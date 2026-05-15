/**
 * Internal helpers shared across the trading widgets.
 */
import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import type { ColorType } from "lightweight-charts";

/** Dark chart theme — Abyssal Terminal palette. */
export const chartTheme = {
  layout: {
    background: { type: "solid" as ColorType.Solid, color: "#06121f" },
    textColor: "#6d8daa",
    fontFamily: "JetBrains Mono, IBM Plex Mono, ui-monospace, monospace",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: "#0b1a2a" },
    horzLines: { color: "#0b1a2a" },
  },
  rightPriceScale: { borderColor: "#152a42" },
  timeScale: { borderColor: "#152a42", timeVisible: true, secondsVisible: false },
  crosshair: {
    vertLine: { color: "#1e3d5e", labelBackgroundColor: "#0b1a2a" },
    horzLine: { color: "#1e3d5e", labelBackgroundColor: "#0b1a2a" },
  },
} as const;

export const chartColors = {
  up:     "#20d47c",
  down:   "#f0495a",
  accent: "#06d1f3",
  volume: "rgba(6,209,243,0.18)",
} as const;

/** UNIX seconds for a lightweight-charts intraday `time` field. */
export function tsToSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function WidgetState({
  icon,
  label,
  spin,
}: {
  icon: ReactNode;
  label: string;
  spin?: boolean;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-fg-faint">
      <span className={spin ? "animate-spin text-accent" : undefined}>{icon}</span>
      <span className="text-xs">{label}</span>
    </div>
  );
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <WidgetState icon={<Loader2 size={18} />} label={label} spin />
);

export const Empty = ({ label = "No data" }: { label?: string }) => (
  <WidgetState icon={<Inbox size={18} />} label={label} />
);

export const ErrorState = ({ label = "Failed to load" }: { label?: string }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-loss">
    <AlertTriangle size={18} />
    <span className="text-xs">{label}</span>
  </div>
);
