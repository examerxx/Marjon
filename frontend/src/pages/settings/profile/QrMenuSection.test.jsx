import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QrMenuSection from "./QrMenuSection";

const fetchQrTables = vi.fn();
vi.mock("../../../api/qrMenu", () => ({ fetchQrTables: (...args) => fetchQrTables(...args) }));
const updateMock = vi.fn();
const reloadMock = vi.fn();
const uploadLogo = vi.fn();
let orgMock = { name: "Marjon Cafe", logo: null };
vi.mock("../../../context/OrgContext", () => ({ useOrg: () => ({ org: orgMock, update: (...a) => updateMock(...a), reload: (...a) => reloadMock(...a) }) }));
vi.mock("../../../api/settings", () => ({ settingsService: { uploadCompanyLogo: (...a) => uploadLogo(...a) } }));
vi.mock("qrcode", async (importOriginal) => {
  const actual = await importOriginal();
  return { default: { ...actual.default, toDataURL: vi.fn(async (text) => `data:image/png;base64,${btoa(text).slice(0, 8)}`) } };
});

const payload = {
  slug: "marjon",
  company_name: "Marjon Cafe",
  tables: [
    { table_id: "t1", number: 1, hall: "Двор", branch: "Основной", token: "a".repeat(52) },
    { table_id: "t2", number: 2, hall: "Двор", branch: "Основной", token: "b".repeat(52) },
  ],
};

describe("QrMenuSection", () => {
  beforeEach(() => {
    fetchQrTables.mockReset();
    localStorage.clear();
    orgMock = { name: "Marjon Cafe", logo: null };
    updateMock.mockReset().mockResolvedValue({});
    reloadMock.mockReset().mockResolvedValue({});
    uploadLogo.mockReset().mockResolvedValue({ data: {} });
  });

  it("показывает общий QR заведения и QR на каждый стол", async () => {
    fetchQrTables.mockResolvedValue(payload);
    render(<QrMenuSection />);
    expect(await screen.findByText("Меню заведения")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marjon Cafe" })).toBeInTheDocument();
    expect(screen.getByText("Стол 1")).toBeInTheDocument();
    expect(screen.getByText("Стол 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Печать всех \(2\)/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("img").length).toBe(3));
  });

  it("ссылка на стол содержит токен, а общая — только заведение", async () => {
    fetchQrTables.mockResolvedValue(payload);
    render(<QrMenuSection />);
    await screen.findByText("Стол 1");
    const hrefs = screen.getAllByRole("link", { name: "Открыть" }).map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toBe(`${window.location.origin}/m/marjon`);
    expect(hrefs[1]).toBe(`${window.location.origin}/m/marjon/${"a".repeat(52)}`);
    expect(hrefs[2]).toBe(`${window.location.origin}/m/marjon/${"b".repeat(52)}`);
  });

  it("без столов подсказывает добавить их", async () => {
    fetchQrTables.mockResolvedValue({ ...payload, tables: [] });
    render(<QrMenuSection />);
    expect(await screen.findByText(/Столов пока нет/)).toBeInTheDocument();
  });

  it("при ошибке загрузки показывает сообщение", async () => {
    fetchQrTables.mockRejectedValue(new Error("boom"));
    render(<QrMenuSection />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить столы");
  });

  it("карточка заведения: фото и название, без поля и строки про адрес сайта", async () => {
    orgMock = { name: "Сардор", logo: "https://cdn.example/logo.png" };
    fetchQrTables.mockResolvedValue(payload);
    const { container } = render(<QrMenuSection />);
    expect(await screen.findByRole("heading", { name: "Сардор" })).toBeInTheDocument();
    expect(container.querySelector(".qr-brand__logo").getAttribute("src")).toBe("https://cdn.example/logo.png");
    expect(screen.queryByLabelText(/Адрес сайта в QR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/QR открывают меню на/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Изменить адрес/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Столов с QR: 2/)).toBeInTheDocument();
  });

  it("без фото показывает букву, а пока профиль не загрузился — название из QR-данных", async () => {
    orgMock = { name: "MARJON", logo: null };
    fetchQrTables.mockResolvedValue(payload);
    const { container } = render(<QrMenuSection />);
    expect(await screen.findByRole("heading", { name: "Marjon Cafe" })).toBeInTheDocument();
    expect(container.querySelector(".qr-brand__logo--letter").textContent).toBe("M");
  });

  it("название можно изменить прямо в карточке", async () => {
    fetchQrTables.mockResolvedValue(payload);
    render(<QrMenuSection />);
    await screen.findByRole("heading", { name: /Marjon Cafe/ });
    fireEvent.click(screen.getByRole("button", { name: "Изменить название заведения" }));
    fireEvent.change(screen.getByLabelText("Название заведения"), { target: { value: "  Новое имя  " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ name: "Новое имя" }));
    await waitFor(() => expect(screen.queryByLabelText("Название заведения")).not.toBeInTheDocument());
  });

  it("пустое название не сохраняется и показывает подсказку", async () => {
    fetchQrTables.mockResolvedValue(payload);
    render(<QrMenuSection />);
    await screen.findByRole("heading", { name: /Marjon Cafe/ });
    fireEvent.click(screen.getByRole("button", { name: "Изменить название заведения" }));
    fireEvent.change(screen.getByLabelText("Название заведения"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("не может быть пустым");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("ошибка сервера при сохранении названия показывается гостю админки", async () => {
    updateMock.mockRejectedValue({ response: { data: { detail: "Нет прав" } } });
    fetchQrTables.mockResolvedValue(payload);
    render(<QrMenuSection />);
    await screen.findByRole("heading", { name: /Marjon Cafe/ });
    fireEvent.click(screen.getByRole("button", { name: "Изменить название заведения" }));
    fireEvent.change(screen.getByLabelText("Название заведения"), { target: { value: "Другое" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет прав");
  });

  it("фото загружается как логотип компании и карточка обновляется", async () => {
    fetchQrTables.mockResolvedValue(payload);
    const { container } = render(<QrMenuSection />);
    await screen.findByRole("heading", { name: /Marjon Cafe/ });
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(uploadLogo).toHaveBeenCalledWith(file));
    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });

  it("неподходящий файл не отправляется на сервер", async () => {
    fetchQrTables.mockResolvedValue(payload);
    const { container } = render(<QrMenuSection />);
    await screen.findByRole("heading", { name: /Marjon Cafe/ });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["x"], "doc.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("JPG, PNG или WebP");
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("QR на карточках — современные векторные, с логотипом Marjon в центре", async () => {
    fetchQrTables.mockResolvedValue(payload);
    const { container } = render(<QrMenuSection />);
    await screen.findByText("Меню заведения");
    const images = [...container.querySelectorAll(".qr-card__img img")];
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.getAttribute("src").startsWith("data:image/svg+xml")).toBe(true);
      const svg = decodeURIComponent(image.getAttribute("src").split(",")[1]);
      expect(svg).toContain("#092747"); // MARJON Signature
      expect(svg).toContain("data:image/webp;base64,"); // логотип Marjon
    }
    expect(screen.queryByRole("complementary", { name: "Дизайн QR-карточки" })).not.toBeInTheDocument();
  });

  it("печать открывает лист с современными QR и сама вызывает печать; закрытое окно даёт подсказку", async () => {
    fetchQrTables.mockResolvedValue(payload);
    const write = vi.fn();
    const fakeWindow = { document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(fakeWindow);
    render(<QrMenuSection />);
    await screen.findByText("Меню заведения");
    fireEvent.click(screen.getByRole("button", { name: /Печать всех/ }));
    expect(open).toHaveBeenCalled();
    const html = write.mock.calls[0][0];
    expect((html.match(/<section class="card">/g) || []).length).toBe(2);
    expect((html.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Стол 1");
    await waitFor(() => expect(fakeWindow.print).toHaveBeenCalled());
    open.mockReturnValue(null);
    fireEvent.click(screen.getAllByRole("button", { name: /Печать$/ })[0]);
    expect(await screen.findByText(/заблокировал окно печати/)).toBeInTheDocument();
    open.mockRestore();
  });
});
