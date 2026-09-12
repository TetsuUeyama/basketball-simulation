# 顔を「のっぺらぼう」にして書き出す。
#  順序が重要:
#   1) 目・まつげの面を消す
#   2) ⚠️ **消した後に**頂点集合を作る（消すと頂点番号がずれる。先に作ると別の頂点を掴む）
#   3) 目と口の穴を塞ぐ（平滑化より前。後だと縁が残る）
#   4) 平滑化（細かい凹凸を消す）
#   5) 出っ張りの押し込み（鼻・耳。平滑化では減らない）
import bpy, bmesh, sys, os
from mathutils import Vector
A = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FACE_IT, ARM_IT, CLAMP = int(A[0]), int(A[1]), float(A[2])
OUT = A[3] if len(A) > 3 else ""
DEC = float(A[4]) if len(A) > 4 else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:/Users/user/Downloads/player-one/Spanish+footballer+FBX.FBX")
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
S = mesh.matrix_world.to_scale().x
names = [ms.material.name.lower() if ms.material else "" for ms in mesh.material_slots]

# --- 1) 目とまつげを消す ---------------------------------------------------
eye_i = [i for i, n in enumerate(names) if "eye" in n or "lash" in n]
if eye_i:
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(mesh.data)
    for f in bm.faces: f.select = f.material_index in eye_i
    bmesh.update_edit_mesh(mesh.data)
    bpy.ops.mesh.delete(type='FACE')
    bpy.ops.object.mode_set(mode='OBJECT')

# --- 2) 消した後に頂点集合を作る -------------------------------------------
def group(keys, exclude=()):
    gi = [g.index for g in mesh.vertex_groups
          if any(k in g.name for k in keys) and not any(x in g.name for x in exclude)]
    return {v.index for v in mesh.data.vertices
            for g in v.groups if g.group in gi and g.weight > 0.5}
head_v = group(("Head",))
arm_v = group(("Arm", "ForeArm"), ("Shoulder",))
print(f"頭の頂点 {len(head_v)} / 腕の頂点 {len(arm_v)}")

def rough(idxs):
    bm = bmesh.new(); bm.from_mesh(mesh.data); bm.verts.ensure_lookup_table()
    t = 0.0; n = 0
    for i in idxs:
        if i >= len(bm.verts): continue
        v = bm.verts[i]; lk = [e.other_vert(v).co for e in v.link_edges]
        if not lk: continue
        t += (v.co - sum(lk, Vector()) / len(lk)).length; n += 1
    bm.free(); return t / n * S * 1000 if n else 0.0
def open_edges(vset):
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    n = sum(1 for e in bm.edges if len(e.link_faces) == 1
            and all(v.index in vset for v in e.verts))
    bm.free(); return n

# --- 3) 目と口の穴だけ塞ぐ -------------------------------------------------
def fill_holes(vset):
    bm = bmesh.new(); bm.from_mesh(mesh.data); bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges if len(e.link_faces) == 1
             and all(v.index in vset for v in e.verts)]
    rest = set(edges); loops = []
    while rest:
        e0 = rest.pop(); loop = [e0]; stack = [e0]
        while stack:
            e = stack.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in rest:
                        rest.discard(e2); loop.append(e2); stack.append(e2)
        loops.append(loop)
    co = [mesh.data.vertices[i].co for i in vset]
    c = sum(co, Vector()) / len(co)
    picked = []
    for lp in loops:
        vs = {v for e in lp for v in e.verts}
        pts = [v.co for v in vs]
        size = max((max(p[k] for p in pts) - min(p[k] for p in pts)) for k in range(3)) * S
        fwd = sum(p.y for p in pts) / len(pts) < c.y
        # ⚠️ 頭の縁を全部塞がない。首・頭皮・シャツの境目まで塞ぐと面が荒れる。
        if size < 0.07 and fwd: picked.append(lp)
    made = []
    for lp in picked:
        ret = bmesh.ops.holes_fill(bm, edges=lp, sides=200)   # ⚠️ sides=0 だと塞がれない
        made += ret.get("faces", [])
    if made:
        bmesh.ops.triangulate(bm, faces=[f for f in made if f.is_valid and len(f.verts) > 3])
    bm.to_mesh(mesh.data); bm.free(); mesh.data.update()
    return len(loops), len(picked)

r0, a0 = rough(head_v), rough(arm_v)
h0 = open_edges(head_v)
nl, np_ = fill_holes(head_v)
h1 = open_edges(head_v)
# 顔の前面に小さい穴が残っていないか（残っていたら塞ぎ漏れ）
def front_holes(vset):
    bm = bmesh.new(); bm.from_mesh(mesh.data); bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges if len(e.link_faces) == 1
             and all(v.index in vset for v in e.verts)]
    rest = set(edges); out = []
    co = [mesh.data.vertices[i].co for i in vset]
    c = sum(co, Vector()) / len(co)
    while rest:
        e0 = rest.pop(); loop = [e0]; stack = [e0]
        while stack:
            e = stack.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in rest: rest.discard(e2); loop.append(e2); stack.append(e2)
        vs = {v for e in loop for v in e.verts}
        pts = [v.co for v in vs]
        size = max((max(pp[k] for pp in pts) - min(pp[k] for pp in pts)) for k in range(3)) * S
        if size < 0.07 and sum(pp.y for pp in pts) / len(pts) < c.y:
            out.append(round(size * 1000, 1))
    bm.free(); return out
fr = front_holes(head_v)
print(f"  顔の前面に残った小さい穴 {len(fr)} 個 {fr[:8]}")
print(f"  穴の縁 {h0} 本 → {h1} 本（ループ {nl} 個のうち {np_} 個を塞いだ）")

# --- 4) 平滑化 -------------------------------------------------------------
def smooth(vset, name, it):
    vg = mesh.vertex_groups.new(name=name); vg.add(list(vset), 1.0, 'REPLACE')
    bpy.context.view_layer.objects.active = mesh
    m = mesh.modifiers.new(name, 'SMOOTH'); m.factor = 1.0; m.iterations = it; m.vertex_group = name
    bpy.ops.object.modifier_apply(modifier=m.name)
smooth(head_v, "fFace", FACE_IT); smooth(arm_v, "fArm", ARM_IT)

# --- 5) 出っ張りの押し込み -------------------------------------------------
if CLAMP > 0:
    co = [mesh.data.vertices[i].co for i in head_v]
    c = sum(co, Vector()) / len(co)
    rx = max(abs(v.x - c.x) for v in co) or 1e-6
    ry = max(abs(v.y - c.y) for v in co) or 1e-6
    rz = max(abs(v.z - c.z) for v in co) or 1e-6
    ts = sorted((((v.x-c.x)/rx)**2 + ((v.y-c.y)/ry)**2 + ((v.z-c.z)/rz)**2) ** 0.5 for v in co)
    fq = ts[int(len(ts) * 0.88)]
    rx, ry, rz = rx * fq, ry * fq, rz * fq
    for i in head_v:
        v = mesh.data.vertices[i]; d = v.co - c
        t = ((d.x/rx)**2 + (d.y/ry)**2 + (d.z/rz)**2) ** 0.5
        if t > 1.0: v.co = c + d * (1.0 / t * CLAMP + (1 - CLAMP))
r1, a1 = rough(head_v), rough(arm_v)
print(f"顔 iter={FACE_IT} 腕 iter={ARM_IT} 押し込み={CLAMP}")
print(f"  顔の凹凸 {r0:.2f} → {r1:.2f}mm ({(1-r1/r0)*100:.0f}%減) / 腕 {a0:.2f} → {a1:.2f}mm ({(1-a1/a0)*100:.0f}%減)")
co = [mesh.matrix_world @ mesh.data.vertices[i].co for i in head_v]
print(f"  頭の幅 {max(c.x for c in co)-min(c.x for c in co):.4f}m / 高さ {max(c.z for c in co)-min(c.z for c in co):.4f}m")
if OUT:
    if DEC > 0:
        bpy.context.view_layer.objects.active = mesh
        d = mesh.modifiers.new("dec", 'DECIMATE'); d.ratio = DEC
        bpy.ops.object.modifier_apply(modifier=d.name)
    print(f"  三角形 {sum(len(p.vertices)-2 for p in mesh.data.polygons)}")
    for img in bpy.data.images:
        if img.size[0] > 1024: img.scale(1024, 1024)
    mesh.name = "bodyAll"
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                              export_skins=True, export_yup=True, export_animations=False)
    print("WROTE", os.path.basename(OUT), os.path.getsize(OUT)//1024, "KB")
