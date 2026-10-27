# Builds the low-poly office prop kit used by the client (web/js/scene.js).
#
# Run inside Blender (5.x):
#   blender --background --python tools/blender/office_kit.py
# or paste into the scripting workspace. It rebuilds every piece from scratch,
# saves assets/office_kit.blend (editable source) and exports
# web/models/office_kit.glb (what the game loads).
#
# Conventions: one object per piece, origin at the base centre, "length" along
# X, depth along Y, height along Z. The glTF exporter turns that into Y-up, so
# in the client X stays X, Blender Z becomes Y and Blender Y becomes -Z. The
# front of a piece (the side the player normally sees) points to -Y here,
# which is +Z in the game (toward the camera).

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
sys.path.insert(0, HERE)
import importlib  # noqa: E402
import kitlib  # noqa: E402
importlib.reload(kitlib)
from kitlib import GLTF_COMMON, Piece, mat, reset_scene  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_BLEND = os.path.join(ROOT, 'assets', 'office_kit.blend')
OUT_GLB = os.path.join(ROOT, 'web', 'models', 'office_kit.glb')

WALL = mat('Wall', (0.80, 0.79, 0.76))
TRIM = mat('Trim', (0.50, 0.52, 0.58))
SKIRT = mat('Skirting', (0.20, 0.22, 0.27))
FRAME = mat('Frame', (0.28, 0.30, 0.35))
GLASS = mat('Glass', (0.62, 0.84, 1.0), alpha=0.28, rough=0.2)
DESK = mat('DeskTop', (1.0, 1.0, 1.0))          # tinted per instance by the client
DESKFRAME = mat('DeskFrame', (0.52, 0.54, 0.60))
DARK = mat('Dark', (0.10, 0.11, 0.14))
SCREEN = mat('Screen', (0.18, 0.32, 0.55), emissive=(0.25, 0.48, 0.90))
SEAT = mat('Seat', (0.18, 0.20, 0.26))
RACK = mat('RackBody', (0.09, 0.10, 0.13))
RACKSLOT = mat('RackSlot', (0.18, 0.20, 0.25))
LED_G = mat('LedGreen', (0.1, 0.9, 0.4), emissive=(0.15, 1.0, 0.45))
LED_B = mat('LedBlue', (0.3, 0.7, 1.0), emissive=(0.3, 0.7, 1.0))
PILLAR = mat('Pillar', (0.60, 0.62, 0.67))
PRINTER = mat('PrinterBody', (0.80, 0.82, 0.86))
PRINTERLID = mat('PrinterLid', (0.52, 0.55, 0.61))
POT = mat('Pot', (0.58, 0.38, 0.27))
SOIL = mat('Soil', (0.14, 0.10, 0.07))
LEAF = mat('Leaf', (0.24, 0.58, 0.30))
LEAF2 = mat('Leaf2', (0.17, 0.46, 0.24))
COOLER = mat('Cooler', (0.88, 0.90, 0.94))
WATER = mat('Water', (0.55, 0.80, 1.0), alpha=0.55, rough=0.2)
TAP_B = mat('TapBlue', (0.25, 0.55, 0.95))
TAP_R = mat('TapRed', (0.90, 0.25, 0.25))
BOARD = mat('Board', (0.96, 0.97, 0.98))
MARK_B = mat('MarkerBlue', (0.15, 0.35, 0.85))
MARK_R = mat('MarkerRed', (0.85, 0.20, 0.25))
STEEL = mat('Steel', (0.70, 0.72, 0.76), rough=0.4)
MUG = mat('Mug', (0.95, 0.55, 0.25))


# ---------------------------------------------------------------- pieces

def build_wall(p):
    # 1 m long, 0.6 thick, 2.4 tall; the client stretches it along X.
    p.box((1.0, 0.60, 2.4), (0, 0, 1.2), WALL, bevel=0.035, edges='x')
    p.box((1.0, 0.66, 0.12), (0, 0, 0.06), SKIRT)
    p.box((1.0, 0.64, 0.05), (0, 0, 2.375), TRIM)


def build_glass(p):
    p.box((1.0, 0.60, 0.16), (0, 0, 0.08), FRAME)
    p.box((1.0, 0.60, 0.10), (0, 0, 2.35), FRAME)
    p.box((1.0, 0.05, 2.14), (0, 0, 1.23), GLASS)


def build_doorframe(p):
    # lintel only, 1 m long; posts are a separate piece
    p.box((1.0, 0.70, 0.14), (0, 0, 2.33), TRIM)


def build_doorpost(p):
    p.box((0.12, 0.70, 2.4), (0, 0, 1.2), TRIM, bevel=0.02, edges='z')


def build_desk_top(p):
    # 1x1 top with its upper face at z=1.0; scaled to the desk footprint
    p.box((1.0, 1.0, 0.08), (0, 0, 0.96), DESK, bevel=0.015)


def build_desk_panel(p):
    # side panel: 1 m deep, scaled along Y
    p.box((0.06, 1.0, 0.92), (0, 0, 0.46), DESKFRAME)
    p.box((0.10, 0.9, 0.04), (0, 0, 0.02), SKIRT)


def build_monitor(p):
    p.cyl(0.13, 0.13, 0.02, (0, 0, 0.01), DARK, segs=12)
    p.box((0.05, 0.04, 0.26), (0, 0.02, 0.14), DARK)
    p.box((0.56, 0.035, 0.34), (0, 0, 0.44), DARK, bevel=0.01)
    p.box((0.52, 0.012, 0.30), (0, -0.02, 0.44), SCREEN)


def build_keyboard(p):
    p.box((0.42, 0.15, 0.022), (0, 0, 0.011), DARK, bevel=0.006)
    p.box((0.38, 0.11, 0.008), (0, 0, 0.025), SKIRT)


def build_chair(p):
    # faces -Y (back rest at +Y)
    p.cyl(0.30, 0.30, 0.04, (0, 0, 0.02), DARK, segs=10)
    p.cyl(0.03, 0.03, 0.42, (0, 0, 0.23), STEEL, segs=8)
    p.box((0.46, 0.46, 0.08), (0, 0, 0.47), SEAT, bevel=0.03)
    p.box((0.44, 0.06, 0.46), (0, 0.20, 0.78), SEAT, bevel=0.02)


def build_rack(p):
    # 1.2 across X, 1.0 along Y (row axis), front face at -X
    p.box((1.2, 1.0, 2.2), (0, 0, 1.1), RACK, bevel=0.02, edges='z')
    for i in range(6):
        z = 0.28 + i * 0.32
        p.box((0.03, 0.82, 0.22), (-0.605, 0, z), RACKSLOT)
        for j, m in enumerate((LED_G, LED_B) if i % 2 == 0 else (LED_G, LED_G)):
            p.box((0.02, 0.03, 0.03), (-0.625, -0.34 + j * 0.07, z + 0.06), m)


def build_pillar(p):
    p.box((1.1, 1.1, 3.0), (0, 0, 1.5), PILLAR, bevel=0.06, edges='z')
    p.box((1.22, 1.22, 0.14), (0, 0, 0.07), SKIRT)


def build_printer(p):
    p.box((0.9, 0.8, 0.6), (0, 0, 0.3), PRINTER)
    p.box((0.9, 0.8, 0.5), (0, 0, 0.85), PRINTER, bevel=0.02)
    p.box((0.8, 0.7, 0.06), (0, 0, 1.13), PRINTERLID, bevel=0.01)
    p.box((0.5, 0.30, 0.03), (0, -0.50, 0.62), PRINTERLID)
    p.box((0.26, 0.12, 0.02), (0.2, -0.41, 1.02), SCREEN)


def build_plant(p):
    p.cyl(0.22, 0.28, 0.5, (0, 0, 0.25), POT, segs=12)
    p.cyl(0.30, 0.30, 0.05, (0, 0, 0.5), POT, segs=12)
    p.cyl(0.26, 0.26, 0.02, (0, 0, 0.51), SOIL, segs=12)
    blobs = [
        (0.36, (0.00, 0.00, 1.05), LEAF, (1.0, 1.0, 0.85)),
        (0.30, (0.22, 0.10, 0.90), LEAF2, (1.0, 1.0, 0.8)),
        (0.30, (-0.20, 0.14, 0.95), LEAF, (1.0, 1.0, 0.8)),
        (0.28, (0.05, -0.24, 0.92), LEAF2, (1.0, 1.0, 0.8)),
        (0.26, (-0.06, 0.02, 1.32), LEAF2, (1.0, 1.0, 0.9)),
    ]
    for r, c, m, s in blobs:
        p.sphere(r, c, m, subdiv=1, scale=s)


def build_watercooler(p):
    p.box((0.45, 0.45, 1.0), (0, 0, 0.5), COOLER, bevel=0.02, edges='z')
    p.box((0.04, 0.08, 0.06), (-0.07, -0.26, 0.74), TAP_B)
    p.box((0.04, 0.08, 0.06), (0.07, -0.26, 0.74), TAP_R)
    p.cyl(0.10, 0.10, 0.08, (0, 0, 1.04), COOLER, segs=12)
    p.cyl(0.19, 0.19, 0.50, (0, 0, 1.33), WATER, segs=14)
    p.cyl(0.19, 0.11, 0.12, (0, 0, 1.64), WATER, segs=14)


def build_whiteboard(p):
    p.box((1.8, 0.06, 1.1), (0, 0, 1.4), BOARD)
    p.box((1.9, 0.07, 0.05), (0, 0, 1.975), FRAME)
    p.box((1.9, 0.07, 0.05), (0, 0, 0.825), FRAME)
    p.box((0.05, 0.07, 1.2), (-0.925, 0, 1.4), FRAME)
    p.box((0.05, 0.07, 1.2), (0.925, 0, 1.4), FRAME)
    p.box((1.0, 0.12, 0.03), (0, -0.05, 0.80), FRAME)
    p.box((0.60, 0.006, 0.03), (-0.35, -0.034, 1.66), MARK_B)
    p.box((0.90, 0.006, 0.03), (0.05, -0.034, 1.50), MARK_B)
    p.box((0.45, 0.006, 0.03), (0.30, -0.034, 1.30), MARK_R)
    p.box((0.30, 0.006, 0.03), (-0.45, -0.034, 1.18), MARK_R)


def build_coffee(p):
    p.box((0.34, 0.40, 0.46), (0, 0, 0.23), DARK, bevel=0.015)
    p.box((0.30, 0.10, 0.20), (0, -0.20, 0.15), STEEL)
    p.box((0.16, 0.02, 0.06), (0, -0.21, 0.36), SCREEN)
    p.cyl(0.045, 0.045, 0.08, (0.0, -0.17, 0.09), MUG, segs=10)


def build_microwave(p):
    p.box((0.52, 0.38, 0.32), (0, 0, 0.16), STEEL, bevel=0.012)
    p.box((0.34, 0.02, 0.24), (-0.06, -0.195, 0.16), DARK)
    p.box((0.06, 0.02, 0.22), (0.19, -0.195, 0.16), SKIRT)


PIECES = {
    'wall': build_wall,
    'glass': build_glass,
    'doorframe': build_doorframe,
    'doorpost': build_doorpost,
    'desk_top': build_desk_top,
    'desk_panel': build_desk_panel,
    'monitor': build_monitor,
    'keyboard': build_keyboard,
    'chair': build_chair,
    'rack': build_rack,
    'pillar': build_pillar,
    'printer': build_printer,
    'plant': build_plant,
    'watercooler': build_watercooler,
    'whiteboard': build_whiteboard,
    'coffee': build_coffee,
    'microwave': build_microwave,
}


# ---------------------------------------------------------------- scene

def build_all():
    reset_scene()
    kit = bpy.data.collections.new('OfficeKit')
    bpy.context.scene.collection.children.link(kit)
    # lay the pieces out in a row so the .blend is pleasant to open
    x = 0.0
    for name, fn in PIECES.items():
        p = Piece(name)
        fn(p)
        ob = p.build(kit)
        ob.location.x = x
        x += 2.5
    return kit


def export():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    # pieces must export at the origin; the row layout is only for viewing
    saved = {}
    for ob in bpy.data.objects:
        saved[ob.name] = ob.location.copy()
        ob.location = (0, 0, 0)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_animations=False, export_skins=False, export_morph=False, **GLTF_COMMON)
    for ob in bpy.data.objects:
        ob.location = saved[ob.name]
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)


if __name__ == '__main__' or 'result' in globals():
    build_all()
    export()
    result = {'glb': OUT_GLB, 'blend': OUT_BLEND, 'pieces': list(PIECES.keys())}
