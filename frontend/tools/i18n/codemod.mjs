#!/usr/bin/env node
/**
 * Кодмод: переносит русские UI-строки в каталог переводов.
 *
 * Что делает:
 *   1. находит пользовательские строки (JSX-текст, атрибуты, конфиги);
 *   2. заменяет каждую на `t("<ns>.<slug>")`;
 *   3. добавляет `import { t } from ".../i18n/t"`, если его нет;
 *   4. дописывает ключи в ru/uz/en.json (ru — исходный текст,
 *      uz/en — тот же текст как заглушка, чтобы переводить порциями).
 *
 * Правки точечные (по смещениям узлов), поэтому форматирование файла
 * не переписывается целиком и диффы остаются читаемыми.
 *
 * Запуск:
 *   node tools/i18n/codemod.mjs --dry src/pages/OrdersPage.jsx
 *   node tools/i18n/codemod.mjs src/pages/OrdersPage.jsx
 *   node tools/i18n/codemod.mjs --all
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../src");
const I18N = path.join(SRC, "i18n");

const CYR = /[\u0400-\u04FF]/;

const TEXT_ATTRS = new Set([
  "placeholder",
  "title",
  "label",
  "aria-label",
  "alt",
  "tooltip",
  "description",
  "hint",
  "caption",
  "emptyText",
  "confirmText",
  "cancelText",
]);

const TEXT_PROPS = new Set([
  "label",
  "title",
  "text",
  "message",
  "description",
  "placeholder",
  "hint",
  "subtitle",
  "caption",
  "note",
  "tooltip",
  "empty",
  "emptyText",
  "unit",
  "reason",
  "confirmText",
  "cancelText",
  "error",
  "success",
  "body",
  "content",
  "confirmLabel",
  "cancelLabel",
  "emptyMessage",
  "warning",
  "tip",
]);

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(text) {
  let out = "";
  for (const ch of text.toLowerCase()) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "_";
  }
  out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (out.length > 52) {
    out = out.slice(0, 52);
    const cut = out.lastIndexOf("_");
    if (cut > 24) out = out.slice(0, cut);
  }
  return out || "text";
}

function namespaceFor(rel) {
  return rel
    .replace(/\.(jsx?|mjs)$/, "")
    .split("/")
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase())
    .filter(Boolean)
    .join(".");
}

function cleanText(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function readCatalog(name) {
  return JSON.parse(readFileSync(path.join(I18N, `${name}.json`), "utf8"));
}

function writeCatalog(name, data) {
  writeFileSync(path.join(I18N, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function setDeep(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part];
  }
  const last = parts[parts.length - 1];
  if (node[last] === undefined) node[last] = value;
  return node[last];
}

function isInsideFunction(p) {
  let cur = p.parentPath;
  while (cur) {
    if (
      cur.isFunctionDeclaration() ||
      cur.isArrowFunctionExpression() ||
      cur.isFunctionExpression() ||
      cur.isObjectMethod() ||
      cur.isClassMethod()
    ) {
      return true;
    }
    cur = cur.parentPath;
  }
  return false;
}

function collectEdits(file, rel, includeModuleScope = false) {
  const code = readFileSync(file, "utf8");
  const edits = [];
  const strings = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "objectRestSpread"],
      errorRecovery: true,
    });
  } catch {
    return { edits, strings, error: "parse-failed" };
  }

  const addEdit = (start, end, replacement, text) => {
    edits.push({ start, end, replacement });
    strings.push(text);
  };

  traverse(ast, {
    JSXText(p) {
      const value = p.node.value;
      const trimmed = cleanText(value);
      if (!trimmed || !CYR.test(trimmed)) return;
      // Оставляем окружающие пробелы снаружи перевода: они нужны для
      // склейки инлайн-текста вида `Всего <b>5</b> блюд`.
      const lead = value.match(/^\s*/)[0];
      const trail = value.match(/\s*$/)[0];
      const coreStart = p.node.start + lead.length;
      const coreEnd = p.node.end - trail.length;
      addEdit(coreStart, coreEnd, `{t("__KEY__")}`, trimmed);
    },
    StringLiteral(p) {
      const parent = p.parent;
      if (parent?.type === "JSXAttribute") {
        if (!TEXT_ATTRS.has(parent.name?.name)) return;
        const text = cleanText(p.node.value);
        if (!text || !CYR.test(text)) return;
        addEdit(p.node.start, p.node.end, `{t("__KEY__")}`, text);
        return;
      }
      if (parent?.type === "ObjectProperty" && parent.value === p.node) {
        const key = parent.key?.name ?? parent.key?.value;
        if (!TEXT_PROPS.has(key)) return;
        const text = cleanText(p.node.value);
        if (!text || !CYR.test(text)) return;
        // Конфиг на уровне модуля вычисляется один раз при импорте —
        // перевод там застынет. Такие места переводим вручную.
        if (!includeModuleScope && !isInsideFunction(p)) return;
        addEdit(p.node.start, p.node.end, `t("__KEY__")`, text);
        return;
      }
      if (parent?.type === "JSXExpressionContainer") {
        const text = cleanText(p.node.value);
        if (!text || !CYR.test(text)) return;
        addEdit(p.node.start, p.node.end, `t("__KEY__")`, text);
      }
    },
  });

  return { edits, strings, code, rel };
}

function applyEdits(code, edits, keys, callName) {
  const sorted = edits
    .map((e, i) => ({ ...e, key: keys[i] }))
    .sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of sorted) {
    const replacement = e.replacement.replace("__KEY__", e.key).replace("t(", `${callName}(`);
    out = out.slice(0, e.start) + replacement + out.slice(e.end);
  }
  return out;
}

/**
 * В части файлов `t` уже занят локально — таймеры (`const t = setTimeout`),
 * колбэки `map((t) => ...)`. Импорт с именем `t` был бы затенён, и вызов
 * `t("ключ")` упал бы с «t is not a function». Для таких файлов импортируем
 * под псевдонимом `tr`.
 */
function needsAlias(code) {
  return (
    /(?:const|let|var)\s+t\s*=/.test(code) ||
    /function\s+t\s*\(/.test(code) ||
    /\(\s*t\s*\)\s*=>/.test(code) ||
    /(?<![.\w])t\s*=>/.test(code)
  );
}

function ensureImport(code, rel, callName) {
  if (/from\s+["'][^"']*i18n\/t(\.js)?["']/.test(code)) return code;
  const depth = rel.split("/").length - 1;
  const relPath = `${depth ? "../".repeat(depth) : "./"}i18n/t`;
  const lines = code.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*import\s.+from\s+["'].+["'];?\s*$/.test(lines[i])) lastImport = i;
  }
  const stmt =
    callName === "t"
      ? `import { t } from "${relPath}";`
      : `import { t as ${callName} } from "${relPath}";`;
  if (lastImport === -1) return `${stmt}\n${code}`;
  lines.splice(lastImport + 1, 0, stmt);
  return lines.join("\n");
}

function walkAll() {
  return globSync(`${SRC.replace(/\\/g, "/")}/**/*.{js,jsx}`).filter((f) => {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (rel.includes(".test.")) return false;
    if (rel.startsWith("i18n/")) return false;
    return true;
  });
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const all = args.includes("--all");
// Режим «только каталог»: строки из конфигов на уровне модуля попадают в
// ru/uz/en.json, но код не переписывается — их оборачивают в `t()` в рендере,
// иначе перевод застынет на языке, активном при импорте модуля.
const catalogOnly = args.includes("--catalog-only");
const targets = all ? walkAll() : args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));

if (!targets.length) {
  console.error("Укажи файлы или --all");
  process.exit(1);
}

const ru = readCatalog("ru");
const uz = readCatalog("uz");
const en = readCatalog("en");

let totalFiles = 0;
let totalStrings = 0;
const used = new Set();

for (const file of targets) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const { edits, strings, code, error } = collectEdits(file, rel, catalogOnly);
  if (error) {
    console.error(`  SKIP ${rel}: ${error}`);
    continue;
  }
  if (!edits.length) continue;

  const ns = namespaceFor(rel);
  const keys = [];
  for (const text of strings) {
    let key = `${ns}.${slugify(text)}`;
    let candidate = key;
    let n = 2;
    // Коллизия: тот же ключ, но другой текст.
    while (used.has(candidate)) {
      const existing = ru;
      const parts = candidate.split(".");
      let node = existing;
      let ok = true;
      for (let i = 0; i < parts.length - 1; i += 1) {
        node = node?.[parts[i]];
        if (!node) { ok = false; break; }
      }
      if (!ok || node?.[parts[parts.length - 1]] === undefined) break;
      if (node[parts[parts.length - 1]] === text) break;
      candidate = `${key}_${n}`;
      n += 1;
    }
    used.add(candidate);
    keys.push(candidate);
    setDeep(ru, candidate, text);
    setDeep(uz, candidate, text);
    setDeep(en, candidate, text);
  }

  const next = ensureImport(
    applyEdits(code, edits, keys, needsAlias(code) ? "tr" : "t"),
    rel,
    needsAlias(code) ? "tr" : "t",
  );

  if (!dry && !catalogOnly) writeFileSync(file, next, "utf8");
  totalFiles += 1;
  totalStrings += edits.length;
  console.log(`  ${dry ? "DRY " : ""}${rel}: ${edits.length} строк${needsAlias(code) ? " [alias tr]" : ""}`);
}

if (!dry) {
  writeCatalog("ru", ru);
  writeCatalog("uz", uz);
  writeCatalog("en", en);
}

console.log(`\nИтого: ${totalFiles} файлов, ${totalStrings} строк${dry ? " (без записи)" : ""}`);
