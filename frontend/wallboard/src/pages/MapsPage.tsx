import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getAllSiteStatuses, getSites, getTopDevices } from "../api";
import type { DeviceRow, Site, SiteStatus } from "../types";
import { SitesLeafletMap } from "../components/SitesLeafletMap";
import { TopDevicesTable } from "../components/TopDevicesTable";

export function MapsPage() {
  const { token } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [s, st, top] = await Promise.all([
          getSites(token),
          getAllSiteStatuses(token),
          getTopDevices(token)
        ]);
        if (cancelled) return;
        setSites(s.sites);
        setStatuses(st.statuses);
        setDevices(top.devices);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Maps</h1>
          <p className="pageSub">Site geography and alert hotspots</p>
        </div>
      </div>
      {error && <div className="bannerError">{error}</div>}
      <div className="mapPageLayout">
        <div className="mapPane">
          <SitesLeafletMap sites={sites} statuses={statuses} height="100%" />
        </div>
        <TopDevicesTable devices={devices} />
      </div>
    </div>
  );
}
