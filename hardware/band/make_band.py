"""
Proposal B sensor band: printable parts (STL), all sizes in mm.

The band is one 25 mm Velcro/elastic strap with 8 sensor pods and 1 electronics box threaded on it:
    pod x8   (TPU 95A)  each holds 2 x FSR 402 (one row near the elbow, one near the wrist) = 16 FSR
    button x16 (TPU)    small dome pressed on each FSR: focuses the muscle pressure on the sensor
    box + lid (PETG)    ESP32 DevKit, CD74HC4067, LiPo 3.7 V, TP4056 charger, USB-C opening

Axes of every part: x = along the strap (around the arm), y = along the forearm, z = away from the skin (z=0 skin side).

Wire path: FSR tail bends up through a slot at the pocket edge -> groove on the outer side of the pod (one per row)
-> grooves run along the band -> into the box through two openings at each end.

Run:  python make_band.py   -> writes the STL files next to this script.
"""
import os
import numpy as np
import trimesh
from manifold3d import Manifold, CrossSection

OUT = os.path.dirname(os.path.abspath(__file__))
SEG = 64

# ---------------------------------------------------------------- parameters (change here)
FSR_D = 18.6          # FSR 402 disc 18.3 mm + clearance
FSR_POCKET = 1.6      # FSR (0.45) + button disc (1.0) + play
ROW_Y = 10.8          # FSR centre distance from the pod middle (two rows)
POD_X, POD_Y, POD_Z = 24.0, 46.0, 8.0
STRAP_W, STRAP_T = 26.0, 2.8      # slot for a 25 mm strap up to 2.5 mm thick
STRAP_Z0 = 2.6                    # strap slot starts above the FSR backing
TAIL_W, TAIL_T = 8.0, 1.8         # slot for the FSR tail (bent upwards)
GROOVE_W, GROOVE_D = 3.6, 1.8     # wire groove on the outer side, one per row
R_CORNER = 3.0


def rbox(x, y, z, r=R_CORNER):
    """Box with rounded vertical edges, sitting on z=0, centred in x/y."""
    r = min(r, x / 2 - 0.01, y / 2 - 0.01)
    return Manifold.extrude(_rounded_rect(x, y, r), z)


def _rounded_rect(x, y, r):
    pts = []
    for cx, cy, a0 in [(x / 2 - r, y / 2 - r, 0), (-x / 2 + r, y / 2 - r, 90), (-x / 2 + r, -y / 2 + r, 180), (x / 2 - r, -y / 2 + r, 270)]:
        for k in range(9):
            a = np.radians(a0 + k * 90 / 8)
            pts.append((cx + r * np.cos(a), cy + r * np.sin(a)))
    return CrossSection([pts])


def box(x, y, z, cx=0, cy=0, cz=0):
    return Manifold.cube((x, y, z), center=True).translate((cx, cy, cz + z / 2))


def cyl(d, h, cx=0, cy=0, cz=0, seg=SEG):
    return Manifold.cylinder(h, d / 2, d / 2, seg).translate((cx, cy, cz))


def save(m, name):
    mesh = m.to_mesh()
    tm = trimesh.Trimesh(vertices=mesh.vert_properties[:, :3], faces=mesh.tri_verts, process=True)
    assert tm.is_watertight, name
    path = os.path.join(OUT, name)
    tm.export(path)
    b = tm.bounds
    print(f'{name:22s} {b[1][0]-b[0][0]:6.1f} x {b[1][1]-b[0][1]:6.1f} x {b[1][2]-b[0][2]:5.1f} mm   {tm.volume/1000:5.2f} cm3')
    return tm


# ---------------------------------------------------------------- sensor pod (print skin side DOWN, no supports)
def pod():
    body = rbox(POD_X, POD_Y, POD_Z)
    cut = Manifold()
    for s in (-1, 1):
        y = s * ROW_Y
        cut += cyl(FSR_D, FSR_POCKET, 0, y, 0)                                   # FSR pocket, open to the skin
        ty = y + s * (FSR_D / 2 - TAIL_T / 2 - 0.2)                               # tail slot at the outer pocket edge
        cut += box(TAIL_W, TAIL_T, POD_Z, 0, ty, 0)                               # tail goes straight up to the groove
        gy = s * (FSR_D / 2 + ROW_Y - GROOVE_W / 2 - 0.2)                         # wire groove above the tail slot
        cut += box(POD_X + 2, GROOVE_W, GROOVE_D + 0.01, 0, gy, POD_Z - GROOVE_D)
    cut += box(POD_X + 2, STRAP_W, STRAP_T, 0, 0, STRAP_Z0)                        # strap tunnel (through, along x)
    # small notches on the skin side so a cable tie can hold the wires if needed
    return body - cut


# ---------------------------------------------------------------- pressure button (print dome UP)
def button():
    disc = cyl(FSR_D - 0.4, 1.0)
    dome = Manifold.sphere(6.0, SEG).translate((0, 0, 1.0 - 3.2)) ^ box(14, 14, 3.0, 0, 0, 1.0)  # cap 2.8 mm high, 10 mm wide
    return disc + dome


# ---------------------------------------------------------------- electronics box (print upside down = floor on bed)
BOX_X, BOX_Y, BOX_Z, WALL = 72.0, 46.0, 21.0, 2.0


def ebox():
    outer = rbox(BOX_X, BOX_Y, BOX_Z)
    inner = rbox(BOX_X - 2 * WALL, BOX_Y - 2 * WALL, BOX_Z, 1.5).translate((0, 0, STRAP_Z0 + STRAP_T + 1.6))
    m = outer - inner
    m -= box(BOX_X + 2, STRAP_W, STRAP_T, 0, 0, STRAP_Z0)                       # same strap tunnel as the pods
    gz = STRAP_Z0 + STRAP_T + 1.6                                               # floor top inside the box
    for s in (-1, 1):                                                          # wire entries, in line with the pod grooves
        gy = s * (FSR_D / 2 + ROW_Y - GROOVE_W / 2 - 0.2)
        m -= box(BOX_X + 2, GROOVE_W + 1.0, 4.0, 0, gy, gz)
    m -= box(4.0, 10.0, 4.5, BOX_X / 2 - 1.0, 0, gz + 3.0)                       # USB-C opening (ESP32 / charger)
    m -= box(7.0, 3.0, 4.0, -BOX_X / 2 + 1.0, 0, gz + 6.0)                       # power switch
    for sx in (-1, 1):                                                          # 4 screw posts for the lid (M2 self-tapping)
        for sy in (-1, 1):
            px, py = sx * (BOX_X / 2 - 4.2), sy * (BOX_Y / 2 - 4.2)
            m += cyl(5.2, BOX_Z - gz, px, py, gz) - cyl(1.7, BOX_Z, px, py, gz)
    return m


def lid():
    plate = rbox(BOX_X, BOX_Y, 1.8)
    lip = rbox(BOX_X - 2 * WALL - 0.4, BOX_Y - 2 * WALL - 0.4, 1.6, 1.3).translate((0, 0, 1.8)) - rbox(BOX_X - 2 * WALL - 2.8, BOX_Y - 2 * WALL - 2.8, 1.6, 1.0).translate((0, 0, 1.8))
    m = plate + lip
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * (BOX_X / 2 - 4.2), sy * (BOX_Y / 2 - 4.2)
            m -= cyl(2.4, 10, px, py, -1)
            m -= box(6.2, 6.2, 2.0, px, py, 1.8)       # clear the lip around the posts
    return m


if __name__ == '__main__':
    parts = {'band_pod_x8.stl': pod(), 'band_button_x16.stl': button(), 'band_box.stl': ebox(), 'band_box_lid.stl': lid()}
    for n, m in parts.items():
        save(m, n)
    # preview of the whole band (not for printing): 8 pods + box around a 260 mm arm
    circ, n_pods = 260.0, 8
    R = circ / (2 * np.pi) + 0.2
    scene = Manifold()
    spots = [i * 360 / 9 for i in range(9)]   # 9 places: 8 pods + box
    for k, a in enumerate(spots):
        part = ebox() if k == 0 else pod()
        m = part.translate((0, 0, R)).rotate((0, a, 0))   # flat part tangent to the arm: x around the arm, z outward
        scene += m
    save(scene, 'band_preview_assembly.stl')
