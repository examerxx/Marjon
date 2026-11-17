// Общие эффекты: «умный» блюр (зависит от места блока на экране и скорости скролла),
// инерция блоков при прокрутке, прогрессивный блюр у кромок экрана, шапка-инверсия
import './fx.css';

const reduced = new URLSearchParams(location.search).get('motion') === '0'; // анимация всегда, prefers-reduced-motion игнорируем по просьбе владельца
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const init = () => {
  const html = document.documentElement;
  html.classList.add('fx'); // шапка
  // телефон: родная прокрутка без покадрового блюра и инерции блоков — иначе страница дёргается
  const lite = matchMedia('(pointer: coarse)').matches || innerWidth < 820;
  html.classList.toggle('lite', lite);
  if (reduced || lite) return;

  // блюр у кромок: сверху и снизу
  const edge = (cls) => { const el = document.createElement('div'); el.className = 'fx-edge ' + cls; el.setAttribute('aria-hidden', 'true'); el.innerHTML = '<i></i><i></i><i></i><i></i>'; document.body.appendChild(el); return el; };
  const top = edge('is-top'), bottom = edge('is-bottom');
  // у пиннутых секций (демо, «Возможности») прогресс-полоса прижата к низу экрана — прогрессивный блюр кромки её мылит, поэтому на время пина кромку гасим
  let pinOn = false;
  const pinEls = [...document.querySelectorAll('.demo-pin, .mod-pin')];
  if (pinEls.length && 'IntersectionObserver' in window) {
    const pinIO = new IntersectionObserver((es) => { // гасим кромку, пока виден хотя бы один пин
      for (const e of es) e.target.__pinOn = e.isIntersecting;
      pinOn = pinEls.some((el) => el.__pinOn);
    }, { threshold: 0 });
    for (const el of pinEls) pinIO.observe(el);
  }

  // блоки: «листовые» элементы; закреплённые сцены пропускаем (там своя анимация)
  const SEL = 'h1, h2, h3, h4, p, li, figure, blockquote, dl, table, .btn, [class*="card"], [class*="stat"], [class*="tile"]';
  const SKIP = '.nav, .menu, #loader, .demo-pin, .mod-pin, .stage, .fx-edge, [data-nofx], #lead'; // модалку не «умно-размываем»: её позиции измеряются, когда она скрыта, и подставляется блюр 12px
  const all = [...document.querySelectorAll(SEL)].filter((el) => !el.closest(SKIP));
  const set = new Set(all);
  const items = all.filter((el) => { for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; })
    .map((el, i) => ({ el, depth: 0.35 + ((i * 0.618034) % 1) * 0.65, y: 0, b: 0, on: false, top: 0, h: 0 }));
  const byEl = new Map(items.map((it) => [it.el, it]));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { for (const e of es) { const it = byEl.get(e.target); it.on = e.isIntersecting; if (!it.on) reset(it); } }, { rootMargin: '12% 0px 12% 0px' });
    for (const it of items) { it.el.classList.add('fx-b'); io.observe(it.el); }
  }
  // положение блоков на странице измеряем один раз (и при изменении вёрстки), а не в каждом кадре:
  // чтение getBoundingClientRect во время прокрутки заставляло браузер пересчитывать вёрстку
  let mT = 0;
  const measure = () => { const y0 = scrollY; for (const it of items) { const r = it.el.getBoundingClientRect(); it.top = r.top + y0 - it.y; it.h = r.height; } };
  const remeasure = () => { clearTimeout(mT); mT = setTimeout(() => { measure(); wake(); }, 140); };
  measure();
  addEventListener('resize', remeasure); addEventListener('load', remeasure); document.fonts?.ready?.then(remeasure);
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.body);
  const reset = (it) => { if (it.b) { it.el.style.filter = ''; it.b = 0; } if (it.y) { it.el.style.translate = ''; it.y = 0; } };

  let lastY = scrollY, lastT = performance.now(), vel = 0, raf = 0, idle = 0;
  const frame = (now) => {
    const dt = Math.max(now - lastT, 1); lastT = now;
    const y = scrollY, vh = innerHeight, max = html.scrollHeight - vh;
    const raw = clamp((y - lastY) / dt, -6, 6); lastY = y; // px/мс
    vel += (raw - vel) * (1 - Math.exp(-dt / 110));
    const speed = Math.min(Math.abs(vel) / 3, 1);
    // у самого верха и самого низа страницы кромки «отпускают» — первый экран и футер остаются резкими
    const kTop = clamp(y / 260, 0, 1), kBot = clamp((max - y) / 260, 0, 1);
    top.classList.toggle('off', y < 60); bottom.classList.toggle('off', y < vh * 0.35 || max - y < 80 || pinOn);
    for (const it of items) {
      if (!it.on) continue;
      const t0 = it.top - y, b0 = t0 + it.h;
      // 0 в зоне фокуса, 1 — у кромки экрана
      const fb = (1 - clamp((vh - t0) / (vh * 0.24), 0, 1)) * kBot * clamp(y / 260, 0, 1);
      const ft = (1 - clamp(b0 / (vh * 0.2), 0, 1)) * kTop;
      const blur = Math.pow(Math.max(fb, ft), 1.35) * 12 + speed * speed * 2.2 * it.depth;
      if (Math.abs(blur - it.b) > 0.12) { it.b = blur < 0.2 ? 0 : blur; it.el.style.filter = it.b ? `blur(${it.b.toFixed(2)}px)` : ''; }
      // инерция: блоки чуть отстают от скролла, каждый на свою «глубину» (то, что ведёт GSAP, не трогаем)
      const ty = it.el._gsap ? 0 : clamp(vel * it.depth * 22, -48, 48);
      if (Math.abs(ty - it.y) > 0.1) { it.y = Math.abs(ty) < 0.15 ? 0 : ty; it.el.style.translate = it.y ? `0 ${it.y.toFixed(1)}px` : ''; }
    }
    idle = Math.abs(vel) < 0.004 && raw === 0 ? idle + 1 : 0;
    raf = idle > 20 ? 0 : requestAnimationFrame(frame);
  };
  const wake = () => { if (!raf) { idle = 0; lastT = performance.now(); lastY = scrollY; raf = requestAnimationFrame(frame); } };
  addEventListener('scroll', wake, { passive: true }); addEventListener('resize', wake);
  wake();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
