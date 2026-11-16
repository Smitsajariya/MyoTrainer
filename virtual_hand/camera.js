// Webcam hand tracking (MediaPipe Hand Landmarker) -> 7 finger features + a rule-based "teacher" gesture.
// Features: [curl_thumb, curl_index, curl_middle, curl_ring, curl_little, pinch_distance, spread]
import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

const MODEL_LOCAL = './vendor/mediapipe/hand_landmarker.task';
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => len(sub(a, b));
function angle(u, v) {
  const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v) + 1e-9);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

export function featuresFromLandmarks(p) {
  const curls = CHAINS.map((c, i) => {
    const pts = [i === 0 ? p[0] : p[0], ...c.map((k) => p[k])];
    let s = 0;
    for (let j = 1; j < pts.length - 1; j++) s += angle(sub(pts[j], pts[j - 1]), sub(pts[j + 1], pts[j]));
    if (i === 0) s -= angle(sub(p[1], p[0]), sub(p[2], p[1]));   // ignore CMC for the thumb
    return Math.max(0, Math.min(1, s / (i === 0 ? 1.4 : 2.9)));
  });
  const palm = dist(p[0], p[9]) + 1e-6;
  const pinch = dist(p[4], p[8]) / palm;
  const spread = dist(p[8], p[20]) / palm;
  return [...curls, pinch, spread];
}

export function teacherGesture(f) {
  const four = (f[1] + f[2] + f[3] + f[4]) / 4;
  if (f[5] < 0.3 && f[1] < 0.8) return 'pinch';   // thumb tip touches a not-fully-curled index
  if (four > 0.6) return 'close';
  if (four < 0.22) return 'open';
  return 'rest';
}

// The blue sensor band on the forearm: found by colour in a window behind the wrist (along the forearm).
// Hand (fingers) + band = the part of the arm the real EMG/FMG band will see, so the band gives the forearm direction.
const BW = 160, BH = 120;
function isBlue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
  if (v < 0.25 || sat < 0.3 || b !== mx) return false;
  let h = mx === mn ? 0 : g === mx ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - g) / (mx - mn) + 4);
  if (h < 0) h += 360;
  return h > 185 && h < 250;
}

export class Camera {
  constructor(videoEl, canvasEl, onFrame, onStatus) {
    this.video = videoEl; this.canvas = canvasEl; this.ctx = canvasEl.getContext('2d');
    this.onFrame = onFrame; this.onStatus = onStatus; this.running = false; this.lastT = -1;
    this.small = document.createElement('canvas'); this.small.width = BW; this.small.height = BH;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.band = null; this.bandSeen = 0;
  }

  // centre of the blue band (image coords 0..1, not mirrored) or null
  findBand(p) {
    this.sctx.drawImage(this.video, 0, 0, BW, BH);
    const img = this.sctx.getImageData(0, 0, BW, BH).data;
    const wx = p[0].x * BW, wy = p[0].y * BH, mx = p[9].x * BW, my = p[9].y * BH;
    const L = Math.hypot(wx - mx, wy - my) || 1, ux = (wx - mx) / L, uy = (wy - my) / L;   // wrist -> elbow
    const x0 = Math.max(0, Math.floor(Math.min(wx, wx + ux * 2.4 * L) - L)), x1 = Math.min(BW - 1, Math.ceil(Math.max(wx, wx + ux * 2.4 * L) + L));
    const y0 = Math.max(0, Math.floor(Math.min(wy, wy + uy * 2.4 * L) - L)), y1 = Math.min(BH - 1, Math.ceil(Math.max(wy, wy + uy * 2.4 * L) + L));
    let n = 0, sx = 0, sy = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ax = x - wx, ay = y - wy, t = (ax * ux + ay * uy) / L, sd = Math.abs(-ax * uy + ay * ux) / L;
      if (t < 0.15 || t > 2.4 || sd > 0.75) continue;
      const i = (y * BW + x) * 4;
      if (isBlue(img[i], img[i + 1], img[i + 2])) { n += 1; sx += x; sy += y; }
    }
    const now = performance.now();
    if (n >= Math.max(6, 0.04 * L * L)) {
      const bx = sx / n / BW, by = sy / n / BH;
      this.band = this.band ? { x: this.band.x * 0.6 + bx * 0.4, y: this.band.y * 0.6 + by * 0.4 } : { x: bx, y: by };
      this.bandSeen = now;
    } else if (now - this.bandSeen > 400) this.band = null;
    return this.band;
  }

  async start() {
    this.onStatus('loading hand model...');
    const vision = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    let model = MODEL_LOCAL;
    try { const r = await fetch(MODEL_LOCAL, { method: 'HEAD' }); if (!r.ok) model = MODEL_REMOTE; } catch (e) { model = MODEL_REMOTE; }
    const make = (delegate) => HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numHands: 1,
      // lower thresholds: keeps tracking a hand that is partly turned or near the image edge
      minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.35,
    });
    try { this.lm = await make('GPU'); } catch (e) { this.lm = await make('CPU'); }
    this.onStatus('starting webcam...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = stream;
    await this.video.play();
    this.running = true;
    this.onStatus('camera on');
    const loop = () => { if (!this.running) return; this.tick(); requestAnimationFrame(loop); };
    loop();
  }

  stop() {
    this.running = false;
    const s = this.video.srcObject; if (s) s.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onStatus('camera off');
  }

  tick() {
    if (this.video.currentTime === this.lastT) return;
    this.lastT = this.video.currentTime;
    const res = this.lm.detectForVideo(this.video, performance.now());
    const W = this.canvas.width, H = this.canvas.height;
    this.ctx.clearRect(0, 0, W, H);
    if (!res.landmarks || !res.landmarks.length) { this.onFrame(null); return; }
    const p = res.landmarks[0];
    // draw mirrored skeleton
    this.ctx.lineWidth = 3; this.ctx.strokeStyle = '#1baf7a'; this.ctx.fillStyle = '#ffffff';
    for (const [a, b] of BONES) {
      this.ctx.beginPath(); this.ctx.moveTo((1 - p[a].x) * W, p[a].y * H); this.ctx.lineTo((1 - p[b].x) * W, p[b].y * H); this.ctx.stroke();
    }
    for (const q of p) { this.ctx.beginPath(); this.ctx.arc((1 - q.x) * W, q.y * H, 3.5, 0, 7); this.ctx.fill(); }
    // sensor band: blue ring + the tracked zone (fingers -> band)
    let band = null;
    try { band = this.findBand(p); } catch (e) { band = null; }
    if (band) {
      const bx = (1 - band.x) * W, by = band.y * H, wx = (1 - p[0].x) * W, wy = p[0].y * H;
      this.ctx.save(); this.ctx.setLineDash([6, 5]); this.ctx.strokeStyle = '#2a78d6'; this.ctx.lineWidth = 3;
      this.ctx.beginPath(); this.ctx.moveTo(wx, wy); this.ctx.lineTo(bx, by); this.ctx.stroke(); this.ctx.restore();
      this.ctx.strokeStyle = '#2a78d6'; this.ctx.lineWidth = 4; this.ctx.beginPath(); this.ctx.arc(bx, by, 14, 0, 7); this.ctx.stroke();
      this.ctx.fillStyle = '#2a78d6'; this.ctx.font = 'bold 15px sans-serif'; this.ctx.fillText('band', bx + 17, by + 5); this.ctx.fillStyle = '#ffffff';
    }
    // 3D world landmarks (metres, hand-centred) give joint angles that do not change with
    // perspective or hand rotation -> more stable finger curls than the 2D image points.
    const w = res.worldLandmarks && res.worldLandmarks[0];
    const f = featuresFromLandmarks(p);                                   // image points (used by the server + rule teacher)
    const f3 = w && w.length === 21 ? featuresFromLandmarks(w) : f;      // 3D points (used by the personal AI)
    const cx = (p[0].x + p[5].x + p[9].x + p[17].x) / 4, cy = (p[0].y + p[5].y + p[9].y + p[17].y) / 4;
    // hand size in the image (wrist -> middle knuckle): bigger = closer to the camera (used for depth)
    const size = Math.hypot(p[9].x - p[0].x, (p[9].y - p[0].y) * (H / W));
    const hand = res.handednesses && res.handednesses[0] && res.handednesses[0][0] ? res.handednesses[0][0].categoryName : null;
    this.onFrame({ f, f3, g: teacherGesture(f), pos: { x: 1 - cx, y: cy }, size,
      w: w ? w.map((q) => [q.x, q.y, q.z]) : null, lm: p.map((q) => [q.x, q.y, q.z]), hand,
      band: band ? { x: 1 - band.x, y: band.y } : null, wrist: { x: 1 - p[0].x, y: p[0].y }, aspect: H / W });
  }
}
