import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportDateRangePicker from "./ReportDateRangePicker";

describe("ReportDateRangePicker canonical Reports variant", () => {
  it("reuses the approved Z-report interaction and commits only through OK", () => {
    const onChange = vi.fn();
    const initialRange = {
      preset: "",
      start: "01.08.2026",
      end: "25.08.2026",
      startTime: "00:00",
      endTime: "00:00",
    };
    const { container } = render(
      <ReportDateRangePicker
        variant="canonical"
        value={initialRange}
        onChange={onChange}
        buttonAriaLabel="Период тестового отчёта"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Период тестового отчёта" });
    expect(trigger).toHaveTextContent("01.08.2026 – 25.08.2026");
    expect(trigger.closest(".owner-reports__period.report-actions")).toBeInTheDocument();
    expect(trigger.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(trigger);
    ["Сегодня", "Вчера", "Эта неделя", "Этот месяц", "Этот год"].forEach((preset) => {
      expect(screen.getByRole("button", { name: preset })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Начало периода")).toHaveValue("01.08.2026");
    expect(screen.getByLabelText("Конец периода")).toHaveValue("25.08.2026");
    expect(screen.getByText("Время").closest(".report-date-calendar-shell")).toHaveAttribute("aria-hidden", "true");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Начало периода"));
    expect(screen.getByRole("button", { name: "Год" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Месяц" })).toBeInTheDocument();
    expect(screen.getByText("Часы")).toBeInTheDocument();
    expect(screen.getByText("Минуты")).toBeInTheDocument();
    expect(container.querySelector(".is-range-start.is-selected")).toBeInTheDocument();
    expect(container.querySelector(".is-range-end.is-selected")).toBeInTheDocument();
    expect(container.querySelectorAll(".is-in-range").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "ОК" })[1]);
    expect(screen.queryByRole("button", { name: "Предыдущий месяц" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сегодня" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: "Сегодня", startTime: "00:00", endTime: "00:00" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    render(
      <ReportDateRangePicker
        variant="canonical"
        value={{ start: "01.08.2026", end: "25.08.2026" }}
        onChange={vi.fn()}
        buttonAriaLabel="Период тестового отчёта"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Период тестового отчёта" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  // ZR-PERIOD-01B: current-period presets all mean start-of-period → TODAY and
  // must never reach into the future. Driven with a frozen clock so the
  // first-day / mid-month / last-day cases are deterministic.
  describe("current-period presets never include future dates", () => {
    function applyPreset(label, onChange) {
      render(
        <ReportDateRangePicker
          variant="canonical"
          value={{ preset: "", start: "01.01.2020", end: "01.01.2020", startTime: "00:00", endTime: "00:00" }}
          onChange={onChange}
          buttonAriaLabel="Период"
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Период" }));
      fireEvent.click(screen.getByRole("button", { name: label }));
      fireEvent.click(screen.getAllByRole("button", { name: "ОК" })[0]);
    }

    afterEach(() => {
      vi.useRealTimers();
      cleanup();
    });

    it.each([
      ["2026-09-01T10:00:00", "01.09.2026", "01.09.2026"],  // first day → single day
      ["2026-09-15T10:00:00", "01.09.2026", "15.09.2026"],  // mid-month → to date
      ["2026-09-30T10:00:00", "01.09.2026", "30.09.2026"],  // last day → full month
    ])("Этот месяц at %s → %s – %s", (now, start, end) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(now));
      const onChange = vi.fn();
      applyPreset("Этот месяц", onChange);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ start, end }));
    });

    it("Эта неделя and Этот год stay start-of-period → today", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T10:00:00")); // Tuesday
      const week = vi.fn();
      applyPreset("Эта неделя", week);
      expect(week).toHaveBeenCalledWith(expect.objectContaining({ start: "14.09.2026", end: "15.09.2026" }));
      cleanup();
      const year = vi.fn();
      applyPreset("Этот год", year);
      expect(year).toHaveBeenCalledWith(expect.objectContaining({ start: "01.01.2026", end: "15.09.2026" }));
    });

    it("Сегодня and Вчера remain single days", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T10:00:00"));
      const today = vi.fn();
      applyPreset("Сегодня", today);
      expect(today).toHaveBeenCalledWith(expect.objectContaining({ start: "15.09.2026", end: "15.09.2026" }));
      cleanup();
      const yesterday = vi.fn();
      applyPreset("Вчера", yesterday);
      expect(yesterday).toHaveBeenCalledWith(expect.objectContaining({ start: "14.09.2026", end: "14.09.2026" }));
    });
  });
});
