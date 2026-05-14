import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type { PortfolioSnapshot, WsEvent } from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { money, signedMoney, pct, num, pnlColor, arrow } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

function Stat({
  label,
  value,
  className,
  hint,
}: {
  label: string;
  value: string;
  className?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border bg-bg-1 px-2 py-1.5">
      <span className="text-2xs uppercase tracking-wide text-fg-faint">{label}</span>
      <span className={cn("num text-sm", className)}>{value}</span>
      {hint && <span className="text-2xs text-fg-faint">{hint}</span>}
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
  if (isError) return <ErrorState label="Portfolio unavailable" />;
  if (!data) return <Empty />;

  const p = data;
  return (
    <div className="scroll-y panel-pad flex flex-col gap-2.5">
      {/* Headline */}
      <div className="flex flex-col gap-0.5">
        <span className="text-2xs uppercase tracking-wide text-fg-faint">Equity</span>
        <div className="flex items-baseline gap-2">
          <span className="num text-2xl font-semibold tabular-nums">{money(p.equity)}</span>
          <span className={cn("num text-sm", pnlColor(p.total_pnl))}>
            {arrow(p.total_pnl)} {signedMoney(p.total_pnl)} ({pct(p.total_pnl_pct)})
          </span>
        </div>
        <span className="text-2xs text-fg-faint">
          from {money(p.starting_equity)} starting · {p.currency}
        </span>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-1.5">
        <Stat
          label="Unrealized P&L"
          value={signedMoney(p.unrealized_pnl)}
          className={pnlColor(p.unrealized_pnl)}
        />
        <Stat
          label="Realized P&L"
          value={signedMoney(p.realized_pnl)}
          className={pnlColor(p.realized_pnl)}
        />
        <Stat label="Net Exposure" value={money(p.net_exposure)} />
        <Stat label="Open Positions" value={num(p.positions_count, 0)} />
        <Stat
          label="Win Rate"
          value={pct(p.win_rate * 100, 1)}
          className={p.win_rate >= 0.5 ? "text-gain" : "text-loss"}
        />
        <Stat
          label="Sharpe"
          value={num(p.sharpe, 2)}
          className={p.sharpe >= 1 ? "text-gain" : p.sharpe < 0 ? "text-loss" : "text-fg"}
        />
        <Stat
          label="Max Drawdown"
          value={pct(-Math.abs(p.max_drawdown_pct), 1)}
          className="text-loss"
        />
        <Stat label="As of" value={new Date(p.ts).toLocaleTimeString("en-US", { hour12: false })} />
      </div>
    </div>
  );
}
