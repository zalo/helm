/**
 * Topbar — app header. Glass surface with ambient glow.
 * Condenses gracefully on mobile (isMobile prop hides workspace controls).
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

// --- AI status pill ----------------------------------------------------------

const AI_TONE = {
  idle:      "neutral",
  analyzing: "accent",
  executing: "gain",
  paused:    "warn",
} as const;

function AiStatus() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ai", "status"],
    queryFn: api.aiStatus,
    refetchInterval: 15_000,
  });

  useWsEvent<AITraderStatus>("ai_status", (payload) => {
    qc.setQueryData(["ai", "status"], payload);
  });

  const control = useMutation({
    mutationFn: (action: "pause" | "resume") => api.aiControl(action),
    onSuccess: (next) => qc.setQueryData(["ai", "status"], next),
  });

  const state   = data?.state ?? "idle";
  const tone    = AI_TONE[state];
  const paused  = state === "paused" || data?.enabled === false;
  const pulsing = state === "analyzing" || state === "executing";

  return (
    <div className="flex items-center gap-2">
      <Pill tone={tone} dot pulse={pulsing} glow={pulsing}>
        AI {state}
      </Pill>
      {data && (
        <>
          <Pill tone="neutral" className="hidden md:inline-flex">{data.mode}</Pill>
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
          <><Play className="h-3.5 w-3.5" /><span className="hidden sm:inline">Resume</span></>
        ) : (
          <><Pause className="h-3.5 w-3.5" /><span className="hidden sm:inline">Pause</span></>
        )}
      </button>
    </div>
  );
}

// --- Portfolio summary -------------------------------------------------------

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
        <span className="num text-sm font-semibold text-fg">{money(data.equity)}</span>
      </div>
      <div className="h-6 w-px bg-border" />
      <div className="hidden flex-col items-end leading-none sm:flex">
        <span className="text-2xs text-fg-faint">Day P&amp;L</span>
        <span className="text-sm font-semibold">
          <StatDelta value={data.total_pnl} format={signedMoney} />
        </span>
      </div>
      <Pill
        tone={data.total_pnl_pct >= 0 ? "gain" : "loss"}
        glow={Math.abs(data.total_pnl_pct) > 1}
      >
        {pct(data.total_pnl_pct)}
      </Pill>
    </div>
  );
}

// --- Connection pill ---------------------------------------------------------

const WS_TONE  = { connecting: "warn", open: "gain", closed: "loss" } as const;
const WS_LABEL = { connecting: "Connecting", open: "Live", closed: "Offline" } as const;

function ConnectionPill() {
  const status = useWsStatus();
  return (
    <Pill
      tone={WS_TONE[status]}
      dot
      pulse={status === "connecting"}
      glow={status === "open"}
    >
      {WS_LABEL[status]}
    </Pill>
  );
}

// --- Topbar ------------------------------------------------------------------

export function Topbar({ isMobile = false }: { isMobile?: boolean }) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const resetLayout = useWorkspaceController((s) => s.resetLayout);

  const onReset = useCallback(() => {
    if (window.confirm("Reset workspace to default layout? This clears all widget settings.")) {
      resetLayout();
    }
  }, [resetLayout]);

  return (
    <>
      {/* Topbar shell — glass surface with ambient border-bottom glow */}
      <header
        className="relative flex h-11 flex-shrink-0 items-center gap-3 px-3"
        style={{
          background: "linear-gradient(180deg, rgba(11,26,42,0.85) 0%, rgba(6,18,31,0.80) 100%)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(6, 209, 243, 0.10)",
          boxShadow: "0 1px 0 rgba(6,209,243,0.05), 0 4px 24px rgba(2,12,24,0.4)",
        }}
      >
        {/* Wordmark */}
        <div className="flex items-center gap-2">
          <img src="/helm.svg" alt="Helm" className="h-5 w-5" />
          <span
            className="text-sm font-bold tracking-tight text-fg"
            style={{ fontFamily: "Syne, system-ui, sans-serif", letterSpacing: "-0.01em" }}
          >
            Helm
          </span>
        </div>

        <div className="h-5 w-px bg-border" />

        <AiStatus />

        <div className="ml-auto flex items-center gap-3">
          <PortfolioSummary />
          <div className="h-5 w-px bg-border" />
          <ConnectionPill />

          {/* Workspace controls — desktop only */}
          {!isMobile && (
            <>
              <div className="h-5 w-px bg-border" />
              <button
                type="button"
                className="btn btn-accent h-7 px-2 text-xs"
                onClick={() => setCatalogOpen(true)}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Widget</span>
              </button>
              <button
                type="button"
                className="btn h-7 px-2 text-xs"
                onClick={onReset}
                title="Reset workspace layout"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            </>
          )}
        </div>
      </header>

      <WidgetCatalog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </>
  );
}
