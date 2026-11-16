// Articulated prosthetic hand (metres). Built along +x (fingers point +x, palm faces -y).
// pose(name)                 -> one of the 4 trained gestures (used with the band / AI decoder)
// curls([t,i,m,r,l], extra)  -> every finger on its own (used when the camera mirrors your fingers)
// update(dt) animates smoothly towards the target.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ------------------------------------------------------------------ Smit's 3D-printed hand (from his STL files)
// tools/build_arm_model.py converts the printed parts to models/arm/*.glb + arm.json (joint positions).
export const ARM = { ready: false, parts: {}, layout: null };
export async function loadArmModel() {
  try {
    const r = await fetch('./models/arm/arm.json', { cache: 'no-store' }); if (!r.ok) return false;
    ARM.layout = await r.json();
    const names = ['palm', 'thumb_1', 'thumb_2', ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((i) => `${f}_${i}`))];
    if (ARM.layout.forearm) names.push('forearm');
    const loader = new GLTFLoader();
    await Promise.all(names.map(async (n) => {
      const sc = (await loader.loadAsync(`./models/arm/${n}.glb`)).scene;
      sc.traverse((m) => { if (m.isMesh) { m.geometry.deleteAttribute('normal'); m.geometry.computeVertexNormals(); } });   // STL -> smooth shading
      ARM.parts[n] = sc;
    }));
    ARM.ready = true;
  } catch (e) { console.warn('printed hand not loaded, using the built-in hand', e); ARM.ready = false; }
  return ARM.ready;
}

export const POSES = {
  rest:  { f: [[0.35, 0.45, 0.3], [0.4, 0.5, 0.3], [0.45, 0.55, 0.35], [0.5, 0.6, 0.35]], t: [0.25, 0.2, 0.15], spread: 0.03 },
  open:  { f: [[0.0, 0.05, 0.0], [0.0, 0.05, 0.0], [0.0, 0.05, 0.0], [0.0, 0.05, 0.0]], t: [-0.15, 0.0, 0.0], spread: 0.12 },
  close: { f: [[1.45, 1.7, 1.05], [1.5, 1.75, 1.05], [1.5, 1.75, 1.05], [1.45, 1.7, 1.0]], t: [0.95, 0.55, 0.6], spread: 0.0 },
  pinch: { f: [[0.75, 0.85, 0.55], [1.2, 1.4, 0.9], [1.3, 1.5, 0.95], [1.3, 1.5, 0.95]], t: [0.8, 0.35, 0.35], spread: 0.0 },
};

const FINGERS = [
  { z: 0.027, len: [0.042, 0.025, 0.02], r: 0.0086 },
  { z: 0.009, len: [0.046, 0.028, 0.021], r: 0.0089 },
  { z: -0.009, len: [0.043, 0.026, 0.02], r: 0.0085 },
  { z: -0.026, len: [0.034, 0.02, 0.017], r: 0.0076 },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// hand style: 'bionic' (default) or 'printed' (Smit's STL hand), remembered in the browser
export function handStyle() { try { return localStorage.getItem('smits_kitchen_hand') || 'bionic'; } catch (e) { return 'bionic'; } }
export function setHandStyle(v) { try { localStorage.setItem('smits_kitchen_hand', v); } catch (e) { /* ignore */ } }
export function createHand(opts = {}) {
  if (handStyle() === 'printed' && ARM.ready) return createPrintedHand(opts);
  return createBionicHand(opts);
}

function createBuiltinHand({ forearm = true } = {}) {
  // white shell + graphite joints + orange status light (looks like a modern bionic hand)
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf1f3f5, roughness: 0.36, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x353a42, roughness: 0.45, metalness: 0.55 });
  const pad = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.85, metalness: 0.0 });
  const sockM = new THREE.MeshPhysicalMaterial({ color: 0x59606b, roughness: 0.5, metalness: 0.2, clearcoat: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xeb6834, roughness: 0.35, emissive: 0xeb6834, emissiveIntensity: 0.6 });
  const root = new THREE.Group();
  const add = (parent, mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

  // palm: rounded shell on a dark chassis
  const palm = add(root, new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.03, 0.08, 4, 0.012), shell));
  palm.position.x = 0.044;
  const chassis = add(root, new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.012, 0.072, 3, 0.005), joint));
  chassis.position.set(0.044, -0.014, 0);
  const knuckle = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.078, 20), joint));
  knuckle.rotation.x = Math.PI / 2; knuckle.position.x = 0.086;
  const light = add(root, new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.004, 0.008, 2, 0.002), accent));
  light.position.set(0.034, 0.0152, 0);

  function phalanx(len, r, tip) {
    const g = new THREE.Group();
    const m = add(g, new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 16), shell));
    m.rotation.z = Math.PI / 2; m.position.x = len / 2;
    add(g, new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 16, 12), joint));
    if (tip) { const p = add(g, new THREE.Mesh(new THREE.SphereGeometry(r * 0.92, 14, 10), pad)); p.position.set(len - r * 0.7, -r * 0.35, 0); p.scale.set(1, 0.7, 1); }
    return g;
  }
  const fingers = [];
  for (const f of FINGERS) {
    const j1 = phalanx(f.len[0], f.r); j1.position.set(0.088, 0, f.z); root.add(j1);
    const j2 = phalanx(f.len[1], f.r * 0.95); j2.position.x = f.len[0]; j1.add(j2);
    const j3 = phalanx(f.len[2], f.r * 0.9, true); j3.position.x = f.len[1]; j2.add(j3);
    fingers.push([j1, j2, j3]);
  }
  const thumbBase = new THREE.Group(); thumbBase.position.set(0.018, -0.004, 0.04); root.add(thumbBase);
  const t1 = phalanx(0.036, 0.0098); thumbBase.add(t1);
  const t2 = phalanx(0.028, 0.0092); t2.position.x = 0.036; t1.add(t2);
  const t3 = phalanx(0.022, 0.0086, true); t3.position.x = 0.028; t2.add(t3);

  if (forearm) {
    const wrist = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.04, 0.026, 36), joint));
    wrist.rotation.z = Math.PI / 2; wrist.position.x = -0.011;
    const sock = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.047, 0.15, 40), sockM));
    sock.rotation.z = Math.PI / 2; sock.position.x = -0.1;
    const cuff = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.0425, 0.0425, 0.03, 40), shell));
    cuff.rotation.z = Math.PI / 2; cuff.position.x = -0.04;
    const ring = add(root, new THREE.Mesh(new THREE.TorusGeometry(0.0435, 0.0028, 8, 48), accent));
    ring.rotation.y = Math.PI / 2; ring.position.x = -0.058;
  }

  return makeController(root, fingers, thumbBase, t2, t3, +1,
    (kind) => (kind === 'small' ? new THREE.Vector3(0.118, -0.012, 0.03) : new THREE.Vector3(0.1, -0.035, 0.0)));
}


// ------------------------------------------------------------------ shared animation (both hands)
// side: +1 thumb on the +z side (built-in hand), -1 thumb on the -z side (printed right hand)
function makeController(root, fingers, thumbBase, t2, t3, side, gripLocal) {
  const cur = JSON.parse(JSON.stringify(POSES.rest));
  let target = POSES.rest;
  function curlsToPose(c, extra = {}) {
    const pinch = extra.pinch != null ? extra.pinch : 1;
    const opp = clamp01(1 - (pinch - 0.22) / 0.55);
    const spreadF = extra.spread != null ? clamp01((extra.spread - 0.95) / 0.65) : 1 - Math.max(c[1], c[4]);
    return {
      f: [1, 2, 3, 4].map((i) => [c[i] * 1.5, c[i] * 1.75, c[i] * 1.05]),
      t: [Math.max(c[0] * 0.95, opp * 0.8), Math.max(c[0], opp * 0.4) * 0.6, Math.max(c[0], opp * 0.4) * 0.65],
      spread: 0.13 * spreadF,
    };
  }
  return {
    root,
    pose(name) { if (POSES[name]) target = POSES[name]; },
    curls(c, extra) { target = curlsToPose(c, extra); },
    update(dt) {
      const k = 1 - Math.exp(-dt * 16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          cur.f[i][j] += (target.f[i][j] - cur.f[i][j]) * k;
          fingers[i][j].rotation.z = -cur.f[i][j];
        }
        fingers[i][0].rotation.y = (i - 1.5) * -cur.spread * side;
      }
      for (let j = 0; j < 3; j++) cur.t[j] += (target.t[j] - cur.t[j]) * k;
      cur.spread += (target.spread - cur.spread) * k;
      if (side > 0) {
        thumbBase.rotation.y = -0.75 + cur.t[0] * 0.9;
        thumbBase.rotation.z = -cur.t[0] * 0.55;
      } else {
        const T = thumbBase.userData.rest;   // printed hand: swing the thumb across the palm
        thumbBase.rotation.set(T.x - cur.t[0] * 1.4, T.y - cur.t[0] * 0.9, T.z - cur.t[0] * (T.dz ?? 0.2));
      }
      t2.rotation.z = -cur.t[1];
      t3.rotation.z = -cur.t[2];
    },
    gripLocal,
  };
}

function createPrintedHand({ forearm = true } = {}) {
  const L = ARM.layout;
  const pla = new THREE.MeshPhysicalMaterial({ color: 0xeef1f4, roughness: 0.5, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  const plaDark = new THREE.MeshStandardMaterial({ color: 0x3b414a, roughness: 0.55, metalness: 0.15 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xeb6834, roughness: 0.35, emissive: 0xeb6834, emissiveIntensity: 0.6 });
  const part = (name, mat) => {
    const o = ARM.parts[name].clone();
    o.traverse((m) => { if (m.isMesh) { m.material = mat; m.castShadow = true; m.receiveShadow = true; } });
    return o;
  };
  const root = new THREE.Group();
  root.add(part('palm', pla));
  if (forearm && ARM.parts.forearm) {
    root.add(part('forearm', plaDark));
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.14, 40), plaDark);   // socket behind the printed wrist unit
    sock.rotation.z = Math.PI / 2; sock.position.x = -0.19; sock.castShadow = true; root.add(sock);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0028, 8, 48), accent);
    ring.rotation.y = Math.PI / 2; ring.position.x = -0.03; root.add(ring);
  }
  const fingers = ['index', 'middle', 'ring', 'pinky'].map((f) => {
    const F = L.fingers[f], seg = F.segments;
    const j1 = new THREE.Group(); j1.position.fromArray(F.base); root.add(j1); j1.add(part(`${f}_1`, pla));
    const j2 = new THREE.Group(); j2.position.x = seg[0]; j1.add(j2); j2.add(part(`${f}_2`, pla));
    const j3 = new THREE.Group(); j3.position.x = seg[1]; j2.add(j3); j3.add(part(`${f}_3`, pla));
    return [j1, j2, j3];
  });
  const thumbBase = new THREE.Group(); thumbBase.position.fromArray(L.thumb.base); root.add(thumbBase);
  thumbBase.rotation.order = 'YZX';
  thumbBase.userData.rest = { x: 0.2, y: 1.05, z: -0.3 };   // pointing sideways (-z), forward and a little to the palm
  thumbBase.add(part('thumb_1', pla));
  const t2 = new THREE.Group(); t2.position.x = L.thumb.segments[0]; thumbBase.add(t2); t2.add(part('thumb_2', pla));
  const t3 = new THREE.Group(); t2.add(t3);   // printed thumb has two segments
  // grip points: middle of the closed fist, and between thumb tip and index tip
  return makeController(root, fingers, thumbBase, t2, t3, -1,
    (kind) => (kind === 'small' ? new THREE.Vector3(0.122, -0.022, -0.024) : new THREE.Vector3(0.105, -0.04, -0.004)));
}

// ------------------------------------------------------------------ bionic hand (default)
// Modern myoelectric hand look: white dorsal shells, graphite fingers, chrome hinges, slim forearm socket.
// Right hand: fingers +x, back of the hand +y, thumb on the -z side.
function taperBox(w, h, d, r, seg, taper) {
  // rounded box along +x from 0..w; height (y) and depth (z) shrink linearly to `taper` at the far end
  const g = new RoundedBoxGeometry(w, h, d, seg, r);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + w / 2, k = 1 - (1 - taper) * (x / w);
    p.setXYZ(i, x, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function createBionicHand({ forearm = true } = {}) {
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.32, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2a2e35, roughness: 0.45, metalness: 0.25, clearcoat: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.22, metalness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.9, metalness: 0.0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2a78d6, roughness: 0.3, emissive: 0x2a78d6, emissiveIntensity: 0.9 });
  const root = new THREE.Group();
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };

  // palm: graphite chassis + white dorsal shell, a little wider at the knuckles
  add(root, taperBox(0.09, 0.027, 0.066, 0.012, 6, 1.14), graphite, -0.002, -0.002, 0);
  add(root, taperBox(0.088, 0.02, 0.07, 0.0095, 6, 1.14), white, -0.001, 0.008, 0);
  add(root, new RoundedBoxGeometry(0.03, 0.003, 0.006, 2, 0.0015), accent, 0.03, 0.0175, 0);   // status light
  // thenar housing (thumb motor) on the palm side
  const thenar = add(root, new THREE.SphereGeometry(0.019, 24, 16), white, 0.032, -0.011, -0.027);
  thenar.scale.set(1.35, 0.7, 0.8);
  // knuckle axle
  const axle = add(root, new THREE.CylinderGeometry(0.0085, 0.0085, 0.082, 24), chrome, 0.089, 0.0, 0);
  axle.rotation.x = Math.PI / 2;

  const FING = [
    { z: -0.027, len: [0.044, 0.027, 0.022], w: 0.0175 },
    { z: -0.009, len: [0.047, 0.029, 0.023], w: 0.0182 },
    { z: 0.009, len: [0.044, 0.027, 0.022], w: 0.0172 },
    { z: 0.026, len: [0.035, 0.021, 0.019], w: 0.0152 },
  ];
  function segment(parent, len, w, tip, cap) {
    const g = new THREE.Group(); parent.add(g);
    add(g, taperBox(len, w * 0.92, w, w * 0.42, 4, 0.9), graphite, 0, 0, 0);
    if (cap) add(g, taperBox(len * 0.72, w * 0.36, w * 0.94, w * 0.17, 3, 0.92), white, len * 0.12, w * 0.33, 0);
    const hinge = add(g, new THREE.CylinderGeometry(w * 0.36, w * 0.36, w * 1.06, 18), chrome, 0, 0, 0);
    hinge.rotation.x = Math.PI / 2;
    if (tip) { const pad = add(g, new THREE.SphereGeometry(w * 0.5, 18, 12), rubber, len - w * 0.28, -w * 0.12, 0); pad.scale.set(0.9, 0.75, 0.95); }
    return g;
  }
  const fingers = FING.map((f) => {
    const j1 = segment(root, f.len[0], f.w, false, true); j1.position.set(0.089, 0, f.z);
    const j2 = segment(j1, f.len[1], f.w * 0.93, false, true); j2.position.x = f.len[0];
    const j3 = segment(j2, f.len[2], f.w * 0.86, true, false); j3.position.x = f.len[1];
    return [j1, j2, j3];
  });
  const thumbBase = new THREE.Group(); thumbBase.position.set(0.026, -0.012, -0.036); root.add(thumbBase);
  thumbBase.rotation.order = 'YZX';
  thumbBase.userData.rest = { x: 0.35, y: 0.95, z: -0.1, dz: 0.05 };
  const t1 = segment(thumbBase, 0.038, 0.02, false, true);
  const t2 = segment(t1, 0.03, 0.019, false, true); t2.position.x = 0.038;
  const t3 = segment(t2, 0.024, 0.017, true, false); t3.position.x = 0.03;

  if (forearm) {
    const ring = add(root, new THREE.CylinderGeometry(0.031, 0.031, 0.014, 40), chrome, -0.012, 0, 0); ring.rotation.z = Math.PI / 2;
    const sock = add(root, new THREE.CylinderGeometry(0.033, 0.041, 0.2, 48, 1, false), white, -0.12, 0, 0); sock.rotation.z = Math.PI / 2;
    const band = add(root, new THREE.CylinderGeometry(0.0345, 0.0355, 0.03, 48), graphite, -0.05, 0, 0); band.rotation.z = Math.PI / 2;
    const led = add(root, new THREE.TorusGeometry(0.0352, 0.0018, 8, 64), accent, -0.067, 0, 0); led.rotation.y = Math.PI / 2;
    const stripe = add(root, new RoundedBoxGeometry(0.15, 0.006, 0.02, 2, 0.003), graphite, -0.14, 0.036, 0); stripe.rotation.z = -0.04;
  }
  const c = makeController(root, fingers, thumbBase, t2, t3, -1,
    (kind) => (kind === 'small' ? new THREE.Vector3(0.128, -0.022, -0.026) : new THREE.Vector3(0.108, -0.042, -0.004)));
  c.joints = { fingers, thumb: [thumbBase, t2, t3], lens: FING.map((f) => f.len), thumbLens: [0.038, 0.03, 0.024] };
  // world positions of the finger tips (for holding objects exactly between the fingers)
  c.tips = () => {
    const tip = (seg, len) => seg.localToWorld(new THREE.Vector3(len * 0.8, 0, 0));
    root.updateMatrixWorld(true);
    return {
      thumb: tip(t3, 0.024), index: tip(fingers[0][2], FING[0].len[2]), middle: tip(fingers[1][2], FING[1].len[2]),
      indexSide: fingers[0][1].localToWorld(new THREE.Vector3(FING[0].len[1] * 0.5, 0, 0)),
      palm: root.localToWorld(new THREE.Vector3(0.06, -0.03, 0)),
      fist: root.localToWorld(new THREE.Vector3(0.1, -0.035, 0)),
      // palm centre (between the knuckles and the wrist) and the direction the palm faces
      palmMid: root.localToWorld(new THREE.Vector3(0.07, -0.015, 0)),
      palmOut: root.localToWorld(new THREE.Vector3(0, -1, 0)).sub(root.localToWorld(new THREE.Vector3(0, 0, 0))).normalize(),
      q: root.getWorldQuaternion(new THREE.Quaternion()),
    };
  };
  return c;
}

// ------------------------------------------------------------------ full mirroring from camera landmarks
// Every bone of the virtual hand points the same way as the matching bone of your real hand
// (MediaPipe 3D world landmarks, metres). Works in the parent's local frame, so it also works
// when the hand is mirrored (scale -1) or the whole arm is moving.
const FINGER_LM = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const THUMB_LM = [1, 2, 3, 4];
const X = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

// world landmark (MediaPipe: x right, y down, z away from camera) -> three.js, seen like a mirror
// MediaPipe world landmarks -> scene: your right is screen right, up is up (checked on the real webcam:
// with this mapping a right hand gives a right-hand shape)
export function lmToThree(w, i, out = new THREE.Vector3()) { return out.set(-w[i][0], -w[i][1], -w[i][2]); }

function aimBone(bone, dirWorld, k) {
  // rotate `bone` (+x along the bone) so that it points along dirWorld, smoothly (k = 0..1)
  const parent = bone.parent; parent.updateMatrixWorld(true);
  const o = parent.getWorldPosition(_a.set(0, 0, 0));
  _b.copy(o).add(dirWorld); parent.worldToLocal(_b); parent.worldToLocal(o);
  const local = _b.sub(o).normalize();
  // the bone's own offset rotation is relative to its parent: aim from +x
  _q.setFromUnitVectors(X, local);
  bone.quaternion.slerp(_q, k);
  bone.updateMatrixWorld(true);
}

export function mirrorFingers(hand, w, k = 0.6, rot = null) {
  if (!hand.joints || !w) return;
  // rot: turns your hand's frame onto the virtual arm's frame (when the arm follows only part of your wrist turn)
  const P = (i) => (rot ? lmToThree(w, i).applyQuaternion(rot) : lmToThree(w, i));
  hand.joints.fingers.forEach((segs, f) => {
    const L = FINGER_LM[f];
    for (let j = 0; j < 3; j++) aimBone(segs[j], P(L[j + 1]).sub(P(L[j])), k);
  });
  const [tb, t2, t3] = hand.joints.thumb;
  aimBone(tb, P(THUMB_LM[1]).sub(P(THUMB_LM[0])), k);
  aimBone(t2, P(THUMB_LM[2]).sub(P(THUMB_LM[1])), k);
  aimBone(t3, P(THUMB_LM[3]).sub(P(THUMB_LM[2])), k);
}

// orientation of the whole hand: x = fingers (wrist -> middle knuckle), z = index side, y = back of the hand
export function handBasis(w, right = true) {
  // x = towards the fingers, z = towards the pinky for a right hand (model thumb side is -z),
  // towards the index for a left hand (the left arm is the right model mirrored in z)
  const P = (i) => lmToThree(w, i);
  const x = P(9).sub(P(0)).normalize();
  const z = right ? P(17).sub(P(5)) : P(5).sub(P(17)); z.sub(x.clone().multiplyScalar(z.dot(x))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
