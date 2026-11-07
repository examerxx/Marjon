import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale, Tooltip } from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

// График выручки OWNER-дашборда (Chart.js) с плагином постепенного раскрытия
// и внешним тултипом. Вынесено из OwnerDashboard.jsx (FE-07B) 1:1.

function formatAxisValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const normalized = Math.abs(number) < 1 ? 0 : number;
  return normalized.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

// Display labels for the left Y-axis neutral range (V3.1 contract).
export const REVENUE_AXIS_MILLION_LABELS = {
  200: "1M",
  400: "5M",
  600: "10M",
  800: "20M",
  1000: "30M",
};

export function formatRevenueAxisTick(value, hasRevenue) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  if (amount < 0) return `−${formatRevenueAxisTick(-amount, hasRevenue)}`;
  if (!hasRevenue && amount in REVENUE_AXIS_MILLION_LABELS) return REVENUE_AXIS_MILLION_LABELS[amount];
  if (amount <= 0) return "0";
  if (!hasRevenue) return formatAxisValue(amount);
  if (amount >= 1_000_000_000) return `${formatAxisValue(amount / 1_000_000_000)}B`;
  if (amount >= 1_000_000) return `${formatAxisValue(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `${formatAxisValue(amount / 1_000)}K`;
  return amount.toLocaleString("ru-RU", { maximumFractionDigits: 8 });
}

// Tooltip always shows the full sum ("3 000 000 UZS"), never a shortened tick.
export function formatChartTooltipValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 UZS";
  return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} UZS`;
}

export function formatSalesLabel(item) {
  if (item && typeof item.chartLabel === "string" && item.chartLabel) return item.chartLabel;
  // API отдаёт snake_case: почасовые бакеты несут chart_label ("HH:00").
  if (item && typeof item.chart_label === "string" && item.chart_label) return item.chart_label;
  const match = String(item?.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}` : "";
}

export function formatSalesTooltipLabel(item) {
  const label = formatSalesLabel(item);
  const match = label.match(/^(\d{2}):00$/);
  if (!match) return label;
  const hour = Number(match[1]);
  return `${label} – ${String(hour + 1).padStart(2, "0")}:00`;
}

// The tooltip lives in a body portal: chart clipping cannot force a peak's
// tooltip below the point. Coordinates and bounds are viewport-relative.
export function revenueTooltipPosition({ width, height, tooltipWidth, tooltipHeight, caretX, caretY }) {
  const inset = 8;
  const gap = 10;
  const halfWidth = tooltipWidth / 2;
  const x = Math.max(halfWidth + inset, Math.min(caretX, width - halfWidth - inset));
  const above = caretY - gap - tooltipHeight;
  const y = Math.max(inset, Math.min(above, height - tooltipHeight - inset));
  return { x, y };
}

// `valueKey` выбирает серию бакета. По умолчанию — `revenue` (историческое
// поведение); дашборд рисует денежный приход, передавая valueKey="income".
// Если бакет не несёт выбранного поля (старый ответ), берём `revenue`, чтобы
// график не обнулился молча.
export default function RevenueChart({ sales, valueKey = "revenue" }) {
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const ctx = canvasRef.current.getContext("2d");
    const revealState = { progress: 0, didClip: false };
    const revealDuration = 1200;
    const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
    const revealPlugin = {
      id: "revenueChartReveal",
      beforeDatasetsDraw(chart) {
        const { chartArea } = chart;
        revealState.didClip = false;
        if (!chartArea) return;
        const width = chartArea.width * revealState.progress;
        chart.ctx.save();
        chart.ctx.beginPath();
        chart.ctx.rect(chartArea.left, chartArea.top, width, chartArea.height);
        chart.ctx.clip();
        revealState.didClip = true;
      },
      afterDatasetsDraw(chart) {
        if (revealState.didClip) chart.ctx.restore();
      },
    };
    let revealFrame = 0;
    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, "rgba(29, 181, 181, 0.28)");
    gradient.addColorStop(0.55, "rgba(31, 202, 194, 0.10)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    const revenueValues = sales.map((item) => {
      const raw = item?.[valueKey] ?? item?.revenue ?? 0;
      const number = Number(raw);
      return Number.isFinite(number) ? number : 0;
    });
    const hasRevenue = revenueValues.some((amount) => amount !== 0);

    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: sales.map((item) => formatSalesLabel(item)),
        datasets: [{
          data: revenueValues,
          borderColor: "#1db5b5",
          backgroundColor: gradient,
          borderWidth: 4,
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#1db5b5",
          pointBorderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.42,
        }],
      },
      options: {
        // Single controlled resize owner (V3.4): native responsive is OFF,
        // one ResizeObserver on .chart-wrap + one RAF drive chart.resize().
        responsive: false,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        animation: false,
        animations: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => {
              const tooltipEl = tooltipRef.current;
              if (!tooltipEl) return;

              if (!tooltip || tooltip.opacity === 0) {
                tooltipEl.classList.remove("is-visible");
                return;
              }

              const titleEl = tooltipEl.querySelector("strong");
              const valueEl = tooltipEl.querySelector("span");
              const item = sales[tooltip.dataPoints?.[0]?.dataIndex];
              if (titleEl) titleEl.textContent = item ? formatSalesTooltipLabel(item) : tooltip.title?.[0] || "";
              if (valueEl) valueEl.textContent = tooltip.body?.[0]?.lines?.[0] || "";

              const bounds = chart.canvas.getBoundingClientRect();
              const { x, y } = revenueTooltipPosition({
                width: window.innerWidth,
                height: window.innerHeight,
                tooltipWidth: tooltipEl.offsetWidth || 144,
                tooltipHeight: tooltipEl.offsetHeight || 80,
                caretX: bounds.left + tooltip.caretX,
                caretY: bounds.top + tooltip.caretY,
              });

              tooltipEl.style.left = `${x}px`;
              tooltipEl.style.top = `${y}px`;
              tooltipEl.classList.add("is-visible");
            },
            callbacks: { label: (context) => formatChartTooltipValue(context.parsed.y) },
          },
        },
        // REVENUE_CHART_SCALES
        scales: {
          x: { grid: { display: false }, ticks: { color: "#667085", font: { size: 13, weight: "600", family: "'Golos Text', Manrope, sans-serif" } }, border: { display: false } },
          y: {
            beginAtZero: true,
            // Empty plots use real money units too, so five evenly spaced
            // ticks do not mix legacy placeholder labels with raw numbers.
            suggestedMax: hasRevenue ? undefined : 30_000_000,
            grid: { color: "rgba(16, 24, 40, 0.08)", drawTicks: false },
            ticks: {
              color: "#667085",
              font: { size: 13, weight: "600", family: "'Golos Text', Manrope, sans-serif" },
              count: 5,
              autoSkip: false,
              maxTicksLimit: 5,
              callback: (value) => formatRevenueAxisTick(value, true),
            },
            border: { display: false },
          },
        },

      },
      plugins: [revealPlugin],
    });

    // Canvas colours must follow the palette without remounting the page or
    // losing its filters. Observe only the theme attribute, not layout changes.
    const applyTheme = () => {
      const styles = getComputedStyle(document.body);
      const dark = document.documentElement.dataset.theme === "dark";
      const muted = dark ? styles.getPropertyValue("--color-text-muted").trim() || "#8eacbf" : "#667085";
      const line = dark ? styles.getPropertyValue("--theme-line-soft").trim() || "#173d53" : "rgba(16, 24, 40, 0.08)";
      chart.options.scales.x.ticks.color = muted;
      chart.options.scales.y.ticks.color = muted;
      chart.options.scales.y.grid.color = line;
      chart.update("none");
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const revealStart = performance.now();
    const runReveal = (timestamp) => {
      const elapsed = timestamp - revealStart;
      const progress = Math.min(1, elapsed / revealDuration);
      revealState.progress = easeOutCubic(progress);
      chart.draw();
      if (progress < 1) revealFrame = window.requestAnimationFrame(runReveal);
    };
    revealFrame = window.requestAnimationFrame(runReveal);

    // Right-endpoint lock (V3.6.1): the stage is right-anchored, so every
    // stage resize moves its LEFT edge only — rightmost point, last tick and
    // right boundary stay fixed. The observer stores the latest integer size
    // and at most one RAF applies it immediately (old natural left-side
    // motion). No timers, no snap, no data touch, no remount.
    const wrapBox = canvasRef.current.closest(".chart-wrap") || canvasRef.current.parentElement;
    const hideTooltip = () => tooltipRef.current?.classList.remove("is-visible");
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
    const stageBox = canvasRef.current.parentElement;
    const appliedSize = { width: 0, height: 0 };
    const applyStageSize = (size) => {
      if (size.width <= 0 || size.height <= 0) return;
      if (size.width === appliedSize.width && size.height === appliedSize.height) return;
      appliedSize.width = size.width;
      appliedSize.height = size.height;
      stageBox.style.width = `${size.width}px`;
      canvasRef.current.style.width = `${size.width}px`;
      canvasRef.current.style.height = `${size.height}px`;
      chart.resize(size.width, size.height);
    };
    const wrapRect = wrapBox.getBoundingClientRect();
    applyStageSize({ width: Math.round(wrapRect.width), height: Math.round(wrapRect.height) });

    let motionRaf = 0;
    let latestSize = null;
    let sizeObserver = null;
    if (typeof window.ResizeObserver !== "undefined") {
      sizeObserver = new window.ResizeObserver((entries) => {
        const last = entries[entries.length - 1];
        latestSize = {
          width: Math.round(last.contentRect.width),
          height: Math.round(last.contentRect.height),
        };
        if (motionRaf) return;
        motionRaf = window.requestAnimationFrame(() => {
          motionRaf = 0;
          const size = latestSize;
          latestSize = null;
          if (!size) return;
          applyStageSize(size);
        });
      });
      sizeObserver.observe(wrapBox);
    }

    return () => {
      window.cancelAnimationFrame(revealFrame);
      if (motionRaf) window.cancelAnimationFrame(motionRaf);
      if (sizeObserver) sizeObserver.disconnect();
      window.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
      themeObserver.disconnect();
      chart.destroy();
    };

  }, [sales, valueKey]);

  return (
    <div className="revenue-chart-stage">
      <canvas ref={canvasRef} id="ownerRevenueChart" />
      {createPortal(<div className="owner-revenue-tooltip" style={{ position: "fixed", zIndex: 1100, transition: "opacity 0.16s ease" }} ref={tooltipRef} aria-hidden="true">
        <strong />
        <span />
      </div>, document.body)}
    </div>
  );
}
