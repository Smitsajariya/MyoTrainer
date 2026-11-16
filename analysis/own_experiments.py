"""Part B of the thesis: single-subject study with our own band (sessions recorded by realtime/server.py).

Each session = recordings/<mode>_<date>_<time>[_tag].csv + .json (columns: t, emg0..1, fmg0..15, label, rep).
Put the day and band shift into the tag when recording, e.g.  day3   day3_shift1cm   day3_shift2cm

Experiments
  B1 within-session   : first half of the repetitions -> second half (per session, per modality)
  B2 day-to-day       : train on one session, test on every other session (no recalibration)
  B3 calibration      : today's k repetitions only vs. other days' data + today's k repetitions
  B4 band shift       : train on the 'shift0' session of a day, test on that day's shift1cm/shift2cm sessions

python analysis/own_experiments.py --rec recordings --out results_own
"""
import argparse
import glob
import json
import os
import re
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pb.features import filter_emg_offline, window_starts, emg_td_features, fmg_features, window_labels_fast  # noqa: E402
from pb.models import make_classifier, evaluate  # noqa: E402
import plots  # noqa: E402

GESTURES = ["rest", "open", "close", "pinch"]
N_EMG, N_FMG = 2, 16
MODALITIES = {"EMG 2ch": "emg", "FMG 16ch": "fmg", "Hybrid 2+16": "both"}


def load_session(csv_path, win_ms=200, step_ms=50):
    meta = {}
    js = csv_path[:-4] + ".json"
    if os.path.exists(js):
        meta = json.load(open(js))
    fs = float(meta.get("fs", 1000.0))
    d = pd.read_csv(csv_path)
    emg = d[[f"emg{i}" for i in range(N_EMG)]].to_numpy()
    fmg = d[[f"fmg{i}" for i in range(N_FMG)]].to_numpy()
    win, step = int(win_ms * fs / 1000), int(step_ms * fs / 1000)
    starts = window_starts(len(d), win, step)
    Xe = emg_td_features(filter_emg_offline(emg, fs), starts, win, zc_thresh=0.01)
    Xe[:, :3 * N_EMG] = np.log(Xe[:, :3 * N_EMG] + 1e-8)
    Xf = fmg_features(fmg, starts, win)
    y = window_labels_fast(d["label"].to_numpy(), starts, win, min_purity=0.95)
    r = window_labels_fast(d["rep"].to_numpy(), starts, win, min_purity=0.95)
    keep = y >= 0
    tag = meta.get("tag", "")
    day = re.search(r"day(\d+)", tag)
    shift = re.search(r"shift(\d+)", tag)
    return {"name": os.path.basename(csv_path)[:-4], "tag": tag,
            "day": int(day.group(1)) if day else None, "shift_cm": int(shift.group(1)) if shift else 0,
            "Xe": Xe[keep], "Xf": Xf[keep], "y": y[keep], "rep": r[keep]}


def X_of(s, mod):
    if mod == "emg":
        return s["Xe"]
    if mod == "fmg":
        return s["Xf"]
    return np.hstack([s["Xe"], s["Xf"]])


def b1_within(sessions):
    rows = []
    for s in sessions:
        reps = sorted(set(s["rep"]))
        if len(reps) < 2:
            continue
        half = reps[:len(reps) // 2]
        tr, te = np.isin(s["rep"], half), ~np.isin(s["rep"], half)
        for name, mod in MODALITIES.items():
            X = X_of(s, mod)
            m = make_classifier().fit(X[tr], s["y"][tr])
            ev = evaluate(s["y"][te], m.predict(X[te]), labels=list(range(4)))
            rows.append({"session": s["name"], "config": name, "accuracy": ev["accuracy"],
                         "macro_f1": ev["macro_f1"], "confusion": ev["confusion"]})
    return pd.DataFrame(rows)


def b2_cross_session(sessions):
    rows = []
    for a in sessions:
        for b in sessions:
            if a is b:
                continue
            for name, mod in MODALITIES.items():
                m = make_classifier().fit(X_of(a, mod), a["y"])
                rows.append({"train": a["name"], "test": b["name"], "config": name,
                             "accuracy": evaluate(b["y"], m.predict(X_of(b, mod)))["accuracy"]})
    return pd.DataFrame(rows)


def b3_calibration(sessions, ks=(1, 2, 3)):
    rows = []
    for t in sessions:
        others = [s for s in sessions if s is not t and s["shift_cm"] == 0]
        reps = sorted(set(t["rep"]))
        test = ~np.isin(t["rep"], reps[:max(ks)])
        for name, mod in MODALITIES.items():
            Xt = X_of(t, mod)
            for k in ks:
                cal = np.isin(t["rep"], reps[:k])
                m = make_classifier().fit(Xt[cal], t["y"][cal])
                rows.append({"session": t["name"], "config": name, "k": k, "method": "calibration only",
                             "accuracy": evaluate(t["y"][test], m.predict(Xt[test]))["accuracy"]})
                if others:
                    mu, sd = Xt[cal].mean(0), Xt[cal].std(0) + 1e-8
                    Xo = [(X_of(o, mod) - X_of(o, mod).mean(0)) / (X_of(o, mod).std(0) + 1e-8) for o in others]
                    Xtr = np.vstack(Xo + [(Xt[cal] - mu) / sd] * 3)
                    ytr = np.concatenate([o["y"] for o in others] + [t["y"][cal]] * 3)
                    m2 = make_classifier().fit(Xtr, ytr)
                    rows.append({"session": t["name"], "config": name, "k": k, "method": "pre-trained + calibration",
                                 "accuracy": evaluate(t["y"][test], m2.predict((Xt[test] - mu) / sd))["accuracy"]})
    return pd.DataFrame(rows)


def b4_shift(sessions):
    rows = []
    days = sorted({s["day"] for s in sessions if s["day"] is not None})
    for d in days:
        base = [s for s in sessions if s["day"] == d and s["shift_cm"] == 0]
        if not base:
            continue
        for s in [s for s in sessions if s["day"] == d]:
            for name, mod in MODALITIES.items():
                m = make_classifier().fit(X_of(base[0], mod), base[0]["y"])
                acc = evaluate(s["y"], m.predict(X_of(s, mod)))["accuracy"] if s is not base[0] else None
                if acc is not None:
                    rows.append({"day": d, "shift_cm": s["shift_cm"], "config": name, "accuracy": acc})
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rec", default="recordings")
    ap.add_argument("--out", default="results_own")
    ap.add_argument("--pattern", default="record_*.csv", help="which recordings to use")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    files = sorted(glob.glob(os.path.join(a.rec, a.pattern)))
    if not files:
        sys.exit(f"no recordings matching {a.pattern} in {a.rec}")
    sessions = [load_session(f) for f in files]
    print(f"{len(sessions)} sessions:", [(s["name"], s["tag"], len(s["y"])) for s in sessions])
    df = b1_within(sessions)
    df.to_csv(os.path.join(a.out, "b1_within_session.csv"), index=False)
    plots.plot_within(df, os.path.join(a.out, "fig_b1_within_session.png"))
    plots.plot_confusion(df, "Hybrid 2+16", GESTURES, os.path.join(a.out, "fig_b1_confusion_hybrid.png"))
    print(df.groupby("config")["accuracy"].agg(["mean", "std"]).round(3))
    if len(sessions) > 1:
        df = b2_cross_session(sessions)
        df.to_csv(os.path.join(a.out, "b2_cross_session.csv"), index=False)
        print(df.groupby("config")["accuracy"].agg(["mean", "std"]).round(3))
        df = b3_calibration(sessions)
        df.to_csv(os.path.join(a.out, "b3_calibration.csv"), index=False)
        plots.plot_calibration(df, os.path.join(a.out, "fig_b3_calibration.png"))
        print(df.groupby(["config", "method", "k"])["accuracy"].mean().round(3))
        df = b4_shift(sessions)
        if not df.empty:
            df.to_csv(os.path.join(a.out, "b4_band_shift.csv"), index=False)
            print(df.groupby(["config", "shift_cm"])["accuracy"].mean().round(3))
    print("->", a.out)


if __name__ == "__main__":
    main()
