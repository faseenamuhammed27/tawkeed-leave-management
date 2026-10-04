import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { API, USERS, mockApi, renderPage, signIn } from "../test/utils";
import { DashboardPage } from "./DashboardPage";

const BALANCES = [
  { leave_type_id: 1, leave_type_code: "ANNUAL", leave_type_name: "Annual Leave", year: 2026, allocated_days: 20, used_days: 3, pending_days: 2, available_days: 15 },
];

describe("DashboardPage", () => {
  it("shows balance cards and recent requests to employees", async () => {
    signIn("employee");
    mockApi({
      [`GET ${API}/me/balances`]: BALANCES,
      [`GET ${API}/leave-requests/mine`]: [],
      [`GET ${API}/holidays`]: [],
    });
    renderPage(<DashboardPage />);
    expect(await screen.findByRole("article", { name: "Annual Leave balance" })).toHaveTextContent("15");
    expect(screen.getAllByRole("link", { name: "Apply for leave" }).length).toBeGreaterThan(0);
  });

  it("gives the admin widgets by status and leave type, linked to filtered lists", async () => {
    signIn("admin");
    const req = (id: number, status: string, type: string, days: number) => ({
      id, status, leave_type_name: type, working_days: days, employee_name: "X", start_date: "2026-11-02", end_date: "2026-11-03",
    });
    const { calls } = mockApi({
      [`GET ${API}/team/leave-requests`]: ({ url }: { url: URL }) =>
        url.searchParams.get("status") === "pending"
          ? { body: [req(1, "pending", "Annual Leave", 2)] }
          : { body: [req(1, "pending", "Annual Leave", 2), req(2, "approved", "Annual Leave", 3), req(3, "approved", "Sick Leave", 1), req(4, "rejected", "Annual Leave", 2)] },
      [`GET ${API}/admin/users`]: [USERS.admin, USERS.manager, USERS.employee],
      [`GET ${API}/holidays`]: [],
    });
    renderPage(<DashboardPage />);

    const approved = await screen.findByRole("link", { name: "Approved requests: 2" });
    expect(approved).toHaveTextContent("4 working days");
    expect(approved).toHaveTextContent("Annual Leave1");
    expect(approved).toHaveTextContent("Sick Leave1");
    expect(screen.getByRole("link", { name: "Pending requests: 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rejected requests: 1" })).toBeInTheDocument();
    expect(approved.getAttribute("href")).toMatch(/^\/approvals\?status=approved&start_date=\d{4}-01-01&end_date=\d{4}-12-31$/);
    expect(screen.getByRole("link", { name: /Managers/ })).toHaveAttribute("href", "/admin/users?role=manager");

    // No leave of their own: the admin never loads personal balances or history.
    expect(screen.queryByRole("link", { name: "Apply for leave" })).not.toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith("/me/balances") || c.path.endsWith("/leave-requests/mine"))).toBe(false);

    // Switching to "This month" asks the API for the current month only.
    await userEvent.click(screen.getByRole("button", { name: "This month" }));
    await waitFor(() => {
      const last = calls.filter((c) => c.path.endsWith("/team/leave-requests") && c.query.get("start_date")).at(-1)!;
      expect(last.query.get("start_date")).toMatch(/^\d{4}-\d{2}-01$/);
      expect(last.query.get("end_date")).not.toMatch(/-12-31$|^$/);
    });
  });
});
