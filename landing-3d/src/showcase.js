// Мобильный hero: 3D-слайдер нашей техники — монитор (кухонный экран), моноблок кассы, принтер чеков и телефон.
// Показываем по одному устройству в миниатюре и меняем их по очереди, как у слайдера (автосмена + свайп + точки).
// Только ≤820px и только если WebGL доступен; иначе блок просто скрыт и hero выглядит как раньше.
const SLIDE_MS = 3600, T = 0.85;

export async function initShowcase() {
  const host = document.querySelector('[data-showcase]');
  if (!host || host.dataset.done) return;
  host.dataset.done = '1';
  // десктоп и планшет: слайдер не нужен, техника живёт в основной сцене
  if (!matchMedia('(max-width: 820px)').matches) { host.remove(); return; }
  const canvas = host.querySelector('canvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // тяжёлое грузим лениво и только после проверки ширины — десктоп не платит
  let THREE, RoomEnvironment, gsap, createDevices;
  try {
    [THREE, { RoomEnvironment }, { default: gsap }, { createDevices }] = await Promise.all([
      import('three'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('gsap'),
      import('./devices.js'),
    ]);
  } catch (e) { host.remove(); return; }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    host.remove();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  try { scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture; } catch (e) { /* без окружения материалы всё равно читаются благодаря свету */ }

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0.18, 5.6);
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xfff4e0, 1.5); key.position.set(2.6, 3.4, 4.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x3fe3c4, 1.0); rim.position.set(-3.2, 1.8, -2.6); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x3a4f49, 0x05070a, 0.9));

  // строим устройства через общий фабричный модуль (в основной сцене на телефоне техники нет)
  const rig = new THREE.Group(); // не используется: фабрике нужен объект только для сигнатуры update()
  const devices = createDevices({ scene, renderer, rig, low: true });
  const parts = devices.parts;

  // каждое устройство — в своём «слайде», центрируем и вписываем в кадр по высоте
  const defs = [
    { o: parts.kds, h: 1.8 },      // монитор (кухонный экран)
    { o: parts.pos, h: 2.2 },      // моноблок кассы
    { o: parts.printer, h: 1.15 }, // принтер чеков
    { o: parts.phone, h: 1.95 },   // телефон
  ];
  const fit = (w, h) => {
    const o = w.children[0];
    const box = new THREE.Box3().setFromObject(o);
    const size = box.getSize(new THREE.Vector3());
    const k = size.y > 0 ? h / size.y : 1;
    o.scale.multiplyScalar(k);
    const box2 = new THREE.Box3().setFromObject(o);
    const c = box2.getCenter(new THREE.Vector3());
    o.position.sub(c);
  };
  const slides = defs.map(({ o, h }, i) => {
    o.removeFromParent();              // вырезаем из фабричного графа — показываем отдельно
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    const w = new THREE.Group();
    w.add(o);
    fit(w, h);
    w.visible = i === 0;
    scene.add(w);
    return w;
  });
  // фабричный корень (posSet с терминалом и ноутбуком) больше не нужен
  scene.remove(devices.root);

  // габариты под контейнер
  const resize = () => {
    const r = host.getBoundingClientRect();
    const wpx = Math.max(1, Math.round(r.width)), hpx = Math.max(1, Math.round(r.height));
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  // точки-индикаторы
  const dots = [...host.querySelectorAll('.hero-dot')];
  const setDots = (n) => dots.forEach((d, i) => d.classList.toggle('on', i === n));

  let idx = 0, busy = false;
  const go = (n, dir = 1, instant = false) => {
    if (busy || n === idx) return;
    const cur = slides[idx], nxt = slides[(n + slides.length) % slides.length];
    idx = (n + slides.length) % slides.length;
    setDots(idx);
    if (reduced || instant) { cur.visible = false; nxt.position.set(0, 0, 0); nxt.rotation.set(0, 0, 0); nxt.visible = true; return; }
    busy = true;
    nxt.visible = true;
    gsap.killTweensOf([cur.position, cur.rotation, nxt.position, nxt.rotation]);
    gsap.to(cur.position, { x: -2.1 * dir, duration: T, ease: 'power2.in' });
    gsap.to(cur.rotation, { y: -1.15 * dir, duration: T, ease: 'power2.in' });
    gsap.fromTo(nxt.position, { x: 2.1 * dir }, { x: 0, duration: T, ease: 'power3.out' });
    gsap.fromTo(nxt.rotation, { y: 1.15 * dir }, { y: 0, duration: T, ease: 'power3.out' });
    gsap.delayedCall(T, () => { cur.visible = false; cur.position.x = 0; cur.rotation.y = 0; busy = false; });
  };
  setDots(0);

  // автосмена по кругу (как у слайдера); свайп — вручную
  let timer = null;
  const play = () => { if (reduced) return; clearInterval(timer); timer = setInterval(() => { if (document.hidden) return; go(idx + 1, 1); }, SLIDE_MS); };
  play();
  let sx = null;
  host.addEventListener('pointerdown', (e) => { sx = e.clientX; }, { passive: true });
  host.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 36) { go(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); play(); }
  }, { passive: true });

  // живое покачивание устройства в кадре; рендер — только пока блок виден на экране
  let inView = true;
  new IntersectionObserver((en) => { inView = en[0]?.isIntersecting ?? true; }, { threshold: 0.01 }).observe(host);
  const clock = new THREE.Clock();
  const inner = slides.map((s) => s.children[0]);
  const loop = () => {
    requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    if (inView) {
      for (let i = 0; i < slides.length; i++) {
        if (slides[i].visible) inner[i].rotation.y = Math.sin(t * 0.55 + i * 1.7) * 0.22;
      }
      renderer.render(scene, camera);
    }
  };
  loop();
  devices.ready.catch(() => {});
  window.addEventListener('pagehide', () => { clearInterval(timer); renderer.dispose(); pmrem.dispose(); }, { once: true });
}
