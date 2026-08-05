/**
 * Восстановление псевдоэлементов (::before / ::after).
 *
 * Их нельзя проверить измерением DOM — jsdom не отдаёт псевдоэлементы в
 * querySelectorAll. Поэтому восстанавливаем консервативно: по реестру, отбрасывая
 * только заведомый шум (переходы/анимации). transform здесь НЕ шум — на нём
 * держатся галочки, стрелки и повороты.
 *
 *   node tools/pseudo-gen.mjs <ledger.json> <out.css>
 */
import fs from "node:fs";

const [, , ledgerPath, outCss] = process.argv;
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

const isPseudo = (s) => /::(?:before|after)\b/.test(s) || /(?<!:):(?:before|after)\b/.test(s);
const DROP = new Set(["transition", "transition-property", "transition-duration",
  "transition-timing-function", "transition-delay", "animation", "animation-name",
  "animation-duration", "animation-timing-function", "will-change"]);

const TOKENS = {
  "#1db5b5": "var(--color-brand)", "#22d3ee": "var(--color-brand-hover)",
  "#0fa3a3": "var(--color-brand-dark)", "#ecfeff": "var(--teal-50)",
  "#67e8f9": "var(--teal-300)", "#071428": "var(--neutral-950)",
  "#0b1f3f": "var(--neutral-900)", "#162840": "var(--neutral-800)",
  "#243a56": "var(--neutral-700)", "#536d8e": "var(--neutral-500)",
  "#a8b9d0": "var(--neutral-300)", "#d0d9e8": "var(--neutral-200)",
  "#e8edf6": "var(--neutral-100)", "#f4f7fc": "var(--neutral-50)",
  "#ffffff": "var(--neutral-0)", "#fff": "var(--neutral-0)",
  "#2563eb": "var(--color-interactive)", "#16a34a": "var(--color-success)",
  "#f59e0b": "var(--color-warning)", "#ef4444": "var(--color-danger)",
};
const tokenize = (v) => /url\(|data:/i.test(v) ? v
  : v.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => TOKENS[m.toLowerCase()] || m);

// (ctx, sel) -> prop -> value, последняя запись побеждает
const groups = new Map();
let n = 0;
for (const e of ledger) {
  if (!isPseudo(e.sel)) continue;
  if (DROP.has(e.prop)) continue;
  const key = `${e.ctx}||${e.sel.replace(/\s+/g, " ").trim()}`;
  if (!groups.has(key)) groups.set(key, new Map());
  groups.get(key).set(e.prop, e.val);
  n++;
}

const byCtx = new Map();
for (const [key, props] of groups) {
  const i = key.indexOf("||");
  const ctx = key.slice(0, i), sel = key.slice(i + 2);
  if (!byCtx.has(ctx)) byCtx.set(ctx, []);
  byCtx.get(ctx).push({ sel, props });
}

let css = `\n/* ═══ ПСЕВДОЭЛЕМЕНТЫ (::before / ::after) ═══
   Восстановлены по реестру: измерением DOM они не проверяются.
   ═══════════════════════════════════════════════════════════ */\n`;
let ndecl = 0;
for (const [ctx, list] of byCtx) {
  const ind = ctx ? "  " : "";
  if (ctx) css += `${ctx} {\n`;
  for (const g of list) {
    css += `${ind}${g.sel} {\n`;
    for (const [p, v] of g.props) { css += `${ind}  ${p}: ${tokenize(v)};\n`; ndecl++; }
    css += `${ind}}\n`;
  }
  if (ctx) css += `}\n`;
}
fs.writeFileSync(outCss, css);
console.log(`деклараций из реестра : ${n}`);
console.log(`правил / деклараций   : ${groups.size} / ${ndecl}`);
console.log(`-> ${outCss}`);
