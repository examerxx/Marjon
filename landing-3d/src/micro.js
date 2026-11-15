// Микроанимации: магнитные кнопки, свет и наклон карточек за курсором, курсор-спутник
import './micro.css';

const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !new URLSearchParams(location.search).has('motion');
const init = () => {
  if (!fine || reduced) return;
  const HOT = 'a, button, summary, .btn, [role="tab"], .role-tab, .mod-b';
  const SPOT = '.btn, .card, .step, .feat, .stat, .iq';

  // свет за курсором (+ наклон карточек, + магнит кнопок) — одно делегированное событие
  let cur = null;
  const leave = (el) => {
    el.classList.remove('is-mag', 'is-tilt');
    for (const p of ['--mx', '--my', '--rx', '--ry']) el.style.removeProperty(p);
  };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.(SPOT);
    if (cur && cur !== el) { leave(cur); cur = null; }
    if (!el) return;
    cur = el;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty('--px', x + 'px'); el.style.setProperty('--py', y + 'px');
    const nx = x / r.width - 0.5, ny = y / r.height - 0.5;
    if (el.classList.contains('btn')) {
      el.classList.add('is-mag');
      el.style.setProperty('--mx', (nx * 14).toFixed(1) + 'px'); el.style.setProperty('--my', (ny * 10).toFixed(1) + 'px');
    } else if (el.matches('.pain, .role-p')) {
      el.classList.add('is-tilt');
      el.style.setProperty('--rx', (-ny * 5).toFixed(2) + 'deg'); el.style.setProperty('--ry', (nx * 6).toFixed(2) + 'deg');
    }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (cur) { leave(cur); cur = null; } });

  // курсор-спутник
  const ring = document.createElement('i');
  ring.className = 'cur-ring'; ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0, seen = false;
  const loop = () => {
    x += (tx - x) * 0.16; y += (ty - y) * 0.16;
    ring.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.2 ? requestAnimationFrame(loop) : 0;
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tx = e.clientX; ty = e.clientY;
    if (!seen) { seen = true; x = tx; y = ty; ring.classList.add('on'); }
    ring.classList.toggle('is-hot', !!e.target.closest?.(HOT));
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  addEventListener('pointerdown', () => ring.classList.add('is-down'));
  addEventListener('pointerup', () => ring.classList.remove('is-down'));
  document.documentElement.addEventListener('mouseleave', () => ring.classList.remove('on'));
  document.documentElement.addEventListener('mouseenter', () => seen && ring.classList.add('on'));
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
