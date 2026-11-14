// Генерирует страницы лендинга: / (ru) и /uz/ (uz).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render } from '../src/page.mjs';
import ru from '../src/locales/ru.mjs';
import uz from '../src/locales/uz.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const t of [ru, uz]) {
  const isRu = t.lang === 'ru';
  const dir = join(root, isRu ? '' : 'uz');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), render({ ...t, base: isRu ? './' : '../', review: '' }));
}
console.log('pages: index.html, uz/index.html');
