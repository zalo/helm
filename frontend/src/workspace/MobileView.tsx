/**
 * MobileView — tab-based layout for small screens.
 *
 * Bottom nav: Portfolio / Chart / AI Trader / Explore. The Explore tab is a
 * registry-driven browser exposing *every* registered widget — a horizontal,
 * category-grouped chip bar selects which one renders full-height below.
 */

import { useCallback, useMemo, useState } from "react";
import { BarChart2, BrainCircuit, LayoutGrid, TrendingUp } from "lucide-react";
import PortfolioWidget from "@/widgets/trading/PortfolioWidget";
import ChartWidget, { type ChartConfig } from "@/widgets/trading/ChartWidget";
import AIDecisionFeed from "@/widgets/trading/AIDecisionFeed";
import { widgetRegistry, widgetsByCategory } from "@/widgets/registry";
import type { WidgetProps, WidgetCategory } from "@/widgets/types";
import { cn } from "@/lib/cn";

type Tab = "portfolio" | "chart" | "ai" | "explore";

const TABS: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
  { id: "portfolio", label: "Portfolio", icon: TrendingUp },
  { id: "chart",     label: "Chart",     icon: BarChart2 },
  { id: "ai",        label: "AI Trader", icon: BrainCircuit },
  { id: "explore",   label: "Explore",   icon: LayoutGrid },
];

/** Display order for the Explore chip-bar category groups. */
const CATEGORY_ORDER: WidgetCategory[] = [
  "Trading", "Markets", "AI", "Social", "News", "Macro",
];

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex h-10 flex-shrink-0 items-center border-b border-border px-4">
      <span className="text-sm font-semibold text-fg">{label}</span>
    </div>
  );
}

// --- Explore tab: every registered widget ------------------------------------

function ExploreTab() {
  const [type, setType] = useState<string>(() => widgetRegistry[0]?.type ?? "");
  // Per-widget config, seeded lazily from each widget's defaultConfig.
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});

  const def = useMemo(
    () => widgetRegistry.find((w) => w.type === type),
    [type],
  );
  const groups = useMemo(() => widgetsByCategory(), []);

  const config = configs[type] ?? (def?.defaultConfig as Record<string, unknown>) ?? {};

  const patch = useCallback<WidgetProps["setConfig"]>(
    (p) => {
      setConfigs((c) => ({
        ...c,
        [type]: {
          ...(c[type] ?? (def?.defaultConfig as Record<string, unknown>) ?? {}),
          ...p,
        },
      }));
    },
    [type, def],
  );

  const Widget = def?.component;

  return (
    <div className="flex h-full flex-col">
      {/* Category-grouped widget chip bar — horizontally scrollable */}
      <div className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-2 py-2">
        {CATEGORY_ORDER.filter((cat) => groups[cat]?.length).map((cat) => (
          <div key={cat} className="flex flex-shrink-0 items-center gap-1.5">
            <span className="flex-shrink-0 pl-1 text-2xs font-semibold uppercase tracking-wider text-fg-faint">
              {cat}
            </span>
            {groups[cat].map((w) => {
              const Icon = w.icon;
              const active = w.type === type;
              return (
                <button
                  key={w.type}
                  type="button"
                  onClick={() => setType(w.type)}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-2xs font-medium transition-colors",
                    active
                      ? "border-accent/50 bg-accent/12 text-accent"
                      : "border-border bg-bg-2 text-fg-muted hover:bg-bg-3 hover:text-fg",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="whitespace-nowrap">{w.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Selected widget — full height. Keyed by type so it remounts on switch. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {Widget && def ? (
          <Widget
            key={type}
            widgetId={`explore-${type}`}
            config={config}
            setConfig={patch}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-faint">
            No widgets registered.
          </div>
        )}
      </div>
    </div>
  );
}

// --- mobile shell ------------------------------------------------------------

export function MobileView() {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [chartConfig, setChartConfig] = useState<ChartConfig>({});

  const patchChart = useCallback(
    (p: Partial<ChartConfig>) => setChartConfig((c) => ({ ...c, ...p })),
    [],
  );
  const noop: WidgetProps["setConfig"] = useCallback(() => {}, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-0">
      {/* Main content area */}
      <div className="min-h-0 flex-1">
        {tab === "portfolio" && (
          <div className="flex h-full flex-col">
            <SectionHeader label="Portfolio" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PortfolioWidget widgetId="mob-portfolio" config={{}} setConfig={noop} />
            </div>
          </div>
        )}

        {tab === "chart" && (
          <div className="flex h-full flex-col">
            <SectionHeader label="Chart" />
            <div className="min-h-0 flex-1">
              <ChartWidget widgetId="mob-chart" config={chartConfig} setConfig={patchChart} />
            </div>
          </div>
        )}

        {tab === "ai" && (
          <div className="flex h-full flex-col">
            <SectionHeader label="AI Trader" />
            <div className="min-h-0 flex-1">
              <AIDecisionFeed widgetId="mob-ai" config={{}} setConfig={noop} />
            </div>
          </div>
        )}

        {tab === "explore" && <ExploreTab />}
      </div>

      {/* Bottom tab bar */}
      <nav
        className="flex flex-shrink-0 border-t border-border bg-bg-0/90 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-3 text-2xs font-medium transition-all",
                active ? "text-accent" : "text-fg-faint hover:text-fg-muted",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-all duration-200",
                  active && "drop-shadow-[0_0_6px_rgba(255,128,0,0.6)]",
                )}
              />
              <span className="leading-none tracking-wide">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
