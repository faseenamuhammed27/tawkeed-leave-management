import { useEffect, useRef, type ReactNode } from "react";

import { errorMessage } from "../api/client";
import type { LeaveStatus } from "../api/types";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorAlert({ error, title, onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <div>
        {title && <strong>{title} </strong>}
        {errorMessage(error)}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-small btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Alert({ kind, children }: { kind: "info" | "success" | "warning" | "error"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function StatusBadge({ status }: { status: LeaveStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus once on open (first form field, else first button). Must not re-run on every render,
  // or focus would jump away while the user is typing.
  useEffect(() => {
    const root = dialogRef.current;
    (root?.querySelector<HTMLElement>(".modal-body input, .modal-body textarea, .modal-body select") ??
      root?.querySelector<HTMLElement>(".modal-footer button"))?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}
