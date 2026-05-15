import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { Bar, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { cn } from "@/lib/cn";
import { chartTheme, chartColors, tsToSec } from "./_shared";
import { Loading, ErrorState, Empty } from "./_shared";

export interface ChartConfig {
  // Optional + index signature so ChartConfig stays structurally comparable to
  // the workspace's Record<string, unknown> config slot (WidgetProps is
  // invariant in C). Empty/missing instrument falls back to the first one.
  instrument?: string;
  [key: string]: unknown;
}

export default function ChartWidget({ config, setConfig }: WidgetProps<ChartConfig>) {
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: api.instruments });

  // Resolve the active instrument by ID: config wins, else first available.
  const active = config.instrument || instruments.data?.[0]?.id || "";

  const bars = useQuery({
    queryKey: ["bars", active],
    queryFn: () => api.bars(active),
    enabled: !!active,
  });

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Build chart once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      ...chartTheme,
      width: host.clientWidth,
      height: host.clientHeight,
    });
    const candle = chart.addCandlestickSeries({
      upColor: chartColors.up,
      downColor: chartColors.down,
      borderUpColor: chartColors.up,
      borderDownColor: chartColors.down,
      wickUpColor: chartColors.up,
      wickDownColor: chartColors.down,
    });
    const vol = chart.addHistogramSeries({
      color: chartColors.volume,
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    // Pin the volume histogram to the bottom 20% of the pane.
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  // Seed series whenever bars resolve.
  useEffect(() => {
    const candle = candleRef.current;
    const vol = volRef.current;
    if (!candle || !vol || !bars.data) return;
    const candleData: CandlestickData[] = bars.data.map((b) => ({
      time: tsToSec(b.ts) as UTCTimestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    const volData: HistogramData[] = bars.data.map((b) => ({
      time: tsToSec(b.ts) as UTCTimestamp,
      value: b.volume,
      color: b.close >= b.open ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)",
    }));
    candle.setData(candleData);
    vol.setData(volData);
    chartRef.current?.timeScale().fitContent();
  }, [bars.data]);

  // Live: append/update the last candle for the active instrument.
  useEffect(() => {
    if (!active) return;
    return helmSocket.on("bar", (e: WsEvent) => {
      const b = e.payload as Bar;
      if (b.instrument !== active) return;
      const time = tsToSec(b.ts) as UTCTimestamp;
      candleRef.current?.update({ time, open: b.open, high: b.high, low: b.low, close: b.close });
      volRef.current?.update({
        time,
        value: b.volume,
        color: b.close >= b.open ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)",
      });
    });
  }, [active]);

  const loading = instruments.isLoading || (!!active && bars.isLoading);
  const error = instruments.isError || bars.isError;
  const empty = !loading && !error && (!active || bars.data?.length === 0);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Instrument picker */}
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <select
          value={active}
          onChange={(ev) => setConfig({ instrument: ev.target.value })}
          className="num rounded border border-border bg-bg-2 px-1.5 py-0.5 text-xs text-fg
            focus:border-accent focus:outline-none"
        >
          {instruments.data?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol} · {i.venue}
            </option>
          ))}
        </select>
        <span className="text-2xs text-fg-faint">candlestick · {bars.data?.length ?? 0} bars</span>
      </div>
      <div className="relative flex-1">
        {loading && <Loading />}
        {error && <ErrorState label="Chart data unavailable" />}
        {empty && <Empty label="No bars for this instrument" />}
        <div
          ref={hostRef}
          className={cn("absolute inset-0", (loading || error || empty) && "invisible")}
        />
      </div>
    </div>
  );
}
