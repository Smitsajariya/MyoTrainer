// Procedural 3D props: kitchen room, fruits, bowl, blender, jug, glasses. All sizes in metres.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ------------------------------------------------------------------ external GLB models (Meshy etc.)
// The server copies downloaded GLBs to virtual_hand/models/<slot>.glb and lists them in models/manifest.json.
// Each model is scaled to the real size below (metres, longest side) and centred, then used instead of the built-in shape.
export const MODEL_SIZE = { apple: 0.08, orange: 0.08, banana: 0.18, strawberry: 0.04, grape: 0.06, cherry: 0.045, bowl: 0.36 };
export const MODELS = {};
export async function loadExternalModels(onProgress = () => {}) {
  let list = [];
  try { const r = await fetch('./models/manifest.json', { cache: 'no-store' }); if (r.ok) list = (await r.json()).models || []; } catch (e) { return MODELS; }
  const loader = new GLTFLoader();
  for (const name of list.filter((n) => MODEL_SIZE[n])) {
    onProgress(name);
    try {
      const gltf = await loader.loadAsync(`./models/${name}.glb`);
      const obj = gltf.scene;
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
      const k = MODEL_SIZE[name] / Math.max(size.x, size.y, size.z, 1e-6);
      obj.scale.setScalar(k);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
      obj.position.set(-c.x, name === 'bowl' ? -box.min.y * k : -c.y, -c.z);   // fruit centred, bowl standing on its base
      obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      const holder = new THREE.Group(); holder.add(obj);
      MODELS[name] = holder;
    } catch (e) { console.warn('model failed', name, e); }
  }
  return MODELS;
}

// ------------------------------------------------------------------ canvas textures
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

export function woodTexture(repeat = [1, 1], base = [176, 124, 78]) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {          // planks
      const y = (i * h) / 6;
      g.fillStyle = `rgba(${base.map((v) => v + rnd(-18, 18)).join(',')},1)`; g.fillRect(0, y, w, h / 6);
      g.fillStyle = 'rgba(60,35,20,0.35)'; g.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 260; i++) {        // grain
      g.strokeStyle = `rgba(80,45,25,${rnd(0.04, 0.14)})`; g.lineWidth = rnd(0.5, 2);
      const y = rnd(0, h); g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / rnd(30, 90)) * rnd(1, 4));
      g.stroke();
    }
  }, repeat);
}

export function tileTexture(repeat = [1, 1], color = '#f3f1ec', grout = '#cfcac0') {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = grout; g.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n / 2; j++) {
      const off = (j % 2) * s / 2;
      g.fillStyle = color; g.globalAlpha = rnd(0.92, 1);
      g.fillRect(i * s + off - s + 3, j * 2 * s + 3, s - 6, 2 * s - 6);
      g.fillRect(i * s + off + 3, j * 2 * s + 3, s - 6, 2 * s - 6);
    }
    g.globalAlpha = 1;
  }, repeat);
}

function floorTexture(repeat) {
  return canvasTex(512, 512, (g, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? '#d9d4ca' : '#c9c2b5'; g.fillRect(i * s, j * s, s, s);
    }
  }, repeat);
}

function skyTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#9fd0ff'); gr.addColorStop(0.7, '#e4f2ff'); gr.addColorStop(1, '#bfe3b0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(rnd(20, 230), rnd(30, 120), rnd(20, 40), rnd(8, 14), 0, 0, 7); g.fill(); }
  });
}

// ------------------------------------------------------------------ kitchen
export function buildKitchen(scene) {
  const room = new THREE.Group(); scene.add(room);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  // floor + walls
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), std({ map: floorTexture([8, 8]), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);
  const tiles = std({ map: tileTexture([6, 3]), roughness: 0.35 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), tiles); back.position.set(0, 1.5, -1.0); back.receiveShadow = true; room.add(back);
  const paint = std({ color: 0xe9e4da, roughness: 0.9 });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), paint); left.position.set(-2.2, 1.5, 0); left.rotation.y = Math.PI / 2; room.add(left);
  const right = left.clone(); right.position.x = 2.2; right.rotation.y = -Math.PI / 2; room.add(right);
  // window with sky
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ map: skyTexture() }));
  win.position.set(0.55, 1.65, -0.99); room.add(win);
  const frameMat = std({ color: 0xffffff, roughness: 0.5 });
  [[0, 0.36, 1.18, 0.04], [0, -0.36, 1.18, 0.04], [-0.57, 0, 0.04, 0.76], [0.57, 0, 0.04, 0.76], [0, 0, 0.03, 0.72]].forEach(([x, y, w, h]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frameMat); b.position.set(0.55 + x, 1.65 + y, -0.975); room.add(b);
  });
  // worktop + cabinets
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.95), std({ map: woodTexture([2, 1]), roughness: 0.55 }));
  top.position.set(0, 0.73, -0.45); top.receiveShadow = true; top.castShadow = true; room.add(top);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.71, 0.9), std({ color: 0x2f4f5f, roughness: 0.6 }));
  cab.position.set(0, 0.355, -0.47); room.add(cab);
  for (let i = -3; i <= 3; i++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.02), std({ color: 0xc9b37e, metalness: 0.8, roughness: 0.3 }));
    h.position.set(i * 0.37, 0.62, -0.01); room.add(h);
  }
  // shelf with jars
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.22), std({ map: woodTexture([1, 1]), roughness: 0.6 }));
  shelf.position.set(-0.75, 1.45, -0.89); room.add(shelf);
  const jarCols = [0xd9a441, 0x8fbf5a, 0xc0503c, 0xe8e1d0];
  for (let i = 0; i < 4; i++) {
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 20),
      new THREE.MeshStandardMaterial({ color: jarCols[i], roughness: 0.25, transparent: true, opacity: 0.85 }));
    jar.position.set(-1.05 + i * 0.2, 1.535, -0.88); room.add(jar);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 20), std({ color: 0x3b3531, roughness: 0.5 }));
    lid.position.set(-1.05 + i * 0.2, 1.615, -0.88); room.add(lid);
  }
  // plant
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 20), std({ color: 0xc66b45, roughness: 0.8 }));
  pot.position.set(1.1, 0.81, -0.75); room.add(pot);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), std({ color: 0x3e8e41, roughness: 0.7 }));
    leaf.scale.set(0.5, 1.4, 0.25);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(1.1 + Math.cos(a) * 0.05, 0.93 + Math.random() * 0.05, -0.75 + Math.sin(a) * 0.05);
    leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6); room.add(leaf);
  }
  // pendant lamp
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.8), std({ color: 0x222222 }));
  cord.position.set(0, 2.6, -0.4); room.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 32, 1, true), std({ color: 0x1f3a5f, roughness: 0.5, side: THREE.DoubleSide }));
  shade.position.set(0, 2.15, -0.4); room.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1cc }));
  bulb.position.set(0, 2.1, -0.4); room.add(bulb);

  // lights
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a7a66, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
  sun.position.set(1.2, 2.6, 1.0); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.4, right: 1.4, top: 1.2, bottom: -1.2, near: 0.5, far: 6 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const lamp = new THREE.PointLight(0xffe2b0, 1.2, 3.5, 1.5); lamp.position.set(0, 2.05, -0.4); scene.add(lamp);
  return { room, worktopY: 0.75 };
}

// ------------------------------------------------------------------ fruits
export const FRUITS = {
  apple:      { need: 'close', grip: 'big',   r: 0.038, name: 'Apple',      icon: '🍎' },
  orange:     { need: 'close', grip: 'big',   r: 0.04,  name: 'Orange',     icon: '🍊' },
  banana:     { need: 'close', grip: 'big',   r: 0.03,  name: 'Banana',     icon: '🍌' },
  strawberry: { need: 'pinch', grip: 'small', r: 0.018, name: 'Strawberry', icon: '🍓' },
  grape:      { need: 'pinch', grip: 'small', r: 0.016, name: 'Grape',      icon: '🍇' },
  cherry:     { need: 'pinch', grip: 'small', r: 0.015, name: 'Cherry',     icon: '🍒' },
};

function lathe(points, segs, mat) {
  const g = new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}

export function makeFruit(kind) {
  const g = new THREE.Group();
  if (MODELS[kind]) { g.add(MODELS[kind].clone()); g.userData = { kind, ...FRUITS[kind] }; return g; }
  const M = (color, rough = 0.45, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  const stemM = M(0x5b3a1e, 0.8), leafM = M(0x4c9a2a, 0.6);
  if (kind === 'apple') {
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, a = t * Math.PI; pts.push([Math.sin(a) * 0.038 * (1 + 0.12 * Math.sin(a * 2)) + 0.0005, -Math.cos(a) * 0.034 - (t < 0.1 || t > 0.9 ? 0.004 * Math.sin(t * Math.PI) : 0)]); }
    pts[0][1] += 0.006; pts[16][1] -= 0.006;
    g.add(lathe(pts, 28, M(0xc8261d, 0.35, { emissive: 0x2a0000 })));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0018, 0.022), stemM); stem.position.y = 0.036; stem.rotation.z = 0.2; g.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 6), leafM); leaf.scale.set(1.3, 0.25, 0.6); leaf.position.set(0.01, 0.04, 0); leaf.rotation.z = -0.5; g.add(leaf);
  } else if (kind === 'orange') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 32, 24), M(0xf08a1c, 0.75)); m.castShadow = true; g.add(m);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.003), leafM); dot.position.y = 0.04; g.add(dot);
  } else if (kind === 'banana') {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.085, 0.02, 0), new THREE.Vector3(0, -0.035, 0), new THREE.Vector3(0.085, 0.02, 0));
    const geo = new THREE.TubeGeometry(curve, 32, 0.017, 10, false);
    const pos = geo.attributes.position, n = 33, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {   // taper the ends
      const seg = Math.floor(i / 11), t = seg / (n - 1), s = 0.35 + 0.65 * Math.sin(Math.PI * t);
      const c = curve.getPoint(t); v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(s).add(c); pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, M(0xf3d23b, 0.55)); m.castShadow = true; g.add(m);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.016), stemM); tip.position.set(0.09, 0.026, 0); tip.rotation.z = -0.6; g.add(tip);
  } else if (kind === 'strawberry') {
    const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([Math.sin(t * Math.PI * 0.95) * 0.018 * (0.55 + 0.45 * t) + 0.0003, -0.022 + t * 0.036]); }
    g.add(lathe(pts, 22, M(0xd7263d, 0.4)));
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), leafM); l.scale.set(1.3, 0.2, 0.5);
      const a = (i / 5) * Math.PI * 2; l.position.set(Math.cos(a) * 0.008, 0.015, Math.sin(a) * 0.008); l.rotation.y = -a; g.add(l);
    }
    const seedM = M(0xf4e19b, 0.6);
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 4, 3), seedM);
      const y = rnd(-0.016, 0.01), t = (y + 0.022) / 0.036, rr = Math.sin(t * Math.PI * 0.95) * 0.018 * (0.55 + 0.45 * t), a = rnd(0, 6.28);
      s.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); g.add(s);
    }
  } else if (kind === 'grape') {
    const gm = M(0x5e2b7e, 0.3, { emissive: 0x10001a });
    const offs = [[0, 0, 0], [0.012, 0.006, 0.004], [-0.011, 0.007, -0.003], [0.002, 0.012, 0.011], [0.004, 0.015, -0.01], [-0.006, -0.009, 0.004]];
    offs.forEach(([x, y, z]) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 16, 12), gm); b.position.set(x, y, z); b.castShadow = true; g.add(b); });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.018), M(0x6f8f3a, 0.7)); stem.position.y = 0.024; g.add(stem);
  } else if (kind === 'cherry') {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.014, 24, 16), M(0x8c0f1e, 0.25, { emissive: 0x1a0000 })); c.castShadow = true; g.add(c);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03), M(0x5b7a2a, 0.7));
    stem.position.set(0.004, 0.026, 0); stem.rotation.z = -0.25; g.add(stem);
  }
  g.userData = { kind, ...FRUITS[kind] };
  return g;
}

// ------------------------------------------------------------------ containers
export function makeBowl() {
  if (MODELS.bowl) { const g = new THREE.Group(); g.add(MODELS.bowl.clone()); return g; }
  const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([0.04 + 0.12 * Math.sin(t * Math.PI / 2), t * 0.07]); }
  const inner = pts.slice().reverse().map(([x, y]) => [x - 0.006, y + 0.004]);
  const g = new THREE.Group();
  const m = lathe([[0, 0.002], ...pts, ...inner, [0, 0.008]], 48, new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.25, metalness: 0.05 }));
  m.receiveShadow = true; g.add(m);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.159, 0.004, 8, 48), new THREE.MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.4 }));
  band.rotation.x = Math.PI / 2; band.position.y = 0.066; g.add(band);
  return g;
}

export function makeBlender() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0xd8362a, roughness: 0.35, metalness: 0.2 }));
  base.position.y = 0.06; base.castShadow = true; g.add(base);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 20), new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.7, roughness: 0.2 }));
  knob.rotation.x = Math.PI / 2; knob.position.set(0, 0.06, 0.088); g.add(knob);
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.06, 0.22, 32, 1, true),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
  jar.position.y = 0.23; g.add(jar);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.004, 8, 40), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.34; g.add(rim);
  const juice = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 1, 32), new THREE.MeshStandardMaterial({ color: 0xe86a8a, roughness: 0.3, transparent: true, opacity: 0.9 }));
  juice.position.y = 0.125; juice.scale.y = 0.001; juice.visible = false; g.add(juice);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.004, 0.012), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 }));
  blade.position.y = 0.135; g.add(blade);
  g.userData = { juice, blade, openingY: 0.34, radius: 0.085 };
  return g;
}

export function makeGlass() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.032, 0.12, 32, 1, true),
    new THREE.MeshPhysicalMaterial({ color: 0xe8f4ff, roughness: 0.05, transparent: true, opacity: 0.32, side: THREE.DoubleSide }));
  glass.position.y = 0.06; g.add(glass);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 32), new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.6 }));
  bottom.position.y = 0.004; g.add(bottom);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.031, 1, 32), new THREE.MeshStandardMaterial({ color: 0x3fa7e0, roughness: 0.15, transparent: true, opacity: 0.75 }));
  water.position.y = 0.008; water.scale.y = 0.0001; g.add(water);
  const line = new THREE.Mesh(new THREE.TorusGeometry(0.0375, 0.0015, 6, 40), new THREE.MeshBasicMaterial({ color: 0x1baf7a }));
  line.rotation.x = Math.PI / 2; g.add(line);
  g.userData = { water, line, height: 0.112 };
  return g;
}

export function makeJug() {
  const g = new THREE.Group();
  const pts = [[0.0, 0], [0.055, 0], [0.06, 0.03], [0.058, 0.12], [0.05, 0.17], [0.052, 0.18]];
  const body = lathe(pts, 36, new THREE.MeshPhysicalMaterial({ color: 0xf6fbff, roughness: 0.08, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  g.add(body);
  const water = lathe([[0, 0.004], [0.053, 0.004], [0.057, 0.03], [0.055, 0.12], [0, 0.12]], 32,
    new THREE.MeshStandardMaterial({ color: 0x3fa7e0, roughness: 0.15, transparent: true, opacity: 0.7 }));
  g.add(water);
  const spout = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 16, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xf6fbff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
  spout.position.set(0.06, 0.17, 0); spout.rotation.z = -Math.PI / 2.4; g.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 10, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.4 }));
  handle.position.set(-0.06, 0.1, 0); handle.rotation.z = Math.PI / 2; g.add(handle);
  g.userData = { water, spoutLocal: new THREE.Vector3(0.078, 0.18, 0) };
  return g;
}
