"""`/api/agent/*` — write endpoints driven by the helm-agent CLI.

Reads continue to live under `/api/trading` and `/api/ai`. This module adds
the mutations an external agent needs: submit/cancel/close orders, plus a
thin pass-through to the OpenBB Platform API.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from helm.config import get_settings
from helm.engine.manager import get_engine
from helm.models import Order

router = APIRouter()


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
