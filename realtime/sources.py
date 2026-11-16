"""Data sources for the real-time system. All yield blocks of (t_s, emg[n,2], fmg[n,16]) at 1 kHz.

SerialSource  - the ESP32 band (firmware/esp32_band)
SimSource     - synthetic signals; the 'intent' is set from the web page (no hardware needed)
ReplaySource  - plays back a recorded session CSV in real time
"""
import time
import threading
import numpy as np

FS = 1000.0
N_EMG, N_FMG = 2, 16
GESTURES = ["rest", "open", "close", "pinch"]


class SerialSource:
    def __init__(self, port, baud=921600):
        import serial
        self.ser = serial.Serial(port, baud, timeout=0)
        self.fmg_last = np.zeros(N_FMG)
        self.buf = b""

    def send(self, ch):
        try:
            self.ser.write(ch.encode())
        except Exception:
            pass

    def read(self):
        self.buf += self.ser.read(self.ser.in_waiting or 1)
        *lines, self.buf = self.buf.split(b"\n")
        ts, emg, fmg = [], [], []
        for ln in lines:
            p = ln.strip().split(b",")
            try:
                if p[0] == b"E" and len(p) == 4:
                    ts.append(int(p[1]) / 1000.0)
                    emg.append([int(p[2]) * 3.3 / 4095 - 1.5, int(p[3]) * 3.3 / 4095 - 1.5])
                    fmg.append(self.fmg_last.copy())
                elif p[0] == b"F" and len(p) == 2 + N_FMG:
                    self.fmg_last = np.array([int(v) for v in p[2:]], float) * 3.3 / 4095
            except ValueError:
                continue
        if not ts:
            return None
        return np.array(ts), np.array(emg), np.array(fmg)


class SimSource:
    """Synthetic band: each gesture has its own EMG/FMG pattern plus noise and a little drift."""

    def __init__(self, seed=1):
        rng = np.random.default_rng(seed)
        self.rng = rng
        self.patterns_e = {"rest": [0.03, 0.03], "open": [0.08, 0.55], "close": [0.6, 0.12], "pinch": [0.35, 0.3]}
        base = rng.uniform(0.3, 0.6, N_FMG)
        self.patterns_f = {
            "rest": base,
            "open": base + np.r_[np.zeros(8), rng.uniform(0.3, 0.8, 8)],
            "close": base + np.r_[rng.uniform(0.4, 0.9, 8), np.zeros(8)],
            "pinch": base + rng.uniform(0.0, 0.5, N_FMG) * (np.arange(N_FMG) % 3 == 0),
        }
        self.intent = "rest"
        self.env = np.array(self.patterns_e["rest"], float)
        self.lvl = self.patterns_f["rest"].copy()
        self.t0 = time.time()
        self.t_last = self.t0
        self.lock = threading.Lock()

    def set_intent(self, g):
        if g in GESTURES:
            with self.lock:
                self.intent = g

    def send(self, ch):
        pass

    def read(self):
        now = time.time()
        n = int((now - self.t_last) * FS)
        if n <= 0:
            time.sleep(0.002)
            return None
        with self.lock:
            tgt_e = np.array(self.patterns_e[self.intent])
            tgt_f = self.patterns_f[self.intent]
        ts = self.t_last - self.t0 + np.arange(1, n + 1) / FS
        self.t_last += n / FS
        # muscle activation follows the intent with a ~60 ms time constant
        a = 1 - np.exp(-np.arange(1, n + 1)[:, None] / (0.06 * FS))
        env = self.env + (tgt_e - self.env) * a
        lvl = self.lvl + (tgt_f - self.lvl) * a
        self.env, self.lvl = env[-1], lvl[-1]
        emg = self.rng.standard_normal((n, N_EMG)) * env + 0.01 * np.sin(2 * np.pi * 50 * ts)[:, None]
        fmg = lvl + 0.02 * self.rng.standard_normal((n, N_FMG))
        return ts, emg, fmg


class ReplaySource:
    def __init__(self, csv_path, speed=1.0):
        import pandas as pd
        d = pd.read_csv(csv_path)
        self.t = d["t"].to_numpy()
        self.emg = d[[f"emg{i}" for i in range(N_EMG)]].to_numpy()
        self.fmg = d[[f"fmg{i}" for i in range(N_FMG)]].to_numpy()
        self.i = 0
        self.t0 = time.time()
        self.speed = speed

    def send(self, ch):
        pass

    def read(self):
        if self.i >= len(self.t):
            return None
        el = (time.time() - self.t0) * self.speed + self.t[0]
        j = np.searchsorted(self.t, el, side="right")
        if j <= self.i:
            time.sleep(0.002)
            return None
        sl = slice(self.i, j)
        self.i = j
        return self.t[sl], self.emg[sl], self.fmg[sl]
