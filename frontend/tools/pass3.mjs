/**
 * Финальный проход: закрывает остаток расхождений, поднимая специфичность
 * ровно настолько, чтобы правило выигрывало честно (повтор последнего класса),
 * а не силой !important.
 *
 *   node tools/pass3.mjs <rules.json> <domDir> <before.jsonl> <ledger.json> <out.css> [width]
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { JSDOM } from "jsdom";
import { loadTokens, normalize } from "./normval.mjs";

const TOK = loadTokens();
const [, , rulesPath, domDir, beforePath, ledgerPath, outCss, widthArg] = process.argv;
const WIDTH = Number(widthArg || 1280);

const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

const SKIP_PROPS = new Set(["transform", "scale", "translate", "rotate", "filter", "will-change",
  "backface-visibility", "perspective", "transition", "animation", "-webkit-tap-highlight-color",
  "text-rendering", "-webkit-font-smoothing", "-moz-osx-font-smoothing", "transition-property",
  "transition-duration", "transition-timing-function", "transition-delay"]);

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

/* спецификация селектора (грубая, как в cssx) */
function spec(sel) {
  const s = sel.replace(/\s+/g, " ").trim();
  const a = (s.match(/#[\w-]+/g) || []).length;
  const s2 = s.replace(/:(?:where)\([^()]*\)/g, " ").replace(/:(?:not|is|has|matches|any)\(([^()]*)\)/g, " $1 ");
  const b = (s2.match(/\.[\w-]+/g) || []).length + (s2.match(/\[[^\]]*\]/g) || []).length
    + (s2.replace(/::[\w-]+/g, "").match(/:(?!:)[\w-]+/g) || []).length;
  const c = (s2.match(/::[\w-]+/g) || []).length
    + (s2.replace(/::?[\w-]+(\([^()]*\))?/g, " ").replace(/\.[\w-]+|#[\w-]+|\[[^\]]*\]/g, " ")
        .match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
  return [a, b, c];
}
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/* эталон */
const before = new Map();
{
  const rl = readline.createInterface({ input: fs.createReadStream(beforePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    before.set(`${o.p}#${o.i}`, o);
  }
}

/* индекс кандидатов */
const byId = new Map(), byClass = new Map(), byTag = new Map(); const universal = [];
rules.forEach((r, i) => {
  const [k, v] = r.key;
  const t = k === "id" ? byId : k === "class" ? byClass : k === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(v)) t.set(v, []);
  t.get(v).push(i);
});

/* реестр: селектор -> prop -> значение (последнее) */
const ledgerBySel = new Map();
for (const e of ledger) {
  for (const raw of e.sel.split(",")) {
    const s = raw.trim();
    if (!s) continue;
    const key = `${e.ctx}||${s}`;
    if (!ledgerBySel.has(key)) ledgerBySel.set(key, new Map());
    ledgerBySel.get(key).set(e.prop, e.val);
  }
}

/* нужные добавки: `${ctx}||${sel}||${boost}` -> Map(prop->val) */
const out = new Map();
const seen = new Int32Array(rules.length).fill(-1);
let stamp = 0, gaps = 0, fixed = 0, unmatched = 0;
const unresolved = [];

for (const f of fs.readdirSync(domDir).filter((x) => x.endsWith(".html")).sort()) {
  const page = f.replace(/\.html$/, "");
  const __h = fs.readFileSync(path.join(domDir, f), "utf8");
  const __cls = /dashboard-shell/.test(__h) ? " class=\"dashboard-body\"" : "";
  const dom = new JSDOM(`<!doctype html><html><body${__cls}>${__h}</body></html>`);
  const els = dom.window.document.querySelectorAll("*");
  els.forEach((el, i) => {
    const rec = before.get(`${page}#${i}`);
    if (!rec) return;
    stamp++;
    const cand = [];
    const push = (arr) => { if (arr) for (const ri of arr) if (seen[ri] !== stamp) { seen[ri] = stamp; cand.push(ri); } };
    if (el.id) push(byId.get(el.id));
    for (const c of el.classList) push(byClass.get(c));
    push(byTag.get(el.tagName.toLowerCase()));
    push(universal);

    const matched = [];
    const win = new Map();
    for (const ri of cand) {
      if (!active[ri]) continue;
      let m = false;
      try { m = el.matches(rules[ri].sel); } catch { m = false; }
      if (!m) continue;
      matched.push(ri);
      const r = rules[ri];
      for (const d of r.d) {
        const cur = win.get(d[0]);
        if (!cur || (r.spec[0] - cur.spec[0] || r.spec[1] - cur.spec[1] || r.spec[2] - cur.spec[2] || r.ord - cur.ord) >= 0)
          win.set(d[0], { spec: r.spec, ord: r.ord, val: d[1] });
      }
    }

    for (const [prop, want] of Object.entries(rec.s)) {
      if (SKIP_PROPS.has(prop)) continue;
      const cur = win.get(prop);
      if (cur && normalize(prop, cur.val, TOK) === normalize(prop, want, TOK)) continue;
      gaps++;

      // найти исходный селектор из реестра, который даёт нужное значение
      let best = null;
      for (const ri of matched) {
        const r = rules[ri];
        const lk = ledgerBySel.get(`${r.ctx}||${r.sel}`);
        if (!lk || !lk.has(prop)) continue;
        if (normalize(prop, lk.get(prop), TOK) !== normalize(prop, want, TOK)) continue;
        if (!best || cmp(r.spec, best.spec) >= 0) best = { sel: r.sel, ctx: r.ctx, spec: r.spec, val: lk.get(prop) };
      }
      // запасной вариант: любой реестровый селектор, матчащий элемент
      if (!best) {
        for (const [key, props] of ledgerBySel) {
          if (!props.has(prop)) continue;
          if (normalize(prop, props.get(prop), TOK) !== normalize(prop, want, TOK)) continue;
          const [ctx, sel] = key.split("||");
          if (ctx && !mediaApplies(ctx, WIDTH)) continue;
          let m = false;
          try { m = el.matches(sel); } catch { m = false; }
          if (!m) continue;
          const sp = spec(sel);
          if (!best || cmp(sp, best.spec) >= 0) best = { sel, ctx, spec: sp, val: props.get(prop) };
        }
      }
      if (!best) { unmatched++; if (unresolved.length < 40) unresolved.push({ page, fp: rec.f, prop, want }); continue; }

      // сколько классов добавить, чтобы обойти текущего победителя
      let boost = 0;
      if (cur) {
        const need = cmp(cur.spec, best.spec);
        if (need >= 0) boost = (cur.spec[1] - best.spec[1]) + 1;
        if (boost < 0) boost = 1;
      }
      const key = `${best.ctx}||${best.sel}||${boost}`;
      if (!out.has(key)) out.set(key, new Map());
      out.get(key).set(prop, best.val);
      fixed++;
    }
  });
  dom.window.close();
}

/* последний класс селектора — для повторения */
function boostSel(sel, n) {
  if (n <= 0) return sel;
  const m = [...sel.matchAll(/\.[\w-]+/g)];
  if (!m) return sel;
  const last = m[m.length - 1];
  if (!last) return sel;
  return sel + last[0].repeat(n);
}

let css = `\n/* ═══ ПРОХОД 3: добор остатка через честную специфичность ═══ */\n`;
const byCtx = new Map();
for (const [key, props] of out) {
  const [ctx, sel, boost] = key.split("||");
  if (!byCtx.has(ctx)) byCtx.set(ctx, []);
  byCtx.get(ctx).push({ sel: boostSel(sel, Number(boost)), props });
}
let ndecl = 0;
for (const [ctx, list] of byCtx) {
  const ind = ctx ? "  " : "";
  if (ctx) css += `${ctx} {\n`;
  for (const g of list) {
    css += `${ind}${g.sel} {\n`;
    for (const [p, v] of g.props) { css += `${ind}  ${p}: ${v};\n`; ndecl++; }
    css += `${ind}}\n`;
  }
  if (ctx) css += `}\n`;
}
fs.writeFileSync(outCss, css);

console.log(`расхождений просмотрено : ${gaps}`);
console.log(`закрыто правилами       : ${fixed}`);
console.log(`не нашлось источника    : ${unmatched}`);
console.log(`правил / деклараций     : ${out.size} / ${ndecl}`);
if (unresolved.length) {
  console.log(`\nбез источника (первые 12):`);
  for (const u of unresolved.slice(0, 12)) console.log(`   ${u.fp.slice(0, 46).padEnd(46)} ${u.prop.padEnd(16)} = ${String(u.want).slice(0, 28)}`);
}
console.log(`-> ${outCss}`);
