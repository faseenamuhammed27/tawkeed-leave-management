import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { LeaveRequest } from "../api/types";
import { API, mockApi, renderPage, signIn } from "../test/utils";
import { HistoryPage, canCancelOwn } from "./HistoryPage";

const base: LeaveRequest = {
  id: 1, employee_id: 3, employee_name: "Sara Ahmed", employee_role: "employee", leave_type_id: 1, leave_type_code: "ANNUAL",
  leave_type_name: "Annual Leave", start_date: "2030-03-04", end_date: "2030-03-05", working_days: 2, reason: null,
  status: "pending", decided_by_id: null, decided_by_name: null, decision_comment: null, decided_at: null,
  cancelled_by_id: null, cancelled_by_name: null, cancellation_reason: null, cancelled_at: null, created_at: "2030-01-01T10:00:00Z",
};

describe("canCancelOwn (UI hint mirroring D3; the API decides)", () => {
  it.each([
    ["pending in future", { status: "pending" }, true],
    ["approved in future", { status: "approved" }, true],
    ["rejected", { status: "rejected" }, false],
    ["cancelled", { status: "cancelled" }, false],
    ["starts today", { start_date: "2030-01-10" }, false],
  ] as const)("%s", (_, overrides, expected) => {
    expect(canCancelOwn({ ...base, ...overrides } as LeaveRequest, "2030-01-10")).toBe(expected);
  });
});

describe("HistoryPage", () => {
  it("shows history with status and offers cancel only where allowed", async () => {
    signIn("employee");
    mockApi({
      [`GET ${API}/leave-requests/mine`]: [
        { ...base, id: 1 },
        { ...base, id: 2, status: "rejected", decided_by_name: "Khalid Rahman", decision_comment: "Busy week", start_date: "2030-04-01", end_date: "2030-04-01" },
      ],
    });
    renderPage(<HistoryPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Pending")).toBeInTheDocument();
    expect(within(table).getByText("Rejected")).toBeInTheDocument();
    expect(within(table).getByText(/Rejected by Khalid Rahman: “Busy week”/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("cancels a request after confirmation", async () => {
    signIn("employee");
    const { calls } = mockApi({
      [`GET ${API}/leave-requests/mine`]: [{ ...base, status: "approved", decided_by_id: 2 }],
      [`POST ${API}/leave-requests/1/cancel`]: { ...base, status: "cancelled", decided_by_id: 2 },
    });
    renderPage(<HistoryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel leave request" });
    expect(dialog).toHaveTextContent("The days will be returned to your balance.");
    await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Plans changed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel leave" }));
    expect(await screen.findByText("Leave cancelled. The days have been returned to your balance.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ reason: "Plans changed" });
  });

  it("shows the API error if cancellation is refused", async () => {
    signIn("employee");
    mockApi({
      [`GET ${API}/leave-requests/mine`]: [base],
      [`POST ${API}/leave-requests/1/cancel`]: () => ({
        status: 409, body: { detail: "Leave cannot be cancelled once it has started", code: "LEAVE_ALREADY_STARTED" },
      }),
    });
    renderPage(<HistoryPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel leave" }));
    expect(await within(dialog).findByText("Leave cannot be cancelled once it has started")).toBeInTheDocument();
  });

  it("shows an empty state and a load error with retry", async () => {
    signIn("employee");
    mockApi({ [`GET ${API}/leave-requests/mine`]: [] });
    renderPage(<HistoryPage />);
    expect(await screen.findByText("No leave requests yet")).toBeInTheDocument();
  });

  it("shows a load error with a retry button", async () => {
    signIn("employee");
    mockApi({ [`GET ${API}/leave-requests/mine`]: () => ({ status: 500, body: { detail: "Database unavailable", code: "HTTP_ERROR" } }) });
    renderPage(<HistoryPage />);
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
