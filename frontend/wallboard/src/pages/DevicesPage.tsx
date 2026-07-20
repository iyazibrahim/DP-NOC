import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getDevices, getDiscoveredDevicesAll, getTopDevices } from "../api";
import type { DeviceRow, DiscoveredDevice, DiscoveryDiagnostics } from "../types";
import { TopDevicesTable } from "../components/TopDevicesTable";

export function DevicesPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [top, setTop] = useState<DeviceRow[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiscoveryDiagnostics | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([getDevices(token), getTopDevices(token), getDiscoveredDevicesAll(token)]).then(
      ([d, t, disc]) => {
        setDevices(d.devices);
        setTop(t.devices);
        setDiscovered(disc.devices);
        setDiagnostics(disc.diagnostics);
      }
    );
  }, [token]);

  const pending = discovered.filter((d) => !d.alreadyRegistered);
  const discoveredCount = discovered.length;

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Devices</h1>
          <p className="pageSub">Inventory across all sites</p>
        </div>
      </div>
      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Discovered (Prometheus)</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          {diagnostics?.prometheusReachable === false
            ? "Prometheus discovery is unreachable."
            : "Auto-sync should register pending devices within ~1 minute."}{" "}
          {discoveredCount > 0 ? `(${discoveredCount} discovered)` : null}
        </div>

        {pending.length === 0 ? (
          <div className="muted">No pending devices.</div>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>Site</th>
                <th>Device</th>
                <th>Kind</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 10).map((d) => (
                <tr key={`${d.siteId ?? "unknown"}-${d.deviceId}`}>
                  <td>{d.siteId ?? "—"}</td>
                  <td>
                    {d.suggestedName}
                    <div className="muted">{d.deviceId}</div>
                  </td>
                  <td>{d.kind}</td>
                  <td className="muted">
                    {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {diagnostics?.labelMismatchHints?.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="tableTitle" style={{ marginBottom: 6 }}>
              Label mismatch hints
            </div>
            <ul className="alertUl" style={{ paddingLeft: 18 }}>
              {diagnostics.labelMismatchHints.map((h, i) => (
                <li key={i} className="muted">
                  {h}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="detailGrid">
        <TopDevicesTable devices={top} />
        <div className="tableCard">
          <div className="tableTitle">All devices</div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Site</th>
                <th>Kind</th>
                <th>Target</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={`${d.siteId}-${d.id}`}>
                  <td>{d.name}</td>
                  <td>{d.siteName}</td>
                  <td>{d.kind ?? "network"}</td>
                  <td>{d.kind === "server" ? d.hostMetricId ?? d.id : d.snmpIp ?? "—"}</td>
                  <td>{d.vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
