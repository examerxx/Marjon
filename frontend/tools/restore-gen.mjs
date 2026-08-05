/**
 * Генератор восстановительного CSS.
 *
 * Берёт реестр удалённых деклараций, оставляет только те, что реально дают
 * потерю по снапшоту, отбрасывает оборонительный шум, схлопывает дубли и
 * выдаёт сгруппированный черновик для ручной доводки.
 *
 * Оптимизация: селекторы проверяются не по всем 28k элементов, а по нескольким
 * представителям каждого затронутого отпечатка — с сохранением реальных
 * предков, чтобы вложенные селекторы матчились честно.
 *
 *   node tools/restore-gen.mjs <ledger.json> <domDir> <work-*.json,...> <out.css> <out.json>
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , ledgerPath, domDir, workPaths, outCss, outJson] = process.argv;
const REPS_PER_FP = Number((process.argv.find((a) => a.startsWith("--reps=")) || "--reps=3").split("=")[1]);

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));

/* ---- множество потерь: fingerprint -> Set(prop) ---- */
const lostByFp = new Map();
for (const wp of workPaths.split(",")) {
  const w = JSON.parse(fs.readFileSync(wp, "utf8"));
  for (const r of w.rows) {
    if (!r.hard) continue;
    if (!lostByFp.has(r.fp)) lostByFp.set(r.fp, new Set());
    lostByFp.get(r.fp).add(r.prop);
  }
}
console.log(`затронутых отпечатков: ${lostByFp.size}`);

/* ---- «оборонительные» свойства и значения ---- */
const NOISE_PROPS = new Set([
  "transform", "scale", "translate", "rotate", "filter", "will-change",
  "backface-visibility", "perspective", "transition", "transition-property",
  "transition-duration", "transition-timing-function", "transition-delay",
  "animation", "animation-name", "-webkit-tap-highlight-color",
  "text-rendering", "-webkit-font-smoothing", "-moz-osx-font-smoothing",
]);
const NOISE_VALUES = new Set(["none", "initial", "unset", "revert", "auto", "normal"]);

/* ---- представители отпечатков (с живыми предками) ---- */
const reps = [];                 // {el, fp}
const repCount = new Map();
const keepDoms = [];             // держим документы живыми
for (const f of fs.readdirSync(domDir).filter((x) => x.endsWith(".html")).sort()) {
  const dom = new JSDOM(`<!doctype html><html><body>${fs.readFileSync(path.join(domDir, f), "utf8")}</body></html>`);
  let used = false;
  for (const el of dom.window.document.querySelectorAll("*")) {
    const c = typeof el.className === "string" ? el.className.trim() : "";
    const fp = el.tagName.toLowerCase() + (c ? "." + c.split(/\s+/).join(".") : "");
    if (!lostByFp.has(fp)) continue;
    const n = repCount.get(fp) || 0;
    if (n >= REPS_PER_FP) continue;
    repCount.set(fp, n + 1);
    reps.push({ el, fp });
    used = true;
  }
  if (used) keepDoms.push(dom);
}
console.log(`представителей: ${reps.length} (покрыто отпечатков ${repCount.size})`);

/* ---- индекс представителей по классам/тегам ---- */
const repsByClass = new Map(), repsByTag = new Map(), repsById = new Map();
reps.forEach((r, i) => {
  const el = r.el;
  if (el.id) {
    if (!repsById.has(el.id)) repsById.set(el.id, []);
    repsById.get(el.id).push(i);
  }
  for (const c of el.classList) {
    if (!repsByClass.has(c)) repsByClass.set(c, []);
    repsByClass.get(c).push(i);
  }
  const t = el.tagName.toLowerCase();
  if (!repsByTag.has(t)) repsByTag.set(t, []);
  repsByTag.get(t).push(i);
});

/** Правый ключ селектора — по нему берём кандидатов. */
function rightKey(sel) {
  let s = sel.replace(/\s+/g, " ").trim();
  s = s.replace(/::[\w-]+/g, "");
  const parts = s.split(/[ >+~]/).filter(Boolean);
  const last = parts[parts.length - 1] || s;
  const id = last.match(/#([\w-]+)/);
  if (id) return ["id", id[1]];
  const outside = last.replace(/:(?:not|is|has|where|matches|any)\([^()]*\)/g, "");
  const cls = [...outside.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (cls.length) return ["class", cls[cls.length - 1]];
  const cls2 = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (cls2.length) return ["class", cls2[cls2.length - 1]];
  const tag = last.match(/^([a-zA-Z][\w-]*)/);
  if (tag) return ["tag", tag[1].toLowerCase()];
  return ["*", "*"];
}

const matchCache = new Map();
let matchCalls = 0;
function fpsMatching(sel) {
  if (matchCache.has(sel)) return matchCache.get(sel);
  const [kind, val] = rightKey(sel);
  let cand;
  if (kind === "id") cand = repsById.get(val) || [];
  else if (kind === "class") cand = repsByClass.get(val) || [];
  else if (kind === "tag") cand = repsByTag.get(val) || [];
  else cand = reps.map((_, i) => i);
  const out = new Set();
  for (const i of cand) {
    matchCalls++;
    let m = false;
    try { m = reps[i].el.matches(sel); } catch { m = false; }
    if (m) out.add(reps[i].fp);
  }
  const arr = [...out];
  matchCache.set(sel, arr);
  return arr;
}

function splitSel(sel) {
  const out = []; let buf = "", d = 0;
  for (const ch of sel) {
    if (ch === "(" || ch === "[") d++;
    else if (ch === ")" || ch === "]") d--;
    if (ch === "," && d === 0) { out.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* ---- фильтрация реестра ---- */
const kept = new Map();
let considered = 0, keptCount = 0;

ledger.forEach((e, order) => {
  considered++;
  if (NOISE_PROPS.has(e.prop)) return;
  if (NOISE_VALUES.has(String(e.val).trim().toLowerCase())) return;

  for (const sel of splitSel(e.sel)) {
    if (!sel) continue;
    let relevant = false, hits = 0;
    for (const fp of fpsMatching(sel)) {
      const s = lostByFp.get(fp);
      if (s && s.has(e.prop)) { relevant = true; hits++; }
    }
    if (!relevant) continue;
    const key = `${e.ctx}||${sel}`;
    if (!kept.has(key)) kept.set(key, new Map());
    kept.get(key).set(e.prop, { val: e.val, order, hits, file: e.file, line: e.line });
    keptCount++;
  }
});

/* ---- hex -> токены ---- */
const TOKENS = {
  "#1db5b5": "var(--color-brand)", "#22d3ee": "var(--color-brand-hover)",
  "#0fa3a3": "var(--color-brand-dark)", "#ecfeff": "var(--teal-50)",
  "#cffafe": "var(--teal-100)", "#a5f3fc": "var(--teal-200)",
  "#67e8f9": "var(--teal-300)", "#0e8080": "var(--teal-700)",
  "#071428": "var(--neutral-950)", "#0b1f3f": "var(--neutral-900)",
  "#162840": "var(--neutral-800)", "#243a56": "var(--neutral-700)",
  "#374f6e": "var(--neutral-600)", "#536d8e": "var(--neutral-500)",
  "#7a94b4": "var(--neutral-400)", "#a8b9d0": "var(--neutral-300)",
  "#d0d9e8": "var(--neutral-200)", "#e8edf6": "var(--neutral-100)",
  "#f4f7fc": "var(--neutral-50)", "#ffffff": "var(--neutral-0)", "#fff": "var(--neutral-0)",
  "#2563eb": "var(--color-interactive)", "#1d4ed8": "var(--blue-700)",
  "#16a34a": "var(--color-success)", "#dcfce7": "var(--color-success-bg)",
  "#f59e0b": "var(--color-warning)", "#fef3c7": "var(--color-warning-bg)",
  "#ef4444": "var(--color-danger)", "#fee2e2": "var(--color-danger-bg)",
  "#8b5cf6": "var(--color-purple)", "#7c3aed": "var(--color-purple-hover)",
};
const tokenize = (v) => v.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => TOKENS[m.toLowerCase()] || m);

/* ---- группировка и вывод ---- */
function familyOf(sel) {
  const m = sel.match(/\.([a-z][\w-]*)/gi);
  if (!m) return "прочее";
  for (const c of m) {
    const f = c.slice(1).match(/^(sidebar|topbar|dashboard|kpi|premium|warehouse|nomenclature|dish|menu|order|report|finance|staff|settings|receipt|waiter|kitchen|analytics|chart|modal|drawer|table|form|btn|brand|support|mj|top-dish|recent|period|global|demo|loader|marjon|pos|auth|login|sales|z-report|edit)/i);
    if (f) return f[1].toLowerCase();
  }
  return m[0].slice(1).split("-").slice(0, 2).join("-");
}

const groups = new Map();
for (const [key, props] of kept) {
  const [ctx, sel] = key.split("||");
  const fam = familyOf(sel);
  if (!groups.has(fam)) groups.set(fam, []);
  groups.get(fam).push({ ctx, sel, props, order: Math.min(...[...props.values()].map((p) => p.order)) });
}

let css = `/* ═══════════════════════════════════════════════════════════════
   MARJON — ЧЕРНОВИК ВОССТАНОВЛЕНИЯ (сгенерирован tools/restore-gen.mjs)
   Требует ручной доводки: сверить с STYLEGUIDE.md, убрать разнобой.
   ═══════════════════════════════════════════════════════════════ */\n`;
let decls = 0;
for (const [fam, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  css += `\n/* ─────────── ${fam.toUpperCase()} (${list.length} прав.) ─────────── */\n`;
  list.sort((a, b) => a.order - b.order);
  const byCtx = new Map();
  for (const g of list) {
    if (!byCtx.has(g.ctx)) byCtx.set(g.ctx, []);
    byCtx.get(g.ctx).push(g);
  }
  for (const [ctx, gs] of byCtx) {
    const ind = ctx ? "  " : "";
    if (ctx) css += `${ctx} {\n`;
    for (const g of gs) {
      css += `${ind}${g.sel} {\n`;
      for (const [prop, info] of g.props) { css += `${ind}  ${prop}: ${tokenize(info.val)};\n`; decls++; }
      css += `${ind}}\n`;
    }
    if (ctx) css += `}\n`;
  }
}

fs.writeFileSync(outCss, css);
fs.writeFileSync(outJson, JSON.stringify({
  considered, keptCount, selectors: kept.size, declarations: decls,
  families: [...groups.entries()].map(([k, v]) => ({ family: k, selectors: v.length })).sort((a, b) => b.selectors - a.selectors),
}, null, 1));

console.log(`вызовов matches      : ${matchCalls}`);
console.log(`уникальных селекторов: ${kept.size}`);
console.log(`деклараций в черновике: ${decls}`);
console.log(`-> ${outCss}`);
