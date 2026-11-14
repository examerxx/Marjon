import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { $, $$, initBase, initMotion } from './ui.js';

const html = document.documentElement;
const q = new URLSearchParams(location.search);

/* ---------- режимы ---------- */
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && q.get('motion') !== '1';
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
  if (lenis) lenis.scrollTo(target, { duration: 1.4 });
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
  if (useGL) {
    lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });
    lenis.on('scroll', ScrollTrigger.update);
    lenis.stop();
  }
  gsap.ticker.lagSmoothing(0);

  motion = initMotion({ scrollTo });

  // 3D
  if (useGL) {
    try {
      const [{ createScene }, { buildMaster, applyInitial }] = await Promise.all([import('./scene.js'), import('./story.js')]);
      world = createScene($('#gl'), { low, labels: $$('.bl') });
      applyInitial(world.S, world.beads);
      master = buildMaster(world.S, world.beads);
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
  let anchors = [[0, 0], [1, 6]], paperA = Infinity, paperB = -Infinity;
  const top = (sel) => $(sel).getBoundingClientRect().top + window.scrollY;
  const measure = () => {
    const vh = window.innerHeight, max = ScrollTrigger.maxScroll(window);
    const paper = $('#paper'), pt = top('#paper'), pb = pt + paper.offsetHeight;
    paperA = pt; paperB = pb - vh;
    anchors = [
      [0, 0], [top('#problem'), 1], [motion.pin.start, 2], [motion.pin.end, 2.8], [top('#live'), 3],
      [top('#roles'), 4], [top('#uzbekistan'), 5], [pt, 5.6], [pb - vh, 5.7], [Math.min(top('#contact'), max - 2), 5.96], [max, 6],
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
  const tick = (time, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 0.1);
    elapsed += dt;
    lenis?.raf(time * 1000);
    const y = window.scrollY;
    const tTarget = timeAt(y);
    tCur += (tTarget - tCur) * (1 - Math.exp(-dt * 7)); // scrub со сглаживанием
    if (Math.abs(tTarget - tCur) < 0.0004) tCur = tTarget;

    const ch = tCur < 0.55 ? 0 : tCur < 1.85 ? 1 : tCur < 2.9 ? 2 : tCur < 3.8 ? 3 : tCur < 4.8 ? 4 : tCur < 5.55 ? 5 : tCur > 5.72 ? 6 : -1;
    if (ch !== chapter) {
      chapter = ch;
      rail.forEach((r, i) => r.classList.toggle('on', i === ch));
      railEl.classList.toggle('off', ch === -1);
    }
    if (!world) return;
    master.time(tCur);
    const covered = y > paperA && y < paperB; // сцена целиком под бумажным блоком
    if (dbg) { dbg.t = tCur; if (dbg.pause) return; dbg.frames++; }
    if (!covered && !document.hidden) world.render(dt, elapsed, lenis?.velocity || 0);
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
  const loader = $('#loader'), nEl = $('[data-loader-n]'), barEl = $('[data-loader-bar]');
  const cnt = { v: 0 };
  const fontsReady = Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  const counted = new Promise((r) => gsap.to(cnt, { v: 100, duration: q.has('fast') ? 0.01 : 1.5, ease: 'power2.inOut', onUpdate: () => { nEl.textContent = Math.round(cnt.v); gsap.set(barEl, { scaleX: cnt.v / 100 }); }, onComplete: r }));
  await Promise.all([fontsReady, counted]);
  world?.render(0.016, 0, 0); // прогрев шейдеров под загрузчиком

  motion.intro();
  measure();
  tCur = timeAt(window.scrollY);
  gsap.to(loader, { yPercent: -100, duration: 1, ease: 'expo.inOut', onComplete: () => loader.remove() });
  if (world) gsap.to(world.S, { intro: 1, duration: 2.6, ease: 'expo.out', delay: 0.2 });
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
