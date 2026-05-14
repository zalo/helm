/**
 * WebSocket client for the Helm event stream (`/ws`).
 *
 * - Auto-reconnects with capped exponential backoff.
 * - Lets callers subscribe to a single `WsEventType` or all events (`"*"`).
 * - Exposes connection status so the UI can show a live/disconnected pill.
 */

import type { WsEvent, WsEventType } from "./types";

export type WsStatus = "connecting" | "open" | "closed";
type Listener = (event: WsEvent) => void;
type StatusListener = (status: WsStatus) => void;

const WS_URL = (() => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
})();

class HelmSocket {
  private ws: WebSocket | null = null;
  private status: WsStatus = "closed";
  private retries = 0;
  private reconnectTimer: number | null = null;
  private readonly listeners = new Map<WsEventType | "*", Set<Listener>>();
  private readonly statusListeners = new Set<StatusListener>();

  connect(): void {
    if (this.ws && (this.status === "open" || this.status === "connecting")) return;
    this.setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.setStatus("open");
    };
    ws.onmessage = (msg) => {
      let event: WsEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      this.dispatch(event);
    };
    ws.onclose = () => {
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  disconnect(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.retries, 15_000);
    this.retries += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private dispatch(event: WsEvent): void {
    this.listeners.get(event.type)?.forEach((l) => l(event));
    this.listeners.get("*")?.forEach((l) => l(event));
  }

  /** Subscribe to one event type, or "*" for all. Returns an unsubscribe fn. */
  on(type: WsEventType | "*", listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
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

/** Process-wide singleton — call `helmSocket.connect()` once in `App`. */
export const helmSocket = new HelmSocket();
