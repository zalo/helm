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
    ib_account_id: str | None = None
    ib_trading_mode: str = "paper"  # paper | live
    ib_read_only_api: bool = True
    # IB market-data tier. REALTIME needs a paid market-data subscription on
    # the IB account; paper / unsubscribed accounts should use DELAYED_FROZEN
    # to get ~15-min-delayed ticks for free.
    # Accepted: realtime | frozen | delayed | delayed_frozen.
    ib_market_data_type: str = "realtime"
    # Bar aggregation source for the 1-min bars the engine subscribes/requests.
    # INTERNAL = Nautilus aggregates from trade ticks (needs tick-by-tick sub).
    # EXTERNAL = use IB's reqHistoricalData (works with delayed data too).
    # Pair "delayed*"/"frozen" market data with EXTERNAL; REALTIME w/ tick sub
    # can use INTERNAL.
    bar_aggregation_source: str = "external"

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


def bar_type_str(instrument_id: object) -> str:
    """One source of truth for the bar-type string the engine uses.

    Reads ``HELM_BAR_AGGREGATION_SOURCE`` once per process. Unknown values fall
    back to EXTERNAL since it's the safer default for IB without a tick-data sub.
    """
    src = (get_settings().bar_aggregation_source or "external").strip().upper()
    if src not in ("INTERNAL", "EXTERNAL"):
        src = "EXTERNAL"
    return f"{instrument_id}-1-MINUTE-LAST-{src}"
