// Сцена F «Зал»: поле плиток (InstancedMesh) — столы зала. Высоты и цвет считаются на CPU, пять состояний по номеру главы.
// 0 — рябь и занятые столы · 1 — беспорядок · 2 — порядок: волна от центра · 3 — столбцы выручки · 4 — буква M
import * as THREE from 'three';

export function createScene(canvas, { low }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1.5 : 2));
  renderer.setClearColor(0x0a0b0c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0b0c, 0.034);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  const COLS = low ? 24 : 34, ROWS = low ? 16 : 22, N = COLS * ROWS, GAP = 1;
  const geo = new THREE.BoxGeometry(0.88, 1, 0.88);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.15 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xb9f3e6, 0x050607, 0.42));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05); sun.position.set(6, 12, 5); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x3fe3c4, 0.9); rim.position.set(-8, 4, -6); scene.add(rim);
  const lamp = new THREE.PointLight(0x3fe3c4, 34, 14, 1.7); lamp.position.set(0, 2.6, 0); scene.add(lamp);

  // постоянные данные плиток
  const hash = new Float32Array(N), px = new Float32Array(N), pz = new Float32Array(N), colI = new Uint16Array(N), rowI = new Uint16Array(N);
  let s = 4242; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) { const c = i % COLS, r = Math.floor(i / COLS); colI[i] = c; rowI[i] = r; px[i] = (c - (COLS - 1) / 2) * GAP; pz[i] = (r - (ROWS - 1) / 2) * GAP; hash[i] = rnd(); }
  const profile = [0.7, 1.1, 0.9, 1.6, 2.1, 1.8, 2.6, 3.1, 2.8, 3.7, 4.3, 5.0];
  const M = ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X']; // буква M, клетка = 2×2 плитки
  const inM = (c, r) => { const cc = Math.floor((c - (COLS / 2 - 5)) / 2), rr = Math.floor((r - (ROWS / 2 - 6)) / 2); return rr >= 0 && rr < 6 && cc >= 0 && cc < 5 && M[rr][cc] === 'X'; };

  const mouse = { tx: 0, ty: 0, x: 0, y: 0, on: false }, hit = new THREE.Vector3(999, 0, 999), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  const onMove = (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = -((e.clientY / innerHeight) * 2 - 1); mouse.on = true; };
  addEventListener('pointermove', onMove, { passive: true });

  const camP = [[0, 8.5, 15], [-5, 12, 11], [0, 19, 7], [7, 6.5, 15], [0, 17, 10]], camL = [[0, 0, 0.5], [0, 0, 0], [0, 0, 0], [0, 1.6, -1], [0, 0, 0]];
  const K = (arr, c, j) => { const i = Math.min(Math.floor(c), arr.length - 2), f = Math.min(Math.max(c - i, 0), 1), e = f * f * (3 - 2 * f); return arr[i][j] + (arr[i + 1][j] - arr[i][j]) * e; };
  const dummy = new THREE.Object3D(), col = new THREE.Color(), base = new THREE.Color(0x141a1b), mint = new THREE.Color(0x3fe3c4), coral = new THREE.Color(0xff6a4d), pearl = new THREE.Color(0xe9e6da);
  let fit = 1;
  const resize = () => { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); fit = cam.aspect < 1 ? 1.5 : 1; };
  resize();

  return {
    resize,
    render(dt, time, c) {
      const cc = Math.max(0, Math.min(4, c)), k = 1 - Math.exp(-dt * 5);
      mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
      cam.position.set(K(camP, cc, 0) + mouse.x * 0.8, (K(camP, cc, 1) + mouse.y * 0.5) * fit, K(camP, cc, 2) * fit);
      cam.lookAt(K(camL, cc, 0), K(camL, cc, 1), K(camL, cc, 2));
      if (mouse.on) { ndc.set(mouse.x, mouse.y); ray.setFromCamera(ndc, cam); ray.ray.intersectPlane(plane, hit) || hit.set(999, 0, 999); }
      lamp.position.set(hit.x > 900 ? 0 : hit.x, 2.6, hit.x > 900 ? 0 : hit.z);
      const w = [0, 1, 2, 3, 4].map((i) => Math.max(0, 1 - Math.abs(cc - i)));
      const pulseR = (time * 5) % 26;
      for (let i = 0; i < N; i++) {
        const x = px[i], z = pz[i], hsh = hash[i], d0 = Math.hypot(x, z);
        const occ = hsh < 0.085; // «занятый стол»
        // 0 · рябь
        const h0 = 0.3 + 0.2 * Math.sin(x * 0.42 + time * 0.9) + 0.16 * Math.sin(z * 0.6 - time * 0.7) + (occ ? 0.55 + 0.12 * Math.sin(time * 2 + hsh * 90) : 0);
        // 1 · беспорядок
        const h1 = 0.15 + hsh * 2.3 * (0.55 + 0.45 * Math.sin(time * 1.3 + hsh * 60));
        // 2 · порядок: волна от центра
        const pu = Math.exp(-((d0 - pulseR) ** 2) * 0.5);
        const h2 = 0.22 + pu * 1.15;
        // 3 · столбцы выручки
        const bi = Math.floor((colI[i] - (COLS - 24) / 2) / 2), inBar = bi >= 0 && bi < 12 && rowI[i] >= ROWS / 2 - 3 && rowI[i] < ROWS / 2 + 1 && colI[i] % 2 === (COLS % 4 === 0 ? 0 : 1) % 2;
        const h3 = inBar ? profile[bi] * (0.94 + 0.06 * Math.sin(time * 1.6 + bi)) : 0.12;
        // 4 · буква M
        const m = inM(colI[i], rowI[i]);
        const h4 = m ? 1.7 + 0.12 * Math.sin(time * 1.4 + x * 0.5) : 0.14;
        // курсор: всплеск
        const dm = Math.hypot(x - hit.x, z - hit.z), bump = Math.exp(-dm * dm * 0.16) * (0.75 + 0.35 * Math.sin(dm * 1.7 - time * 5));
        const h = Math.max(0.06, h0 * w[0] + h1 * w[1] + h2 * w[2] + h3 * w[3] + h4 * w[4] + bump * (1 - w[3] * 0.6));
        dummy.position.set(x, h / 2, z);
        dummy.rotation.set((hsh - 0.5) * 0.9 * w[1], (hsh * 7 % 1 - 0.5) * 1.2 * w[1], ((hsh * 13) % 1 - 0.5) * 0.9 * w[1]);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        // цвет
        const glow = Math.min(1, (occ ? 0.95 * w[0] : 0) + pu * w[2] + (inBar ? (0.35 + 0.65 * (bi / 11)) * w[3] : 0) + (m ? w[4] : 0) + bump * 0.7);
        col.copy(base).lerp(pearl, 0.03 + 0.06 * w[2]).lerp(mint, glow);
        if (hsh > 0.86) col.lerp(coral, w[1] * 0.9);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      renderer.render(scene, cam);
    },
    dispose() { removeEventListener('pointermove', onMove); geo.dispose(); mat.dispose(); renderer.dispose(); },
  };
}
