/**
 * Copilot engine — a simulated, context-aware assistant for the demo build.
 *
 * There is no LLM in the static demo, so this matches the user's intent against
 * keyword intents and answers with *live* data pulled from the same `api` the
 * widgets use. It can also emit "generative UI" actions — e.g. add a widget to
 * the canvas — which the CopilotPanel wires to the workspace controller.
 */

import { api } from "@/api/client";
import { money, signedMoney, pct, num } from "@/lib/format";

export interface CopilotAction {
  kind: "add-widget";
  widgetType: string;
  label: string;
}

export interface CopilotReply {
  text: string;
  actions?: CopilotAction[];
  citations?: string[];
}

/** Suggested prompts shown when the conversation is empty. */
export const SUGGESTED_PROMPTS: string[] = [
  "How is the portfolio doing?",
  "What is the AI trader doing right now?",
  "Show me my open positions",
  "Add a chart to the dashboard",
  "What's market sentiment like?",
];

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/** Map a free-text widget mention to a registered widget type. */
function matchWidgetType(s: string): { type: string; label: string } | null {
  if (has(s, "chart", "candle", "price")) return { type: "chart", label: "Price Chart" };
  if (has(s, "position")) return { type: "positions", label: "Positions" };
  if (has(s, "order")) return { type: "orders", label: "Orders" };
  if (has(s, "p&l", "pnl", "equity curve")) return { type: "pnl", label: "P&L Curve" };
  if (has(s, "portfolio")) return { type: "portfolio", label: "Portfolio" };
  if (has(s, "decision", "ai feed", "ai trader")) return { type: "ai-decision-feed", label: "AI Decisions" };
  if (has(s, "fear", "greed", "sentiment")) return { type: "fear-greed", label: "Fear & Greed" };
  if (has(s, "news", "hacker")) return { type: "hacker-news", label: "Hacker News" };
  if (has(s, "reddit")) return { type: "reddit", label: "Reddit" };
  if (has(s, "twitter", "x feed")) return { type: "twitter-feed", label: "X / Twitter" };
  if (has(s, "congress")) return { type: "congress-trades", label: "Congress Trades" };
  if (has(s, "sec", "filing", "edgar")) return { type: "sec-edgar", label: "SEC Filings" };
  if (has(s, "econ", "calendar", "macro")) return { type: "econ-calendar", label: "Econ Calendar" };
  if (has(s, "white house", "press")) return { type: "white-house", label: "White House" };
  if (has(s, "discord")) return { type: "discord", label: "Discord" };
  return null;
}

export async function askCopilot(message: string): Promise<CopilotReply> {
  const s = message.toLowerCase().trim();

  // --- generative UI: add a widget --------------------------------------
  if (has(s, "add", "show me", "open", "create", "put") && !has(s, "doing", "sentiment like")) {
    const w = matchWidgetType(s);
    if (w) {
      return {
        text: `I can drop a **${w.label}** widget onto the canvas for you. Click below to add it — it'll start streaming live data immediately.`,
        actions: [{ kind: "add-widget", widgetType: w.type, label: `Add ${w.label} widget` }],
      };
    }
  }

  // --- portfolio summary -------------------------------------------------
  if (has(s, "portfolio", "equity", "how am i", "how is the", "doing", "balance", "net worth")) {
    try {
      const p = await api.portfolio();
      const dir = p.total_pnl >= 0 ? "up" : "down";
      return {
        text:
          `Your portfolio is **${money(p.equity)}** in equity, ${dir} ` +
          `**${signedMoney(p.total_pnl)} (${pct(p.total_pnl_pct)})** from a ` +
          `${money(p.starting_equity)} start.\n\n` +
          `· Unrealized **${signedMoney(p.unrealized_pnl)}**, realized **${signedMoney(p.realized_pnl)}**\n` +
          `· **${p.positions_count}** open position${p.positions_count === 1 ? "" : "s"}, net exposure ${money(p.net_exposure)}\n` +
          `· Win rate **${pct(p.win_rate * 100, 0)}**, Sharpe **${num(p.sharpe, 2)}**, max drawdown **${pct(-Math.abs(p.max_drawdown_pct), 1)}**`,
        citations: ["Portfolio"],
        actions: [{ kind: "add-widget", widgetType: "pnl", label: "Add P&L Curve widget" }],
      };
    } catch {
      return { text: "I couldn't reach the portfolio data just now — try again in a moment." };
    }
  }

  // --- AI trader status --------------------------------------------------
  if (has(s, "ai trader", "the ai", "what is the ai", "what's the ai", "trader doing", "strategy", "agent")) {
    try {
      const [status, decisions] = await Promise.all([api.aiStatus(), api.aiDecisions(3)]);
      const recent = decisions
        .map((d) => `· **${d.action}** ${d.instrument?.split(".")[0] ?? ""} — ${d.thesis}`)
        .join("\n");
      return {
        text:
          `The **${status.strategy_name}** agent is **${status.state}** ` +
          `(${status.enabled ? "enabled" : "paused"}). It has made **${status.decisions_today}** ` +
          `decision${status.decisions_today === 1 ? "" : "s"} today with a **${pct(status.win_rate * 100, 0)}** win rate.\n\n` +
          (recent ? `Latest calls:\n${recent}` : "No decisions logged yet."),
        citations: ["AI Decisions"],
        actions: [{ kind: "add-widget", widgetType: "ai-decision-feed", label: "Add AI Decisions widget" }],
      };
    } catch {
      return { text: "The AI trader status isn't responding right now — give it a second." };
    }
  }

  // --- positions ---------------------------------------------------------
  if (has(s, "position", "holding", "exposure", "what do i own")) {
    try {
      const positions = await api.positions();
      if (positions.length === 0) {
        return { text: "You have **no open positions** right now — the AI trader is flat." };
      }
      const lines = positions
        .map(
          (p) =>
            `· **${p.side} ${p.instrument.split(".")[0]}** ×${num(p.quantity, 4)} @ ${num(p.avg_px)} ` +
            `→ ${signedMoney(p.unrealized_pnl)} unrealized`,
        )
        .join("\n");
      return {
        text: `You hold **${positions.length}** position${positions.length === 1 ? "" : "s"}:\n\n${lines}`,
        citations: ["Positions"],
        actions: [{ kind: "add-widget", widgetType: "positions", label: "Add Positions widget" }],
      };
    } catch {
      return { text: "I couldn't load positions just now — try again shortly." };
    }
  }

  // --- market sentiment --------------------------------------------------
  if (has(s, "sentiment", "fear", "greed", "mood", "market like")) {
    try {
      const items = await api.feed("fear-greed", { limit: 1 });
      const item = items[0];
      const val = item?.meta?.value ?? item?.meta?.index;
      const label = item?.meta?.classification ?? item?.title ?? "unknown";
      return {
        text:
          `The **Crypto Fear & Greed Index** is currently **${val ?? "—"}** — _${label}_.\n\n` +
          `I can pin the live gauge to your dashboard so you can track it alongside your positions.`,
        citations: ["Fear & Greed"],
        actions: [{ kind: "add-widget", widgetType: "fear-greed", label: "Add Fear & Greed widget" }],
      };
    } catch {
      return {
        text: "I can add a live Crypto Fear & Greed gauge to your dashboard.",
        actions: [{ kind: "add-widget", widgetType: "fear-greed", label: "Add Fear & Greed widget" }],
      };
    }
  }

  // --- risk --------------------------------------------------------------
  if (has(s, "risk", "drawdown", "sharpe", "volatility", "safe")) {
    try {
      const p = await api.portfolio();
      const riskNote =
        p.max_drawdown_pct > 8
          ? "That drawdown is on the elevated side — worth watching."
          : "Risk looks contained for now.";
      return {
        text:
          `Risk snapshot:\n\n` +
          `· Max drawdown **${pct(-Math.abs(p.max_drawdown_pct), 1)}**\n` +
          `· Sharpe ratio **${num(p.sharpe, 2)}**\n` +
          `· Net exposure **${money(p.net_exposure)}** across **${p.positions_count}** position${p.positions_count === 1 ? "" : "s"}\n\n` +
          riskNote,
        citations: ["Portfolio"],
      };
    } catch {
      return { text: "Risk metrics aren't available right now — try again in a moment." };
    }
  }

  // --- help / capabilities ----------------------------------------------
  if (has(s, "help", "what can you", "who are you", "capabilities", "hello", "hi ", "hey")) {
    return {
      text:
        "I'm the **Helm Copilot**. I can:\n\n" +
        "· Summarize your **portfolio**, **positions**, and **risk**\n" +
        "· Report what the **AI trader** is doing and why\n" +
        "· Check **market sentiment**\n" +
        "· **Add widgets** to your dashboard on request — just ask me to \"add a chart\" or \"show me positions\"\n\n" +
        "Ask me anything, or tap a suggestion below.",
    };
  }

  // --- fallback ----------------------------------------------------------
  const w = matchWidgetType(s);
  if (w) {
    return {
      text: `Want me to add a **${w.label}** widget to the dashboard?`,
      actions: [{ kind: "add-widget", widgetType: w.type, label: `Add ${w.label} widget` }],
    };
  }
  return {
    text:
      "I can help with your portfolio, positions, the AI trader, market sentiment, and " +
      "building out your dashboard. Try one of the suggestions below, or ask me to add a widget.",
  };
}
