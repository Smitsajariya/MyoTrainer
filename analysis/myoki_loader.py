"""Load MyoKi participant files (P01.mat ... P35.mat) and turn them into windowed features.

MyoKi (Andreas et al., Scientific Data 2025, CC BY 4.0, figshare DOI 10.6084/m9.figshare.28696778)
Fields used: emg (N x 12, V), fmg (N x 24, 0-3.3 V, P26-P35 only), grasp (0 rest/transition,
1 cylindrical, 2 spherical, 3 hook, 4 tripod, 5 pinch, 6 lumbrical, 7 complex), repetition (1-6),
frequency (~2000 Hz). Files are large (~4 GB); this loader reads only the needed variables and
caches the features per participant in <cache_dir>/Pxx_wWIN_sSTEP.npz so the slow step runs once.
"""
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pb.features import filter_emg_offline, window_starts, emg_td_features, fmg_features, window_labels_fast  # noqa: E402

GRASP_NAMES = {0: "rest/transition", 1: "cylindrical", 2: "spherical", 3: "hook",
               4: "tripod", 5: "pinch", 6: "lumbrical", 7: "complex"}
DEFAULT_CLASSES = (1, 2, 3, 4, 5, 6)


def _read_mat(path, fields):
    """Read selected variables from a MATLAB file (v7.3/HDF5 via h5py, older via scipy)."""
    try:
        import h5py
        with h5py.File(path, "r") as f:
            out = {}
            for k in fields:
                if k not in f:
                    continue
                a = np.array(f[k])
                # MATLAB stores column-major: h5py sees (channels, samples). Make it (samples, channels).
                if a.ndim == 2 and a.shape[0] < a.shape[1]:
                    a = a.T
                out[k] = a
            return out
    except (OSError, ValueError):
        from scipy.io import loadmat
        d = loadmat(path, variable_names=list(fields))
        return {k: np.asarray(d[k]) for k in fields if k in d}


def load_participant(path, cache_dir, win_ms=200, step_ms=50, classes=DEFAULT_CLASSES, verbose=True):
    """Return dict with X_emg (windows x 60), X_fmg (windows x 24 or None), y, rep."""
    name = os.path.splitext(os.path.basename(path))[0]
    os.makedirs(cache_dir, exist_ok=True)
    cache = os.path.join(cache_dir, f"{name}_w{win_ms}_s{step_ms}.npz")
    if os.path.exists(cache):
        d = np.load(cache, allow_pickle=False)
        X_fmg = d["X_fmg"] if d["X_fmg"].size else None
        return {"name": name, "X_emg": d["X_emg"], "X_fmg": X_fmg, "y": d["y"], "rep": d["rep"], "fs": float(d["fs"])}

    if verbose:
        print(f"[{name}] reading {path} ...", flush=True)
    m = _read_mat(path, ["emg", "fmg", "grasp", "repetition", "frequency"])
    fs = float(np.asarray(m["frequency"]).ravel()[0])
    emg = np.asarray(m["emg"], dtype=np.float64)
    grasp = np.asarray(m["grasp"]).ravel().astype(int)
    rep = np.asarray(m["repetition"]).ravel().astype(int)
    fmg = np.asarray(m["fmg"], dtype=np.float64) if "fmg" in m and np.size(m["fmg"]) > 0 else None

    win = int(round(win_ms * fs / 1000))
    step = int(round(step_ms * fs / 1000))
    if verbose:
        print(f"[{name}] fs={fs:.1f} Hz, samples={len(emg)}, filtering + features ...", flush=True)
    emg_f = filter_emg_offline(emg, fs)
    starts = window_starts(len(emg_f), win, step)
    X_emg = emg_td_features(emg_f, starts, win)
    X_fmg = fmg_features(fmg, starts, win) if fmg is not None else None
    y = window_labels_fast(grasp, starts, win)
    r = window_labels_fast(rep, starts, win)

    keep = np.isin(y, classes) & (r > 0)
    X_emg, y, r = X_emg[keep], y[keep], r[keep]
    if X_fmg is not None:
        X_fmg = X_fmg[keep]
    np.savez_compressed(cache, X_emg=X_emg, X_fmg=X_fmg if X_fmg is not None else np.zeros(0),
                        y=y, rep=r, fs=fs)
    if verbose:
        print(f"[{name}] {len(y)} labelled windows cached -> {cache}", flush=True)
    return {"name": name, "X_emg": X_emg, "X_fmg": X_fmg, "y": y, "rep": r, "fs": fs}


# --------------------------------------------------------------------------- channel selection
N_EMG_FEATS = 5  # MAV, RMS, WL, ZC, SSC


def emg_cols(channels, n_channels=12):
    """Column indices of all 5 features for the chosen EMG channels (0-based)."""
    return [f * n_channels + c for f in range(N_EMG_FEATS) for c in channels]


def fmg_module_cols(modules, per_module=4):
    """FMG columns for bracelet modules (0-based). Assumes the 24 FMG columns are grouped
    4 per module in module order (check Fig. 4 of the MyoKi paper and adjust if needed)."""
    return [m * per_module + k for m in modules for k in range(per_module)]


# Sensor configurations compared in the thesis
CONFIGS = {
    "EMG 6ch":            {"emg": list(range(6)), "fmg_modules": []},
    "FMG 24ch":           {"emg": [],             "fmg_modules": [0, 1, 2, 3, 4, 5]},
    "Hybrid 6+24":        {"emg": list(range(6)), "fmg_modules": [0, 1, 2, 3, 4, 5]},
    # low-cost band similar to our hardware: 2 EMG + 16 FSR
    "EMG 2ch":            {"emg": [6, 7],         "fmg_modules": []},
    "FMG 16ch":           {"emg": [],             "fmg_modules": [0, 1, 3, 4]},
    "Hybrid 2+16":        {"emg": [6, 7],         "fmg_modules": [0, 1, 3, 4]},
    "FMG 8ch":            {"emg": [],             "fmg_modules": [0, 3]},
}


def build_X(subj, cfg, rotate_modules=0):
    """Assemble the feature matrix for a sensor configuration.
    rotate_modules simulates the band being put on rotated by N module positions (60 deg each)."""
    parts = []
    if cfg["emg"]:
        ch = list(cfg["emg"])
        if rotate_modules:
            ch = [((c + rotate_modules) % 6) if c < 6 else c for c in ch]
        Xe = subj["X_emg"][:, emg_cols(ch)].copy()
        nf = len(ch)
        Xe[:, :3 * nf] = np.log(Xe[:, :3 * nf] + 1e-8)  # log-compress MAV/RMS/WL
        parts.append(Xe)
    if cfg["fmg_modules"]:
        if subj["X_fmg"] is None:
            return None
        mods = [((m + rotate_modules) % 6) for m in cfg["fmg_modules"]]
        parts.append(subj["X_fmg"][:, fmg_module_cols(mods)])
    return np.hstack(parts)
