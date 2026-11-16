"""Signal conditioning and feature extraction shared by offline analysis and the real-time system.

EMG: band-pass 20-450 Hz + 50 Hz notch, then Hudgins time-domain features per channel
     (MAV, RMS, WL, ZC, SSC) over sliding windows.
FMG: mean (and optionally slope) per channel over the same windows.
"""
import numpy as np
from scipy import signal

EMG_FEATURES = ("MAV", "RMS", "WL", "ZC", "SSC")


# --------------------------------------------------------------------------- filters
def design_emg_filter(fs, low=20.0, high=450.0, notch=50.0, order=4):
    """Return a list of SOS sections: band-pass (+ notch if inside the band)."""
    nyq = fs / 2.0
    high = min(high, 0.45 * fs)
    sos = [signal.butter(order, [low / nyq, high / nyq], btype="bandpass", output="sos")]
    if notch and notch < high:
        b, a = signal.iirnotch(notch / nyq, Q=30.0)
        sos.append(signal.tf2sos(b, a))
    return np.vstack(sos)


def filter_emg_offline(emg, fs, **kw):
    """Zero-phase filtering for recorded data. emg: (samples, channels)."""
    sos = design_emg_filter(fs, **kw)
    return signal.sosfiltfilt(sos, emg, axis=0)


class CausalEMGFilter:
    """Streaming (causal) version of the same filter for real-time use."""

    def __init__(self, fs, n_channels, **kw):
        self.sos = design_emg_filter(fs, **kw)
        self.zi = np.zeros((self.sos.shape[0], 2, n_channels))

    def __call__(self, chunk):
        out, self.zi = signal.sosfilt(self.sos, chunk, axis=0, zi=self.zi)
        return out


# --------------------------------------------------------------------------- windows
def window_starts(n_samples, win, step):
    if n_samples < win:
        return np.zeros(0, dtype=int)
    return np.arange(0, n_samples - win + 1, step)


def _window_sum(cs, starts, win):
    """cs: cumulative sum with a leading zero row, shape (n+1, ch)."""
    return cs[starts + win] - cs[starts]


def emg_td_features(emg, starts, win, zc_thresh=None):
    """Vectorised Hudgins features for all windows.

    emg: filtered EMG (samples, channels). Returns (windows, channels*5) ordered
    [MAV_ch0..chN, RMS_ch0.., WL.., ZC.., SSC..].
    zc_thresh: amplitude threshold for ZC/SSC (default 1% of channel std).
    """
    x = np.asarray(emg, dtype=np.float64)
    n, ch = x.shape
    if zc_thresh is None:
        zc_thresh = 0.01 * (x.std(axis=0) + 1e-12)
    zc_thresh = np.broadcast_to(np.asarray(zc_thresh, dtype=float), (ch,))

    def csum(a):
        out = np.zeros((a.shape[0] + 1, ch))
        np.cumsum(a, axis=0, out=out[1:])
        return out

    absx = np.abs(x)
    mav = _window_sum(csum(absx), starts, win) / win
    rms = np.sqrt(_window_sum(csum(x * x), starts, win) / win)

    d = np.diff(x, axis=0)                                   # (n-1, ch)
    absd = np.vstack([np.zeros((1, ch)), np.abs(d)])         # align: index i = |x[i]-x[i-1]|
    wl_cs = csum(absd)
    wl = wl_cs[starts + win] - wl_cs[starts + 1]             # differences inside the window

    zc_ind = np.zeros_like(x)
    zc_ind[1:] = ((x[1:] * x[:-1]) < 0) & (np.abs(x[1:] - x[:-1]) >= zc_thresh)
    zc_cs = csum(zc_ind)
    zc = zc_cs[starts + win] - zc_cs[starts + 1]

    ssc_ind = np.zeros_like(x)
    if n >= 3:
        a = x[1:-1] - x[:-2]
        b = x[1:-1] - x[2:]
        ssc_ind[1:-1] = ((a * b) > 0) & ((np.abs(a) >= zc_thresh) | (np.abs(b) >= zc_thresh))
    ssc_cs = csum(ssc_ind)
    s0 = np.minimum(starts + 1, n)
    s1 = np.minimum(starts + win - 1, n)
    ssc = ssc_cs[s1] - ssc_cs[s0]

    return np.hstack([mav, rms, wl, zc, ssc])


def fmg_features(fmg, starts, win, with_slope=False):
    """Mean FMG level per channel (and optional slope last-first) per window."""
    x = np.asarray(fmg, dtype=np.float64)
    ch = x.shape[1]
    cs = np.zeros((x.shape[0] + 1, ch))
    np.cumsum(x, axis=0, out=cs[1:])
    mean = _window_sum(cs, starts, win) / win
    if not with_slope:
        return mean
    slope = x[starts + win - 1] - x[starts]
    return np.hstack([mean, slope])


def window_labels(labels, starts, win, min_purity=0.8):
    """Majority label per window; windows below the purity threshold get -1."""
    labels = np.asarray(labels).astype(int).ravel()
    out = np.full(len(starts), -1, dtype=int)
    for i, s in enumerate(starts):
        seg = labels[s:s + win]
        vals, counts = np.unique(seg, return_counts=True)
        k = counts.argmax()
        if counts[k] >= min_purity * win:
            out[i] = vals[k]
    return out


def window_labels_fast(labels, starts, win, min_purity=0.8):
    """Faster majority labelling for long recordings with few classes."""
    labels = np.asarray(labels).astype(int).ravel()
    classes = np.unique(labels)
    best = np.full(len(starts), -1, dtype=int)
    best_count = np.zeros(len(starts))
    for c in classes:
        cs = np.concatenate([[0], np.cumsum(labels == c)])
        cnt = cs[starts + win] - cs[starts]
        better = cnt > best_count
        best[better] = c
        best_count[better] = cnt[better]
    best[best_count < min_purity * win] = -1
    return best


def feature_names(n_emg, n_fmg, fmg_slope=False):
    names = [f"{f}_e{c}" for f in EMG_FEATURES for c in range(n_emg)]
    names += [f"MEAN_f{c}" for c in range(n_fmg)]
    if fmg_slope:
        names += [f"SLOPE_f{c}" for c in range(n_fmg)]
    return names
