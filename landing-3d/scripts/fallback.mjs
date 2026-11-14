import { chromium } from 'playwright';
const b = await chromium.launch();
const errs = [];
for (const [name, w, h, opts, q] of [['nogl', 1440, 900, {}, 'gl=0&fast'], ['reduced', 1440, 900, { reducedMotion: 'reduce' }, ''], ['reduced-m', 390, 844, { reducedMotion: 'reduce', isMobile: true }, ''], ['nojs', 1440, 900, { javaScriptEnabled: false }, '']]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, ...opts })).newPage();
  page.on('pageerror', (e) => errs.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(name + ': ' + m.text()));
  await page.goto('http://localhost:4173/?' + q, { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `shots/fb-${name}.jpg`, type: 'jpeg', quality: 70 });
  const y = await page.evaluate(() => { const y = document.querySelector('#modules').getBoundingClientRect().top + scrollY; scrollTo(0, y); return y; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `shots/fb-${name}-mod.jpg`, type: 'jpeg', quality: 70 });
  await page.close();
}
console.log(errs.join('\n') || 'no errors');
await b.close();
