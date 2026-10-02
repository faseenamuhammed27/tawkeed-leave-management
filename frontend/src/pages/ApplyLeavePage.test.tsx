import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { API, mockApi, renderPage, signIn } from "../test/utils";
import { ApplyLeavePage } from "./ApplyLeavePage";

const TYPES = [
  { id: 1, code: "ANNUAL", name: "Annual Leave", default_annual_days: 20, is_active: true },
  { id: 2, code: "SICK", name: "Sick Leave", default_annual_days: 10, is_active: true },
];
const BALANCES = [
  { leave_type_id: 1, leave_type_code: "ANNUAL", leave_type_name: "Annual Leave", year: 2026, allocated_days: 20, used_days: 0, pending_days: 2, available_days: 18 },
];

function preview(overrides = {}) {
  return {
    start_date: "2030-03-04", end_date: "2030-03-10", working_days: 4, calendar_days: 7, weekend_days: 2,
    holidays: [{ date: "2030-03-06", name: "Test Holiday" }], starts_in_past: false, available_days: 18, exceeds_balance: false,
    ...overrides,
  };
}

function setDates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: end } });
}

describe("ApplyLeavePage", () => {
  it("shows the working-day count from the API as dates are picked", async () => {
    signIn("employee");
    const { calls } = mockApi({
      [`GET ${API}/leave-types`]: TYPES,
      [`GET ${API}/me/balances`]: BALANCES,
      [`GET ${API}/leave-requests/preview`]: preview(),
    });
    renderPage(<ApplyLeavePage />);
    await screen.findByLabelText("Leave type");
    setDates("2030-03-04", "2030-03-10");

    expect(await screen.findByTestId("working-days")).toHaveTextContent("4 working days");
    expect(screen.getByText("Test Holiday")).toBeInTheDocument();
    const call = calls.find((c) => c.path.endsWith("/preview"))!;
    expect(call.query.get("start_date")).toBe("2030-03-04");
    expect(call.query.get("end_date")).toBe("2030-03-10");
    expect(call.query.get("leave_type_id")).toBe("1");
  });

  it("warns when the request exceeds the available balance", async () => {
    signIn("employee");
    mockApi({
      [`GET ${API}/leave-types`]: TYPES,
      [`GET ${API}/me/balances`]: BALANCES,
      [`GET ${API}/leave-requests/preview`]: preview({ working_days: 25, exceeds_balance: true }),
    });
    renderPage(<ApplyLeavePage />);
    await screen.findByLabelText("Leave type");
    setDates("2030-03-04", "2030-04-10");
    expect(await screen.findByText(/more than your available balance \(18 days\)/)).toBeInTheDocument();
  });

  it("flags an end date before the start date without calling the API", async () => {
    signIn("employee");
    const { calls } = mockApi({ [`GET ${API}/leave-types`]: TYPES, [`GET ${API}/me/balances`]: BALANCES });
    renderPage(<ApplyLeavePage />);
    await screen.findByLabelText("Leave type");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2030-03-10" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2030-03-04" } });
    expect(await screen.findByText("End date cannot be before start date.")).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith("/preview"))).toBe(false);
  });

  it("requires dates before submitting", async () => {
    signIn("employee");
    const { calls } = mockApi({ [`GET ${API}/leave-types`]: TYPES, [`GET ${API}/me/balances`]: BALANCES });
    renderPage(<ApplyLeavePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit request" }));
    expect(screen.getAllByText("Required")).toHaveLength(2);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the API's business-rule error when submission is refused", async () => {
    signIn("employee");
    mockApi({
      [`GET ${API}/leave-types`]: TYPES,
      [`GET ${API}/me/balances`]: BALANCES,
      [`GET ${API}/leave-requests/preview`]: preview(),
      [`POST ${API}/leave-requests`]: () => ({
        status: 409,
        body: { detail: "These dates overlap your pending request from 2030-03-04 to 2030-03-05", code: "OVERLAPPING_REQUEST" },
      }),
    });
    renderPage(<ApplyLeavePage />);
    await screen.findByLabelText("Leave type");
    setDates("2030-03-04", "2030-03-10");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText(/overlap your pending request/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your requests" })).toBeInTheDocument();
  });

  it("submits the request and goes to the history page", async () => {
    signIn("employee");
    const { calls } = mockApi({
      [`GET ${API}/leave-types`]: TYPES,
      [`GET ${API}/me/balances`]: BALANCES,
      [`GET ${API}/leave-requests/preview`]: preview(),
      [`POST ${API}/leave-requests`]: () => ({ status: 201, body: { id: 9 } }),
    });
    renderPage(<ApplyLeavePage />);
    await screen.findByLabelText("Leave type");
    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "2");
    setDates("2030-03-04", "2030-03-10");
    await userEvent.type(screen.getByLabelText("Reason (optional)"), "Family event");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(screen.getByText("History screen")).toBeInTheDocument());
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      leave_type_id: 2, start_date: "2030-03-04", end_date: "2030-03-10", reason: "Family event",
    });
  });
});
