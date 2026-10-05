import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import CategoriesPage from "./CategoriesPage";
import { getCategories } from "../api/categories";
import { catalogService } from "../api/catalog";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));
vi.mock("../api/catalog", () => ({
  catalogService: { createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn() },
}));

// V2 — Dish Categories follow-up: Dishes-like panel, turquoise add button,
// centered Add modal (photo/name/status/service/show-in-menu/add), service as
// a status-like pill, taller rows, no hash secondary text. Real category
// business content only — no fake Place tables/percent/pricing.
describe("Dish Categories V2 follow-up", () => {
  it("renders Place-family rows with service pill, no hash text, and opens the centered Add modal", async () => {
    vi.mocked(getCategories).mockResolvedValue({
      data: [
        { id: "c1", name: "Супы", slug: "supy", is_active: true, calculate_service: true, show_in_menu: true },
        { id: "c2", name: "Архивная", slug: "arh", is_active: false, calculate_service: false, show_in_menu: false },
      ],
    });
    render(<CategoriesPage type="dishes" />);

    expect(screen.getByRole("heading", { name: "Категория блюд" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить категорию" })).toBeInTheDocument();

    expect(await screen.findByText("Супы")).toBeInTheDocument();
    expect(screen.getByText("Архивная")).toBeInTheDocument();
    // V2: hash secondary text removed — no slug line in dish rows.
    expect(screen.queryByText("#supy")).toBeNull();
    expect(screen.queryByText("#arh")).toBeNull();
    expect(screen.queryByText(/#\S/)).toBeNull();
    // V3: both rows share the identical structure/layout (same classes).
    const rows = document.querySelectorAll(".dishcat-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toBe(rows[1].className);
    expect(rows[0].tagName).toBe(rows[1].tagName);
    // V5: photo block lives on the RIGHT, immediately before service
    // (NAME < PHOTO < SERVICE < ACTIVE < EDIT < DELETE), never by the name.
    const photos = document.querySelectorAll(".dishcat-photo-sm");
    expect(photos).toHaveLength(2);
    rows.forEach((row) => {
      const html = row.innerHTML;
      const infoPos = html.indexOf("dishcat-info");
      const photoPos = html.indexOf("dishcat-photo-sm");
      const svcPos = html.indexOf("dishcat-service-badge");
      const statusPos = html.indexOf("settings-status-badge");
      expect(infoPos).toBeGreaterThan(-1);
      expect(photoPos).toBeGreaterThan(infoPos);
      expect(svcPos).toBeGreaterThan(photoPos);
      expect(statusPos).toBeGreaterThan(svcPos);
    });
    // V6: service badge renders real backend state (is-on green / is-off red).
    const badges = document.querySelectorAll(".dishcat-service-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0].classList.contains("is-off")).toBe(true);
    expect(badges[1].classList.contains("is-on")).toBe(true);
    // V2: service is a status-like pill, not an action button.
    expect(screen.getAllByText("Рассчитать обслугу")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Рассчитать обслугу" })).toBeNull();
    // Place-family status language preserved.
    expect(screen.getByText("Активен")).toBeInTheDocument();
    expect(screen.getByText("Неактивен")).toBeInTheDocument();
    // Place-family actions.
    expect(screen.getAllByRole("button", { name: "Редактировать" })).toHaveLength(2);
    expect(screen.getAllByLabelText("Удалить")).toHaveLength(2);

    // No fake Place business data.
    expect(screen.queryByText(/стол/)).toBeNull();
    expect(screen.queryByText(/UZS/)).toBeNull();
    // Old image placeholder block stays removed.
    expect(screen.queryByLabelText("Изображение категории")).toBeNull();

    // V4: Edit opens its own centered modal, prefilled with the clicked
    // category's real values. Rows sort by name, so the first row is the
    // inactive "Архивная" — prefill must reflect THAT row (name + Неактивен).
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const editDialog = await screen.findByRole("dialog", { name: "Редактировать категорию" });
    expect(editDialog).toBeInTheDocument();
    expect(editDialog.querySelector('input[placeholder="Название категории"]').value).toBe("Архивная");
    expect(editDialog).toHaveTextContent("Статус");
    expect(editDialog).toHaveTextContent("Рассчитать обслугу");
    expect(editDialog).toHaveTextContent("Показать в меню");
    expect(editDialog.querySelector('button[type="submit"]').textContent).toBe("Сохранить");
    // Prefilled status reflects the clicked row (Архивная is inactive).
    expect(editDialog).toHaveTextContent("Неактивен");
    fireEvent.click(editDialog.querySelector(".settings-form__footer button[type='button']"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Редактировать категорию" })).toBeNull());

    // V2: Add opens a centered OWNER modal with the required fields.
    fireEvent.click(screen.getByRole("button", { name: "Добавить категорию" }));
    const dialog = await screen.findByRole("dialog", { name: "Добавить категорию" });
    expect(dialog).toBeInTheDocument();
    // Add modal is blank (not leaking the edit prefill).
    expect(dialog.querySelector('input[placeholder="Название категории"]').value).toBe("");
    expect(dialog).toHaveTextContent("Фото");
    expect(dialog).toHaveTextContent("Название");
    expect(dialog).toHaveTextContent("Статус");
    expect(dialog).toHaveTextContent("Рассчитать обслугу");
    expect(dialog).toHaveTextContent("Показать в меню");
    expect(dialog.querySelector('input[aria-label="Загрузить фото категории"]')).not.toBeNull();
    expect(dialog.querySelector('input[placeholder="Название категории"]')).not.toBeNull();
    const addButton = dialog.querySelector('button[type="submit"]');
    expect(addButton?.textContent).toBe("Добавить");
    const footerButtons = Array.from(dialog.querySelectorAll(".settings-form__footer button"));
    expect(footerButtons.map((b) => b.textContent)).toEqual(["Отмена", "Добавить"]);

    // Modal closes cleanly without creating anything.
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await waitFor(() => expect(getCategories).toHaveBeenCalled());
  });

  it("saves edits through the real update API and refetches, without faking success", async () => {
    const rows = [
      { id: "c1", name: "Супы", slug: "supy", is_active: true, calculate_service: true, show_in_menu: true },
      { id: "c2", name: "Архивная", slug: "arh", is_active: false, calculate_service: false, show_in_menu: false },
    ];
    vi.mocked(getCategories).mockResolvedValue({ data: rows });
    vi.mocked(catalogService.updateCategory).mockResolvedValue({ data: { id: "c1" } });
    render(<CategoriesPage type="dishes" />);
    await screen.findByText("Супы");

    // V6: flag switches are real and enabled in Edit, prefilled from backend.
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "Редактировать категорию" });
    const serviceToggle = within(dialog).getByText("Рассчитать обслугу").closest("div").querySelector("input");
    const showToggle = within(dialog).getByText("Показать в меню").closest("div").querySelector("input");
    expect(serviceToggle.disabled).toBe(false);
    expect(showToggle.disabled).toBe(false);
    expect(serviceToggle.checked).toBe(true);
    expect(showToggle.checked).toBe(true);

    fireEvent.change(dialog.querySelector('input[placeholder="Название категории"]'), {
      target: { value: "Супы новые" },
    });
    fireEvent.click(serviceToggle); // true -> false
    vi.mocked(getCategories).mockResolvedValue({
      data: [
        { id: "c1", name: "Супы новые", slug: "supy", is_active: true, calculate_service: false, show_in_menu: true },
        rows[1],
      ],
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(catalogService.updateCategory).toHaveBeenCalledWith("c1", {
        name: "Супы новые",
        is_active: true,
        calculate_service: false,
        show_in_menu: true,
      }),
    );
    // Photo (no backend contract) never enters the payload.
    const sent = vi.mocked(catalogService.updateCategory).mock.calls[0][1];
    expect(sent).not.toHaveProperty("photo");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Супы новые")).toBeInTheDocument();
    // Row reflects the persisted OFF state (red family class).
    const updated = document.querySelectorAll(".dishcat-service-badge");
    expect(updated[1].classList.contains("is-off")).toBe(true);
  });

  it("keeps the edit modal open with the real backend error on save failure", async () => {
    vi.mocked(getCategories).mockResolvedValue({
      data: [{ id: "c1", name: "Супы", slug: "supy", is_active: true }],
    });
    vi.mocked(catalogService.updateCategory).mockRejectedValue({
      response: { data: { detail: "Имя уже занято" } },
    });
    render(<CategoriesPage type="dishes" />);
    await screen.findByText("Супы");

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = await screen.findByRole("dialog", { name: "Редактировать категорию" });
    fireEvent.change(dialog.querySelector('input[placeholder="Название категории"]'), {
      target: { value: "Дубликат" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(within(dialog).getByText("Имя уже занято")).toBeInTheDocument(),
    );
    // No fake success: modal stays open, list unchanged.
    expect(screen.getByRole("dialog", { name: "Редактировать категорию" })).toBeInTheDocument();
    expect(screen.getByText("Супы")).toBeInTheDocument();
    expect(screen.queryByText("Дубликат")).toBeNull();
  });

  it("deletes through the real backend confirm flow and refetches", async () => {
    vi.mocked(getCategories).mockResolvedValue({
      data: [{ id: "c1", name: "Супы", slug: "supy", is_active: true, calculate_service: true, show_in_menu: true }],
    });
    vi.mocked(catalogService.deleteCategory).mockResolvedValue({});
    render(<CategoriesPage type="dishes" />);
    await screen.findByText("Супы");

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const confirm = await screen.findByRole("dialog", { name: "Удалить категорию" });
    expect(confirm).toHaveTextContent("Супы");
    vi.mocked(getCategories).mockResolvedValue({ data: [] });
    fireEvent.click(within(confirm).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(catalogService.deleteCategory).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Супы")).toBeNull();
  });

  it("keeps the row and shows the backend error when delete is refused", async () => {
    vi.mocked(getCategories).mockResolvedValue({
      data: [{ id: "c1", name: "Супы", slug: "supy", is_active: true, calculate_service: true, show_in_menu: true }],
    });
    vi.mocked(catalogService.deleteCategory).mockRejectedValue({
      response: { data: { detail: "Category is in use by dishes and cannot be deleted" } },
    });
    render(<CategoriesPage type="dishes" />);
    await screen.findByText("Супы");

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const confirm = await screen.findByRole("dialog", { name: "Удалить категорию" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Удалить" }));

    await waitFor(() =>
      expect(
        within(confirm).getByText("Category is in use by dishes and cannot be deleted"),
      ).toBeInTheDocument(),
    );
    // No fake removal: confirm stays open, row stays.
    expect(screen.getByRole("dialog", { name: "Удалить категорию" })).toBeInTheDocument();
    expect(screen.getByText("Супы")).toBeInTheDocument();
  });

  it("never shows the legacy not-connected delete message", async () => {
    vi.mocked(getCategories).mockResolvedValue({
      data: [{ id: "c1", name: "Супы", slug: "supy", is_active: true, calculate_service: true, show_in_menu: true }],
    });
    render(<CategoriesPage type="dishes" />);
    await screen.findByText("Супы");
    expect(screen.queryByText(/пока не подключено к backend/)).toBeNull();
    // Dish flow no longer references the legacy stub (a non-dish fallback
    // message for other category types is out of scope and stays honest).
    const src = readFileSync(`${process.cwd()}/src/pages/CategoriesPage.jsx`, "utf8");
    expect(src).not.toMatch(/function handleDelete/);
    expect(src).toMatch(/onClick=\{\(\) => openDeleteConfirm\(row\)\}/);
  });

  it("offsets only the МЕНЮ eyebrow by 8px via a category-scoped rule", () => {
    const css = readFileSync(`${process.cwd()}/src/styles/owner/nomenclature.css`, "utf8");
    const eyebrow = css.match(
      /\.menu-categories-page\.is-dish-categories \.dishcat-header \.settings-title-group p\s*\{[^}]*\}/,
    )?.[0] || "";
    expect(eyebrow).toMatch(/top:\s*8px/);
    // No whole-header shift: header keeps its grid/margin template.
    expect(css).not.toMatch(/\.dishcat-header\s*\{[^}]*margin-bottom:\s*20px/);
  });
});
