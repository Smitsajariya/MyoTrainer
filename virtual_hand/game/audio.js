// Procedural sound effects and music (Web Audio API, no files needed).
let ctx = null, master = null;
let muted = false;

export function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.6; }
export function isMuted() { return muted; }

function env(g, t, a, d, peak = 1) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slide = 0) {
  const c = audio(), t = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  env(g, t, 0.005, dur, vol);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function getNoise() {
  const c = audio();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noise(dur, filterFreq, vol = 0.2, when = 0, type = 'bandpass', q = 1) {
  const c = audio(), t = c.currentTime + when;
  const s = c.createBufferSource(); s.buffer = getNoise();
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
  const g = c.createGain(); env(g, t, 0.005, dur, vol);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

export const sfx = {
  pop: () => { tone(520, 0.12, 'triangle', 0.25, 0, 1.6); },
  grab: () => { tone(330, 0.08, 'square', 0.08); tone(660, 0.14, 'triangle', 0.18, 0.04); },
  plop: () => { tone(180, 0.25, 'sine', 0.35, 0, 0.5); noise(0.12, 900, 0.08); },
  drop: () => { tone(140, 0.2, 'sine', 0.3, 0, 0.6); noise(0.18, 400, 0.12, 0, 'lowpass'); },
  good: () => { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.2, i * 0.07)); },
  perfect: () => { [784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.16, 'sine', 0.22, i * 0.05)); },
  miss: () => { tone(220, 0.25, 'sawtooth', 0.08, 0, 0.6); },
  wrong: () => { tone(200, 0.12, 'square', 0.1); tone(150, 0.2, 'square', 0.1, 0.12); },
  star: () => { tone(1200, 0.3, 'sine', 0.15, 0, 1.5); },
  win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.2, i * 0.11)); },
  splash: () => { noise(0.45, 1800, 0.25, 0, 'bandpass', 0.7); },
  blender: () => { for (let i = 0; i < 6; i++) noise(0.25, 300 + i * 120, 0.12, i * 0.2, 'bandpass', 3); },
  click: () => tone(900, 0.04, 'square', 0.06),
};

// continuous pour sound
let pourNode = null;
export function pourSound(level) {   // level 0..1, 0 stops
  const c = audio();
  if (level <= 0.01) { if (pourNode) { pourNode.g.gain.setTargetAtTime(0, c.currentTime, 0.05); } return; }
  if (!pourNode) {
    const s = c.createBufferSource();
    s.buffer = getNoise(); s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(master); s.start();
    pourNode = { s, f, g };
  }
  pourNode.g.gain.setTargetAtTime(0.18 * level, c.currentTime, 0.05);
  pourNode.f.frequency.setTargetAtTime(900 + 900 * level, c.currentTime, 0.1);
}

// simple procedural groove for the rhythm level
export class Groove {
  constructor(bpm = 90) { this.bpm = bpm; this.timer = null; this.step = 0; }
  start() {
    const c = audio();
    this.next = c.currentTime + 0.1; this.step = 0;
    const bass = [55, 55, 65.4, 49];
    this.timer = setInterval(() => {
      const spb = 60 / this.bpm / 2;   // eighth notes
      while (this.next < c.currentTime + 0.2) {
        const s = this.step % 16, w = this.next - c.currentTime;
        if (s % 4 === 0) tone(110, 0.18, 'sine', 0.35, w, 0.35);              // kick
        if (s % 8 === 4) noise(0.12, 2500, 0.12, w);                           // snare
        noise(0.03, 8000, 0.03, w, 'highpass');                                // hat
        if (s % 4 === 2) tone(bass[(this.step >> 4) % 4], spb * 1.6, 'triangle', 0.12, w);
        this.next += spb; this.step++;
      }
    }, 50);
  }
  setBpm(b) { this.bpm = b; }
  stop() { clearInterval(this.timer); this.timer = null; }
}
