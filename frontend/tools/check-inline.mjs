/**
 * Ищет единственное место, где @layer НЕ эквивалентен !important:
 * флаг перебивает инлайновый style="", а слой — нет.
 *
 * Конфликт = элемент имеет инлайновое свойство, и то же свойство задаёт
 * правило из слоя marjon-important. Раньше побеждало правило, теперь инлайн.
 *
 *   node tools/check-inline.mjs <rules.json> <domDir>
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const [, , rulesPath, domDir] = process.argv;
const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

const impRules = rules.filter((r) => (r.layer || "") === "marjon-important");
if (!impRules.length) {
  console.log("В правилах нет пометки слоя — экспортируй с полем layer.");
  process.exit(2);
}

const byClass = new Map(), byTag = new Map(), byId = new Map(); const universal = [];
impRules.forEach((r, i) => {
  const [k, v] = r.key;
  const t = k === "id" ? byId : k === "class" ? byClass : k === "tag" ? byTag : null;
  if (!t) { universal.push(i); return; }
  if (!t.has(v)) t.set(v, []);
  t.get(v).push(i);
});

const conflicts = new Map();
for (const f of fs.readdirSync(domDir).filter((x) => x.endsWith(".html")).sort()) {
  const html = fs.readFileSync(path.join(domDir, f), "utf8");
  const cls = /dashboard-shell/.test(html) ? ' class="dashboard-body"' : "";
  const dom = new JSDOM(`<!doctype html><html><body${cls}>${html}</body></html>`);
  for (const el of dom.window.document.querySelectorAll("[style]")) {
    const inlineProps = (el.getAttribute("style") || "").split(";")
      .map((s) => s.split(":")[0].trim().toLowerCase()).filter(Boolean);
    if (!inlineProps.length) continue;

    const cand = new Set();
    if (el.id) (byId.get(el.id) || []).forEach((i) => cand.add(i));
    for (const c of el.classList) (byClass.get(c) || []).forEach((i) => cand.add(i));
    (byTag.get(el.tagName.toLowerCase()) || []).forEach((i) => cand.add(i));
    universal.forEach((i) => cand.add(i));

    for (const i of cand) {
      const r = impRules[i];
      let m = false;
      try { m = el.matches(r.sel); } catch { m = false; }
      if (!m) continue;
      for (const d of r.d) {
        if (!inlineProps.includes(d[0])) continue;
        const key = `${r.sel} { ${d[0]} }`;
        if (!conflicts.has(key)) {
          conflicts.set(key, { n: 0, sel: r.sel, prop: d[0], layerVal: d[1],
            inline: el.style[d[0]] || el.getAttribute("style"), file: r.file, line: r.line });
        }
        conflicts.get(key).n++;
      }
    }
  }
  dom.window.close();
}

const list = [...conflicts.values()].sort((a, b) => b.n - a.n);
console.log(`КОНФЛИКТОВ «инлайн против слоя»: ${list.length}`);
for (const c of list) {
  console.log(`\n  ${c.n}× ${c.sel}`);
  console.log(`      свойство : ${c.prop}`);
  console.log(`      в слое   : ${String(c.layerVal).slice(0, 60)}   [${c.file}:${c.line}]`);
  console.log(`      инлайн   : ${String(c.inline).slice(0, 60)}   ← сейчас побеждает это`);
}
if (!list.length) console.log("  нет — эквивалентность полная");
