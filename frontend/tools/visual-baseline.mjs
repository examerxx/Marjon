/**
 * Снимок и проверка внешнего вида без скриншотов.
 *
 * Считает эффективный стиль каждого элемента (полный каскад: важность, слой,
 * специфичность, порядок) и сохраняет хеш на элемент. Базовый снимок лежит в
 * репозитории и весит ~150 КБ вместо десятков мегабайт значений.
 *
 * При расхождении показывает, на каких страницах и элементах поехало —
 * подробности смотреть через tools/explain.mjs.
 *
 *   node tools/visual-baseline.mjs snapshot <rules.json> <domDir> <out.json> [widths]
 *   node tools/visual-baseline.mjs check    <rules.json> <domDir> <baseline.json> [widths]
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , mode, rulesPath, domDir, filePath, widthsArg] = process.argv;
const WIDTHS = (widthsArg || "390,768,1280,1440").split(",").map(Number);

if (!["snapshot", "check"].includes(mode)) {
  console.error("режим: snapshot | check");
  process.exit(2);
}

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

/* ---------- каскад ---------- */
const LAYER_ORDER = ["marjon-base", "marjon-important"];
const rank = (n) => (!n ? LAYER_ORDER.length : (LAYER_ORDER.indexOf(n) === -1 ? 0 : LAYER_ORDER.indexOf(n)));

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

/* FNV-1a, 32 бита — достаточно: коллизия меняет вердикт лишь при точном совпадении хеша */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/* ---------- проход по страницам ---------- */
const seen = new Int32Array(rules.length).fill(-1);
let stamp = 0;

function pageHashes(html) {
  const cls = /dashboard-shell/.test(html) ? ' class="dashboard-body"' : "";
  const dom = new JSDOM(`<!doctype html><html><body${cls}>${html}</body></html>`);
  const els = dom.window.document.querySelectorAll("*");
  const buf = Buffer.alloc(els.length * 4);
  const fps = [];

  els.forEach((el, i) => {
    const c = typeof el.className === "string" ? el.className.trim() : "";
    fps.push(el.tagName.toLowerCase() + (c ? "." + c.split(/\s+/).join(".") : ""));

    stamp++;
    const cand = [];
    const push = (arr) => { if (arr) for (const ri of arr) if (seen[ri] !== stamp) { seen[ri] = stamp; cand.push(ri); } };
    if (el.id) push(byId.get(el.id));
    for (const k of el.classList) push(byClass.get(k));
    push(byTag.get(el.tagName.toLowerCase()));
    push(universal);

    const hit = [];
    for (const ri of cand) {
      let m = false;
      try { m = el.matches(rules[ri].sel); } catch { m = false; }
      if (m) hit.push(ri);
    }

    let acc = "";
    for (let wi = 0; wi < WIDTHS.length; wi++) {
      const win = new Map();
      for (const ri of hit) {
        if (!mediaOk[ri][wi]) continue;
        const r = rules[ri];
        const lay = rank(r.layer);
        for (const d of r.d) {
          const cur = win.get(d[0]);
          if (!cur) { win.set(d[0], [d[2], lay, r.spec, r.ord, d[1]]); continue; }
          if (d[2] !== cur[0]) { if (d[2] > cur[0]) win.set(d[0], [d[2], lay, r.spec, r.ord, d[1]]); continue; }
          if (lay !== cur[1]) { if (lay > cur[1]) win.set(d[0], [d[2], lay, r.spec, r.ord, d[1]]); continue; }
          const cs = cur[2], rs = r.spec;
          if ((rs[0] - cs[0] || rs[1] - cs[1] || rs[2] - cs[2] || r.ord - cur[3]) >= 0)
            win.set(d[0], [d[2], lay, r.spec, r.ord, d[1]]);
        }
      }
      acc += "|" + WIDTHS[wi] + "|" + [...win.entries()].sort().map(([p, v]) => p + ":" + v[4]).join(";");
    }
    buf.writeUInt32LE(hash(acc), i * 4);
  });

  dom.window.close();
  return { hashes: buf.toString("base64"), count: els.length, fps };
}

const files = fs.readdirSync(domDir).filter((f) => f.endsWith(".html")).sort();
const current = {};
const fingerprints = {};
for (const f of files) {
  const page = f.replace(/\.html$/, "");
  const r = pageHashes(fs.readFileSync(path.join(domDir, f), "utf8"));
  current[page] = { h: r.hashes, n: r.count };
  fingerprints[page] = r.fps;
}

/* ---------- режимы ---------- */
if (mode === "snapshot") {
  fs.writeFileSync(filePath, JSON.stringify({ widths: WIDTHS, pages: current }, null, 0));
  const total = Object.values(current).reduce((a, p) => a + p.n, 0);
  console.log(`снимок: ${files.length} страниц, ${total} элементов, ${(fs.statSync(filePath).size / 1024) | 0} КБ`);
  console.log(`-> ${filePath}`);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(filePath, "utf8"));
if (base.widths.join(",") !== WIDTHS.join(",")) {
  console.error(`Ширины снимка (${base.widths}) не совпадают с проверяемыми (${WIDTHS}).`);
  process.exit(2);
}

let changed = 0, structural = 0, newPages = 0, gonePages = 0;
const report = [];

for (const page of Object.keys(current)) {
  const b = base.pages[page];
  if (!b) { newPages++; report.push(`  + страница ${page} — новая, в снимке её нет`); continue; }
  if (b.n !== current[page].n) {
    structural++;
    report.push(`  ~ ${page}: изменилась разметка (${b.n} -> ${current[page].n} элементов), стили не сверялись`);
    continue;
  }
  const oldBuf = Buffer.from(b.h, "base64");
  const newBuf = Buffer.from(current[page].h, "base64");
  const diffs = [];
  for (let i = 0; i < b.n; i++) {
    if (oldBuf.readUInt32LE(i * 4) !== newBuf.readUInt32LE(i * 4)) diffs.push(i);
  }
  if (diffs.length) {
    changed += diffs.length;
    const sample = diffs.slice(0, 5).map((i) => `${fingerprints[page][i].slice(0, 52)} [#${i}]`);
    report.push(`  ✗ ${page}: ${diffs.length} элементов`);
    for (const s of sample) report.push(`        ${s}`);
    if (diffs.length > 5) report.push(`        … ещё ${diffs.length - 5}`);
  }
}
for (const page of Object.keys(base.pages)) if (!current[page]) { gonePages++; report.push(`  - страница ${page} пропала`); }

console.log(`страниц проверено: ${Object.keys(current).length}, ширин: ${WIDTHS.join(", ")}`);
if (!changed && !structural && !newPages && !gonePages) {
  console.log("\nВНЕШНИЙ ВИД НЕ ИЗМЕНИЛСЯ");
  process.exit(0);
}
console.log("");
report.forEach((l) => console.log(l));
console.log(`\nизменилось элементов: ${changed}`);
console.log("\nЕсли изменение намеренное — обнови снимок в этом же PR:");
console.log("    npm run css:baseline");
console.log("Разобраться, что именно поехало:");
console.log("    node tools/explain.mjs .cssaudit/rules-kafe.json .cssaudit/dom <страница> <отпечаток> <свойство>");
process.exit(1);
