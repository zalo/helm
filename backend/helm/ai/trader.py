"""`AITraderStrategy` — the Nautilus `Strategy` that runs the AI trader live.

On a recurring timer it builds a `MarketState` from the node cache, asks the
`AIBrain` for a decision, submits real orders through Nautilus, records the
decision in the shared `DecisionStore`, and publishes an ``ai_decision`` event.

The `DemoEngine` uses `AIBrain` + `DecisionStore` directly and never touches
this class. `nautilus_trader` is imported lazily so the module imports fine on
machines without Nautilus.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from helm.ai.brain import AIBrain, MarketState
from helm.ai.decisions import DecisionStore
from helm.engine.events import EventBroadcaster
from helm.models import AIAction

log = logging.getLogger("helm.ai.trader")


def _strategy_base() -> type:
    """Return the Nautilus `Strategy` base class (imported lazily)."""
    from nautilus_trader.trading.strategy import Strategy

    return Strategy


def build_ai_trader_strategy(
    *,
    events: EventBroadcaster,
    decisions: DecisionStore,
    instrument_ids: list[Any],
    tick_seconds: float,
    trade_size_fraction: float = 0.08,
    brain_enabled: bool = True,
):
    """Factory for an `AITraderStrategy` instance.

    A factory is used because the Nautilus `Strategy` base must be imported at
    call time (only when the real engine is actually constructed).
    """

    Strategy = _strategy_base()

    class AITraderStrategy(Strategy):  # type: ignore[misc, valid-type]
        """Timer-driven AI trader. Calls `AIBrain.evaluate()` and trades on it."""

        def __init__(self) -> None:
            super().__init__()
            self._events = events
            self._decisions = decisions
            self._instrument_ids = instrument_ids
            self._tick_seconds = tick_seconds
            self._trade_size_fraction = trade_size_fraction
            self._brain_enabled = brain_enabled
            self._brain = AIBrain(seed=42)
            self._timer_name = "ai-trader-tick"

        # -- lifecycle ------------------------------------------------------
        def on_start(self) -> None:  # noqa: D401 - Nautilus hook
            from datetime import datetime, timedelta, timezone

            from helm.config import bar_type_str

            # Seed ~300 bars of history so MarketState has a series to evaluate.
            # IB will trim to RTH-available data automatically.
            start = datetime.now(timezone.utc) - timedelta(hours=6)
            for instrument_id in self._instrument_ids:
                try:
                    from nautilus_trader.model.data import BarType

                    bar_type = BarType.from_str(bar_type_str(instrument_id))
                    try:
                        self.request_bars(bar_type, start=start)
                    except Exception:
                        log.debug(
                            "AITrader: request_bars failed for %s", instrument_id,
                            exc_info=True,
                        )
                    self.subscribe_bars(bar_type)
                except Exception:  # pragma: no cover - defensive
                    log.debug("AITrader: could not subscribe bars for %s", instrument_id)
            if self._brain_enabled:
                try:
                    from datetime import timedelta

                    self.clock.set_timer(
                        name=self._timer_name,
                        interval=timedelta(seconds=self._tick_seconds),
                        callback=self._on_timer,
                    )
                except Exception:  # pragma: no cover - defensive
                    log.exception("AITrader: failed to register timer")
            else:
                log.info(
                    "AITrader: brain timer disabled (HELM_AI_BRAIN_ENABLED=false); "
                    "strategy is loaded only as the helm-agent CLI's order conduit."
                )

        def on_stop(self) -> None:  # noqa: D401 - Nautilus hook
            try:
                self.clock.cancel_timer(self._timer_name)
            except Exception:  # pragma: no cover
                pass

        # -- timer ----------------------------------------------------------
        def _on_timer(self, event: Any) -> None:
            try:
                self._evaluate_and_trade()
            except Exception:  # pragma: no cover - never kill the node
                log.exception("AITrader: evaluation cycle failed")

        def _evaluate_and_trade(self) -> None:
            from helm.engine.nautilus_engine import (
                map_bar,
                map_position,
            )
            from helm.models import Bar as HelmBar
            from helm.models import Position as HelmPosition

            bars: dict[str, list[HelmBar]] = {}
            last_px: dict[str, float] = {}
            for instrument_id in self._instrument_ids:
                key = str(instrument_id)
                try:
                    from nautilus_trader.model.data import BarType

                    from helm.config import bar_type_str

                    bar_type = BarType.from_str(bar_type_str(instrument_id))
                    cached = self.cache.bars(bar_type)
                except Exception:
                    cached = []
                helm_bars: list[HelmBar] = []
                for raw in reversed(list(cached)):  # cache.bars() is newest-first
                    mapped = map_bar(raw)
                    if mapped is not None:
                        helm_bars.append(HelmBar(**mapped))
                if helm_bars:
                    bars[key] = helm_bars
                    last_px[key] = helm_bars[-1].close

            positions: list[HelmPosition] = []
            try:
                for raw_pos in self.cache.positions_open():
                    mapped = map_position(raw_pos)
                    if mapped is not None:
                        positions.append(HelmPosition(**mapped))
            except Exception:  # pragma: no cover - defensive
                log.debug("AITrader: failed to read open positions", exc_info=True)

            decision = self._brain.evaluate(
                MarketState(bars=bars, last_px=last_px, positions=positions)
            )
            if decision is None:
                return

            if decision.action is AIAction.HOLD:
                decision.status = "skipped"
            else:
                order_id = self._submit_for(decision)
                decision.order_id = order_id
                decision.status = "executed" if order_id else "skipped"

            self._decisions.append(decision)
            self._events.publish_nowait(
                "ai_decision", decision.model_dump(mode="json")
            )

        # -- order submission ----------------------------------------------
        def _submit_for(self, decision: Any) -> str | None:
            """Translate a decision into a Nautilus market order. Returns the
            client order id, or ``None`` if nothing was submitted."""
            spec = decision.instrument
            if spec is None:
                return None
            try:
                from nautilus_trader.model.enums import OrderSide
                from nautilus_trader.model.identifiers import InstrumentId

                instrument_id = InstrumentId.from_str(spec)
                instrument = self.cache.instrument(instrument_id)
                if instrument is None:
                    return None

                if decision.action is AIAction.CLOSE:
                    position = None
                    for pos in self.cache.positions_open(instrument_id=instrument_id):
                        position = pos
                        break
                    if position is None:
                        return None
                    self.close_position(position)
                    return str(position.id)

                side = (
                    OrderSide.BUY
                    if decision.action is AIAction.BUY
                    else OrderSide.SELL
                )
                account = None
                accounts = self.cache.accounts()
                if accounts:
                    account = accounts[0]
                # Size from a fraction of account balance / last price.
                last = self.cache.price(instrument_id, price_type=None)  # best-effort
                px = float(last) if last is not None else None
                if px is None:
                    quote = self.cache.quote_tick(instrument_id)
                    px = float(quote.ask_price) if quote is not None else None
                if px is None or px <= 0:
                    return None

                balance = 100_000.0
                try:
                    if account is not None:
                        balance = float(account.balance_total().as_double())
                except Exception:
                    pass
                raw_qty = (balance * self._trade_size_fraction) / px
                quantity = instrument.make_qty(raw_qty)

                order = self.order_factory.market(
                    instrument_id=instrument_id,
                    order_side=side,
                    quantity=quantity,
                )
                self.submit_order(order)
                return str(order.client_order_id)
            except Exception:  # pragma: no cover - defensive
                log.exception("AITrader: order submission failed")
                return None

    return AITraderStrategy()
