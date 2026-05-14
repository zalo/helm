"""`NautilusEngine` — embeds a real Nautilus `TradingNode` in-process.

Nautilus exposes no REST/WS API of its own, so Helm runs the `TradingNode` via
``run_async()`` inside the FastAPI process: REST getters read straight from
``node.kernel.cache`` / ``node.portfolio``, and a registered `BridgeActor`
forwards live events to WebSocket clients.

All `nautilus_trader` imports are deferred to method/`__init__` bodies so this
module imports cleanly even when Nautilus is not installed — it is only
*constructed* when Nautilus is present and ``mode != demo`` (see
`engine/manager.py`). The mapping helpers are module-level so `BridgeActor` and
`AITraderStrategy` can reuse them.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timezone
from typing import Any

from helm.ai.decisions import DecisionStore
from helm.config import Settings
from helm.engine.base import BaseEngine
from helm.engine.events import EventBroadcaster
from helm.models import (
    Account,
    AIControlRequest,
    AIDecision,
    AIState,
    AITraderStatus,
    Bar,
    EquityPoint,
    Instrument,
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
    PortfolioSnapshot,
    Position,
    PositionSide,
)

log = logging.getLogger("helm.engine.nautilus")


# --------------------------------------------------------------------------- #
# Mapping helpers: Nautilus domain objects -> Helm Pydantic models.
# These are intentionally defensive — a mapping failure must never crash the
# app. They are module-level so BridgeActor / AITraderStrategy can reuse them.
# --------------------------------------------------------------------------- #


def _utc(ns: int | None) -> datetime:
    """Convert Nautilus nanosecond UNIX timestamp to a tz-aware UTC datetime."""
    if not ns:
        return datetime.now(timezone.utc)
    return datetime.fromtimestamp(ns / 1_000_000_000, tz=timezone.utc)


def _f(value: Any, default: float = 0.0) -> float:
    """Best-effort float coercion for Nautilus Price/Quantity/Money objects."""
    if value is None:
        return default
    for attr in ("as_double",):
        fn = getattr(value, attr, None)
        if callable(fn):
            try:
                return float(fn())
            except Exception:
                pass
    try:
        return float(value)
    except Exception:
        return default


def map_instrument(instrument: Any) -> dict[str, Any] | None:
    try:
        instrument_id = instrument.id
        symbol = str(getattr(instrument_id, "symbol", "")) or str(instrument_id)
        venue = str(getattr(instrument_id, "venue", "")) or "SIM"
        asset_class = str(getattr(instrument, "asset_class", "EQUITY")).upper()
        # Nautilus asset_class enum names roughly line up; normalise loosely.
        if "CRYPTO" in asset_class:
            asset_class = "CRYPTO"
        elif "FX" in asset_class or "FOREX" in asset_class:
            asset_class = "FX"
        return Instrument(
            id=str(instrument_id),
            symbol=symbol,
            venue=venue,
            asset_class=asset_class if asset_class else "EQUITY",
            quote_currency=str(getattr(instrument, "quote_currency", "USD")),
            price_precision=int(getattr(instrument, "price_precision", 2) or 2),
            size_precision=int(getattr(instrument, "size_precision", 0) or 0),
        ).model_dump(mode="json")
    except Exception:  # pragma: no cover - defensive
        log.debug("map_instrument failed", exc_info=True)
        return None


def map_bar(bar: Any) -> dict[str, Any] | None:
    try:
        bar_type = getattr(bar, "bar_type", None)
        instrument_id = getattr(bar_type, "instrument_id", None)
        return Bar(
            instrument=str(instrument_id) if instrument_id else "",
            ts=_utc(getattr(bar, "ts_event", None)),
            open=_f(bar.open),
            high=_f(bar.high),
            low=_f(bar.low),
            close=_f(bar.close),
            volume=_f(getattr(bar, "volume", None)),
        ).model_dump(mode="json")
    except Exception:  # pragma: no cover - defensive
        log.debug("map_bar failed", exc_info=True)
        return None


def map_order(order: Any) -> dict[str, Any] | None:
    try:
        side_raw = str(getattr(order, "side", "")).upper()
        side = OrderSide.BUY if "BUY" in side_raw else OrderSide.SELL

        type_raw = str(getattr(order, "order_type", "")).upper()
        if "STOP" in type_raw and "LIMIT" in type_raw:
            otype = OrderType.STOP_LIMIT
        elif "STOP" in type_raw:
            otype = OrderType.STOP_MARKET
        elif "LIMIT" in type_raw:
            otype = OrderType.LIMIT
        else:
            otype = OrderType.MARKET

        status_raw = str(getattr(order, "status", "")).upper()
        try:
            status = OrderStatus(status_raw)
        except ValueError:
            status = OrderStatus.INITIALIZED

        price = getattr(order, "price", None)
        avg_px = getattr(order, "avg_px", None)
        return Order(
            id=str(getattr(order, "client_order_id", "")) or str(id(order)),
            instrument=str(getattr(order, "instrument_id", "")),
            side=side,
            type=otype,
            status=status,
            quantity=_f(getattr(order, "quantity", None)),
            filled_qty=_f(getattr(order, "filled_qty", None)),
            price=_f(price) if price is not None else None,
            avg_px=_f(avg_px) if avg_px is not None else None,
            ts=_utc(getattr(order, "ts_init", None)),
            strategy=str(getattr(order, "strategy_id", "ai-trader")),
        ).model_dump(mode="json")
    except Exception:  # pragma: no cover - defensive
        log.debug("map_order failed", exc_info=True)
        return None


def map_position(position: Any) -> dict[str, Any] | None:
    try:
        side_raw = str(getattr(position, "side", "")).upper()
        if "LONG" in side_raw:
            side = PositionSide.LONG
        elif "SHORT" in side_raw:
            side = PositionSide.SHORT
        else:
            side = PositionSide.FLAT

        quantity = abs(_f(getattr(position, "quantity", None)))
        last_px = _f(getattr(position, "last_px", None) or getattr(position, "avg_px_open", None))
        avg_px = _f(getattr(position, "avg_px_open", None))
        return Position(
            id=str(getattr(position, "id", "")) or str(id(position)),
            instrument=str(getattr(position, "instrument_id", "")),
            side=side,
            quantity=quantity,
            avg_px=avg_px,
            last_px=last_px,
            market_value=round(last_px * quantity, 2),
            unrealized_pnl=_f(getattr(position, "unrealized_pnl", None)),
            realized_pnl=_f(getattr(position, "realized_pnl", None)),
            opened_at=_utc(getattr(position, "ts_opened", None)),
            strategy=str(getattr(position, "strategy_id", "ai-trader")),
        ).model_dump(mode="json")
    except Exception:  # pragma: no cover - defensive
        log.debug("map_position failed", exc_info=True)
        return None


def map_account(account: Any) -> dict[str, Any] | None:
    try:
        # AccountState events and Account objects both expose balances.
        currency = "USD"
        balance = free = used = 0.0
        balances_fn = getattr(account, "balances", None)
        if callable(balances_fn):
            balances = balances_fn()
            values = list(balances.values()) if hasattr(balances, "values") else list(balances)
            if values:
                b = values[0]
                balance = _f(getattr(b, "total", None))
                free = _f(getattr(b, "free", None))
                used = _f(getattr(b, "locked", None))
                currency = str(getattr(b, "currency", "USD"))
        else:
            balance = _f(getattr(account, "balance_total", lambda: None)())
            free = _f(getattr(account, "balance_free", lambda: None)())
            used = _f(getattr(account, "balance_locked", lambda: None)())

        return Account(
            id=str(getattr(account, "id", "")) or "NAUTILUS",
            currency=currency,
            balance=balance,
            equity=balance,
            free=free,
            used=used,
        ).model_dump(mode="json")
    except Exception:  # pragma: no cover - defensive
        log.debug("map_account failed", exc_info=True)
        return None


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #


class NautilusEngine(BaseEngine):
    """Embeds a Nautilus `TradingNode` and maps its state to the Helm contract."""

    def __init__(self, settings: Settings, events: EventBroadcaster) -> None:
        super().__init__(settings, events)
        self._node: Any = None
        self._run_task: asyncio.Task | None = None
        self._decisions = DecisionStore()
        self._ai_enabled = settings.ai_autostart
        self._ai_state = AIState.IDLE
        self._started_at: datetime | None = None
        self._equity_curve: list[EquityPoint] = []

    # -- lifecycle ----------------------------------------------------------
    async def start(self) -> None:
        if self._running:
            return
        # Imported here so the module is importable without nautilus_trader.
        from nautilus_trader.config import (
            ImportableActorConfig,
            LoggingConfig,
            TradingNodeConfig,
        )
        from nautilus_trader.live.node import TradingNode
        from nautilus_trader.model.identifiers import TraderId

        from helm.ai.trader import build_ai_trader_strategy
        from helm.engine.bridge_actor import build_bridge_actor

        data_clients: dict[str, Any] = {}
        exec_clients: dict[str, Any] = {}

        # Wire a Binance venue only when credentials are present; otherwise the
        # node runs bare (still useful for backtest-style / sandbox wiring).
        if self.settings.binance_api_key and self.settings.binance_api_secret:
            try:
                from nautilus_trader.adapters.binance.config import (
                    BinanceDataClientConfig,
                    BinanceExecClientConfig,
                )
                from nautilus_trader.adapters.binance.factories import (
                    BinanceLiveDataClientFactory,
                    BinanceLiveExecClientFactory,
                )

                data_clients["BINANCE"] = BinanceDataClientConfig(
                    api_key=self.settings.binance_api_key,
                    api_secret=self.settings.binance_api_secret,
                )
                exec_clients["BINANCE"] = BinanceExecClientConfig(
                    api_key=self.settings.binance_api_key,
                    api_secret=self.settings.binance_api_secret,
                )
                self._binance_factories = (
                    BinanceLiveDataClientFactory,
                    BinanceLiveExecClientFactory,
                )
            except Exception:  # pragma: no cover - adapter optional
                log.exception("Binance adapter unavailable; running node bare.")
                self._binance_factories = None
        else:
            self._binance_factories = None

        config = TradingNodeConfig(
            trader_id=TraderId(self.settings.trader_id),
            logging=LoggingConfig(log_level="INFO"),
            data_clients=data_clients,
            exec_clients=exec_clients,
        )

        node = TradingNode(config=config)

        # Register adapter factories (if any) before build().
        if self._binance_factories is not None:
            data_factory, exec_factory = self._binance_factories
            with contextlib.suppress(Exception):
                node.add_data_client_factory("BINANCE", data_factory)
                node.add_exec_client_factory("BINANCE", exec_factory)

        # Resolve configured instrument ids.
        from nautilus_trader.model.identifiers import InstrumentId

        instrument_ids: list[Any] = []
        for spec in self.settings.instruments:
            with contextlib.suppress(Exception):
                instrument_ids.append(InstrumentId.from_str(spec))

        # Register the bridge actor + AI trader strategy.
        with contextlib.suppress(Exception):
            bridge = build_bridge_actor(self.events, instrument_ids)
            node.trader.add_actor(bridge)
        with contextlib.suppress(Exception):
            strategy = build_ai_trader_strategy(
                events=self.events,
                decisions=self._decisions,
                instrument_ids=instrument_ids,
                tick_seconds=self.settings.ai_tick_seconds,
            )
            node.trader.add_strategy(strategy)

        node.build()
        self._node = node
        self._run_task = asyncio.create_task(node.run_async(), name="nautilus-node")
        self._running = True
        self._started_at = datetime.now(timezone.utc)
        self._ai_state = AIState.IDLE if self._ai_enabled else AIState.PAUSED
        log.info("NautilusEngine started (trader_id=%s).", self.settings.trader_id)

    async def stop(self) -> None:
        self._running = False
        if self._node is not None:
            with contextlib.suppress(Exception):
                await self._node.stop_async()
            with contextlib.suppress(Exception):
                self._node.dispose()
        if self._run_task is not None:
            self._run_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._run_task
        self._node = None
        self._run_task = None
        log.info("NautilusEngine stopped.")

    # -- cache access -------------------------------------------------------
    @property
    def _cache(self) -> Any:
        if self._node is None:
            return None
        try:
            return self._node.kernel.cache
        except Exception:  # pragma: no cover - defensive
            return None

    @property
    def _portfolio(self) -> Any:
        if self._node is None:
            return None
        try:
            return self._node.portfolio
        except Exception:  # pragma: no cover - defensive
            return None

    # -- getters ------------------------------------------------------------
    def get_portfolio(self) -> PortfolioSnapshot:
        now = datetime.now(timezone.utc)
        start = self.settings.starting_equity
        equity = start
        unrealized = 0.0
        realized = 0.0
        net_exposure = 0.0
        positions = self.get_positions()

        portfolio = self._portfolio
        cache = self._cache
        try:
            if portfolio is not None and cache is not None:
                from nautilus_trader.model.objects import Currency

                ccy = Currency.from_str(self.settings.base_currency)
                # portfolio.realized_pnl()/unrealized_pnl() are per-instrument;
                # sum across configured instruments defensively.
                for inst in cache.instruments():
                    with contextlib.suppress(Exception):
                        u = portfolio.unrealized_pnl(inst.id)
                        if u is not None:
                            unrealized += _f(u)
                    with contextlib.suppress(Exception):
                        r = portfolio.realized_pnl(inst.id)
                        if r is not None:
                            realized += _f(r)
        except Exception:  # pragma: no cover - defensive
            log.debug("portfolio pnl aggregation failed", exc_info=True)

        accounts = self.get_accounts()
        if accounts:
            equity = sum(a.equity for a in accounts)
        else:
            equity = start + unrealized + realized

        for p in positions:
            net_exposure += p.market_value if p.side is PositionSide.LONG else -p.market_value

        total_pnl = equity - start
        self._equity_curve.append(EquityPoint(ts=now, equity=round(equity, 2)))
        if len(self._equity_curve) > 2000:
            self._equity_curve = self._equity_curve[-2000:]

        return PortfolioSnapshot(
            ts=now,
            currency=self.settings.base_currency,
            equity=round(equity, 2),
            starting_equity=start,
            total_pnl=round(total_pnl, 2),
            total_pnl_pct=round((total_pnl / start) * 100.0, 4) if start else 0.0,
            unrealized_pnl=round(unrealized, 2),
            realized_pnl=round(realized, 2),
            net_exposure=round(net_exposure, 2),
            positions_count=len(positions),
            win_rate=self._decisions.win_rate,
            sharpe=0.0,
            max_drawdown_pct=0.0,
            equity_curve=list(self._equity_curve),
        )

    def get_positions(self) -> list[Position]:
        cache = self._cache
        if cache is None:
            return []
        out: list[Position] = []
        with contextlib.suppress(Exception):
            for raw in cache.positions():
                mapped = map_position(raw)
                if mapped is not None:
                    out.append(Position(**mapped))
        return out

    def get_orders(self) -> list[Order]:
        cache = self._cache
        if cache is None:
            return []
        out: list[Order] = []
        with contextlib.suppress(Exception):
            for raw in cache.orders():
                mapped = map_order(raw)
                if mapped is not None:
                    out.append(Order(**mapped))
        out.sort(key=lambda o: o.ts, reverse=True)
        return out

    def get_accounts(self) -> list[Account]:
        cache = self._cache
        if cache is None:
            return []
        out: list[Account] = []
        with contextlib.suppress(Exception):
            for raw in cache.accounts():
                mapped = map_account(raw)
                if mapped is not None:
                    out.append(Account(**mapped))
        return out

    def get_instruments(self) -> list[Instrument]:
        cache = self._cache
        if cache is None:
            return []
        out: list[Instrument] = []
        with contextlib.suppress(Exception):
            for raw in cache.instruments():
                mapped = map_instrument(raw)
                if mapped is not None:
                    out.append(Instrument(**mapped))
        return out

    def get_bars(self, instrument: str, count: int = 300) -> list[Bar]:
        cache = self._cache
        if cache is None:
            return []
        out: list[Bar] = []
        with contextlib.suppress(Exception):
            from nautilus_trader.model.data import BarType

            bar_type = BarType.from_str(f"{instrument}-1-MINUTE-LAST-INTERNAL")
            raw_bars = cache.bars(bar_type)
            # cache.bars() returns newest-first; reverse to oldest-first.
            for raw in reversed(list(raw_bars)[:count]):
                mapped = map_bar(raw)
                if mapped is not None:
                    out.append(Bar(**mapped))
        return out

    def get_ai_status(self) -> AITraderStatus:
        uptime = (
            (datetime.now(timezone.utc) - self._started_at).total_seconds()
            if self._started_at
            else 0.0
        )
        return AITraderStatus(
            state=self._ai_state,
            mode=self.settings.mode,
            strategy_name=self.settings.strategy_name,
            last_run=self._decisions.list(1)[0].ts if len(self._decisions) else None,
            uptime_s=round(uptime, 1),
            decisions_today=self._decisions.decisions_today,
            win_rate=self._decisions.win_rate,
            enabled=self._ai_enabled,
        )

    def get_ai_decisions(self, limit: int = 100) -> list[AIDecision]:
        return self._decisions.list(limit=limit)

    async def ai_control(self, request: AIControlRequest) -> AITraderStatus:
        # Pause/resume the AI trader strategy without tearing down the node.
        if request.action == "pause":
            self._ai_enabled = False
            self._ai_state = AIState.PAUSED
        elif request.action == "resume":
            self._ai_enabled = True
            self._ai_state = AIState.IDLE
        if self._node is not None:
            with contextlib.suppress(Exception):
                for strategy in self._node.trader.strategies():
                    if request.action == "pause":
                        strategy.stop()
                    else:
                        strategy.start()
        await self.events.publish(
            "ai_status", self.get_ai_status().model_dump(mode="json")
        )
        return self.get_ai_status()
