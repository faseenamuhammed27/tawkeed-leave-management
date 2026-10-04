import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { API, mockApi, renderPage, signIn } from "../../test/utils";
import { HolidaysPage } from "./HolidaysPage";

describe("HolidaysPage", () => {
  it("filters by year and date range, and sends them to the API", async () => {
    signIn("admin");
    const { calls } = mockApi({ [`GET ${API}/holidays`]: [{ id: 1, holiday_date: "2026-12-02", name: "National Day" }] });
    renderPage(<HolidaysPage />);
    expect(await screen.findByText("National Day")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Year" }), "");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2027-01-31" } });
    await waitFor(() => {
      const q = calls.filter((c) => c.path.endsWith("/holidays")).at(-1)!.query;
      expect([q.get("year"), q.get("start_date"), q.get("end_date")]).toEqual([null, "2026-12-01", "2027-01-31"]);
    });

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => {
      const q = calls.filter((c) => c.path.endsWith("/holidays")).at(-1)!.query;
      expect(q.get("start_date")).toBeNull();
      expect(q.get("year")).not.toBeNull();
    });
  });

  it("shows a filtered empty state", async () => {
    signIn("admin");
    mockApi({ [`GET ${API}/holidays`]: [] });
    renderPage(<HolidaysPage />);
    await screen.findByText(/No public holidays in/);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-06-01" } });
    expect(await screen.findByText("No public holidays match these filters")).toBeInTheDocument();
  });
});
