// DOM-слой: SplitText-заголовки, появление карточек, счётчики, pin модулей, роли, навигация.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const fmt = (v, dec) => {
  const [a, b] = v.toFixed(dec).split('.');
  return (a.length > 4 ? a.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : a) + (b ? ',' + b : '');
};

/* ---------- то, что работает в любом режиме (в т.ч. reduced-motion) ---------- */
export function initBase({ scrollTo, onRole }) {
  $$('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

  // время в Ташкенте
  const clock = $$('[data-clock]');
  const tickClock = () => {
    const t = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }).format(new Date());
    clock.forEach((el) => (el.textContent = t));
  };
  tickClock();

  // таймеры кухни
  const timers = $$('[data-timer]').map((el) => ({ el, s: +el.dataset.timer }));
  const iv = setInterval(() => {
    if (document.hidden) return;
    timers.forEach((t) => { t.s = (t.s + 1) % 3600; t.el.textContent = `${pad(Math.floor(t.s / 60))}:${pad(t.s % 60)}`; });
    tickClock();
  }, 1000);

  // роли (tabs)
  const tabs = $$('.role-tab'), panels = $$('.role-p');
  const setRole = (i, focus) => {
    tabs.forEach((t, k) => { const on = k === i; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    panels.forEach((p, k) => { p.hidden = k !== i; p.classList.toggle('on', k === i); });
    if (focus) tabs[i].focus();
    tabs[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    onRole?.(i, panels[i]);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setRole(i));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); setRole((i + d + tabs.length) % tabs.length, true); }
    });
  });

  // FAQ: открыт только один
  const faq = $$('.faq details');
  faq.forEach((d) => d.addEventListener('toggle', () => { if (d.open) faq.forEach((o) => o !== d && (o.open = false)); }));

  // меню
  const burger = $('.burger'), menu = $('#menu');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open);
    burger.setAttribute('aria-label', open ? burger.dataset.close : burger.dataset.open);
    menu.setAttribute('aria-hidden', !open);
    menu.inert = !open;
  };
  burger?.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  window.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));
  window.addEventListener('resize', () => window.innerWidth > 1100 && setMenu(false));

  // якоря
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const target = id.length > 1 && $(id);
    if (!target) return;
    e.preventDefault();
    setMenu(false);
    scrollTo(id === '#top' ? 0 : target);
    history.replaceState(null, '', id);
  }));

  return () => clearInterval(iv);
}

/* ---------- анимации ---------- */
export function initMotion({ scrollTo }) {
  gsap.registerPlugin(ScrollTrigger, SplitText);
  ScrollTrigger.config({ ignoreMobileResize: true });
  const nav = $('#nav');

  // появление блоков
  const rest = $$('[data-r]').filter((el) => !el.closest('.ch-hero'));
  gsap.set(rest, { autoAlpha: 0, y: 44 });
  ScrollTrigger.batch(rest, {
    start: 'top 92%', once: true,
    onEnter: (b) => gsap.to(b, { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, overwrite: true }),
  });

  // заголовки глав: SplitText, маска по строкам
  const splits = [];
  const splitHeads = () => $$('[data-split]').forEach((el) => {
    if (el.matches('.h-hero')) return;
    splits.push(SplitText.create($$('.ln', el), {
      type: 'lines', mask: 'lines', linesClass: 'sl', autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, { yPercent: 112, duration: 1.3, ease: 'power4.out', stagger: 0.1, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
    }));
  });

  // счётчики
  $$('[data-count]').forEach((el) => {
    const n = +el.dataset.count, dec = +el.dataset.dec || 0, o = { v: 0 };
    el.textContent = fmt(0, dec);
    gsap.to(o, { v: n, duration: 1.8, ease: 'power2.out', onUpdate: () => (el.textContent = fmt(o.v, dec)), scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
  });

  // столбики и строки чека
  $$('.bars').forEach((b) => gsap.from(b.children, { scaleY: 0, duration: 1, ease: 'expo.out', stagger: 0.05, scrollTrigger: { trigger: b, start: 'top 92%', once: true } }));
  if ($('[data-row]')) gsap.from('[data-row]', { autoAlpha: 0, x: -14, duration: 0.7, ease: 'power3.out', stagger: 0.22, scrollTrigger: { trigger: '.lc-receipt', start: 'top 78%', once: true } });

  // «как это выглядит сейчас»: инструменты зачёркиваются по скроллу
  if ($('[data-tool]')) gsap.to('[data-tool]', { '--strike': 1, ease: 'none', stagger: 0.4, scrollTrigger: { trigger: '.tools', start: 'top 72%', end: 'top 26%', scrub: 0.4 } });

  // модули: pin + переключение по прогрессу
  const btns = $$('.mod-b'), cards = $$('.mod-card'), numEl = $('[data-mod-n]'), bar = $('[data-mod-bar]');
  let cur = 0;
  const setMod = (i) => {
    if (i === cur) return; cur = i;
    btns.forEach((b, k) => b.classList.toggle('on', k === i));
    cards.forEach((c, k) => { c.classList.toggle('on', k === i); c.setAttribute('aria-hidden', k !== i); });
    numEl.textContent = pad(i + 1);
    gsap.fromTo(numEl, { yPercent: 28, opacity: 0.2 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'power3.out', overwrite: true });
  };
  const pin = !$('.mod-pin') ? null : ScrollTrigger.create({
    trigger: '.mod-pin', pin: true, start: 'top top', anticipatePin: 1, invalidateOnRefresh: true,
    end: () => '+=' + window.innerHeight * (window.innerWidth < 820 ? 2.8 : 3.4),
    onUpdate: (self) => { setMod(Math.min(7, Math.floor(self.progress * 8))); gsap.set(bar, { scaleX: self.progress }); },
  });
  if (pin) btns.forEach((b, i) => b.addEventListener('click', () => scrollTo(pin.start + ((i + 0.5) / 8) * (pin.end - pin.start))));

  // навигация: прячется при скролле вниз, перекрашивается на бумаге
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (self) => {
      const y = self.scroll();
      nav.classList.toggle('solid', y > 40);
      nav.classList.toggle('hide', self.direction === 1 && y > window.innerHeight * 0.5 && !document.body.classList.contains('menu-open'));
    },
  });
  if ($('#paper')) ScrollTrigger.create({ trigger: '#paper', start: 'top 34px', end: 'bottom 34px', toggleClass: { targets: nav, className: 'on-paper' } });

  // чипы в hero: лёгкий параллакс
  const chips = $$('[data-float]').map((el) => ({ k: +el.dataset.float, x: gsap.quickTo(el, 'x', { duration: 1.2, ease: 'power3' }), r: gsap.quickTo(el, 'rotation', { duration: 1.2, ease: 'power3' }) }));
  $$('[data-float]').forEach((el, i) => gsap.to(el, { yPercent: -10, duration: 3 + i, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  const onMove = (e) => { const mx = e.clientX / window.innerWidth - 0.5; chips.forEach((c) => { c.x(mx * 30 * c.k); c.r(mx * 2.5 * c.k); }); };
  window.addEventListener('pointermove', onMove, { passive: true });

  // intro: вызывается после загрузчика
  const heroR = $$('.ch-hero [data-r]');
  gsap.set(heroR, { autoAlpha: 0, y: 30 });
  gsap.set('.h-hero', { autoAlpha: 0 });
  const intro = () => {
    splitHeads();
    gsap.set('.h-hero', { autoAlpha: 1 });
    $$('.h-hero').forEach((el) => splits.push(SplitText.create($$('.ln', el), { // оба слоя: светлый и тёмный
      type: 'lines,chars', mask: 'lines', linesClass: 'sl', autoSplit: true,
      onSplit: (self) => gsap.from(self.chars, { yPercent: 115, duration: 1.2, ease: 'power4.out', stagger: 0.022, delay: 0.25 }),
    })));
    gsap.to(heroR, { autoAlpha: 1, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.1, delay: 0.9 });
    ScrollTrigger.refresh();
  };

  return {
    intro, pin,
    kill() { window.removeEventListener('pointermove', onMove); splits.forEach((s) => s.revert()); ScrollTrigger.getAll().forEach((s) => s.kill()); },
  };
}
