import { useState } from "react";
import { Modal } from "@/components/Modal";
import { StatusPill } from "@/components/StatusPill";
import { connectivityState, statusWord } from "@/statusLabels";
import type { DomainStatus } from "@/types";

const CHECKS = [
  {
    key: "probe" as const,
    label: "Probe",
    detail: "The monitoring box at this site. Up means it is still reporting."
  },
  {
    key: "internet" as const,
    label: "Internet",
    detail: "Checks from that box to DNS and to the central server."
  }
];

export function ConnectivityStatus({
  probe,
  internet,
  variant = "tile"
}: {
  probe?: DomainStatus | null;
  internet?: DomainStatus | null;
  variant?: "tile" | "pill";
}) {
  const [open, setOpen] = useState(false);
  const probeState = probe?.state ?? "unknown";
  const internetState = internet?.state ?? "unknown";
  const state = connectivityState(probeState, internetState);
  const failing = CHECKS.filter((check) => {
    const row = check.key === "probe" ? probeState : internetState;
    return row !== "healthy";
  });

  return (
    <>
      {variant === "tile" ? (
        <button
          type="button"
          className={`healthMini healthMiniButton healthMini--${state}`}
          onClick={() => setOpen(true)}
        >
          <span className="healthMiniLabel">Connectivity</span>
          <strong>{statusWord(state)}</strong>
          <span className="muted">{failing.length === 0 ? "Probe and internet" : "Details"}</span>
        </button>
      ) : (
        <button type="button" className="statusPillButton" onClick={() => setOpen(true)}>
          <StatusPill state={state} />
        </button>
      )}
      <Modal open={open} title="Connectivity" onClose={() => setOpen(false)}>
        <p className="muted" style={{ marginTop: 0 }}>
          Connectivity is up only when the probe and the internet checks are both up.
          {failing.length > 0
            ? ` Failing: ${failing.map((check) => check.label).join(" and ")}.`
            : " Both checks are up."}
        </p>
        <div className="connectivityList">
          {CHECKS.map((check) => {
            const row = check.key === "probe" ? probe : internet;
            return (
              <div key={check.key} className="connectivityRow">
                <div>
                  <div className="connectivityRowLabel">{check.label}</div>
                  <p className="muted">{row?.notes || check.detail}</p>
                </div>
                <StatusPill state={row?.state ?? "unknown"} />
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
