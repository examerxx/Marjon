// Микроанимации: магнитные кнопки, свет и наклон карточек за курсором, курсор-спутник
import './micro.css';

const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = new URLSearchParams(location.search).get('motion') === '0'; // анимация всегда
const init = () => {
  if (!fine || reduced) return;
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

};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
