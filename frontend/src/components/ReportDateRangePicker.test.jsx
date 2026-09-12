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

  it("supports controlled open state and reports animated exit completion", async () => {
    const onOpenChange = vi.fn();
    const onExitComplete = vi.fn();
    const props = {
      variant: "canonical",
      value: { start: "01.08.2026", end: "25.08.2026" },
      onChange: vi.fn(),
      buttonAriaLabel: "Период тестового отчёта",
      animateExit: true,
      onOpenChange,
      onExitComplete,
    };
    const { container, rerender } = render(<ReportDateRangePicker {...props} open />);

    const trigger = screen.getByRole("button", { name: "Период тестового отчёта" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const openMenu = container.querySelector(".report-date-menu");
    expect(openMenu).toBeInTheDocument();

    rerender(<ReportDateRangePicker {...props} open={false} />);
    const closingMenu = container.querySelector(".report-date-menu.is-closing");
    expect(closingMenu).toBe(openMenu);
    expect(closingMenu).toHaveAttribute("inert");
    expect(closingMenu).toHaveAttribute("aria-hidden", "true");
    fireEvent(closingMenu, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitFor(() => expect(onExitComplete).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".report-date-menu")).toBeNull();
  });

  it("keeps the same uncontrolled menu node mounted until its exit animation ends", async () => {
    const { container } = render(
      <ReportDateRangePicker
        variant="canonical"
        value={{ preset: "Сегодня", start: "12.09.2026", end: "12.09.2026" }}
        onChange={vi.fn()}
        buttonAriaLabel="Период Z-отчёта"
        animateExit
      />,
    );

    const trigger = screen.getByRole("button", { name: "Период Z-отчёта" });
    fireEvent.click(trigger);
    const openMenu = container.querySelector(".report-date-menu");
    expect(openMenu).toBeInTheDocument();

    fireEvent.click(trigger);
    const closingMenu = container.querySelector(".report-date-menu.is-closing");
    expect(closingMenu).toBe(openMenu);
    expect(closingMenu).toHaveAttribute("inert");
    expect(closingMenu).toHaveAttribute("aria-hidden", "true");

    fireEvent(closingMenu, new Event("webkitAnimationEnd", { bubbles: true }));
    await waitFor(() => expect(container.querySelector(".report-date-menu")).toBeNull());
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

// --- explicit time activation (ZR-TIME-01) -----------------------------------
// The picker's 00:00 defaults are a DISPLAY state. Only a clock the operator
// actually changed may narrow a Z-report to a wall-clock window, so the committed
// value carries `timeTouched` and nothing else about the approved UI changes.
describe("canonical picker explicit time activation (ZR-TIME-01)", () => {
  const RANGE = {
    preset: "",
    start: "01.09.2026",
    end: "04.09.2026",
    startTime: "00:00",
    endTime: "00:00",
  };

  function open(overrides = {}) {
    const onChange = vi.fn();
    const { container } = render(
      <ReportDateRangePicker
        variant="canonical"
        value={RANGE}
        onChange={onChange}
        buttonAriaLabel="Период отчёта"
        {...overrides}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Период отчёта" }));
    return { onChange, container, apply: () => fireEvent.click(container.querySelector(".report-date-ok")) };
  }

  function pickTime(fieldLabel, column, value) {
    fireEvent.click(screen.getByLabelText(fieldLabel));
    const list = document.querySelectorAll(".report-date-time-list")[column];
    fireEvent.click([...list.querySelectorAll("button")].find((b) => b.textContent === value));
  }

  it("commits an untouched range as DATE-ONLY", () => {
    const { onChange, apply } = open();
    apply();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      start: "01.09.2026", end: "04.09.2026", startTime: "00:00", endTime: "00:00", timeTouched: false,
    });
  });

  it("activates explicit time when the START hour changes", () => {
    const { onChange, apply } = open();
    pickTime("Начало периода", 0, "13");
    apply();

    expect(onChange.mock.calls[0][0]).toMatchObject({ startTime: "13:00", timeTouched: true });
  });

  it("activates explicit time when the END minute changes", () => {
    const { onChange, apply } = open();
    pickTime("Конец периода", 1, "06");
    apply();

    expect(onChange.mock.calls[0][0]).toMatchObject({ endTime: "00:06", timeTouched: true });
  });

  it("does not activate when the already-selected clock is re-picked", () => {
    const { onChange, apply } = open();
    pickTime("Начало периода", 0, "00");
    pickTime("Начало периода", 1, "00");
    apply();

    expect(onChange.mock.calls[0][0]).toMatchObject({ startTime: "00:00", timeTouched: false });
  });

  it("a preset is a DATE range, so it clears explicit time again", () => {
    const { onChange, apply, container } = open();
    pickTime("Начало периода", 0, "13");
    // the PRESET row's Сегодня, not the calendar footer's jump-to-today button
    const preset = [...container.querySelectorAll(".report-date-presets button")]
      .find((button) => button.textContent === "Сегодня");
    fireEvent.click(preset);
    apply();

    expect(onChange.mock.calls[0][0]).toMatchObject({ startTime: "00:00", timeTouched: false });
  });

  it("keeps a committed explicit window when the picker is reopened", () => {
    const { onChange, apply } = open({
      value: { ...RANGE, startTime: "13:23", endTime: "22:06", timeTouched: true },
    });
    apply();

    expect(onChange.mock.calls[0][0]).toMatchObject({
      startTime: "13:23", endTime: "22:06", timeTouched: true,
    });
  });

  it("lets a page's own validateRange refuse the window instead of committing it", () => {
    const { onChange, apply, container } = open({ validateRange: () => "Начало позже окончания" });
    apply();

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".report-date-error")).toHaveTextContent("Начало позже окончания");
  });
});
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
