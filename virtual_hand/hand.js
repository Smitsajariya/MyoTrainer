// Virtual prosthetic hand on a scanned residual limb, driven by the real-time server (ws://localhost:8765).
// Sensors: webcam hand tracking (camera.js) and/or the EMG+FMG band. Game: game.js.
// Without a server the page runs as an offline demo: keys 1-4 set the pose.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Camera } from './camera.js?v=1794717000';
import { Game } from './game.js?v=1794717000';
import { TowerGame } from './game_tower.js?v=1794717000';
import { MatchGame } from './game_match.js?v=1794717000';
import { createHand as createBionicHand, mirrorFingers, handBasis, lmToThree } from './game/handmodel.js?v=1794717000';
import { GestureAI, vec } from './game/gesture_ai.js?v=1794717000';
import { detectGrip, palmFacing, GripFilter, HandSmoother, GRIPS, GRIP_TO_BAND } from './game/grips.js?v=1794717000';

const GESTURES = ['rest', 'open', 'close', 'pinch'];
const view = document.getElementById('view');
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.domElement.id = 'gl';
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
view.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef0f3);
const camera3d = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
camera3d.position.set(0.105, 0.22, 0.66);   // centred on the middle of the table: left and right hand get the same space
const controls = new OrbitControls(camera3d, renderer.domElement);
controls.target.set(0.105, -0.02, 0);
controls.enableDamping = true;
controls.enableRotate = false; controls.enablePan = false; controls.enableZoom = false;   // fixed view: the table never tilts by a stray mouse drag

scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c0c8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.4, 0.8, 0.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
// a table under the hand: gives depth (you see where the objects and the basket are)
const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.62), new THREE.MeshStandardMaterial({ color: 0xe3d3b8, roughness: 0.85 }));
table.position.set(0.05, -0.1, -0.02); table.receiveShadow = true; scene.add(table);
const edge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9b493, roughness: 0.8 }));
edge.position.set(0.05, -0.105, 0.29); scene.add(edge);

// ------------------------------------------------------------------ residual limb (scan) + socket + band
const arm = new THREE.Group();          // stump + socket + band + hand: moves as one when your hand moves
scene.add(arm);
const limb = new THREE.Group();
arm.add(limb);
new GLTFLoader().load('./assets/stump.glb', (g) => {
  g.scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.computeVertexNormals();
      o.material = new THREE.MeshStandardMaterial({ color: 0xdcb79c, roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide });
      o.castShadow = true;
    }
  });
  limb.add(g.scene);
}, undefined, () => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.15, 32), new THREE.MeshStandardMaterial({ color: 0xdcb79c, roughness: 0.75 }));
  m.rotation.z = Math.PI / 2; m.position.x = -0.075; limb.add(m);
});
const carbon = new THREE.MeshPhysicalMaterial({ color: 0x2a2e35, roughness: 0.4, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.05, 0.085, 40, 1, true), carbon);
socket.rotation.z = Math.PI / 2; socket.position.x = -0.012; socket.castShadow = true; arm.add(socket);
const wristCap = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.047, 0.03, 40), carbon);
wristCap.rotation.z = Math.PI / 2; wristCap.position.x = 0.044; arm.add(wristCap);

const band = new THREE.Group(); band.position.x = -0.1; arm.add(band);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.007, 10, 48), new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.8 }));
ring.rotation.y = Math.PI / 2; band.add(ring);
const fsrMeshes = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.012),
    new THREE.MeshStandardMaterial({ color: 0xeb6834, emissive: 0xeb6834, emissiveIntensity: 0 }));
  s.position.set(0, Math.cos(a) * 0.052, Math.sin(a) * 0.052); s.lookAt(0, 0, 0);
  band.add(s); fsrMeshes.push(s);
}

// ------------------------------------------------------------------ articulated hand
const metal = new THREE.MeshStandardMaterial({ color: 0x8b97a6, roughness: 0.35, metalness: 0.65 });
const metal2 = new THREE.MeshStandardMaterial({ color: 0x5f6b7a, roughness: 0.4, metalness: 0.6 });
const hand = new THREE.Group(); hand.position.x = 0.06; arm.add(hand);
const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.026, 0.078, 2, 2, 2), metal);
palm.position.x = 0.0425; palm.castShadow = true; hand.add(palm);

function phalanx(len, r) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 6, 14), metal);
  m.rotation.z = Math.PI / 2; m.position.x = len / 2; m.castShadow = true; g.add(m);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 14, 10), metal2));
  return g;
}
const FINGERS = [
  { z: 0.027, len: [0.042, 0.025, 0.02], r: 0.0085 },
  { z: 0.009, len: [0.046, 0.028, 0.021], r: 0.0088 },
  { z: -0.009, len: [0.043, 0.026, 0.02], r: 0.0084 },
  { z: -0.026, len: [0.034, 0.02, 0.017], r: 0.0074 },
];
const fingerJoints = [];
for (const f of FINGERS) {
  const j1 = phalanx(f.len[0], f.r); j1.position.set(0.085, 0, f.z); hand.add(j1);
  const j2 = phalanx(f.len[1], f.r * 0.95); j2.position.x = f.len[0]; j1.add(j2);
  const j3 = phalanx(f.len[2], f.r * 0.9); j3.position.x = f.len[1]; j2.add(j3);
  fingerJoints.push([j1, j2, j3]);
}
const thumbBase = new THREE.Group(); thumbBase.position.set(0.018, -0.004, 0.04); thumbBase.rotation.y = -0.75; hand.add(thumbBase);
const t1 = phalanx(0.036, 0.0095); thumbBase.add(t1);
const t2 = phalanx(0.028, 0.009); t2.position.x = 0.036; t1.add(t2);
const t3 = phalanx(0.022, 0.0085); t3.position.x = 0.028; t2.add(t3);

const POSES = {
  rest:  { f: [[0.35, 0.45, 0.3], [0.4, 0.5, 0.3], [0.45, 0.55, 0.35], [0.5, 0.6, 0.35]], t: [0.25, 0.2, 0.15], spread: 0.03 },
  open:  { f: [[0.0, 0.05, 0.0], [0.0, 0.05, 0.0], [0.0, 0.05, 0.0], [0.0, 0.05, 0.0]], t: [-0.15, 0.0, 0.0], spread: 0.12 },
  close: { f: [[1.45, 1.7, 1.05], [1.5, 1.75, 1.05], [1.5, 1.75, 1.05], [1.45, 1.7, 1.0]], t: [0.95, 0.55, 0.6], spread: 0.0 },
  pinch: { f: [[0.75, 0.85, 0.55], [1.2, 1.4, 0.9], [1.3, 1.5, 0.95], [1.3, 1.5, 0.95]], t: [0.8, 0.35, 0.35], spread: 0.0 },
};
const cur = JSON.parse(JSON.stringify(POSES.rest));
let target = POSES.rest;

function poseFromCurls(c) {   // camera curls [thumb, index, middle, ring, little] -> joint targets
  return {
    f: [1, 2, 3, 4].map((i) => [c[i] * 1.5, c[i] * 1.75, c[i] * 1.05]),
    t: [c[0] * 1.0, c[0] * 0.6, c[0] * 0.6],
    spread: 0.12 * (1 - Math.max(c[1], c[4])),
  };
}

function applyPose(dt) {
  const k = 1 - Math.exp(-dt * 14);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      cur.f[i][j] += (target.f[i][j] - cur.f[i][j]) * k;
      fingerJoints[i][j].rotation.z = -cur.f[i][j];
    }
    fingerJoints[i][0].rotation.y = (i - 1.5) * -cur.spread;
  }
  for (let j = 0; j < 3; j++) cur.t[j] += (target.t[j] - cur.t[j]) * k;
  cur.spread += (target.spread - cur.spread) * k;
  thumbBase.rotation.y = -0.75 + cur.t[0] * 0.9;
  thumbBase.rotation.z = -cur.t[0] * 0.55;
  t2.rotation.z = -cur.t[1];
  t3.rotation.z = -cur.t[2];
}

// the same bionic hand as in the games (the simple hand above is kept only as the joint reference)
const bh = createBionicHand({ forearm: false });
hand.add(bh.root);
palm.visible = false; fingerJoints.forEach((f) => { f[0].visible = false; }); thumbBase.visible = false;

// ------------------------------------------------------------------ copy my whole hand (camera)
// position (left-right, up-down, near-far) + orientation of the hand + every finger joint, like a mirror.
const PALM = new THREE.Vector3(0.105, 0, 0);       // palm centre in arm coordinates
// Relative copying: when you start, your hand's pose is taken as "neutral" = the arm as you see it.
// Afterwards the arm turns as much as your wrist turns (max 65 degrees) and moves as much as your hand
// moves (a few cm, no depth jumps), while every finger copies your fingers exactly.
const armTarget = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), rot: new THREE.Quaternion(), on: false, w: null };
let neutral = null;
// which of your hands the camera sees (MediaPipe handedness label; checked on the real webcam:
// 'Right' = your right hand with the un-mirrored camera picture we give it).
let side = 'right', sideCand = 'right', sideN = 0, sideSeen = 0;
// The SHAPE of the virtual hand follows from which hand it is (checked on the real webcam: the camera's
// 3D points of your right hand need the mirrored model). Fixed per hand, so it can never flip while you play.
const shapeOf = (sd) => (sd === 'right' ? 'left' : 'right');
function armScale() {      // which side it comes from (your arm) + right/left hand shape
  const sx = side === 'right' ? -1 : 1;
  arm.scale.set(sx, 1, shapeOf(side) === 'right' ? sx : -sx);
}
function updateSide(label) {
  if (!label) return;
  const s = label === 'Left' ? 'left' : 'right';
  if (s === sideCand) sideN += 1; else { sideCand = s; sideN = 1; }
  if (sideN >= 6 && s !== side) { side = s; neutral = null; }   // switched hands: new neutral pose
}
const MAX_TURN = THREE.MathUtils.degToRad(45);      // total wrist turn (a natural, comfortable range)
// UP / DOWN LIMITS (change here): hand height range and forearm tilt (with the band), fingers never go into the table
const HAND_UP = 0.06, HAND_DOWN = -0.08;              // metres from the start position
const TILT_UP = THREE.MathUtils.degToRad(35), TILT_DOWN = THREE.MathUtils.degToRad(8);
const TABLE_TOP = -0.09, FINGER_R = 0.008;            // table surface and finger thickness
const HAND_TILT_UP = THREE.MathUtils.degToRad(40), HAND_TILT_DOWN = THREE.MathUtils.degToRad(18);   // going down = the whole hand goes down, the wrist bends little   // whole hand (forearm + wrist)
const ELBOW_X = -0.2;                                  // the forearm turns about the elbow end (not the wrist)
const armBase = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3();
// points of the hand and the wrist (hand coordinates) that must stay above the table
const HAND_LOW = [[0, -0.03, 0], [0.085, -0.02, 0.035], [0.085, -0.02, -0.035], [0.04, -0.02, 0.035], [0.04, -0.02, -0.035]];
const ARM_LOW = [[0.044, -0.047, 0], [-0.012, -0.05, 0]];
const MAX_ROLL = THREE.MathUtils.degToRad(25);      // palm roll: more would show the hand edge-on
const MAX_FOREARM = THREE.MathUtils.degToRad(12);   // the forearm only follows a little; the wrist does the rest
const _zAxis = new THREE.Vector3(0, 0, 1);
const _qF = new THREE.Quaternion(), _qW = new THREE.Quaternion(), _mS = new THREE.Matrix4(), _mR = new THREE.Matrix4();
// The left arm comes in from the left of the screen, the right arm from the right (mirror image of the left
// scene), so the virtual arm is the same arm as yours. Right arm = right-hand model turned 180 deg about the
// vertical axis and shifted so the palm stays at the same spot.
const TURN_RIGHT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const RIGHT_SHIFT = 2 * 0.105;
function setNeutral() { neutral = null; }
function applyMirror(d) {
  if (!d || !d.w) return;
  const qAbs = handBasis(d.w, shapeOf(side) === 'right');
  if (!neutral) neutral = { q: qAbs.clone(), x: d.pos.x, y: d.pos.y };
  // forearm direction on the screen from the blue band (band -> wrist); its change since neutral tilts the virtual forearm
  if (d.band && d.wrist) {
    const fa = Math.atan2(-(d.wrist.y - d.band.y) * (d.aspect || 0.75), d.wrist.x - d.band.x);
    if (neutral.fa == null) neutral.fa = fa;
    let da = fa - neutral.fa; da = Math.atan2(Math.sin(da), Math.cos(da));
    armTarget.fore = side === 'right' ? THREE.MathUtils.clamp(da, -TILT_UP, TILT_DOWN) : THREE.MathUtils.clamp(da, -TILT_DOWN, TILT_UP); armTarget.foreSeen = performance.now();
  }
  // turn since neutral, limited like a real wrist
  const qRel = qAbs.clone().multiply(neutral.q.clone().invert());
  const ang = 2 * Math.acos(Math.min(1, Math.abs(qRel.w)));
  if (ang > MAX_TURN) qRel.slerp(new THREE.Quaternion(), 1 - MAX_TURN / ang);
  // roll about the forearm (x axis) limited to MAX_ROLL so the fingers always stay in view
  const tw = new THREE.Quaternion(qRel.x, 0, 0, qRel.w).normalize();
  const roll = 2 * Math.atan2(tw.x, tw.w);
  if (Math.abs(roll) > MAX_ROLL) {
    const sw = qRel.clone().multiply(tw.clone().invert());
    qRel.copy(sw.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sign(roll) * MAX_ROLL)));
  }
  // up/down of the whole hand (forearm + wrist together) limited: HAND_TILT_DOWN .. HAND_TILT_UP
  const fwd = new THREE.Vector3(side === 'right' ? -1 : 1, 0, 0).applyQuaternion(qRel);
  const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)), pc = THREE.MathUtils.clamp(pitch, -HAND_TILT_DOWN, HAND_TILT_UP);
  if (pc !== pitch) {
    const ax = fwd.clone().cross(new THREE.Vector3(0, 1, 0));
    if (ax.lengthSq() > 1e-6) qRel.premultiply(new THREE.Quaternion().setFromAxisAngle(ax.normalize(), pc - pitch));
  }
  armTarget.q.copy(qRel);
  const R = side === 'right';
  armTarget.rot.copy(qRel);                                          // your hand frame -> virtual arm frame
  if (R) armTarget.rot.multiply(TURN_RIGHT);
  armTarget.rot.multiply(qAbs.clone().invert());
  // left/right and up/down: with a movement calibration YOUR range (left..right, low..high) fills the whole
  // virtual range; without it the change since the start position is scaled
  const MR = moveRange[side], XLO = R ? -0.30 : -0.12, XHI = R ? 0.12 : 0.30, C = THREE.MathUtils.clamp;
  const X = (R ? RIGHT_SHIFT : 0) + (MR ? XLO + C((d.pos.x - MR.x0) / (MR.x1 - MR.x0), 0, 1) * (XHI - XLO) : C((d.pos.x - neutral.x) * 0.75, XLO, XHI));
  const Y = MR ? HAND_DOWN + C((MR.y1 - d.pos.y) / (MR.y1 - MR.y0), 0, 1) * (HAND_UP - HAND_DOWN) : C((neutral.y - d.pos.y) * 0.45, HAND_DOWN, HAND_UP);
  if (moveCal) moveCalStep(d);
  // the tower lifts the arm: then your own up movement is small, so the hand stays on the screen
  const lift = current.armLift();
  armTarget.pos.set(X, lift + (lift > 0 ? Math.min(Y, 0.03) : Y), 0);
  armTarget.on = true; armTarget.w = d.w; armTarget.seen = performance.now();
}
function updateArm(dt) {
  // keep the last pose through short tracking gaps (1.5 s) instead of snapping back
  // while the hand is out of view the arm stays where it was (the object stays in the hand)
  const on = $('mirror').checked && armTarget.on && (handLost || performance.now() - (armTarget.seen || 0) < 1500);
  const k = 1 - Math.exp(-dt * 10);
  if (on) {
    armScale();
    if (!arm.userData.mirrored) armBase.copy(arm.position);
    armBase.lerp(armTarget.pos, k);
    // split the turn: a little for the forearm, the rest at the wrist (hand group pivots at the wrist)
    const ang = 2 * Math.acos(Math.min(1, Math.abs(armTarget.q.w)));
    if (performance.now() - (armTarget.foreSeen || 0) < 500) _qF.setFromAxisAngle(_zAxis, armTarget.fore);   // band seen: real forearm tilt
    else _qF.identity().slerp(armTarget.q, ang > 1e-4 ? Math.min(1, MAX_FOREARM / ang) : 1);
    arm.quaternion.slerp(_qF, k);
    // the elbow end stays where it is, the hand end moves up/down (like a real forearm)
    _e.set(ELBOW_X * arm.scale.x, 0, 0);
    arm.position.copy(armBase).add(_e).sub(_e.clone().applyQuaternion(arm.quaternion));
    // wrist rotation in arm coordinates (arm is scaled by +-1 per axis): S * (Rforearm^-1 * Rtotal) * S
    _qW.copy(arm.quaternion).invert().multiply(armTarget.q);
    _mS.makeScale(arm.scale.x, arm.scale.y, arm.scale.z);
    _mR.makeRotationFromQuaternion(_qW).premultiply(_mS).multiply(_mS);
    hand.quaternion.setFromRotationMatrix(_mR);
    arm.updateMatrixWorld(true);
    mirrorFingers(bh, armTarget.w, Math.min(1, k * 1.5), armTarget.rot);
    // floor: if a finger tip, the palm or the fist is below the table top, lift the whole arm by that much
    const T = bh.tips();
    let low = Math.min(T.thumb.y, T.index.y, T.middle.y, T.palm.y, T.fist.y, T.palmMid.y);
    HAND_LOW.forEach(([x, y, z]) => { low = Math.min(low, hand.localToWorld(_p.set(x, y, z)).y); });
    ARM_LOW.forEach(([x, y, z]) => { low = Math.min(low, arm.localToWorld(_p.set(x, y, z)).y); });
    if (low < TABLE_TOP + FINGER_R) { arm.position.y += TABLE_TOP + FINGER_R - low; arm.updateMatrixWorld(true); }
    arm.userData.mirrored = true;
  } else {
    if (arm.userData.mirrored) {   // back from copying: clear the copied joint rotations, the gesture poses take over
      arm.userData.mirrored = false; neutral = null;
      bh.joints.fingers.flat().forEach((j) => j.rotation.set(0, 0, 0));
      bh.joints.thumb.forEach((j) => j.rotation.set(0, 0, 0));
    }
    // grip-only mode: same arm as yours (right arm from the right, left arm from the left), fixed pose
    const camHand = performance.now() - sideSeen < 3000;
    if (!camHand) arm.scale.set(1, 1, 1);
    else armScale();
    arm.position.lerp(new THREE.Vector3(camHand && side === 'right' ? RIGHT_SHIFT : 0, current.armLift(), 0), k);
    arm.quaternion.slerp(new THREE.Quaternion(), k);
    hand.quaternion.slerp(new THREE.Quaternion(), k);
    bh.update(dt);
  }
}
$('bNeutral').onclick = setNeutral;
// MOVEMENT CALIBRATION: 10 s, move your hand as far left, right, up and down as is comfortable. This range is
// saved per hand (left / right) and mapped to the whole virtual table, so every patient can reach everything.
const moveRange = (() => { try { return JSON.parse(localStorage.getItem('lab_move_range_v1')) || {}; } catch { return {}; } })();
let moveCal = null;
function moveMsg(t) { $('moveMsg').textContent = t || ''; }
function moveCalStep(d) {
  const c = moveCal, now = performance.now(), left = Math.max(0, 10 - (now - c.t0) / 1000);
  c.x0 = Math.min(c.x0, d.pos.x); c.x1 = Math.max(c.x1, d.pos.x); c.y0 = Math.min(c.y0, d.pos.y); c.y1 = Math.max(c.y1, d.pos.y);
  moveMsg(`↔ ↕ move your ${side} hand far LEFT, RIGHT, UP, DOWN · ${left.toFixed(0)} s`);
  if (left > 0) return;
  moveCal = null;
  if (c.x1 - c.x0 < 0.12 || c.y1 - c.y0 < 0.08) { moveMsg('range too small: press again and move further'); return; }
  moveRange[side] = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 };
  try { localStorage.setItem('lab_move_range_v1', JSON.stringify(moveRange)); } catch { /* private window */ }
  send({ cmd: 'move_range', side, ...moveRange[side] });
  moveMsg(`✔ ${side} hand range saved (${Math.round((c.x1 - c.x0) * 100)}% × ${Math.round((c.y1 - c.y0) * 100)}% of the image)`);
}
$('bMoveCal').onclick = () => {
  if (!camData) { moveMsg('start the camera and show your hand first'); return; }
  moveCal = { t0: performance.now(), x0: 1, x1: 0, y0: 1, y1: 0 };
};
$('bMoveClear').onclick = () => { delete moveRange[side]; try { localStorage.setItem('lab_move_range_v1', JSON.stringify(moveRange)); } catch { /* */ } moveMsg(`${side} hand range cleared`); };
// While an object is held, the hand takes a proper grasp around it (like a real prosthesis: closing the hand
// triggers the grip, the motors stop on the object). The wrist and arm still follow your hand.
function holdGrasp(dt) {
  const c = current.active && current.holdCurls ? current.holdCurls() : null;
  if (!c) return;
  if (window.__holdCurls) c.splice(0, 5, ...window.__holdCurls);       // test hook
  bh.joints.fingers.flat().forEach((j) => j.rotation.set(0, 0, 0));
  bh.joints.thumb.slice(1).forEach((j) => j.rotation.set(0, 0, 0));
  bh.curls(c); bh.update(dt);
}
// limit how far each finger joint bends while an object is held: the fingers wrap around it
const _ax = new THREE.Vector3();
function wrapAround(maxA) {
  if (!maxA) return;                                // maxA: how far each joint may bend (set by the game per object)
  const lim = (j, m) => {
    const q = j.quaternion, a = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (a > m) q.slerp(_qF.identity(), 1 - m / a);
  };
  bh.joints.fingers.forEach((f) => f.forEach((j) => lim(j, maxA)));
  bh.joints.thumb.slice(1).forEach((j) => lim(j, maxA));
}

// ------------------------------------------------------------------ record + replay the camera movement
let motRec = null, motData = null, motPlay = null;
$('bMotRec').onclick = () => {
  if (motRec) {   // stop
    motData = motRec; motRec = null;
    $('bMotRec').textContent = '● Record my movement'; $('bMotPlay').disabled = $('bMotSave').disabled = !motData.frames.length;
    $('motInfo').textContent = `recorded ${motData.frames.length} frames, ${(motData.frames.length ? motData.frames[motData.frames.length - 1].t / 1000 : 0).toFixed(1)} s`;
    send({ cmd: 'motion', meta: { frames: motData.frames.length, started: motData.started }, frames: motData.frames });
    return;
  }
  if (!cam.running) { $('motInfo').textContent = 'start the camera first'; return; }
  motRec = { started: new Date().toISOString(), t0: performance.now(), frames: [] };
  $('bMotRec').textContent = '■ Stop recording'; $('motInfo').textContent = 'recording... move your hand';
};
$('bMotPlay').onclick = () => {
  if (!motData || !motData.frames.length) return;
  motPlay = { t0: performance.now(), i: 0 }; $('motInfo').textContent = 'replaying...';
};
$('bMotSave').onclick = () => {
  const blob = new Blob([JSON.stringify(motData)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `hand_motion_${motData.started.replace(/[:.]/g, '-')}.json`; a.click();
};
function replayStep() {
  if (!motPlay) return;
  const t = performance.now() - motPlay.t0, F = motData.frames;
  while (motPlay.i < F.length - 1 && F[motPlay.i + 1].t <= t) motPlay.i += 1;
  const fr = F[motPlay.i];
  camData = { ...fr, g: fr.g || 'rest' }; camSeen = performance.now();
  applyMirror(camData);
  if (motPlay.i >= F.length - 1) { motPlay = null; $('motInfo').textContent = 'replay finished'; }
}

// ------------------------------------------------------------------ UI scaffolding
for (const g of GESTURES) {
  $('probs').insertAdjacentHTML('beforeend',
    `<div class="bar"><span>${g}</span><div class="track"><div class="fill" id="p_${g}" style="background:var(--accent)"></div></div><span class="num" id="pn_${g}">-</span></div>`);
}
for (let i = 0; i < 16; i++) $('fmg').insertAdjacentHTML('beforeend', `<div id="f${i}" title="FSR ${i}"></div>`);
['thumb', 'index', 'middle', 'ring', 'little'].forEach((n, i) => {
  $('camCurls').insertAdjacentHTML('beforeend',
    `<div class="bar"><span>${n}</span><div class="track"><div class="fill" id="c${i}" style="background:var(--ok)"></div></div><span class="num" id="c${i}n">-</span></div>`);
});

let decoded = 'rest';
let handLost = false;            // camera running but no hand in view          // movement used by the hand and the game
let online = false, haveModel = false, source = '';
let camData = null, camSeen = 0, camLostSent = false;
// camera gesture = personal AI from the game's 20 s calibration (same browser storage), else the rule teacher;
// smoothed + debounced (a new gesture must win 3 frames in a row)
const camAI = new GestureAI();
let camFs = null, camCand = 'rest', camCandN = 0, camState = 'rest';
const smoother = new HandSmoother();          // One Euro filter: no shaking
const gripF = new GripFilter(5);              // a new grip must win 5 frames in a row (less flicker)
let camGrip = 'rest';
function camGesture(d) {
  const x = vec(d);
  if (!camFs) camFs = x.slice(); else for (let i = 0; i < x.length; i++) camFs[i] += (x[i] - camFs[i]) * 0.5;
  const g = camAI.ready ? camAI.predict(camFs).g : d.g;
  if (g === camCand) camCandN += 1; else { camCand = g; camCandN = 1; }
  if (camCandN >= 3) camState = g;
  return camState;
}

const BAND_TO_GRIP = { close: 'power', pinch: 'pinch', open: 'open', rest: 'rest' };
function setDecoded(s) {
  if (!s) return;
  decoded = BAND_TO_GRIP[s] || s;                 // the game works with grips
  $('state').textContent = GRIPS[decoded] ? `${GRIPS[decoded].icon} ${GRIPS[decoded].label}` : s;
  const pose = GRIP_TO_BAND[decoded] || s;
  if (POSES[pose]) { target = POSES[pose]; bh.pose(pose); }
}

// ------------------------------------------------------------------ server link
let ws = null;
function connect() {
  try { ws = new WebSocket(`ws://${location.hostname || 'localhost'}:8765`); } catch (e) { return; }
  ws.onopen = () => { online = true; $('conn').classList.add('on'); $('conn').querySelector('span').textContent = 'connected'; };
  ws.onclose = () => {
    online = false; $('conn').classList.remove('on'); $('conn').querySelector('span').textContent = 'not connected';
    $('mode').textContent = 'offline demo: keys 1-4 move the hand';
    setTimeout(connect, 1500);
  };
  ws.onmessage = (ev) => onFrame(JSON.parse(ev.data));
}
connect();
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function onFrame(m) {
  if (m.type !== 'frame') return;
  source = m.source; haveModel = !!m.model;
  // with the camera running, the camera gesture (personal AI) decides; the server model decides for the band
  if (m.state && !(source === 'CameraSource' && cam.running)) setDecoded(m.state);
  for (const g of GESTURES) {
    const p = m.probs && m.probs[g] != null ? m.probs[g] : 0;
    $(`p_${g}`).style.width = `${(p * 100).toFixed(0)}%`;
    $(`pn_${g}`).textContent = m.probs && m.probs[g] != null ? `${(p * 100).toFixed(0)}%` : '-';
  }
  const band = source !== 'CameraSource';
  if (band && m.emg) m.emg.forEach((v, i) => { $(`e${i}`).style.width = `${Math.min(100, (v / 0.8) * 100)}%`; $(`e${i}n`).textContent = v.toFixed(2); });
  if (band && m.fmg) {
    const mx = Math.max(0.5, ...m.fmg);
    m.fmg.forEach((v, i) => { const a = Math.min(1, v / mx); $(`f${i}`).style.background = `rgba(235,104,52,${0.08 + 0.92 * a})`; fsrMeshes[i].material.emissiveIntensity = a * 0.9; });
  }
  const p = m.prompt;
  if (p) {
    $('prompt').style.display = 'block';
    $('pg').textContent = p.gesture;
    $('pph').textContent = `${p.phase === 'prepare' ? 'get ready' : 'HOLD'} · ${p.remaining.toFixed(1)} s · repetition ${p.rep}/${p.of}`;
    $('pbar').style.width = `${(p.step / p.steps) * 100}%`;
    if (m.source === 'SimSource') send({ cmd: 'intent', gesture: p.phase === 'hold' ? p.gesture : 'rest' });
  } else {
    $('prompt').style.display = 'none';
  }
  $('mode').textContent = `input: ${m.source.replace('Source', '')} · mode: ${m.mode}${m.model ? ' · model ' + m.model : ' · no model yet (press Calibrate)'}`;
  $('simBox').style.display = m.source === 'SimSource' ? '' : 'none';
  $('meta').innerHTML = `input: ${m.source}<br>processing: ${m.proc_ms} ms per decision<br>calibration windows: ${m.n_cal}` +
    (m.label_source ? `<br>labels from: ${m.label_source}` : '');
}

// ------------------------------------------------------------------ camera
function onCamFrame(d) {
  if (!d) {
    // keep the last gesture through short tracking drop-outs (450 ms)
    if (camSeen && performance.now() - camSeen > 450 && !camLostSent) { handLost = true; camData = null; smoother.reset(); $('camLabel').textContent = 'no hand visible'; send({ cmd: 'cam_lost' }); camLostSent = true; setDecoded('rest'); }
    return;
  }
  d = smoother.smooth(d);
  camData = d; handLost = false;
  camLostSent = false;
  camSeen = performance.now();
  camGesture(d);                                   // personal AI (4 band classes), kept for the band labels
  // seen from the side the fingers hide behind each other: keep the last grip (hysteresis 0.3 / 0.42)
  camGrip = d.w ? gripF.push(detectGrip(d.w).grip) : camState;
  const g = GRIP_TO_BAND[camGrip] || camState;     // band label from the camera grip (geometry, more reliable)
  $('camLabel').textContent = `${side === 'right' ? 'Right' : 'Left'} hand · ${GRIPS[camGrip].icon} ${['open', 'rest'].includes(camGrip) ? (camGrip === 'open' ? 'open' : 'relaxed') : 'closed'}${d.band ? ' · 🟦 band' : ''}`;
  d.f.slice(0, 5).forEach((v, i) => { $(`c${i}`).style.width = `${(v * 100).toFixed(0)}%`; $(`c${i}n`).textContent = v.toFixed(2); });
  send({ cmd: 'cam', f: d.f, g });
  if (d && d.hand) { updateSide(d.hand); sideSeen = performance.now(); }
  if ($('mirror').checked) applyMirror(d);
  if (motRec) motRec.frames.push({ t: Math.round(performance.now() - motRec.t0), w: d.w, pos: d.pos, size: d.size, f: d.f, g });
  setDecoded(camGrip);   // camera running: the camera grip drives the hand and the game
  $('hHand').textContent = ['open', 'rest'].includes(camGrip) ? '🖐 Open' : '✊ Closed';
}
const cam = new Camera($('video'), $('camCanvas'), onCamFrame, (s) => { $('camStatus').textContent = s; });

$('bCam').onclick = async () => {
  if (cam.running) { cam.stop(); handLost = false; $('camBox').style.display = 'none'; $('bCam').textContent = 'Start camera'; return; }
  $('camBox').style.display = 'block';
  try { await cam.start(); $('bCam').textContent = 'Stop camera'; } catch (e) {
    $('camStatus').textContent = 'camera error: ' + (e && e.message ? e.message : e);
  }
};
$('mirror').onchange = () => { if (POSES[decoded]) { target = POSES[decoded]; bh.pose(decoded); } };
$('camTeach').onchange = () => send({ cmd: 'label_source', value: $('camTeach').checked ? 'camera' : 'prompts' });

// ------------------------------------------------------------------ training controls
$('bCal').onclick = () => send({ cmd: 'calibrate', reps: +$('reps').value, hold: +$('hold').value, tag: $('tag').value });
$('bRec').onclick = () => send({ cmd: 'record', reps: +$('reps').value, hold: +$('hold').value, tag: $('tag').value });
$('bStop').onclick = () => send({ cmd: 'stop' });
document.querySelectorAll('#simBox button').forEach((b) => {
  b.onclick = () => { send({ cmd: 'intent', gesture: b.dataset.g }); if (!online) setDecoded(b.dataset.g); };
});
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const g = GESTURES[+e.key - 1];
  if (!g) return;
  if (online && source === 'SimSource') send({ cmd: 'intent', gesture: g });
  else if (!online || !haveModel) setDecoded(g);
});

// ------------------------------------------------------------------ game
const ui = {
  banner: (title, sub, ok, near) => {
    const b = $('banner');
    if (!title) { b.style.display = 'none'; return; }
    b.style.display = $('prompt').style.display === 'block' ? 'none' : 'block';
    b.classList.toggle('ok', !!ok); b.classList.toggle('near', !!near);
    $('bg').textContent = title; $('bph').textContent = sub || '';
  },
  stats: (s) => {   // each game has its own column in the panel
    const g = s.game === 'tower' ? 't' : s.game === 'match' ? 'm' : 'f', sec = (v, d = 2) => (v != null ? `${v.toFixed(d)} s` : '-');
    $(`${g}_trials`).textContent = s.trials;
    $(`${g}_rate`).textContent = s.trials ? `${s.success}/${s.trials} (${Math.round(s.success_rate * 100)}%)` : '-';
    $(`${g}_grab`).textContent = sec(s.mean_grab_s); $(`${g}_rel`).textContent = sec(s.mean_release_s);
    $(`${g}_drop`).textContent = `${s.drops} / ${s.timeouts}`;
    if (g === 't') $('t_best').textContent = `${s.towers} / ${s.best_height}`;
    if (g === 'm') { $('m_wrong').textContent = `${s.wrong_colour} / ${s.wrong_shape} / ${s.wrong_combo || 0}`; $('m_lvl').textContent = `L${s.level} ${'⭐'.repeat(s.stars || 0)}`; $('m_dist').textContent = s.mean_dist_cm != null ? `${s.mean_dist_cm.toFixed(1)} cm` : '-'; }
    $('hTrial').textContent = s.trials; $('hOk').textContent = s.success;
    $('hGrab').textContent = sec(s.mean_grab_s, 1);
  },
  extra: (txt) => { $('hExtra').style.display = txt ? '' : 'none'; $('hExtra').textContent = txt || ''; },
  // big round card in the middle of the 3D view (round start)
  intro: (html) => { const e = $('roundIntro'); if (!html) { e.classList.remove('show'); return; } e.innerHTML = html; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); },
  // result screen at the end of a game
  end: (html) => { const e = $('endCard'); if (!html) { e.style.display = 'none'; return; } $('endBody').innerHTML = html; e.style.display = 'flex'; },
};
const gameOpts = { tips: () => bh.tips(), camera: () => camera3d, mirrored: () => $('mirror').checked && !!camData,
  // right arm comes in from the right: basket/tower and the objects on the LEFT of the hand (and the other way round)
  basketX: () => (armFromRight() ? -0.055 : 0.265), spawnX: () => (armFromRight() ? 0.08 : 0.13) };   // new objects come down from above the hand (not from the targets' side)
const game = new Game(scene, hand, ui, send, gameOpts);           // 🍎 fruit basket
const tower = new TowerGame(scene, hand, ui, send, gameOpts);     // 🧱 build a tower
const match = new MatchGame(scene, hand, ui, send, gameOpts);     // 🎯 match it (colour, then shape)
let current = game;
function armFromRight() { return side === 'right' && performance.now() - sideSeen < 3000; }
// PLAY MODE: full screen 3D view with a small score bar; the setup panel comes back when the game stops
function playMode(on) { $('app').classList.toggle('play', on); requestAnimationFrame(resize); }
setInterval(() => $('app').classList.toggle('arm-r', armFromRight()), 500);   // camera picture on the free side
function startGame(g) {
  if (current.active) current.stop(); current = g; ui.extra(null); ui.end(null);
  g.roundSel = $(g === tower ? 'rTower' : g === match ? 'rMatch' : 'rGame').value;   // which round(s) to play
  playMode(true); g.start();
}
$('bEndAgain').onclick = () => startGame(current);
$('bEndBack').onclick = () => { ui.end(null); if (current.active) current.stop(); playMode(false); };
$('bGame').onclick = () => startGame(game);
$('bTower').onclick = () => startGame(tower);
$('bMatch').onclick = () => startGame(match);
$('bGameStop').onclick = $('bGameStop2').onclick = () => { if (current.active) current.stop(); playMode(false); };

// ------------------------------------------------------------------ loop
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera3d.aspect = w / h; camera3d.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  replayStep(); applyPose(dt); updateArm(dt);
  holdGrasp(dt);
  current.update(handLost ? 'lost' : decoded);
  if (handLost && current.active) ui.banner('✋ Show your hand to the camera', 'the object stays in your hand until you see it again');
  controls.update();
  renderer.render(scene, camera3d);
});
window.__setPose = setDecoded;
window.__game = game;
window.__tower = tower;
window.__match = match;
window.__bh = bh;
window.__cam3d = { camera: camera3d, controls };
// test hook: feed one camera frame (used by tests/e2e_mirror.py)
window.__mirrorFrame = onCamFrame;   // runs the same pipeline as a real camera frame
