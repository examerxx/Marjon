import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReportEmptyState from "./ReportEmptyState";

describe("ReportEmptyState shared illustration", () => {
  it("renders the business title with the universal image and no description", () => {
    render(<ReportEmptyState title="Отменённых блюд нет" />);
    expect(screen.getByText("Отменённых блюд нет")).toBeInTheDocument();
    expect(screen.queryByText("За выбранный период и фильтры отмены не найдены.")).toBeNull();
    const image = screen.getByRole("presentation", { hidden: true });
    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("alt", "");
    expect(image.getAttribute("src")).toBeTruthy();
    expect(image).toHaveClass("owner-report-empty-image");
  });

  it("keeps the image decorative and the state semantic", () => {
    const { container } = render(<ReportEmptyState title="T" />);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".owner-report-empty__icon")).toBeNull();
    expect(container.querySelector(".owner-report-empty-description")).toBeNull();
  });

  it("hides visually while loading without unmounting the state", () => {
    const { container, rerender } = render(<ReportEmptyState title="T" hidden />);
    expect(container.querySelector('[role="status"]')).toHaveStyle({ visibility: "hidden" });
    rerender(<ReportEmptyState title="T" hidden={false} />);
    expect(container.querySelector('[role="status"]')).not.toHaveStyle({ visibility: "hidden" });
  });
});
