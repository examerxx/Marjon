import { readFileSync } from "node:fs";
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
    // ZR-PRINT-FINAL-UX-05: a time-bearing field always reads DD.MM.YYYY | HH:MM
    expect(screen.getByLabelText("Начало периода")).toHaveValue("01.08.2026 | 00:00");
    expect(screen.getByLabelText("Конец периода")).toHaveValue("25.08.2026 | 00:00");
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

// --- screen date/time contract (ZR-PRINT-FINAL-UX-05) ------------------------
// The canonical picker DISPLAYS «DD.MM.YYYY | HH:MM», centres «Дата с» / «Дата
// по» over their own fields and «Время» over the whole ЧАСЫ + МИНУТЫ block, and
// paints the selected hour / minute / Сегодня in the exact OWNER accent. The
// markup hooks are asserted here together with the OWNER rules that target them,
// because "CSS that quietly stops matching the DOM" is the regression this
// guards — neither half proves the requirement alone.
describe("canonical picker screen date/time display (ZR-PRINT-FINAL-UX-05)", () => {
  const OWNER_CSS = readFileSync(`${process.cwd()}/src/styles/owner/reports.css`, "utf8");
  const TOKENS_CSS = readFileSync(`${process.cwd()}/src/styles/global/marjon-tokens.css`, "utf8");
  const RANGE = {
    preset: "",
    start: "31.08.2026",
    end: "04.09.2026",
    startTime: "13:23",
    endTime: "05:03",
  };

  function openPicker(range = RANGE) {
    render(
      <ReportDateRangePicker
        variant="canonical"
        value={range}
        onChange={vi.fn()}
        buttonAriaLabel="Период отчёта"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Период отчёта" }));
  }

  it("displays DD.MM.YYYY | HH:MM in both fields and parses that text back", () => {
    openPicker();

    expect(screen.getByLabelText("Начало периода")).toHaveValue("31.08.2026 | 13:23");
    expect(screen.getByLabelText("Конец периода")).toHaveValue("04.09.2026 | 05:03");
    // the separator is display only, so the field understands its own rendering
    // when typed back instead of dropping the time
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "01.09.2026 | 07:45" } });
    expect(screen.getByLabelText("Начало периода")).toHaveValue("01.09.2026 | 07:45");
  });

  it("keeps each date label inside its own field, and Время above both time columns", () => {
    openPicker();

    const startField = screen.getByText("Дата с").closest(".report-date-field");
    const endField = screen.getByText("Дата по").closest(".report-date-field");
    expect(startField).toContainElement(screen.getByLabelText("Начало периода"));
    expect(endField).toContainElement(screen.getByLabelText("Конец периода"));
    // each label measures ONE field, so centring it cannot drift onto the other
    expect(startField).not.toContainElement(screen.getByLabelText("Конец периода"));

    fireEvent.click(screen.getByLabelText("Начало периода"));
    const title = screen.getByText("Время").closest(".report-date-time-title");
    const panel = title.parentElement;
    const columns = panel.querySelector(".report-date-time-columns");
    expect(panel).toHaveClass("report-date-time-panel");
    // «Время» is the heading directly above the ЧАСЫ + МИНУТЫ pair — centring it
    // centres it over both columns, not over one of them
    expect(title.nextElementSibling).toBe(columns);
    expect(columns.textContent).toContain("Часы");
    expect(columns.textContent).toContain("Минуты");
  });

  it("marks exactly the selected hour and minute for the accent rule", () => {
    openPicker();
    fireEvent.click(screen.getByLabelText("Начало периода"));

    const [hours, minutes] = document.querySelectorAll(".report-date-time-list");
    const selectedHours = hours.querySelectorAll("button.is-selected");
    const selectedMinutes = minutes.querySelectorAll("button.is-selected");
    expect(selectedHours).toHaveLength(1);
    expect(selectedHours[0]).toHaveTextContent("13");
    expect(selectedMinutes).toHaveLength(1);
    expect(selectedMinutes[0]).toHaveTextContent("23");
    expect(document.querySelector(".report-date-today-button")).toHaveTextContent("Сегодня");
  });

  it("centres both date labels and Время in the OWNER stylesheet", () => {
    expect(OWNER_CSS).toMatch(
      /\.owner-reports__period\.report-actions \.report-date-field > span \{[^}]*text-align: center/,
    );
    expect(OWNER_CSS).toMatch(
      /\.owner-reports__period\.report-actions \.report-date-time-title \{[^}]*justify-content: center/,
    );
  });

  it.each([
    ["selected hour / minute", "\\.report-date-time-list button\\.is-selected"],
    ["Сегодня button", "\\.report-date-today-button"],
  ])("paints the %s in the exact accent on white", (_label, selector) => {
    const body = `\\.owner-reports__period\\.report-actions ${selector} \\{[^}]*`;
    expect(OWNER_CSS).toMatch(new RegExp(`${body}background: var\\(--owner-accent, #1fc9c9\\)`));
    expect(OWNER_CSS).toMatch(new RegExp(`${body}color: #ffffff`));
    // …and the token that rule resolves to IS the approved value
    expect(TOKENS_CSS).toMatch(/--owner-accent:\s*#1fc9c9;/i);
  });
});
