/**
 * Workspace — the tiling desk built on dockview.
 *
 * - On ready: restore the persisted layout, or build a sensible default desk.
 * - Persists `api.toJSON()` (debounced) on any layout change.
 * - Cleans up a widget instance's config when its panel is removed.
 * - Publishes `addWidget` / `resetLayout` to a tiny controller store so the
 *   Topbar (a sibling, not a child) can drive the desk.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  DockviewReact,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanel,
} from "dockview";
import { create } from "zustand";
import { getWidget, widgetRegistry } from "@/widgets/registry";
import { useWorkspace } from "@/store/workspace";
import { HelmPanel, type HelmPanelParams } from "./HelmPanel";

const COMPONENT = "helm-widget" as const;

// --- controller store: lets the Topbar reach into the live dockview api ----

interface WorkspaceController {
  addWidget: (type: string) => void;
  resetLayout: () => void;
  ready: boolean;
}

export const useWorkspaceController = create<WorkspaceController>(() => ({
  addWidget: () => {},
  resetLayout: () => {},
  ready: false,
}));

// --- default desk ----------------------------------------------------------

/**
 * Starter desk. Widget bundles load in parallel, so this references types by
 * string; any type the registry doesn't have yet is silently skipped. Ordered
 * so the result still looks intentional even if some types are missing.
 */
function buildDefaultLayout(api: DockviewApi): void {
  // Add a panel only if its widget type is registered right now; fix up
  // params.widgetId to the real panel id once created.
  const place = (
    type: string,
    position?: AddPanelPositionOptions,
  ): IDockviewPanel | null => {
    const def = getWidget(type);
    if (!def) return null;
    const id = crypto.randomUUID();
    const panel = api.addPanel<HelmPanelParams>({
      id,
      component: COMPONENT,
      title: def.title,
      params: { widgetType: type, widgetId: id },
      ...(position ? { position } : {}),
    });
    return panel;
  };

  // Layout: chart top-left (big), portfolio top-right, AI feed right column,
  // positions + orders + exotic widget along the bottom.
  const chart = place("chart");
  const portfolio = place(
    "portfolio",
    chart ? { referencePanel: chart, direction: "right" } : undefined,
  );
  const aiAnchor = portfolio ?? chart;
  place(
    "ai-decision-feed",
    aiAnchor ? { referencePanel: aiAnchor, direction: "below" } : undefined,
  );
  const positions = place(
    "positions",
    chart ? { referencePanel: chart, direction: "below" } : undefined,
  );
  const bottomAnchor = positions ?? chart;
  place(
    "orders",
    bottomAnchor ? { referencePanel: bottomAnchor, direction: "right" } : undefined,
  );

  // One exotic widget tabbed alongside Positions so it shares the same panel
  // group rather than floating over it.
  const exoticType = ["fear-greed", "twitter-feed", "hacker-news", "white-house"].find(
    (t) => getWidget(t),
  );
  if (exoticType && bottomAnchor) {
    place(exoticType, { referencePanel: bottomAnchor, direction: "within" });
  }

  // Nothing matched (all bundles still stubs) — drop in whatever exists so the
  // desk is never blank.
  if (api.totalPanels === 0 && widgetRegistry.length > 0) {
    for (const def of widgetRegistry.slice(0, 4)) place(def.type);
  }
}

// --- component -------------------------------------------------------------

export function Workspace() {
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Read store actions imperatively — avoids re-rendering on layout changes.
  const saveLayout = useWorkspace((s) => s.saveLayout);
  const removeConfig = useWorkspace((s) => s.removeConfig);
  const resetLayoutStore = useWorkspace((s) => s.resetLayout);

  const addWidget = useCallback((type: string) => {
    const api = apiRef.current;
    if (!api) return;
    const def = getWidget(type);
    if (!def) return;
    const id = crypto.randomUUID();
    api.addPanel<HelmPanelParams>({
      id,
      component: COMPONENT,
      title: def.title,
      params: { widgetType: type, widgetId: id },
    });
  }, []);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    resetLayoutStore();
    if (!api) return;
    api.clear();
    buildDefaultLayout(api);
  }, [resetLayoutStore]);

  // Publish controls for the Topbar.
  useEffect(() => {
    useWorkspaceController.setState({ addWidget, resetLayout, ready: true });
  }, [addWidget, resetLayout]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = useWorkspace.getState().layout;
      let restored = false;
      if (saved) {
        try {
          api.fromJSON(saved as Parameters<DockviewApi["fromJSON"]>[0]);
          restored = api.totalPanels > 0;
        } catch (err) {
          console.error("[Workspace] failed to restore layout, rebuilding", err);
        }
      }
      if (!restored) {
        api.clear();
        buildDefaultLayout(api);
      }

      // Persist any layout change, debounced.
      api.onDidLayoutChange(() => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveLayout(api.toJSON());
        }, 400);
      });

      // Drop instance config when a panel is closed for good.
      api.onDidRemovePanel((panel) => {
        const widgetId = (panel.params as HelmPanelParams | undefined)?.widgetId;
        if (widgetId) removeConfig(widgetId);
      });
    },
    [saveLayout, removeConfig],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <DockviewReact
      className="dockview-theme-helm h-full w-full"
      components={{ [COMPONENT]: HelmPanel }}
      onReady={onReady}
    />
  );
}
