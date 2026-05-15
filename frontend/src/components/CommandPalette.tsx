/**
 * CommandPalette — Cmd/Ctrl+K quick launcher.
 *
 * Searches across: widgets (add to canvas), dashboards (switch to), and shell
 * actions (toggle Copilot, new dashboard, reset layout). Keyboard-driven —
 * arrow keys + Enter.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, LayoutGrid, LayoutDashboard, Sparkles, Plus, RotateCcw, CornerDownLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { widgetRegistry } from "@/widgets/registry";
import { useWorkspace } from "@/store/workspace";
import { useWorkspaceController } from "@/workspace/Workspace";
import { cn } from "@/lib/cn";

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onToggleCopilot,
}: {
  open: boolean;
  onClose: () => void;
  onToggleCopilot: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const dashboards   = useWorkspace((s) => s.dashboards);
  const setActive    = useWorkspace((s) => s.setActiveDashboard);
  const createDash   = useWorkspace((s) => s.createDashboard);
  const addWidget    = useWorkspaceController((s) => s.addWidget);
  const resetLayout  = useWorkspaceController((s) => s.resetLayout);

  // Build the full command list.
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // Shell actions
    cmds.push(
      { id: "act-copilot", label: "Toggle Copilot", hint: "Action", icon: Sparkles, run: onToggleCopilot },
      { id: "act-new", label: "New dashboard", hint: "Action", icon: Plus, run: () => createDash("Untitled dashboard") },
      { id: "act-reset", label: "Reset dashboard layout", hint: "Action", icon: RotateCcw, run: resetLayout },
    );

    // Dashboards
    for (const d of dashboards) {
      cmds.push({
        id: `dash-${d.id}`,
        label: d.name,
        hint: "Dashboard",
        icon: LayoutDashboard,
        run: () => setActive(d.id),
      });
    }

    // Widgets
    for (const w of widgetRegistry) {
      cmds.push({
        id: `widget-${w.type}`,
        label: `Add ${w.title}`,
        hint: `Widget · ${w.category}`,
        icon: w.icon ?? LayoutGrid,
        run: () => addWidget(w.type),
      });
    }
    return cmds;
  }, [dashboards, addWidget, resetLayout, setActive, createDash, onToggleCopilot]);

  // Filter by query.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Reset state on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp cursor when the filtered set shrinks.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the active row visible.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const exec = (cmd: Command) => {
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd) exec(cmd);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-bg-0/70 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[60vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl
          border border-border-strong bg-bg-1 shadow-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="h-4 w-4 flex-shrink-0 text-fg-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search widgets, dashboards, actions…"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
          />
          <kbd className="rounded border border-border bg-bg-2 px-1.5 py-0.5 text-2xs text-fg-faint">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-3.5 py-8 text-center text-sm text-fg-faint">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              const active = i === cursor;
              return (
                <button
                  key={cmd.id}
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => exec(cmd)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
                    active ? "bg-bg-3" : "hover:bg-bg-2",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border",
                      active
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border bg-bg-2 text-fg-faint",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{cmd.label}</span>
                    <span className="block text-2xs text-fg-faint">{cmd.hint}</span>
                  </span>
                  {active && (
                    <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-fg-faint" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 text-2xs text-fg-faint">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-bg-2 px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-bg-2 px-1 py-0.5">↵</kbd> select
          </span>
          <span className="ml-auto">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
