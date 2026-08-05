/**
 * Восстанавливает правила, заскоупленные под body.<класс>, СТРОГО в исходном
 * порядке каскада: одна CSS-декларация на одну запись реестра, соседние записи
 * с одинаковым селектором объединяются в одно правило.
 *
 * Схлопывать по селектору с «последним значением» нельзя — это перемешивает
 * порядок и ломает каскад.
 *
 *   node tools/body-scoped-gen.mjs <ledger.json> <out.css>
 */
import fs from "node:fs";

const [, , ledgerPath, outCss] = process.argv;
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

const isBodyScoped = (sel) => sel.split(",").some((s) => /^\s*body\.[\w-]/.test(s));
const DROP = new Set(["transition", "transition-property", "transition-duration",
  "transition-timing-function", "transition-delay", "animation", "animation-name",
  "animation-duration", "will-change"]);

const seq = [];
for (const e of ledger) {
  if (!isBodyScoped(e.sel) || DROP.has(e.prop)) continue;
  const sel = e.sel.replace(/\s+/g, " ").trim();
  const last = seq[seq.length - 1];
  if (last && last.sel === sel && last.ctx === e.ctx) last.decls.push([e.prop, e.val]);
  else seq.push({ ctx: e.ctx, sel, decls: [[e.prop, e.val]] });
}

let css = `\n/* ═══════════════════════════════════════════════════════════════
   ПРАВИЛА ПОД body.<класс> — верхний авторитетный слой старого дизайна.
   Возвращены строго в исходном порядке каскада, без !important.
   ═══════════════════════════════════════════════════════════════ */\n`;
let n = 0, openCtx = null;
for (const g of seq) {
  if (g.ctx !== openCtx) {
    if (openCtx) css += `}\n`;
    if (g.ctx) css += `${g.ctx} {\n`;
    openCtx = g.ctx;
  }
  const ind = g.ctx ? "  " : "";
  css += `${ind}${g.sel} {\n`;
  for (const [p, v] of g.decls) { css += `${ind}  ${p}: ${v};\n`; n++; }
  css += `${ind}}\n`;
}
if (openCtx) css += `}\n`;

fs.writeFileSync(outCss, css);
console.log(`правил / деклараций: ${seq.length} / ${n}`);
console.log(`-> ${outCss}`);
