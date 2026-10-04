import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { LeaveRequest } from "../api/types";
import { API, mockApi, renderPage, signIn } from "../test/utils";
import { ApprovalsPage } from "./ApprovalsPage";

const REQUEST: LeaveRequest = {
  id: 7, employee_id: 3, employee_name: "Sara Ahmed", employee_role: "employee", employee_is_active: true, leave_type_id: 1, leave_type_code: "ANNUAL",
  leave_type_name: "Annual Leave", start_date: "2030-03-04", end_date: "2030-03-05", working_days: 2, reason: "Family visit",
  status: "pending", decided_by_id: null, decided_by_name: null, decision_comment: null, decided_at: null,
  cancelled_by_id: null, cancelled_by_name: null, cancellation_reason: null, cancelled_at: null, created_at: "2030-01-01T10:00:00Z",
};

const FILTER_DATA = {
  [`GET ${API}/team/members`]: [{ id: 3, full_name: "Sara Ahmed", email: "employee1@tawkeed.example", role: "employee" }],
  [`GET ${API}/leave-types`]: [{ id: 1, code: "ANNUAL", name: "Annual Leave", default_annual_days: 20, is_active: true }],
};

describe("ApprovalsPage", () => {
  it("lists pending team requests", async () => {
    signIn("manager");
    const { calls } = mockApi({ [`GET ${API}/team/leave-requests`]: [REQUEST] });
    renderPage(<ApprovalsPage />);
    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(calls.find((c) => c.path.endsWith("/team/leave-requests"))!.query.get("status")).toBe("pending");
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
      ...FILTER_DATA,
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
      ...FILTER_DATA,
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
      ...FILTER_DATA,
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

  it("applies filters from the URL (e.g. a dashboard widget link) and sends them to the API", async () => {
    signIn("admin");
    const { calls } = mockApi({ ...FILTER_DATA, [`GET ${API}/team/leave-requests`]: [] });
    renderPage(<ApprovalsPage />, {
      route: "/approvals?status=approved&leave_type_id=1&role=manager&start_date=2026-01-01&end_date=2026-12-31",
      path: "/approvals",
    });
    expect(await screen.findByText("No requests match these filters")).toBeInTheDocument();
    const q = calls.find((c) => c.path.endsWith("/team/leave-requests"))!.query;
    expect(Object.fromEntries(q)).toEqual({
      status: "approved", leave_type_id: "1", role: "manager", start_date: "2026-01-01", end_date: "2026-12-31",
    });
    expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute("aria-pressed", "true");
  });

  it("changing a filter refetches with it", async () => {
    signIn("admin");
    const { calls } = mockApi({ ...FILTER_DATA, [`GET ${API}/team/leave-requests`]: [REQUEST] });
    renderPage(<ApprovalsPage />, { route: "/approvals", path: "/approvals" });
    await screen.findByText("Sara Ahmed", { selector: "td" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person" }), "3");
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/team/leave-requests") && c.query.get("employee_id") === "3")).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("does not offer the role filter to managers", async () => {
    signIn("manager");
    mockApi({ ...FILTER_DATA, [`GET ${API}/team/leave-requests`]: [] });
    renderPage(<ApprovalsPage />);
    await screen.findByText("Nothing waiting for approval");
    expect(screen.queryByRole("combobox", { name: "Role" })).not.toBeInTheDocument();
  });

  it("shows the requester's role to the admin, on every tab", async () => {
    signIn("admin");
    mockApi({
      ...FILTER_DATA,
      [`GET ${API}/team/leave-requests`]: [REQUEST, { ...REQUEST, id: 8, employee_name: "Khalid Rahman", employee_role: "manager" }],
    });
    renderPage(<ApprovalsPage />, { route: "/approvals?status=all", path: "/approvals" });
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(within(table).getByText("employee")).toBeInTheDocument();
    expect(within(table).getByText("manager")).toBeInTheDocument();
  });

  it("does not show a role column to managers", async () => {
    signIn("manager");
    mockApi({ ...FILTER_DATA, [`GET ${API}/team/leave-requests`]: [REQUEST] });
    renderPage(<ApprovalsPage />);
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("columnheader", { name: "Role" })).not.toBeInTheDocument();
  });

  it("marks deactivated users and filters by user status", async () => {
    signIn("manager");
    const { calls } = mockApi({
      ...FILTER_DATA,
      [`GET ${API}/team/leave-requests`]: [REQUEST, { ...REQUEST, id: 9, employee_name: "Left Company", employee_is_active: false }],
    });
    renderPage(<ApprovalsPage />, { route: "/approvals", path: "/approvals" });
    const left = (await screen.findByText("Left Company")).closest("td")!;
    expect(within(left).getByText("Deactivated")).toBeInTheDocument();
    const sara = screen.getByText("Sara Ahmed", { selector: "td" });
    expect(within(sara).queryByText("Deactivated")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "User status" }), "false");
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/team/leave-requests") && c.query.get("employee_active") === "false")).toBe(true),
    );
  });
});
