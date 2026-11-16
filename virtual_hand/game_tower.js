// "Build a tower" game: precise placing and a steady hand.
// A block arrives at the hand. Close the hand to grab it, carry it over the tower and OPEN the hand:
// the block drops onto the tower. Placed well (centre over the block below) it stays, otherwise it falls off.
// Five blocks = tower complete, then a new tower starts. Every block is scored and logged like the fruit game.
import * as THREE from 'three';
import { DropGuide, screenDx } from './game/dropguide.js?v=1794717000';
import { reachSpot, handAt, ReachMarker, roundList, REACH_WINDOW, REACH_TARGET_SHIFT, REACH_GAP, DWELL_S } from './game/reach.js?v=1794717000';
const ROUNDS = { 1: { title: 'Round 1 · it comes to your hand', icon: '🧱' }, 2: { title: 'Round 2 · pick it up yourself', icon: '🖐' } };

const SIZE = 0.032;           // block edge (m)
const GOAL = 5;               // blocks per tower
const HOLD_MS = 300;          // a grasp / an opening must last this long
const GRAB_WINDOW = 8.0;      // s
const CARRY_TIME = 0.8;       // s before the block can be released
const PLACE_WINDOW = 12.0;    // s to carry it over the tower and open
const TABLE_Y = -0.09;        // table top
const COLORS = [0xe4572e, 0xf3a712, 0x29a36a, 0x2a78d6, 0x8a4fd1, 0xd6336c];
// 'lost' = the camera does not see the hand: nothing is grabbed or let go while the hand is out of view
const closed = (st) => !['open', 'rest', 'lost'].includes(st);
const opened = (st) => ['open', 'rest'].includes(st);

export class TowerGame {
  constructor(scene, hand, ui, send, opts = {}) {
    this.scene = scene; this.hand = hand; this.ui = ui; this.send = send;
    this.tips = opts.tips || null;
    this.mirrored = opts.mirrored || (() => false);
    const bx0 = opts.basketX || (() => 0.265);   // round 2: the tower stands further out (the block lies between)
    this.baseX = () => { const b = bx0(); return this.active && this.round === 2 ? b + Math.sign(b - 0.105) * REACH_TARGET_SHIFT : b; };   // the tower stands where the basket would be
    this.spawnX = opts.spawnX || (() => 0.5);
    this.camera = opts.camera || (() => null);
    this.active = false; this.phase = 'idle'; this.stats = this.emptyStats();
    this.group = new THREE.Group(); scene.add(this.group);
    // the base plate of the tower
    this.base = new THREE.Mesh(new THREE.BoxGeometry(SIZE * 1.9, 0.006, SIZE * 1.9),
      new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 }));
    this.base.position.set(0.265, TABLE_Y + 0.003, 0.0); this.base.receiveShadow = true; this.base.visible = false;
    this.group.add(this.base);
    this.tower = [];              // placed blocks (meshes), bottom first
    this.guide = new DropGuide(this.group, TABLE_Y);
    this.lastBaseX = null;
    this.wrapA = 0.95;            // max bend per finger joint while holding: fingers close around the block
    this.item = null; this.stateSince = performance.now(); this.lastState = 'rest';
    this.marker = new ReachMarker(this.group); this.roundSel = 'all'; this.rounds = [1]; this.ri = 0;
  }

  emptyStats() { return { trials: 0, success: 0, wrong: 0, drops: 0, timeouts: 0, grabTimes: [], releaseTimes: [], towers: 0, best: 0 }; }
  // the virtual arm is lifted as the tower grows, so the block in the hand is always above the tower
  // (round 2: only while carrying, so the hand can go down to the block on the table)
  armLift() { return !this.active || (this.round === 2 && !['carry', 'place'].includes(this.phase)) ? 0 : this.tower.length * SIZE; }
  get round() { return this.rounds[this.ri] || 1; }
  holdRadius() { return this.item && ['carry', 'place'].includes(this.phase) ? SIZE * 0.55 : 0; }
  // how far the fingers may bend around the block (rad per joint): they stop on its surface
  holdWrap() { return this.holdRadius() ? this.wrapA : 0; }
  // finger closing [thumb, index, middle, ring, little] (0 open .. 1 fist) for a grasp around the block
  holdCurls() { return this.holdRadius() ? [0.72, 0.6, 0.6, 0.62, 0.64] : null; }

  start() {
    this.active = true; this.stats = this.emptyStats(); this.base.visible = true; this.clearTower();
    this.rounds = roundList(this.roundSel, 2); this.ri = 0;
    this.send({ cmd: 'game', ev: 'start', game: 'tower', rounds: this.rounds });
    this.introRound();
  }

  // one tower per round when all rounds are played
  introRound() {
    const R = ROUNDS[this.round];
    this.ui.intro && this.ui.intro(`<div class="ri-icon">${R.icon}</div><div class="ri-t">${R.title}</div><div class="ri-s">${this.round === 2 ? 'the block lies on the table: move your hand to it, close, put it on the tower' : 'the block comes to your hand: close, put it on the tower'}</div>`);
    this.ui.banner(null); this.item = null; this.phase = 'pause'; this.t0 = performance.now() + 1000;
  }

  stop() {
    this.marker.hide(); this.ui.intro && this.ui.intro(null);
    this.active = false; this.phase = 'idle'; this.base.visible = false; this.clearTower();
    if (this.item) { this.group.remove(this.item.mesh); this.item = null; }
    this.ui.banner(null); this.ui.extra && this.ui.extra(null); this.guide.hide();
    this.send({ cmd: 'game', ev: 'stop', game: 'tower', ...this.summary() });
    this.ui.stats(this.summary());
  }

  clearTower() { this.tower.forEach((m) => this.group.remove(m)); this.tower = []; }

  // the next free spot on top of the tower (x follows the top block, so a crooked tower stays crooked)
  topSpot() {
    const n = this.tower.length, bx = this.baseX();
    const x = n ? this.tower[n - 1].position.x : bx;
    return new THREE.Vector3(x, TABLE_Y + 0.006 + SIZE / 2 + n * SIZE, 0.0);
  }

  gripPoint() {
    if (this.tips) {
      const t = this.tips();
      const palmSpot = t.palmMid.clone().add(t.palmOut.clone().multiplyScalar(SIZE / 2 + 0.008));
      if (!['carry', 'place'].includes(this.phase)) return palmSpot.addScaledVector(t.palmOut, 0.014);
      // held: the block sits between the thumb tip and the index/middle tips (where a real hand holds it),
      // but never closer to the palm than its own half size
      const c = t.thumb.clone().multiplyScalar(0.4).addScaledVector(t.index, 0.3).addScaledVector(t.middle, 0.3);
      const out = c.clone().sub(t.palmMid).dot(t.palmOut);
      if (out < SIZE / 2 + 0.008) c.addScaledVector(t.palmOut, SIZE / 2 + 0.008 - out);
      return c;
    }
    return new THREE.Vector3(this.hand.position.x + 0.1, -0.05, 0);
  }

  makeBlock() {
    const c = COLORS[(this.stats.trials) % COLORS.length];
    const m = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
    m.add(e); m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  nextBlock() {
    if (!this.active) return;
    this.ui.intro && this.ui.intro(null);
    const mesh = this.makeBlock();
    mesh.position.set(this.spawnX(), 0.13, 0);   // drops in from above the hand
    this.group.add(mesh);
    this.item = { mesh, from: mesh.position.clone() };
    this.phase = 'approach'; this.t0 = performance.now();
    if (this.round === 2) { { const b = this.baseX(), dir = Math.sign(b - 0.105); this.spotDir = dir; mesh.position.copy(reachSpot(b, SIZE / 2, this.stats.trials, this.tips ? this.tips().palmMid.x : undefined, b - dir * (SIZE + REACH_GAP))); } this.phase = 'reach'; }
    this.stats.trials += 1;
    this.ui.stats(this.summary()); this.showHeight();
    this.ui.banner('Block: close your hand around it ✊', 'arriving...');
  }

  showHeight() { this.ui.extra && this.ui.extra(`🧱 Round ${this.round}${this.rounds.length > 1 ? `/${this.rounds.length}` : ''} · Tower ${this.tower.length}/${GOAL}`); }

  finish(result, extra = {}) {
    if (result === 'success') this.stats.success += 1;
    if (result === 'drop') this.stats.drops += 1;
    if (result === 'timeout') this.stats.timeouts += 1;
    this.send({ cmd: 'game', ev: 'trial', game: 'tower', item: 'block', result, round: this.round, height: this.tower.length, ...extra });
    this.ui.stats(this.summary()); this.showHeight();
    let title = { success: 'Well placed!', drop: 'It fell off', timeout: 'Too slow' }[result], sub = 'next block...';
    if (result === 'success' && this.tower.length >= GOAL) {
      this.stats.towers += 1; title = 'Tower complete! 🎉'; sub = 'a new tower starts...';
      this.pendingClear = true;
    }
    this.ui.banner(title, sub, result === 'success');
    this.phase = 'pause'; this.t0 = performance.now();
  }

  summary() {
    const s = this.stats, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return { game: 'tower', trials: s.trials, success: s.success, success_rate: s.trials ? s.success / s.trials : 0, wrong_grasp: s.wrong,
      drops: s.drops, timeouts: s.timeouts, mean_grab_s: mean(s.grabTimes), mean_release_s: mean(s.releaseTimes),
      towers: s.towers, best_height: s.best };
  }

  update(state) {
    const bx = this.baseX();
    if (this.lastBaseX != null && Math.abs(bx - this.lastBaseX) > 0.1 && this.tower.length) {
      this.clearTower(); this.showHeight();                    // you changed hands: start the tower on the new side
      this.send({ cmd: 'game_event', game: 'tower', ev: 'hand_switched_new_tower' });
    }
    this.lastBaseX = bx; this.base.position.x = bx;
    const now = performance.now();
    if (state !== this.lastState) { this.lastState = state; this.stateSince = now; }
    const held = now - this.stateSince >= HOLD_MS;
    if (!this.active || !this.item) {
      if (this.active && this.phase === 'pause' && (now - this.t0) / 1000 > 1.3) {
        if (this.pendingClear) {
          this.pendingClear = false; this.clearTower();
          if (this.ri < this.rounds.length - 1) { this.ri += 1; this.showHeight(); return this.introRound(); }
        }
        this.nextBlock();
      }
      return;
    }
    const it = this.item, t = (now - this.t0) / 1000, grip = this.gripPoint();
    if (!['carry', 'place'].includes(this.phase)) this.guide.hide();
    // the held block never goes into the tower: over the tower it rests on top of it
    if (['carry', 'place'].includes(this.phase)) {
      const top = this.topSpot();
      if (Math.abs(top.x - grip.x) < SIZE * 1.3 && grip.y < top.y + 0.003) grip.y = top.y + 0.003;
    }
    if (this.phase !== 'reach') this.marker.hide();
    switch (this.phase) {
      case 'reach': {   // round 2: the block lies on the table, go to it and close the hand
        { const b = this.baseX(), dir = Math.sign(b - 0.105); if (dir !== this.spotDir) { this.spotDir = dir; it.mesh.position.copy(reachSpot(b, SIZE / 2, this.stats.trials, undefined, b - dir * (SIZE + REACH_GAP))); } }   // changed hands
        const at = handAt(grip, it.mesh.position, SIZE / 2); if (at) this.nearT = now;
        const near = now - (this.nearT || 0) < 900;   // closing the hand may move it a little: 'at the object' stays true for 0.9 s
        this.marker.show(it.mesh.position, SIZE / 2, near);
        this.ui.banner(near ? 'Block: CLOSE your hand ✊' : 'Block: move your hand to it', `pick it up yourself · ${Math.max(0, REACH_WINDOW - t).toFixed(1)} s`, false, near);
        const fresh = this.stateSince >= this.t0;
        if (held && fresh && near && closed(state)) {
          this.stats.grabTimes.push(t); this.grabT = t; this.marker.hide(); this.phase = 'carry'; this.t0 = now;
          this.ui.banner('Hold it...', 'keep the grasp');
        } else if (t > REACH_WINDOW) { this.marker.hide(); this.drop(); this.finish('timeout', { phase: 'reach' }); }
        break;
      }
      case 'approach': {
        const a = Math.min(1, t / 1.2);
        it.mesh.position.lerpVectors(it.from, grip, a * a * (3 - 2 * a));
        if (a >= 1) { this.phase = 'grab'; this.t0 = now; }
        break;
      }
      case 'grab': {
        it.mesh.position.copy(grip).add(new THREE.Vector3(0, Math.sin(now / 160) * 0.002, 0));
        this.ui.banner('Block: close your hand around it ✊', `GRAB now · ${Math.max(0, GRAB_WINDOW - t).toFixed(1)} s`);
        const fresh = this.stateSince >= this.t0;
        if (held && fresh && closed(state)) {
          this.stats.grabTimes.push(t); this.grabT = t; this.phase = 'carry'; this.t0 = now;
          this.ui.banner('Hold it...', 'keep the grasp');
        } else if (t > GRAB_WINDOW) { this.drop(); this.finish('timeout', { phase: 'grab' }); }
        break;
      }
      case 'carry': {
        it.mesh.position.copy(grip);
        if (state === 'open' && now - this.stateSince > 300) { this.drop(); this.finish('drop', { grab_s: this.grabT, early: true }); }
        else if (t > CARRY_TIME) { this.phase = 'place'; this.t0 = now; }
        break;
      }
      case 'place': {
        it.mesh.position.copy(grip);
        const top = this.topSpot(), dx = -screenDx(this.camera(), it.mesh.position, top);
        const near = !this.mirrored() || Math.abs(dx) < 0.045;
        if (near && this.mirrored()) { if (!this.overT) this.overT = now; } else this.overT = 0;
        const dw = this.overT ? (now - this.overT) / 1000 : 0, auto = dw > DWELL_S;   // held still over the tower: drops by itself
        this.guide.showTo(it.mesh.position.clone().setY(it.mesh.position.y - SIZE / 2), new THREE.Vector3(top.x - dx, top.y - SIZE / 2, top.z), near && this.mirrored());
        this.ui.banner(!this.mirrored() ? 'Now OPEN your hand' : near ? 'Over the tower: OPEN your hand' : `Move it ${dx > 0 ? 'right →' : '← left'} to the tower`,
          near && this.mirrored() ? `or hold still: drops in ${Math.max(0, DWELL_S - dw).toFixed(1)} s` : `block ${this.tower.length + 1} of ${GOAL} · ${Math.max(0, PLACE_WINDOW - t).toFixed(1)} s`, false, near && this.mirrored());
        if (auto || (held && opened(state))) {
          this.overT = 0;
          if (near) {
            const off = this.mirrored() ? THREE.MathUtils.clamp(-dx, -SIZE * 0.3, SIZE * 0.3) : 0;   // a slightly crooked tower
            this.stats.releaseTimes.push(t);
            this.place(new THREE.Vector3(top.x + off, top.y, top.z));
            this.stats.best = Math.max(this.stats.best, this.tower.length);
            this.finish('success', { grab_s: this.grabT, release_s: t, offset_m: +off.toFixed(4) });
          } else { this.drop(); this.finish('drop', { grab_s: this.grabT, missed_tower: true, dx_m: +dx.toFixed(3) }); }
        } else if (t > PLACE_WINDOW) { this.drop(); this.finish('timeout', { phase: 'place', grab_s: this.grabT }); }
        break;
      }
      default: break;
    }
  }

  // block lands on the tower: lift a little over the top if needed, then set it down
  place(target) {
    this.guide.hide();
    const mesh = this.item.mesh, start = mesh.position.clone(), t0 = performance.now();
    const over = Math.max(start.y, target.y + 0.02);
    this.tower.push(mesh); this.item = null;
    const anim = () => {
      const a = Math.min(1, (performance.now() - t0) / 420);
      const p = a < 0.5 ? a / 0.5 : 1;
      mesh.position.set(THREE.MathUtils.lerp(start.x, target.x, p), a < 0.5 ? THREE.MathUtils.lerp(start.y, over, p) : THREE.MathUtils.lerp(over, target.y, (a - 0.5) / 0.5),
        THREE.MathUtils.lerp(start.z, target.z, p));
      mesh.rotation.set(0, 0, 0);
      if (a < 1) requestAnimationFrame(anim);
    };
    anim();
  }

  // block falls onto the table and disappears
  drop() {
    const it = this.item; if (!it) return;
    this.guide.hide();
    const mesh = it.mesh, start = mesh.position.clone(), t0 = performance.now();
    const end = new THREE.Vector3(start.x + 0.04, TABLE_Y + SIZE / 2, start.z + 0.03);
    const anim = () => {
      const a = Math.min(1, (performance.now() - t0) / 450);
      mesh.position.lerpVectors(start, end, a * a); mesh.rotation.z = a * 0.9;
      if (a < 1) requestAnimationFrame(anim); else setTimeout(() => this.group.remove(mesh), 700);
    };
    anim();
    this.item = null;
  }
}
