// Скриншоты вариантов B/C: node scripts/shots2.mjs <path> <W> <H> <id[+vh]> ...   (например: b/ 1440 900 top problem platforms+0.3)
// env: Q (доп. query), OUT (префикс файла). Пишет shots/{OUT}-{W}-{name}.jpg
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [path, W, H, ...names] = process.argv.slice(2);
mkdirSync('shots', { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await page.goto(`http://localhost:4173/${path}?fast&debug&motion=1${process.env.Q || '&gl=1&q=low'}`, { waitUntil: 'load' });
await page.waitForTimeout(+(process.env.WAIT || 6000));
for (const n of names) {
  const [id, off = 0] = n.split('+');
  await page.evaluate(() => window.__m && (window.__m.pause = false));
  const y = await page.evaluate(([id, off]) => { const el = document.getElementById(id); const y = id === 'end' ? 1e9 : el.getBoundingClientRect().top + scrollY + off * innerHeight; scrollTo(0, y); return scrollY; }, [id, +off]);
  await page.waitForTimeout(+(process.env.SETTLE || 3500));
  const info = await page.evaluate(() => { if (window.__m) window.__m.pause = true; return { t: window.__m?.t?.toFixed(2), f: window.__m?.frames, sw: document.documentElement.scrollWidth }; });
  const out = `shots/${process.env.OUT || path.replace(/\W/g, '')}-${W}-${n}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 72, timeout: 150000 });
  console.log(out, 'y=' + Math.round(y), JSON.stringify(info));
}
if (errs.length) console.log('ERRORS:\n' + [...new Set(errs)].join('\n'));
await b.close();
