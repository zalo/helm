/**
 * Topbar — OpenBB-style header: global search (opens Cmd+K palette), the
 * active dashboard breadcrumb, then live status (AI, equity, connection) and
 * the Add Widget + Copilot controls on the right.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Pause, Play, Search, LayoutGrid, Sparkles, ChevronRight,
  TrendingUp, TrendingDown, Minus, Bell,
} from "lucide-react";
import { api } from "@/api/client";
import type { AITraderStatus, PortfolioSnapshot } from "@/api/types";
import { money, pct, signedMoney } from "@/lib/format";
import { useWsEvent, useWsStatus } from "@/hooks/useWsEvent";
import { useWorkspace, useActiveDashboard } from "@/store/workspace";
import { Pill, StatDelta } from "@/components/ui";

// --- AI status ---------------------------------------------------------------

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
      <Pill tone={tone} dot pulse={pulsing}>AI {state}</Pill>
      {data && (
        <span className="hidden items-center gap-2 text-2xs text-fg-muted xl:flex">
          <span className="num">{data.decisions_today} today</span>
          <span className="num">{pct(data.win_rate * 100, 0)} win</span>
        </span>
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

// --- portfolio summary -------------------------------------------------------

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

  if (!data) return <div className="num text-sm text-fg-faint">— equity</div>;

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end leading-none">
        <span className="text-2xs text-fg-faint">Equity</span>
        <span className="num text-sm font-semibold text-fg">{money(data.equity)}</span>
      </div>
      <div className="hidden h-6 w-px bg-border sm:block" />
      <div className="hidden flex-col items-end leading-none sm:flex">
        <span className="text-2xs text-fg-faint">Day P&amp;L</span>
        <span className="text-sm font-semibold">
          <StatDelta value={data.total_pnl} format={signedMoney} />
        </span>
      </div>
      <Pill tone={data.total_pnl_pct >= 0 ? "gain" : "loss"}>{pct(data.total_pnl_pct)}</Pill>
    </div>
  );
}

// --- regime indicator --------------------------------------------------------
// Single-chip macro read derived from the live portfolio + AI signal flow.
// Maps total day-P&L to a coarse risk regime — the research surveyed several
// pro dashboards (Hyperliquid, Trade Ideas) where a single regime chip is the
// "what is the market doing right now" anchor. Demo-grade heuristic.

function RegimePill() {
  const { data } = useQuery({
    queryKey: ["trading", "portfolio"],
    queryFn: api.portfolio,
    refetchInterval: 10_000,
  });

  if (!data) {
    return (
      <Pill tone="neutral" dot>
        <Minus className="h-3 w-3" />
        <span className="hidden xl:inline">Regime</span>
      </Pill>
    );
  }
  const p = data.total_pnl_pct;
  let tone: "gain" | "loss" | "warn" | "neutral";
  let label: string;
  let Icon: typeof TrendingUp;
  if (p >= 0.5) {
    tone = "gain";   label = "Risk-On";   Icon = TrendingUp;
  } else if (p <= -0.5) {
    tone = "loss";   label = "Risk-Off";  Icon = TrendingDown;
  } else if (p >= 0) {
    tone = "warn";   label = "Coiled";    Icon = Minus;
  } else {
    tone = "warn";   label = "Defensive"; Icon = TrendingDown;
  }
  return (
    <span title={`Day P&L ${pct(p)}`}>
      <Pill tone={tone} dot>
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </Pill>
    </span>
  );
}

// --- wake agent --------------------------------------------------------------

/** Send a one-shot "wake" event to any helm-agent CLI listening on /ws. */
function WakeAgentButton() {
  const [flash, setFlash] = useState(false);
  const wake = useMutation({
    mutationFn: (message: string) => api.agentWake(message),
    onSuccess: () => {
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    },
  });
  return (
    <button
      type="button"
      className={"btn h-7 px-2 text-xs " + (flash ? "btn-accent" : "")}
      disabled={wake.isPending}
      onClick={() => wake.mutate("wake from webui")}
      title="Wake any helm-agent CLI sleeping on --on-event wake"
    >
      <Bell className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{flash ? "Sent" : "Wake"}</span>
    </button>
  );
}

// --- connection --------------------------------------------------------------

const WS_TONE  = { connecting: "warn", open: "gain", closed: "loss" } as const;
const WS_LABEL = { connecting: "Connecting", open: "Live", closed: "Offline" } as const;

function ConnectionPill() {
  const status = useWsStatus();
  return (
    <Pill tone={WS_TONE[status]} dot pulse={status === "connecting"}>
      {WS_LABEL[status]}
    </Pill>
  );
}

// --- topbar ------------------------------------------------------------------

export function Topbar({
  isMobile = false,
  copilotOpen = false,
  onOpenPalette,
  onOpenWidgets,
  onToggleCopilot,
}: {
  isMobile?: boolean;
  copilotOpen?: boolean;
  onOpenPalette?: () => void;
  onOpenWidgets?: () => void;
  onToggleCopilot?: () => void;
}) {
  const active  = useActiveDashboard();
  const folders = useWorkspace((s) => s.folders);
  const folder  = folders.find((f) => f.id === active.folderId);

  return (
    <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border bg-bg-0 px-3">
      {/* Mobile: compact wordmark. Desktop: dashboard breadcrumb. */}
      {isMobile ? (
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}helm.png`} alt="Helm" className="h-6 w-6" />
          <span className="text-sm font-bold tracking-tight text-fg">Helm</span>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          {folder && (
            <>
              <span className="truncate text-xs text-fg-faint">{folder.name}</span>
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-fg-faint" />
            </>
          )}
          <span className="truncate text-sm font-semibold text-fg">{active.name}</span>
        </div>
      )}

      {/* Global search → command palette (desktop only) */}
      {!isMobile && onOpenPalette && (
        <button
          type="button"
          onClick={onOpenPalette}
          className="group flex h-7 w-64 items-center gap-2 rounded-md border border-border
            bg-bg-1 px-2.5 text-xs text-fg-faint transition-colors hover:border-border-strong hover:bg-bg-2"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search widgets, dashboards…</span>
          <kbd className="rounded border border-border bg-bg-2 px-1 py-0.5 text-2xs">⌘K</kbd>
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        <RegimePill />
        <div className="hidden h-6 w-px bg-border md:block" />
        <AiStatus />
        <div className="hidden h-6 w-px bg-border md:block" />
        <PortfolioSummary />
        <div className="h-6 w-px bg-border" />
        <WakeAgentButton />
        <ConnectionPill />

        {!isMobile && (
          <>
            <div className="h-6 w-px bg-border" />
            <button
              type="button"
              className="btn h-7 px-2 text-xs"
              onClick={onOpenWidgets}
              title="Add widget"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Add Widget</span>
            </button>
          </>
        )}

        {onToggleCopilot && (
          <button
            type="button"
            className={
              "btn h-7 px-2 text-xs " +
              (copilotOpen ? "btn-accent" : "")
            }
            onClick={onToggleCopilot}
            title="Toggle Copilot"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Copilot</span>
          </button>
        )}
      </div>
    </header>
  );
}
