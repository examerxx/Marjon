import { describe, expect, it } from "vitest";
import { CUSTOMER_BLOCKS, CUSTOMER_STYLE_BLOCKS } from "../../api/receipt";
import {
  CUSTOMER_BLOCK_PHYSICAL,
  PENDING_BLOCKS,
  isActiveConstructorBlock,
} from "./receiptBlockCapabilities";

describe("receiptBlockCapabilities — active contract", () => {
  it("gives every canonical block a physical entry with a working toggle", () => {
    for (const key of CUSTOMER_BLOCKS) {
      expect(CUSTOMER_BLOCK_PHYSICAL[key], key).toBeDefined();
      expect(CUSTOMER_BLOCK_PHYSICAL[key].toggle).toBe(true);
    }
    expect(Object.keys(CUSTOMER_BLOCK_PHYSICAL)).toHaveLength(CUSTOMER_BLOCKS.length);
  });

  it("locks the style classification: 8 full, 2 full-tabular, 1 preview-only, rest none", () => {
    const by = (kind) => CUSTOMER_BLOCKS.filter((key) => CUSTOMER_BLOCK_PHYSICAL[key].styles === kind);
    expect(by("full").sort()).toEqual(
      ["dateTime", "orderNumber", "restaurantName", "table", "thankYouText", "total", "waiter"].sort(),
    );
    expect(by("full-tabular").sort()).toEqual(["items", "paymentMethod"].sort());
    expect(by("preview-only").sort()).toEqual(["bottomOrderNumber"].sort());
    expect(by("partial").sort()).toEqual([]);
    expect(by("none").sort()).toEqual(
      ["address", "discount", "logo", "phone", "serviceFee", "vat"].sort(),
    );
  });

  it("keeps the style UI list exactly equal to full + full-tabular (no drift)", () => {
    expect([...CUSTOMER_STYLE_BLOCKS].sort()).toEqual(
      CUSTOMER_BLOCKS.filter((key) => CUSTOMER_BLOCK_PHYSICAL[key].styles !== "none").sort(),
    );
  });
});

describe("receiptBlockCapabilities — pending can never appear as active", () => {
  const pendingKeys = PENDING_BLOCKS.map((entry) => entry.key);

  it("covers every reference-video gap with a backend requirement", () => {
    // bottomOrderNumber graduated to a canonical block (preview-only until the
    // formatter workstream renders it); the rest remain backend-gated.
    for (const key of ["orderTypeSplit", "subtotal", "separators", "deliveryAddress", "deliveryPhone", "deliveryComment", "qr", "splitBill", "printerConnection"]) {
      expect(pendingKeys).toContain(key);
    }
    for (const entry of PENDING_BLOCKS) {
      expect(entry.key).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.domain).toMatch(/^(template|pos|printer)$/);
      expect(entry.need.length).toBeGreaterThan(20);
    }
  });

  it("keeps every pending key out of the canonical constructor list", () => {
    for (const key of pendingKeys) {
      expect(CUSTOMER_BLOCKS).not.toContain(key);
      expect(isActiveConstructorBlock(key)).toBe(false);
    }
    expect(isActiveConstructorBlock("totally_unknown_block")).toBe(false);
    expect(isActiveConstructorBlock("restaurantName")).toBe(true);
    expect(isActiveConstructorBlock("total")).toBe(true);
  });

  it("marks split-bill and printer-connection as separate domains, not template gaps", () => {
    const byKey = Object.fromEntries(PENDING_BLOCKS.map((entry) => [entry.key, entry]));
    expect(byKey.splitBill.domain).toBe("pos");
    expect(byKey.printerConnection.domain).toBe("printer");
  });
});
