// HTML-шаблон лендинга. Один источник для ru и uz: scripts/build-pages.mjs
// рендерит его в index.html и uz/index.html.
export const arrow = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 17.5 17.5 6.5M8 6.5h9.5V16"/></svg>';
export const right = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
export const mark = `<svg class="mark" viewBox="55 370 430 290" aria-hidden="true" focusable="false">
  <rect x="39.71" y="472.12" width="316.08" height="86.27" rx="43.135" transform="rotate(-45 197.75 515.25)" fill="#14B8A6"/>
  <rect x="193.39" y="472.61" width="314.75" height="85.29" rx="42.645" transform="rotate(-45.44 350.76 515.25)" fill="#5fd6cf"/>
  <path d="M461 525C466 526 470 531 470 537L470 599C470 616 461 629 445 636C434 641 420 641 408 635C394 628 386 615 386 600C386 589 390 580 398 571L439 530C445 524 453 522 461 525Z" fill="currentColor"/>
</svg>`;
import { demo } from './demo.mjs';
export const pad = (n) => String(n).padStart(2, '0');
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
export const h = (lines, cls, tag = 'h2') =>
  `<${tag} class="${cls}" data-split>${lines.map((l) => `<span class="ln">${l}</span>`).join(' ')}</${tag}>`;
export const head = (s, extra = '') => `
      <header class="sec-head ${extra}">
        <p class="kicker" data-r>${s.kicker}</p>
        ${h(s.h2, 'h-ch')}
        <p class="lede" data-r>${s.lede}</p>
      </header>`;
export const marquee = (items, rev) => `
        <div class="mq ${rev ? 'mq-rev' : ''}"><div class="mq-track">
          ${[0, 1].map((k) => items.map(([b, s]) => `<div class="iq"${k ? ' aria-hidden="true"' : ''}><b>${b}</b><span>${s}</span></div>`).join('')).join('')}
        </div></div>`;

export const vband = (words, dir = 1) => `
<div class="vband" data-vband data-dir="${dir}" data-nofx aria-hidden="true"><div class="vband-t">${[0, 1].map(() => words.map((w, i) => `<span class="${i % 2 ? 'o' : ''}">${w}</span><i>✦</i>`).join('')).join('')}</div></div>`;


// «Роли»: в версии с устройствами — три устройства по очереди (без карточки), в «Нити» — вкладки
const rolesShow = (t) => `    <ol class="rshow" data-rshow>
      ${t.roles.show.map((r, i) => `<li class="rs" data-rs>
        <div class="rs-cap">
          <span class="rs-n">${pad(i + 1)} <i>/ ${pad(t.roles.show.length)}</i></span>
          <h3>${r.k}</h3>
          <p>${r.t}</p>
          <div class="rs-who">${r.who.map((w) => `<span>${w}</span>`).join('')}</div>
        </div>
        <figure class="rs-fb d-${r.img}${r.img === 'mobile' ? ' ph' : ''}"><img src="/src/assets/shots/${r.img}.webp" alt="${r.k}" loading="eager" decoding="async" width="${r.img === 'mobile' ? 1170 : 3072}" height="${r.img === 'mobile' ? 2532 : 1920}" /></figure>
      </li>`).join('\n      ')}
    </ol>`;
const rolesTabs = (t) => `    <div class="roles" data-r>
      <div class="role-tabs" role="tablist" aria-label="${t.roles.aria}">
        ${t.roles.items.map((r, i) => `<button type="button" role="tab" id="rt${i}" aria-controls="rp${i}" aria-selected="${!i}" tabindex="${i ? -1 : 0}" class="role-tab${i ? '' : ' on'}" data-role="${i}"><i>${pad(i + 1)}</i>${r.name}</button>`).join('\n        ')}
      </div>
      <div class="role-panels">
        ${t.roles.items.map((r, i) => `<article class="card role-p${i ? '' : ' on'}" role="tabpanel" id="rp${i}" aria-labelledby="rt${i}"${i ? ' hidden' : ''}>
          <span class="mini">${t.roles.roleWord} · ${r.name}</span>
          <h3>${r.title}</h3>
          <p>${r.text}</p>
          <ul>${r.list.map((x) => `<li>${x}</li>`).join('')}</ul>
          <div class="role-acc"><span>${t.roles.access}</span><b>${r.access}</b></div>
        </article>`).join('\n        ')}
      </div>
    </div>`;

const painIcons = [
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.3" y="8.3" width="10.8" height="10.8" rx="2.3"/><path d="M5.3 14.9V6.6a2.3 2.3 0 0 1 2.3-2.3h8.3"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.7 5.6 20.3 18.4"/><path d="M10.2 5.2A9.4 9.4 0 0 1 12 5c5.1 0 8.7 4.3 9.7 6.6-.5 1.2-1.7 2.6-3.2 3.7M7 6.7C4.6 8.3 3 10.9 2.3 12c.9 2.3 4.5 6.8 9.7 6.8 1.4 0 2.7-.3 3.9-1"/></svg>',
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2.1"/></svg>',
];

export function render(t) {
  const B = t.base;
  const isRu = t.lang === 'ru';
  const link = (href) => (/^(#|https?:|mailto:)/.test(href) ? href : B + (isRu ? '' : 'uz/') + href);
  return `<!doctype html>
<html lang="${t.lang}" class="no-js">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t.title}</title>
<meta name="description" content="${t.desc}" />
<meta name="theme-color" content="#0a0b0c" />
<link rel="canonical" href="https://marjon.tech${t.path}" />
<link rel="alternate" hreflang="ru" href="https://marjon.tech/" />
<link rel="alternate" hreflang="uz" href="https://marjon.tech/uz/" />
<link rel="alternate" hreflang="x-default" href="https://marjon.tech/" />
<link rel="icon" type="image/svg+xml" href="${B}mark.svg" />
<link rel="apple-touch-icon" href="${B}icon-512.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Marjon" />
<meta property="og:locale" content="${t.ogLocale}" />
<meta property="og:title" content="${t.title}" />
<meta property="og:description" content="${t.ogDesc}" />
<meta property="og:url" content="https://marjon.tech${t.path}" />
<meta property="og:image" content="https://marjon.tech/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<script>document.documentElement.classList.replace('no-js','js');try{if(sessionStorage.getItem('mj-ls'))document.documentElement.classList.add('ls')}catch(e){}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Marjon","applicationCategory":"BusinessApplication","operatingSystem":"Web, Windows, Android, iOS","url":"https://marjon.tech${t.path}","description":"${t.desc}","inLanguage":["ru","uz","en"],"publisher":{"@type":"Organization","name":"Marjon","url":"https://marjon.tech/"}}
</script>
<script>document.documentElement.dataset.loader = (new URLSearchParams(location.search).get('loader') || '2').replace(/[^123]/g, '') || '2';</script>
<script type="module" src="/src/main.js"></script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>

<div class="loader" id="loader" aria-hidden="true">
  <!-- фон: 1 — занавес колонками, 2 — маска с буквами-окнами, 3 — жалюзи -->
  <div class="ld-v ld-v1"><div class="ld-cols">${'<i></i>'.repeat(5)}</div><div class="ld-glow"></div></div>
  <div class="ld-v ld-v2">
    <svg class="ld2" data-ld2 width="100%" height="100%" aria-hidden="true">
      <defs>
        <mask id="ld2-hole" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><rect x="-10000" y="-10000" width="20000" height="20000" fill="#fff" /><text class="ld2-t" data-ld2-hole x="50%" y="50%" fill="#fff">Marjon</text></mask>
        <clipPath id="ld2-clip"><text class="ld2-t" x="50%" y="50%">Marjon</text></clipPath>
        <radialGradient id="ld2-glow" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#3fe3c4" stop-opacity=".16" /><stop offset="1" stop-color="#3fe3c4" stop-opacity="0" /></radialGradient>
        <linearGradient id="ld2-liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff7e2" /><stop offset=".35" stop-color="#3fe3c4" /><stop offset="1" stop-color="#12a88d" /></linearGradient>
      </defs>
      <g mask="url(#ld2-hole)"><rect width="100%" height="100%" fill="#0a0b0c" /><rect data-ld2-glow width="100%" height="100%" fill="url(#ld2-glow)" /></g>
      <g data-ld2-ink>
        <g clip-path="url(#ld2-clip)">
          <path data-ld2-w2 fill="#1c8f7b" opacity=".75" />
          <path data-ld2-w1 fill="url(#ld2-liq)" />
          <g data-ld2-bub fill="#d9fff6" opacity=".7"></g>
        </g>
        <text class="ld2-t ld2-out" data-ld2-out x="50%" y="50%">Marjon</text>
      </g>
    </svg>
  </div>
  <div class="ld-v ld-v3">
    <div class="ld3-strips">${'<i></i>'.repeat(8)}</div>
    <div class="ld3-mq">${[0, 1, 2].map((r) => `<p style="--dir:${r % 2 ? 1 : -1}"><span>${[...t.loaderBeads, ...t.loaderBeads, ...t.loaderBeads].map((n) => `${n} ·`).join(' ')}</span></p>`).join('')}</div>
  </div>

  <div class="ld-top"><span class="ld-status"><i></i><b data-ld-status data-done="${t.loaderDone}">${t.loader}</b></span><span class="ld-clock" data-ld-clock>00:00:00</span></div>
  <div class="ld-mid">
    <div class="ld-word ld-v ld-v1">
      <span class="ld-w ld-w-out">${[...'Marjon'].map((c) => `<span>${c}</span>`).join('')}</span>
      <span class="ld-w ld-w-fill" data-ld-fill>${[...'Marjon'].map((c) => `<span>${c}</span>`).join('')}</span>
    </div>
    <div class="ld3-word ld-v ld-v3" data-ld3>${Array.from({ length: 9 }, (_, i) => `<div class="ld3-s" style="--i:${i}"><span class="ld3-o">Marjon</span><span class="ld3-f">Marjon</span></div>`).join('')}</div>
  </div>
  <div class="ld-bot">
    <ul class="ld-list">${t.loaderBeads.map((n) => `<li data-ld-li><i></i>${n}</li>`).join('')}</ul>
    <span class="loader-n"><b data-loader-n>0</b><small>%</small></span>
  </div>
  <i class="loader-bar" data-loader-bar></i>
</div>

<div class="stage" aria-hidden="true">
  <div class="poster"></div>
  <canvas id="gl"></canvas>
  <div class="stage-shade"></div>
</div>
<div class="bead-labels" aria-hidden="true">
  ${t.modules.items.map((m, i) => `<span class="bl" data-bl="${i}"><span class="bl-line" aria-hidden="true"></span><span class="bl-tag"><i>${pad(i + 1)}</i><b>${m.short}</b></span></span>`).join('')}
</div>

<header class="nav" id="nav">
  <nav class="nav-in" aria-label="${t.nav.aria}">
    <a class="brand" href="#top" aria-label="${t.nav.home}">${mark}<span>Marjon</span></a>
    <div class="nav-links">
      ${t.nav.links.map(([href, l]) => `<a href="${href}">${l}</a>`).join('\n      ')}
    </div>
    <div class="nav-tools">
      <div class="lang" role="group" aria-label="${t.nav.lang}">
        <a href="${isRu ? './' : '../'}" hreflang="ru" lang="ru"${isRu ? ' class="on" aria-current="page"' : ''}>RU</a>
        <a href="${isRu ? 'uz/' : './'}" hreflang="uz" lang="uz"${!isRu ? ' class="on" aria-current="page"' : ''}>UZ</a>
      </div>
      <a class="nav-login" href="https://admin.marjon.tech/login">${t.nav.login}</a>
      <a class="btn btn-mint btn-sm" href="#contact" data-lead>${t.nav.cta}${arrow}</a>
    </div>
    <button class="burger" type="button" aria-label="${t.nav.menuOpen}" aria-expanded="false" aria-controls="menu" data-open="${t.nav.menuOpen}" data-close="${t.nav.menuClose}"><span></span><span></span></button>
  </nav>
</header>

<div class="menu" id="menu" aria-hidden="true" inert>
  <div class="menu-links">
    ${t.nav.links.map(([href, l], i) => `<a href="${href}"><i>${pad(i + 1)}</i>${l}</a>`).join('\n    ')}
  </div>
  <div class="menu-foot">
    <a class="btn btn-mint" href="#contact" data-lead>${t.hero.cta}${arrow}</a>
    <a class="btn btn-line" href="https://admin.marjon.tech/login">${t.nav.login}</a>
  </div>
</div>

<nav class="rail" aria-hidden="true">
  ${t.rail.map((l, i) => `<span class="rail-i" data-rail="${i}"><b>${pad(i)}</b><i>${l}</i></span>`).join('\n  ')}
</nav>

<main id="main">

<!-- 0 · HERO -->
<section class="ch ch-hero" id="top" data-ch="0">
  <div class="hero-3d" data-showcase aria-hidden="true"><canvas></canvas><div class="hero-dots">${'<i class="hero-dot"></i>'.repeat(4)}</div></div>
  <div class="wrap hero-in">
    <p class="kicker" data-r>${t.hero.kicker}</p>
    <div class="hero-title">
      ${h(t.hero.h1, 'h-hero', 'h1')}
      ${h(t.hero.h1, 'h-hero h-hero-ink', 'div').replace('<div ', '<div aria-hidden="true" ')}
    </div>
    <div class="hero-row">
      <div class="hero-copy">
        <p class="lede" data-r>${t.hero.lede}</p>
        <p class="hero-note" data-r>${t.hero.note}</p>
      </div>
      <div class="btns" data-r>
        <a class="btn btn-mint" href="#contact" data-lead>${t.hero.cta}${arrow}</a>
        <a class="btn btn-line" href="#modules">${t.hero.cta2}${right}</a>
      </div>
    </div>
  </div>
  <div class="wrap hud" data-r>
    <span><i class="dot"></i>${t.hero.hud[0]}</span>
    <span>${t.hero.hud[1]} <b data-clock>--:--</b></span>
    <span class="hud-x">${t.hero.hud[2]}</span>
    <span class="hud-x">${t.hero.hud[3]}</span>
    <span class="hud-scroll">${t.hero.scroll}<i></i></span>
  </div>
</section>

<!-- 1 · PROBLEM -->
<section class="ch ch-problem" id="problem" data-ch="1">
  <div class="wrap">
    ${head(t.problem)}
    <div class="tools">
      <p class="mini" data-r>${t.problem.toolsLabel}</p>
      <ul>
        ${t.problem.tools.map(([b, s]) => `<li class="tool" data-tool><b>${b}</b><span>${s}</span></li>`).join('\n        ')}
      </ul>
    </div>
    <div class="pains">
      ${t.problem.pains.map(([a, b, c], i) => `<article class="card pain" data-r><div class="pain-top"><span class="pain-idx">${pad(i + 1)}<i> / ${pad(t.problem.pains.length)}</i></span><span class="pain-ic" aria-hidden="true">${painIcons[i]}</span></div><h3>${a}</h3><p>${b}</p>${c ? `<div class="pain-tag">${c}</div>` : ''}</article>`).join('\n      ')}
    </div>
  </div>
</section>

<!-- переключатель ровно на стыке «Проблема → Манифест» -->
<div class="switch-seam">
  <button class="next-switch" type="button" role="switch" aria-checked="false" aria-label="${t.problem.switch.aria}">
    <span class="ns-track" aria-hidden="true"><span class="ns-knob"></span></span>
  </button>
</div>

<!-- 2 · MODULES (pin) -->
<section class="mani" id="mani" data-nofx>
  <div class="wrap">
    <p class="mini mani-k"><i class="dot"></i>${t.mani.k}</p>
    <p class="mani-t" data-mani>${t.mani.t}</p>
  </div>
</section>
${vband(t.band, 1)}

<section class="ch ch-modules" id="modules" data-ch="2">
  <div class="mod-pin">
    <div class="mod-top">
      <div class="wrap">
        <p class="kicker mod-kick">${t.modules.kicker}</p>
        <h2 class="h-ch mod-h2">${t.modules.h2.map((l) => `<span class="ln">${l}</span>`).join('')}</h2>
        <p class="lede mod-lede">${t.modules.lede}</p>
      </div>
    </div>
    <div class="mod-bar" aria-hidden="true"><i data-mod-bar></i></div>
    <div class="mod-fallback">
      ${head(t.modules, 'mod-head')}
      <ol class="mod-list" aria-label="${t.modules.listAria}">
        ${t.modules.items.map((m, i) => `<li><i>${pad(i + 1)}</i>${m.name}</li>`).join('\n        ')}
      </ol>
    </div>
  </div>
</section>

<!-- 3 · LIVE -->
<section class="ch ch-live" id="live" data-ch="3">
  <div class="wrap">
    ${head(t.live)}
    <div class="live-grid">
      <article class="card lc lc-rev" data-r>
        <span class="mini"><i class="dot"></i>${t.live.rev.label}</span>
        <p class="lc-num"><b data-count="12.48" data-dec="2">12,48</b><small>${t.live.rev.unit}</small></p>
        <span class="delta">+<b data-count="18.4" data-dec="1">${t.live.rev.delta}</b>%</span>
        <div class="bars" data-bars>${[22, 30, 26, 44, 58, 52, 70, 64, 86, 78, 100, 92].map((v) => `<i style="--v:${v}"></i>`).join('')}</div>
        <div class="axis">${t.live.rev.axis.map((a) => `<span>${a}</span>`).join('')}</div>
        ${t.live.rev.foot ? `<div class="lc-foot">${t.live.rev.foot.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>` : ''}
      </article>
      <article class="card lc lc-receipt" data-r>
        <div class="rc-head"><b>${t.live.receipt.head}</b><span>${t.live.receipt.no}</span></div>
        <p class="rc-meta">${t.live.receipt.meta}</p>
        <ul>${t.live.receipt.rows.map(([a, b, c]) => `<li data-row><span>${a}</span><i>${b}</i><b>${c}</b></li>`).join('')}</ul>
        <div class="rc-total"><span>${t.live.receipt.total}</span><b><span data-count="214000" data-dec="0">214 000</span> ${t.demo.cur}</b></div>
        <p class="rc-paid"><i class="dot"></i>${t.live.receipt.paid}</p>
        <p class="rc-ofd">${t.live.receipt.ofd}</p>
      </article>
      <article class="card lc lc-kds" data-r>
        <span class="mini"><i class="dot dot-coral"></i>${t.live.kds.label}</span>
        <ul>${t.live.kds.rows.map(([a, b, s]) => `<li><span><b>${a}</b>${b}</span><em data-timer="${s}">${mmss(s)}</em></li>`).join('')}</ul>
        <p class="lc-foot">${t.live.kds.foot}</p>
      </article>
      <article class="card lc lc-stock" data-r>
        <span class="mini"><i class="dot dot-coral"></i>${t.live.stock.label}</span>
        <p class="lc-num"><b>${t.live.stock.n}</b><small>${t.live.stock.unit}</small></p>
        <p class="lc-foot">${t.live.stock.foot}</p>
      </article>
    </div>
  </div>
</section>

<!-- 4 · ROLES -->
<section class="ch ch-roles" id="roles" data-ch="4">
  <div class="wrap">
    ${head(t.roles)}
${t.ah ? rolesShow(t) : rolesTabs(t)}
  </div>
</section>

<!-- ЖИВОЕ ДЕМО: интерфейс сам проходит сценарий (src/demo.mjs) -->
${demo(t)}

<!-- PAPER -->
<div class="paper" id="paper">
  <section class="sec sec-shift" id="shift">
    <div class="wrap">
      ${head(t.shift)}
      <div class="shift">
        <div class="sh-head" aria-hidden="true"><span></span><span>${t.shift.was}</span><span>${t.shift.now}</span></div>
        ${t.shift.rows.map(([k, a, b]) => `<div class="sh-row" data-r><span class="sh-k">${k}</span><p class="sh-was"><span class="vh">${t.shift.was}: </span>${a}</p><p class="sh-now"><span class="vh">${t.shift.now}: </span>${right}<b>${b}</b></p></div>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section class="sec" id="launch">
    <div class="wrap">
      ${head(t.launch)}
      <ol class="route">
        ${t.launch.steps.map(([a, b], i) => `<li class="rt" style="--i:${i}" data-r><span class="rt-n">${pad(i + 1)}</span><h3>${a}</h3><p>${b}</p></li>`).join('\n        ')}
        <li class="rt-line" aria-hidden="true"><i></i></li>
      </ol>
    </div>
  </section>

  <section class="sec" id="faq">
    <div class="wrap faq-grid">
      <div>
        ${head(t.faq)}
        <a class="mail" href="#contact" data-lead data-r>${right}${t.form.send}</a>
      </div>
      <div class="faq" data-r>
        ${t.faq.items.map(([q, a]) => `<details><summary>${q}<i aria-hidden="true"></i></summary><p>${a}</p></details>`).join('\n        ')}
      </div>
    </div>
  </section>
</div>

<!-- 6 · FINALE -->
<section class="ch ch-cta" id="contact" data-ch="6">
  <div class="cta-veil" aria-hidden="true"></div>
  <div class="wrap cta-in">
    ${h(t.cta.h2, 'h-cta')}
    <p class="lede" data-r>${t.cta.lede}</p>
    <div class="btns" data-r>
      <a class="btn btn-mint btn-lg" href="mailto:support@marjon.tech?subject=${encodeURIComponent(t.cta.aSubj)}" data-lead>${t.cta.a}${arrow}</a>
      <a class="btn btn-line btn-lg" href="https://www.instagram.com/marjon_tech" target="_blank" rel="noopener">${t.cta.b}${right}</a>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="brand" href="#top" aria-label="${t.nav.home}">${mark}<span>Marjon</span></a>
        <p>${t.foot.about}</p>
        <div class="foot-apps">
          <a class="app-btn" href="https://play.google.com/store/apps/details?id=uz.marjon.marjon_mobile" target="_blank" rel="noopener" aria-label="Marjon Staff — Google Play"><svg viewBox="0 0 256 283" width="21" height="23" aria-hidden="true"><path fill="#EA4335" d="M119.553 134.916L1.06 259.061a32.14 32.14 0 0 0 47.062 19.071l133.327-75.934z"/><path fill="#FBBC04" d="M239.37 113.814L181.715 80.79l-64.898 56.95l65.162 64.28l57.216-32.67a31.345 31.345 0 0 0 0-55.537z"/><path fill="#4285F4" d="M1.06 23.487A30.6 30.6 0 0 0 0 31.61v219.327a32.3 32.3 0 0 0 1.06 8.124l122.555-120.966z"/><path fill="#34A853" d="m120.436 141.274l61.278-60.483L48.564 4.503A32.85 32.85 0 0 0 32.051 0C17.644-.028 4.978 9.534 1.06 23.399z"/></svg><span class="app-btn-t"><small>${t.foot.apps.getIt}</small><b>${t.foot.apps.play}</b></span></a>
          <button class="app-btn" type="button" data-apps-open aria-haspopup="dialog" aria-controls="apps-modal" aria-label="Marjon — App Store"><svg viewBox="0 0 256 315" width="19" height="23" aria-hidden="true" fill="#fff"><path d="M213.803 167.03c.442 47.58 41.74 63.413 42.197 63.615c-.35 1.116-6.599 22.563-21.757 44.716c-13.104 19.153-26.705 38.235-48.13 38.63c-21.05.388-27.82-12.483-51.888-12.483c-24.061 0-31.582 12.088-51.51 12.871c-20.68.783-36.428-20.71-49.64-39.793c-27-39.033-47.633-110.3-19.928-158.406c13.763-23.89 38.36-39.017 65.056-39.405c20.307-.387 39.475 13.662 51.889 13.662c12.406 0 35.699-16.895 60.186-14.414c10.25.427 39.026 4.14 57.503 31.186c-1.49.923-34.335 20.044-33.978 59.822M174.24 50.199c10.98-13.29 18.369-31.79 16.353-50.199c-15.826.636-34.962 10.546-46.314 23.828c-10.173 11.763-19.082 30.589-16.678 48.633c17.64 1.365 35.66-8.964 46.64-22.262"/></svg><span class="app-btn-t"><small>${t.foot.apps.dl}</small><b>${t.foot.apps.appstore}</b></span></button>
        </div>
      </div>
      ${t.foot.cols.map(([title, links]) => `<div class="foot-col"><h3>${title}</h3>${links.map(([href, l]) => `<a href="${link(href)}">${l}</a>`).join('')}</div>`).join('\n      ')}
    </div>
    <div class="foot-word" aria-hidden="true">MARJON</div>
    ${t.review || ''}
    <div class="foot-bottom"><span>© <span data-year>2026</span> ${t.foot.rights}</span><span>${t.foot.made}</span></div>
  </div>
</footer>

<!-- ПРИЛОЖЕНИЯ: два 3D-телефона (Owner / Staff) и кнопка скачать -->
<div class="apps" id="apps-modal" hidden data-lenis-prevent>
  <div class="apps-bg" data-apps-close></div>
  <div class="apps-box" role="dialog" aria-modal="true" aria-labelledby="apps-t" tabindex="-1">
    <button class="apps-x" type="button" data-apps-close aria-label="${t.foot.apps.close}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    <p class="mini apps-mini">${t.foot.apps.appstore}</p>
    <h3 class="apps-t" id="apps-t">${t.foot.apps.modalTitle}</h3>
    <div class="phone-stage">
      <button class="iphone-wrap phone-l is-on" type="button" data-apps-pick="owner" aria-pressed="true">
        <span class="iphone"><span class="iphone-screen"><img src="/apps/owner.webp" alt="Marjon Owner — Дашборд" width="640" height="1422" loading="lazy" /></span></span>
        <span class="iphone-cap"><b>${t.foot.apps.owner}</b><small>${t.foot.apps.ownerD}</small></span>
      </button>
      <button class="iphone-wrap phone-r" type="button" data-apps-pick="staff" aria-pressed="false">
        <span class="iphone"><span class="iphone-screen"><img src="/apps/staff.webp" alt="Marjon Staff — стол и меню" width="640" height="1385" loading="lazy" /></span></span>
        <span class="iphone-cap"><b>${t.foot.apps.staff}</b><small>${t.foot.apps.staffD}</small></span>
      </button>
    </div>
    <a class="apps-cta" id="apps-cta" href="https://apps.apple.com/ca/app/marjon-owner/id6808735197" target="_blank" rel="noopener"><svg viewBox="0 0 256 315" width="15" height="19" aria-hidden="true" fill="currentColor"><path d="M213.803 167.03c.442 47.58 41.74 63.413 42.197 63.615c-.35 1.116-6.599 22.563-21.757 44.716c-13.104 19.153-26.705 38.235-48.13 38.63c-21.05.388-27.82-12.483-51.888-12.483c-24.061 0-31.582 12.088-51.51 12.871c-20.68.783-36.428-20.71-49.64-39.793c-27-39.033-47.633-110.3-19.928-158.406c13.763-23.89 38.36-39.017 65.056-39.405c20.307-.387 39.475 13.662 51.889 13.662c12.406 0 35.699-16.895 60.186-14.414c10.25.427 39.026 4.14 57.503 31.186c-1.49.923-34.335 20.044-33.978 59.822M174.24 50.199c10.98-13.29 18.369-31.79 16.353-50.199c-15.826.636-34.962 10.546-46.314 23.828c-10.173 11.763-19.082 30.589-16.678 48.633c17.64 1.365 35.66-8.964 46.64-22.262"/></svg><span>${t.foot.apps.dlCta} <b id="apps-cta-name">Marjon Owner</b></span></a>
  </div>
</div>

<!-- ЗАЯВКА: большое белое окно -->
<div class="lead" id="lead" hidden data-lenis-prevent>
  <div class="lead-bg" data-lead-close></div>
  <div class="lead-box" role="dialog" aria-modal="true" aria-labelledby="lead-t" tabindex="-1">
    <button class="lead-x" type="button" data-lead-close aria-label="${t.form.x}"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    <div class="lead-side">
      <span class="lead-brand">${mark}<b>Marjon</b></span>
      <span class="lead-pearl" aria-hidden="true"><i></i><svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="lp-body" cx="41%" cy="35%" r="72%"><stop offset="0" stop-color="#fffefb"/><stop offset=".28" stop-color="#f6f0e6"/><stop offset=".55" stop-color="#ddd4c6"/><stop offset=".8" stop-color="#a69d8e"/><stop offset="1" stop-color="#5a554d"/></radialGradient>
          <radialGradient id="lp-shade" cx="30%" cy="26%" r="92%"><stop offset=".38" stop-color="#1a1611" stop-opacity="0"/><stop offset=".74" stop-color="#1a1611" stop-opacity=".46"/><stop offset="1" stop-color="#0c0a08" stop-opacity=".86"/></radialGradient>
          <radialGradient id="lp-bounce" cx="68%" cy="86%" r="38%"><stop offset="0" stop-color="#bff5e9" stop-opacity=".75"/><stop offset="1" stop-color="#bff5e9" stop-opacity="0"/></radialGradient>
          <linearGradient id="lp-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#9ff0df" stop-opacity="0"/><stop offset="1" stop-color="#9ff0df" stop-opacity=".8"/></linearGradient>
          <clipPath id="lp-clip"><circle cx="100" cy="100" r="92"/></clipPath>
          <filter id="lp-b18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
          <filter id="lp-b9" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
          <filter id="lp-b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>
          <filter id="lp-nacre" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".012 .05" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .9 .5 0 0 -.45"/><feGaussianBlur stdDeviation="1.2"/></filter>
        </defs>
        <g clip-path="url(#lp-clip)">
          <circle cx="100" cy="100" r="92" fill="url(#lp-body)"/>
          <!-- перламутр: розовый, мятный и голубой отливы -->
          <g style="mix-blend-mode:soft-light">
            <ellipse cx="138" cy="70" rx="46" ry="40" fill="#ff9fc4" filter="url(#lp-b18)" opacity=".85"/>
            <ellipse cx="66" cy="140" rx="50" ry="40" fill="#58e6c9" filter="url(#lp-b18)" opacity=".9"/>
            <ellipse cx="120" cy="150" rx="40" ry="28" fill="#8fb8ff" filter="url(#lp-b18)" opacity=".7"/>
          </g>
          <rect width="200" height="200" filter="url(#lp-nacre)" opacity=".16" style="mix-blend-mode:overlay"/>
          <circle cx="100" cy="100" r="92" fill="url(#lp-shade)"/>
          <circle cx="100" cy="100" r="92" fill="url(#lp-bounce)"/>
          <!-- блики: мягкое «окно» и резкая точка -->
          <ellipse cx="70" cy="58" rx="36" ry="25" fill="#fff" opacity=".8" filter="url(#lp-b9)" transform="rotate(-28 70 58)"/>
          <ellipse cx="63" cy="52" rx="15" ry="9" fill="#fff" opacity=".95" filter="url(#lp-b3)" transform="rotate(-28 63 52)"/>
          <ellipse cx="61" cy="50" rx="8.5" ry="4.6" fill="#fff" transform="rotate(-28 61 50)"/>
          <circle cx="84" cy="43" r="2.2" fill="#fff" opacity=".9"/>
          <circle cx="100" cy="100" r="90" fill="none" stroke="url(#lp-rim)" stroke-width="3.5" filter="url(#lp-b3)"/>
        </g>
      </svg></span>
      <h2 id="lead-t">${t.form.title.join(' ')}</h2>
      <div class="lead-set">
        <p class="lead-sum"><b data-lead-type>${t.form.types[0]}</b> · <b data-lead-count>1</b> <span data-lead-pts data-w="${t.form.pts.join('|')}">${t.form.pts[0]}</span></p>
        <p class="lead-set-k">${t.form.set}</p>
        <ul data-lead-set>${t.modules.items.map((m, i) => `<li data-i="${i}">${m.name}</li>`).join('')}</ul>
      </div>
    </div>
    <form class="lead-form" novalidate data-lead-form data-subj="${t.form.subj}" data-err="${t.form.err}">
      <fieldset><legend>${t.form.type}</legend><div class="lead-opts">${t.form.types.map((x, i) => `<label><input type="radio" name="type" value="${x}" data-k="${i}"${i ? '' : ' checked'} /><span>${x}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>${t.form.count}</legend><div class="lead-opts">${t.form.counts.map((x, i) => `<label><input type="radio" name="count" value="${x}" data-k="${i}"${i ? '' : ' checked'} /><span>${x}</span></label>`).join('')}</div></fieldset>
      <div class="lead-row">
        <label class="lead-f"><input name="name" type="text" autocomplete="name" placeholder=" " required /><span>${t.form.name}</span></label>
        <label class="lead-f"><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder=" " required /><span>${t.form.phone}</span></label>
      </div>
      <label class="lead-f"><input name="venue" type="text" autocomplete="organization" placeholder=" " /><span>${t.form.venue}</span></label>
      <p class="lead-err" role="alert" data-lead-err></p>
      <div class="lead-end">
        <button class="lead-send" type="submit" data-sending="${t.form.sending || ''}"><span data-send-l>${t.form.send}</span>${arrow}</button>
        <small>${t.form.agree}</small>
      </div>
    </form>
    <div class="lead-done" data-lead-done hidden>
      <ol class="ld-steps">
        ${t.form.doneSteps.map(([a, b], i) => `<li class="${['ok', 'now', ''][i]}" style="--i:${i}"${t.form.doneOk?.[i] ? ` data-ok-h="${t.form.doneOk[i][0]}" data-ok-p="${t.form.doneOk[i][1]}"` : ''}><i aria-hidden="true">${i ? i + 1 : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5 10 17.5 19.5 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'}</i><div><h3>${a}</h3>${i ? `<p>${b}</p>` : '<p class="ld-sum" data-lead-sum></p>'}${i === 1 ? `<div class="ld-act"><button class="lead-send" type="button" data-lead-again>${t.form.again}${arrow}</button><button class="lead-ghost" type="button" data-lead-copy data-ok="${t.form.copied}">${t.form.copy}</button></div><small>${t.form.noMail}</small>` : ''}</div></li>`).join('\n        ')}
      </ol>
      <button class="lead-back" type="button" data-lead-close>${right}${t.form.close}</button>
    </div>
  </div>
</div>
</body>
</html>
`;
}
