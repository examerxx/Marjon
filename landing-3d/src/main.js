import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './style.css';
import './fx.js';
import './micro.js';
import './plus.js';
import './lead.js';
import './mobile.css';
import { createLoader } from './loader.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { $, $$, initBase, initMotion, initSwitch } from './ui.js';
import { initDemo } from './demo.js';

const html = document.documentElement;
const q = new URLSearchParams(location.search);

/* ---------- режимы ---------- */
const reduced = q.get('motion') === '0'; // анимация всегда; ?motion=0 — принудительный фолбэк
const hasWebGL = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
const weak = navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2 || navigator.connection?.saveData === true;
// ?gl=0 / ?gl=1 — принудительно выключить/включить 3D (для проверки фолбэка)
const useGL = q.get('gl') === '1' || (q.get('gl') !== '0' && hasWebGL && !weak && !reduced);
const low = q.get('q') === 'low' || matchMedia('(pointer: coarse)').matches || window.innerWidth < 820; // мобильный профиль качества
const dbg = q.has('debug') ? (window.__m = { pause: false, frames: 0 }) : null; // ?debug — хук для скриншот-тестов
html.classList.toggle('no-gl', !useGL);
html.classList.toggle('static', reduced);

let lenis = null, world = null, master = null, motion = null;
const scrollTo = (target) => {
  if (lenis && !lenis.isStopped) lenis.scrollTo(target, { duration: 1.4 }); // lenis остановлен (загрузчик) — нативный фолбэк
  else if (typeof target === 'number') window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
  else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
};

const stopBase = initBase({
  scrollTo,
  onRole: (i, panel) => {
    if (reduced) return;
    gsap.fromTo(panel, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out' });
    if (world) gsap.to(world.S, { dial: i * (Math.PI / 4), duration: 1.4, ease: 'power3.inOut' });
  },
});

if (reduced) {
  $('#loader')?.remove();
} else {
  boot();
}

async function boot() {
  gsap.registerPlugin(ScrollTrigger);

  // Lenis ведёт скролл, тик получает от gsap.ticker (один цикл на всё)
  if (!reduced) {
    const touch = matchMedia('(pointer: coarse)').matches; // на телефоне — родная прокрутка системы: привычная скорость и инерция
    lenis = new Lenis({ lerp: 0.06, wheelMultiplier: 1, prevent: () => false, smoothWheel: true, syncTouch: !touch, syncTouchLerp: 0.08, touchInertiaMultiplier: 28 });/* длинное «скольжение» с инерцией */
    lenis.on('scroll', ScrollTrigger.update);
    lenis.stop();
  }
  window.addEventListener('lead:open', () => lenis?.stop()); window.addEventListener('lead:close', () => lenis?.start());
  gsap.ticker.lagSmoothing(0);

  motion = initMotion({ scrollTo });
  initSwitch({ scrollTo });
  initDemo(); // после initMotion: pin модулей стоит выше по странице

  // 3D
  if (useGL) {
    try {
      const [{ createScene }, { buildMaster, applyInitial }] = await Promise.all([import('./scene.js'), import('./story.js')]);
      const dev = html.classList.contains('v-ah'), phoneOnly = matchMedia('(pointer: coarse)').matches && Math.max(screen.width, screen.height) < 900; // на телефоне техники в сцене нет — не грузим её модели и снимки
      const addon = dev && !phoneOnly ? (await import('./devices.js')).createDevices : null;
      world = createScene($('#gl'), { low, labels: $$('.bl'), addon });
      applyInitial(world.S, world.beads, dev);
      master = buildMaster(world.S, world.beads, dev);
      master.progress(1).progress(0); // прогон: фиксируем стартовые значения всех твинов
      world.S.intro = 0;
    } catch (err) {
      console.warn('[marjon] 3D недоступно, показываю постер', err);
      html.classList.add('no-gl');
      world = null;
    }
  }

  /* ---------- скролл → время мастер-таймлайна ---------- */
  // Опорные точки [scrollY, time]. Пересчитываются на каждом refresh (resize, шрифты, pin).
  let anchors = [[0, 0], [1, 6]], paperA = Infinity, paperB = -Infinity, rsY = null; // rsY — центры шагов «Ролей» (версия с устройствами)
  const rsEls = $$('[data-rs]');
  const top = (sel) => $(sel).getBoundingClientRect().top + window.scrollY;
  const measure = () => {
    const vh = window.innerHeight, max = ScrollTrigger.maxScroll(window);
    const paper = $('#paper'), pt = top('#platforms'), pb = top('#paper') + paper.offsetHeight; // демо + бумага закрывают сцену
    paperA = pt; paperB = pb - vh;
    if (world) world.S.band = (vh - ($('.foot')?.offsetHeight || 0)) / vh; // свободная полоса над футером в самом низу страницы
    rsY = rsEls.length ? rsEls.map((el) => el.getBoundingClientRect().top + window.scrollY + el.offsetHeight / 2 - vh / 2) : null;
    anchors = [
      [0, 0], [top('#problem'), 1], [motion.pin.start, 2], [motion.pin.end, 2.8], [top('#live'), 3],
      [top('#roles'), 4], ...(rsY ? [[rsY[rsY.length - 1], 4.5]] : []), [top('#uzbekistan'), 5], [pt, 5.6], [pb - vh, 5.7], [Math.min(top('#contact'), max - 2), 5.96], [max, 6],
    ];
    for (let i = 1; i < anchors.length; i++) anchors[i][0] = Math.max(anchors[i][0], anchors[i - 1][0] + 1);
  };
  const timeAt = (y) => {
    for (let i = 1; i < anchors.length; i++) {
      const [y1, t1] = anchors[i], [y0, t0] = anchors[i - 1];
      if (y <= y1) return t0 + ((y - y0) / (y1 - y0)) * (t1 - t0);
    }
    return 6;
  };
  ScrollTrigger.addEventListener('refresh', measure);

  /* ---------- единственный рендер-цикл ---------- */
  const rail = $$('.rail-i'), railEl = $('.rail'), inkEl = $('.h-hero-ink');
  let tCur = 0, chapter = -2, elapsed = 0;
  const demoEl = $('#platforms'), DPRS = low ? [1.5, 1.25, 1] : [1.5, 1.25, 1]; let perfT = 0, perfN = 0, perfL = 0;
  const tick = (time, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 0.1);
    elapsed += dt;
    lenis?.raf(time * 1000);
    const y = window.scrollY;
    const tTarget = timeAt(y);
    tCur += (tTarget - tCur) * (1 - Math.exp(-dt * 7)); // scrub со сглаживанием
    if (Math.abs(tTarget - tCur) < 0.0004) tCur = tTarget;
    if (dbg && dbg.force != null) tCur = dbg.force; // отладка: показать сцену в заданный момент раскадровки

    const ch = tCur < 0.55 ? 0 : tCur < 1.85 ? 1 : tCur < 2.9 ? 2 : tCur < 3.8 ? 3 : tCur < 4.8 ? 4 : tCur < 5.55 ? 5 : tCur > 5.72 ? 6 : -1;
    if (ch !== chapter) {
      chapter = ch;
      rail.forEach((r, i) => r.classList.toggle('on', i === ch));
      railEl.classList.toggle('off', ch === -1);
    }
    if (!world) return;
    master.time(tCur); world.S.t = tCur;
    if (rsY) { // какое устройство показывать в «Ролях»: 0 касса · 1 телефон · 2 панель
      let r = 0; for (let i = 1; i < rsY.length; i++) r += Math.min(Math.max((y - rsY[i - 1]) / (rsY[i] - rsY[i - 1]), 0), 1);
      const k = 1 - Math.exp(-dt * 6); world.S.role = (world.S.role ?? r) + (r - (world.S.role ?? r)) * k;
      if (dbg && dbg.role != null) world.S.role = dbg.role;
    }
    const covered = y > paperA && y < paperB; // сцена целиком под бумажным блоком
    if (dbg) { dbg.t = tCur; if (dbg.pause) return; dbg.frames++; }
    let hid = covered || document.hidden;
    if (!hid && demoEl) { const r = demoEl.getBoundingClientRect(); hid = r.top < -70 && r.bottom > window.innerHeight + 2; } // под непрозрачным демо сцену тоже не рисуем
    if (!hid) {
      world.render(dt, elapsed, lenis?.velocity || 0);
      // если кадры идут медленно — ступенчато снижаем плотность пикселей сцены
      if (elapsed > 5 && deltaMs < 200) { perfT += deltaMs; if (++perfN >= 80) { if (perfT / perfN > 24 && perfL < DPRS.length) world.setMaxDpr(DPRS[perfL++]); perfT = perfN = 0; } }
    }
    if (y < window.innerHeight) { // тёмный слой H1 — только внутри круга жемчужины
      const r = inkEl.getBoundingClientRect(), p = world.pearl;
      inkEl.style.setProperty('--px', (p.x - r.left).toFixed(1) + 'px');
      inkEl.style.setProperty('--py', (p.y - r.top).toFixed(1) + 'px');
      inkEl.style.setProperty('--pr', Math.max(0, p.r - 1).toFixed(1) + 'px');
    }
  };
  gsap.ticker.add(tick);

  let rz;
  const onResize = () => { clearTimeout(rz); rz = setTimeout(() => world?.resize(), 120); };
  window.addEventListener('resize', onResize);

  /* ---------- загрузчик → intro ---------- */
  const fontsReady = Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  // смена языка: без экрана загрузки и с того же места страницы
  let ls = null; try { ls = JSON.parse(sessionStorage.getItem('mj-ls') || 'null'); sessionStorage.removeItem('mj-ls'); } catch {}
  const secs = () => $$('main section[id], .paper section[id]');
  $$('.lang a:not(.on)').forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const y = window.scrollY; let cur = null;
    secs().forEach((s) => { const top = s.getBoundingClientRect().top + y; if (top <= y + 2) cur = { id: s.id, f: (y - top) / Math.max(1, s.offsetHeight) }; });
    try { sessionStorage.setItem('mj-ls', JSON.stringify(cur || { id: '', f: 0 })); } catch {}
    html.classList.add('ls-out'); setTimeout(() => { location.href = a.href; }, 220);
  }));
  setTimeout(() => { const o = $('.lang a:not(.on)'); if (o) { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = o.href; document.head.append(l); } }, 4000);
  const ld = createLoader(q.has('fast') || !!ls);
  const warmed = world?.warm ? Promise.race([world.warm(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {}) : null; // прогрев 3D идёт, пока считает загрузчик
  // снимки в «живом демо» и рамках ролей декодируем заранее, а не в момент появления на экране
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 600));
  idle(() => $$('img').forEach((im) => { im.loading = 'eager'; im.decoding = 'async'; im.decode?.().catch(() => {}); }));
  await ld.run(Promise.all([fontsReady, warmed]), () => world?.render(0.016, 0, 0), // прогрев шейдеров под загрузчиком
    () => { if (world) gsap.to(world.S, { intro: 1, duration: 2.4, ease: 'expo.out' }); }); // сцена проявляется уже под занавесом — без чёрной паузы
  motion.intro();
  measure();
  if (ls?.id) { const s = document.getElementById(ls.id); if (s) { const y = s.getBoundingClientRect().top + window.scrollY + ls.f * s.offsetHeight; if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); window.scrollTo(0, y); ScrollTrigger.update(); } }
  if (ls && world) world.S.intro = 1;
  tCur = timeAt(window.scrollY);
  ld.reveal();
  lenis?.start();
  html.classList.add('ready');

  /* ---------- cleanup (HMR / уход со страницы) ---------- */
  const destroy = () => {
    gsap.ticker.remove(tick);
    window.removeEventListener('resize', onResize);
    ScrollTrigger.removeEventListener('refresh', measure);
    motion?.kill(); master?.kill(); lenis?.destroy(); world?.dispose(); stopBase();
  };
  if (import.meta.hot) import.meta.hot.dispose(destroy);
  window.addEventListener('pagehide', (e) => { if (!e.persisted) destroy(); });
}
