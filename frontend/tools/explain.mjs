/**
 * Показывает, какое правило выигрывает каскад для конкретного элемента и свойства.
 * Нужен, когда цифры расходятся и надо не гадать, а увидеть победителя.
 *
 *   node tools/explain.mjs <rules.json> <domDir> <page> <fingerprint> <prop> [width]
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , rulesPath, domDir, page, fp, prop, widthArg] = process.argv;
const WIDTH = Number(widthArg || 1440);
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

const LAYER_ORDER = ["marjon-base", "marjon-important"];
const layerRank = (n) => (!n ? LAYER_ORDER.length : (LAYER_ORDER.indexOf(n) === -1 ? 0 : LAYER_ORDER.indexOf(n)));

function mediaApplies(ctx, width) {
  if (!ctx) return true;
  for (const p of ctx.split(/(?=@media|@supports|@container)/g).map((s) => s.trim()).filter(Boolean)) {
    if (p.startsWith("@supports") || p.startsWith("@container")) continue;
    const q = p.replace(/^@media\s*/, "").toLowerCase();
    if (/\bprint\b/.test(q) && !/\bscreen\b/.test(q)) return false;
    let any = false;
    for (const alt of q.split(",").map((s) => s.trim())) {
      let ok = true;
      for (const m of alt.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)\s*(px|em|rem)?\s*\)/g)) {
        let v = parseFloat(m[2]);
        if (m[3] === "em" || m[3] === "rem") v *= 16;
        if (m[1] === "min" && !(width >= v)) ok = false;
        if (m[1] === "max" && !(width <= v)) ok = false;
      }
      if (ok) { any = true; break; }
    }
    if (!any) return false;
  }
  return true;
}

const html = fs.readFileSync(path.join(domDir, `${page}.html`), "utf8");
const cls = /dashboard-shell/.test(html) ? ' class="dashboard-body"' : "";
const dom = new JSDOM(`<!doctype html><html><body${cls}>${html}</body></html>`);
const els = [...dom.window.document.querySelectorAll("*")];

const target = els.find((el) => {
  const c = typeof el.className === "string" ? el.className.trim() : "";
  return el.tagName.toLowerCase() + (c ? "." + c.split(/\s+/).join(".") : "") === fp;
});
if (!target) { console.log(`элемент с отпечатком ${fp} не найден на ${page}`); process.exit(1); }

const cands = [];
for (const r of rules) {
  if (!mediaApplies(r.ctx, WIDTH)) continue;
  if (!r.d.some((d) => d[0] === prop)) continue;
  let m = false;
  try { m = target.matches(r.sel); } catch { m = false; }
  if (!m) continue;
  const d = r.d.filter((x) => x[0] === prop).pop();
  cands.push({ imp: d[2], lay: layerRank(r.layer), layer: r.layer || "—",
    spec: r.spec, ord: r.ord, val: d[1], sel: r.sel, file: r.file, line: r.line });
}
cands.sort((a, b) =>
  a.imp - b.imp || a.lay - b.lay ||
  a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2] || a.ord - b.ord);

console.log(`\n${page} · ${fp} · ${prop} · ${WIDTH}px`);
console.log(`кандидатов: ${cands.length}  (последний в списке побеждает)\n`);
for (const c of cands.slice(-10)) {
  console.log(`  ${c.imp ? "!imp" : "    "} слой=${c.layer.padEnd(16)} spec=${JSON.stringify(c.spec)} ord=${String(c.ord).padStart(6)}  ${c.val.slice(0, 26).padEnd(26)} ${c.sel.slice(0, 44)}  [${c.file}:${c.line}]`);
}
console.log(`\nПОБЕДИТЕЛЬ: ${cands.length ? cands[cands.length - 1].val : "(нет)"}`);
