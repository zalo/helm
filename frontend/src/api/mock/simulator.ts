/**
 * `DemoSimulator` — a client-side port of the Python `DemoEngine` + `AIBrain` +
 * `DecisionStore`. Drives a fully self-contained market + portfolio + AI-trader
 * simulation so the frontend works with no backend (GitHub Pages demo build).
 *
 * Logic is ported faithfully from:
 *   - backend/helm/engine/demo_engine.py
 *   - backend/helm/ai/brain.py
 *   - backend/helm/ai/decisions.py
 */

import type {
  Account,
  AIAction,
  AIDecision,
  AISignal,
  AIState,
  AITraderStatus,
  Bar,
  EngineMode,
  EquityPoint,
  Instrument,
  Order,
  OrderSide,
  PortfolioSnapshot,
  Position,
  PositionSide,
  Quote,
  SignalSentiment,
  WsEvent,
  WsEventType,
} from "../types";
import instrumentsJson from "./snapshots/instruments.json";

// --- Settings mirror (backend/helm/config.py defaults) -----------------------
const STARTING_EQUITY = 100_000.0;
const BASE_CURRENCY = "USD";
const STRATEGY_NAME = "ai-trader";
const TRADER_ID = "HELM-001";
const MODE: EngineMode = "demo";
const AI_TICK_SECONDS = 8.0;

const BAR_LIMIT = 500;
const TICK_SECONDS = 1.0;
const PORTFOLIO_EVERY = 4; // publish a portfolio event every N ticks
const TRADE_SIZE_FRACTION = 0.08;

// --- seeded RNG (mulberry32) — deterministic, like Python's random.Random -----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard-normal sample from a uniform RNG. */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Floor a Date to the minute (mirrors `replace(second=0, microsecond=0)`). */
function floorMinute(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(0, 0);
  return c;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 14)}`;
}

// --- per-instrument price + bar simulator ------------------------------------
class Sim {
  instrument: Instrument;
  private rng: () => number;
  price: number;
  sessionOpen: number;
  bars: Bar[] = [];
  private barMinute: number | null = null;
  private o: number;
  private h: number;
  private l: number;
  private c: number;
  private volAccum = 0;
  private mu = 0.0;
  private sigma: number;

  constructor(instrument: Instrument, seedPx: number, rng: () => number) {
    this.instrument = instrument;
    this.rng = rng;
    this.price = seedPx;
    this.sessionOpen = seedPx;
    this.o = this.h = this.l = this.c = seedPx;
    this.sigma =
      instrument.asset_class === "CRYPTO"
        ? 0.45
        : instrument.asset_class === "FX"
          ? 0.06
          : 0.28;
    this.backfill();
  }

  private stepPrice(): number {
    const dt = TICK_SECONDS / (365.0 * 24.0 * 3600.0);
    const shock = gauss(this.rng);
    const drift = (this.mu - 0.5 * this.sigma ** 2) * dt;
    const diffusion = this.sigma * Math.sqrt(dt) * shock;
    this.price *= Math.exp(drift + diffusion);
    return this.price;
  }

  /** Seed ~120 one-minute bars of plausible history ending now. */
  private backfill(): void {
    const now = floorMinute(new Date());
    let px = this.sessionOpen;
    const bars: Bar[] = [];
    for (let i = 120; i > 0; i--) {
      const ts = new Date(now.getTime() - i * 60_000);
      const o = px;
      let hi = px;
      let lo = px;
      for (let s = 0; s < 60; s++) {
        const dt = 1.0 / (365.0 * 24.0 * 3600.0);
        const shock = gauss(this.rng);
        px *= Math.exp(-0.5 * this.sigma ** 2 * dt + this.sigma * Math.sqrt(dt) * shock);
        hi = Math.max(hi, px);
        lo = Math.min(lo, px);
      }
      bars.push({
        instrument: this.instrument.id,
        ts: ts.toISOString(),
        open: round(o, 6),
        high: round(hi, 6),
        low: round(lo, 6),
        close: round(px, 6),
        volume: round(uniform(this.rng, 500, 5000), 2),
      });
    }
    this.bars = bars;
    this.price = px;
    this.sessionOpen = bars.length ? bars[0].open : px;
  }

  /** Advance one tick. Returns the new quote and a finalised bar if a minute boundary was crossed. */
  tick(): { quote: Quote; finalised: Bar | null } {
    const px = this.stepPrice();
    const now = new Date();
    const minute = floorMinute(now).getTime();
    let finalised: Bar | null = null;

    if (this.barMinute === null) {
      this.barMinute = minute;
      this.o = this.h = this.l = this.c = px;
      this.volAccum = 0;
    } else if (minute !== this.barMinute) {
      finalised = {
        instrument: this.instrument.id,
        ts: new Date(this.barMinute).toISOString(),
        open: round(this.o, 6),
        high: round(this.h, 6),
        low: round(this.l, 6),
        close: round(this.c, 6),
        volume: round(this.volAccum, 2),
      };
      this.bars.push(finalised);
      if (this.bars.length > BAR_LIMIT) this.bars.shift();
      this.barMinute = minute;
      this.o = this.h = this.l = this.c = px;
      this.volAccum = 0;
    } else {
      this.h = Math.max(this.h, px);
      this.l = Math.min(this.l, px);
      this.c = px;
      this.volAccum += uniform(this.rng, 5, 80);
    }

    const prec = this.instrument.price_precision;
    const spread = Math.max(px * 0.0002, 10 ** -prec);
    const changePct = this.sessionOpen
      ? ((px - this.sessionOpen) / this.sessionOpen) * 100.0
      : 0.0;
    const quote: Quote = {
      instrument: this.instrument.id,
      ts: now.toISOString(),
      bid: round(px - spread / 2, 6),
      ask: round(px + spread / 2, 6),
      last: round(px, 6),
      change_pct: round(changePct, 4),
    };
    return { quote, finalised };
  }

  /** The in-progress (not yet finalised) current-minute bar. */
  liveBar(): Bar {
    const ts =
      this.barMinute !== null
        ? new Date(this.barMinute)
        : floorMinute(new Date());
    return {
      instrument: this.instrument.id,
      ts: ts.toISOString(),
      open: round(this.o, 6),
      high: round(this.h, 6),
      low: round(this.l, 6),
      close: round(this.c, 6),
      volume: round(this.volAccum, 2),
    };
  }

  allBars(): Bar[] {
    return [...this.bars, this.liveBar()];
  }
}

// --- AI brain (port of brain.py) ---------------------------------------------
function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50.0;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return 100.0 - 100.0 / (1.0 + rs);
}

function returns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev) out.push((closes[i] - prev) / prev);
  }
  return out;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0.0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sent(score: number): SignalSentiment {
  if (score > 0.12) return "bullish";
  if (score < -0.12) return "bearish";
  return "neutral";
}

/** FNV-1a 32-bit hash — stand-in for sha256-derived determinism in `_social_sentiment`. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Scored {
  score: number;
  signals: AISignal[];
  rsi: number;
  momentum: number;
  vol: number;
  social: number;
  macroOn: boolean;
  macroText: string;
}

class AIBrain {
  private socialSentiment(instrument: string, ts: Date): number {
    const stamp =
      `${ts.getUTCFullYear()}` +
      `${String(ts.getUTCMonth() + 1).padStart(2, "0")}` +
      `${String(ts.getUTCDate()).padStart(2, "0")}` +
      `${String(ts.getUTCHours()).padStart(2, "0")}` +
      `${String(ts.getUTCMinutes()).padStart(2, "0")}`;
    const raw = fnv1a(`${instrument}:${stamp}`) / 0xffffffff;
    return round(raw * 2.0 - 1.0, 2);
  }

  private macroFlag(ts: Date): { on: boolean; text: string } {
    const bucket = ts.getUTCMinutes() % 7;
    const headlines: Record<number, string> = {
      0: "Fed minutes signal dovish tilt",
      3: "CPI print lands below consensus",
      5: "Risk-off on geopolitical headlines",
    };
    if (bucket in headlines) return { on: true, text: headlines[bucket] };
    return { on: false, text: "" };
  }

  private scoreInstrument(instrument: string, closes: number[], ts: Date): Scored {
    const rets = returns(closes);
    const window = rets.length >= 10 ? rets.slice(-10) : rets;
    const momentum = window.length
      ? window.reduce((a, b) => a + b, 0) / window.length
      : 0.0;
    const momentumScore = clamp(momentum * 250.0, -1.0, 1.0);

    const rsiVal = rsi(closes);
    const rsiScore = clamp((50.0 - rsiVal) / 25.0, -1.0, 1.0);

    const vol = window.length ? stdev(window) : 0.0;
    const volRegime = vol > 0.004 ? "elevated" : "calm";
    const volDamp = volRegime === "elevated" ? 0.6 : 1.0;

    const social = this.socialSentiment(instrument, ts);
    const { on: macroOn, text: macroText } = this.macroFlag(ts);
    let macroScore = 0.0;
    if (macroOn) {
      macroScore =
        macroText.includes("dovish") || macroText.includes("below") ? 0.4 : -0.5;
    }

    let blended =
      (momentumScore * 0.35 +
        rsiScore * 0.3 +
        social * 0.2 +
        macroScore * 0.15) *
      volDamp;
    blended = clamp(blended, -1.0, 1.0);

    const signals: AISignal[] = [
      {
        label: "Momentum(10)",
        value: `${momentum * 100 >= 0 ? "+" : ""}${(momentum * 100).toFixed(2)}%`,
        sentiment: sent(momentumScore),
        source: "price-action",
      },
      {
        label: "RSI(14)",
        value: rsiVal.toFixed(1),
        sentiment: sent(rsiScore),
        source: "price-action",
      },
      {
        label: "Volatility regime",
        value: `${(vol * 100).toFixed(2)}% (${volRegime})`,
        sentiment: "neutral",
        source: "price-action",
      },
      {
        label: "X chatter",
        value: `${social >= 0 ? "+" : ""}${social.toFixed(2)}`,
        sentiment: sent(social),
        source: "twitter-feed",
      },
    ];
    if (macroOn) {
      signals.push({
        label: "Macro headline",
        value: macroText,
        sentiment: sent(macroScore),
        source: "news-wire",
      });
    }

    return {
      score: blended,
      signals,
      rsi: rsiVal,
      momentum,
      vol,
      social,
      macroOn,
      macroText,
    };
  }

  private resolveAction(score: number, held: Position | undefined): AIAction {
    const buyTh = 0.22;
    const sellTh = -0.22;

    if (held && held.side !== "FLAT") {
      const long = held.side === "LONG";
      if (long && score <= sellTh) return "CLOSE";
      if (!long && score >= buyTh) return "CLOSE";
      if (long && score >= buyTh + 0.25) return "BUY";
      if (!long && score <= sellTh - 0.25) return "SELL";
      return "HOLD";
    }
    if (score >= buyTh) return "BUY";
    if (score <= sellTh) return "SELL";
    return "HOLD";
  }

  private thesis(
    action: AIAction,
    instrument: string,
    score: number,
    rsiVal: number,
    momentum: number,
  ): string {
    const sym = instrument.split(".")[0];
    if (action === "HOLD")
      return `No edge on ${sym} — signals mixed, standing aside.`;
    if (action === "CLOSE")
      return `Closing ${sym}: thesis invalidated by a signal reversal.`;
    const direction = action === "BUY" ? "Long" : "Short";
    const driver =
      Math.abs(momentum) > 0.0008
        ? "momentum"
        : Math.abs(rsiVal - 50) > 15
          ? "RSI mean-reversion"
          : "blended alt-data";
    const s = `${score >= 0 ? "+" : ""}${score.toFixed(2)}`;
    return `${direction} ${sym} — ${driver} skew, blended score ${s}.`;
  }

  private reasoning(
    action: AIAction,
    instrument: string,
    score: number,
    rsiVal: number,
    momentum: number,
    vol: number,
    social: number,
    macroOn: boolean,
    macroText: string,
    held: Position | undefined,
  ): string {
    const sym = instrument.split(".")[0];
    const rsiNote =
      rsiVal < 30
        ? `RSI(14) at **${rsiVal.toFixed(1)}** is in oversold territory`
        : rsiVal > 70
          ? `RSI(14) at **${rsiVal.toFixed(1)}** is overbought`
          : `RSI(14) at **${rsiVal.toFixed(1)}** is neutral`;
    const momNote = `recent momentum is running **${momentum * 100 >= 0 ? "+" : ""}${(
      momentum * 100
    ).toFixed(2)}%** per bar`;
    const volNote =
      vol > 0.004
        ? "Volatility is **elevated**, so I'm sizing conviction down."
        : "Volatility is **calm**, supporting a normal-conviction read.";
    const socialNote =
      `Social chatter scores **${social >= 0 ? "+" : ""}${social.toFixed(2)}** ` +
      (social > 0.15
        ? "(crowd leaning bullish)"
        : social < -0.15
          ? "(crowd leaning bearish)"
          : "(crowd indifferent)");
    const macroNote = macroOn
      ? ` A macro headline is live — _${macroText}_ — which I weighted into the blend.`
      : "";

    const s = `${score >= 0 ? "+" : ""}${score.toFixed(2)}`;
    const parts: string[] = [
      `For ${sym}: ${rsiNote}, and ${momNote}.`,
      `${volNote} ${socialNote}.${macroNote}`,
    ];
    if (action === "HOLD") {
      parts.push(
        `The blended score is only **${s}** — inside my no-trade band, ` +
          "so the highest-EV move is to wait for confirmation.",
      );
    } else if (action === "CLOSE" && held) {
      parts.push(
        `I'm holding a ${held.side.toLowerCase()} of ${held.quantity} ${sym}; ` +
          `the signal has flipped to **${s}**, against the position — ` +
          "taking it off to protect P&L.",
      );
    } else if (action === "BUY" || action === "SELL") {
      const side = action === "BUY" ? "long" : "short";
      parts.push(
        `Net blended score of **${s}** clears my entry threshold; ` +
          `opening/adding a ${side} exposure in ${sym}.`,
      );
    }
    return parts.join(" ");
  }

  /** Pick one instrument to act on and return a decision (or null if no data). */
  evaluate(
    barsByInstrument: Record<string, Bar[]>,
    positions: Position[],
  ): AIDecision | null {
    const candidates = Object.entries(barsByInstrument).filter(
      ([, bars]) => bars.length >= 5,
    );
    if (candidates.length === 0) return null;

    const ts = new Date();
    const posByInstrument = new Map(positions.map((p) => [p.instrument, p]));

    let best: { conviction: number; instrument: string; scored: Scored } | null =
      null;
    for (const [instrument, bars] of candidates) {
      const closes = bars.map((b) => b.close);
      const scored = this.scoreInstrument(instrument, closes, ts);
      const conviction = Math.abs(scored.score);
      if (best === null || conviction > best.conviction) {
        best = { conviction, instrument, scored };
      }
    }
    if (best === null) return null;

    const { instrument, scored } = best;
    const { score, signals, rsi: rsiVal, momentum, vol, social, macroOn, macroText } =
      scored;
    const held = posByInstrument.get(instrument);

    let confidence = Math.min(0.99, 0.5 + Math.abs(score) * 0.5);
    const action = this.resolveAction(score, held);
    if (action === "HOLD") {
      confidence = round(Math.min(confidence, 0.45 + Math.abs(score) * 0.2), 3);
    }

    return {
      id: uid("dec"),
      ts: ts.toISOString(),
      action,
      instrument,
      confidence: round(confidence, 3),
      thesis: this.thesis(action, instrument, score, rsiVal, momentum),
      reasoning: this.reasoning(
        action,
        instrument,
        score,
        rsiVal,
        momentum,
        vol,
        social,
        macroOn,
        macroText,
        held,
      ),
      signals,
      order_id: null,
      status: "proposed",
      realized_pnl: null,
    };
  }
}

// --- DecisionStore (port of decisions.py) ------------------------------------
class DecisionStore {
  private decisions: AIDecision[] = [];
  private byId = new Map<string, AIDecision>();
  private readonly maxlen: number;

  constructor(maxlen = 500) {
    this.maxlen = maxlen;
  }

  append(decision: AIDecision): AIDecision {
    if (this.decisions.length === this.maxlen && this.decisions.length) {
      const evicted = this.decisions.shift()!;
      this.byId.delete(evicted.id);
    }
    this.decisions.push(decision);
    this.byId.set(decision.id, decision);
    return decision;
  }

  /** Newest-first, capped at `limit`. */
  list(limit = 100): AIDecision[] {
    return [...this.decisions].reverse().slice(0, Math.max(0, limit));
  }

  update(
    id: string,
    patch: { realized_pnl?: number; status?: AIDecision["status"]; order_id?: string },
  ): AIDecision | null {
    const decision = this.byId.get(id);
    if (!decision) return null;
    if (patch.realized_pnl !== undefined) decision.realized_pnl = patch.realized_pnl;
    if (patch.status !== undefined) decision.status = patch.status;
    if (patch.order_id !== undefined) decision.order_id = patch.order_id;
    return decision;
  }

  get decisionsToday(): number {
    const today = new Date().toISOString().slice(0, 10);
    return this.decisions.filter((d) => d.ts.slice(0, 10) === today).length;
  }

  get winRate(): number {
    const closed = this.decisions.filter((d) => d.realized_pnl !== null);
    if (closed.length === 0) return 0.0;
    const wins = closed.filter((d) => (d.realized_pnl ?? 0) > 0).length;
    return round(wins / closed.length, 4);
  }
}

// --- instrument seed table (demo_engine._SEEDS) ------------------------------
const SEED_PX: Record<string, number> = {
  AAPL: 228.5,
  NVDA: 135.2,
  TSLA: 251.4,
  BTCUSDT: 67_400.0,
  ETHUSDT: 3_240.0,
  EURUSD: 1.085,
};

type EventListener = (e: WsEvent) => void;

export class DemoSimulator {
  private rng = mulberry32(1337);
  private brain = new AIBrain();
  private decisions = new DecisionStore();

  private sims = new Map<string, Sim>();
  private account: Account;
  private positions = new Map<string, Position>(); // instrument -> open position
  private orders: Order[] = [];
  private realizedPnl = 0.0;
  private equityCurve: EquityPoint[] = [];
  private equityPeak = STARTING_EQUITY;

  private aiState: AIState = "idle";
  private aiEnabled = true;
  private aiLastRun: string | null = null;
  private startedAt: number | null = null;

  private listeners = new Set<EventListener>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private aiInitialTimer: ReturnType<typeof setTimeout> | null = null;
  private tickCount = 0;
  private running = false;

  constructor() {
    const instruments = instrumentsJson as Instrument[];
    for (const inst of instruments) {
      const seedPx = SEED_PX[inst.symbol] ?? 100.0;
      // Per-instrument RNG seeded off the master stream, mirroring the Python engine.
      this.sims.set(inst.id, new Sim(inst, seedPx, mulberry32(Math.floor(this.rng() * 2 ** 32))));
    }

    this.account = {
      id: `DEMO-${TRADER_ID}`,
      currency: BASE_CURRENCY,
      balance: STARTING_EQUITY,
      equity: STARTING_EQUITY,
      free: STARTING_EQUITY,
      used: 0.0,
    };

    this.seedStarterPositions();
    this.backfillDecisions();
    this.backfillEquityCurve();
  }

  // -- seeding ----------------------------------------------------------------
  /** Open positions seeded into the demo so the trader desk has live P&L on load. */
  private seedStarterPositions(): void {
    interface Starter {
      spec: string;
      side: PositionSide;
      qty: number;
      /** avg_px = last_px * avgMul (>1 → underwater long / profitable short). */
      avgMul: number;
      /** Minutes ago the position was opened. */
      openedMinAgo: number;
    }
    const starters: Starter[] = [
      { spec: "AAPL.NASDAQ",     side: "LONG",  qty: 120,  avgMul: 0.985, openedMinAgo: 42 },
      { spec: "BTCUSDT.BINANCE", side: "LONG",  qty: 0.35, avgMul: 0.985, openedMinAgo: 42 },
      { spec: "TSLA.NASDAQ",     side: "SHORT", qty: 60,   avgMul: 1.008, openedMinAgo: 22 },
    ];
    for (const s of starters) {
      const sim = this.sims.get(s.spec);
      if (!sim) continue;
      const last = sim.price;
      const avg = last * s.avgMul;
      const direction = s.side === "LONG" ? 1.0 : -1.0;
      const pos: Position = {
        id: uid("pos"),
        instrument: s.spec,
        side: s.side,
        quantity: s.qty,
        avg_px: round(avg, 6),
        last_px: round(last, 6),
        market_value: round(last * s.qty, 2),
        unrealized_pnl: round((last - avg) * s.qty * direction, 2),
        realized_pnl: 0.0,
        opened_at: new Date(Date.now() - s.openedMinAgo * 60_000).toISOString(),
        strategy: STRATEGY_NAME,
      };
      this.positions.set(s.spec, pos);
      this.account.used += Math.abs(pos.market_value);
    }
    this.recomputeAccount();
  }

  /** Lookup a plausible historical price for `spec` `ageMin` minutes ago. */
  private priceAt(spec: string, ageMin: number): number {
    const sim = this.sims.get(spec);
    if (!sim) return 100.0;
    const bars = sim.bars;
    if (!bars.length) return sim.price;
    const idx = Math.max(0, Math.min(bars.length - 1, bars.length - 1 - ageMin));
    return bars[idx].close;
  }

  /**
   * Backfill ~2 hours of synthetic equity curve so the PnL widget renders a
   * meaningful arc and `sharpe`/`maxDrawdownPct` have signal to compute from.
   */
  private backfillEquityCurve(): void {
    const points: EquityPoint[] = [];
    const start = STARTING_EQUITY;
    const end = this.account.equity;
    const peak    = start * 1.0145;   // mid-window high
    const trough  = start * 0.9905;   // late-window low → real drawdown
    const peakAt   = 0.42;
    const troughAt = 0.74;
    const minutes = 120;
    const now = Date.now();
    for (let i = minutes; i >= 0; i--) {
      const t = 1 - i / minutes;
      let base: number;
      if (t < peakAt) {
        const k = t / peakAt;
        base = start * 0.997 + (peak - start * 0.997) * k;
      } else if (t < troughAt) {
        const k = (t - peakAt) / (troughAt - peakAt);
        base = peak + (trough - peak) * k;
      } else {
        const k = (t - troughAt) / (1 - troughAt);
        base = trough + (end - trough) * k;
      }
      const jitter = (this.rng() - 0.5) * start * 0.0012;
      const equity = round(base + jitter, 2);
      points.push({ ts: new Date(now - i * 60_000).toISOString(), equity });
      this.equityPeak = Math.max(this.equityPeak, equity);
    }
    this.equityCurve = points;
  }

  /**
   * Hand-curated history of AI decisions + matching filled orders so the demo
   * has a credible story on first load — opens for current positions, a few
   * closed trades with realized P&L, a rejected order, a stale skip, and one
   * fresh proposed idea sitting at the top of the feed.
   */
  private backfillDecisions(): void {
    interface Seed {
      ageMin: number;
      instrument: string;
      action: AIAction;
      confidence: number;
      thesis: string;
      reasoning: string;
      signals: AISignal[];
      status: AIDecision["status"];
      /** Realized P&L attributed to this decision (positive=win, negative=loss). */
      realized_pnl: number | null;
      /** Whether to emit a matching Order. */
      emitOrder: boolean;
      /** Order quantity override; else derived from notional. */
      qty?: number;
      /** Order side override (else BUY for BUY/REBALANCE, SELL otherwise). */
      orderSide?: OrderSide;
      /** Order status override (else FILLED). */
      orderStatus?: Order["status"];
    }

    const sig = (
      label: string,
      value: string,
      sentiment: SignalSentiment,
      source = "price-action",
    ): AISignal => ({ label, value, sentiment, source });

    const SEEDS: Seed[] = [
      // ============ 1. Fresh proposed BUY at the top of the feed ============
      {
        ageMin: 1,
        instrument: "ETHUSDT.BINANCE",
        action: "BUY",
        confidence: 0.74,
        thesis: "Long ETHUSDT — momentum skew, blended score +0.38.",
        reasoning:
          "For ETHUSDT: RSI(14) at **58.7** is neutral, and recent momentum is running **+0.41%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.39** (crowd leaning bullish). " +
          "A macro headline is live — _CPI print lands below consensus_ — which I weighted into the blend. " +
          "Net blended score of **+0.38** clears my entry threshold; opening a long exposure in ETHUSDT.",
        signals: [
          sig("Momentum(10)", "+0.41%", "bullish"),
          sig("RSI(14)", "58.7", "neutral"),
          sig("Volatility regime", "0.21% (calm)", "neutral"),
          sig("X chatter", "+0.39", "bullish", "twitter-feed"),
          sig("Macro headline", "CPI print lands below consensus", "bullish", "news-wire"),
        ],
        status: "proposed",
        realized_pnl: null,
        emitOrder: false,
      },
      // ============ 2. Recent winning close: NVDA short covered ============
      {
        ageMin: 8,
        instrument: "NVDA.NASDAQ",
        action: "SELL",
        confidence: 0.69,
        thesis: "Short NVDA — RSI mean-reversion, blended score −0.36.",
        reasoning:
          "For NVDA: RSI(14) at **74.3** is overbought, and recent momentum is running **+0.18%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.08** (crowd indifferent). " +
          "Net blended score of **−0.36** clears my entry threshold; opening a short exposure in NVDA. " +
          "_Covered at +$140 a few minutes later — RSI flushed below 70._",
        signals: [
          sig("Momentum(10)", "+0.18%", "neutral"),
          sig("RSI(14)", "74.3", "bearish"),
          sig("X chatter", "+0.08", "neutral", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: 140.0,
        emitOrder: true,
        qty: 80,
        orderSide: "SELL",
      },
      // ============ 3. Open current TSLA short (22 min ago) ============
      {
        ageMin: 22,
        instrument: "TSLA.NASDAQ",
        action: "SELL",
        confidence: 0.66,
        thesis: "Short TSLA — momentum skew, blended score −0.32.",
        reasoning:
          "For TSLA: RSI(14) at **38.4** is neutral, and recent momentum is running **−0.27%** per bar. " +
          "Volatility is **elevated**, so I'm sizing conviction down. " +
          "Social chatter scores **−0.21** (crowd leaning bearish). " +
          "Net blended score of **−0.32** clears my entry threshold; opening a short exposure in TSLA.",
        signals: [
          sig("Momentum(10)", "−0.27%", "bearish"),
          sig("RSI(14)", "38.4", "neutral"),
          sig("Volatility regime", "0.51% (elevated)", "neutral"),
          sig("X chatter", "−0.21", "bearish", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: null,
        emitOrder: true,
        qty: 60,
        orderSide: "SELL",
      },
      // ============ 4. HOLD/skipped — score in the no-trade band ============
      {
        ageMin: 32,
        instrument: "AAPL.NASDAQ",
        action: "HOLD",
        confidence: 0.39,
        thesis: "No edge on AAPL — signals mixed, standing aside.",
        reasoning:
          "For AAPL: RSI(14) at **52.1** is neutral, and recent momentum is running **+0.08%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.04** (crowd indifferent). " +
          "The blended score is only **+0.11** — inside my no-trade band, so the highest-EV move is to wait for confirmation.",
        signals: [
          sig("Momentum(10)", "+0.08%", "neutral"),
          sig("RSI(14)", "52.1", "neutral"),
          sig("X chatter", "+0.04", "neutral", "twitter-feed"),
        ],
        status: "skipped",
        realized_pnl: null,
        emitOrder: false,
      },
      // ============ 5. Open current AAPL long (42 min ago) ============
      {
        ageMin: 42,
        instrument: "AAPL.NASDAQ",
        action: "BUY",
        confidence: 0.72,
        thesis: "Long AAPL — momentum skew, blended score +0.43.",
        reasoning:
          "For AAPL: RSI(14) at **46.8** is neutral, and recent momentum is running **+0.31%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.34** (crowd leaning bullish). " +
          "A macro headline is live — _Fed minutes signal dovish tilt_ — which I weighted into the blend. " +
          "Net blended score of **+0.43** clears my entry threshold; opening a long exposure in AAPL.",
        signals: [
          sig("Momentum(10)", "+0.31%", "bullish"),
          sig("RSI(14)", "46.8", "neutral"),
          sig("X chatter", "+0.34", "bullish", "twitter-feed"),
          sig("Macro headline", "Fed minutes signal dovish tilt", "bullish", "news-wire"),
        ],
        status: "executed",
        realized_pnl: null,
        emitOrder: true,
        qty: 120,
        orderSide: "BUY",
      },
      // ============ 6. Open current BTCUSDT long (42 min ago) ============
      {
        ageMin: 42,
        instrument: "BTCUSDT.BINANCE",
        action: "BUY",
        confidence: 0.78,
        thesis: "Long BTCUSDT — momentum skew, blended score +0.51.",
        reasoning:
          "For BTCUSDT: RSI(14) at **63.4** is neutral, and recent momentum is running **+0.58%** per bar. " +
          "Volatility is **elevated**, so I'm sizing conviction down. " +
          "Social chatter scores **+0.46** (crowd leaning bullish). " +
          "A macro headline is live — _Fed minutes signal dovish tilt_ — which I weighted into the blend. " +
          "Net blended score of **+0.51** clears my entry threshold; opening a long exposure in BTCUSDT.",
        signals: [
          sig("Momentum(10)", "+0.58%", "bullish"),
          sig("RSI(14)", "63.4", "neutral"),
          sig("Volatility regime", "0.47% (elevated)", "neutral"),
          sig("X chatter", "+0.46", "bullish", "twitter-feed"),
          sig("Macro headline", "Fed minutes signal dovish tilt", "bullish", "news-wire"),
        ],
        status: "executed",
        realized_pnl: null,
        emitOrder: true,
        qty: 0.35,
        orderSide: "BUY",
      },
      // ============ 7. Closed earlier AAPL long for +$640 ============
      {
        ageMin: 75,
        instrument: "AAPL.NASDAQ",
        action: "BUY",
        confidence: 0.81,
        thesis: "Long AAPL — momentum skew, blended score +0.62.",
        reasoning:
          "For AAPL: RSI(14) at **41.2** is neutral, and recent momentum is running **+0.44%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.51** (crowd leaning bullish). " +
          "Net blended score of **+0.62** clears my entry threshold; opening a long exposure in AAPL. " +
          "_Closed at +$640 once RSI pushed back above 65._",
        signals: [
          sig("Momentum(10)", "+0.44%", "bullish"),
          sig("RSI(14)", "41.2", "neutral"),
          sig("X chatter", "+0.51", "bullish", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: 640.0,
        emitOrder: true,
        qty: 110,
        orderSide: "BUY",
      },
      // ============ 8. Losing trade: NVDA long, exited at −$185 ============
      {
        ageMin: 95,
        instrument: "NVDA.NASDAQ",
        action: "BUY",
        confidence: 0.58,
        thesis: "Long NVDA — momentum skew, blended score +0.28.",
        reasoning:
          "For NVDA: RSI(14) at **64.7** is neutral, and recent momentum is running **+0.22%** per bar. " +
          "Volatility is **elevated**, so I'm sizing conviction down. " +
          "Social chatter scores **+0.18** (crowd leaning bullish). " +
          "Net blended score of **+0.28** clears my entry threshold; opening a long exposure in NVDA. " +
          "_Stopped out at −$185 after the score flipped on a sentiment reversal._",
        signals: [
          sig("Momentum(10)", "+0.22%", "bullish"),
          sig("RSI(14)", "64.7", "neutral"),
          sig("X chatter", "+0.18", "bullish", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: -185.0,
        emitOrder: true,
        qty: 75,
        orderSide: "BUY",
      },
      // ============ 9. Closed earlier ETHUSDT long for +$240 ============
      {
        ageMin: 110,
        instrument: "ETHUSDT.BINANCE",
        action: "BUY",
        confidence: 0.7,
        thesis: "Long ETHUSDT — momentum skew, blended score +0.4.",
        reasoning:
          "For ETHUSDT: RSI(14) at **57.9** is neutral, and recent momentum is running **+0.35%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **+0.42** (crowd leaning bullish). " +
          "Net blended score of **+0.40** clears my entry threshold; opening a long exposure in ETHUSDT. " +
          "_Took profit at +$240 — momentum stalled into resistance._",
        signals: [
          sig("Momentum(10)", "+0.35%", "bullish"),
          sig("RSI(14)", "57.9", "neutral"),
          sig("X chatter", "+0.42", "bullish", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: 240.0,
        emitOrder: true,
        qty: 2.4,
        orderSide: "BUY",
      },
      // ============ 10. Order rejected — risk check failure ============
      {
        ageMin: 130,
        instrument: "TSLA.NASDAQ",
        action: "BUY",
        confidence: 0.56,
        thesis: "Long TSLA — momentum skew, blended score +0.27.",
        reasoning:
          "For TSLA: RSI(14) at **47.6** is neutral, and recent momentum is running **+0.19%** per bar. " +
          "Volatility is **elevated**, so I'm sizing conviction down. " +
          "Social chatter scores **+0.22** (crowd leaning bullish). " +
          "Net blended score of **+0.27** clears my entry threshold; opening a long exposure in TSLA. " +
          "_Risk check rejected the fill — single-name exposure cap hit. Will re-evaluate at next tick._",
        signals: [
          sig("Momentum(10)", "+0.19%", "bullish"),
          sig("RSI(14)", "47.6", "neutral"),
          sig("X chatter", "+0.22", "bullish", "twitter-feed"),
        ],
        status: "rejected",
        realized_pnl: null,
        emitOrder: true,
        qty: 50,
        orderSide: "BUY",
        orderStatus: "REJECTED",
      },
      // ============ 11. Closed earlier BTCUSDT long for +$320 ============
      {
        ageMin: 155,
        instrument: "BTCUSDT.BINANCE",
        action: "BUY",
        confidence: 0.73,
        thesis: "Long BTCUSDT — momentum skew, blended score +0.47.",
        reasoning:
          "For BTCUSDT: RSI(14) at **55.3** is neutral, and recent momentum is running **+0.49%** per bar. " +
          "Volatility is **elevated**, so I'm sizing conviction down. " +
          "Social chatter scores **+0.37** (crowd leaning bullish). " +
          "Net blended score of **+0.47** clears my entry threshold; opening a long exposure in BTCUSDT. " +
          "_Closed at +$320 — took profit ahead of CPI._",
        signals: [
          sig("Momentum(10)", "+0.49%", "bullish"),
          sig("RSI(14)", "55.3", "neutral"),
          sig("Volatility regime", "0.43% (elevated)", "neutral"),
          sig("X chatter", "+0.37", "bullish", "twitter-feed"),
        ],
        status: "executed",
        realized_pnl: 320.0,
        emitOrder: true,
        qty: 0.28,
        orderSide: "BUY",
      },
      // ============ 12. Older HOLD/skipped EURUSD ============
      {
        ageMin: 180,
        instrument: "EURUSD.SIM",
        action: "HOLD",
        confidence: 0.32,
        thesis: "No edge on EURUSD — signals mixed, standing aside.",
        reasoning:
          "For EURUSD: RSI(14) at **49.4** is neutral, and recent momentum is running **+0.03%** per bar. " +
          "Volatility is **calm**, supporting a normal-conviction read. " +
          "Social chatter scores **−0.07** (crowd indifferent). " +
          "The blended score is only **+0.04** — inside my no-trade band, so the highest-EV move is to wait for confirmation.",
        signals: [
          sig("Momentum(10)", "+0.03%", "neutral"),
          sig("RSI(14)", "49.4", "neutral"),
          sig("X chatter", "−0.07", "neutral", "twitter-feed"),
        ],
        status: "skipped",
        realized_pnl: null,
        emitOrder: false,
      },
    ];

    // Walk newest → oldest, but append oldest-first so DecisionStore order is
    // chronological (the widget reverses it for display).
    for (const s of [...SEEDS].reverse()) {
      const ts = new Date(Date.now() - s.ageMin * 60_000).toISOString();
      const decision: AIDecision = {
        id: uid("dec"),
        ts,
        action: s.action,
        instrument: s.instrument,
        confidence: s.confidence,
        thesis: s.thesis,
        reasoning: s.reasoning,
        signals: s.signals,
        order_id: null,
        status: s.status,
        realized_pnl: s.realized_pnl,
      };

      if (s.emitOrder && this.sims.has(s.instrument)) {
        const px = this.priceAt(s.instrument, s.ageMin);
        const side: OrderSide =
          s.orderSide ?? (s.action === "BUY" ? "BUY" : "SELL");
        const qty =
          s.qty ?? Math.max(1, (STARTING_EQUITY * TRADE_SIZE_FRACTION) / px);
        const status = s.orderStatus ?? "FILLED";
        const order: Order = {
          id: uid("ord"),
          instrument: s.instrument,
          side,
          type: "MARKET",
          status,
          quantity: qty,
          filled_qty: status === "FILLED" ? qty : 0,
          price: round(px, 6),
          avg_px: status === "FILLED" ? round(px, 6) : null,
          ts,
          strategy: STRATEGY_NAME,
        };
        this.orders.push(order);
        decision.order_id = order.id;
      }

      if (s.realized_pnl !== null) {
        this.realizedPnl += s.realized_pnl;
        this.account.balance += s.realized_pnl;
      }

      this.decisions.append(decision);
    }
    this.recomputeAccount();
  }

  // -- lifecycle --------------------------------------------------------------
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.aiState = this.aiEnabled ? "idle" : "paused";

    this.timers.push(setInterval(() => this.marketLoop(), TICK_SECONDS * 1000));
    this.timers.push(
      setInterval(() => this.portfolioLoop(), TICK_SECONDS * PORTFOLIO_EVERY * 1000),
    );
    // AI loop: small initial delay so the market loop has produced a tick or two.
    this.aiInitialTimer = setTimeout(() => {
      this.aiInitialTimer = null;
      if (!this.running) return;
      this.aiLoop();
      this.timers.push(setInterval(() => this.aiLoop(), AI_TICK_SECONDS * 1000));
    }, 1200);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.aiInitialTimer !== null) {
      clearTimeout(this.aiInitialTimer);
      this.aiInitialTimer = null;
    }
  }

  // -- event subscription -----------------------------------------------------
  onEvent(cb: EventListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(type: WsEventType, payload: unknown): void {
    const event: WsEvent = { type, ts: isoNow(), payload };
    this.listeners.forEach((l) => l(event));
  }

  // -- background loops -------------------------------------------------------
  private marketLoop(): void {
    this.tickCount += 1;
    for (const sim of this.sims.values()) {
      const { quote, finalised } = sim.tick();
      this.emit("quote", quote);
      if (finalised) this.emit("bar", finalised);
    }
    this.markPositions();
  }

  private portfolioLoop(): void {
    this.recomputeAccount();
    const snap = this.getPortfolio();
    this.equityCurve.push({ ts: snap.ts, equity: snap.equity });
    if (this.equityCurve.length > 2000) this.equityCurve.shift();
    this.emit("portfolio", snap);
    this.emit("account", this.account);
  }

  private aiLoop(): void {
    if (!this.running) return;
    if (this.aiEnabled) this.runAiCycle();
  }

  // -- AI cycle ---------------------------------------------------------------
  private runAiCycle(): void {
    this.setAiState("analyzing");
    this.aiLastRun = isoNow();

    const barsByInstrument: Record<string, Bar[]> = {};
    for (const [spec, sim] of this.sims) barsByInstrument[spec] = sim.allBars();
    const decision = this.brain.evaluate(barsByInstrument, [
      ...this.positions.values(),
    ]);
    if (!decision) {
      this.setAiState("idle");
      return;
    }

    if (decision.action === "HOLD") {
      decision.status = "skipped";
      this.decisions.append(decision);
      this.emit("ai_decision", decision);
      this.setAiState("idle");
      return;
    }

    this.setAiState("executing");
    this.decisions.append(decision);
    try {
      this.executeDecision(decision);
      if (decision.status === "proposed") decision.status = "executed";
    } catch {
      decision.status = "rejected";
    }
    this.emit("ai_decision", decision);
    this.setAiState("idle");
  }

  private executeDecision(decision: AIDecision): void {
    const spec = decision.instrument;
    if (!spec || !this.sims.has(spec)) {
      decision.status = "skipped";
      return;
    }
    const sim = this.sims.get(spec)!;
    const last = sim.price;
    const existing = this.positions.get(spec);

    if (decision.action === "CLOSE") {
      if (!existing) {
        decision.status = "skipped";
        return;
      }
      this.closePosition(spec, last, decision);
      return;
    }

    const side: OrderSide = decision.action === "BUY" ? "BUY" : "SELL";
    const notional = this.account.equity * TRADE_SIZE_FRACTION;
    let qty = Math.max(notional / last, 0.0);
    const inst = sim.instrument;
    if (inst.size_precision === 0) qty = Math.max(1, Math.round(qty));
    else qty = round(qty, inst.size_precision);
    if (qty <= 0) {
      decision.status = "skipped";
      return;
    }

    const order = this.fillOrder(spec, side, qty, last, decision);
    this.applyFill(spec, side, qty, last, order);
  }

  private fillOrder(
    spec: string,
    side: OrderSide,
    qty: number,
    px: number,
    decision: AIDecision,
  ): Order {
    const order: Order = {
      id: uid("ord"),
      instrument: spec,
      side,
      type: "MARKET",
      status: "FILLED",
      quantity: qty,
      filled_qty: qty,
      price: round(px, 6),
      avg_px: round(px, 6),
      ts: isoNow(),
      strategy: STRATEGY_NAME,
    };
    this.orders.push(order);
    decision.order_id = order.id;
    this.emit("order", order);
    return order;
  }

  private applyFill(
    spec: string,
    side: OrderSide,
    qty: number,
    px: number,
    _order: Order,
  ): void {
    const existing = this.positions.get(spec);
    const signed = side === "BUY" ? qty : -qty;

    if (!existing || existing.side === "FLAT") {
      const pos: Position = {
        id: uid("pos"),
        instrument: spec,
        side: signed > 0 ? "LONG" : "SHORT",
        quantity: Math.abs(signed),
        avg_px: round(px, 6),
        last_px: round(px, 6),
        market_value: round(px * Math.abs(signed), 2),
        unrealized_pnl: 0.0,
        realized_pnl: 0.0,
        opened_at: isoNow(),
        strategy: STRATEGY_NAME,
      };
      this.positions.set(spec, pos);
    } else {
      const curSigned =
        existing.side === "LONG" ? existing.quantity : -existing.quantity;
      const newSigned = curSigned + signed;
      if (Math.abs(newSigned) < 1e-9) {
        this.closePosition(spec, px, null);
        return;
      }
      existing.avg_px = round(
        (Math.abs(curSigned) * existing.avg_px + Math.abs(signed) * px) /
          Math.abs(newSigned),
        6,
      );
      existing.quantity = Math.abs(newSigned);
      existing.side = newSigned > 0 ? "LONG" : "SHORT";
      existing.last_px = round(px, 6);
    }

    this.markPositions();
    this.recomputeAccount();
    const pos = this.positions.get(spec);
    if (pos) this.emit("position", pos);
  }

  private closePosition(
    spec: string,
    px: number,
    decision: AIDecision | null,
  ): void {
    const pos = this.positions.get(spec);
    if (!pos) return;
    const direction = pos.side === "LONG" ? 1.0 : -1.0;
    const pnl = round((px - pos.avg_px) * pos.quantity * direction, 2);
    this.realizedPnl += pnl;
    this.account.balance += pnl;

    const closeSide: OrderSide = pos.side === "LONG" ? "SELL" : "BUY";
    const order: Order = {
      id: uid("ord"),
      instrument: spec,
      side: closeSide,
      type: "MARKET",
      status: "FILLED",
      quantity: pos.quantity,
      filled_qty: pos.quantity,
      price: round(px, 6),
      avg_px: round(px, 6),
      ts: isoNow(),
      strategy: STRATEGY_NAME,
    };
    this.orders.push(order);

    // Emit a final FLAT snapshot of the position before dropping it.
    const flat: Position = {
      ...pos,
      side: "FLAT",
      quantity: 0.0,
      last_px: round(px, 6),
      market_value: 0.0,
      unrealized_pnl: 0.0,
      realized_pnl: pnl,
    };
    this.positions.delete(spec);
    this.markPositions();
    this.recomputeAccount();

    if (decision) {
      decision.order_id = order.id;
      decision.realized_pnl = pnl;
      this.attributePnl(spec, pnl);
    }

    this.emit("order", order);
    this.emit("position", flat);
  }

  /** Set realized_pnl on the most recent open-decision for this instrument. */
  private attributePnl(spec: string, pnl: number): void {
    for (const dec of this.decisions.list(200)) {
      if (
        dec.instrument === spec &&
        (dec.action === "BUY" || dec.action === "SELL") &&
        dec.realized_pnl === null
      ) {
        this.decisions.update(dec.id, { realized_pnl: pnl });
        this.emit("ai_decision", dec);
        break;
      }
    }
  }

  // -- bookkeeping ------------------------------------------------------------
  private markPositions(): void {
    for (const [spec, pos] of this.positions) {
      const sim = this.sims.get(spec);
      if (!sim) continue;
      const last = sim.price;
      const direction = pos.side === "LONG" ? 1.0 : -1.0;
      pos.last_px = round(last, 6);
      pos.market_value = round(last * pos.quantity, 2);
      pos.unrealized_pnl = round((last - pos.avg_px) * pos.quantity * direction, 2);
    }
  }

  private recomputeAccount(): void {
    let unrealized = 0;
    let used = 0;
    for (const p of this.positions.values()) {
      unrealized += p.unrealized_pnl;
      used += Math.abs(p.market_value);
    }
    const equity = this.account.balance + unrealized;
    this.account.equity = round(equity, 2);
    this.account.used = round(used, 2);
    this.account.free = round(Math.max(equity - used, 0.0), 2);
    this.equityPeak = Math.max(this.equityPeak, equity);
  }

  private setAiState(state: AIState): void {
    if (state === this.aiState) return;
    this.aiState = state;
    this.emit("ai_status", this.getAiStatus());
  }

  // -- metrics ----------------------------------------------------------------
  /**
   * Annualised Sharpe over the equity curve. Annualisation factor is derived
   * from the *observed* median spacing between curve points so the formula
   * stays correct whether points are seconds, minutes, or hours apart — the
   * backfilled history is sparser than the live `PORTFOLIO_EVERY` cadence.
   */
  private sharpe(): number {
    const pts = this.equityCurve;
    if (pts.length < 3) return 0.0;
    const rets: number[] = [];
    const dts: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1].equity;
      if (prev) rets.push((pts[i].equity - prev) / prev);
      const dt =
        new Date(pts[i].ts).getTime() - new Date(pts[i - 1].ts).getTime();
      if (dt > 0) dts.push(dt);
    }
    if (rets.length < 2 || dts.length === 0) return 0.0;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance =
      rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0.0;
    const sortedDts = [...dts].sort((a, b) => a - b);
    const medianDtMs = sortedDts[Math.floor(sortedDts.length / 2)];
    const dailySamples = 86_400_000 / medianDtMs;
    const sh = (mean / std) * Math.sqrt(dailySamples);
    return round(clamp(sh, -5.0, 5.0), 2);
  }

  private maxDrawdownPct(): number {
    let peak = -Infinity;
    let maxDd = 0.0;
    for (const pt of this.equityCurve) {
      peak = Math.max(peak, pt.equity);
      if (peak > 0) {
        const dd = (peak - pt.equity) / peak;
        maxDd = Math.max(maxDd, dd);
      }
    }
    return round(maxDd * 100.0, 3);
  }

  // -- BaseEngine getters -----------------------------------------------------
  getPortfolio(): PortfolioSnapshot {
    this.recomputeAccount();
    let unrealized = 0;
    let netExposure = 0;
    for (const p of this.positions.values()) {
      unrealized += p.unrealized_pnl;
      netExposure += p.side === "LONG" ? p.market_value : -p.market_value;
    }
    unrealized = round(unrealized, 2);
    const equity = this.account.equity;
    const start = STARTING_EQUITY;
    const totalPnl = round(equity - start, 2);
    return {
      ts: isoNow(),
      currency: BASE_CURRENCY,
      equity: round(equity, 2),
      starting_equity: start,
      total_pnl: totalPnl,
      total_pnl_pct: start ? round((totalPnl / start) * 100.0, 4) : 0.0,
      unrealized_pnl: unrealized,
      realized_pnl: round(this.realizedPnl, 2),
      net_exposure: round(netExposure, 2),
      positions_count: this.positions.size,
      win_rate: this.decisions.winRate,
      sharpe: this.sharpe(),
      max_drawdown_pct: this.maxDrawdownPct(),
      equity_curve: [...this.equityCurve],
    };
  }

  getPositions(): Position[] {
    this.markPositions();
    return [...this.positions.values()];
  }

  getOrders(): Order[] {
    return [...this.orders].reverse(); // newest-first
  }

  getAccounts(): Account[] {
    this.recomputeAccount();
    return [this.account];
  }

  getInstruments(): Instrument[] {
    return [...this.sims.values()].map((s) => s.instrument);
  }

  getBars(instrument: string, count = 300): Bar[] {
    const sim = this.sims.get(instrument);
    if (!sim) return [];
    const bars = sim.allBars();
    return bars.slice(-Math.max(0, count));
  }

  getAiStatus(): AITraderStatus {
    const uptime = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0.0;
    return {
      state: this.aiState,
      mode: MODE,
      strategy_name: STRATEGY_NAME,
      last_run: this.aiLastRun,
      uptime_s: round(uptime, 1),
      decisions_today: this.decisions.decisionsToday,
      win_rate: this.decisions.winRate,
      enabled: this.aiEnabled,
    };
  }

  getAiDecisions(limit = 100): AIDecision[] {
    return this.decisions.list(limit);
  }

  aiControl(action: "pause" | "resume"): AITraderStatus {
    if (action === "pause") {
      this.aiEnabled = false;
      this.setAiState("paused");
    } else if (action === "resume") {
      this.aiEnabled = true;
      this.setAiState("idle");
    }
    return this.getAiStatus();
  }
}

/** Process-wide singleton — shared by `mockApi` and `mockSocket`. */
export const simulator = new DemoSimulator();
