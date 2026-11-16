// Сцена H «Техника»: реальные устройства с настоящими экранами продукта — моноблок кассы с принтером чеков, ноутбук с панелью, телефон.
// 0 — вся техника вместе · 1 — устройства вразнобой, экраны гаснут · 2 — касса, печатается чек · 3 — ноутбук с отчётом · 4 — телефон
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeRenderer, keyLight, canvasTex, mixState, weights } from '../kit.js';
import posUrl from '../../assets/shots/pos.webp';
import dashUrl from '../../assets/shots/dash.webp';
import mobUrl from '../../assets/shots/mobile.webp';

export function createScene(canvas, { low }) {
  const { renderer, env } = makeRenderer(canvas, low);
  const scene = new THREE.Scene(); scene.environment = env; scene.environmentIntensity = 0.7;
  scene.fog = new THREE.Fog(0x0a0b0c, 16, 38);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 90);
  keyLight(scene, low, [-6, 12, 8], 9).intensity = 1.9;
  const rim = new THREE.PointLight(0x3fe3c4, 16, 30, 1.3); rim.position.set(6, 7, -9); scene.add(rim);
  const uz = document.documentElement.lang === 'uz';

  /* ---------- материалы ---------- */
  const mBlack = new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.42, metalness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.5 });
  const mAlu = new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.36, metalness: 1 });
  const mAluDark = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.34, metalness: 1 });
  const mBezel = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.25, metalness: 0.2 });
  const mGlass = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 1, transparent: true, opacity: 0.1, envMapIntensity: 2.2, depthWrite: false });
  const mFloor = new THREE.MeshStandardMaterial({ color: 0x0c0e0f, roughness: 0.3, metalness: 0.55 });
  const loader = new THREE.TextureLoader(), screens = [];
  const screenMat = (url) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false }); screens.push(m); return m; };
  const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, r, mat) => sh(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat));
  // экран: стекло-рамка + картинка + слой отражения
  const screen = (w, h, url, bezel = 0.07) => { const g = new THREE.Group(), a = new THREE.Mesh(new THREE.PlaneGeometry(w + bezel * 2, h + bezel * 2), mBezel), b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(url)), c = new THREE.Mesh(new THREE.PlaneGeometry(w + bezel * 2, h + bezel * 2), mGlass); b.position.z = 0.002; c.position.z = 0.004; g.add(a, b, c); return g; };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mFloor); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  /* ---------- моноблок кассы ---------- */
  const pos = new THREE.Group();
  { const base = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.07, 64), mBlack)); base.position.y = 0.035;
    const neck = box(0.3, 1.25, 0.12, 0.05, mAluDark); neck.position.set(0, 0.62, -0.22); neck.rotation.x = -0.24;
    const head = new THREE.Group(); head.position.set(0, 1.5, 0); head.rotation.x = -0.2;
    head.add(box(3.3, 2.1, 0.14, 0.06, mBlack));
    const s = screen(3.04, 1.9, posUrl, 0.06); s.position.z = 0.072; head.add(s);
    pos.add(base, neck, head); }
  /* ---------- принтер чеков ---------- */
  const printer = new THREE.Group(); let paper;
  { const body = box(0.95, 0.72, 1.05, 0.09, mBlack); body.position.y = 0.36;
    const lid = box(0.8, 0.03, 0.5, 0.012, mAluDark); lid.position.set(0, 0.725, -0.1);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), new THREE.MeshBasicMaterial({ color: 0x3fe3c4, toneMapped: false })); led.position.set(0.3, 0.2, 0.527);
    const receipt = canvasTex(384, 1152, (g, W, H) => {
      g.fillStyle = '#fbfaf5'; g.fillRect(0, 0, W, H); g.fillStyle = '#16181a'; g.textAlign = 'center';
      g.font = '700 46px ui-monospace, Menlo, Consolas, monospace'; g.fillText('MARJON', W / 2, 78);
      g.font = '22px ui-monospace, Menlo, Consolas, monospace'; g.fillText(uz ? 'Chek № 00186 · Stol 4' : 'Чек № 00186 · Стол 4', W / 2, 122); g.fillText('14.11.2026  21:41', W / 2, 152);
      const dash = (y) => { g.fillText('- - - - - - - - - - - - - -', W / 2, y); }; dash(190);
      const rows = uz ? [['Osh × 2', '96 000'], ['Shashlik × 3', '81 000'], ['Choy', '12 000'], ['Non × 2', '10 000'], ['Salat', '15 000']] : [['Плов × 2', '96 000'], ['Шашлык × 3', '81 000'], ['Чай', '12 000'], ['Нон × 2', '10 000'], ['Салат', '15 000']];
      g.font = '24px ui-monospace, Menlo, Consolas, monospace';
      rows.forEach(([a, b], i) => { g.textAlign = 'left'; g.fillText(a, 34, 240 + i * 44); g.textAlign = 'right'; g.fillText(b, W - 34, 240 + i * 44); });
      g.textAlign = 'center'; dash(470);
      g.font = '700 30px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'left'; g.fillText(uz ? 'JAMI' : 'ИТОГО', 34, 524); g.textAlign = 'right'; g.fillText('214 000', W - 34, 524);
      g.font = '22px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'left'; g.fillText(uz ? "To'landi" : 'Оплачено', 34, 566); g.textAlign = 'right'; g.fillText('Click · UZS', W - 34, 566);
      g.textAlign = 'center'; dash(610);
      let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const q = 9, n = 21, x0 = (W - q * n) / 2, y0 = 650;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const corner = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7); const on = corner ? (i % 14 === 0 || i % 14 === 6 || j % 14 === 0 || j % 14 === 6 || (i % 14 > 1 && i % 14 < 5 && j % 14 > 1 && j % 14 < 5)) : r() > 0.5; if (on) g.fillRect(x0 + j * q, y0 + i * q, q, q); }
      g.fillText('ОФД · soliq.uz', W / 2, 890); g.fillText(uz ? 'Rahmat!' : 'Спасибо!', W / 2, 930);
    });
    const pg = new THREE.PlaneGeometry(0.5, 1.5, 1, 32); pg.translate(0, 0.75, 0);
    const p = pg.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 1.5; p.setZ(i, -0.42 * t * t); p.setY(i, p.getY(i) * (1 - 0.1 * t * t)); } pg.computeVertexNormals();
    paper = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: receipt, roughness: 0.9, side: THREE.DoubleSide })); paper.castShadow = true; paper.position.set(0, 0.7, 0.16);
    printer.add(body, lid, led, paper); }
  /* ---------- ноутбук ---------- */
  const laptop = new THREE.Group();
  { const base = box(3.4, 0.09, 2.3, 0.04, mAlu); base.position.y = 0.045;
    const keys = canvasTex(1024, 400, (g, W, H) => { g.fillStyle = '#15171a'; g.fillRect(0, 0, W, H); g.fillStyle = '#060708'; const rowsN = 5, gap = 8, kh = (H - gap * (rowsN + 1)) / rowsN; for (let r = 0; r < rowsN; r++) { const n = r === 4 ? 9 : 14 - (r % 2), kw = (W - gap * (n + 1)) / n; for (let i = 0; i < n; i++) { let x = gap + i * (kw + gap), w = kw; if (r === 4 && i === 4) { w = kw * 1; } g.beginPath(); g.roundRect(x, gap + r * (kh + gap), w, kh, 9); g.fill(); } } });
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.1), new THREE.MeshStandardMaterial({ map: keys, roughness: 0.6, metalness: 0.2 })); kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.092, -0.42);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.7), new THREE.MeshStandardMaterial({ color: 0x7d8289, roughness: 0.22, metalness: 1 })); pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.092, 0.6);
    const lid = new THREE.Group(); lid.position.set(0, 0.09, -1.12); lid.rotation.x = -0.27;
    const shell = box(3.4, 2.2, 0.07, 0.03, mAlu); shell.position.y = 1.1; lid.add(shell);
    const s = screen(3.14, 1.9625, dashUrl, 0.07); s.position.set(0, 1.1, 0.037); lid.add(s);
    laptop.add(base, kb, pad, lid); }
  /* ---------- телефон ---------- */
  const phone = new THREE.Group();
  { phone.add(box(0.8, 1.64, 0.085, 0.042, mAluDark));
    const s = screen(0.7, 1.515, mobUrl, 0.025); s.position.z = 0.0435; phone.add(s);
    const camB = box(0.3, 0.3, 0.03, 0.014, mBlack); camB.position.set(0.2, 0.6, -0.05); phone.add(camB);
    [[-0.07, 0.07], [0.07, 0.07], [0, -0.06]].forEach(([x, y]) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 24), mBezel); l.rotation.x = Math.PI / 2; l.position.set(0.2 + x, 0.6 + y, -0.066); phone.add(l); }); }
  scene.add(pos, printer, laptop, phone);

  /* ---------- состояния: [x, y, z, rx, ry, rz, scale] ---------- */
  const items = [
    [pos, [[-1.75, 0, 0.2, 0, 0.32, 0, 1], [-2.7, 2.2, -1, 0.3, 1.25, -0.25, 1], [1.4, 0, 0, 0, -0.16, 0, 1], [-5.5, 0, -6, 0, 0.5, 0, 1], [-2.4, 0, -2.4, 0, 0.4, 0, 1]]],
    [printer, [[0.25, 0, 1.7, 0, 0.25, 0, 1], [0.5, 1.0, 2.4, 0.35, 0.9, 0.3, 1], [3.8, 0, 0.9, 0, -0.42, 0, 1], [7.5, 0, -5, 0, -0.4, 0, 1], [-4.4, 0, -0.4, 0, 0.6, 0, 1]]],
    [laptop, [[2.05, 0, -0.7, 0, -0.3, 0, 1], [3.5, 1.3, -2.6, -0.2, -1.3, 0.2, 1], [6.5, 0, -6, 0, -0.5, 0, 1], [1.5, 0, 0, 0, -0.2, 0, 1], [3.0, 0, -2.6, 0, -0.42, 0, 1]]],
    [phone, [[2.2, 1.45, 2.3, -0.08, -0.4, 0.07, 1], [0.9, 3.3, 1, 0.6, 2.5, 0.5, 1], [-4.6, 1.5, -5, 0, 0.6, 0, 1], [3.8, 0.95, 1.25, -0.16, -0.55, 0, 0.95], [-0.3, 1.75, 3.0, -0.04, -0.28, 0.04, 1.45]]],
  ];
  const camS = [[0, 2.6, 12.4, 0.3, 1.45, 0], [0, 3.2, 17, 0.2, 1.9, 0], [0.9, 2.1, 9.8, 1.2, 1.3, 0], [0.9, 2.4, 8.6, 1.0, 1.15, 0], [0.4, 2.0, 10.2, 0.4, 1.5, 0]];
  const cs = new Float32Array(6), os = new Float32Array(7), mouse = { x: 0, y: 0, tx: 0, ty: 0 }, dim = new THREE.Color();
  const onMove = (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = (e.clientY / innerHeight) * 2 - 1; };
  addEventListener('pointermove', onMove, { passive: true });
  let fit = 1, W = 1, H = 1;
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight; renderer.setSize(W, H, false); cam.aspect = W / H;
    const wide = cam.aspect > 1.25; fit = wide ? 1 : cam.aspect < 0.8 ? 2.2 : 1.5;
    if (wide) cam.setViewOffset(W, H, -W * 0.2, 0, W, H); else cam.setViewOffset(W, H, 0, H * 0.12, W, H); // на широком экране сцена сдвинута вправо, текст — слева
    cam.updateProjectionMatrix();
  };
  resize();

  return {
    resize,
    render(dt, time, c) {
      const cc = Math.max(0, Math.min(4, c)), k = 1 - Math.exp(-dt * 4), w = weights(cc);
      mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
      mixState(camS, cc, cs);
      cam.position.set(cs[3] + (cs[0] - cs[3]) * fit + mouse.x * 0.9, cs[4] + (cs[1] - cs[4]) * fit - mouse.y * 0.4, cs[5] + (cs[2] - cs[5]) * fit);
      cam.lookAt(cs[3], cs[4], cs[5]);
      items.forEach(([obj, st], i) => {
        mixState(st, cc, os);
        const fl = w[1] + (obj === phone ? 0.5 * (1 - w[1]) : 0), ph = i * 1.7;
        obj.position.set(os[0], os[1] + fl * Math.sin(time * 0.8 + ph) * 0.16, os[2]);
        obj.rotation.set(os[3] + fl * Math.sin(time * 0.5 + ph) * 0.06, os[4] + fl * Math.sin(time * 0.35 + ph) * 0.1 + (obj === phone ? mouse.x * 0.12 : 0), os[5] + w[1] * Math.cos(time * 0.45 + ph) * 0.08);
        obj.scale.setScalar(os[6]);
      });
      // чек выезжает из принтера: чуть-чуть на первом экране, полностью — в главе кассы
      const print = Math.min(1, 0.16 + Math.max(0, 1 - Math.abs(cc - 2.15) / 0.9) * 0.84);
      paper.position.y = 0.7 - 1.3 * (1 - print);
      dim.setScalar(1 - 0.72 * w[1]); screens.forEach((m) => m.color.copy(dim));
      renderer.render(scene, cam);
    },
    dispose() { removeEventListener('pointermove', onMove); scene.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.dispose(); } }); env.dispose(); renderer.dispose(); },
  };
}
