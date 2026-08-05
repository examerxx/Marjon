/**
 * Строит дедуплицированный список работ: уникальные (отпечаток, свойство) с
 * потерянным или изменившимся значением. Это спецификация для переписывания.
 *
 *   node tools/worklist.mjs <beforePrefix> <afterPrefix> <width> <out.json>
 */
import fs from "node:fs";
import readline from "node:readline";
import { loadTokens, normalize } from "./normval.mjs";
const TOK = loadTokens();

const [, , beforePrefix, afterPrefix, width, outPath] = process.argv;

const NOISE = new Set(["-webkit-font-smoothing", "-moz-osx-font-smoothing", "text-rendering"]);
// Свойства, потеря которых визуально безопасна (анимации/служебное)
const SOFT = new Set(["transition-property", "transition-duration", "transition-timing-function",
  "transition-delay", "transition", "animation", "animation-name", "animation-duration",
  "will-change", "-webkit-tap-highlight-color", "scrollbar-width", "scrollbar-color",
  "-webkit-appearance", "appearance", "-moz-appearance", "outline-offset", "cursor",
  "user-select", "-webkit-user-select", "text-rendering", "backface-visibility"]);

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

// distinct: fingerprint -> prop -> {before, after, pages:Set, n}
const dist = new Map();

for (const [k, b] of before) {
  const a = after.get(k);
  const bs = b.s, as = a?.s || {};
  const fp = b.f;
  const page = k.split("#")[0];
  for (const p of Object.keys(bs)) {
    if (NOISE.has(p)) continue;
    if (normalize(p, bs[p], TOK) === normalize(p, as[p], TOK)) continue;
    if (!dist.has(fp)) dist.set(fp, new Map());
    const m = dist.get(fp);
    if (!m.has(p)) m.set(p, { before: bs[p], after: as[p] ?? null, pages: new Set(), n: 0 });
    const e = m.get(p);
    e.pages.add(page);
    e.n++;
  }
}

/** Компонент = первый класс отпечатка, приведённый к «семье». */
function familyOf(fp) {
  const cls = fp.split(".").slice(1).filter(Boolean);
  if (!cls.length) return "(без класса) " + fp.split(".")[0];
  for (const c of cls) {
    const m = c.match(/^(sidebar|topbar|dashboard|kpi|premium|warehouse|nomenclature|dish|menu|order|report|finance|staff|settings|receipt|waiter|kitchen|analytics|chart|modal|drawer|table|form|btn|button|input|select|badge|card|brand|support|mj|z-report|top-dish|recent|period|global|demo|loader|marjon|pos|auth|login)/i);
    if (m) return m[1].toLowerCase();
  }
  return cls[0].split("-").slice(0, 2).join("-");
}

const rows = [];
let totalPairs = 0, hardPairs = 0;
for (const [fp, m] of dist) {
  for (const [prop, e] of m) {
    totalPairs++;
    const hard = !SOFT.has(prop);
    if (hard) hardPairs++;
    rows.push({
      fp, prop, before: e.before, after: e.after,
      lost: e.after === null, hard,
      pages: e.pages.size, elems: e.n,
      family: familyOf(fp),
    });
  }
}

// сортировка: сначала «жёсткие» свойства, потом по охвату
rows.sort((x, y) => (y.hard - x.hard) || (y.elems - x.elems) || x.fp.localeCompare(y.fp));

const byFamily = new Map();
for (const r of rows) {
  if (!byFamily.has(r.family)) byFamily.set(r.family, { pairs: 0, hard: 0, fps: new Set(), props: new Set() });
  const e = byFamily.get(r.family);
  e.pairs++; if (r.hard) e.hard++;
  e.fps.add(r.fp); e.props.add(r.prop);
}

const summary = [...byFamily.entries()]
  .map(([k, v]) => ({ family: k, pairs: v.pairs, hard: v.hard, fingerprints: v.fps.size, props: v.props.size }))
  .sort((a, b) => b.hard - a.hard);

fs.writeFileSync(outPath, JSON.stringify({
  width: Number(width),
  totals: { fingerprints: dist.size, pairs: totalPairs, hardPairs },
  summary, rows,
}, null, 1));

console.log(`\n==== ${width}px: дедуплицированный список работ ====`);
console.log(`уникальных отпечатков затронуто : ${dist.size}`);
console.log(`уникальных пар (отпечаток,свойство): ${totalPairs}`);
console.log(`из них значимых (не анимации)   : ${hardPairs}`);
console.log(`\n${"семья".padEnd(16)}${"значимых".padStart(9)}${"всего".padStart(8)}${"отпечатков".padStart(12)}`);
for (const s of summary.slice(0, 40)) {
  console.log(`${s.family.padEnd(16)}${String(s.hard).padStart(9)}${String(s.pairs).padStart(8)}${String(s.fingerprints).padStart(12)}`);
}
console.log(`\nполный список: ${outPath}`);
