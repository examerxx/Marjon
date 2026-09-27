import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { buildCustomerTemplate, buildKitchenTemplate, testPrintReceipt } from "../../api/receipt";
import ReceiptPreview, { computeFitScale, FIT_MIN_SCALE, getCustomerReceiptTotals } from "./ReceiptPreview";

const customerOrder = {
  order_number: "3",
  table_number: "1 (Divanli Kabina)",
  waiter: "Kassir",
  order_type: "На стол",
  discount: 0,
  service_fee: 8000,
  vat: 0,
  total_amount: 108640,
  created_at: "2025-07-31T18:17:00",
  payments: [
    { label: "Наличные", amount: 108000 },
    { label: "Карта", amount: 600 },
    { label: "Подарочный баланс", amount: 0 },
  ],
  items: [
    { id: 1, name: "Somsa", quantity: 10, price: 8000, total: 80000 },
    { id: 2, name: "Shashlik tovuqli 200g", quantity: 2, price: 32000, total: 64000 },
  ],
};

const kitchenOrder = {
  order_number: "A-1042",
  table_number: "12",
  waiter: "Aziz",
  station: "Горячий цех",
  priority: "Срочно",
  note: "Без лука в салате",
  created_at: "2026-07-27T10:41:00",
  items: [
    { id: 1, name: "Плов чайханский", quantity: 2, modifiers: ["Без казы", "Острый соус отдельно"] },
    { id: 2, name: "Салат Ачичук", quantity: 1, modifiers: ["Меньше соли"] },
  ],
};

function renderCustomer({ template = buildCustomerTemplate(), order = customerOrder } = {}) {
  return render(<ReceiptPreview type="customer" template={template} order={order} org={{ name: "MARJON", phone: "+998770702101" }} />);
}

function renderKitchen({ template = buildKitchenTemplate(), order = kitchenOrder } = {}) {
  return render(<ReceiptPreview type="kitchen" template={template} order={order} />);
}

function receiptRoot(container) {
  return container.querySelector("[data-receipt-print-root]");
}

describe("ReceiptPreview print layout", () => {
  it("renders a real uploaded company logo, never a fabricated one", () => {
    const { container } = render(
      <ReceiptPreview type="customer" template={buildCustomerTemplate()} order={customerOrder} org={{ name: "MARJON", logo: "https://cdn.test/logo.png" }} />,
    );
    const logo = container.querySelector("img.receipt-preview__logo");
    expect(logo).not.toBeNull();
    expect(logo.getAttribute("src")).toBe("https://cdn.test/logo.png");
  });

  it("renders no logo when the company has none uploaded (physical parity)", () => {
    const { container } = renderCustomer();
    expect(container.querySelector("img.receipt-preview__logo")).toBeNull();
  });

  it("renders the template restaurant name, not a hardcoded brand", () => {
    const template = { ...buildCustomerTemplate(), restaurantName: "Чайхана №1" };
    render(<ReceiptPreview type="customer" template={template} order={customerOrder} org={{ name: "MARJON" }} />);
    expect(screen.getByText("Чайхана №1")).toBeInTheDocument();
  });

  it("renders the customer order number exactly once (no bottom duplicate)", () => {
    renderCustomer();

    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
    // The retired bottom-order duplicate is gone: one info row only.
    expect(screen.getAllByText("Номер заказа:")).toHaveLength(1);
    expect(screen.getAllByText("3")).toHaveLength(1);
  });

  it("renders the total amount", () => {
    renderCustomer();

    expect(screen.getByText("Итого к оплате:")).toBeInTheDocument();
    expect(screen.getByText("108 640")).toBeInTheDocument();
  });

  it("does not change the subtotal calculation", () => {
    expect(getCustomerReceiptTotals(customerOrder).subtotal).toBe(144000);
  });

  it("hides a zero discount row", () => {
    renderCustomer();

    expect(screen.queryByText("Скидка")).not.toBeInTheDocument();
  });

  it("hides a zero tax row", () => {
    renderCustomer();

    expect(screen.queryByText("Налог")).not.toBeInTheDocument();
  });

  it("hides a zero service row", () => {
    renderCustomer({ order: { ...customerOrder, service_fee: 0 } });

    expect(screen.queryByText("Обслуживание")).not.toBeInTheDocument();
  });

  it("hides payment methods with zero amount", () => {
    renderCustomer();

    expect(screen.queryByText("Подарочный баланс:")).not.toBeInTheDocument();
  });

  it("never renders a bottom order-number duplicate (no such physical block)", () => {
    const { container } = renderCustomer();
    expect(container.querySelector(".receipt-preview__bottom-order")).toBeNull();
    expect(screen.queryByText("НОМЕР ЗАКАЗА")).toBeNull();
    // The single real order number lives in the order info section.
    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
  });

  it("keeps a long item name fully in the customer receipt", () => {
    const longName = "Плов чайханский ".repeat(8).trim();
    renderCustomer({
      order: {
        ...customerOrder,
        items: [{ id: 9, name: longName, quantity: 1, price: 12345, total: 12345 }],
      },
    });

    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it("does not render an empty waiter row", () => {
    renderCustomer({ order: { ...customerOrder, waiter: "" } });

    expect(screen.queryByText("Официант:")).not.toBeInTheDocument();
  });

  it("does not render an empty table row", () => {
    renderCustomer({ order: { ...customerOrder, table_number: "" } });

    expect(screen.queryByText("Номер стола:")).not.toBeInTheDocument();
  });

  it("does not render station in the kitchen receipt", () => {
    renderKitchen();

    expect(screen.queryByText("Станция")).not.toBeInTheDocument();
    expect(screen.queryByText("Горячий цех")).not.toBeInTheDocument();
  });

  it("does not render the old kitchen priority frame class", () => {
    const { container } = renderKitchen();

    expect(container.querySelector(".receipt-preview__priority")).toBeNull();
  });

  it("renders modifiers as plain text instead of gray note cards", () => {
    const { container } = renderKitchen();

    expect(screen.getByText("- Без казы, Острый соус отдельно")).toBeInTheDocument();
    expect(container.querySelector(".receipt-preview__notes")).toBeNull();
  });

  it("renders urgent kitchen orders", () => {
    renderKitchen();

    expect(screen.getByText("! СРОЧНО !")).toBeInTheDocument();
  });

  it("does not use the old bordered wrapper class for urgent text", () => {
    const { container } = renderKitchen();
    const urgent = screen.getByText("! СРОЧНО !");

    expect(urgent).toHaveClass("receipt-preview__kitchen-urgent");
    expect(container.querySelector(".receipt-preview__priority")).toBeNull();
  });

  it("omits urgency for non-urgent kitchen orders", () => {
    renderKitchen({ order: { ...kitchenOrder, priority: "Обычный", urgent: false, is_urgent: false } });

    expect(screen.queryByText("! СРОЧНО !")).not.toBeInTheDocument();
  });

  it("does not create a comment block when the kitchen comment is empty", () => {
    const { container } = renderKitchen({ order: { ...kitchenOrder, note: "" } });

    expect(container.querySelector(".receipt-preview__kitchen-comment")).toBeNull();
  });

  it("supports data-paper-size 58", () => {
    const { container } = renderCustomer({ template: { ...buildCustomerTemplate(), paperSize: "58mm" } });

    expect(receiptRoot(container)).toHaveAttribute("data-paper-size", "58");
  });

  it("supports data-paper-size 80", () => {
    const { container } = renderKitchen({ template: { ...buildKitchenTemplate(), paperSize: "80mm" } });

    expect(receiptRoot(container)).toHaveAttribute("data-paper-size", "80");
  });

  it("uses one shared component for preview and print content", () => {
    const { container } = renderCustomer();

    expect(container.querySelectorAll('[data-receipt-component="shared"]')).toHaveLength(1);
    expect(receiptRoot(container)).toHaveAttribute("data-receipt-type", "customer");
  });

  it("does not call a backend mutation for test print", async () => {
    const post = vi.spyOn(api, "post");
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, writable: true });

    await expect(testPrintReceipt(buildCustomerTemplate())).resolves.toMatchObject({ ok: true, source: "local" });

    expect(post).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("keeps control buttons outside the print receipt content", () => {
    const { container } = renderCustomer();
    const root = receiptRoot(container);

    expect(within(root).queryByRole("button")).not.toBeInTheDocument();
    expect(root.querySelector("input, select, textarea")).toBeNull();
  });
});

describe("ReceiptPreview block-order parity", () => {
  const rootText = (container) => receiptRoot(container).textContent;
  const before = (text, a, b) => expect(text.indexOf(a)).toBeGreaterThanOrEqual(0) && expect(text.indexOf(a)).toBeLessThan(text.indexOf(b));

  it("renders customer blocks in the canonical persisted order by default", () => {
    const { container } = renderCustomer();
    const text = rootText(container);
    // logo/name → items → totals → payment → footer.
    before(text, "MARJON", "Кол-во");
    before(text, "Кол-во", "Итого к оплате:");
    before(text, "Итого к оплате:", "RAXMAT");
  });

  it("reorders the preview immediately when template.blocks changes (total before items)", () => {
    const base = buildCustomerTemplate();
    const reordered = { ...base, blocks: ["total", "items", ...base.blocks.filter((b) => b !== "total" && b !== "items")] };
    const { container } = renderCustomer({ template: reordered });
    const text = rootText(container);
    before(text, "Итого к оплате:", "Кол-во");
  });

  it("keeps a moved block's style attached after reorder", () => {
    const base = buildCustomerTemplate();
    const template = {
      ...base,
      blocks: ["restaurantName", "logo", ...base.blocks.filter((b) => b !== "restaurantName" && b !== "logo")],
      blockStyles: { ...base.blockStyles, restaurantName: { size: "xlarge", align: "center", weight: "bold" } },
    };
    const { container } = renderCustomer({ template });
    const brand = container.querySelector(".receipt-preview__brand");
    expect(brand).toHaveClass("receipt-preview__block--size-xlarge");
    expect(brand).toHaveClass("receipt-preview__block--weight-bold");
  });

  it("keeps a reordered but disabled block hidden", () => {
    const base = buildCustomerTemplate();
    const template = {
      ...base,
      blocks: ["total", "items", ...base.blocks.filter((b) => b !== "total" && b !== "items")],
      enabled: { ...base.enabled, total: false },
    };
    const { container } = renderCustomer({ template });
    expect(rootText(container)).not.toContain("Итого к оплате:");
  });

  it("falls back safely for a partial/legacy order without dropping known blocks", () => {
    const base = buildCustomerTemplate();
    // Only two blocks listed; the rest must still render (appended canonically).
    const { container } = renderCustomer({ template: { ...base, blocks: ["total", "items"] } });
    const text = rootText(container);
    expect(text).toContain("Итого к оплате:");
    expect(text).toContain("Кол-во");
    expect(text).toContain("RAXMAT"); // footer thank-you not dropped
  });

  it("ignores unknown future block keys without crashing", () => {
    const base = buildCustomerTemplate();
    const { container } = renderCustomer({ template: { ...base, blocks: ["items", "totally_unknown_block", "total"] } });
    expect(rootText(container)).toContain("Итого к оплате:");
    expect(within(receiptRoot(container)).queryByText(/totally_unknown_block/)).toBeNull();
  });

  it("ignores the retired qr key in legacy templates (no fake QR graphic)", () => {
    const base = buildCustomerTemplate();
    const legacy = { ...base, blocks: [...base.blocks, "qr"], enabled: { ...base.enabled, qr: true } };
    const { container } = renderCustomer({ template: legacy });
    expect(container.querySelector(".receipt-preview__qr-block")).toBeNull();
    expect(rootText(container)).toContain("Итого к оплате:");
  });

  it("reorders the kitchen preview independently and keeps it pricing-free", () => {
    const base = buildKitchenTemplate();
    const reordered = { ...base, blocks: ["items", "orderNumber", ...base.blocks.filter((b) => b !== "items" && b !== "orderNumber")] };
    const { container } = renderKitchen({ template: reordered });
    const text = receiptRoot(container).textContent;
    // items (Плов) now precede the big order number.
    expect(text.indexOf("Плов чайханский")).toBeLessThan(text.indexOf("#A-1042"));
    expect(text).not.toContain("Итого к оплате:");
  });
});


describe("ReceiptPreview fixed reference lines", () => {
  it("renders solid rules after header/info/head/total/payment and dashed after items/summary", () => {
    const { container } = renderCustomer();
    const solids = container.querySelectorAll(".receipt-preview__rule.is-solid");
    expect(solids.length).toBe(5);
    const dashed = [...container.querySelectorAll(".receipt-preview__rule")].filter((el) => !el.classList.contains("is-solid"));
    expect(dashed.length).toBe(2);
    const headRule = container.querySelector(".receipt-preview__items .receipt-preview__rule.is-solid");
    expect(headRule).not.toBeNull();
  });

  it("renders no rules between item rows and no divider machinery", () => {
    const { container } = renderCustomer();
    expect(container.querySelector("[data-divider]")).toBeNull();
    expect(container.querySelector("button.receipt-divider-hit")).toBeNull();
    expect(container.querySelector(".receipt-preview__divider-stars")).toBeNull();
    expect(document.querySelector(".receipt-divider-pop")).toBeNull();
    expect(receiptRoot(container).textContent).toContain("Итого к оплате:");
  });
});

describe("computeFitScale contract", () => {
  it("never upscales when the receipt already fits", () => {
    expect(computeFitScale(430, 400, 500, 612)).toBe(1);
  });

  it("takes the tighter constraint (height-bound 80mm receipt)", () => {
    // Real audit numbers: 430x819 paper in a 322x612 box.
    expect(computeFitScale(430, 819, 322, 612)).toBeCloseTo(612 / 819, 5);
  });

  it("takes the width constraint on narrow panes", () => {
    expect(computeFitScale(430, 200, 215, 612)).toBeCloseTo(0.5, 5);
  });

  it("floors at the readable minimum instead of shrinking to a miniature", () => {
    expect(computeFitScale(430, 2000, 322, 612)).toBe(FIT_MIN_SCALE);
    expect(FIT_MIN_SCALE).toBe(0.5);
  });

  it("falls back to 1.0 when nothing is measurable", () => {
    expect(computeFitScale(0, 0, 0, 0)).toBe(1);
    expect(computeFitScale(430, 819, 0, 0)).toBe(1);
  });
});

describe("ReceiptPreview constructor style mapping", () => {
  const styled = (block, style) => {
    const base = buildCustomerTemplate();
    return render(
      <ReceiptPreview
        type="customer"
        template={{ ...base, blockStyles: { ...base.blockStyles, [block]: style } }}
        order={customerOrder}
        org={{ name: "MARJON", phone: "+998770702101" }}
      />,
    );
  };

  it("maps size options onto brand/total/thanks/footer/items blocks", () => {
    let { container } = styled("restaurantName", { size: "xlarge", align: "center", weight: "bold" });
    expect(container.querySelector(".receipt-preview__brand")).toHaveClass("receipt-preview__block--size-xlarge");
    ({ container } = styled("total", { size: "large", align: "left", weight: "standard" }));
    expect(container.querySelector(".receipt-preview__total")).toHaveClass("receipt-preview__block--size-large");
    ({ container } = styled("thankYouText", { size: "xlarge", align: "center", weight: "bold" }));
    expect(container.querySelector(".receipt-preview__customer-footer strong")).toHaveClass("receipt-preview__block--size-xlarge");
    ({ container } = styled("footerText", { size: "large", align: "center", weight: "bold" }));
    expect(container.querySelector(".receipt-preview__customer-footer b")).toHaveClass("receipt-preview__block--size-large");
    ({ container } = styled("items", { size: "large", align: "left", weight: "standard" }));
    expect(container.querySelector("[data-receipt-items]").parentElement).toHaveClass("receipt-preview__block--size-large");
  });

  it("maps weight onto info rows and thanks so the Bold control has a target", () => {
    const { container } = styled("orderNumber", { size: "standard", align: "left", weight: "bold" });
    const row = [...container.querySelectorAll(".receipt-preview__info-row")]
      .find((el) => el.textContent.includes("Номер заказа:"));
    expect(row).toHaveClass("receipt-preview__block--weight-bold");
    expect(container.querySelector(".receipt-preview__customer-footer strong"))
      .toHaveClass("receipt-preview__block--weight-bold");
  });

  it("maps alignment onto info rows without breaking the label/value layout", () => {
    const base = buildCustomerTemplate();
    const { container } = render(
      <ReceiptPreview
        type="customer"
        template={{ ...base, blockStyles: { ...base.blockStyles, table: { size: "standard", align: "right", weight: "standard" } } }}
        order={customerOrder}
        org={{ name: "MARJON", phone: "+998770702101" }}
      />,
    );
    const row = [...container.querySelectorAll(".receipt-preview__info-row")]
      .find((el) => el.textContent.includes("Номер стола:"));
    expect(row).toHaveClass("receipt-preview__block--align-right");
    expect(row.querySelector("b")).not.toBeNull();
    expect(row.querySelector("span")).not.toBeNull();
  });
});

describe("ReceiptPreview fit-to-pane presentation", () => {
  it("keeps the legacy shell without fitPane (print/root contract untouched)", () => {
    const { container } = renderCustomer();
    const shell = container.querySelector("[data-receipt-preview-shell]");
    expect(shell).not.toHaveClass("receipt-preview-shell--fit");
    expect(shell.hasAttribute("data-fit-scale")).toBe(false);
    expect(container.querySelector(".receipt-fit-viewport")).toBeNull();
  });

  it("renders the fit shell with a neutral 1.0 scale when no layout is measurable (jsdom)", () => {
    const { container } = render(
      <ReceiptPreview type="customer" template={buildCustomerTemplate()} order={customerOrder} org={{ name: "MARJON" }} fitPane />,
    );
    const shell = container.querySelector("[data-receipt-preview-shell]");
    expect(shell).toHaveClass("receipt-preview-shell--fit");
    expect(shell.getAttribute("data-fit-scale")).toBe("1.000");
    expect(container.querySelector(".receipt-fit-viewport")).not.toBeNull();
    // Logical receipt contract is identical in both modes.
    expect(receiptRoot(container).textContent).toContain("Итого к оплате:");
  });
});
