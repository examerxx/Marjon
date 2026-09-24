import { beforeEach, describe, expect, it } from "vitest";
import { reportCacheKey, readReportCache, writeReportCache, __resetReportCache } from "./reportResultCache";

describe("reportResultCache (session-only, per request identity)", () => {
  beforeEach(() => __resetReportCache());

  it("returns null for a never-loaded identity (truthful miss → loading elsewhere)", () => {
    expect(readReportCache(reportCacheKey("tables", { from: "2026-01-01" }))).toBeNull();
  });

  it("stores and returns the exact success payload for a matching identity", () => {
    const key = reportCacheKey("orders", { from: "2026-01-01", to: "2026-01-31", filters: {} });
    writeReportCache(key, { rows: [{ id: "1" }] });
    expect(readReportCache(key)).toEqual({ rows: [{ id: "1" }] });
  });

  it("keys separately per report type and per request identity (no leakage)", () => {
    writeReportCache(reportCacheKey("orders", { p: 1 }), { rows: ["o"] });
    writeReportCache(reportCacheKey("dishes", { p: 1 }), { rows: ["d"] });
    expect(readReportCache(reportCacheKey("orders", { p: 1 })).rows).toEqual(["o"]);
    expect(readReportCache(reportCacheKey("dishes", { p: 1 })).rows).toEqual(["d"]);
    // Different period → miss, never the other period's data.
    expect(readReportCache(reportCacheKey("orders", { p: 2 }))).toBeNull();
  });

  it("carries auxiliary success shape (e.g. totals) verbatim", () => {
    const key = reportCacheKey("dishes", { p: 1 });
    writeReportCache(key, { rows: [1], totals: { sum: 10 } });
    expect(readReportCache(key)).toEqual({ rows: [1], totals: { sum: 10 } });
  });
});
