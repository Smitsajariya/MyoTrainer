"""Turn Smit's 3D-printed hand STLs (print layout, millimetres) into game parts (metres, joint frames).

Input : folder with Hand4RIGHT.stl, Fingerdesign_8-7_{Index,Middle,Ring,Pinky,Thumb}.stl, ArmPiece_1.stl
Output: virtual_hand/models/arm/*.glb  +  arm.json (joint positions)

Game hand frame: wrist at origin, fingers along +x, back of the hand +y, palm side -y.
Each phalanx GLB has its hinge at the origin and points along +x, so the game only rotates it about z.
Usage: python tools/build_arm_model.py "<folder with the STLs>"
"""
import json, os, sys
import numpy as np
import trimesh

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), "..", "virtual_hand", "models", "arm")
os.makedirs(OUT, exist_ok=True)
MM = 0.001


def load(name):
    return trimesh.load(os.path.join(SRC, name + ".stl"), force="mesh")


def simplify(m, faces):
    if len(m.faces) <= faces:
        return m
    try:
        return m.simplify_quadric_decimation(face_count=faces)
    except Exception as e:
        print("  (no decimation:", e, ")")
        return m


def save(m, name, faces):
    m = simplify(m, faces)
    m.fix_normals()
    m.export(os.path.join(OUT, name + ".glb"))
    print(f"  {name}.glb  {len(m.faces)} triangles  size {np.round((m.bounds[1]-m.bounds[0])*1000,1)} mm")


def transform(m, R, t):
    """new = R @ (v - t) * MM"""
    m = m.copy()
    m.vertices = ((m.vertices - t) @ np.asarray(R, float).T) * MM
    return m


layout = {"fingers": {}, "thumb": {}}

# ---------------------------------------------------------------- palm (Hand4RIGHT)
palm = load("Hand4RIGHT")
# STL: fingers +z, back of hand +x, thumb at low y  ->  game: (x, y, z) = (z, x - xc, y - yc)
XC, YC = -131.0, 160.0
Rp = [[0, 0, 1], [1, 0, 0], [0, 1, 0]]
save(transform(palm, Rp, [XC, YC, 0.0]), "palm", 30000)
v = palm.vertices
knuckle_y = {"index": 131.0, "middle": 151.0, "ring": 171.0, "pinky": 191.0}
for name, y in knuckle_y.items():
    s = v[(np.abs(v[:, 1] - y) < 3) & (v[:, 2] > 60)]
    ztop = s[:, 2].max()
    layout["fingers"][name] = {"base": [(ztop - 6.0) * MM, 0.0, (y - YC) * MM]}
# thumb mount (outer end of the side boss)
layout["thumb"]["base"] = [50.0 * MM, (-154.0 - XC) * MM, (106.0 - YC) * MM]

# ---------------------------------------------------------------- fingers
def finger_parts(fname, n):
    m = load(fname)
    parts = sorted(m.split(only_watertight=False), key=lambda p: -len(p.faces))[:n]
    return m, parts


ROT = {  # STL long axis -> game +x, STL +z (dome / back) -> game +y
    "y+": [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    "x+": [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
    "y-": [[0, -1, 0], [0, 0, 1], [-1, 0, 0]],
}
SPEC = {"index": ("Index", "y+"), "middle": ("Middle", "x+"), "ring": ("Ring", "x+"), "pinky": ("Pinky", "x+")}
for name, (fname, axis) in list(SPEC.items()) + [("thumb", ("Thumb", "y-"))]:
    n = 2 if name == "thumb" else 3
    _, parts = finger_parts("Fingerdesign_8-7_" + fname, n)
    L = 1 if axis[0] == "y" else 0
    sign = 1 if axis[1] == "+" else -1
    parts = sorted(parts, key=lambda p: sign * p.bounds[0][L])          # proximal first
    segs = []
    for i, p in enumerate(parts):
        lo, hi = p.bounds
        prox = lo[L] if sign > 0 else hi[L]
        c = (lo + hi) / 2
        pivot = c.copy(); pivot[L] = prox + sign * 4.0                   # hinge pin ~4 mm inside the segment
        g = transform(p, ROT[axis], pivot)
        length = (hi[L] - lo[L]) - 7.0                                     # distance to the next hinge
        save(g, f"{name}_{i+1}", 5000)
        segs.append(round(length * MM, 4))
    (layout["thumb"] if name == "thumb" else layout["fingers"][name])["segments"] = segs

# ---------------------------------------------------------------- forearm (wrist unit)
try:
    arm = load("ArmPiece_1")
    lo, hi = arm.bounds; c = (lo + hi) / 2
    # long axis z -> game x, its top end at the wrist so the piece sits behind it (x < 0)
    Ra = [[0, 0, 1], [1, 0, 0], [0, 1, 0]]
    save(transform(arm, Ra, [c[0], c[1], hi[2]]), "forearm", 12000)
    layout["forearm"] = True
except Exception as e:
    print("forearm skipped:", e)

with open(os.path.join(OUT, "arm.json"), "w") as f:
    json.dump(layout, f, indent=1)
print(json.dumps(layout, indent=1))
