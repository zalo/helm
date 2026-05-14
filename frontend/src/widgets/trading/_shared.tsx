/**
 * Internal helpers shared across the trading widgets. Kept self-contained
 * (no dependency on src/components/ui.tsx) so this bundle stays decoupled.
 */
import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import type { ColorType } from "lightweight-charts";

/** Dark chart theme — matches the Helm design tokens. */
export const chartTheme = {
  layout: {
    background: { type: "solid" as ColorType.Solid, color: "#0d1117" },
    textColor: "#8b949e",
    fontFamily: "JetBrains Mono, IBM Plex Mono, ui-monospace, monospace",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: "#21262d" },
    horzLines: { color: "#21262d" },
  },
  rightPriceScale: { borderColor: "#30363d" },
  timeScale: { borderColor: "#30363d", timeVisible: true, secondsVisible: false },
  crosshair: {
    vertLine: { color: "#444c56", labelBackgroundColor: "#21262d" },
    horzLine: { color: "#444c56", labelBackgroundColor: "#21262d" },
  },
} as const;

export const chartColors = {
  up: "#3fb950",
  down: "#f85149",
  accent: "#58a6ff",
  volume: "rgba(88,166,255,0.35)",
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
      <span className={spin ? "animate-spin" : undefined}>{icon}</span>
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
