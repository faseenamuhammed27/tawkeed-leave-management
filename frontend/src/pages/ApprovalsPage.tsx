import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../api/client";
import { leaveApi, teamApi } from "../api/endpoints";
import type { LeaveRequest, LeaveStatus } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { RequestTable } from "../components/RequestTable";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { formatRange } from "../lib/dates";

type Decision = { request: LeaveRequest; action: "approve" | "reject" };

export function ApprovalsPage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<LeaveStatus | "">("pending");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const requests = useQuery({ queryKey: ["team-requests", tab], queryFn: () => teamApi.requests(tab || undefined) });

  const decide = useMutation({
    mutationFn: ({ request, action }: Decision) =>
      action === "approve" ? leaveApi.approve(request.id, comment.trim() || undefined) : leaveApi.reject(request.id, comment.trim()),
    onSuccess: (r) => {
      setFlash(`${r.employee_name}'s leave (${formatRange(r.start_date, r.end_date)}) was ${r.status}.`);
      close();
      queryClient.invalidateQueries({ queryKey: ["team-requests"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  function close() {
    setDecision(null);
    setComment("");
    decide.reset();
  }

  const rejecting = decision?.action === "reject";
  const commentMissing = rejecting && !comment.trim();

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={
          hasRole("admin")
            ? "Leave requests from managers and other admins."
            : "Leave requests from your team."
        }
      />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="filters" role="group" aria-label="Filter by status">
        {(["pending", "approved", "rejected", "cancelled", ""] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`chip${tab === s ? " chip-active" : ""}`}
            aria-pressed={tab === s}
            onClick={() => setTab(s)}
          >
            {s ? s[0].toUpperCase() + s.slice(1) : "All"}
          </button>
        ))}
      </div>

      {requests.isPending && <Spinner />}
      <ErrorAlert error={requests.error} onRetry={() => requests.refetch()} />
      {requests.data &&
        (requests.data.length ? (
          <RequestTable
            requests={requests.data}
            showEmployee
            caption="Team leave requests"
            actions={(r) =>
              r.status === "pending" ? (
                <div className="btn-group">
                  <button type="button" className="btn btn-small btn-success" onClick={() => setDecision({ request: r, action: "approve" })}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => setDecision({ request: r, action: "reject" })}>
                    Reject
                  </button>
                </div>
              ) : null
            }
          />
        ) : (
          <EmptyState title={tab === "pending" ? "Nothing waiting for approval" : "No requests to show"}>
            {tab === "pending" && "New requests from your team will appear here."}
          </EmptyState>
        ))}

      {decision && (
        <Modal
          title={rejecting ? "Reject leave request" : "Approve leave request"}
          onClose={close}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Back
              </button>
              <button
                type="button"
                className={`btn ${rejecting ? "btn-danger" : "btn-success"}`}
                disabled={decide.isPending || commentMissing}
                onClick={() => decide.mutate(decision)}
              >
                {decide.isPending ? "Saving…" : rejecting ? "Reject" : "Approve"}
              </button>
            </>
          }
        >
          <dl className="summary">
            <div>
              <dt>Employee</dt>
              <dd>{decision.request.employee_name}</dd>
            </div>
            <div>
              <dt>Leave</dt>
              <dd>
                {decision.request.leave_type_name}, {formatRange(decision.request.start_date, decision.request.end_date)} (
                {decision.request.working_days} working day{decision.request.working_days === 1 ? "" : "s"})
              </dd>
            </div>
            {decision.request.reason && (
              <div>
                <dt>Reason</dt>
                <dd>{decision.request.reason}</dd>
              </div>
            )}
          </dl>
          <Field
            label={rejecting ? "Comment (required)" : "Comment (optional)"}
            htmlFor="decision-comment"
            hint={rejecting ? "Explain why, so the employee can plan around it." : undefined}
          >
            <textarea
              id="decision-comment"
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              aria-required={rejecting}
            />
          </Field>
          {decide.error && <Alert kind="error">{errorMessage(decide.error)}</Alert>}
        </Modal>
      )}
    </>
  );
}
