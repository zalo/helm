/**
 * TypeScript mirror of `backend/helm/models.py` — the Helm API contract.
 * Keep this file in sync with the Pydantic models.
 */

export type EngineMode = "demo" | "sandbox" | "live" | "backtest";
export type OrderSide = "BUY" | "SELL";
export type PositionSide = "LONG" | "SHORT" | "FLAT";
export type OrderStatus =
  | "INITIALIZED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED";
export type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "STOP_LIMIT";
export type AIAction = "BUY" | "SELL" | "HOLD" | "CLOSE" | "REBALANCE";
export type AIState = "idle" | "analyzing" | "executing" | "paused";
export type SignalSentiment = "bullish" | "bearish" | "neutral";
export type FeedKind = "rss" | "oembed" | "iframe" | "json";

// --- Market data ----------------------------------------------------------

export interface Instrument {
  id: string;
  symbol: string;
  venue: string;
  asset_class: string;
  quote_currency: string;
  price_precision: number;
  size_precision: number;
}

export interface Bar {
  instrument: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  instrument: string;
  ts: string;
  bid: number;
  ask: number;
  last: number;
  change_pct: number;
}

// --- Trading state --------------------------------------------------------

export interface Position {
  id: string;
  instrument: string;
  side: PositionSide;
  quantity: number;
  avg_px: number;
  last_px: number;
  market_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  opened_at: string;
  strategy: string;
}

export interface Order {
  id: string;
  instrument: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  quantity: number;
  filled_qty: number;
  price: number | null;
  avg_px: number | null;
  ts: string;
  strategy: string;
}

export interface Account {
  id: string;
  currency: string;
  balance: number;
  equity: number;
  free: number;
  used: number;
}

export interface EquityPoint {
  ts: string;
  equity: number;
}

export interface PortfolioSnapshot {
  ts: string;
  currency: string;
  equity: number;
  starting_equity: number;
  total_pnl: number;
  total_pnl_pct: number;
  unrealized_pnl: number;
  realized_pnl: number;
  net_exposure: number;
  positions_count: number;
  win_rate: number;
  sharpe: number;
  max_drawdown_pct: number;
  equity_curve: EquityPoint[];
}

// --- AI trader ------------------------------------------------------------

export interface AISignal {
  label: string;
  value: string;
  sentiment: SignalSentiment;
  source: string;
}

export interface AIDecision {
  id: string;
  ts: string;
  action: AIAction;
  instrument: string | null;
  confidence: number;
  thesis: string;
  reasoning: string;
  signals: AISignal[];
  order_id: string | null;
  status: "proposed" | "executed" | "skipped" | "rejected";
  realized_pnl: number | null;
}

export interface AITraderStatus {
  state: AIState;
  mode: EngineMode;
  strategy_name: string;
  last_run: string | null;
  uptime_s: number;
  decisions_today: number;
  win_rate: number;
  enabled: boolean;
}

// --- Exotic indicator feeds ----------------------------------------------

export interface FeedSource {
  id: string;
  name: string;
  category: string;
  description: string;
  kind: FeedKind;
  icon: string;
  params: Record<string, unknown>;
  refresh_s: number;
}

export interface FeedItem {
  id: string;
  source_id: string;
  title: string;
  summary: string;
  url: string;
  author: string;
  published: string | null;
  image: string | null;
  html: string | null;
  sentiment: SignalSentiment | null;
  meta: Record<string, unknown>;
}

export interface OEmbedResponse {
  html: string;
  provider: string;
  title: string;
}

// --- WebSocket ------------------------------------------------------------

export type WsEventType =
  | "quote"
  | "bar"
  | "order"
  | "position"
  | "account"
  | "portfolio"
  | "ai_decision"
  | "ai_status"
  | "log"
  | "wake"
  | "agent_message";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  ts: string;
  payload: T;
}

export interface LogEntry {
  ts: string;
  level: "debug" | "info" | "warning" | "error";
  source: string;
  message: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  mode: EngineMode;
  nautilus_available: boolean;
  openbb_available: boolean;
  engine_running: boolean;
}
