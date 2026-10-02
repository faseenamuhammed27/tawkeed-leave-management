import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { LeaveRequest } from "../api/types";
import { API, mockApi, renderPage, signIn } from "../test/utils";
import { ApprovalsPage } from "./ApprovalsPage";

const REQUEST: LeaveRequest = {
  id: 7, employee_id: 3, employee_name: "Sara Ahmed", leave_type_id: 1, leave_type_code: "ANNUAL",
  leave_type_name: "Annual Leave", start_date: "2030-03-04", end_date: "2030-03-05", working_days: 2, reason: "Family visit",
  status: "pending", decided_by_id: null, decided_by_name: null, decision_comment: null, decided_at: null,
  cancelled_by_id: null, cancelled_by_name: null, cancellation_reason: null, cancelled_at: null, created_at: "2030-01-01T10:00:00Z",
};

describe("ApprovalsPage", () => {
  it("lists pending team requests", async () => {
    signIn("manager");
    const { calls } = mockApi({ [`GET ${API}/team/leave-requests`]: [REQUEST] });
    renderPage(<ApprovalsPage />);
    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(calls[0].query.get("status")).toBe("pending");
  });

  it("shows an empty state when nothing is waiting", async () => {
    signIn("manager");
    mockApi({ [`GET ${API}/team/leave-requests`]: [] });
    renderPage(<ApprovalsPage />);
    expect(await screen.findByText("Nothing waiting for approval")).toBeInTheDocument();
  });

  it("requires a comment to reject", async () => {
    signIn("manager");
    const { calls } = mockApi({
      [`GET ${API}/team/leave-requests`]: [REQUEST],
      [`POST ${API}/leave-requests/7/reject`]: { ...REQUEST, status: "rejected", decision_comment: "Busy week" },
    });
    renderPage(<ApprovalsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));

    const dialog = screen.getByRole("dialog", { name: "Reject leave request" });
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    const comment = within(dialog).getByRole("textbox", { name: "Comment (required)" });
    expect(comment).toHaveFocus(); // focus goes to the comment field, not the close button
    await userEvent.type(comment, "   ");
    expect(confirm).toBeDisabled();
    await userEvent.clear(comment);
    await userEvent.type(comment, "Busy week");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(await screen.findByText(/was rejected/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ comment: "Busy week" });
  });

  it("approves with an optional comment", async () => {
    signIn("manager");
    const { calls } = mockApi({
      [`GET ${API}/team/leave-requests`]: [REQUEST],
      [`POST ${API}/leave-requests/7/approve`]: { ...REQUEST, status: "approved" },
    });
    renderPage(<ApprovalsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog", { name: "Approve leave request" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/was approved/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")!.path).toBe(`${API}/leave-requests/7/approve`);
  });

  it("shows the API's refusal (e.g. not your team) inside the dialog", async () => {
    signIn("manager");
    mockApi({
      [`GET ${API}/team/leave-requests`]: [REQUEST],
      [`POST ${API}/leave-requests/7/approve`]: () => ({
        status: 400,
        body: { detail: "Insufficient balance to approve: 2 day(s) requested, 1 remaining", code: "INSUFFICIENT_BALANCE" },
      }),
    });
    renderPage(<ApprovalsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/Insufficient balance to approve/)).toBeInTheDocument();
  });
});
