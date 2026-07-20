import type { DeviceRow } from "../types";

export function TopDevicesTable({
  devices,
  title = "Top Devices (by alerts)"
}: {
  devices: DeviceRow[];
  title?: string;
}) {
  const rows = [...devices].sort((a, b) => (b.alertCount ?? 0) - (a.alertCount ?? 0)).slice(0, 12);

  return (
    <div className="tableCard">
      <div className="tableTitle">{title}</div>
      <table className="dataTable">
        <thead>
          <tr>
            <th>Device</th>
            <th>Site</th>
            <th>Vendor</th>
            <th>Alerts</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No devices — register NUC in Sites or use Discover on the site page.
              </td>
            </tr>
          ) : (
            rows.map((d) => (
              <tr key={`${d.siteId}-${d.id}`}>
                <td>{d.name}</td>
                <td>{d.siteName}</td>
                <td>{d.vendor || "—"}</td>
                <td className="num">{d.alertCount ?? 0}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
