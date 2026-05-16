"""Pydantic schemas — the Helm API contract.

This module is the single source of truth for the shapes exchanged over REST and
WebSocket. ``frontend/src/api/types.ts`` mirrors it; keep them in sync.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #


class EngineMode(str, Enum):
    DEMO = "demo"
    SANDBOX = "sandbox"
    LIVE = "live"
    BACKTEST = "backtest"


class OrderSide(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class PositionSide(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"
    FLAT = "FLAT"


class OrderStatus(str, Enum):
    INITIALIZED = "INITIALIZED"
    SUBMITTED = "SUBMITTED"
    ACCEPTED = "ACCEPTED"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class OrderType(str, Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP_MARKET = "STOP_MARKET"
    STOP_LIMIT = "STOP_LIMIT"


class AIAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"
    CLOSE = "CLOSE"
    REBALANCE = "REBALANCE"


class AIState(str, Enum):
    IDLE = "idle"
    ANALYZING = "analyzing"
    EXECUTING = "executing"
    PAUSED = "paused"


class SignalSentiment(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #


class Instrument(BaseModel):
    id: str  # e.g. "AAPL.NASDAQ" / "BTCUSDT.BINANCE"
    symbol: str
    venue: str
    asset_class: str = "EQUITY"  # EQUITY | CRYPTO | FX | FUTURE | OPTION
    quote_currency: str = "USD"
    price_precision: int = 2
    size_precision: int = 0


class Bar(BaseModel):
    instrument: str
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class Quote(BaseModel):
    instrument: str
    ts: datetime
    bid: float
    ask: float
    last: float
    change_pct: float = 0.0


# --------------------------------------------------------------------------- #
# Trading state
# --------------------------------------------------------------------------- #


class Position(BaseModel):
    id: str
    instrument: str
    side: PositionSide
    quantity: float
    avg_px: float
    last_px: float
    market_value: float
    unrealized_pnl: float
    realized_pnl: float
    opened_at: datetime
    strategy: str = "ai-trader"


class Order(BaseModel):
    id: str
    instrument: str
    side: OrderSide
    type: OrderType
    status: OrderStatus
    quantity: float
    filled_qty: float = 0.0
    price: float | None = None
    avg_px: float | None = None
    ts: datetime
    strategy: str = "ai-trader"


class Account(BaseModel):
    id: str
    currency: str = "USD"
    balance: float
    equity: float
    free: float
    used: float


class EquityPoint(BaseModel):
    ts: datetime
    equity: float


class PortfolioSnapshot(BaseModel):
    ts: datetime
    currency: str = "USD"
    equity: float
    starting_equity: float
    total_pnl: float
    total_pnl_pct: float
    unrealized_pnl: float
    realized_pnl: float
    net_exposure: float
    positions_count: int
    win_rate: float = 0.0
    sharpe: float = 0.0
    max_drawdown_pct: float = 0.0
    equity_curve: list[EquityPoint] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# AI trader
# --------------------------------------------------------------------------- #


class AISignal(BaseModel):
    """A single piece of evidence the AI trader cited for a decision."""

    label: str  # "RSI(14)" / "WH press release" / "X chatter spike"
    value: str  # "28.4" / "+0.62"
    sentiment: SignalSentiment = SignalSentiment.NEUTRAL
    source: str = ""  # widget/source id this signal came from


class AIDecision(BaseModel):
    id: str
    ts: datetime
    action: AIAction
    instrument: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    thesis: str  # one-line summary
    reasoning: str  # full rationale (markdown ok)
    signals: list[AISignal] = Field(default_factory=list)
    order_id: str | None = None
    status: Literal["proposed", "executed", "skipped", "rejected"] = "proposed"
    realized_pnl: float | None = None  # filled in once the trade closes


class AITraderStatus(BaseModel):
    state: AIState
    mode: EngineMode
    strategy_name: str
    last_run: datetime | None = None
    uptime_s: float = 0.0
    decisions_today: int = 0
    win_rate: float = 0.0
    enabled: bool = True


class AIControlRequest(BaseModel):
    action: Literal["pause", "resume"]


# --------------------------------------------------------------------------- #
# Exotic indicator feeds
# --------------------------------------------------------------------------- #


class FeedKind(str, Enum):
    RSS = "rss"  # server-parsed RSS/Atom, rendered as native cards
    OEMBED = "oembed"  # oEmbed HTML embed
    IFRAME = "iframe"  # sandboxed iframe (e.g. Widgetbot)
    JSON = "json"  # JSON API normalized server-side


class FeedSource(BaseModel):
    id: str  # "whitehouse" / "reddit" / "sec-edgar" / "fear-greed"
    name: str
    category: str  # "Social" | "News" | "Macro" | "Markets"
    description: str
    kind: FeedKind
    icon: str = ""  # lucide icon name hint for the UI
    params: dict[str, Any] = Field(default_factory=dict)  # configurable params schema
    refresh_s: int = 300


class FeedItem(BaseModel):
    id: str
    source_id: str
    title: str
    summary: str = ""
    url: str = ""
    author: str = ""
    published: datetime | None = None
    image: str | None = None
    html: str | None = None  # sanitized embed HTML, when kind == oembed
    sentiment: SignalSentiment | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class OEmbedResponse(BaseModel):
    html: str
    provider: str = ""
    title: str = ""


# --------------------------------------------------------------------------- #
# WebSocket envelope
# --------------------------------------------------------------------------- #

WsEventType = Literal[
    "quote",
    "bar",
    "order",
    "position",
    "account",
    "portfolio",
    "ai_decision",
    "ai_status",
    "log",
    "wake",
    "agent_message",
]


class WsEvent(BaseModel):
    type: WsEventType
    ts: datetime
    payload: dict[str, Any]


class LogEntry(BaseModel):
    ts: datetime
    level: Literal["debug", "info", "warning", "error"] = "info"
    source: str = "engine"
    message: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    mode: EngineMode
    nautilus_available: bool
    openbb_available: bool
    engine_running: bool


# --------------------------------------------------------------------------- #
# Nautilus artifacts: backtests + risk analyses
# --------------------------------------------------------------------------- #


class BacktestTrade(BaseModel):
    ts: datetime
    instrument: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    pnl: float | None = None


class BacktestSummary(BaseModel):
    """List-view fields — keep small so list endpoints stay token-efficient."""

    id: str
    name: str
    strategy: str
    instruments: list[str]
    start: datetime
    end: datetime
    final_equity: float
    starting_equity: float
    total_return_pct: float
    sharpe: float | None = None
    max_drawdown_pct: float | None = None
    trades_count: int


class BacktestResult(BacktestSummary):
    """Full result — includes the equity curve and individual trades."""

    equity_curve: list[EquityPoint] = Field(default_factory=list)
    trades: list[BacktestTrade] = Field(default_factory=list)
    notes: str | None = None


class RiskExposure(BaseModel):
    instrument: str
    quantity: float
    market_value: float
    weight: float  # fraction of equity
    beta: float | None = None


class RiskScenario(BaseModel):
    name: str
    pnl_pct: float
    description: str | None = None


class RiskAnalysisSummary(BaseModel):
    id: str
    name: str
    ts: datetime
    portfolio_equity: float
    gross_exposure: float
    net_exposure: float
    var_95: float | None = None


class RiskAnalysisResult(RiskAnalysisSummary):
    exposures: list[RiskExposure] = Field(default_factory=list)
    scenarios: list[RiskScenario] = Field(default_factory=list)
    notes: str | None = None


class StrategyInfo(BaseModel):
    id: str
    name: str
    kind: Literal["live", "backtest", "ad-hoc"]
    description: str
