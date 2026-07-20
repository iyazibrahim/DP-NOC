import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getWebsites } from "../api";
import { StatusPill } from "../components/StatusPill";

export function WebsitesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<
    Array<{ siteId: string; siteName: string; name: string; url: string; state: string }>
  >([]);

  useEffect(() => {
    if (!token) return;
    getWebsites(token).then((r) => setRows(r.websites));
  }, [token]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Websites</h1>
          <p className="pageSub">Blackbox HTTP probes from the central VPS</p>
        </div>
      </div>
      <table className="dataTable full">
        <thead>
          <tr>
            <th>Site</th>
            <th>Name</th>
            <th>URL</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.siteId}-${r.url}`}>
              <td>{r.siteName}</td>
              <td>{r.name}</td>
              <td>{r.url}</td>
              <td>
                <StatusPill state={r.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
