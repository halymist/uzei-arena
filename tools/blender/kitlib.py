# Shared helpers for the Blender asset scripts (office_kit.py, characters.py).
#
# Everything is built from primitives in bmesh so the models can be rebuilt
# from scratch; the .blend files are saved as editable snapshots.

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

SHARP_ANGLE = math.radians(38)

_mats = {}


def mat(name, rgb, emissive=None, alpha=None, rough=0.85):
    """Principled material; cached by name so pieces share them."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1.0)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except AttributeError:
            m.blend_method = 'BLEND'
    m.diffuse_color = (*rgb, 1.0 if alpha is None else alpha)
    _mats[name] = m
    return m


def _edge_match(e, which):
    d = (e.verts[1].co - e.verts[0].co).normalized()
    mid = (e.verts[1].co + e.verts[0].co) / 2
    if which == 'all':
        return True
    if which == 'x':
        return abs(d.x) > 0.9
    if which == 'y':
        return abs(d.y) > 0.9
    if which == 'z':
        return abs(d.z) > 0.9
    if which == 'h':
        return abs(d.z) < 0.1
    if which == 'top':
        return abs(d.z) < 0.1 and mid.z > 0
    if which == 'xz':
        return abs(d.y) < 0.1
    return False


def _rot_matrix(rot):
    rx, ry, rz = rot
    return (Matrix.Rotation(math.radians(rz), 4, 'Z')
            @ Matrix.Rotation(math.radians(ry), 4, 'Y')
            @ Matrix.Rotation(math.radians(rx), 4, 'X'))


class Piece:
    """Accumulates primitives into one mesh. Each primitive remembers which
    bone (vertex group) it belongs to, so characters get rigid skinning for
    free: every vertex of a part follows exactly one bone."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.groups = []  # (bone, first_vertex, last_vertex_exclusive)

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _merge(self, tb, m, bone, rot=None):
        if rot is not None:
            bmesh.ops.transform(tb, matrix=_rot_matrix(rot), verts=tb.verts)
        mi = self._mi(m)
        for f in tb.faces:
            f.material_index = mi
        tmp = bpy.data.meshes.new('_tmp')
        tb.to_mesh(tmp)
        tb.free()
        start = len(self.bm.verts)
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        if bone:
            self.groups.append((bone, start, len(self.bm.verts)))

    def box(self, size, center, m, bevel=0.0, edges='all', segments=2, bone=None, rot=None):
        tb = bmesh.new()
        bmesh.ops.create_cube(tb, size=1.0)
        bmesh.ops.scale(tb, vec=Vector(size), verts=tb.verts)
        if bevel > 0:
            sel = [e for e in tb.edges if _edge_match(e, edges)]
            if sel:
                bmesh.ops.bevel(tb, geom=sel, offset=bevel, segments=segments, profile=0.72,
                                affect='EDGES', clamp_overlap=True)
        if rot is not None:
            bmesh.ops.transform(tb, matrix=_rot_matrix(rot), verts=tb.verts)
        bmesh.ops.translate(tb, vec=Vector(center), verts=tb.verts)
        self._merge(tb, m, bone)

    def cyl(self, r1, r2, h, center, m, segs=16, bone=None, rot=None):
        tb = bmesh.new()
        bmesh.ops.create_cone(tb, cap_ends=True, cap_tris=False, segments=segs,
                              radius1=r1, radius2=r2, depth=h)
        if rot is not None:
            bmesh.ops.transform(tb, matrix=_rot_matrix(rot), verts=tb.verts)
        bmesh.ops.translate(tb, vec=Vector(center), verts=tb.verts)
        self._merge(tb, m, bone)

    def sphere(self, r, center, m, subdiv=1, scale=(1, 1, 1), bone=None, rot=None):
        tb = bmesh.new()
        bmesh.ops.create_icosphere(tb, subdivisions=subdiv, radius=r)
        bmesh.ops.scale(tb, vec=Vector(scale), verts=tb.verts)
        if rot is not None:
            bmesh.ops.transform(tb, matrix=_rot_matrix(rot), verts=tb.verts)
        bmesh.ops.translate(tb, vec=Vector(center), verts=tb.verts)
        self._merge(tb, m, bone)

    def build(self, collection, weld=True):
        bm = self.bm
        if weld and not self.groups:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.normal_update()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b = e.link_faces
                e.smooth = a.normal.angle(b.normal, 0.0) < SHARP_ANGLE
            else:
                e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        for bone, a, b in self.groups:
            vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            vg.add(list(range(a, b)), 1.0, 'REPLACE')
        return ob


def reset_scene():
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for b in list(block):
            if b.users == 0:
                block.remove(b)
    _mats.clear()


GLTF_COMMON = dict(
    export_format='GLB',
    export_apply=True,
    export_yup=True,
    export_lights=False,
    export_cameras=False,
    export_texcoords=False,
    export_normals=True,
    use_selection=False,
)
