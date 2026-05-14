/**
 * HelmPanel — the single dockview component ("component map of one").
 *
 * Every panel in the workspace is a `helm-widget`. This reads the panel's
 * params (`{ widgetType, widgetId }`), resolves the `WidgetDefinition` from the
 * registry, seeds + subscribes to that instance's config, and renders the
 * widget inside `<WidgetFrame>`. Unknown widget types fail soft.
 */

import { useCallback, useMemo } from "react";
import type { IDockviewPanelProps } from "dockview";
import { HelpCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getWidget } from "@/widgets/registry";
import type { WidgetProps } from "@/widgets/types";
import { useWorkspace } from "@/store/workspace";
import { WidgetError, WidgetFrame } from "./WidgetFrame";

export interface HelmPanelParams {
  widgetType: string;
  widgetId: string;
}

export function HelmPanel(props: IDockviewPanelProps<HelmPanelParams>) {
  const { widgetType, widgetId } = props.params;
  const def = useMemo(() => getWidget(widgetType), [widgetType]);

  const ensureConfig = useWorkspace((s) => s.ensureConfig);
  const setConfigRaw = useWorkspace((s) => s.setConfig);

  // Seed defaults once (idempotent in the store) before first render uses them.
  if (def) ensureConfig(widgetId, def.defaultConfig as Record<string, unknown>);

  // Subscribe only to this instance's config slice.
  const config = useWorkspace(
    useShallow((s) => s.configs[widgetId] ?? def?.defaultConfig ?? {}),
  );

  const setConfig = useCallback<WidgetProps["setConfig"]>(
    (patch) => setConfigRaw(widgetId, patch as Record<string, unknown>),
    [setConfigRaw, widgetId],
  );

  if (!def) {
    return (
      <WidgetFrame icon={HelpCircle} title="Unknown widget">
        <WidgetError
          title="Unknown widget type"
          detail={`No widget registered for "${widgetType}". It may belong to a bundle that isn't loaded.`}
        />
      </WidgetFrame>
    );
  }

  const WidgetComponent = def.component;
  return (
    <WidgetFrame icon={def.icon} title={def.title}>
      <WidgetComponent widgetId={widgetId} config={config} setConfig={setConfig} />
    </WidgetFrame>
  );
}
