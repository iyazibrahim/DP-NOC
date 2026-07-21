import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getDevices, getDiscoveredDevicesAll, getTopDevices } from "../api";
import type { DeviceRow, DiscoveredDevice, DiscoveryDiagnostics } from "../types";
import { TopDevicesTable } from "../components/TopDevicesTable";

function kindLabel(kind: string | undefined) {
  if (kind === "server") return "Collector / server";
  if (kind === "network") return "Local device";
  return kind ?? "—";
}

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
  const collectors = devices.filter((d) => (d.kind ?? "network") === "server");
  const localDevices = devices.filter((d) => (d.kind ?? "network") === "network");

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Devices</h1>
          <p className="pageSub">Collectors and local gear across all sites</p>
        </div>
      </div>

      <div className="healthStrip">
        <div className="healthChip">
          <span className="healthChipLabel">Collectors</span>
          <strong>{collectors.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Local devices</span>
          <strong>{localDevices.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Waiting to add</span>
          <strong>{pending.length}</strong>
        </div>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">New devices found</div>
        <div className="muted" style={{ marginBottom: 10 }}>
          {diagnostics?.plainSummary ??
            (diagnostics?.prometheusReachable === false
              ? "Cannot reach metrics storage."
              : "New collectors are added automatically within about a minute.")}
        </div>

        {pending.length === 0 ? (
          <div className="muted">Nothing waiting — collectors already registered or not sending data yet.</div>
        ) : (
          <table className="dataTable">
            <thead>
              <tr>
                <th>Site</th>
                <th>Name</th>
                <th>Type</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 10).map((d) => (
                <tr key={`${d.siteId ?? "unknown"}-${d.deviceId}`}>
                  <td>
                    {d.siteId ? <Link to={`/sites/${d.siteId}`}>{d.siteId}</Link> : "—"}
                  </td>
                  <td>
                    {d.suggestedName}
                    <div className="muted">{d.deviceId}</div>
                  </td>
                  <td>{kindLabel(d.kind)}</td>
                  <td className="muted">
                    {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {diagnostics?.labelMismatchHints?.length ? (
          <div className="calloutWarn" style={{ marginTop: 12 }}>
            <div className="tableTitle" style={{ marginBottom: 6 }}>
              Needs attention
            </div>
            <ul className="alertUl" style={{ paddingLeft: 18 }}>
              {diagnostics.labelMismatchHints.map((h, i) => (
                <li key={i}>{h}</li>
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
                <th>Type</th>
                <th>ID / address</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No devices yet. When a collector starts sending data, it should appear above and be added automatically.
                  </td>
                </tr>
              ) : (
                devices.map((d) => (
                  <tr key={`${d.siteId}-${d.id}`}>
                    <td>{d.name}</td>
                    <td>
                      <Link to={`/sites/${d.siteId}`}>{d.siteName}</Link>
                    </td>
                    <td>{kindLabel(d.kind)}</td>
                    <td>{d.kind === "server" ? d.hostMetricId ?? d.id : d.snmpIp ?? "—"}</td>
                    <td>{d.vendor}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
