/**
 * Собирает автономную HTML-страницу: реальная разметка страницы + весь CSS кафе
 * инлайном. Нужна для визуальной сверки «до/после» через браузер.
 *
 *   node tools/make-preview.mjs <page> <out.html> [--css-from-git] [--width=1280]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const [, , page, outPath] = process.argv;
const fromGit = process.argv.includes("--css-from-git");

const ORDER = [
  "src/styles/marjon-tokens.css", "src/styles/brand.css", "src/styles/dashboard.css",
  "src/styles/topbar-widgets.css", "src/styles/forms.css", "src/styles/tables.css",
  "src/styles/staff-pos.css", "src/styles/responsive.css", "src/styles/app.css",
  "src/styles/dashboard-curve.css", "src/styles/loader.css", "src/styles/react-overrides.css",
  "src/styles/receipt.css", "src/styles/auth.css", "src/styles/login-extras.css",
];
// новый восстановительный слой подключаем последним, если он есть
if (fs.existsSync("src/styles/marjon-restore.css")) ORDER.push("src/styles/marjon-restore.css");

let css = "";
for (const f of ORDER) {
  let text = "";
  if (fromGit) {
    try { text = execSync(`git show HEAD:frontend/${f}`, { cwd: "..", maxBuffer: 64 * 1024 * 1024 }).toString(); }
    catch { text = ""; }
  } else {
    text = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  }
  css += `\n/* ===== ${f} ===== */\n${text}`;
}

const body = fs.readFileSync(path.join(".cssaudit/dom", `${page}.html`), "utf8");
const isDash = /dashboard-shell/.test(body);

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marjon — ${page}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Golos+Text:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
<style>
${css}
</style>
</head>
<body class="${isDash ? "dashboard-body" : ""}">
<div id="root">${body}</div>
</body></html>`;

fs.writeFileSync(outPath, html);
console.log(`${outPath}  (${(html.length / 1024).toFixed(0)} КБ, css ${(css.length / 1024).toFixed(0)} КБ)`);
