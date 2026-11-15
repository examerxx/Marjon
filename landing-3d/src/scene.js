// 3D-сцена «Нить»: 8 перламутровых бусин + нить. Всё процедурное, без моделей и текстур.
// Сцена ничего не анимирует сама: она читает состояние S и beads[i].st,
// которые двигает мастер-таймлайн (story.js). Свой ход у неё только idle-дрейф и параллакс.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const N = 8; // бусин = модулей
const SEG = 288; // сегментов нити
const C = {
  ink: new THREE.Color('#0a0b0c'), pearl: new THREE.Color('#efe9dd'), dull: new THREE.Color('#4a4d50'),
  black: new THREE.Color('#0d0f10'), mint: new THREE.Color('#3fe3c4'), coral: new THREE.Color('#ff6a4d'),
};

// ---------- шейдеры ----------
const BG = {
  vert: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
  frag: /* glsl */ `precision highp float;
    varying vec2 vUv; uniform vec3 uInk, uGlow; uniform vec2 uPos; uniform float uAmt, uAspect, uTime;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 p = (vUv - uPos) * vec2(uAspect, 1.0);
      float n = noise(p * 1.6 + uTime * 0.04) * 0.5 + noise(p * 3.4 - uTime * 0.03) * 0.25;
      float d = length(p) * (0.9 + n * 0.5);
      float g = exp(-d * d * 2.6) * 0.55 + exp(-d * 1.4) * 0.12;
      vec3 col = uInk + uGlow * g * uAmt;
      col += uGlow * 0.015 * n * uAmt;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const DUST = {
  vert: /* glsl */ `precision highp float;
    attribute float aSeed; uniform float uTime, uSize; varying float vA;
    void main(){
      vec3 p = position;
      p.y = mod(p.y + uTime * (0.08 + aSeed * 0.12) + 9.0, 18.0) - 9.0;
      p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.3;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (0.4 + aSeed) / -mv.z;
      vA = (0.35 + 0.65 * sin(uTime * (0.6 + aSeed) + aSeed * 90.0)) * smoothstep(34.0, 8.0, -mv.z);
    }`,
  frag: /* glsl */ `precision highp float;
    uniform vec3 uColor; uniform float uOpacity; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 1.4, a * a * vA * uOpacity); }`,
};
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uCA: { value: 0 }, uVig: { value: 0.9 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `precision highp float;
    uniform sampler2D tDiffuse; uniform float uCA, uVig; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 o = c * r2 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      col *= 1.0 - r2 * uVig;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 0.045 } },
  vertexShader: LensShader.vertexShader,
  fragmentShader: /* glsl */ `precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime, uAmt; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float n = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5; gl_FragColor = vec4(c.rgb + n * uAmt, 1.0); }`,
};

// Студийный свет вместо HDRI: тёплый софтбокс сверху, мятная полоса слева, холодный контровой.
function buildEnv(renderer) {
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (color, k, pos, scale) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
    m.position.set(...pos); m.scale.set(...scale); env.add(m);
  };
  env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: 0x060708, side: THREE.BackSide })));
  add('#fff3e2', 9, [1, 9, 3], [10, 0.2, 6]);
  add('#3fe3c4', 5, [-10, 0, 2], [0.2, 9, 3]);
  add('#cfe6ff', 3.5, [9, 2, -5], [0.2, 5, 5]);
  add('#ffffff', 2.2, [0, -1, 11], [5, 2.4, 0.2]);
  add('#ff8a6a', 1.4, [3, -9, 2], [5, 0.2, 3]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(200,255,240,.6)'); r.addColorStop(1, 'rgba(63,227,196,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createScene(canvas, { low = false, labels = [] } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  const maxDpr = low ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(C.ink, 1);

  const scene = new THREE.Scene();
  scene.environment = buildEnv(renderer);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
  const rig = new THREE.Group();
  scene.add(rig);

  const key = new THREE.DirectionalLight('#fff1dd', 1.6);
  key.position.set(4, 6, 5);
  scene.add(key);

  // ---- состояние, которым управляет мастер-таймлайн ----
  const S = {
    camX: 0, camY: -0.3, camZ: 6.4, tx: 0, ty: 0, tz: 0, roll: 0, fit: 1,
    ox: 0.2, oy: -0.04, oyM: -0.17, // сдвиг кадра: десктоп (доля ширины/высоты) и портрет
    rx: 0, ry: 0, rz: 0, dialAmt: 0, dial: 0,
    draw: 1, threadA: 1, tension: 0.5, pulse: 0,
    drift: 0.25, coral: 0, glow: 1, labels: 0, dust: 0.55, exposure: 1.05,
    bloom: 0.45, intro: 1,
  };

  // ---- фон ----
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: BG.vert, fragmentShader: BG.frag, depthTest: false, depthWrite: false,
    uniforms: { uInk: { value: C.ink.clone() }, uGlow: { value: new THREE.Color() }, uPos: { value: new THREE.Vector2(0.5, 0.5) }, uAmt: { value: 1 }, uAspect: { value: 1 }, uTime: { value: 0 } },
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false; bg.renderOrder = -10;
  scene.add(bg);

  // ---- бусины ----
  const sphere = new THREE.SphereGeometry(1, low ? 48 : 96, low ? 32 : 64);
  const beads = [];
  for (let i = 0; i < N; i++) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: C.pearl.clone(), roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12,
      iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
      sheen: 0.4, sheenColor: new THREE.Color('#ffe9d6'), sheenRoughness: 0.5,
      emissive: C.mint.clone(), emissiveIntensity: 0, envMapIntensity: 1.15,
    });
    // свечение по краю (френель), а не ровной заливкой
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance *= 0.12 + 2.6 * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);`
      );
    };
    const mesh = new THREE.Mesh(sphere, mat);
    rig.add(mesh);
    beads.push({ mesh, mat, st: { x: 0, y: 0, z: 0, s: 0.4, dull: 0, lit: 0, dark: 0 }, ph: i * 1.7 + 0.3, fq: 0.35 + (i % 3) * 0.11 });
  }

  // ---- нить ----
  const pts = beads.map(() => new THREE.Vector3());
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const lineGeo = new LineGeometry();
  lineGeo.setPositions(new Float32Array((SEG + 1) * 3));
  const lineMat = new LineMaterial({ color: 0xffffff, linewidth: low ? 1.6 : 2.2, transparent: true, opacity: 1, depthWrite: false });
  lineMat.color.setRGB(0.5, 2.3, 1.9); // HDR-мята: уходит в bloom
  const line = new Line2(lineGeo, lineMat);
  line.frustumCulled = false;
  rig.add(line);
  const segArr = lineGeo.attributes.instanceStart.data.array; // [x0 y0 z0 x1 y1 z1] * SEG
  const segBuf = lineGeo.attributes.instanceStart.data;

  // ---- импульсы по нити ----
  const glowTex = glowTexture();
  const pulses = [0, 1, 2].map(() => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    sp.material.color.setRGB(1.2, 2.4, 2.0);
    rig.add(sp);
    return sp;
  });

  // ---- пыль ----
  const dustN = low ? 260 : 700;
  const dpos = new Float32Array(dustN * 3), dseed = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 34; dpos[i * 3 + 1] = (Math.random() - 0.5) * 18; dpos[i * 3 + 2] = (Math.random() - 0.5) * 26 - 2;
    dseed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST.vert, fragmentShader: DUST.frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: 60 }, uColor: { value: C.pearl.clone() }, uOpacity: { value: 0.5 } },
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- постобработка: Render → Bloom → Lens(виньетка+аберрация) → Output → Grain ----
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.4, 0.82);
  composer.addPass(bloom);
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass(GrainShader);
  composer.addPass(grain);

  // ---- размер ----
  let W = 1, H = 1, aspect = 1, portrait = 0;
  function resize() {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    aspect = W / H;
    portrait = THREE.MathUtils.smoothstep(1.2 - aspect, 0, 0.45); // 0 — ландшафт, 1 — портрет
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    if (low) bloom.resolution.set(W / 2, H / 2);
    lineMat.resolution.set(W, H);
    dustMat.uniforms.uSize.value = 60 * dpr * (H / 900);
    bgMat.uniforms.uAspect.value = aspect;
    camera.aspect = aspect;
  }

  // ---- кадр ----
  const pearl = { x: 0, y: 0, r: 0 };
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { mouse.tx = (e.clientX / window.innerWidth) * 2 - 1; mouse.ty = (e.clientY / window.innerHeight) * 2 - 1; };
  window.addEventListener('pointermove', onMove, { passive: true });

  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), tgt = new THREE.Vector3(), col = new THREE.Color();
  let vel = 0;

  function render(dt, time, scrollVel = 0) {
    const k = 1 - Math.pow(1 - 0.06, dt * 60); // lerp, не зависящий от fps
    mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
    vel += (Math.min(Math.abs(scrollVel), 60) - vel) * k;

    // rig
    rig.rotation.set(S.rx + mouse.y * 0.04, S.ry + mouse.x * 0.06, S.rz + S.dial * S.dialAmt + Math.sin(time * 0.25) * 0.05);

    // бусины
    for (let i = 0; i < N; i++) {
      const b = beads[i], st = b.st, d = S.drift;
      b.mesh.position.set(
        st.x + Math.sin(time * b.fq + b.ph) * 0.22 * d,
        st.y + Math.cos(time * b.fq * 0.8 + b.ph * 1.3) * 0.26 * d,
        st.z + Math.sin(time * b.fq * 0.6 + b.ph * 2.1) * 0.2 * d
      );
      b.mesh.scale.setScalar(Math.max(0.0001, st.s));
      b.mesh.rotation.y = time * 0.1 + b.ph;
      pts[i].copy(b.mesh.position);
      const m = b.mat;
      col.copy(C.pearl).lerp(C.dull, st.dull).lerp(C.black, st.dark);
      m.color.copy(col);
      m.roughness = 0.2 + st.dull * 0.6 - st.dark * 0.08;
      m.iridescence = (1 - st.dull) * (1 - st.dark * 0.4);
      m.clearcoat = 1 - st.dull * 0.9;
      m.sheen = 0.4 * (1 - st.dull) * (1 - st.dark);
      m.emissiveIntensity = st.lit * 0.9;
      m.envMapIntensity = 1.15 - st.dull * 0.55;
    }

    // нить
    curve.tension = S.tension;
    curve.getPoint(0, v);
    for (let i = 0; i < SEG; i++) {
      curve.getPoint((i + 1) / SEG, v2);
      const o = i * 6;
      segArr[o] = v.x; segArr[o + 1] = v.y; segArr[o + 2] = v.z;
      segArr[o + 3] = v2.x; segArr[o + 4] = v2.y; segArr[o + 5] = v2.z;
      v.copy(v2);
    }
    segBuf.needsUpdate = true;
    lineGeo.instanceCount = Math.max(0, Math.min(SEG, Math.round(SEG * S.draw)));
    lineMat.opacity = S.threadA;
    line.visible = S.threadA > 0.004 && S.draw > 0.002;

    for (let i = 0; i < 3; i++) {
      const sp = pulses[i];
      const u = ((time * 0.11 + i / 3) % 1) * Math.min(1, S.draw);
      curve.getPoint(u, sp.position);
      sp.scale.setScalar(0.42 + Math.sin(time * 4 + i) * 0.06);
      sp.material.opacity = S.pulse * S.threadA;
      sp.visible = sp.material.opacity > 0.01;
    }

    // камера
    const fit = 1 + (Math.max(1, 1.05 / aspect) - 1) * S.fit;
    const introZ = (1 - S.intro) * 5;
    tgt.set(S.tx, S.ty, S.tz);
    v.set(S.camX - S.tx + mouse.x * 0.35, S.camY - S.ty - mouse.y * 0.25, S.camZ - S.tz).multiplyScalar(fit);
    v.setLength(v.length() + introZ);
    camera.position.copy(tgt).add(v);
    camera.lookAt(tgt);
    camera.rotateZ(S.roll);
    const ox = S.ox * (1 - portrait), oy = S.oy * (1 - portrait) + S.oyM * portrait;
    camera.setViewOffset(W, H, -ox * W, -oy * H, W, H);
    camera.updateMatrixWorld();

    // свет и атмосфера
    col.copy(C.mint).lerp(C.coral, S.coral);
    bgMat.uniforms.uGlow.value.copy(col).multiplyScalar(0.34);
    bgMat.uniforms.uAmt.value = S.glow * S.intro;
    bgMat.uniforms.uTime.value = time;
    rig.getWorldPosition(v).project(camera);
    bgMat.uniforms.uPos.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    key.color.set('#fff1dd').lerp(C.coral, S.coral * 0.7);
    scene.environmentIntensity = 1 - S.coral * 0.45;
    renderer.toneMappingExposure = S.exposure;
    dustMat.uniforms.uTime.value = time;
    dustMat.uniforms.uOpacity.value = S.dust;
    bloom.strength = S.bloom * (low ? 0.6 : 1);
    lens.uniforms.uCA.value = low ? 0 : 0.012 + vel * 0.0016;
    grain.uniforms.uTime.value = time;

    // экранный круг жемчужины — для тёмного слоя заголовка в hero
    beads[0].mesh.getWorldPosition(v);
    const pd = v.distanceTo(camera.position);
    v.project(camera);
    pearl.x = (v.x * 0.5 + 0.5) * W; pearl.y = (-v.y * 0.5 + 0.5) * H;
    pearl.r = (beads[0].st.s / Math.sqrt(Math.max(1e-4, pd * pd - beads[0].st.s ** 2))) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (H / 2);

    // подписи у бусин (DOM)
    if (labels.length) {
      const show = S.labels > 0.01;
      for (let i = 0; i < labels.length; i++) {
        const el = labels[i], b = beads[i];
        if (!show) { if (el._o !== 0) { el.style.opacity = 0; el._o = 0; } continue; }
        b.mesh.getWorldPosition(v);
        const dist = v.distanceTo(camera.position);
        v.project(camera);
        const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
        const rad = (b.st.s / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * (H / 2);
        const on = v.z < 1 && px > -80 && px < W + 80 ? S.labels * (0.35 + 0.65 * b.st.lit) : 0;
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${(py + rad + 14).toFixed(1)}px, 0) translateX(-50%)`;
        el.style.opacity = on.toFixed(3); el._o = on;
      }
    }
    composer.render(dt);
  }

  function dispose() {
    window.removeEventListener('pointermove', onMove);
    sphere.dispose(); beads.forEach((b) => b.mat.dispose());
    lineGeo.dispose(); lineMat.dispose(); glowTex.dispose(); pulses.forEach((p) => p.material.dispose());
    dustGeo.dispose(); dustMat.dispose(); bg.geometry.dispose(); bgMat.dispose();
    scene.environment?.dispose(); rt.dispose(); composer.dispose(); renderer.dispose();
  }

  resize();
  return { S, beads, pearl, render, resize, dispose, renderer };
}
