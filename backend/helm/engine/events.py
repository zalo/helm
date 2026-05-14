"""WebSocket event fan-out.

The engine publishes `WsEvent`s here; every connected WebSocket client gets its
own bounded queue. Slow clients drop the oldest events rather than blocking the
engine — a trading UI prefers fresh state over a complete-but-stale backlog.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from helm.models import WsEvent, WsEventType


class EventBroadcaster:
    def __init__(self, max_queue: int = 512) -> None:
        self._subscribers: set[asyncio.Queue[WsEvent]] = set()
        self._max_queue = max_queue
        self._lock = asyncio.Lock()

    async def publish(self, type_: WsEventType, payload: dict[str, Any]) -> None:
        event = WsEvent(type=type_, ts=datetime.now(timezone.utc), payload=payload)
        # snapshot under lock, deliver outside it
        async with self._lock:
            subscribers = list(self._subscribers)
        for queue in subscribers:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()  # drop oldest
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(event)

    def publish_nowait(self, type_: WsEventType, payload: dict[str, Any]) -> None:
        """Fire-and-forget publish for non-async call sites (e.g. Nautilus actor)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.publish(type_, payload))

    @contextlib.asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[WsEvent]]:
        queue: asyncio.Queue[WsEvent] = asyncio.Queue(maxsize=self._max_queue)
        async with self._lock:
            self._subscribers.add(queue)
        try:
            yield queue
        finally:
            async with self._lock:
                self._subscribers.discard(queue)

    async def stream(self) -> AsyncIterator[WsEvent]:
        async with self.subscribe() as queue:
            while True:
                yield await queue.get()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
