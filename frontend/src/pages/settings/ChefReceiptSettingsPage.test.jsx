import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildKitchenTemplate,
  getKitchenTemplate,
  saveKitchenTemplate,
  testPrintKitchen,
} from "../../api/receipt";
import ChefReceiptSettingsPage from "./ChefReceiptSettingsPage";

vi.mock("../../api/receipt", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getKitchenTemplate: vi.fn(),
    saveKitchenTemplate: vi.fn(() => Promise.resolve({ template: {}, source: "api" })),
    testPrintKitchen: vi.fn(() => Promise.resolve({ ok: true, source: "local" })),
  };
});

beforeEach(() => {
  getKitchenTemplate.mockImplementation(() =>
    Promise.resolve({ template: buildKitchenTemplate(), source: "api" }),
  );
  saveKitchenTemplate.mockImplementation(() => Promise.resolve({ template: {}, source: "api" }));
});

describe("ChefReceiptSettingsPage (kitchen)", () => {
  it("loads the kitchen template with the OWNER header + autoPrint control", async () => {
    render(<ChefReceiptSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Настройка чека повара" })).toBeInTheDocument();
    expect(screen.getByText("Параметры кухни")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Автопечать нового заказа/ })).toBeInTheDocument();
    await waitFor(() => expect(getKitchenTemplate).toHaveBeenCalled());
  });

  it("renders the kitchen preview (no customer pricing) and blocks", async () => {
    const { container } = render(<ChefReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека повара" });
    expect(container.querySelector("[data-receipt-type='kitchen']")).not.toBeNull();
    // Kitchen omits customer money blocks.
    expect(screen.queryByText("ИТОГО:")).toBeNull();
  });

  it("toggles autoPrint as a local draft (no instant PATCH)", async () => {
    render(<ChefReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека повара" });
    const auto = screen.getByRole("checkbox", { name: /Автопечать нового заказа/ });
    fireEvent.click(auto);
    expect(saveKitchenTemplate).not.toHaveBeenCalled();
  });

  it("saves via one PATCH and shows a saved banner", async () => {
    render(<ChefReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека повара" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveKitchenTemplate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Шаблон кухонного чека сохранён на сервере/)).toBeInTheDocument();
  });

  it("shows a save error without faking success", async () => {
    saveKitchenTemplate.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { data: { detail: "Сервис недоступен" } } }),
    );
    render(<ChefReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека повара" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(screen.queryByText(/сохранён на сервере/)).toBeNull();
  });
});
