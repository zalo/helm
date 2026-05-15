import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, ChevronRight, Pause, Play, Circle } from "lucide-react";
import { api } from "@/api/client";
import { helmSocket } from "@/api/ws";
import type {
  AIAction, AIDecision, AISignal, AIState, AITraderStatus, SignalSentiment, WsEvent,
} from "@/api/types";
import type { WidgetProps } from "@/widgets/types";
import { signedMoney, pct, relativeTime, pnlColor } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Loading, ErrorState, Empty } from "./_shared";

// --- style maps --------------------------------------------------------------

const ACTION_COLORS: Record<AIAction, { border: string; bg: string; text: string; label: string }> = {
  BUY:       { border: "#25c685", bg: "rgba(37,198,133,0.06)",  text: "text-gain",    label: "bg-gain/12 text-gain border-gain/30" },
  SELL:      { border: "#f0455a", bg: "rgba(240,69,90,0.06)",   text: "text-loss",    label: "bg-loss/12 text-loss border-loss/30" },
  HOLD:      { border: "#323237", bg: "rgba(43,43,49,0.40)",    text: "text-fg-muted", label: "bg-bg-2 text-fg-muted border-border" },
  CLOSE:     { border: "#f0a020", bg: "rgba(240,160,32,0.06)",  text: "text-warn",    label: "bg-warn/12 text-warn border-warn/30" },
  REBALANCE: { border: "#ff8000", bg: "rgba(255,128,0,0.06)",   text: "text-accent",  label: "bg-accent/12 text-accent border-accent/30" },
};

const STATE_COLOR: Record<AIState, string> = {
  idle:      "text-fg-faint",
  analyzing: "text-accent",
  executing: "text-gain",
  paused:    "text-warn",
};

const SENTIMENT_STYLE: Record<SignalSentiment, string> = {
  bullish: "bg-gain/10 text-gain",
  bearish: "bg-loss/10 text-loss",
  neutral: "bg-bg-2 text-fg-muted",
};

// --- confidence bar ----------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const pctVal  = Math.round(value * 100);
  const barColor =
    pctVal >= 70 ? "#25c685" :
    pctVal >= 40 ? "#f0a020" : "#f0455a";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pctVal}%`, background: barColor }}
        />
      </div>
      <span className="num w-8 text-right text-2xs text-fg-muted">{pctVal}%</span>
    </div>
  );
}

function SignalChip({ s }: { s: AISignal }) {
  return (
    <span
      className={cn("chip rounded-md text-2xs", SENTIMENT_STYLE[s.sentiment])}
      title={`${s.source} · ${s.sentiment}`}
    >
      <span className="opacity-60">{s.label}</span>
      <span className="font-semibold">{s.value}</span>
    </span>
  );
}

// --- decision card -----------------------------------------------------------

function DecisionCard({ d }: { d: AIDecision }) {
  const [open, setOpen] = useState(false);
  const style = ACTION_COLORS[d.action] ?? ACTION_COLORS.HOLD;

  return (
    <div
      className="rounded-xl overflow-hidden border border-border/60 transition-all duration-200 hover:border-border-strong"
      style={{
        borderLeft: `3px solid ${style.border}`,
        background: style.bg,
      }}
    >
      <div className="flex flex-col gap-2 p-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className={cn("chip border rounded-md font-semibold text-2xs", style.label)}>
            {d.action}
          </span>
          {d.instrument && (
            <span className="num text-xs font-bold text-fg">
              {d.instrument.split(".")[0]}
            </span>
          )}
          <span className="ml-auto text-2xs text-fg-faint" title={new Date(d.ts).toISOString()}>
            {relativeTime(d.ts)}
          </span>
        </div>

        {/* Confidence */}
        <ConfidenceBar value={d.confidence} />

        {/* Thesis */}
        <p className="text-xs leading-relaxed text-fg/90">{d.thesis}</p>

        {/* Signal chips */}
        {d.signals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.signals.map((s, i) => (
              <SignalChip key={`${s.label}-${i}`} s={s} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-0.5 text-2xs text-fg-faint hover:text-fg-muted transition-colors"
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {open ? "Hide reasoning" : "Show reasoning"}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                "chip rounded-md text-2xs",
                d.status === "executed" && "bg-gain/10 text-gain",
                d.status === "proposed" && "bg-accent/10 text-accent",
                d.status === "skipped"  && "bg-bg-2 text-fg-faint",
                d.status === "rejected" && "bg-loss/10 text-loss",
              )}
            >
              {d.status}
            </span>
            {d.realized_pnl != null && (
              <span className={cn("num text-xs font-semibold", pnlColor(d.realized_pnl))}>
                {signedMoney(d.realized_pnl)}
              </span>
            )}
          </div>
        </div>

        {/* Expanded reasoning */}
        {open && (
          <div
            className="mt-0.5 rounded-lg border border-border bg-bg-0/60 p-2.5 text-2xs leading-relaxed text-fg-muted whitespace-pre-wrap"
          >
            {d.reasoning}
          </div>
        )}
      </div>
    </div>
  );
}

// --- status header -----------------------------------------------------------

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
    <div
      className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2"
      style={{ background: "rgba(11,26,42,0.8)" }}
    >
      <BrainCircuit size={13} className="text-accent" />
      <span className="text-xs font-semibold tracking-wide">AI Trader</span>
      {status && (
        <>
          <span className={cn("flex items-center gap-1 text-2xs", STATE_COLOR[status.state])}>
            <Circle size={6} fill="currentColor" />
            {status.state}
          </span>
          <div className="ml-auto flex items-center gap-3 text-2xs text-fg-muted">
            <span>
              <span className="num text-fg">{status.decisions_today}</span> today
            </span>
            <span>
              win{" "}
              <span className={cn("num font-semibold", status.win_rate >= 0.5 ? "text-gain" : "text-loss")}>
                {pct(status.win_rate * 100, 0)}
              </span>
            </span>
            <button
              onClick={toggle}
              disabled={busy}
              className="btn h-6 px-1.5 py-0 text-2xs"
              title={status.enabled ? "Pause AI" : "Resume AI"}
            >
              {status.enabled ? <Pause size={10} /> : <Play size={10} />}
              {status.enabled ? "Pause" : "Resume"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- widget ------------------------------------------------------------------

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
    return () => { unsubD(); unsubS(); };
  }, [qc]);

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
          <div className="flex flex-col gap-2 p-2.5">
            {rows.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
