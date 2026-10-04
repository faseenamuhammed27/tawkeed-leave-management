import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { adminApi, leaveApi, referenceApi, teamApi } from "../api/endpoints";
import type { Holiday } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { BalanceCards } from "../components/BalanceCards";
import { RequestTable } from "../components/RequestTable";
import { EmptyState, ErrorAlert, PageHeader, Spinner } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";

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

function AdminOverview() {
  const { user } = useAuth();
  const pending = useQuery({ queryKey: ["team-requests", "pending"], queryFn: () => teamApi.requests("pending") });
  const users = useQuery({ queryKey: ["admin-users", "active"], queryFn: () => adminApi.users({ is_active: true }) });
  const holidays = useQuery({ queryKey: ["holidays", "all"], queryFn: () => referenceApi.holidays() });
  const count = (role: string) => users.data?.filter((u) => u.role === role).length ?? "–";

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
        <Link to="/approvals" className="callout">
          <strong>{pending.data.length}</strong> manager leave request{pending.data.length === 1 ? "" : "s"} waiting for
          your decision →
        </Link>
      )}
      <ErrorAlert error={pending.error ?? users.error} />

      <section className="section" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Overview</h2>
        <div className="balance-grid">
          <Link to="/approvals" className="balance-card stat-card">
            <span className="muted small">Pending manager requests</span>
            <span className="big-number">{pending.data?.length ?? "–"}</span>
          </Link>
          <Link to="/admin/users" className="balance-card stat-card">
            <span className="muted small">Managers</span>
            <span className="big-number">{count("manager")}</span>
          </Link>
          <Link to="/admin/users" className="balance-card stat-card">
            <span className="muted small">Employees</span>
            <span className="big-number">{count("employee")}</span>
          </Link>
        </div>
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
    queryFn: () => teamApi.requests("pending"),
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
