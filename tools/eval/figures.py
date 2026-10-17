"""Draw the README figures from docs/figures/figures.json (written by eval/figures.ts).

White background, no titles: captions live in the README.
    python eval/figures.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIGS = ROOT / "docs" / "figures"
AMBER = "#E39B00"
INK = "#222222"
MUTED = "#8A8A8A"
WALL = "#9C9C9C"
plt.rcParams.update({"font.family": "Source Sans Pro", "font.size": 15, "text.color": INK,
                     "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK})


def strip(ax, x, z, yaw, width, alpha=1.0):
    """A cue line on the floor plan: across the heading `yaw` (0 = up the page)."""
    hx, hz = -math.sin(yaw), -math.cos(yaw)  # heading in floor coordinates
    px, pz = -hz, hx  # across it
    dx, dz = px * width / 2, pz * width / 2
    ax.plot([x - dx, x + dx], [-(z - dz), -(z + dz)], color=AMBER, lw=7, solid_capstyle="round", alpha=alpha)


def dim(ax, x, y0, y1, text, side=1):
    ax.annotate("", (x, y0), (x, y1), arrowprops=dict(arrowstyle="<->", color=MUTED, lw=1.1, shrinkA=0, shrinkB=0))
    ax.text(x + side * 6, (y0 + y1) / 2, text, ha="left" if side > 0 else "right", va="center", color=MUTED, fontsize=13)


def plan_figure(d: dict) -> None:
    fig, (a, b) = plt.subplots(1, 2, figsize=(12, 6.2), gridspec_kw={"width_ratios": [350, 245], "wspace": 0.12})
    # Doorway: walls at the door plane with an 80 cm opening, the person stopped 20 cm off-centre.
    door = d["doorway"]["door"]["center"]
    yd = -door["z"]
    for x0, x1 in ((-170, -40), (40, 170)):
        a.plot([x0, x1], [yd, yd], color=WALL, lw=9, solid_capstyle="butt")
    for ln in d["doorway"]["lines"]:
        strip(a, ln["x"], ln["z"], ln["yaw"], ln["width"])
    at = d["doorway"]["at"]
    a.plot(at["x"], -at["z"], "o", color=INK, ms=9)
    a.text(at["x"] + 9, -at["z"] - 2, "stops here", va="center", fontsize=13)
    ys = [-ln["z"] for ln in d["doorway"]["lines"]]
    dim(a, -52, -at["z"], ys[0], "22 cm", side=-1)
    dim(a, -52, ys[0], ys[1], "step", side=-1)
    dim(a, 52, yd, ys[-1], "past the door")
    a.text(118, yd + 12, "door", color=MUTED, fontsize=13, ha="center")
    a.set_xlim(-175, 175)
    a.set_ylim(-at["z"] - 25, ys[-1] + 25)

    # Turn: marks on a wide arc to the left, then two lines on the new heading.
    t = d["turn"]
    for ln in t["lines"]:
        strip(b, ln["x"], ln["z"], ln["yaw"], ln["width"])
    r = d["cues"]["turnRadiusCm"]
    cx, cy = -r, d["cues"]["toeOffsetCm"] + d["cues"]["firstGapCm"]
    arc = [(cx + r * math.cos(math.radians(a_)), cy + r * math.sin(math.radians(a_))) for a_ in range(0, 91, 3)]
    b.plot([p[0] for p in arc], [p[1] for p in arc], ls=(0, (2, 3)), color=MUTED, lw=1.2)
    b.plot(t["at"]["x"], -t["at"]["z"], "o", color=INK, ms=9)
    b.text(t["at"]["x"] + 9, -t["at"]["z"] - 2, "stops here", va="center", fontsize=13)
    b.text(12, cy + 36, f"{r} cm arc", color=MUTED, fontsize=13)
    b.set_xlim(-175, 70)
    span = ys[-1] - (-at["z"]) + 50  # same scale as the doorway panel
    b.set_ylim(-25, span - 25)

    for ax in (a, b):
        ax.set_aspect("equal")
        ax.axis("off")
    fig.savefig(FIGS / "cue_plan.png", dpi=200, bbox_inches="tight", pad_inches=0.15, facecolor="white")
    plt.close(fig)


def timeline_figure(d: dict) -> None:
    tl = d["timeline"]
    fr = tl["frames"]
    t = [f["t"] for f in fr]
    fig, (s, ln, bt) = plt.subplots(3, 1, figsize=(12, 5.6), sharex=True,
                                    gridspec_kw={"height_ratios": [1.5, 1.6, 0.45], "hspace": 0.18})
    for ax in (s, ln, bt):
        ax.axvspan(tl["stopT"], tl["resumeT"], color="#F2F2F0", lw=0)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color("#BDBDBD")
        ax.tick_params(left=False, length=0)

    s.plot(t, [f["speed"] for f in fr], color=INK, lw=1.8)
    s.set_ylim(-5, 85)
    s.set_yticks([0, 70])
    s.set_yticklabels(["0", "70 cm/s"], fontsize=13, color=MUTED)
    s.text((tl["stopT"] + tl["resumeT"]) / 2, 74, "freeze", ha="center", color=MUTED, fontsize=13)

    n = max(len(f["lines"]) for f in fr)
    for i in range(n):
        prev = None
        for k, f in enumerate(fr):
            o = f["lines"][i] if i < len(f["lines"]) else 0.0
            if o > 0.01 and k + 1 < len(fr):
                ln.fill_between([f["t"], fr[k + 1]["t"]], n - i - 0.32, n - i + 0.32, color=AMBER, alpha=o, lw=0)
            prev = o
    ln.set_ylim(0.4, n + 1.5)
    ln.set_yticks([n, 1])
    ln.set_yticklabels(["line 1", f"line {n}"], fontsize=13, color=MUTED)
    ln.text(tl["shownT"], n + 0.95, f"lines {tl['shownT'] - tl['stopT']:.2f} s after the stop", fontsize=13)
    fade = next(f["t"] for f in fr if f["state"] == "fading")
    ln.text(fade - 0.1, n + 0.95, "steady walking: lines fade", fontsize=13, color=INK, ha="right")

    beats = [f["t"] for f in fr if f["beat"]]
    bt.vlines(beats, 0, 1, color=AMBER, lw=2.4)
    bt.set_ylim(0, 1.2)
    bt.set_yticks([0.5])
    bt.set_yticklabels(["beat"], fontsize=13, color=MUTED)
    bt.set_xlim(0, t[-1])
    bt.set_xlabel("seconds", fontsize=14, color=MUTED)
    fig.savefig(FIGS / "cue_timeline.png", dpi=200, bbox_inches="tight", pad_inches=0.15, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    data = json.loads((FIGS / "figures.json").read_text(encoding="utf-8"))
    plan_figure(data)
    timeline_figure(data)
    print("wrote", FIGS / "cue_plan.png", "and", FIGS / "cue_timeline.png")
