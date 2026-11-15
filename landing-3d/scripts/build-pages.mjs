// Генерирует страницы лендинга: / — основной вариант «Нить», /e/ — «Поток», /f/ — «Зал»; узбекские версии — в подпапках uz/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render as renderA } from '../src/page.mjs';
import { render as renderE } from '../src/v/e/page.mjs';
import { render as renderF } from '../src/v/f/page.mjs';
import { render as renderG } from '../src/v/g/page.mjs';
import { render as renderH } from '../src/v/h/page.mjs';
import ruBase from '../src/locales/ru.mjs';
import uzBase from '../src/locales/uz.mjs';
import cleanRu from '../src/locales/clean.ru.mjs';
import cleanUz from '../src/locales/clean.uz.mjs';

// правка текстов поверх базовых локалей: объекты сливаются, массивы и строки заменяются
const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; return o; };
const ru = merge(ruBase, cleanRu), uz = merge(uzBase, cleanUz);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const renderAH = (t) => renderA({ ...t, ah: true }).replace('class="no-js"', 'class="no-js v-ah"'); // «Нить» + техника из H
// PROD=1 — сборка для сайта: только «Нить и техника» в корне, без переключателя вариантов
const PROD = process.env.PROD === '1';
const variants = PROD ? [['', renderAH, '']] : [['', renderA, 'A · Нить'], ['ah/', renderAH, 'A+H · Нить и техника'], ['e/', renderE, 'E · Поток'], ['f/', renderF, 'F · Зал'], ['g/', renderG, 'G · Дастархан'], ['h/', renderH, 'H · Техника']];
const out = [];
for (const [dir, render] of variants) {
  for (const t of [ru, uz]) {
    const isRu = t.lang === 'ru', lang = isRu ? '' : 'uz/';
    const up = '../'.repeat((dir ? 1 : 0) + (isRu ? 0 : 1)) || './';
    const review = PROD ? '' : `<p class="review"><span>${isRu ? 'Варианты' : 'Variantlar'}:</span>${variants.map(([d, , name]) => `<a href="${up}${d}${lang}"${d === dir ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</p>`;
    mkdirSync(join(root, dir, lang), { recursive: true });
    writeFileSync(join(root, dir, lang, 'index.html'), render(dir ? { ...t, base: up, review, path: `/${dir}${lang}`, altPath: `/${dir}${isRu ? 'uz/' : ''}` } : t));
    out.push(`${dir}${lang}index.html`);
  }
}
console.log('pages: ' + out.join(', '));
