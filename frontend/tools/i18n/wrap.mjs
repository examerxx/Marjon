#!/usr/bin/env node
/**
 * Оборачивает подписи из конфигов в `t()` в местах рендера.
 *
 * Зачем: подписи вида `{ config.title }` берутся из объекта, объявленного на
 * уровне модуля. Такой объект вычисляется один раз при импорте, поэтому
 * `t()` внутри него «застыл» бы на языке, активном при загрузке бандла.
 * Оборачиваем в рендере — там `t()` вызывается заново на каждой перерисовке.
 *
 * `t()` умеет принимать и русский текст (резервный поиск по индексу), поэтому
 * подписи, которых нет в каталоге (например, данные с сервера), возвращаются
 * как есть и ничего не ломают.
 *
 * Запуск: node tools/i18n/wrap.mjs <файлы...>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../src");

// { x.title } / { item.label } — но не { t(...) } и не вызовы методов.
const PATTERN = /\{\s*(?!t\()([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(title|label|description|text)\s*\}/g;

const files = process.argv.slice(2).map((f) => path.resolve(f));
let touched = 0;

for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, "/");
  let code = readFileSync(file, "utf8");
  let count = 0;
  code = code.replace(PATTERN, (_m, obj, field) => {
    count += 1;
    return `{t(${obj}.${field})}`;
  });
  if (!count) {
    console.log(`  ${rel}: нет подходящих мест`);
    continue;
  }
  if (!/from\s+["'][^"']*i18n\/t(\.js)?["']/.test(code)) {
    const depth = rel.split("/").length - 1;
    const relPath = `${depth ? "../".repeat(depth) : "./"}i18n/t`;
    const lines = code.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*import\s.+from\s+["'].+["'];?\s*$/.test(lines[i])) lastImport = i;
    }
    const stmt = `import { t } from "${relPath}";`;
    if (lastImport === -1) code = `${stmt}\n${code}`;
    else lines.splice(lastImport + 1, 0, stmt), (code = lines.join("\n"));
  }
  writeFileSync(file, code, "utf8");
  touched += 1;
  console.log(`  ${rel}: ${count} мест`);
}

console.log(`\nФайлов изменено: ${touched}`);
