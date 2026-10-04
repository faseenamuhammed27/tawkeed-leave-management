import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { errorMessage } from "../api/client";
import { leaveApi, referenceApi, teamApi, type QueueFilters } from "../api/endpoints";
import type { LeaveRequest, LeaveStatus, Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { RequestTable } from "../components/RequestTable";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../components/ui";
import { formatRange } from "../lib/dates";

type Decision = { request: LeaveRequest; action: "approve" | "reject" };

export function ApprovalsPage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasRole("admin");
  // Filters live in the URL so dashboard widgets can link to a filtered list.
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const tab: LeaveStatus | "" = statusParam === "all" ? "" : ((statusParam as LeaveStatus | null) ?? "pending");
  const num = (key: string) => (params.get(key) ? Number(params.get(key)) : undefined);
  const filters: QueueFilters = {
    status: tab || undefined,
    leave_type_id: num("leave_type_id"),
    employee_id: num("employee_id"),
    role: isAdmin ? ((params.get("role") as Role | null) ?? undefined) : undefined,
    employee_active: params.get("active") === "true" ? true : params.get("active") === "false" ? false : undefined,
    start_date: params.get("start_date") ?? undefined,
    end_date: params.get("end_date") ?? undefined,
  };
  const extraFilters = ["leave_type_id", "employee_id", "role", "active", "start_date", "end_date"].some((k) => params.get(k));

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function clearFilters() {
    setParams(statusParam ? { status: statusParam } : {}, { replace: true });
  }

  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const requests = useQuery({ queryKey: ["team-requests", filters], queryFn: () => teamApi.requests(filters) });
  const leaveTypes = useQuery({ queryKey: ["leave-types"], queryFn: referenceApi.leaveTypes });
  const members = useQuery({ queryKey: ["team-members"], queryFn: teamApi.members });

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
        subtitle={isAdmin ? "Leave requests from everyone in the company." : "Leave requests from your team."}
      />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="filters" role="group" aria-label="Filter by status">
        {(["pending", "approved", "rejected", "cancelled", ""] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`chip${tab === s ? " chip-active" : ""}`}
            aria-pressed={tab === s}
            onClick={() => setFilter("status", s || "all")}
          >
            {s ? s[0].toUpperCase() + s.slice(1) : "All"}
          </button>
        ))}
      </div>

      <div className="toolbar" role="group" aria-label="Filters">
        <select aria-label="Leave type" value={params.get("leave_type_id") ?? ""} onChange={(e) => setFilter("leave_type_id", e.target.value)}>
          <option value="">All leave types</option>
          {(leaveTypes.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select aria-label="Role" value={params.get("role") ?? ""} onChange={(e) => setFilter("role", e.target.value)}>
            <option value="">All roles</option>
            <option value="employee">Employees</option>
            <option value="manager">Managers</option>
          </select>
        )}
        <select aria-label="User status" value={params.get("active") ?? ""} onChange={(e) => setFilter("active", e.target.value)}>
          <option value="">All users</option>
          <option value="true">Active users</option>
          <option value="false">Deactivated users</option>
        </select>
        <select aria-label="Person" value={params.get("employee_id") ?? ""} onChange={(e) => setFilter("employee_id", e.target.value)}>
          <option value="">Everyone</option>
          {(members.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <input type="date" aria-label="From date" value={params.get("start_date") ?? ""} onChange={(e) => setFilter("start_date", e.target.value)} />
        <input type="date" aria-label="To date" value={params.get("end_date") ?? ""} onChange={(e) => setFilter("end_date", e.target.value)} />
        {extraFilters && (
          <button type="button" className="btn btn-small btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        {requests.data && <span className="muted small">{requests.data.length} request{requests.data.length === 1 ? "" : "s"}</span>}
      </div>

      {requests.isPending && <Spinner />}
      <ErrorAlert error={requests.error} onRetry={() => requests.refetch()} />
      {requests.data &&
        (requests.data.length ? (
          <RequestTable
            requests={requests.data}
            showEmployee
            showRole={isAdmin}
            showUserStatus
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
          <EmptyState title={tab === "pending" && !extraFilters ? "Nothing waiting for approval" : "No requests match these filters"}>
            {tab === "pending" && !extraFilters && "New requests will appear here."}
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
