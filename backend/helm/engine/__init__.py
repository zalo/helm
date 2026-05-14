"""Trading engine package.

`BaseEngine` is the contract every engine implementation satisfies. `DemoEngine`
is a self-contained simulator; `NautilusEngine` embeds a real Nautilus
`TradingNode`. `get_engine()` returns the process-wide singleton chosen from
`Settings.mode`.
"""

from helm.engine.base import BaseEngine
from helm.engine.events import EventBroadcaster
from helm.engine.manager import build_engine, get_engine

__all__ = ["BaseEngine", "EventBroadcaster", "build_engine", "get_engine"]
