import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("sign out", () => {
  it("asks for confirmation; Cancel keeps the session", async () => {
    signIn("employee");
    renderPage(<Layout />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out" });
    expect(dialog).toHaveTextContent("Are you sure you want to sign out?");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("tawkeed.session")).not.toBeNull();
  });

  it("signs out after confirming", async () => {
    signIn("employee");
    renderPage(<Layout />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out" }));
    expect(localStorage.getItem("tawkeed.session")).toBeNull();
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
