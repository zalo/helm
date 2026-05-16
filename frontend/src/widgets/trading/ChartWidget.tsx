/**
 * ChartWidget — tabbed canvas for one instrument.
 *
 *  Bars       : live 1-min OHLCV from the Nautilus cache (+ /ws bar events)
 *  Backtests  : list saved backtest results; clicking a row charts its
 *               equity curve and lists the most recent trades.
 *  Risk       : list saved risk analyses; clicking a row shows exposure
 *               weights + scenario P&L.
 *
 * Tab + selected backtest/risk id are persisted in the widget's config
 * (which survives reloads as part of the dashboard layout).
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { ArrowLeft, BarChart3, FlaskConical, ShieldAlert } from "lucide-react";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { Bar, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { cn } from "@/lib/cn";
import { chartColors, chartTheme, tsToSec } from "./_shared";
import { Empty, ErrorState, Loading } from "./_shared";

type ChartTab = "bars" | "backtests" | "risk";

export interface ChartConfig {
  instrument?: string;
  tab?: ChartTab;
  backtestId?: string;
  riskId?: string;
  [key: string]: unknown;
}

// ============================================================================
// Bars tab — pre-existing live chart
// ============================================================================

function BarsTab({ active }: { active: string }) {
  const bars = useQuery({
    queryKey: ["bars", active],
    queryFn: () => api.bars(active),
    enabled: !!active,
  });
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      ...chartTheme, width: host.clientWidth, height: host.clientHeight,
    });
    const candle = chart.addCandlestickSeries({
      upColor: chartColors.up, downColor: chartColors.down,
      borderUpColor: chartColors.up, borderDownColor: chartColors.down,
      wickUpColor: chartColors.up, wickDownColor: chartColors.down,
    });
    const vol = chart.addHistogramSeries({
      color: chartColors.volume, priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);
    return () => {
      ro.disconnect(); chart.remove();
      chartRef.current = null; candleRef.current = null; volRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candle = candleRef.current; const vol = volRef.current;
    if (!candle || !vol || !bars.data) return;
    const candleData: CandlestickData[] = bars.data.map((b) => ({
      time: tsToSec(b.ts) as UTCTimestamp,
      open: b.open, high: b.high, low: b.low, close: b.close,
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

  useEffect(() => {
    if (!active) return;
    return helmSocket.on("bar", (e: WsEvent) => {
      const b = e.payload as Bar;
      if (b.instrument !== active) return;
      const time = tsToSec(b.ts) as UTCTimestamp;
      candleRef.current?.update({ time, open: b.open, high: b.high, low: b.low, close: b.close });
      volRef.current?.update({
        time, value: b.volume,
        color: b.close >= b.open ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)",
      });
    });
  }, [active]);

  const loading = !!active && bars.isLoading;
  const error = bars.isError;
  const empty = !loading && !error && (!active || bars.data?.length === 0);

  return (
    <div className="relative h-full">
      {loading && <Loading />}
      {error && <ErrorState label="Chart data unavailable" />}
      {empty && <Empty label="No bars for this instrument" />}
      <div ref={hostRef}
        className={cn("absolute inset-0", (loading || error || empty) && "invisible")} />
    </div>
  );
}

// ============================================================================
// Backtests tab
// ============================================================================

function EquityChart({ points }: { points: { ts: string; equity: number }[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      ...chartTheme, width: host.clientWidth, height: host.clientHeight,
    });
    const line = chart.addLineSeries({ color: chartColors.up, lineWidth: 2 });
    const data: LineData[] = points.map((p) => ({
      time: tsToSec(p.ts) as UTCTimestamp, value: p.equity,
    }));
    line.setData(data);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);
    return () => { ro.disconnect(); chart.remove(); };
  }, [points]);
  return <div ref={hostRef} className="absolute inset-0" />;
}

function BacktestsTab({
  selectedId, onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const list = useQuery({ queryKey: ["backtests"], queryFn: api.backtests });
  const detail = useQuery({
    queryKey: ["backtest", selectedId],
    queryFn: () => api.backtest(selectedId!),
    enabled: !!selectedId,
  });

  if (selectedId && detail.data) {
    const r = detail.data;
    const ret = r.total_return_pct;
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
          <button onClick={() => onSelect(null)} className="btn h-6 px-1.5 text-2xs">
            <ArrowLeft className="h-3 w-3" /> back
          </button>
          <span className="truncate text-xs font-semibold text-fg">{r.name}</span>
          <span className={cn("ml-auto chip text-2xs",
            ret >= 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>
            {ret >= 0 ? "+" : ""}{ret.toFixed(2)}%
          </span>
        </div>
        <div className="grid flex-shrink-0 grid-cols-4 gap-2 border-b border-border px-2.5 py-2 text-2xs">
          <Stat label="Period" value={`${r.start.slice(0,10)} → ${r.end.slice(0,10)}`} />
          <Stat label="Final equity" value={`$${r.final_equity.toLocaleString()}`} />
          <Stat label="Sharpe" value={r.sharpe?.toFixed(2) ?? "—"} />
          <Stat label="Max DD" value={r.max_drawdown_pct != null ? `${r.max_drawdown_pct.toFixed(2)}%` : "—"} />
        </div>
        <div className="relative flex-1 border-b border-border">
          <EquityChart points={r.equity_curve} />
        </div>
        <div className="flex-shrink-0 max-h-32 overflow-y-auto px-2.5 py-1.5 text-2xs">
          <div className="mb-1 text-fg-faint">Last {Math.min(r.trades.length, 6)} of {r.trades.length} trades</div>
          {r.trades.slice(-6).reverse().map((t, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className="num text-fg-muted">{t.ts.slice(5,16).replace("T", " ")}</span>
              <span className="num font-semibold text-fg">{t.instrument.split(".")[0]}</span>
              <span className={cn("font-semibold", t.side === "BUY" ? "text-gain" : "text-loss")}>
                {t.side}
              </span>
              <span className="num text-fg-muted">{t.quantity}@{t.price}</span>
              {t.pnl != null && (
                <span className={cn("num ml-auto", t.pnl >= 0 ? "text-gain" : "text-loss")}>
                  {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (list.isLoading) return <Loading label="Loading backtests…" />;
  if (list.isError) return <ErrorState label="Backtests unavailable" />;
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return <Empty label="No saved backtests. Drop a JSON in backend/helm/data_seed/backtests/ to add one." />;
  }
  return (
    <div className="scroll-y h-full">
      <div className="flex flex-col gap-1.5 p-2">
        {rows.map((b) => (
          <button key={b.id} onClick={() => onSelect(b.id)}
            className="flex flex-col items-stretch gap-1 rounded-md border border-border bg-bg-1 px-2.5 py-2 text-left hover:border-border-strong hover:bg-bg-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-fg">{b.name}</span>
              <span className={cn("ml-auto chip text-2xs",
                b.total_return_pct >= 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>
                {b.total_return_pct >= 0 ? "+" : ""}{b.total_return_pct.toFixed(2)}%
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-faint">
              <span className="num">{b.start.slice(0,10)} → {b.end.slice(0,10)}</span>
              <span>{b.instruments.join(", ")}</span>
              <span className="num">Sharpe {b.sharpe?.toFixed(2) ?? "—"}</span>
              <span className="num">DD {b.max_drawdown_pct != null ? `${b.max_drawdown_pct.toFixed(1)}%` : "—"}</span>
              <span className="num">{b.trades_count} trades</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Risk tab
// ============================================================================

function RiskTab({
  selectedId, onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const list = useQuery({ queryKey: ["risk"], queryFn: api.riskAnalyses });
  const detail = useQuery({
    queryKey: ["risk", selectedId],
    queryFn: () => api.riskAnalysis(selectedId!),
    enabled: !!selectedId,
  });

  if (selectedId && detail.data) {
    const r = detail.data;
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
          <button onClick={() => onSelect(null)} className="btn h-6 px-1.5 text-2xs">
            <ArrowLeft className="h-3 w-3" /> back
          </button>
          <span className="truncate text-xs font-semibold text-fg">{r.name}</span>
        </div>
        <div className="grid flex-shrink-0 grid-cols-4 gap-2 border-b border-border px-2.5 py-2 text-2xs">
          <Stat label="As of" value={r.ts.slice(0,16).replace("T", " ")} />
          <Stat label="Equity" value={`$${r.portfolio_equity.toLocaleString()}`} />
          <Stat label="Gross exp" value={`$${r.gross_exposure.toLocaleString()}`} />
          <Stat label="VaR(95)" value={r.var_95 != null ? `$${r.var_95.toLocaleString()}` : "—"} />
        </div>
        <div className="scroll-y flex-1 px-2.5 py-2">
          <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-fg-faint">Exposures</div>
          <div className="flex flex-col gap-1">
            {r.exposures.map((e) => (
              <div key={e.instrument} className="flex items-center gap-2 rounded bg-bg-2 px-2 py-1 text-2xs">
                <span className="num font-semibold text-fg">{e.instrument.split(".")[0]}</span>
                <span className="num text-fg-muted">{e.quantity} @ ${e.market_value.toLocaleString()}</span>
                <span className="num ml-auto text-fg-muted">w={(e.weight * 100).toFixed(2)}%</span>
                {e.beta != null && <span className="num text-fg-muted">β={e.beta.toFixed(2)}</span>}
              </div>
            ))}
          </div>
          <div className="mb-1 mt-3 text-2xs font-semibold uppercase tracking-wider text-fg-faint">Scenarios</div>
          <div className="flex flex-col gap-1">
            {r.scenarios.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-bg-2 px-2 py-1 text-2xs">
                <span className="flex-1 text-fg">{s.name}</span>
                <span className={cn("num font-semibold",
                  s.pnl_pct >= 0 ? "text-gain" : "text-loss")}>
                  {s.pnl_pct >= 0 ? "+" : ""}{s.pnl_pct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
          {r.notes && (
            <div className="mt-3 rounded border border-border bg-bg-1 px-2 py-1.5 text-2xs text-fg-muted">
              {r.notes}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (list.isLoading) return <Loading label="Loading risk analyses…" />;
  if (list.isError) return <ErrorState label="Risk analyses unavailable" />;
  const rows = list.data ?? [];
  if (rows.length === 0) {
    return <Empty label="No saved risk analyses. Drop a JSON in backend/helm/data_seed/risk/." />;
  }
  return (
    <div className="scroll-y h-full">
      <div className="flex flex-col gap-1.5 p-2">
        {rows.map((r) => (
          <button key={r.id} onClick={() => onSelect(r.id)}
            className="flex flex-col items-stretch gap-1 rounded-md border border-border bg-bg-1 px-2.5 py-2 text-left hover:border-border-strong hover:bg-bg-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold text-fg">{r.name}</span>
              <span className="ml-auto chip bg-bg-2 text-2xs text-fg-muted">{r.ts.slice(0,10)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-fg-faint">
              <span className="num">eq ${r.portfolio_equity.toLocaleString()}</span>
              <span className="num">gross ${r.gross_exposure.toLocaleString()}</span>
              <span className="num">net ${r.net_exposure.toLocaleString()}</span>
              {r.var_95 != null && <span className="num">VaR ${r.var_95.toLocaleString()}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Shared
// ============================================================================

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-2xs text-fg-faint">{label}</span>
      <span className="num text-xs font-semibold text-fg">{value}</span>
    </div>
  );
}

// ============================================================================
// Top-level
// ============================================================================

export default function ChartWidget({ config, setConfig }: WidgetProps<ChartConfig>) {
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: api.instruments });
  const active = config.instrument || instruments.data?.[0]?.id || "";
  const tab: ChartTab = config.tab ?? "bars";
  const setTab = (t: ChartTab) => setConfig({ tab: t });

  const setBacktest = (id: string | null) => setConfig({ backtestId: id ?? undefined });
  const setRisk = (id: string | null) => setConfig({ riskId: id ?? undefined });

  return (
    <div className="flex h-full w-full flex-col">
      {/* Tabs */}
      <div className="flex flex-shrink-0 items-center border-b border-border bg-bg-1">
        {([
          { id: "bars",      label: "Bars",      icon: BarChart3 },
          { id: "backtests", label: "Backtests", icon: FlaskConical },
          { id: "risk",      label: "Risk",      icon: ShieldAlert },
        ] as const).map((t) => {
          const Icon = t.icon;
          const activeTab = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors",
                activeTab
                  ? "border-b-2 border-accent text-fg"
                  : "border-b-2 border-transparent text-fg-muted hover:text-fg",
              )}>
              <Icon size={11} />
              {t.label}
            </button>
          );
        })}

        {/* Bars-only: instrument picker on the right */}
        {tab === "bars" && (
          <div className="ml-auto flex items-center gap-2 px-2.5 py-1">
            <select
              value={active}
              onChange={(ev) => setConfig({ instrument: ev.target.value })}
              className="num rounded border border-border bg-bg-2 px-1.5 py-0.5 text-xs text-fg
                focus:border-accent focus:outline-none"
            >
              {instruments.data?.map((i) => (
                <option key={i.id} value={i.id}>{i.symbol} · {i.venue}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "bars" && <BarsTab active={active} />}
        {tab === "backtests" && (
          <BacktestsTab selectedId={config.backtestId ?? null} onSelect={setBacktest} />
        )}
        {tab === "risk" && (
          <RiskTab selectedId={config.riskId ?? null} onSelect={setRisk} />
        )}
      </div>
    </div>
  );
}
