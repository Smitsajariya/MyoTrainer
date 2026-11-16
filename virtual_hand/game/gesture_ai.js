// Personal camera gesture classifier.
// Trained in the game from a 20 s "quick calibration" (open, fist, pinch, rest, two rounds).
// Model: one Gaussian per gesture with a shared diagonal variance (= LDA with diagonal covariance),
// on 14 features (7 from the 2D image landmarks + 7 from the 3D world landmarks).
// It also learns this person's open/fist range per finger, so the mirrored hand reaches full open and full fist.

export const GESTURES = ['rest', 'open', 'close', 'pinch'];
const KEY = 'smits_kitchen_gesture_ai_v1';

export function vec(d) { return [...d.f, ...(d.f3 || d.f)]; }

function fit(samples) {
  // samples: {gesture: [[14 numbers], ...]}
  const D = 14, cls = GESTURES.filter((g) => (samples[g] || []).length >= 3);
  if (cls.length < GESTURES.length) return null;
  const mean = {}, v = new Array(D).fill(0); let n = 0;
  for (const g of cls) {
    const X = samples[g], m = new Array(D).fill(0);
    X.forEach((x) => x.forEach((a, i) => { m[i] += a / X.length; }));
    mean[g] = m;
    X.forEach((x) => x.forEach((a, i) => { v[i] += (a - m[i]) ** 2; })); n += X.length;
  }
  const sd = v.map((a) => Math.sqrt(a / Math.max(1, n - cls.length)) + 0.03);   // floor keeps it robust
  return { mean, sd };
}

function scores(model, x) {
  const out = {};
  for (const g of GESTURES) {
    const m = model.mean[g]; let d = 0;
    for (let i = 0; i < x.length; i++) d += ((x[i] - m[i]) / model.sd[i]) ** 2;
    out[g] = -0.5 * d;
  }
  const mx = Math.max(...Object.values(out)); let s = 0;
  for (const g of GESTURES) { out[g] = Math.exp(out[g] - mx); s += out[g]; }
  for (const g of GESTURES) out[g] /= s;
  return out;
}

export class GestureAI {
  constructor() {
    this.model = null; this.range = null; this.report = null;
    try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.model) Object.assign(this, j); } catch (e) { /* no storage */ }
  }

  get ready() { return !!this.model; }

  // rounds: [{gesture: [[x...]...]}, {...}]  (two rounds -> honest accuracy: train on one, test on the other)
  train(rounds) {
    const all = {}; GESTURES.forEach((g) => { all[g] = []; });
    rounds.forEach((r) => GESTURES.forEach((g) => all[g].push(...(r[g] || []))));
    const model = fit(all);
    if (!model) return null;
    // cross-validated accuracy (round A -> round B and B -> A)
    const per = {}; GESTURES.forEach((g) => { per[g] = { ok: 0, n: 0 }; });
    const confusion = {};
    if (rounds.length >= 2) {
      for (const [a, b] of [[0, 1], [1, 0]]) {
        const m = fit(rounds[a]); if (!m) continue;
        for (const g of GESTURES) for (const x of rounds[b][g] || []) {
          const p = scores(m, x); const pred = GESTURES.reduce((u, h) => (p[h] > p[u] ? h : u), 'rest');
          per[g].n += 1; if (pred === g) per[g].ok += 1; else confusion[`${g}->${pred}`] = (confusion[`${g}->${pred}`] || 0) + 1;
        }
      }
    }
    const tot = GESTURES.reduce((s, g) => s + per[g].n, 0), ok = GESTURES.reduce((s, g) => s + per[g].ok, 0);
    // personal finger range from OPEN and FIST samples (image features, used for mirroring)
    const avg = (X, i) => X.reduce((s, x) => s + x[i], 0) / Math.max(1, X.length);
    const range = [0, 1, 2, 3, 4].map((i) => [avg(all.open, i), avg(all.close, i)]);
    this.model = model; this.range = range;
    this.report = { accuracy: tot ? ok / tot : null, per: Object.fromEntries(GESTURES.map((g) => [g, per[g].n ? per[g].ok / per[g].n : null])),
      confusion, samples: Object.fromEntries(GESTURES.map((g) => [g, all[g].length])), date: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify({ model, range, report: this.report })); } catch (e) { /* ignore */ }
    return this.report;
  }

  clear() { this.model = null; this.range = null; this.report = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  predict(x) {
    if (!this.model) return null;
    const p = scores(this.model, x);
    let g = GESTURES.reduce((u, h) => (p[h] > p[u] ? h : u), 'rest');
    // sanity check seen in play-testing: a fist with the thumb resting on the index finger can look like a pinch.
    // If the index AND the other three fingers are all curled, it is a fist.
    const others = (x[2] + x[3] + x[4]) / 3;
    if (g === 'pinch' && x[1] > 0.7 && others > 0.75) g = 'close';
    return { g: p[g] >= 0.6 || g === 'close' ? g : 'rest', p };
  }

  // 0..1 curl per finger, stretched to this person's own open..fist range
  normCurls(f) {
    return [0, 1, 2, 3, 4].map((i) => {
      if (!this.range) return Math.max(0, Math.min(1, f[i]));
      const [o, c] = this.range[i]; const span = Math.abs(c - o) < 0.08 ? 0.08 : c - o;
      return Math.max(0, Math.min(1, (f[i] - o) / span));
    });
  }
}
