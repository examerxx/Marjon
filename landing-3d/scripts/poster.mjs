// Статичный постер для слабых устройств и prefers-reduced-motion: кадр hero без DOM-слоя.
// Запуск: npm run build && npx vite preview --port 4173 & node scripts/poster.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h, out] of [[1600, 1000, 'public/poster.jpg'], [780, 1400, 'public/poster-m.jpg']]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto('http://localhost:4173/?gl=1&fast&debug&motion=1', { waitUntil: 'load' });
  await page.addStyleTag({ content: 'main,.nav,.rail,.foot,.bead-labels,.stage-shade,.loader{display:none!important}' });
  await page.waitForTimeout(9000);
  await page.evaluate(() => (window.__m.pause = true));
  await page.screenshot({ path: out, type: 'jpeg', quality: 78 });
  console.log(out);
  await page.close();
}
await b.close();
