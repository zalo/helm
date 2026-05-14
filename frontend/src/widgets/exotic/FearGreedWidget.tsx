import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import type { WidgetProps } from "../types";
import type { FeedItem } from "@/api/types";
import { relativeTime } from "@/lib/format";
import { feed, WidgetShell, Loading, Empty, ErrorState } from "./_shared";

const SOURCE = "fear-greed";
const REFRESH_MS = 300_000;

/** Extract the 0–100 index value from a feed item's meta. */
function readValue(item: FeedItem): number | null {
  const v = item.meta?.value ?? item.meta?.index ?? item.meta?.score;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function readClassification(item: FeedItem): string {
  const c = item.meta?.classification ?? item.meta?.label ?? item.meta?.value_classification;
  return typeof c === "string" && c ? c : "";
}

/** Color ramp red → amber → green across 0–100. */
function valueColor(v: number): string {
  if (v < 25) return "#f85149"; // extreme fear
  if (v < 45) return "#d29922"; // fear
  if (v < 55) return "#8b949e"; // neutral
  if (v < 75) return "#3fb950"; // greed
  return "#2ea043"; // extreme greed
}

/** Semicircular gauge — 180° arc, needle at `value`/100. */
function Dial({ value, color }: { value: number; color: string }) {
  const R = 80;
  const CX = 100;
  const CY = 100;
  const angle = Math.PI * (1 - value / 100); // 180° (left) → 0° (right)
  const needleX = CX + R * 0.92 * Math.cos(angle);
  const needleY = CY - R * 0.92 * Math.sin(angle);
  // arc length of a 180° semicircle = π·R; dash to fill proportionally
  const arcLen = Math.PI * R;

  return (
    <svg viewBox="0 0 200 116" className="w-full max-w-[260px]">
      <defs>
        <linearGradient id="fg-ramp" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f85149" />
          <stop offset="35%" stopColor="#d29922" />
          <stop offset="50%" stopColor="#8b949e" />
          <stop offset="70%" stopColor="#3fb950" />
          <stop offset="100%" stopColor="#2ea043" />
        </linearGradient>
      </defs>
      {/* track */}
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
        fill="none"
        stroke="#21262d"
        strokeWidth="14"
        strokeLinecap="round"
      />
      {/* filled portion */}
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
        fill="none"
        stroke="url(#fg-ramp)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * arcLen} ${arcLen}`}
      />
      {/* needle */}
      <line
        x1={CX}
        y1={CY}
        x2={needleX}
        y2={needleY}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r="6" fill={color} />
      <circle cx={CX} cy={CY} r="6" fill="none" stroke="#0d1117" strokeWidth="2" />
    </svg>
  );
}

export function FearGreedWidget(_: WidgetProps) {
  const q = useQuery({
    queryKey: ["feed", SOURCE],
    queryFn: () => feed(SOURCE, { limit: 30 }),
    refetchInterval: REFRESH_MS,
  });

  if (q.isLoading) {
    return (
      <WidgetShell header={<Header />}>
        <Loading />
      </WidgetShell>
    );
  }
  if (q.isError) {
    return (
      <WidgetShell header={<Header />}>
        <ErrorState source="Fear & Greed index" onRetry={() => q.refetch()} />
      </WidgetShell>
    );
  }
  if (!q.data?.length) {
    return (
      <WidgetShell header={<Header />}>
        <Empty label="No index data" />
      </WidgetShell>
    );
  }

  // Items are one-per-day; first item = most recent.
  const series = q.data;
  const current = series[0];
  const value = readValue(current);
  const classification = readClassification(current);
  const color = value != null ? valueColor(value) : "#8b949e";

  // 30-day strip, oldest → newest (reverse since feed is newest-first).
  const strip = series.slice(0, 30).reverse();
  const stripMax = 100;

  return (
    <WidgetShell header={<Header />}>
      <div className="flex flex-col items-center gap-3 panel-pad">
        <div className="relative flex w-full flex-col items-center">
          <Dial value={value ?? 0} color={color} />
          <div className="-mt-7 flex flex-col items-center">
            <span className="num text-4xl font-bold leading-none" style={{ color }}>
              {value ?? "—"}
            </span>
            {classification && (
              <span
                className="mt-1 text-xs font-semibold uppercase tracking-wide"
                style={{ color }}
              >
                {classification}
              </span>
            )}
          </div>
        </div>

        {current.published && (
          <span className="text-2xs text-fg-faint">
            updated <span className="num">{relativeTime(current.published)}</span>
          </span>
        )}

        {/* 30-day history strip */}
        <div className="w-full">
          <div className="mb-1 flex items-center justify-between text-2xs text-fg-faint">
            <span>30-day history</span>
            <span className="num">
              {strip.length} reading{strip.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex h-16 items-end gap-px rounded border border-border bg-bg-1 p-1">
            {strip.map((item) => {
              const v = readValue(item);
              const h = v != null ? Math.max(4, (v / stripMax) * 100) : 4;
              return (
                <div
                  key={item.id}
                  className="flex-1 rounded-sm transition-all"
                  style={{
                    height: `${h}%`,
                    backgroundColor: v != null ? valueColor(v) : "#30363d",
                  }}
                  title={
                    v != null
                      ? `${v} · ${readClassification(item) || "—"} · ${relativeTime(item.published)}`
                      : "no data"
                  }
                />
              );
            })}
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

function Header() {
  return (
    <>
      <Gauge size={14} className="text-accent" />
      <span className="text-xs font-semibold">Crypto Fear &amp; Greed</span>
    </>
  );
}
