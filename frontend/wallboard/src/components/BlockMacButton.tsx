import { useState } from "react";
import { blockClientMac, unblockClientMac, type ClientBlock } from "@/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";

type Props = {
  token: string;
  siteId: string;
  mac: string;
  hostname?: string | null;
  ssid?: string | null;
  apLabel?: string | null;
  inBytes?: number | null;
  outBytes?: number | null;
  blocked?: ClientBlock | null;
  onChanged: () => void;
};

function volume(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const gb = 1_000_000_000;
  const mb = 1_000_000;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.round(bytes)} B`;
}

export function BlockMacButton({
  token,
  siteId,
  mac,
  hostname,
  ssid,
  apLabel,
  inBytes,
  outBytes,
  blocked,
  onChanged
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = hostname || mac;

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      if (blocked) {
        await unblockClientMac(token, siteId, mac);
      } else {
        await blockClientMac(token, siteId, { mac, hostname, ssid, apLabel });
      }
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The block did not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant={blocked ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>
        {blocked ? "Unblock" : "Block this MAC"}
      </Button>
      <Modal
        open={open}
        title={blocked ? `Unblock ${who}` : `Block ${who}`}
        onClose={() => setOpen(false)}
      >
        <p>
          {who} · {mac}
          {ssid ? ` · ${ssid}` : ""}
          {apLabel ? ` · ${apLabel}` : ""}
        </p>
        <p className="muted">
          Download {volume(inBytes)} · Upload {volume(outBytes)}
        </p>
        {blocked ? (
          <p>{blocked.lastDetail || "This MAC is on the block list."}</p>
        ) : (
          <p>
            The collector will try to drop this MAC from every Cambium access point at this location. It does not
            ban the device by itself if the access point refuses the write.
          </p>
        )}
        {error ? <p className="muted">{error}</p> : null}
        <div className="formActions">
          <Button type="button" disabled={busy} onClick={() => void onConfirm()}>
            {blocked ? "Unblock" : "Confirm block"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}
