import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  getAllSiteStatuses,
  getDevices,
  getDiscoveredDevicesAll,
  getTopDevices,
  STATUS_POLL_MS
} from "../api";
import type { DeviceRow, DiscoveredDevice, DiscoveryDiagnostics, DomainState, SiteStatus } from "../types";
import { TopDevicesTable } from "../components/TopDevicesTable";
import { StatusPill } from "../components/StatusPill";

function kindLabel(kind: string | undefined) {
  if (kind === "server") return "Collector / server";
  if (kind === "network") return "Local device";
  return kind ?? "—";
}

function snmpStateForDevice(
  statuses: SiteStatus[],
  siteId: string,
  deviceId: string
): { state: DomainState; notes?: string } {
  const st = statuses.find((s) => s.siteId === siteId);
  const row = st?.localDeviceStates?.find((d) => d.deviceId === deviceId);
  if (row) return { state: row.state, notes: row.notes };
  return { state: "unknown", notes: "No SNMP status yet" };
}

function collectorStateForDevice(
  statuses: SiteStatus[],
  siteId: string,
  deviceId: string
): { state: DomainState; notes?: string; live: boolean } {
  const st = statuses.find((s) => s.siteId === siteId);
  const row = st?.collectorDeviceStates?.find((d) => d.deviceId === deviceId);
  if (row) return { state: row.state, notes: row.notes, live: row.live };
  return { state: st?.collector?.state ?? "unknown", notes: st?.collector?.notes, live: false };
}

export function DevicesPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [top, setTop] = useState<DeviceRow[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiscoveryDiagnostics | null>(null);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      const [d, t, disc, st] = await Promise.all([
        getDevices(token),
        getTopDevices(token),
        getDiscoveredDevicesAll(token),
        getAllSiteStatuses(token)
      ]);
      if (cancelled) return;
      setDevices(d.devices);
      setTop(t.devices);
      setDiscovered(disc.devices);
      setDiagnostics(disc.diagnostics);
      setStatuses(st.statuses);
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  const pending = discovered.filter((d) => !d.alreadyRegistered);
  const collectors = devices.filter((d) => (d.kind ?? "network") === "server");
  const localDevices = devices.filter((d) => (d.kind ?? "network") === "network");
  const hasDiagError =
    diagnostics?.prometheusReachable === false ||
    (diagnostics?.labelMismatchHints?.length ?? 0) > 0;
  const showDiscovery = pending.length > 0 || hasDiagError;

  const missingSnmpIp = useMemo(
    () => localDevices.filter((d) => !d.snmpIp).length,
    [localDevices]
  );

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

      {missingSnmpIp > 0 ? (
        <div className="bannerHint" style={{ marginBottom: 14 }}>
          {missingSnmpIp} local device{missingSnmpIp === 1 ? "" : "s"} missing an SNMP IP — the
          collector cannot poll them until an IP is set. After saving, collectors sync inventory
          within ~1–2 minutes.
        </div>
      ) : localDevices.length > 0 ? (
        <p className="muted" style={{ marginBottom: 14 }}>
          SNMP status refreshes every {STATUS_POLL_MS / 1000}s. Collectors pull device inventory
          every 1–2 minutes.
        </p>
      ) : null}

      {!showDiscovery && pending.length === 0 ? (
        <p className="muted" style={{ marginBottom: 14 }}>
          All collectors registered
        </p>
      ) : null}

      {showDiscovery ? (
        <div className="tableCard" style={{ marginBottom: 14 }}>
          <div className="tableTitle">New devices found</div>
          {diagnostics?.prometheusReachable === false ? (
            <div className="muted" style={{ marginBottom: 10 }}>
              {diagnostics.plainSummary ?? "Cannot reach metrics storage."}
            </div>
          ) : null}

          {pending.length > 0 ? (
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Last seen</th>
                  <th></th>
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
                    <td>
                      {d.siteId ? (
                        <Link to={`/sites/${d.siteId}`}>Open site</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

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
      ) : null}

      {collectors.filter((c) => {
        const h = collectorStateForDevice(statuses, c.siteId, c.id);
        return !h.live && collectors.some((x) => x.siteId === c.siteId && x.id !== c.id);
      }).length > 0 ? (
        <div className="bannerHint" style={{ marginBottom: 14 }}>
          Some sites have more than one collector inventory row. Keep the one marked{" "}
          <strong>Live</strong> (healthy metrics); remove the stale duplicate on the site page.
        </div>
      ) : null}

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
                <th>Health</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No devices yet. When a collector starts sending data, it should appear and be
                    added automatically.
                  </td>
                </tr>
              ) : (
                devices.map((d) => {
                  const isServer = (d.kind ?? "network") === "server";
                  const snmp = !isServer
                    ? snmpStateForDevice(statuses, d.siteId, d.id)
                    : null;
                  const collector = isServer
                    ? collectorStateForDevice(statuses, d.siteId, d.id)
                    : null;
                  return (
                    <tr key={`${d.siteId}-${d.id}`}>
                      <td>
                        {d.name}
                        {collector?.live ? (
                          <span className="liveBadge" title="Receiving host metrics">
                            Live
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <Link to={`/sites/${d.siteId}`}>{d.siteName}</Link>
                      </td>
                      <td>{kindLabel(d.kind)}</td>
                      <td>
                        {isServer ? d.hostMetricId ?? d.id : d.snmpIp ?? "—"}
                        {!isServer && !d.snmpIp ? (
                          <div className="muted">Needs SNMP IP</div>
                        ) : null}
                      </td>
                      <td>
                        {snmp ? (
                          <StatusPill state={snmp.state} notes={snmp.notes} />
                        ) : collector ? (
                          <StatusPill state={collector.state} notes={collector.notes} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{d.vendor}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
