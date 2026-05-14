"""`BaseEngine` — the contract every engine implementation satisfies.

Routes and the WebSocket handler depend only on this interface, so the demo
simulator and the real Nautilus engine are fully interchangeable.
"""

from __future__ import annotations

import abc

from helm.config import Settings
from helm.engine.events import EventBroadcaster
from helm.models import (
    Account,
    AIControlRequest,
    AIDecision,
    AITraderStatus,
    Bar,
    Instrument,
    Order,
    PortfolioSnapshot,
    Position,
)


class BaseEngine(abc.ABC):
    """Lifecycle + read API for a trading engine.

    Implementations must be safe to query synchronously (routes call the
    getters directly) and must push live updates through ``self.events``.
    """

    def __init__(self, settings: Settings, events: EventBroadcaster) -> None:
        self.settings = settings
        self.events = events
        self._running = False

    # --- lifecycle ---------------------------------------------------------
    @abc.abstractmethod
    async def start(self) -> None:
        """Boot the engine and the AI trader; begin emitting events."""

    @abc.abstractmethod
    async def stop(self) -> None:
        """Tear down cleanly."""

    @property
    def running(self) -> bool:
        return self._running

    # --- trading state (synchronous reads) ---------------------------------
    @abc.abstractmethod
    def get_portfolio(self) -> PortfolioSnapshot: ...

    @abc.abstractmethod
    def get_positions(self) -> list[Position]: ...

    @abc.abstractmethod
    def get_orders(self) -> list[Order]: ...

    @abc.abstractmethod
    def get_accounts(self) -> list[Account]: ...

    @abc.abstractmethod
    def get_instruments(self) -> list[Instrument]: ...

    @abc.abstractmethod
    def get_bars(self, instrument: str, count: int = 300) -> list[Bar]: ...

    # --- AI trader ---------------------------------------------------------
    @abc.abstractmethod
    def get_ai_status(self) -> AITraderStatus: ...

    @abc.abstractmethod
    def get_ai_decisions(self, limit: int = 100) -> list[AIDecision]: ...

    @abc.abstractmethod
    async def ai_control(self, request: AIControlRequest) -> AITraderStatus: ...
