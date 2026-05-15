/**
 * Sidebar — OpenBB-style left navigation rail.
 *
 * Logo → primary actions (new dashboard, widget library, templates) → the
 * folder/dashboard tree → footer (collapse toggle, GitHub). Collapsible to an
 * icon-only rail.
 */

import { useState } from "react";
import {
  LayoutDashboard, Wallet, Globe, Bitcoin, Newspaper, Plus, FolderPlus,
  LayoutGrid, Sparkles, ChevronLeft, ChevronRight, ChevronDown,
  MoreHorizontal, Folder as FolderIcon, Github, Pencil, Copy, Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/lib/cn";

// --- dashboard icon resolution ----------------------------------------------

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Wallet, Globe, Bitcoin, Newspaper,
};
const iconFor = (name: string): LucideIcon => ICONS[name] ?? LayoutDashboard;

// --- per-dashboard row -------------------------------------------------------

function DashboardRow({
  id, name, icon, active, collapsed, onSelect,
}: {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const renameDashboard    = useWorkspace((s) => s.renameDashboard);
  const duplicateDashboard = useWorkspace((s) => s.duplicateDashboard);
  const deleteDashboard    = useWorkspace((s) => s.deleteDashboard);
  const total              = useWorkspace((s) => s.dashboards.length);
  const Icon = iconFor(icon);

  return (
    <div
      className={cn("group relative flex items-center", collapsed ? "justify-center" : "")}
    >
      <button
        type="button"
        onClick={onSelect}
        title={collapsed ? name : undefined}
        className={cn(
          "nav-row min-w-0 flex-1",
          active && "nav-row-active",
          collapsed && "justify-center px-0",
        )}
      >
        <Icon
          className={cn("h-4 w-4 flex-shrink-0", active ? "text-accent" : "text-fg-faint")}
        />
        {!collapsed && <span className="truncate">{name}</span>}
      </button>

      {!collapsed && (
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="absolute right-1 flex h-6 w-6 items-center justify-center rounded
            text-fg-faint opacity-0 transition-opacity hover:bg-bg-3 hover:text-fg
            group-hover:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      )}

      {menuOpen && !collapsed && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-1 top-8 z-50 w-40 overflow-hidden rounded-md border border-border-strong bg-bg-2 shadow-panel">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-fg-muted hover:bg-bg-3 hover:text-fg"
              onClick={() => {
                const next = window.prompt("Rename dashboard", name);
                if (next?.trim()) renameDashboard(id, next.trim());
                setMenuOpen(false);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-fg-muted hover:bg-bg-3 hover:text-fg"
              onClick={() => { duplicateDashboard(id); setMenuOpen(false); }}
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
            <button
              type="button"
              disabled={total <= 1}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-loss hover:bg-bg-3 disabled:opacity-40"
              onClick={() => {
                if (window.confirm(`Delete "${name}"?`)) deleteDashboard(id);
                setMenuOpen(false);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- sidebar -----------------------------------------------------------------

export function Sidebar({
  onOpenWidgets,
  onOpenTemplates,
}: {
  onOpenWidgets: () => void;
  onOpenTemplates: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const dashboards   = useWorkspace((s) => s.dashboards);
  const folders      = useWorkspace((s) => s.folders);
  const activeId     = useWorkspace((s) => s.activeId);
  const setActive    = useWorkspace((s) => s.setActiveDashboard);
  const createDash   = useWorkspace((s) => s.createDashboard);
  const createFolder = useWorkspace((s) => s.createFolder);

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(
    () => Object.fromEntries(folders.map((f) => [f.id, true])),
  );
  const toggleFolder = (id: string) =>
    setOpenFolders((s) => ({ ...s, [id]: !(s[id] ?? true) }));

  const ungrouped = dashboards.filter((d) => d.folderId === null);

  return (
    <aside
      className="flex flex-shrink-0 flex-col border-r border-border bg-bg-0 transition-[width] duration-200"
      style={{ width: collapsed ? 56 : 232 }}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-11 flex-shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "gap-2 px-3",
        )}
      >
        <img src="/helm.png" alt="Helm" className="h-6 w-6 flex-shrink-0" />
        {!collapsed && (
          <span className="text-sm font-bold tracking-tight text-fg">Helm</span>
        )}
      </div>

      {/* Primary actions */}
      <div className={cn("flex flex-col gap-0.5 py-2", collapsed ? "px-1.5" : "px-2")}>
        <button
          type="button"
          onClick={() => createDash("Untitled dashboard")}
          title="New dashboard"
          className={cn("nav-row", collapsed && "justify-center px-0")}
        >
          <Plus className="h-4 w-4 flex-shrink-0 text-fg-faint" />
          {!collapsed && <span>New dashboard</span>}
        </button>
        <button
          type="button"
          onClick={onOpenTemplates}
          title="Apps & templates"
          className={cn("nav-row", collapsed && "justify-center px-0")}
        >
          <Sparkles className="h-4 w-4 flex-shrink-0 text-fg-faint" />
          {!collapsed && <span>Apps &amp; templates</span>}
        </button>
        <button
          type="button"
          onClick={onOpenWidgets}
          title="Widget library"
          className={cn("nav-row", collapsed && "justify-center px-0")}
        >
          <LayoutGrid className="h-4 w-4 flex-shrink-0 text-fg-faint" />
          {!collapsed && <span>Widget library</span>}
        </button>
      </div>

      <div className="mx-2 border-t border-border" />

      {/* Dashboard tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-2xs font-semibold uppercase tracking-wider text-fg-faint">
              Dashboards
            </span>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt("New folder name", "New folder");
                if (name?.trim()) {
                  const id = createFolder(name.trim());
                  setOpenFolders((s) => ({ ...s, [id]: true }));
                }
              }}
              title="New folder"
              className="flex h-5 w-5 items-center justify-center rounded text-fg-faint hover:bg-bg-2 hover:text-fg"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className={cn("flex flex-col gap-0.5", collapsed ? "px-1.5" : "px-2")}>
          {folders.map((folder) => {
            const items = dashboards.filter((d) => d.folderId === folder.id);
            const open = openFolders[folder.id] ?? true;
            return (
              <div key={folder.id}>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-2xs
                      font-semibold uppercase tracking-wide text-fg-faint hover:bg-bg-2 hover:text-fg-muted"
                  >
                    {open ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <FolderIcon className="h-3 w-3" />
                    <span className="truncate">{folder.name}</span>
                    <span className="ml-auto text-fg-faint">{items.length}</span>
                  </button>
                )}
                {(open || collapsed) && (
                  <div className={cn(!collapsed && "ml-2 border-l border-border pl-1")}>
                    {items.map((d) => (
                      <DashboardRow
                        key={d.id}
                        id={d.id}
                        name={d.name}
                        icon={d.icon}
                        active={d.id === activeId}
                        collapsed={collapsed}
                        onSelect={() => setActive(d.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped dashboards */}
          {ungrouped.length > 0 && (
            <div className="mt-0.5">
              {ungrouped.map((d) => (
                <DashboardRow
                  key={d.id}
                  id={d.id}
                  name={d.name}
                  icon={d.icon}
                  active={d.id === activeId}
                  collapsed={collapsed}
                  onSelect={() => setActive(d.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className={cn(
          "flex flex-shrink-0 items-center border-t border-border py-2",
          collapsed ? "flex-col gap-1 px-1.5" : "gap-1 px-2",
        )}
      >
        <a
          href="https://github.com/sh1ftmaker/helm"
          target="_blank"
          rel="noreferrer"
          title="GitHub"
          className={cn("nav-row flex-1", collapsed && "flex-none justify-center px-0")}
        >
          <Github className="h-4 w-4 flex-shrink-0 text-fg-faint" />
          {!collapsed && <span className="text-xs">GitHub</span>}
        </a>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md
            border border-border bg-bg-2 text-fg-muted hover:bg-bg-3 hover:text-fg"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </aside>
  );
}
