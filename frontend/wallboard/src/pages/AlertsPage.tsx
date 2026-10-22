import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { acknowledgeIncident, getIncidents, STATUS_POLL_MS, type NocIncident } from "@/api";
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
  if (i.acknowledgedAt) return "Acknowledged. This does not change whether the check is up.";
  if (i.resolvedAt) return "The check has recovered. Acknowledge to move it to history.";
  return "The check is still failing.";
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
  const pendingAck = open.filter((row) => row.resolvedAt).length;
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
        subtitle="Click an incident for the full detail. Acknowledge clears it from this list and does not change site health."
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
          <span className="healthChipLabel">Needs acknowledgement</span>
          <strong>{pendingAck}</strong>
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
            </tr>
          </thead>
          <tbody>
            {open.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No open incidents.
                </td>
              </tr>
            ) : (
              openPager.slice.map((row) => (
                <IncidentRow key={row.id} row={row} onOpen={() => setSelected(row)} />
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
  history
}: {
  row: NocIncident;
  onOpen: () => void;
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
        </>
      )}
    </tr>
  );
}

function IncidentDetail({
  row,
  busy,
  onAck
}: {
  row: NocIncident;
  busy: boolean;
  onAck: () => void;
}) {
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
      {row.acknowledgedAt ? null : (
        <div className="formActions">
          <Button type="button" disabled={busy} onClick={onAck}>
            Acknowledge
          </Button>
        </div>
      )}
    </div>
  );
}
