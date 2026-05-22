import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type AreaData,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { PortfolioSnapshot, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { money, signedMoney, pct, pnlColor, arrow } from "@/lib/format";
import { cn } from "@/lib/cn";
import { chartTheme, chartColors, tsToSec } from "./_shared";
import { Loading, ErrorState, Empty } from "./_shared";

export default function PnLWidget(_props: WidgetProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: 30_000,
  });

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Build the chart once the host element is mounted.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      ...chartTheme,
      width: host.clientWidth,
      height: host.clientHeight,
      handleScale: false,
      handleScroll: false,
    });
    const series = chart.addAreaSeries({
      lineColor: chartColors.accent,
      topColor: "rgba(88,166,255,0.30)",
      bottomColor: "rgba(88,166,255,0.02)",
      lineWidth: 2,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Seed the series whenever the query resolves with a fresh curve.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) return;
    // Defensive dedup: lightweight-charts throws on duplicate or out-of-order
    // timestamps. The backend now dedups too, but keep the safety net here
    // so any future regression doesn't crash the whole pane.
    const seen = new Map<number, number>();
    for (const pt of data.equity_curve) {
      seen.set(tsToSec(pt.ts), pt.equity);  // last writer wins per second
    }
    const points: AreaData[] = [...seen.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
    series.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Extend the series live on portfolio events.
  useEffect(() => {
    return helmSocket.on("portfolio", (e: WsEvent) => {
      const snap = e.payload as PortfolioSnapshot;
      seriesRef.current?.update({
        time: tsToSec(snap.ts) as UTCTimestamp,
        value: snap.equity,
      });
    });
  }, []);

  const dayPnl = data ? data.equity - (data.equity_curve[0]?.equity ?? data.starting_equity) : 0;
  const dayBase = data?.equity_curve[0]?.equity ?? data?.starting_equity ?? 0;
  const dayPct = dayBase ? (dayPnl / dayBase) * 100 : 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Day P&L summary bar */}
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <span className="text-2xs uppercase tracking-wide text-fg-faint">Equity Curve</span>
        {data && (
          <div className="flex items-baseline gap-2">
            <span className="num text-sm font-semibold">{money(data.equity)}</span>
            <span className={cn("num text-xs", pnlColor(dayPnl))}>
              {arrow(dayPnl)} {signedMoney(dayPnl)} ({pct(dayPct)})
            </span>
          </div>
        )}
      </div>
      <div className="relative flex-1">
        {isLoading && <Loading />}
        {isError && <ErrorState label="Equity curve unavailable" />}
        {!isLoading && !isError && data && data.equity_curve.length === 0 && (
          <Empty label="No equity history" />
        )}
        <div
          ref={hostRef}
          className={cn(
            "absolute inset-0",
            (isLoading || isError) && "invisible",
          )}
        />
      </div>
    </div>
  );
}
