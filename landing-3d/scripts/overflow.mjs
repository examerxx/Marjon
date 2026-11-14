import { chromium } from 'playwright';
const W = +process.argv[2] || 390;
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: W, height: 844 }, isMobile: W < 600, hasTouch: W < 600 })).newPage();
await page.goto(`http://localhost:4173/${process.argv[3] || ''}?gl=0&fast`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log(await page.evaluate((W) => {
  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width <= 432 && el.scrollWidth > el.clientWidth + 1 && !el.closest('.mq') && !el.closest('.role-tabs')) out.push(`${el.tagName}.${String(el.className).slice(0, 40)} sw=${el.scrollWidth} cw=${el.clientWidth}`);
  });
  return `scrollWidth=${document.documentElement.scrollWidth} inner=${innerWidth}\n` + out.slice(0, 25).join('\n');
}, W));
await b.close();
