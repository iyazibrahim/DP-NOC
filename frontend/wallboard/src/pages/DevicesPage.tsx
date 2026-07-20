import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getDevices, getTopDevices } from "../api";
import type { DeviceRow } from "../types";
import { TopDevicesTable } from "../components/TopDevicesTable";

export function DevicesPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [top, setTop] = useState<DeviceRow[]>([]);

  useEffect(() => {
    if (!token) return;
    Promise.all([getDevices(token), getTopDevices(token)]).then(([d, t]) => {
      setDevices(d.devices);
      setTop(t.devices);
    });
  }, [token]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1>Devices</h1>
          <p className="pageSub">Inventory across all sites (SNMP targets)</p>
        </div>
      </div>
      <div className="detailGrid">
        <TopDevicesTable devices={top} />
        <div className="tableCard">
          <div className="tableTitle">All devices</div>
          <table className="dataTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Site</th>
                <th>Type</th>
                <th>IP</th>
                <th>Vendor</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={`${d.siteId}-${d.id}`}>
                  <td>{d.name}</td>
                  <td>{d.siteName}</td>
                  <td>{d.type}</td>
                  <td>{d.snmpIp}</td>
                  <td>{d.vendor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
