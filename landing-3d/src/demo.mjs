// Живое демо: настоящие скриншоты «играют» сценарий по скроллу. Общая секция для вариантов A и D.
// Разметка — здесь, стили — demo.css, таймлайн — demo.js. Координаты кликов — проценты скриншотов.
const k = (s) => s.replace(/^\d+\s*\/\s*/, '');

export function demo(t, attrs = '') {
  const s = t.screens, alt = t.platforms.alt, d = t.demo;
  const caps = [[s.pos, 'pos', alt[1]], [s.kitchen], [s.mob, 'mobile', alt[2], true], [s.dash, 'dash', alt[0]]];
  return `  <div class="demo" id="platforms"${attrs}>
    <div class="demo-pin">
      <div class="demo-caps">
        <p class="demo-step"><span>${d.step}</span> <b data-step>01</b> / 04</p>
        <div class="caps">
          ${caps.map(([sc, img, a, ph], i) => `<article class="cap${i ? '' : ' on'}" data-cap>
            <p class="cap-k">${k(sc.kicker)}</p>
            <h2 class="cap-h">${sc.h2.join(' ')}</h2>
            <p class="cap-t">${sc.text}</p>
            ${i === 3 ? `<p class="cap-kpi"><span>${d.income}</span><b><i data-kpi>118 024 000</i> UZS</b></p>` : `<ul class="ticks">${sc.list.slice(0, 2).map((x) => `<li>${x}</li>`).join('')}</ul>`}
            ${img ? `<figure class="cap-fb${ph ? ' ph' : ''}"><img src="/src/assets/shots/${img}.webp" alt="${a}" loading="lazy" width="${ph ? 1170 : 3072}" height="${ph ? 2532 : 1920}" /></figure>` : ''}
          </article>`).join('')}
        </div>
        <div class="demo-bar" aria-hidden="true"><i data-bar></i></div>
        <p class="real">${s.real}</p>
      </div>
      <div class="demo-stage" aria-hidden="true">
        <div class="win" data-win>
          <div class="win-bar"><i></i><i></i><i></i><span class="win-t" data-wt="0">${d.winPos}</span><span class="win-t" data-wt="1">${d.winDash}</span></div>
          <div class="win-view">
            <div class="win-cam" data-cam>
              <img class="scr" src="/src/assets/shots/pos.webp" alt="" width="3072" height="1920" />
              <img class="scr scr-dash" data-dash src="/src/assets/shots/dash.webp" alt="" width="3072" height="1920" />
              ${[[33.7, 41], [21.9, 41], [57.2, 17], [87.6, 87.2]].map(([x, y], i) => `<i class="hit" data-hit="${i}" style="left:${x}%;top:${y}%"></i>`).join('')}
              ${[['MANTI', 33.7, 41], ['OSH', 21.9, 41], ['BORSH', 57.2, 17]].map(([n, x, y], i) => `<span class="fly" data-fly="${i}" style="left:${x}%;top:${y}%">+1 ${n}</span>`).join('')}
              ${[20, 36, 52.1, 68.1].map((x) => `<i class="kring" data-kring style="left:${x}%"></i>`).join('')}
              <i class="d-dot" data-dot></i><span class="d-tip" data-tip><b>13 486 000 UZS</b>${d.peak}</span>
            </div>
            <div class="win-dim" data-dim></div>
            <svg class="cur" data-cur viewBox="0 0 24 24"><path d="M4 2.5 19 11l-6.6 1.7L9.6 19 4 2.500Z" fill="#fff" stroke="#09090b" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </div>
        </div>
        <div class="d-order" data-order><span>${d.table}</span><b><i data-oc>4</i> ${d.items}</b><strong><i data-os>150 000</i> ${d.cur}</strong></div>
        <div class="d-sent" data-sent><i></i>${d.sent}</div>
        <div class="d-kds" data-kds>
          <p>${d.station}</p>
          ${[[d.table, ['Manti × 1', 'Osh × 1', 'Borsh × 1']], ...t.live.kds.rows.slice(1, 3).map(([a, b]) => [a, b.split(' · ')])].map(([a, rows], i) => `<div class="tk" data-tk><header><b>${a}</b><span class="tk-time"${i ? '' : ' data-tkt'}>${i ? ['02:10', '01:18'][i - 1] : '00:00'}</span></header>${rows.map((r) => `<span>${r}</span>`).join('')}<footer><em class="st st-a">${d.cooking}</em>${i ? '' : `<em class="st st-b" data-ready>${d.ready}</em>`}</footer></div>`).join('')}
        </div>
        <div class="phone" data-phone><div class="phone-in"><img data-pimg src="/src/assets/shots/mobile.webp" alt="" width="1170" height="2532" /><i class="hit" data-phit style="left:73%;top:57%"></i></div><span class="p-chip" data-pchip>${d.table} · +1 BORSH</span></div>
      </div>
      <p class="demo-hint" data-hint>${d.hint}</p>
    </div>
  </div>`;
}
