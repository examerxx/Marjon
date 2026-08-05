/**
 * Прикидывает перенос правил из marjon-important в marjon-base БЕЗ правки файлов.
 * Показывает, сколько элементов изменит вид. Ноль — значит правило держалось
 * в верхнем слое зря и его можно опустить.
 *
 *   node tools/simulate-move.mjs <rules.json> <domDir> <regexp> [width]
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , rulesPath, domDir, pattern, widthArg] = process.argv;
const WIDTH = Number(widthArg || 1440);
const RE = new RegExp(pattern);
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

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

const maxOrd = Math.max(...rules.map((r) => r.ord));
const moved = new Set();
rules.forEach((r, i) => {
  if (r.layer === "marjon-important" && RE.test(r.sel)) moved.add(i);
});
console.log(`правил под перенос: ${moved.size} из ${rules.filter((r) => r.layer === "marjon-important").length} в верхнем слое`);
if (!moved.size) process.exit(0);

/* два варианта веса: как сейчас и после переноса */
const now = rules.map((r) => [rank(r.layer), r.ord]);
const after = rules.map((r, i) => (moved.has(i) ? [rank("marjon-base"), maxOrd + 1 + i] : [rank(r.layer), r.ord]));

const byId = new Map(), byClass = new Map(), byTag = new Map(); const universal = [];
rules.forEach((r, i) => {
  const [k, v] = r.key;
  const t = k === "id" ? byId : k === "class" ? byClass : k === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(v)) t.set(v, []);
  t.get(v).push(i);
});

function winners(hit, weights) {
  const win = new Map();
  for (const ri of hit) {
    const r = rules[ri];
    const [lay, ord] = weights[ri];
    for (const d of r.d) {
      const cur = win.get(d[0]);
      if (!cur) { win.set(d[0], [lay, r.spec, ord, d[1], ri]); continue; }
      if (lay !== cur[0]) { if (lay > cur[0]) win.set(d[0], [lay, r.spec, ord, d[1], ri]); continue; }
      const cs = cur[1], rs = r.spec;
      if ((rs[0] - cs[0] || rs[1] - cs[1] || rs[2] - cs[2] || ord - cur[2]) >= 0)
        win.set(d[0], [lay, r.spec, ord, d[1], ri]);
    }
  }
  return win;
}

let changed = 0, elems = 0;
const samples = [];
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
      if (!mediaApplies(rules[i].ctx, WIDTH)) continue;
      let m = false;
      try { m = el.matches(rules[i].sel); } catch { m = false; }
      if (m) hit.push(i);
    }
    if (!hit.length) continue;
    elems++;
    const a = winners(hit, now), b = winners(hit, after);
    for (const [p, v] of a) {
      const w = b.get(p);
      if (!w || w[3] !== v[3]) {
        changed++;
        if (samples.length < 8) {
          const c = typeof el.className === "string" ? el.className.trim() : "";
          samples.push(`${el.tagName.toLowerCase()}${c ? "." + c.split(/\s+/).join(".") : ""} · ${p}: ${v[3]} → ${w ? w[3] : "(нет)"}`);
        }
      }
    }
  }
  dom.window.close();
}
console.log(`элементов проверено: ${elems}`);
console.log(`изменится свойств : ${changed}`);
if (changed) { console.log("\nпримеры:"); samples.forEach((s) => console.log("   " + s)); }
else console.log("\nПЕРЕНОС БЕЗОПАСЕН — картинка не меняется");
