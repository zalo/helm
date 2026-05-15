/**
 * Shared presentational primitives — OpenBB-style flat dark design system.
 */

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { arrow } from "@/lib/format";

type Tone = "neutral" | "gain" | "loss" | "accent" | "warn";

const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-bg-2 text-fg-muted border border-border",
  gain:    "bg-gain/12 text-gain border border-gain/25",
  loss:    "bg-loss/12 text-loss border border-loss/25",
  accent:  "bg-accent/12 text-accent border border-accent/25",
  warn:    "bg-warn/12 text-warn border border-warn/25",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-fg-faint",
  gain:    "bg-gain",
  loss:    "bg-loss",
  accent:  "bg-accent",
  warn:    "bg-warn",
};

/** Status/label chip. Optional leading color dot, with optional radar pulse. */
export function Pill({
  tone = "neutral",
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("chip whitespace-nowrap", TONE_CHIP[tone], className)}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
          {pulse && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full",
                TONE_DOT[tone],
                "animate-[radar-ping_1.4s_cubic-bezier(0,0,0.2,1)_infinite]",
              )}
            />
          )}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}

/** Numeric delta with directional arrow + P&L coloring. */
export function StatDelta({
  value,
  format,
  className,
}: {
  value: number | null | undefined;
  format: (n: number | null | undefined) => string;
  className?: string;
}) {
  const tone =
    value == null || value === 0
      ? "text-fg-muted"
      : value > 0
        ? "text-gain"
        : "text-loss";
  return (
    <span className={cn("num inline-flex items-center gap-1", tone, className)}>
      <span className="text-[10px] leading-none">{arrow(value)}</span>
      {format(value)}
    </span>
  );
}

/** Icon-only button — square, hairline, hover-raise. */
export function IconButton({
  className,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border",
        "bg-bg-2 text-fg-muted transition-colors hover:bg-bg-3 hover:text-fg hover:border-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active && "border-accent/40 bg-accent/15 text-accent",
        className,
      )}
      {...props}
    />
  );
}

/** Spinning loader glyph. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-accent", className)} />;
}

/**
 * Backdrop modal. Renders into a portal, dismisses on Esc + backdrop click.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg-0/75 p-8 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-1 shadow-panel"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="text-sm font-semibold text-fg">{title}</div>
            <IconButton onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
