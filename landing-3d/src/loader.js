// Экран загрузки «Открываем смену» — три варианта одного стиля (?loader=1|2|3):
//   1 — вордмарк заливается, занавес уходит колонками
//   2 — буквы наполняются живой волной и становятся окнами в страницу, камера влетает в букву
//   3 — слово собирается из срезов на фоне бегущих строк, выход — жалюзи
import gsap from 'gsap';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function createLoader(fast) {
  const loader = $('#loader');
  if (!loader) return { run: async () => {}, reveal: () => {} };
  const v = +document.documentElement.dataset.loader || 2;
  const nEl = $('[data-loader-n]'), barEl = $('[data-loader-bar]'), lis = $$('[data-ld-li]'), statusEl = $('[data-ld-status]'), clockEl = $('[data-ld-clock]');
  const cnt = { v: 0 };
  const clock = () => { clockEl.textContent = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Tashkent', hour12: false }); };
  clock(); const clockT = setInterval(clock, 1000);
  let ok = 0, raf = 0;

  /* ---------- вариант 1 ---------- */
  const v1 = {
    intro() { gsap.from('.ld-w-out span', { yPercent: 110, duration: 0.9, ease: 'expo.out', stagger: 0.045 }); },
    update(p) { $('[data-ld-fill]').style.clipPath = `inset(${(100 - p).toFixed(2)}% 0 0 0)`; },
    outro: () => { gsap.set('.ld-w-out', { opacity: 0 }); return gsap.timeline()
      .fromTo('.ld-word', { scale: 1 }, { scale: 1.04, duration: 0.35, ease: 'power2.out' }, 0)
      .to('.ld-top, .ld-bot, .loader-bar', { opacity: 0, duration: 0.3 }, 0.3)
      .to('.ld-glow', { opacity: 0, duration: 0.6 }, 0.35)
      .to('.ld-w span', { yPercent: -125, duration: 0.7, ease: 'expo.in', stagger: { each: 0.035 } }, 0.35); },
    reveal: (done) => gsap.to('.ld-cols i', { scaleY: 0, duration: 0.95, ease: 'expo.inOut', stagger: { each: 0.07, from: 'center' }, onComplete: done }),
  };

  /* ---------- вариант 2: жидкость ---------- */
  const v2 = (() => {
    const out = $('[data-ld2-out]'), hole = $('[data-ld2-hole]'), w1 = $('[data-ld2-w1]'), w2 = $('[data-ld2-w2]'), bubG = $('[data-ld2-bub]');
    const st = { p: 0, amp: 1, t: 0 };
    let bubbles = [];
    const wave = (box, level, phase, amp, len) => {
      const x0 = box.x - 40, x1 = box.x + box.width + 40, bottom = box.y + box.height + 40;
      let d = `M${x0},${bottom} L${x0},${level}`;
      for (let x = x0; x <= x1; x += 14) d += ` L${x.toFixed(1)},${(level + Math.sin((x / len) * Math.PI * 2 + phase) * amp + Math.sin((x / (len * 0.37)) * Math.PI * 2 - phase * 1.7) * amp * 0.35).toFixed(1)}`;
      return d + ` L${x1},${bottom} Z`;
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      st.t += 0.016;
      const box = out.getBBox(); if (!box.width) return;
      const level = box.y + box.height * (1 - st.p / 100) - (st.p > 0 && st.p < 100 ? 0 : st.p >= 100 ? 30 : -30);
      const amp = 0, len = box.width / 2.2; // строгая заливка: ровный уровень, без волны и пузырей
      w1.setAttribute('d', wave(box, level, st.t * 3.1, amp, len));
      w2.setAttribute('d', wave(box, level - amp * 0.9, -st.t * 2.2 + 1.3, amp * 1.25, len * 1.4));
      if (false) bubbles = Array.from({ length: 16 }, (_, i) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); bubG.appendChild(c); return { c, x: (i * 0.618) % 1, y: (i * 0.37) % 1, r: 2 + (i % 4) * 1.6, s: 0.25 + ((i * 0.29) % 1) * 0.5 }; });
      for (const b of bubbles) {
        b.y -= b.s * 0.016; if (b.y < 0) b.y = 1;
        const cy = box.y + box.height * b.y;
        b.c.setAttribute('cx', (box.x + box.width * b.x + Math.sin(st.t * 2 + b.x * 20) * 6).toFixed(1)); b.c.setAttribute('cy', cy.toFixed(1));
        b.c.setAttribute('r', cy > level + 8 ? b.r : 0);
      }
    };
    return {
      intro() { frame(); gsap.from(out, { opacity: 0, duration: 0.8 }); gsap.from('[data-ld2-glow]', { opacity: 0, duration: 1.2 }); },
      update(p) { st.p = p; },
      outro: () => gsap.timeline()
        .to(st, { amp: 0, duration: 0.45, ease: 'power2.out' }, 0)
        .to('.ld-top, .ld-bot, .loader-bar', { opacity: 0, duration: 0.3 }, 0.25)
        // буквы становятся окнами: жидкость растворяется, сквозь слово видна страница
        .add(() => hole.setAttribute('fill', '#000'), 0.5)
        .to('[data-ld2-ink]', { opacity: 0, duration: 0.45, ease: 'power2.inOut' }, 0.5)
        .to('[data-ld2-glow]', { opacity: 0, duration: 0.4 }, 0.5),
      reveal(done) {
        cancelAnimationFrame(raf);
        // влетаем в ножку буквы «M»: отверстие раскрывается на весь экран.
        // Без «чёрной паузы»: окно растёт сразу и быстро, а сам занавес к концу растворяется,
        // так что сцена под ним (она уже проявляется) видна без провала в темноту.
        const fs = parseFloat(getComputedStyle(hole).fontSize), e = hole.getExtentOfChar(0);
        const ox = e.x + fs * 0.15, oy = e.y + e.height * 0.56;
        gsap.to(hole, { scale: 130, svgOrigin: `${ox} ${oy}`, duration: 0.95, ease: 'power3.in' });
        gsap.to(loader, { opacity: 0, duration: 0.5, delay: 0.5, ease: 'power1.out', onComplete: done });
      },
    };
  })();

  /* ---------- вариант 3: срезы и жалюзи ---------- */
  const v3 = (() => {
    const slices = $$('.ld3-s'), N = slices.length;
    const off = slices.map((_, i) => (i % 2 ? 1 : -1) * (18 + ((i * 7) % 5) * 9)); // vw
    return {
      intro() { gsap.from(slices, { opacity: 0, duration: 0.5, stagger: 0.04 }); gsap.from('.ld3-mq p', { opacity: 0, xPercent: (i) => (i % 2 ? 6 : -6), duration: 1.4, ease: 'expo.out', stagger: 0.1 }); },
      update(p) {
        const k = p / 100;
        slices.forEach((s, i) => {
          // срезы съезжаются по очереди снизу вверх и «защёлкиваются», заливка идёт следом
          const local = Math.min(Math.max((k * 1.25 - ((N - 1 - i) / N) * 0.55) / 0.7, 0), 1), e = 1 - Math.pow(1 - local, 3);
          s.style.transform = `translate3d(${(off[i] * (1 - e)).toFixed(2)}vw,0,0)`;
          s.lastChild.style.opacity = Math.min(Math.max((local - 0.72) / 0.28, 0), 1);
        });
      },
      outro: () => gsap.timeline()
        .fromTo('.ld3-word', { scale: 1 }, { scale: 1.035, duration: 0.3, ease: 'power2.out' }, 0)
        .to('.ld-top, .ld-bot, .loader-bar', { opacity: 0, duration: 0.3 }, 0.25)
        .to('.ld3-mq', { opacity: 0, duration: 0.4 }, 0.3)
        .to({}, { duration: 0.15 }),
      reveal(done) {
        gsap.to(slices, { xPercent: (i) => (i % 2 ? 130 : -130), duration: 0.9, ease: 'expo.in', stagger: 0.025 });
        gsap.to('.ld3-strips i', { xPercent: (i) => (i % 2 ? 101 : -101), duration: 1.05, ease: 'expo.inOut', stagger: 0.05, delay: 0.3, onComplete: done });
      },
    };
  })();

  const V = [v1, v2, v3][v - 1] || v2;
  const finish = () => { clearInterval(clockT); cancelAnimationFrame(raf); loader.remove(); };

  return {
    async run(ready, warm, onOutro) {
      if (!fast) { V.intro(); gsap.from('.ld-top, .ld-bot', { opacity: 0, duration: 0.6, delay: 0.15 }); }
      const counted = new Promise((r) => gsap.to(cnt, { v: 100, duration: fast ? 0.01 : v === 1 ? 2.3 : 2.8, ease: 'power2.inOut', delay: fast ? 0 : 0.25, onComplete: r, onUpdate: () => {
        nEl.textContent = Math.round(cnt.v); gsap.set(barEl, { scaleX: cnt.v / 100 });
        if (!fast) V.update(cnt.v);
        while (ok < lis.length && cnt.v >= ((ok + 1) / lis.length) * 96) lis[ok++].classList.add('ok');
      } }));
      await Promise.all([ready, counted]);
      warm?.();
      onOutro?.(); // страница начинает проявляться уже под занавесом
      if (!fast) { statusEl.textContent = statusEl.dataset.done; await V.outro(); }
    },
    reveal() { if (fast) finish(); else V.reveal(finish); },
  };
}
