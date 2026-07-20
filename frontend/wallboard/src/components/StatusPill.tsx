import type { DomainState } from "../types";

export function StatusPill({
  state,
  notes
}: {
  state: DomainState | string;
  notes?: string;
}) {
  const s = String(state);
  const cls =
    s === "healthy"
      ? "pill pillHealthy"
      : s === "warning"
        ? "pill pillWarning"
        : s === "critical"
          ? "pill pillCritical"
          : "pill pillUnknown";
  const label = s === "critical" ? "DOWN" : s.toUpperCase();
  return (
    <span className={cls} title={notes}>
      {label}
    </span>
  );
}
