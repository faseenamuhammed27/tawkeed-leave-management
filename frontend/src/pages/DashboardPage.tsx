import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { adminApi, leaveApi, referenceApi, teamApi } from "../api/endpoints";
import type { Holiday, LeaveStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BalanceCards } from "../components/BalanceCards";
import { RequestTable } from "../components/RequestTable";
import { EmptyState, ErrorAlert, PageHeader, Spinner } from "../components/ui";
import { formatDate, monthBounds, todayISO } from "../lib/dates";

export function DashboardPage() {
  const { hasRole } = useAuth();
  // The admin (Director) does not take leave (decision D2), so they get an overview instead.
  return hasRole("admin") ? <AdminOverview /> : <LeaveDashboard />;
}

function UpcomingHolidays({ holidays, error, loading }: { holidays?: Holiday[]; error: unknown; loading: boolean }) {
  const today = todayISO();
  const upcoming = (holidays ?? []).filter((h) => h.holiday_date >= today).slice(0, 4);
  return (
    <section className="section" aria-labelledby="holidays-heading">
      <h2 id="holidays-heading">Upcoming public holidays</h2>
      {loading && <Spinner />}
      <ErrorAlert error={error} />
      {holidays &&
        (upcoming.length ? (
          <ul className="plain-list">
            {upcoming.map((h) => (
              <li key={h.id}>
                <span>{h.name}</span>
                <span className="muted">{formatDate(h.holiday_date)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No upcoming public holidays" />
        ))}
    </section>
  );
}

const ADMIN_LINKS = [
  { to: "/admin/users", label: "Users & managers", hint: "Add staff, assign managers" },
  { to: "/admin/allowances", label: "Allowances", hint: "Yearly leave per person" },
  { to: "/admin/leave-types", label: "Leave types", hint: "Annual, sick and more" },
  { to: "/admin/holidays", label: "Public holidays", hint: "Excluded from working days" },
  { to: "/calendar", label: "Team calendar", hint: "Approved leave, company-wide" },
  { to: "/admin/audit-log", label: "Audit log", hint: "Who did what, and when" },
];

type Period = "month" | "year";

const WIDGETS: { status: LeaveStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
];

function periodRange(period: Period): { start: string; end: string } {
  const today = todayISO();
  if (period === "month") return monthBounds(today);
  const year = today.slice(0, 4);
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function AdminOverview() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("year");
  const range = periodRange(period);
  const pending = useQuery({ queryKey: ["team-requests", { status: "pending" }], queryFn: () => teamApi.requests({ status: "pending" }) });
  const inPeriod = useQuery({
    queryKey: ["team-requests", { start_date: range.start, end_date: range.end }],
    queryFn: () => teamApi.requests({ start_date: range.start, end_date: range.end }),
  });
  const users = useQuery({ queryKey: ["admin-users", "active"], queryFn: () => adminApi.users({ is_active: true }) });
  const holidays = useQuery({ queryKey: ["holidays", "all"], queryFn: () => referenceApi.holidays() });
  const count = (role: string) => users.data?.filter((u) => u.role === role).length ?? "–";
  const listLink = (status: LeaveStatus) => `/approvals?status=${status}&start_date=${range.start}&end_date=${range.end}`;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.full_name.split(" ")[0]}`}
        subtitle="Company setup and oversight."
        actions={
          <Link to="/approvals" className="btn btn-primary">
            Review approvals
          </Link>
        }
      />

      {pending.data && pending.data.length > 0 && (
        <Link to="/approvals?status=pending" className="callout">
          <strong>{pending.data.length}</strong> leave request{pending.data.length === 1 ? "" : "s"} waiting for a
          decision →
        </Link>
      )}
      <ErrorAlert error={inPeriod.error ?? users.error} onRetry={() => inPeriod.refetch()} />

      <section className="section" aria-labelledby="people-heading">
        <h2 id="people-heading">People</h2>
        <div className="balance-grid">
          <Link to="/admin/users?role=manager" className="balance-card stat-card">
            <span className="muted small">Managers</span>
            <span className="big-number">{count("manager")}</span>
          </Link>
          <Link to="/admin/users?role=employee" className="balance-card stat-card">
            <span className="muted small">Employees</span>
            <span className="big-number">{count("employee")}</span>
          </Link>
        </div>
      </section>

      <section className="section" aria-labelledby="leave-heading">
        <div className="section-head">
          <h2 id="leave-heading">Leave requests</h2>
          <div className="filters" role="group" aria-label="Period">
            {(["month", "year"] as Period[]).map((p) => (
              <button key={p} type="button" className={`chip${period === p ? " chip-active" : ""}`} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {p === "month" ? "This month" : "This year"}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Requests with dates in {period === "month" ? "this month" : "this year"} ({formatDate(range.start)} – {formatDate(range.end)}). Click a card to see the list.
        </p>
        {inPeriod.isPending && <Spinner />}
        {inPeriod.data && (
          <div className="balance-grid">
            {WIDGETS.map((w) => {
              const rows = inPeriod.data.filter((r) => r.status === w.status);
              const days = rows.reduce((sum, r) => sum + r.working_days, 0);
              const byType = new Map<string, number>();
              for (const r of rows) byType.set(r.leave_type_name, (byType.get(r.leave_type_name) ?? 0) + 1);
              return (
                <Link key={w.status} to={listLink(w.status)} className={`balance-card stat-card stat-${w.status}`} aria-label={`${w.label} requests: ${rows.length}`}>
                  <span className="muted small">{w.label}</span>
                  <span className="big-number">{rows.length}</span>
                  <span className="muted small">
                    {days} working day{days === 1 ? "" : "s"}
                  </span>
                  {byType.size > 0 && (
                    <ul className="type-breakdown">
                      {[...byType.entries()].map(([type, n]) => (
                        <li key={type}>
                          <span>{type}</span>
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="two-col">
        <section className="section" aria-labelledby="shortcuts-heading">
          <h2 id="shortcuts-heading">Administration</h2>
          <ul className="plain-list">
            {ADMIN_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to}>{l.label}</Link>
                <span className="muted small">{l.hint}</span>
              </li>
            ))}
          </ul>
        </section>
        <UpcomingHolidays holidays={holidays.data} error={holidays.error} loading={holidays.isPending} />
      </div>
    </>
  );
}

function LeaveDashboard() {
  const { user, hasRole } = useAuth();
  const year = Number(todayISO().slice(0, 4));
  const balances = useQuery({ queryKey: ["balances", year], queryFn: () => referenceApi.myBalances(year) });
  const mine = useQuery({ queryKey: ["my-requests"], queryFn: () => leaveApi.mine() });
  const isApprover = hasRole("manager");
  const pending = useQuery({
    queryKey: ["team-requests", "pending"],
    queryFn: () => teamApi.requests({ status: "pending" }),
    enabled: isApprover,
  });
  const holidays = useQuery({ queryKey: ["holidays", year], queryFn: () => referenceApi.holidays() });

  const recent = (mine.data ?? []).slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.full_name.split(" ")[0]}`}
        subtitle={user?.manager_name ? `Your manager: ${user.manager_name}` : undefined}
        actions={
          <Link to="/apply" className="btn btn-primary">
            Apply for leave
          </Link>
        }
      />

      {isApprover && pending.data && pending.data.length > 0 && (
        <Link to="/approvals" className="callout">
          <strong>{pending.data.length}</strong> leave request{pending.data.length === 1 ? "" : "s"} waiting for your
          decision →
        </Link>
      )}

      <section className="section" aria-labelledby="balances-heading">
        <h2 id="balances-heading">Leave balance {year}</h2>
        {balances.isPending && <Spinner label="Loading balances…" />}
        <ErrorAlert error={balances.error} onRetry={() => balances.refetch()} />
        {balances.data &&
          (balances.data.length ? (
            <BalanceCards balances={balances.data} />
          ) : (
            <EmptyState title="No leave types are set up yet" />
          ))}
      </section>

      <div className="two-col">
        <section className="section" aria-labelledby="recent-heading">
          <div className="section-head">
            <h2 id="recent-heading">Recent requests</h2>
            <Link to="/history">View all</Link>
          </div>
          {mine.isPending && <Spinner />}
          <ErrorAlert error={mine.error} onRetry={() => mine.refetch()} />
          {mine.data &&
            (recent.length ? (
              <RequestTable requests={recent} caption="Recent requests" />
            ) : (
              <EmptyState title="You haven't requested any leave yet">
                <Link to="/apply">Apply for leave</Link>
              </EmptyState>
            ))}
        </section>

        <UpcomingHolidays holidays={holidays.data} error={holidays.error} loading={holidays.isPending} />
      </div>
    </>
  );
}
