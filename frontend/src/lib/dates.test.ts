import { describe, expect, it } from "vitest";

import { addDays, addMonths, formatRange, monthBounds, monthGrid, todayISO } from "./dates";

describe("dates", () => {
  it("todayISO uses the Asia/Dubai business timezone", () => {
    // 21:30 UTC on 2 Oct is already 3 Oct in Dubai (UTC+4).
    expect(todayISO(new Date("2026-10-02T21:30:00Z"))).toBe("2026-10-03");
    expect(todayISO(new Date("2026-10-02T10:00:00Z"))).toBe("2026-10-02");
  });

  it("adds days and months across boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(monthBounds("2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("builds a Monday-first month grid", () => {
    const grid = monthGrid("2026-03-01"); // 1 March 2026 is a Sunday
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-03-01"]);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  it("formats ranges compactly", () => {
    expect(formatRange("2026-03-09", "2026-03-09")).toBe("9 Mar 2026");
    expect(formatRange("2026-03-09", "2026-03-11")).toBe("9 Mar – 11 Mar 2026");
  });
});
