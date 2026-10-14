import { useEffect, useMemo, useState } from "react";
import { Users, Wifi } from "lucide-react";
import { getSiteNetwork, STATUS_POLL_MS, type SiteNetworkSummary } from "@/api";
import type { Site } from "@/types";
import { StatusPill } from "@/components/StatusPill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  token: string;
  site: Site;
};

function apLabel(a: { label?: string; nickname?: string | null; name: string }): string {
  return (a.label || a.nickname || a.name).trim() || a.name;
}

export function SiteClientsPanel({ token, site }: Props) {
  const [network, setNetwork] = useState<SiteNetworkSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const total = network?.clients.total ?? null;
  const withCounts = aps.filter((a) => a.clients != null).length;

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
          <strong className="healthChipValue">{total != null ? total : "—"}</strong>
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

      <p className="muted text-sm" style={{ margin: 0 }}>
        Counts per access point from SNMP. A full list of each phone or laptop is planned next.
      </p>

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
                  No access points yet. Add APs under Overview → Devices (type <code>ap</code>), then
                  Force-apply the collector.
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
