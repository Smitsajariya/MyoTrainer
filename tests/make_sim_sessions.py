"""Write fake recording sessions (same format as realtime/server.py) to test analysis/own_experiments.py.
Each 'day' gets a slightly different sensor gain (re-donning the band); shift sessions mix FMG channels."""
import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "realtime"))
from sources import SimSource, GESTURES, N_EMG, N_FMG  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "sim_recordings"
os.makedirs(out, exist_ok=True)
fs, prep, hold, reps = 1000, 2.0, 4.0, 6
for day in (1, 2, 3):
    for shift in (0, 1, 2) if day == 3 else (0,):
        src = SimSource(seed=1)
        rng = np.random.default_rng(day * 10 + shift)
        ge, gf = rng.uniform(0.8, 1.2, N_EMG), rng.uniform(0.85, 1.15, N_FMG)
        rows = []
        t = 0.0
        for r in range(1, reps + 1):
            for g in GESTURES:
                for phase, dur in (("prep", prep), ("hold", hold)):
                    src.set_intent(g if phase == "hold" else "rest")
                    n = int(dur * fs)
                    src.t_last -= dur          # pretend 'dur' seconds passed
                    ts, e, f = src.read()
                    e, f = e[:n] * ge, f[:n] * gf
                    if shift:
                        f = np.roll(f, shift, axis=1) * 0.5 + f * 0.5
                    lab = GESTURES.index(g) if phase == "hold" else -1
                    lab_arr = np.full(n, lab)
                    lab_arr[: int(0.5 * fs)] = -1 if phase == "hold" else lab_arr[: int(0.5 * fs)]
                    tt = t + np.arange(n) / fs
                    t += dur
                    rows.append(np.column_stack([tt, e, f, lab_arr, np.full(n, r)]))
        arr = np.vstack(rows)
        tag = f"day{day}" + (f"_shift{shift}cm" if shift else "")
        name = f"record_2026120{day}_10000{shift}_{tag}"
        np.savetxt(os.path.join(out, name + ".csv"), arr, delimiter=",", comments="",
                   header="t," + ",".join(f"emg{i}" for i in range(N_EMG)) + "," + ",".join(f"fmg{i}" for i in range(N_FMG)) + ",label,rep",
                   fmt=["%.4f"] + ["%.5f"] * (N_EMG + N_FMG) + ["%d", "%d"])
        json.dump({"mode": "record", "tag": tag, "reps": reps, "hold_s": hold, "fs": fs}, open(os.path.join(out, name + ".json"), "w"))
        print(name, len(arr))
