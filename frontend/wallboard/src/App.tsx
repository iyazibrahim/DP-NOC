import { useEffect, useMemo, useRef, useState } from "react";
import type { ActiveAlert, DomainState, Site, SiteStatus } from "./types";
import { login, getAllSites, getAllSiteStatuses, getRecentAlerts } from "./api";
import { SiteMap } from "./components/SiteMap";
import { SiteDetailPanel } from "./components/SiteDetailPanel";
import { AlertTicker } from "./components/AlertTicker";
import { StatusPill } from "./components/StatusPill";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.toString() ?? "http://localhost:8080";
const grafanaUrl =
  import.meta.env.VITE_GRAFANA_URL?.toString() ?? "http://localhost:3000";
const grafanaDashboardUrl =
  import.meta.env.VITE_GRAFANA_DASHBOARD_URL?.toString() ?? grafanaUrl;

const wallboardUsername = import.meta.env.VITE_WALLBOARD_USERNAME?.toString() ?? "";
const wallboardPassword = import.meta.env.VITE_WALLBOARD_PASSWORD?.toString() ?? "";

const REFRESH_MS = 10_000;
const ALERTS_LIMIT = 12;

function safeNow(ts: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function projectStatusesWithSiteMeta(sites: Site[], statuses: SiteStatus[]) {
  const byId = new Map(sites.map((s) => [s.id, s]));
  return statuses.map((st) => {
    const site = byId.get(st.siteId);
    return {
      ...st,
      lat: site?.lat,
      lng: site?.lng
    };
  });
}

function overallFallback(statuses: SiteStatus[]): DomainState {
  const hasCritical = statuses.some((s) => s.overall === "critical");
  if (hasCritical) return "critical";
  const hasWarn = statuses.some((s) => s.overall === "warning");
  if (hasWarn) return "warning";
  if (statuses.length === 0) return "unknown";
  return "healthy";
}

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);

  const selectedSiteIdRef = useRef<string | null>(null);
  selectedSiteIdRef.current = selectedSiteId;

  const [loginUser, setLoginUser] = useState<string>(wallboardUsername || "admin");
  const [loginPass, setLoginPass] = useState<string>(wallboardPassword || "admin");

  const statusesWithMeta = useMemo(
    () => projectStatusesWithSiteMeta(sites, statuses),
    [sites, statuses]
  );

  const selectedSite = useMemo(() => {
    if (!selectedSiteId) return null;
    return sites.find((s) => s.id === selectedSiteId) ?? null;
  }, [sites, selectedSiteId]);

  const selectedStatus = useMemo(() => {
    if (!selectedSiteId) return null;
    return statuses.find((s) => s.siteId === selectedSiteId) ?? null;
  }, [statuses, selectedSiteId]);

  const relatedAlerts = useMemo(() => {
    if (!selectedSiteId) return [];
    return alerts.filter((a) => (a.labels?.site ?? "") === selectedSiteId);
  }, [alerts, selectedSiteId]);

  const overall = useMemo(() => overallFallback(statuses), [statuses]);

  useEffect(() => {
    let cancelled = false;
    const hasAutoCreds = Boolean(wallboardUsername && wallboardPassword);
    if (!hasAutoCreds) return;

    setIsAuthLoading(true);
    login(apiBaseUrl, wallboardUsername, wallboardPassword)
      .then((r) => {
        if (cancelled) return;
        setToken(r.token);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setIsAuthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    const refresh = async () => {
      const t = selectedSiteIdRef.current;
      try {
        const [sitesResp, statusesResp, alertsResp] = await Promise.all([
          getAllSites(apiBaseUrl, token),
          getAllSiteStatuses(apiBaseUrl, token),
          getRecentAlerts(apiBaseUrl, token, ALERTS_LIMIT)
        ]);

        if (cancelled) return;
        setSites(sitesResp.sites);
        setStatuses(statusesResp.statuses);
        setAlerts(alertsResp.alerts);
        setLastRefreshAt(Date.now());

        if (!t) {
          const first = statusesResp.statuses?.[0]?.siteId ?? null;
          setSelectedSiteId(first);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  const doLogin = async () => {
    setIsAuthLoading(true);
    setError(null);
    try {
      const r = await login(apiBaseUrl, loginUser, loginPass);
      setToken(r.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsAuthLoading(false);
    }
  };

  return (
    <div className="wallboard">
      <div className="scanlines" />

      <div className="topBar">
        <div className="brand" aria-label="Brand">
          <div className="brandTitle">NOC WALLBOARD</div>
          <div className="brandSub">multisite connectivity + websites</div>
        </div>

        <div className="topMeta">
          <div>
            REFRESH: <span style={{ color: "rgba(229,231,235,0.92)" }}>{safeNow(lastRefreshAt)}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            GLOBAL: <StatusPill state={overall} />
          </div>
        </div>
      </div>

      <div className="mapWrap">
        <div className="mapSurface" />
        <SiteMap
          statuses={statusesWithMeta}
          selectedSiteId={selectedSiteId}
          onSelect={(id) => setSelectedSiteId(id)}
        />
      </div>

      <div className="legend" aria-label="Legend">
        <div className="legendTitle">STATUS LEGEND</div>
        <div className="legendRow">
          <span className="swatch" style={{ background: "rgba(34,197,94,0.85)" }} />
          HEALTHY
        </div>
        <div className="legendRow">
          <span className="swatch" style={{ background: "rgba(251,191,36,0.9)" }} />
          WARNING
        </div>
        <div className="legendRow">
          <span className="swatch" style={{ background: "rgba(239,68,68,0.9)" }} />
          CRITICAL
        </div>
        <div className="legendRow">
          <span className="swatch" style={{ background: "rgba(148,163,184,0.25)" }} />
          UNKNOWN
        </div>
      </div>

      <SiteDetailPanel
        site={selectedSite}
        status={selectedStatus}
        alerts={relatedAlerts}
        grafanaBaseUrl={grafanaDashboardUrl}
      />

      <AlertTicker alerts={alerts} />

      {!token && (
        <div className="overlay" role="dialog" aria-label="Login">
          <div className="loginBox">
            <div className="loginTitle">OPERATOR LOGIN</div>
            <div className="loginText">
              Wallboard reads status + alerts from the NOC API. Enter credentials once for this session.
            </div>
            {error && (
              <div style={{ marginBottom: 10, color: "rgba(239,68,68,0.95)" }}>{error}</div>
            )}
            <div className="field">
              <label className="label">Username</label>
              <input
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="btnRow">
              <button className="primary" disabled={isAuthLoading} onClick={doLogin}>
                {isAuthLoading ? "Authenticating..." : "Login"}
              </button>
            </div>
            <div className="loginText" style={{ marginTop: 12 }}>
              Dev default (docker-compose): <span style={{ color: "rgba(229,231,235,0.95)" }}>admin/admin</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

