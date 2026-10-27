import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { acknowledgeIncident, getClientBlocks, getIncidents, STATUS_POLL_MS, type ClientBlock, type NocIncident } from "@/api";
import { BlockMacButton } from "@/components/BlockMacButton";
import { StatusPill } from "@/components/StatusPill";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/noc/PageHeader";
import { TablePagination, paginateItems } from "@/components/TableControls";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PAGE_SIZE = 10;

function kindLabel(kind: string): string {
  switch (kind) {
    case "uplink":
      return "Internet";
    case "collector":
      return "Probe";
    case "website":
      return "Website";
    case "device":
      return "Network device";
    case "snmp":
      return "SNMP";
    case "bandwidth":
      return "Bandwidth";
    case "location":
    case "overall":
      return "Location";
    default:
      return kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Alert";
  }
}

function incidentStatusLabel(i: NocIncident) {
  if (i.acknowledgedAt) return "Acknowledged";
  if (i.resolvedAt) return "Recovered";
  return "Active";
}

function incidentStatusSentence(i: NocIncident) {
  if (i.kind === "bandwidth") {
    if (i.acknowledgedAt) return "Cleared. Blocking the MAC is a separate step.";
    return "This client is still over a daily cap. It clears when the day ends or use drops. Block is optional.";
  }
  if (i.acknowledgedAt && i.resolvedAt) return "Recovered and cleared automatically.";
  if (i.acknowledgedAt) return "Acknowledged while still failing. It stays silent until this outage recovers.";
  if (i.resolvedAt) return "The check has recovered.";
  return "The check is still failing.";
}

function macFromIncident(row: NocIncident): string | null {
  const prefix = `bandwidth:${row.siteId}:`;
  if (!row.key.startsWith(prefix)) return null;
  const match = row.key.slice(prefix.length).match(/^([0-9a-f]{2}(?::[0-9a-f]{2}){5}):\d{4}-\d{2}-\d{2}$/);
  return match ? match[1] : null;
}

function formatWhen(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function siteCell(row: NocIncident) {
  if (row.siteId === "global") return row.siteName;
  return <Link to={`/sites/${row.siteId}`}>{row.siteName}</Link>;
}

export function AlertsPage() {
  const { token } = useAuth();
  const [open, setOpen] = useState<NocIncident[]>([]);
  const [history, setHistory] = useState<NocIncident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selected, setSelected] = useState<NocIncident | null>(null);

  async function reload() {
    if (!token) return;
    const inc = await getIncidents(token);
    setOpen(inc.open ?? []);
    setHistory(inc.history ?? []);
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
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

  useEffect(() => {
    setSelected((current) => {
      if (!current) return null;
      return [...open, ...history].find((row) => row.id === current.id) ?? null;
    });
  }, [open, history]);

  async function onAck(id: string) {
    if (!token) return;
    setBusyId(id);
    try {
      await acknowledgeIncident(token, id);
      setSelected(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledge failed");
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = open.filter((row) => !row.resolvedAt).length;
  const openPager = useMemo(() => paginateItems(open, openPage, PAGE_SIZE), [open, openPage]);
  const historyPager = useMemo(
    () => paginateItems(history, historyPage, PAGE_SIZE),
    [history, historyPage]
  );

  useEffect(() => {
    if (openPage !== openPager.page) setOpenPage(openPager.page);
  }, [openPage, openPager.page]);
  useEffect(() => {
    if (historyPage !== historyPager.page) setHistoryPage(historyPager.page);
  }, [historyPage, historyPager.page]);

  return (
    <div className="page">
      <PageHeader
        title="Alerts"
        subtitle="Active incidents stay here until the check recovers, then they move to History on their own. Acknowledge while still failing only silences that outage until it recovers again."
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="healthStrip" style={{ marginBottom: 14 }}>
        <div className="healthChip">
          <span className="healthChipLabel">Active</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="healthChip">
          <span className="healthChipLabel">Open</span>
          <strong>{open.length}</strong>
        </div>
      </div>

      <div className="tableCard" style={{ marginBottom: 14 }}>
        <div className="tableTitle">Open</div>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Type</th>
              <th>Problem</th>
              <th>Site</th>
              <th>Status</th>
              <th>Opened</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {open.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No open incidents.
                </td>
              </tr>
            ) : (
              openPager.slice.map((row) => (
                <IncidentRow
                  key={row.id}
                  row={row}
                  busy={busyId === row.id}
                  onOpen={() => setSelected(row)}
                  onAck={() => void onAck(row.id)}
                />
              ))
            )}
          </tbody>
        </table>
        {open.length > 0 ? (
          <TablePagination
            page={openPager.page}
            totalPages={openPager.totalPages}
            total={openPager.total}
            start={openPager.start}
            end={openPager.end}
            onPageChange={setOpenPage}
          />
        ) : null}
      </div>

      <div className="tableCard">
        <div className="tableTitle">History</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Acknowledged incidents from the last 30 days.
        </p>
        <table className="dataTable">
          <thead>
            <tr>
              <th>Type</th>
              <th>Problem</th>
              <th>Site</th>
              <th>Resolved</th>
              <th>Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No acknowledged incidents yet.
                </td>
              </tr>
            ) : (
              historyPager.slice.map((row) => (
                <IncidentRow key={row.id} row={row} onOpen={() => setSelected(row)} history />
              ))
            )}
          </tbody>
        </table>
        {history.length > 0 ? (
          <TablePagination
            page={historyPager.page}
            totalPages={historyPager.totalPages}
            total={historyPager.total}
            start={historyPager.start}
            end={historyPager.end}
            onPageChange={setHistoryPage}
          />
        ) : null}
      </div>

      <Modal open={selected != null} title={selected?.title ?? "Incident"} onClose={() => setSelected(null)} wide>
        {selected ? (
          <IncidentDetail
            row={selected}
            token={token}
            busy={busyId === selected.id}
            onAck={() => void onAck(selected.id)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function IncidentRow({
  row,
  onOpen,
  onAck,
  busy,
  history
}: {
  row: NocIncident;
  onOpen: () => void;
  onAck?: () => void;
  busy?: boolean;
  history?: boolean;
}) {
  return (
    <tr
      className="alertRow"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td>{kindLabel(row.kind)}</td>
      <td>{row.title}</td>
      <td onClick={(e) => e.stopPropagation()}>{siteCell(row)}</td>
      {history ? (
        <>
          <td>{formatWhen(row.resolvedAt)}</td>
          <td>{formatWhen(row.acknowledgedAt)}</td>
        </>
      ) : (
        <>
          <td>
            {row.resolvedAt ? (
              <span className="muted">{incidentStatusLabel(row)}</span>
            ) : (
              <StatusPill state="critical" notes="Still failing" />
            )}
          </td>
          <td>{formatWhen(row.openedAt)}</td>
          <td onClick={(e) => e.stopPropagation()}>
            {row.acknowledgedAt || !onAck ? null : (
              <Button type="button" size="sm" disabled={busy} onClick={onAck}>
                Acknowledge
              </Button>
            )}
          </td>
        </>
      )}
    </tr>
  );
}

function IncidentDetail({
  row,
  token,
  busy,
  onAck
}: {
  row: NocIncident;
  token: string | null;
  busy: boolean;
  onAck: () => void;
}) {
  const mac = macFromIncident(row);
  const [blocked, setBlocked] = useState<ClientBlock | null>(null);
  useEffect(() => {
    if (!token || !mac || row.siteId === "global") return;
    let cancelled = false;
    getClientBlocks(token, row.siteId)
      .then((res) => {
        if (!cancelled) setBlocked(res.blocks.find((item) => item.mac === mac) ?? null);
      })
      .catch(() => {
        if (!cancelled) setBlocked(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, mac, row.siteId]);

  return (
    <div className="alertDetail">
      <p className="alertDetailNote">{row.detail || "No further detail was recorded."}</p>
      <div className="alertDetailGrid">
        <span>Type</span>
        <strong>{kindLabel(row.kind)}</strong>
        <span>Site</span>
        <strong>{siteCell(row)}</strong>
        <span>Status</span>
        <strong>{incidentStatusSentence(row)}</strong>
        <span>Opened</span>
        <strong>{formatWhen(row.openedAt)}</strong>
        <span>Resolved</span>
        <strong>{formatWhen(row.resolvedAt)}</strong>
        <span>Acknowledged</span>
        <strong>{formatWhen(row.acknowledgedAt)}</strong>
        <span>Acknowledged by</span>
        <strong>{row.acknowledgedBy ?? "—"}</strong>
      </div>
      <div className="formActions">
        {token && mac && row.siteId !== "global" ? (
          <BlockMacButton
            token={token}
            siteId={row.siteId}
            mac={mac}
            blocked={blocked}
            onChanged={() => {
              getClientBlocks(token, row.siteId)
                .then((res) => setBlocked(res.blocks.find((item) => item.mac === mac) ?? null))
                .catch(() => undefined);
            }}
          />
        ) : null}
        {row.acknowledgedAt ? null : (
          <Button type="button" disabled={busy} onClick={onAck}>
            Acknowledge
          </Button>
        )}
      </div>
    </div>
  );
}
