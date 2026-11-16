"""Classifier helpers: build, train, evaluate, save/load."""
import json
import numpy as np
import joblib
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.svm import SVC
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix


def make_classifier(kind="lda"):
    if kind == "lda":
        return make_pipeline(StandardScaler(), LinearDiscriminantAnalysis(solver="lsqr", shrinkage="auto"))
    if kind == "svm":
        return make_pipeline(StandardScaler(), SVC(kernel="rbf", C=10.0, gamma="scale", probability=False))
    raise ValueError(kind)


def evaluate(y_true, y_pred, labels=None):
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", labels=labels, zero_division=0)),
        "confusion": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }


def log_features(X, n_emg_feats):
    """Log-compress EMG amplitude features (MAV/RMS/WL) to reduce skew; leaves FMG untouched."""
    X = X.copy()
    if n_emg_feats:
        amp = slice(0, int(n_emg_feats * 3 / 5))  # MAV, RMS, WL blocks
        X[:, amp] = np.log(X[:, amp] + 1e-8)
    return X


class SubjectScaler:
    """Per-subject z-scoring fitted on that subject's own (calibration) data."""

    def __init__(self):
        self.mu = None
        self.sd = None

    def fit(self, X):
        self.mu = X.mean(axis=0)
        self.sd = X.std(axis=0) + 1e-8
        return self

    def transform(self, X):
        return (X - self.mu) / self.sd


def save_model(path, model, meta):
    joblib.dump({"model": model, "meta": meta}, path)
    with open(str(path) + ".json", "w") as f:
        json.dump(meta, f, indent=2)


def load_model(path):
    d = joblib.load(path)
    return d["model"], d["meta"]
