// Grip detection from the camera's 3D hand landmarks (MediaPipe world landmarks, metres).
// Geometry, not a trained model: distances between finger tips, knuckles and the wrist, divided by the
// palm length, so it works for any hand size and in any hand orientation.
//   open    all fingers straight
//   power   fist (apple, bottle)
//   pinch   thumb tip on index tip (grape, coin)
//   tripod  thumb + index + middle tips together (pen, chalk)
//   lateral thumb pad on the side of the bent index finger (key, card)
//   point   index straight, other fingers bent (button, touch screen)
//   rest    anything else (relaxed hand)

export const GRIPS = {
  open:    { label: 'OPEN', icon: '🖐️' },
  power:   { label: 'FIST', icon: '✊' },
  wrap:    { label: 'HOLD (hand around a big object)', icon: '🤲' },
  pinch:   { label: 'PINCH', icon: '🤏' },
  tripod:  { label: 'TRIPOD (thumb + 2 fingers)', icon: '🤌' },
  lateral: { label: 'KEY GRIP (thumb on side of index)', icon: '🔑' },
  point:   { label: 'POINT', icon: '☝️' },
  rest:    { label: 'REST', icon: '🫳' },
};
// the 4 band classes (what the EMG/FMG AI decodes) for each grip
export const GRIP_TO_BAND = { open: 'open', power: 'close', wrap: 'close', pinch: 'pinch', tripod: 'pinch', lateral: 'pinch', point: 'rest', rest: 'rest' };

const d = (w, a, b) => Math.hypot(w[a][0] - w[b][0], w[a][1] - w[b][1], w[a][2] - w[b][2]);

export function gripMetrics(w) {
  const s = d(w, 0, 9) || 1;                    // palm length (wrist -> middle knuckle)
  const tw = [8, 12, 16, 20].map((t) => d(w, 0, t) / s);   // tip-to-wrist: ~1.9 straight, ~1.0 curled
  return {
    s, tw,
    ti: d(w, 4, 8) / s,                          // thumb tip - index tip
    tm: d(w, 4, 12) / s,                         // thumb tip - middle tip
    im: d(w, 8, 12) / s,                         // index tip - middle tip
    tSide: Math.min(d(w, 4, 6), d(w, 4, 7)) / s, // thumb tip - side of the index (PIP/DIP)
    tMid: Math.min(d(w, 4, 10), d(w, 4, 11)) / s, // thumb tip - middle finger PIP/DIP (fist: thumb wraps here)
    thumbOut: d(w, 4, 5) / s,                    // thumb tip - index knuckle (thumb spread away from the hand)
  };
}

export function detectGrip(w) {
  if (!w || w.length !== 21) return { grip: 'rest', m: null };
  const m = gripMetrics(w);
  const [ix, md, rg, pk] = m.tw;
  const straight = (v) => v > 1.7, curled = (v) => v < 1.3;
  let grip = 'rest';
  const nStraight = [ix, md, rg, pk].filter((v) => v > 1.6).length;
  if ((straight(ix) && straight(md) && straight(rg) && m.ti > 0.55) || (nStraight >= 3 && m.ti > 0.45)) grip = 'open';
  else if (ix > 1.65 && curled(md) && curled(rg) && m.ti > 0.3) grip = 'point';
  else if (curled(ix) && curled(md) && curled(rg)) {
    // whole hand closed: thumb pad on the side of the index = key grip, thumb wrapped over the fingers = fist
    // ... unless the thumb tip touches the index tip (a pinch with the other fingers tucked in)
    if (m.ti < 0.28) grip = m.tm < 0.32 ? 'tripod' : 'pinch';
    else grip = m.tSide < 0.38 && m.tSide < m.tMid - 0.05 && m.thumbOut > 0.45 ? 'lateral' : 'power';
  }
  else if (m.ti < 0.42 && m.tm < 0.5 && m.im < 0.45) grip = 'tripod';
  // fingers half closed around something big (apple, ball, banana), thumb on the other side
  else if (ix < 1.62 && md < 1.62 && rg < 1.62 && (ix + md + rg) / 3 < 1.55 && m.ti > 0.35) grip = 'wrap';
  else if (m.ti < 0.4) grip = 'pinch';
  return { grip, m };
}

// How well the camera sees the palm: 1 = palm (or back of the hand) faces the camera, 0 = hand seen from the side.
// Seen from the side the fingers hide behind each other and an open hand looks closed, so the grip is not trusted then.
export function palmFacing(w) {
  if (!w || w.length !== 21) return 1;
  const a = [w[5][0] - w[0][0], w[5][1] - w[0][1], w[5][2] - w[0][2]], b = [w[17][0] - w[0][0], w[17][1] - w[0][1], w[17][2] - w[0][2]];
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const L = Math.hypot(...n) || 1;
  return Math.abs(n[2]) / L;
}

// keeps the grip steady: a new grip must win `n` frames in a row
export class GripFilter {
  constructor(n = 4) { this.n = n; this.cur = 'rest'; this.cand = 'rest'; this.k = 0; }
  push(g) {
    if (g === this.cand) this.k += 1; else { this.cand = g; this.k = 1; }
    if (this.k >= this.n) this.cur = g;
    return this.cur;
  }
}

// One Euro filter (Casiez et al. 2012): strong smoothing when the hand is still (no shaking),
// little lag when it moves fast. Used for every landmark coordinate, the hand position and size.
class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.6, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = null; this.dx = 0; }
  static a(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(v, dt) {
    if (this.x == null) { this.x = v; return v; }
    const dx = (v - this.x) / dt;
    this.dx += OneEuro.a(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export class HandSmoother {
  constructor() { this.f = null; this.t = 0; }
  // d: camera frame {w, pos, size, ...} -> same frame with smoothed w / pos / size
  smooth(d) {
    const now = performance.now() / 1000, dt = this.t ? Math.max(1 / 120, Math.min(0.2, now - this.t)) : 1 / 30; this.t = now;
    if (!this.f) this.f = { w: Array.from({ length: 63 }, () => new OneEuro(1.4, 8)), p: [new OneEuro(1.0, 1.5), new OneEuro(1.0, 1.5)], s: new OneEuro(0.6, 1.0) };
    const out = { ...d };
    if (d.w) out.w = d.w.map((q, i) => q.map((v, k) => this.f.w[i * 3 + k].filter(v, dt)));
    if (d.pos) out.pos = { x: this.f.p[0].filter(d.pos.x, dt), y: this.f.p[1].filter(d.pos.y, dt) };
    if (d.size != null) out.size = this.f.s.filter(d.size, dt);
    return out;
  }
  reset() { this.f = null; this.t = 0; }
}
