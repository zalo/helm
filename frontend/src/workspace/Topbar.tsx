/**
 * Topbar — the app header. Bloomberg-dense: AI trader status, WS link health,
 * portfolio equity + day P&L, pause/resume control, add-widget + reset-layout.
 *
 * Server state via react-query, kept live by patching the query cache from WS
 * `ai_status` / `portfolio` events.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, LayoutGrid, Pause, Play } from "lucide-react";
import { api } from "@/api/client";
import type { AITraderStatus, PortfolioSnapshot } from "@/api/types";
import { money, pct, signedMoney } from "@/lib/format";
import { useWsEvent, useWsStatus } from "@/hooks/useWsEvent";
import { Pill, StatDelta } from "@/components/ui";
import { useWorkspaceController } from "./Workspace";
import { WidgetCatalog } from "./WidgetCatalog";

// --- AI status pill --------------------------------------------------------

const AI_TONE = {
  idle: "neutral",
  analyzing: "accent",
  executing: "gain",
  paused: "warn",
} as const;

function AiStatus() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ai", "status"],
    queryFn: api.aiStatus,
    refetchInterval: 15_000,
  });

  // Live patch from the WS stream.
  useWsEvent<AITraderStatus>("ai_status", (payload) => {
    qc.setQueryData(["ai", "status"], payload);
  });

  const control = useMutation({
    mutationFn: (action: "pause" | "resume") => api.aiControl(action),
    onSuccess: (next) => qc.setQueryData(["ai", "status"], next),
  });

  const state = data?.state ?? "idle";
  const tone = AI_TONE[state];
  const paused = state === "paused" || data?.enabled === false;

  return (
    <div className="flex items-center gap-2">
      <Pill tone={tone} dot pulse={state === "analyzing" || state === "executing"}>
        AI {state}
      </Pill>
      {data && (
        <>
          <Pill tone="neutral">{data.mode}</Pill>
          <span className="hidden text-2xs text-fg-faint lg:inline">
            {data.strategy_name}
          </span>
          <span className="hidden items-center gap-2 text-2xs text-fg-muted xl:flex">
            <span className="num">{data.decisions_today} today</span>
            <span className="num">{pct(data.win_rate * 100, 0)} win</span>
          </span>
        </>
      )}
      <button
        type="button"
        className="btn h-7 px-2 text-xs"
        disabled={control.isPending || !data}
        onClick={() => control.mutate(paused ? "resume" : "pause")}
        title={paused ? "Resume AI trader" : "Pause AI trader"}
      >
        {paused ? (
          <>
            <Play className="h-3.5 w-3.5" /> Resume
          </>
        ) : (
          <>
            <Pause className="h-3.5 w-3.5" /> Pause
          </>
        )}
      </button>
    </div>
  );
}

// --- portfolio summary -----------------------------------------------------

function PortfolioSummary() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["trading", "portfolio"],
    queryFn: api.portfolio,
    refetchInterval: 10_000,
  });

  useWsEvent<PortfolioSnapshot>("portfolio", (payload) => {
    qc.setQueryData(["trading", "portfolio"], payload);
  });

  if (!data) {
    return <div className="num text-sm text-fg-faint">— equity</div>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end leading-none">
        <span className="text-2xs text-fg-faint">Equity</span>
        <span className="num text-sm font-semibold text-fg">
          {money(data.equity)}
        </span>
      </div>
      <div className="h-7 w-px bg-border" />
      <div className="flex flex-col items-end leading-none">
        <span className="text-2xs text-fg-faint">Day P&amp;L</span>
        <span className="text-sm font-semibold">
          <StatDelta value={data.total_pnl} format={signedMoney} />
        </span>
      </div>
      <Pill tone={data.total_pnl_pct >= 0 ? "gain" : "loss"}>
        {pct(data.total_pnl_pct)}
      </Pill>
    </div>
  );
}

// --- connection pill -------------------------------------------------------

const WS_TONE = { connecting: "warn", open: "gain", closed: "loss" } as const;
const WS_LABEL = { connecting: "Connecting", open: "Live", closed: "Offline" } as const;

function ConnectionPill() {
  const status = useWsStatus();
  return (
    <Pill tone={WS_TONE[status]} dot pulse={status === "connecting"}>
      {WS_LABEL[status]}
    </Pill>
  );
}

// --- topbar ----------------------------------------------------------------

export function Topbar() {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const resetLayout = useWorkspaceController((s) => s.resetLayout);

  const onReset = useCallback(() => {
    if (window.confirm("Reset the workspace to the default layout? This clears all widget settings.")) {
      resetLayout();
    }
  }, [resetLayout]);

  return (
    <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border bg-bg-0 px-3">
      {/* wordmark */}
      <div className="flex items-center gap-2">
        <img src="/helm.svg" alt="Helm" className="h-5 w-5" />
        <span className="text-sm font-bold tracking-tight text-fg">Helm</span>
      </div>

      <div className="h-6 w-px bg-border" />
      <AiStatus />

      <div className="ml-auto flex items-center gap-3">
        <PortfolioSummary />
        <div className="h-6 w-px bg-border" />
        <ConnectionPill />
        <div className="h-6 w-px bg-border" />
        <button
          type="button"
          className="btn btn-accent h-7 px-2 text-xs"
          onClick={() => setCatalogOpen(true)}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Add Widget
        </button>
        <button
          type="button"
          className="btn h-7 px-2 text-xs"
          onClick={onReset}
          title="Reset workspace layout"
        >
          <Layers className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      <WidgetCatalog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </header>
  );
}
