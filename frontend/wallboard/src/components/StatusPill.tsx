import { StatusBadge } from "@/components/noc/StatusBadge";
import type { DomainState } from "@/types";

/** @deprecated Prefer StatusBadge — kept as alias for gradual migration. */
export function StatusPill({
  state,
  notes
}: {
  state: DomainState | string;
  notes?: string;
}) {
  return <StatusBadge state={state} notes={notes} />;
}
