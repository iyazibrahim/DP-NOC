import type { DomainState } from "../types";

export function StatusPill({ state }: { state: DomainState }) {
  const cls =
    state === "healthy"
      ? "pill pillHealthy"
      : state === "warning"
        ? "pill pillWarning"
        : state === "critical"
          ? "pill pillCritical"
          : "pill pillUnknown";

  const label = state === "healthy" ? "GREEN" : state === "warning" ? "AMBER" : state === "critical" ? "RED" : "GRAY";
  return <span className={cls}>{label}</span>;
}

