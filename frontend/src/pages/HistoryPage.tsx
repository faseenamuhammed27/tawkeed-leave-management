import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";

import { errorMessage } from "../api/client";
import { leaveApi } from "../api/endpoints";
import type { LeaveRequest, LeaveStatus } from "../api/types";
import { RequestTable } from "../components/RequestTable";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { formatRange, todayISO } from "../lib/dates";

const FILTERS: { value: LeaveStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

/** UI hint only; the API makes the final decision (decision D3). */
export function canCancelOwn(r: LeaveRequest, today = todayISO()): boolean {
  return (r.status === "pending" || r.status === "approved") && r.start_date > today;
}

export function HistoryPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LeaveStatus | "">("");
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [target, setTarget] = useState<LeaveRequest | null>(null);
  const [reason, setReason] = useState("");

  const requests = useQuery({
    queryKey: ["my-requests", filter],
    queryFn: () => leaveApi.mine(filter || undefined),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) => leaveApi.cancel(id, reason),
    onSuccess: (r) => {
      setTarget(null);
      setReason("");
      setFlash(
        r.decided_by_id
          ? "Leave cancelled. The days have been returned to your balance."
          : "Leave request cancelled.",
      );
      queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
    },
  });

  function close() {
    setTarget(null);
    setReason("");
    cancel.reset();
  }

  return (
    <>
      <PageHeader
        title="My requests"
        subtitle="Your leave history and its status."
        actions={
          <Link to="/apply" className="btn btn-primary">
            Apply for leave
          </Link>
        }
      />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="filters" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`chip${filter === f.value ? " chip-active" : ""}`}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {requests.isPending && <Spinner />}
      <ErrorAlert error={requests.error} onRetry={() => requests.refetch()} />
      {requests.data &&
        (requests.data.length ? (
          <RequestTable
            requests={requests.data}
            caption="My leave requests"
            actions={(r) =>
              canCancelOwn(r) ? (
                <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setTarget(r)}>
                  Cancel
                </button>
              ) : null
            }
          />
        ) : (
          <EmptyState title={filter ? `No ${filter} requests` : "No leave requests yet"}>
            <Link to="/apply">Apply for leave</Link>
          </EmptyState>
        ))}

      {target && (
        <Modal
          title="Cancel leave request"
          onClose={close}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Keep request
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ id: target.id, reason: reason.trim() || undefined })}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel leave"}
              </button>
            </>
          }
        >
          <p>
            Cancel your {target.status} {target.leave_type_name.toLowerCase()} for{" "}
            <strong>{formatRange(target.start_date, target.end_date)}</strong> ({target.working_days} day
            {target.working_days === 1 ? "" : "s"})?
            {target.status === "approved" && " The days will be returned to your balance."}
          </p>
          <Field label="Reason (optional)" htmlFor="cancel-reason">
            <textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {cancel.error && <Alert kind="error">{errorMessage(cancel.error)}</Alert>}
        </Modal>
      )}
    </>
  );
}
