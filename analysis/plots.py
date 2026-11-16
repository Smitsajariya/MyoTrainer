"""Thesis figures. Palette: validated categorical slots (blue, orange, aqua) on a light surface."""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
GRID = "#e4e3df"
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"


def color_for(config):
    if config.startswith("EMG"):
        return BLUE
    if config.startswith("FMG"):
        return ORANGE
    return AQUA


def _style(ax, ylabel):
    ax.set_facecolor(SURFACE)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_ylabel(ylabel, color=INK2, fontsize=9.5)


def plot_within(df, path):
    order = [c for c in ["EMG 6ch", "FMG 24ch", "Hybrid 6+24", "EMG 2ch", "FMG 8ch", "FMG 16ch", "Hybrid 2+16"]
             if c in set(df["config"])]
    g = df.groupby("config")["accuracy"]
    mean, sd = g.mean().reindex(order) * 100, g.std().reindex(order).fillna(0) * 100
    fig, ax = plt.subplots(figsize=(7.2, 3.6), dpi=200, facecolor=SURFACE)
    x = np.arange(len(order))
    ax.bar(x, mean, width=0.62, color=[color_for(c) for c in order], edgecolor=SURFACE, linewidth=2)
    ax.errorbar(x, mean, yerr=sd, fmt="none", ecolor=INK2, elinewidth=1, capsize=3)
    for xi, m in zip(x, mean):
        ax.text(xi, m + 2, f"{m:.0f}%", ha="center", va="bottom", fontsize=8.5, color=INK)
    ax.set_xticks(x, order, rotation=0, fontsize=8.5)
    ax.set_ylim(0, 105)
    _style(ax, "Accuracy (%)")
    ax.set_title("Within-subject grasp classification (train reps 1-4, test 5-6)", fontsize=10.5, color=INK, loc="left")
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def plot_confusion(df, config, class_names, path):
    sub = df[df["config"] == config]
    if sub.empty:
        return
    cm = np.sum([np.array(c) for c in sub["confusion"]], axis=0).astype(float)
    cm = cm / np.maximum(cm.sum(1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(4.6, 4.0), dpi=200, facecolor=SURFACE)
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list("seq", ["#f4f8fd", "#9ec5f0", BLUE, "#123e75"])
    ax.imshow(cm, cmap=cmap, vmin=0, vmax=1)
    n = len(class_names)
    ax.set_xticks(range(n), class_names, rotation=45, ha="right", fontsize=8, color=INK2)
    ax.set_yticks(range(n), class_names, fontsize=8, color=INK2)
    for i in range(n):
        for j in range(n):
            if cm[i, j] >= 0.05:
                ax.text(j, i, f"{cm[i, j] * 100:.0f}", ha="center", va="center", fontsize=7.5,
                        color="white" if cm[i, j] > 0.55 else INK)
    ax.set_xlabel("Predicted", color=INK2, fontsize=9)
    ax.set_ylabel("True", color=INK2, fontsize=9)
    ax.set_title(f"Confusion matrix (%), {config}", fontsize=10, color=INK, loc="left")
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def plot_calibration(df, path):
    fig, ax = plt.subplots(figsize=(7.2, 3.8), dpi=200, facecolor=SURFACE)
    for cfg in [c for c in ["EMG 2ch", "FMG 16ch", "Hybrid 2+16"] if c in set(df["config"])] or sorted(set(df["config"])):
        col = color_for(cfg)
        for method, ls, mk in (("pre-trained + calibration", "-", "o"), ("calibration only", "--", "s")):
            d = df[(df["config"] == cfg) & (df["method"] == method)].groupby("k")["accuracy"].mean() * 100
            if d.empty:
                continue
            ax.plot(d.index, d.values, ls, color=col, linewidth=2, marker=mk, markersize=6,
                    markeredgecolor=SURFACE, markeredgewidth=1.5, label=f"{cfg}, {method}")
    ax.set_xlabel("Calibration repetitions of the new user", color=INK2, fontsize=9.5)
    ax.set_xticks(sorted(df["k"].unique()))
    ax.set_ylim(0, 100)
    _style(ax, "Accuracy (%)")
    ax.legend(fontsize=7.5, frameon=False, ncol=2, loc="lower right", labelcolor=INK2)
    ax.set_title("How much calibration does a new user need?", fontsize=10.5, color=INK, loc="left")
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def plot_rotation(df, path):
    order = [c for c in ["EMG 6ch", "FMG 24ch", "Hybrid 6+24"] if c in set(df["config"])] or sorted(set(df["config"]))
    fig, ax = plt.subplots(figsize=(6.0, 3.6), dpi=200, facecolor=SURFACE)
    x = np.arange(len(order))
    for off, rot, alpha, lab in ((-0.17, 0, 1.0, "band as trained"), (0.17, 1, 0.45, "band rotated 60 deg")):
        m = [df[(df["config"] == c) & (df["rotation_modules"] == rot)]["accuracy"].mean() * 100 for c in order]
        bars = ax.bar(x + off, m, width=0.32, color=[color_for(c) for c in order], alpha=alpha,
                      edgecolor=SURFACE, linewidth=2, label=lab)
        for b, v in zip(bars, m):
            ax.text(b.get_x() + b.get_width() / 2, v + 2, f"{v:.0f}%", ha="center", fontsize=8, color=INK)
    ax.set_xticks(x, order, fontsize=9)
    ax.set_ylim(0, 105)
    _style(ax, "Accuracy (%)")
    ax.legend(fontsize=8, frameon=False, labelcolor=INK2)
    ax.set_title("Robustness to putting the band on rotated", fontsize=10.5, color=INK, loc="left")
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)
