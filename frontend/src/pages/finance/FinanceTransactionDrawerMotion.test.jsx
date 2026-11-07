import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FinanceTransactionDrawer from "./FinanceTransactionDrawer";

function DrawerHarness({ onClose, onSave = async () => undefined, saving = false }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "income",
    amount: "100",
    paymentTypeId: "",
    counterpartyId: "",
    categoryId: "",
    comment: "",
  });
  return <>
    <button onClick={() => setOpen(true)}>Открыть операцию</button>
    {open && <FinanceTransactionDrawer
      form={form}
      setForm={setForm}
      onClose={() => { onClose(); setOpen(false); }}
      onSave={onSave}
      saving={saving}
      paymentTypes={[{ id: "cash", name: "Наличными" }]}
    />}
  </>;
}

function openDrawer(props = {}) {
  const onClose = props.onClose || vi.fn();
  render(<DrawerHarness {...props} onClose={onClose} />);
  const trigger = screen.getByRole("button", { name: "Открыть операцию" });
  trigger.focus();
  fireEvent.click(trigger);
  return { onClose, trigger, dialog: screen.getByRole("dialog") };
}

function advance(ms) {
  act(() => vi.advanceTimersByTime(ms));
}

function animationEnd(element, name) {
  for (const eventName of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(eventName, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: name });
    fireEvent(element, event);
  }
}

describe("finance transaction modal lifecycle", () => {
  let previousOverflow;

  beforeEach(() => {
    previousOverflow = document.body.style.overflow;
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = previousOverflow;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["cancel", "cross", "escape", "backdrop"])(
    "retains the form through its exit when dismissed with %s",
    (method) => {
      const { onClose, dialog } = openDrawer();
      if (method === "cancel") fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
      if (method === "cross") fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
      if (method === "escape") fireEvent.keyDown(document, { key: "Escape" });
      if (method === "backdrop") fireEvent.click(document.querySelector(".finance-drawer__backdrop"));

      expect(dialog.closest(".finance-operation-modal")).toHaveClass("is-motion-closing");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Добавить приход" })).toBeDisabled();
      advance(259);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      advance(1);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores entrance completion and finishes once on exit completion", () => {
    const { onClose, dialog } = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    animationEnd(dialog, "finance-operation-enter");
    expect(onClose).not.toHaveBeenCalled();
    animationEnd(dialog, "finance-operation-leave");
    expect(screen.queryByRole("dialog")).toBeNull();
    advance(300);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts the retained exit after a successful save", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { onClose, dialog } = openDrawer({ onSave });
    await act(async () => { fireEvent.submit(dialog); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(dialog.closest(".finance-operation-modal")).toHaveClass("is-motion-closing");
    expect(onClose).not.toHaveBeenCalled();
    advance(260);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the form open after validation or a failed save returns no success", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { onClose, dialog } = openDrawer({ onSave });
    await act(async () => { fireEvent.submit(dialog); });
    advance(300);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(dialog.closest(".finance-operation-modal")).not.toHaveClass("is-motion-closing");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("prevents dismissal and duplicate save while saving", async () => {
    const onSave = vi.fn();
    const { onClose, dialog } = openDrawer({ onSave, saving: true });
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector(".finance-drawer__backdrop"));
    await act(async () => { fireEvent.submit(dialog); });
    advance(300);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lets an open select consume Escape before the dialog closes", () => {
    const { onClose } = openDrawer();
    const payment = screen.getByRole("combobox", { name: /Тип оплаты/ });
    fireEvent.click(payment);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(payment, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    advance(300);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("restores focus and the previous scroll state only after exit", () => {
    document.body.style.overflow = "auto";
    const { trigger } = openDrawer();
    expect(screen.getByPlaceholderText("Введите сумму")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(document.body.style.overflow).toBe("hidden");
    advance(260);
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("uses the short reduced-motion fallback", () => {
    window.matchMedia.mockReturnValue({ matches: true });
    const { onClose } = openDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    advance(119);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});