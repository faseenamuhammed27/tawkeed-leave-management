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
  const [actorId, setActorId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const logs = useQuery({
    queryKey: ["audit-logs", action, actorId, startDate, endDate, page],
    queryFn: () =>
      adminApi.auditLogs({
        action: action || undefined,
        actor_id: actorId ? Number(actorId) : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });
  // Everyone who can appear as an actor, including deactivated users and the admin.
  const users = useQuery({ queryKey: ["admin-users", "all"], queryFn: () => adminApi.users() });

  const anyFilter = Boolean(action || actorId || startDate || endDate);
  // Any filter change starts again from the first page.
  const change = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  function clearFilters() {
    setAction("");
    setActorId("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const totalPages = logs.data ? Math.max(1, Math.ceil(logs.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be edited or deleted." />
      <div className="toolbar" role="group" aria-label="Filters">
        <select aria-label="Filter by action" value={action} onChange={(e) => change(setAction)(e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {label(a)}
            </option>
          ))}
        </select>
        <select aria-label="Who" value={actorId} onChange={(e) => change(setActorId)(e.target.value)}>
          <option value="">Everyone</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name}
              {u.is_active ? "" : " (deactivated)"}
            </option>
          ))}
        </select>
        <input type="date" aria-label="From date" value={startDate} onChange={(e) => change(setStartDate)(e.target.value)} />
        <input type="date" aria-label="To date" min={startDate || undefined} value={endDate} onChange={(e) => change(setEndDate)(e.target.value)} />
        {anyFilter && (
          <button type="button" className="btn btn-small btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
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
                    <th className="row-num">#</th>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.items.map((l, i) => (
                    <tr key={l.id}>
                      <td data-label="#" className="row-num">{(page - 1) * PAGE_SIZE + i + 1}</td>
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
          <EmptyState title={anyFilter ? "No audit entries match these filters" : "No audit entries"} />
        ))}
    </>
  );
}
