"""Push-notification forwarder.

Subscribes to ``EventBroadcaster`` and POSTs interesting `WsEvent`s as
``{title, body, url, tag}`` payloads to the local terminal-PWA notify
endpoint (default ``http://127.0.0.1:3000/api/notify``). That endpoint, in
turn, fans the message out to every phone that has the PWA installed +
notifications enabled. Helm doesn't manage subscriptions, web-push keys,
or APNs — the terminal PWA already handles all of that.

Two surfaces:
  * ``NotifyPublisher`` — long-running task wired into the FastAPI lifespan
    that filters/formats events and forwards each one.
  * ``send_notification`` — direct call (used by ``helm-agent notify`` and
    the ``POST /api/agent/notify`` REST helper).

Failures are swallowed and logged; the trading engine never blocks on the
notification leg.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from helm.config import Settings
from helm.engine.events import EventBroadcaster
from helm.models import WsEvent

log = logging.getLogger("helm.notify")

# Order statuses worth a notification — INITIALIZED / ACCEPTED transitions
# are too chatty (one per order regardless of intent).
_NOTIFIABLE_ORDER_STATUSES = {"FILLED", "PARTIALLY_FILLED", "REJECTED",
                              "CANCELED", "EXPIRED"}


def _format_event(event: WsEvent) -> dict[str, Any] | None:
    """Translate a `WsEvent` into a notify payload — or None to suppress.

    Keeps title/body short for lock-screen legibility and stable per logical
    event so the OS collapses repeats instead of stacking.
    """
    p = event.payload or {}

    if event.type == "order":
        status = (p.get("status") or "").upper()
        if status not in _NOTIFIABLE_ORDER_STATUSES:
            return None
        side = p.get("side") or ""
        qty = p.get("quantity") or 0
        instr = (p.get("instrument") or "").split(".")[0]
        filled = p.get("filled_qty") or 0
        avg = p.get("avg_px")
        body_bits = [f"{int(filled)}/{int(qty)} {side} {instr}"]
        if avg:
            body_bits.append(f"@ ${avg}")
        return {
            "title": f"Order {status}: {side} {int(qty)} {instr}",
            "body": " ".join(body_bits),
            "url": "/",
            "tag": f"order-{p.get('id')}",
        }

    if event.type == "agent_message":
        body = p.get("message") or ""
        return {
            "title": "Agent reply",
            "body": (body[:160] + "…") if len(body) > 160 else body,
            "url": "/",
            # One agent-chat slot — newer replaces older on the lock screen.
            "tag": "agent-chat",
        }

    if event.type == "tv_alert":
        symbol = p.get("symbol") or p.get("ticker") or "?"
        indicator = p.get("indicator") or "TradingView"
        side = p.get("side") or p.get("action") or ""
        value = p.get("value") or p.get("close")
        body_bits = [symbol]
        if side:
            body_bits.append(str(side).upper())
        if value is not None:
            body_bits.append(f"@ {value}")
        msg = p.get("message") or p.get("text") or ""
        body = " ".join(body_bits)
        if msg and msg not in body:
            body += f" — {msg[:120]}"
        return {
            "title": f"TV: {indicator}",
            "body": body,
            "url": "/",
            "tag": f"tv-{indicator}",
        }

    if event.type == "wake":
        message = p.get("message") or ""
        source = p.get("source") or "agent"
        return {
            "title": f"Wake from {source}",
            "body": (message[:160] + "…") if len(message) > 160 else message,
            "url": "/",
            "tag": "wake",
        }

    return None


async def send_notification(
    url: str, payload: dict[str, Any], *, client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Direct POST to the notify endpoint. Used by the CLI helper + publisher."""
    owns_client = client is None
    c = client or httpx.AsyncClient(timeout=5.0)
    try:
        r = await c.post(url, json=payload)
        if r.status_code >= 400:
            log.warning("notify endpoint %s -> %s: %s", url, r.status_code, r.text[:200])
            return {"error": f"HTTP {r.status_code}", "detail": r.text[:200]}
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
    except httpx.HTTPError as e:
        log.debug("notify POST failed", exc_info=True)
        return {"error": "network", "detail": str(e)}
    finally:
        if owns_client:
            await c.aclose()


class NotifyPublisher:
    """Long-running task that bridges helm WS events to the notify endpoint."""

    def __init__(self, settings: Settings, broadcaster: EventBroadcaster) -> None:
        self._settings = settings
        self._broadcaster = broadcaster
        self._task: asyncio.Task[None] | None = None
        self._client: httpx.AsyncClient | None = None
        self._wanted: set[str] = set(settings.notify_events)

    async def start(self) -> None:
        if not self._settings.notify_enabled:
            log.info("notify publisher disabled via HELM_NOTIFY_ENABLED=false")
            return
        if self._task is not None:
            return
        self._client = httpx.AsyncClient(timeout=5.0)
        self._task = asyncio.create_task(self._run(), name="helm-notify")
        log.info("notify publisher started (events=%s url=%s)",
                 sorted(self._wanted), self._settings.notify_url)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _run(self) -> None:
        async with self._broadcaster.subscribe() as queue:
            while True:
                event: WsEvent = await queue.get()
                if event.type not in self._wanted:
                    continue
                try:
                    payload = _format_event(event)
                except Exception:
                    log.debug("notify formatter raised", exc_info=True)
                    continue
                if payload is None:
                    continue
                # Don't await — fire and forget; one slow phone shouldn't
                # block the next event from being processed.
                asyncio.create_task(
                    send_notification(
                        self._settings.notify_url, payload, client=self._client,
                    ),
                    name=f"notify-{event.type}",
                )
