// HTML-шаблон лендинга. Один источник для ru и uz: scripts/build-pages.mjs
// рендерит его в index.html и uz/index.html.
const arrow = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 17.5 17.5 6.5M8 6.5h9.5V16"/></svg>';
const right = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
const mark = `<svg class="mark" viewBox="55 370 430 290" aria-hidden="true" focusable="false">
  <rect x="39.71" y="472.12" width="316.08" height="86.27" rx="43.135" transform="rotate(-45 197.75 515.25)" fill="#14B8A6"/>
  <rect x="193.39" y="472.61" width="314.75" height="85.29" rx="42.645" transform="rotate(-45.44 350.76 515.25)" fill="#5fd6cf"/>
  <path d="M461 525C466 526 470 531 470 537L470 599C470 616 461 629 445 636C434 641 420 641 408 635C394 628 386 615 386 600C386 589 390 580 398 571L439 530C445 524 453 522 461 525Z" fill="currentColor"/>
</svg>`;
const pad = (n) => String(n).padStart(2, '0');
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
const h = (lines, cls, tag = 'h2') =>
  `<${tag} class="${cls}" data-split>${lines.map((l) => `<span class="ln">${l}</span>`).join(' ')}</${tag}>`;
const head = (s, extra = '') => `
      <header class="sec-head ${extra}">
        <p class="kicker" data-r>${s.kicker}</p>
        ${h(s.h2, 'h-ch')}
        <p class="lede" data-r>${s.lede}</p>
      </header>`;
const marquee = (items, rev) => `
        <div class="mq ${rev ? 'mq-rev' : ''}"><div class="mq-track">
          ${[0, 1].map((k) => items.map(([b, s]) => `<div class="iq"${k ? ' aria-hidden="true"' : ''}><b>${b}</b><span>${s}</span></div>`).join('')).join('')}
        </div></div>`;

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
<script>document.documentElement.classList.replace('no-js','js');</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Marjon","applicationCategory":"BusinessApplication","operatingSystem":"Web, Windows, Android, iOS","url":"https://marjon.tech${t.path}","description":"${t.desc}","inLanguage":["ru","uz","en"],"publisher":{"@type":"Organization","name":"Marjon","url":"https://marjon.tech/"}}
</script>
<script type="module" src="/src/main.js"></script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>

<div class="loader" id="loader" aria-hidden="true">
  <div class="loader-in">
    <span class="loader-t">${t.loader}</span>
    <span class="loader-n"><b data-loader-n>0</b>%</span>
  </div>
  <i class="loader-bar" data-loader-bar></i>
</div>

<div class="stage" aria-hidden="true">
  <div class="poster"></div>
  <canvas id="gl"></canvas>
  <div class="stage-shade"></div>
</div>
<div class="bead-labels" aria-hidden="true">
  ${t.modules.items.map((m, i) => `<span class="bl" data-bl="${i}"><i>${pad(i + 1)}</i>${m.short}</span>`).join('')}
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
      <a class="btn btn-mint btn-sm" href="#contact">${t.nav.cta}${arrow}</a>
    </div>
    <button class="burger" type="button" aria-label="${t.nav.menuOpen}" aria-expanded="false" aria-controls="menu" data-open="${t.nav.menuOpen}" data-close="${t.nav.menuClose}"><span></span><span></span></button>
  </nav>
</header>

<div class="menu" id="menu" aria-hidden="true" inert>
  <div class="menu-links">
    ${t.nav.links.map(([href, l], i) => `<a href="${href}"><i>${pad(i + 1)}</i>${l}</a>`).join('\n    ')}
  </div>
  <div class="menu-foot">
    <a class="btn btn-mint" href="#contact">${t.hero.cta}${arrow}</a>
    <a class="btn btn-line" href="https://admin.marjon.tech/login">${t.nav.login}</a>
  </div>
</div>

<nav class="rail" aria-hidden="true">
  ${t.rail.map((l, i) => `<span class="rail-i" data-rail="${i}"><b>${pad(i)}</b><i>${l}</i></span>`).join('\n  ')}
</nav>

<main id="main">

<!-- 0 · HERO -->
<section class="ch ch-hero" id="top" data-ch="0">
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
        <a class="btn btn-mint" href="#contact">${t.hero.cta}${arrow}</a>
        <a class="btn btn-line" href="#modules">${t.hero.cta2}${right}</a>
      </div>
    </div>
  </div>
  <div class="chip chip-a" data-float="1" data-r>
    <span class="chip-top"><i class="dot"></i>${t.hero.chipA.top}</span>
    <span class="chip-big">${t.hero.chipA.sum} <small>${t.hero.chipA.cur}</small></span>
    <span class="chip-foot">${t.hero.chipA.foot}</span>
  </div>
  <div class="chip chip-b" data-float="-1" data-r>
    <span class="chip-top"><i class="dot dot-coral"></i>${t.hero.chipB.top}</span>
    <span class="chip-big" data-timer="42">${t.hero.chipB.time}</span>
    <span class="chip-foot">${t.hero.chipB.foot}</span>
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
      ${t.problem.pains.map(([a, b], i) => `<article class="card pain" data-r><span class="idx">${pad(i + 1)}</span><h3>${a}</h3><p>${b}</p><i class="x" aria-hidden="true"></i></article>`).join('\n      ')}
    </div>
  </div>
</section>

<!-- 2 · MODULES (pin) -->
<section class="ch ch-modules" id="modules" data-ch="2">
  <div class="mod-pin">
    <div class="wrap mod-grid">
      ${head(t.modules, 'mod-head')}
      <div class="mod-count" aria-hidden="true"><b data-mod-n>01</b><i>/ 08</i></div>
      <ol class="mod-list" aria-label="${t.modules.listAria}">
        ${t.modules.items.map((m, i) => `<li><button type="button" class="mod-b${i ? '' : ' on'}" data-mod="${i}"><i>${pad(i + 1)}</i><span>${m.name}</span></button></li>`).join('\n        ')}
      </ol>
      <div class="mod-cards">
        ${t.modules.items.map((m, i) => `<article class="card mod-card${i ? '' : ' on'}" data-mod-card="${i}"${i ? ' aria-hidden="true"' : ''}>
          <span class="idx">${pad(i + 1)} / 08</span>
          <h3>${m.name}</h3>
          <p>${m.text}</p>
          <div class="tags">${m.tags.map((x) => `<span>${x}</span>`).join('')}</div>
          <div class="mod-live"><span><i class="dot"></i>${m.live[0]}</span><b>${m.live[1]}</b></div>
        </article>`).join('\n        ')}
      </div>
      <div class="mod-bar" aria-hidden="true"><i data-mod-bar></i></div>
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
      </article>
      <article class="card lc lc-receipt" data-r>
        <div class="rc-head"><b>${t.live.receipt.head}</b><span>${t.live.receipt.no}</span></div>
        <p class="rc-meta">${t.live.receipt.meta}</p>
        <ul>${t.live.receipt.rows.map(([a, b, c]) => `<li data-row><span>${a}</span><i>${b}</i><b>${c}</b></li>`).join('')}</ul>
        <div class="rc-total"><span>${t.live.receipt.total}</span><b><span data-count="214000" data-dec="0">214 000</span> UZS</b></div>
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
    <div class="roles" data-r>
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
    </div>
  </div>
</section>

<!-- 5 · UZBEKISTAN -->
<section class="ch ch-uz" id="uzbekistan" data-ch="5">
  <div class="wrap">
    ${head(t.uz)}
    <div class="stats">
      ${t.uz.stats.map((s) => `<div class="stat" data-r><p class="stat-n">${s.pre ? `<i>${s.pre}</i>` : ''}<b data-count="${s.n}" data-dec="0">${s.n}</b>${s.suf ? `<small>${s.suf}</small>` : ''}</p><span>${s.label}</span></div>`).join('\n      ')}
    </div>
    <div class="feats">
      ${t.uz.feats.map(([a, b], i) => `<div class="feat" data-r><i>${pad(i + 1)}</i><h3>${a}</h3><p>${b}</p></div>`).join('\n      ')}
    </div>
  </div>
</section>

<!-- PAPER -->
<div class="paper" id="paper">
  <section class="sec" id="platforms">
    <div class="wrap">
      ${head(t.platforms)}
      <div class="plats">
        ${[['web', 'dash', 1535, 958], ['desk', 'pos', 1535, 958], ['phone', 'mobile', 575, 1236]].map(([k, img, w, hh], i) => `<article class="plat plat-${k}" data-r>
          <figure class="shot shot-${k}">${k === 'web' ? '<div class="shot-bar"><i></i><i></i><i></i><span>admin.marjon.tech</span></div>' : ''}<img src="/src/assets/shots/${img}.webp" width="${w}" height="${hh}" alt="${t.platforms.alt[i]}" loading="lazy" decoding="async" /></figure>
          <div class="plat-txt"><span class="mini">${t.platforms.items[i].os}</span><h3>${t.platforms.items[i].name}</h3><p>${t.platforms.items[i].text}</p>
          <div class="tags">${t.platforms.items[i].tags.map((x) => `<span>${x}</span>`).join('')}</div></div>
        </article>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section class="sec sec-integ" id="integrations">
    <div class="wrap">${head(t.integ)}</div>
    <div class="mq-wrap" data-r>${marquee(t.integ.a)}${marquee(t.integ.b, true)}
    </div>
  </section>

  <section class="sec" id="launch">
    <div class="wrap">
      ${head(t.launch)}
      <ol class="steps">
        ${t.launch.steps.map(([a, b], i) => `<li class="step" data-r><span class="step-n">${pad(i + 1)}</span><h3>${a}</h3><p>${b}</p></li>`).join('\n        ')}
      </ol>
    </div>
  </section>

  <section class="sec" id="faq">
    <div class="wrap faq-grid">
      <div>
        ${head(t.faq)}
        <a class="mail" href="mailto:support@marjon.tech" data-r>${right}support@marjon.tech</a>
      </div>
      <div class="faq" data-r>
        ${t.faq.items.map(([q, a]) => `<details><summary>${q}<i aria-hidden="true"></i></summary><p>${a}</p></details>`).join('\n        ')}
      </div>
    </div>
  </section>
</div>

<!-- 6 · FINALE -->
<section class="ch ch-cta" id="contact" data-ch="6">
  <div class="wrap cta-in">
    ${h(t.cta.h2, 'h-cta')}
    <p class="lede" data-r>${t.cta.lede}</p>
    <div class="btns" data-r>
      <a class="btn btn-mint btn-lg" href="mailto:support@marjon.tech?subject=${encodeURIComponent(t.cta.aSubj)}">${t.cta.a}${arrow}</a>
      <a class="btn btn-line btn-lg" href="mailto:support@marjon.tech?subject=${encodeURIComponent(t.cta.bSubj)}">${t.cta.b}${right}</a>
    </div>
    <p class="cta-note" data-r><i class="dot"></i>${t.cta.note}</p>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="brand" href="#top" aria-label="${t.nav.home}">${mark}<span>Marjon</span></a>
        <p>${t.foot.about}</p>
      </div>
      ${t.foot.cols.map(([title, links]) => `<div class="foot-col"><h3>${title}</h3>${links.map(([href, l]) => `<a href="${link(href)}">${l}</a>`).join('')}</div>`).join('\n      ')}
    </div>
    <div class="foot-word" aria-hidden="true">MARJON</div>
    ${t.review || ''}
    <div class="foot-bottom"><span>© <span data-year>2026</span> ${t.foot.rights}</span><span>${t.foot.made}</span></div>
  </div>
</footer>
</body>
</html>
`;
}
