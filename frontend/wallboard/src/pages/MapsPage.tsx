import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useCommandCenter } from "@/commandCenter/CommandCenterContext";
import {
  getAllSiteStatuses,
  getRecentAlerts,
  getSites,
  getTopDevices,
  STATUS_POLL_MS
} from "@/api";
import type { ActiveAlert, DeviceRow, Site, SiteStatus } from "@/types";
import { SitesLeafletMap } from "@/components/SitesLeafletMap";
import { MapsOpsRail } from "@/components/MapsOpsRail";
import { PageHeader } from "@/components/noc/PageHeader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function MapsPage() {
  const { token } = useAuth();
  const { active: commandCenter, enter: enterCommandCenter } = useCommandCenter();
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [s, st, top, al] = await Promise.all([
          getSites(token),
          getAllSiteStatuses(token),
          getTopDevices(token),
          getRecentAlerts(token, 30).catch(() => ({ alerts: [] as ActiveAlert[] }))
        ]);
        if (cancelled) return;
        setSites(s.sites);
        setStatuses(st.statuses);
        setDevices(top.devices);
        setAlerts(al.alerts ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className={`page${commandCenter ? " page--commandCenter" : ""}`}>
      {!commandCenter ? (
        <PageHeader
          title="Maps"
          subtitle="Site geography, uplink, and alert hotspots"
          actions={
            <Button type="button" variant="outline" onClick={() => void enterCommandCenter()}>
              Fullscreen
            </Button>
          }
        />
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mapPageLayout">
        <div className="mapPane">
          <SitesLeafletMap
            sites={sites}
            statuses={statuses}
            height="100%"
            selectedSiteId={selectedSiteId}
            onSelectSite={setSelectedSiteId}
          />
        </div>
        <MapsOpsRail
          sites={sites}
          statuses={statuses}
          devices={devices}
          alerts={alerts}
          selectedSiteId={selectedSiteId}
          onSelectSite={setSelectedSiteId}
        />
      </div>
    </div>
  );
}
