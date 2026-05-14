/**
 * WidgetCatalog — the "Add Widget" modal. Lists every registered widget
 * grouped by category, searchable by name/description. Clicking an entry adds
 * it to the live workspace and closes. Esc-dismissable via `<Modal>`.
 */

import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { widgetsByCategory } from "@/widgets/registry";
import type { WidgetDefinition } from "@/widgets/types";
import { Modal } from "@/components/ui";
import { useWorkspaceController } from "./Workspace";

export function WidgetCatalog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const addWidget = useWorkspaceController((s) => s.addWidget);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCat = widgetsByCategory();
    const out: [string, WidgetDefinition[]][] = [];
    for (const [cat, widgets] of Object.entries(byCat)) {
      const matched = q
        ? widgets.filter(
            (w) =>
              w.title.toLowerCase().includes(q) ||
              w.description.toLowerCase().includes(q) ||
              w.type.toLowerCase().includes(q),
          )
        : widgets;
      if (matched.length) out.push([cat, matched]);
    }
    return out;
  }, [query]);

  const pick = (type: string) => {
    addWidget(type);
    onClose();
  };

  const total = groups.reduce((n, [, w]) => n + w.length, 0);

  return (
    <Modal open={open} onClose={onClose} title="Add Widget" width={620}>
      <div className="flex flex-col">
        <div className="sticky top-0 z-10 border-b border-border bg-bg-1 p-2.5">
          <div className="flex items-center gap-2 rounded border border-border bg-bg-0 px-2">
            <Search className="h-3.5 w-3.5 text-fg-faint" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="h-8 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>

        <div className="p-2.5">
          {total === 0 ? (
            <div className="py-10 text-center text-sm text-fg-faint">
              {widgetsByCategory && Object.keys(widgetsByCategory()).length === 0
                ? "No widgets registered yet."
                : `No widgets match “${query}”.`}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(([category, widgets]) => (
                <section key={category}>
                  <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">
                    {category}
                  </h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {widgets.map((w) => {
                      const Icon = w.icon;
                      return (
                        <button
                          key={w.type}
                          type="button"
                          onClick={() => pick(w.type)}
                          className="group flex items-start gap-2 rounded border border-border bg-bg-2 p-2 text-left transition-colors hover:border-accent/40 hover:bg-bg-3"
                        >
                          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-bg-0 text-fg-muted group-hover:text-accent">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-fg">
                              {w.title}
                            </span>
                            <span className="block text-2xs leading-snug text-fg-faint line-clamp-2">
                              {w.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
