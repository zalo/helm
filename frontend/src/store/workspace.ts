/**
 * Workspace store — persisted layout + per-widget-instance config.
 *
 * `layout` is dockview's `api.toJSON()` blob (opaque shape, stored as-is).
 * `configs` maps a dockview panel id (widgetId) to that instance's config.
 * Everything here is persisted to localStorage so a reload restores the desk.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WorkspaceState {
  /** widgetId -> per-instance config object. */
  configs: Record<string, Record<string, unknown>>;
  /** dockview serialized layout (api.toJSON()), or null before first save. */
  layout: object | null;

  /** Merge-patch a widget instance's config. Creates the entry if missing. */
  setConfig: (widgetId: string, patch: Record<string, unknown>) => void;
  /** Seed defaults the first time a widget instance mounts (no-op if present). */
  ensureConfig: (widgetId: string, defaults: Record<string, unknown>) => void;
  /** Drop a widget instance's config (call when its panel is removed). */
  removeConfig: (widgetId: string) => void;
  /** Persist the latest serialized dockview layout. */
  saveLayout: (layout: object) => void;
  /** Wipe layout + all configs — Workspace rebuilds the default desk. */
  resetLayout: () => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      configs: {},
      layout: null,

      setConfig: (widgetId, patch) =>
        set((s) => ({
          configs: {
            ...s.configs,
            [widgetId]: { ...(s.configs[widgetId] ?? {}), ...patch },
          },
        })),

      ensureConfig: (widgetId, defaults) =>
        set((s) => {
          if (s.configs[widgetId]) return s;
          return { configs: { ...s.configs, [widgetId]: { ...defaults } } };
        }),

      removeConfig: (widgetId) =>
        set((s) => {
          if (!s.configs[widgetId]) return s;
          const next = { ...s.configs };
          delete next[widgetId];
          return { configs: next };
        }),

      saveLayout: (layout) => set({ layout }),

      resetLayout: () => set({ layout: null, configs: {} }),
    }),
    {
      name: "helm.workspace",
      version: 1,
      partialize: (s) => ({ configs: s.configs, layout: s.layout }),
    },
  ),
);
