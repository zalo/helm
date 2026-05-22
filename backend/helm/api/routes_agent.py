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

from helm.artifacts import get_artifact, list_artifacts
from helm.config import get_settings
from helm.engine.manager import get_broadcaster, get_engine
from helm.models import (
    AIAction,
    AIDecision,
    BacktestResult,
    BacktestSummary,
    Order,
    RiskAnalysisResult,
    RiskAnalysisSummary,
    StrategyInfo,
)

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


import re

_INSTRUMENT_PATTERN = re.compile(r"^[A-Z0-9._/-]+\.[A-Z][A-Z0-9_]+$")
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
_INSTRUMENTS_KEY = "HELM_INSTRUMENTS"


def _read_env_instruments() -> list[str]:
    """Best-effort current instruments list — runtime cache first, then .env."""
    try:
        return list(get_engine().settings.instruments)
    except Exception:
        pass
    if _ENV_PATH.exists():
        for line in _ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(_INSTRUMENTS_KEY + "="):
                raw = line.split("=", 1)[1].strip()
                if raw.startswith("["):
                    try:
                        return json.loads(raw)
                    except Exception:
                        pass
                return [s.strip() for s in raw.split(",") if s.strip()]
    return []


def _write_env_instruments(items: list[str]) -> None:
    """Idempotent: write/replace ``HELM_INSTRUMENTS=[...]`` in-place in .env."""
    payload = json.dumps(items)
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text().splitlines()
        replaced = False
        out: list[str] = []
        for ln in lines:
            if ln.strip().startswith(_INSTRUMENTS_KEY + "="):
                out.append(f"{_INSTRUMENTS_KEY}={payload}")
                replaced = True
            else:
                out.append(ln)
        if not replaced:
            out.append(f"{_INSTRUMENTS_KEY}={payload}")
        _ENV_PATH.write_text("\n".join(out).rstrip() + "\n")
    else:
        _ENV_PATH.write_text(f"{_INSTRUMENTS_KEY}={payload}\n")


class AddInstrumentRequest(BaseModel):
    id: str = Field(..., description="Instrument id, e.g. AAPL.NASDAQ")


@router.post("/instruments")
async def add_instrument(req: AddInstrumentRequest) -> dict[str, Any]:
    iid = req.id.strip()
    if not _INSTRUMENT_PATTERN.match(iid):
        raise HTTPException(
            status_code=400,
            detail=f"{iid!r} doesn't look like a Nautilus instrument id "
                   "(expected SYMBOL.VENUE, e.g. AAPL.NASDAQ)",
        )
    current = _read_env_instruments()
    if iid in current:
        return {"id": iid, "added": False, "instruments": current,
                "restart_required": False, "note": "already configured (no-op)"}
    next_list = current + [iid]
    _write_env_instruments(next_list)
    return {"id": iid, "added": True, "instruments": next_list,
            "restart_required": True,
            "note": "added to .env; call POST /api/agent/restart (or "
                    "`helm-agent restart`) to load it into the engine"}


@router.delete("/instruments/{instrument_id}")
async def remove_instrument(instrument_id: str) -> dict[str, Any]:
    current = _read_env_instruments()
    if instrument_id not in current:
        return {"id": instrument_id, "removed": False, "instruments": current,
                "restart_required": False, "note": "not in the configured list (no-op)"}
    next_list = [x for x in current if x != instrument_id]
    _write_env_instruments(next_list)
    return {"id": instrument_id, "removed": True, "instruments": next_list,
            "restart_required": True}


# --- self-restart (friction #3) ----------------------------------------------

@router.post("/restart")
async def restart_engine() -> dict[str, Any]:
    """Schedule an in-process ``os.execv`` so the FastAPI app re-reads .env.

    Returns 200 immediately; the actual re-exec happens after the response is
    flushed so the client doesn't see a hang or connection reset.
    """
    import asyncio
    import os
    import sys

    async def _later() -> None:
        await asyncio.sleep(0.2)  # let the HTTP response flush
        os.execv(sys.executable, [sys.executable, "-m", "uvicorn",
                                  "helm.main:app", "--host", "127.0.0.1",
                                  "--port", "8000"])

    asyncio.create_task(_later())
    return {"restarting": True, "in_seconds": 0.2}


# --- pending message queue (delivery-once for agent wakes) -------------------
#
# The chat ring buffer is the durable conversation log. The pending queue is
# a thin delivery layer that lets the live agent see only what it hasn't
# acted on yet — even messages that arrived while it was busy or offline.
# A successful `say` auto-acks the oldest pending wake.

import uuid

_pending_lock = threading.Lock()
_pending: deque[dict[str, Any]] = deque(maxlen=200)


def _enqueue_wake(message: str, source: str, data: dict[str, Any]) -> dict[str, Any]:
    entry = {
        "id": uuid.uuid4().hex[:12],
        "message": message,
        "source": source,
        "data": data,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    with _pending_lock:
        _pending.append(entry)
    return entry


def _ack_oldest() -> dict[str, Any] | None:
    with _pending_lock:
        if not _pending:
            return None
        return _pending.popleft()


@router.get("/pending")
async def get_pending() -> dict[str, Any]:
    """Return all unprocessed wake messages, oldest first."""
    with _pending_lock:
        items = list(_pending)
    return {"count": len(items), "messages": items}


@router.post("/ack/{message_id}")
async def ack_message(message_id: str) -> dict[str, Any]:
    """Mark a specific queued wake as processed (idempotent no-op if missing)."""
    with _pending_lock:
        before = len(_pending)
        kept = [m for m in _pending if m["id"] != message_id]
        _pending.clear()
        _pending.extend(kept)
        removed = before - len(_pending)
    return {"id": message_id, "acked": removed > 0, "remaining": len(kept)}


# --- Nautilus artifacts: backtests + risk + strategies -----------------------


@router.get("/backtests", response_model=list[BacktestSummary])
async def list_backtests() -> list[BacktestSummary]:
    """Every backtest result the engine knows about (live + seed)."""
    return [BacktestSummary.model_validate(_drop_full(x))
            for x in list_artifacts("backtests")]


@router.get("/backtests/{artifact_id}", response_model=BacktestResult)
async def get_backtest(artifact_id: str) -> BacktestResult:
    data = get_artifact("backtests", artifact_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"backtest {artifact_id!r} not found")
    return BacktestResult.model_validate(data)


@router.get("/risk", response_model=list[RiskAnalysisSummary])
async def list_risk() -> list[RiskAnalysisSummary]:
    return [RiskAnalysisSummary.model_validate(_drop_full(x))
            for x in list_artifacts("risk")]


@router.get("/risk/{artifact_id}", response_model=RiskAnalysisResult)
async def get_risk(artifact_id: str) -> RiskAnalysisResult:
    data = get_artifact("risk", artifact_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"risk analysis {artifact_id!r} not found")
    return RiskAnalysisResult.model_validate(data)


def _drop_full(d: dict[str, Any]) -> dict[str, Any]:
    """Strip large detail fields for list endpoints (keep summary lean)."""
    out = dict(d)
    for k in ("equity_curve", "trades", "exposures", "scenarios", "notes"):
        out.pop(k, None)
    return out


class DecisionRequest(BaseModel):
    """An externally-produced trading decision the agent wants surfaced."""
    action: str = Field(..., pattern="^(BUY|SELL|HOLD|CLOSE)$")
    instrument: str | None = None
    confidence: float = Field(0.7, ge=0.0, le=1.0)
    thesis: str = Field(..., min_length=1)
    reasoning: str = ""
    order_id: str | None = None
    status: str = Field("proposed", pattern="^(proposed|executed|skipped|rejected)$")


@router.post("/decisions", response_model=AIDecision)
async def post_decision(req: DecisionRequest) -> AIDecision:
    """Push a decision into the Decisions feed.

    The in-process AIBrain timer is disabled by default; this endpoint is the
    canonical way for an external agent (helm-agent decide …) to put a
    decision into the Decisions tab.
    """
    import uuid as _uuid
    decision = AIDecision(
        id=f"dec-{_uuid.uuid4().hex[:12]}",
        ts=datetime.now(timezone.utc),
        action=AIAction(req.action),
        instrument=req.instrument,
        confidence=req.confidence,
        thesis=req.thesis,
        reasoning=req.reasoning or req.thesis,
        order_id=req.order_id,
        status=req.status,
    )
    return await get_engine().record_decision(decision)


@router.get("/strategies", response_model=list[StrategyInfo])
async def list_strategies() -> list[StrategyInfo]:
    """The trader strategies the running TradingNode has registered.

    For now this is the AITraderStrategy (kept loaded as the order conduit) +
    any backtest strategies known to ship with the repo. Extend as new live
    strategies are added.
    """
    items: list[StrategyInfo] = [
        StrategyInfo(
            id="ai-trader",
            name="AITraderStrategy",
            kind="live",
            description=("Nautilus Strategy that the helm-agent CLI submits "
                         "orders through. The internal AIBrain timer is "
                         "disabled by default; the external Claude Code "
                         "operator drives decisions."),
        ),
        StrategyInfo(
            id="backtest-ai-trader",
            name="backtest_ai_trader.py",
            kind="backtest",
            description=("Sample backtest harness wrapping the same "
                         "AITraderStrategy against historical parquet bars. "
                         "Located at backend/scripts/backtest_ai_trader.py "
                         "(per docs/AGENT_GUIDE.md §5)."),
        ),
    ]
    return items


class WakeRequest(BaseModel):
    """Webui-driven wake-up signal for a waiting `helm-agent sleep --on-event wake`."""
    message: str = Field("", description="Free-form message for the waiting agent")
    source: str = Field("webui", description="Originating UI surface for the wake")
    data: dict[str, Any] = Field(default_factory=dict)


@router.post("/wake")
async def wake_agent(req: WakeRequest) -> dict[str, Any]:
    queued: dict[str, Any] | None = None
    if req.message:
        queued = _enqueue_wake(req.message, req.source, req.data)
        _append_chat({"role": "user", "message": req.message,
                      "source": req.source, "ts": queued["ts"],
                      "id": queued["id"]})
    payload = {
        "id": queued["id"] if queued else None,
        "message": req.message,
        "source": req.source,
        "data": req.data,
        "ts": queued["ts"] if queued else datetime.now(timezone.utc).isoformat(),
    }
    await get_broadcaster().publish("wake", payload)
    return {"woken": True, "queued": queued is not None, "payload": payload}


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
    # A reply implicitly acknowledges the oldest unprocessed wake.
    acked = _ack_oldest()
    await get_broadcaster().publish("agent_message", payload)
    return {"posted": True, "payload": payload,
            "acked_wake_id": acked["id"] if acked else None}


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
