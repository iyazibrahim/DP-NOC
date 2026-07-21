import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  title,
  onClose,
  children,
  wide
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const didFocusRef = useRef(false);

  useEffect(() => {
    if (!open) {
      didFocusRef.current = false;
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus first field once — never re-run on parent re-renders (that stole focus to ×).
    if (!didFocusRef.current) {
      didFocusRef.current = true;
      const t = window.setTimeout(() => {
        const el = panelRef.current?.querySelector<HTMLElement>(
          "input, select, textarea, button:not(.modalClose), [href], [tabindex]:not([tabindex='-1'])"
        );
        el?.focus();
      }, 0);
      return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prev;
        window.clearTimeout(t);
      };
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modalOverlay"
      role="presentation"
      onClick={() => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        className={`modalPanel${wide ? " modalPanel--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <h2 id={titleId} className="modalTitle">
            {title}
          </h2>
          <button
            type="button"
            className="iconBtn modalClose"
            onClick={() => onCloseRef.current()}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>,
    document.body
  );
}
