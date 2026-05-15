/**
 * TemplatesModal — OpenBB-style "Apps". Pre-built dashboard templates the user
 * can instantiate; each maps to a `kind` that Workspace.tsx lays out with a
 * curated default widget set.
 */

import {
  LayoutDashboard, Wallet, Globe, Bitcoin, Newspaper, BrainCircuit,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Modal } from "@/components/ui";
import { useWorkspace } from "@/store/workspace";

interface Template {
  kind: string;        // becomes the dashboard id prefix → drives default layout
  name: string;
  icon: string;        // stored on the dashboard
  display: LucideIcon; // rendered in this modal
  folder: string;      // folder name to file it under (created if missing)
  description: string;
  widgets: string[];   // shown as a preview chip list
}

const TEMPLATES: Template[] = [
  {
    kind: "desk",
    name: "AI Trader Desk",
    icon: "LayoutDashboard",
    display: LayoutDashboard,
    folder: "Trading",
    description: "The full command center — live chart, portfolio, P&L curve, positions, orders and the AI decision feed.",
    widgets: ["Chart", "Portfolio", "P&L", "Positions", "Orders", "AI Decisions"],
  },
  {
    kind: "risk",
    name: "Positions & Risk",
    icon: "Wallet",
    display: Wallet,
    folder: "Trading",
    description: "Risk-focused — open positions, order log, portfolio metrics and the equity curve side by side.",
    widgets: ["Positions", "Portfolio", "P&L", "Orders"],
  },
  {
    kind: "macro",
    name: "Macro & Sentiment",
    icon: "Globe",
    display: Globe,
    folder: "Research",
    description: "Top-down view — economic calendar, White House feed, Congress trades and the Fear & Greed gauge.",
    widgets: ["Econ Calendar", "White House", "Congress Trades", "Fear & Greed"],
  },
  {
    kind: "crypto",
    name: "Crypto Watch",
    icon: "Bitcoin",
    display: Bitcoin,
    folder: "Research",
    description: "Crypto desk — price chart, Fear & Greed, Reddit chatter and Hacker News headlines.",
    widgets: ["Chart", "Fear & Greed", "Reddit", "Hacker News"],
  },
  {
    kind: "news",
    name: "News & Social",
    icon: "Globe",
    display: Newspaper,
    folder: "Research",
    description: "Information edge — X feed, Hacker News, Reddit, SEC filings and the White House press feed.",
    widgets: ["X / Twitter", "Hacker News", "Reddit", "SEC Filings", "White House"],
  },
  {
    kind: "ai",
    name: "AI Analyst",
    icon: "LayoutDashboard",
    display: BrainCircuit,
    folder: "Trading",
    description: "AI-centric — the decision feed front and center with portfolio, chart and sentiment context.",
    widgets: ["AI Decisions", "Portfolio", "Chart", "Fear & Greed"],
  },
];

export function TemplatesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const folders      = useWorkspace((s) => s.folders);
  const createFolder = useWorkspace((s) => s.createFolder);
  const createDash   = useWorkspace((s) => s.createDashboard);

  const instantiate = (t: Template) => {
    let folder = folders.find((f) => f.name === t.folder);
    const folderId = folder ? folder.id : createFolder(t.folder);
    // Dashboard id is prefixed with the template kind so Workspace.tsx can
    // pick the matching default layout.
    createDash(t.name, folderId, t.icon);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Apps & Templates" width={680}>
      <div className="p-3.5">
        <p className="mb-3 text-xs text-fg-faint">
          Each template spins up a new dashboard with a curated set of widgets,
          pre-arranged for a specific workflow.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {TEMPLATES.map((t) => {
            const Icon = t.display;
            return (
              <button
                key={t.kind}
                type="button"
                onClick={() => instantiate(t)}
                className="group flex flex-col gap-2 rounded-lg border border-border bg-bg-2 p-3
                  text-left transition-all duration-150 hover:border-accent/40 hover:bg-bg-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md
                      border border-border bg-bg-0 text-fg-faint group-hover:border-accent/40 group-hover:text-accent"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fg">{t.name}</div>
                    <div className="text-2xs text-fg-faint">{t.folder}</div>
                  </div>
                </div>
                <p className="text-2xs leading-relaxed text-fg-muted">{t.description}</p>
                <div className="flex flex-wrap gap-1">
                  {t.widgets.map((w) => (
                    <span
                      key={w}
                      className="rounded border border-border bg-bg-0 px-1.5 py-0.5 text-2xs text-fg-faint"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
