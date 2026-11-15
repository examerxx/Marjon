/* Marjon landing — interactions */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- year ---------- */
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- nav state ---------- */
  var nav = $('.nav');
  function onScrollNav() {
    if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 18);
  }
  onScrollNav();
  window.addEventListener('scroll', onScrollNav, { passive: true });

  /* ---------- mobile menu ---------- */
  var burger = $('.burger');
  var mobileMenu = $('#mobileMenu');
  var lastFocus = null;
  var menuLabelOpen = (burger && burger.dataset.labelOpen) || 'Открыть меню';
  var menuLabelClose = (burger && burger.dataset.labelClose) || 'Закрыть меню';

  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? menuLabelClose : menuLabelOpen);
    mobileMenu.setAttribute('aria-hidden', String(!open));
    if (open) {
      lastFocus = document.activeElement;
      var first = mobileMenu.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    } else if (lastFocus) {
      lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  }

  if (burger && mobileMenu) {
    burger.addEventListener('click', function () {
      setMenu(!document.body.classList.contains('menu-open'));
    });
    $$('a', mobileMenu).forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) setMenu(false);
    });
  }

  /* ---------- Asia/Tashkent clock ---------- */
  var clockFmt;
  try {
    clockFmt = new Intl.DateTimeFormat(document.documentElement.lang || 'ru-RU', {
      timeZone: 'Asia/Tashkent',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (err) { clockFmt = null; }

  function tickClock() {
    if (!clockFmt) return;
    var value = clockFmt.format(new Date()).replace(/\s/g, '');
    $$('[data-clock]').forEach(function (el) { el.textContent = value; });
  }
  tickClock();
  window.setInterval(tickClock, 20000);

  /* ---------- kinetic word ---------- */
  var cycle = $('#cycle');
  if (cycle) {
    var words = (cycle.dataset.words || 'ритме').split(',');
    var wordIndex = 0;
    var cycling = false;

    var renderWord = function (word, leaving) {
      cycle.textContent = '';
      Array.prototype.forEach.call(word, function (char, i) {
        var span = document.createElement('span');
        span.className = 'ch' + (leaving ? ' out' : '');
        span.textContent = char;
        span.style.animationDelay = (leaving ? i * 20 : i * 38) + 'ms';
        cycle.appendChild(span);
      });
    };

    renderWord(words[0], false);

    if (!reduced && words.length > 1) {
      window.setInterval(function () {
        if (cycling) return;
        cycling = true;
        var chars = $$('.ch', cycle);
        chars.forEach(function (ch, i) {
          ch.classList.add('out');
          ch.style.animationDelay = i * 20 + 'ms';
        });
        var wait = 240 + chars.length * 20;
        window.setTimeout(function () {
          wordIndex = (wordIndex + 1) % words.length;
          renderWord(words[wordIndex], false);
          cycling = false;
        }, wait);
      }, 3400);
    }
  }

  /* ---------- receipt QR ---------- */
  var qr = $('#receiptQr');
  if (qr) {
    var seed = 17;
    var rnd = function () {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (var i = 0; i < 49; i++) {
      var r = Math.floor(i / 7);
      var c = i % 7;
      var finder = (r < 3 && c < 3) || (r < 3 && c > 3) || (r > 3 && c < 3);
      var cell = document.createElement('i');
      if (finder || rnd() > 0.52) cell.className = 'on';
      qr.appendChild(cell);
    }
  }

  /* ---------- KDS timer ---------- */
  var kdsTimer = $('#kdsTimer');
  if (kdsTimer && !reduced) {
    var seconds = 42;
    window.setInterval(function () {
      seconds = (seconds + 1) % 5940;
      kdsTimer.textContent =
        String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
        String(seconds % 60).padStart(2, '0');
    }, 1000);
  }

  /* ---------- modules: sticky showcase ---------- */
  var modRows = $$('.mod-row');
  var modPanels = $$('.mod-panel');
  var modStage = $('#modStage');
  var activeMod = -1;
  var modLock = 0;

  function setMod(index) {
    if (index === activeMod) return;
    activeMod = index;
    modRows.forEach(function (row, i) {
      var on = i === index;
      row.classList.toggle('is-active', on);
      row.setAttribute('aria-pressed', String(on));
    });
    modPanels.forEach(function (panel, i) {
      panel.classList.toggle('is-on', i === index);
    });
  }

  if (modRows.length) {
    setMod(0);
    modRows.forEach(function (row, i) {
      row.addEventListener('mouseenter', function () {
        if (finePointer) { modLock = performance.now(); setMod(i); }
      });
      row.addEventListener('focus', function () { setMod(i); });
      row.addEventListener('click', function () {
        modLock = performance.now();
        setMod(i);
      });
    });
  }

  var modTicking = false;
  function syncMods() {
    modTicking = false;
    if (!modStage || window.innerWidth < 1041) return;
    if (performance.now() - modLock < 1100) return;
    var stageRect = modStage.getBoundingClientRect();
    if (stageRect.bottom < 40 || stageRect.top > window.innerHeight - 80) return;
    var mid = window.innerHeight * 0.46;
    var best = activeMod;
    var bestDist = Infinity;
    modRows.forEach(function (row, i) {
      var rect = row.getBoundingClientRect();
      var dist = Math.abs((rect.top + rect.bottom) / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best !== activeMod) setMod(best);
  }
  window.addEventListener('scroll', function () {
    if (modTicking) return;
    modTicking = true;
    window.requestAnimationFrame(syncMods);
  }, { passive: true });

  /* ---------- roles: tabs ---------- */
  var roleTabs = $$('.role-btn');
  var rolePanels = $$('.role-panel');
  var roleList = document.querySelector('.role-tabs');
  var roleMq = window.matchMedia('(max-width: 1040px)');

  if (roleList) {
    var syncRoleOrientation = function () {
      roleList.setAttribute('aria-orientation', roleMq.matches ? 'horizontal' : 'vertical');
    };
    syncRoleOrientation();
    if (roleMq.addEventListener) roleMq.addEventListener('change', syncRoleOrientation);
  }

  function selectRole(index, focus) {
    roleTabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    rolePanels.forEach(function (panel, i) {
      var on = i === index;
      panel.hidden = !on;
      panel.classList.toggle('is-in', on);
    });
    if (focus) roleTabs[index].focus();
  }

  roleTabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectRole(index, false); });
    tab.addEventListener('keydown', function (e) {
      var step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (step) {
        e.preventDefault();
        selectRole((index + step + roleTabs.length) % roleTabs.length, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        selectRole(0, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        selectRole(roleTabs.length - 1, true);
      }
    });
  });

  /* ---------- legal: reading progress + toc ---------- */
  var progressBar = $('.doc-progress i');
  var doc = $('.doc');
  if (progressBar && doc) {
    var updateProgress = function () {
      var start = doc.getBoundingClientRect().top + window.scrollY - 140;
      var end = start + doc.offsetHeight - window.innerHeight * 0.55;
      var p = end > start ? (window.scrollY - start) / (end - start) : 0;
      progressBar.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
  }

  var tocLinks = $$('.doc-toc a[href^="#"]');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var tocById = {};
    tocLinks.forEach(function (link) {
      tocById[link.getAttribute('href').slice(1)] = link;
    });
    var tocIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var current = tocById[entry.target.id];
        tocLinks.forEach(function (link) {
          var on = link === current;
          link.classList.toggle('is-active', on);
          if (on) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-18% 0px -68% 0px' });
    $$('.doc section[id]').forEach(function (section) { tocIO.observe(section); });
  }

  /* ---------- reveals ---------- */
  var revealEls = $$('.reveal');
  var titleEls = $$('.hero h1, .h2, .legal-hero h1');

  function showAll() {
    revealEls.concat(titleEls).forEach(function (el) { el.classList.add('in'); });
  }

  if ('IntersectionObserver' in window) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealIO.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    var titleIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        titleIO.unobserve(entry.target);
      });
    }, { threshold: 0.15 });

    revealEls.forEach(function (el) { revealIO.observe(el); });
    titleEls.forEach(function (el) { titleIO.observe(el); });
  } else {
    showAll();
  }

  /* ---------- statistic counters ---------- */
  var counters = $$('[data-count]');
  if (counters.length && 'IntersectionObserver' in window && !reduced) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        countIO.unobserve(el);
        var target = parseInt(el.getAttribute('data-count'), 10) || 0;
        var started = 0;
        var duration = 1400;
        var step = function (now) {
          if (!started) started = now;
          var p = Math.min(1, (now - started) / duration);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * eased);
          if (p < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countIO.observe(el); });
  }

  /* ---------- FAQ: one open at a time ---------- */
  var faqRoot = $('[data-faq]');
  if (faqRoot) {
    var details = $$('details', faqRoot);
    details.forEach(function (item) {
      item.addEventListener('toggle', function () {
        if (!item.open) return;
        details.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  }

  /* ---------- hero tilt ---------- */
  var heroVisual = $('#heroVisual');
  var receipt = $('#heroReceipt');
  if (heroVisual && receipt && finePointer && !reduced) {
    heroVisual.addEventListener('pointermove', function (e) {
      var rect = heroVisual.getBoundingClientRect();
      var nx = (e.clientX - rect.left) / rect.width - 0.5;
      var ny = (e.clientY - rect.top) / rect.height - 0.5;
      receipt.style.transform =
        'rotate(' + (2.4 + nx * 3.4).toFixed(2) + 'deg) translate(' +
        (nx * 12).toFixed(1) + 'px,' + (ny * 9).toFixed(1) + 'px)';
    });
    heroVisual.addEventListener('pointerleave', function () {
      receipt.style.transform = '';
    });
  }

  /* ---------- ASCII canvas engine ---------- */
  function setupAscii(canvas, mode) {
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var state = {
      w: 0,
      h: 0,
      dpr: 1,
      step: 10,
      t: 0,
      visible: true,
      raf: 0,
      last: 0,
      points: [],
      mouseX: 0,
      mouseY: 0,
      currentX: 0,
      currentY: 0
    };

    var orbChars = '·.,:;+=*#%@';
    var mChars = '.:+*#%@';

    function drawOrb(time) {
      var w = state.w;
      var h = state.h;
      var step = state.step;
      var font = Math.max(8, step * 1.18);
      var chars = orbChars;
      var cx = w / 2 + state.currentX * w * 0.035;
      var cy = h * 0.5 + state.currentY * h * 0.03;
      var base = Math.min(w, h) * 0.37;

      ctx.clearRect(0, 0, w, h);
      ctx.font = '500 ' + font + 'px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (var y = step; y < h; y += step) {
        for (var x = step; x < w; x += step) {
          var dx = x - cx;
          var dy = y - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var angle = Math.atan2(dy, dx);
          var radius = base * (
            1 +
            0.055 * Math.sin(angle * 6 + time * 0.8) +
            0.03 * Math.sin(angle * 13 - time * 0.55)
          );
          var ring = 1 - Math.min(1, Math.abs(dist - radius) / (step * 4.4));
          var grain = 0.5 + 0.5 * Math.sin(angle * 17 + dist * 0.07 - time * 1.3);
          var value = ring * grain;
          if (dist < radius) {
            value = Math.max(value, 0.22 * (0.5 + 0.5 * Math.sin(dist * 0.08 + time * 1.1)));
          }
          if (value < 0.11) continue;

          var char = chars[Math.min(chars.length - 1, Math.floor(value * chars.length))];
          var mint = Math.sin(angle * 3 + dist * 0.05 + time) > 0.55;
          ctx.fillStyle = mint
            ? 'rgba(0, 165, 143,' + (0.14 + value * 0.42).toFixed(3) + ')'
            : 'rgba(12, 12, 13,' + (0.1 + value * 0.34).toFixed(3) + ')';
          ctx.fillText(char, x, y);
        }
      }
    }

    function buildMask() {
      var w = state.w;
      var h = state.h;
      var step = Math.max(6, Math.round(Math.min(w, h) / 62));
      state.step = step;

      var off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      var o = off.getContext('2d');
      if (!o) { state.points = []; return; }

      var size = h * 0.84;
      var family = '600 ' + size + 'px Onest, "Segoe UI", sans-serif';
      o.font = family;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      var width = o.measureText('M').width;
      if (width > w * 0.88) {
        size = size * (w * 0.88) / width;
        o.font = '600 ' + size + 'px Onest, "Segoe UI", sans-serif';
      }
      o.fillStyle = '#fff';
      o.fillText('M', w / 2, h * 0.53);

      var data;
      try {
        data = o.getImageData(0, 0, w, h).data;
      } catch (err) {
        state.points = [];
        return;
      }

      state.points = [];
      for (var y = step; y < h - step; y += step) {
        for (var x = step; x < w - step; x += step) {
          if (data[(y * w + x) * 4 + 3] > 120) {
            state.points.push({ x: x, y: y, seed: ((x * 13 + y * 7) % 97) / 97 });
          }
        }
      }
    }

    function drawM(time) {
      var w = state.w;
      var h = state.h;
      var step = state.step;
      ctx.clearRect(0, 0, w, h);
      ctx.font = '500 ' + Math.max(7, step * 1.1) + 'px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (var i = 0; i < state.points.length; i++) {
        var p = state.points[i];
        var wave = 0.55 + 0.45 * Math.sin(time * 1.5 + p.y * 0.032 + p.x * 0.01);
        var value = wave * 0.82 + p.seed * 0.18;
        var char = mChars[Math.min(mChars.length - 1, Math.floor(value * mChars.length))];
        var bright = value > 0.92;
        ctx.fillStyle = bright
          ? 'rgba(242, 240, 232,' + (0.5 + value * 0.4).toFixed(3) + ')'
          : 'rgba(63, 227, 196,' + (0.18 + value * 0.55).toFixed(3) + ')';
        ctx.fillText(char, p.x, p.y);
      }
    }

    function draw(time) {
      if (!state.w || !state.h) return;
      if (mode === 'm') drawM(time);
      else drawOrb(time);
    }

    function frame(now) {
      state.raf = 0;
      if (!state.visible) return;
      if (now - state.last < 42) {
        state.raf = window.requestAnimationFrame(frame);
        return;
      }
      state.last = now;
      state.t = now / 1000;
      state.currentX += (state.mouseX - state.currentX) * 0.06;
      state.currentY += (state.mouseY - state.currentY) * 0.06;
      draw(state.t);
      state.raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (reduced) {
        state.currentX = 0;
        state.currentY = 0;
        draw(0);
        return;
      }
      if (!state.raf) state.raf = window.requestAnimationFrame(frame);
    }

    function stop() {
      if (state.raf) window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width));
      var h = Math.max(1, Math.round(rect.height));
      if (w === state.w && h === state.h) return;
      state.w = w;
      state.h = h;
      state.dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * state.dpr);
      canvas.height = Math.round(h * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

      if (mode === 'm') {
        buildMask();
      } else {
        state.step = Math.max(8, Math.round(Math.min(w, h) / 46));
      }
      draw(state.t);
    }

    resize();

    var resizeTimer = 0;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        resize();
        start();
      }, 120);
    }
    window.addEventListener('resize', onResize);

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          state.visible = entry.isIntersecting;
          if (state.visible) start();
          else stop();
        });
      }, { threshold: 0.01 });
      io.observe(canvas);
    } else {
      start();
    }

    if (mode === 'orb' && finePointer && !reduced) {
      var host = canvas.parentElement;
      if (host) {
        host.addEventListener('pointermove', function (e) {
          var rect = host.getBoundingClientRect();
          state.mouseX = (e.clientX - rect.left) / rect.width - 0.5;
          state.mouseY = (e.clientY - rect.top) / rect.height - 0.5;
        });
        host.addEventListener('pointerleave', function () {
          state.mouseX = 0;
          state.mouseY = 0;
        });
      }
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (mode === 'm') buildMask();
        draw(state.t);
      });
    }

    return { start: start, stop: stop };
  }

  setupAscii($('#heroCanvas'), 'orb');
  setupAscii($('#ctaCanvas'), 'm');
})();
