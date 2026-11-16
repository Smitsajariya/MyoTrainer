// Grab-and-release training game.
// An object arrives at the hand. Grab it with the right grip, hold it, then OPEN the hand over the basket.
// With the camera copying your hand, the object sits exactly between your virtual finger tips and you
// carry it to the basket yourself. Every trial is scored and logged.
import * as THREE from 'three';
import { GRIPS } from './game/grips.js?v=1794717000';
import { DropGuide } from './game/dropguide.js?v=1794717000';
import { sfx, audio } from './game/audio.js?v=1794717000';
import { reachSpot, handAt, ReachMarker, roundList, REACH_WINDOW, REACH_TARGET_SHIFT, REACH_GAP, DWELL_S } from './game/reach.js?v=1794717000';
const PER_ROUND = 6;   // fruits per round when all rounds are played
const ROUNDS = { 1: { title: 'Round 1 · it comes to your hand', icon: '🍎' }, 2: { title: 'Round 2 · pick it up yourself', icon: '🖐' } };
const snd = (k) => { try { sfx[k] && sfx[k](); } catch { /* no sound */ } };

const ITEMS = {
  apple:  { need: 'power', radius: 0.038, color: 0xd93a2b, label: 'Apple: close your hand around it ✊' },
  ball:   { need: 'power', radius: 0.045, color: 0x2a78d6, label: 'Ball: close your hand around it ✊' },
  banana: { need: 'power', radius: 0.02,  color: 0xf2c84b, label: 'Banana: close your hand around it ✊' },
};
// big objects: a full fist or fingers half closed around the object both count
const OK = { power: ['power', 'wrap'] };
const KINDS = Object.keys(ITEMS);
const HOLD_MS = 300;        // a grasp must be held this long to count
const GRAB_WINDOW = 6.0;    // s
const CARRY_TIME = 1.5;     // s the item must be held before release
const RELEASE_WINDOW = 10.0; // s (time to carry it to the basket and open)

export class Game {
  constructor(scene, hand, ui, send, opts = {}) {
    this.scene = scene; this.hand = hand; this.ui = ui; this.send = send;
    this.tips = opts.tips || null;            // () => world positions of the virtual finger tips
    this.mirrored = opts.mirrored || (() => false);
    const bx0 = opts.basketX || (() => 0.3);   // round 2: the basket stands further out (the fruit lies between)
    this.basketX = () => { const b = bx0(); return this.active && this.round === 2 ? b + Math.sign(b - 0.105) * REACH_TARGET_SHIFT : b; };
    this.spawnX = opts.spawnX || (() => 0.5);      // where the fruit comes from (the side away from the arm)   // left arm: basket right of the hand; right arm: left of it
    this.active = false; this.phase = 'idle'; this.stats = this.emptyStats();
    this.group = new THREE.Group(); scene.add(this.group);
    // basket under the hand
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.035, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xa0743f, roughness: 0.9, side: THREE.DoubleSide }));
    basket.position.set(0, -0.072, 0.03);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.045, 32), new THREE.MeshStandardMaterial({ color: 0x8a6232 }));
    bottom.rotation.x = -Math.PI / 2; bottom.position.set(0, -0.088, 0.03);
    this.basket = new THREE.Group(); this.basket.add(basket, bottom); this.basket.visible = false; this.basket.position.x = 0.3;
    this.group.add(this.basket);
    this.item = null; this.stateSince = performance.now(); this.lastState = 'rest';
    this.guide = new DropGuide(this.group);
    this.marker = new ReachMarker(this.group);
    this.roundSel = 'all';
  }

  armLift() { return 0; }
  // radius of the object in the hand (the virtual fingers wrap around it), 0 when nothing is held
  holdRadius() { return this.item && ['carry', 'release'].includes(this.phase) ? this.item.def.radius : 0; }
  holdCurls() { const r = this.holdRadius(); if (!r) return null; const k = THREE.MathUtils.clamp(0.72 - (r - 0.02) * 9, 0.48, 0.72); return [k + 0.1, k, k, k + 0.02, k + 0.04]; }
  holdWrap() { const r = this.holdRadius(); return r ? THREE.MathUtils.clamp(0.62 + (0.05 - r) * 11, 0.65, 0.95) : 0; }

  emptyStats() { return { trials: 0, success: 0, wrong: 0, drops: 0, timeouts: 0, grabTimes: [], releaseTimes: [] }; }

  start() {
    try { audio(); } catch { /* no sound */ }
    this.active = true; this.stats = this.emptyStats(); this.basket.visible = true;
    this.rounds = roundList(this.roundSel, 2); this.ri = 0; this.inRound = 0;
    this.send({ cmd: 'game', ev: 'start', rounds: this.rounds });
    this.introRound();
  }

  get round() { return this.rounds ? this.rounds[this.ri] : 1; }
  introRound() {
    const R = ROUNDS[this.round];
    this.ui.intro && this.ui.intro(`<div class="ri-icon">${R.icon}</div><div class="ri-t">${R.title}</div><div class="ri-s">${this.round === 2 ? 'the fruit lies on the table: move your hand to it, close, carry it to the basket' : 'the fruit comes to your hand: close, carry it to the basket'}</div>`);
    this.ui.extra && this.ui.extra(`🍎 Round ${this.round}${this.rounds.length > 1 ? `/${this.rounds.length}` : ''}`);
    this.ui.banner(null); this.phase = 'pause'; this.t0 = performance.now() + 1000; this.item = null;
  }

  stop() {
    this.marker.hide(); this.ui.intro && this.ui.intro(null); this.ui.extra && this.ui.extra(null);
    this.active = false; this.phase = 'idle'; this.basket.visible = false; this.guide.hide();
    if (this.item) { this.group.remove(this.item.mesh); this.item = null; }
    this.ui.banner(null);
    this.send({ cmd: 'game', ev: 'stop', ...this.summary() });
    this.ui.stats(this.summary());
  }

  gripPoint(kind) {
    const r = ITEMS[kind].radius;
    if (this.tips) {   // in front of the palm, as far out as the object is thick
      const t = this.tips();   // the object rests against the palm, the fingers close around it
      const palmSpot = t.palmMid.clone().add(t.palmOut.clone().multiplyScalar(r + 0.022));
      if (!['carry', 'release'].includes(this.phase)) return palmSpot;
      // held: between the thumb tip and the index/middle tips, never closer to the palm than its radius
      const c = t.thumb.clone().multiplyScalar(0.4).addScaledVector(t.index, 0.3).addScaledVector(t.middle, 0.3);
      const out = c.clone().sub(t.palmMid).dot(t.palmOut);
      if (out < r + 0.006) c.addScaledVector(t.palmOut, r + 0.006 - out);
      return c;
    }
    const x = this.hand.position.x;
    return new THREE.Vector3(x + 0.1, -0.035 - r * 0.6, 0.0);
  }

  // turn the object with the hand (the banana lies across the palm)
  orient(it) {
    if (!this.tips) return;
    const q = this.tips().q;
    if (!it.baseQ) it.baseQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.kind === 'banana' ? Math.PI / 2 : 0);
    it.mesh.quaternion.copy(q).multiply(it.baseQ);
  }

  makeMesh(kind) {
    const def = ITEMS[kind], m = (c, r = 0.4) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    let mesh;
    if (kind === 'banana') {
      // curved banana: a tube along an arc, thin at both ends
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.08, 0.02, 0), new THREE.Vector3(0, -0.025, 0), new THREE.Vector3(0.08, 0.02, 0));
      const g = new THREE.TubeGeometry(curve, 40, def.radius, 16, false);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {   // taper the ends
        const u = uv.getX(i), k = Math.sin(Math.PI * u) ** 0.5 * 0.85 + 0.15, c = curve.getPoint(u);
        p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
      }
      g.computeVertexNormals();
      mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(g, m(def.color, 0.55)));
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.014, 10), m(0x5b4a2a)); tip.position.set(0.084, 0.026, 0); tip.rotation.z = -0.9; mesh.add(tip);
    } else if (kind === 'ball') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 32, 24), m(def.color, 0.45));
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 1.002, 0.004, 8, 48), m(0xffffff, 0.5)); stripe.rotation.x = Math.PI / 2; mesh.add(stripe);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 32, 24), m(def.color, 0.35));
      mesh.scale.set(1, 0.92, 1);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.016), m(0x5b3a1e)); stem.position.y = def.radius; mesh.add(stem);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), m(0x3f8f3a)); leaf.scale.set(1.6, 0.3, 0.8); leaf.position.set(0.008, def.radius + 0.006, 0); mesh.add(leaf);
    }
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return mesh;
  }

  nextTrial() {
    this.warned = false;
    if (!this.active) return;
    this.ui.intro && this.ui.intro(null);
    // all rounds: after PER_ROUND fruits the next round starts (the last round goes on until you stop)
    if (this.inRound >= PER_ROUND && this.ri < this.rounds.length - 1) { this.ri += 1; this.inRound = 0; return this.introRound(); }
    this.inRound += 1;
    const kinds = KINDS;
    let kind = kinds[Math.floor(Math.random() * kinds.length)];
    if (kind === this.lastKind && Math.random() < 0.7) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
    const def = ITEMS[kind];
    const mesh = this.makeMesh(kind);
    mesh.position.set(this.spawnX(), 0.13, 0.0);   // drops in from above the hand
    this.group.add(mesh);
    this.item = { kind, def, mesh, from: mesh.position.clone() };
    this.lastKind = kind;
    this.phase = 'approach'; this.t0 = performance.now();
    if (this.round === 2) { { const b = this.basketX(), dir = Math.sign(b - 0.105); this.spotDir = dir; mesh.position.copy(reachSpot(b, kind === 'banana' ? 0.05 : def.radius, this.inRound - 1, this.tips ? this.tips().palmMid.x : undefined, b - dir * (0.06 + REACH_GAP))); } this.phase = 'reach'; this.ui.banner(`${kind[0].toUpperCase()}${kind.slice(1)}: move your hand to it`, 'then close your hand ✊'); }
    this.stats.trials += 1;
    this.ui.stats(this.summary());
    this.ui.banner(def.label, 'arriving...');
    snd('pop');
  }

  finish(result, extra = {}) {
    const k = this.lastKind || '';
    if (result === 'success') this.stats.success += 1;
    if (result === 'wrong_grasp') this.stats.wrong += 1;
    if (result === 'drop') this.stats.drops += 1;
    if (result === 'timeout') this.stats.timeouts += 1;
    snd(result === 'success' ? 'good' : result === 'wrong_grasp' ? 'wrong' : result === 'drop' ? 'drop' : 'miss');
    if (result === 'success') setTimeout(() => snd('plop'), 250);
    this.send({ cmd: 'game', ev: 'trial', item: k, result, round: this.round, ...extra });
    this.ui.stats(this.summary());
    this.ui.banner(result === 'success' ? 'Well done!' : ({ wrong_grasp: 'Wrong grasp', drop: 'Dropped it', timeout: 'Too slow' })[result],
      result === 'success' ? 'next item...' : 'try the next one', result === 'success');
    this.phase = 'pause'; this.t0 = performance.now();
  }

  summary() {
    const s = this.stats, mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    return { trials: s.trials, success: s.success, success_rate: s.trials ? s.success / s.trials : 0, wrong_grasp: s.wrong,
      drops: s.drops, timeouts: s.timeouts, mean_grab_s: mean(s.grabTimes), mean_release_s: mean(s.releaseTimes) };
  }

  // called every frame with the decoded movement
  update(state) {
    this.basket.position.x = this.basketX();
    const now = performance.now();
    if (state !== this.lastState) { this.lastState = state; this.stateSince = now; }
    const held = now - this.stateSince >= HOLD_MS;
    if (!this.active || !this.item) {
      if (this.active && this.phase === 'pause' && (now - this.t0) / 1000 > 1.2) this.nextTrial();
      return;
    }
    const it = this.item, t = (now - this.t0) / 1000, grip = this.gripPoint(it.kind);
    if (this.phase !== 'reach') this.marker.hide();
    switch (this.phase) {
      case 'reach': {   // round 2: the fruit lies on the table, go to it and close the hand
        { const b = this.basketX(), dir = Math.sign(b - 0.105); if (dir !== this.spotDir) { this.spotDir = dir; it.mesh.position.copy(reachSpot(b, it.kind === 'banana' ? 0.05 : it.def.radius, this.inRound - 1, undefined, b - dir * (0.06 + REACH_GAP))); } }   // changed hands
        const at = handAt(grip, it.mesh.position, it.def.radius); if (at) this.nearT = now;
        const near = now - (this.nearT || 0) < 900;   // closing the hand may move it a little: 'at the object' stays true for 0.9 s
        this.marker.show(it.mesh.position, it.def.radius, near);
        const name = `${it.kind[0].toUpperCase()}${it.kind.slice(1)}`;
        this.ui.banner(near ? `${name}: CLOSE your hand ✊` : `${name}: move your hand to it`, `pick it up yourself · ${Math.max(0, REACH_WINDOW - t).toFixed(1)} s`, false, near);
        const fresh = this.stateSince >= this.t0;
        if (held && fresh && near && !['open', 'rest', 'lost'].includes(state)) {
          this.stats.grabTimes.push(t); this.grabT = t; this.marker.hide();
          this.phase = 'carry'; this.t0 = now; this.ui.banner('Hold it...', 'keep the grasp'); snd('grab');
        } else if (t > REACH_WINDOW) { this.marker.hide(); this.fall(); this.finish('timeout', { phase: 'reach' }); }
        break;
      }
      case 'approach': {
        const a = Math.min(1, t / 1.2);
        it.mesh.position.lerpVectors(it.from, grip, a * a * (3 - 2 * a));
        if (a >= 1) { this.phase = 'grab'; this.t0 = now; this.ui.banner(it.def.label, 'GRAB now'); }
        break;
      }
      case 'grab': {
        it.mesh.position.copy(grip).add(new THREE.Vector3(0, Math.sin(now / 160) * 0.002, 0)); this.orient(it);
        this.ui.banner(it.def.label, `GRAB now · ${Math.max(0, GRAB_WINDOW - t).toFixed(1)} s`);
        const fresh = this.stateSince >= this.t0;   // the grasp must start after the item arrived
        // big objects: any closing of the hand counts (a real hand around a ball can look like many grips)
        const ok = (st) => !['open', 'rest', 'lost'].includes(st);
        if (held && fresh && ok(state)) {
          this.stats.grabTimes.push(t); this.grabT = t;
          this.phase = 'carry'; this.t0 = now; this.ui.banner('Hold it...', 'keep the grasp'); snd('grab');
        } else if (fresh && now - this.stateSince >= 600 && !['rest', 'open', 'lost'].includes(state) && !ok(state)) {
          // forgiving: say what is wrong, count it once, let the player correct it (no failed trial)
          if (!this.warned) { this.warned = true; this.stats.wrong += 1; this.send({ cmd: 'game_event', ev: 'wrong_grasp_warning', item: it.kind, got: state }); }
          const g = GRIPS[state] || { label: state, icon: '' }, n = GRIPS[it.def.need];
          this.ui.banner(it.def.label, `that is ${g.icon} ${g.label} · change to ${n.icon} ${n.label}`);
        } else if (t > GRAB_WINDOW) { this.fall(); this.finish('timeout', { phase: 'grab' }); }
        break;
      }
      case 'carry': {
        it.mesh.position.copy(grip); this.orient(it);
        // only OPENING the hand lets go (small changes of the grip while holding do not drop it)
        if (state === 'open' && now - this.stateSince > 300) { this.fall(); this.finish('drop', { grab_s: this.grabT }); }
        else if (t > CARRY_TIME) { this.phase = 'release'; this.t0 = now; this.ui.banner('Now OPEN your hand', 'drop it into the basket'); }
        break;
      }
      case 'release': {
        it.mesh.position.copy(grip); this.orient(it);
        const b0 = this.basketPos(), dx = b0.x - it.mesh.position.x, over0 = Math.abs(dx) < 0.09;
        if (this.mirrored()) this.guide.show(it.mesh.position.clone().setY(it.mesh.position.y - it.def.radius), -0.088, over0); else this.guide.hide();
        // over the basket and held still for DWELL_S: drops by itself
        if (over0 && this.mirrored()) { if (!this.overT) this.overT = now; } else this.overT = 0;
        const dw = this.overT ? (now - this.overT) / 1000 : 0, auto = dw > DWELL_S;
        this.ui.banner(!this.mirrored() ? 'Now OPEN your hand' : over0 ? 'Over the basket: OPEN your hand' : `Move it ${dx > 0 ? 'right →' : '← left'} to the basket`,
          over0 && this.mirrored() ? `or hold still: drops in ${Math.max(0, DWELL_S - dw).toFixed(1)} s` : `drop it into the basket · ${Math.max(0, RELEASE_WINDOW - t).toFixed(1)} s`, false, over0 && this.mirrored());
        if (auto || (held && ['open', 'rest'].includes(state))) {
          this.overT = 0;
          const b = this.basketPos(), p = it.mesh.position;
          // over the basket = left-right position matches (depth from the camera is too noisy to ask for)
          const over = !this.mirrored() || Math.abs(p.x - b.x) < 0.09;
          if (over) { this.stats.releaseTimes.push(t); this.fall(true); this.finish('success', { grab_s: this.grabT, release_s: t }); }
          else { this.fall(); this.finish('drop', { grab_s: this.grabT, missed_basket: true }); }
        } else if (t > RELEASE_WINDOW) { this.fall(); this.finish('timeout', { phase: 'release', grab_s: this.grabT }); }
        break;
      }
      default: break;
    }
  }

  basketPos() { return new THREE.Vector3(this.basketX(), -0.072, 0.03); }

  fall(intoBasket = false) {
    const it = this.item; if (!it) return;
    this.guide.hide();
    const mesh = it.mesh, start = mesh.position.clone(), t0 = performance.now();
    const end = intoBasket ? new THREE.Vector3(this.basketX(), -0.088 + it.def.radius, 0.03) : new THREE.Vector3(start.x + 0.06, -0.09 + it.def.radius, -0.08);
    const anim = () => {
      const a = Math.min(1, (performance.now() - t0) / 450);
      mesh.position.lerpVectors(start, end, a * a);
      if (a < 1) requestAnimationFrame(anim);
      else setTimeout(() => this.group.remove(mesh), 700);
    };
    anim();
    this.item = null;
  }
}
