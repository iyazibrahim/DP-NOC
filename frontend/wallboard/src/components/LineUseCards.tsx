import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  getLineUseDay,
  type ClientDayUse,
  type DayDeviceUse,
  type LineUseDay,
  type SiteNetworkSummary
} from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { Modal } from "@/components/Modal";
import { darkTooltipProps } from "@/components/noc/MetricChart";

/** Format transferred octets as human volume (GB used, etc.). */
export function formatBytesUsed(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const tb = 1_000_000_000_000;
  const gb = 1_000_000_000;
  const mb = 1_000_000;
  if (bytes >= tb) return `${(bytes / tb).toFixed(bytes >= 10 * tb ? 1 : 2)} TB`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(bytes >= 10 * gb ? 1 : 2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(bytes >= 100 * mb ? 0 : 1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatDay(date: string, today: boolean): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  });
  return today ? `${label} (today)` : label;
}

function dayTotal(day: LineUseDay): number | null {
  if (day.inBytes == null && day.outBytes == null) return null;
  return (day.inBytes ?? 0) + (day.outBytes ?? 0);
}

export function LineUseCards({ network }: { network: SiteNetworkSummary | null }) {
  const [openKey, setOpenKey] = useState<"1d" | "7d" | "30d" | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setOpenKey(null);
    setSelectedDate(null);
  }, [network?.siteId]);

  const windows = [
    { key: "1d" as const, label: "Today", hint: "Details" },
    { key: "7d" as const, label: "This week", hint: "Mon–Sun" },
    { key: "30d" as const, label: "This month", hint: "Resets" }
  ];

  const openWin = openKey ? network?.utilWindows?.[openKey] : undefined;
  const title =
    openKey === "30d"
      ? "Line use · this month"
      : openKey === "7d"
        ? "Line use · this week"
        : "Line use · today";

  return (
    <div className="wanUtilSummary">
      <div className="wanUtilSummaryGrid">
        {windows.map(({ key, label, hint }) => {
          const win = network?.utilWindows?.[key];
          const inB = win?.inBytes ?? null;
          const outB = win?.outBytes ?? null;
          const total = inB != null || outB != null ? (inB ?? 0) + (outB ?? 0) : null;
          return (
            <button
              key={key}
              type="button"
              className="wanUtilCell wanUtilCellButton"
              aria-haspopup="dialog"
              aria-label={`${label} line use, open overview`}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedDate(null);
                setOpenKey(key);
              }}
            >
              <div className="wanUtilCellLabel">
                <span>{label}</span>
                <span className="wanUtilCellHint">{hint}</span>
              </div>
              <div className="wanUtilCellTotal">{formatBytesUsed(total)}</div>
              <div className="wanUtilCellSplit">
                <span title="Download">↓ {formatBytesUsed(inB)}</span>
                <span title="Upload">↑ {formatBytesUsed(outB)}</span>
              </div>
            </button>
          );
        })}
      </div>
      <Modal open={openKey != null} title={title} onClose={() => setOpenKey(null)} wide className="sm:max-w-4xl">
        {openKey === "1d" ? (
          <>
            <TodayLineOverview
              inBytes={openWin?.inBytes ?? null}
              outBytes={openWin?.outBytes ?? null}
              hours={openWin?.hours ?? []}
              breakdown={network?.todayBreakdown}
            />
            {network?.siteId && openWin?.today ? (
              <DaySplit siteId={network.siteId} date={openWin.today} />
            ) : null}
          </>
        ) : openKey ? (
          <>
            <LineUseOverview
              days={openWin?.days ?? []}
              today={openWin?.today}
              inBytes={openWin?.inBytes ?? null}
              outBytes={openWin?.outBytes ?? null}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            {network?.siteId && selectedDate ? (
              <DaySplit siteId={network.siteId} date={selectedDate} />
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Select a day to see which device moved the bytes, and which Wi-Fi client the ledger has for that day.
              </p>
            )}
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function formatRate(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return "—";
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 1 : 2)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${Math.round(bps)} bps`;
}

function TodayLineOverview({
  inBytes,
  outBytes,
  hours,
  breakdown
}: {
  inBytes: number | null;
  outBytes: number | null;
  hours: Array<{ ts: number; inBytes: number; outBytes: number }>;
  breakdown: SiteNetworkSummary["todayBreakdown"];
}) {
  const total = inBytes != null || outBytes != null ? (inBytes ?? 0) + (outBytes ?? 0) : null;
  const scale = useMemo(() => {
    const max = Math.max(0, ...hours.map((hour) => hour.inBytes + hour.outBytes));
    if (max >= 1_000_000_000_000) return { div: 1_000_000_000_000, unit: "TB" };
    if (max >= 1_000_000_000) return { div: 1_000_000_000, unit: "GB" };
    return { div: 1_000_000, unit: "MB" };
  }, [hours]);
  const chart = hours.map((hour) => ({
    label: new Date(hour.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    inBytes: hour.inBytes,
    outBytes: hour.outBytes,
    download: hour.inBytes / scale.div,
    upload: hour.outBytes / scale.div
  }));
  const client = breakdown?.topClient ?? null;
  const aps = breakdown?.aps ?? [];

  return (
    <>
      <div className="wanUtilSummaryGrid lineUseOverviewStats">
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Total</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(total)}</div>
        </div>
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Download</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(inBytes)}</div>
        </div>
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Upload</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(outBytes)}</div>
        </div>
      </div>
      <div className="lineUseOverviewChart">
        {chart.length < 2 ? (
          <p className="muted">No hourly totals yet today.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={20} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                width={56}
                unit={scale.unit}
                tickFormatter={(value) =>
                  typeof value === "number" ? value.toFixed(value >= 10 ? 0 : 1) : String(value)
                }
              />
              <Tooltip
                {...darkTooltipProps()}
                formatter={(value, name, item) => {
                  const payload = (item as { payload?: { inBytes?: number; outBytes?: number } })?.payload;
                  const raw = name === "Download" ? payload?.inBytes : payload?.outBytes;
                  return [formatBytesUsed(raw ?? null), String(name)];
                }}
              />
              <Legend />
              <Bar dataKey="download" name="Download" stackId="use" fill="var(--accent)" />
              <Bar dataKey="upload" name="Upload" stackId="use" fill="var(--accent-yellow)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="lineUseOverviewMeta">
        <span>
          Highest client{" "}
          {client
            ? `${client.label} · ${client.apLabel} · ${
                client.live
                  ? `↓ ${formatRate(client.inBps)} ↑ ${formatRate(client.outBps)} (live)`
                  : `↓ ${formatBytesUsed(client.inBytes)} ↑ ${formatBytesUsed(client.outBytes)}`
              }`
            : "—"}
        </span>
      </div>
      <div className="lineUseOverviewTable">
        <table className="dataTable">
          <thead>
            <tr>
              <th>Access point</th>
              <th className="num">Clients</th>
              <th className="num">Download</th>
              <th className="num">Upload</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {aps.length === 0 ? (
              <tr>
                <td colSpan={5}>No access points on this site.</td>
              </tr>
            ) : (
              aps.map((ap) => (
                <tr key={ap.deviceId}>
                  <td>{ap.label}</td>
                  <td className="num">{ap.clients == null ? "—" : Math.round(ap.clients)}</td>
                  <td className="num">{formatBytesUsed(ap.inBytes)}</td>
                  <td className="num">{formatBytesUsed(ap.outBytes)}</td>
                  <td className="num">
                    {formatBytesUsed(
                      ap.inBytes == null && ap.outBytes == null ? null : (ap.inBytes ?? 0) + (ap.outBytes ?? 0)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Today is midnight until now, Malaysia time. Access-point totals are octets on that AP since midnight.
      </p>
    </>
  );
}

function LineUseOverview({
  days,
  today,
  inBytes,
  outBytes,
  selectedDate,
  onSelectDate
}: {
  days: LineUseDay[];
  today?: string;
  inBytes: number | null;
  outBytes: number | null;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const total = inBytes != null || outBytes != null ? (inBytes ?? 0) + (outBytes ?? 0) : null;
  const fullWithData = days.filter((day) => day.date !== today && dayTotal(day) != null);
  const avg =
    fullWithData.length > 0
      ? fullWithData.reduce((sum, day) => sum + (dayTotal(day) ?? 0), 0) / fullWithData.length
      : null;
  const busiest = days.reduce<LineUseDay | null>((best, day) => {
    const value = dayTotal(day);
    if (value == null) return best;
    if (!best || value > (dayTotal(best) ?? -1)) return day;
    return best;
  }, null);

  const scale = useMemo(() => {
    const max = Math.max(0, ...days.map((day) => dayTotal(day) ?? 0));
    if (max >= 1_000_000_000_000) return { div: 1_000_000_000_000, unit: "TB" };
    if (max >= 1_000_000_000) return { div: 1_000_000_000, unit: "GB" };
    return { div: 1_000_000, unit: "MB" };
  }, [days]);

  const chart = days.map((day) => ({
    label: formatDay(day.date, day.date === today),
    inBytes: day.inBytes,
    outBytes: day.outBytes,
    download: day.inBytes == null ? null : day.inBytes / scale.div,
    upload: day.outBytes == null ? null : day.outBytes / scale.div,
    missing: day.inBytes == null && day.outBytes == null
  }));

  return (
    <>
      <div className="wanUtilSummaryGrid lineUseOverviewStats">
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Total</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(total)}</div>
        </div>
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Download</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(inBytes)}</div>
        </div>
        <div className="wanUtilCell">
          <div className="wanUtilCellLabel">Upload</div>
          <div className="wanUtilCellTotal">{formatBytesUsed(outBytes)}</div>
        </div>
      </div>
      <div className="lineUseOverviewMeta">
        <span>Avg full day {formatBytesUsed(avg)}</span>
        <span>
          Busiest{" "}
          {busiest
            ? `${formatDay(busiest.date, busiest.date === today)} · ${formatBytesUsed(dayTotal(busiest))}`
            : "—"}
        </span>
      </div>
      {days.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Daily history is not available for this line yet.
        </p>
      ) : (
        <>
          <div className="lineUseOverviewChart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={20} />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  width={56}
                  unit={scale.unit}
                  tickFormatter={(value) =>
                    typeof value === "number" ? value.toFixed(value >= 10 ? 0 : 1) : String(value)
                  }
                />
                <Tooltip
                  {...darkTooltipProps()}
                  formatter={(value, name, item) => {
                    const payload = (
                      item as { payload?: { inBytes?: number | null; outBytes?: number | null; missing?: boolean } }
                    )?.payload;
                    if (payload?.missing) return ["No data", String(name)];
                    const raw = name === "Download" ? payload?.inBytes : payload?.outBytes;
                    return [formatBytesUsed(raw ?? null), String(name)];
                  }}
                />
                <Legend />
                <Bar dataKey="download" name="Download" stackId="use" fill="var(--accent)" />
                <Bar dataKey="upload" name="Upload" stackId="use" fill="var(--accent-yellow)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="lineUseOverviewTable">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Download</th>
                  <th className="num">Upload</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((day) => (
                  <tr
                    key={day.date}
                    className="alertRow"
                    onClick={() => onSelectDate(day.date)}
                    style={day.date === selectedDate ? { outline: "1px solid var(--accent)" } : undefined}
                  >
                    <td>{formatDay(day.date, day.date === today)}</td>
                    <td className="num">{formatBytesUsed(day.inBytes)}</td>
                    <td className="num">{formatBytesUsed(day.outBytes)}</td>
                    <td className="num">{formatBytesUsed(dayTotal(day))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Each day is midnight to midnight, Malaysia time. Today runs up to now. The total is the sum of these days.
        Select a day to see which box moved it.
      </p>
    </>
  );
}

function DaySplit({ siteId, date }: { siteId: string; date: string }) {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DayDeviceUse[] | null>(null);
  const [clients, setClients] = useState<ClientDayUse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setDevices(null);
    setClients(null);
    getLineUseDay(token, siteId, date)
      .then((res) => {
        if (cancelled) return;
        setDevices(res.devices);
        setClients(res.clients);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Day detail failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token, siteId, date]);

  return (
    <div className="lineUseOverviewTable" style={{ marginTop: 12 }}>
      <div className="tableTitle">Devices · {date}</div>
      {error ? <p className="muted">{error}</p> : null}
      {devices == null && !error ? <p className="muted">Loading device totals…</p> : null}
      {devices ? (
        <table className="dataTable">
          <thead>
            <tr>
              <th>Device</th>
              <th>Role</th>
              <th className="num">Download</th>
              <th className="num">Upload</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={5}>No interface counters for this day.</td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={`${device.role}-${device.deviceId}-${device.label}`}>
                  <td>{device.label}</td>
                  <td>{device.role}</td>
                  <td className="num">{formatBytesUsed(device.inBytes)}</td>
                  <td className="num">{formatBytesUsed(device.outBytes)}</td>
                  <td className="num">
                    {formatBytesUsed(
                      device.inBytes == null && device.outBytes == null
                        ? null
                        : (device.inBytes ?? 0) + (device.outBytes ?? 0)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : null}
      <p className="muted">
        Internet line is the tagged WAN port. Other rows add every port on that device, so a firewall can read higher
        than the line. A small access-point total next to a large line means the transfer was wired.
      </p>
      <div className="tableTitle">Wi-Fi clients · {date}</div>
      {clients ? (
        <table className="dataTable">
          <thead>
            <tr>
              <th>Client</th>
              <th>SSID</th>
              <th>Access point</th>
              <th>Services</th>
              <th className="num">Download</th>
              <th className="num">Upload</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  No per-client bytes for this day. The ledger starts when the collector is rebuilt. Omada access
                  points have no byte counters.
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <tr key={client.mac}>
                  <td>
                    {client.hostname || client.mac}
                    <div className="muted">{client.mac}</div>
                  </td>
                  <td>{client.ssid || "—"}</td>
                  <td>{client.apLabel || "—"}</td>
                  <td>{client.apps.length > 0 ? client.apps.join(", ") : "Not logged"}</td>
                  <td className="num">{formatBytesUsed(client.inBytes)}</td>
                  <td className="num">{formatBytesUsed(client.outBytes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
