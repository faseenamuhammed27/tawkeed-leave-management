import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MemberLeaveSummary } from "../api/types";
import { API, mockApi, renderPage, signIn } from "../test/utils";
import { TeamMembersPage } from "./TeamMembersPage";

const TYPES = [
  { id: 1, code: "ANNUAL", name: "Annual Leave", default_annual_days: 20, is_active: true },
  { id: 2, code: "SICK", name: "Sick Leave", default_annual_days: 10, is_active: true },
];

const none = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
const SARA: MemberLeaveSummary = {
  id: 3, full_name: "Sara Ahmed", email: "employee1@tawkeed.example", role: "employee", manager_name: "Khalid Rahman", year: 2026,
  leave_types: [
    { leave_type_id: 1, leave_type_code: "ANNUAL", leave_type_name: "Annual Leave", allocated_days: 20, used_days: 3, pending_days: 2, available_days: 15,
      requests: { pending: 1, approved: 1, rejected: 0, cancelled: 0 } },
    { leave_type_id: 2, leave_type_code: "SICK", leave_type_name: "Sick Leave", allocated_days: 10, used_days: 0, pending_days: 0, available_days: 10,
      requests: { ...none, rejected: 1 } },
  ],
  totals: { pending: 1, approved: 1, rejected: 1, cancelled: 0 },
};

describe("TeamMembersPage", () => {
  it("shows each person's balance and request counts per leave type", async () => {
    signIn("manager");
    mockApi({ [`GET ${API}/team/leave-summary`]: [SARA], [`GET ${API}/leave-types`]: TYPES });
    renderPage(<TeamMembersPage />);
    const row = (await screen.findByText("Sara Ahmed")).closest("tr")!;
    const annual = within(row).getByText("15").closest("td")!;
    expect(annual).toHaveTextContent("of 20 left");
    expect(annual).toHaveTextContent("3 used · 2 pending days");
    expect(annual).toHaveTextContent("1 pending");
    expect(annual).toHaveTextContent("1 approved");
    expect(within(row).getByRole("link", { name: "View requests" }).getAttribute("href")).toMatch(/employee_id=3/);
    // Managers do not get role or manager columns.
    expect(screen.queryByRole("columnheader", { name: "Role" })).not.toBeInTheDocument();
  });

  it("gives the admin role and manager columns and a role filter sent to the API", async () => {
    signIn("admin");
    const { calls } = mockApi({ [`GET ${API}/team/leave-summary`]: [SARA], [`GET ${API}/leave-types`]: TYPES });
    renderPage(<TeamMembersPage />);
    await screen.findByText("Sara Ahmed");
    // The role badge sits in the Name cell (no separate Role column).
    expect(screen.queryByRole("columnheader", { name: "Role" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /Sara Ahmed/ })).toHaveTextContent("employee");
    expect(screen.getByRole("columnheader", { name: "Manager" })).toBeInTheDocument();
    expect(screen.getByText("Khalid Rahman")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "manager");
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/team/leave-summary") && c.query.get("role") === "manager")).toBe(true),
    );
  });

  it("leave type filter shows only that leave type's column", async () => {
    signIn("manager");
    mockApi({ [`GET ${API}/team/leave-summary`]: [SARA], [`GET ${API}/leave-types`]: TYPES });
    renderPage(<TeamMembersPage />);
    await screen.findByRole("columnheader", { name: "Sick Leave" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Leave type" }), "1");
    expect(screen.queryByRole("columnheader", { name: "Sick Leave" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Annual Leave" })).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    signIn("manager");
    mockApi({ [`GET ${API}/team/leave-summary`]: [], [`GET ${API}/leave-types`]: TYPES });
    renderPage(<TeamMembersPage />);
    expect(await screen.findByText("No team members yet")).toBeInTheDocument();
  });
});
