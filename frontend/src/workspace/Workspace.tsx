/**
 * Workspace — the tiling canvas (dockview) for the active dashboard.
 *
 * Keyed on `activeId` so switching dashboards fully remounts the canvas. On
 * ready it restores that dashboard's saved layout, or builds a curated default
 * based on the dashboard's "kind" (derived from its name). Layout changes are
 * debounced and saved back to the dashboard the canvas was mounted with — never
 * the one you've since switched to.
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
import { useWorkspace, useActiveDashboard } from "@/store/workspace";
import { HelmPanel, type HelmPanelParams } from "./HelmPanel";

const COMPONENT = "helm-widget" as const;

// --- controller store: lets the shell reach into the live dockview api -------

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

// --- default layouts, one per dashboard "kind" -------------------------------

/** Map a dashboard name to a layout template. */
function layoutKind(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("risk") || n.includes("position")) return "risk";
  if (n.includes("macro") || n.includes("sentiment")) return "macro";
  if (n.includes("crypto")) return "crypto";
  if (n.includes("news") || n.includes("social")) return "news";
  if (n.includes("analyst")) return "ai";
  return "desk";
}

function buildDefaultLayout(api: DockviewApi, kind: string): void {
  const place = (
    type: string,
    position?: AddPanelPositionOptions,
  ): IDockviewPanel | null => {
    const def = getWidget(type);
    if (!def) return null;
    const id = crypto.randomUUID();
    return api.addPanel<HelmPanelParams>({
      id,
      component: COMPONENT,
      title: def.title,
      params: { widgetType: type, widgetId: id },
      ...(position ? { position } : {}),
    });
  };
  const below = (ref: IDockviewPanel | null) =>
    ref ? ({ referencePanel: ref, direction: "below" } as const) : undefined;
  const right = (ref: IDockviewPanel | null) =>
    ref ? ({ referencePanel: ref, direction: "right" } as const) : undefined;
  const within = (ref: IDockviewPanel | null) =>
    ref ? ({ referencePanel: ref, direction: "within" } as const) : undefined;

  switch (kind) {
    case "risk": {
      const positions = place("positions");
      const portfolio = place("portfolio", right(positions));
      place("pnl", below(portfolio));
      place("orders", below(positions));
      break;
    }
    case "macro": {
      const econ = place("econ-calendar");
      const wh = place("white-house", right(econ));
      const congress = place("congress-trades", below(econ));
      place("fear-greed", below(wh));
      void congress;
      break;
    }
    case "crypto": {
      const chart = place("chart");
      const fg = place("fear-greed", right(chart));
      const reddit = place("reddit", below(chart));
      place("hacker-news", below(fg));
      void reddit;
      break;
    }
    case "news": {
      const twitter = place("twitter-feed");
      const hn = place("hacker-news", right(twitter));
      const reddit = place("reddit", below(twitter));
      const sec = place("sec-edgar", below(hn));
      place("white-house", within(sec));
      void reddit;
      break;
    }
    case "ai": {
      const ai = place("ai-decision-feed");
      const portfolio = place("portfolio", right(ai));
      place("chart", below(portfolio));
      place("fear-greed", below(ai));
      break;
    }
    default: {
      // "desk" — the full command center.
      const chart = place("chart");
      const portfolio = place("portfolio", right(chart));
      place("ai-decision-feed", below(portfolio));
      const positions = place("positions", below(chart));
      place("orders", right(positions));
      place("pnl", within(positions));
      break;
    }
  }

  // Nothing matched (bundles still stubs) — drop in whatever exists.
  if (api.totalPanels === 0 && widgetRegistry.length > 0) {
    for (const def of widgetRegistry.slice(0, 4)) place(def.type);
  }
}

// --- component ---------------------------------------------------------------

export function Workspace() {
  const active = useActiveDashboard();
  return <WorkspaceCanvas key={active.id} dashboardId={active.id} dashboardName={active.name} />;
}

function WorkspaceCanvas({
  dashboardId,
  dashboardName,
}: {
  dashboardId: string;
  dashboardName: string;
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimer = useRef<number | null>(null);
  const unmounting = useRef(false);

  const saveLayout         = useWorkspace((s) => s.saveLayout);
  const removeConfig       = useWorkspace((s) => s.removeConfig);
  const resetActiveLayout  = useWorkspace((s) => s.resetActiveLayout);

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
    resetActiveLayout();
    if (!api) return;
    api.clear();
    buildDefaultLayout(api, layoutKind(dashboardName));
  }, [resetActiveLayout, dashboardName]);

  // Publish controls for the shell (Topbar, Sidebar, Copilot, palette).
  useEffect(() => {
    useWorkspaceController.setState({ addWidget, resetLayout, ready: true });
  }, [addWidget, resetLayout]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = useWorkspace
        .getState()
        .dashboards.find((d) => d.id === dashboardId)?.layout;

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
        buildDefaultLayout(api, layoutKind(dashboardName));
      }

      // Persist layout changes (debounced) back to *this* dashboard.
      api.onDidLayoutChange(() => {
        if (unmounting.current) return;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveLayout(api.toJSON(), dashboardId);
        }, 400);
      });

      // Drop a widget instance's config when its panel is closed by the user.
      api.onDidRemovePanel((panel) => {
        if (unmounting.current) return; // dashboard switch / app unmount
        const widgetId = (panel.params as HelmPanelParams | undefined)?.widgetId;
        if (widgetId) removeConfig(widgetId);
      });
    },
    [dashboardId, dashboardName, saveLayout, removeConfig],
  );

  // On unmount (dashboard switch or app close): flush a pending save, then
  // mark unmounting so disposal events from dockview are ignored.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        try {
          const api = apiRef.current;
          if (api) saveLayout(api.toJSON(), dashboardId);
        } catch {
          /* api already disposed — nothing to flush */
        }
      }
      unmounting.current = true;
    };
  }, [dashboardId, saveLayout]);

  return (
    <DockviewReact
      className="dockview-theme-helm h-full w-full"
      components={{ [COMPONENT]: HelmPanel }}
      onReady={onReady}
    />
  );
}
