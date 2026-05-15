/**
 * WidgetFrame — chrome every widget renders inside.
 * Glass header with gradient edge highlight. Error boundary isolates crashes.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui";

// --- centered-state helpers --------------------------------------------------

function CenteredState({
  icon: Icon,
  title,
  detail,
  tone = "muted",
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  detail?: ReactNode;
  tone?: "muted" | "loss";
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <Icon
        className={cn("h-6 w-6", tone === "loss" ? "text-loss" : "text-fg-faint")}
      />
      <div className={cn("text-sm font-medium", tone === "loss" ? "text-loss" : "text-fg-muted")}>
        {title}
      </div>
      {detail != null && (
        <div className="max-w-[280px] text-xs text-fg-faint">{detail}</div>
      )}
      {action}
    </div>
  );
}

export function WidgetLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-faint">
      <Spinner />
      <div className="text-xs text-fg-faint">{label}</div>
    </div>
  );
}

export function WidgetEmpty({
  title = "Nothing here yet",
  detail,
}: {
  title?: ReactNode;
  detail?: ReactNode;
}) {
  return <CenteredState icon={Inbox} title={title} detail={detail} />;
}

export function WidgetError({
  title = "Something went wrong",
  detail,
  onRetry,
}: {
  title?: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <CenteredState
      icon={AlertTriangle}
      tone="loss"
      title={title}
      detail={detail}
      action={
        onRetry && (
          <button type="button" className="btn mt-1" onClick={onRetry}>
            <RotateCw className="h-3.5 w-3.5" />
            Reload widget
          </button>
        )
      }
    />
  );
}

// --- error boundary ----------------------------------------------------------

interface BoundaryProps  { children: ReactNode }
interface BoundaryState  { error: Error | null }

class WidgetErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[WidgetFrame] widget crashed:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      return (
        <WidgetError
          title="Widget crashed"
          detail={this.state.error.message}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

// --- frame -------------------------------------------------------------------

export function WidgetFrame({
  icon: Icon,
  title,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-bg-1">
      {/* Flat panel header — thin border, restrained (OpenBB-style) */}
      <header className="flex h-7 flex-shrink-0 items-center gap-1.5 border-b border-border bg-bg-2 px-2.5">
        {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0 text-fg-faint" />}
        <span className="truncate text-xs font-semibold text-fg">{title}</span>
        {actions != null && (
          <div className="ml-auto flex items-center gap-1">{actions}</div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WidgetErrorBoundary>{children}</WidgetErrorBoundary>
      </div>
    </div>
  );
}
