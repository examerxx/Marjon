import './style.css';
import { boot } from '../boot.js';

boot({
  loadScene: () => import('./scene.js'),
  motion({ ScrollTrigger, $$ }) {
    // строки модулей: та, что у центра экрана, раскрыта сама — работает и без наведения
    const rows = $$('.f-m');
    rows.forEach((r) => ScrollTrigger.create({ trigger: r, start: 'top 58%', end: 'bottom 42%', toggleClass: { targets: r, className: 'on' } }));
  },
});
