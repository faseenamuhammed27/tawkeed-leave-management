import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Role } from "../api/types";
import { renderPage, signIn } from "../test/utils";
import { Layout } from "./Layout";
import { RequireAuth } from "./RequireAuth";

const links = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("role-based navigation (visibility only; the API enforces access)", () => {
  it.each<[Role, string[], string[]]>([
    ["employee", ["Dashboard", "Apply for leave", "My requests"], ["Approvals", "Team calendar", "Users & managers", "Audit log"]],
    ["manager", ["Dashboard", "Apply for leave", "My requests", "Approvals", "Team calendar"], ["Users & managers", "Allowances", "Audit log"]],
    // The admin (Director) does not request leave (decision D2).
    ["admin", ["Dashboard", "Approvals", "Team calendar", "Users & managers", "Allowances", "Leave types", "Public holidays", "Audit log"], ["Apply for leave", "My requests"]],
  ])("%s sees the right menu", (role, visible, hidden) => {
    signIn(role);
    renderPage(<Layout />);
    for (const label of visible) expect(links()).toContain(label);
    for (const label of hidden) expect(links()).not.toContain(label);
  });

  it("shows the signed-in user's name and role", () => {
    signIn("manager");
    renderPage(<Layout />);
    expect(screen.getByText("Khalid Rahman")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
  });
});

describe("RequireAuth", () => {
  it("redirects to login when signed out", () => {
    renderPage(<RequireAuth><div>secret</div></RequireAuth>);
    expect(screen.getByText("Login screen")).toBeInTheDocument();
  });

  it("blocks pages for the wrong role", () => {
    signIn("employee");
    renderPage(<RequireAuth roles={["admin"]}><div>admin page</div></RequireAuth>);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByText("admin page")).not.toBeInTheDocument();
  });

  it("blocks the leave pages for the admin", () => {
    signIn("admin");
    renderPage(<RequireAuth roles={["employee", "manager"]}><div>apply form</div></RequireAuth>);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("allows the right role", () => {
    signIn("admin");
    renderPage(<RequireAuth roles={["admin"]}><div>admin page</div></RequireAuth>);
    expect(screen.getByText("admin page")).toBeInTheDocument();
  });
});
