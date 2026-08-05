/**
 * Ищет декларации верхнего слоя, которые НЕ выигрывают каскад нигде.
 * Такие можно удалить — картинка не изменится по определению.
 *
 * Осторожность: селекторы с состояниями (:hover, .is-open и т.п.) пропускаем —
 * эти состояния не представлены в снятом DOM, значит проверить их нельзя.
 *
 *   node tools/find-never-wins.mjs <rules.json> <domDir> <out.json> [widths]
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , rulesPath, domDir, outPath, widthsArg] = process.argv;
const WIDTHS = (widthsArg || "390,768,1280,1440").split(",").map(Number);
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

const LAYER_ORDER = ["marjon-base", "marjon-important"];
const rank = (n) => (!n ? LAYER_ORDER.length : (LAYER_ORDER.indexOf(n) === -1 ? 0 : LAYER_ORDER.indexOf(n)));

/**
 * Селектор зависит от состояния, которое нельзя надёжно проверить.
 *
 * Псевдоклассы jsdom не вычисляет в принципе. Классы-состояния сняты
 * отдельными вариантами DOM (tools/audit/harvest-states.jsx), но покрыты
 * не все их сочетания — попытка ослабить это условие дала регрессию
 * на 38 свойствах сайдбара. Пока держим строго.
 */
const STATEFUL = /:(hover|focus|focus-within|focus-visible|active|checked|disabled|target|placeholder-shown|valid|invalid)\b|\.is-|\.has-|\.show|\.open|\baria-expanded="true"/;

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

const mediaOk = rules.map((r) => WIDTHS.map((w) => mediaApplies(r.ctx, w)));

const byId = new Map(), byClass = new Map(), byTag = new Map(); const universal = [];
rules.forEach((r, i) => {
  const [k, v] = r.key;
  const t = k === "id" ? byId : k === "class" ? byClass : k === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(v)) t.set(v, []);
  t.get(v).push(i);
});

/* какие (правило, свойство) хоть раз выиграли */
const won = new Set();
/* какие вообще матчились — чтобы отличить «не выиграл» от «не встретился» */
const seenRule = new Set();

for (const f of fs.readdirSync(domDir).filter((x) => x.endsWith(".html")).sort()) {
  const html = fs.readFileSync(path.join(domDir, f), "utf8");
  const cls = /dashboard-shell/.test(html) ? ' class="dashboard-body"' : "";
  const dom = new JSDOM(`<!doctype html><html><body${cls}>${html}</body></html>`);
  for (const el of dom.window.document.querySelectorAll("*")) {
    const cand = new Set();
    if (el.id) (byId.get(el.id) || []).forEach((i) => cand.add(i));
    for (const c of el.classList) (byClass.get(c) || []).forEach((i) => cand.add(i));
    (byTag.get(el.tagName.toLowerCase()) || []).forEach((i) => cand.add(i));
    universal.forEach((i) => cand.add(i));

    const hit = [];
    for (const i of cand) {
      let m = false;
      try { m = el.matches(rules[i].sel); } catch { m = false; }
      if (m) { hit.push(i); seenRule.add(i); }
    }
    if (!hit.length) continue;

    for (let wi = 0; wi < WIDTHS.length; wi++) {
      const win = new Map();
      for (const ri of hit) {
        if (!mediaOk[ri][wi]) continue;
        const r = rules[ri];
        const lay = rank(r.layer);
        for (const d of r.d) {
          const cur = win.get(d[0]);
          if (!cur) { win.set(d[0], [lay, r.spec, r.ord, ri]); continue; }
          if (lay !== cur[0]) { if (lay > cur[0]) win.set(d[0], [lay, r.spec, r.ord, ri]); continue; }
          const cs = cur[1], rs = r.spec;
          if ((rs[0] - cs[0] || rs[1] - cs[1] || rs[2] - cs[2] || r.ord - cur[2]) >= 0)
            win.set(d[0], [lay, r.spec, r.ord, ri]);
        }
      }
      for (const [prop, w] of win) won.add(`${w[3]}|${prop}`);
    }
  }
  dom.window.close();
}

const dead = [];
let considered = 0, skippedState = 0, skippedUnseen = 0;
rules.forEach((r, i) => {
  if (r.layer !== "marjon-important") return;
  if (STATEFUL.test(r.sel)) { skippedState += r.d.length; return; }
  if (!seenRule.has(i)) { skippedUnseen += r.d.length; return; }
  for (const d of r.d) {
    considered++;
    if (!won.has(`${i}|${d[0]}`)) {
      dead.push({ file: r.file, line: r.line, sel: r.sel, ctx: r.ctx, prop: d[0], val: d[1] });
    }
  }
});

fs.writeFileSync(outPath, JSON.stringify({ dead }, null, 1));
const impTotal = rules.filter((r) => r.layer === "marjon-important").reduce((a, r) => a + r.d.length, 0);
console.log(`деклараций в слое marjon-important : ${impTotal}`);
console.log(`  пропущено (селектор с состоянием): ${skippedState}`);
console.log(`  пропущено (элемент не встретился): ${skippedUnseen}`);
console.log(`  проверено                        : ${considered}`);
console.log(`МЁРТВЫХ (не выигрывают нигде)      : ${dead.length}`);
const byFile = new Map();
for (const d of dead) byFile.set(d.file, (byFile.get(d.file) || 0) + 1);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(5)}  ${f}`);
