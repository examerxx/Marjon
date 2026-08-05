/**
 * Сравнить два снапшота каскада (JSONL) и выдать отчёт о потерях.
 *
 *   node tools/diff-snap.mjs <beforePrefix> <afterPrefix> <width> <out.json> [--top=N]
 *
 * Классификация по каждому (элемент, свойство):
 *   LOST     — значение было, стало отсутствовать вовсе
 *   CHANGED  — значение изменилось
 *   ADDED    — появилось (не должно происходить при удалении)
 */
import fs from "node:fs";
import readline from "node:readline";

const [, , beforePrefix, afterPrefix, width, outPath] = process.argv;
const topN = Number((process.argv.find((a) => a.startsWith("--top=")) || "--top=60").split("=")[1]);

// свойства, по которым расхождение почти всегда безобидно
const NOISE = new Set(["-webkit-font-smoothing", "-moz-osx-font-smoothing", "text-rendering"]);

async function load(file) {
  const map = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    map.set(`${o.p}#${o.i}`, o);
  }
  return map;
}

const before = await load(`${beforePrefix}.${width}.jsonl`);
const after = await load(`${afterPrefix}.${width}.jsonl`);

const lost = [], changed = [], added = [];
const byProp = new Map();
const byComponent = new Map();
const byFingerprint = new Map();

function bump(map, key, rec) {
  if (!map.has(key)) map.set(key, { n: 0, samples: [] });
  const e = map.get(key);
  e.n++;
  if (e.samples.length < 4) e.samples.push(rec);
}

/** Грубая группировка по компоненту: первый значимый класс. */
function componentOf(fp) {
  const cls = fp.split(".").slice(1);
  if (!cls.length) return `<${fp}>`;
  const c = cls[0];
  const m = c.match(/^([a-z0-9]+(?:-[a-z0-9]+)?)/i);
  return m ? m[1] : c;
}

const keys = new Set([...before.keys(), ...after.keys()]);
for (const k of keys) {
  const b = before.get(k), a = after.get(k);
  const bs = b?.s || {}, as = a?.s || {};
  const fp = b?.f || a?.f || "";
  const props = new Set([...Object.keys(bs), ...Object.keys(as)]);
  for (const p of props) {
    if (NOISE.has(p)) continue;
    const bv = bs[p], av = as[p];
    if (bv === av) continue;
    const rec = { k, fp, prop: p, before: bv ?? null, after: av ?? null };
    if (bv !== undefined && av === undefined) { lost.push(rec); }
    else if (bv === undefined) { added.push(rec); continue; }
    else { changed.push(rec); }
    bump(byProp, p, rec);
    bump(byComponent, componentOf(fp), rec);
    bump(byFingerprint, fp, rec);
  }
}

const sortMap = (m) => [...m.entries()].sort((x, y) => y[1].n - x[1].n);

const report = {
  width: Number(width),
  totals: {
    elementsBefore: before.size,
    elementsAfter: after.size,
    lost: lost.length,
    changed: changed.length,
    added: added.length,
  },
  byComponent: sortMap(byComponent).slice(0, 400).map(([k, v]) => ({ component: k, n: v.n, samples: v.samples })),
  byProp: sortMap(byProp).slice(0, 200).map(([k, v]) => ({ prop: k, n: v.n, samples: v.samples })),
  byFingerprint: sortMap(byFingerprint).slice(0, 800).map(([k, v]) => ({ fp: k, n: v.n, samples: v.samples })),
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 1));

console.log(`\n==== ширина ${width}px ====`);
console.log(`элементов: было ${before.size}, стало ${after.size}`);
console.log(`ПОТЕРЯНО свойств: ${lost.length}   ИЗМЕНЕНО: ${changed.length}   ДОБАВЛЕНО: ${added.length}`);
console.log(`\n--- топ компонентов по количеству расхождений ---`);
for (const [k, v] of sortMap(byComponent).slice(0, topN)) {
  console.log(`  ${String(v.n).padStart(6)}  ${k}`);
}
console.log(`\n--- топ свойств ---`);
for (const [k, v] of sortMap(byProp).slice(0, 30)) {
  console.log(`  ${String(v.n).padStart(6)}  ${k}`);
}
console.log(`\nполный отчёт: ${outPath}`);
