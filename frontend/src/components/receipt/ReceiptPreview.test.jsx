import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { buildCustomerTemplate, buildKitchenTemplate, testPrintReceipt } from "../../api/receipt";
import ReceiptPreview, { getCustomerReceiptTotals } from "./ReceiptPreview";

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
  it("renders the customer receipt logo and Marjon title", () => {
    renderCustomer();

    expect(screen.getByRole("img", { name: /MARJON/i })).toBeInTheDocument();
    expect(screen.getByText("MARJON")).toBeInTheDocument();
  });

  it("renders the customer order number", () => {
    renderCustomer();

    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the total amount", () => {
    renderCustomer();

    expect(screen.getByText("ИТОГО:")).toBeInTheDocument();
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

  it("renders the large bottom order number", () => {
    const { container } = renderCustomer();
    const bottomOrder = container.querySelector(".receipt-preview__bottom-order");

    expect(bottomOrder).toHaveTextContent("НОМЕР ЗАКАЗА");
    expect(bottomOrder).toHaveTextContent("3");
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
