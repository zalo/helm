/**
 * The widget registry — the single catalog the workspace shell reads from.
 *
 * It composes two independently-owned bundles: `trading/` (portfolio, positions,
 * orders, P&L, chart, AI decision feed) and `exotic/` (Twitter, White House,
 * Reddit, Discord, SEC, Congress, econ calendar, Fear & Greed, Hacker News).
 * Each bundle exports a `WidgetDefinition[]` from its `index.ts`.
 */

import type { WidgetDefinition } from "./types";
import { tradingWidgets } from "./trading";
import { exoticWidgets } from "./exotic";

export const widgetRegistry: WidgetDefinition[] = [...tradingWidgets, ...exoticWidgets];

const byType = new Map(widgetRegistry.map((w) => [w.type, w]));

export function getWidget(type: string): WidgetDefinition | undefined {
  return byType.get(type);
}

export function widgetsByCategory(): Record<string, WidgetDefinition[]> {
  const groups: Record<string, WidgetDefinition[]> = {};
  for (const w of widgetRegistry) {
    (groups[w.category] ??= []).push(w);
  }
  return groups;
}
