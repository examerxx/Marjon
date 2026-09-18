import { describe, expect, it } from "vitest";
import { formatSelectedLabels } from "./ReportMultiSelect";

const OPTIONS = [
  { value: "dine_in", label: "На стол" },
  { value: "delivery", label: "Доставка" },
  { value: "takeaway", label: "С собой" },
];

describe("formatSelectedLabels — shared multi-select trigger text", () => {
  it("returns empty for no selection (caller shows the muted placeholder)", () => {
    expect(formatSelectedLabels([], OPTIONS)).toBe("");
    expect(formatSelectedLabels(null, OPTIONS)).toBe("");
  });

  it("shows the single label for one selection", () => {
    expect(formatSelectedLabels(["dine_in"], OPTIONS)).toBe("На стол");
  });

  it("joins every label with comma+space in dropdown option order", () => {
    expect(formatSelectedLabels(["dine_in", "delivery"], OPTIONS)).toBe("На стол, Доставка");
    expect(formatSelectedLabels(["delivery", "dine_in"], OPTIONS)).toBe("На стол, Доставка");
    expect(formatSelectedLabels(["dine_in", "delivery", "takeaway"], OPTIONS)).toBe(
      "На стол, Доставка, С собой"
    );
  });

  it("never renders count summaries", () => {
    const text = formatSelectedLabels(["dine_in", "delivery", "takeaway"], OPTIONS);
    expect(text).not.toMatch(/Выбрано/);
    expect(text).not.toMatch(/\+\d/);
  });

  it("collapses duplicate ids to one label", () => {
    expect(formatSelectedLabels(["dine_in", "dine_in", "delivery"], OPTIONS)).toBe(
      "На стол, Доставка"
    );
  });

  it("renders stale ids truthfully instead of dropping them silently", () => {
    expect(formatSelectedLabels(["dine_in", "ghost"], OPTIONS)).toBe("На стол, ghost");
  });
});
