/**
 * WidgetCatalog — "Add Widget" modal. Searchable, grouped by category.
 */

import { useMemo, useState } from "react";
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

  const pick = (type: string) => { addWidget(type); onClose(); };
  const total = groups.reduce((n, [, w]) => n + w.length, 0);

  return (
    <Modal open={open} onClose={onClose} title="Add Widget" width={620}>
      <div className="flex flex-col">
        {/* Search bar */}
        <div className="sticky top-0 z-10 border-b border-border bg-bg-1/80 p-3 backdrop-blur-md">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-0/80 px-3">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-accent/60" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="h-9 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
            />
          </div>
        </div>

        <div className="p-3">
          {total === 0 ? (
            <div className="py-10 text-center text-sm text-fg-faint">
              {Object.keys(widgetsByCategory()).length === 0
                ? "No widgets registered yet."
                : `No widgets match "${query}".`}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(([category, widgets]) => (
                <section key={category}>
                  <h3 className="mb-2 text-2xs font-bold uppercase tracking-widest text-accent/60">
                    {category}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {widgets.map((w) => {
                      const Icon = w.icon;
                      return (
                        <button
                          key={w.type}
                          type="button"
                          onClick={() => pick(w.type)}
                          className="group flex items-start gap-3 rounded-xl border border-border bg-bg-2/50 p-3 text-left
                            transition-all duration-150 hover:border-accent/30 hover:bg-bg-2 hover:shadow-glow-sm"
                        >
                          <span
                            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg
                              border border-border bg-bg-0 text-fg-faint transition-colors
                              group-hover:border-accent/30 group-hover:text-accent"
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-fg">
                              {w.title}
                            </span>
                            <span className="mt-0.5 block text-2xs leading-snug text-fg-faint line-clamp-2">
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
