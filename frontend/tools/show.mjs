/** Показать список работ по семье/отпечатку: node tools/show.mjs <work.json> <фильтр> [--all] [--limit=N] */
import fs from "node:fs";
const [, , file, filter] = process.argv;
const all = process.argv.includes("--all");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "--limit=400").split("=")[1]);
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = w.rows.filter((r) => (all || r.hard) && (r.family === filter || r.fp.includes(filter) || r.prop === filter));
const byFp = new Map();
for (const r of rows) {
  if (!byFp.has(r.fp)) byFp.set(r.fp, []);
  byFp.get(r.fp).push(r);
}
console.log(`фильтр "${filter}": отпечатков ${byFp.size}, пар ${rows.length}\n`);
let shown = 0;
for (const [fp, list] of [...byFp.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (shown >= limit) { console.log(`… ещё ${byFp.size - shown} отпечатков`); break; }
  console.log(`▸ ${fp}   [${list[0].pages} стр., ${list[0].elems} эл.]`);
  for (const r of list.sort((a, b) => a.prop.localeCompare(b.prop))) {
    const to = r.lost ? "✗ ПОТЕРЯНО" : `→ ${r.after}`;
    console.log(`    ${r.prop.padEnd(26)} ${String(r.before).slice(0, 58).padEnd(58)} ${to}`);
  }
  console.log("");
  shown++;
}
