// Smit's Kitchen: game hub, HUD, level loop, progress dashboard.
import * as THREE from 'three';
import { Input } from './input.js';
import { RhythmLevel } from './level_rhythm.js';
import { KitchenLevel } from './level_kitchen.js';
import { PourLevel } from './level_pour.js';
import { audio, sfx, setMuted, isMuted } from './audio.js';
import { GESTURES } from './gesture_ai.js';
import { loadExternalModels, MODELS } from './props.js';
import { loadArmModel, handStyle, setHandStyle, ARM } from './handmodel.js';

const $ = (id) => document.getElementById(id);
const LEVEL_COLORS = { rhythm: '#2a78d6', kitchen: '#eb6834', pour: '#1baf7a' };
const LEVEL_NAMES = { rhythm: 'Gesture Rhythm', kitchen: 'Fruit Kitchen', pour: 'Steady Pour' };

const renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// external 3D models (Meshy GLBs in virtual_hand/models) are loaded before the scenes are built
$('sConn').textContent = 'loading 3D models...';
await loadExternalModels((n) => { $('sConn').textContent = `loading 3D model: ${n}...`; });
await loadArmModel();   // Smit's 3D-printed hand (models/arm), else the built-in hand

// ------------------------------------------------------------------ HUD
let toastTimer = null;
const hud = {
  toast(title, sub = '', kind = '') {
    const t = $('toast'); t.className = `panel ${kind}`; t.style.display = 'block';
    $('tT').textContent = title; $('tS').textContent = sub;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, kind === 'ok' || kind === 'bad' ? 1100 : 2600);
  },
  hint(s) { $('hint').textContent = s; },
  timer(s) { $('hTime').textContent = s.toFixed(1); },
  score(n) { $('hScore').textContent = Math.round(n); },
  order(order, i, n) {
    $('orderCard').innerHTML = `<h3>Order ${i} / ${n}: smoothie</h3>` + order.map((o) => {
      const need = ['strawberry', 'grape', 'cherry'].includes(o.kind) ? 'pinch 🤏' : 'fist ✊';
      const icon = { apple: '🍎', orange: '🍊', banana: '🍌', strawberry: '🍓', grape: '🍇', cherry: '🍒' }[o.kind];
      return `<div class="row ${o.got >= o.n ? 'done' : ''}"><span class="ico">${icon}</span><span>${o.kind}</span><span class="need">${need}</span><span class="cnt">${o.got}/${o.n}</span></div>`;
    }).join('');
    const sc = order.reduce((a, o) => a + o.got, 0) * 100; hud.score(sc + (current ? current.stats.stars * 150 : 0));
  },
  gauge(v, zone) {
    $('gZone').style.bottom = `${zone[0] * 100}%`; $('gZone').style.height = `${(zone[1] - zone[0]) * 100}%`;
    $('gMark').style.bottom = `calc(${Math.min(1, v) * 100}% - 3px)`;
    $('gMark').style.background = v > 0.88 ? '#e34948' : v >= zone[0] && v <= zone[1] ? '#1baf7a' : '#14181f';
  },
  event(e) { input.send({ cmd: 'game_event', level: current ? current.key : '', ...e }); },
  finish(summary) { finishLevel(summary); },
};

// ------------------------------------------------------------------ input
const input = new Input({
  video: $('video'), canvas: $('camCanvas'),
  onStatus: (s) => { $('camTag').textContent = s; },
  onCam: (d) => { $('camTag').textContent = d ? `camera: ${input.camState}` : 'no hand visible'; },
});
input.on('history', (rows) => renderDashboard(rows, 'saved on this computer by the server (recordings/game_history.json)'));

async function toggleCamera() {
  audio();
  if (input.camOn) { input.stopCamera(); $('camBox').style.display = 'none'; updateButtons(); return; }
  $('camBox').style.display = 'block';
  try { await input.startCamera(); } catch (e) { $('camTag').textContent = 'camera error'; hud.toast('Camera error', String(e && e.message ? e.message : e), 'bad'); }
  if (input.camOn && !input.ai.ready && !$('calib').classList.contains('show') && !current) openCalib();   // first time: 20 s calibration
  updateButtons();
}
$('bCam').onclick = toggleCamera; $('bCam2').onclick = toggleCamera;

function updateButtons() {
  $('bCam').textContent = input.camOn ? 'Stop camera' : 'Start camera';
  $('bCam2').classList.toggle('on', input.camOn);
  $('bMute').textContent = isMuted() ? 'Sound off' : 'Sound on';
  $('bAssist').classList.toggle('on', !!(current && current.assist));
  $('bMirror').textContent = input.mirror ? 'Fingers: mirror ✓' : 'Fingers: gesture only';
  $('bMirror2').classList.toggle('on', input.mirror);
  $('sAI').textContent = input.ai.ready ? `personal model, ${Math.round((input.ai.report?.accuracy ?? 0) * 100)}% accuracy` : 'not calibrated (rule-based)';
}
const toggleMirror = () => { input.setMirror(!input.mirror); updateButtons(); };
$('bMirror').onclick = toggleMirror; $('bMirror2').onclick = toggleMirror;
$('bHand').textContent = `Hand: ${handStyle() === 'printed' && ARM.ready ? 'my printed hand' : 'bionic'}`;
$('bHand').style.display = ARM.ready ? '' : 'none';
$('bHand').onclick = () => { setHandStyle(handStyle() === 'printed' ? 'bionic' : 'printed'); location.reload(); };

// ------------------------------------------------------------------ quick calibration (personal camera AI)
const CAL = { open: ['🖐️', 'OPEN', 'spread all fingers'], close: ['✊', 'FIST', 'close all fingers tight'],
  pinch: ['🤏', 'PINCH', 'thumb tip on index tip, other fingers relaxed'], rest: ['🫳', 'REST', 'relaxed hand, fingers softly bent'] };
const CAL_ORDER = ['open', 'close', 'pinch', 'rest'];
const CAL_HOLD = 2.6, CAL_SKIP = 0.7;            // seconds per gesture, first part ignored (moving into the gesture)
let calRunning = false;

function openCalib() {
  audio(); $('calib').classList.add('show'); $('cRes').innerHTML = ''; $('cLive').style.display = 'block';
  $('cTitle').textContent = 'Calibrate my hand'; $('cGo').textContent = 'Start'; $('cGo').style.display = '';
  $('cSub').textContent = 'Hold your hand in front of the camera and copy each gesture until the bar is full. Two rounds, about 20 seconds.';
  showCal('open', 0, ''); 
}
function showCal(g, frac, info) {
  $('cBig').textContent = CAL[g][0]; $('cName').textContent = CAL[g][1]; $('cFill').style.width = `${Math.round(frac * 100)}%`;
  $('cInfo').textContent = info || CAL[g][2];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCalib() {
  if (calRunning) return;
  if (!input.camOn) { await toggleCamera(); }
  if (!input.camOn) return;
  calRunning = true; $('cGo').style.display = 'none'; $('camBox').classList.add('big');
  const rounds = [];
  for (let r = 0; r < 2; r++) {
    const round = {}; rounds.push(round);
    for (const g of CAL_ORDER) {
      round[g] = [];
      sfx.pop();
      const t0 = performance.now(); let missing = 0;
      input.calibSink = (x) => { if ((performance.now() - t0) / 1000 > CAL_SKIP) round[g].push(x); };
      while ((performance.now() - t0) / 1000 < CAL_HOLD) {
        const el = (performance.now() - t0) / 1000;
        const vis = input.handVisible(); if (!vis) missing += 1;
        showCal(g, el / CAL_HOLD, vis ? `round ${r + 1} of 2 · ${CAL[g][2]}` : '⚠ no hand visible: move your hand into the camera');
        await sleep(50);
      }
      input.calibSink = null;
      if (round[g].length < 8) {   // hand was not visible: repeat this gesture once
        showCal(g, 0, 'not enough frames, again...'); await sleep(700);
        const t1 = performance.now();
        input.calibSink = (x) => { if ((performance.now() - t1) / 1000 > CAL_SKIP) round[g].push(x); };
        while ((performance.now() - t1) / 1000 < CAL_HOLD) { showCal(g, (performance.now() - t1) / 1000 / CAL_HOLD, CAL[g][2]); await sleep(50); }
        input.calibSink = null;
      }
    }
  }
  $('camBox').classList.remove('big');
  const rep = input.ai.train(rounds);
  calRunning = false;
  $('cLive').style.display = 'none'; $('cGo').style.display = ''; $('cGo').textContent = 'Repeat';
  if (!rep) { $('cTitle').textContent = 'Not enough data'; $('cSub').textContent = 'Keep the whole hand visible in the camera and try again.'; sfx.wrong(); return; }
  sfx.win();
  const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
  $('cTitle').textContent = `Your camera AI: ${pct(rep.accuracy)} accuracy`;
  $('cSub').textContent = 'Trained on round 1 and tested on round 2 (and the other way round), so this is an honest estimate. Below 85%: repeat with clearer gestures.';
  const conf = Object.entries(rep.confusion).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k.replace('close', 'fist').replace('->', ' taken as ')} (${v})`).join(', ');
  $('cRes').innerHTML = `<table><thead><tr><th>Gesture</th><th>Accuracy</th><th>Frames</th></tr></thead><tbody>${GESTURES.map((g) =>
    `<tr><td>${CAL[g][0]} ${CAL[g][1]}</td><td class="${(rep.per[g] ?? 0) >= 0.85 ? 'ok' : 'low'}">${pct(rep.per[g])}</td><td>${rep.samples[g]}</td></tr>`).join('')}</tbody></table>
    <div style="margin-top:10px;font-size:13px;color:var(--ink2)">${conf ? `Most common mix-ups: ${conf}` : 'No mix-ups.'}</div>`;
  input.send({ cmd: 'cam_calibration', report: rep, rounds });
  updateButtons();
}
$('bCalib').onclick = openCalib; $('cGo').onclick = runCalib;
$('cClose').onclick = () => { if (!calRunning) $('calib').classList.remove('show'); };
$('bMute').onclick = () => { setMuted(!isMuted()); updateButtons(); };
$('bAssist').onclick = () => { if (current && 'assist' in current) { current.assist = !current.assist; updateButtons(); } };

// ------------------------------------------------------------------ levels
const levels = { rhythm: new RhythmLevel(renderer, hud), kitchen: new KitchenLevel(renderer, hud), pour: new PourLevel(renderer, hud) };
let current = null;
let menuScene = levels.kitchen;   // the kitchen is the menu background

function startLevel(key) {
  audio(); sfx.click();
  current = levels[key];
  ['menu', 'end', 'dash'].forEach((id) => $(id).classList.remove('show'));
  $('hud').style.display = 'flex'; $('hint').style.display = 'block';
  $('orderCard').style.display = key === 'kitchen' ? 'block' : 'none';
  $('gauge').style.display = key === 'pour' ? 'block' : 'none';
  $('hLevel').textContent = LEVEL_NAMES[key]; $('hLevel').style.color = LEVEL_COLORS[key];
  $('bAssist').style.display = key === 'kitchen' ? '' : 'none';
  hud.score(0);
  current.start();
  input.send({ cmd: 'game_event', level: key, ev: 'start', input: input.label() });
  updateButtons();
}
document.querySelectorAll('.card').forEach((c) => { c.onclick = () => startLevel(c.dataset.level); });

function toMenu() {
  if (current) current.stop();
  current = null;
  ['end', 'dash'].forEach((id) => $(id).classList.remove('show'));
  $('menu').classList.add('show');
  ['hud', 'hint', 'orderCard', 'gauge', 'toast'].forEach((id) => { $(id).style.display = 'none'; });
  loadBest();
}
$('bQuit').onclick = toMenu; $('eMenu').onclick = toMenu;

let lastLevel = null;
function finishLevel(s) {
  lastLevel = current ? current.key : null;
  const row = { ...s, lines: undefined, date: new Date().toISOString(), input: input.label(), model: input.modelName || null };
  delete row.lines;
  input.send({ cmd: 'game_summary', ...row });
  try { const h = JSON.parse(localStorage.getItem('smits_kitchen_history') || '[]'); h.push(row); localStorage.setItem('smits_kitchen_history', JSON.stringify(h.slice(-300))); } catch (e) { /* storage unavailable */ }
  if (current) current.stop();
  $('eTitle').textContent = `${s.title}: complete`;
  $('eStars').textContent = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
  $('eScore').textContent = `Score ${s.score}`;
  $('eLines').innerHTML = s.lines.map((l) => `<li>${l}</li>`).join('');
  ['hud', 'hint', 'orderCard', 'gauge', 'toast'].forEach((id) => { $(id).style.display = 'none'; });
  $('end').classList.add('show');
  current = null;
  sfx.star();
}
$('eAgain').onclick = () => lastLevel && startLevel(lastLevel);

// ------------------------------------------------------------------ dashboard
function localHistory() { try { return JSON.parse(localStorage.getItem('smits_kitchen_history') || '[]'); } catch (e) { return []; } }
function openDash() {
  $('dash').classList.add('show');
  if (input.connected) { renderDashboard(localHistory(), 'loading...'); input.requestHistory(); }
  else renderDashboard(localHistory(), 'saved in this browser (server not connected)');
}
$('bDash').onclick = openDash; $('eDash').onclick = () => { $('end').classList.remove('show'); openDash(); };
$('dClose').onclick = () => $('dash').classList.remove('show');

function keyResult(r) {
  if (r.level === 'rhythm') return `${Math.round((r.accuracy || 0) * 100)}% · ${r.mean_rt_ms ?? '-'} ms`;
  if (r.level === 'kitchen') return `${r.items ?? 0} fruits · ${r.mean_order_s ? r.mean_order_s.toFixed(1) : '-'} s/order`;
  if (r.level === 'pour') return `fill error ${r.mean_fill_error != null ? (r.mean_fill_error * 100).toFixed(1) : '-'}%`;
  return '';
}

function lineChart(rows, color, label) {
  const W = 640, H = 130, P = { l: 40, r: 12, t: 26, b: 22 };
  if (!rows.length) return `<div class="chart"><h4>${label}</h4><div style="color:#5a6270;font-size:12px;padding:20px 0">no sessions yet</div></div>`;
  const ys = rows.map((r) => r.score), max = Math.max(...ys, 1);
  const x = (i) => P.l + (rows.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (rows.length - 1));
  const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#e4e3df"/><text x="${P.l - 6}" y="${y(max * f) + 4}" font-size="10" text-anchor="end" fill="#52514e">${Math.round(max * f)}</text>`).join('');
  const path = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.score)}`).join(' ');
  const dots = rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.score)}" r="5" fill="${color}" stroke="#fcfcfb" stroke-width="2"><title>${new Date(r.date).toLocaleString()} · score ${r.score} · ${keyResult(r)}</title></circle>`).join('');
  const last = rows[rows.length - 1];
  return `<div class="chart"><h4>${label} · score per session</h4><svg viewBox="0 0 ${W} ${H}">${grid}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>${dots}
    <text x="${x(rows.length - 1)}" y="${y(last.score) - 9}" font-size="11" text-anchor="end" fill="#0b0b0b">${last.score}</text>
    <text x="${P.l}" y="${H - 6}" font-size="10" fill="#52514e">session 1</text><text x="${W - P.r}" y="${H - 6}" font-size="10" text-anchor="end" fill="#52514e">session ${rows.length}</text></svg></div>`;
}

function renderDashboard(rows, src) {
  $('dashSrc').textContent = `Sessions are ${src}.`;
  $('charts').innerHTML = ['rhythm', 'kitchen', 'pour'].map((k) => lineChart(rows.filter((r) => r.level === k), LEVEL_COLORS[k], LEVEL_NAMES[k])).join('');
  $('dashRows').innerHTML = rows.slice(-12).reverse().map((r) => `<tr><td>${new Date(r.date).toLocaleString()}</td><td>${LEVEL_NAMES[r.level] || r.level}</td><td>${r.score}</td><td>${'★'.repeat(r.stars || 0)}</td><td>${keyResult(r)}</td><td>${r.input || ''}</td></tr>`).join('');
}

function loadBest() {
  const rows = localHistory();
  ['rhythm', 'kitchen', 'pour'].forEach((k) => {
    const r = rows.filter((x) => x.level === k);
    $(`best_${k}`).textContent = r.length ? `best ${Math.max(...r.map((x) => x.score))} · played ${r.length}×` : 'no score yet';
  });
}
loadBest();

// ------------------------------------------------------------------ loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  Object.values(levels).forEach((l) => { l.camera.aspect = w / h; l.camera.updateProjectionMatrix(); });
}
window.addEventListener('resize', resize); resize();

let last = performance.now(), menuT = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(window.__maxDt || 0.05, (now - last) / 1000); last = now;   // __maxDt: test hook for slow headless GPUs
  input.update(dt);
  $('dConn').classList.toggle('ok', input.connected);
  $('sConn').textContent = input.connected ? (input.hasModel ? `server + AI model (${input.modelName})` : 'server connected, no AI model yet') : 'server not connected (offline demo)';
  $('sInput').textContent = `input: ${input.label()}`;
  $('hInput').textContent = `${input.label()} · ${input.state}`;
  if (current) {
    current.update(dt, input);
    renderer.render(current.scene, current.camera);
  } else {
    menuT += dt;   // slow orbit of the kitchen behind the menu
    const c = menuScene.camera;
    c.position.set(Math.sin(menuT * 0.15) * 0.45, 1.42, 0.45 + Math.cos(menuT * 0.15) * 0.1); c.lookAt(0, 0.84, -0.42);
    input.driveHand(menuScene.hand); menuScene.hand.update(dt);
    renderer.render(menuScene.scene, c);
  }
});
updateButtons();
window.__game = { input, startLevel, levels, toMenu, runCalib };
