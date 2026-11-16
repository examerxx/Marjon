// Общие помощники «реалистичных» сцен G и H: рендерер с тенями и ACES, студийное окружение (PMREM), интерполяция состояний.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function makeRenderer(canvas, low) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1.5 : 2));
  renderer.setClearColor(0x0a0b0c, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const env = pm.fromScene(room, 0.04).texture; pm.dispose();
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return { renderer, env };
}
export function keyLight(scene, low, pos = [5, 11, 6], span = 9) {
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.position.set(...pos); sun.castShadow = true;
  sun.shadow.mapSize.setScalar(low ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 5;
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 40 });
  scene.add(sun); return sun;
}
export const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
export const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
// состояние объекта: [x, y, z, rx, ry, rz, scale]; c — непрерывный номер главы
export function mixState(states, c, out) {
  const i = Math.min(Math.floor(c), states.length - 2), f = Math.min(Math.max(c - i, 0), 1), e = f * f * f * (f * (f * 6 - 15) + 10), a = states[i], b = states[i + 1];
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * e;
  return out;
}
export const weights = (c, n = 5) => Array.from({ length: n }, (_, i) => Math.max(0, 1 - Math.abs(c - i)));
