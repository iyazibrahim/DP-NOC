import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function darkTooltipProps(): {
  contentStyle: CSSProperties;
  labelStyle: CSSProperties;
  itemStyle: CSSProperties;
} {
  return {
    contentStyle: {
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      color: "var(--foreground)"
    },
    labelStyle: { color: "var(--muted-foreground)" },
    itemStyle: { color: "var(--foreground)" }
  };
}

export function formatPct(value: number | string | null | undefined, digits = 1): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatMs(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)} ms`;
}

/** Availability series is often 0–1; show as percent with 1 decimal. */
export function formatAvailabilityRatio(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  const pct = n <= 1.0001 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

export function MetricChartFrame({
  title,
  children,
  className,
  actions
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}
