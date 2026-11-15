// Вариант G «Дастархан»: настоящий накрытый стол. Модули — как меню на бумажной карте, остальной текст — в стеклянных панелях по сторонам.
import { shell } from '../shell.mjs';
import { arrow, right, pad, h, head, vband } from '../../page.mjs';

export const render = (t) => shell(t, 'g', (p) => `
<section class="ch g-hero" id="top" data-c="0">
  <div class="wrap g-hero-in">
    <div class="g-hero-t">
      <p class="kicker" data-r>${t.hero.kicker}</p>
      ${h(t.hero.h1, 'h-hero', 'h1')}
    </div>
    <div class="g-hero-b">
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

<section class="ch g-problem" id="problem" data-c="1">
  <div class="wrap">
    <div class="g-panel g-right">
      ${head(t.problem)}
      <div class="tools" data-r><ul>${t.problem.tools.map(([a, b]) => `<li class="tool" style="--strike:1"><b>${a}</b><span>${b}</span></li>`).join('')}</ul></div>
      <div class="g-pains">
        ${t.problem.pains.map(([a, b], i) => `<article class="g-pain" data-r><span class="idx">${pad(i + 1)}</span><div><h3>${a}</h3><p>${b}</p></div></article>`).join('\n        ')}
      </div>
    </div>
  </div>
</section>

<section class="mani" id="mani" data-nofx data-c="1.5">
  <div class="wrap">
    <p class="mini mani-k"><i class="dot"></i>${t.mani.k}</p>
    <p class="mani-t" data-mani>${t.mani.t}</p>
  </div>
</section>
${vband(t.band, 1)}

<section class="ch g-mod" id="modules" data-c="2">
  <div class="wrap">
    <div class="g-menu">
      <div class="g-menu-top"><span>Marjon</span><span>${t.modules.kicker}</span><span>№ 01—${pad(t.modules.items.length)}</span></div>
      ${head(t.modules)}
      <ol class="g-list">
        ${t.modules.items.map((m, i) => `<li class="g-item" data-r>
          <span class="g-i">${pad(i + 1)}</span>
          <h3>${m.name}</h3><i class="g-dots"></i><b>${m.live[1]}</b>
          <p>${m.text}</p><span class="g-live">${m.live[0]}</span>
        </li>`).join('\n        ')}
      </ol>
      <p class="g-menu-foot">${t.band.join(' · ')}</p>
    </div>
  </div>
</section>
<i class="c-mark" data-c="2"></i>

${p.demo}

${p.roles.replace('<section class="ch ch-roles"', '<section class="ch ch-roles" data-c="2.6"')}

<section class="ch g-num" id="uzbekistan" data-c="3">
  <div class="wrap">
    <div class="g-panel g-left">
      ${head(t.uz)}
      <div class="g-stats">
        ${t.uz.stats.map((s) => `<div class="g-stat" data-r><b class="v-big">${s.pre}<i data-count="${s.n}">0</i><small>${s.suf}</small></b><span>${s.label}</span></div>`).join('')}
      </div>
    </div>
    <div class="feats">${t.uz.feats.map(([a, b], i) => `<div class="feat" data-r><i>${pad(i + 1)}</i><h3>${a}</h3><p>${b}</p></div>`).join('')}</div>
  </div>
</section>
<i class="c-mark" data-c="3"></i>

${p.paper}
${p.cta}`);
