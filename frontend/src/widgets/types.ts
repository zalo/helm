/**
 * The widget contract. Every panel in the Helm workspace is a `WidgetDefinition`
 * registered in `registry.ts`. The workspace shell renders `component`, persists
 * `config` per instance, and uses `configSchema` to drive the settings drawer.
 */

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { ZodTypeAny } from "zod";

export type WidgetCategory = "Trading" | "Markets" | "AI" | "Social" | "News" | "Macro";

/** Props every widget component receives from the workspace shell. */
export interface WidgetProps<C = Record<string, unknown>> {
  /** Stable per-instance id (dockview panel id). */
  widgetId: string;
  /** Current persisted config for this instance. */
  config: C;
  /** Merge-patch this instance's config; the shell persists it. */
  setConfig: (patch: Partial<C>) => void;
}

export interface WidgetDefinition<C = Record<string, unknown>> {
  /** Unique key, e.g. "portfolio", "twitter-feed". */
  type: string;
  title: string;
  description: string;
  category: WidgetCategory;
  icon: LucideIcon;
  component: ComponentType<WidgetProps<C>>;
  /** Defaults applied when a new instance is added from the catalog. */
  defaultConfig: C;
  /** Zod schema — drives the auto-generated settings drawer. Optional. */
  configSchema?: ZodTypeAny;
  /** dockview sizing hints (px). */
  minWidth?: number;
  minHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

/** Helper for defining a widget with inferred config type. */
export function defineWidget<C>(def: WidgetDefinition<C>): WidgetDefinition<C> {
  return def;
}
