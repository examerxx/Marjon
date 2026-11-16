// Вариант F «Зал»: поле плиток — столы зала. Рябь, беспорядок, порядок, столбцы выручки, буква M. Композиция — редакционная, со «строками».
import { shell } from '../shell.mjs';
import { arrow, right, pad, h, head, vband } from '../../page.mjs';

export const render = (t) => shell(t, 'f', (p) => `
<section class="ch f-hero" id="top" data-c="0">
  <div class="wrap f-hero-in">
    <p class="kicker" data-r>${t.hero.kicker}</p>
    ${h(t.hero.h1, 'h-hero', 'h1')}
    <div class="f-hero-b">
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

<section class="ch f-problem" id="problem" data-c="1">
  <div class="wrap v-split">
    ${head(t.problem)}
    <div class="f-rows">
      ${t.problem.pains.map(([a, b], i) => `<article class="f-row f-pain" data-r><span class="f-n">${String(i + 1).padStart(3, '0')}</span><h3>${a}</h3><p>${b}</p><i class="x"></i></article>`).join('\n      ')}
      <div class="tools" data-r><p class="mini">${t.problem.toolsLabel}</p><ul>${t.problem.tools.map(([a, b]) => `<li class="tool" style="--strike:1"><b>${a}</b><span>${b}</span></li>`).join('')}</ul></div>
    </div>
  </div>
</section>

<section class="mani" id="mani" data-nofx data-c="1.6">
  <div class="wrap">
    <p class="mini mani-k"><i class="dot"></i>${t.mani.k}</p>
    <p class="mani-t" data-mani>${t.mani.t}</p>
  </div>
</section>
${vband(t.band, 1)}

<section class="ch f-mod" id="modules" data-c="2">
  <div class="wrap v-split">
    ${head(t.modules)}
    <div class="f-rows">
      ${t.modules.items.map((m, i) => `<article class="f-row f-m" data-r tabindex="0">
        <span class="f-n">${String(i + 1).padStart(3, '0')}</span>
        <h3>${m.name}</h3>
        <div class="f-m-more"><div><p>${m.text}</p><div class="tags">${m.tags.map((x) => `<span>${x}</span>`).join('')}</div></div></div>
        <div class="f-live"><span>${m.live[0]}</span><b>${m.live[1]}</b></div>
      </article>`).join('\n      ')}
    </div>
  </div>
</section>

${p.demo}

${p.roles.replace('<section class="ch ch-roles"', '<section class="ch ch-roles" data-c="2.6"')}

<section class="ch f-num" id="uzbekistan" data-c="3">
  <div class="wrap">
    ${head(t.uz)}
    <div class="f-stats">
      ${t.uz.stats.map((s, i) => `<div class="f-stat" data-r><span class="f-n">${String(i + 1).padStart(3, '0')}</span><b class="v-big">${s.pre}<i data-count="${s.n}">0</i><small>${s.suf}</small></b><span>${s.label}</span></div>`).join('')}
    </div>
    <div class="feats">${t.uz.feats.map(([a, b], i) => `<div class="feat" data-r><i>${pad(i + 1)}</i><h3>${a}</h3><p>${b}</p></div>`).join('')}</div>
  </div>
</section>

${p.paper}
${p.cta}`);
