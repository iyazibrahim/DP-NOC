import { useEffect } from "react";

export type ToastItem = {
  id: string;
  title: string;
  detail?: string;
  tone?: "critical" | "info";
};

const AUTO_HIDE_MS = 25_000;

export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toastStack" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(toast.id), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toastCard toastCard--${toast.tone ?? "critical"}`} role="status">
      <div className="toastBody">
        <div className="toastTitle">{toast.title}</div>
        {toast.detail ? <div className="toastDetail">{toast.detail}</div> : null}
      </div>
      <button
        type="button"
        className="toastDismiss"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Helper to append without mutating — keep newest on top, cap stack size. */
export function pushToast(prev: ToastItem[], next: ToastItem, max = 6): ToastItem[] {
  return [next, ...prev.filter((t) => t.id !== next.id)].slice(0, max);
}
