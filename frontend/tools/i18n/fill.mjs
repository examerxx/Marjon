#!/usr/bin/env node
/**
 * Заполнение каталогов переводов.
 *
 * Два источника:
 *   1. уже переведённые записи — если тот же русский текст уже переведён под
 *      другим ключом, перевод переиспользуется (после кодмода одна и та же
 *      фраза живёт в нескольких namespace);
 *   2. файлы-словари из `tools/i18n/batches/*.tsv` со строками
 *      `<русский>\t<узбекский>\t<английский>`.
 *
 * Запуск:
 *   node tools/i18n/fill.mjs --reuse          # только переиспользование
 *   node tools/i18n/fill.mjs                  # reuse + все batches
 *   node tools/i18n/fill.mjs --report         # что осталось перевести
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N = path.resolve(__dirname, "../../src/i18n");
const BATCHES = path.join(__dirname, "batches");

function read(name) {
  return JSON.parse(readFileSync(path.join(I18N, `${name}.json`), "utf8"));
}

function write(name, data) {
  writeFileSync(path.join(I18N, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function leaves(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, leaves(v, key));
    else out[key] = v;
  }
  return out;
}

function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

const ru = read("ru");
const uz = read("uz");
const en = read("en");

const ruFlat = leaves(ru);
const uzFlat = leaves(uz);
const enFlat = leaves(en);

const pending = () => Object.keys(ruFlat).filter((k) => uzFlat[k] === ruFlat[k]);

const args = process.argv.slice(2);

// ── 1. Переиспользование готовых переводов по русскому тексту ────────────────
const uzByText = new Map();
const enByText = new Map();
for (const key of Object.keys(ruFlat)) {
  const text = ruFlat[key];
  if (uzFlat[key] && uzFlat[key] !== text && !uzByText.has(text)) uzByText.set(text, uzFlat[key]);
  if (enFlat[key] && enFlat[key] !== text && !enByText.has(text)) enByText.set(text, enFlat[key]);
}

let reused = 0;
if (!args.includes("--report")) {
  for (const key of pending()) {
    const text = ruFlat[key];
    if (uzByText.has(text)) {
      setDeep(uz, key, uzByText.get(text));
      setDeep(en, key, enByText.get(text) ?? text);
      reused += 1;
    }
  }
}

// ── 2. Словари-батчи ─────────────────────────────────────────────────────────
let applied = 0;
const unknown = [];
if (!args.includes("--reuse") && !args.includes("--report") && existsSync(BATCHES)) {
  const files = readdirSync(BATCHES).filter((f) => f.endsWith(".tsv")).sort();
  for (const file of files) {
    const lines = readFileSync(path.join(BATCHES, file), "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n");
    for (const line of lines) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [ruText, uzText, enText] = line.split("\t");
      if (!ruText || !uzText || !enText) continue;
      let hit = 0;
      for (const key of Object.keys(ruFlat)) {
        if (ruFlat[key] !== ruText) continue;
        setDeep(uz, key, uzText);
        setDeep(en, key, enText);
        hit += 1;
        applied += 1;
      }
      if (!hit) unknown.push(`${file}: ${ruText}`);
    }
  }
}

if (!args.includes("--report")) {
  write("uz", uz);
  write("en", en);
}

const uzAfter = leaves(read("uz"));
const left = Object.keys(ruFlat).filter((k) => uzAfter[k] === ruFlat[k]);
const leftTexts = [...new Set(left.map((k) => ruFlat[k]))].sort();

console.log(`Переиспользовано: ${reused}`);
console.log(`Из батчей: ${applied}`);
console.log(`Осталось ключей: ${left.length} (уникальных текстов: ${leftTexts.length})`);
if (unknown.length) {
  console.log(`\nНе найдено в ru.json (${unknown.length}):`);
  for (const u of unknown.slice(0, 20)) console.log(`  ${u}`);
}

if (args.includes("--report")) {
  for (const t of leftTexts) console.log(t);
}
