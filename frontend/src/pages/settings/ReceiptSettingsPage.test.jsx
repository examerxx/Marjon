import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomerTemplate,
  getCustomerTemplate,
  saveCustomerTemplate,
  testPrintReceipt,
} from "../../api/receipt";
import { settingsService } from "../../api/settings";
import ReceiptSettingsPage from "./ReceiptSettingsPage";

const orgState = vi.hoisted(() => ({
  org: { name: "MARJON", phone: "+998770702101", address: "" },
  reload: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../context/OrgContext", () => ({
  useOrg: () => orgState,
}));

vi.mock("../../api/settings", () => ({
  settingsService: {
    uploadCompanyLogo: vi.fn(() => Promise.resolve({ data: {} })),
    deleteCompanyLogo: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock("../../api/receipt", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCustomerTemplate: vi.fn(),
    saveCustomerTemplate: vi.fn(() => Promise.resolve({ template: {}, source: "api" })),
    testPrintReceipt: vi.fn(() => Promise.resolve({ ok: true, source: "local" })),
  };
});

function conflict() {
  return Object.assign(new Error("Request failed with status code 409"), {
    name: "AxiosError",
    response: { status: 409, data: {} },
  });
}

beforeEach(() => {
  getCustomerTemplate.mockImplementation(() =>
    Promise.resolve({ template: buildCustomerTemplate({ name: "MARJON", phone: "+998770702101" }), source: "api" }),
  );
  saveCustomerTemplate.mockImplementation(() => Promise.resolve({ template: {}, source: "api" }));
  orgState.org = { name: "MARJON", phone: "+998770702101", address: "" };
  orgState.reload.mockClear();
  settingsService.uploadCompanyLogo.mockClear();
  settingsService.deleteCompanyLogo.mockClear();
});

// PLACEHOLDER_TESTS
describe("ReceiptSettingsPage (customer)", () => {
  it("loads the real template and renders the OWNER header + parameters", async () => {
    render(<ReceiptSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Настройка чека" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Параметры")).toBeInTheDocument();
    await waitFor(() => expect(getCustomerTemplate).toHaveBeenCalled());
    // Paper-width truth hint is present.
    expect(screen.getByText(/Фактическая ширина печати зависит от настройки/)).toBeInTheDocument();
  });

  it("renders a large receipt preview alongside the editor", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(container.querySelector(".receipt-preview-col")).not.toBeNull();
    expect(container.querySelector("[data-receipt-print-root]")).not.toBeNull();
    expect(screen.getByText("Итого к оплате:")).toBeInTheDocument();
  });

  it("reflects a block visibility toggle in the preview immediately (local draft)", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByText("Итого к оплате:")).toBeInTheDocument();
    // "Итого" is the total block label in the editor.
    fireEvent.click(screen.getByRole("checkbox", { name: "Итого" }));
    await waitFor(() => expect(screen.queryByText("Итого к оплате:")).toBeNull());
    // Not persisted — no PATCH fired from a draft toggle.
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("saves the whole template via one PATCH and shows a saved banner", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Шаблон чека сохранён на сервере/)).toBeInTheDocument();
  });

  it("shows a save error without faking success", async () => {
    saveCustomerTemplate.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { data: { detail: "Сервис недоступен" } } }),
    );
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(screen.queryByText(/сохранён на сервере/)).toBeNull();
  });

  it("surfaces a 409 optimistic-concurrency conflict and does not silently overwrite", async () => {
    saveCustomerTemplate.mockRejectedValueOnce(conflict());
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText(/Обновите страницу, чтобы получить актуальную версию/)).toBeInTheDocument();
  });

  it("renders the preview in the SAVED block order after load (parity with the printer source)", async () => {
    const base = buildCustomerTemplate({ name: "MARJON", phone: "+998770702101" });
    const reordered = { ...base, blocks: ["total", "items", ...base.blocks.filter((b) => b !== "total" && b !== "items")] };
    getCustomerTemplate.mockImplementationOnce(() => Promise.resolve({ template: reordered, source: "api" }));
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    await waitFor(() => {
      const text = container.querySelector("[data-receipt-print-root]").textContent;
      expect(text.indexOf("Итого к оплате:")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Итого к оплате:")).toBeLessThan(text.indexOf("Кол-во"));
    });
  });

  it("hides a disabled block's style editor and restores it on re-enable", async () => {
    // Resolve the initial load FIRST so later toggles act on server truth
    // (a toggle fired before load resolves is truthfully superseded by it).
    let resolveLoad;
    getCustomerTemplate.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    resolveLoad({ template: buildCustomerTemplate({ name: "MARJON", phone: "+998770702101" }), source: "api" });
    expect(await screen.findByText("Итого к оплате:")).toBeInTheDocument();
    const box = () => screen.getByRole("checkbox", { name: "Название ресторана" });
    const nameRow = () => box().closest(".receipt-section-row");
    expect(within(nameRow()).getByRole("button", { name: "Очень большой" })).toBeInTheDocument();
    fireEvent.click(box());
    expect(within(nameRow()).queryByRole("button", { name: "Очень большой" })).toBeNull();
    expect(screen.queryByText("MARJON", { selector: ".receipt-preview__brand" })).toBeNull();
    // Saved style is retained, not deleted: re-enabling restores editor + preview.
    fireEvent.click(box());
    expect(await within(nameRow()).findByRole("button", { name: "Очень большой" })).toBeInTheDocument();
    expect(screen.getByText("MARJON", { selector: ".receipt-preview__brand" })).toBeInTheDocument();
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("shows no editor row for retired legacy keys (qr) without crashing", async () => {
    const base = buildCustomerTemplate({ name: "MARJON", phone: "+998770702101" });
    getCustomerTemplate.mockImplementationOnce(() => Promise.resolve({
      template: { ...base, blocks: [...base.blocks, "qr"], enabled: { ...base.enabled, qr: true } },
      source: "api",
    }));
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.queryByRole("checkbox", { name: "QR" })).toBeNull();
    expect(document.querySelector(".receipt-preview__qr-block")).toBeNull();
    expect(screen.getByText("Итого к оплате:")).toBeInTheDocument();
  });

  it("block editor shows visibility (and style) but no reorder controls or «Порядок и видимость» label", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    // The confusing right-side reorder mini-buttons and the label are gone.
    expect(screen.queryByText("Порядок и видимость")).toBeNull();
    expect(screen.queryByRole("button", { name: /выше/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /ниже/ })).toBeNull();
    // Visibility toggles remain (e.g. Логотип).
    expect(screen.getByRole("checkbox", { name: "Логотип" })).toBeInTheDocument();
  });

  it("right-aligns secondary actions and keeps Save at the end of the scrollable editor (never pinned)", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const actions = container.querySelector(".receipt-editor-actions.receipt-editor-actions--end");
    expect(actions).not.toBeNull();
    expect(actions.querySelector(".receipt-btn-secondary")).not.toBeNull();
    // Save lives INSIDE the scrolling editor as its last block — no pinned footer.
    const inContentSave = container.querySelector(".receipt-editor .receipt-editor-save .receipt-save");
    expect(inContentSave).not.toBeNull();
    expect(inContentSave).toHaveTextContent("Сохранить");
    expect(container.querySelector(".receipt-editor-footer")).toBeNull();
    // Header row carries the two secondary actions (title level), never Save.
    const header = container.querySelector(".settings-header.receipt-header");
    expect(header).not.toBeNull();
    expect(header.querySelectorAll(".receipt-btn-secondary")).toHaveLength(2);
    expect(header.querySelector(".receipt-btn-primary")).toBeNull();
    // No preview size label anywhere.
    expect(container.querySelector(".receipt-preview-shell__label")).toBeNull();
  });
});

describe("ReceiptSettingsPage — logo block (real upload, no fake image)", () => {
  function pngFile(name = "logo.png", type = "image/png") {
    return new File(["fake-bytes"], name, { type });
  }

  function logoRow() {
    return screen.getByRole("checkbox", { name: "Логотип" }).closest(".receipt-section-row");
  }

  it("shows a truthful empty state when no company logo exists", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByText("Логотип компании не установлен")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выбрать логотип" })).toBeInTheDocument();
    expect(document.querySelector("img.receipt-preview__logo")).toBeNull();
    expect(document.querySelector("img.receipt-logo-thumb")).toBeNull();
    expect(settingsService.uploadCompanyLogo).not.toHaveBeenCalled();
  });

  it("shows thumbnail + replace/remove when a real logo exists", async () => {
    orgState.org = { ...orgState.org, logo: "https://cdn.test/logo.png" };
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const thumb = document.querySelector("img.receipt-logo-thumb");
    expect(thumb?.getAttribute("src")).toBe("https://cdn.test/logo.png");
    expect(screen.getByRole("button", { name: "Заменить логотип" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Убрать" })).toBeInTheDocument();
    expect(document.querySelector("img.receipt-preview__logo")?.getAttribute("src")).toBe("https://cdn.test/logo.png");
  });

  it("uploads a real file, reloads org, shows no fake preview", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const input = document.querySelector('.receipt-logo-field input[type="file"]');
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() => expect(settingsService.uploadCompanyLogo).toHaveBeenCalledTimes(1));
    // Page → service contract carries the raw File (no base64, no localStorage).
    expect(settingsService.uploadCompanyLogo.mock.calls[0][0]).toBeInstanceOf(File);
    await waitFor(() => expect(orgState.reload).toHaveBeenCalled());
    expect(await screen.findByText("Логотип загружен.")).toBeInTheDocument();
  });

  it("rejects non-image types locally without an API call", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const input = document.querySelector('.receipt-logo-field input[type="file"]');
    fireEvent.change(input, { target: { files: [pngFile("logo.gif", "image/gif")] } });
    expect(await screen.findByText("Поддерживаются только jpg, png, webp.")).toBeInTheDocument();
    expect(settingsService.uploadCompanyLogo).not.toHaveBeenCalled();
    expect(document.querySelector("img.receipt-preview__logo")).toBeNull();
  });

  it("surfaces a failed upload truthfully without faking the logo", async () => {
    settingsService.uploadCompanyLogo.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { status: 403, data: { detail: "Forbidden" } } }),
    );
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const input = document.querySelector('.receipt-logo-field input[type="file"]');
    fireEvent.change(input, { target: { files: [pngFile()] } });
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(orgState.reload).not.toHaveBeenCalled();
    expect(document.querySelector("img.receipt-preview__logo")).toBeNull();
    expect(screen.queryByText("Логотип загружен.")).toBeNull();
  });

  it("deletes the logo through the real API and reloads org", async () => {
    orgState.org = { ...orgState.org, logo: "https://cdn.test/logo.png" };
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));
    await waitFor(() => expect(settingsService.deleteCompanyLogo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(orgState.reload).toHaveBeenCalled());
    expect(await screen.findByText("Логотип удалён.")).toBeInTheDocument();
  });
});

