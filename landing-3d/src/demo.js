import gsap from 'gsap';
import './demo.css';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- живое демо: один scrub-таймлайн, интерфейс «играет» четыре сцены ---------- */
export function initDemo() {
  const pin = $('.demo-pin'); if (!pin) return;
  const small = window.innerWidth < 900, Z = small ? 1.45 : 1;
  const camEl = $('[data-cam]'), cur = $('[data-cur]'), caps = $$('[data-cap]'), stepEl = $('[data-step]');
  const cam = { s: 1, fx: 0.5, fy: 0.5 }, c = { x: 0.62, y: 1.12 };
  const ord = { n: 4, sum: 150000 }, kt = { s: 0 }, kpi = { v: 0 }, dot = { x: 24, y: 57.1 };
  const oc = $('[data-oc]'), os = $('[data-os]'), tkt = $('[data-tkt]'), kpiEl = $('[data-kpi]'), dotEl = $('[data-dot]');
  let step = -1;
  const apply = () => {
    const s = cam.s, tx = clamp((0.5 - cam.fx * s) * 100, (1 - s) * 100, 0), ty = clamp((0.5 - cam.fy * s) * 100, (1 - s) * 100, 0);
    // без transform: scale — иначе браузер растягивает слой, снятый в 1×, и картинка мылится
    camEl.style.left = tx + '%'; camEl.style.top = ty + '%'; camEl.style.width = camEl.style.height = s * 100 + '%'; camEl.style.setProperty('--z', s);
    cur.style.left = c.x * s * 100 + tx + '%'; cur.style.top = c.y * s * 100 + ty + '%';
    oc.textContent = Math.round(ord.n); os.textContent = fmt(ord.sum);
    tkt.textContent = `${pad(Math.floor(kt.s / 60))}:${pad(Math.floor(kt.s % 60))}`;
    kpiEl.textContent = fmt(kpi.v);
    dotEl.style.left = dot.x + '%'; dotEl.style.top = dot.y + '%';
  };
  const setStep = (i) => { if (i === step) return; step = i; stepEl.textContent = pad(i + 1); };

  // въезд: окно лежит «на столе» и поднимается к зрителю
  gsap.fromTo('.demo-stage', { rotateX: 46, scale: 0.7, yPercent: 14, transformPerspective: 1500 }, { rotateX: 0, scale: 1, yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.demo', start: 'top bottom', end: 'top top', scrub: true } });
  gsap.from('.demo-step, .caps', { autoAlpha: 0, y: -24, ease: 'none', scrollTrigger: { trigger: '.demo', start: 'top 60%', end: 'top top', scrub: true } });

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' }, onUpdate: apply,
    scrollTrigger: { trigger: pin, pin: true, start: 'top top', end: () => '+=' + window.innerHeight * (small ? 5 : 5.6), scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate: (st) => { gsap.set('[data-bar]', { scaleX: st.progress }); const t = st.progress * 10; setStep(t < 3.45 ? 0 : t < 5.2 ? 1 : t < 7 ? 2 : 3); } },
  });
  const capSwap = (at, a, b) => tl.to(caps[a], { autoAlpha: 0, y: -26, duration: 0.25 }, at).fromTo(caps[b], { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3 }, at + 0.2);
  const click = (at, hit) => tl.to(cur, { scale: 0.78, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.inOut' }, at - 0.07).fromTo(hit, { scale: 0.2, opacity: 1 }, { scale: 1.5, opacity: 0, duration: 0.4, ease: 'power2.out' }, at);
  const hits = $$('[data-hit]'), fly = $$('[data-fly]');
  const dish = [[0.337, 0.42, 8000], [0.219, 0.42, 40000], [0.572, 0.18, 35000]];

  gsap.set(caps, { autoAlpha: 0 }); gsap.set(caps[0], { autoAlpha: 1 });
  tl.to('[data-hint]', { autoAlpha: 0, duration: 0.3 }, 0.15);
  // 1 · касса: камера наезжает на меню, курсор набирает заказ
  tl.to(cam, { s: 1.75 * Z, fx: 0.4, fy: 0.36, duration: 0.8 }, 0.15)
    .to(c, { x: dish[0][0], y: dish[0][1], duration: 0.75, ease: 'power3.out' }, 0.2)
    .to('[data-order]', { autoAlpha: 1, y: 0, duration: 0.3 }, 0.5);
  let sum = 150000;
  dish.forEach(([x, y, price], i) => {
    const at = 1 + i * 0.52; sum += price;
    if (i) tl.to(c, { x, y, duration: 0.36, ease: 'power2.inOut' }, at - 0.4);
    click(at, hits[i]);
    tl.fromTo(fly[i], { opacity: 0, left: x * 100 + '%', top: y * 100 + '%', scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.12, ease: 'none' }, at + 0.02)
      .to(fly[i], { left: '88%', top: '70%', duration: 0.42, ease: 'power2.in' }, at + 0.12)
      .to(fly[i], { opacity: 0, scale: 0.5, duration: 0.1, ease: 'none' }, at + 0.46)
      .to(ord, { n: 5 + i, sum, duration: 0.3, ease: 'power1.out' }, at + 0.3)
      .fromTo('[data-order] strong', { scale: 1.25 }, { scale: 1, duration: 0.25, ease: 'power2.out' }, at + 0.45);
  });
  tl.to(cam, { s: 2.05 * Z, fx: 0.88, fy: 0.74, duration: 0.6 }, 2.4)
    .to(c, { x: 0.876, y: 0.875, duration: 0.5 }, 2.5);
  click(3.08, hits[3]);
  tl.fromTo('[data-sent]', { autoAlpha: 0, y: 24, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, 3.12);
  // 2 · кухня: заказ прилетает тикетом, таймер идёт
  capSwap(3.4, 0, 1);
  tl.to(cam, { s: 1, fx: 0.5, fy: 0.5, duration: 0.5 }, 3.4)
    .to(cur, { opacity: 0, duration: 0.2 }, 3.4)
    .to('[data-dim]', { opacity: 0.72, duration: 0.4 }, 3.45)
    .to('[data-order]', { autoAlpha: 0, y: 20, duration: 0.25 }, 3.45)
    .to('.d-kds p', { opacity: 1, duration: 0.2 }, 3.6)
    .fromTo('[data-tk]', { opacity: 0, y: 90, rotate: (i) => [-7, 5, -4][i], scale: 0.85 }, { opacity: 1, y: 0, rotate: (i) => [-2, 1.5, -1][i], scale: 1, duration: 0.45, stagger: 0.12, ease: 'back.out(1.3)' }, 3.6)
    .to(kt, { s: 252, duration: 1.1, ease: 'none' }, 3.75)
    .to('[data-sent]', { autoAlpha: 0, y: -16, duration: 0.2 }, 3.9)
    .to('[data-ready]', { opacity: 1, duration: 0.12, ease: 'none' }, 4.7)
    .fromTo($$('[data-tk]')[0], { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1 }, 4.7)
    .to('[data-tk]', { opacity: 0, y: -70, rotate: (i) => [-9, 6, -5][i], duration: 0.3, stagger: 0.06, ease: 'power2.in' }, 5.0)
    .to('.d-kds p', { opacity: 0, duration: 0.2 }, 5.0);
  // 3 · телефон официанта
  capSwap(5.15, 1, 2);
  tl.to('[data-win]', small ? { scale: 0.9, duration: 0.5 } : { xPercent: -14, scale: 0.84, duration: 0.5 }, 5.2)
    .fromTo('[data-phone]', { autoAlpha: 0, yPercent: 60, rotate: 12 }, { autoAlpha: 1, yPercent: 0, rotate: 0, duration: 0.6, ease: 'power3.out' }, 5.25)
    .fromTo('[data-pimg]', { yPercent: 0 }, { yPercent: 0, duration: 1.2, ease: 'power1.inOut' }, 5.6)
    .fromTo('[data-phit]', { scale: 0.2, opacity: 1 }, { scale: 1.4, opacity: 0, duration: 0.35, ease: 'power2.out' }, 6.4)
    .fromTo('[data-pchip]', { autoAlpha: 0, x: 30, scale: 0.85 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, 6.45)
    .to('[data-pchip]', { autoAlpha: 0, duration: 0.2 }, 6.95)
    .to('[data-phone]', { autoAlpha: 0, yPercent: 40, rotate: -8, duration: 0.4, ease: 'power2.in' }, 6.95);
  // 4 · дашборд владельца
  capSwap(7.0, 2, 3);
  tl.to('[data-win]', { xPercent: 0, scale: 1, duration: 0.5 }, 7.05)
    .to('[data-dim]', { opacity: 0, duration: 0.4 }, 7.1)
    .to('[data-dash]', { clipPath: 'inset(0 0 0 0%)', duration: 0.55, ease: 'power2.inOut' }, 7.1)
    .to('[data-wt="0"]', { opacity: 0, duration: 0.2 }, 7.1).to('[data-wt="1"]', { opacity: 1, duration: 0.2 }, 7.3)
    .to(cam, { s: 1.9 * Z, fx: 0.42, fy: 0.18, duration: 0.6 }, 7.5)
    .to(kpi, { v: 118024000, duration: 0.9, ease: 'power2.out' }, 7.6)
    .fromTo('[data-kring]', { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.18, stagger: 0.16, ease: 'power2.out' }, 7.9)
    .to('[data-kring]', { opacity: 0, duration: 0.2, stagger: 0.16 }, 8.12)
    .to(cam, { s: 1.8 * Z, fx: 0.47, fy: 0.5, duration: 0.6 }, 8.5)
    .to(dotEl, { opacity: 1, duration: 0.15 }, 8.7);
  [[28.4, 55.8], [32.7, 54.3], [37.2, 48.4], [39.6, 46.3], [41.6, 45.5]].forEach(([x, y], i) => tl.to(dot, { x, y, duration: 0.14, ease: 'none' }, 8.75 + i * 0.14));
  tl.fromTo('[data-tip]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2 }, 9.45)
    .to(cam, { s: 1, fx: 0.5, fy: 0.5, duration: 0.45 }, 9.55)
    .to({}, { duration: 0.05 }, 9.95);
  apply();
}
