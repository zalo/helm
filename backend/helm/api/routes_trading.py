"""`/api/trading/*` — read-only views of the trading engine state.

All endpoints read synchronously from the process-wide engine singleton; the
``/api/trading`` prefix is applied by `main.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from helm.engine.manager import get_engine
from helm.models import Account, Bar, Instrument, Order, PortfolioSnapshot, Position

router = APIRouter()


@router.get("/portfolio", response_model=PortfolioSnapshot)
async def get_portfolio() -> PortfolioSnapshot:
    return get_engine().get_portfolio()


@router.get("/positions", response_model=list[Position])
async def get_positions() -> list[Position]:
    return get_engine().get_positions()


@router.get("/orders", response_model=list[Order])
async def get_orders() -> list[Order]:
    return get_engine().get_orders()


@router.get("/account", response_model=list[Account])
async def get_account() -> list[Account]:
    return get_engine().get_accounts()


@router.get("/instruments", response_model=list[Instrument])
async def get_instruments() -> list[Instrument]:
    return get_engine().get_instruments()


@router.get("/bars", response_model=list[Bar])
async def get_bars(
    instrument: str = Query(..., description="Instrument id, e.g. AAPL.NASDAQ"),
    count: int = Query(300, ge=1, le=500, description="Max bars to return"),
) -> list[Bar]:
    return get_engine().get_bars(instrument, count)
