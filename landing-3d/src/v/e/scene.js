// Сцена E «Поток»: один буфер частиц, пять форм, морфинг в вершинном шейдере по номеру главы.
// 0 — волна (поток заказов) · 1 — хаос · 2 — жемчужина · 3 — столбцы выручки · 4 — кольцо
import * as THREE from 'three';

export function createScene(canvas, { low }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1.5 : 2));
  renderer.setClearColor(0x0a0b0c, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

  const N = low ? 14000 : 38000;
  const P = [0, 1, 2, 3, 4].map(() => new Float32Array(N * 3)), R = new Float32Array(N * 4);
  const rnd = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const bars = [0.9, 1.3, 1.1, 1.9, 2.4, 2.0, 2.9, 3.4, 3.0, 4.0, 4.6, 5.2];
  const side = Math.ceil(Math.sqrt(N * 1.9));
  for (let i = 0; i < N; i++) {
    const a = rnd(), b = rnd(), c = rnd(), d = rnd(), k = i * 3;
    R.set([a, b, c, d], i * 4);
    // 0 · волна: наклонный лист
    const u = ((i % side) / side) * 2 - 1, v = (Math.floor(i / side) / (N / side)) * 2 - 1;
    P[0].set([u * 10.5, -2.7 + v * 0.5, v * 4.6 - 1.2], k);
    // 1 · хаос
    P[1].set([(a - 0.5) * 17, (b - 0.5) * 9.5, (c - 0.5) * 9 - 1], k);
    // 2 · жемчужина (сфера Фибоначчи + тонкая оболочка)
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963, rad = 2.75 * (d > 0.86 ? 1.12 + c * 0.25 : 1);
    P[2].set([Math.cos(th) * rr * rad, y * rad, Math.sin(th) * rr * rad], k);
    // 3 · столбцы
    const j = Math.floor(a * bars.length), hh = bars[j];
    P[3].set([(j - (bars.length - 1) / 2) * 0.86 + (b - 0.5) * 0.5, -2.7 + c * hh, (d - 0.5) * 0.5], k);
    // 4 · кольцо
    const t1 = a * Math.PI * 2, t2 = b * Math.PI * 2, rt = 0.42 * Math.sqrt(c);
    P[4].set([(3.9 + rt * Math.cos(t2)) * Math.cos(t1), rt * Math.sin(t2) * 1.4, (3.9 + rt * Math.cos(t2)) * Math.sin(t1)], k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P[0], 3));
  P.forEach((p, i) => i && geo.setAttribute('p' + i, new THREE.BufferAttribute(p, 3)));
  geo.setAttribute('aR', new THREE.BufferAttribute(R, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);

  const U = { uT: { value: 0 }, uTime: { value: 0 }, uVel: { value: 0 }, uMouse: { value: new THREE.Vector2(9, 9) }, uPx: { value: 1 }, uAspect: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute vec3 p4; attribute vec4 aR;
      uniform float uT, uTime, uVel, uPx, uAspect; uniform vec2 uMouse;
      varying vec3 vCol; varying float vA;
      mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
      void main() {
        float t = clamp(uT + (aR.x - .5) * .55, 0., 4.);
        float i = floor(t), f = fract(t); f = f * f * (3. - 2. * f);
        float tt = min(i + f, 4.);
        float w0 = max(0., 1. - abs(tt)), w1 = max(0., 1. - abs(tt - 1.)), w2 = max(0., 1. - abs(tt - 2.)), w3 = max(0., 1. - abs(tt - 3.)), w4 = max(0., 1. - abs(tt - 4.));
        vec3 a0 = position; a0.y += sin(a0.x * .62 + uTime * .9) * .5 + sin(a0.z * 1.2 - uTime * .7) * .28 + sin(a0.x * 1.7 + a0.z + uTime * 1.3) * .1;
        vec3 a1 = p1 + vec3(sin(uTime * .5 + aR.y * 40.), cos(uTime * .4 + aR.z * 40.), sin(uTime * .3 + aR.w * 40.)) * .7;
        vec3 a2 = p2; a2.xz = rot(uTime * .16) * a2.xz; a2 *= 1. + sin(uTime * 1.1 + aR.y * 6.28) * .012;
        vec3 a3 = p3; a3.y += sin(uTime * 1.6 + a3.x * 2.) * .04;
        vec3 a4 = p4; a4.xz = rot(-uTime * .22) * a4.xz; a4.yz = rot(.95) * a4.yz;
        vec3 pos = a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3 + a4 * w4;
        float mid = 1. - abs(2. * f - 1.); // вихрь в середине перехода
        pos += vec3(sin(aR.y * 31. + uTime), cos(aR.z * 27. + uTime * 1.2), sin(aR.w * 23. - uTime)) * mid * 1.1;
        pos.y += uVel * (aR.y - .5) * 1.6; // скорость скролла «растягивает» облако
        vec4 mv = modelViewMatrix * vec4(pos, 1.);
        vec4 clip = projectionMatrix * mv;
        vec2 ndc = clip.xy / clip.w, dm = (ndc - uMouse) * vec2(uAspect, 1.);
        float push = exp(-dot(dm, dm) * 9.);
        clip.xy += normalize(dm + 1e-4) / vec2(uAspect, 1.) * push * .16 * clip.w;
        gl_Position = clip;
        gl_PointSize = uPx * (1. + aR.y * 1.8) * (10. / -mv.z) * (1. + abs(uVel) * .5 + push * 1.2);
        vec3 pearl = vec3(.95, .93, .86), mint = vec3(.25, .89, .77), coral = vec3(1., .42, .3);
        vec3 col = mix(pearl, mint, smoothstep(.35, 1., aR.z));
        col = mix(col, coral, w1 * step(.78, aR.w));
        col = mix(col, mint, w3 * smoothstep(-2.7, 2.6, pos.y) * .8 + push * .6);
        vCol = col; vA = (.5 + aR.w * .5 + w0 * .35) * smoothstep(30., 6., -mv.z);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vA;
      void main() { float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(vCol, a * a * vA); }`,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  const mouse = { x: 9, y: 9, tx: 9, ty: 9, px: 0, py: 0 };
  const onMove = (e) => { mouse.tx = (e.clientX / innerWidth) * 2 - 1; mouse.ty = -((e.clientY / innerHeight) * 2 - 1); };
  addEventListener('pointermove', onMove, { passive: true });
  const camZ = [10.5, 12, 9.2, 10.8, 10.5], camY = [0.4, 0, 0, 0.2, 0.6];
  const lerpK = (arr, c) => { const i = Math.min(Math.floor(c), arr.length - 2), f = Math.min(Math.max(c - i, 0), 1); return arr[i] + (arr[i + 1] - arr[i]) * f; };
  let fit = 1, vel = 0;
  const resize = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    fit = Math.min(1, cam.aspect / 1.25); pts.scale.setScalar(Math.max(fit, 0.5));
    U.uAspect.value = cam.aspect; U.uPx.value = renderer.getPixelRatio() * (low ? 2.6 : 2.1) * Math.min(h / 900, 1.3);
  };
  resize();

  return {
    resize,
    render(dt, time, c, v) {
      const k = 1 - Math.exp(-dt * 5);
      if (mouse.x > 8) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
      mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
      mouse.px += ((mouse.tx > 8 ? 0 : mouse.tx) - mouse.px) * k * 0.5; mouse.py += ((mouse.ty > 8 ? 0 : mouse.ty) - mouse.py) * k * 0.5;
      vel += (Math.max(-1.5, Math.min(1.5, v * 0.02)) - vel) * k;
      const cc = Math.max(0, Math.min(4, c));
      U.uT.value = cc; U.uTime.value = time; U.uVel.value = vel; U.uMouse.value.set(mouse.x, mouse.y);
      cam.position.set(mouse.px * 0.9, lerpK(camY, cc) + mouse.py * 0.5, lerpK(camZ, cc));
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
    },
    dispose() { removeEventListener('pointermove', onMove); geo.dispose(); mat.dispose(); renderer.dispose(); },
  };
}
