import { fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ReceiptSettingsPage from "./ReceiptSettingsPage";
import * as receiptApi from "../../api/receipt";

const mockOrg = vi.hoisted(() => ({
  name: "MARJON",
  phone: "+998770702101",
  currency: "UZS",
  address: "",
}));

vi.mock("../../context/OrgContext", () => ({
  useOrg: () => ({
    org: mockOrg,
  }),
}));

vi.mock("../../api/receipt", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    getCustomerTemplate: vi.fn(async (org) => ({
      template: actual.buildCustomerTemplate(org),
      source: "local",
    })),
    saveCustomerTemplate: vi.fn(async (template) => ({ template, source: "local" })),
    testPrintReceipt: vi.fn(async () => ({ ok: true, source: "local" })),
  };
});

const receiptCss = readFileSync("src/styles/receipt.css", "utf8");

function cssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return receiptCss.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, "m"))?.[1] || "";
}

function renderReceiptSettings() {
  return render(<ReceiptSettingsPage />);
}

describe("ReceiptSettingsPage scroll layout", () => {
  it("renders settings and receipt preview in separate columns", () => {
    const { container } = renderReceiptSettings();
    const layout = container.querySelector(".receipt-layout");
    const settings = container.querySelector(".receipt-settings");
    const previewColumn = container.querySelector(".receipt-preview-sticky");
    const receiptRoot = container.querySelector("[data-receipt-print-root]");

    expect(layout).toContainElement(settings);
    expect(layout).toContainElement(previewColumn);
    expect(previewColumn).toContainElement(receiptRoot);
    expect(settings).not.toContainElement(receiptRoot);
  });

  it("keeps the receipt preview as the shared print component", () => {
    const { container } = renderReceiptSettings();

    expect(container.querySelectorAll('[data-receipt-component="shared"]')).toHaveLength(1);
    expect(container.querySelector("[data-receipt-print-root]")).toHaveAttribute("data-receipt-type", "customer");
  });

  it("continues to update paper size in the preview", () => {
    const { container } = renderReceiptSettings();
    const paperSelect = container.querySelector(".receipt-field select");

    fireEvent.change(paperSelect, { target: { value: "58mm" } });
    expect(container.querySelector("[data-receipt-print-root]")).toHaveAttribute("data-paper-size", "58");

    fireEvent.change(paperSelect, { target: { value: "80mm" } });
    expect(container.querySelector("[data-receipt-print-root]")).toHaveAttribute("data-paper-size", "80");
  });

  it("continues to update the preview from settings fields", async () => {
    const { container } = renderReceiptSettings();

    await waitFor(() => {
      expect(container.querySelector(".receipt-settings > .receipt-panel-title:first-child span")).toBeNull();
    });

    const footerText = container.querySelector(".receipt-field textarea");

    fireEvent.change(footerText, { target: { value: "+998991112233" } });

    expect(container.querySelector("[data-receipt-print-root]")).toHaveTextContent("+998991112233");
  });

  it("does not perform backend mutations when rendering the settings page", () => {
    renderReceiptSettings();

    expect(receiptApi.saveCustomerTemplate).not.toHaveBeenCalled();
    expect(receiptApi.testPrintReceipt).not.toHaveBeenCalled();
  });

  it("defines the desktop layout with only the settings panel as the scroll container", () => {
    expect(cssRule(".receipt-page")).toContain("height: calc(100dvh");
    expect(cssRule(".receipt-page")).toContain("min-height: 0");
    expect(cssRule(".receipt-page")).toContain("overflow: hidden");
    expect(cssRule(".receipt-layout")).toContain("overflow: hidden");
    expect(cssRule(".receipt-layout")).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(cssRule(".receipt-settings")).toContain("overflow-y: auto");
    expect(cssRule(".receipt-settings")).toContain("scrollbar-gutter: stable");
    expect(cssRule(".receipt-preview-sticky")).toContain("overflow: hidden");
    expect(cssRule(".receipt-preview-sticky")).not.toContain("overflow-y: auto");
  });

  it("keeps tablet and mobile layout as a single visible flow", () => {
    expect(receiptCss).toMatch(/@media\s*\(max-width:\s*1024px\)\s*\{[\s\S]*?\.receipt-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/);
    expect(receiptCss).toMatch(/@media\s*\(max-width:\s*1024px\)\s*\{[\s\S]*?\.receipt-settings\s*\{[\s\S]*?overflow:\s*visible;/);
  });

  it("keeps editor controls outside the print receipt content", () => {
    const { container } = renderReceiptSettings();
    const receiptRoot = container.querySelector("[data-receipt-print-root]");

    expect(receiptRoot.querySelector("input, select, textarea, button")).toBeNull();
  });
});
