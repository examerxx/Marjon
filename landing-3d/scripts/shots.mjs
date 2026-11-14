// Проверочные скриншоты: node scripts/shots.mjs [width] [height] [query] [pathPrefix]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const W = +process.argv[2] || 1440, H = +process.argv[3] || 900, Q = process.argv[4] || 'gl=1&fast', P = process.argv[5] || '';
const WAIT = +process.env.WAIT || 5000;
const only = process.argv[6] ? process.argv[6].split(',') : null;
mkdirSync('shots', { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: W < 600, hasTouch: W < 600 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto(`http://localhost:4173/${P}?${Q}`, { waitUntil: 'load' });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => ({ max: document.documentElement.scrollHeight - innerHeight, cls: document.documentElement.className, sw: document.documentElement.scrollWidth, iw: innerWidth }));
console.log(JSON.stringify(info));
const pos = await page.evaluate(() => {
  const top = (s) => document.querySelector(s).getBoundingClientRect().top + scrollY, vh = innerHeight;
  const pin = document.querySelector('.pin-spacer') || document.querySelector('#modules');
  const ps = pin.getBoundingClientRect().top + scrollY, pl = pin.offsetHeight - vh;
  return { hero: 0, heroOut: vh * 0.5, problem: top('#problem'), problem2: top('#problem') + vh * 0.7, mod1: ps + pl * 0.06, mod4: ps + pl * 0.45, mod8: ps + pl * 0.97,
    live: top('#live'), live2: top('#live') + vh * 0.75, roles: top('#roles') + vh * 0.2, uz: top('#uzbekistan'), uz2: top('#uzbekistan') + vh * 0.6,
    plat: top('#platforms'), integ: top('#integrations') - 80, launch: top('#launch') - 80, faq: top('#faq') - 80, cta: top('#contact') + 40, end: 1e7 };
});
for (const [name, y] of Object.entries(pos)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.waitForTimeout(WAIT);
  await page.evaluate(() => { if (window.__m) window.__m.pause = true; });
  await page.screenshot({ path: `shots/${W}-${name}.jpg`, quality: 72, type: 'jpeg' });
  const st = await page.evaluate(() => { const m = window.__m; if (!m) return ''; m.pause = false; return `t=${m.t.toFixed(2)} frames=${m.frames}`; });
  console.log(name, Math.round(y), st);
}
console.log(errs.length ? [...new Set(errs)].join('\n') : 'no console errors');
await b.close();
