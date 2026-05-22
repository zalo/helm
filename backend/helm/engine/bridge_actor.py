"""`BridgeActor` — the idiomatic Nautilus -> frontend bridge.

Nautilus has no built-in REST/WS API. The recommended pattern is a custom
`Actor` registered on the `TradingNode` that subscribes to the message bus and
forwards events out of the trading domain. `BridgeActor` does exactly that: it
maps Nautilus order/position/account events and bars to Helm `WsEvent`s and
pushes them into the `EventBroadcaster` consumed by `/ws`.

`nautilus_trader` is imported lazily inside methods so this module stays
importable on machines without Nautilus installed (the demo path).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from helm.engine.events import EventBroadcaster

if TYPE_CHECKING:  # pragma: no cover - typing only
    from nautilus_trader.common.actor import Actor as _ActorBase
else:  # resolved lazily in _actor_base()
    _ActorBase = object

log = logging.getLogger("helm.engine.bridge")


def _actor_base() -> type:
    """Return the Nautilus `Actor` base class (imported lazily)."""
    from nautilus_trader.common.actor import Actor

    return Actor


def build_bridge_actor(events: EventBroadcaster, instrument_ids: list[Any] | None = None):
    """Factory: construct a `BridgeActor` bound to ``events``.

    Defined as a factory because the concrete `Actor` base must be imported at
    call time, not at module import time.
    """

    Actor = _actor_base()

    class BridgeActor(Actor):  # type: ignore[misc, valid-type]
        """Subscribes to the message bus and fans events out to WebSocket clients."""

        def __init__(self) -> None:
            super().__init__()
            self._events = events
            self._instrument_ids = instrument_ids or []

        # -- lifecycle ------------------------------------------------------
        def on_start(self) -> None:  # noqa: D401 - Nautilus hook
            """Subscribe to all event streams we forward."""
            try:
                # Domain events via the message bus — order/position/account.
                from nautilus_trader.model.events import (
                    AccountState,
                    OrderEvent,
                    PositionEvent,
                )

                self.msgbus.subscribe("events.order.*", self._on_order_event)
                self.msgbus.subscribe("events.position.*", self._on_position_event)
                self.msgbus.subscribe("events.account.*", self._on_account_event)
            except Exception:  # pragma: no cover - defensive
                log.exception("BridgeActor: failed to subscribe to event bus")

            # Bars for each configured instrument.
            for instrument_id in self._instrument_ids:
                try:
                    instrument = self.cache.instrument(instrument_id)
                    if instrument is None:
                        continue
                    from nautilus_trader.model.data import BarType

                    from helm.config import bar_type_str

                    bar_type = BarType.from_str(bar_type_str(instrument_id))
                    self.subscribe_bars(bar_type)
                except Exception:  # pragma: no cover - defensive
                    log.debug("BridgeActor: could not subscribe bars for %s", instrument_id)

        def on_stop(self) -> None:  # noqa: D401 - Nautilus hook
            pass

        # -- nautilus hooks -------------------------------------------------
        def on_bar(self, bar: Any) -> None:
            from helm.engine.nautilus_engine import map_bar

            try:
                payload = map_bar(bar)
                if payload is not None:
                    self._publish("bar", payload)
            except Exception:  # pragma: no cover - defensive
                log.debug("BridgeActor.on_bar mapping failed", exc_info=True)

        # -- msgbus handlers ------------------------------------------------
        def _on_order_event(self, event: Any) -> None:
            try:
                client_order_id = getattr(event, "client_order_id", None)
                order = self.cache.order(client_order_id) if client_order_id else None
                if order is None:
                    return
                from helm.engine.nautilus_engine import map_order

                payload = map_order(order)
                if payload is None:
                    return
                # Drop reconciliation phantoms — at engine start (and after a
                # restart) Nautilus replays every historical IB fill through
                # msgbus to seed the cache. Those events are tagged
                # strategy="EXTERNAL"; real strategy submissions carry the
                # actual strategy id (e.g. "ai-trader"). Without this filter
                # every /ws reconnect would fire a stale `order` event and
                # wake any sleep parked on `--on-event order`.
                strategy = (payload.get("strategy") or "").upper()
                if strategy == "EXTERNAL":
                    return
                self._publish("order", payload)
            except Exception:  # pragma: no cover - defensive
                log.debug("BridgeActor order event mapping failed", exc_info=True)

        def _on_position_event(self, event: Any) -> None:
            try:
                position_id = getattr(event, "position_id", None)
                position = self.cache.position(position_id) if position_id else None
                from helm.engine.nautilus_engine import map_position

                payload = map_position(position) if position is not None else None
                if payload is None:
                    # Position event without a cached position — synthesise from event.
                    payload = map_position(event)
                if payload is not None:
                    self._publish("position", payload)
            except Exception:  # pragma: no cover - defensive
                log.debug("BridgeActor position event mapping failed", exc_info=True)

        def _on_account_event(self, event: Any) -> None:
            try:
                from helm.engine.nautilus_engine import map_account

                payload = map_account(event)
                if payload is not None:
                    self._publish("account", payload)
            except Exception:  # pragma: no cover - defensive
                log.debug("BridgeActor account event mapping failed", exc_info=True)

        # -- helpers --------------------------------------------------------
        def _publish(self, type_: str, payload: dict[str, Any]) -> None:
            """Fire the event into the broadcaster from the Nautilus thread."""
            self._events.publish_nowait(type_, payload)  # type: ignore[arg-type]

    return BridgeActor()
