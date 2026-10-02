import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { ApiError, errorMessage } from "../api/client";
import { leaveApi, referenceApi } from "../api/endpoints";
import type { LeavePreview } from "../api/types";
import { Alert, Field, PageHeader, Spinner } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";

/** Debounced call to the API's preview endpoint - the API is the single source of truth for the day count. */
function useLivePreview(start: string, end: string, leaveTypeId: number | null) {
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(null);
    if (!start || !end) {
      setPreview(null);
      setLoading(false);
      return;
    }
    if (end < start) {
      setPreview(null);
      setLoading(false);
      setError(new ApiError(422, { detail: "End date cannot be before start date.", code: "VALIDATION_ERROR" }));
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      leaveApi
        .preview({ start_date: start, end_date: end, leave_type_id: leaveTypeId ?? undefined }, controller.signal)
        .then((p) => setPreview(p))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setPreview(null);
          setError(err);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [start, end, leaveTypeId]);

  return { preview, error, loading };
}

export function ApplyLeavePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = todayISO();
  const year = Number(today.slice(0, 4));

  const types = useQuery({ queryKey: ["leave-types"], queryFn: referenceApi.leaveTypes });
  const balances = useQuery({ queryKey: ["balances", year], queryFn: () => referenceApi.myBalances(year) });

  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (leaveTypeId === null && types.data?.length) setLeaveTypeId(types.data[0].id);
  }, [types.data, leaveTypeId]);

  const { preview, error: previewError, loading: previewLoading } = useLivePreview(start, end, leaveTypeId);

  const create = useMutation({
    mutationFn: leaveApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      navigate("/history", { state: { flash: "Leave request submitted and waiting for approval." } });
    },
  });

  const missing = !leaveTypeId ? "Choose a leave type." : !start ? "Choose a start date." : !end ? "Choose an end date." : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (missing || !leaveTypeId) return;
    create.mutate({ leave_type_id: leaveTypeId, start_date: start, end_date: end, reason: reason.trim() || undefined });
  }

  const balance = balances.data?.find((b) => b.leave_type_id === leaveTypeId);
  const submitError = create.error;

  return (
    <>
      <PageHeader title="Apply for leave" subtitle="Weekends and public holidays are not counted." />
      {types.isPending && <Spinner />}
      {types.error && <Alert kind="error">{errorMessage(types.error)}</Alert>}

      {types.data && (
        <div className="apply-layout">
          <form className="card form" onSubmit={onSubmit} noValidate aria-label="Leave request">
            <Field label="Leave type" htmlFor="leave-type">
              <select
                id="leave-type"
                value={leaveTypeId ?? ""}
                onChange={(e) => setLeaveTypeId(Number(e.target.value))}
              >
                {types.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="field-row">
              <Field label="Start date" htmlFor="start-date" error={touched && !start ? "Required" : null}>
                <input
                  id="start-date"
                  type="date"
                  min={today}
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (!end || end < e.target.value) setEnd(e.target.value);
                  }}
                />
              </Field>
              <Field label="End date" htmlFor="end-date" error={touched && !end ? "Required" : null}>
                <input id="end-date" type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>

            <Field label="Reason (optional)" htmlFor="reason" hint={`${reason.length}/500`}>
              <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            {submitError && (
              <Alert kind="error">
                {errorMessage(submitError)}
                {submitError instanceof ApiError && submitError.code === "OVERLAPPING_REQUEST" && (
                  <>
                    {" "}
                    <Link to="/history">See your requests</Link>
                  </>
                )}
              </Alert>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                {create.isPending ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </form>

          <aside className="card preview" aria-live="polite" aria-label="Working days">
            <h2>Working days</h2>
            {!start || !end ? (
              <p className="muted">Pick your dates to see how many working days will be used.</p>
            ) : previewError ? (
              <Alert kind="error">{errorMessage(previewError)}</Alert>
            ) : previewLoading && !preview ? (
              <Spinner label="Calculating…" />
            ) : preview ? (
              <>
                <p className="preview-count" data-testid="working-days">
                  <span className="big-number">{preview.working_days}</span> working day
                  {preview.working_days === 1 ? "" : "s"}
                </p>
                <ul className="plain-list small">
                  <li>
                    <span>Calendar days</span>
                    <span>{preview.calendar_days}</span>
                  </li>
                  <li>
                    <span>Weekend days</span>
                    <span>{preview.weekend_days}</span>
                  </li>
                  {preview.holidays.map((h) => (
                    <li key={h.date}>
                      <span>{h.name}</span>
                      <span className="muted">{formatDate(h.date)}</span>
                    </li>
                  ))}
                </ul>
                {preview.working_days === 0 && <Alert kind="warning">These dates contain no working days.</Alert>}
                {preview.starts_in_past && <Alert kind="warning">Leave cannot start in the past.</Alert>}
                {preview.exceeds_balance && (
                  <Alert kind="warning">
                    This is more than your available balance ({preview.available_days} day
                    {preview.available_days === 1 ? "" : "s"}).
                  </Alert>
                )}
              </>
            ) : null}
            {balance && (
              <p className="muted small preview-balance">
                {balance.leave_type_name}: {balance.available_days} of {balance.allocated_days} days available (
                {balance.pending_days} pending)
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
