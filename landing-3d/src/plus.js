// «Плюс»: манифест со словами по скроллу, бегущие ленты от скорости скролла, зерно,
// кинетический заголовок (вариативный шрифт под курсором), шаги запуска, орб, вордмарк футера.
// Один rAF-цикл, позиции — из getBoundingClientRect (не зависит от pin-секций).
import './plus.css';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduced = new URLSearchParams(location.search).get('motion') === '0'; // анимация всегда
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

const init = () => {
  if (reduced) return;
  const html = document.documentElement;

  // зерно
  const grain = document.createElement('div'); grain.className = 'grain'; grain.setAttribute('aria-hidden', 'true'); document.body.appendChild(grain);

  // манифест → слова
  const mani = $('[data-mani]'); let words = [];
  if (mani) {
    const out = [];
    for (const node of [...mani.childNodes]) {
      const em = node.nodeType === 1;
      for (const w of node.textContent.split(/(\s+)/)) out.push(/^\s*$/.test(w) ? ' ' : `<span class="w${em ? ' em' : ''}">${w}</span>`);
    }
    mani.innerHTML = out.join(''); words = $$('.w', mani);
  }

  // ленты
  const bands = $$('[data-vband]').map((el) => ({ el, t: el.firstElementChild, x: 0, dir: +el.dataset.dir || 1, sk: 0 }));

  // шаги
  const steps = $('.steps'), stepEls = $$('.step', steps || document);
  steps?.classList.add('fxs');

  // вордмарк футера
  const fw = $('.foot-word');
  if (fw) { const l = [...fw.textContent.trim()].map((c) => `<span>${c}</span>`).join(''); fw.innerHTML = `<span class="fw-o">${l}</span><span class="fw-f">${l}</span>`; }

  // кинетический заголовок: символы первого экрана (оба слоя — светлый и тёмный)
  const mouse = { x: -9999, y: -9999, on: false };
  if (fine) addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; }, { passive: true });
  let layers = [], wts = [], stamp = 0;
  const collect = () => {
    layers = $$('.h-hero').map((h) => $$('.sl > *', h).filter((c) => !c.children.length));
    layers.forEach((l) => l.forEach((c) => c.classList.add('kc')));
    wts = (layers[0] || []).map(() => 600);
  };
  addEventListener('resize', () => { layers = []; });

  let lastY = scrollY, lastT = performance.now(), vel = 0, dirSign = 1, maniK = -1, stepK = -1, fwK = -1;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(Math.max(now - lastT, 1), 60); lastT = now;
    const y = scrollY, vh = innerHeight, raw = clamp((y - lastY) / dt, -6, 6); lastY = y;
    vel += (raw - vel) * (1 - Math.exp(-dt / 120));
    if (Math.abs(raw) > 0.02) dirSign = Math.sign(raw);

    if (mani) {
      const r = mani.getBoundingClientRect();
      if (r.bottom > -vh && r.top < vh * 2) {
        // ≤1920px блюр убираем раньше: текст должен быть чётким, пока секция читается, а не после того, как она уехала
        const early = innerWidth <= 1920;
        const start = early ? vh * 0.85 : vh * 0.82, denom = early ? r.height * 0.55 + vh * 0.22 : r.height + vh * 0.32;
        const p = clamp((start - r.top) / denom, 0, 1), k = Math.round(p * (words.length + 2));
        if (k !== maniK) { maniK = k; words.forEach((w, i) => w.classList.toggle('on', i < k)); }
      }
    }
    for (const b of bands) {
      const r = b.el.getBoundingClientRect();
      if (r.bottom < -50 || r.top > vh + 50) continue;
      const half = b.t.scrollWidth / 2; if (!half) continue;
      b.x = (((b.x + (0.07 * dirSign + vel * 0.55) * dt * b.dir) % half) + half) % half;
      b.sk += (clamp(vel * -5, -11, 11) - b.sk) * 0.12;
      b.t.style.transform = `translate3d(${(-b.x).toFixed(1)}px,0,0) skewX(${b.sk.toFixed(2)}deg)`;
    }
    if (steps) {
      const r = steps.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) {
        const p = clamp((vh * 0.86 - r.top) / (vh * 0.5), 0, 1), k = Math.round(p * 100);
        if (k !== stepK) { stepK = k; steps.style.setProperty('--sp', p.toFixed(3)); stepEls.forEach((s, i) => s.classList.toggle('on', p > (i + 0.35) / stepEls.length)); }
      }
    }
    if (fw) {
      const r = fw.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) { const k = Math.round(clamp((vh - r.top) / (r.height * 1.25), 0, 1) * 100); if (k !== fwK) { fwK = k; fw.style.setProperty('--fw', 100 - k + '%'); } }
    }

    // буквы «тяжелеют» рядом с курсором
    if (fine && y < vh && html.classList.contains('ready')) {
      if (!layers.length && now - stamp > 400) { stamp = now; collect(); }
      const main = layers[0];
      if (main?.length) for (let i = 0; i < main.length; i++) {
        const r = main[i].getBoundingClientRect(), d = Math.hypot(mouse.x - (r.left + r.width / 2), mouse.y - (r.top + r.height / 2));
        const target = mouse.on ? 600 + 300 * Math.pow(clamp(1 - d / 300, 0, 1), 1.6) : 600;
        const w = wts[i] + (target - wts[i]) * 0.18;
        if (Math.abs(w - wts[i]) > 0.6 || (Math.abs(target - w) < 0.6 && wts[i] !== target)) {
          wts[i] = Math.abs(target - w) < 0.6 ? target : w;
          const v = wts[i] === 600 ? '' : `"wght" ${wts[i].toFixed(0)}`;
          for (const l of layers) if (l[i]) l[i].style.fontVariationSettings = v;
        }
      }
    }
  };
  requestAnimationFrame(frame);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
