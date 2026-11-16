// Level 2 - Fruit Kitchen: first-person kitchen. Take fruits from the bowl with the right grasp
// (fist for big fruit, pinch for small fruit), carry them to the blender and OPEN the hand to drop them.
// The hand follows your real hand (camera) or the mouse; "auto-reach" moves it for you (band-only use).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKitchen, makeFruit, makeBowl, makeBlender, FRUITS } from './props.js';
import { createHand } from './handmodel.js';
import { sfx } from './audio.js';

const BIG = ['apple', 'orange', 'banana'], SMALL = ['strawberry', 'grape', 'cherry'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const JUICE = { apple: 0xf3e3a0, orange: 0xffa53a, banana: 0xf7e7a1, strawberry: 0xf0476b, grape: 0x7b3fa0, cherry: 0xb3123a };

export class KitchenLevel {
  constructor(renderer, hud) {
    this.name = 'Fruit Kitchen'; this.key = 'kitchen';
    this.hud = hud;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color(0xdfe6ec);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 20);
    this.camera.position.set(0, 1.3, 0.22);
    this.camera.lookAt(0, 0.78, -0.42);
    buildKitchen(this.scene);
    this.top = 0.75;
    this.bowl = makeBowl(); this.bowl.position.set(-0.36, this.top, -0.4); this.bowl.scale.setScalar(1.25); this.scene.add(this.bowl);
    this.blender = makeBlender(); this.blender.position.set(0.4, this.top, -0.42); this.scene.add(this.blender);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.018, 0.22), new THREE.MeshStandardMaterial({ color: 0xc89b6d, roughness: 0.7 }));
    board.position.set(0.0, this.top + 0.009, -0.36); board.receiveShadow = true; this.scene.add(board);
    // hand rig
    this.hand = createHand({ forearm: true });
    this.rig = new THREE.Group(); this.rig.add(this.hand.root);
    // like your own arm reaching over the table: fingers point away from you, back of the hand up,
    // the camera looks down from above, so every finger is visible
    this.hand.root.rotation.set(0, Math.PI / 2, 0);
    this.rig.rotation.set(-0.3, 1.0, 0);   // arm comes in from the right side: fingers point left-forward, thumb towards you
    this.scene.add(this.rig);
    this.rigPos = new THREE.Vector3(0, 1.0, -0.12);
    // target ring that shows where the grip is
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.056, 40), new THREE.MeshBasicMaterial({ color: 0x1baf7a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.ring.renderOrder = 5;
    this.ring.rotation.x = -Math.PI / 2; this.scene.add(this.ring);
    this.fruits = []; this.falling = [];
    this.assist = false;
  }

  // ------------------------------------------------------------ session
  start() {
    this.camera.position.set(0, 1.3, 0.22); this.camera.lookAt(0, 0.78, -0.42);
    this.stats = { orders: 0, items: 0, wrongGrasp: 0, wrongFruit: 0, drops: 0, stars: 0, orderTimes: [], pickTimes: [] };
    this.fruits.forEach((f) => this.scene.remove(f)); this.fruits = [];
    this.orderNo = 0; this.nOrders = 3; this.held = null; this.lastState = 'rest'; this.stateT = 0; this.wrongT = 0; this.dropT = 0; this.done = false;
    this.newOrder();
  }

  newOrder() {
    this.orderNo += 1;
    const kinds = [pick(BIG), pick(SMALL)];
    if (Math.random() < 0.5) kinds.push(pick([...BIG, ...SMALL].filter((k) => !kinds.includes(k))));
    this.order = kinds.map((k) => ({ kind: k, n: 1 + Math.floor(Math.random() * 2), got: 0 }));
    this.orderT0 = performance.now(); this.orderErrors = 0; this.lastPickT = performance.now();
    const j = this.blender.userData.juice; j.visible = false; j.scale.y = 0.001;
    this.mix = [];
    this.fillBowl();
    this.hud.order(this.order, this.orderNo, this.nOrders);
    this.hud.toast(`Order ${this.orderNo}: make the smoothie`, '');
  }

  fillBowl() {
    const need = []; this.order.forEach((o) => { for (let i = o.got; i < o.n; i++) need.push(o.kind); });
    const have = this.fruits.filter((f) => !f.userData.used).map((f) => f.userData.kind);
    const want = need.slice();
    have.forEach((k) => { const i = want.indexOf(k); if (i >= 0) want.splice(i, 1); });
    while (this.fruits.filter((f) => !f.userData.used).length + want.length < 7) want.push(pick([...BIG, ...SMALL]));
    want.forEach((k) => this.addFruit(k));
    this.layoutBowl();
  }

  addFruit(kind) {
    const f = makeFruit(kind); f.userData.used = false; this.fruits.push(f); this.scene.add(f);
  }

  layoutBowl() {
    const free = this.fruits.filter((f) => !f.userData.used && f !== this.held && !f.userData.falling);
    free.forEach((f, i) => {
      const a = (i / Math.max(1, free.length - 1)) * Math.PI * 2 + 0.3, rr = i === 0 ? 0 : 0.125;   // spaced out: easy to pick one
      const p = new THREE.Vector3(this.bowl.position.x + Math.cos(a) * rr, this.top + 0.035 + f.userData.r, this.bowl.position.z + Math.sin(a) * rr * 0.85);
      f.userData.home = p.clone(); f.position.copy(p); f.rotation.set(0, a, 0);
    });
  }

  // ------------------------------------------------------------ frame
  update(dt, input) {
    const now = performance.now();
    input.driveHand(this.hand);
    this.hand.update(dt);
    const st = input.state;
    if (st !== this.lastState) { this.lastState = st; this.stateT = now; }
    // 1) where the hand is: your hand moves over the table like a mouse (left-right = x, up-down in the camera = far-near)
    const bl0 = this.blender.userData;
    let p;   // point on the table under the hand
    const lost = input.camOn && !input.handVisible();   // camera lost the hand for a moment: freeze, do not drop
    if (this.assist || (!input.posLive && !input.camOn)) {
      p = this.held ? this.blender.position.clone() : (this.nextTargetFruitPos() || new THREE.Vector3(0, 0, -0.35));
    } else {
      p = new THREE.Vector3(THREE.MathUtils.lerp(-0.62, 0.62, input.pos.x), 0, THREE.MathUtils.lerp(-0.62, -0.18, input.pos.y));
      this.lastP = p.clone();
    }
    // 2) magnet: the closest fruit within 16 cm is the candidate; the hand dips down to it
    const cand = this.held ? null : this.candidateAt(p);
    let h = this.top + 0.12;
    if (cand) h = cand.position.y + 0.02;
    if (this.held && this.overBlender(p)) h = this.top + bl0.openingY + 0.1;
    const gripGoal = cand ? cand.position.clone().setY(h) : new THREE.Vector3(p.x, h, p.z);
    const target = gripGoal.sub(this.gripOffset || new THREE.Vector3(0, -0.07, -0.2));
    this.rigPos.lerp(target, 1 - Math.exp(-dt * 7));
    this.rig.position.copy(this.rigPos);
    this.rig.updateMatrixWorld(true);
    const kind = this.held ? this.held.userData.grip : (cand?.userData.grip || 'big');
    const grip = this.hand.root.localToWorld(this.hand.gripLocal(kind === 'small' ? 'small' : 'big'));
    this.gripOffset = grip.clone().sub(this.rigPos); this.gripPos = grip.clone();
    // highlight
    this.fruits.forEach((f) => { if (!f.userData.used && f !== this.held) f.scale.setScalar(f === cand ? 1.18 + 0.05 * Math.sin(now / 110) : 1); });
    const ringAt = cand ? cand.position : this.held && this.overBlender(p) ? this.blender.position : p;
    this.ring.position.set(ringAt.x, this.top + 0.006, ringAt.z);
    this.ring.material.color.set(this.held ? (this.overBlender(p) ? 0x1baf7a : 0xeb6834) : cand ? 0x1baf7a : 0x9aa3ad);
    this.ring.scale.setScalar(cand || (this.held && this.overBlender(p)) ? 1.6 : 1);

    // 3) grasp: the right gesture over a candidate (made now, or within the last second)
    if (!lost && !this.held && cand && (st === 'close' || st === 'pinch')) {
      if (cand.userData.need === st && now - this.stateT < 1200 && now - this.dropT > 600) this.grab(cand);
      else if (cand.userData.need !== st && now - this.stateT > 350 && now - this.wrongT > 1500) {
        this.wrongT = now; this.stats.wrongGrasp += 1; this.orderErrors += 1; sfx.wrong();
        this.hud.toast('Other grasp', cand.userData.need === 'pinch' ? 'small fruit: PINCH 🤏' : 'big fruit: FIST ✊', 'bad');
      }
    }
    // 4) release: open the hand (or relax it for 0.7 s); never while the camera has lost the hand
    if (this.held && !lost && (st === 'open' || (st === 'rest' && now - this.stateT > 700))) this.release(grip, p);
    if (this.held) this.held.position.lerp(grip, 1 - Math.exp(-dt * 18));   // fruit flies into the hand
    // falling fruit animation
    this.falling = this.falling.filter((f) => {
      f.userData.vy -= 9.81 * dt; f.position.y += f.userData.vy * dt;
      if (f.position.y <= f.userData.floorY) {
        f.position.y = f.userData.floorY; f.userData.falling = false; if (f.userData.onLand) f.userData.onLand(); return false;
      }
      return true;
    });
    // blender
    const bl = this.blender.userData;
    if (this.blending) {
      bl.blade.rotation.y += dt * 60; this.blender.position.x = 0.4 + Math.sin(now / 25) * 0.002;
      if (now > this.blending) { this.blending = 0; this.blender.position.x = 0.4; this.finishOrder(); }
    }
    this.hud.timer((now - this.orderT0) / 1000);
    this.hud.hint(this.held ? (this.overBlender(p) ? 'Now OPEN your hand 🖐️' : 'Move to the blender (right) ➜')
      : cand ? `${cand.userData.icon} ${cand.userData.name}: ${cand.userData.need === 'pinch' ? 'PINCH 🤏' : 'FIST ✊'}`
      : lost ? '✋ show your hand to the camera' : (this.assist || !input.posLive) ? 'auto-reach is moving the hand' : 'Move your hand over the plate (left)');
  }

  overBlender(p) { return Math.hypot(p.x - this.blender.position.x, p.z - this.blender.position.z) < 0.2; }

  candidateAt(p) {
    let best = null, bd = 1e9;
    for (const f of this.fruits) {
      if (f.userData.used || f === this.held || f.userData.falling) continue;
      const d = Math.hypot(f.position.x - p.x, f.position.z - p.z);
      if (d < bd) { bd = d; best = f; }
    }
    return bd < 0.16 ? best : null;
  }

  nearest(grip) {
    if (!grip) grip = this.gripPos || this.rigPos;
    let best = null, bd = 1e9;
    for (const f of this.fruits) {
      if (f.userData.used || f === this.held || f.userData.falling) continue;
      const d = f.position.distanceTo(grip);
      if (d < bd) { bd = d; best = f; }
    }
    return bd < 0.09 + (best ? best.userData.r : 0) ? best : null;
  }

  nextTargetFruitPos() {
    const needed = this.order.filter((o) => o.got < o.n).map((o) => o.kind);
    const f = this.fruits.find((x) => !x.userData.used && !x.userData.falling && needed.includes(x.userData.kind));
    return f ? f.position.clone() : null;
  }

  grab(f) {
    this.held = f; sfx.grab();
    this.stats.pickTimes.push((performance.now() - this.lastPickT) / 1000);
    this.hud.event({ ev: 'grab', item: f.userData.kind });
  }

  release(grip, p) {
    const f = this.held; this.held = null; this.lastPickT = performance.now(); this.dropT = performance.now();
    const b = this.blender.position;
    const overBlender = this.overBlender(p || grip);
    f.scale.setScalar(1);
    f.userData.falling = true; f.userData.vy = 0;
    if (overBlender) {
      f.position.x = b.x + (Math.random() - 0.5) * 0.04; f.position.z = b.z + (Math.random() - 0.5) * 0.04;
      f.userData.floorY = this.top + 0.15 + this.mix.length * 0.012;
      f.userData.used = true;
      const o = this.order.find((x) => x.kind === f.userData.kind && x.got < x.n);
      if (o) {
        o.got += 1; this.stats.items += 1; this.mix.push(f.userData.kind);
        f.userData.onLand = () => { sfx.plop(); this.updateJuice(); };
        this.hud.toast(`${f.userData.icon} in!`, '', 'ok');
        this.hud.event({ ev: 'place', item: f.userData.kind, ok: true });
      } else {
        this.stats.wrongFruit += 1; this.orderErrors += 1;
        f.userData.onLand = () => sfx.wrong();
        this.hud.toast('Not in the recipe', `${f.userData.name} was not ordered`, 'bad');
        this.hud.event({ ev: 'place', item: f.userData.kind, ok: false });
      }
      this.hud.order(this.order, this.orderNo, this.nOrders);
      if (this.order.every((x) => x.got >= x.n)) { this.blending = performance.now() + 1800; sfx.blender(); }
    } else {
      this.stats.drops += 1; this.orderErrors += 1;
      f.userData.floorY = this.top + f.userData.r;
      f.userData.onLand = () => { sfx.drop(); setTimeout(() => { f.userData.falling = false; this.layoutBowl(); }, 500); };
      this.hud.toast('Dropped', 'it goes back to the plate · open only over the blender', 'bad');
      this.hud.event({ ev: 'drop', item: f.userData.kind });
    }
    this.falling.push(f);
  }

  updateJuice() {
    const j = this.blender.userData.juice;
    j.visible = true;
    const c = new THREE.Color(0, 0, 0);
    this.mix.forEach((k) => c.add(new THREE.Color(JUICE[k])));
    c.multiplyScalar(1 / Math.max(1, this.mix.length));
    j.material.color.copy(c);
    const h = Math.min(0.18, 0.03 * this.mix.length);
    j.scale.y = h; j.position.y = 0.125 + h / 2;
  }

  finishOrder() {
    const t = (performance.now() - this.orderT0) / 1000;
    const stars = this.orderErrors === 0 && t < 30 ? 3 : this.orderErrors <= 1 && t < 50 ? 2 : 1;
    this.stats.stars += stars; this.stats.orders += 1; this.stats.orderTimes.push(t);
    sfx.win();
    this.hud.toast(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  Smoothie ready!`, `${t.toFixed(1)} s · ${this.orderErrors} errors`, 'ok');
    this.hud.event({ ev: 'order', time_s: t, errors: this.orderErrors, stars });
    this.fruits.filter((f) => f.userData.used).forEach((f) => this.scene.remove(f));
    this.fruits = this.fruits.filter((f) => !f.userData.used);
    if (this.orderNo >= this.nOrders) { setTimeout(() => this.hud.finish(this.summary()), 1500); this.done = true; }
    else setTimeout(() => this.newOrder(), 1800);
  }

  summary() {
    const s = this.stats, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const score = Math.max(0, Math.round(s.items * 100 + s.stars * 150 - (s.wrongGrasp + s.wrongFruit + s.drops) * 40));
    return { level: this.key, title: this.name, score, stars: Math.round(s.stars / Math.max(1, s.orders)), orders: s.orders,
      items: s.items, wrong_grasp: s.wrongGrasp, wrong_fruit: s.wrongFruit, drops: s.drops,
      mean_order_s: mean(s.orderTimes), mean_pick_s: mean(s.pickTimes),
      lines: [`Orders: ${s.orders}`, `Fruits placed: ${s.items}`, `Mean order time: ${mean(s.orderTimes)?.toFixed(1) ?? '-'} s`,
        `Wrong grasp: ${s.wrongGrasp} · wrong fruit: ${s.wrongFruit} · drops: ${s.drops}`] };
  }

  stop() { this.done = true; }
}
