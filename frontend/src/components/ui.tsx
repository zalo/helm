/**
 * Shared presentational primitives — kept deliberately small and consistent
 * with the tokens / component classes in `theme.css` + `tailwind.config.js`.
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
  gain: "bg-gain/15 text-gain border border-gain/30",
  loss: "bg-loss/15 text-loss border border-loss/30",
  accent: "bg-accent/15 text-accent border border-accent/30",
  warn: "bg-warn/15 text-warn border border-warn/30",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-fg-faint",
  gain: "bg-gain",
  loss: "bg-loss",
  accent: "bg-accent",
  warn: "bg-warn",
};

/** Small status/label chip. Optional leading color dot. */
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
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            TONE_DOT[tone],
            pulse && "animate-pulse",
          )}
        />
      )}
      {children}
    </span>
  );
}

/** A numeric delta with directional arrow + P&L coloring. */
export function StatDelta({
  value,
  format,
  className,
}: {
  value: number | null | undefined;
  /** Render the magnitude however the caller wants (money/pct/num). */
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
        "inline-flex h-7 w-7 items-center justify-center rounded border border-border",
        "bg-bg-2 text-fg-muted transition-colors hover:bg-bg-3 hover:text-fg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active && "border-accent/40 bg-accent/15 text-accent",
        className,
      )}
      {...props}
    />
  );
}

/** Spinning loader glyph. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

/**
 * Backdrop modal. Renders into a portal, dismisses on Esc + backdrop click,
 * locks body scroll while open.
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-8 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-border-strong bg-bg-1 shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
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
