import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { API, USERS, mockApi, renderPage, signIn } from "../../test/utils";
import { AuditLogPage } from "./AuditLogPage";

const ENTRY = {
  id: 1, actor_id: 2, actor_name: "Khalid Rahman", action: "leave_request.approved", entity_type: "leave_request",
  entity_id: 7, details: { comment: "Enjoy" }, created_at: "2026-10-04T10:00:00Z",
};

describe("AuditLogPage", () => {
  it("filters by who and by date range, and sends them to the API", async () => {
    signIn("admin");
    const { calls } = mockApi({
      [`GET ${API}/admin/audit-logs`]: { items: [ENTRY], total: 1, page: 1, page_size: 25 },
      [`GET ${API}/admin/users`]: [USERS.admin, USERS.manager, { ...USERS.employee, is_active: false }],
    });
    renderPage(<AuditLogPage />);
    expect(await screen.findByText("Khalid Rahman", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sara Ahmed (deactivated)" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Who" }), "2");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-10-04" } });

    await waitFor(() => {
      const q = calls.filter((c) => c.path.endsWith("/admin/audit-logs")).at(-1)!.query;
      expect([q.get("actor_id"), q.get("start_date"), q.get("end_date"), q.get("page")]).toEqual(["2", "2026-10-01", "2026-10-04", "1"]);
    });
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const q = calls.filter((c) => c.path.endsWith("/admin/audit-logs")).at(-1)!.query;
      expect(q.get("actor_id")).toBeNull();
      expect(q.get("start_date")).toBeNull();
    });
  });

  it("shows an empty state when nothing matches", async () => {
    signIn("admin");
    mockApi({
      [`GET ${API}/admin/audit-logs`]: { items: [], total: 0, page: 1, page_size: 25 },
      [`GET ${API}/admin/users`]: [USERS.admin],
    });
    renderPage(<AuditLogPage />);
    expect(await screen.findByText("No audit entries")).toBeInTheDocument();
  });
});
