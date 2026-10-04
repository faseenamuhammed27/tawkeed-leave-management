import type { ReactNode } from "react";

import type { LeaveRequest } from "../api/types";
import { formatRange } from "../lib/dates";
import { StatusBadge } from "./ui";

export function RequestTable({
  requests,
  showEmployee = false,
  showRole = false,
  showUserStatus = false,
  actions,
  caption,
}: {
  requests: LeaveRequest[];
  showEmployee?: boolean;
  showRole?: boolean;
  showUserStatus?: boolean;
  actions?: (r: LeaveRequest) => ReactNode;
  caption?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            {showRole && <th>Role</th>}
            <th>Type</th>
            <th>Dates</th>
            <th className="num">Days</th>
            <th>Status</th>
            <th>Details</th>
            {actions && <th className="actions-col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              {showEmployee && (
                <td data-label="Employee">
                  <span className="name-with-badge">
                    {r.employee_name}
                    {showUserStatus &&
                      (r.employee_is_active ? (
                        <span className="badge badge-active status-badge">Active</span>
                      ) : (
                        <span className="badge badge-cancelled status-badge">Deactivated</span>
                      ))}
                  </span>
                </td>
              )}
              {showRole && (
                <td data-label="Role">
                  <span className={`role-chip role-${r.employee_role}`}>{r.employee_role}</span>
                </td>
              )}
              <td data-label="Type">{r.leave_type_name}</td>
              <td data-label="Dates">{formatRange(r.start_date, r.end_date)}</td>
              <td data-label="Days" className="num">{r.working_days}</td>
              <td data-label="Status">
                <StatusBadge status={r.status} />
              </td>
              <td data-label="Details" className="details-cell">
                <RequestDetails request={r} />
              </td>
              {actions && (
                <td data-label="Actions" className="actions-col">
                  {actions(r)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestDetails({ request: r }: { request: LeaveRequest }) {
  const lines: string[] = [];
  if (r.reason) lines.push(`Reason: ${r.reason}`);
  if (r.decided_by_name) {
    lines.push(`${r.status === "rejected" ? "Rejected" : "Approved"} by ${r.decided_by_name}${r.decision_comment ? `: “${r.decision_comment}”` : ""}`);
  }
  if (r.cancelled_by_name) {
    lines.push(`Cancelled by ${r.cancelled_by_name}${r.cancellation_reason ? `: “${r.cancellation_reason}”` : ""}`);
  }
  if (!lines.length) return <span className="muted">—</span>;
  return (
    <div className="details-lines">
      {lines.map((l) => (
        <div key={l} className="small">
          {l}
        </div>
      ))}
    </div>
  );
}
