import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { leaveApi, referenceApi, teamApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { BalanceCards } from "../components/BalanceCards";
import { RequestTable } from "../components/RequestTable";
import { EmptyState, ErrorAlert, PageHeader, Spinner } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const year = Number(todayISO().slice(0, 4));
  const balances = useQuery({ queryKey: ["balances", year], queryFn: () => referenceApi.myBalances(year) });
  const mine = useQuery({ queryKey: ["my-requests"], queryFn: () => leaveApi.mine() });
  const isApprover = hasRole("manager", "admin");
  const pending = useQuery({
    queryKey: ["team-requests", "pending"],
    queryFn: () => teamApi.requests("pending"),
    enabled: isApprover,
  });
  const holidays = useQuery({ queryKey: ["holidays", year], queryFn: () => referenceApi.holidays() });

  const today = todayISO();
  const upcomingHolidays = (holidays.data ?? []).filter((h) => h.holiday_date >= today).slice(0, 4);
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

        <section className="section" aria-labelledby="holidays-heading">
          <h2 id="holidays-heading">Upcoming public holidays</h2>
          {holidays.isPending && <Spinner />}
          <ErrorAlert error={holidays.error} />
          {holidays.data &&
            (upcomingHolidays.length ? (
              <ul className="plain-list">
                {upcomingHolidays.map((h) => (
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
      </div>
    </>
  );
}
