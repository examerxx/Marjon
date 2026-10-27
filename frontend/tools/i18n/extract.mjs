#!/usr/bin/env node
/**
 * Извлекатель русских UI-строк из фронтенда (только чтение, ничего не меняет).
 *
 * Зачем: понять реальный объём перевода перед тем, как трогать 175 файлов.
 * Считает не «строки с кириллицей» (туда попадают комментарии), а именно
 * пользовательские строки: текст JSX, литералы в атрибутах и в объектах-конфигах.
 *
 * Запуск:
 *   node tools/i18n/extract.mjs            # сводка
 *   node tools/i18n/extract.mjs --json     # подробный JSON в stdout
 *   node tools/i18n/extract.mjs --file X   # строки одного файла
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

// @babel/traverse — CJS: в ESM дефолт приходит как модуль-объект.
const traverse = traverseModule.default ?? traverseModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../src");

const CYR = /[\u0400-\u04FF]/;

// Атрибуты, значение которых видит пользователь.
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

// Ключи объектов-конфигов, значения которых обычно попадают в UI.
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
]);

function walkFiles(dir, out = []) {
  for (const entry of globSync(`${dir.replace(/\\/g, "/")}/**/*.{js,jsx}`)) {
    const rel = path.relative(SRC, entry).replace(/\\/g, "/");
    if (rel.includes(".test.")) continue;
    if (rel.startsWith("i18n/")) continue;
    out.push(entry);
  }
  return out;
}

function cleanText(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function hasLetters(s) {
  // Отсекаем строки из одних символов/цифр.
  return /[A-Za-z\u0400-\u04FF]/.test(s);
}

function collect(file) {
  const code = readFileSync(file, "utf8");
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  const found = [];

  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "objectRestSpread"],
      errorRecovery: true,
    });
  } catch (err) {
    return { rel, error: String(err.message), found };
  }

  const push = (text, kind, line) => {
    const t = cleanText(text);
    if (!t || !CYR.test(t) || !hasLetters(t)) return;
    found.push({ text: t, kind, line });
  };

  traverse(ast, {
    JSXText(p) {
      push(p.node.value, "jsx-text", p.node.loc?.start.line);
    },
    StringLiteral(p) {
      const parent = p.parent;
      // Атрибут JSX: <Input placeholder="Имя" />
      if (parent?.type === "JSXAttribute") {
        const name = parent.name?.name;
        if (TEXT_ATTRS.has(name)) push(p.node.value, `attr:${name}`, p.node.loc?.start.line);
        return;
      }
      // Значение свойства объекта-конфига: { label: "Склад" }
      if (parent?.type === "ObjectProperty" && parent.value === p.node) {
        const key = parent.key?.name ?? parent.key?.value;
        if (TEXT_PROPS.has(key)) push(p.node.value, `prop:${key}`, p.node.loc?.start.line);
        return;
      }
      // Строка внутри JSX-выражения: {cond ? "Да" : "Нет"}
      if (parent?.type === "JSXExpressionContainer") {
        push(p.node.value, "jsx-expr", p.node.loc?.start.line);
      }
    },
    TemplateLiteral(p) {
      const raw = p.node.quasis.map((q) => q.value.cooked ?? "").join(" ");
      if (!CYR.test(raw)) return;
      const inJsx = p.parent?.type === "JSXExpressionContainer";
      if (inJsx) push(raw, "template", p.node.loc?.start.line);
    },
  });

  return { rel, found };
}

const files = walkFiles(SRC);
const results = files.map(collect);

const all = results.flatMap((r) => r.found.map((f) => ({ ...f, file: r.rel })));
const unique = new Map();
for (const item of all) {
  unique.set(item.text, (unique.get(item.text) ?? 0) + 1);
}

const args = process.argv.slice(2);
if (args.includes("--json")) {
  writeFileSync(
    path.resolve(__dirname, "strings.json"),
    JSON.stringify({ total: all.length, unique: unique.size, results }, null, 2),
  );
  console.log(`strings.json: ${all.length} вхождений, ${unique.size} уникальных`);
} else if (args.includes("--file")) {
  const target = args[args.indexOf("--file") + 1];
  const r = results.find((x) => x.rel === target);
  console.log(JSON.stringify(r ?? { error: "not found" }, null, 2));
} else {
  const perFile = results
    .filter((r) => r.found.length)
    .sort((a, b) => b.found.length - a.found.length);

  console.log(`Файлов с UI-строками: ${perFile.length} из ${files.length}`);
  console.log(`Вхождений: ${all.length}`);
  console.log(`Уникальных фраз: ${unique.size}`);
  console.log(`\nТоп-20 файлов:`);
  for (const r of perFile.slice(0, 20)) {
    console.log(`  ${String(r.found.length).padStart(4)}  ${r.rel}`);
  }

  const byKind = {};
  for (const item of all) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  console.log(`\nПо типу:`);
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }
}
