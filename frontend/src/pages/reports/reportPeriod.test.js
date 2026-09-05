import { describe, expect, it } from "vitest";
import {
  hasExplicitTimeRange,
  isEmptyExplicitRange,
  zReportPeriodParams,
  zReportPrintPeriod,
} from "./reportPeriod";

// ZR-TIME-01 — the ONE client-side Z-report period contract. Everything the page
// sends and everything it prints is derived here, so these are the assertions
// that keep the two from drifting apart.
describe("Z-report period params (ZR-TIME-01)", () => {
  const SAME_DAY = { start: "05.09.2026", end: "05.09.2026", startTime: "00:00", endTime: "00:00" };
  const RANGE = { start: "01.09.2026", end: "04.09.2026", startTime: "00:00", endTime: "00:00" };

  it("sends a bare single date while the clocks are untouched", () => {
    expect(zReportPeriodParams(SAME_DAY)).toEqual({ date: "2026-09-05" });
    expect(hasExplicitTimeRange(SAME_DAY)).toBe(false);
  });

  it("sends a bare date range while the clocks are untouched", () => {
    expect(zReportPeriodParams(RANGE)).toEqual({ date_from: "2026-09-01", date_to: "2026-09-04" });
  });

  it("never sends the default 00:00 as a real boundary", () => {
    // the whole point: 00:00 → 00:00 must stay a WHOLE DAY, not a zero-length
    // window, so an untouched picker sends no clock at all
    const params = zReportPeriodParams({ ...SAME_DAY, timeTouched: false });
    expect(Object.keys(params)).toEqual(["date"]);
  });

  it("adds the wall clocks once the operator has chosen them", () => {
    expect(zReportPeriodParams({ ...SAME_DAY, startTime: "13:23", endTime: "22:06", timeTouched: true }))
      .toEqual({ date: "2026-09-05", time_from: "13:23", time_to: "22:06" });
    expect(zReportPeriodParams({ ...RANGE, startTime: "22:00", endTime: "02:00", timeTouched: true }))
      .toEqual({
        date_from: "2026-09-01", date_to: "2026-09-04", time_from: "22:00", time_to: "02:00",
      });
  });

  it("falls back to 00:00 only for a malformed clock, never to an invented one", () => {
    expect(zReportPeriodParams({ ...SAME_DAY, startTime: "nonsense", endTime: "22:06", timeTouched: true }))
      .toEqual({ date: "2026-09-05", time_from: "00:00", time_to: "22:06" });
  });

  describe("empty explicit window detection", () => {
    it("accepts a strictly positive window, including across midnight", () => {
      expect(isEmptyExplicitRange({
        start: "05.09.2026", end: "05.09.2026", startTime: "13:23", endTime: "22:06", timeTouched: true,
      })).toBe(false);
      expect(isEmptyExplicitRange({
        start: "05.09.2026", end: "06.09.2026", startTime: "22:00", endTime: "02:00", timeTouched: true,
      })).toBe(false);
    });

    it("refuses equal and inverted boundaries", () => {
      expect(isEmptyExplicitRange({
        start: "05.09.2026", end: "05.09.2026", startTime: "13:23", endTime: "13:23", timeTouched: true,
      })).toBe(true);
      expect(isEmptyExplicitRange({
        start: "05.09.2026", end: "05.09.2026", startTime: "22:06", endTime: "13:23", timeTouched: true,
      })).toBe(true);
    });

    it("leaves an untouched 00:00 → 00:00 day alone", () => {
      // identical clocks, but they were never chosen: this is a whole day, not an
      // empty window, and it must not be refused
      expect(isEmptyExplicitRange(SAME_DAY)).toBe(false);
    });
  });

  describe("printed period", () => {
    it("prints a bare date for an untouched single day", () => {
      expect(zReportPrintPeriod(SAME_DAY)).toEqual({ term: "Дата", label: "05.09.2026" });
    });

    it("prints a bare date range for an untouched period", () => {
      expect(zReportPrintPeriod(RANGE)).toEqual({ term: "Период", label: "01.09.2026 - 04.09.2026" });
    });

    it("prints both endpoints with clocks for an explicit window", () => {
      expect(zReportPrintPeriod({
        ...RANGE, startTime: "13:23", endTime: "22:06", timeTouched: true,
      })).toEqual({ term: "Период", label: "01.09.2026 13:23 - 04.09.2026 22:06" });
    });

    it("never fabricates 00:00 for a date-only report", () => {
      expect(zReportPrintPeriod(SAME_DAY).label).not.toContain("00:00");
      expect(zReportPrintPeriod(RANGE).label).not.toContain("00:00");
    });
  });
});
