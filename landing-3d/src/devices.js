// Техника для версии A+H: реальные устройства с настоящими экранами продукта, встроенные в сцену «Нить».
// Комплект кассы (моноблок, платёжный терминал, принтер чеков), кухонный экран с живыми таймерами, ноутбук с панелью, телефон.
// Положение каждого устройства задано по тем же отметкам времени, что и раскладки бусин в story.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import posUrl from './assets/shots/pos.webp';
import dashUrl from './assets/shots/dash.webp';
import mobUrl from './assets/shots/mobile.webp';

const MINT = '#3fe3c4', CORAL = '#ff6a4d', AMBER = '#ffc24d';
const FONT = '"Onest Variable", "Onest", system-ui, sans-serif';

export function createDevices({ scene, renderer, rig, low }) {
  const uz = document.documentElement.lang === 'uz';
  const root = new THREE.Group(); scene.add(root);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h); const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.userData = { g, w, h }; return t; };
  const aniso = renderer.capabilities.getMaxAnisotropy();

  /* ---------- материалы ---------- */
  const M = (cls, o) => keep(new cls(o));
  const mBlack = M(THREE.MeshPhysicalMaterial, { color: 0x121416, roughness: 0.38, metalness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const mSoft = M(THREE.MeshStandardMaterial, { color: 0x1c1f22, roughness: 0.75, metalness: 0.1 });
  const mAlu = M(THREE.MeshStandardMaterial, { color: 0xa9aeb5, roughness: 0.3, metalness: 1 });
  const mAluDark = M(THREE.MeshStandardMaterial, { color: 0x41454c, roughness: 0.28, metalness: 1 });
  const mTitan = M(THREE.MeshStandardMaterial, { color: 0x8b857c, roughness: 0.26, metalness: 1 });
  const mGloss = M(THREE.MeshPhysicalMaterial, { color: 0x030304, roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 });
  const mGlass = M(THREE.MeshStandardMaterial, { color: 0x000000, roughness: 0.03, metalness: 1, transparent: true, opacity: 0.06, envMapIntensity: 2.0, depthWrite: false });
  const mLens = M(THREE.MeshPhysicalMaterial, { color: 0x0a1020, roughness: 0.02, metalness: 0.9, clearcoat: 1 });
  const mLed = M(THREE.MeshBasicMaterial, { color: new THREE.Color(MINT).multiplyScalar(1.7), toneMapped: false });
  const mPaper = (map) => M(THREE.MeshStandardMaterial, { map, roughness: 0.92, side: THREE.DoubleSide });

  const geos = [];
  const mesh = (geo, mat) => { geos.push(geo); return new THREE.Mesh(geo, mat); };
  const box = (w, h, d, r, mat, seg = 6) => mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
  // плита со скруглёнными углами (радиус не ограничен толщиной, как у RoundedBox) и мягкой фаской по кромке — корпуса экранов и телефона
  const slab = (w, h, d, r, mat, bevel = Math.min(d * 0.32, 0.02)) => {
    const s = new THREE.Shape(), x = -w / 2 + bevel, y = -h / 2 + bevel, W = w - bevel * 2, H = h - bevel * 2, R = Math.max(0.001, r - bevel);
    s.moveTo(x + R, y); s.lineTo(x + W - R, y); s.absarc(x + W - R, y + R, R, -Math.PI / 2, 0); s.lineTo(x + W, y + H - R); s.absarc(x + W - R, y + H - R, R, 0, Math.PI / 2);
    s.lineTo(x + R, y + H); s.absarc(x + R, y + H - R, R, Math.PI / 2, Math.PI); s.lineTo(x, y + R); s.absarc(x + R, y + R, R, Math.PI, Math.PI * 1.5);
    const g = new THREE.ExtrudeGeometry(s, { depth: d - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 28 });
    g.translate(0, 0, -(d - bevel * 2) / 2); g.computeVertexNormals();
    return mesh(g, mat);
  };
  const cyl = (r, h, mat, seg = 32) => mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

  // экран: картинка со скруглёнными углами + слой отражения; яркость общая (гаснут, когда «нить порвана»)
  const screens = [];
  const roundMask = (w, h, r) => { const k = 1024 / Math.max(w, h), t = tex(Math.round(w * k), Math.round(h * k), (g, W, H) => { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(0, 0, W, H, r * k); g.fill(); }); t.colorSpace = THREE.NoColorSpace; return t; };
  const screen = (w, h, map, r = 0.03) => {
    const g = new THREE.Group(), mat = M(THREE.MeshBasicMaterial, { map, alphaMap: roundMask(w, h, r), transparent: true, toneMapped: false });
    screens.push(mat); g.add(mesh(new THREE.PlaneGeometry(w, h), mat), at(mesh(new THREE.PlaneGeometry(w, h), mGlass), 0, 0, 0.003)); return g;
  };
  const loader = new THREE.TextureLoader();
  const pending = []; // снимки экранов: сцена ждёт их под экраном загрузки, чтобы при прокрутке ничего не догружалось
  const shot = (url) => { let done; pending.push(new Promise((r) => { done = r; })); const t = keep(loader.load(url, done, undefined, done)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; return t; };
  const glow = (color, intensity, dist) => new THREE.PointLight(color, intensity, dist, 1.6);

  /* ---------- комплект кассы ---------- */
  const posSet = new THREE.Group();
  {
    const pos = at(new THREE.Group(), -0.75, 0, 0);
    pos.add(at(slab(1.5, 1.15, 0.07, 0.16, mAlu), 0, 0.035, -0.1, -Math.PI / 2));                      // основание
    pos.add(at(box(0.34, 1.3, 0.09, 0.04, mAlu), 0, 0.68, -0.3, -0.22));                // стойка
    pos.add(at(cyl(0.085, 0.5, mAluDark), 0, 1.3, -0.2, 0, 0, Math.PI / 2));            // шарнир
    const head = at(new THREE.Group(), 0, 1.52, 0, -0.2);
    head.add(slab(3.3, 2.1, 0.11, 0.12, mBlack));
    head.add(at(mesh(new THREE.PlaneGeometry(3.24, 2.04), M(THREE.MeshPhysicalMaterial, { color: 0x030304, roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, alphaMap: roundMask(3.24, 2.04, 0.1), transparent: true })), 0, 0, 0.0556)); // стекло во всю лицевую панель
    head.add(at(screen(3.04, 1.9, shot(posUrl), 0.045), 0, 0.02, 0.058));
    head.add(at(box(0.9, 0.012, 0.012, 0.005, mLed, 2), 0, -1.062, 0.03));              // индикатор смены
    head.add(at(cyl(0.2, 0.012, mAluDark, 40), 0, 0.1, -0.058, Math.PI / 2));           // шильдик сзади
    head.add(at(glow(0xcfeee6, 1.5, 4.2), 0, 0, 1.2));
    pos.add(head);
    // платёжный терминал
    const term = at(new THREE.Group(), 1.45, 0, 1.25, 0, -0.35);
    const tb = at(new THREE.Group(), 0, 0.2, 0, -1.2);
    tb.add(box(0.5, 0.98, 0.16, 0.06, mBlack));
    const tScreen = tex(256, 200, (g, W, H) => { g.fillStyle = '#071412'; g.fillRect(0, 0, W, H); g.fillStyle = MINT; g.textAlign = 'center'; g.font = `600 22px ${FONT}`; g.fillText(uz ? "To'lov" : 'Оплата', W / 2, 46); g.fillStyle = '#fff'; g.font = `700 44px ${FONT}`; g.fillText('214 000', W / 2, 108); g.font = `500 20px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('UZS', W / 2, 138); g.fillStyle = MINT; g.font = `600 22px ${FONT}`; g.fillText(uz ? "✓ To'landi" : '✓ Оплачено', W / 2, 180); });
    tb.add(at(screen(0.4, 0.31, tScreen, 0.02), 0, 0.27, 0.082));
    const pad = tex(256, 300, (g, W, H) => { g.fillStyle = '#0d0f11'; g.fillRect(0, 0, W, H); const ks = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '✕', '0', '✓'], cs = { '✕': CORAL, '✓': MINT }; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 30px ${FONT}`; ks.forEach((k, i) => { const x = 14 + (i % 3) * 80, y = 12 + Math.floor(i / 3) * 71; g.fillStyle = cs[k] || '#262a2e'; g.beginPath(); g.roundRect(x, y, 68, 58, 12); g.fill(); g.fillStyle = cs[k] ? '#06100e' : '#e9e9e4'; g.fillText(k, x + 34, y + 30); }); });
    tb.add(at(mesh(new THREE.PlaneGeometry(0.4, 0.47), M(THREE.MeshStandardMaterial, { map: pad, roughness: 0.55 })), 0, -0.2, 0.0805));
    term.add(tb, at(box(0.4, 0.2, 0.5, 0.05, mSoft), 0, 0.1, -0.12));
    // принтер чеков
    const pr = at(new THREE.Group(), 2.2, 0, 0.3, 0, -0.3);
    pr.add(at(box(0.95, 0.72, 1.05, 0.1, mBlack), 0, 0.36, 0));
    pr.add(at(box(0.82, 0.03, 0.56, 0.012, mSoft), 0, 0.725, -0.12));
    pr.add(at(box(0.6, 0.02, 0.03, 0.008, mAlu, 2), 0, 0.735, 0.2));                    // нож отрыва
    pr.add(at(cyl(0.035, 0.012, mAluDark, 20), -0.3, 0.728, 0.36));                     // кнопка подачи
    pr.add(at(mesh(new THREE.CircleGeometry(0.016, 16), M(THREE.MeshBasicMaterial, { color: new THREE.Color(MINT).multiplyScalar(0.55) })), 0.32, 0.2, 0.527)); // спокойный индикатор, без свечения
    pr.add(at(box(0.56, 0.012, 0.05, 0.004, mSoft, 2), 0, 0.738, 0.17));                // щель подачи
    { // чек выходит вверх из щели и слегка загибается назад
      const rt = tex(384, 512, (g, W, H) => {
        g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, W, H); g.fillStyle = '#17191c'; g.textBaseline = 'middle';
        g.font = '700 34px Arial'; g.textAlign = 'center'; g.fillText('MARJON', W / 2, 46);
        g.font = '400 17px Arial'; g.fillStyle = '#6b6f75'; g.fillText('Стол 1 · 14.11.2026 · 19:21', W / 2, 84);
        const dash = (y) => { g.strokeStyle = '#9a9da2'; g.lineWidth = 2; g.setLineDash([7, 6]); g.beginPath(); g.moveTo(26, y); g.lineTo(W - 26, y); g.stroke(); };
        dash(112);
        const rows = [['Лагман', '38 000'], ['Плов', '45 000'], ['Манты', '36 000'], ['Шашлык × 2', '64 000'], ['Салат', '22 000'], ['Чай', '8 000'], ['Нон × 2', '10 000'], ['Морс', '10 000']];
        g.font = '500 21px Arial'; g.fillStyle = '#17191c';
        rows.forEach(([a, b], i) => { const y = 142 + i * 31; g.textAlign = 'left'; g.fillText(a, 28, y); g.textAlign = 'right'; g.fillText(b, W - 28, y); });
        dash(398);
        g.font = '700 30px Arial'; g.textAlign = 'left'; g.fillText('Итого', 28, 436); g.textAlign = 'right'; g.fillText('233 000', W - 28, 436);
        g.font = '400 17px Arial'; g.fillStyle = '#6b6f75'; g.textAlign = 'center'; g.fillText('Спасибо! Rahmat!', W / 2, 484);
      });
      const pg = new THREE.PlaneGeometry(0.5, 0.66, 1, 18); pg.translate(0, 0.33, 0);
      const pp = pg.attributes.position; for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setZ(i, -0.42 * y * y); }
      pg.computeVertexNormals();
      const paper = mesh(pg, M(THREE.MeshStandardMaterial, { map: rt, color: 0xd9d7d0, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.25 }));
      pr.add(at(paper, 0, 0.74, 0.172, -0.1));
    }
    posSet.add(pos, term, pr);
  }

  /* ---------- кухонный экран (живые таймеры) ---------- */
  const kds = new THREE.Group(); let kdsTex, kdsAt = -1;
  const tickets = uz
    ? [['Stol 4', ['Osh × 2', 'Achchiq-chuchuk'], 42], ['Stol 7', ['Shashlik × 3', 'Non × 2'], 318], ['Yetkazish', ["Lag'mon × 1", 'Manti × 2'], 611], ['Stol 1', ['Mastava × 2', 'Choy'], 127]]
    : [['Стол 4', ['Плов × 2', 'Ачичук'], 42], ['Стол 7', ['Шашлык × 3', 'Нон × 2'], 318], ['Доставка', ['Лагман × 1', 'Манты × 2'], 611], ['Стол 1', ['Мастава × 2', 'Чай'], 127]];
  const drawKds = (sec) => {
    const { g, w: W, h: H } = kdsTex.userData;
    g.fillStyle = '#0b0d0e'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#f2f0e8'; g.font = `600 30px ${FONT}`; g.fillText(uz ? 'Oshxona · 2-stansiya' : 'Кухня · станция 2', 36, 60);
    g.textAlign = 'right'; g.fillStyle = MINT; g.font = `500 24px ${FONT}`; g.fillText(uz ? '● onlayn' : '● онлайн', W - 36, 58);
    tickets.forEach(([name, items, base], i) => {
      const x = 36 + i * 242, y = 96, cw = 226, ch = H - y - 36, s = base + sec, col = s > 600 ? CORAL : s > 300 ? AMBER : MINT;
      g.fillStyle = '#15181a'; g.beginPath(); g.roundRect(x, y, cw, ch, 18); g.fill();
      g.fillStyle = col; g.beginPath(); g.roundRect(x, y, cw, 10, [18, 18, 0, 0]); g.fill();
      g.textAlign = 'left'; g.fillStyle = '#f2f0e8'; g.font = `600 30px ${FONT}`; g.fillText(name, x + 20, y + 62);
      g.fillStyle = 'rgba(242,240,232,.5)'; g.font = `500 18px ${FONT}`; g.fillText('№ 0018' + (6 + i), x + 20, y + 90);
      g.fillStyle = 'rgba(242,240,232,.86)'; g.font = `500 24px ${FONT}`; items.forEach((t, k) => g.fillText(t, x + 20, y + 146 + k * 40));
      g.fillStyle = col; g.font = `700 54px ${FONT}`; g.fillText(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, x + 20, y + ch - 80);
      g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(x + 20, y + ch - 56, cw - 40, 34, 17); g.fill();
      g.fillStyle = 'rgba(242,240,232,.8)'; g.font = `500 18px ${FONT}`; g.textAlign = 'center'; g.fillText(uz ? 'Tayyor' : 'Готово', x + cw / 2, y + ch - 33);
    });
    kdsTex.needsUpdate = true;
  };
  {
    kdsTex = tex(1024, 640, () => {}); drawKds(0);
    kds.add(at(slab(2.74, 1.74, 0.09, 0.11, mBlack), 0, 0.87, 0));
    kds.add(at(mesh(new THREE.PlaneGeometry(2.68, 1.68), M(THREE.MeshPhysicalMaterial, { color: 0x030304, roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, alphaMap: roundMask(2.68, 1.68, 0.09), transparent: true })), 0, 0.87, 0.0456));
    kds.add(at(screen(2.56, 1.6, kdsTex, 0.03), 0, 0.87, 0.048));
    kds.add(at(cyl(0.07, 0.4, mAluDark), 0, 0.87, -0.22, Math.PI / 2), at(box(0.7, 0.7, 0.04, 0.02, mAluDark), 0, 0.87, -0.42)); // кронштейн
    kds.add(at(glow(0xbfe9df, 1.2, 5), 0, 0.87, 1));
  }

  /* ---------- ноутбук ---------- */
  const laptop = new THREE.Group();
  {
    laptop.add(at(slab(3.4, 2.3, 0.085, 0.17, mAlu), 0, 0.0425, 0, -Math.PI / 2));
    const keyCanvas = (legend) => (g, W, H) => { g.fillStyle = legend ? '#000' : '#17191c'; g.fillRect(0, 0, W, H); const rows = 5, gap = 8, kh = (H - gap * (rows + 1)) / rows; for (let r = 0; r < rows; r++) { const n = r === 4 ? 8 : 14 - (r % 2), unit = (W - gap * (n + 1)) / (r === 4 ? n + 4 : n); let x = gap; for (let i = 0; i < n; i++) { const w = r === 4 && i === 3 ? unit * 5 : unit, y = gap + r * (kh + gap); if (legend) { g.fillStyle = '#fff'; g.fillRect(x + w / 2 - (r === 4 && i === 3 ? 0 : 5), y + kh / 2 - 5, r === 4 && i === 3 ? 0 : 10, 10); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, kh, 9); g.stroke(); } else { g.fillStyle = '#060708'; g.beginPath(); g.roundRect(x, y, w, kh, 9); g.fill(); } x += w + gap; } } };
    laptop.add(at(mesh(new THREE.PlaneGeometry(3.0, 1.1), M(THREE.MeshStandardMaterial, { map: tex(1024, 400, keyCanvas(false)), emissive: 0xdff7f1, emissiveMap: tex(1024, 400, keyCanvas(true)), emissiveIntensity: 0.55, roughness: 0.6, metalness: 0.2 })), 0, 0.087, -0.42, -Math.PI / 2));
    laptop.add(at(mesh(new THREE.PlaneGeometry(1.2, 0.72), M(THREE.MeshStandardMaterial, { color: 0x969ba2, roughness: 0.18, metalness: 1 })), 0, 0.087, 0.62, -Math.PI / 2));
    laptop.add(at(cyl(0.05, 2.9, mAluDark, 20), 0, 0.09, -1.12, 0, 0, Math.PI / 2));    // шарнир
    const lid = at(new THREE.Group(), 0, 0.09, -1.12, -0.27);
    lid.add(at(slab(3.4, 2.2, 0.06, 0.15, mAlu, 0.012), 0, 1.1, 0));
    lid.add(at(mesh(new THREE.PlaneGeometry(3.34, 2.14), M(THREE.MeshPhysicalMaterial, { color: 0x030304, roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, alphaMap: roundMask(3.34, 2.14, 0.125), transparent: true })), 0, 1.1, 0.0306));
    lid.add(at(screen(3.14, 1.9625, shot(dashUrl), 0.05), 0, 1.09, 0.033));
    lid.add(at(mesh(new THREE.CircleGeometry(0.018, 14), mLens), 0, 2.125, 0.032));     // камера
    lid.add(at(cyl(0.17, 0.008, mAluDark, 40), 0, 1.1, -0.031, Math.PI / 2));           // знак на крышке
    lid.add(at(glow(0xd6efe9, 2.4, 6), 0, 1.0, 1.1));
    // свет экрана на клавиатуре
    const spill = tex(64, 64, (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(210,245,236,.9)'); gr.addColorStop(1, 'rgba(210,245,236,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
    laptop.add(at(mesh(new THREE.PlaneGeometry(3.1, 1.0), M(THREE.MeshBasicMaterial, { map: spill, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })), 0, 0.089, -0.55, -Math.PI / 2));
    laptop.add(lid);
  }

  /* ---------- телефон ---------- */
  const phone = new THREE.Group();
  {
    // корпус как у iPhone: большой радиус углов (≈17% ширины), плоские грани с тонкой фаской
    phone.add(slab(0.8, 1.64, 0.085, 0.142, mTitan, 0.011));
    phone.add(at(mesh(new THREE.PlaneGeometry(0.778, 1.618), M(THREE.MeshPhysicalMaterial, { color: 0x030304, roughness: 0.08, clearcoat: 1, alphaMap: roundMask(0.778, 1.618, 0.131), transparent: true })), 0, 0, 0.0428));
    phone.add(at(screen(0.74, 1.6, shot(mobUrl), 0.116), 0, 0, 0.0434));
    phone.add(at(mesh(new THREE.PlaneGeometry(0.2, 0.055), M(THREE.MeshBasicMaterial, { color: 0x000000, alphaMap: roundMask(0.2, 0.055, 0.0275), transparent: true })), 0, 0.735, 0.047)); // «островок»
    phone.add(at(box(0.012, 0.2, 0.03, 0.005, mTitan, 2), 0.402, 0.25, 0), at(box(0.012, 0.11, 0.03, 0.005, mTitan, 2), -0.402, 0.36, 0), at(box(0.012, 0.11, 0.03, 0.005, mTitan, 2), -0.402, 0.2, 0));
    phone.add(at(mesh(new THREE.PlaneGeometry(0.78, 1.62), M(THREE.MeshPhysicalMaterial, { color: 0x24262a, roughness: 0.35, metalness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.3, alphaMap: roundMask(0.78, 1.62, 0.132), transparent: true })), 0, 0, -0.0428, 0, Math.PI));
    phone.add(at(slab(0.34, 0.34, 0.03, 0.09, mTitan, 0.008), 0.18, 0.58, -0.05));
    [[-0.075, 0.075], [0.075, 0.075], [-0.075, -0.075]].forEach(([x, y]) => { phone.add(at(cyl(0.06, 0.03, mAluDark, 28), 0.18 + x, 0.58 + y, -0.066, Math.PI / 2), at(mesh(new THREE.CircleGeometry(0.045, 24), mLens), 0.18 + x, 0.58 + y, -0.0815, 0, Math.PI)); });
    phone.add(at(glow(0xd6efe9, 1.0, 4), 0, 0, 0.8));
  }
  root.add(posSet, kds, laptop, phone);

  /* ---------- раскадровка: те же отметки, что у бусин ---------- */
  //            hero                     нить порвана               вдоль нити                  кольцо                    орбита                   звезда                    жемчужина
  const HID = 0.001;
  const K = [0, 1, 1.55, 2, 2.8, 3, 3.6, 4, 4.55, 5, 5.7, 6], IDX = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  // Устройства видны в hero, «Возможностях», «Ролях» и финале. В «Проблеме», «Потоке» и «Узбекистане» они плавно уходят вглубь.
  // самый низ страницы (футер): три устройства встают в ряд в верхней части экрана, над футером
  const END = [[-2.9, 0.42, -1.0, 0, 0.3, 0, 0.6], [0.8, 0.5, -1.0, 0.02, -0.1, 0, 0.66], [3.3, 1.2, -1.0, -0.03, -0.34, 0.02, 0.84]];
  const items = [
    { o: posSet, role: 0, end: END[0], at: [0.1, -1.5, 0, 0, -0.3, 0, 0.92], st: [[-0.45, -0.25, -3.2, 0, 0.35, 0, 0.62], [-1.2, 0.3, -7.5, 0.04, 0.6, -0.04, HID], [-7.2, -2.3, -1.8, 0, 0.25, 0, 0.8], [-1.5, -1.2, -7, 0, 0.1, 0, HID], [0, 0, 0, 0, 0, 0, HID], [-2, -1.4, -8, 0, 0.5, 0, HID], [-3.3, -2.5, -3.2, 0, 0.5, 0, 0.5]] },
    { o: laptop, role: 2, end: END[1], at: [0.1, -1.3, 0.4, 0.02, -0.3, 0, 1.0], st: [[0.5, -1.4, -1.0, 0.04, -0.3, 0, 0.56], [0.9, -1.2, -6.5, -0.04, -0.55, 0.04, HID], [7.2, -2.3, -1.8, 0, -0.3, 0, 0.85], [1.5, -1.6, -7, 0, -0.5, 0, HID], [0, 0, 0, 0, 0, 0, HID], [1.2, -1.4, -8, 0, -0.4, 0, HID], [3.3, -2.6, -3.0, 0, -0.5, 0, 0.56]] },
    { o: phone, role: 1, end: END[2], at: [0.1, 0.05, 0, 0, -0.25, 0, 1.75], st: [[1.05, -0.9, 1.3, -0.08, -0.45, 0.06, 0.45], [1.3, -0.3, -5.5, 0.06, -0.7, 0.08, HID], [1.0, -1.35, -1.2, 0, 0.15, 0, 1.0], [3, 0.5, -7, 0, 0.6, 0, HID], [0, 0, 0, 0, 0, 0, HID], [2.4, 0, -7, -0.1, -0.6, 0, HID], [4.6, -1.5, -1.6, -0.06, -0.6, 0.05, 0.4]] },
    { o: kds, at: null, st: [[-3, 3, -9, 0, 0.3, 0, HID], [-3, 3, -9, 0, 0.3, 0, HID], [-3.4, -2.2, -2.2, 0, 0.1, 0, 0.75], [-6, 3, -9, 0, 0.4, 0, HID], [-6, 3, -9, 0, 0.4, 0, HID], [-6, 3, -9, 0, 0.4, 0, HID], [-5, 3, -9, 0.08, 0, 0, HID]] },
  ];
  // «Роли»: устройства по очереди — активное в центре, предыдущее уходит вверх, следующее ждёт снизу
  const ss = (x) => { const c = Math.min(Math.max(x, 0), 1); return c * c * (3 - 2 * c); };
  const setRole = (r) => items.forEach((it) => {
    if (!it.at) return;
    const d = it.role - r, w = ss(1 - Math.abs(d) * 1.25), a = it.at, o = it.st[4];
    o[0] = a[0]; o[1] = a[1] - d * 3.4; o[2] = a[2] - (1 - w) * 2.5; o[3] = a[3] + d * 0.25; o[4] = a[4] - d * 0.5; o[5] = a[5]; o[6] = Math.max(HID, a[6] * w);
  });
  // портрет (телефон): 3D-техники нет — её заменяют рамки со снимками экранов, в сцене остаётся нить с бусинами
  const hid = (a) => [a[0], a[1], a[2], a[3], a[4], a[5], HID];
  items.forEach((it) => {
    it.stP = it.st.map(hid);
  });
  const os = new Float32Array(7), oe = new Float32Array(7);
  const mix = (st, t) => {
    let i = 0; while (i < K.length - 2 && t > K[i + 1]) i++;
    const f = Math.min(Math.max((t - K[i]) / (K[i + 1] - K[i]), 0), 1), e = f * f * f * (f * (f * 6 - 15) + 10), a = st[IDX[i]], b = st[IDX[i + 1]];
    for (let k = 0; k < 7; k++) os[k] = a[k] + (b[k] - a[k]) * e;
  };
  const dim = new THREE.Color();

  return {
    ready: Promise.all(pending),
    update(time, S, mouse, portrait) {
      const t = S.t || 0;
      root.position.copy(rig.position); root.scale.setScalar(rig.scale.x * (portrait ? 0.72 : 1));
      const d = Math.min(0.5, S.drift), intro = S.intro ?? 1;
      // S.band — доля экрана над футером в самом низу страницы; если места почти нет, устройства остаются на своих местах
      const band = S.band ?? 0.4, cv = renderer.domElement, aspect = cv.clientWidth / Math.max(1, cv.clientHeight);
      const end = band >= 0.16 && !portrait ? ss((t - 5.962) / 0.038) : 0;
      const hf = Math.min(0.3, Math.max(0.1, band - 0.07)), kk = Math.min(hf / 0.19, aspect * 0.62), cy = -0.7 + (0.5 - (0.07 + (band - 0.05) / 2)) * 6.6;
      const spread = Math.min(1.1, Math.max(0.5, (3.3 * aspect * 0.64) / 2.95)) * Math.min(1, 0.55 + kk * 0.45);
      setRole(S.role ?? 1);
      items.forEach((it, i) => {
        mix(portrait ? it.stP : it.st, t);
        if (end > 0 && it.end) { // ряд вписывается в свободную полосу над футером: центр и размер — от её высоты, разлёт — от ширины окна
          const e = it.end;
          oe[0] = e[0] * spread; oe[1] = cy + (e[1] - 0.95) * kk; oe[2] = e[2]; oe[3] = e[3]; oe[4] = e[4]; oe[5] = e[5]; oe[6] = e[6] * kk;
          for (let k = 0; k < 7; k++) os[k] += (oe[k] - os[k]) * end;
        }
        const ph = i * 1.9, s = os[6] * (0.6 + 0.4 * intro);
        it.o.visible = s > 0.01;
        it.o.position.set(os[0], os[1] + Math.sin(time * 0.7 + ph) * 0.12 * (0.4 + d), os[2] - (1 - intro) * 3);
        it.o.rotation.set(os[3] + Math.sin(time * 0.5 + ph) * 0.04 * (0.5 + d) - mouse.y * 0.05, os[4] + Math.sin(time * 0.33 + ph) * 0.07 * (0.5 + d) + mouse.x * 0.1, os[5] + Math.cos(time * 0.45 + ph) * 0.05 * d);
        it.o.scale.setScalar(s);
      });
      dim.setScalar(0.86 - 0.5 * S.coral - 0.5 * Math.max(0, Math.min(1, (t - 5.7) / 0.3)) * (1 - end * 0.85)); screens.forEach((m) => m.color.copy(dim));
      const sec = Math.floor(time);
      if (sec !== kdsAt && kds.visible) { kdsAt = sec; drawKds(sec); }
    },
    dispose() { scene.remove(root); geos.forEach((g) => g.dispose()); disposables.forEach((x) => x.dispose()); },
  };
}
