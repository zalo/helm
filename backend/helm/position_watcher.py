"""Position-level price watchers.

Background task that subscribes to the engine's WS event stream, tracks the
latest price per instrument from `bar`/`quote` events, and compares it against
a per-instrument threshold config:

  * ``notify_low`` / ``notify_high`` — price levels that should pull human
    attention. Fires a ``position_alert`` WS event (which `NotifyPublisher`
    turns into a push notification, and any parked ``helm-agent sleep
    --on-event position_alert`` wakes on).
  * ``emergency_low`` / ``emergency_high`` — "this is bad, exit now" levels.
    Fires the same alert AND submits a market order to flatten the
    position. We don't wait for human review — that's the whole point.

State is tracked per (instrument, threshold) so a level only fires once each
time the price crosses through it. Crossing back and re-crossing re-arms.
This avoids the "stuck below a stop" flood while still catching genuine
re-tests of a level.

Config is persisted at ``$HELM_WATCHER_FILE`` (default ``backend/.watcher.json``,
gitignored). Mutated via the REST endpoints in ``routes_agent`` and the
``helm-agent watcher`` CLI. The watcher hot-reloads the file before each
evaluation so config changes take effect on the next price tick without a
restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from helm.config import Settings
from helm.engine.base import BaseEngine
from helm.engine.events import EventBroadcaster
from helm.models import WsEvent

log = logging.getLogger("helm.watcher")

# Lower-bound thresholds fire when price crosses down through them; upper
# bounds fire when price crosses up. This keeps the semantics symmetric.
_LOWER_KEYS = ("notify_low", "emergency_low")
_UPPER_KEYS = ("notify_high", "emergency_high")


@dataclass
class Threshold:
    """Threshold config for one instrument. All bounds optional."""
    instrument: str
    notify_low: float | None = None
    notify_high: float | None = None
    emergency_low: float | None = None
    emergency_high: float | None = None
    note: str = ""  # human reminder of why these levels were chosen


@dataclass
class _State:
    """Tracks whether each threshold is currently 'armed' (will fire on next
    cross) and the most-recent price we've seen for the instrument."""
    last_price: float | None = None
    armed: dict[str, bool] = field(
        default_factory=lambda: {k: True for k in (*_LOWER_KEYS, *_UPPER_KEYS)}
    )


def _watcher_path(settings: Settings) -> Path:
    override = os.environ.get("HELM_WATCHER_FILE")
    if override:
        return Path(override)
    # Sits next to the .env that pydantic-settings loaded — i.e. the backend
    # cwd. SettingsConfigDict stores env_file as a relative string.
    env_file = settings.model_config.get("env_file", ".env")
    return (Path.cwd() / str(env_file)).resolve().parent / ".watcher.json"


def load_config(settings: Settings) -> dict[str, Threshold]:
    path = _watcher_path(settings)
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("failed to read %s: %s", path, exc)
        return {}
    out: dict[str, Threshold] = {}
    for instr, body in raw.items():
        if not isinstance(body, dict):
            continue
        out[instr] = Threshold(
            instrument=instr,
            notify_low=body.get("notify_low"),
            notify_high=body.get("notify_high"),
            emergency_low=body.get("emergency_low"),
            emergency_high=body.get("emergency_high"),
            note=body.get("note", ""),
        )
    return out


def save_config(settings: Settings, cfg: dict[str, Threshold]) -> None:
    path = _watcher_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        instr: {
            "notify_low": t.notify_low,
            "notify_high": t.notify_high,
            "emergency_low": t.emergency_low,
            "emergency_high": t.emergency_high,
            "note": t.note,
        }
        for instr, t in cfg.items()
    }
    path.write_text(json.dumps(body, indent=2, sort_keys=True))


def _extract_price(event: WsEvent) -> tuple[str | None, float | None]:
    """Pull (instrument_id, price) from a price-bearing WS event."""
    p = event.payload or {}
    instr = p.get("instrument")
    if not instr:
        return None, None
    if event.type == "bar":
        close = p.get("close")
        return instr, float(close) if close is not None else None
    if event.type == "quote":
        last = p.get("last")
        if last is not None:
            return instr, float(last)
        bid = p.get("bid")
        ask = p.get("ask")
        if bid is not None and ask is not None:
            return instr, (float(bid) + float(ask)) / 2.0
        return instr, None
    return None, None


def _crossed_down(prev: float | None, curr: float, level: float) -> bool:
    """True if price moved from above-or-at the level to strictly below."""
    if prev is None:
        return curr < level
    return prev >= level and curr < level


def _crossed_up(prev: float | None, curr: float, level: float) -> bool:
    if prev is None:
        return curr > level
    return prev <= level and curr > level


class PositionWatcher:
    """Long-running task that turns price moves into ``position_alert`` events
    (and, on emergency-level breaches, autonomous market exits)."""

    def __init__(
        self,
        settings: Settings,
        broadcaster: EventBroadcaster,
        engine: BaseEngine,
    ) -> None:
        self._settings = settings
        self._broadcaster = broadcaster
        self._engine = engine
        self._task: asyncio.Task[None] | None = None
        self._state: dict[str, _State] = {}

    async def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="helm-watcher")
        log.info("position watcher started (config=%s)", _watcher_path(self._settings))

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):
            pass
        self._task = None

    async def _run(self) -> None:
        async with self._broadcaster.subscribe() as queue:
            while True:
                event: WsEvent = await queue.get()
                if event.type not in ("bar", "quote"):
                    continue
                instr, price = _extract_price(event)
                if instr is None or price is None:
                    continue
                try:
                    await self._evaluate(instr, price)
                except Exception:  # never let the watcher crash the loop
                    log.exception("watcher eval crashed for %s", instr)

    async def _evaluate(self, instrument: str, price: float) -> None:
        cfg = load_config(self._settings)
        threshold = cfg.get(instrument)
        if threshold is None:
            # No threshold for this instrument — still record the price so
            # newly-added thresholds get a sensible `prev` on their first cross.
            self._state.setdefault(instrument, _State()).last_price = price
            return

        state = self._state.setdefault(instrument, _State())
        prev = state.last_price
        state.last_price = price

        # Emergency thresholds first — they short-circuit the notify legs.
        for key, getter in (
            ("emergency_low", lambda t: t.emergency_low),
            ("emergency_high", lambda t: t.emergency_high),
        ):
            level = getter(threshold)
            if level is None or not state.armed.get(key, True):
                continue
            crossed = _crossed_down(prev, price, level) if "low" in key else _crossed_up(prev, price, level)
            if not crossed:
                continue
            state.armed[key] = False
            await self._fire_emergency(instrument, price, level, key, threshold.note)
            return  # don't also fire the notify legs on the same tick

        # Notify-only thresholds.
        for key, getter in (
            ("notify_low", lambda t: t.notify_low),
            ("notify_high", lambda t: t.notify_high),
        ):
            level = getter(threshold)
            if level is None or not state.armed.get(key, True):
                continue
            crossed = _crossed_down(prev, price, level) if "low" in key else _crossed_up(prev, price, level)
            if not crossed:
                continue
            state.armed[key] = False
            await self._fire_notify(instrument, price, level, key, threshold.note)

        # Re-arm any threshold the price has cleanly moved back across by more
        # than 1% — that way a re-test fires a fresh alert, but ordinary
        # jitter around the level doesn't spam.
        for key in (*_LOWER_KEYS, *_UPPER_KEYS):
            level = getattr(threshold, key)
            if level is None or state.armed.get(key, True):
                continue
            margin = level * 0.01
            re_arm = (
                (key.endswith("_low") and price > level + margin)
                or (key.endswith("_high") and price < level - margin)
            )
            if re_arm:
                state.armed[key] = True
                log.info("re-armed %s threshold for %s at %.4f", key, instrument, price)

    async def _fire_notify(
        self, instrument: str, price: float, level: float, kind: str, note: str,
    ) -> None:
        log.info("notify-cross %s %s price=%.4f level=%.4f", instrument, kind, price, level)
        await self._broadcaster.publish(
            "position_alert",
            {
                "instrument": instrument,
                "kind": kind,
                "severity": "notify",
                "price": price,
                "level": level,
                "note": note,
                "action": "review",
                "message": (
                    f"{instrument} crossed {kind} level "
                    f"({price:.2f} vs {level:.2f}) — review position"
                ),
            },
        )

    async def _fire_emergency(
        self, instrument: str, price: float, level: float, kind: str, note: str,
    ) -> None:
        log.warning("EMERGENCY %s %s price=%.4f level=%.4f", instrument, kind, price, level)
        # Best-effort flatten. We *do not* re-raise — emit the alert no matter
        # what so the human gets paged even if the broker rejects.
        order_id: str | None = None
        order_error: str | None = None
        try:
            order = await self._engine.close_position(instrument)
            if order is not None:
                order_id = order.id
        except Exception as exc:
            order_error = str(exc)
            log.exception("emergency close failed for %s", instrument)

        await self._broadcaster.publish(
            "position_alert",
            {
                "instrument": instrument,
                "kind": kind,
                "severity": "emergency",
                "price": price,
                "level": level,
                "note": note,
                "action": "auto_flatten",
                "order_id": order_id,
                "order_error": order_error,
                "message": (
                    f"EMERGENCY {instrument}: {kind} {level:.2f} breached "
                    f"at {price:.2f} — auto-flattening position"
                ),
            },
        )
