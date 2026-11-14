// Генерирует index.html (ru) и uz/index.html из одного шаблона и двух словарей.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render } from '../src/page.mjs';
import ru from '../src/locales/ru.mjs';
import uz from '../src/locales/uz.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'uz'), { recursive: true });
writeFileSync(join(root, 'index.html'), render(ru));
writeFileSync(join(root, 'uz/index.html'), render(uz));
console.log('pages: index.html, uz/index.html');
