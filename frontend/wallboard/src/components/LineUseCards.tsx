import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LineUseDay, SiteNetworkSummary } from "@/api";
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
  const [openKey, setOpenKey] = useState<"7d" | "30d" | null>(null);

  useEffect(() => {
    setOpenKey(null);
  }, [network?.siteId]);

  const windows = [
    { key: "1d" as const, label: "Today", clickable: false },
    { key: "7d" as const, label: "7 days", clickable: true },
    { key: "30d" as const, label: "30 days", clickable: true }
  ];

  const openWin = openKey ? network?.utilWindows?.[openKey] : undefined;

  return (
    <div className="wanUtilSummary">
      <div className="wanUtilSummaryGrid">
        {windows.map(({ key, label, clickable }) => {
          const win = network?.utilWindows?.[key];
          const inB = win?.inBytes ?? null;
          const outB = win?.outBytes ?? null;
          const total = inB != null || outB != null ? (inB ?? 0) + (outB ?? 0) : null;
          const body = (
            <>
              <div className="wanUtilCellLabel">
                <span>{label}</span>
                {clickable ? <span className="wanUtilCellHint">Daily</span> : null}
              </div>
              <div className="wanUtilCellTotal">{formatBytesUsed(total)}</div>
              <div className="wanUtilCellSplit">
                <span title="Download">↓ {formatBytesUsed(inB)}</span>
                <span title="Upload">↑ {formatBytesUsed(outB)}</span>
              </div>
            </>
          );
          if (!clickable) {
            return (
              <div key={key} className="wanUtilCell">
                {body}
              </div>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className="wanUtilCell wanUtilCellButton"
              aria-haspopup="dialog"
              aria-label={`${label} line use, open daily overview`}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (key === "7d" || key === "30d") setOpenKey(key);
              }}
            >
              {body}
            </button>
          );
        })}
      </div>
      <Modal
        open={openKey != null}
        title={openKey === "30d" ? "Line use · last 30 days" : "Line use · last 7 days"}
        onClose={() => setOpenKey(null)}
        wide
        className="sm:max-w-4xl"
      >
        {openKey ? (
          <LineUseOverview
            days={openWin?.days ?? []}
            inBytes={openWin?.inBytes ?? null}
            outBytes={openWin?.outBytes ?? null}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function LineUseOverview({
  days,
  inBytes,
  outBytes
}: {
  days: LineUseDay[];
  inBytes: number | null;
  outBytes: number | null;
}) {
  const total = inBytes != null || outBytes != null ? (inBytes ?? 0) + (outBytes ?? 0) : null;
  const todayDate = days[days.length - 1]?.date;
  const fullWithData = days.slice(0, -1).filter((day) => dayTotal(day) != null);
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
    label: formatDay(day.date, false),
    inBytes: day.inBytes,
    outBytes: day.outBytes,
    download: (day.inBytes ?? 0) / scale.div,
    upload: (day.outBytes ?? 0) / scale.div,
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
            ? `${formatDay(busiest.date, busiest.date === todayDate)} · ${formatBytesUsed(dayTotal(busiest))}`
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
                  <tr key={day.date}>
                    <td>{formatDay(day.date, day.date === todayDate)}</td>
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
      </p>
    </>
  );
}
