// Level 3 - Steady Pour: control grip STRENGTH. Squeeze into the green zone to tilt the jug and pour.
// Stop exactly at the green line. Too strong = splash, too weak = no pour. Trains graded (proportional) control.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKitchen, makeGlass, makeJug } from './props.js';
import { createHand } from './handmodel.js';
import { sfx, pourSound } from './audio.js';

export const ZONE = [0.25, 0.8];   // wide green zone (easy); squeeze above 0.95 = splash

export class PourLevel {
  constructor(renderer, hud) {
    this.name = 'Steady Pour'; this.key = 'pour'; this.hud = hud;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color(0xdfe6ec);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
    this.camera.position.set(0.0, 1.2, 0.42);
    this.camera.lookAt(0.0, 0.9, -0.42);
    buildKitchen(this.scene);
    this.top = 0.75;
    // jug held by the hand, tilting around the pivot
    this.pivot = new THREE.Group(); this.pivot.position.set(-0.1, 0.9, -0.42); this.scene.add(this.pivot);
    this.jug = makeJug(); this.jug.position.set(-0.03, -0.09, 0); this.pivot.add(this.jug);
    this.hand = createHand({ forearm: true });
    this.hand.root.position.set(-0.18, 0.02, 0.0);
    this.hand.root.rotation.set(Math.PI / 2, 0, 0);     // palm faces the jug handle
    this.pivot.add(this.hand.root);
    // pour stream
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.009, 1, 12), new THREE.MeshStandardMaterial({ color: 0x5fb8ea, transparent: true, opacity: 0.75 }));
    this.stream.visible = false; this.scene.add(this.stream);
    this.drops = [];
    this.glass = null;
  }

  start() {
    this.stats = { glasses: 0, errors: [], splashes: 0, overflows: 0, inZone: 0, pourTime: 0, scores: [] };
    this.nGlasses = 4; this.tilt = 0; this.done = false; this.splashT = 0; this.overT = 0;
    this.nextGlass();
  }

  nextGlass() {
    if (this.glass) this.scene.remove(this.glass);
    // put the glass exactly under the spout at a typical pouring tilt
    const keep = this.pivot.rotation.z; this.pivot.rotation.z = -1.0; this.pivot.updateMatrixWorld(true);
    this.glassX = this.jug.localToWorld(this.jug.userData.spoutLocal.clone()).x; this.pivot.rotation.z = keep;
    this.glass = makeGlass(); this.glass.position.set(this.glassX, this.top, -0.42); this.scene.add(this.glass);
    this.level = 0; this.targetLevel = 0.45 + Math.random() * 0.4; this.idleT = 0; this.poured = false;
    const g = this.glass.userData; g.line.position.y = 0.008 + g.height * this.targetLevel;
    this.slideIn = 0;
    this.hud.toast(`Glass ${this.stats.glasses + 1} of ${this.nGlasses}`, 'squeeze into the GREEN zone to pour');
  }

  update(dt, input) {
    const i = input.intensity;
    this.hud.gauge(i, ZONE);
    input.driveHand(this.hand, i > 0.25 ? 'close' : 'rest');
    this.hand.update(dt);
    if (this.slideIn < 1) { this.slideIn = Math.min(1, this.slideIn + dt * 2.5); this.glass.position.x = this.glassX + (1 - this.slideIn) * 0.6; }
    // tilt follows grip strength inside the zone
    let tgt = 0;
    if (i >= ZONE[0]) tgt = THREE.MathUtils.clamp((i - ZONE[0]) / (ZONE[1] - ZONE[0]), 0, 1) * 1.25;
    this.tilt += (tgt - this.tilt) * (1 - Math.exp(-dt * 6));
    this.pivot.rotation.z = -this.tilt;
    // squeezing too hard -> splash
    if (i > 0.95) {
      this.overT += dt;
      if (this.overT > 0.6 && performance.now() - this.splashT > 1500) {
        this.splashT = performance.now(); this.stats.splashes += 1; sfx.splash(); this.splash();
        this.hud.toast('Too strong!', 'relax a little', 'bad'); this.hud.event({ ev: 'splash' });
      }
    } else this.overT = 0;
    // pouring
    const rate = Math.max(0, (this.tilt - 0.55) / 0.7);
    const g = this.glass.userData;
    if (rate > 0.02 && this.slideIn >= 1) {
      this.poured = true;
      this.level += rate * 0.22 * dt;
      this.stats.pourTime += dt;
      if (i >= ZONE[0] && i <= ZONE[1]) this.stats.inZone += dt;
      this.pivot.updateMatrixWorld(true);
      const sp = this.jug.localToWorld(this.jug.userData.spoutLocal.clone());
      const surf = this.top + 0.008 + g.height * Math.min(1, this.level);
      this.stream.visible = true;
      const len = Math.max(0.01, sp.y - surf);
      this.stream.scale.set(0.6 + rate, len, 0.6 + rate);
      this.stream.position.set(sp.x, surf + len / 2, sp.z);
      pourSound(rate);
      this.idleT = 0;
    } else {
      this.stream.visible = false; pourSound(0);
      if (this.poured) this.idleT += dt;
    }
    if (this.level > 1.0 && !this.overflowed) { this.overflowed = true; this.stats.overflows += 1; sfx.splash(); this.splash(); this.hud.toast('Overflow!', '', 'bad'); }
    const L = Math.min(1, this.level);
    g.water.scale.y = Math.max(0.0001, g.height * L); g.water.position.y = 0.008 + (g.height * L) / 2;
    // jug water drains a little
    this.jug.userData.water.scale.y = Math.max(0.2, 1 - (this.stats.glasses + this.level) * 0.15);
    // glass finished when the player relaxes for 1 s after pouring
    if (this.poured && this.idleT > 1.0 && !this.done) this.evaluate();
    this.drops = this.drops.filter((d) => { d.v.y -= 9.81 * dt; d.m.position.addScaledVector(d.v, dt); if (d.m.position.y < this.top) { this.scene.remove(d.m); return false; } return true; });
    this.hud.timer(this.stats.pourTime);
    this.hud.hint(`fill to the green line · ${Math.round(L * 100)}% (target ${Math.round(this.targetLevel * 100)}%)`);
  }

  splash() {
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), new THREE.MeshStandardMaterial({ color: 0x5fb8ea, transparent: true, opacity: 0.8 }));
      m.position.set(this.glass.position.x, this.top + 0.1, this.glass.position.z);
      this.scene.add(m);
      this.drops.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8) });
    }
  }

  evaluate() {
    const err = Math.abs(Math.min(1.2, this.level) - this.targetLevel);
    const score = Math.max(0, Math.round(100 - err * 400 - (this.overflowed ? 30 : 0)));
    this.stats.errors.push(err); this.stats.scores.push(score); this.stats.glasses += 1;
    const stars = score >= 85 ? 3 : score >= 60 ? 2 : score > 0 ? 1 : 0;
    stars >= 2 ? sfx.good() : sfx.miss();
    this.hud.toast(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${score} points`, `off by ${(err * 100).toFixed(0)}% of the glass`, stars >= 2 ? 'ok' : 'bad');
    this.hud.event({ ev: 'glass', target: this.targetLevel, level: this.level, error: err, score });
    this.overflowed = false; this.poured = false;
    if (this.stats.glasses >= this.nGlasses) { this.done = true; pourSound(0); setTimeout(() => this.hud.finish(this.summary()), 1200); }
    else setTimeout(() => this.nextGlass(), 1000);
    this.poured = false; this.idleT = 0;
  }

  summary() {
    const s = this.stats, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const score = s.scores.reduce((a, b) => a + b, 0);
    const avg = mean(s.scores) || 0;
    return { level: this.key, title: this.name, score, stars: avg >= 85 ? 3 : avg >= 60 ? 2 : 1, glasses: s.glasses,
      mean_fill_error: mean(s.errors), splashes: s.splashes, overflows: s.overflows,
      time_in_zone: s.pourTime ? s.inZone / s.pourTime : null,
      lines: [`Glasses: ${s.glasses}`, `Mean fill error: ${((mean(s.errors) || 0) * 100).toFixed(1)}% of the glass`,
        `Grip in green zone while pouring: ${s.pourTime ? Math.round((s.inZone / s.pourTime) * 100) : 0}%`, `Splashes: ${s.splashes} · overflows: ${s.overflows}`] };
  }

  stop() { this.done = true; pourSound(0); }
}
