import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { fetchExportReportHtml } from "@/api";
import { PageHeader } from "@/components/noc/PageHeader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormalReportPage() {
  const { exportId = "" } = useParams();
  const { token } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!token || !exportId) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    fetchExportReportHtml(token, exportId)
      .then((doc) => {
        if (!cancelled) setHtml(doc);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, exportId]);

  const onPrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
      return;
    }
    window.print();
  };

  return (
    <div className="page formalReportPage">
      <PageHeader
        breadcrumb={
          <>
            <Link to="/settings">Settings</Link>
            <span className="text-muted-foreground"> / </span>
            Reports
          </>
        }
        title="Formal report"
        subtitle="A4 layout · Print or Save as PDF from the browser print dialog"
        actions={
          <>
            <Button type="button" variant="outline" asChild>
              <Link to="/settings">Back</Link>
            </Button>
            <Button type="button" onClick={onPrint} disabled={!html || busy}>
              Print / Save PDF
            </Button>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {busy && !html ? <p className="muted">Loading report…</p> : null}

      {html ? (
        <div className="formalReportFrameWrap">
          <iframe
            ref={iframeRef}
            title="NOC formal report"
            className="formalReportFrame"
            srcDoc={html}
          />
        </div>
      ) : null}
    </div>
  );
}
