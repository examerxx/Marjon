/**
 * Собирает страницу A/B: одна и та же разметка, два набора стилей
 * (до чистки !important и после), переключаются мгновенно.
 *
 *   node tools/make-ab.mjs <kafe|admin> <page> <out.html>
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const [, , bundle, page, outPath] = process.argv;
const BASE = "e85e978e8a0ea2eac17defcc8fc343469801a48a";

const KAFE = [
  "src/styles/marjon-tokens.css", "src/styles/brand.css", "src/styles/dashboard.css",
  "src/styles/topbar-widgets.css", "src/styles/forms.css", "src/styles/tables.css",
  "src/styles/staff-pos.css", "src/styles/responsive.css", "src/styles/app.css",
  "src/styles/dashboard-curve.css", "src/styles/loader.css", "src/styles/react-overrides.css",
  "src/styles/receipt.css", "src/styles/auth.css", "src/styles/login-extras.css",
];
const KAFE_AFTER = [...KAFE, "src/styles/marjon-restore.css"];
const ADMIN = ["src/admin/styles.css"];
const ADMIN_AFTER = [...ADMIN, "src/admin/restore.css"];

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n");

function fromGit(f) {
  try {
    return execSync(`git -C /agent/workspace/Marjon show ${BASE}:frontend/${f}`,
      { maxBuffer: 128 * 1024 * 1024 }).toString();
  } catch { return ""; }
}
const fromDisk = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

const isAdmin = bundle === "admin";
const beforeCss = strip((isAdmin ? ADMIN : KAFE).map(fromGit).join("\n"));
const afterCss = strip((isAdmin ? ADMIN_AFTER : KAFE_AFTER).map(fromDisk).join("\n"));

const domDir = isAdmin ? ".cssaudit/domadmin" : ".cssaudit/dom";
const body = fs.readFileSync(path.join(domDir, `${page}.html`), "utf8");
const isDash = /dashboard-shell/.test(body);

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marjon · ${page} · до/после</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Golos+Text:wght@400;500;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">

<style id="css-before" media="not all">
${beforeCss}
</style>
<style id="css-after">
${afterCss}
</style>

<style id="ab-ui">
  #ab-bar{position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:18px;
    display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:999px;
    background:rgba(7,20,40,.93);box-shadow:0 12px 34px rgba(7,20,40,.42);
    font:600 13px/1 "Golos Text",system-ui,sans-serif;color:#fff;backdrop-filter:blur(8px)}
  #ab-bar button{appearance:none;border:0;cursor:pointer;padding:9px 16px;border-radius:999px;
    font:inherit;color:rgba(255,255,255,.72);background:transparent;transition:.15s}
  #ab-bar button.on{background:#1db5b5;color:#fff}
  #ab-bar .lbl{padding-left:6px;opacity:.6;font-weight:500}
  #ab-bar kbd{background:rgba(255,255,255,.14);border-radius:5px;padding:2px 6px;font:inherit;font-size:11px}
</style>
</head>
<body class="${isDash ? "dashboard-body" : ""}">
<div id="root">${body}</div>

<div id="ab-bar">
  <button id="b-before" type="button">ДО чистки</button>
  <button id="b-after" type="button" class="on">ПОСЛЕ</button>
  <span class="lbl">пробел — переключить</span>
</div>

<script>
(function(){
  var before=document.getElementById('css-before'),after=document.getElementById('css-after'),
      bB=document.getElementById('b-before'),bA=document.getElementById('b-after'),show='after';
  function set(v){
    show=v;
    before.media = v==='before' ? 'all' : 'not all';
    after.media  = v==='after'  ? 'all' : 'not all';
    bB.className = v==='before' ? 'on' : '';
    bA.className = v==='after'  ? 'on' : '';
    document.title='Marjon · ${page} · '+(v==='before'?'ДО':'ПОСЛЕ');
  }
  bB.onclick=function(){set('before')}; bA.onclick=function(){set('after')};
  document.addEventListener('keydown',function(e){
    if(e.code==='Space'){e.preventDefault();set(show==='after'?'before':'after');}
  });
})();
</script>
</body></html>`;

fs.writeFileSync(outPath, html);
console.log(`${outPath}  ${(html.length / 1024 / 1024).toFixed(2)} МБ  (до ${(beforeCss.length/1024)|0}К / после ${(afterCss.length/1024)|0}К)`);
