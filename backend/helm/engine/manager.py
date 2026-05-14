"""Process-wide engine singleton + factory.

`build_engine()` picks an implementation from `Settings.mode` and falls back to
the demo simulator if `nautilus_trader` is not installed. `get_engine()` returns
the live instance for routes/WebSocket to read.
"""

from __future__ import annotations

import logging

from helm.config import Settings, get_settings
from helm.engine.base import BaseEngine
from helm.engine.events import EventBroadcaster
from helm.models import EngineMode

log = logging.getLogger("helm.engine")

_engine: BaseEngine | None = None
_broadcaster: EventBroadcaster | None = None


def nautilus_available() -> bool:
    try:
        import nautilus_trader  # noqa: F401

        return True
    except Exception:  # pragma: no cover - import guard
        return False


def get_broadcaster() -> EventBroadcaster:
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = EventBroadcaster()
    return _broadcaster


def build_engine(settings: Settings | None = None) -> BaseEngine:
    """Construct (and cache) the engine for this process."""
    global _engine
    if _engine is not None:
        return _engine

    settings = settings or get_settings()
    events = get_broadcaster()

    use_nautilus = settings.mode != EngineMode.DEMO and nautilus_available()
    if settings.mode != EngineMode.DEMO and not nautilus_available():
        log.warning(
            "mode=%s requested but nautilus_trader is not installed; "
            "falling back to demo simulator.",
            settings.mode,
        )

    if use_nautilus:
        from helm.engine.nautilus_engine import NautilusEngine

        _engine = NautilusEngine(settings, events)
    else:
        from helm.engine.demo_engine import DemoEngine

        _engine = DemoEngine(settings, events)

    log.info("Engine built: %s (mode=%s)", type(_engine).__name__, settings.mode)
    return _engine


def get_engine() -> BaseEngine:
    if _engine is None:
        return build_engine()
    return _engine


def reset_engine() -> None:
    """Test helper — drop the cached singleton."""
    global _engine, _broadcaster
    _engine = None
    _broadcaster = None
