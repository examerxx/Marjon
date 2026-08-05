/**
 * Ищет «мёртвый» CSS: декларации, которые годами были замаскированы чужим
 * !important, а после чистки всплыли и портят картинку.
 *
 * Критерий удаления строгий: декларация удаляется, только если ВО ВСЕХ местах,
 * где она сейчас выигрывает каскад, значение расходится с эталоном. Если
 * хоть где-то она даёт правильный результат — не трогаем.
 *
 *   node tools/find-dead.mjs <rules.json> <domDir> <before.jsonl> <out.json> [width]
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { JSDOM } from "jsdom";
import { loadTokens, normalize } from "./normval.mjs";
const TOK = loadTokens();

const [, , rulesPath, domDir, beforePath, outPath, widthArg] = process.argv;
const WIDTH = Number(widthArg || 1280);

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

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
const active = rules.map((r) => mediaApplies(r.ctx, WIDTH));

const byId = new Map(), byClass = new Map(), byTag = new Map(); const universal = [];
rules.forEach((r, i) => {
  const [k, v] = r.key;
  const t = k === "id" ? byId : k === "class" ? byClass : k === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(v)) t.set(v, []);
  t.get(v).push(i);
});

/* эталон */
const before = new Map();
{
  const rl = readline.createInterface({ input: fs.createReadStream(beforePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    before.set(`${o.p}#${o.i}`, o.s);
  }
}

/* статистика по каждой декларации: сколько раз выиграла верно / неверно */
const stat = new Map();   // `${ruleIdx}|${prop}` -> {good, bad, sel, file, line, val}
const seen = new Int32Array(rules.length).fill(-1);
let stamp = 0;

for (const f of fs.readdirSync(domDir).filter((x) => x.endsWith(".html")).sort()) {
  const page = f.replace(/\.html$/, "");
  const __h = fs.readFileSync(path.join(domDir, f), "utf8");
  const __cls = /dashboard-shell/.test(__h) ? " class=\"dashboard-body\"" : "";
  const dom = new JSDOM(`<!doctype html><html><body${__cls}>${__h}</body></html>`);
  const els = dom.window.document.querySelectorAll("*");
  els.forEach((el, i) => {
    const bs = before.get(`${page}#${i}`);
    if (!bs) return;
    stamp++;
    const cand = [];
    const push = (arr) => { if (arr) for (const ri of arr) if (seen[ri] !== stamp) { seen[ri] = stamp; cand.push(ri); } };
    if (el.id) push(byId.get(el.id));
    for (const c of el.classList) push(byClass.get(c));
    push(byTag.get(el.tagName.toLowerCase()));
    push(universal);

    const win = new Map();
    for (const ri of cand) {
      if (!active[ri]) continue;
      let m = false;
      try { m = el.matches(rules[ri].sel); } catch { m = false; }
      if (!m) continue;
      const r = rules[ri];
      for (const d of r.d) {
        const prop = d[0];
        const cur = win.get(prop);
        if (!cur) { win.set(prop, { spec: r.spec, ord: r.ord, val: d[1], ri }); continue; }
        const cs = cur.spec, rs = r.spec;
        if ((rs[0] - cs[0] || rs[1] - cs[1] || rs[2] - cs[2] || r.ord - cur.ord) >= 0)
          win.set(prop, { spec: r.spec, ord: r.ord, val: d[1], ri });
      }
    }
    for (const [prop, w] of win) {
      const expected = bs[prop];
      if (expected === undefined) continue;      // раньше свойство не задавалось — не судим
      const key = `${w.ri}|${prop}`;
      if (!stat.has(key)) {
        const r = rules[w.ri];
        stat.set(key, { good: 0, bad: 0, sel: r.sel, file: r.file, line: r.line, val: w.val, ctx: r.ctx });
      }
      const s = stat.get(key);
      if (normalize(prop, w.val, TOK) === normalize(prop, expected, TOK)) s.good++; else s.bad++;
    }
  });
  dom.window.close();
}

const dead = [];
for (const [key, s] of stat) {
  if (s.bad > 0 && s.good === 0) dead.push({ ...s, prop: key.split("|")[1], hits: s.bad });
}
dead.sort((a, b) => b.hits - a.hits);

fs.writeFileSync(outPath, JSON.stringify({ width: WIDTH, total: stat.size, dead }, null, 1));
console.log(`деклараций-победителей рассмотрено: ${stat.size}`);
console.log(`МЁРТВЫХ (всегда портят, нигде не помогают): ${dead.length}`);
const byFile = new Map();
for (const d of dead) byFile.set(d.file, (byFile.get(d.file) || 0) + 1);
for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${f}`);
console.log(`-> ${outPath}`);
