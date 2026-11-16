// "Match it" game, from Smit's MatchIt design, built for the Lab (same hand, grip and rules as the other games).
//   Round 1  colour        : a cube in one colour             -> pad with the SAME colour
//   Round 2  shape         : cube, ball, triangle, ...         -> outline with the SAME shape
//   Round 3  colour + shape: e.g. a red triangle               -> the RED TRIANGLE (not the red circle, not the blue triangle)
// Close = grab, carry, open = drop. Targets change places for every object. Green over the right target, orange over a wrong one;
// wrong target or dropped -> the object comes back. Level 1-3 (3, 4 or 5 targets, smaller and closer); after a game the level
// goes up (>= 80 % right, at most 1 drop) or down (< 50 %). Sounds, stars and a result screen with the last game for comparison.
import * as THREE from 'three';
import { DropGuide } from './game/dropguide.js?v=1794717000';
import { reachSpot, handAt, ReachMarker, roundList, REACH_WINDOW, REACH_GAP, DWELL_S } from './game/reach.js?v=1794717000';
import { sfx, audio } from './game/audio.js?v=1794717000';

const N_PER_ROUND = 5;
const HOLD_MS = 300, GRAB_WINDOW = 8.0, CARRY_TIME = 0.6, PLACE_WINDOW = 14.0;
const TABLE_Y = -0.09;
const LEVELS = {
  1: { n: 3, offs: [0.09, 0.19, 0.29], scale: 1.6, tol: 0.05, name: 'Level 1 · 3 big targets' },
  2: { n: 4, offs: [0.08, 0.155, 0.23, 0.305], scale: 1.3, tol: 0.04, name: 'Level 2 · 4 targets' },
  3: { n: 5, offs: [0.07, 0.13, 0.19, 0.25, 0.31], scale: 1.05, tol: 0.032, name: 'Level 3 · 5 small targets' },
};
const GREEN = 0x1baf7a, ORANGE = 0xeb7a1c, GREY = 0x6b7480;
const COLOURS = {
  red:    { hex: 0xd9362b, name: 'Red',    icon: '🟥' },
  blue:   { hex: 0x2a78d6, name: 'Blue',   icon: '🟦' },
  yellow: { hex: 0xf0b400, name: 'Yellow', icon: '🟨' },
  green:  { hex: 0x22a35a, name: 'Green',  icon: '🟩' },
  purple: { hex: 0x8a4fd1, name: 'Purple', icon: '🟪' },
};
const COLOUR_KEYS = Object.keys(COLOURS);
const SHAPES = {
  square:   { label: 'Square',   icon: '◻', obj: 'Cube',     hex: 0x2a78d6, r: 0.017 },
  circle:   { label: 'Circle',   icon: '◯', obj: 'Ball',     hex: 0x1baf7a, r: 0.018 },
  triangle: { label: 'Triangle', icon: '△', obj: 'Triangle', hex: 0xe0552b, r: 0.017 },
  hexagon:  { label: 'Hexagon',  icon: '⬡', obj: 'Hexagon',  hex: 0x8a4fd1, r: 0.017 },
  pentagon: { label: 'Pentagon', icon: '⬠', obj: 'Pentagon', hex: 0xf0b400, r: 0.017 },
};
const SHAPE_KEYS = Object.keys(SHAPES);
const ROUND_INFO = {
  1: { title: 'Round 1 · COLOUR', sub: 'put the cube on the pad with the same colour', icon: '🎨' },
  2: { title: 'Round 2 · SHAPE', sub: 'put it into the outline with the same shape', icon: '🔷' },
  3: { title: 'Round 3 · COLOUR + SHAPE', sub: 'both must match: a red triangle goes on the RED TRIANGLE', icon: '🎯' },
  4: { title: 'Round 4 · PICK IT UP YOURSELF', sub: 'the object lies on the table: go to it, close, put it on the right target', icon: '🖐' },
};
const closed = (st) => !['open', 'rest', 'lost'].includes(st);
const opened = (st) => ['open', 'rest'].includes(st);
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };
const snd = (k) => { try { sfx[k] && sfx[k](); } catch { /* no sound */ } };

function polyShape(pts) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }
function frameGeo(pts, k) {
  const s = polyShape(pts), h = new THREE.Path();
  pts.forEach(([x, y], i) => (i ? h.lineTo(x * k, y * k) : h.moveTo(x * k, y * k))); h.closePath(); s.holes.push(h);
  return new THREE.ShapeGeometry(s);
}
const ngon = (n, r, rot = 90) => Array.from({ length: n }, (_, i) => { const a = ((rot + (i * 360) / n) * Math.PI) / 180; return [Math.cos(a) * r, Math.sin(a) * r]; });
function outlinePoints(kind) {
  if (kind === 'circle') return ngon(40, 0.026);
  if (kind === 'triangle') return ngon(3, 0.031);
  if (kind === 'hexagon') return ngon(6, 0.028, 0);
  if (kind === 'pentagon') return ngon(5, 0.029);
  if (kind === 'square') return [[-0.023, -0.023], [0.023, -0.023], [0.023, 0.023], [-0.023, 0.023]];
  return [[-0.028, -0.022], [0.028, -0.022], [0.028, 0.022], [-0.028, 0.022]];
}
function makeObject(kind, hex) {
  const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35, metalness: 0.05 });
  let geo;
  if (kind === 'circle') geo = new THREE.SphereGeometry(SHAPES.circle.r, 28, 20);
  else if (kind === 'triangle') geo = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 3);
  else if (kind === 'hexagon') geo = new THREE.CylinderGeometry(0.019, 0.019, 0.03, 6);
  else if (kind === 'pentagon') geo = new THREE.CylinderGeometry(0.019, 0.019, 0.03, 5);
  else geo = new THREE.BoxGeometry(0.032, 0.032, 0.032);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  if (kind !== 'circle') m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 })));
  return m;
}

export class MatchGame {
  constructor(scene, hand, ui, send, opts = {}) {
    this.scene = scene; this.hand = hand; this.ui = ui; this.send = send;
    this.tips = opts.tips || null;
    this.mirrored = opts.mirrored || (() => false);
    this.sideX = opts.basketX || (() => 0.265);
    this.spawnX = opts.spawnX || (() => 0.5);
    this.camera = opts.camera || (() => null);
    this.active = false; this.phase = 'idle';
    this.group = new THREE.Group(); scene.add(this.group);
    this.padGroup = new THREE.Group(); this.group.add(this.padGroup);
    this.fx = [];
    this.guide = new DropGuide(this.group, TABLE_Y);
    this.pads = []; this.item = null; this.stateSince = performance.now(); this.lastState = 'rest';
    this.level = store.get('lab_match_level_v1', 1);
    this.rounds = this.emptyRounds(); this.round = 1; this.itemNo = 0; this.rs = this.rounds[0];
    this.marker = new ReachMarker(this.group); this.roundSel = 'all'; this.rlist = [1, 2, 3, 4]; this.rix = 0;
  }

  emptyRounds() { return [1, 2, 3, 4].map((n) => ({ n, items: 0, attempts: 0, correct: 0, wrong: 0, drops: 0, timeouts: 0, dists: [], grab: [], move: [], release: [] })); }
  armLift() { return 0; }
  holdRadius() { return this.item && ['carry', 'place'].includes(this.phase) ? this.item.r : 0; }
  holdWrap() { return this.holdRadius() ? 0.95 : 0; }
  holdCurls() { return this.holdRadius() ? [0.72, 0.6, 0.6, 0.62, 0.64] : null; }
  L() { return LEVELS[this.level] || LEVELS[1]; }

  start() {
    try { audio(); } catch { /* no sound */ }
    this.active = true; this.rounds = this.emptyRounds();
    this.level = store.get('lab_match_level_v1', 1);
    this.ui.end && this.ui.end(null);
    this.send({ cmd: 'game', ev: 'start', game: 'match', level: this.level });
    this.rlist = roundList(this.roundSel, 4); this.rix = 0;
    this.startRound(this.rlist[0]);
  }

  stop() {
    this.marker.hide();
    this.active = false; this.phase = 'idle';
    this.clearPads(); if (this.item) { this.group.remove(this.item.mesh); this.item = null; }
    this.fx.forEach((f) => f.dispose && f.dispose()); this.fx = [];
    this.guide.hide(); this.ui.banner(null); this.ui.extra && this.ui.extra(null); this.ui.intro && this.ui.intro(null);
    this.send({ cmd: 'game', ev: 'stop', game: 'match', ...this.summary() });
    this.ui.stats(this.summary());
  }

  startRound(n) {
    this.round = n; this.itemNo = 0; this.rs = this.rounds[n - 1];
    const L = this.L();
    const cols = COLOUR_KEYS.slice(0, L.n), shps = SHAPE_KEYS.slice(0, L.n);
    const pool = (keys) => shuffle(Array.from({ length: N_PER_ROUND }, (_, i) => keys[i % keys.length]));
    if (n === 1) this.queue = pool(cols).map((c) => ({ kind: 'square', colour: c, shape: null, hex: COLOURS[c].hex, r: 0.017, say: `${COLOURS[c].icon} ${COLOURS[c].name} cube` }));
    else if (n === 2) this.queue = pool(shps).map((s) => ({ kind: s, colour: null, shape: s, hex: SHAPES[s].hex, r: SHAPES[s].r + 0.001, say: `${SHAPES[s].icon} ${SHAPES[s].obj}` }));
    else this.queue = Array.from({ length: N_PER_ROUND }, () => { const c = pick(cols.slice(0, 3)), s = pick(shps.slice(0, 3));
      return { kind: s, colour: c, shape: s, hex: COLOURS[c].hex, r: SHAPES[s].r + 0.001, say: `${COLOURS[c].icon} ${COLOURS[c].name} ${SHAPES[s].label.toLowerCase()}` }; });
    if (n < 3) this.buildPads(n === 1 ? cols.map((c) => ({ colour: c })) : shps.map((s) => ({ shape: s })));
    else this.clearPads();
    const I = ROUND_INFO[n];
    this.marker.hide();
    this.ui.intro && this.ui.intro(`<div class="ri-icon">${I.icon}</div><div class="ri-t">${I.title}</div><div class="ri-s">${I.sub}</div><div class="ri-l">${L.name} · ${N_PER_ROUND} objects</div>`);
    this.ui.banner(null);
    snd('star');
    this.phase = 'pause'; this.t0 = performance.now(); this.pauseS = 2.2; this.nextIsNew = true;
    this.showRound();
  }

  clearPads() { this.pads.forEach((p) => this.padGroup.remove(p.group)); this.pads = []; }

  buildPads(targets) {
    this.clearPads();
    const sc = this.round === 4 ? 1.25 : this.L().scale;   // round 4: 3 big targets
    targets.forEach((tg) => {
      const pts = outlinePoints(tg.shape || 'pad');
      const group = new THREE.Group();
      const idle = tg.colour ? COLOURS[tg.colour].hex : GREY;
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.031, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.0008; group.add(base);
      const rimMat = new THREE.MeshBasicMaterial({ color: idle, side: THREE.DoubleSide });
      const rim = new THREE.Mesh(frameGeo(pts, tg.shape ? 0.7 : 0.78), rimMat); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.0025; group.add(rim);
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(polyShape(pts)), new THREE.MeshStandardMaterial({
        color: tg.colour ? COLOURS[tg.colour].hex : 0xb5b9bf, transparent: true, opacity: tg.colour ? 0.35 : 0.25, roughness: 0.9, side: THREE.DoubleSide }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.0016; fill.receiveShadow = true; group.add(fill);
      group.scale.setScalar(sc);
      this.padGroup.add(group);
      this.pads.push({ key: `${tg.colour || ''}|${tg.shape || ''}`, colour: tg.colour, shape: tg.shape, group, rimMat, idle, pos: new THREE.Vector3(), sc, shaking: false });
    });
    this.shufflePads();
  }

  comboPads(it) {
    const n = this.round === 4 ? 3 : this.L().n, cols = COLOUR_KEYS.slice(0, Math.max(3, n)), shps = SHAPE_KEYS.slice(0, Math.max(3, n));
    const list = [{ colour: it.colour, shape: it.shape }];
    const add = (t) => { if (!list.some((x) => x.colour === t.colour && x.shape === t.shape)) list.push(t); };
    add({ colour: it.colour, shape: pick(shps.filter((s) => s !== it.shape)) });
    add({ colour: pick(cols.filter((c) => c !== it.colour)), shape: it.shape });
    while (list.length < n) add({ colour: pick(cols), shape: pick(shps) });
    this.buildPads(list.slice(0, n));
  }

  shufflePads() {
    const palm = 0.105, dir = this.sideX() > palm ? 1 : -1, offs = this.round === 4 ? [0.15, 0.225, 0.30] : this.L().offs,   // round 4: targets further out, the object lies in front of the hand
      order = shuffle(offs.map((_, i) => i));
    this.padDir = dir;
    this.pads.forEach((p, i) => { p.pos.set(palm + dir * offs[order[i]], TABLE_Y + 0.001, 0.0); p.group.position.copy(p.pos); });
  }

  showRound() {
    const R = this.rs, dots = Array.from({ length: N_PER_ROUND }, (_, i) => (i < R.correct ? '●' : '○')).join('');
    this.ui.extra && this.ui.extra(`🎯 L${this.level} · Round ${this.round}${this.rlist.length > 1 ? ` (${this.rix + 1}/${this.rlist.length})` : ''} ${dots}`);
  }

  isRight(pad, it) { return (!it.colour || pad.colour === it.colour) && (!it.shape || pad.shape === it.shape); }
  targetPad() { return this.pads.find((p) => this.isRight(p, this.item)); }
  padName(p) {
    if (p.colour && p.shape) return `${COLOURS[p.colour].name.toUpperCase()} ${SHAPES[p.shape].label.toUpperCase()}`;
    return p.colour ? COLOURS[p.colour].name.toUpperCase() : `${SHAPES[p.shape].icon} ${SHAPES[p.shape].label.toLowerCase()}`;
  }

  nextItem(again = false) {
    if (!this.active) return;
    this.ui.intro && this.ui.intro(null);
    if (!again) {
      if (this.itemNo >= N_PER_ROUND) {
        if (this.rix < this.rlist.length - 1) { this.rix += 1; return this.startRound(this.rlist[this.rix]); }
        return this.finishGame();
      }
      this.itemDef = this.queue[this.itemNo]; this.itemNo += 1; this.rs.items += 1;
    }
    if (this.item) this.group.remove(this.item.mesh);
    const mesh = makeObject(this.itemDef.kind, this.itemDef.hex);
    mesh.position.set(this.spawnX(), 0.13, 0); mesh.scale.setScalar(0.01); this.group.add(mesh);   // drops in from above the hand
    this.item = { ...this.itemDef, mesh, from: mesh.position.clone() };
    if (this.round >= 3 && !again) this.comboPads(this.item);
    else if (!again) this.shufflePads();
    this.phase = 'approach'; this.t0 = performance.now(); this.spawnT = this.t0;
    if (this.round === 4) { mesh.scale.setScalar(1); const dir = this.sideX() > 0.105 ? 1 : -1, first = this.pads.reduce((m, p) => (dir > 0 ? Math.min(m, p.pos.x) : Math.max(m, p.pos.x)), dir * 9);
      mesh.position.copy(reachSpot(this.sideX(), this.item.r, this.itemNo - 1, this.tips ? this.tips().palmMid.x : undefined, first - dir * (0.03 + REACH_GAP * 0.8))); this.phase = 'reach'; }
    snd('pop');
    this.ui.banner(`${this.item.say}: grab it ✊`, 'arriving...');
    this.ui.stats(this.summary()); this.showRound();
  }

  padAt(p) {
    let best = null, bd = 1e9;
    for (const pad of this.pads) { const d = Math.abs(p.x - pad.pos.x); if (d < bd) { bd = d; best = pad; } }   // the object drops straight down
    return bd < (this.round === 4 ? 0.042 : this.L().tol) ? best : null;
  }

  gripPoint() {
    const r = this.item ? this.item.r : 0.017;
    if (this.tips) {
      const t = this.tips();
      if (!['carry', 'place'].includes(this.phase)) return t.palmMid.clone().addScaledVector(t.palmOut, r + 0.022);
      const c = t.thumb.clone().multiplyScalar(0.4).addScaledVector(t.index, 0.3).addScaledVector(t.middle, 0.3);
      const out = c.clone().sub(t.palmMid).dot(t.palmOut);
      if (out < r + 0.008) c.addScaledVector(t.palmOut, r + 0.008 - out);
      return c;
    }
    return new THREE.Vector3(this.hand.position.x + 0.1, -0.05, 0);
  }

  summary() {
    const [a, b, c, e] = this.rounds, pct = (r) => (r.attempts ? r.correct / r.attempts : 0);
    const all = this.rounds.reduce((s, r) => ({ c: s.c + r.correct, n: s.n + r.attempts, d: s.d + r.drops, t: s.t + r.timeouts }), { c: 0, n: 0, d: 0, t: 0 });
    const f = (k) => this.rounds.flatMap((r) => r[k]);
    const rate = all.n ? all.c / all.n : 0;
    return { game: 'match', level: this.level, round: this.round, trials: all.n + all.d + all.t, success: all.c, success_rate: rate,
      match_pct_colour: pct(a), match_pct_shape: pct(b), match_pct_combo: pct(c), match_pct_reach: pct(e), wrong_colour: a.wrong, wrong_shape: b.wrong, wrong_combo: c.wrong + e.wrong,
      drops: all.d, timeouts: all.t, mean_dist_cm: mean(f('dists')), mean_grab_s: mean(f('grab')), mean_move_s: mean(f('move')), mean_release_s: mean(f('release')),
      stars: rate >= 0.9 && all.d <= 1 ? 3 : rate >= 0.7 ? 2 : 1 };
  }

  finishGame() {
    this.phase = 'over'; this.guide.hide(); this.ui.banner(null); this.clearPads();
    const s = this.summary(), hist = store.get('lab_match_history_v1', []), last = hist.length ? hist[hist.length - 1] : null;
    let next = this.level, lvlMsg = `you stay on level ${this.level}`;
    if (s.success_rate >= 0.8 && s.drops <= 1 && this.level < 3) { next = this.level + 1; lvlMsg = `⬆ next game: level ${next} (more, smaller targets)`; }
    else if (s.success_rate < 0.5 && this.level > 1) { next = this.level - 1; lvlMsg = `⬇ next game: level ${next} (easier)`; }
    else if (this.level === 3 && s.success_rate >= 0.8) lvlMsg = '🏆 top level, well done!';
    store.set('lab_match_level_v1', next);
    hist.push({ date: new Date().toISOString(), ...s }); store.set('lab_match_history_v1', hist.slice(-50));
    const pc = (v) => `${Math.round(v * 100)}%`, sec = (v) => (v != null ? `${v.toFixed(1)} s` : '-'), cm = (v) => (v != null ? `${v.toFixed(1)} cm` : '-');
    const bar = (v, label) => `<div class="eb"><span>${label}</span><div class="ebar"><i style="width:${Math.round(v * 100)}%"></i></div><b>${pc(v)}</b></div>`;
    let cmp = 'first game: this is your starting point';
    if (last) {
      const d = s.success_rate - last.success_rate, dt = (last.mean_grab_s && s.mean_grab_s) ? last.mean_grab_s - s.mean_grab_s : 0;
      cmp = d > 0.001 ? `📈 better than last time: +${Math.round(d * 100)}% right` : d < -0.001 ? `last time ${pc(last.success_rate)} right: try again!` : 'same score as last time';
      if (dt > 0.05) cmp += ` · grabbing ${dt.toFixed(1)} s faster`;
    }
    this.ui.end && this.ui.end(`
      <div class="ec-stars">${'<span class="on">⭐</span>'.repeat(s.stars)}${'<span class="dim">⭐</span>'.repeat(3 - s.stars)}</div>
      <div class="ec-t">Match it · Level ${this.level} done!</div>
      <div class="ec-cmp">${cmp}</div>
      ${[[1, s.match_pct_colour, '🎨 Colour'], [2, s.match_pct_shape, '🔷 Shape'], [3, s.match_pct_combo, '🎯 Colour + shape'], [4, s.match_pct_reach, '🖐 Pick it up']].filter(([n]) => this.rlist.includes(n)).map(([, v, l]) => bar(v, l)).join('')}
      <div class="ec-grid"><div><b>${cm(s.mean_dist_cm)}</b><span>from centre</span></div><div><b>${sec(s.mean_grab_s)}</b><span>grab</span></div>
        <div><b>${sec(s.mean_move_s)}</b><span>move</span></div><div><b>${sec(s.mean_release_s)}</b><span>release</span></div>
        <div><b>${s.wrong_colour + s.wrong_shape + s.wrong_combo}</b><span>wrong target</span></div><div><b>${s.drops}</b><span>drops</span></div></div>
      <div class="ec-lvl">${lvlMsg}</div>`);
    snd(s.stars === 3 ? 'win' : 'perfect');
    this.ui.extra && this.ui.extra(`🎯 L${this.level} · done ${'⭐'.repeat(s.stars)}`);
    this.ui.stats(s); this.send({ cmd: 'game', ev: 'done', game: 'match', next_level: next, ...s });
  }

  burst(pos, hex) {
    const g = new THREE.Group(); g.position.copy(pos); this.group.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 40), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; g.add(ring);
    const bits = Array.from({ length: 14 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005), new THREE.MeshBasicMaterial({ color: i % 2 ? hex : 0xffd54a, transparent: true }));
      const a = (i / 14) * Math.PI * 2; m.userData.v = new THREE.Vector3(Math.cos(a) * 0.12, 0.25 + Math.random() * 0.15, Math.sin(a) * 0.12);
      g.add(m); return m;
    });
    const t0 = performance.now();
    this.fx.push({ step: () => {
      const t = (performance.now() - t0) / 1000;
      ring.scale.setScalar(1 + t * 5); ring.material.opacity = Math.max(0, 1 - t * 1.6);
      bits.forEach((m) => { m.position.set(m.userData.v.x * t, m.userData.v.y * t - 0.6 * t * t, m.userData.v.z * t); m.rotation.x += 0.2; m.material.opacity = Math.max(0, 1 - t * 1.2); });
      return t < 0.9;
    }, dispose: () => this.group.remove(g) });
  }

  shake(pad) {
    const x0 = pad.pos.x, t0 = performance.now(); pad.shaking = true;
    this.fx.push({ step: () => {
      const t = (performance.now() - t0) / 1000;
      pad.group.position.x = x0 + Math.sin(t * 60) * 0.004 * Math.max(0, 1 - t * 2.5);
      pad.rimMat.color.setHex(ORANGE);
      return t < 0.5;
    }, dispose: () => { pad.group.position.x = pad.pos.x; pad.rimMat.color.setHex(pad.idle); pad.shaking = false; } });
  }

  update(state) {
    const now = performance.now();
    this.fx = this.fx.filter((f) => { const on = f.step(); if (!on) f.dispose && f.dispose(); return on; });
    if (state !== this.lastState) { this.lastState = state; this.stateSince = now; }
    const held = now - this.stateSince >= HOLD_MS;
    if (this.pads.length && this.padDir !== (this.sideX() > 0.105 ? 1 : -1)) {   // you changed hands: targets and the object on the table move to the new side
      this.shufflePads();
      if (this.phase === 'reach' && this.item) {
        const dir = this.padDir, first = this.pads.reduce((m, p) => (dir > 0 ? Math.min(m, p.pos.x) : Math.max(m, p.pos.x)), dir * 9);
        this.item.mesh.position.copy(reachSpot(this.sideX(), this.item.r, this.itemNo - 1, undefined, first - dir * (0.03 + REACH_GAP * 0.8)));
      }
    }
    if (!this.active || this.phase === 'over') return;
    if (this.phase === 'pause') { if ((now - this.t0) / 1000 > (this.pauseS || 1.2)) { const again = !this.nextIsNew; this.nextIsNew = true; this.nextItem(again); } return; }
    if (!this.item) return;
    const it = this.item, t = (now - this.t0) / 1000, grip = this.gripPoint();
    const carrying = ['carry', 'place'].includes(this.phase);
    const over = carrying && this.mirrored() ? this.padAt(it.mesh.position) : null;
    const pulse = 1 + 0.08 * Math.sin(now / 90);
    this.pads.forEach((pad) => {
      if (pad.shaking) return;
      const right = over === pad && this.isRight(pad, it);
      pad.rimMat.color.setHex(over === pad ? (right ? GREEN : ORANGE) : pad.idle);
      pad.group.scale.setScalar(pad.sc * (over === pad ? (right ? 1.12 * pulse : 1.06) : 1));
    });
    if (!carrying) this.guide.hide();
    if (this.phase !== 'reach') this.marker.hide();
    switch (this.phase) {
      case 'reach': {   // round 4: the object lies on the table, go to it and close the hand
        const at = handAt(grip, it.mesh.position, it.r); if (at) this.nearT = now;
        const near = now - (this.nearT || 0) < 900;   // closing the hand may move it a little: 'at the object' stays true for 0.9 s
        this.marker.show(it.mesh.position, it.r, near);
        this.ui.banner(near ? `${it.say}: CLOSE your hand ✊` : `${it.say}: move your hand to it`, `pick it up yourself · ${Math.max(0, REACH_WINDOW - t).toFixed(1)} s`, false, near);
        if (held && this.stateSince >= this.t0 && near && closed(state)) {
          this.grabS = (now - this.spawnT) / 1000; this.grabNow = now; this.firstOverT = 0; this.marker.hide();
          this.phase = 'carry'; this.t0 = now; this.ui.banner('Hold it...', 'keep the grasp'); snd('grab');
        } else if (t > REACH_WINDOW) { this.marker.hide(); this.rs.timeouts += 1; this.fail('Too slow', 'it comes back, try again'); }
        break;
      }
      case 'approach': {
        const a = Math.min(1, t / 1.2), e = a * a * (3 - 2 * a);
        it.mesh.position.lerpVectors(it.from, grip, e);
        it.mesh.scale.setScalar(Math.min(1, 0.01 + t * 4));
        it.mesh.rotation.y = (1 - e) * 3;
        if (a >= 1) { this.phase = 'grab'; this.t0 = now; it.mesh.rotation.y = 0; }
        break;
      }
      case 'grab': {
        it.mesh.position.copy(grip).add(new THREE.Vector3(0, Math.sin(now / 160) * 0.002, 0));
        it.mesh.scale.setScalar(1 + 0.05 * Math.sin(now / 120));
        this.ui.banner(`${it.say}: grab it ✊`, `close your hand · ${Math.max(0, GRAB_WINDOW - t).toFixed(1)} s`);
        if (held && this.stateSince >= this.t0 && closed(state)) {
          it.mesh.scale.setScalar(1);
          this.grabS = (now - this.spawnT) / 1000; this.grabNow = now; this.firstOverT = 0;
          this.phase = 'carry'; this.t0 = now; this.ui.banner('Hold it...', 'keep the grasp');
          snd('grab');
        } else if (t > GRAB_WINDOW) { this.rs.timeouts += 1; this.fail('Too slow', 'it comes back, grab it again'); }
        break;
      }
      case 'carry': {
        it.mesh.position.copy(grip);
        if (state === 'open' && now - this.stateSince > 300) { this.rs.drops += 1; this.fail('Dropped', 'open your hand only over the target'); }
        else if (t > CARRY_TIME) { this.phase = 'place'; this.t0 = now; }
        break;
      }
      case 'place': {
        it.mesh.position.copy(grip);
        const tp = this.targetPad(), dx = tp.pos.x - it.mesh.position.x, tn = this.padName(tp);
        const right = !this.mirrored() || (over && this.isRight(over, it));
        if (over && !this.firstOverT) this.firstOverT = now;
        const land = new THREE.Vector3(it.mesh.position.x, TABLE_Y, tp.pos.z);   // straight down onto the target row
        this.guide.showTo(it.mesh.position.clone().setY(it.mesh.position.y - it.r), land, !!right && this.mirrored());
        let title;
        if (!this.mirrored()) title = 'Now OPEN your hand';
        else if (!over) title = `Move it ${dx > 0 ? 'right →' : '← left'} to the ${tn}`;
        else if (right) title = `Over the ${tn}: OPEN your hand 🖐`;
        else title = `That is the ${this.padName(over)}, find the ${tn}`;
        this.ui.banner(title, this.overT ? `or hold still: drops in ${Math.max(0, DWELL_S - (now - this.overT) / 1000).toFixed(1)} s` : `Round ${this.round} · ${this.itemNo} of ${N_PER_ROUND} · ${Math.max(0, PLACE_WINDOW - t).toFixed(1)} s`, false, !!right && this.mirrored());
        // over the RIGHT target and held still for DWELL_S: drops by itself (never on a wrong target)
        if (over && right && this.mirrored()) { if (!this.overT) this.overT = now; } else this.overT = 0;
        if (this.overT && now - this.overT > DWELL_S * 1000) { this.overT = 0; this.release(over); }
        else if (held && opened(state)) { this.overT = 0; this.release(over); }
        else if (t > PLACE_WINDOW) { this.rs.timeouts += 1; this.fail('Too slow', 'it comes back, try again'); }
        break;
      }
      default: break;
    }
  }

  release(over) {
    const now = performance.now(), it = this.item, R = this.rs;
    const target = this.mirrored() ? over : this.targetPad();
    if (!target) { R.drops += 1; return this.fail('Dropped', 'open your hand only over the target'); }
    R.attempts += 1;
    const ok = this.isRight(target, it);
    const dist = Math.abs(it.mesh.position.x - target.pos.x) * 100;
    const moveS = ((this.firstOverT || now) - this.grabNow) / 1000, relS = (now - (this.firstOverT || now)) / 1000;
    this.send({ cmd: 'game', ev: 'trial', game: 'match', level: this.level, round: this.round, item: it.say, placed: target.key, ok,
      dist_cm: +dist.toFixed(2), grab_s: +this.grabS.toFixed(3), move_s: +moveS.toFixed(3), release_s: +relS.toFixed(3),
      result: ok ? 'success' : ['wrong_colour', 'wrong_shape', 'wrong_combo', 'wrong_combo'][this.round - 1] });
    if (!ok) {
      R.wrong += 1; this.shake(target); snd('wrong');
      return this.fail(['Wrong colour', 'Wrong shape', 'Not this one', 'Not this one'][this.round - 1], `that is the ${this.padName(target)} · it comes back, try again`, true);
    }
    R.correct += 1; R.dists.push(dist); R.grab.push(this.grabS); R.move.push(moveS); R.release.push(relS);
    this.guide.hide();
    const mesh = it.mesh, start = mesh.position.clone(), t0 = performance.now();
    const end = new THREE.Vector3(target.pos.x + THREE.MathUtils.clamp(start.x - target.pos.x, -0.012, 0.012), TABLE_Y + it.r, 0.0);
    const anim = () => {
      const a = Math.min(1, (performance.now() - t0) / 380);
      mesh.position.lerpVectors(start, end, a * a); mesh.rotation.set(0, 0, 0);
      if (a < 1) requestAnimationFrame(anim);
      else { this.burst(end.clone().setY(TABLE_Y), it.hex); snd('plop'); setTimeout(() => this.group.remove(mesh), 900); }
    };
    anim();
    snd(dist < 1.0 ? 'perfect' : 'good');
    this.item = null;
    const nxt = this.queue[this.itemNo];
    this.ui.banner(dist < 1.0 ? '✔ +1  Perfect, right in the centre!' : '✔ +1  Great!', nxt ? `next: ${nxt.say}` : (this.rix < this.rlist.length - 1 ? `round ${this.rlist[this.rix + 1]} starts` : 'all done'), true);
    this.ui.stats(this.summary()); this.showRound();
    this.phase = 'pause'; this.t0 = now; this.pauseS = 1.3; this.nextIsNew = true;
  }

  fail(title, sub, wrong = false) {
    const it = this.item; this.guide.hide();
    if (!wrong) snd('drop');
    if (it) {
      const mesh = it.mesh, start = mesh.position.clone(), t0 = performance.now();
      const end = new THREE.Vector3(start.x + 0.03, TABLE_Y + it.r, start.z + 0.03);
      const anim = () => {
        const a = Math.min(1, (performance.now() - t0) / 420);
        mesh.position.lerpVectors(start, end, a * a);
        if (a < 1) requestAnimationFrame(anim); else setTimeout(() => this.group.remove(mesh), 500);
      };
      anim();
    }
    this.item = null;
    this.ui.banner(title, sub);
    this.ui.stats(this.summary());
    this.phase = 'pause'; this.t0 = performance.now(); this.pauseS = 1.4; this.nextIsNew = false;
  }
}
