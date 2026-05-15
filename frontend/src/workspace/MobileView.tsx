/**
 * MobileView — tab-based layout for small screens.
 * Renders core trading widgets stacked in a single-column interface
 * controlled by a bottom navigation bar.
 */

import { useCallback, useState } from "react";
import { BarChart2, BrainCircuit, LayoutGrid, TrendingUp, Gauge } from "lucide-react";
import PortfolioWidget from "@/widgets/trading/PortfolioWidget";
import ChartWidget, { type ChartConfig } from "@/widgets/trading/ChartWidget";
import AIDecisionFeed from "@/widgets/trading/AIDecisionFeed";
import { FearGreedWidget } from "@/widgets/exotic/FearGreedWidget";
import { HackerNewsWidget } from "@/widgets/exotic/HackerNewsWidget";
import type { WidgetProps } from "@/widgets/types";

type Tab = "portfolio" | "chart" | "ai" | "explore";
type ExploreTab = "fear-greed" | "hacker-news";

const TABS: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
  { id: "portfolio", label: "Portfolio", icon: TrendingUp },
  { id: "chart",     label: "Chart",     icon: BarChart2 },
  { id: "ai",        label: "AI Trader", icon: BrainCircuit },
  { id: "explore",   label: "Explore",   icon: LayoutGrid },
];

const EXPLORE_TABS: { id: ExploreTab; label: string; icon: typeof TrendingUp }[] = [
  { id: "fear-greed",  label: "Fear & Greed", icon: Gauge },
  { id: "hacker-news", label: "Hacker News",  icon: LayoutGrid },
];

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex h-10 flex-shrink-0 items-center border-b border-border px-4">
      <span className="text-sm font-semibold text-fg">{label}</span>
    </div>
  );
}

export function MobileView() {
  const [tab, setTab] = useState<Tab>("portfolio");
  const [exploreTab, setExploreTab] = useState<ExploreTab>("fear-greed");
  const [chartConfig, setChartConfig] = useState<ChartConfig>({});
  const [hnConfig, setHnConfig] = useState<{ query: string }>({ query: "AI trading" });

  const patchChart = useCallback(
    (patch: Partial<ChartConfig>) => setChartConfig((c) => ({ ...c, ...patch })),
    [],
  );
  const patchHn = useCallback(
    (patch: Partial<{ query: string }>) => setHnConfig((c) => ({ ...c, ...patch })),
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

        {tab === "explore" && (
          <div className="flex h-full flex-col">
            {/* Explore sub-nav */}
            <div className="flex flex-shrink-0 border-b border-border">
              {EXPLORE_TABS.map((t) => {
                const Icon = t.icon;
                const active = t.id === exploreTab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setExploreTab(t.id)}
                    className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 border-b-2 text-xs font-medium transition-colors
                      ${active ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg"}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {exploreTab === "fear-greed" && (
                <FearGreedWidget widgetId="mob-fg" config={{}} setConfig={noop} />
              )}
              {exploreTab === "hacker-news" && (
                <HackerNewsWidget widgetId="mob-hn" config={hnConfig} setConfig={patchHn} />
              )}
            </div>
          </div>
        )}
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
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-3 text-2xs font-medium transition-all
                ${active ? "text-accent" : "text-fg-faint hover:text-fg-muted"}`}
            >
              <Icon
                className={`h-5 w-5 transition-all duration-200
                  ${active ? "drop-shadow-[0_0_6px_rgba(6,209,243,0.7)]" : ""}`}
              />
              <span className="leading-none tracking-wide">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
