import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit, ChevronDown, ChevronRight, Pause, Play, Circle,
  MessageSquare, Send, User2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

// --- chat panel --------------------------------------------------------------
//
// Round-trip: user types → POST /api/agent/wake (broadcasts `wake` WS event) →
// helm-agent CLI sleeping on --on-event wake exits with the message → Claude
// Code processes it → calls `helm-agent say "…"` → /api/agent/say broadcasts
// `agent_message` → this panel renders it.

interface ChatMsg {
  id: string;
  role: "user" | "agent";
  message: string;
  ts: string;
  source?: string;
}

const CHAT_STORAGE_KEY = "helm.chatHistory.v1";
const CHAT_MAX_MESSAGES = 500;
const TYPING_TIMEOUT_MS = 5 * 60 * 1000;

function loadChatHistory(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-CHAT_MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveChatHistory(messages: ChatMsg[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = messages.slice(-CHAT_MAX_MESSAGES);
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded — drop silently; old messages are fine to lose */
  }
}

function mergeMsg(prev: ChatMsg[], incoming: ChatMsg): ChatMsg[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  // Insert in ts-sorted order so out-of-order delivery still renders right.
  const out = [...prev, incoming];
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
}

function ChatPanel() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>(loadChatHistory);
  // Set when a user sends a wake; cleared on the next agent_message or timeout.
  const [agentBusy, setAgentBusy] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On mount, pull the canonical chat history from the backend (covers
  // messages that arrived while the tab was closed or on a different tab).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.agentChat(500);
        if (cancelled) return;
        setMessages((prev) => {
          let merged = prev;
          for (const m of data.messages) {
            const id = (m as ChatMsg).id
              ?? `s-${m.ts}-${m.role}-${m.message.length}`;
            merged = mergeMsg(merged, {
              id,
              role: m.role === "agent" ? "agent" : "user",
              message: m.message,
              ts: m.ts,
              source: m.source,
            });
          }
          return merged;
        });
      } catch { /* offline / endpoint missing — fall back to local-only */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    const unsubAgent = helmSocket.on("agent_message", (e: WsEvent) => {
      const p = e.payload as { message: string; role?: string; ts?: string };
      const ts = p.ts ?? new Date().toISOString();
      setMessages((m) => mergeMsg(m, {
        id: `a-${ts}-${p.message.length}`,
        role: "agent",
        message: p.message,
        ts,
      }));
      setAgentBusy(false);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    });
    const unsubWake = helmSocket.on("wake", (e: WsEvent) => {
      const p = e.payload as { id?: string; message?: string; source?: string; ts?: string };
      if (!p.message) return;
      const ts = p.ts ?? new Date().toISOString();
      // Use the backend-assigned id when present so own sends, external sends,
      // and history hydration all converge on the same key (no duplicates).
      const id = p.id ? `w-${p.id}` : `w-${ts}-${p.message.length}`;
      setMessages((m) => mergeMsg(m, {
        id,
        role: "user",
        message: p.message!,
        ts,
        source: p.source,
      }));
      // Any inbound user message means a CLI worker should be processing it.
      setAgentBusy(true);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setAgentBusy(false), TYPING_TIMEOUT_MS);
    });
    return () => {
      unsubAgent();
      unsubWake();
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, agentBusy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    try {
      // Don't add a local bubble — wait for the WS echo so the id (server-assigned)
      // matches what hydration would produce. Eliminates dup bubbles entirely.
      await api.agentWake(text, { from: "webui-chat" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="scroll-y flex-1 px-3 py-2.5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-faint">
            <MessageSquare size={20} className="opacity-60" />
            <div className="text-xs">Send a message to wake the agent.</div>
            <div className="max-w-xs text-center text-2xs">
              Each send fires a <code className="text-fg">wake</code> WS event the
              agent's CLI receives via <code className="text-fg">helm-agent sleep --on-event wake</code>.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex max-w-[85%] flex-col gap-0.5 rounded-lg px-2.5 py-1.5",
                  m.role === "user"
                    ? "ml-auto bg-accent/15 text-fg"
                    : "mr-auto bg-bg-2 text-fg",
                )}
              >
                <div className="flex items-center gap-1 text-2xs text-fg-faint">
                  {m.role === "user" ? <User2 size={9} /> : <BrainCircuit size={9} />}
                  <span>{m.role}</span>
                  {m.role === "user" && m.source && m.source !== "webui" && m.source !== "webui-chat" && (
                    <span className="rounded bg-bg-3 px-1 py-px text-2xs text-fg-faint">
                      via {m.source}
                    </span>
                  )}
                  <span className="ml-auto">{relativeTime(m.ts)}</span>
                </div>
                <div className="md-message text-xs leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.message}</ReactMarkdown>
                </div>
              </div>
            ))}
            {agentBusy && (
              <div className="mr-auto flex items-center gap-1.5 rounded-lg bg-bg-2 px-2.5 py-1.5">
                <span className="flex items-center gap-1 text-2xs text-fg-faint">
                  <BrainCircuit size={9} />
                  <span>agent</span>
                </span>
                <span className="flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint" />
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <form
        className="flex flex-shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
      >
        <input
          type="text"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message agent (wakes the CLI)…"
          className="flex-1 rounded-md border border-border bg-bg-2 px-2 py-1 text-xs text-fg
            placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn h-7 px-2 text-xs">
          <Send size={11} />
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  );
}

// --- widget ------------------------------------------------------------------

type AITab = "decisions" | "chat";

const AI_TAB_STORAGE_KEY = "helm.aiDecisionFeed.tab";

function loadAITab(): AITab {
  if (typeof window === "undefined") return "chat";
  const v = window.localStorage.getItem(AI_TAB_STORAGE_KEY);
  // Chat is the default since the in-process AIBrain is off by default —
  // the agent loop runs through the chat panel, so that's where to land.
  return v === "decisions" ? "decisions" : "chat";
}

export default function AIDecisionFeed(_props: WidgetProps) {
  const qc = useQueryClient();
  const [tab, setTabRaw] = useState<AITab>(loadAITab);
  const setTab = (next: AITab) => {
    setTabRaw(next);
    try { window.localStorage.setItem(AI_TAB_STORAGE_KEY, next); } catch { /* quota */ }
  };

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
      <div className="flex flex-shrink-0 border-b border-border bg-bg-1">
        {([
          { id: "decisions", label: "Decisions", icon: BrainCircuit },
          { id: "chat",      label: "Chat",      icon: MessageSquare },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-2xs font-medium transition-colors",
                active
                  ? "border-b-2 border-accent text-fg"
                  : "border-b-2 border-transparent text-fg-muted hover:text-fg",
              )}
            >
              <Icon size={11} />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === "decisions" ? (
          <div className="scroll-y h-full">
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
        ) : (
          <ChatPanel />
        )}
      </div>
    </div>
  );
}
