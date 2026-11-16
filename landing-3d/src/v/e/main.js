import './style.css';
import { boot } from '../boot.js';

boot({
  loadScene: () => import('./scene.js'),
  motion({ gsap, ScrollTrigger, $, $$ }) {
    // роли: закреплённая горизонтальная лента
    const pin = $('.e-roles-pin'), track = $('[data-track]'), cards = $$('.e-role'), nEl = $('[data-role-i]');
    if (!pin) return;
    const dist = () => Math.max(track.scrollWidth - window.innerWidth, 0);
    gsap.to(track, { x: () => -dist(), ease: 'none', scrollTrigger: { trigger: pin, pin: true, start: 'top top', end: () => '+=' + (dist() + window.innerHeight * 0.4), scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1,
      onUpdate: (st) => { const i = Math.min(cards.length - 1, Math.round(st.progress * (cards.length - 1))); cards.forEach((c, k) => c.classList.toggle('on', k === i)); nEl.textContent = String(i + 1).padStart(2, '0'); } } });
    cards[0]?.classList.add('on');
  },
});
