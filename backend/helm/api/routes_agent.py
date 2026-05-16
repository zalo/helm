"""`/api/agent/*` — write endpoints driven by the helm-agent CLI.

Reads continue to live under `/api/trading` and `/api/ai`. This module adds
the mutations an external agent needs: submit/cancel/close orders, plus a
thin pass-through to the OpenBB Platform API.
"""

from __future__ import annotations

import json
import logging
import threading
from collections import deque
from pathlib import Path
from typing import Any

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from helm.config import get_settings
from helm.engine.manager import get_broadcaster, get_engine
from helm.models import Order

log = logging.getLogger("helm.api.agent")

router = APIRouter()


# --- chat ring buffer (disk-backed) -----------------------------------------
#
# Both `wake` (user → agent) and `say` (agent → user) messages are appended so
# the Chat panel can pull the full conversation on mount, regardless of whether
# the tab was open when an earlier event fired. The buffer is bounded; oldest
# entries fall off.
_CHAT_MAX = 500
_CHAT_PATH = Path(__file__).resolve().parents[2] / ".chat_history.json"
_chat_lock = threading.Lock()


def _load_chat() -> deque[dict[str, Any]]:
    try:
        if _CHAT_PATH.exists():
            data = json.loads(_CHAT_PATH.read_text())
            if isinstance(data, list):
                return deque(data[-_CHAT_MAX:], maxlen=_CHAT_MAX)
    except Exception:
        log.warning("chat history file unreadable; starting fresh", exc_info=True)
    return deque(maxlen=_CHAT_MAX)


_chat: deque[dict[str, Any]] = _load_chat()


def _append_chat(entry: dict[str, Any]) -> None:
    with _chat_lock:
        _chat.append(entry)
        try:
            _CHAT_PATH.write_text(json.dumps(list(_chat)))
        except Exception:
            log.debug("chat history flush failed", exc_info=True)


class SubmitOrderRequest(BaseModel):
    instrument: str = Field(..., description="Instrument id, e.g. AAPL.NASDAQ")
    side: str = Field(..., pattern="^(BUY|SELL)$")
    quantity: float = Field(..., gt=0.0)
    type: str = Field("MARKET", pattern="^(MARKET|LIMIT)$")
    price: float | None = None


@router.post("/orders", response_model=Order)
async def submit_order(req: SubmitOrderRequest) -> Order:
    try:
        return await get_engine().submit_order(
            req.instrument, req.side, req.quantity, req.type, req.price,
        )
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: str) -> dict[str, Any]:
    ok = await get_engine().cancel_order(order_id)
    return {"order_id": order_id, "cancelled": ok}


@router.post("/close/{instrument}")
async def close_position(instrument: str) -> dict[str, Any]:
    order = await get_engine().close_position(instrument)
    return {
        "instrument": instrument,
        "closed": order is not None,
        "order": order.model_dump(mode="json") if order else None,
    }


class WakeRequest(BaseModel):
    """Webui-driven wake-up signal for a waiting `helm-agent sleep --on-event wake`."""
    message: str = Field("", description="Free-form message for the waiting agent")
    source: str = Field("webui", description="Originating UI surface for the wake")
    data: dict[str, Any] = Field(default_factory=dict)


@router.post("/wake")
async def wake_agent(req: WakeRequest) -> dict[str, Any]:
    payload = {
        "message": req.message,
        "source": req.source,
        "data": req.data,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if req.message:
        _append_chat({"role": "user", "message": req.message,
                      "source": req.source, "ts": payload["ts"]})
    await get_broadcaster().publish("wake", payload)
    return {"woken": True, "payload": payload}


class AgentSayRequest(BaseModel):
    """Outbound message from the agent (operated by Claude Code) → webui chat."""
    message: str = Field(..., description="Message body shown in the chat panel")
    role: str = Field("agent", description="Sender label; defaults to 'agent'")
    data: dict[str, Any] = Field(default_factory=dict)


@router.post("/say")
async def agent_say(req: AgentSayRequest) -> dict[str, Any]:
    payload = {
        "message": req.message,
        "role": req.role,
        "data": req.data,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    _append_chat({"role": req.role, "message": req.message, "ts": payload["ts"]})
    await get_broadcaster().publish("agent_message", payload)
    return {"posted": True, "payload": payload}


@router.get("/chat")
async def get_chat_history(
    limit: int = Query(500, ge=1, le=_CHAT_MAX),
) -> dict[str, Any]:
    """Full chat history — agent says + user wakes, oldest first."""
    with _chat_lock:
        items = list(_chat)[-limit:]
    return {"count": len(items), "messages": items}


class OpenBBProxy(BaseModel):
    path: str = Field(..., description="OpenBB path, e.g. /api/v1/news/world")
    params: dict[str, Any] = Field(default_factory=dict)


@router.post("/openbb")
async def openbb_proxy(req: OpenBBProxy) -> Any:
    base = get_settings().openbb_api_url
    if not base:
        raise HTTPException(status_code=503, detail="HELM_OPENBB_API_URL not configured")
    url = base.rstrip("/") + ("/" + req.path.lstrip("/"))
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(url, params=req.params)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"openbb upstream: {e!s}")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text[:1000])
    try:
        return r.json()
    except ValueError:
        return {"raw": r.text}
