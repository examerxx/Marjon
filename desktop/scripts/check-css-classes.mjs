#!/usr/bin/env node
/**
 * check-css-classes.mjs
 * ─────────────────────────────────────────────────────────────────────
 * Проект использует ОБЫЧНЫЙ глобальный CSS (не CSS Modules, не Tailwind).
 * Имя класса в JSX — просто строка: если селектора нет в CSS, ничего не
 * падает, экран рендерится без стилей, а `npm run build` остаётся зелёным.
 *
 * Этот скрипт собирает все className из src/**.jsx и сверяет с селекторами
 * из src/styles/*.css. Печатает классы, которые есть в JSX, но отсутствуют
 * в CSS, и завершается с кодом 1, если такие найдены.
 *
 * Ограничение: полностью динамические имена (`type-${x}`) не проверяются —
 * их фрагменты пропускаются. Ловит массовые статические расхождения.
 *
 * Запуск:  npm run check:css
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src')
const STYLES = join(SRC, 'styles')

// ── Рекурсивный обход файлов с нужным расширением ──
function walk(dir, ext, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, ext, acc)
    else if (ext.includes(extname(entry.name))) acc.push(full)
  }
  return acc
}

// ── Классы, известные CSS ──
// Собираем каждый одиночный селектор класса .foo из всех css-файлов.
function collectDefinedClasses() {
  const defined = new Set()
  for (const file of walk(STYLES, ['.css'])) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // .класс — буквы, цифры, дефис, подчёркивание; не трогаем псевдо (:hover) и комбинаторы
    for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      defined.add(m[1])
    }
  }
  return defined
}

// ── Классы, используемые в JSX ──
// Берём и обычные className="a b", и шаблонные className={`a ${x ? 'b' : ''}`}.
// Из шаблонных строк вытаскиваем только статические литералы классов.
function collectUsedClasses() {
  const used = new Map() // class -> Set(файлы)
  const add = (cls, file) => {
    if (!cls) return
    if (!used.has(cls)) used.set(cls, new Set())
    used.get(cls).add(file)
  }

  // Токен считается статическим классом, только если он целиком валиден.
  // Отбрасываем пустые, обрывки перед интерполяцией (кончаются на `-`),
  // и всё, где остался `${...}`.
  const addTokens = (str, rel) => {
    for (const t of str.split(/\s+/)) {
      const c = t.trim()
      if (!c) continue
      if (c.includes('$') || c.includes('{') || c.includes('}')) continue
      if (c.endsWith('-')) continue // напр. `table-card--` перед ${status}
      if (!/^-?[_a-zA-Z][\w-]*$/.test(c)) continue
      add(c, rel)
    }
  }

  for (const file of walk(SRC, ['.jsx', '.js'])) {
    const code = readFileSync(file, 'utf8')
    const rel = file.replace(SRC, 'src').replace(/\\/g, '/')

    // className="..."  и  className={'...'} / {"..."} (без шаблонных строк)
    for (const m of code.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)')\s*\})/g)) {
      addTokens(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '', rel)
    }

    // className={`... ${...} ...`} — шаблонные строки
    for (const m of code.matchAll(/className\s*=\s*\{\s*`([^`]*)`/g)) {
      const tpl = m[1]
      // статические слова между интерполяциями
      tpl.split(/\$\{[^}]*\}/).forEach(chunk => addTokens(chunk, rel))
      // классы в результатах тернарников внутри ${...}: после ? или :
      for (const inner of tpl.matchAll(/\$\{([^}]*)\}/g)) {
        for (const lit of inner[1].matchAll(/[?:]\s*['"]([^'"]*)['"]/g)) {
          addTokens(lit[1], rel)
        }
      }
    }
  }
  return used
}

const defined = collectDefinedClasses()
const used = collectUsedClasses()

const missing = []
for (const [cls, files] of used) {
  if (!cls) continue
  if (defined.has(cls)) continue
  missing.push({ cls, files: [...files] })
}

missing.sort((a, b) => a.cls.localeCompare(b.cls))

if (missing.length === 0) {
  console.log(`✓ CSS-классы синхронизированы: все ${used.size} класса из JSX определены в CSS.`)
  process.exit(0)
}

console.error(`\n✗ Найдено ${missing.length} класс(ов) в JSX без определения в CSS:\n`)
for (const { cls, files } of missing) {
  console.error(`  .${cls}`)
  for (const f of files) console.error(`      ${f}`)
}
console.error(`\nИсточник правды — JSX. Добавьте недостающие правила в src/styles/*.css`)
console.error(`(не переименовывайте классы в JSX). Динамические имени (\`type-\${x}\`) скрипт не видит.\n`)
process.exit(1)
