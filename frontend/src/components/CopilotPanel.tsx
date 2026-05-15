/**
 * CopilotPanel — OpenBB-style AI Copilot as a slide-in right panel.
 *
 * Header (title + new chat + close) → message body → footer input. Replies come
 * from the simulated `askCopilot` engine, which pulls live data and can emit
 * "generative UI" actions that add widgets to the canvas.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, Plus, X, Send, ArrowUp, Loader2 } from "lucide-react";
import { askCopilot, SUGGESTED_PROMPTS, type CopilotAction } from "@/copilot/engine";
import { useWorkspaceController } from "@/workspace/Workspace";
import { cn } from "@/lib/cn";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: CopilotAction[];
  citations?: string[];
  pending?: boolean;
}

const uid = () => Math.random().toString(36).slice(2);

/** Render the lightweight markdown the engine emits (**bold**, _italic_, · bullets). */
function renderRich(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} className="h-1.5" />;
    const isBullet = line.trimStart().startsWith("·");
    const body = isBullet ? line.trimStart().slice(1).trim() : line;
    const parts = body.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).filter(Boolean);
    return (
      <div key={i} className={cn("text-xs leading-relaxed", isBullet && "flex gap-1.5 pl-1")}>
        {isBullet && <span className="text-accent">·</span>}
        <span>
          {parts.map((p, j) => {
            if (p.startsWith("**") && p.endsWith("**"))
              return <strong key={j} className="font-semibold text-fg">{p.slice(2, -2)}</strong>;
            if (p.startsWith("_") && p.endsWith("_"))
              return <em key={j} className="text-fg-muted">{p.slice(1, -1)}</em>;
            return <span key={j}>{p}</span>;
          })}
        </span>
      </div>
    );
  });
}

function MessageBubble({ m, onAction }: { m: Message; onAction: (a: CopilotAction) => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/15 px-3 py-2 text-xs text-fg">
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 animate-fade-up">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        {m.pending ? (
          <div className="flex items-center gap-1.5 py-1 text-xs text-fg-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-fg-muted">
            {renderRich(m.text)}

            {/* Generative-UI actions */}
            {m.actions && m.actions.length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {m.actions.map((a, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onAction(a)}
                    className="flex items-center gap-1.5 self-start rounded-md border border-accent/40
                      bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors
                      hover:bg-accent/20 hover:border-accent/60"
                  >
                    <Plus className="h-3 w-3" />
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {/* Citations */}
            {m.citations && m.citations.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-2xs text-fg-faint">Sources:</span>
                {m.citations.map((c, i) => (
                  <span
                    key={i}
                    className="rounded border border-border bg-bg-2 px-1.5 py-0.5 text-2xs text-fg-muted"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CopilotPanel({
  onClose,
  fullWidth = false,
}: {
  onClose: () => void;
  /** Mobile: fill the viewport instead of a fixed-width side rail. */
  fullWidth?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const addWidget = useWorkspaceController((s) => s.addWidget);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to newest message.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: Message = { id: uid(), role: "user", text: trimmed };
    const pendingMsg: Message = { id: uid(), role: "assistant", text: "", pending: true };
    setMessages((m) => [...m, userMsg, pendingMsg]);

    try {
      const reply = await askCopilot(trimmed);
      // Small delay so "Thinking…" registers — feels like real work.
      await new Promise((r) => setTimeout(r, 350));
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? { ...msg, pending: false, text: reply.text, actions: reply.actions, citations: reply.citations }
            : msg,
        ),
      );
    } catch {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? { ...msg, pending: false, text: "Something went wrong — try again." }
            : msg,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const runAction = (a: CopilotAction) => {
    if (a.kind === "add-widget") {
      addWidget(a.widgetType);
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: `Done — I've added the **${a.label.replace(/^Add /, "").replace(/ widget$/, "")}** widget to your dashboard.`,
        },
      ]);
    }
  };

  const newChat = () => { setMessages([]); setInput(""); };

  return (
    <aside
      className={cn(
        "flex flex-shrink-0 flex-col bg-bg-1",
        fullWidth
          ? "h-full w-full"
          : "w-[360px] border-l border-border shadow-copilot animate-slide-in-right",
      )}
    >
      {/* Header */}
      <header className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-border bg-bg-0 px-3">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-fg">Copilot</span>
        <span className="rounded bg-bg-2 px-1.5 py-0.5 text-2xs font-medium text-fg-faint">
          demo
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={newChat}
            title="New conversation"
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-2 hover:text-fg"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close Copilot"
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10">
              <Sparkles className="h-6 w-6 text-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold text-fg">Helm Copilot</div>
              <div className="mt-1 max-w-[260px] text-xs text-fg-faint">
                Ask about your portfolio, the AI trader, or market sentiment — or
                tell me to add widgets to your dashboard.
              </div>
            </div>
            <div className="flex w-full flex-col gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  className="flex items-center justify-between gap-2 rounded-md border border-border
                    bg-bg-2 px-2.5 py-1.5 text-left text-xs text-fg-muted transition-colors
                    hover:border-accent/40 hover:bg-bg-3 hover:text-fg"
                >
                  <span>{p}</span>
                  <ArrowUp className="h-3 w-3 flex-shrink-0 rotate-45 text-fg-faint" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} onAction={runAction} />
            ))}
          </div>
        )}
      </div>

      {/* Footer input */}
      <div className="flex-shrink-0 border-t border-border bg-bg-0 p-2.5">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-bg-2 px-2.5 py-1.5
          focus-within:border-accent/50">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask the Copilot…"
            className="max-h-28 min-h-[20px] flex-1 resize-none bg-transparent text-xs text-fg
              outline-none placeholder:text-fg-faint"
            style={{ lineHeight: "1.5" }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md
              bg-accent text-bg-0 transition-opacity hover:opacity-90
              disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1 px-1 text-2xs text-fg-faint">
          Simulated copilot · pulls live demo data · can add widgets
        </div>
      </div>
    </aside>
  );
}
