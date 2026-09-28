import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { buildCustomerTemplate, buildKitchenTemplate, testPrintReceipt } from "../../api/receipt";
import ReceiptPreview, { computeFitScale, FIT_MIN_SCALE, getCustomerReceiptTotals } from "./ReceiptPreview";
import { LINE_SPACING_LARGE, normalizeLineSpacing } from "../../api/receipt";

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

  it("renders the order number in info and in the bottom block (same order data)", () => {
    const { container } = renderCustomer();

    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
    // One info row only.
    expect(screen.getAllByText("Номер заказа:")).toHaveLength(1);
    // Info value "3" plus the bottom block value "3": same order, two spots.
    expect(screen.getAllByText("3")).toHaveLength(2);
    expect(container.querySelector(".receipt-preview__bottomnum-value")).toHaveTextContent("3");
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

  it("still applies stored discount/vat values without editor cards", () => {
    // The editor hides discount/vat toggles, but already-saved templates
    // with nonzero values keep rendering them via the total-anchored unit.
    const base = buildCustomerTemplate();
    const template = {
      ...base,
      blocks: base.blocks.filter((block) => block !== "discount" && block !== "vat"),
      enabled: { ...base.enabled, discount: true, vat: true },
    };
    render(
      <ReceiptPreview
        type="customer"
        template={template}
        order={{ ...customerOrder, discount: 5000, vat: 1200 }}
        org={{ name: "MARJON", phone: "+998770702101" }}
      />,
    );
    expect(screen.getByText("Скидка")).toBeInTheDocument();
    expect(screen.getByText("Налог")).toBeInTheDocument();
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

  it("renders the bottom order number block below the comment (caption + big number)", () => {
    const { container } = renderCustomer();
    expect(container.querySelector(".receipt-preview__bottom-order")).toBeNull();
    const block = container.querySelector(".receipt-preview__bottomnum");
    expect(block).not.toBeNull();
    expect(block.querySelector(".receipt-preview__bottomnum-caption")).toHaveTextContent("НОМЕР ЗАКАЗА");
    // Order number comes from the current order data, not a static value.
    expect(block.querySelector(".receipt-preview__bottomnum-value")).toHaveTextContent("3");
    // The single real order number still lives in the order info section.
    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
  });

  it("hides the bottom order number block when disabled", () => {
    const base = buildCustomerTemplate();
    const { container } = render(
      <ReceiptPreview
        type="customer"
        template={{ ...base, enabled: { ...base.enabled, bottomOrderNumber: false } }}
        order={customerOrder}
        org={{ name: "MARJON", phone: "+998770702101" }}
      />,
    );
    expect(container.querySelector(".receipt-preview__bottomnum")).toBeNull();
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

  it("never renders the priority banner, even for urgent orders", () => {
    renderKitchen();

    expect(screen.queryByText("! СРОЧНО !")).not.toBeInTheDocument();
    expect(screen.queryByText("ОТМЕНА")).not.toBeInTheDocument();
  });

  it("does not use the old bordered wrapper class for urgent text", () => {
    const { container } = renderKitchen();

    expect(container.querySelector(".receipt-preview__kitchen-urgent")).toBeNull();
    expect(container.querySelector(".receipt-preview__priority")).toBeNull();
  });

  it("omits urgency for non-urgent kitchen orders", () => {
    renderKitchen({ order: { ...kitchenOrder, priority: "Обычный", urgent: false, is_urgent: false } });

    expect(screen.queryByText("! СРОЧНО !")).not.toBeInTheDocument();
  });

  it("renders the order type when enabled", () => {
    renderKitchen({ order: { ...kitchenOrder, order_type: "На стол" } });

    expect(screen.getByText("Тип заказа:")).toBeInTheDocument();
    expect(screen.getByText("На стол")).toBeInTheDocument();
  });

  it("does not duplicate the order number for a normal (non-cancelled) order", () => {
    const { container } = renderKitchen();

    expect(container.querySelector(".receipt-preview__kitchen-cancel")).toBeNull();
    expect(screen.queryByText("ОТМЕНА")).not.toBeInTheDocument();
    expect(screen.getAllByText("#A-1042")).toHaveLength(1);
  });

  it("renders the cancellation block instead of the normal number when cancelled", () => {
    const { container } = renderKitchen({
      order: { ...kitchenOrder, status: "cancelled" },
    });

    expect(screen.getByText("ОТМЕНА")).toBeInTheDocument();
    expect(screen.getAllByText("#A-1042")).toHaveLength(1);
  });

  it("keeps dishes visible with no money when showOrderSum is OFF", () => {
    const { container } = renderKitchen();

    expect(screen.getByText("Плов чайханский", { exact: false })).toBeInTheDocument();
    expect(container.querySelector(".receipt-preview__kitchen-amount")).toBeNull();
  });

  it("shows real amounts only when showOrderSum is ON and data provides them", () => {
    const order = {
      ...kitchenOrder,
      items: [{ id: 1, name: "Плов чайханский", quantity: 2, total: 16000 }],
    };
    const template = {
      ...buildKitchenTemplate(),
      enabled: { ...buildKitchenTemplate().enabled, showOrderSum: true },
    };
    const { container } = renderKitchen({ template, order });

    expect(container.querySelector(".receipt-preview__kitchen-amount")).not.toBeNull();
  });

  it("shows no amounts when showOrderSum is ON but the order has no money", () => {
    const template = {
      ...buildKitchenTemplate(),
      enabled: { ...buildKitchenTemplate().enabled, showOrderSum: true },
    };
    const { container } = renderKitchen({ template });

    expect(screen.getByText("Плов чайханский", { exact: false })).toBeInTheDocument();
    expect(container.querySelector(".receipt-preview__kitchen-amount")).toBeNull();
  });

  it("hides item notes and the order note when comment is OFF but keeps modifiers", () => {
    const template = {
      ...buildKitchenTemplate(),
      enabled: { ...buildKitchenTemplate().enabled, comment: false },
    };
    renderKitchen({ template });

    expect(screen.getByText("- Без казы, Острый соус отдельно")).toBeInTheDocument();
    expect(screen.queryByText("Без лука в салате")).not.toBeInTheDocument();
    expect(screen.queryByText("Комментарий:")).not.toBeInTheDocument();
  });

  it("applies chef style classes to the order number", () => {
    const { container } = renderKitchen();
    const number = container.querySelector(".receipt-preview__kitchen-number");

    expect(number).toHaveClass("receipt-preview__block--size-large");
    expect(number).toHaveClass("receipt-preview__block--align-center");
    expect(number).toHaveClass("receipt-preview__block--weight-bold");
  });

  it("maps a legacy medium chef size to large in the preview", () => {
    const template = {
      ...buildKitchenTemplate(),
      blockStyles: {
        ...buildKitchenTemplate().blockStyles,
        orderNumber: { size: "medium", align: "center", weight: "bold" },
      },
    };
    const { container } = renderKitchen({ template });
    const number = container.querySelector(".receipt-preview__kitchen-number");

    expect(number).toHaveClass("receipt-preview__block--size-large");
    expect(number.className).not.toContain("size-medium");
  });

  it("renders legacy kitchen template keys without crashing", () => {
    const legacy = {
      ...buildKitchenTemplate(),
      blocks: ["orderNumber", "table", "waiter", "createdAt", "items", "orderNote", "priority"],
    };
    const { container } = renderKitchen({ template: legacy });

    expect(screen.getByText("#A-1042")).toBeInTheDocument();
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
    const reordered = { ...base, blocks: ["date", "orderNumber", ...base.blocks.filter((b) => b !== "date" && b !== "orderNumber")] };
    const { container } = renderKitchen({ template: reordered });
    const text = receiptRoot(container).textContent;
    // date (Время) now precedes the big order number.
    expect(text.indexOf("Время:")).toBeLessThan(text.indexOf("#A-1042"));
    expect(text).not.toContain("Итого к оплате:");
  });

  it("keeps dishes as core content even when legacy items keys are stored", () => {
    const base = buildKitchenTemplate();
    const legacy = { ...base, blocks: ["orderNumber", "items", "modifiers"], enabled: { ...base.enabled, showOrderSum: false } };
    const { container } = renderKitchen({ template: legacy });
    expect(receiptRoot(container).textContent).toContain("Плов чайханский");
    expect(container.querySelector(".receipt-preview__kitchen-amount")).toBeNull();
  });
});


describe("ReceiptPreview fixed reference lines", () => {
  it("renders solid rules after info/head/total/payment and dashed after items/summary", () => {
    const { container } = renderCustomer();
    const solids = container.querySelectorAll(".receipt-preview__rule.is-solid");
    expect(solids.length).toBe(4);
    const dashed = [...container.querySelectorAll(".receipt-preview__rule")].filter((el) => !el.classList.contains("is-solid"));
    expect(dashed.length).toBe(2);
    const headRule = container.querySelector(".receipt-preview__items .receipt-preview__rule.is-solid");
    expect(headRule).not.toBeNull();
  });

  it("renders no rule directly under the restaurant header block", () => {
    const { container } = renderCustomer();
    const sections = [...container.querySelectorAll("[data-receipt-section]")];
    const headerSection = sections.find((el) => el.getAttribute("data-receipt-section") === "header");
    expect(headerSection).not.toBeNull();
    expect(headerSection.querySelector(".receipt-preview__rule")).toBeNull();
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
  it("never upscales when the pane fits the paper width", () => {
    expect(computeFitScale(430, 500)).toBe(1);
  });

  it("scales by width only: height has no parameter to influence the result", () => {
    // The signature itself is the contract: (natW, availW). A short pane
    // (browser zoom) yields the same scale as a tall one at equal width.
    expect(computeFitScale(430, 392)).toBeCloseTo(392 / 430, 5);
    expect(computeFitScale(326, 392)).toBe(1);
  });

  it("floors at the readable minimum on genuinely narrow panes", () => {
    expect(computeFitScale(430, 215)).toBeCloseTo(0.5, 5);
    expect(computeFitScale(430, 10)).toBe(FIT_MIN_SCALE);
    expect(FIT_MIN_SCALE).toBe(0.5);
  });

  it("keeps a tall receipt at the width scale instead of tiny-mode", () => {
    // 826px tall receipt in a short pane: width still decides, no collapse.
    expect(computeFitScale(430, 392)).toBeGreaterThanOrEqual(0.9);
  });

  it("falls back to 1.0 when nothing is measurable", () => {
    expect(computeFitScale(0, 0)).toBe(1);
    expect(computeFitScale(430, 0)).toBe(1);
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
    ({ container } = styled("bottomOrderNumber", { size: "large", align: "center", weight: "bold" }));
    expect(container.querySelector(".receipt-preview__bottomnum")).toHaveClass("receipt-preview__block--size-large");
    ({ container } = styled("items", { size: "large", align: "left", weight: "standard" }));
    expect(container.querySelector("[data-receipt-items]").parentElement).toHaveClass("receipt-preview__block--size-large");
  });

  it("maps alignment onto the restaurant name block for every option", () => {
    const base = buildCustomerTemplate();
    for (const align of ["left", "center", "right"]) {
      const { container, unmount } = render(
        <ReceiptPreview
          type="customer"
          template={{ ...base, blockStyles: { ...base.blockStyles, restaurantName: { size: "large", align, weight: "bold" } } }}
          order={customerOrder}
          org={{ name: "MARJON", phone: "+998770702101" }}
        />,
      );
      expect(container.querySelector(".receipt-preview__brand"))
        .toHaveClass(`receipt-preview__block--align-${align}`);
      unmount();
    }
  });

  it("maps size options onto the bottom order number block", () => {
    const base = buildCustomerTemplate();
    const at = (size) => {
      const { container, unmount } = render(
        <ReceiptPreview
          type="customer"
          template={{ ...base, blockStyles: { ...base.blockStyles, bottomOrderNumber: { size, align: "center", weight: "bold" } } }}
          order={customerOrder}
          org={{ name: "MARJON", phone: "+998770702101" }}
        />,
      );
      const cls = container.querySelector(".receipt-preview__bottomnum").className;
      unmount();
      return cls;
    };
    expect(at("standard")).not.toMatch(/size-(large|xlarge)/);
    expect(at("large")).toMatch(/size-large/);
    expect(at("xlarge")).toMatch(/size-xlarge/);
  });

  it("maps alignment onto the bottom order number block for every option", () => {
    const base = buildCustomerTemplate();
    for (const align of ["left", "center", "right"]) {
      const { container, unmount } = render(
        <ReceiptPreview
          type="customer"
          template={{ ...base, blockStyles: { ...base.blockStyles, bottomOrderNumber: { size: "large", align, weight: "bold" } } }}
          order={customerOrder}
          org={{ name: "MARJON", phone: "+998770702101" }}
        />,
      );
      expect(container.querySelector(".receipt-preview__bottomnum"))
        .toHaveClass(`receipt-preview__block--align-${align}`);
      unmount();
    }
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

describe("ReceiptPreview line-spacing density", () => {
  it("resolves a missing density to the large approved baseline", () => {
    expect(normalizeLineSpacing(undefined)).toBe(LINE_SPACING_LARGE);
    expect(normalizeLineSpacing("ultra")).toBe(LINE_SPACING_LARGE);
    expect(normalizeLineSpacing("small")).toBe("small");
    expect(normalizeLineSpacing("medium")).toBe("medium");
  });

  it("exposes the resolved density on the print root", () => {
    const { container, unmount } = renderCustomer();
    expect(receiptRoot(container)).toHaveAttribute("data-line-spacing", "large");
    unmount();
    const small = render(
      <ReceiptPreview type="customer" template={{ ...buildCustomerTemplate(), lineSpacing: "small" }} order={customerOrder} org={{ name: "MARJON" }} />,
    );
    expect(receiptRoot(small.container)).toHaveAttribute("data-line-spacing", "small");
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
