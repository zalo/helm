/**
 * Demo-mode API + WebSocket shims. When the frontend is built with
 * `VITE_DEMO=1`, `client.ts` and `ws.ts` export these instead of the real
 * implementations — everything is driven by the in-process `DemoSimulator`.
 */

import type {
  Account,
  AIDecision,
  AITraderStatus,
  Bar,
  HealthResponse,
  Instrument,
  Order,
  PortfolioSnapshot,
  Position,
  WsEvent,
  WsEventType,
} from "../types";
import type { WsStatus } from "../ws";
import { simulator } from "./simulator";
import { getFeed, getFeedSources, getOembed } from "./feeds";

/** Resolve a value after a small delay, mirroring real network latency. */
function later<T>(value: T, ms = 80): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// --- mockApi: same shape/signature as the real `api` -------------------------
export const mockApi = {
  health: (): Promise<HealthResponse> =>
    later({
      status: "ok",
      version: "0.1.0-demo",
      mode: "demo",
      nautilus_available: false,
      openbb_available: false,
      engine_running: true,
    }),

  // --- trading ---
  portfolio: (): Promise<PortfolioSnapshot> => later(simulator.getPortfolio()),
  positions: (): Promise<Position[]> => later(simulator.getPositions()),
  orders: (): Promise<Order[]> => later(simulator.getOrders()),
  accounts: (): Promise<Account[]> => later(simulator.getAccounts()),
  instruments: (): Promise<Instrument[]> => later(simulator.getInstruments()),
  bars: (instrument: string, count = 300): Promise<Bar[]> =>
    later(simulator.getBars(instrument, count)),

  // --- ai trader ---
  aiStatus: (): Promise<AITraderStatus> => later(simulator.getAiStatus()),
  aiDecisions: (limit = 100): Promise<AIDecision[]> =>
    later(simulator.getAiDecisions(limit)),
  aiControl: (action: "pause" | "resume"): Promise<AITraderStatus> =>
    later(simulator.aiControl(action)),

  // --- agent (no-op in demo: there's no live CLI to wake) ---
  agentWake: async (message = "", _data: Record<string, unknown> = {}) => ({
    woken: true,
    payload: { message, source: "webui", demo: true },
  }),
  agentChat: async (_limit = 500) => ({ count: 0, messages: [] }),
  backtests: async () => [],
  backtest: async (_id: string) => { throw new Error("backtests unavailable in demo"); },
  riskAnalyses: async () => [],
  riskAnalysis: async (_id: string) => { throw new Error("risk unavailable in demo"); },
  strategies: async () => [],

  // --- exotic feeds ---
  feedSources: () => getFeedSources(),
  feed: (sourceId: string, params: { limit?: number; query?: string } = {}) =>
    getFeed(sourceId, params),
  oembed: (url: string) => getOembed(url),
};

// --- mockSocket: same public interface as `helmSocket` -----------------------
type Listener = (event: WsEvent) => void;
type StatusListener = (status: WsStatus) => void;

class MockSocket {
  private status: WsStatus = "closed";
  private started = false;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Map<WsEventType | "*", Set<Listener>>();
  private readonly statusListeners = new Set<StatusListener>();

  connect(): void {
    if (this.status === "open" || this.status === "connecting") return;
    this.setStatus("connecting");

    if (!this.started) {
      simulator.start();
      this.started = true;
    }
    // Pipe simulator events into the same dispatch fan-out the real socket uses.
    this.unsubscribe = simulator.onEvent((event) => this.dispatch(event));

    this.setStatus("open");
    // Replay a snapshot burst so widgets populate instantly — mirrors `/ws`.
    this.sendSnapshot();
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setStatus("closed");
  }

  private sendSnapshot(): void {
    const now = () => new Date().toISOString();
    const burst: WsEvent[] = [
      { type: "portfolio", ts: now(), payload: simulator.getPortfolio() },
      { type: "ai_status", ts: now(), payload: simulator.getAiStatus() },
      ...simulator.getAccounts().map(
        (a): WsEvent => ({ type: "account", ts: now(), payload: a }),
      ),
      ...simulator.getPositions().map(
        (p): WsEvent => ({ type: "position", ts: now(), payload: p }),
      ),
      ...simulator
        .getOrders()
        .slice(0, 25)
        .map((o): WsEvent => ({ type: "order", ts: now(), payload: o })),
      ...simulator
        .getAiDecisions(15)
        .map((d): WsEvent => ({ type: "ai_decision", ts: now(), payload: d })),
    ];
    for (const event of burst) this.dispatch(event);
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private dispatch(event: WsEvent): void {
    this.listeners.get(event.type)?.forEach((l) => l(event));
    this.listeners.get("*")?.forEach((l) => l(event));
  }

  on(type: WsEventType | "*", listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  get currentStatus(): WsStatus {
    return this.status;
  }
}

export const mockSocket = new MockSocket();
