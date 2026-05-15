/**
 * Internal helpers shared across the trading widgets.
 */
import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import type { ColorType } from "lightweight-charts";

/** Dark chart theme — OpenBB flat dark palette. */
export const chartTheme = {
  layout: {
    background: { type: "solid" as ColorType.Solid, color: "#1b1b1f" },
    textColor: "#9a9aa2",
    fontFamily: "JetBrains Mono, IBM Plex Mono, ui-monospace, monospace",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: "rgba(51,51,55,0.4)" },
    horzLines: { color: "rgba(51,51,55,0.4)" },
  },
  rightPriceScale: { borderColor: "#323237" },
  timeScale: { borderColor: "#323237", timeVisible: true, secondsVisible: false },
  crosshair: {
    vertLine: { color: "#444448", labelBackgroundColor: "#212126" },
    horzLine: { color: "#444448", labelBackgroundColor: "#212126" },
  },
} as const;

export const chartColors = {
  up:     "#25c685",
  down:   "#f0455a",
  accent: "#ff8000",
  volume: "rgba(255,128,0,0.18)",
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
