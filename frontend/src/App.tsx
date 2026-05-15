/**
 * App — the OpenBB-style shell.
 *
 * Desktop: Sidebar │ ( Topbar / Workspace canvas / Copilot panel ).
 * Mobile:  Topbar / MobileView (bottom-tab layout).
 *
 * Cmd/Ctrl+K opens the command palette. The Copilot is a slide-in right panel.
 */

import { useEffect, useState } from "react";
import { helmSocket } from "@/api/ws";
import { Topbar } from "@/workspace/Topbar";
import { Workspace } from "@/workspace/Workspace";
import { MobileView } from "@/workspace/MobileView";
import { Sidebar } from "@/components/Sidebar";
import { CopilotPanel } from "@/components/CopilotPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { TemplatesModal } from "@/components/TemplatesModal";
import { WidgetCatalog } from "@/workspace/WidgetCatalog";
import { useIsMobile } from "@/hooks/useMediaQuery";

export default function App() {
  const isMobile = useIsMobile();
  const [copilotOpen, setCopilotOpen]     = useState(false);
  const [paletteOpen, setPaletteOpen]     = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen]     = useState(false);

  useEffect(() => {
    helmSocket.connect();
  }, []);

  // Cmd/Ctrl+K → command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- mobile: simplified single-column shell ---
  if (isMobile) {
    return (
      <div className="flex h-full flex-col bg-bg-0">
        <Topbar
          isMobile
          copilotOpen={copilotOpen}
          onToggleCopilot={() => setCopilotOpen((v) => !v)}
        />
        <main className="min-h-0 flex-1">
          {copilotOpen ? (
            <CopilotPanel fullWidth onClose={() => setCopilotOpen(false)} />
          ) : (
            <MobileView />
          )}
        </main>
      </div>
    );
  }

  // --- desktop: full OpenBB-style shell ---
  return (
    <div className="flex h-full bg-bg-0">
      <Sidebar
        onOpenWidgets={() => setWidgetsOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          copilotOpen={copilotOpen}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenWidgets={() => setWidgetsOpen(true)}
          onToggleCopilot={() => setCopilotOpen((v) => !v)}
        />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <Workspace />
          </main>
          {copilotOpen && <CopilotPanel onClose={() => setCopilotOpen(false)} />}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onToggleCopilot={() => setCopilotOpen((v) => !v)}
      />
      <TemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
      <WidgetCatalog open={widgetsOpen} onClose={() => setWidgetsOpen(false)} />
    </div>
  );
}
