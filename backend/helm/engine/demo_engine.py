"""`DemoEngine` — a self-contained market + portfolio + AI-trader simulator.

Lets Helm run end-to-end with zero credentials: every instrument follows a
geometric-Brownian-motion random walk, 1-minute OHLCV bars are assembled live,
and the `AIBrain` trades a simulated book against them. All state is in-memory
and every change is published to WebSocket clients via the `EventBroadcaster`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import random
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

from helm.ai.brain import AIBrain, MarketState
from helm.ai.decisions import DecisionStore
from helm.config import Settings
from helm.engine.base import BaseEngine
from helm.engine.events import EventBroadcaster
from helm.models import (
    Account,
    AIAction,
    AIControlRequest,
    AIDecision,
    AIState,
    AITraderStatus,
    Bar,
    EngineMode,
    EquityPoint,
    Instrument,
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
    PortfolioSnapshot,
    Position,
    PositionSide,
    Quote,
)

log = logging.getLogger("helm.engine.demo")

# Per-asset-class seed prices and GBM parameters (drift / annualised vol).
_SEEDS: dict[str, tuple[float, str, str, int]] = {
    # symbol-prefix -> (seed_px, asset_class, quote_ccy, price_precision)
    "AAPL": (228.50, "EQUITY", "USD", 2),
    "NVDA": (135.20, "EQUITY", "USD", 2),
    "TSLA": (251.40, "EQUITY", "USD", 2),
    "BTCUSDT": (67_400.0, "CRYPTO", "USDT", 2),
    "ETHUSDT": (3_240.0, "CRYPTO", "USDT", 2),
    "EURUSD": (1.0850, "FX", "USD", 5),
}
_BAR_LIMIT = 500
_TICK_SECONDS = 1.0
_PORTFOLIO_EVERY = 4  # publish a portfolio event every N ticks
_TRADE_SIZE_FRACTION = 0.08  # fraction of equity to deploy per opening trade


class _Sim:
    """Per-instrument price simulator + bar aggregator."""

    def __init__(self, instrument: Instrument, seed_px: float, rng: random.Random) -> None:
        self.instrument = instrument
        self.rng = rng
        self.price = seed_px
        self.session_open = seed_px
        self.bars: deque[Bar] = deque(maxlen=_BAR_LIMIT)
        self._bar_minute: datetime | None = None
        self._o = self._h = self._l = self._c = seed_px
        self._vol_accum = 0.0
        # GBM params — annualised vol scaled per asset class.
        self._mu = 0.0
        self._sigma = 0.45 if instrument.asset_class == "CRYPTO" else (
            0.06 if instrument.asset_class == "FX" else 0.28
        )
        # Backfill a little history so the UI + brain have something on load.
        self._backfill()

    def _step_price(self) -> float:
        # GBM increment over one ~1s tick (dt in years).
        dt = _TICK_SECONDS / (365.0 * 24.0 * 3600.0)
        shock = self.rng.gauss(0.0, 1.0)
        drift = (self._mu - 0.5 * self._sigma**2) * dt
        diffusion = self._sigma * math.sqrt(dt) * shock
        self.price *= math.exp(drift + diffusion)
        return self.price

    def _backfill(self) -> None:
        """Seed ~120 one-minute bars of plausible history ending now."""
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        px = self.session_open
        bars: list[Bar] = []
        for i in range(120, 0, -1):
            ts = now - timedelta(minutes=i)
            o = px
            # ~60 sub-steps per minute.
            hi = lo = px
            for _ in range(60):
                dt = 1.0 / (365.0 * 24.0 * 3600.0)
                shock = self.rng.gauss(0.0, 1.0)
                px *= math.exp(-0.5 * self._sigma**2 * dt + self._sigma * math.sqrt(dt) * shock)
                hi = max(hi, px)
                lo = min(lo, px)
            bars.append(
                Bar(
                    instrument=self.instrument.id,
                    ts=ts,
                    open=round(o, 6),
                    high=round(hi, 6),
                    low=round(lo, 6),
                    close=round(px, 6),
                    volume=round(self.rng.uniform(500, 5000), 2),
                )
            )
        self.bars.extend(bars)
        self.price = px
        self.session_open = bars[0].open if bars else px

    def tick(self) -> tuple[Quote, Bar | None]:
        """Advance one tick. Returns the new quote and a finalised bar if a
        minute boundary was crossed."""
        px = self._step_price()
        now = datetime.now(timezone.utc)
        minute = now.replace(second=0, microsecond=0)
        finalised: Bar | None = None

        if self._bar_minute is None:
            self._bar_minute = minute
            self._o = self._h = self._l = self._c = px
            self._vol_accum = 0.0
        elif minute != self._bar_minute:
            finalised = Bar(
                instrument=self.instrument.id,
                ts=self._bar_minute,
                open=round(self._o, 6),
                high=round(self._h, 6),
                low=round(self._l, 6),
                close=round(self._c, 6),
                volume=round(self._vol_accum, 2),
            )
            self.bars.append(finalised)
            self._bar_minute = minute
            self._o = self._h = self._l = self._c = px
            self._vol_accum = 0.0
        else:
            self._h = max(self._h, px)
            self._l = min(self._l, px)
            self._c = px
            self._vol_accum += self.rng.uniform(5, 80)

        prec = self.instrument.price_precision
        spread = max(px * 0.0002, 10 ** -prec)
        change_pct = (
            ((px - self.session_open) / self.session_open) * 100.0
            if self.session_open
            else 0.0
        )
        quote = Quote(
            instrument=self.instrument.id,
            ts=now,
            bid=round(px - spread / 2, 6),
            ask=round(px + spread / 2, 6),
            last=round(px, 6),
            change_pct=round(change_pct, 4),
        )
        return quote, finalised

    def live_bar(self) -> Bar:
        """The in-progress (not yet finalised) current-minute bar."""
        ts = self._bar_minute or datetime.now(timezone.utc).replace(second=0, microsecond=0)
        return Bar(
            instrument=self.instrument.id,
            ts=ts,
            open=round(self._o, 6),
            high=round(self._h, 6),
            low=round(self._l, 6),
            close=round(self._c, 6),
            volume=round(self._vol_accum, 2),
        )

    def all_bars(self) -> list[Bar]:
        return list(self.bars) + [self.live_bar()]


def _parse_instrument(spec: str) -> Instrument:
    """Turn an ``"AAPL.NASDAQ"`` spec into an `Instrument`."""
    symbol, _, venue = spec.partition(".")
    venue = venue or "SIM"
    seed_px, asset_class, quote_ccy, prec = _SEEDS.get(symbol, (100.0, "EQUITY", "USD", 2))
    return Instrument(
        id=spec,
        symbol=symbol,
        venue=venue,
        asset_class=asset_class,
        quote_currency=quote_ccy,
        price_precision=prec,
        size_precision=4 if asset_class in ("CRYPTO", "FX") else 0,
    )


class DemoEngine(BaseEngine):
    """In-memory simulator implementing the full `BaseEngine` contract."""

    def __init__(self, settings: Settings, events: EventBroadcaster) -> None:
        super().__init__(settings, events)
        self._rng = random.Random(1337)
        self._brain = AIBrain(seed=42)
        self._decisions = DecisionStore()

        # Market simulators.
        self._sims: dict[str, _Sim] = {}
        for spec in settings.instruments:
            inst = _parse_instrument(spec)
            seed_px, *_ = _SEEDS.get(inst.symbol, (100.0,))
            self._sims[spec] = _Sim(inst, seed_px, random.Random(self._rng.random()))

        # Portfolio state.
        self._account = Account(
            id=f"DEMO-{settings.trader_id}",
            currency=settings.base_currency,
            balance=settings.starting_equity,
            equity=settings.starting_equity,
            free=settings.starting_equity,
            used=0.0,
        )
        self._positions: dict[str, Position] = {}  # instrument -> open position
        self._orders: list[Order] = []
        self._realized_pnl = 0.0
        self._equity_curve: deque[EquityPoint] = deque(maxlen=2000)
        self._equity_peak = settings.starting_equity

        # AI trader state.
        self._ai_state = AIState.IDLE
        self._ai_enabled = settings.ai_autostart
        self._ai_last_run: datetime | None = None
        self._started_at: datetime | None = None

        # Background tasks.
        self._tasks: list[asyncio.Task] = []
        self._tick_count = 0

        self._seed_starter_positions()

    # -- seeding ------------------------------------------------------------
    def _seed_starter_positions(self) -> None:
        """Open a couple of positions so the UI isn't empty on first load."""
        opened_at = datetime.now(timezone.utc) - timedelta(minutes=42)
        starters = [
            ("AAPL.NASDAQ", PositionSide.LONG, 120.0),
            ("BTCUSDT.BINANCE", PositionSide.LONG, 0.35),
        ]
        for spec, side, qty in starters:
            sim = self._sims.get(spec)
            if sim is None:
                continue
            last = sim.price
            # Pretend we entered slightly away from the current price.
            avg = last * (0.985 if side is PositionSide.LONG else 1.015)
            pos = Position(
                id=f"pos-{uuid.uuid4().hex[:10]}",
                instrument=spec,
                side=side,
                quantity=qty,
                avg_px=round(avg, 6),
                last_px=round(last, 6),
                market_value=round(last * qty, 2),
                unrealized_pnl=round((last - avg) * qty, 2),
                realized_pnl=0.0,
                opened_at=opened_at,
                strategy=self.settings.strategy_name,
            )
            self._positions[spec] = pos
            self._account.used += abs(pos.market_value)
        self._recompute_account()
        self._equity_curve.append(
            EquityPoint(ts=datetime.now(timezone.utc), equity=self._account.equity)
        )

    # -- lifecycle ----------------------------------------------------------
    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._started_at = datetime.now(timezone.utc)
        self._ai_state = AIState.IDLE if self._ai_enabled else AIState.PAUSED
        self._tasks = [
            asyncio.create_task(self._market_loop(), name="demo-market"),
            asyncio.create_task(self._portfolio_loop(), name="demo-portfolio"),
            asyncio.create_task(self._ai_loop(), name="demo-ai"),
        ]
        log.info("DemoEngine started (%d instruments).", len(self._sims))
        await self.events.publish("log", {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": "info",
            "source": "demo-engine",
            "message": f"Demo engine online — simulating {len(self._sims)} instruments.",
        })

    async def stop(self) -> None:
        self._running = False
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        log.info("DemoEngine stopped.")

    # -- background loops ---------------------------------------------------
    async def _market_loop(self) -> None:
        try:
            while self._running:
                self._tick_count += 1
                for sim in self._sims.values():
                    quote, finalised = sim.tick()
                    await self.events.publish("quote", quote.model_dump(mode="json"))
                    if finalised is not None:
                        await self.events.publish("bar", finalised.model_dump(mode="json"))
                self._mark_positions()
                await asyncio.sleep(_TICK_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - keep the loop alive in dev
            log.exception("market loop crashed")

    async def _portfolio_loop(self) -> None:
        try:
            while self._running:
                await asyncio.sleep(_TICK_SECONDS * _PORTFOLIO_EVERY)
                self._recompute_account()
                snap = self.get_portfolio()
                self._equity_curve.append(EquityPoint(ts=snap.ts, equity=snap.equity))
                await self.events.publish("portfolio", snap.model_dump(mode="json"))
                await self.events.publish("account", self._account.model_dump(mode="json"))
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover
            log.exception("portfolio loop crashed")

    async def _ai_loop(self) -> None:
        # Small initial delay so the market loop has produced a tick or two.
        await asyncio.sleep(3.0)
        try:
            while self._running:
                if self._ai_enabled and self.settings.ai_brain_enabled:
                    await self._run_ai_cycle()
                await asyncio.sleep(self.settings.ai_tick_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover
            log.exception("ai loop crashed")

    # -- AI cycle -----------------------------------------------------------
    async def _run_ai_cycle(self) -> None:
        await self._set_ai_state(AIState.ANALYZING)
        self._ai_last_run = datetime.now(timezone.utc)

        market_state = MarketState(
            bars={spec: sim.all_bars() for spec, sim in self._sims.items()},
            last_px={spec: sim.price for spec, sim in self._sims.items()},
            positions=list(self._positions.values()),
        )
        decision = self._brain.evaluate(market_state)
        if decision is None:
            await self._set_ai_state(AIState.IDLE)
            return

        if decision.action is AIAction.HOLD:
            decision.status = "skipped"
            self._decisions.append(decision)
            await self.events.publish("ai_decision", decision.model_dump(mode="json"))
            await self._set_ai_state(AIState.IDLE)
            return

        await self._set_ai_state(AIState.EXECUTING)
        self._decisions.append(decision)
        try:
            self._execute_decision(decision)
            decision.status = "executed"
        except Exception:  # pragma: no cover - defensive
            log.exception("decision execution failed")
            decision.status = "rejected"
        await self.events.publish("ai_decision", decision.model_dump(mode="json"))
        await self._set_ai_state(AIState.IDLE)

    def _execute_decision(self, decision: AIDecision) -> None:
        """Mutate the book per the decision and emit order/position events."""
        spec = decision.instrument
        if spec is None or spec not in self._sims:
            decision.status = "skipped"
            return
        sim = self._sims[spec]
        last = sim.price
        existing = self._positions.get(spec)

        if decision.action is AIAction.CLOSE:
            if existing is None:
                decision.status = "skipped"
                return
            self._close_position(spec, last, decision)
            return

        # BUY / SELL -> open or add.
        side = OrderSide.BUY if decision.action is AIAction.BUY else OrderSide.SELL
        notional = self._account.equity * _TRADE_SIZE_FRACTION
        qty = max(notional / last, 0.0)
        inst = sim.instrument
        if inst.size_precision == 0:
            qty = float(max(1, round(qty)))
        else:
            qty = round(qty, inst.size_precision)
        if qty <= 0:
            decision.status = "skipped"
            return

        order = self._fill_order(spec, side, qty, last, decision)
        self._apply_fill(spec, side, qty, last, order)

    def _fill_order(
        self,
        spec: str,
        side: OrderSide,
        qty: float,
        px: float,
        decision: AIDecision,
    ) -> Order:
        order = Order(
            id=f"ord-{uuid.uuid4().hex[:10]}",
            instrument=spec,
            side=side,
            type=OrderType.MARKET,
            status=OrderStatus.FILLED,
            quantity=qty,
            filled_qty=qty,
            price=round(px, 6),
            avg_px=round(px, 6),
            ts=datetime.now(timezone.utc),
            strategy=self.settings.strategy_name,
        )
        self._orders.append(order)
        decision.order_id = order.id
        self.events.publish_nowait("order", order.model_dump(mode="json"))
        return order

    def _apply_fill(
        self, spec: str, side: OrderSide, qty: float, px: float, order: Order
    ) -> None:
        existing = self._positions.get(spec)
        signed = qty if side is OrderSide.BUY else -qty

        if existing is None or existing.side is PositionSide.FLAT:
            pos = Position(
                id=f"pos-{uuid.uuid4().hex[:10]}",
                instrument=spec,
                side=PositionSide.LONG if signed > 0 else PositionSide.SHORT,
                quantity=abs(signed),
                avg_px=round(px, 6),
                last_px=round(px, 6),
                market_value=round(px * abs(signed), 2),
                unrealized_pnl=0.0,
                realized_pnl=0.0,
                opened_at=datetime.now(timezone.utc),
                strategy=self.settings.strategy_name,
            )
            self._positions[spec] = pos
        else:
            # Same-direction add: blend the average price.
            cur_signed = existing.quantity if existing.side is PositionSide.LONG else -existing.quantity
            new_signed = cur_signed + signed
            if abs(new_signed) < 1e-9:
                self._close_position(spec, px, None)
                return
            existing.avg_px = round(
                (abs(cur_signed) * existing.avg_px + abs(signed) * px) / abs(new_signed), 6
            )
            existing.quantity = abs(new_signed)
            existing.side = PositionSide.LONG if new_signed > 0 else PositionSide.SHORT
            existing.last_px = round(px, 6)

        self._mark_positions()
        self._recompute_account()
        pos = self._positions.get(spec)
        if pos is not None:
            self.events.publish_nowait("position", pos.model_dump(mode="json"))

    def _close_position(self, spec: str, px: float, decision: AIDecision | None) -> None:
        pos = self._positions.get(spec)
        if pos is None:
            return
        direction = 1.0 if pos.side is PositionSide.LONG else -1.0
        pnl = round((px - pos.avg_px) * pos.quantity * direction, 2)
        self._realized_pnl += pnl
        self._account.balance += pnl

        # Record a closing order opposite the position side.
        close_side = OrderSide.SELL if pos.side is PositionSide.LONG else OrderSide.BUY
        order = Order(
            id=f"ord-{uuid.uuid4().hex[:10]}",
            instrument=spec,
            side=close_side,
            type=OrderType.MARKET,
            status=OrderStatus.FILLED,
            quantity=pos.quantity,
            filled_qty=pos.quantity,
            price=round(px, 6),
            avg_px=round(px, 6),
            ts=datetime.now(timezone.utc),
            strategy=self.settings.strategy_name,
        )
        self._orders.append(order)

        # Emit a final FLAT snapshot of the position before dropping it.
        flat = pos.model_copy(
            update={
                "side": PositionSide.FLAT,
                "quantity": 0.0,
                "last_px": round(px, 6),
                "market_value": 0.0,
                "unrealized_pnl": 0.0,
                "realized_pnl": pnl,
            }
        )
        del self._positions[spec]
        self._mark_positions()
        self._recompute_account()

        if decision is not None:
            decision.order_id = order.id
            decision.realized_pnl = pnl
            # Backfill realized_pnl onto the decision that opened this position.
            self._attribute_pnl(spec, pnl, pos.opened_at)

        self.events.publish_nowait("order", order.model_dump(mode="json"))
        self.events.publish_nowait("position", flat.model_dump(mode="json"))

    def _attribute_pnl(self, spec: str, pnl: float, opened_at: datetime) -> None:
        """Set realized_pnl on the most recent open-decision for this instrument."""
        for dec in self._decisions.list(limit=200):
            if (
                dec.instrument == spec
                and dec.action in (AIAction.BUY, AIAction.SELL)
                and dec.realized_pnl is None
                and dec.ts <= datetime.now(timezone.utc)
            ):
                self._decisions.update(dec.id, realized_pnl=pnl)
                self.events.publish_nowait("ai_decision", dec.model_dump(mode="json"))
                break

    # -- bookkeeping --------------------------------------------------------
    def _mark_positions(self) -> None:
        for spec, pos in self._positions.items():
            sim = self._sims.get(spec)
            if sim is None:
                continue
            last = sim.price
            direction = 1.0 if pos.side is PositionSide.LONG else -1.0
            pos.last_px = round(last, 6)
            pos.market_value = round(last * pos.quantity, 2)
            pos.unrealized_pnl = round((last - pos.avg_px) * pos.quantity * direction, 2)

    def _recompute_account(self) -> None:
        unrealized = sum(p.unrealized_pnl for p in self._positions.values())
        used = sum(abs(p.market_value) for p in self._positions.values())
        equity = self._account.balance + unrealized
        self._account.equity = round(equity, 2)
        self._account.used = round(used, 2)
        self._account.free = round(max(equity - used, 0.0), 2)
        self._equity_peak = max(self._equity_peak, equity)

    async def _set_ai_state(self, state: AIState) -> None:
        if state == self._ai_state:
            return
        self._ai_state = state
        await self.events.publish("ai_status", self.get_ai_status().model_dump(mode="json"))

    # -- metrics ------------------------------------------------------------
    def _sharpe(self) -> float:
        pts = list(self._equity_curve)
        if len(pts) < 3:
            return 0.0
        rets: list[float] = []
        for i in range(1, len(pts)):
            prev = pts[i - 1].equity
            if prev:
                rets.append((pts[i].equity - prev) / prev)
        if len(rets) < 2:
            return 0.0
        mean = sum(rets) / len(rets)
        var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
        std = math.sqrt(var)
        if std == 0:
            return 0.0
        # Per-sample Sharpe. Annualising off ~1s samples explodes the number,
        # so report a daily-equivalent scaling and clamp to a presentable range.
        daily_samples = (24 * 3600) / (_TICK_SECONDS * _PORTFOLIO_EVERY)
        sharpe = (mean / std) * math.sqrt(daily_samples)
        return round(max(-10.0, min(10.0, sharpe)), 3)

    def _max_drawdown_pct(self) -> float:
        peak = -math.inf
        max_dd = 0.0
        for pt in self._equity_curve:
            peak = max(peak, pt.equity)
            if peak > 0:
                dd = (peak - pt.equity) / peak
                max_dd = max(max_dd, dd)
        return round(max_dd * 100.0, 3)

    # -- BaseEngine getters -------------------------------------------------
    def get_portfolio(self) -> PortfolioSnapshot:
        self._recompute_account()
        unrealized = round(sum(p.unrealized_pnl for p in self._positions.values()), 2)
        equity = self._account.equity
        start = self.settings.starting_equity
        total_pnl = round(equity - start, 2)
        net_exposure = round(
            sum(
                p.market_value if p.side is PositionSide.LONG else -p.market_value
                for p in self._positions.values()
            ),
            2,
        )
        return PortfolioSnapshot(
            ts=datetime.now(timezone.utc),
            currency=self.settings.base_currency,
            equity=round(equity, 2),
            starting_equity=start,
            total_pnl=total_pnl,
            total_pnl_pct=round((total_pnl / start) * 100.0, 4) if start else 0.0,
            unrealized_pnl=unrealized,
            realized_pnl=round(self._realized_pnl, 2),
            net_exposure=net_exposure,
            positions_count=len(self._positions),
            win_rate=self._decisions.win_rate,
            sharpe=self._sharpe(),
            max_drawdown_pct=self._max_drawdown_pct(),
            equity_curve=list(self._equity_curve),
        )

    def get_positions(self) -> list[Position]:
        self._mark_positions()
        return list(self._positions.values())

    def get_orders(self) -> list[Order]:
        # Newest-first.
        return list(reversed(self._orders))

    def get_accounts(self) -> list[Account]:
        self._recompute_account()
        return [self._account]

    def get_instruments(self) -> list[Instrument]:
        return [sim.instrument for sim in self._sims.values()]

    def get_bars(self, instrument: str, count: int = 300) -> list[Bar]:
        sim = self._sims.get(instrument)
        if sim is None:
            return []
        bars = sim.all_bars()
        return bars[-max(0, count):]

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
            last_run=self._ai_last_run,
            uptime_s=round(uptime, 1),
            decisions_today=self._decisions.decisions_today,
            win_rate=self._decisions.win_rate,
            enabled=self._ai_enabled,
        )

    def get_ai_decisions(self, limit: int = 100) -> list[AIDecision]:
        return self._decisions.list(limit=limit)

    async def ai_control(self, request: AIControlRequest) -> AITraderStatus:
        if request.action == "pause":
            self._ai_enabled = False
            await self._set_ai_state(AIState.PAUSED)
        elif request.action == "resume":
            self._ai_enabled = True
            await self._set_ai_state(AIState.IDLE)
        return self.get_ai_status()

    async def record_decision(self, decision: AIDecision) -> AIDecision:
        self._decisions.append(decision)
        await self.events.publish("ai_decision", decision.model_dump(mode="json"))
        return decision

    # -- agent-driven order ops --------------------------------------------
    async def submit_order(
        self,
        instrument: str,
        side: str,
        quantity: float,
        order_type: str = "MARKET",
        price: float | None = None,
    ) -> Order:
        sim = self._sims.get(instrument)
        if sim is None:
            raise ValueError(f"unknown instrument {instrument!r}")
        last = sim.price if order_type.upper() == "MARKET" or price is None else float(price)
        os = OrderSide.BUY if side.upper() == "BUY" else OrderSide.SELL
        # Reuse the existing fill plumbing with a synthetic decision-less call.
        order = Order(
            id=f"ord-{uuid.uuid4().hex[:10]}",
            instrument=instrument,
            side=os,
            type=OrderType.MARKET if order_type.upper() == "MARKET" else OrderType.LIMIT,
            status=OrderStatus.FILLED,
            quantity=quantity,
            filled_qty=quantity,
            price=round(last, 6),
            avg_px=round(last, 6),
            ts=datetime.now(timezone.utc),
            strategy="agent-cli",
        )
        self._orders.append(order)
        self.events.publish_nowait("order", order.model_dump(mode="json"))
        self._apply_fill(instrument, os, quantity, last, order)
        return order

    async def cancel_order(self, order_id: str) -> bool:
        # Demo orders fill synchronously — nothing to cancel. Treat as no-op.
        for o in self._orders:
            if o.id == order_id and o.status not in (OrderStatus.FILLED, OrderStatus.CANCELED):
                o.status = OrderStatus.CANCELED
                self.events.publish_nowait("order", o.model_dump(mode="json"))
                return True
        return False

    async def close_position(self, instrument: str) -> Order | None:
        pos = self._positions.get(instrument)
        if pos is None or pos.side is PositionSide.FLAT:
            return None
        sim = self._sims.get(instrument)
        if sim is None:
            return None
        before = len(self._orders)
        self._close_position(instrument, sim.price, None)
        # The synthetic order from _close_position is the last appended.
        return self._orders[-1] if len(self._orders) > before else None
