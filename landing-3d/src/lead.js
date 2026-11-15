// Заявка на подключение: большое белое окно поверх страницы. Открывается любым элементом [data-lead].
// Слева — живой итог: формат, число точек и разделы, с которых обычно начинают (меняются вместе с выбором).
// Своего сервера заявок у лендинга нет: отправка собирает письмо на support@marjon.tech (mailto),
// а экран после отправки честно ведёт по шагам и даёт запасной путь — скопировать заявку.
// Когда появится адрес для заявок, достаточно заменить send().
import './lead.css';

const root = document.getElementById('lead');
if (root) {
  const html = document.documentElement, $ = (s) => root.querySelector(s);
  const box = $('.lead-box'), form = $('[data-lead-form]'), done = $('[data-lead-done]'), err = $('[data-lead-err]');
  const setEl = [...root.querySelectorAll('[data-lead-set] li')], typeEl = $('[data-lead-type]'), countEl = $('[data-lead-count]'), ptsEl = $('[data-lead-pts]');
  const pts = ptsEl.dataset.w.split('|');
  // разделы по формату: 0 касса · 1 кухня · 2 склад · 3 доставка · 4 гости · 5 персонал · 6 отчёты · 7 оплата
  const SETS = [[0, 1, 2], [0, 1, 2, 4, 5], [0, 1, 3], [0, 2, 6]];
  let last = null, hideT = 0, mail = '', text = '';

  const sync = () => {
    const ty = form.querySelector('[name="type"]:checked'), co = form.querySelector('[name="count"]:checked');
    const set = new Set(SETS[+ty.dataset.k] || SETS[0]);
    if (+co.dataset.k > 0) { set.add(5); set.add(6); } // несколько точек — нужны персонал и отчёты по филиалам
    let n = 0;
    setEl.forEach((li) => { const on = set.has(+li.dataset.i); li.classList.toggle('on', on); li.style.setProperty('--d', on ? n++ * 60 + 'ms' : '0ms'); });
    typeEl.textContent = ty.value; countEl.textContent = co.value; ptsEl.textContent = pts[+co.dataset.k] || pts[0];
    const sum = $('.lead-sum'); sum.classList.remove('flip'); void sum.offsetWidth; sum.classList.add('flip');
  };
  form.addEventListener('change', sync); sync();

  // телефон: +998 90 123 45 67
  const phone = form.querySelector('[name="phone"]');
  const fmt = (v) => {
    let d = v.replace(/\D/g, ''); if (!d) return '';
    if (d.startsWith('998')) d = d.slice(3); else if (d.length > 9 && d.startsWith('8')) d = d.slice(1);
    d = d.slice(0, 9);
    return '+998 ' + [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
  };
  const toEnd = () => { const n = phone.value.length; try { phone.setSelectionRange(n, n); } catch {} };
  // мобильная клавиатура: поле в фокусе всегда остаётся в видимой части окна
  const vv = window.visualViewport;
  const intoView = (el) => { if (!el || !el.matches?.('input, select, textarea') || !matchMedia('(max-width: 860px), (pointer: coarse)').matches) return;
    const r = el.getBoundingClientRect(), vh = vv ? vv.height : window.innerHeight; if (r.top < 70 || r.bottom > vh - 24) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  form.addEventListener('focusin', (e) => { setTimeout(() => intoView(e.target), 60); setTimeout(() => intoView(e.target), 420); });
  vv?.addEventListener('resize', () => { box.closest('.lead')?.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'); if (form.contains(document.activeElement)) intoView(document.activeElement); });
  phone.addEventListener('focus', () => { if (!phone.value) { phone.value = '+998 '; toEnd(); setTimeout(toEnd); } });
  phone.addEventListener('blur', () => { if (phone.value.replace(/\D/g, '') === '998') phone.value = ''; });
  phone.addEventListener('input', (e) => { if (e.inputType?.startsWith('delete')) return; phone.value = fmt(phone.value); toEnd(); });

  const open = (from) => {
    clearTimeout(hideT);
    last = from || document.activeElement;
    form.hidden = false; done.hidden = true; root.classList.remove('sent'); err.textContent = '';
    root.hidden = false;
    void root.offsetWidth; // запустить переход
    root.classList.add('on'); html.classList.add('lead-open');
    window.dispatchEvent(new CustomEvent('lead:open'));
    setTimeout(() => ((matchMedia('(pointer: coarse)').matches ? null : form.querySelector('input[name="name"]')) || box).focus({ preventScroll: true }), 350); // на телефоне клавиатура не выскакивает сама
  };
  const close = () => {
    if (root.hidden) return;
    root.classList.remove('on'); html.classList.remove('lead-open');
    window.dispatchEvent(new CustomEvent('lead:close'));
    hideT = setTimeout(() => { root.hidden = true; }, 450);
    last?.focus?.({ preventScroll: true });
  };

  // перехват раньше обработчика якорей: «Подключить» не скроллит, а открывает окно
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-lead]');
    if (a) { e.preventDefault(); e.stopPropagation(); open(a); return; }
    if (e.target.closest?.('[data-lead-close]')) { e.preventDefault(); close(); return; }
    if (e.target.closest?.('[data-lead-again]')) { location.href = mail; return; }
    const c = e.target.closest?.('[data-lead-copy]');
    if (c) navigator.clipboard?.writeText(text).then(() => { const t = c.textContent; c.textContent = c.dataset.ok; c.classList.add('ok'); setTimeout(() => { c.textContent = t; c.classList.remove('ok'); }, 1800); }).catch(() => {});
  }, true);
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // фокус остаётся внутри окна
      const f = [...box.querySelectorAll('button, input, a[href]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    }
  });

  const send = (d) => {
    const L = (n) => { const el = form.querySelector(`[name="${n}"]`), fs = el.closest('fieldset'); return (fs ? fs.querySelector('legend') : el.closest('label').querySelector('span')).textContent.trim(); };
    const set = setEl.filter((li) => li.classList.contains('on')).map((li) => li.textContent).join(', ');
    text = [`${L('type')}: ${d.type}`, `${L('count')}: ${d.count}`, `${L('name')}: ${d.name}`, `${L('phone')}: ${d.phone}`, d.venue && `${L('venue')}: ${d.venue}`, set && `Модули: ${set}`].filter(Boolean).join('\n');
    mail = `mailto:support@marjon.tech?subject=${encodeURIComponent(form.dataset.subj)}&body=${encodeURIComponent(text)}`;
  };
  // заявка уходит менеджеру в Telegram через адрес /lead на сервере (токен бота хранится там, не в коде сайта)
  const toTelegram = async () => {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000);
    try { const r = await fetch('/lead?t=' + encodeURIComponent(('Заявка с сайта marjon.tech\n\n' + text).slice(0, 900)), { method: 'POST', signal: ctl.signal, cache: 'no-store' }); return r.status === 204 || r.status === 200; }
    catch { return false; } finally { clearTimeout(tm); }
  };
  form.addEventListener('input', () => { err.textContent = ''; form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad')); });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const bad = ['name', 'phone'].filter((n) => !String(d[n] || '').trim() || (n === 'phone' && String(d[n]).replace(/\D/g, '').length < 12));
    if (bad.length) {
      err.textContent = form.dataset.err;
      bad.forEach((n) => form.querySelector(`[name="${n}"]`).closest('label').classList.add('bad'));
      form.querySelector(`[name="${bad[0]}"]`).focus();
      return;
    }
    send(d);
    const btn = form.querySelector('.lead-send'), lbl = btn.querySelector('[data-send-l]'), l0 = lbl.textContent;
    busy = true; btn.disabled = true; if (btn.dataset.sending) lbl.textContent = btn.dataset.sending;
    const ok = await toTelegram();
    busy = false; btn.disabled = false; lbl.textContent = l0;
    const steps = [...done.querySelectorAll('.ld-steps li')];
    if (ok) { // дошло: второй шаг уже выполнен, почта не нужна
      steps.forEach((li) => { if (li.dataset.okH) { li.querySelector('h3').textContent = li.dataset.okH; const p = li.querySelector('p:not(.ld-sum)'); if (p && li.dataset.okP) p.textContent = li.dataset.okP; } });
      steps[1]?.querySelectorAll('.ld-act, small').forEach((x) => { x.hidden = true; });
      steps[1]?.classList.replace('now', 'ok'); steps[2]?.classList.add('now');
    } else location.href = mail; // запасной путь: письмо в почтовой программе
    $('[data-lead-sum]').textContent = [d.type, `${d.count} ${ptsEl.textContent}`, d.name.trim(), d.phone].join(' · ');
    form.hidden = true; done.hidden = false; root.classList.add('sent');
    done.querySelector('button').focus({ preventScroll: true });
  });
}
