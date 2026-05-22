"""`/ws` — the multiplexed WebSocket event stream.

On connect the client gets an immediate snapshot burst (current portfolio, AI
status, open positions and recent orders) so the UI can render without waiting
for the next live tick, then every `WsEvent` published to the `EventBroadcaster`
is streamed through until the client disconnects.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from helm.engine.manager import get_broadcaster, get_engine
from helm.models import WsEvent

log = logging.getLogger("helm.api.ws")

router = APIRouter()


def _event(type_: str, payload: dict, *, snapshot: bool = False) -> dict:
    evt = WsEvent(
        type=type_,  # type: ignore[arg-type]
        ts=datetime.now(timezone.utc),
        payload=payload,
    ).model_dump(mode="json")
    # Mark snapshot-burst events so programmatic subscribers (helm-agent
    # sleep, anything driving the CLI off of /ws) can ignore them. The web
    # UI doesn't care — it accepts the same event whether snapshot or live.
    if snapshot:
        evt["snapshot"] = True
    return evt


async def _send_snapshot(ws: WebSocket) -> None:
    """Push the current engine state so a fresh client is immediately populated."""
    engine = get_engine()
    try:
        await ws.send_json(_event("portfolio", engine.get_portfolio().model_dump(mode="json"), snapshot=True))
        await ws.send_json(_event("ai_status", engine.get_ai_status().model_dump(mode="json"), snapshot=True))
        for account in engine.get_accounts():
            await ws.send_json(_event("account", account.model_dump(mode="json"), snapshot=True))
        for position in engine.get_positions():
            await ws.send_json(_event("position", position.model_dump(mode="json"), snapshot=True))
        for order in engine.get_orders()[:25]:
            await ws.send_json(_event("order", order.model_dump(mode="json"), snapshot=True))
        for decision in engine.get_ai_decisions(limit=15):
            await ws.send_json(_event("ai_decision", decision.model_dump(mode="json"), snapshot=True))
    except Exception:  # pragma: no cover - snapshot is best-effort
        log.debug("ws snapshot burst failed", exc_info=True)


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    log.info("WebSocket client connected (total=%d)", get_broadcaster().subscriber_count + 1)
    try:
        await _send_snapshot(ws)
        async for event in get_broadcaster().stream():
            await ws.send_json(event.model_dump(mode="json"))
    except WebSocketDisconnect:
        log.info("WebSocket client disconnected")
    except Exception:  # pragma: no cover - keep other clients alive
        log.exception("WebSocket stream error")
    finally:
        log.info("WebSocket client closed")
