// Level 1 - Gesture Rhythm: gesture cards fly toward you on the beat. Make the gesture as the card
// reaches the ring. Measures accuracy and reaction time (ms) per gesture; speed adapts to your skill.
import * as THREE from 'three';
import { createHand } from './handmodel.js';
import { sfx, Groove } from './audio.js';

const G = {
  close: { label: 'FIST', color: '#eb6834', sym: 'fist' },
  open:  { label: 'OPEN', color: '#1baf7a', sym: 'open' },
  pinch: { label: 'PINCH', color: '#7b5cd6', sym: 'pinch' },
};

function drawSymbol(g, sym, cx, cy, s) {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = s * 0.09;
  if (sym === 'fist') {
    g.beginPath(); g.roundRect(cx - s * 0.32, cy - s * 0.2, s * 0.64, s * 0.46, s * 0.12); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = s * 0.03;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(cx - s * 0.32 + i * s * 0.16, cy - s * 0.2); g.lineTo(cx - s * 0.32 + i * s * 0.16, cy + s * 0.02); g.stroke(); }
    g.fillStyle = '#fff'; g.beginPath(); g.roundRect(cx - s * 0.42, cy - s * 0.02, s * 0.18, s * 0.3, s * 0.08); g.fill();
  } else if (sym === 'open') {
    g.beginPath(); g.roundRect(cx - s * 0.22, cy - s * 0.02, s * 0.44, s * 0.34, s * 0.12); g.fill();
    for (let i = 0; i < 4; i++) { const x = cx - s * 0.17 + i * s * 0.115; g.beginPath(); g.moveTo(x, cy); g.lineTo(x, cy - s * 0.36 + (i === 0 || i === 3 ? s * 0.06 : 0)); g.stroke(); }
    g.beginPath(); g.moveTo(cx - s * 0.2, cy + s * 0.12); g.lineTo(cx - s * 0.38, cy - s * 0.04); g.stroke();
  } else {
    g.beginPath(); g.arc(cx - s * 0.04, cy + s * 0.08, s * 0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx + s * 0.08, cy - s * 0.02); g.lineTo(cx + s * 0.16, cy - s * 0.3); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.2, cy - s * 0.02); g.lineTo(cx + s * 0.1, cy - s * 0.3); g.stroke();
    g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(cx + s * 0.14, cy - s * 0.32, s * 0.06, 0, Math.PI * 2); g.fill();
  }
}

function cardTexture(kind) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const g = c.getContext('2d'), d = G[kind];
  g.fillStyle = d.color; g.beginPath(); g.roundRect(8, 8, 240, 304, 36); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 6; g.stroke();
  drawSymbol(g, d.sym, 128, 140, 220);
  g.fillStyle = '#fff'; g.font = 'bold 54px Inter, Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillText(d.label, 128, 286);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class RhythmLevel {
  constructor(renderer, hud) {
    this.name = 'Gesture Rhythm'; this.key = 'rhythm'; this.hud = hud;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1320);
    this.scene.fog = new THREE.Fog(0x0e1320, 4, 14);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 50);
    this.camera.position.set(0, 1.6, 2.6); this.camera.lookAt(0, 1.0, -3);
    this.scene.add(new THREE.HemisphereLight(0x9fb7ff, 0x1a1a2a, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 4, 3); this.scene.add(key);
    // track
    const track = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 30), new THREE.MeshStandardMaterial({ color: 0x151c2e, roughness: 0.6, metalness: 0.3 }));
    track.rotation.x = -Math.PI / 2; track.position.z = -12; this.scene.add(track);
    this.lines = [];
    for (let i = 0; i < 30; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.02), new THREE.MeshBasicMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.35 }));
      l.rotation.x = -Math.PI / 2; l.position.set(0, 0.002, -i); this.scene.add(l); this.lines.push(l);
    }
    [-1.1, 1.1].forEach((x) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 30), new THREE.MeshBasicMaterial({ color: 0x3987e5 }));
      rail.position.set(x, 0.02, -12); this.scene.add(rail);
    });
    // hit ring
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 12, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.ring.position.set(0, 1.0, 0); this.scene.add(this.ring);
    this.ringGlow = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 12, 64), new THREE.MeshBasicMaterial({ color: 0x1baf7a, transparent: true, opacity: 0 }));
    this.ringGlow.position.copy(this.ring.position); this.scene.add(this.ringGlow);
    // feedback hand
    this.hand = createHand({ forearm: true });
    this.hand.root.scale.setScalar(3.2);
    this.hand.root.position.set(1.55, 0.55, 0.6);
    this.hand.root.rotation.set(0, Math.PI / 2 + 0.5, 0.35);
    this.scene.add(this.hand.root);
    this.textures = Object.fromEntries(Object.keys(G).map((k) => [k, cardTexture(k)]));
    this.cards = [];
    this.groove = new Groove(84);
    this.particles = [];
  }

  start() {
    this.stats = { notes: 0, perfect: 0, good: 0, miss: 0, wrong: 0, rts: [], byGesture: { close: [], open: [], pinch: [] }, conf: {} };
    this.cards.forEach((c) => this.scene.remove(c.mesh)); this.cards = [];
    this.bpm = 60; this.groove.setBpm(this.bpm); this.groove.start();
    this.t0 = performance.now() / 1000; this.nextNote = this.t0 + 3.5; this.total = 20; this.spawned = 0;
    this.combo = 0; this.score = 0; this.done = false;
    this.lastState = 'rest'; this.onsets = []; this.armed = { close: true, open: true, pinch: true };
    this.speed = 3.5;   // m/s (slow: the card is visible for ~3 s)
    this.hud.toast('Make the gesture when the card reaches the ring', 'slow start · relax your hand between cards');
  }

  spawn(time) {
    const kinds = Object.keys(G);
    let kind = kinds[Math.floor(Math.random() * 3)];
    if (this.cards.length && this.cards[this.cards.length - 1].kind === kind && Math.random() < 0.6) kind = kinds[(kinds.indexOf(kind) + 1) % 3];
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicMaterial({ map: this.textures[kind], transparent: true }));
    this.scene.add(mesh);
    this.cards.push({ kind, mesh, T: time, state: 'live' });
    this.spawned += 1;
  }

  update(dt, input) {
    const now = performance.now() / 1000;
    input.driveHand(this.hand); this.hand.update(dt);
    // onset tracking
    if (input.state !== this.lastState) {
      this.onsets.push({ g: input.state, t: now });
      if (this.onsets.length > 20) this.onsets.shift();
      this.lastState = input.state;
    }
    // spawn on the beat (a card every 3 beats = 3 s at the start)
    const spacing = (60 / this.bpm) * 3;
    while (this.spawned < this.total && this.nextNote - now < 3.5) { this.spawn(this.nextNote); this.nextNote += spacing; }
    // move cards
    for (const c of this.cards) {
      const dz = c.state === 'live' ? (c.T - now) * this.speed : 0;   // judged cards stay at the ring (no giant card in your face)
      c.mesh.position.set(0, 1.0, -dz);
      c.mesh.material.opacity = THREE.MathUtils.clamp(1.2 - dz / 12, 0, 1);
      if (c.state !== 'live') continue;
      // generous window: gesture started between 0.8 s early and 1.0 s late, and still held
      const on = this.onsets.find((o) => o.g === c.kind && o.t >= c.T - 0.8 && o.t <= c.T + 1.0 && !o.used);
      const wrong = this.onsets.find((o) => o.g !== c.kind && o.g !== 'rest' && o.t >= c.T - 0.3 && o.t <= c.T + 0.8 && !o.used && now - o.t > 0.35 && input.state === o.g);
      if (on && now - on.t >= 0.08 && input.state === c.kind && now >= c.T - 0.35) {
        on.used = true;
        const rt = on.t - c.T;
        const perfect = rt >= -0.4 && rt <= 0.45;
        this.judge(c, perfect ? 'perfect' : 'good', rt);
      } else if (wrong) {
        wrong.used = true; this.judge(c, 'wrong', null, wrong.g);
      } else if (now > c.T + 1.0) {
        this.judge(c, 'miss', null);
      }
    }
    this.cards = this.cards.filter((c) => {
      if (c.state !== 'live' && now - c.judgedAt > 0.45) { this.scene.remove(c.mesh); return false; }
      if (c.state !== 'live') { c.mesh.scale.multiplyScalar(c.state === 'miss' || c.state === 'wrong' ? 0.95 : 1.02); c.mesh.material.opacity *= 0.85; }
      return true;
    });
    // track motion + ring glow
    const offset = (now * this.speed) % 1;
    this.lines.forEach((l, i) => { l.position.z = -i + offset; });
    this.ringGlow.material.opacity *= Math.pow(0.02, dt);
    this.particles = this.particles.filter((p) => { p.v.y -= 6 * dt; p.m.position.addScaledVector(p.v, dt); p.m.material.opacity -= dt * 1.5; if (p.m.material.opacity <= 0) { this.scene.remove(p.m); return false; } return true; });
    this.hud.timer(Math.max(0, now - this.t0));
    this.hud.hint(`card ${Math.min(this.spawned, this.total)} / ${this.total} · combo ${this.combo} · ${this.bpm} bpm`);
    this.hud.score(this.score);
    if (!this.done && this.spawned >= this.total && this.cards.length === 0) { this.done = true; this.groove.stop(); setTimeout(() => this.hud.finish(this.summary()), 600); }
  }

  judge(c, result, rt, got) {
    c.state = result; c.judgedAt = performance.now() / 1000; this.stats.notes += 1;
    if (result === 'perfect' || result === 'good') {
      this.combo += 1; this.stats[result] += 1; this.stats.rts.push(rt); this.stats.byGesture[c.kind].push(rt);
      this.score += (result === 'perfect' ? 100 : 60) * (1 + Math.min(4, Math.floor(this.combo / 5)) * 0.25);
      result === 'perfect' ? sfx.perfect() : sfx.good();
      this.ringGlow.material.color.set(result === 'perfect' ? 0x1baf7a : 0xeda100); this.ringGlow.material.opacity = 0.9;
      this.burst(G[c.kind].color);
      this.hud.toast(result === 'perfect' ? 'PERFECT' : 'GOOD', `${Math.round(rt * 1000)} ms`, 'ok');
    } else {
      this.combo = 0; this.stats[result] += 1;
      if (result === 'wrong') { const k = `${c.kind}->${got}`; this.stats.conf[k] = (this.stats.conf[k] || 0) + 1; }
      sfx.miss();
      this.ringGlow.material.color.set(0xe34948); this.ringGlow.material.opacity = 0.7;
      this.hud.toast(result === 'wrong' ? `WRONG (${got})` : 'MISS', `needed ${G[c.kind].label}`, 'bad');
    }
    this.hud.event({ ev: 'note', need: c.kind, result, rt_ms: rt != null ? Math.round(rt * 1000) : null, got: got || null, bpm: this.bpm });
    // adapt speed gently: every 5 cards, a bit faster if accuracy > 85 %, slower if < 60 %
    if (this.stats.notes % 5 === 0) {
      const recent = this.stats.perfect + this.stats.good, acc = recent / this.stats.notes;
      this.bpm = Math.round(THREE.MathUtils.clamp(this.bpm + (acc > 0.85 ? 6 : acc < 0.6 ? -6 : 0), 50, 90));
      this.groove.setBpm(this.bpm);
    }
  }

  burst(color) {
    for (let k = 0; k < 18; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.copy(this.ring.position); this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ m, v: new THREE.Vector3(Math.cos(a) * 2, Math.sin(a) * 2 + 1, 0.5) });
    }
  }

  summary() {
    const s = this.stats, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const acc = s.notes ? (s.perfect + s.good) / s.notes : 0;
    const per = Object.fromEntries(Object.entries(s.byGesture).map(([k, v]) => [k, mean(v) != null ? Math.round(mean(v) * 1000) : null]));
    return { level: this.key, title: this.name, score: Math.round(this.score), stars: acc >= 0.85 ? 3 : acc >= 0.6 ? 2 : 1,
      accuracy: acc, perfect: s.perfect, good: s.good, miss: s.miss, wrong: s.wrong,
      mean_rt_ms: mean(s.rts) != null ? Math.round(mean(s.rts) * 1000) : null, rt_by_gesture_ms: per, confusions: s.conf, final_bpm: this.bpm,
      lines: [`Accuracy: ${Math.round(acc * 100)}% (${s.perfect} perfect, ${s.good} good, ${s.miss} miss, ${s.wrong} wrong)`,
        `Mean reaction: ${mean(s.rts) != null ? Math.round(mean(s.rts) * 1000) : '-'} ms (fist ${per.close ?? '-'}, open ${per.open ?? '-'}, pinch ${per.pinch ?? '-'})`,
        `Final speed: ${this.bpm} bpm`] };
  }

  stop() { this.done = true; this.groove.stop(); }
}
