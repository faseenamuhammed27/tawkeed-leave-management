import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { referenceApi, teamApi } from "../api/endpoints";
import type { Role, StatusCounts } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorAlert, PageHeader, Spinner } from "../components/ui";
import { todayISO } from "../lib/dates";

const STATUSES: (keyof StatusCounts)[] = ["pending", "approved", "rejected", "cancelled"];

/** Non-zero request counts as small coloured chips, e.g. "1 pending · 2 approved". */
export function StatusChips({ counts }: { counts: StatusCounts }) {
  const shown = STATUSES.filter((s) => counts[s] > 0);
  if (!shown.length) return <span className="muted small">No requests</span>;
  return (
    <span className="chip-row">
      {shown.map((s) => (
        <span key={s} className={`mini-chip badge-${s}`}>
          {counts[s]} {s}
        </span>
      ))}
    </span>
  );
}

export function TeamMembersPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const thisYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [leaveTypeId, setLeaveTypeId] = useState("");

  const summary = useQuery({
    queryKey: ["team-summary", year, role, search],
    queryFn: () => teamApi.leaveSummary({ year, role: role || undefined, search: search.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
  const leaveTypes = useQuery({ queryKey: ["leave-types"], queryFn: referenceApi.leaveTypes });
  const visibleTypes = (leaveTypes.data ?? []).filter((t) => !leaveTypeId || String(t.id) === leaveTypeId);

  return (
    <>
      <PageHeader
        title="Team members"
        subtitle={
          isAdmin
            ? "Leave balances and requests for everyone in the company."
            : "Leave balances and requests for your team."
        }
      />

      <div className="toolbar" role="group" aria-label="Filters">
        <input type="search" placeholder="Search name or email" aria-label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
        {isAdmin && (
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">All roles</option>
            <option value="employee">Employees</option>
            <option value="manager">Managers</option>
          </select>
        )}
        <select aria-label="Leave type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          <option value="">All leave types</option>
          {(leaveTypes.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {summary.data && <span className="muted small">{summary.data.length} {summary.data.length === 1 ? "person" : "people"}</span>}
      </div>

      {summary.isPending && <Spinner />}
      <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
      {summary.data &&
        (summary.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Leave overview per person, {year}</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  {isAdmin && <th>Role</th>}
                  {isAdmin && <th>Manager</th>}
                  {visibleTypes.map((t) => (
                    <th key={t.id}>{t.name}</th>
                  ))}
                  <th>All requests {year}</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Name">
                      <div>{m.full_name}</div>
                      <div className="muted small">{m.email}</div>
                    </td>
                    {isAdmin && (
                      <td data-label="Role">
                        <span className={`role-chip role-${m.role}`}>{m.role}</span>
                      </td>
                    )}
                    {isAdmin && <td data-label="Manager">{m.manager_name ?? <span className="muted">—</span>}</td>}
                    {visibleTypes.map((t) => {
                      const lt = m.leave_types.find((x) => x.leave_type_id === t.id);
                      return (
                        <td key={t.id} data-label={t.name} className="leave-cell">
                          {lt ? (
                            <>
                              <div>
                                <strong>{lt.available_days}</strong> <span className="muted small">of {lt.allocated_days} left</span>
                              </div>
                              <div className="muted small">
                                {lt.used_days} used · {lt.pending_days} pending days
                              </div>
                              <StatusChips counts={lt.requests} />
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td data-label="All requests">
                      <StatusChips counts={m.totals} />
                    </td>
                    <td data-label="Actions" className="actions-col">
                      <Link
                        className="btn btn-small btn-ghost"
                        to={`/approvals?status=all&employee_id=${m.id}&start_date=${year}-01-01&end_date=${year}-12-31`}
                      >
                        View requests
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={search || role ? "No one matches these filters" : "No team members yet"} />
        ))}
    </>
  );
}
