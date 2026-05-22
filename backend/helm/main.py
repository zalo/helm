"""Helm FastAPI application.

Wires the engine lifecycle to the app lifespan and mounts every router. The
engine (demo simulator or embedded Nautilus `TradingNode`) starts when the app
starts and streams events to WebSocket clients via the `EventBroadcaster`.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from helm import __version__
from helm.config import get_settings
from helm.engine.manager import build_engine, nautilus_available
from helm.models import HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
log = logging.getLogger("helm")


def openbb_available() -> bool:
    try:
        import openbb  # noqa: F401

        return True
    except Exception:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    from helm.engine.manager import get_broadcaster
    from helm.notifications import NotifyPublisher

    settings = get_settings()
    engine = build_engine(settings)
    notifier = NotifyPublisher(settings, get_broadcaster())
    log.info("Starting Helm engine (mode=%s)…", settings.mode)
    await engine.start()
    await notifier.start()
    try:
        yield
    finally:
        log.info("Stopping Helm engine…")
        await notifier.stop()
        await engine.stop()


app = FastAPI(
    title="Helm",
    version=__version__,
    summary="Open-source web backend for AI-driven algorithmic trading.",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    from helm.engine.manager import get_engine

    return HealthResponse(
        version=__version__,
        mode=settings.mode,
        nautilus_available=nautilus_available(),
        openbb_available=openbb_available(),
        engine_running=get_engine().running,
    )


# Routers are mounted lazily so a failure in one feature area does not take down
# the whole app during early development.
def _mount_routers() -> None:
    from helm.api import routes_agent, routes_ai, routes_feeds, routes_trading, websocket

    app.include_router(routes_trading.router, prefix="/api/trading", tags=["trading"])
    app.include_router(routes_ai.router, prefix="/api/ai", tags=["ai"])
    app.include_router(routes_feeds.router, prefix="/api/feeds", tags=["feeds"])
    app.include_router(routes_agent.router, prefix="/api/agent", tags=["agent"])
    app.include_router(websocket.router, tags=["ws"])


_mount_routers()
