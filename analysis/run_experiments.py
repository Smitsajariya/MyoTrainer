"""Part A of the thesis: compare EMG, FMG and hybrid sensing on public data (MyoKi).

Experiments (all with LDA by default, --clf svm for an RBF-SVM):
  E1 within-subject   : train repetitions 1-4, test 5-6, per sensor configuration
  E2 calibration      : how many calibration repetitions are needed, with and without
                        pre-training on the other participants (transfer)
  E3 band rotation    : train normal, test with the band rotated by one module (60 deg)
  E4 cross-subject    : leave-one-subject-out without any calibration

Usage (Windows example):
  python analysis\\run_experiments.py --data-dir D:\\MyoKi --subjects P26-P35 --out results
"""
import argparse
import os
import sys
import time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pb.models import make_classifier, evaluate  # noqa: E402
from myoki_loader import load_participant, build_X, CONFIGS, GRASP_NAMES, DEFAULT_CLASSES  # noqa: E402
import plots  # noqa: E402

TRAIN_REPS = (1, 2, 3, 4)
TEST_REPS = (5, 6)


def parse_subjects(spec):
    out = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            for i in range(int(a.lstrip("Pp")), int(b.lstrip("Pp")) + 1):
                out.append(f"P{i:02d}")
        elif part:
            out.append(f"P{int(part.lstrip('Pp')):02d}")
    return out


def zscore_fit(X):
    return X.mean(0), X.std(0) + 1e-8


def e1_within(subjects, configs, clf):
    rows = []
    for s in subjects:
        for name in configs:
            X = build_X(s, CONFIGS[name])
            if X is None:
                continue
            tr = np.isin(s["rep"], TRAIN_REPS)
            te = np.isin(s["rep"], TEST_REPS)
            m = make_classifier(clf).fit(X[tr], s["y"][tr])
            ev = evaluate(s["y"][te], m.predict(X[te]), labels=list(DEFAULT_CLASSES))
            rows.append({"subject": s["name"], "config": name, **{k: ev[k] for k in ("accuracy", "macro_f1")},
                         "confusion": ev["confusion"]})
    return pd.DataFrame(rows)


def e2_calibration(subjects, configs, clf, ks=(0, 1, 2, 3, 4)):
    """Target-only vs pre-trained (other participants) + k calibration repetitions."""
    rows = []
    for t_i, tgt in enumerate(subjects):
        others = [s for j, s in enumerate(subjects) if j != t_i]
        for name in configs:
            Xt = build_X(tgt, CONFIGS[name])
            if Xt is None:
                continue
            te = np.isin(tgt["rep"], TEST_REPS)
            # pool of other participants, each z-scored with its own statistics
            pool_X, pool_y = [], []
            for o in others:
                Xo = build_X(o, CONFIGS[name])
                if Xo is None:
                    continue
                mu, sd = zscore_fit(Xo)
                pool_X.append((Xo - mu) / sd)
                pool_y.append(o["y"])
            if not pool_X:
                continue
            pool_X, pool_y = np.vstack(pool_X), np.concatenate(pool_y)
            for k in ks:
                cal = np.isin(tgt["rep"], TRAIN_REPS[:k]) if k > 0 else np.zeros(len(tgt["y"]), bool)
                # normalisation of the target: calibration data if available, otherwise unlabeled test data
                mu, sd = zscore_fit(Xt[cal] if k > 0 else Xt[te])
                Xtn = (Xt - mu) / sd
                # pre-trained + calibration
                if k > 0:
                    reps = max(1, int(0.5 * len(pool_y) / max(1, cal.sum())))
                    Xtr = np.vstack([pool_X] + [Xtn[cal]] * min(reps, 20))
                    ytr = np.concatenate([pool_y] + [tgt["y"][cal]] * min(reps, 20))
                else:
                    Xtr, ytr = pool_X, pool_y
                m = make_classifier(clf).fit(Xtr, ytr)
                acc_pre = evaluate(tgt["y"][te], m.predict(Xtn[te]))["accuracy"]
                rows.append({"subject": tgt["name"], "config": name, "k": k, "method": "pre-trained + calibration",
                             "accuracy": acc_pre})
                if k > 0:
                    m2 = make_classifier(clf).fit(Xt[cal], tgt["y"][cal])
                    acc_t = evaluate(tgt["y"][te], m2.predict(Xt[te]))["accuracy"]
                    rows.append({"subject": tgt["name"], "config": name, "k": k, "method": "calibration only",
                                 "accuracy": acc_t})
    return pd.DataFrame(rows)


def e3_rotation(subjects, configs, clf):
    rows = []
    for s in subjects:
        for name in configs:
            X = build_X(s, CONFIGS[name])
            if X is None:
                continue
            tr = np.isin(s["rep"], TRAIN_REPS)
            te = np.isin(s["rep"], TEST_REPS)
            m = make_classifier(clf).fit(X[tr], s["y"][tr])
            for rot in (0, 1):
                Xr = build_X(s, CONFIGS[name], rotate_modules=rot)
                acc = evaluate(s["y"][te], m.predict(Xr[te]))["accuracy"]
                rows.append({"subject": s["name"], "config": name, "rotation_modules": rot, "accuracy": acc})
    return pd.DataFrame(rows)


def e4_loso(subjects, configs, clf):
    rows = []
    for t_i, tgt in enumerate(subjects):
        for name in configs:
            Xt = build_X(tgt, CONFIGS[name])
            if Xt is None:
                continue
            Xs, ys = [], []
            for j, o in enumerate(subjects):
                if j == t_i:
                    continue
                Xo = build_X(o, CONFIGS[name])
                mu, sd = zscore_fit(Xo)
                Xs.append((Xo - mu) / sd)
                ys.append(o["y"])
            mu, sd = zscore_fit(Xt)
            m = make_classifier(clf).fit(np.vstack(Xs), np.concatenate(ys))
            acc = evaluate(tgt["y"], m.predict((Xt - mu) / sd))["accuracy"]
            rows.append({"subject": tgt["name"], "config": name, "accuracy": acc})
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True, help="folder with P26.mat ... P35.mat")
    ap.add_argument("--subjects", default="P26-P35", help="e.g. P26-P35 or P26,P27,P30")
    ap.add_argument("--out", default="results")
    ap.add_argument("--clf", default="lda", choices=["lda", "svm"])
    ap.add_argument("--win-ms", type=int, default=200)
    ap.add_argument("--step-ms", type=int, default=50)
    ap.add_argument("--experiments", default="e1,e2,e3,e4")
    ap.add_argument("--configs", default=",".join(CONFIGS.keys()))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cache = os.path.join(args.out, "cache")
    configs = [c.strip() for c in args.configs.split(",") if c.strip()]
    subjects = []
    for name in parse_subjects(args.subjects):
        p = os.path.join(args.data_dir, f"{name}.mat")
        if not os.path.exists(p) and not os.path.exists(os.path.join(cache, f"{name}_w{args.win_ms}_s{args.step_ms}.npz")):
            print(f"skip {name}: {p} not found")
            continue
        subjects.append(load_participant(p, cache, args.win_ms, args.step_ms))
    if len(subjects) < 2:
        sys.exit("Need at least 2 participants.")
    print(f"Loaded {len(subjects)} participants: {[s['name'] for s in subjects]}")
    ex = set(args.experiments.split(","))
    t0 = time.time()
    if "e1" in ex:
        df = e1_within(subjects, configs, args.clf)
        df.to_csv(os.path.join(args.out, "e1_within_subject.csv"), index=False)
        plots.plot_within(df, os.path.join(args.out, "fig_e1_within_subject.png"))
        plots.plot_confusion(df, "Hybrid 2+16", [GRASP_NAMES[c] for c in DEFAULT_CLASSES],
                             os.path.join(args.out, "fig_e1_confusion_hybrid_2_16.png"))
        print(df.groupby("config")[["accuracy", "macro_f1"]].agg(["mean", "std"]).round(3))
    if "e2" in ex:
        df = e2_calibration(subjects, [c for c in configs if c in ("EMG 2ch", "FMG 16ch", "Hybrid 2+16")] or configs, args.clf)
        df.to_csv(os.path.join(args.out, "e2_calibration.csv"), index=False)
        plots.plot_calibration(df, os.path.join(args.out, "fig_e2_calibration.png"))
        print(df.groupby(["config", "method", "k"])["accuracy"].mean().round(3))
    if "e3" in ex:
        df = e3_rotation(subjects, [c for c in configs if c in ("EMG 6ch", "FMG 24ch", "Hybrid 6+24")] or configs, args.clf)
        df.to_csv(os.path.join(args.out, "e3_band_rotation.csv"), index=False)
        plots.plot_rotation(df, os.path.join(args.out, "fig_e3_band_rotation.png"))
        print(df.groupby(["config", "rotation_modules"])["accuracy"].mean().round(3))
    if "e4" in ex:
        df = e4_loso(subjects, configs, args.clf)
        df.to_csv(os.path.join(args.out, "e4_cross_subject.csv"), index=False)
        print(df.groupby("config")["accuracy"].agg(["mean", "std"]).round(3))
    print(f"done in {time.time() - t0:.1f} s -> {args.out}")


if __name__ == "__main__":
    main()
