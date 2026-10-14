import { useEffect, useMemo, useState } from "react";
import { Users, Wifi } from "lucide-react";
import { getSiteNetwork, STATUS_POLL_MS, type SiteNetworkSummary } from "@/api";
import type { Site } from "@/types";
import { StatusPill } from "@/components/StatusPill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TablePagination, paginateItems } from "@/components/TableControls";

type Props = {
  token: string;
  site: Site;
};

function apLabel(a: { label?: string; nickname?: string | null; name: string }): string {
  return (a.label || a.nickname || a.name).trim() || a.name;
}

function formatBitrate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbps`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  if (abs >= 1000) return `${(value / 1000).toFixed(1)} Kbps`;
  return `${Math.round(value)} bps`;
}

function dash(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  return String(v);
}

export function SiteClientsPanel({ token, site }: Props) {
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [apFilter, setApFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getSiteNetwork(token, site.id, 24);
        if (cancelled) return;
        setNetwork(res.network);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Clients load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, site.id]);

  useEffect(() => {
    setPage(1);
  }, [apFilter, search, site.id]);

  const aps = useMemo(() => {
    const rows = network?.aps?.length
      ? network.aps
      : (network?.clients.byDevice ?? []).map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          nickname: null as string | null,
          label: d.name,
          vendor: d.vendor,
          clients: d.clients,
          inBps: null as number | null,
          outBps: null as number | null,
          snmpUp: null as number | null
        }));
    return [...rows].sort((a, b) => (b.clients ?? -1) - (a.clients ?? -1));
  }, [network]);

  const stations = network?.stations ?? [];
  const total = network?.clients.total ?? null;
  const withCounts = aps.filter((a) => a.clients != null).length;
  const stationTotal = stations.length > 0 ? stations.length : total;

  const filteredStations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stations.filter((st) => {
      if (apFilter !== "all" && st.deviceId !== apFilter) return false;
      if (!q) return true;
      const hay = [st.hostname, st.mac, st.ip, st.ssid, st.apLabel, st.clientOs]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [stations, apFilter, search]);

  const pager = useMemo(() => paginateItems(filteredStations, page, 20), [filteredStations, page]);

  const omadaMacOnly = useMemo(() => {
    if (stations.length === 0) return false;
    return stations.every(
      (st) =>
        /omada|tplink/i.test(st.vendor || "") &&
        !st.hostname &&
        !st.ip &&
        st.txRate == null &&
        st.inBps == null &&
        st.outBps == null
    );
  }, [stations]);

  if (loading && !network) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="siteClientsPanel space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="websiteKpiStrip">
        <div className="healthChip">
          <span className="healthChipLabel inline-flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            Total clients
          </span>
          <strong className="healthChipValue">{stationTotal != null ? stationTotal : "—"}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel inline-flex items-center gap-1.5">
            <Wifi className="size-3.5" aria-hidden />
            Access points
          </span>
          <strong className="healthChipValue">{aps.length}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Reporting</span>
          <strong className="healthChipValue">
            {aps.length > 0 ? `${withCounts} / ${aps.length}` : "—"}
          </strong>
        </div>
      </div>

      <div className="tableCard">
        <div className="siteClientsToolbar">
          <div className="tableTitle" style={{ margin: 0 }}>
            Connected clients
          </div>
          <div className="siteClientsFilters">
            <label className="siteClientsFilter">
              <span className="muted text-sm">Access point</span>
              <select
                value={apFilter}
                onChange={(e) => setApFilter(e.target.value)}
                aria-label="Filter by access point"
              >
                <option value="all">All</option>
                {aps.map((a) => (
                  <option key={a.deviceId} value={a.deviceId}>
                    {apLabel(a)}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hostname, MAC, IP…"
              aria-label="Search clients"
              className="siteClientsSearch"
            />
          </div>
        </div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Hostname</th>
              <th>MAC</th>
              <th>IP</th>
              <th>Access point</th>
              <th>SSID</th>
              <th>SNR</th>
              <th>Link rate</th>
              <th>In</th>
              <th>Out</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  {stations.length === 0
                    ? "No connected clients reported yet."
                    : "No clients match this filter."}
                </td>
              </tr>
            ) : (
              pager.slice.map((st, i) => (
                <tr key={`${st.deviceId}-${st.mac ?? st.hostname ?? i}`}>
                  <td>
                    {dash(st.hostname)}
                    {st.clientOs ? <div className="muted">{st.clientOs}</div> : null}
                  </td>
                  <td>
                    <code style={{ fontSize: "0.85em" }}>{dash(st.mac)}</code>
                  </td>
                  <td>{dash(st.ip)}</td>
                  <td>{st.apLabel}</td>
                  <td>{dash(st.ssid)}</td>
                  <td>{st.snr != null ? st.snr : "—"}</td>
                  <td>{dash(st.txRate)}</td>
                  <td>{formatBitrate(st.inBps)}</td>
                  <td>{formatBitrate(st.outBps)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {omadaMacOnly ? (
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85em" }}>
            Omada/TP-Link SNMP only exposes client MAC (no hostname, SSID, SNR, link rate, or
            per-client In/Out). Those columns stay empty for Omada APs.
          </p>
        ) : null}
        <TablePagination
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          start={pager.start}
          end={pager.end}
          onPageChange={setPage}
        />
      </div>

      <div className="tableCard">
        <div className="tableTitle">By access point</div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Access point</th>
              <th>Vendor</th>
              <th>Clients</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {aps.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No access points yet. Add APs under Overview → Devices, then sync the collector.
                </td>
              </tr>
            ) : (
              aps.map((d) => (
                <tr key={d.deviceId}>
                  <td>
                    {apLabel(d)}
                    {d.nickname ? <div className="muted">{d.name}</div> : null}
                  </td>
                  <td>{d.vendor}</td>
                  <td>{d.clients != null ? d.clients : "—"}</td>
                  <td>
                    {d.snmpUp == null ? (
                      "—"
                    ) : (
                      <StatusPill
                        state={d.snmpUp >= 1 ? "healthy" : "critical"}
                        notes={d.snmpUp >= 1 ? "UP" : "DOWN"}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
