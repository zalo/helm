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
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-bg-2 px-2.5 py-2">
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

  return (
    <div className="scroll-y panel-pad flex flex-col gap-2.5">
      {/* Headline equity */}
      <div className="rounded-md border border-border bg-bg-2 p-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-faint">
          Total Equity
        </span>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span className="num text-2xl font-bold tabular-nums text-fg">{money(p.equity)}</span>
          <span className={cn("num text-sm font-semibold", pnlColor(p.total_pnl))}>
            {arrow(p.total_pnl)}&nbsp;{signedMoney(p.total_pnl)} ({pct(p.total_pnl_pct)})
          </span>
        </div>
        <span className="mt-1 block text-2xs text-fg-faint">
          from {money(p.starting_equity)} starting · {p.currency}
        </span>
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
        <StatCard label="Net Exposure"   value={money(p.net_exposure)} />
        <StatCard label="Open Positions" value={num(p.positions_count, 0)} />
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
