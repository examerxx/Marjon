// Постеры варианта D (кадр hero без DOM-слоя): npm run build && vite preview, затем node scripts/poster2.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const v of ['d']) for (const [w, h, suf] of [[1600, 1000, ''], [780, 1400, '-m']]) {
  const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto(`http://localhost:4173/${v}/?gl=1&fast&debug&motion=1&q=low`, { waitUntil: 'load' });
  await page.addStyleTag({ content: 'main,.nav,.foot,.loader,.daybar,.menu{display:none!important}' });
  await page.waitForTimeout(8000);
  await page.evaluate(() => (window.__m.pause = true));
  await page.screenshot({ path: `public/poster-${v}${suf}.jpg`, type: 'jpeg', quality: 78 });
  console.log(`public/poster-${v}${suf}.jpg`);
  await page.close();
}
await b.close();
