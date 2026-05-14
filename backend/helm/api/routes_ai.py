"""`/api/ai/*` — AI trader status, decision history, and pause/resume control.

The ``/api/ai`` prefix is applied by `main.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from helm.engine.manager import get_engine
from helm.models import AIControlRequest, AIDecision, AITraderStatus

router = APIRouter()


@router.get("/status", response_model=AITraderStatus)
async def get_status() -> AITraderStatus:
    return get_engine().get_ai_status()


@router.get("/decisions", response_model=list[AIDecision])
async def get_decisions(
    limit: int = Query(100, ge=1, le=500, description="Max decisions (newest first)"),
) -> list[AIDecision]:
    return get_engine().get_ai_decisions(limit)


@router.post("/control", response_model=AITraderStatus)
async def control(request: AIControlRequest) -> AITraderStatus:
    return await get_engine().ai_control(request)
