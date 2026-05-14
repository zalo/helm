/**
 * App — composes the Topbar over the tiling Workspace in a full-height column.
 * Opens the WebSocket once on mount.
 *
 * Topbar and Workspace are siblings; they coordinate through the
 * `useWorkspaceController` store (Workspace publishes `addWidget` /
 * `resetLayout`, Topbar consumes them) — no prop drilling or refs across the tree.
 */

import { useEffect } from "react";
import { helmSocket } from "@/api/ws";
import { Topbar } from "@/workspace/Topbar";
import { Workspace } from "@/workspace/Workspace";

export default function App() {
  useEffect(() => {
    helmSocket.connect();
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg-0">
      <Topbar />
      <main className="min-h-0 flex-1">
        <Workspace />
      </main>
    </div>
  );
}
