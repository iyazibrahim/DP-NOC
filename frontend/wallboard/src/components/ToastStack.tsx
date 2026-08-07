import { toast } from "sonner";

export type ToastItem = {
  id: string;
  title: string;
  detail?: string;
  tone?: "critical" | "info";
};

/** Compatibility helper — routes to sonner. */
export function pushToast(prev: ToastItem[], next: ToastItem, _max = 6): ToastItem[] {
  if (next.tone === "info") {
    toast(next.title, { id: next.id, description: next.detail });
  } else {
    toast.error(next.title, { id: next.id, description: next.detail });
  }
  return prev;
}

/** No-op stack — toasts render via Sonner Toaster in App. */
export function ToastStack(_props: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return null;
}
