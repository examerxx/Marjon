// Вариант H «Техника»: реальные устройства с настоящими экранами продукта справа, весь рассказ — в левой колонке.
import { shell } from '../shell.mjs';
import { arrow, right, pad, h, head, vband } from '../../page.mjs';

export const render = (t) => shell(t, 'h', (p) => `
<section class="ch hh-hero" id="top" data-c="0">
  <div class="wrap">
    <div class="h-col h-hero-in">
      <p class="kicker" data-r>${t.hero.kicker}</p>
      ${h(t.hero.h1, 'h-hero', 'h1')}
      <p class="lede" data-r>${t.hero.lede}</p>
      <div class="btns" data-r>
        <a class="btn btn-mint btn-lg" href="#contact">${t.hero.cta}${arrow}</a>
        <a class="btn btn-line btn-lg" href="#modules">${t.hero.cta2}${right}</a>
      </div>
    </div>
  </div>
  <div class="wrap hud" data-r>
    <span><i class="dot"></i>${t.hero.hud[0]}</span><span>${t.hero.hud[1]} <b data-clock>00:00</b></span><span>${t.hero.hud[2]}</span><span>${t.hero.hud[3]}</span>
    <span class="hud-scroll">${t.hero.scroll}<i></i></span>
  </div>
</section>

<section class="ch h-sec" id="problem" data-c="1">
  <div class="wrap"><div class="h-col">
    ${head(t.problem)}
    <div class="tools" data-r><ul>${t.problem.tools.map(([a, b]) => `<li class="tool" style="--strike:1"><b>${a}</b><span>${b}</span></li>`).join('')}</ul></div>
    <div class="h-stack">
      ${t.problem.pains.map(([a, b], i) => `<article class="card pain" data-r><span class="idx">${pad(i + 1)}</span><h3>${a}</h3><p>${b}</p><i class="x"></i></article>`).join('\n      ')}
    </div>
  </div></div>
</section>

<section class="mani" id="mani" data-nofx data-c="1.5">
  <div class="wrap">
    <p class="mini mani-k"><i class="dot"></i>${t.mani.k}</p>
    <p class="mani-t" data-mani>${t.mani.t}</p>
  </div>
</section>
${vband(t.band, 1)}

<section class="ch h-sec" id="modules" data-c="2">
  <div class="wrap"><div class="h-col">
    ${head(t.modules)}
    <div class="h-stack h-mods">
      ${t.modules.items.map((m, i) => `<article class="card h-mod" data-r>
        <header><span class="idx">${pad(i + 1)} / ${pad(t.modules.items.length)}</span><span class="h-chip"><i class="dot"></i>${m.live[0]} · <b>${m.live[1]}</b></span></header>
        <h3>${m.name}</h3>
        <p>${m.text}</p>
        <div class="tags">${m.tags.map((x) => `<span>${x}</span>`).join('')}</div>
      </article>`).join('\n      ')}
    </div>
  </div></div>
</section>
<i class="c-mark" data-c="2.3"></i>

${p.demo}

${p.roles.replace('<section class="ch ch-roles"', '<section class="ch ch-roles h-roles" data-c="2.7"')}

<section class="ch h-sec" id="uzbekistan" data-c="3">
  <div class="wrap"><div class="h-col">
    ${head(t.uz)}
    <div class="h-stats">
      ${t.uz.stats.map((s) => `<div class="h-stat" data-r><b class="v-big">${s.pre}<i data-count="${s.n}">0</i><small>${s.suf}</small></b><span>${s.label}</span></div>`).join('')}
    </div>
    <div class="feats">${t.uz.feats.map(([a, b], i) => `<div class="feat" data-r><i>${pad(i + 1)}</i><h3>${a}</h3><p>${b}</p></div>`).join('')}</div>
  </div></div>
</section>
<i class="c-mark" data-c="3"></i>

${p.paper}
${p.cta}`);
