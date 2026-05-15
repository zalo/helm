/**
 * Workspace store — OpenBB-style multi-dashboard model.
 *
 * The workspace holds many `Dashboard`s organized into `Folder`s. Exactly one
 * dashboard is active at a time; its `layout` (dockview `toJSON()` blob) and
 * per-widget `configs` are what the canvas reads + writes.
 *
 * Layout/config mutations target an explicit dashboard id (defaulting to the
 * active one) so an unmounting canvas can't write into the dashboard you just
 * switched to.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Dashboard {
  id: string;
  name: string;
  folderId: string | null;
  /** lucide icon name — resolved in the Sidebar. */
  icon: string;
  /** dockview serialized layout, or null → Workspace builds a default. */
  layout: object | null;
  /** widgetId -> per-instance config. */
  configs: Record<string, Record<string, unknown>>;
}

export interface Folder {
  id: string;
  name: string;
}

interface WorkspaceState {
  dashboards: Dashboard[];
  folders: Folder[];
  activeId: string;

  // --- dashboard navigation + management ---
  setActiveDashboard: (id: string) => void;
  createDashboard: (name: string, folderId?: string | null, icon?: string) => string;
  duplicateDashboard: (id: string) => string | null;
  renameDashboard: (id: string, name: string) => void;
  deleteDashboard: (id: string) => void;
  moveDashboard: (id: string, folderId: string | null) => void;

  // --- folder management ---
  createFolder: (name: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;

  // --- active-dashboard surface (layout + widget configs) ---
  setConfig: (widgetId: string, patch: Record<string, unknown>) => void;
  ensureConfig: (widgetId: string, defaults: Record<string, unknown>) => void;
  removeConfig: (widgetId: string) => void;
  saveLayout: (layout: object, dashboardId?: string) => void;
  resetActiveLayout: () => void;
}

const uid = () => crypto.randomUUID();

// --- seed: a small set of dashboards across two folders ---------------------
// These double as "Apps" — each gets a distinct default layout in Workspace.tsx.

const SEED_FOLDERS: Folder[] = [
  { id: "fld-trading",  name: "Trading" },
  { id: "fld-research", name: "Research" },
];

const SEED_DASHBOARDS: Dashboard[] = [
  { id: "dash-desk",     name: "AI Trader Desk",     folderId: "fld-trading",  icon: "LayoutDashboard", layout: null, configs: {} },
  { id: "dash-risk",     name: "Positions & Risk",   folderId: "fld-trading",  icon: "Wallet",          layout: null, configs: {} },
  { id: "dash-macro",    name: "Macro & Sentiment",  folderId: "fld-research", icon: "Globe",           layout: null, configs: {} },
  { id: "dash-news",     name: "News & Social",      folderId: "fld-research", icon: "Newspaper",       layout: null, configs: {} },
  { id: "dash-crypto",   name: "Crypto Watch",       folderId: "fld-research", icon: "Bitcoin",         layout: null, configs: {} },
];

function patchActive(
  s: WorkspaceState,
  fn: (d: Dashboard) => Dashboard,
): Partial<WorkspaceState> {
  return {
    dashboards: s.dashboards.map((d) => (d.id === s.activeId ? fn(d) : d)),
  };
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      dashboards: SEED_DASHBOARDS,
      folders: SEED_FOLDERS,
      activeId: SEED_DASHBOARDS[0].id,

      // --- navigation ---
      setActiveDashboard: (id) => {
        if (get().dashboards.some((d) => d.id === id)) set({ activeId: id });
      },

      createDashboard: (name, folderId = null, icon = "LayoutDashboard") => {
        const id = uid();
        const dash: Dashboard = { id, name, folderId, icon, layout: null, configs: {} };
        set((s) => ({ dashboards: [...s.dashboards, dash], activeId: id }));
        return id;
      },

      duplicateDashboard: (id) => {
        const src = get().dashboards.find((d) => d.id === id);
        if (!src) return null;
        const newId = uid();
        const copy: Dashboard = {
          ...src,
          id: newId,
          name: `${src.name} copy`,
          // Deep-clone serializable layout + configs.
          layout: src.layout ? JSON.parse(JSON.stringify(src.layout)) : null,
          configs: JSON.parse(JSON.stringify(src.configs)),
        };
        set((s) => ({ dashboards: [...s.dashboards, copy], activeId: newId }));
        return newId;
      },

      renameDashboard: (id, name) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) => (d.id === id ? { ...d, name } : d)),
        })),

      deleteDashboard: (id) =>
        set((s) => {
          if (s.dashboards.length <= 1) return s; // keep at least one
          const remaining = s.dashboards.filter((d) => d.id !== id);
          const activeId = s.activeId === id ? remaining[0].id : s.activeId;
          return { dashboards: remaining, activeId };
        }),

      moveDashboard: (id, folderId) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) => (d.id === id ? { ...d, folderId } : d)),
        })),

      // --- folders ---
      createFolder: (name) => {
        const id = uid();
        set((s) => ({ folders: [...s.folders, { id, name }] }));
        return id;
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        })),

      deleteFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          // Orphan the folder's dashboards rather than deleting them.
          dashboards: s.dashboards.map((d) =>
            d.folderId === id ? { ...d, folderId: null } : d,
          ),
        })),

      // --- active-dashboard surface ---
      setConfig: (widgetId, patch) =>
        set((s) =>
          patchActive(s, (d) => ({
            ...d,
            configs: {
              ...d.configs,
              [widgetId]: { ...(d.configs[widgetId] ?? {}), ...patch },
            },
          })),
        ),

      ensureConfig: (widgetId, defaults) =>
        set((s) => {
          const active = s.dashboards.find((d) => d.id === s.activeId);
          if (!active || active.configs[widgetId]) return s;
          return patchActive(s, (d) => ({
            ...d,
            configs: { ...d.configs, [widgetId]: { ...defaults } },
          }));
        }),

      removeConfig: (widgetId) =>
        set((s) => {
          const active = s.dashboards.find((d) => d.id === s.activeId);
          if (!active || !active.configs[widgetId]) return s;
          return patchActive(s, (d) => {
            const next = { ...d.configs };
            delete next[widgetId];
            return { ...d, configs: next };
          });
        }),

      saveLayout: (layout, dashboardId) =>
        set((s) => {
          const targetId = dashboardId ?? s.activeId;
          return {
            dashboards: s.dashboards.map((d) =>
              d.id === targetId ? { ...d, layout } : d,
            ),
          };
        }),

      resetActiveLayout: () =>
        set((s) => patchActive(s, (d) => ({ ...d, layout: null, configs: {} }))),
    }),
    {
      name: "helm.workspace",
      version: 4,
      partialize: (s) => ({
        dashboards: s.dashboards,
        folders: s.folders,
        activeId: s.activeId,
      }),
      // Pre-v4 missed the "News & Social" seed dashboard and the showcase
      // desk layout — reseed so returning visitors see the full demo.
      migrate: (persisted, version) => {
        const fresh = {
          dashboards: SEED_DASHBOARDS,
          folders: SEED_FOLDERS,
          activeId: SEED_DASHBOARDS[0].id,
        };
        if (version < 4 || !persisted) return fresh;
        return persisted as typeof fresh;
      },
    },
  ),
);

// --- selectors ---------------------------------------------------------------

/** The currently-active dashboard (guaranteed to exist). */
export function useActiveDashboard(): Dashboard {
  return useWorkspace((s) => {
    return s.dashboards.find((d) => d.id === s.activeId) ?? s.dashboards[0];
  });
}
