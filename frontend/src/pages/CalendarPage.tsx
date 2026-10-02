import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../api/client";
import { leaveApi, referenceApi, teamApi } from "../api/endpoints";
import type { CalendarEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { addMonths, formatDate, formatMonth, formatRange, isWeekend, monthBounds, monthGrid, todayISO } from "../lib/dates";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const queryClient = useQueryClient();
  const today = todayISO();
  const [month, setMonth] = useState(monthBounds(today).start);
  const { start, end } = monthBounds(month);
  const [target, setTarget] = useState<CalendarEntry | null>(null);
  const [reason, setReason] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const entries = useQuery({ queryKey: ["calendar", start, end], queryFn: () => teamApi.calendar(start, end) });
  const holidays = useQuery({
    queryKey: ["holidays", Number(start.slice(0, 4))],
    queryFn: () => referenceApi.holidays(Number(start.slice(0, 4))),
  });

  const holidayByDate = useMemo(
    () => new Map((holidays.data ?? []).map((h) => [h.holiday_date, h.name])),
    [holidays.data],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries.data ?? []) {
      for (const day of monthGrid(month).flat()) {
        if (day && day >= e.start_date && day <= e.end_date && !isWeekend(day) && !holidayByDate.has(day)) {
          map.set(day, [...(map.get(day) ?? []), e]);
        }
      }
    }
    return map;
  }, [entries.data, month, holidayByDate]);

  const adminCancel = useMutation({
    mutationFn: (e: CalendarEntry) => leaveApi.cancel(e.request_id, reason.trim()),
    onSuccess: (r) => {
      setFlash(`${r.employee_name}'s leave (${formatRange(r.start_date, r.end_date)}) was cancelled and the balance restored.`);
      closeCancel();
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["team-requests"] });
    },
  });

  function closeCancel() {
    setTarget(null);
    setReason("");
    adminCancel.reset();
  }

  return (
    <>
      <PageHeader
        title="Team calendar"
        subtitle={isAdmin ? "Approved leave for everyone." : "Approved leave for your team (and you)."}
      />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="calendar-toolbar">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          ‹ Prev
        </button>
        <h2 className="calendar-title" aria-live="polite">
          {formatMonth(month)}
        </h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          Next ›
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setMonth(monthBounds(today).start)}>
          Today
        </button>
      </div>

      {entries.isPending && <Spinner label="Loading calendar…" />}
      <ErrorAlert error={entries.error} onRetry={() => entries.refetch()} />

      {entries.data && (
        <>
          <div className="calendar" role="table" aria-label={`Approved leave, ${formatMonth(month)}`}>
            <div className="calendar-row calendar-head" role="row">
              {WEEKDAYS.map((d) => (
                <div key={d} role="columnheader" className="calendar-cell">
                  {d}
                </div>
              ))}
            </div>
            {monthGrid(month).map((week, i) => (
              <div key={i} className="calendar-row" role="row">
                {week.map((day, j) => {
                  if (!day) return <div key={j} className="calendar-cell calendar-empty" role="cell" />;
                  const holiday = holidayByDate.get(day);
                  const people = byDay.get(day) ?? [];
                  return (
                    <div
                      key={day}
                      role="cell"
                      className={`calendar-cell${isWeekend(day) ? " weekend" : ""}${holiday ? " holiday" : ""}${day === today ? " today" : ""}`}
                    >
                      <span className="calendar-day">{Number(day.slice(8))}</span>
                      {holiday && <span className="calendar-holiday">{holiday}</span>}
                      {people.map((p) => (
                        <span key={p.request_id} className="calendar-chip" title={`${p.employee_name} – ${p.leave_type_name}`}>
                          {p.employee_name}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <section className="section" aria-labelledby="leave-list-heading">
            <h2 id="leave-list-heading">Approved leave this month</h2>
            {entries.data.length ? (
              <ul className="plain-list leave-list">
                {entries.data.map((e) => (
                  <li key={e.request_id}>
                    <span>
                      <strong>{e.employee_name}</strong> · {e.leave_type_name}
                    </span>
                    <span className="muted">
                      {formatRange(e.start_date, e.end_date)} · {e.working_days} day{e.working_days === 1 ? "" : "s"}
                    </span>
                    {isAdmin && e.start_date > today && (
                      <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setTarget(e)}>
                        Cancel (correction)
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No approved leave this month" />
            )}
          </section>
        </>
      )}

      {target && (
        <Modal
          title="Cancel approved leave"
          onClose={closeCancel}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={closeCancel}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!reason.trim() || adminCancel.isPending}
                onClick={() => adminCancel.mutate(target)}
              >
                {adminCancel.isPending ? "Cancelling…" : "Cancel leave"}
              </button>
            </>
          }
        >
          <p>
            Administrative correction for <strong>{target.employee_name}</strong>: {target.leave_type_name},{" "}
            {formatDate(target.start_date)} – {formatDate(target.end_date)}. The {target.working_days} day
            {target.working_days === 1 ? "" : "s"} will be returned to their balance and the change is recorded in the audit log.
          </p>
          <Field label="Reason (required)" htmlFor="admin-cancel-reason">
            <textarea id="admin-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {adminCancel.error && <Alert kind="error">{errorMessage(adminCancel.error)}</Alert>}
        </Modal>
      )}
    </>
  );
}
