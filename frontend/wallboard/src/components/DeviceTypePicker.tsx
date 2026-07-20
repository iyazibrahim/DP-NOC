import { useEffect, useState } from "react";
import { getDeviceTypes } from "../api";
import type { DeviceKind } from "../types";

export type DeviceTypeOption = {
  id: string;
  label: string;
  kind: DeviceKind;
  icon?: string;
};

const VENDOR_PRESETS = ["generic", "cisco", "mikrotik", "ubiquiti", "tp-link", "hp", "dell", "fortinet"];

export function DeviceTypePicker({
  types,
  selectedTypeId,
  onSelectType,
  vendor,
  onVendorChange,
  onAddCustomType
}: {
  types: DeviceTypeOption[];
  selectedTypeId: string;
  onSelectType: (type: DeviceTypeOption) => void;
  vendor: string;
  onVendorChange: (vendor: string) => void;
  onAddCustomType: (label: string, kind: DeviceKind) => Promise<void>;
}) {
  const [customLabel, setCustomLabel] = useState("");
  const [customKind, setCustomKind] = useState<DeviceKind>("network");
  const [adding, setAdding] = useState(false);

  const selected = types.find((t) => t.id === selectedTypeId);

  async function submitCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customLabel.trim()) return;
    setAdding(true);
    try {
      await onAddCustomType(customLabel.trim(), customKind);
      setCustomLabel("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="deviceTypePicker">
      <label className="label">Device type</label>
      <div className="typeChipGrid">
        {types.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`typeChip ${selectedTypeId === t.id ? "active" : ""}`}
            onClick={() => onSelectType(t)}
          >
            <span className="typeChipIcon">{t.icon ?? "•"}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {selected ? (
        <p className="muted">
          Selected: <strong>{selected.label}</strong> ({selected.kind === "server" ? "host metrics" : "SNMP"})
        </p>
      ) : null}

      <form className="customTypeRow" onSubmit={submitCustom}>
        <input
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="Custom type (e.g. ups, pdu)"
        />
        <select value={customKind} onChange={(e) => setCustomKind(e.target.value as DeviceKind)}>
          <option value="network">Network</option>
          <option value="server">Server</option>
        </select>
        <button type="submit" disabled={adding || !customLabel.trim()}>
          Add type
        </button>
      </form>

      <label className="label">Vendor</label>
      <div className="typeChipGrid compact">
        {VENDOR_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            className={`typeChip ${vendor === v ? "active" : ""}`}
            onClick={() => onVendorChange(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <input
        value={vendor}
        onChange={(e) => onVendorChange(e.target.value)}
        placeholder="Or type vendor name"
      />
    </div>
  );
}

export function useDeviceTypes(token: string | null) {
  const [types, setTypes] = useState<DeviceTypeOption[]>([]);

  useEffect(() => {
    if (!token) return;
    getDeviceTypes(token).then((r) => setTypes(r.types));
  }, [token]);

  return { types, setTypes };
}
