import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DomainState } from "@/types";

const stateStyles: Record<string, string> = {
  healthy: "border-transparent bg-[color-mix(in_srgb,var(--success)_22%,transparent)] text-[var(--success)]",
  warning: "border-transparent bg-[color-mix(in_srgb,var(--warning)_22%,transparent)] text-[var(--warning)]",
  critical: "border-transparent bg-destructive/20 text-destructive",
  unknown: "border-transparent bg-muted text-muted-foreground"
};

export function StatusBadge({
  state,
  notes,
  label,
  className
}: {
  state: DomainState | string;
  notes?: string;
  label?: string;
  className?: string;
}) {
  const s = String(state);
  const text = label ?? (s === "critical" ? "DOWN" : s.toUpperCase());
  return (
    <Badge
      variant="outline"
      title={notes}
      className={cn(stateStyles[s] ?? stateStyles.unknown, "font-semibold uppercase tracking-wide", className)}
    >
      {text}
    </Badge>
  );
}
