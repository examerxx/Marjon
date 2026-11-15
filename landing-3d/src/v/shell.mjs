// Общая оболочка вариантов E и F: head, загрузчик, шапка, «бумага», CTA и футер берутся из основного шаблона,
// чтобы бренд-элементы были едины; <main> и 3D-сцена у каждого варианта свои.
import { render } from '../page.mjs';
import { demo } from '../demo.mjs';

const cut = (s, from, to) => { const a = s.indexOf(from); if (a < 0) throw new Error('shell: нет ' + from); const b = to ? s.indexOf(to, a + from.length) : s.length; if (b < 0) throw new Error('shell: нет ' + to); return s.slice(a, b); };

export function shell(t, variant, main) {
  const src = render(t);
  const head = src.slice(0, src.indexOf('<div class="stage"')).replace('/src/main.js', `/src/v/${variant}/main.js`).replace('class="no-js"', `class="no-js v-${variant}"`);
  const nav = cut(src, '<header class="nav"', '<nav class="rail"');
  const paper = cut(src, '<div class="paper" id="paper">', '<!-- 6 · FINALE -->');
  const cta = cut(src, '<!-- 6 · FINALE -->', '</main>').replace('data-ch="6"', 'data-ch="6" data-c="4"');
  const roles = cut(src, '<section class="ch ch-roles"', '<!-- 5');
  const foot = cut(src, '<footer class="foot">');
  const parts = { paper, cta, roles, demo: demo(t) };
  return `${head}<div class="stage" aria-hidden="true">
  <div class="poster"></div>
  <canvas id="gl"></canvas>
  <div class="stage-shade"></div>
</div>

${nav}<main id="main">
${main(parts)}
</main>

${foot}`;
}
