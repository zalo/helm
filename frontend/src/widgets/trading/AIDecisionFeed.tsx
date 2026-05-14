import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Circle,
} from "lucide-react";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type {
  AIAction,
  AIDecision,
  AISignal,
  AIState,
  AITraderStatus,
  SignalSentiment,
  WsEvent,
} from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { signedMoney, pct, relativeTime, pnlColor } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

// --- action / state styling ------------------------------------------------

const ACTION_STYLE: Record<AIAction, string> = {
  BUY: "bg-gain-dim text-gain border-gain/40",
  SELL: "bg-loss-dim text-loss border-loss/40",
  HOLD: "bg-bg-2 text-fg-muted border-border",
  CLOSE: "bg-warn-dim text-warn border-warn/40",
  REBALANCE: "bg-accent-dim text-accent border-accent/40",
};

const STATE_DOT: Record<AIState, string> = {
  idle: "text-fg-faint",
  analyzing: "text-accent",
  executing: "text-gain",
  paused: "text-warn",
};

const SENTIMENT_STYLE: Record<SignalSentiment, string> = {
  bullish: "bg-gain-dim text-gain",
  bearish: "bg-loss-dim text-loss",
  neutral: "bg-bg-2 text-fg-muted",
};

// --- confidence gauge ------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const pctVal = Math.round(value * 100);
  const color =
    pctVal >= 70 ? "bg-gain" : pctVal >= 40 ? "bg-warn" : "bg-loss";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-2">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="num w-9 text-right text-2xs text-fg-muted">{pctVal}%</span>
    </div>
  );
}

function SignalChip({ s }: { s: AISignal }) {
  return (
    <span
      className={cn("chip", SENTIMENT_STYLE[s.sentiment])}
      title={`${s.source} · ${s.sentiment}`}
    >
      <span className="opacity-70">{s.label}</span>
      <span className="font-semibold">{s.value}</span>
    </span>
  );
}

// --- decision card ---------------------------------------------------------

function DecisionCard({ d }: { d: AIDecision }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border bg-bg-1 hover:border-border-strong">
      <div className="flex flex-col gap-1.5 p-2">
        {/* Header row */}
        <div className="flex items-center gap-1.5">
          <span className={cn("chip border", ACTION_STYLE[d.action])}>{d.action}</span>
          {d.instrument && (
            <span className="num text-xs font-semibold text-fg">{d.instrument}</span>
          )}
          <span className="ml-auto text-2xs text-fg-faint" title={new Date(d.ts).toISOString()}>
            {relativeTime(d.ts)}
          </span>
        </div>

        {/* Confidence */}
        <ConfidenceBar value={d.confidence} />

        {/* Thesis */}
        <p className="text-xs leading-snug text-fg">{d.thesis}</p>

        {/* Signals */}
        {d.signals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.signals.map((s, i) => (
              <SignalChip key={`${s.label}-${i}`} s={s} />
            ))}
          </div>
        )}

        {/* Outcome + expand control */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-0.5 text-2xs text-fg-faint hover:text-fg-muted"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {open ? "Hide reasoning" : "Full reasoning"}
          </button>
          <span
            className={cn(
              "ml-auto chip",
              d.status === "executed" && "bg-gain-dim text-gain",
              d.status === "proposed" && "bg-accent-dim text-accent",
              d.status === "skipped" && "bg-bg-2 text-fg-faint",
              d.status === "rejected" && "bg-loss-dim text-loss",
            )}
          >
            {d.status}
          </span>
          {d.realized_pnl != null && (
            <span
              className={cn("num text-xs font-semibold", pnlColor(d.realized_pnl))}
              title="Realized P&L from this decision"
            >
              {signedMoney(d.realized_pnl)}
            </span>
          )}
        </div>

        {/* Full reasoning — preserves line breaks from the model output. */}
        {open && (
          <div className="mt-0.5 whitespace-pre-wrap rounded border border-border bg-bg-0 p-2 text-2xs leading-relaxed text-fg-muted">
            {d.reasoning}
          </div>
        )}
      </div>
    </div>
  );
}

// --- status header ---------------------------------------------------------

function StatusHeader({ status }: { status: AITraderStatus | undefined }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!status) return;
    setBusy(true);
    try {
      const next = await api.aiControl(status.enabled ? "pause" : "resume");
      qc.setQueryData(["ai-status"], next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-border bg-bg-2 px-2.5 py-1.5">
      <BrainCircuit size={14} className="text-accent" />
      <span className="text-xs font-semibold">AI Trader</span>
      {status && (
        <>
          <span
            className={cn("flex items-center gap-1 text-2xs", STATE_DOT[status.state])}
            title={`mode: ${status.mode} · strategy: ${status.strategy_name}`}
          >
            <Circle size={7} fill="currentColor" />
            {status.state}
          </span>
          <div className="ml-auto flex items-center gap-2.5 text-2xs text-fg-muted">
            <span>
              <span className="num text-fg">{status.decisions_today}</span> today
            </span>
            <span>
              win{" "}
              <span className={cn("num", status.win_rate >= 0.5 ? "text-gain" : "text-loss")}>
                {pct(status.win_rate * 100, 0)}
              </span>
            </span>
            <button
              onClick={toggle}
              disabled={busy}
              className="btn px-1.5 py-0.5 text-2xs"
              title={status.enabled ? "Pause AI trader" : "Resume AI trader"}
            >
              {status.enabled ? <Pause size={11} /> : <Play size={11} />}
              {status.enabled ? "Pause" : "Resume"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- widget ----------------------------------------------------------------

export default function AIDecisionFeed(_props: WidgetProps) {
  const qc = useQueryClient();

  const decisions = useQuery({
    queryKey: ["ai-decisions"],
    queryFn: () => api.aiDecisions(100),
    refetchInterval: 60_000,
  });
  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: api.aiStatus,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const unsubD = helmSocket.on("ai_decision", (e: WsEvent) => {
      const d = e.payload as AIDecision;
      qc.setQueryData<AIDecision[]>(["ai-decisions"], (prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((x) => x.id === d.id);
        // Update in place if it already exists (e.g. realized_pnl arrived later).
        if (idx !== -1) {
          const next = list.slice();
          next[idx] = d;
          return next;
        }
        return [d, ...list];
      });
    });
    const unsubS = helmSocket.on("ai_status", (e: WsEvent) => {
      qc.setQueryData(["ai-status"], e.payload as AITraderStatus);
    });
    return () => {
      unsubD();
      unsubS();
    };
  }, [qc]);

  // Reverse-chronological — backend order is not guaranteed.
  const rows = decisions.data
    ? [...decisions.data].sort((a, b) => b.ts.localeCompare(a.ts))
    : [];

  return (
    <div className="flex h-full w-full flex-col">
      <StatusHeader status={status.data} />
      <div className="scroll-y flex-1">
        {decisions.isLoading ? (
          <Loading label="Loading decisions…" />
        ) : decisions.isError ? (
          <ErrorState label="Decision feed unavailable" />
        ) : rows.length === 0 ? (
          <Empty label="No decisions yet" />
        ) : (
          <div className="flex flex-col gap-1.5 p-2">
            {rows.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
