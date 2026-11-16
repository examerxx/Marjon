// Общее ядро вариантов E и F: режимы, Lenis на gsap.ticker, загрузчик, появления, привязка скролла к «главе» сцены.
import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import '../style.css';
import './v.css';
import '../fx.js';
import '../micro.js';
import '../plus.js';
import '../lead.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { $, $$, initBase } from '../ui.js';
import { initDemo } from '../demo.js';
import { createLoader } from '../loader.js';

export function boot({ loadScene, motion }) {
  const html = document.documentElement, q = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !q.has('motion');
  const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  const useGL = q.get('gl') === '1' || (q.get('gl') !== '0' && hasGL && !reduced);
  const low = q.get('q') === 'low' || matchMedia('(pointer: coarse)').matches || window.innerWidth < 820;
  const dbg = q.has('debug') ? (window.__m = { pause: false, frames: 0 }) : null;
  html.classList.toggle('no-gl', !useGL); html.classList.toggle('static', reduced);
  let lenis = null;
  initBase({ scrollTo: (t) => (lenis ? lenis.scrollTo(t, { duration: 1.4 }) : typeof t === 'number' ? window.scrollTo(0, t) : t.scrollIntoView()) });
  if (reduced) { $('#loader')?.remove(); return; }

  (async () => {
    gsap.registerPlugin(ScrollTrigger, SplitText);
    ScrollTrigger.config({ ignoreMobileResize: true });
    lenis = new Lenis({ lerp: 0.06, wheelMultiplier: 1, prevent: () => false, smoothWheel: true, syncTouch: true, syncTouchLerp: 0.08, touchInertiaMultiplier: 28 });
    lenis.on('scroll', ScrollTrigger.update); lenis.stop();
    window.addEventListener('lead:open', () => lenis?.stop()); window.addEventListener('lead:close', () => lenis?.start());

    let world = null;
    if (useGL) {
      try { world = (await loadScene()).createScene($('#gl'), { low }); }
      catch (err) { console.warn('[marjon] 3D недоступно', err); html.classList.add('no-gl'); }
    }

    /* ---------- появления ---------- */
    const hero = $('#top');
    const rest = $$('[data-r]').filter((el) => !hero.contains(el));
    gsap.set(rest, { autoAlpha: 0, y: 44 });
    ScrollTrigger.batch(rest, { start: 'top 92%', once: true, onEnter: (b) => gsap.to(b, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.08, overwrite: true }) });
    $$('[data-split]').filter((el) => !hero.contains(el)).forEach((el) => SplitText.create($$('.ln', el), {
      type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, { yPercent: 112, duration: 1.25, ease: 'expo.out', stagger: 0.09, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
    }));
    $$('[data-count]').forEach((el) => {
      const o = { v: 0 }, to = +el.dataset.count;
      ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => gsap.to(o, { v: to, duration: 2, ease: 'expo.out', onUpdate: () => { el.textContent = Math.round(o.v); } }) });
    });
    const nav = $('#nav');
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => nav.classList.toggle('hide', self.direction === 1 && self.scroll() > innerHeight * 0.5 && !document.body.classList.contains('menu-open')) });

    initDemo();
    motion?.({ gsap, ScrollTrigger, $, $$ });

    /* ---------- скролл → «глава» сцены (непрерывное число) ---------- */
    const chs = $$('[data-c]'); let tops = [];
    const measure = () => { tops = chs.map((el) => [el.getBoundingClientRect().top + scrollY, +el.dataset.c]).sort((a, b) => a[0] - b[0]); };
    ScrollTrigger.addEventListener('refresh', measure);
    const chAt = (y) => {
      const yy = y + Math.min(y, innerHeight * 0.4);
      if (!tops.length || yy <= tops[0][0]) return tops[0]?.[1] || 0;
      for (let i = 1; i < tops.length; i++) if (yy <= tops[i][0]) return tops[i - 1][1] + ((yy - tops[i - 1][0]) / (tops[i][0] - tops[i - 1][0])) * (tops[i][1] - tops[i - 1][1]);
      return tops[tops.length - 1][1];
    };
    const covers = $$('.demo, .paper');
    let c = 0, elapsed = 0;
    gsap.ticker.add((time, dms) => {
      const dt = Math.min(dms / 1000, 0.1); elapsed += dt;
      lenis.raf(time * 1000);
      c += (chAt(scrollY) - c) * (1 - Math.exp(-dt * 5));
      if (!world || document.hidden || dbg?.pause) return;
      const vh = innerHeight;
      if (covers.some((el) => { const r = el.getBoundingClientRect(); return r.top <= 0 && r.bottom >= vh; })) return; // сцена полностью закрыта
      world.render(dt, elapsed, c, lenis.velocity || 0);
      if (dbg) dbg.frames++;
    });
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => world?.resize(), 120); });

    /* ---------- загрузчик → вступление ---------- */
    const fontsReady = Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    const ld = createLoader(q.has('fast'));
    await ld.run(fontsReady, () => world?.render(0.016, 0, 0, 0));
    $$('.h-hero', hero).forEach((el) => SplitText.create($$('.ln', el), {
      type: 'lines,chars', mask: 'lines', linesClass: 'sl', autoSplit: true,
      onSplit: (self) => gsap.from(self.chars, { yPercent: 115, duration: 1.2, ease: 'power4.out', stagger: 0.02, delay: 0.25 }),
    }));
    gsap.fromTo($$('[data-r]', hero), { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.1, delay: 0.8 });
    ScrollTrigger.sort(); ScrollTrigger.refresh(); measure();
    ld.reveal();
    lenis.start();
    html.classList.add('ready');
    addEventListener('pagehide', (e) => { if (!e.persisted) { lenis.destroy(); world?.dispose(); } });
  })();
}
