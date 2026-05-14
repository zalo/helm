"""Helm backend configuration.

Settings load from environment variables (prefix ``HELM_``) or a local ``.env``.
Out of the box Helm runs in ``demo`` mode — a self-contained market + AI-trader
simulator — so the whole stack works with zero credentials.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from helm.models import EngineMode


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HELM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Engine ---
    mode: EngineMode = EngineMode.DEMO
    trader_id: str = "HELM-001"
    strategy_name: str = "ai-trader"
    starting_equity: float = 100_000.0
    base_currency: str = "USD"

    # Instruments the demo simulator / default subscriptions cover.
    instruments: list[str] = Field(
        default_factory=lambda: [
            "AAPL.NASDAQ",
            "NVDA.NASDAQ",
            "TSLA.NASDAQ",
            "BTCUSDT.BINANCE",
            "ETHUSDT.BINANCE",
            "EURUSD.SIM",
        ]
    )

    # --- AI trader cadence ---
    ai_tick_seconds: float = 8.0  # how often the trader re-evaluates
    ai_autostart: bool = True

    # --- Venue credentials (only used when mode != demo) ---
    binance_api_key: str | None = None
    binance_api_secret: str | None = None
    ib_host: str = "127.0.0.1"
    ib_port: int = 7497
    ib_client_id: int = 1

    # --- Research layer ---
    openbb_api_url: str | None = None  # e.g. http://localhost:6900
    openbb_pat: str | None = None

    # --- HTTP / server ---
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )
    feed_cache_ttl_s: int = 300
    http_user_agent: str = "Helm/0.1 (+https://github.com/helm-trading/helm)"


@lru_cache
def get_settings() -> Settings:
    return Settings()
