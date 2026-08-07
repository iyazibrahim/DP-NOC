import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DomainState } from "@/types";

/** High-contrast status chips for dark ops UI (readable on near-black cards). */
const stateStyles: Record<string, string> = {
  healthy:
    "border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_18%,#07090c)] text-[var(--success)]",
  warning:
    "border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_16%,#07090c)] text-[var(--warning)]",
  critical:
    "border-[color-mix(in_srgb,var(--destructive)_50%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_18%,#07090c)] text-[var(--destructive)]",
  unknown:
    "border-[rgba(148,163,184,0.45)] bg-[rgba(148,163,184,0.12)] text-[#c8d4de]"
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
      className={cn(
        "h-6 rounded-full px-2.5 font-mono text-[11px] font-bold uppercase tracking-wide",
        stateStyles[s] ?? stateStyles.unknown,
        className
      )}
    >
      {text}
    </Badge>
  );
}
