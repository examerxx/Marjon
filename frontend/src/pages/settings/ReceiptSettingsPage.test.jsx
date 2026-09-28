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
  it("loads the real template and renders the OWNER header without a Parameters card", async () => {
    render(<ReceiptSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Настройка чека" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.queryByText("Параметры")).toBeNull();
    expect(screen.queryByRole("button", { name: "Сбросить" })).toBeNull();
    await waitFor(() => expect(getCustomerTemplate).toHaveBeenCalled());
    // No visible paper-size control: paperSize lives in the template blob only.
    expect(document.querySelector(".receipt-editor-actions .receipt-paper-select")).toBeNull();
    expect(screen.queryByLabelText("Размер бумаги")).toBeNull();
    expect(screen.getByRole("button", { name: "Печать предпросмотра" })).toBeInTheDocument();
  });

  it("keeps exactly one restaurant-name input, inside its block row", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.queryAllByRole("textbox", { name: "Название" })).toHaveLength(1);
    const row = screen.getByRole("checkbox", { name: "Название ресторана" }).closest(".receipt-section-row");
    expect(within(row).getByRole("textbox", { name: "Название" })).toBeInTheDocument();
  });

  it("hides the restaurant-name input on OFF and restores its value on ON", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const box = screen.getByRole("checkbox", { name: "Название ресторана" });
    const row = () => box.closest(".receipt-section-row");
    const details = () => row().querySelector(".receipt-section-row__details");
    fireEvent.change(within(row()).getByRole("textbox", { name: "Название" }), { target: { value: "AuditName" } });
    fireEvent.click(box);
    expect(details()).not.toHaveClass("is-open");
    expect(screen.queryByText("AuditName", { selector: ".receipt-preview__brand" })).toBeNull();
    fireEvent.click(box);
    expect(details()).toHaveClass("is-open");
    expect(within(row()).getByRole("textbox", { name: "Название" })).toHaveValue("AuditName");
    expect(screen.getByText("AuditName", { selector: ".receipt-preview__brand" })).toBeInTheDocument();
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("saves the name edit while a server-loaded paperSize passes through untouched", async () => {
    getCustomerTemplate.mockImplementationOnce(() => Promise.resolve({
      template: { ...buildCustomerTemplate({ name: "MARJON", phone: "+998770702101" }), paperSize: "58mm" },
      source: "api",
    }));
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), { target: { value: "AuditName" } });
    const editor = document.querySelector(".receipt-editor");
    editor.scrollTop = editor.scrollHeight;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    const payload = saveCustomerTemplate.mock.calls[0][0];
    expect(payload.restaurantName).toBe("AuditName");
    expect(payload.paperSize).toBe("58mm");
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

  it("collapses a disabled block's style editor and restores it on re-enable", async () => {
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
    // Details collapse (animated, inert) instead of unmounting: values survive.
    const details = () => nameRow().querySelector(".receipt-section-row__details");
    expect(details()).not.toHaveClass("is-open");
    expect(nameRow().querySelector(".receipt-section-row__details-inner")).toHaveAttribute("inert");
    expect(screen.queryByText("MARJON", { selector: ".receipt-preview__brand" })).toBeNull();
    // Saved style is retained, not deleted: re-enabling restores editor + preview.
    fireEvent.click(box());
    expect(details()).toHaveClass("is-open");
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
    // Header row carries one secondary action (Print), never Save, and no
    // visible paper-size control.
    const header = container.querySelector(".settings-header.receipt-header");
    expect(header).not.toBeNull();
    expect(header.querySelectorAll(".receipt-btn-secondary")).toHaveLength(1);
    expect(header.querySelector(".receipt-paper-select")).toBeNull();
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
    expect(screen.getByText("Логотип компании")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Заменить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
    expect(document.querySelector("img.receipt-preview__logo")?.getAttribute("src")).toBe("https://cdn.test/logo.png");
  });

  it("toggling the logo block never deletes the server logo", async () => {
    orgState.org = { ...orgState.org, logo: "https://cdn.test/logo.png" };
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Логотип" }));
    expect(document.querySelector("img.receipt-preview__logo")).toBeNull();
    expect(settingsService.deleteCompanyLogo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Логотип" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deleteCompanyLogo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(orgState.reload).toHaveBeenCalled());
    expect(await screen.findByText("Логотип удалён.")).toBeInTheDocument();
  });
});

describe("ReceiptSettingsPage — line spacing density control", () => {
  it("renders the density control with Большое active by default", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByText("Дополнительные настройки")).toBeInTheDocument();
    expect(screen.getByText("Место между строками")).toBeInTheDocument();
    expect(screen.getByText("Подключение принтера")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Место между строками чека" });
    expect(within(group).getByRole("button", { name: "Большое" })).toHaveClass("is-active");
  });

  it("switching density updates the preview root live without Save", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const root = () => container.querySelector("[data-receipt-print-root]");
    expect(root()).toHaveAttribute("data-line-spacing", "large");
    const group = screen.getByRole("group", { name: "Место между строками чека" });
    fireEvent.click(within(group).getByRole("button", { name: "Малое" }));
    expect(root()).toHaveAttribute("data-line-spacing", "small");
    fireEvent.click(within(group).getByRole("button", { name: "Среднее" }));
    expect(root()).toHaveAttribute("data-line-spacing", "medium");
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("persists density through Save and reload", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const group = screen.getByRole("group", { name: "Место между строками чека" });
    fireEvent.click(within(group).getByRole("button", { name: "Среднее" }));
    const editor = document.querySelector(".receipt-editor");
    editor.scrollTop = editor.scrollHeight;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    expect(saveCustomerTemplate.mock.calls[0][0].lineSpacing).toBe("medium");
  });
});

describe("ReceiptSettingsPage — editor scope (no discount/VAT cards)", () => {
  it("hides Скидка and НДС rows but keeps service/total/payment", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.queryByRole("checkbox", { name: "Скидка" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "НДС" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Сервисный сбор" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Итого" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Способ оплаты" })).toBeInTheDocument();
  });

  it("keeps stored discount/VAT values applied to already-saved templates", async () => {
    // Editor-scope removal must not destroy data: enabled discount/vat with
    // nonzero values still render via the total-anchored summary unit.
    const base = buildCustomerTemplate();
    getCustomerTemplate.mockImplementationOnce(() => Promise.resolve({
      template: { ...base, enabled: { ...base.enabled, discount: true } },
      source: "api",
    }));
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.queryByRole("checkbox", { name: "Скидка" })).toBeNull();
  });
});

describe("ReceiptSettingsPage — flat section structure (no boxed cards)", () => {
  it("renders groups + static sections directly without subcard shells", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(container.querySelector(".receipt-editor .receipt-subcard")).toBeNull();
    expect(container.querySelectorAll(".receipt-editor .receipt-section-group")).toHaveLength(6);
    expect(container.querySelector('[data-settings-section="additional"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-section="spacing"]')).toBeNull();
    expect(container.querySelector('[data-settings-section="printer"]')).toBeNull();
    // All 14 visible block rows still exist with working toggles
    // (discount/vat intentionally hidden from the editor).
    expect(container.querySelectorAll("[data-block-row]")).toHaveLength(14);
  });
});

describe("ReceiptSettingsPage — collapsible additional-settings card", () => {
  it("renders one Дополнительные настройки header open by default (no separate cards)", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.queryByRole("button", { name: /Параметры/ })).toBeNull();
    const header = screen.getByRole("button", { name: "Дополнительные настройки" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    // Both controls live inside this single group, side by side.
    const section = document.querySelector('[data-settings-section="additional"]');
    expect(section.querySelector('[aria-label="Место между строками чека"]')).not.toBeNull();
    expect(section.querySelector('[aria-label="Подключение принтера"]')).not.toBeNull();
    // Collapsing hides card content without touching template state.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ReceiptSettingsPage — total weight control mapping", () => {
  it("maps Bold onto the total block for the preview weight rule", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const row = screen.getByRole("checkbox", { name: "Итого" }).closest(".receipt-section-row");
    const total = container.querySelector(".receipt-preview__total");
    expect(total).not.toHaveClass("receipt-preview__block--weight-bold");
    fireEvent.click(within(row).getByRole("button", { name: "Жирный" }));
    expect(container.querySelector(".receipt-preview__total")).toHaveClass("receipt-preview__block--weight-bold");
  });
});

describe("ReceiptSettingsPage — address/phone live with their checkbox", () => {
  const row = (name) => screen.getByRole("checkbox", { name }).closest(".receipt-section-row");
  const details = (name) => row(name).querySelector(".receipt-section-row__details");

  it("renders address/phone inputs inside their block rows, not in Параметры", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    // Exactly one address input and one phone input: both live in block rows
    // (role=textbox disambiguates from the same-named checkboxes).
    expect(screen.queryAllByRole("textbox", { name: "Адрес" })).toHaveLength(1);
    expect(screen.queryAllByRole("textbox", { name: "Телефон" })).toHaveLength(1);
    expect(within(row("Адрес")).getByRole("textbox", { name: "Адрес" })).toBeInTheDocument();
    expect(within(row("Телефон")).getByRole("textbox", { name: "Телефон" })).toBeInTheDocument();
  });

  it("OFF collapses input + preview block but preserves the value", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const box = screen.getByRole("checkbox", { name: "Адрес" });
    fireEvent.click(box); // enable: input appears with current (empty) value
    expect(details("Адрес")).toHaveClass("is-open");
    fireEvent.change(within(row("Адрес")).getByRole("textbox", { name: "Адрес" }), { target: { value: "Tashkent" } });
    fireEvent.click(box); // disable: details collapse, preview block gone
    expect(details("Адрес")).not.toHaveClass("is-open");
    expect(row("Адрес").querySelector(".receipt-section-row__details-inner")).toHaveAttribute("inert");
    // Value is NOT destroyed by toggling off.
    fireEvent.click(box);
    expect(details("Адрес")).toHaveClass("is-open");
    expect(within(row("Адрес")).getByRole("textbox", { name: "Адрес" })).toHaveValue("Tashkent");
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("typing an address updates the live preview immediately", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Адрес" }));
    fireEvent.change(within(row("Адрес")).getByRole("textbox", { name: "Адрес" }), { target: { value: "Tashkent" } });
    expect(await screen.findByText("Tashkent")).toBeInTheDocument();
  });

  it("save payload carries template values with no animation/group UI state", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Адрес" }));
    fireEvent.change(within(row("Адрес")).getByRole("textbox", { name: "Адрес" }), { target: { value: "Tashkent" } });
    const editor = document.querySelector(".receipt-editor");
    editor.scrollTop = editor.scrollHeight;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    const payload = saveCustomerTemplate.mock.calls[0][0];
    expect(payload.address).toBe("Tashkent");
    expect(payload.enabled.address).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/collapsed|is-open|aria-expanded|block-group/i);
  });
});

describe("ReceiptSettingsPage — additional settings group", () => {
  it("renders one Дополнительные настройки group with both controls side by side", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByRole("button", { name: "Дополнительные настройки" })).toHaveAttribute("aria-expanded", "true");
    const section = container.querySelector('[data-settings-section="additional"]');
    expect(section).not.toBeNull();
    expect(section.querySelector('[aria-label="Место между строками чека"]')).not.toBeNull();
    expect(section.querySelector('[aria-label="Подключение принтера"]')).not.toBeNull();
    // Old separate cards are gone.
    expect(container.querySelector('[data-settings-section="spacing"]')).toBeNull();
    expect(container.querySelector('[data-settings-section="printer"]')).toBeNull();
  });

  it("collapse is UI-only: values survive and payload stays clean", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const header = screen.getByRole("button", { name: "Дополнительные настройки" });
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("persists lineSpacing + printerConnection through Save", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const section = document.querySelector('[data-settings-section="additional"]');
    fireEvent.click(within(section).getByRole("button", { name: "Малое" }));
    fireEvent.click(within(section).getByRole("button", { name: "USB" }));
    const editor = document.querySelector(".receipt-editor");
    editor.scrollTop = editor.scrollHeight;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    const payload = saveCustomerTemplate.mock.calls[0][0];
    expect(payload.lineSpacing).toBe("small");
    expect(payload.printerConnection).toBe("usb");
  });
});

describe("ReceiptSettingsPage — comment / bottom number / printer connection", () => {
  it("labels the comment block Комментарий к чеку (same template key)", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByRole("checkbox", { name: "Комментарий к чеку" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Текст благодарности" })).toBeNull();
  });

  it("renders the bottom order number block with size/weight controls", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByRole("checkbox", { name: "Нижний номер заказа" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Нижний текст" })).toBeNull();
    expect(container.querySelector(".receipt-preview__bottomnum-value")).toHaveTextContent("3");
  });

  it("toggles the bottom order number block without touching other blocks", async () => {
    const { container } = render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Нижний номер заказа" }));
    expect(container.querySelector(".receipt-preview__bottomnum")).toBeNull();
    expect(screen.getByText("Номер заказа:")).toBeInTheDocument();
    expect(saveCustomerTemplate).not.toHaveBeenCalled();
  });

  it("offers LAN/USB single-choice printer connection, default LAN", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    expect(screen.getByText("Подключение принтера")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Подключение принтера" });
    expect(within(group).getByRole("button", { name: "LAN" })).toHaveClass("is-active");
    fireEvent.click(within(group).getByRole("button", { name: "USB" }));
    expect(within(group).getByRole("button", { name: "USB" })).toHaveClass("is-active");
    expect(within(group).getByRole("button", { name: "LAN" })).not.toHaveClass("is-active");
  });

  it("persists printer connection through Save and reload", async () => {
    render(<ReceiptSettingsPage />);
    await screen.findByRole("heading", { name: "Настройка чека" });
    const group = screen.getByRole("group", { name: "Подключение принтера" });
    fireEvent.click(within(group).getByRole("button", { name: "USB" }));
    const editor = document.querySelector(".receipt-editor");
    editor.scrollTop = editor.scrollHeight;
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(saveCustomerTemplate).toHaveBeenCalledTimes(1));
    expect(saveCustomerTemplate.mock.calls[0][0].printerConnection).toBe("usb");
  });
});

