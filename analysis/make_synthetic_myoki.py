"""Create small fake participant files in the MyoKi format (HDF5 / MATLAB v7.3 layout).
Only for testing the pipeline before the real data is downloaded. Results on these files mean nothing.

python analysis/make_synthetic_myoki.py --out synthetic_data --n 4
"""
import argparse
import os
import numpy as np
import h5py


def make_subject(path, seed, fs=2000.0, hold_s=3.0, trans_s=1.0):
    rng = np.random.default_rng(seed)
    classes = [1, 2, 3, 4, 5, 6]
    base_emg = rng.uniform(0.1, 1.0, size=(7, 12))      # class activation pattern (0 = rest)
    base_fmg = rng.uniform(0.2, 1.0, size=(7, 24))
    subj_gain_e = rng.uniform(0.7, 1.3, size=12)
    subj_gain_f = rng.uniform(0.7, 1.3, size=24)
    grasp, rep, env_e, lvl_f = [], [], [], []
    for r in range(1, 7):
        for c in classes:
            nt, nh = int(trans_s * fs), int(hold_s * fs)
            grasp += [0] * nt + [c] * nh
            rep += [r] * (nt + nh)
            env_e.append(np.tile(0.05 * base_emg[0], (nt, 1)))
            env_e.append(np.tile(base_emg[c] * subj_gain_e * rng.uniform(0.8, 1.2), (nh, 1)))
            lvl_f.append(np.tile(0.3 * base_fmg[0], (nt, 1)))
            lvl_f.append(np.tile(base_fmg[c] * subj_gain_f * rng.uniform(0.85, 1.15), (nh, 1)))
    env_e, lvl_f = np.vstack(env_e), np.vstack(lvl_f)
    n = len(grasp)
    emg = (rng.standard_normal((n, 12)) * env_e * 1e-4).astype(np.float64)
    # FMG: ~89 Hz sensor, zero-order hold to fs
    hold = int(fs / 89.4)
    fmg = lvl_f + 0.08 * rng.standard_normal((n, 24))
    fmg = np.repeat(fmg[::hold], hold, axis=0)[:n]
    fmg = np.clip(fmg * 1.5, 0, 3.3)
    with h5py.File(path, "w") as f:   # store transposed like MATLAB v7.3 (channels x samples)
        f["emg"] = emg.T
        f["fmg"] = fmg.T
        f["grasp"] = np.array(grasp, float)[None, :]
        f["repetition"] = np.array(rep, float)[None, :]
        f["frequency"] = np.array([[fs]])
    return n


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="synthetic_data")
    ap.add_argument("--n", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for i in range(a.n):
        name = f"P{26 + i:02d}"
        n = make_subject(os.path.join(a.out, f"{name}.mat"), seed=i)
        print(name, n, "samples")
