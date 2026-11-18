// Футер: кнопка «App Store» открывает модалку с двумя 3D-телефонами (Owner / Staff)
// и кнопкой «Скачать»: телефон выбирается тапом, ссылка ведёт в App Store.
// Закрытие: клик по подложке, по кресту или Escape. Lenis ставится на паузу на время показа.
const APPS = {
  owner: { url: 'https://apps.apple.com/ca/app/marjon-owner/id6808735197', name: 'Marjon Owner' },
  staff: { url: 'https://apps.apple.com/ca/app/marjon-staff/id6808714517', name: 'Marjon Staff' },
};

export function initApps() {
  const modal = document.getElementById('apps-modal');
  if (!modal) return;
  const opener = document.querySelector('[data-apps-open]');
  const cta = modal.querySelector('#apps-cta');
  const ctaName = modal.querySelector('#apps-cta-name');
  const picks = [...modal.querySelectorAll('[data-apps-pick]')];
  let last = null;

  const pick = (key) => {
    const app = APPS[key];
    if (!app) return;
    picks.forEach((b) => {
      const on = b.dataset.appsPick === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (cta) cta.href = app.url;
    if (ctaName) ctaName.textContent = app.name;
  };
  picks.forEach((b) => b.addEventListener('click', () => pick(b.dataset.appsPick)));

  const open = () => {
    last = document.activeElement;
    modal.hidden = false;
    document.documentElement.classList.add('apps-open');
    window.dispatchEvent(new CustomEvent('lead:open')); // останавливает Lenis (см. main.js)
    modal.querySelector('.apps-x')?.focus({ preventScroll: true });
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    document.documentElement.classList.remove('apps-open');
    window.dispatchEvent(new CustomEvent('lead:close'));
    last?.focus?.({ preventScroll: true });
  };
  opener?.addEventListener('click', open);
  modal.querySelectorAll('[data-apps-close]').forEach((el) => el.addEventListener('click', close));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
