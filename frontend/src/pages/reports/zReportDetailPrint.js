import { formatMoney } from "./reportMoney";

// Per-entity Z-report print document (ZR-PRINT-01C), deliberately SEPARATE from
// the frozen whole-shift builder in ZReportPage.jsx. That one knows nothing
// about dimensions; this one knows nothing about shift stubs — the detail
// contract excludes shift_opened_at / shift_closed_at / is_closed on purpose,
// because no fact row carries a shift_id and echoing them per cashier would
// imply a shift settlement that does not exist. The two never share a path.

// A figure a dimension structurally CANNOT attribute arrives as null and is
// listed in `unsupported_fields`. Unknown is not zero, so it is never printed
// as 0 / 0 UZS. A real backend zero stays a real zero.
export const UNKNOWN_FIGURE = "Не определено";

// A title that EXISTS but prints nothing: one NBSP. Chrome's print header centre
// renders the print job's document.title and falls back to the host page's title
// when the printed document has none, so "no title at all" is what printed
// «MARJON - Dashboard» (ZR-PRINT-FINAL-UX-06). NBSP is not ASCII whitespace, so
// it survives title normalisation instead of collapsing back to empty.
export const INVISIBLE_TITLE = "\u00a0";

// ZR-PRINT-FINAL-UX-05: the printed heading IS the report the user clicked —
// the plural row title from the screen — and the generic «Z-отчёт» word is gone
// from the document entirely. Per-entity blocks carry only the identity line
// (Имя / Место), so the report name is printed exactly once, as the main
// centred title.
const DIMENSIONS = {
  cashier: {
    title: "Отчёт по кассирам",
    nameLabel: "Имя",
    totals: "Итого по выбранным кассирам",
    namesLabel: "Кассиры",
  },
  waiter: {
    title: "Отчёт по официантам",
    nameLabel: "Имя",
    totals: "Итого по выбранным официантам",
    namesLabel: "Официанты",
  },
  hall: {
    // Row label on screen is "Отчёт по местам"; the backend dimension is `hall`.
    title: "Отчёт по местам",
    nameLabel: "Место",
    totals: "Итого по выбранным местам",
    namesLabel: "Места",
  },
};

// Local escaper: the print document is self-contained (no OWNER stylesheet, no
// OWNER module graph inside the frame), and the frozen general builder keeps
// its own copy untouched. Every dynamic string below goes through this.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- exact decimal money -----------------------------------------------------
// Backend money arrives as Pydantic Decimal JSON strings ("205000.00"). Reading
// them through Number() and multiplying in binary floating point yields
// 24599.999999-class results, so every percentage below is computed on exact
// BigInt integers and rounded exactly once, at the very end.

// "205000.00" -> { units: 20500000n, scale: 2 }; value === units / 10^scale.
function parseDecimal(value) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
  const units = BigInt((whole || "0") + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

// ROUNDING POLICY: half-up (away from zero) to a whole UZS, applied ONCE per
// printed amount and never re-applied to an already rounded amount. UZS has no
// circulating subunit and every Marjon report prints whole sums.
function roundHalfUp({ units, scale }) {
  if (scale === 0) return units;
  const divisor = 10n ** BigInt(scale);
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const rounded = magnitude / divisor + ((magnitude % divisor) * 2n >= divisor ? 1n : 0n);
  return negative ? -rounded : rounded;
}

// APPROVED waiter formula: the base is the FINAL order total
// (figures.net_sales — service fee already included), NEVER service_fee_total.
//   Обслуга официанта = Сумма заказов × Процент / 100
// 205000 × 12% = 24600 exactly; 20500 × 12% = 2460 is the wrong base.
export function waiterServiceUnits(netSales, percent) {
  const base = parseDecimal(netSales);
  const rate = parseDecimal(percent);
  if (base === null || rate === null) return null;
  return roundHalfUp({ units: base.units * rate.units, scale: base.scale + rate.scale + 2 });
}

// The ONE ZReportPage percent input drives EVERY selected waiter. 0 is valid; an
// empty or out-of-range field is refused outright rather than silently read as
// some other percentage.
export function normalizeWaiterPercent(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { percent: null, label: "не задан" };
  const parsed = parseDecimal(text);
  if (parsed === null) return { percent: null, label: "недопустимое значение" };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { percent: null, label: "недопустимое значение" };
  }
  return { percent: text, label: `${text}%` };
}

// --- cells and tables --------------------------------------------------------

function moneyCell(value) {
  return value == null ? UNKNOWN_FIGURE : formatMoney(value);
}

function countCell(value) {
  return value == null ? UNKNOWN_FIGURE : String(value);
}

function unitsCell(units) {
  return units == null ? UNKNOWN_FIGURE : formatMoney(units.toString());
}

// PLACE — the approved block is Кол-во заказов / Сумма блюд / Сумма обслуживания
// / Итого, and nothing else (ZR-PRINT-FINAL-UX-06 removed Скидки and Налог at the
// user's explicit request).
//
// CONSEQUENCE, stated rather than hidden: Marjon's Итого is `Order.total_amount`
// = subtotal − скидки + сервис + налог, so with those two lines gone the printed
// rows no longer add up to the printed Итого whenever a discount or a tax exists.
// Итого stays the backend's own net_sales — never a frontend re-derivation from
// the visible rows — so the total remains correct even though it is no longer
// reconstructible from the sheet.
const HALL_ROWS = [
  ["Кол-во заказов", "orders_count", countCell],
  ["Сумма блюд", "gross_sales", moneyCell],
  ["Сумма обслуживания", "service_fee_total", moneyCell],
];

function row(label, value) {
  return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
}

function subhead(title) {
  return `<div class="zrd-sub">${escapeHtml(title)}</div>`;
}

function hallTable(figures) {
  const body = HALL_ROWS.map(([label, key, cell]) => row(label, cell(figures?.[key]))).join("");
  // Итого is the backend's own net_sales, never a frontend re-derivation.
  return `<table class="zrd-table"><tbody>${body}</tbody>`
    + `<tfoot><tr class="zrd-strong"><td>Итого</td>`
    + `<td>${escapeHtml(moneyCell(figures?.net_sales))}</td></tr></tfoot></table>`;
}

// CASHIER — the reference block is the payment methods and their total, nothing
// else. That is also the truthful shape here: a cashier owns an order only
// through the COMPLETED payment that closed it, so the payment breakdown IS the
// cashier report. Order-level money (валовые продажи, скидки, налог, средний
// чек) describes orders, not the cash the cashier handled, so it is not printed.
//
// Every amount is rounded to whole UZS ONCE and the Итого is the sum of exactly
// those printed rows, so the block always foots as printed — never a different
// backend aggregate that would disagree with the lines above it. One unknown
// amount makes the total unknown instead of a silently short sum.
function cashierTable(figures) {
  const methods = Array.isArray(figures?.payment_methods) ? figures.payment_methods : [];
  const amounts = methods.map((item) => {
    const parsed = parseDecimal(item?.amount);
    return parsed === null ? null : roundHalfUp(parsed);
  });
  const body = methods.length
    ? methods.map((item, index) => row(item?.method, unitsCell(amounts[index]))).join("")
    : `<tr><td colspan="2">Нет оплат за выбранный период</td></tr>`;
  const total = amounts.some((value) => value === null)
    ? null
    : amounts.reduce((accumulator, value) => accumulator + value, 0n);
  return `<table class="zrd-table"><tbody>${body}</tbody>`
    + `<tfoot><tr class="zrd-strong"><td>Итого</td>`
    + `<td>${escapeHtml(unitsCell(total))}</td></tr></tfoot></table>`;
}

// --- entities ----------------------------------------------------------------
// Names only — a UUID is never the printed identity. Backend state flags are
// appended when true, so a report on an archived hall says so.
function entityName(entity) {
  const name = entity?.entity_name || "—";
  if (entity?.entity_deleted) return `${name} (удалён)`;
  if (entity?.entity_is_active === false) return `${name} (неактивен)`;
  return name;
}

// The one centred document header: the CLICKED report's own name (ZR-PRINT-
// FINAL-UX-05 — the generic «Z-отчёт» word is not printed), then the period it
// covers.
//
// ZR-TIME-01: the period text and its LABEL both come from the caller, because
// they must describe the window the backend actually aggregated:
//   * explicit time window → «Период: DD.MM.YYYY HH:MM - DD.MM.YYYY HH:MM»
//   * whole single day      → «Дата: DD.MM.YYYY»
//   * whole date range      → «Период: DD.MM.YYYY - DD.MM.YYYY»
// A date-only report is never labelled with clocks, because it never sent any.
function documentHeader(title, term, period) {
  return `<header class="zrd-doc-head">`
    + `<h1 class="zrd-title">${escapeHtml(title)}</h1>`
    + `<p class="zrd-period">${escapeHtml(term)}: ${escapeHtml(period)}</p>`
    + `</header><hr class="zrd-rule">`;
}

// `title` is optional: per-entity blocks identify themselves by the meta line
// alone (Имя: …), because the report name is already the document's main
// heading — a second, singular «Отчёт по кассиру» under «Отчёт по кассирам»
// would print the same words twice.
function sectionHead(title, metaRows) {
  return `<header class="zrd-head">`
    + (title ? `<h2>${escapeHtml(title)}</h2>` : "")
    + metaRows.map(([label, value]) => `<p class="zrd-meta">${escapeHtml(label)}: ${escapeHtml(value)}</p>`).join("")
    + `</header>`;
}

// PRINT-only waiter summary: ONE compact table for every selected waiter
// (Имя | Сумма заказов | Сумма услуги | Обслуга официанта) instead of a page
// each. "Сумма услуги" is informational — it is NOT the percentage base.
// The percent is stated once in the caption, never as a fourth data column.
//
// Union "Сумма заказов" / "Сумма услуги" come from the backend's own union
// totals — never a frontend sum of the entity rows. The union service amount IS
// the sum of the printed per-waiter amounts, so the table always foots to its
// own rows under the half-up policy above; if any row's amount is unknown the
// total is unknown too, rather than a silently short sum. A single waiter gets
// no Итого line, because it would restate that one row verbatim.
function waiterSummaryTable(entities, totals, percentState) {
  const amounts = entities.map((entity) => (percentState.percent === null
    ? null
    : waiterServiceUnits(entity?.figures?.net_sales, percentState.percent)));
  const body = entities.map((entity, index) => `<tr>`
    + `<td>${escapeHtml(entityName(entity))}</td>`
    + `<td>${escapeHtml(moneyCell(entity?.figures?.net_sales))}</td>`
    + `<td>${escapeHtml(moneyCell(entity?.figures?.service_fee_total))}</td>`
    + `<td>${escapeHtml(unitsCell(amounts[index]))}</td>`
    + `</tr>`).join("");
  const total = amounts.some((value) => value === null)
    ? null
    : amounts.reduce((accumulator, value) => accumulator + value, 0n);
  const foot = entities.length > 1
    ? `<tfoot><tr class="zrd-strong"><td>Итого</td>`
      + `<td>${escapeHtml(moneyCell(totals?.net_sales))}</td>`
      + `<td>${escapeHtml(moneyCell(totals?.service_fee_total))}</td>`
      + `<td>${escapeHtml(unitsCell(total))}</td></tr></tfoot>`
    : "";
  return `${subhead(`Обслуга по официантам (процент: ${percentState.label})`)}`
    + `<table class="zrd-table zrd-table--waiter">`
    + `<thead><tr><th>Имя</th><th>Сумма заказов</th><th>Сумма услуги</th><th>Обслуга официанта</th></tr></thead>`
    + `<tbody>${body}</tbody>`
    + foot
    + `</table>`;
}

// --- document ----------------------------------------------------------------
// Self-contained CSS: the frame never loads the OWNER stylesheet, so there is no
// screen token to reach for here and nothing in this file can leak back out onto
// a screen. Deliberately plain accounting paper — black on white, dashed rules
// instead of borders, no filled table headers, no cards, no rounded surfaces.
//
// GEOMETRY, approved against the reference print flow: A4 portrait carrying ONE
// ~108mm column centred on the sheet — about 51% of the 210mm page width, not
// the full printable area. Stretched to the printable width the same figures
// read as a wide data dump; the reference is a narrow, dense accounting slip
// with deliberate white space around it. The width is stated in mm so the
// proportion comes from CSS alone and never depends on the user touching
// Chrome's Scale control. Everything — heading, period, sections, tables,
// totals, notes — lives inside that one column, so nothing is centred while a
// table still spans the sheet.
//
// Typography is print points, not screen pixels, and stays deliberately small:
// the document must not grow just because it became narrower.
//
// Sections FLOW instead of taking a forced page each: page-per-entity turned a
// three-cashier report into three sheets and left a trailing blank page. Only
// `break-inside` is constrained, so a block moves to the next page whole rather
// than being cut mid-table.
export const DOC_WIDTH_MM = 108;

// TYPOGRAPHY (ZR-PRINT-TYPOGRAPHY-CORRECTION): normal printable text is
// 14px Calibri in #000000, per the supplied reference — the earlier 8.5pt → 9.5pt
// steps were still too small next to it. Table and inline cells carry the
// reference's own `padding: 0 10px 0 0`, so columns breathe horizontally instead
// of needing a wider sheet.
//
// SIZE changed, WEIGHT did not: normal text stays 400 (the explicit
// `font-weight:400` on th/td is what keeps column headers, names and amounts from
// turning bold), and the only bold is the pre-existing semantic bold — Итого /
// totals rows, the union section header, the waiter caption. The main heading
// keeps its size and weight (13pt/700/italic) and only follows the document's
// family; the period line stays below the body size so it still reads as
// secondary to that heading.
//
// Units are mixed on purpose: 14px is the requested body value (14px = 10.5pt at
// print resolution, an absolute size Chrome does not scale), while the heading and
// the period keep the point sizes already approved for them.
const PRINT_CSS = `@page{size:A4 portrait;margin:14mm}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{font:14px/1.28 Calibri,sans-serif;color:#000000}
.zrd-doc{width:${DOC_WIDTH_MM}mm;max-width:${DOC_WIDTH_MM}mm;margin-left:auto;margin-right:auto}
.zrd-doc-head{text-align:center}
.zrd-title{margin:0;font-size:13pt;font-weight:700;font-style:italic}
.zrd-period{margin:0.8mm 0 0;font-size:9pt}
.zrd-rule{border:0;border-top:1px dashed #000;margin:1.6mm 0 0}
.zrd-section{margin:3mm 0 0;padding:0}
.zrd-head h2{margin:0;font-size:14px;font-weight:700}
.zrd-meta{margin:0.4mm 0 0}
.zrd-sub{margin:2mm 0 0;font-weight:700}
.zrd-table{width:100%;border-collapse:collapse;margin:0.8mm 0 0}
.zrd-table th,.zrd-table td{border:0;border-bottom:1px dashed #808080;padding:0 10px 0 0;text-align:left;font-weight:400;vertical-align:bottom}
.zrd-table th+th,.zrd-table td+td{text-align:right}
.zrd-table tfoot td,.zrd-strong td{font-weight:700;border-bottom:0;border-top:1px solid #000}
.zrd-table--waiter{table-layout:fixed}
.zrd-table--waiter th:nth-child(1),.zrd-table--waiter td:nth-child(1){width:22%}
.zrd-table--waiter th:nth-child(2),.zrd-table--waiter td:nth-child(2){width:26%}
.zrd-table--waiter th:nth-child(3),.zrd-table--waiter td:nth-child(3){width:24%}
.zrd-table--waiter th:nth-child(4),.zrd-table--waiter td:nth-child(4){width:28%}
@media print{
.zrd-section,.zrd-table{break-inside:avoid;page-break-inside:avoid}
}`;

export function buildZReportDetailPrintDocument({
  detail,
  periodTerm = "Период",
  periodLabel = "",
  waiterPercent,
} = {}) {
  const meta = DIMENSIONS[detail?.dimension];
  if (!meta) throw new TypeError(`Unsupported Z-report dimension: ${detail?.dimension}`);
  const entities = Array.isArray(detail.entities) ? detail.entities : [];
  const percentState = normalizeWaiterPercent(waiterPercent);
  const isWaiter = detail.dimension === "waiter";
  const period = String(periodLabel || "");

  // WAITER: one compact table covering every selected waiter, plus the backend
  // union Итого — never a section per person. It carries its own caption and an
  // Имя column, so a section header would only restate them; nothing else fits
  // the approved four-column shape, so no per-waiter figures/payment pages are
  // emitted either.
  let blocks;
  if (isWaiter) {
    blocks = [waiterSummaryTable(entities, detail.totals, percentState)];
  } else {
    // CASHIER / HALL: one compact block per entity in backend order, identified
    // by the meta line alone (Имя: … / Место: …) — the report name is the main
    // heading and is not repeated per entity. Neither shape is additive across
    // entities, so the union block below comes from the backend `totals` —
    // never a frontend sum of the entity rows.
    const entityBlock = detail.dimension === "cashier" ? cashierTable : hallTable;
    blocks = entities.map((entity) => sectionHead("", [[meta.nameLabel, entityName(entity)]])
      + entityBlock(entity?.figures));

    // One entity → the union totals section would restate the same numbers, so
    // it is deliberately omitted. Two or more → the authoritative union block
    // straight from backend `totals`.
    if (entities.length > 1) {
      blocks.push(sectionHead(meta.totals, [[meta.namesLabel, entities.map(entityName).join(", ")]])
        + entityBlock(detail.totals));
    }
  }

  // Everything lives inside the one centred ~108mm column, so the heading, the
  // tables and the period all share the same measure. The backend coverage
  // notes are NOT printed (ZR-PRINT-FINAL-UX-05): the response still carries
  // `coverage`, but this document renders no «Примечание» block at all.
  const body = `<div class="zrd-doc">`
    + documentHeader(meta.title, periodTerm, period)
    + blocks.map((inner) => `<section class="zrd-section">${inner}</section>`).join("")
    + `</div>`;

  // Chrome's print header centre renders the PRINT JOB's own document.title, and
  // falls back to the HOST page's title when the printed document has none — an
  // empty <title> is exactly what let «MARJON - Dashboard» print above every
  // sheet (ZR-PRINT-FINAL-UX-06). So the document keeps a title that is present
  // but has no visible glyphs (one NBSP): non-empty, so Chrome never reaches for
  // the host title, and blank, so no product name is printed. renderPrintFrame
  // blanks the host title for the duration of the call as a second guard.
  return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><title>${INVISIBLE_TITLE}</title>`
    + `<style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

// --- print surface -----------------------------------------------------------
// REFERENCE FLOW (ZR-PRINT-REFERENCE-FLOW-07): the click opens a DEDICATED print
// document — its own tab holding nothing but the report — and Chrome's native
// preview is invoked automatically as soon as that document is ready. One
// application click, no Ctrl+P, no second Print action, and no PDF library: the
// preview's own destination list (Microsoft Print to PDF, Save as PDF, a real
// printer) IS the PDF path.
//
// The tab is opened SYNCHRONOUSLY inside the click handler, while the user
// activation is still live, so the popup blocker allows it; the detail request is
// awaited afterwards and the waiting document is replaced in place, so the user
// never sits in front of a blank tab. If an environment blocks the popup anyway
// (window.open returns null), the surface degrades to the hidden iframe — the same
// document printed from a frame instead of a tab — so one click still reaches the
// preview.
export const PRINT_WAIT_TEXT = "Готовим отчёт…";

// The waiting document is the print document's own first state: same invisible
// title, same white sheet, nothing from the OWNER shell.
const WAIT_CSS = `html,body{margin:0;background:#fff}
body{font:14px/1.28 Calibri,sans-serif;color:#000000;padding:14mm}
.zrd-wait{margin:0;text-align:center}`;

export function buildPrintWaitDocument() {
  return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><title>${INVISIBLE_TITLE}</title>`
    + `<style>${WAIT_CSS}</style></head>`
    + `<body><p class="zrd-wait">${PRINT_WAIT_TEXT}</p></body></html>`;
}

function writeDocument(doc, html) {
  doc.open();
  doc.write(html);
  doc.close();
}

export function openPrintFrame(doc = document) {
  const frame = doc.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("data-zrd-print", "true");
  doc.body.appendChild(frame);
  return frame;
}

// Print is invoked once the written document has actually finished parsing and
// laying out (ZR-PRINT-FINAL-UX-06): readyState/load, then webfonts, then one
// animation frame. A blind timer could hand Chrome a document that had not been
// laid out yet, which is what a preview showing an unformed sheet looks like. The
// timer survives only as a floor: if a browser never reports the written document
// ready, one click must still open the preview.
const PRINT_READY_FALLBACK_MS = 400;

function whenReady(view, doc, run) {
  const afterFonts = () => {
    const paint = view.requestAnimationFrame ? () => view.requestAnimationFrame(run) : run;
    const fonts = doc.fonts?.ready;
    if (fonts?.then) fonts.then(paint, paint);
    else paint();
  };
  if (doc.readyState === "complete") afterFonts();
  else view.addEventListener("load", afterFonts, { once: true });
}

function schedulePrint(view, doc, run) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    run();
  };
  whenReady(view, doc, once);
  window.setTimeout(once, PRINT_READY_FALLBACK_MS);
}

// Opened synchronously by the click handler: a real tab when the browser allows
// one, the hidden iframe otherwise. Either way the surface already shows the
// waiting document by the time this returns.
export function openPrintSurface(view = window) {
  let printWindow = null;
  try {
    printWindow = view.open("", "_blank");
  } catch (error) {
    printWindow = null;
  }
  if (printWindow?.document) {
    writeDocument(printWindow.document, buildPrintWaitDocument());
    return { kind: "window", printWindow };
  }
  return { kind: "frame", frame: openPrintFrame(view.document) };
}

// A failed detail request must not leave anything that could pass for a finished
// report: the tab is closed, the frame removed.
export function closePrintSurface(surface) {
  if (surface?.kind === "window") {
    if (!surface.printWindow?.closed) surface.printWindow?.close();
    return;
  }
  surface?.frame?.remove();
}

export function renderPrintSurface(surface, html) {
  if (surface?.kind !== "window") return renderPrintFrame(surface?.frame, html);
  const printWindow = surface.printWindow;
  if (!printWindow || printWindow.closed || !printWindow.document) return false;
  writeDocument(printWindow.document, html);
  // Reference behaviour: cancelling the preview leaves the printable document on
  // screen, so nothing here closes, clears or re-prints it — only the user does.
  // The tab is its own top-level document, so there is no host title for Chrome's
  // print header to fall back to either.
  schedulePrint(printWindow, printWindow.document, () => {
    if (printWindow.closed) return;
    printWindow.focus();
    printWindow.print();
  });
  return true;
}

// Fallback surface only (popup blocked): the same document printed from a hidden
// iframe, which cannot stay on screen afterwards, so it is cleaned up as before.
export function renderPrintFrame(frame, html) {
  const frameWindow = frame?.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    frame?.remove();
    return false;
  }
  writeDocument(frameDocument, html);

  // Second guard for the browser print header on this path: an iframe print job
  // with no title of its own falls back to the HOST page's title, which is what
  // printed «MARJON - Dashboard». The job's title is already invisible, and the
  // host's is swapped for an invisible one only for the duration of the print
  // call, then restored. window.print() blocks until the preview is dismissed,
  // and afterprint restores too, so the tab title is never left blank.
  const host = frame.ownerDocument || document;
  const hostTitle = host.title;
  // Restoring is conditional on purpose: if anything else has set a title in the
  // meantime, that title — not this stale snapshot — is the current one.
  const restore = () => {
    if (host.title === INVISIBLE_TITLE) host.title = hostTitle;
  };
  frameWindow.onafterprint = () => {
    restore();
    frame.remove();
  };

  schedulePrint(frameWindow, frameDocument, () => {
    // A surface that is no longer in the document is not a print job: the click
    // was superseded (navigation, cleanup), so nothing is printed and no title is
    // touched.
    if (!frame.isConnected) return;
    host.title = INVISIBLE_TITLE;
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      restore();
      window.setTimeout(() => frame.remove(), 60000);
    }
  });
  return true;
}
