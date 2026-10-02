import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { adminApi } from "../../api/endpoints";
import { EmptyState, ErrorAlert, PageHeader, Spinner } from "../../components/ui";
import { formatDateTime } from "../../lib/dates";

const PAGE_SIZE = 25;

const ACTIONS = [
  "leave_request.created",
  "leave_request.approved",
  "leave_request.rejected",
  "leave_request.cancelled",
  "user.created",
  "user.updated",
  "leave_balance.set",
  "leave_type.created",
  "leave_type.updated",
  "public_holiday.created",
  "public_holiday.updated",
  "public_holiday.deleted",
];

const label = (action: string) => action.replace(/_/g, " ").replace(".", " · ");

function summarise(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const value =
        typeof v === "object" && v && "from" in v && "to" in v
          ? `${String((v as { from: unknown }).from)} → ${String((v as { to: unknown }).to)}`
          : String(v);
      return `${k.replace(/_/g, " ")}: ${value}`;
    })
    .join(" · ");
}

export function AuditLogPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ["audit-logs", action, page],
    queryFn: () => adminApi.auditLogs({ action: action || undefined, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be edited or deleted." />
      <div className="toolbar">
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        {logs.data && <span className="muted small">{logs.data.total} entries</span>}
      </div>

      {logs.isPending && <Spinner />}
      <ErrorAlert error={logs.error} onRetry={() => logs.refetch()} />
      {logs.data &&
        (logs.data.items.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.items.map((l) => (
                    <tr key={l.id}>
                      <td data-label="When" className="nowrap">{formatDateTime(l.created_at)}</td>
                      <td data-label="Who">{l.actor_name ?? "System"}</td>
                      <td data-label="Action">
                        <span className="action-tag">{label(l.action)}</span>
                      </td>
                      <td data-label="Record" className="nowrap">
                        {l.entity_type.replace(/_/g, " ")} #{l.entity_id}
                      </td>
                      <td data-label="Details" className="details-cell small">
                        {summarise(l.details) || <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button type="button" className="btn btn-small btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ Newer
              </button>
              <span className="muted small">
                Page {page} of {totalPages}
              </span>
              <button type="button" className="btn btn-small btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Older ›
              </button>
            </div>
          </>
        ) : (
          <EmptyState title="No audit entries" />
        ))}
    </>
  );
}
