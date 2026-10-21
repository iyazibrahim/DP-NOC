import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useCommandCenter } from "@/commandCenter/CommandCenterContext";
import { useDashboardDeck } from "@/commandCenter/DashboardDeckContext";
import {
  getAllSiteStatuses,
  getDashboardLayout,
  getRecentAlerts,
  getSettings,
  getSites,
  getTopDevices,
  resetDashboardLayout,
  saveDashboardLayout,
  STATUS_POLL_MS
} from "@/api";
import type {
  ActiveAlert,
  DashboardBoard,
  DashboardLayout,
  DashboardWidget,
  DeviceRow,
  DomainState,
  Site,
  SiteStatus
} from "@/types";
import {
  BOARD_SESSION_KEY,
  occupiedRows,
  visibleBoards,
  withMissingSiteBoards
} from "@/dashboardBoards";
import { WidgetBody, WIDGET_CATALOG, WIDGET_GROUPS } from "@/components/WidgetBody";
import { WidgetConfigEditor } from "@/components/WidgetConfigEditor";
import { useMetricPresets } from "@/components/DeviceMetricWidgets";
import { pushToast, ToastStack, type ToastItem } from "@/components/ToastStack";
import { uplinkOf } from "@/statusLabels";
import { PageHeader } from "@/components/noc/PageHeader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

function safeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

const FIT_MIN_ROW = 18;

/** RGL may use Infinity/NaN; JSON turns those into null and the API rejects the layout. */
function normalizeWidgets(widgets: DashboardWidget[]): DashboardWidget[] {
  const prepared = widgets.map((w) => {
    const h = Math.max(1, Math.min(24, safeInt(w.h, 4)));
    const ww = Math.max(1, Math.min(12, safeInt(w.w, 4)));
    const x = Math.max(0, Math.min(11, safeInt(w.x, 0)));
    const yRaw = safeInt(w.y, -1);
    return { ...w, x, y: yRaw, w: ww, h };
  });

  let maxBottom = 0;
  for (const w of prepared) {
    if (w.y >= 0) maxBottom = Math.max(maxBottom, w.y + w.h);
  }

  return prepared.map((w, i) => ({
    ...w,
    y: w.y >= 0 ? w.y : maxBottom + i * Math.max(2, w.h)
  }));
}

function normalizeLayoutForSave(layout: DashboardLayout): DashboardLayout {
  return {
    version: 2,
    boards: layout.boards.map((b) => ({
      ...b,
      siteId: b.siteId || null,
      title: b.title.trim() || (b.siteId ? b.siteId : "All locations"),
      widgets: normalizeWidgets(b.widgets)
    }))
  };
}

function readActiveBoardId() {
  try {
    return sessionStorage.getItem(BOARD_SESSION_KEY) || "overview";
  } catch {
    return "overview";
  }
}

function widgetLabel(type: DashboardWidget["type"], config?: Record<string, string>) {
  const custom = config?.title?.trim();
  if (custom) return custom;
  return WIDGET_CATALOG.find((c) => c.type === type)?.label ?? type;
}

function widgetHasConfig(type: DashboardWidget["type"]) {
  return (
    type === "site_card" ||
    type === "grafana_panel" ||
    type === "device_metric_chart" ||
    type === "device_metric_bar" ||
    type === "device_stat_gauge" ||
    type === "device_health" ||
    type === "ap_cluster" ||
    type === "net_line_use" ||
    type === "net_bandwidth" ||
    type === "net_speedtest" ||
    type === "net_ap_traffic" ||
    type === "device_detail" ||
    type === "uplink_status" ||
    type === "collector_status" ||
    type === "local_devices_board" ||
    type === "snmp_device_status" ||
    type === "device_stack" ||
    type === "site_signal_board"
  );
}

export function DashboardPage() {
  const { token } = useAuth();
  const { active: commandCenter, enter: enterCommandCenter } = useCommandCenter();
  const { setChrome, rotateSeconds } = useDashboardDeck();
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesReady, setSitesReady] = useState(false);
  const [statuses, setStatuses] = useState<SiteStatus[]>([]);
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [grafanaUrl, setGrafanaUrl] = useState("http://localhost:3001");
  const [width, setWidth] = useState(1200);
  const [hostHeight, setHostHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Which widget shows the settings panel (edit mode). */
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(readActiveBoardId);
  const [navEpoch, setNavEpoch] = useState(0);
  const [progress, setProgress] = useState(0);
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    try {
      return localStorage.getItem("noc-dashboard-density") === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  const compact = density === "compact" || commandCenter;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const saveInFlight = useRef(0);
  const presets = useMetricPresets();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const prevStatusRef = useRef<Record<
    string,
    { uplink: DomainState; overall: DomainState; websites: DomainState }
  > | null>(null);
  const prevDevicesRef = useRef<Record<string, DomainState> | null>(null);

  // Toast when uplink, website, SNMP, or a device flips to a worse state (skip first poll).
  useEffect(() => {
    const prev = prevStatusRef.current;
    const prevDevices = prevDevicesRef.current;
    const next: Record<
      string,
      { uplink: DomainState; overall: DomainState; websites: DomainState }
    > = {};
    const nextDevices: Record<string, DomainState> = {};
    for (const st of statuses) {
      const uplink = uplinkOf(st).state;
      next[st.siteId] = { uplink, overall: st.overall, websites: st.websites.state };
      const siteName =
        st.siteId === "global"
          ? "Global / Central"
          : (sites.find((s) => s.id === st.siteId)?.name ?? st.siteId);
      for (const d of st.localDeviceStates ?? []) {
        const key = `${st.siteId}:${d.deviceId}`;
        nextDevices[key] = d.state;
        if (!prevDevices || prevDevices[key] == null) continue;
        if (d.state === "warning" && prevDevices[key] !== "warning") {
          setToasts((t) =>
            pushToast(t, {
              id: `snmp-warn-${key}-${Date.now()}`,
              title: `SNMP not answering — ${d.name}`,
              detail:
                d.notes ??
                `${d.name} is online, but SNMP is not answering. Check the SNMP community and that UDP port 161 is allowed, then use Force apply on the collector.`,
              tone: "warning"
            })
          );
        } else if (d.state === "critical" && prevDevices[key] !== "critical") {
          setToasts((t) =>
            pushToast(t, {
              id: `device-down-${key}-${Date.now()}`,
              title: `Device unreachable — ${d.name}`,
              detail:
                d.notes ??
                `${d.name} is not answering ping or SNMP. Check power and the network cable.`,
              tone: "critical"
            })
          );
        }
      }
      if (!prev) continue;
      const before = prev[st.siteId];
      if (!before) continue;
      if (uplink === "critical" && before.uplink !== "critical") {
        setToasts((t) =>
          pushToast(t, {
            id: `uplink-down-${st.siteId}-${Date.now()}`,
            title: `Internet DOWN — ${siteName}`,
            detail:
              "Both internet checks failed. Check the uplink and the collector.",
            tone: "critical"
          })
        );
      } else if (
        st.websites.state === "critical" &&
        before.websites !== "critical" &&
        uplink !== "critical"
      ) {
        const downSites = (st.websiteStates ?? []).filter((w) => w.state === "critical");
        const detail =
          downSites.length > 0
            ? `${downSites.map((w) => w.name).join(", ")} is not responding. Check that the address is correct and the site is up.`
            : "A website check failed. Check that the address is correct and the site is up.";
        setToasts((t) =>
          pushToast(t, {
            id: `website-down-${st.siteId}-${Date.now()}`,
            title:
              downSites.length === 1
                ? `Website DOWN — ${downSites[0].name}`
                : `Website DOWN — ${siteName}`,
            detail,
            tone: "critical"
          })
        );
      } else if (
        st.overall === "critical" &&
        before.overall !== "critical" &&
        uplink !== "critical" &&
        st.websites.state !== "critical" &&
        st.localDevices?.state !== "critical"
      ) {
        setToasts((t) =>
          pushToast(t, {
            id: `location-down-${st.siteId}-${Date.now()}`,
            title: `Location health critical — ${siteName}`,
            detail: "This location needs attention. Open the dashboard for the failing check.",
            tone: "critical"
          })
        );
      }
    }
    prevStatusRef.current = next;
    prevDevicesRef.current = nextDevices;
  }, [statuses, sites]);

  // Measure AFTER the grid host mounts (layout ready). Stuck width=1200 caused ~70% usable area.
  useEffect(() => {
    const el = hostRef.current ?? document.getElementById("dashboard-grid-host");
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0) setWidth(w);
      if (h > 0) setHostHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [layout, editing, activeId]);

  const acceptLayout = useCallback(
    (server: DashboardLayout, siteList: Site[]) => {
      const { layout: merged, changed } = withMissingSiteBoards(server, siteList);
      setLayout(merged);
      if (changed && token) {
        saveInFlight.current += 1;
        void saveDashboardLayout(token, normalizeLayoutForSave(merged))
          .catch((e) => {
            setError(e instanceof Error ? e.message : "Failed to save location boards");
          })
          .finally(() => {
            saveInFlight.current -= 1;
          });
      }
    },
    [token]
  );

  const refreshLayout = useCallback(async () => {
    if (!token) return;
    const [layoutRes, sitesRes] = await Promise.all([getDashboardLayout(token), getSites(token)]);
    setSites(sitesRes.sites);
    setSitesReady(true);
    acceptLayout(layoutRes.layout, sitesRes.sites);
  }, [token, acceptLayout]);

  const refreshData = useCallback(
    async (includeLayout: boolean) => {
      if (!token) return;
      try {
        if (includeLayout) {
          const [layoutRes, sitesRes, stRes, alertsRes, topRes, settings] = await Promise.all([
            getDashboardLayout(token),
            getSites(token),
            getAllSiteStatuses(token),
            getRecentAlerts(token, 30),
            getTopDevices(token),
            getSettings()
          ]);
          setSites(sitesRes.sites);
          setSitesReady(true);
          acceptLayout(layoutRes.layout, sitesRes.sites);
          setStatuses(stRes.statuses);
          setAlerts(alertsRes.alerts);
          setDevices(topRes.devices);
          setGrafanaUrl(settings.grafanaPublicUrl);
        } else {
          const [sitesRes, stRes, alertsRes, topRes, settings] = await Promise.all([
            getSites(token),
            getAllSiteStatuses(token),
            getRecentAlerts(token, 30),
            getTopDevices(token),
            getSettings()
          ]);
          if (!editingRef.current && saveInFlight.current === 0) {
            const layoutRes = await getDashboardLayout(token);
            acceptLayout(layoutRes.layout, sitesRes.sites);
          }
          setSites(sitesRes.sites);
          setSitesReady(true);
          setStatuses(stRes.statuses);
          setAlerts(alertsRes.alerts);
          setDevices(topRes.devices);
          setGrafanaUrl(settings.grafanaPublicUrl);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [token, acceptLayout]
  );

  useEffect(() => {
    refreshData(true);
    const t = setInterval(() => refreshData(false), STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshData]);

  const boards = useMemo(
    () => (layout ? visibleBoards(layout, sites, sitesReady) : []),
    [layout, sites, sitesReady]
  );
  const boardsRef = useRef<DashboardBoard[]>(boards);
  boardsRef.current = boards;

  const activeIndex = Math.max(
    0,
    boards.findIndex((b) => b.id === activeId)
  );
  const activeBoard = boards[activeIndex] ?? boards[0] ?? null;
  const activeBoardRef = useRef(activeBoard);
  activeBoardRef.current = activeBoard;

  const shift = useCallback((dir: number) => {
    setActiveId((current) => {
      const list = boardsRef.current;
      if (list.length === 0) return current;
      const i = list.findIndex((b) => b.id === current);
      const base = i < 0 ? 0 : i;
      const next = (base + dir + list.length) % list.length;
      const id = list[next].id;
      try {
        sessionStorage.setItem(BOARD_SESSION_KEY, id);
      } catch {
        /* ignore */
      }
      return id;
    });
    setNavEpoch((n) => n + 1);
  }, []);
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const rotateSecondsRef = useRef(rotateSeconds);
  rotateSecondsRef.current = rotateSeconds;
  const commandCenterRef = useRef(commandCenter);
  commandCenterRef.current = commandCenter;

  useEffect(() => {
    if (boards.length === 0) return;
    if (boards.some((b) => b.id === activeId)) return;
    const id = boards[0].id;
    setActiveId(id);
    try {
      sessionStorage.setItem(BOARD_SESSION_KEY, id);
    } catch {
      /* ignore */
    }
  }, [boards, activeId]);

  const widgets = activeBoard?.widgets ?? [];
  const rows = occupiedRows(widgets);
  const fit = !editing;
  const gridMargin: [number, number] = compact ? [6, 6] : [10, 10];
  const editRowH = compact ? 28 : 36;
  let rowH = editRowH;
  let scale = 1;
  if (fit && hostHeight > 0) {
    const gaps = Math.max(0, rows - 1) * gridMargin[1];
    const raw = (hostHeight - gaps) / rows;
    if (raw >= FIT_MIN_ROW) {
      rowH = raw;
    } else {
      rowH = FIT_MIN_ROW;
      const natural = rows * FIT_MIN_ROW + gaps;
      scale = natural > 0 ? Math.min(1, hostHeight / natural) : 1;
    }
  }
  const gridWidth = scale < 1 && width > 0 ? width / scale : width;
  const editMinRows = Math.max(rows + 8, 22);

  const gridLayout: Layout[] = useMemo(
    () =>
      widgets.map((w) => {
        const narrowOk =
          w.type === "device_stat_gauge" ||
          w.type === "device_health" ||
          w.type === "ap_cluster" ||
          w.type === "net_line_use" ||
          w.type === "net_bandwidth" ||
          w.type === "net_speedtest" ||
          w.type === "net_ap_traffic" ||
          w.type === "snmp_device_status" ||
          w.type === "device_stack" ||
          w.type === "uplink_status" ||
          w.type === "collector_status" ||
          w.type === "website_summary" ||
          w.type === "alerts_table";
        return {
          i: w.i,
          x: Math.max(0, safeInt(w.x, 0)),
          y: Math.max(0, safeInt(w.y, 0)),
          w: Math.max(1, safeInt(w.w, 4)),
          h: Math.max(1, safeInt(w.h, 4)),
          minW: narrowOk ? 1 : w.type === "mini_map" || w.type === "device_metric_chart" || w.type === "device_metric_bar" ? 3 : 2,
          minH: w.type === "mini_map" ? 3 : 2
        };
      }),
    [widgets]
  );

  const updateActiveWidgets = (fn: (current: DashboardWidget[]) => DashboardWidget[]) => {
    const boardId = activeBoardRef.current?.id;
    if (!boardId) return;
    setLayout((current) => {
      if (!current) return current;
      return {
        ...current,
        boards: current.boards.map((b) =>
          b.id === boardId ? { ...b, widgets: fn(b.widgets) } : b
        )
      };
    });
  };

  const applyLayoutPositions = (next: Layout[]) => {
    if (!editing) return;
    updateActiveWidgets((current) =>
      current.map((w) => {
        const n = next.find((x) => x.i === w.i);
        if (!n) return w;
        return {
          ...w,
          x: Math.max(0, Math.min(11, safeInt(n.x, w.x))),
          y: Math.max(0, safeInt(n.y, w.y >= 0 && Number.isFinite(w.y) ? w.y : 0)),
          w: Math.max(1, Math.min(12, safeInt(n.w, w.w))),
          h: Math.max(1, Math.min(24, safeInt(n.h, w.h)))
        };
      })
    );
  };

  const persist = async () => {
    if (!token || !layout) return;
    try {
      const normalized = normalizeLayoutForSave(layout);
      setLayout(normalized);
      saveInFlight.current += 1;
      try {
        await saveDashboardLayout(token, normalized);
      } finally {
        saveInFlight.current -= 1;
      }
      setEditing(false);
      setDrawerOpen(false);
      setConfigOpenId(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save layout");
    }
  };

  const addWidget = (type: DashboardWidget["type"]) => {
    if (!layout || !activeBoard) return;
    const meta = WIDGET_GROUPS.flatMap((g) => g.widgets).find((c) => c.type === type)!;
    const id = `${type}-${Date.now()}`;
    const firstSite = activeBoard.siteId
      ? (sites.find((s) => s.id === activeBoard.siteId) ?? sites[0])
      : sites[0];
    const collectors = (firstSite?.devices ?? []).filter((d) => (d.kind ?? "network") === "server");
    const firstDevice = collectors[0] ?? firstSite?.devices?.[0];
    let config: Record<string, string> | undefined;
    if (type === "grafana_panel") {
      config = { embedUrl: `${grafanaUrl.replace(/\/$/, "")}/` };
    } else if (type === "site_card") {
      config = { siteId: firstSite?.id ?? "" };
    } else if (
      type === "device_metric_chart" ||
      type === "device_metric_bar" ||
      type === "device_stat_gauge" ||
      type === "device_health" ||
      type === "device_detail"
    ) {
      config = {
        siteId: firstSite?.id ?? "",
        deviceId: firstDevice?.id ?? "",
        metric: firstDevice?.kind === "network" ? "snmp_up" : "cpu_pct"
      };
    } else if (type === "uplink_status" || type === "collector_status") {
      config = { siteId: firstSite?.id ?? "" };
    } else if (type === "local_devices_board") {
      config = { siteId: firstSite?.id ?? "", view: "list" };
    } else if (type === "snmp_device_status") {
      const firstNet =
        (firstSite?.devices ?? []).find((d) => (d.kind ?? "network") !== "server") ??
        (firstSite?.devices ?? []).find((d) => d.snmpIp);
      config = {
        siteId: firstSite?.id ?? "",
        deviceId: firstNet?.id ?? ""
      };
    } else if (
      type === "net_line_use" ||
      type === "net_bandwidth" ||
      type === "net_speedtest" ||
      type === "net_ap_traffic"
    ) {
      config = { siteId: firstSite?.id ?? "" };
    } else if (type === "ap_cluster") {
      config = { siteId: firstSite?.id ?? "", deviceIds: "" };
    } else if (type === "device_stack") {
      const aps = (firstSite?.devices ?? []).filter(
        (d) => d.type === "ap" && (d.kind ?? "network") !== "server"
      );
      const picks =
        aps.length > 0
          ? aps
          : (firstSite?.devices ?? []).filter((d) => (d.kind ?? "network") !== "server");
      config = {
        siteId: firstSite?.id ?? "",
        deviceIds: picks.map((d) => d.id).join(",")
      };
    }
    if (activeBoard.siteId) {
      config = { ...(config ?? {}), siteId: activeBoard.siteId };
    }
    let maxBottom = 0;
    for (const w of activeBoard.widgets) {
      const y = Number.isFinite(w.y) && w.y >= 0 ? w.y : 0;
      const h = Number.isFinite(w.h) && w.h > 0 ? w.h : meta.defaultH;
      maxBottom = Math.max(maxBottom, y + h);
    }
    const widget: DashboardWidget = {
      i: id,
      type,
      x: 0,
      y: maxBottom,
      w: meta.defaultW,
      h: compact ? Math.max(2, Math.round(meta.defaultH * 0.75)) : meta.defaultH,
      config
    };
    updateActiveWidgets((current) => [...current, widget]);
    setEditing(true);
    if (widgetHasConfig(type)) setConfigOpenId(id);
  };

  const updateWidgetConfig = (widgetId: string, config: Record<string, string>) => {
    updateActiveWidgets((current) => current.map((w) => (w.i === widgetId ? { ...w, config } : w)));
  };

  const removeWidget = (id: string) => {
    updateActiveWidgets((current) => current.filter((w) => w.i !== id));
    if (configOpenId === id) setConfigOpenId(null);
  };

  const doReset = async () => {
    if (!token || !activeBoard) return;
    saveInFlight.current += 1;
    try {
      const r = await resetDashboardLayout(token, activeBoard.id);
      acceptLayout(r.layout, sites);
      setConfigOpenId(null);
    } finally {
      saveInFlight.current -= 1;
    }
  };

  const cancelEdit = async () => {
    setEditing(false);
    setDrawerOpen(false);
    setConfigOpenId(null);
    await refreshLayout();
  };

  // Exit edit mode when entering command center so the grid stays locked.
  useEffect(() => {
    if (commandCenter && editing) {
      setEditing(false);
      setDrawerOpen(false);
      setConfigOpenId(null);
    }
  }, [commandCenter, editing]);

  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        shiftRef.current(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        shiftRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  useEffect(() => {
    if (!commandCenter || rotateSeconds == null || editing || boards.length < 2) {
      setProgress(0);
      return;
    }
    let start = performance.now();
    let hiddenFor = 0;
    let hiddenAt: number | null = document.hidden ? performance.now() : null;
    let fired = false;
    const id = window.setInterval(() => {
      if (rotateSecondsRef.current == null || !commandCenterRef.current) {
        window.clearInterval(id);
        return;
      }
      const now = performance.now();
      if (document.hidden) {
        if (hiddenAt == null) hiddenAt = now;
        return;
      }
      if (hiddenAt != null) {
        hiddenFor += now - hiddenAt;
        hiddenAt = null;
      }
      const elapsed = now - start - hiddenFor;
      const ratio = elapsed / (rotateSecondsRef.current * 1000);
      if (ratio >= 1) {
        if (!fired) {
          fired = true;
          shiftRef.current(1);
        }
        return;
      }
      setProgress(ratio);
    }, 100);
    return () => window.clearInterval(id);
  }, [commandCenter, rotateSeconds, editing, activeId, navEpoch, boards.length]);

  useEffect(() => {
    if (!activeBoard) {
      setChrome(null);
      return;
    }
    setChrome({
      title: activeBoard.title,
      index: activeIndex + 1,
      count: boards.length,
      prev: () => shiftRef.current(-1),
      next: () => shiftRef.current(1),
      progress
    });
  }, [activeBoard, activeIndex, boards.length, progress, setChrome]);

  useEffect(() => {
    return () => setChrome(null);
  }, [setChrome]);

  if (!layout) {
    return (
      <div className="page dashboardPage">{error ? `Error: ${error}` : "Loading dashboard…"}</div>
    );
  }

  const canEdit = editing && !commandCenter;

  return (
    <div
      className={`page dashboardPage${editing ? " dashboardPage--editing" : ""}${
        commandCenter ? " page--commandCenter" : ""
      }`}
    >
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      {!commandCenter ? (
        <PageHeader
          className="shrink-0"
          title={
            <div className="dashboardCarousel">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Previous location"
                disabled={boards.length < 2}
                onClick={() => shift(-1)}
              >
                <ChevronLeft />
              </Button>
              <div className="dashboardCarouselTitle">
                <span className="dashboardCarouselName">{activeBoard?.title ?? "Dashboard"}</span>
                <span className="dashboardCarouselCount">
                  {boards.length === 0 ? "—" : `${activeIndex + 1}/${boards.length}`}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Next location"
                disabled={boards.length < 2}
                onClick={() => shift(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          }
          actions={
            editing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  title={compact ? "Switch to comfortable spacing" : "Pack more sites on screen"}
                  onClick={() => {
                    const next = density === "compact" ? "comfortable" : "compact";
                    setDensity(next);
                    try {
                      localStorage.setItem("noc-dashboard-density", next);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {density === "compact" ? "Comfortable" : "Compact"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDrawerOpen(true)}>
                  Add widget
                </Button>
                <Button type="button" onClick={persist}>
                  Save layout
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  title={compact ? "Switch to comfortable spacing" : "Pack more sites on screen"}
                  onClick={() => {
                    const next = density === "compact" ? "comfortable" : "compact";
                    setDensity(next);
                    try {
                      localStorage.setItem("noc-dashboard-density", next);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {density === "compact" ? "Comfortable" : "Compact"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void enterCommandCenter()}>
                  Fullscreen
                </Button>
                <Button type="button" onClick={() => setEditing(true)}>
                  Edit layout
                </Button>
                <Button type="button" variant="outline" onClick={doReset}>
                  Reset
                </Button>
              </>
            )
          }
        />
      ) : null}

      {canEdit ? (
        <div className="bannerHint">
          Unsaved changes — drag into empty space, resize from the bottom-right corner, use{" "}
          <strong>Settings</strong> on a widget for options. Click <strong>Save layout</strong> when
          done.
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div
        id="dashboard-grid-host"
        ref={hostRef}
        className={`dashboardHost${canEdit ? " dashboardHostEditing" : ""}${
          compact ? " dashboardHostCompact" : ""
        }`}
        style={fit ? undefined : { minHeight: editMinRows * editRowH + 80 }}
      >
        <div
          className="dashboardScale"
          style={
            scale < 1
              ? { width: "100%", height: "100%", overflow: "hidden" }
              : undefined
          }
        >
          <div
            style={
              scale < 1
                ? {
                    width: gridWidth,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left"
                  }
                : undefined
            }
          >
        <GridLayout
          className="layout"
          layout={gridLayout}
          cols={12}
          rowHeight={rowH}
          width={Math.max(1, Math.round(gridWidth))}
          margin={gridMargin}
          containerPadding={[0, 0]}
          isDraggable={canEdit}
          isResizable={canEdit}
          onDragStop={applyLayoutPositions}
          onResizeStop={applyLayoutPositions}
          draggableHandle=".widgetDrag"
          compactType={null}
          preventCollision
          allowOverlap={false}
          useCSSTransforms
          resizeHandles={["se"]}
        >
          {widgets.map((w) => {
            const showConfig = canEdit && configOpenId === w.i && widgetHasConfig(w.type);
            return (
              <div
                key={w.i}
                className={`dashWidget${showConfig ? " dashWidgetConfigOpen" : ""}${
                  w.type === "mini_map" ? " dashWidget--map" : ""
                }`}
              >
                <div className="widgetChrome">
                  {canEdit && (
                    <span className="widgetDrag" title="Drag">
                      ⋮⋮
                    </span>
                  )}
                  <span className="widgetTypeLabel">{widgetLabel(w.type, w.config)}</span>
                  {canEdit && widgetHasConfig(w.type) ? (
                    <button
                      type="button"
                      className={`iconBtn${showConfig ? " iconBtnActive" : ""}`}
                      title="Settings"
                      onClick={() => setConfigOpenId(showConfig ? null : w.i)}
                    >
                      ⚙
                    </button>
                  ) : null}
                  {canEdit && (
                    <button
                      type="button"
                      className="iconBtn"
                      title="Remove"
                      onClick={() => removeWidget(w.i)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <WidgetBody
                  type={w.type}
                  config={w.config}
                  sites={sites}
                  statuses={statuses}
                  alerts={alerts}
                  devices={devices}
                  grafanaUrl={grafanaUrl}
                  compact={compact || w.config?.compact === "1"}
                />
                {showConfig ? (
                  <div className="widgetConfigPanel">
                    <WidgetConfigEditor
                      widget={w}
                      sites={sites}
                      presets={presets}
                      grafanaUrl={grafanaUrl}
                      onChange={(config) => updateWidgetConfig(w.i, config)}
                    />
                    <button
                      type="button"
                      className="widgetConfigDone"
                      onClick={() => setConfigOpenId(null)}
                    >
                      Done
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </GridLayout>
          </div>
        </div>
      </div>

      {drawerOpen && canEdit && (
        <div className="drawer">
          <div className="drawerTitle">Add widget</div>
          {WIDGET_GROUPS.map((group) => (
            <div key={group.label} className="drawerGroup">
              <div className="drawerGroupLabel">{group.label}</div>
              {group.widgets.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  className="drawerItem"
                  onClick={() => {
                    addWidget(c.type);
                    setDrawerOpen(false);
                  }}
                >
                  <span className="drawerItemLabel" title={c.description}>
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <button type="button" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
