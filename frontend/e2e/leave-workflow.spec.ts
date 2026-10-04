import { expect, test, type Page } from "@playwright/test";

import { addDays, formatMonth, formatRange, monthBounds, todayISO } from "../src/lib/dates";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const USERS = {
  admin: "admin@tawkeed.example",
  manager: "manager@tawkeed.example",
  employee: "employee1@tawkeed.example",
};

// Dates in NEXT year, a different week each run, so re-runs never overlap earlier requests.
const year = Number(todayISO().slice(0, 4)) + 1;
const jan1 = `${year}-01-01`;
const firstMonday = addDays(jan1, (8 - new Date(`${jan1}T00:00:00Z`).getUTCDay()) % 7);
const monday = addDays(firstMonday, 7 * (6 + (Math.floor(Date.now() / 600_000) % 30)));
const A = { start: monday, end: addDays(monday, 1) }; // Mon-Tue: will be approved, then cancelled
const B = { start: addDays(monday, 3), end: addDays(monday, 4) }; // Thu-Fri: will be rejected

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("dialog", { name: "Sign out" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}

async function apply(page: Page, range: { start: string; end: string }) {
  await page.getByRole("link", { name: "Apply for leave" }).first().click();
  await page.getByLabel("Start date").fill(range.start);
  await page.getByLabel("End date").fill(range.end);
  await expect(page.getByTestId("working-days")).toHaveText("2 working days"); // live count from the API
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Leave request submitted and waiting for approval.")).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

const row = (page: Page, range: { start: string; end: string }) =>
  page.getByRole("row").filter({ hasText: formatRange(range.start, range.end) });

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("Set E2E_PASSWORD to the demo accounts' password");
});

test("full leave workflow across employee, manager and admin", async ({ page }) => {
  // --- Employee: balances, live working days, submit two requests
  await login(page, USERS.employee);
  await expect(page.getByRole("article", { name: "Annual Leave balance" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users & managers" })).toHaveCount(0);
  await apply(page, A);
  await expect(row(page, A).getByText("Pending", { exact: true })).toBeVisible();
  await apply(page, B);

  // Overlap is refused by the API and explained in the UI.
  await page.getByRole("link", { name: "Apply for leave" }).first().click();
  await page.getByLabel("Start date").fill(A.end);
  await page.getByLabel("End date").fill(A.end);
  await expect(page.getByTestId("working-days")).toHaveText("1 working day");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(/overlap your pending request/)).toBeVisible();

  // Employees cannot open admin pages.
  await page.goto("/admin/users");
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  await logout(page);

  // --- Manager: approve A, reject B (comment required)
  await login(page, USERS.manager);
  await page.getByRole("link", { name: "Approvals" }).click();
  await row(page, A).getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/was approved/)).toBeVisible();

  await row(page, B).getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog", { name: "Reject leave request" });
  await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
  await dialog.getByLabel("Comment (required)").fill("Team offsite that week");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText(/was rejected/)).toBeVisible();

  // Approved leave appears on the team calendar.
  await page.getByRole("link", { name: "Team calendar" }).click();
  const target = monthBounds(A.start).start;
  for (let i = 0; i < 24 && !(await page.getByRole("heading", { name: formatMonth(target) }).isVisible()); i++) {
    await page.getByRole("button", { name: "Next month" }).click();
  }
  await expect(page.getByRole("heading", { name: formatMonth(target) })).toBeVisible();
  await expect(page.locator(".leave-list li").filter({ hasText: formatRange(A.start, A.end) })).toContainText("Sara Ahmed");
  await logout(page);

  // --- Employee: sees decisions, cancels approved leave (balance restored)
  await login(page, USERS.employee);
  await page.getByRole("link", { name: "My requests" }).click();
  await expect(row(page, B)).toContainText("Rejected by Khalid Rahman: “Team offsite that week”");
  await expect(row(page, A).getByText("Approved", { exact: true })).toBeVisible();
  await row(page, A).getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel leave" }).click();
  await expect(page.getByText("Leave cancelled. The days have been returned to your balance.")).toBeVisible();
  await expect(row(page, A).getByText("Cancelled", { exact: true })).toBeVisible();
  await logout(page);

  // --- Admin (the Director): admin screens and the audit trail; no leave of their own (D2)
  await login(page, USERS.admin);
  await expect(page.getByRole("link", { name: "Apply for leave" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My requests" })).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Users & managers" }).click();
  await expect(page.getByRole("cell", { name: "employee1@tawkeed.example" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Leave types" }).click();
  await expect(page.getByRole("cell", { name: "Annual Leave" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Public holidays" }).click();
  await expect(page.getByRole("heading", { name: "Public holidays" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Allowances" }).click();
  await expect(page.getByRole("spinbutton", { name: "Annual Leave allocated days" })).toBeVisible();
  await nav(page).getByRole("link", { name: "Audit log" }).click();
  await page.getByLabel("Filter by action").selectOption("leave_request.cancelled");
  await expect(page.getByRole("row").filter({ hasText: "Sara Ahmed" }).first()).toBeVisible();
});

test("login shows the API error for a wrong password @mobile", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@tawkeed.example");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
});
