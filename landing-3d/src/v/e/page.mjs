// Вариант E «Поток»: рой частиц — заказы. Хаос собирается в жемчужину, потом в график. Композиция — по центру, монументально.
import { shell } from '../shell.mjs';
import { arrow, right, pad, h, head, vband } from '../../page.mjs';

export const render = (t) => shell(t, 'e', (p) => `
<section class="ch e-hero" id="top" data-c="0">
  <div class="wrap e-hero-in">
    <p class="kicker" data-r>${t.hero.kicker}</p>
    ${h(t.hero.h1, 'h-hero', 'h1')}
    <p class="lede" data-r>${t.hero.lede}</p>
    <div class="btns" data-r>
      <a class="btn btn-mint btn-lg" href="#contact">${t.hero.cta}${arrow}</a>
      <a class="btn btn-line btn-lg" href="#modules">${t.hero.cta2}${right}</a>
    </div>
  </div>
  <div class="wrap hud" data-r>
    <span><i class="dot"></i>${t.hero.hud[0]}</span><span>${t.hero.hud[1]} <b data-clock>00:00</b></span><span>${t.hero.hud[2]}</span><span>${t.hero.hud[3]}</span>
    <span class="hud-scroll">${t.hero.scroll}<i></i></span>
  </div>
</section>

<section class="ch e-problem" id="problem" data-c="1">
  <div class="wrap">
    ${head(t.problem, 'e-center')}
    <div class="tools e-tools" data-r><ul>${t.problem.tools.map(([a, b]) => `<li class="tool" style="--strike:1"><b>${a}</b><span>${b}</span></li>`).join('')}</ul></div>
    <div class="pains">
      ${t.problem.pains.map(([a, b], i) => `<article class="card pain" data-r><span class="idx">${pad(i + 1)}</span><h3>${a}</h3><p>${b}</p><i class="x"></i></article>`).join('')}
    </div>
  </div>
</section>

<section class="mani e-mani" id="mani" data-nofx data-c="1.6">
  <div class="wrap">
    <p class="mini mani-k"><i class="dot"></i>${t.mani.k}</p>
    <p class="mani-t" data-mani>${t.mani.t}</p>
  </div>
</section>
${vband(t.band, 1)}

<section class="ch e-mod" id="modules" data-c="2">
  <div class="wrap">
    ${head(t.modules, 'e-center')}
    <div class="bento">
      ${t.modules.items.map((m, i) => `<article class="card bento-c b${i}" data-r>
        <span class="idx">${pad(i + 1)} / ${pad(t.modules.items.length)}</span>
        <h3>${m.name}</h3>
        <p>${m.text}</p>
        <div class="tags">${m.tags.map((x) => `<span>${x}</span>`).join('')}</div>
        <div class="readout"><span><i class="dot"></i>${m.live[0]}</span><b>${m.live[1]}</b></div>
      </article>`).join('\n      ')}
    </div>
  </div>
</section>

${p.demo}

<section class="ch e-num" id="uzbekistan" data-c="3">
  <div class="wrap">
    ${head(t.uz, 'e-center')}
    <div class="e-stats">
      ${t.uz.stats.map((s) => `<div class="e-stat" data-r><b class="v-big">${s.pre}<i data-count="${s.n}">0</i><small>${s.suf}</small></b><span>${s.label}</span></div>`).join('')}
    </div>
    <div class="feats">${t.uz.feats.map(([a, b], i) => `<div class="feat" data-r><i>${pad(i + 1)}</i><h3>${a}</h3><p>${b}</p></div>`).join('')}</div>
  </div>
</section>

<section class="e-roles" id="roles" data-c="3.5">
  <div class="e-roles-pin">
    <div class="wrap e-roles-head">
      <p class="kicker">${t.roles.kicker}</p>
      <h2 class="h-ch">${t.roles.h2.join(' ')}</h2>
      <p class="e-roles-n"><b data-role-i>01</b> / ${pad(t.roles.items.length)}</p>
    </div>
    <div class="e-track" data-track>
      ${t.roles.items.map((r, i) => `<article class="card e-role">
        <span class="e-role-i v-big">${pad(i + 1)}</span>
        <p class="mini">${t.roles.roleWord} · ${r.name}</p>
        <h3>${r.title}</h3>
        <p>${r.text}</p>
        <ul class="ticks">${r.list.map((x) => `<li>${x}</li>`).join('')}</ul>
        <div class="readout"><span>${t.roles.access}</span><b>${r.access}</b></div>
      </article>`).join('\n      ')}
    </div>
  </div>
</section>

${p.paper}
${p.cta}`);
