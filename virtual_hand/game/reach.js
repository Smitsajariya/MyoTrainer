// "Pick it up yourself" rounds: the object lies on the table, you move your hand to it, close the hand to grab it.
// Shared by all games. The object lies on the side away from the basket / tower / targets, within reach.
import * as THREE from 'three';

export const TABLE_Y = -0.09;
export const REACH_WINDOW = 15.0;   // s to reach the object and grab it
const PALM_X = 0.105;               // palm x of the virtual hand at the start position

// where the object lies: in front of the fingers, between the hand and the basket / tower / targets (never under
// the arm). The distance grows with every object (n = objects so far): first close, then further away.
export const REACH_TARGET_SHIFT = 0.12;
export const REACH_GAP = 0.14;     // the object lies at least this far before the basket / tower / first target
// hold the object still over the RIGHT place for DWELL_S seconds = it drops by itself (for patients who can not open)
export const DWELL_S = 2.0;   // in reach rounds the basket / tower / targets move this much further out
// palmX: where the palm is now; limitX: near edge of the basket / tower / first target (the object stays before it)
export function reachSpot(sideX, r, n = 0, palmX = PALM_X + (sideX > PALM_X ? 0.025 : -0.025), limitX = null) {
  const dir = sideX > PALM_X ? 1 : -1;
  const off = 0.06 + Math.min(1, n / 5) * 0.04 + Math.random() * 0.012;
  let x = palmX + dir * off;
  // far from the basket / tower / targets: the object lies at the limit (a little random), so you always carry it a long way
  if (limitX != null) x = limitX - dir * (r + 0.015 + Math.random() * 0.02);
  return new THREE.Vector3(x, TABLE_Y + r, 0);
}

// is the hand at the object? (left/right and up/down; the hand can not move in depth)
export function handAt(grip, obj, r) { return Math.hypot(grip.x - obj.x, grip.y - obj.y) < r * 0.5 + 0.02; }

// a ring around the object on the table: grey = go there, green = close your hand now
export class ReachMarker {
  constructor(parent) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x8a8f98, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 40), this.mat);
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; parent.add(this.ring);
  }
  show(pos, r, near) {
    this.ring.position.set(pos.x, TABLE_Y + 0.002, pos.z);
    const s = (r + 0.012) / 0.03 * (near ? 1.15 + 0.05 * Math.sin(performance.now() / 90) : 1);
    this.ring.scale.setScalar(s); this.mat.color.setHex(near ? 0x1baf7a : 0x8a8f98); this.ring.visible = true;
  }
  hide() { this.ring.visible = false; }
}

// which rounds a game plays: 'all' -> 1, 2, ...; a number -> only that round
export function roundList(sel, n) { return sel === 'all' || !sel ? Array.from({ length: n }, (_, i) => i + 1) : [Number(sel)]; }
