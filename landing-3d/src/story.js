// Мастер-таймлайн. Время = номер главы: [0..1] hero → проблема, [2..2.8] проход по модулям и т.д.
// Раскадровка — в DESIGN.md §5. Таймлайн на паузе: его time ведёт скролл (main.js).
import gsap from 'gsap';

const TAU = Math.PI * 2;
const ring = (i, R, k = 1) => { const a = Math.PI / 2 - ((i * k) % 8) * (TAU / 8); return { x: Math.cos(a) * R, y: Math.sin(a) * R, z: 0 }; };

// Раскладки: позиция и размер каждой из 8 бусин
const L = {
  // 0 — жемчужина в центре, остальные уходят по диагонали (как штрихи логотипа)
  hero: [
    { x: 0, y: 0, z: 0, s: 1.35 },
    { x: 2.5, y: 1.75, z: -1.6, s: 0.3 }, { x: 4.6, y: 3.3, z: -4, s: 0.22 }, { x: 6.4, y: 5.4, z: -8, s: 0.16 },
    { x: -1, y: 7, z: -15, s: 0.12 },
    { x: -7, y: -5, z: -7, s: 0.16 }, { x: -4.6, y: -3.3, z: -3.4, s: 0.22 }, { x: -2.4, y: -1.75, z: -1.2, s: 0.3 },
  ],
  // 1 — нить порвана: бусины врассыпную
  scatter: [
    { x: -3.4, y: 1.7, z: 0.5, s: 0.52 }, { x: 2.9, y: 2.3, z: -1.5, s: 0.42 }, { x: 4.6, y: -0.7, z: 0.8, s: 0.36 }, { x: 1.3, y: -2.2, z: 1.5, s: 0.56 },
    { x: -1.5, y: -1.3, z: -2.6, s: 0.3 }, { x: -4.8, y: -1.9, z: -0.6, s: 0.46 }, { x: 0.3, y: 3, z: -3, s: 0.38 }, { x: -0.5, y: 0.3, z: 2.2, s: 0.6 },
  ],
  // 2 — бусины в линию, нить продевается
  line: Array.from({ length: 8 }, (_, i) => ({ x: (i - 3.5) * 2.4, y: Math.sin(i * 0.9) * 0.34, z: Math.cos(i * 1.3) * 0.4, s: 0.52 })),
  // 3 — кольцо
  ring: Array.from({ length: 8 }, (_, i) => ({ ...ring(i, 3), s: 0.44 })),
  // 4 — орбита (то же кольцо, но rig лежит плашмя)
  orbit: Array.from({ length: 8 }, (_, i) => ({ ...ring(i, 3.2), s: 0.4 })),
  // 5 — звезда {8/3}: мотив гириха; при tension = 0 нить становится ломаной
  star: Array.from({ length: 8 }, (_, i) => ({ ...ring(i, 3.2, 3), s: 0.3 })),
  // 6 — одна жемчужина и тесный ореол
  pearl: [{ x: 0, y: 0, z: 0, s: 1.7 }, ...Array.from({ length: 7 }, (_, j) => ({ ...ring(j + 1, 2.7), s: 0.1 }))],
};

export function applyInitial(S, beads) {
  beads.forEach((b, i) => Object.assign(b.st, L.hero[i], { dull: 0, lit: i === 0 ? 0.12 : 0.3, dark: 0 }));
}

export function buildMaster(S, beads) {
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } });
  // «к моменту at прийти в состояние»: старт за dur до этого
  const cam = (at, dur, vars, ease) => tl.to(S, { ...vars, duration: dur, ...(ease ? { ease } : {}) }, at - dur);
  const lay = (at, dur, layout, extra = {}, stagger = 0) =>
    beads.forEach((b, i) => tl.to(b.st, { ...layout[i], ...extra, duration: dur - stagger * 7 }, at - dur + stagger * i));

  // ── 0 → 1  нить рвётся ─────────────────────────────────────────────
  lay(1, 1, L.scatter, { dull: 1, lit: 0 });
  cam(1, 1, { camX: 0, camY: 0.4, camZ: 10.5, roll: 0.14, ox: 0.12, oy: 0, oyM: -0.05, ry: 0.5, rx: 0.1, drift: 1, coral: 1, glow: 0.7, dust: 0.9, pulse: 0 });
  tl.to(S, { threadA: 0, duration: 0.45, ease: 'power2.in' }, 0.05);
  tl.to(S, { draw: 0, duration: 0.5, ease: 'power2.in' }, 0.1);
  // 1 → 1.55  хаос держится и медленно поворачивается
  cam(1.55, 0.55, { ry: 1.0, roll: -0.08, camZ: 9.6 }, 'none');

  // ── 1.55 → 2  выстраиваются в линию (ещё тусклые) ──────────────────
  lay(2, 0.45, L.line);
  cam(2, 0.45, { camX: L.line[0].x + 2.2, camY: 0.6, camZ: 8.6, tx: L.line[0].x, roll: 0, ox: -0.04, oy: 0.04, oyM: -0.04, rx: 0, ry: 0, drift: 0.2, coral: 0.25, glow: 0.8, fit: 0.42, labels: 1, dust: 0.5 });
  tl.set(S, { threadA: 1 }, 1.95);

  // ── 2 → 2.8  камера едет вдоль нити, бусины загораются по одной ────
  tl.to(S, { camX: L.line[7].x + 2.2, tx: L.line[7].x, draw: 7 / 8, coral: 0, glow: 1, duration: 0.8, ease: 'none' }, 2);
  beads.forEach((b, i) => {
    const t = 2 + i * 0.1;
    tl.to(b.st, { dull: 0, lit: 1, s: 0.66, duration: 0.07, ease: 'power2.out' }, Math.max(2, t - 0.04));
    if (i < 7) tl.to(b.st, { lit: 0.3, s: 0.52, duration: 0.1 }, t + 0.1);
  });

  // ── 2.8 → 3  нить замыкается в кольцо ───────────────────────────────
  lay(3, 0.2, L.ring, { lit: 0.35 });
  cam(3, 0.2, { camX: 0, camY: 0, camZ: 11.5, tx: 0, ox: 0.2, oy: 0, oyM: 0.12, rx: -0.3, ry: -0.35, draw: 1, labels: 0, fit: 1, pulse: 1, drift: 0.3 });
  // 3 → 3.6  кольцо вращается скроллом
  cam(3.6, 0.6, { rz: -1.1, ry: -0.2 }, 'none');

  // ── 3.6 → 4  кольцо ложится в орбиту ────────────────────────────────
  lay(4, 0.4, L.orbit, { lit: 0.25 });
  cam(4, 0.4, { camY: 1.2, camZ: 11, rx: -1.12, ry: 0, rz: -1.6, ox: 0.24, oy: 0.1, oyM: 0.2, pulse: 0.7, dialAmt: 1, glow: 0.8 });
  cam(4.55, 0.55, { rz: -2.2 }, 'none');

  // ── 4.55 → 5  нить натягивается в восьмиконечную звезду ─────────────
  lay(5, 0.45, L.star, { lit: 0.6 });
  cam(5, 0.45, { camY: 0, camZ: 12, rx: 0, ry: 0.25, rz: -TAU / 2, ox: 0.26, oy: 0.02, oyM: 0.12, tension: 0, threadA: 0.75, pulse: 0.5, dialAmt: 0, glow: 1.1, drift: 0.12 });
  // 5 → 5.7  звезда медленно вращается (и уходит под бумажный блок)
  cam(5.7, 0.7, { rz: -TAU / 2 - 0.9, ry: -0.15 }, 'none');

  // ── 5.7 → 6  всё стягивается в одну чёрную жемчужину ────────────────
  lay(6, 0.3, L.pearl, { lit: 0.5 });
  tl.to(beads[0].st, { dark: 1, lit: 0.55, duration: 0.3 }, 5.7);
  cam(6, 0.3, { camY: 0.2, camZ: 8.4, rx: -1.25, ry: 0.2, rz: -TAU / 2 - 1.6, ox: 0, oy: 0.02, oyM: 0, tension: 0.5, threadA: 1, pulse: 1, glow: 1.3, drift: 0.2, bloom: 0.6 });

  return tl;
}
