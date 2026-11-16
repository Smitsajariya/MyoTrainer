// One input layer for all games.
//   state     : decoded movement ('rest'|'open'|'close'|'pinch')
//   intensity : grip strength 0..1
//   pos       : hand position {x, y} in 0..1 (screen-like, y down)
// Priority: server AI model -> camera teacher -> keyboard/mouse. Works offline (keyboard + mouse).
import { Camera } from '../camera.js';
import { GestureAI, vec } from './gesture_ai.js';

export class Input {
  constructor({ video, canvas, onStatus = () => {}, onCam = () => {} }) {
    this.state = 'rest'; this.intensity = 0; this.pos = { x: 0.5, y: 0.45 };
    this.connected = false; this.hasModel = false; this.source = 'offline'; this.modelName = null;
    this.serverState = null; this.serverIntensity = null; this.probs = {};
    this.cam = null; this.camOn = false; this.camData = null; this.camSeen = 0;
    this.keyState = 'rest'; this.keyIntensity = 0; this.space = false;
    this.mouse = { x: 0.5, y: 0.45, t: 0 };
    this.onStatus = onStatus; this.onCam = onCam;
    this.listeners = {};
    this.video = video; this.canvas = canvas;
    this.ai = new GestureAI();                 // personal camera classifier (quick calibration)
    this.fs = null;                            // smoothed camera features
    this.camState = 'rest'; this.cand = 'rest'; this.candN = 0; this.camProbs = null;
    this.fingers = null;                       // 5 finger curls 0..1 for the mirrored hand
    try { this.mirror = localStorage.getItem('smits_kitchen_mirror') !== '0'; } catch (e) { this.mirror = true; }
    this.calibSink = null;                     // set by the calibration screen
    this.connect();
    this.bindKeys();
  }

  on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, d) { (this.listeners[type] || []).forEach((f) => f(d)); }

  connect() {
    try { this.ws = new WebSocket(`ws://${location.hostname || 'localhost'}:8765`); } catch (e) { return; }
    this.ws.onopen = () => { this.connected = true; this.emit('status'); };
    this.ws.onclose = () => { this.connected = false; this.hasModel = false; this.emit('status'); setTimeout(() => this.connect(), 1500); };
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'frame') {
        this.source = m.source; this.hasModel = !!m.model; this.modelName = m.model;
        this.serverState = m.state; this.probs = m.probs || {};
        this.serverIntensity = m.intensity != null ? m.intensity : null;
      } else if (m.type === 'history') {
        this.emit('history', m.sessions || []);
      }
    };
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  bindKeys() {
    const G = ['rest', 'open', 'close', 'pinch'];
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const g = G[+e.key - 1];
      if (g) { this.keyState = g; this.mouse.t = this.mouse.t || 0; }
      if (e.code === 'Space') { this.space = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, t: performance.now() };
    });
  }

  async startCamera() {
    if (!this.cam) {
      this.cam = new Camera(this.video, this.canvas, (d) => {
        if (d) this.camData = d;          // keep the last hand through short tracking drop-outs (see handVisible)
        if (d) { this.camSeen = performance.now(); this.onCamFrame(d); this.send({ cmd: 'cam', f: d.f, g: this.camState }); }
        else if (this.camSeen && performance.now() - this.camSeen > 450 && !this.lostSent) { this.send({ cmd: 'cam_lost' }); this.lostSent = true; }
        if (d) this.lostSent = false;
        this.onCam(this.handVisible() ? this.camData : null);
      }, (s) => this.onStatus(s));
    }
    await this.cam.start();
    this.camOn = true;
  }

  // per camera frame: smooth features, classify with the personal AI (or the rule teacher), debounce
  onCamFrame(d) {
    const x = vec(d);
    if (!this.fs || this.fs.length !== x.length) this.fs = x.slice();
    else for (let i = 0; i < x.length; i++) this.fs[i] += (x[i] - this.fs[i]) * 0.5;
    if (this.calibSink) this.calibSink(x);
    let g = d.g;
    if (this.ai.ready) { const r = this.ai.predict(this.fs); g = r.g; this.camProbs = r.p; } else this.camProbs = null;
    // hysteresis: a new gesture must win 3 frames in a row (~100 ms) before it is accepted
    if (g === this.cand) this.candN += 1; else { this.cand = g; this.candN = 1; }
    if (this.candN >= 3) this.camState = g;
    const f = this.fs.slice(0, 7);
    this.fingers = { c: this.ai.normCurls(f), pinch: f[5], spread: f[6] };
  }

  setMirror(on) { this.mirror = on; try { localStorage.setItem('smits_kitchen_mirror', on ? '1' : '0'); } catch (e) { /* ignore */ } }

  // drive a hand model: every finger follows the camera when mirroring, otherwise the decoded gesture pose
  driveHand(hand, fallbackPose) {
    if (this.mirror && this.handVisible() && this.fingers) hand.curls(this.fingers.c, this.fingers);
    else hand.pose(fallbackPose || this.state);
  }

  stopCamera() { if (this.cam) this.cam.stop(); this.camOn = false; this.camData = null; }

  handVisible() { return this.camOn && this.camData && performance.now() - this.camSeen < 450; }

  requestHistory() { this.send({ cmd: 'history' }); }

  // call once per frame
  update(dt) {
    const vis = this.handVisible();
    // movement
    // the server model decides when it reads the BAND; for the camera the personal AI (if calibrated) is better
    const useServer = this.connected && this.hasModel && this.serverState && !(this.source === 'CameraSource' && this.ai.ready);
    if (useServer) this.state = this.serverState;
    else if (vis) this.state = this.camState;
    else if (this.camOn) this.state = 'rest';
    else this.state = this.keyState;
    if (useServer && this.camOn && !vis) this.state = 'rest';
    // grip intensity
    if (vis) {
      const c = this.fingers ? this.fingers.c : this.camData.f;   // personal open..fist range when calibrated
      this.intensity = Math.max(0, Math.min(1, (c[1] + c[2] + c[3] + c[4]) / 4));
    } else if (this.camOn && this.camSeen && performance.now() - this.camSeen < 1500) {
      // short camera drop-out: hold the last grip strength instead of jumping to 0
    } else if (this.serverIntensity != null && this.source !== 'CameraSource') {
      this.intensity = this.serverIntensity;
    } else {
      const tgt = this.space ? 1 : (this.keyState === 'close' ? 0.55 : 0);
      this.keyIntensity += (tgt - this.keyIntensity) * Math.min(1, dt * (this.space ? 1.2 : 3));
      this.intensity = this.keyIntensity;
    }
    // hand position
    if (vis && this.camData.pos) {
      // reach gain: the middle half of the camera image covers the whole table, so your hand never has to go
      // to the image edge (where tracking is lost). Centre a bit low, where people naturally hold the hand.
      const G = 2.0, cx = 0.5, cy = 0.56;
      const tx = Math.max(0, Math.min(1, 0.5 + (this.camData.pos.x - cx) * G));
      const ty = Math.max(0, Math.min(1, 0.5 + (this.camData.pos.y - cy) * G));
      const k = Math.min(1, dt * 12);                     // smoothed so the virtual hand does not shake
      this.pos = { x: this.pos.x + (tx - this.pos.x) * k, y: this.pos.y + (ty - this.pos.y) * k };
    }
    else if (performance.now() - this.mouse.t < 4000) this.pos = { x: this.mouse.x, y: this.mouse.y };
    this.posLive = vis || performance.now() - this.mouse.t < 4000;
    if (this.forceIntensity != null) this.intensity = this.forceIntensity;   // test hook
  }

  label() {
    if (this.connected && this.hasModel && !(this.source === 'CameraSource' && this.ai.ready)) return `AI model (${this.source.replace('Source', '').toLowerCase()})`;
    if (this.handVisible()) return this.ai.ready ? `camera · personal AI ${Math.round((this.ai.report?.accuracy || 0) * 100)}%` : 'camera · not calibrated';
    if (this.camOn) return 'camera: show your hand';
    return 'keyboard 1-4 + mouse';
  }
}
