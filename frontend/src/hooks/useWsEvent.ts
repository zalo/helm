/**
 * React hooks over the `helmSocket` singleton. Widgets and the shell use these
 * for live data instead of touching the socket directly.
 */

import { useEffect, useRef, useState } from "react";
import { helmSocket, type WsStatus } from "@/api/ws";
import type { WsEvent, WsEventType } from "@/api/types";

/**
 * Subscribe to one WS event type (or "*" for all). The handler is kept in a ref
 * so callers can pass an inline closure without re-subscribing every render.
 * The payload is delivered typed — `T` is the `payload` shape for that event.
 */
export function useWsEvent<T = unknown>(
  type: WsEventType | "*",
  handler: (payload: T, event: WsEvent<T>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return helmSocket.on(type, (event) => {
      handlerRef.current(event.payload as T, event as WsEvent<T>);
    });
  }, [type]);
}

/** Live WebSocket connection status, re-rendering on change. */
export function useWsStatus(): WsStatus {
  const [status, setStatus] = useState<WsStatus>(helmSocket.currentStatus);
  useEffect(() => helmSocket.onStatus(setStatus), []);
  return status;
}
