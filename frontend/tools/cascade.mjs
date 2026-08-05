/**
 * Считает эффективный стиль каждого элемента реального DOM по правилам каскада.
 * Матчинг селекторов — через jsdom (nwsapi), т.е. спек-совместимый.
 *
 * Оптимизации:
 *  - селекторы матчатся ОДИН раз на страницу, медиазапросы применяются потом;
 *  - кандидаты берутся из индекса по правому ключу селектора и дедуплицируются;
 *  - результат пишется потоково в JSONL, без удержания всего в памяти.
 *
 * Использование:
 *   node --max-old-space-size=6144 tools/cascade.mjs <rules.json> <domDir> <outPrefix> [widths]
 * Результат: <outPrefix>.<width>.jsonl  +  <outPrefix>.meta.json
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , rulesPath, domDir, outPrefix, bpArg] = process.argv;
const WIDTHS = (bpArg || "390,768,1280").split(",").map(Number);

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

/* ---------- каскадные слои ----------
   Порядок каскада: важность → слой → специфичность → порядок.
   Правила вне слоёв сильнее любого слоя — так по спецификации. */
const LAYER_ORDER = ["marjon-base", "marjon-important"];
function layerRank(name) {
  if (!name) return LAYER_ORDER.length;
  const i = LAYER_ORDER.indexOf(name);
  return i === -1 ? 0 : i;
}

/* ---------- медиазапросы ---------- */
function mediaApplies(ctx, width) {
  if (!ctx) return true;
  const parts = ctx.split(/(?=@media|@supports|@container)/g).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (p.startsWith("@supports") || p.startsWith("@container")) continue;
    const q = p.replace(/^@media\s*/, "").toLowerCase();
    if (/\bprint\b/.test(q) && !/\bscreen\b/.test(q)) return false;
    const alts = q.split(",").map((s) => s.trim());
    let any = false;
    for (const alt of alts) {
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

// mediaOk[ruleIdx] = Uint8Array по индексам ширин
const mediaOk = rules.map((r) => Uint8Array.from(WIDTHS.map((w) => (mediaApplies(r.ctx, w) ? 1 : 0))));

/* ---------- индекс кандидатов ---------- */
const byId = new Map(), byClass = new Map(), byTag = new Map();
const universal = [];
rules.forEach((r, i) => {
  const [kind, val] = r.key;
  const t = kind === "id" ? byId : kind === "class" ? byClass : kind === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(val)) t.set(val, []);
  t.get(val).push(i);
});

/* ---------- проход ---------- */
const files = fs.readdirSync(domDir).filter((f) => f.endsWith(".html")).sort();
const streams = WIDTHS.map((w) => fs.createWriteStream(`${outPrefix}.${w}.jsonl`));
const meta = { widths: WIDTHS, pages: [], elements: 0 };

let totalMatchCalls = 0;
const seen = new Int32Array(rules.length).fill(-1);
let stamp = 0;

for (const file of files) {
  const page = file.replace(/\.html$/, "");
  const html = fs.readFileSync(path.join(domDir, file), "utf8");
  const bodyCls = /dashboard-shell/.test(html) ? ' class="dashboard-body"' : "";
  const dom = new JSDOM(`<!doctype html><html><body${bodyCls}>${html}</body></html>`);
  const doc = dom.window.document;
  const els = doc.querySelectorAll("*");
  meta.pages.push({ page, count: els.length });
  meta.elements += els.length;

  const lines = WIDTHS.map(() => []);

  els.forEach((el, i) => {
    // --- собрать уникальных кандидатов ---
    stamp++;
    const cand = [];
    const push = (arr) => {
      if (!arr) return;
      for (const ri of arr) if (seen[ri] !== stamp) { seen[ri] = stamp; cand.push(ri); }
    };
    if (el.id) push(byId.get(el.id));
    const cl = el.classList;
    for (let c = 0; c < cl.length; c++) push(byClass.get(cl[c]));
    push(byTag.get(el.tagName.toLowerCase()));
    push(universal);
    if (!cand.length) return;

    // --- матчинг ОДИН раз ---
    const hit = [];
    for (const ri of cand) {
      totalMatchCalls++;
      let m = false;
      try { m = el.matches(rules[ri].sel); } catch { m = false; }
      if (m) hit.push(ri);
    }
    if (!hit.length) return;
    hit.sort((a, b) => a - b);

    const cls = typeof el.className === "string" ? el.className.trim() : "";
    const fp = el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).join(".") : "");

    // --- победитель по каждой ширине ---
    // Порядок каскада: важность → слой → специфичность → порядок.
    for (let wi = 0; wi < WIDTHS.length; wi++) {
      const win = new Map();
      for (const ri of hit) {
        if (!mediaOk[ri][wi]) continue;
        const r = rules[ri];
        const lay = layerRank(r.layer);
        for (const d of r.d) {
          const prop = d[0], val = d[1], imp = d[2];
          const cur = win.get(prop);
          if (!cur) { win.set(prop, [imp, lay, r.spec, r.ord, val, ri]); continue; }
          if (imp !== cur[0]) { if (imp > cur[0]) win.set(prop, [imp, lay, r.spec, r.ord, val, ri]); continue; }
          if (lay !== cur[1]) { if (lay > cur[1]) win.set(prop, [imp, lay, r.spec, r.ord, val, ri]); continue; }
          const cs = cur[2], rs = r.spec;
          const cmp = rs[0] - cs[0] || rs[1] - cs[1] || rs[2] - cs[2] || r.ord - cur[3];
          if (cmp >= 0) win.set(prop, [imp, lay, r.spec, r.ord, val, ri]);
        }
      }
      if (!win.size) continue;
      const o = {};
      for (const [p, v] of win) o[p] = v[4];
      lines[wi].push(JSON.stringify({ p: page, i, f: fp, s: o }));
    }
  });

  for (let wi = 0; wi < WIDTHS.length; wi++) {
    if (lines[wi].length) streams[wi].write(lines[wi].join("\n") + "\n");
  }
  dom.window.close();
  process.stderr.write(`  ${page}: ${els.length} эл.\n`);
}

for (const s of streams) s.end();
fs.writeFileSync(`${outPrefix}.meta.json`, JSON.stringify(meta, null, 1));
process.stderr.write(`элементов=${meta.elements} вызовов matches=${totalMatchCalls}\n`);
