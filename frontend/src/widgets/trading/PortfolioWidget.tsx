import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { PortfolioSnapshot, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { money, signedMoney, pct, num, pnlColor, arrow } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

function StatCard({
  label,
  value,
  className,
  accent = false,
}: {
  label: string;
  value: string;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-all duration-200",
        "border",
        accent
          ? "border-border-strong bg-bg-2/80"
          : "border-border bg-bg-2/40 hover:bg-bg-2/70 hover:border-border-strong",
      )}
    >
      <span className="text-2xs font-medium uppercase tracking-wider text-fg-faint">{label}</span>
      <span className={cn("num text-sm font-semibold", className)}>{value}</span>
    </div>
  );
}

export default function PortfolioWidget(_props: WidgetProps) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    return helmSocket.on("portfolio", (e: WsEvent) => {
      qc.setQueryData(["portfolio"], e.payload as PortfolioSnapshot);
    });
  }, [qc]);

  if (isLoading) return <Loading />;
  if (isError)   return <ErrorState label="Portfolio unavailable" />;
  if (!data)     return <Empty />;

  const p = data;
  const pnlPositive = p.total_pnl >= 0;

  return (
    <div className="scroll-y panel-pad flex flex-col gap-3">
      {/* Headline equity — gradient text, bold presence */}
      <div
        className="rounded-xl border border-border-strong p-4"
        style={{
          background: "linear-gradient(135deg, rgba(11,26,42,0.9) 0%, rgba(6,18,31,0.8) 100%)",
          boxShadow: pnlPositive
            ? "inset 0 1px 0 rgba(32,212,124,0.08), 0 0 24px rgba(32,212,124,0.04)"
            : "inset 0 1px 0 rgba(240,73,90,0.08), 0 0 24px rgba(240,73,90,0.04)",
        }}
      >
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-faint">
          Total Equity
        </span>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span
            className="num text-3xl font-bold tabular-nums"
            style={{
              background: pnlPositive
                ? "linear-gradient(135deg, #dde9f8 30%, #20d47c 100%)"
                : "linear-gradient(135deg, #dde9f8 30%, #f0495a 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {money(p.equity)}
          </span>
          <span className={cn("num text-base font-semibold", pnlColor(p.total_pnl))}>
            {arrow(p.total_pnl)}&nbsp;{signedMoney(p.total_pnl)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className={cn(
              "chip border font-semibold",
              pnlPositive
                ? "bg-gain/10 text-gain border-gain/25"
                : "bg-loss/10 text-loss border-loss/25",
            )}
          >
            {pct(p.total_pnl_pct)}
          </span>
          <span className="text-2xs text-fg-faint">
            from {money(p.starting_equity)} · {p.currency}
          </span>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard
          label="Unrealized P&L"
          value={signedMoney(p.unrealized_pnl)}
          className={pnlColor(p.unrealized_pnl)}
        />
        <StatCard
          label="Realized P&L"
          value={signedMoney(p.realized_pnl)}
          className={pnlColor(p.realized_pnl)}
        />
        <StatCard label="Net Exposure"    value={money(p.net_exposure)} />
        <StatCard label="Open Positions"  value={num(p.positions_count, 0)} />
        <StatCard
          label="Win Rate"
          value={pct(p.win_rate * 100, 1)}
          className={p.win_rate >= 0.5 ? "text-gain" : "text-loss"}
        />
        <StatCard
          label="Sharpe"
          value={num(p.sharpe, 2)}
          className={p.sharpe >= 1 ? "text-gain" : p.sharpe < 0 ? "text-loss" : "text-fg"}
        />
        <StatCard
          label="Max Drawdown"
          value={pct(-Math.abs(p.max_drawdown_pct), 1)}
          className="text-loss"
        />
        <StatCard
          label="As of"
          value={new Date(p.ts).toLocaleTimeString("en-US", { hour12: false })}
          className="text-fg-muted"
        />
      </div>
    </div>
  );
}
