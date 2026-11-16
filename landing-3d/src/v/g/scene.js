// Сцена G «Дастархан»: настоящий стол — ляган с пловом, пиалы с чаем, чайник, лепёшки. Керамика с росписью, мягкие тени, студийный свет.
// 0 — накрытый стол · 1 — всё в воздухе, вразнобой · 2 — раскладка сверху (вокруг «меню») · 3 — стопки пиал как график роста · 4 — ляган крупно
import * as THREE from 'three';
import { makeRenderer, keyLight, canvasTex, seeded, mixState, weights } from '../kit.js';

export function createScene(canvas, { low }) {
  const { renderer, env } = makeRenderer(canvas, low);
  const scene = new THREE.Scene(); scene.environment = env; scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0x0a0b0c, 13, 30);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
  keyLight(scene, low, [-5, 11, 5], 10);
  const fill = new THREE.PointLight(0x3fe3c4, 9, 26, 1.4); fill.position.set(7, 6, -7); scene.add(fill);
  const rnd = seeded(77);
  const SEG = low ? 48 : 96;

  /* ---------- текстуры ---------- */
  const COB = '#1d3f94', TEAL = '#17a08d', CREAM = '#f3efe4';
  // роспись: x — вокруг оси, v — вдоль профиля (0 — донце снаружи, 1 — центр внутри)
  const ceramic = canvasTex(2048, 1024, (g, W, H) => {
    const Y = (v) => (1 - v) * H, band = (v0, v1, col) => { g.fillStyle = col; g.fillRect(0, Y(v1), W, Y(v0) - Y(v1)); };
    band(0, 1, CREAM);
    band(0.3, 0.33, COB); band(0.36, 0.368, TEAL);
    band(0.5, 0.6, COB);                                   // кромка
    const n = 24, st = W / n;
    g.fillStyle = CREAM; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(i * st + st / 2, Y(0.55), st * 0.2, 0, 7); g.fill(); }
    g.fillStyle = TEAL; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(i * st + st / 2, Y(0.55), st * 0.09, 0, 7); g.fill(); }
    band(0.615, 0.625, TEAL);
    // пояс лепестков
    for (let i = 0; i < 12; i++) {
      const cx = (i + 0.5) * (W / 12), y0 = Y(0.65), y1 = Y(0.82), wd = W / 12 * 0.36;
      g.fillStyle = i % 2 ? COB : TEAL; g.beginPath(); g.moveTo(cx, y0); g.bezierCurveTo(cx + wd, y0 + (y1 - y0) * 0.35, cx + wd * 0.7, y1, cx, y1); g.bezierCurveTo(cx - wd * 0.7, y1, cx - wd, y0 + (y1 - y0) * 0.35, cx, y0); g.fill();
      g.fillStyle = CREAM; g.beginPath(); g.ellipse(cx, (y0 + y1) / 2 - 8, wd * 0.22, (y0 - y1) * 0.22, 0, 0, 7); g.fill();
      g.fillStyle = COB; g.beginPath(); g.arc(cx + W / 24, (y0 + y1) / 2, 9, 0, 7); g.fill();
    }
    band(0.845, 0.855, COB); band(0.87, 0.875, TEAL);
    band(0.94, 1, COB);                                    // медальон
    g.fillStyle = CREAM; for (let i = 0; i < 16; i++) { g.beginPath(); g.arc((i + 0.5) * W / 16, Y(0.955), 10, 0, 7); g.fill(); }
  });
  ceramic.wrapS = THREE.RepeatWrapping;
  const wood = canvasTex(1024, 1024, (g, W, H) => {
    g.fillStyle = '#1c130e'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) { const y = rnd() * H, a = 0.03 + rnd() * 0.09; g.strokeStyle = rnd() > 0.5 ? `rgba(120,78,46,${a})` : `rgba(0,0,0,${a * 2})`; g.lineWidth = 0.6 + rnd() * 2.4; g.beginPath(); g.moveTo(0, y); let yy = y; for (let x = 0; x <= W; x += 64) { yy += (rnd() - 0.5) * 7; g.lineTo(x, yy); } g.stroke(); }
    for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, (k * H) / 4 - 2, W, 4); }
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(5, 5);
  const bread = canvasTex(512, 512, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#d9a04a'); gr.addColorStop(0.3, '#c98636'); gr.addColorStop(0.62, '#9a5a1d'); gr.addColorStop(0.8, '#c08338'); gr.addColorStop(1, '#e2bd7a');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '70,36,8' : '255,226,160'},${rnd() * 0.16})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 1 + rnd() * 5, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(70,36,8,.75)'; for (let r = 0; r < 3; r++) for (let i = 0; i < 28; i++) { g.beginPath(); g.arc((i + (r % 2) * 0.5) * W / 28, 22 + r * 34, 4.5, 0, 7); g.fill(); } // чекич в центре
    g.fillStyle = 'rgba(250,236,200,.9)'; for (let i = 0; i < 420; i++) { g.beginPath(); g.ellipse(rnd() * W, 150 + rnd() * 190, 3.4, 1.7, rnd() * 3, 0, 7); g.fill(); } // кунжут
  });

  /* ---------- материалы ---------- */
  const mCeramic = new THREE.MeshPhysicalMaterial({ map: ceramic, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
  const mCobalt = new THREE.MeshPhysicalMaterial({ color: 0x1d3f94, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
  const mTea = new THREE.MeshPhysicalMaterial({ color: 0x4f1f06, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.9 });
  const mBread = new THREE.MeshStandardMaterial({ map: bread, roughness: 0.78 });
  const mTable = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });

  const table = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mTable); table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);

  /* ---------- формы (тела вращения) ---------- */
  const lathe = (pts, n = 44) => new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y))).getPoints(n).map((p) => (p.x < 0 ? p.setX(0) : p)), SEG);
  const plateGeo = (R, d, t = 0.05) => lathe([[0, 0], [R * 0.44, 0], [R * 0.5, 0.02], [R * 0.78, d * 0.42], [R, d], [R + 0.012, d + t * 0.5], [R, d + t], [R * 0.78, d * 0.42 + t], [R * 0.5, t + 0.02], [R * 0.3, t], [0, t]]);
  const bowlGeo = (R, h, t = 0.035) => lathe([[0, 0], [R * 0.4, 0], [R * 0.44, 0.04], [R * 0.68, h * 0.34], [R * 0.9, h * 0.7], [R, h], [R + 0.01, h + t * 0.4], [R - t * 0.4, h], [R * 0.86, h * 0.7], [R * 0.62, h * 0.34 + t], [R * 0.32, t + 0.04], [0, t + 0.03]]);
  const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const gLagan = plateGeo(2.2, 0.36), gSmall = plateGeo(0.92, 0.14, 0.04), gBowl = bowlGeo(0.62, 0.44);

  // ляган с пловом
  const lagan = new THREE.Group(); lagan.add(shadow(new THREE.Mesh(gLagan, mCeramic)));
  {
    const dome = (r) => 0.07 + 0.5 * Math.pow(Math.max(0, 1 - (r / 1.42) ** 2), 0.75);
    const mound = new THREE.Mesh(lathe([[0, dome(0)], [0.5, dome(0.5)], [1, dome(1)], [1.3, dome(1.3)], [1.42, 0.07], [0, 0.06]], 24), new THREE.MeshStandardMaterial({ color: 0xd6aa52, roughness: 0.85 })); mound.castShadow = true; lagan.add(mound);
    const put = (geo, mat, count, cols, lift, place) => {
      const im = new THREE.InstancedMesh(geo, mat, count), d = new THREE.Object3D(), col = new THREE.Color();
      for (let i = 0; i < count; i++) { const r = 1.4 * Math.sqrt(rnd()), a = rnd() * 6.283; d.position.set(Math.cos(a) * r, dome(r) + lift * rnd(), Math.sin(a) * r); place(d, r, a); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, col.set(cols[Math.floor(rnd() * cols.length)]).multiplyScalar(0.8 + rnd() * 0.3)); }
      im.receiveShadow = true; lagan.add(im); return im;
    };
    const flat = (d) => d.rotation.set((rnd() - 0.5) * 0.9, rnd() * 6.283, Math.PI / 2 + (rnd() - 0.5) * 0.7);
    put(new THREE.CapsuleGeometry(0.017, 0.062, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.55 }), low ? 1500 : 4200, ['#f4dc9a', '#ecc978', '#e3b85e', '#f7e6b4'], 0.035, flat);
    put(new THREE.BoxGeometry(0.03, 0.2, 0.026), new THREE.MeshStandardMaterial({ roughness: 0.5 }), low ? 110 : 260, ['#ec8a1a', '#f3a52a', '#f6c33c', '#e2701a'], 0.05, flat);
    put(new THREE.SphereGeometry(0.042, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 46, ['#ecd29a', '#e2c184'], 0.05, () => {});
    put(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.35 }), 30, ['#3a1420', '#5a1f2a'], 0.05, () => {}); // изюм/барбарис
    const meat = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.15, 1), new THREE.MeshPhysicalMaterial({ color: 0x6a3418, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.5 }), 9), d = new THREE.Object3D();
    for (let i = 0; i < 9; i++) { const r = 0.12 + rnd() * 0.5, a = rnd() * 6.283; d.position.set(Math.cos(a) * r, dome(r) + 0.07, Math.sin(a) * r); d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); d.scale.set(1 + rnd() * 0.5, 0.6 + rnd() * 0.3, 0.8 + rnd() * 0.4); d.updateMatrix(); meat.setMatrixAt(i, d.matrix); }
    meat.castShadow = true; lagan.add(meat);
  }
  // пиала с чаем
  const gTea = new THREE.CircleGeometry(0.62 * 0.84, 40).rotateX(-Math.PI / 2);
  const makeBowl = (tea) => { const g = new THREE.Group(); g.add(shadow(new THREE.Mesh(gBowl, mCeramic))); if (tea) { const t = new THREE.Mesh(gTea, mTea); t.position.y = 0.3; g.add(t); } return g; };
  // чайник
  const teapot = new THREE.Group();
  teapot.add(shadow(new THREE.Mesh(lathe([[0, 0], [0.36, 0], [0.44, 0.04], [0.64, 0.3], [0.68, 0.56], [0.56, 0.84], [0.37, 0.97], [0.31, 1.0], [0.3, 1.03], [0.14, 1.1], [0.06, 1.13], [0.1, 1.2], [0.06, 1.27], [0, 1.28]], 60), mCeramic)));
  teapot.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.55, 0.4, 0], [0.86, 0.5, 0], [1.0, 0.76, 0], [1.14, 0.96, 0]].map((p) => new THREE.Vector3(...p))), 24, 0.068, 14), mCobalt)));
  const handle = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 12, 28, Math.PI), mCobalt)); handle.position.set(-0.6, 0.56, 0); handle.rotation.z = Math.PI / 2; teapot.add(handle);
  // лепёшка
  const gNon = lathe([[0, 0.14], [0.26, 0.15], [0.42, 0.22], [0.62, 0.26], [0.79, 0.19], [0.84, 0.09], [0.72, 0.005], [0, 0]], 30);
  const makeNon = () => shadow(new THREE.Mesh(gNon, mBread));

  /* ---------- состояния ---------- */
  const items = [];
  const add = (obj, st) => { scene.add(obj); items.push({ obj, st, h: rnd() }); };
  const float = (cx) => [cx + (rnd() - 0.5) * 7.5, 1.1 + rnd() * 2.8, (rnd() - 0.5) * 5, (rnd() - 0.5) * 1.6, rnd() * 6, (rnd() - 0.5) * 1.6, 1];
  const P7 = (a) => [a[0], a[1], a[2], a[3] || 0, a[4] || 0, a[5] || 0, 1];
  const S = (a, c, d, e, b) => [P7(a), b || float(-2.4), P7(c), P7(d), P7(e)];
  add(lagan, S([1.9, 0, 0], [-5.7, 0, -0.4], [-4.2, 0, -6], [0, 0, 0], [-2.6, 1.9, -0.6, 0.3, 1, -0.22, 1]));
  add(teapot, S([5.1, 0, -1.9, 0, 0.7], [5.3, 0, -2.0, 0, 2.4], [7.2, 0, -1.8, 0, 2.2], [-3.5, 0, -2.2, 0, -0.5]));
  add(makeNon(), S([4.7, 0, 2.5], [-4.9, 0, 3.3], [-0.6, 0, -6.4], [3.3, 0, -1.9]));
  add(makeNon(), S([-0.6, 0, -2.9], [5.7, 0, -3.8], [4.4, 0, -6.6], [4.8, 0, -3.8]));
  add(shadow(new THREE.Mesh(gSmall, mCeramic)), S([-2.9, 0, -1.7], [6.4, 0, -0.5], [-7.5, 0, -3.2], [-5.2, 0, -3.1]));
  add(shadow(new THREE.Mesh(gSmall, mCeramic)), S([2.7, 0, -3.7], [-6.7, 0, -3.9], [9.5, 0, -5], [5.7, 0, -0.5]));
  // 16 пиал: первые четыре стоят на столе, остальные появляются в стопках
  const tablePos = [[[4.9, 0, 0.3], [4.6, 0, 0.7], [3.0, 0, 0.7]], [[5.9, 0, -0.5], [5.9, 0, 1.6], [-3.0, 0, 0.9]], [[-0.9, 0, 2.0], [4.8, 0, 3.0], [-1.7, 0, -3.1]], [[0.4, 0, 3.0], [-4.3, 0, -3.5], [1.6, 0, -3.3]]];
  const heights = [1, 2, 3, 4, 6]; let bi = 0;
  heights.forEach((n, k) => { for (let j = 0; j < n; j++, bi++) {
    const stack = [1.3 + k * 1.2, j * 0.17, 0.2, 0, rnd() * 6, 0, 1], t = tablePos[bi];
    const st = t ? S(t[0], t[1], stack, t[2]) : [0, 1, 2, 3, 4].map((i) => (i === 3 ? stack : [stack[0], 0, stack[2], 0, 0, 0, 0.001]));
    st[3] = stack; add(makeBowl(!!t && false), st); if (t) items[items.length - 1].tea = true;
  } });
  // чай — отдельными дисками в «столовых» пиалах (в стопке чай исчезает)
  items.filter((i) => i.tea).forEach((i) => { const t = new THREE.Mesh(gTea, mTea); t.position.y = 0.3; i.obj.add(t); i.teaMesh = t; });

  /* ---------- камера ---------- */
  const camS = [[-1.5, 6.6, 8.4, -0.7, 0, -0.9], [0, 4.2, 11, -1.6, 1.5, 0], [0, 14.5, 0.02, 0, 0, 0], [3.0, 1.9, 6.6, 3.7, 0.75, 0], [0, 3.3, 7.4, 0, 2.0, 0]];
  const cs = new Float32Array(6), os = new Float32Array(7), mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = (e.clientY / innerHeight) * 2 - 1; };
  addEventListener('pointermove', onMove, { passive: true });
  let fit = 1;
  const resize = () => { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); fit = cam.aspect < 1 ? 1.55 : cam.aspect < 1.4 ? 1.2 : 1; };
  resize();

  return {
    resize,
    render(dt, time, c) {
      const cc = Math.max(0, Math.min(4, c)), k = 1 - Math.exp(-dt * 4), w = weights(cc);
      mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
      mixState(camS, cc, cs);
      cam.position.set(cs[3] + (cs[0] - cs[3]) * fit + mouse.x * 0.7, cs[4] + (cs[1] - cs[4]) * fit - mouse.y * 0.35, cs[5] + (cs[2] - cs[5]) * fit);
      cam.up.set(0, 1, 0); cam.lookAt(cs[3], cs[4], cs[5]);
      for (const it of items) {
        mixState(it.st, cc, os);
        const fl = w[1], ph = it.h * 40;
        it.obj.position.set(os[0], os[1] + fl * Math.sin(time * 0.7 + ph) * 0.22, os[2]);
        it.obj.rotation.set(os[3] + fl * Math.sin(time * 0.4 + ph) * 0.12, os[4] + fl * time * 0.12 * (it.h - 0.5), os[5] + fl * Math.cos(time * 0.5 + ph) * 0.12);
        it.obj.scale.setScalar(os[6]); it.obj.visible = os[6] > 0.01;
        if (it.teaMesh) it.teaMesh.visible = w[3] < 0.5;
      }
      lagan.rotation.y += time * 0.06 * (w[0] + w[4]);
      renderer.render(scene, cam);
    },
    dispose() { removeEventListener('pointermove', onMove); scene.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose()); }); [ceramic, wood, bread, env].forEach((t) => t.dispose()); renderer.dispose(); },
  };
}
