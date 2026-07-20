import type { DomainState } from "../types";

export function StatusPill({ state }: { state: DomainState | string }) {
  const s = String(state);
  const cls =
    s === "healthy"
      ? "pill pillHealthy"
      : s === "warning"
        ? "pill pillWarning"
        : s === "critical"
          ? "pill pillCritical"
          : "pill pillUnknown";
  return <span className={cls}>{s.toUpperCase()}</span>;
}
