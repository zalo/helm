/**
 * Typed REST client for the Helm backend. All paths are relative — the Vite dev
 * server proxies `/api` to the backend, and in production the frontend is served
 * from the same origin.
 */

import type {
  Account,
  AgentChatMessage,
  AIDecision,
  AITraderStatus,
  Bar,
  FeedItem,
  FeedSource,
  HealthResponse,
  Instrument,
  OEmbedResponse,
  Order,
  PortfolioSnapshot,
  Position,
} from "./types";
import { mockApi } from "./mock";

const BASE = "/api";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${res.statusText} — ${body}`.trim());
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
}

const realApi = {
  health: () => request<HealthResponse>("/health"),

  // --- trading ---
  portfolio: () => request<PortfolioSnapshot>("/trading/portfolio"),
  positions: () => request<Position[]>("/trading/positions"),
  orders: () => request<Order[]>("/trading/orders"),
  accounts: () => request<Account[]>("/trading/account"),
  instruments: () => request<Instrument[]>("/trading/instruments"),
  bars: (instrument: string, count = 300) =>
    request<Bar[]>(`/trading/bars${qs({ instrument, count })}`),

  // --- ai trader ---
  aiStatus: () => request<AITraderStatus>("/ai/status"),
  aiDecisions: (limit = 100) => request<AIDecision[]>(`/ai/decisions${qs({ limit })}`),
  aiControl: (action: "pause" | "resume") =>
    request<AITraderStatus>("/ai/control", {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  // --- agent (helm-agent CLI bridge) ---
  agentWake: (message = "", data: Record<string, unknown> = {}) =>
    request<{ woken: boolean; payload: Record<string, unknown> }>("/agent/wake", {
      method: "POST",
      body: JSON.stringify({ message, source: "webui", data }),
    }),
  agentChat: (limit = 500) =>
    request<{ count: number; messages: AgentChatMessage[] }>(
      `/agent/chat${qs({ limit })}`,
    ),

  // --- exotic feeds ---
  feedSources: () => request<FeedSource[]>("/feeds/sources"),
  feed: (sourceId: string, params: { limit?: number; query?: string } = {}) =>
    request<FeedItem[]>(`/feeds/${encodeURIComponent(sourceId)}${qs(params)}`),
  oembed: (url: string) => request<OEmbedResponse>(`/feeds/oembed${qs({ url })}`),
};

/**
 * In a `VITE_DEMO=1` build there is no backend — swap in the in-process
 * simulator-backed mock. Consumers import `api` unchanged either way.
 */
export const api = import.meta.env.VITE_DEMO === "1" ? mockApi : realApi;

export { ApiError };
