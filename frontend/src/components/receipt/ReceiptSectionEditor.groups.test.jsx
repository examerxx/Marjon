import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReceiptSectionEditor from "./ReceiptSectionEditor";

const GROUPS = [
  { key: "header", title: "Шапка", blocks: ["logo", "restaurantName", "address", "phone"] },
  { key: "order", title: "Информация о заказе", blocks: ["orderNumber", "table", "waiter", "dateTime"] },
  { key: "items", title: "Состав заказа", blocks: ["items"] },
  { key: "totals", title: "Итоги", blocks: ["discount", "serviceFee", "vat", "total", "paymentMethod"] },
  { key: "footer", title: "Нижняя часть", blocks: ["thankYouText", "footerText"] },
];

const BLOCKS = GROUPS.flatMap((group) => group.blocks);
const LABELS = Object.fromEntries(BLOCKS.map((block) => [block, `label-${block}`]));

function renderEditor(overrides = {}) {
  const props = {
    blocks: BLOCKS,
    enabled: Object.fromEntries(BLOCKS.map((block) => [block, true])),
    labels: LABELS,
    blockStyles: {},
    styleBlocks: [],
    onToggle: vi.fn(),
    onStyleChange: vi.fn(),
    groups: GROUPS,
    ...overrides,
  };
  const result = render(<ReceiptSectionEditor {...props} />);
  return { ...result, props };
}

describe("ReceiptSectionEditor groups", () => {
  it("renders all five group headers with aria-expanded open by default", () => {
    renderEditor();
    for (const group of GROUPS) {
      const header = screen.getByRole("button", { name: group.title });
      expect(header).toBeVisible();
      expect(header).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("keeps every current receipt control rendered inside its group", () => {
    const { container } = renderEditor();
    expect(container.querySelectorAll("[data-block-row]")).toHaveLength(BLOCKS.length);
    for (const group of GROUPS) {
      const section = container.querySelector(`[data-block-group="${group.key}"]`);
      expect(section).not.toBeNull();
      for (const block of group.blocks) {
        expect(within(section).getByRole("checkbox", { name: `label-${block}` })).toBeInTheDocument();
      }
    }
  });

  it("collapse hides editor cards only, without touching block state", () => {
    // jsdom has no layout, so "hidden" is asserted via the collapse contract
    // (aria-expanded + is-open on the animated body); real hiding is covered
    // by the browser suite on the review runtime.
    const { container, props } = renderEditor();
    const header = screen.getByRole("button", { name: "Состав заказа" });
    const section = container.querySelector('[data-block-group="items"]');
    const body = () => section.querySelector(".receipt-section-group__body");
    expect(body()).toHaveClass("is-open");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(body()).not.toHaveClass("is-open");
    // No toggle/payload callback fired by collapsing.
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onStyleChange).not.toHaveBeenCalled();
    // Expand restores the cards with values intact.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(body()).toHaveClass("is-open");
    expect(within(section).getByRole("checkbox", { name: "label-items" })).toBeChecked();
  });

  it("preserves checkbox values across collapse/expand", () => {
    const enabled = Object.fromEntries(BLOCKS.map((block) => [block, true]));
    renderEditor({ enabled: { ...enabled, logo: false } });
    const header = screen.getByRole("button", { name: "Шапка" });
    expect(screen.getByRole("checkbox", { name: "label-logo" })).not.toBeChecked();
    fireEvent.click(header);
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("checkbox", { name: "label-logo" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "label-restaurantName" })).toBeChecked();
  });

  it("keeps block controls functional inside groups", () => {
    const { props } = renderEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: "label-table" }));
    expect(props.onToggle).toHaveBeenCalledWith("table");
  });

  it("renders a flat list without groups (kitchen path unchanged)", () => {
    const { container } = renderEditor({ groups: undefined });
    expect(container.querySelector("[data-block-group]")).toBeNull();
    expect(container.querySelectorAll("[data-block-row]")).toHaveLength(BLOCKS.length);
    expect(container.querySelector(".receipt-section-group__header")).toBeNull();
  });

  it("renders the shared 3-zone style row: size(3) / align(3) / weight(2)", () => {
    const { container } = renderEditor({ styleBlocks: ["table"] });
    const row = container.querySelector('[data-block-row="table"]');
    const style = row.querySelector(".receipt-section-row__style");
    expect(style).not.toBeNull();
    const groups = [...style.querySelectorAll(":scope > .receipt-segment-group")];
    expect(groups.map((g) => g.querySelector(":scope > span").textContent)).toEqual([
      "Размер текста",
      "Выравнивание",
      "Жирность",
    ]);
    const counts = groups.map((g) => g.querySelectorAll(":scope > .receipt-segments > button").length);
    expect(counts).toEqual([3, 3, 2]);
    const sizeLabels = [...groups[0].querySelectorAll("button")].map((b) => b.textContent);
    expect(sizeLabels).toEqual(["Стандартный", "Большой", "Очень большой"]);
  });

  it("renders blocks missing from groups as ungrouped rows (no silent loss)", () => {
    const partial = [{ key: "header", title: "Шапка", blocks: ["logo"] }];
    const { container } = renderEditor({ groups: partial });
    expect(container.querySelectorAll("[data-block-row]")).toHaveLength(BLOCKS.length);
    expect(container.querySelector('[data-block-row="restaurantName"]')).toBeVisible();
  });
});
