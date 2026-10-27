# Builds the game characters: one humanoid rig shared by the player and the
# four office NPCs, plus a dog rig, with every animation clip the client uses.
#
#   blender --background --python tools/blender/characters.py
#
# Output: assets/characters.blend (editable) and web/models/characters.glb.
#
# Conventions match office_kit.py: Z up, characters face -Y (which is +Z in
# the game, toward the camera), origin between the feet. Skinning is rigid:
# every body part follows exactly one bone, so the low-poly look stays crisp
# and no weight painting is needed. Clips key every bone (rest pose where a
# bone does nothing) so the client can cross-fade any clip into any other.
#
# Angle conventions used by K(): rotations are about the WORLD axes of the
# rest pose. For a bone hanging down (arms, legs) a negative rx swings it
# forward; for a bone pointing up (hips, spine, head) a positive rx leans it
# forward. ry tilts sideways, rz twists.

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
sys.path.insert(0, HERE)
import importlib  # noqa: E402
import kitlib  # noqa: E402
importlib.reload(kitlib)
from kitlib import GLTF_COMMON, Piece, mat, reset_scene  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_BLEND = os.path.join(ROOT, 'assets', 'characters.blend')
OUT_GLB = os.path.join(ROOT, 'web', 'models', 'characters.glb')

FPS = 24

# ---------------------------------------------------------------- materials

SKIN = mat('Skin', (0.93, 0.76, 0.62))
TINT = mat('Tint', (1.0, 1.0, 1.0))                 # player shirt, coloured by the client
TROUSERS = mat('Trousers', (0.16, 0.18, 0.25))
SHOES = mat('Shoes', (0.09, 0.09, 0.11))
SHIRT_LIGHT = mat('ShirtLight', (0.84, 0.89, 0.96))
SHIRT_WHITE = mat('ShirtWhite', (0.95, 0.95, 0.95))
SUIT = mat('Suit', (0.15, 0.16, 0.21))
TIE_RED = mat('TieRed', (0.78, 0.15, 0.20))
TIE_DARK = mat('TieDark', (0.11, 0.13, 0.24))
DRESS = mat('Dress', (0.40, 0.62, 0.95))
HAIR = mat('Hair', (0.16, 0.10, 0.07))
HAIR_LIGHT = mat('HairLight', (0.38, 0.26, 0.15))
COAT = mat('Coat', (0.60, 0.67, 0.38))
DARK = mat('Dark', (0.08, 0.09, 0.12))
PHONE_SCREEN = mat('PhoneScreen', (0.4, 0.9, 1.0), emissive=(0.4, 0.9, 1.0))
FOLDER = mat('Folder', (0.95, 0.88, 0.62))
FUR = mat('Fur', (0.58, 0.42, 0.26))
FUR_DARK = mat('FurDark', (0.33, 0.22, 0.12))
FUR_LIGHT = mat('FurLight', (0.78, 0.66, 0.50))
COLLAR = mat('Collar', (0.85, 0.20, 0.22))

# ---------------------------------------------------------------- rigs

# name, head, tail, parent
HUMAN_BONES = [
    ('hips', (0, 0, 0.95), (0, 0, 1.05), None),
    ('spine', (0, 0, 1.05), (0, 0, 1.50), 'hips'),
    ('head', (0, 0, 1.50), (0, 0, 1.92), 'spine'),
    ('upper_arm.L', (0.31, 0, 1.47), (0.31, 0, 1.15), 'spine'),
    ('forearm.L', (0.31, 0, 1.15), (0.31, 0, 0.82), 'upper_arm.L'),
    ('upper_arm.R', (-0.31, 0, 1.47), (-0.31, 0, 1.15), 'spine'),
    ('forearm.R', (-0.31, 0, 1.15), (-0.31, 0, 0.82), 'upper_arm.R'),
    ('thigh.L', (0.13, 0, 0.95), (0.13, 0, 0.50), 'hips'),
    ('shin.L', (0.13, 0, 0.50), (0.13, 0, 0.05), 'thigh.L'),
    ('thigh.R', (-0.13, 0, 0.95), (-0.13, 0, 0.50), 'hips'),
    ('shin.R', (-0.13, 0, 0.50), (-0.13, 0, 0.05), 'thigh.R'),
]

DOG_BONES = [
    ('d_spine', (0, 0.30, 0.46), (0, -0.25, 0.48), None),
    ('d_head', (0, -0.25, 0.50), (0, -0.66, 0.60), 'd_spine'),
    ('d_tail', (0, 0.32, 0.48), (0, 0.62, 0.70), 'd_spine'),
    ('d_leg.FL', (0.14, -0.18, 0.42), (0.14, -0.18, 0.02), 'd_spine'),
    ('d_leg.FR', (-0.14, -0.18, 0.42), (-0.14, -0.18, 0.02), 'd_spine'),
    ('d_leg.BL', (0.14, 0.22, 0.42), (0.14, 0.22, 0.02), 'd_spine'),
    ('d_leg.BR', (-0.14, 0.22, 0.42), (-0.14, 0.22, 0.02), 'd_spine'),
]


def make_rig(name, bones, collection):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, head, tail, parent in bones:
        eb = arm.edit_bones.new(bname)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        if parent:
            eb.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.select_set(False)
    arm.display_type = 'STICK'
    return rig


def bind(ob, rig):
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ---------------------------------------------------------------- humanoid meshes

def side(s):
    return '.L' if s > 0 else '.R'


def add_head(p, r, z, skin=SKIN, eyes=True):
    p.sphere(r, (0, 0, z), skin, subdiv=2, bone='head')
    p.cyl(0.07, 0.08, 0.12, (0, 0, z - r + 0.02), skin, segs=10, bone='head')
    if eyes:
        ey = -r * 0.86
        p.sphere(0.032, (0.075, ey, z + 0.03), DARK, subdiv=1, bone='head')
        p.sphere(0.032, (-0.075, ey, z + 0.03), DARK, subdiv=1, bone='head')


def add_arms(p, sleeve, lower, r=0.08, hand_r=0.085, z_top=1.47):
    for s in (1, -1):
        x = s * 0.31
        p.cyl(r, r * 0.9, 0.32, (x, 0, z_top - 0.16), sleeve, segs=10, bone='upper_arm' + side(s))
        p.cyl(r * 0.9, r * 0.8, 0.31, (x, 0, 0.99), lower, segs=10, bone='forearm' + side(s))
        p.sphere(hand_r, (x, 0, 0.81), SKIN, subdiv=1, bone='forearm' + side(s))


def add_legs(p, trousers, r=0.11, shoes=SHOES):
    for s in (1, -1):
        x = s * 0.13
        p.cyl(r, r * 0.9, 0.47, (x, 0, 0.72), trousers, segs=10, bone='thigh' + side(s))
        p.cyl(r * 0.88, r * 0.8, 0.44, (x, 0, 0.29), trousers, segs=10, bone='shin' + side(s))
        p.box((0.17, 0.30, 0.10), (x, -0.05, 0.05), shoes, bevel=0.02, bone='shin' + side(s))


def build_player(p):
    p.box((0.44, 0.26, 0.16), (0, 0, 1.01), TROUSERS, bevel=0.03, bone='hips')
    p.box((0.52, 0.30, 0.50), (0, 0, 1.30), TINT, bevel=0.06, bone='spine')
    p.box((0.10, 0.03, 0.32), (0, -0.165, 1.31), TIE_DARK, bone='spine')
    p.box((0.13, 0.04, 0.07), (0, -0.17, 1.51), TIE_DARK, bone='spine')
    add_head(p, 0.21, 1.74)
    p.sphere(0.205, (0, 0.02, 1.84), HAIR_LIGHT, subdiv=2, scale=(1.05, 1.05, 0.7), bone='head')
    add_arms(p, TINT, TINT)
    add_legs(p, TROUSERS)


def build_namestek(p):
    p.box((0.44, 0.26, 0.16), (0, 0, 1.01), TROUSERS, bevel=0.03, bone='hips')
    p.box((0.52, 0.30, 0.50), (0, 0, 1.30), SHIRT_LIGHT, bevel=0.06, bone='spine')
    p.box((0.16, 0.03, 0.06), (0, -0.165, 1.52), SHIRT_WHITE, bone='spine')  # collar
    add_head(p, 0.21, 1.74)
    p.cyl(0.055, 0.02, 0.17, (0, -0.26, 1.72), SKIN, segs=8, bone='head', rot=(-90, 0, 0))
    p.sphere(0.205, (0, 0.03, 1.83), HAIR, subdiv=2, scale=(1.05, 1.05, 0.65), bone='head')
    add_arms(p, SHIRT_LIGHT, SHIRT_LIGHT)
    p.box((0.05, 0.28, 0.36), (0.42, -0.05, 0.92), FOLDER, bevel=0.01, bone='forearm.L')
    add_legs(p, TROUSERS)


def build_reditel(p):
    p.box((0.62, 0.42, 0.18), (0, 0, 1.01), SUIT, bevel=0.04, bone='hips')
    p.box((0.70, 0.46, 0.52), (0, 0, 1.31), SUIT, bevel=0.10, bone='spine')
    p.sphere(0.30, (0, -0.07, 1.20), SUIT, subdiv=2, scale=(1.25, 1.0, 1.0), bone='spine')
    p.sphere(0.305, (0, -0.075, 1.20), SHIRT_WHITE, subdiv=2, scale=(0.45, 1.0, 0.95), bone='spine')
    p.box((0.11, 0.03, 0.30), (0, -0.37, 1.30), TIE_RED, bone='spine')
    p.box((0.14, 0.04, 0.07), (0, -0.33, 1.50), TIE_RED, bone='spine')
    add_head(p, 0.24, 1.76)
    for s in (1, -1):
        p.sphere(0.08, (s * 0.21, 0.02, 1.72), HAIR, subdiv=1, scale=(0.6, 1.3, 0.9), bone='head')
        p.box((0.08, 0.03, 0.025), (s * 0.085, -0.215, 1.84), HAIR, bone='head', rot=(0, 0, s * -18))
    add_arms(p, SUIT, SUIT, r=0.10, hand_r=0.09)
    add_legs(p, SUIT, r=0.13)


def build_sofie(p):
    p.box((0.36, 0.22, 0.14), (0, 0, 1.01), DRESS, bevel=0.03, bone='hips')
    p.cyl(0.31, 0.20, 0.52, (0, 0, 0.73), DRESS, segs=14, bone='hips')
    p.box((0.38, 0.22, 0.48), (0, 0, 1.30), DRESS, bevel=0.05, bone='spine')
    p.box((0.30, 0.03, 0.05), (0, -0.115, 1.52), SKIN, bone='spine')  # neckline
    add_head(p, 0.20, 1.74)
    p.sphere(0.215, (0, 0.02, 1.79), HAIR, subdiv=2, scale=(1.05, 1.08, 0.78), bone='head')
    p.cyl(0.065, 0.035, 0.46, (0, 0.21, 1.52), HAIR, segs=10, bone='head', rot=(-18, 0, 0))
    add_arms(p, DRESS, SKIN, r=0.065, hand_r=0.075)
    add_legs(p, SKIN, r=0.08)


def build_curda(p):
    p.box((0.56, 0.40, 0.16), (0, 0, 1.01), TROUSERS, bevel=0.04, bone='hips')
    p.sphere(0.36, (0, 0, 1.30), COAT, subdiv=2, scale=(0.95, 0.80, 0.80), bone='spine')
    p.box((0.12, 0.04, 0.40), (0, -0.29, 1.28), COAT, bone='spine')  # buttons strip
    add_head(p, 0.25, 1.76)
    p.box((0.38, 0.03, 0.07), (0, -0.235, 1.80), DARK, bone='head')
    p.sphere(0.25, (0, 0.03, 1.84), HAIR, subdiv=2, scale=(1.02, 1.02, 0.5), bone='head')
    add_arms(p, COAT, COAT, r=0.095, hand_r=0.09)
    p.box((0.08, 0.025, 0.15), (-0.36, -0.06, 0.80), DARK, bone='forearm.R', rot=(0, 0, -20))
    p.box((0.06, 0.004, 0.12), (-0.355, -0.077, 0.80), PHONE_SCREEN, bone='forearm.R', rot=(0, 0, -20))
    add_legs(p, TROUSERS, r=0.12)


HUMANS = {
    'player': build_player,
    'namestek': build_namestek,
    'reditel': build_reditel,
    'sofie': build_sofie,
    'curda': build_curda,
}


def build_dog(p):
    p.box((0.36, 0.72, 0.30), (0, 0.02, 0.46), FUR, bevel=0.05, bone='d_spine')
    p.sphere(0.19, (0, -0.26, 0.46), FUR, subdiv=2, scale=(1.0, 1.0, 0.9), bone='d_spine')
    p.cyl(0.15, 0.15, 0.05, (0, -0.28, 0.52), COLLAR, segs=12, bone='d_spine', rot=(60, 0, 0))
    p.box((0.26, 0.26, 0.24), (0, -0.44, 0.60), FUR, bevel=0.04, bone='d_head')
    p.box((0.15, 0.17, 0.13), (0, -0.62, 0.55), FUR_LIGHT, bevel=0.02, bone='d_head')
    p.sphere(0.035, (0, -0.70, 0.59), DARK, subdiv=1, bone='d_head')
    for s in (1, -1):
        p.sphere(0.028, (s * 0.075, -0.56, 0.65), DARK, subdiv=1, bone='d_head')
        p.box((0.06, 0.09, 0.15), (s * 0.145, -0.40, 0.60), FUR_DARK, bevel=0.015, bone='d_head', rot=(0, s * 12, 0))
    p.cyl(0.04, 0.025, 0.38, (0, 0.47, 0.60), FUR_DARK, segs=8, bone='d_tail', rot=(-55, 0, 0))
    for bname, x, y in (('d_leg.FL', 0.14, -0.18), ('d_leg.FR', -0.14, -0.18), ('d_leg.BL', 0.14, 0.22), ('d_leg.BR', -0.14, 0.22)):
        p.cyl(0.055, 0.045, 0.40, (x, y, 0.22), FUR, segs=8, bone=bname)
        p.sphere(0.06, (x, y - 0.02, 0.05), FUR_DARK, subdiv=1, scale=(1, 1.2, 0.8), bone=bname)


# ---------------------------------------------------------------- animation DSL

class Clip:
    """Keys bone rotations about world axes (see header) into a new action."""

    def __init__(self, rig, name, length, loop):
        self.rig = rig
        self.name = name
        self.length = length
        self.loop = loop
        self.keys = {}  # (bone, frame) -> dict
        for pb in rig.pose.bones:
            self.keys[(pb.name, 0)] = {}

    def K(self, bone, frame, rx=0, ry=0, rz=0, loc=None):
        self.keys[(bone, frame)] = {'rx': rx, 'ry': ry, 'rz': rz, 'loc': loc}

    def KS(self, bones, frame, **kw):
        for b in bones:
            self.K(b, frame, **kw)

    def finish(self):
        rig = self.rig
        act = bpy.data.actions.new(self.name)
        ad = rig.animation_data or rig.animation_data_create()
        ad.action = act
        if hasattr(ad, 'action_slot') and not ad.action_slot:
            try:
                ad.action_slot = act.slots.new(id_type='OBJECT', name=rig.name)
            except Exception:
                pass
        keys = dict(self.keys)
        if self.loop:
            for (bone, frame), v in list(keys.items()):
                if frame == 0 and (bone, self.length) not in keys:
                    keys[(bone, self.length)] = v
        for (bone, frame), v in keys.items():
            pb = rig.pose.bones[bone]
            M = pb.bone.matrix_local.to_3x3()
            R = (Matrix.Rotation(math.radians(v.get('rz', 0)), 3, 'Z')
                 @ Matrix.Rotation(math.radians(v.get('ry', 0)), 3, 'Y')
                 @ Matrix.Rotation(math.radians(v.get('rx', 0)), 3, 'X'))
            L = M.inverted() @ R @ M
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = L.to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            loc = v.get('loc') or (0, 0, 0)
            pb.location = M.inverted() @ Vector(loc)
            pb.keyframe_insert('location', frame=frame)
        act.frame_range = (0, self.length)
        act.use_frame_range = True
        if self.loop:
            act.use_cyclic = True
        # park the action on its own NLA track so the exporter finds it
        track = ad.nla_tracks.new()
        track.name = self.name
        strip = track.strips.new(self.name, 0, act)
        if hasattr(strip, 'action_slot') and ad.action_slot:
            strip.action_slot = ad.action_slot
        ad.action = None
        for pb in rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        return act


ARMS = ['upper_arm.L', 'upper_arm.R']
FOREARMS = ['forearm.L', 'forearm.R']
THIGHS = ['thigh.L', 'thigh.R']
SHINS = ['shin.L', 'shin.R']


def human_clips(rig):
    c = Clip(rig, 'idle', 48, True)
    c.K('spine', 24, rx=2.5)
    c.K('head', 24, rx=-2)
    c.K('upper_arm.L', 0, ry=-4, rx=2); c.K('upper_arm.L', 24, ry=-7, rx=4)
    c.K('upper_arm.R', 0, ry=4, rx=2); c.K('upper_arm.R', 24, ry=7, rx=4)
    c.KS(FOREARMS, 0, rx=-8)
    c.K('hips', 24, loc=(0, 0, -0.015))
    c.finish()

    c = Clip(rig, 'run', 16, True)
    c.K('thigh.L', 0, rx=-40); c.K('thigh.L', 8, rx=35)
    c.K('thigh.R', 0, rx=35); c.K('thigh.R', 8, rx=-40)
    c.K('shin.L', 0, rx=15); c.K('shin.L', 4, rx=5); c.K('shin.L', 8, rx=75); c.K('shin.L', 12, rx=45)
    c.K('shin.R', 0, rx=75); c.K('shin.R', 4, rx=45); c.K('shin.R', 8, rx=15); c.K('shin.R', 12, rx=5)
    c.K('upper_arm.L', 0, rx=35); c.K('upper_arm.L', 8, rx=-40)
    c.K('upper_arm.R', 0, rx=-40); c.K('upper_arm.R', 8, rx=35)
    c.KS(FOREARMS, 0, rx=-55)
    c.K('spine', 0, rx=12, rz=5); c.K('spine', 8, rx=12, rz=-5)
    c.K('head', 0, rx=-8)
    c.K('hips', 4, loc=(0, 0, -0.045)); c.K('hips', 8, loc=(0, 0, 0)); c.K('hips', 12, loc=(0, 0, -0.045))
    c.finish()

    c = Clip(rig, 'walk', 24, True)
    c.K('thigh.L', 0, rx=-22); c.K('thigh.L', 12, rx=18)
    c.K('thigh.R', 0, rx=18); c.K('thigh.R', 12, rx=-22)
    c.K('shin.L', 0, rx=8); c.K('shin.L', 6, rx=4); c.K('shin.L', 12, rx=35); c.K('shin.L', 18, rx=20)
    c.K('shin.R', 0, rx=35); c.K('shin.R', 6, rx=20); c.K('shin.R', 12, rx=8); c.K('shin.R', 18, rx=4)
    c.K('upper_arm.L', 0, rx=15); c.K('upper_arm.L', 12, rx=-18)
    c.K('upper_arm.R', 0, rx=-18); c.K('upper_arm.R', 12, rx=15)
    c.KS(FOREARMS, 0, rx=-15)
    c.K('spine', 0, rx=3, rz=2); c.K('spine', 12, rx=3, rz=-2)
    c.K('hips', 6, loc=(0, 0, -0.02)); c.K('hips', 12, loc=(0, 0, 0)); c.K('hips', 18, loc=(0, 0, -0.02))
    c.finish()

    c = Clip(rig, 'attack', 12, False)
    c.K('upper_arm.R', 3, rx=45, ry=25); c.K('upper_arm.R', 6, rx=-115, ry=5); c.K('upper_arm.R', 12)
    c.K('forearm.R', 0, rx=-15); c.K('forearm.R', 3, rx=-70); c.K('forearm.R', 6, rx=-5); c.K('forearm.R', 12, rx=-15)
    c.K('upper_arm.L', 3, rx=-20); c.K('upper_arm.L', 6, rx=25); c.K('upper_arm.L', 12)
    c.K('forearm.L', 0, rx=-20)
    c.K('spine', 3, rz=18, rx=-4); c.K('spine', 6, rz=-18, rx=10); c.K('spine', 12)
    c.K('head', 6, rx=5); c.K('head', 12)
    c.finish()

    c = Clip(rig, 'cast', 18, False)
    c.K('upper_arm.L', 6, rx=-165, ry=-15); c.K('upper_arm.L', 10, rx=-85, ry=-8); c.K('upper_arm.L', 18)
    c.K('upper_arm.R', 6, rx=-165, ry=15); c.K('upper_arm.R', 10, rx=-85, ry=8); c.K('upper_arm.R', 18)
    c.KS(FOREARMS, 0, rx=-15); c.KS(FOREARMS, 6, rx=-25); c.KS(FOREARMS, 10, rx=-10); c.KS(FOREARMS, 18, rx=-15)
    c.K('spine', 6, rx=-10); c.K('spine', 10, rx=16); c.K('spine', 18)
    c.K('hips', 10, loc=(0, 0, -0.06)); c.K('hips', 18)
    c.K('head', 6, rx=-10); c.K('head', 10, rx=8); c.K('head', 18)
    c.finish()

    c = Clip(rig, 'channel', 24, True)
    c.K('upper_arm.L', 0, rx=-80, ry=-6); c.K('upper_arm.L', 6, rx=-84, ry=-6); c.K('upper_arm.L', 12, rx=-78, ry=-6); c.K('upper_arm.L', 18, rx=-83, ry=-6)
    c.K('upper_arm.R', 0, rx=-80, ry=6); c.K('upper_arm.R', 6, rx=-84, ry=6); c.K('upper_arm.R', 12, rx=-78, ry=6); c.K('upper_arm.R', 18, rx=-83, ry=6)
    c.KS(FOREARMS, 0, rx=-15)
    c.K('spine', 0, rx=8)
    c.K('hips', 12, loc=(0, 0, -0.02))
    c.finish()

    c = Clip(rig, 'dash', 10, False)
    c.K('spine', 2, rx=38); c.K('spine', 8, rx=30); c.K('spine', 10)
    c.KS(ARMS, 2, rx=70); c.KS(ARMS, 10)
    c.KS(FOREARMS, 0, rx=-20)
    c.K('head', 2, rx=-20); c.K('head', 10)
    c.K('thigh.L', 2, rx=-20); c.K('thigh.R', 2, rx=30); c.KS(THIGHS, 10)
    c.K('shin.L', 2, rx=20); c.K('shin.R', 2, rx=60); c.KS(SHINS, 10)
    c.finish()

    c = Clip(rig, 'hit', 8, False)
    c.K('spine', 2, rx=-14, rz=6); c.K('spine', 8)
    c.K('head', 2, rx=-18); c.K('head', 8)
    c.K('upper_arm.L', 2, rx=15, ry=-20); c.K('upper_arm.R', 2, rx=15, ry=20); c.KS(ARMS, 8)
    c.finish()

    c = Clip(rig, 'stun', 24, True)
    c.K('head', 0, ry=-18, rx=-8); c.K('head', 12, ry=18, rx=-8)
    c.K('spine', 0, rz=6); c.K('spine', 12, rz=-6)
    c.K('upper_arm.L', 0, rx=8, ry=-22); c.K('upper_arm.R', 0, rx=8, ry=22)
    c.KS(FOREARMS, 0, rx=-25)
    c.K('hips', 0, loc=(0, 0, -0.02))
    c.finish()

    c = Clip(rig, 'death', 20, False)
    c.K('hips', 4, rx=-25, loc=(0, 0.05, -0.10)); c.K('hips', 12, rx=-82, loc=(0, 0.12, -0.82)); c.K('hips', 20, rx=-82, loc=(0, 0.12, -0.82))
    c.KS(THIGHS, 12, rx=-15); c.KS(SHINS, 12, rx=30)
    c.K('upper_arm.L', 12, rx=10, ry=-70); c.K('upper_arm.R', 12, rx=10, ry=70)
    c.K('head', 12, rx=-15)
    c.finish()

    c = Clip(rig, 'pickup', 30, True)
    c.K('spine', 0, rx=40); c.K('spine', 15, rx=43)
    c.KS(THIGHS, 0, rx=-25); c.KS(SHINS, 0, rx=55)
    c.KS(ARMS, 0, rx=-40); c.KS(FOREARMS, 0, rx=-30)
    c.K('hips', 0, loc=(0, 0, -0.18)); c.K('hips', 15, loc=(0, 0, -0.20))
    c.K('head', 0, rx=-20)
    c.finish()

    c = Clip(rig, 'shout', 20, False)
    c.K('upper_arm.R', 4, rx=-150, ry=20); c.K('upper_arm.R', 8, rx=-140, ry=35); c.K('upper_arm.R', 12, rx=-150, ry=10); c.K('upper_arm.R', 16, rx=-140, ry=35); c.K('upper_arm.R', 20)
    c.K('forearm.R', 4, rx=-40); c.K('forearm.R', 20)
    c.K('head', 4, rx=-12, ry=10); c.K('head', 20)
    c.K('spine', 4, rx=-5); c.K('spine', 20)
    c.finish()

    c = Clip(rig, 'heal', 40, True)
    c.K('upper_arm.L', 0, rx=-35, ry=-55); c.K('upper_arm.L', 20, rx=-45, ry=-60)
    c.K('upper_arm.R', 0, rx=-35, ry=55); c.K('upper_arm.R', 20, rx=-45, ry=60)
    c.KS(FOREARMS, 0, rx=-30)
    c.K('spine', 0, rx=2); c.K('spine', 20, rx=-2)
    c.K('hips', 20, loc=(0, 0, 0.03))
    c.K('head', 20, rx=-4)
    c.finish()

    c = Clip(rig, 'phone', 36, True)
    c.K('upper_arm.R', 0, rx=-25, ry=30); c.K('upper_arm.R', 18, rx=-27, ry=32)
    c.K('forearm.R', 0, rx=-150)
    c.K('upper_arm.L', 0, ry=-6, rx=3); c.K('upper_arm.L', 18, ry=-9, rx=6)
    c.K('forearm.L', 0, rx=-10)
    c.K('head', 0, ry=-10, rx=2); c.K('head', 18, ry=-12, rx=-2)
    c.K('spine', 18, rx=2)
    c.finish()

    c = Clip(rig, 'boss_idle', 48, True)
    c.K('upper_arm.L', 0, rx=10, ry=-35); c.K('upper_arm.L', 24, rx=12, ry=-37)
    c.K('upper_arm.R', 0, rx=10, ry=35); c.K('upper_arm.R', 24, rx=12, ry=37)
    c.KS(FOREARMS, 0, rx=-100)
    c.K('spine', 0, rx=-6); c.K('spine', 24, rx=-3)
    c.K('head', 0, rx=4); c.K('head', 24, rx=6)
    c.K('hips', 24, loc=(0, 0, -0.015))
    c.finish()


DOG_LEGS_F = ['d_leg.FL', 'd_leg.FR']
DOG_LEGS_B = ['d_leg.BL', 'd_leg.BR']


def dog_clips(rig):
    c = Clip(rig, 'dog_idle', 48, True)
    for f in range(0, 49, 6):
        c.K('d_tail', f, rz=-25 if (f // 6) % 2 == 0 else 25)
    c.K('d_head', 24, rx=5)
    c.K('d_spine', 24, loc=(0, 0, -0.01))
    c.finish()

    c = Clip(rig, 'dog_run', 12, True)
    c.KS(DOG_LEGS_F, 0, rx=-40); c.KS(DOG_LEGS_F, 6, rx=35)
    c.KS(DOG_LEGS_B, 0, rx=35); c.KS(DOG_LEGS_B, 6, rx=-40)
    c.K('d_spine', 0, rx=-5); c.K('d_spine', 3, rx=0, loc=(0, 0, -0.05)); c.K('d_spine', 6, rx=5); c.K('d_spine', 9, rx=0, loc=(0, 0, -0.05))
    c.K('d_head', 0, rx=-5)
    c.K('d_tail', 0, rz=-15); c.K('d_tail', 6, rz=15)
    c.finish()

    c = Clip(rig, 'dog_walk', 20, True)
    c.K('d_leg.FL', 0, rx=-20); c.K('d_leg.FL', 10, rx=18)
    c.K('d_leg.BR', 0, rx=-20); c.K('d_leg.BR', 10, rx=18)
    c.K('d_leg.FR', 0, rx=18); c.K('d_leg.FR', 10, rx=-20)
    c.K('d_leg.BL', 0, rx=18); c.K('d_leg.BL', 10, rx=-20)
    c.K('d_spine', 5, loc=(0, 0, -0.015)); c.K('d_spine', 10, loc=(0, 0, 0)); c.K('d_spine', 15, loc=(0, 0, -0.015))
    c.K('d_tail', 0, rz=-20); c.K('d_tail', 10, rz=20)
    c.K('d_head', 0, rx=3)
    c.finish()

    c = Clip(rig, 'dog_bite', 10, False)
    c.K('d_head', 3, rx=-20); c.K('d_head', 6, rx=35); c.K('d_head', 10)
    c.K('d_spine', 6, rx=10, loc=(0, -0.12, 0)); c.K('d_spine', 10)
    c.KS(DOG_LEGS_F, 6, rx=-20); c.KS(DOG_LEGS_F, 10)
    c.finish()

    c = Clip(rig, 'dog_hit', 8, False)
    c.K('d_head', 2, rz=25); c.K('d_head', 8)
    c.K('d_spine', 2, loc=(0, 0.08, 0)); c.K('d_spine', 8)
    c.finish()

    c = Clip(rig, 'dog_stun', 24, True)
    c.K('d_head', 0, rz=-20, rx=-10); c.K('d_head', 12, rz=20, rx=-10)
    c.K('d_tail', 0, rz=0, rx=35)
    c.finish()

    c = Clip(rig, 'dog_death', 16, False)
    c.K('d_spine', 10, ry=85, loc=(0, 0, -0.28)); c.K('d_spine', 16, ry=85, loc=(0, 0, -0.28))
    c.KS(DOG_LEGS_F + DOG_LEGS_B, 10, rx=-30)
    c.K('d_head', 10, rx=10)
    c.finish()


# ---------------------------------------------------------------- build + export

def build_all():
    reset_scene()
    coll = bpy.data.collections.new('Characters')
    bpy.context.scene.collection.children.link(coll)
    bpy.context.scene.render.fps = FPS

    rig = make_rig('Rig', HUMAN_BONES, coll)
    for name, fn in HUMANS.items():
        p = Piece(name)
        fn(p)
        ob = p.build(coll)
        bind(ob, rig)
    human_clips(rig)

    dog_rig = make_rig('DogRig', DOG_BONES, coll)
    p = Piece('pes')
    build_dog(p)
    ob = p.build(coll)
    bind(ob, dog_rig)
    dog_clips(dog_rig)

    return rig, dog_rig


def export():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_frame_range=False,
        export_force_sampling=True,
        export_anim_single_armature=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_skins=True,
        export_morph=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        **GLTF_COMMON,
    )
    # All variants share one armature, so they must stay at the origin (an
    # offset mesh would deform around a shifted pivot). Hide all but one for
    # viewing; toggle visibility in the outliner to see the others.
    for name in HUMANS:
        bpy.data.objects[name].hide_viewport = name != 'player'
        bpy.data.objects[name].hide_render = name != 'player'
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)


if __name__ == '__main__':
    build_all()
    export()
    result = {
        'glb': OUT_GLB,
        'blend': OUT_BLEND,
        'actions': sorted(a.name for a in bpy.data.actions),
    }
