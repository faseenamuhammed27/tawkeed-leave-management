import { screen } from "@testing-library/react";
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

  it("gives the admin an overview without leave balances or an apply button", async () => {
    signIn("admin");
    const { calls } = mockApi({
      [`GET ${API}/team/leave-requests`]: [{ id: 1 }, { id: 2 }],
      [`GET ${API}/admin/users`]: [USERS.admin, USERS.manager, USERS.employee],
      [`GET ${API}/holidays`]: [],
    });
    renderPage(<DashboardPage />);
    expect(await screen.findByRole("link", { name: /2 manager leave requests waiting/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review approvals" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Apply for leave" })).not.toBeInTheDocument();
    // The admin never asks the API for their own balances or leave history.
    expect(calls.some((c) => c.path.endsWith("/me/balances") || c.path.endsWith("/leave-requests/mine"))).toBe(false);
  });
});
