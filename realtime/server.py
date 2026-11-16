"""Real-time server: sensor (camera or EMG/FMG band) -> features -> classifier -> virtual hand + game (browser).

Run (Windows examples):
  python realtime\\server.py --source camera                # webcam hand tracking is the sensor
  python realtime\\server.py --source sim                   # simulated band, no hardware
  python realtime\\server.py --source serial --port COM5    # ESP32 band (camera can be the label teacher)
  python realtime\\server.py --source replay --file recordings\\x.csv
Then open http://localhost:8000.

Modes (from the web page): calibrate (guided gestures -> trains LDA), record (guided, logged),
run (live control). Labels come from the on-screen prompts or, optionally, from the camera ("teacher").
Game results are logged to recordings/game_<time>.csv.
"""
import argparse
import asyncio
import csv
import functools
import http.server
import json
import mimetypes
import os
import sys
import threading
import time
from collections import Counter, deque

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from pb.features import CausalEMGFilter, emg_td_features, fmg_features  # noqa: E402
from pb.models import make_classifier, save_model, load_model  # noqa: E402
from sources import SerialSource, SimSource, ReplaySource, FS, N_EMG, N_FMG, GESTURES  # noqa: E402

WIN, STEP, VOTE = 200, 50, 3          # band: 200 ms windows every 50 ms at 1 kHz, majority vote over 3
CAM_WIN = 6                           # camera: ~200 ms of frames at 30 fps
N_CAM = 7                             # curls x5, pinch distance, spread
CAM_FRESH_S = 0.3


def featurize(emg_win, fmg_win):
    """Band feature row; identical to the offline pipeline (log-compressed EMG amplitude features)."""
    e = emg_td_features(emg_win, np.array([0]), len(emg_win), zc_thresh=0.01)
    e[:, :3 * N_EMG] = np.log(e[:, :3 * N_EMG] + 1e-8)
    f = fmg_features(fmg_win, np.array([0]), len(fmg_win))
    return np.hstack([e, f])[0]


def featurize_cam(frames):
    """Camera feature row: mean of the last ~200 ms of frames + the newest frame."""
    a = np.asarray(frames, float)
    return np.hstack([a.mean(0), a[-1]])


class CameraSource:
    """Frames are pushed by the browser (MediaPipe hand landmarks -> 7 features)."""

    def __init__(self):
        self.q = deque()
        self.t0 = time.time()

    def push(self, f):
        if len(f) == N_CAM:
            self.q.append((time.time() - self.t0, f))

    def send(self, ch):
        pass

    def read(self):
        if not self.q:
            return None
        items = [self.q.popleft() for _ in range(len(self.q))]
        return np.array([t for t, _ in items]), np.array([f for _, f in items], float)


class Protocol:
    """Guided sequence: for each repetition and gesture: prepare (no label), then hold (labelled)."""

    def __init__(self, reps, hold_s=4.0, prep_s=2.0, gestures=GESTURES, settle_s=0.5):
        self.steps = [(r + 1, g) for r in range(reps) for g in gestures]
        self.hold, self.prep, self.settle = hold_s, prep_s, settle_s
        self.t0 = time.time()
        self.reps = reps

    def status(self):
        el = time.time() - self.t0
        per = self.prep + self.hold
        i = int(el // per)
        if i >= len(self.steps):
            return None
        rep, g = self.steps[i]
        within = el - i * per
        phase = "prepare" if within < self.prep else "hold"
        rem = (self.prep - within) if phase == "prepare" else (per - within)
        labelled = phase == "hold" and within >= self.prep + self.settle
        return {"rep": rep, "of": self.reps, "gesture": g, "phase": phase, "remaining": round(rem, 1),
                "labelled": labelled, "step": i + 1, "steps": len(self.steps)}


class Engine:
    def __init__(self, source, out_dir):
        self.src = source
        self.camera_input = isinstance(source, CameraSource)
        self.out_dir = out_dir
        os.makedirs(os.path.join(out_dir, "recordings"), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "models"), exist_ok=True)
        self.filt = CausalEMGFilter(FS, N_EMG)
        self.emg, self.fmg = deque(maxlen=2000), deque(maxlen=2000)
        self.cam = deque(maxlen=CAM_WIN)
        self.since_step = 0
        self.model, self.model_name = None, None
        self.votes = deque(maxlen=VOTE)
        self.state, self.probs = "rest", {}
        self.mode, self.protocol = "run", None
        self.cal_X, self.cal_y = [], []
        self.log, self.tag = None, ""
        self.proc_ms = 0.0
        self.last_sent_state = None
        self.label_source = "prompts"
        self.cam_g, self.cam_t = None, 0.0
        self.game_log = None

    # ---------------------------------------------------------------- labels
    def current_label(self, st):
        """Gesture label for the current moment, or None."""
        if not st:
            return None
        if self.label_source == "camera":
            fresh = time.time() - self.cam_t < CAM_FRESH_S
            return self.cam_g if fresh and self.cam_g in GESTURES else None
        return st["gesture"] if st["labelled"] else None

    # ---------------------------------------------------------------- modes
    def start(self, mode, reps=5, hold=4.0, tag=""):
        self.stop()
        self.mode = mode
        self.protocol = Protocol(reps, hold_s=hold)
        self.cal_X, self.cal_y = [], []
        self.tag = tag
        stamp = time.strftime("%Y%m%d_%H%M%S")
        kind = "cam" if self.camera_input else "band"
        name = f"{mode}_{stamp}_{kind}{'_' + tag if tag else ''}"
        path = os.path.join(self.out_dir, "recordings", name + ".csv")
        self.log = open(path, "w")
        if self.camera_input:
            cols = [f"cam{i}" for i in range(N_CAM)]
        else:
            cols = [f"emg{i}" for i in range(N_EMG)] + [f"fmg{i}" for i in range(N_FMG)]
        self.log.write("t," + ",".join(cols) + ",label,rep\n")
        with open(path.replace(".csv", ".json"), "w") as f:
            json.dump({"mode": mode, "tag": tag, "reps": reps, "hold_s": hold, "fs": 30.0 if self.camera_input else FS,
                       "input": kind, "label_source": self.label_source, "gestures": GESTURES, "started": stamp}, f, indent=2)
        print(f"[{mode}] started ({kind}, labels from {self.label_source}) -> {path}")

    def stop(self):
        if self.log:
            self.log.close()
            self.log = None
        if self.mode == "calibrate" and len(self.cal_y) > 20:
            self.train()
        self.mode, self.protocol = "run", None

    def train(self):
        X, y = np.array(self.cal_X), np.array(self.cal_y)
        if len(set(y)) < 2:
            print("not enough classes to train")
            return
        m = make_classifier("lda").fit(X, y)
        kind = "cam" if self.camera_input else "band"
        name = f"lda_{kind}_{time.strftime('%Y%m%d_%H%M%S')}"
        save_model(os.path.join(self.out_dir, "models", name + ".joblib"), m,
                   {"classes": [str(c) for c in m.classes_], "n_windows": int(len(y)), "input": kind,
                    "label_source": self.label_source,
                    "per_class": {g: int((y == g).sum()) for g in GESTURES}})
        self.model, self.model_name = m, name
        self.votes.clear()
        print(f"trained {name} on {len(y)} windows: " + ", ".join(f"{g}={int((y == g).sum())}" for g in GESTURES))

    def load(self, path):
        self.model, _ = load_model(path)
        self.model_name = os.path.basename(path)

    def game_event(self, ev):
        if ev.get("ev") == "start" or self.game_log is None:
            stamp = time.strftime("%Y%m%d_%H%M%S")
            path = os.path.join(self.out_dir, "recordings", f"game_{stamp}.csv")
            self.game_log = open(path, "w", newline="")
            self.game_writer = csv.writer(self.game_log)
            self.game_writer.writerow(["time", "event", "item", "result", "grab_s", "release_s", "input", "model"])
            print(f"[game] logging -> {path}")
        self.game_writer.writerow([time.strftime("%H:%M:%S"), ev.get("ev"), ev.get("item", ""), ev.get("result", ""),
                                   ev.get("grab_s", ""), ev.get("release_s", ""), type(self.src).__name__, self.model_name or ""])
        self.game_log.flush()
        if ev.get("ev") == "stop":
            print("[game] summary:", {k: ev.get(k) for k in ("trials", "success", "success_rate", "mean_grab_s")})

    # ---------------------------------------------------------------- game logs (Smit's Kitchen)
    def log_jsonl(self, name, m):
        m = {k: v for k, v in m.items() if k != "cmd"}
        m["t"] = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(os.path.join(self.out_dir, "recordings", name), "a") as f:
            f.write(json.dumps(m) + "\n")

    def history_path(self):
        return os.path.join(self.out_dir, "recordings", "game_history.json")

    def history(self):
        try:
            with open(self.history_path()) as f:
                return json.load(f)
        except (OSError, ValueError):
            return []

    def add_history(self, m):
        h = self.history()
        h.append({k: v for k, v in m.items() if k != "cmd"})
        with open(self.history_path(), "w") as f:
            json.dump(h, f, indent=1)
        print(f"[game] {m.get('level')} finished: score {m.get('score')}, stars {m.get('stars')}")

    def band_intensity(self):
        """Grip strength 0..1 from the band: EMG RMS and FMG mean, scaled by a slowly adapting range."""
        if len(self.emg) < WIN:
            return None
        e = float(np.sqrt((np.array(self.emg)[-WIN:] ** 2).mean()))
        f = float(np.mean(self.fmg[-1])) if len(self.fmg) else 0.0
        v = e + f
        self.i_lo = min(getattr(self, "i_lo", v), v) * 0.999 + v * 0.001
        self.i_hi = max(getattr(self, "i_hi", v + 1e-3), v) * 0.9995 + v * 0.0005
        return float(np.clip((v - self.i_lo) / max(1e-6, self.i_hi - self.i_lo), 0, 1))

    # ---------------------------------------------------------------- processing
    def decide(self, x):
        if self.model is None:
            return
        p = self.model.predict_proba(x[None])[0]
        self.probs = {str(c): float(v) for c, v in zip(self.model.classes_, p)}
        self.votes.append(str(self.model.classes_[int(np.argmax(p))]))
        self.state = Counter(self.votes).most_common(1)[0][0]

    def step(self):
        blk = self.src.read()
        if blk is None:
            return False
        t_arrive = time.perf_counter()
        st = self.protocol.status() if self.protocol else None
        if self.protocol and st is None:
            self.stop()
        lab = self.current_label(st)
        lab_i = GESTURES.index(lab) if lab else -1
        rep = st["rep"] if st else 0
        if self.camera_input:
            ts, cam = blk
            if self.log:
                np.savetxt(self.log, np.column_stack([ts, cam, np.full(len(ts), lab_i), np.full(len(ts), rep)]),
                           delimiter=",", fmt=["%.4f"] + ["%.4f"] * N_CAM + ["%d", "%d"])
            for i in range(len(ts)):
                self.cam.append(cam[i])
                if len(self.cam) >= 3:
                    x = featurize_cam(self.cam)
                    if self.mode == "calibrate" and lab:
                        self.cal_X.append(x)
                        self.cal_y.append(lab)
                    self.decide(x)
            self.proc_ms = (time.perf_counter() - t_arrive) * 1000
            return True
        ts, emg, fmg = blk
        emg_f = self.filt(emg)
        if self.log:
            arr = np.column_stack([ts, emg, fmg, np.full(len(ts), lab_i), np.full(len(ts), rep)])
            np.savetxt(self.log, arr, delimiter=",", fmt=["%.4f"] + ["%.5f"] * (N_EMG + N_FMG) + ["%d", "%d"])
        for i in range(len(ts)):
            self.emg.append(emg_f[i])
            self.fmg.append(fmg[i])
            self.since_step += 1
            if self.since_step >= STEP and len(self.emg) >= WIN:
                self.since_step = 0
                x = featurize(np.array(self.emg)[-WIN:], np.array(self.fmg)[-WIN:])
                if self.mode == "calibrate" and lab:
                    self.cal_X.append(x)
                    self.cal_y.append(lab)
                self.decide(x)
                self.proc_ms = (time.perf_counter() - t_arrive) * 1000
        if self.state != self.last_sent_state:
            self.src.send({"close": "C", "open": "O", "rest": "R", "pinch": "P"}.get(self.state, "R"))
            self.last_sent_state = self.state
        return True

    def frame(self):
        st = self.protocol.status() if self.protocol else None
        out = {"type": "frame", "state": self.state if self.model is not None else None, "probs": self.probs,
               "mode": self.mode, "prompt": st, "proc_ms": round(self.proc_ms, 2), "model": self.model_name,
               "n_cal": len(self.cal_y), "source": type(self.src).__name__, "label_source": self.label_source}
        if not self.camera_input:
            e = np.array(self.emg)[-WIN:] if len(self.emg) >= WIN else np.zeros((WIN, N_EMG))
            out["emg"] = np.sqrt((e ** 2).mean(0)).round(4).tolist()
            out["fmg"] = np.round(np.array(self.fmg)[-1] if len(self.fmg) else np.zeros(N_FMG), 3).tolist()
            bi = self.band_intensity()
            out["intensity"] = None if bi is None else round(bi, 3)
        return out


# ---------------------------------------------------------------- 3D models from Meshy (or anywhere)
MODEL_SLOTS = {
    "apple": ["apple"], "orange": ["orange", "mandarin", "naranja", "tangerine", "citrus"], "banana": ["banana"],
    "strawberry": ["strawberr"], "grape": ["grape"], "cherry": ["cherr"], "bowl": ["fruit_bowl", "fruitbowl", "bowl", "plate"],
}
MODEL_EXCLUDE = {"apple": ["pineapple"], "grape": ["grapefruit"]}


def import_models():
    """Copy GLB files downloaded from Meshy (Downloads folder) into virtual_hand/models/<slot>.glb.
    A file is matched by a word in its name, e.g. Meshy_AI_A_photorealistic_apple_..._texture.glb -> apple.glb.
    The newest matching download wins. You can also drop your own apple.glb etc. into virtual_hand/models/."""
    import glob
    import shutil
    mdir = os.path.join(ROOT, "virtual_hand", "models")
    os.makedirs(mdir, exist_ok=True)
    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    files = sorted(glob.glob(os.path.join(downloads, "*.glb")), key=os.path.getmtime) if os.path.isdir(downloads) else []
    for slot, words in MODEL_SLOTS.items():
        hits = [f for f in files if any(w in os.path.basename(f).lower() for w in words)
                and not any(x in os.path.basename(f).lower() for x in MODEL_EXCLUDE.get(slot, []))]
        if not hits:
            continue
        src, dst = hits[-1], os.path.join(mdir, slot + ".glb")
        if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
            shutil.copy2(src, dst)
            print(f"[models] {slot}.glb <- {os.path.basename(src)}")
    have = sorted(os.path.splitext(f)[0] for f in os.listdir(mdir) if f.endswith(".glb"))
    with open(os.path.join(mdir, "manifest.json"), "w") as fh:
        json.dump({"models": have}, fh)
    print("[models] in the game:", ", ".join(have) if have else "none (built-in shapes)")


def start_http(port):
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("text/javascript", ".mjs")
    directory = os.path.join(ROOT, "virtual_hand")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          ".wasm": "application/wasm", ".mjs": "text/javascript", ".js": "text/javascript"}

        def log_message(self, *a):
            pass

        def end_headers(self):
            # never cache the app files: every F5 loads the newest code
            self.send_header("Cache-Control", "no-store, must-revalidate")
            super().end_headers()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=directory))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"virtual hand: http://localhost:{port}")


async def main_async(args):
    from websockets.asyncio.server import serve
    if args.source == "serial":
        src = SerialSource(args.port)
    elif args.source == "replay":
        src = ReplaySource(args.file)
    elif args.source == "camera":
        src = CameraSource()
    else:
        src = SimSource()
    eng = Engine(src, args.out)
    if args.model:
        eng.load(args.model)
    clients = set()

    async def handler(ws):
        clients.add(ws)
        try:
            async for msg in ws:
                try:
                    m = json.loads(msg)
                except ValueError:
                    continue
                cmd = m.get("cmd")
                if cmd == "cam":
                    eng.cam_g, eng.cam_t = m.get("g"), time.time()
                    if isinstance(src, CameraSource):
                        src.push(m.get("f", []))
                elif cmd == "cam_lost" and isinstance(src, CameraSource):
                    eng.cam_g = None
                    eng.cam.clear()
                    eng.votes.clear()
                    eng.state, eng.probs = "rest", {}
                elif cmd in ("calibrate", "record"):
                    eng.start(cmd, int(m.get("reps", 5)), float(m.get("hold", 4.0)), m.get("tag", ""))
                elif cmd == "stop":
                    eng.stop()
                elif cmd == "label_source":
                    eng.label_source = "camera" if m.get("value") == "camera" else "prompts"
                elif cmd == "game":
                    eng.game_event(m)
                elif cmd == "game_event":
                    eng.log_jsonl("game_events.jsonl", m)
                elif cmd == "game_summary":
                    eng.add_history(m)
                elif cmd == "motion":
                    # recorded hand movement from the camera (3D landmarks per frame) -> recordings/motion_<time>.json
                    fn = os.path.join(eng.rec_dir if hasattr(eng, "rec_dir") else os.path.join(ROOT, "recordings"),
                                      time.strftime("motion_%Y%m%d_%H%M%S.json"))
                    os.makedirs(os.path.dirname(fn), exist_ok=True)
                    with open(fn, "w") as fh:
                        json.dump({"meta": m.get("meta"), "frames": m.get("frames", [])}, fh)
                    print("[motion] saved", len(m.get("frames", [])), "frames ->", fn)
                elif cmd == "cam_calibration":
                    # personal camera AI: accuracy report + all samples (thesis: camera-label quality)
                    eng.log_jsonl("camera_calibration.jsonl", m)
                    print("[camera AI] personal calibration, accuracy:", m.get("report", {}).get("accuracy"))
                elif cmd == "history":
                    await ws.send(json.dumps({"type": "history", "sessions": eng.history()}))
                elif cmd == "intent" and isinstance(src, SimSource):
                    src.set_intent(m.get("gesture", "rest"))
        finally:
            clients.discard(ws)

    async def pump():
        last_send = 0.0
        while True:
            progressed = eng.step()
            now = time.time()
            if now - last_send > 0.05 and clients:
                last_send = now
                data = json.dumps(eng.frame())
                for c in list(clients):
                    try:
                        await c.send(data)
                    except Exception:
                        clients.discard(c)
            await asyncio.sleep(0 if progressed else 0.003)

    start_http(args.http_port)
    async with serve(handler, "127.0.0.1", args.ws_port, max_size=64 * 1024 * 1024):   # motion recordings can be large
        print(f"websocket: ws://localhost:{args.ws_port}  source={args.source}")
        await pump()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["camera", "sim", "serial", "replay"], default="camera")
    ap.add_argument("--port", help="serial port, e.g. COM5 or /dev/ttyUSB0")
    ap.add_argument("--file", help="CSV for --source replay")
    ap.add_argument("--model", help="trained model (.joblib) to load at start")
    ap.add_argument("--out", default=ROOT, help="where recordings/ and models/ are written")
    ap.add_argument("--http-port", type=int, default=8000)
    ap.add_argument("--ws-port", type=int, default=8765)
    args = ap.parse_args()
    try:
        import_models()
    except Exception as e:  # never block the server because of a model file
        print("[models] import skipped:", e)
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
