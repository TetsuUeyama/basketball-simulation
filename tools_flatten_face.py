# のっぺらぼう化。穴は「平らな蓋」ではなく**周囲の顔と段差なく繋ぐ**。
#  1) 目・まつげを消す → 2) 頂点集合を作る（⚠️ 消した後に）
#  3) 穴を塞ぐ → 4) 蓋を細分して周囲と一緒に均す（段差取り）
#  5) 頭と腕を平滑化 → 6) 鼻・耳の押し込み
import bpy, bmesh, sys, os, math
from mathutils import Vector
A = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FACE_IT, ARM_IT, CLAMP = int(A[0]), int(A[1]), float(A[2])
BLEND = int(A[3]) if len(A) > 3 else 30      # 段差取りの回数
OUT = A[4] if len(A) > 4 else ""
DEC = float(A[5]) if len(A) > 5 else 0.0
FLAT_SKIN = (len(A) > 6 and A[6] == "1")   # 1 なら腕・胴の肌も単色にする
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:/Users/user/Downloads/player-one/Spanish+footballer+FBX.FBX")
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
S = mesh.matrix_world.to_scale().x
names = [ms.material.name.lower() if ms.material else "" for ms in mesh.material_slots]
eye_i = [i for i, n in enumerate(names)
          if "eye" in n or "lash" in n or "hair" in n or "scalp" in n]
if eye_i:
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(mesh.data)
    for f in bm.faces: f.select = f.material_index in eye_i
    bmesh.update_edit_mesh(mesh.data)
    bpy.ops.mesh.delete(type='FACE')
    bpy.ops.object.mode_set(mode='OBJECT')
def group(keys, exclude=()):
    gi = [g.index for g in mesh.vertex_groups
          if any(k in g.name for k in keys) and not any(x in g.name for x in exclude)]
    return {v.index for v in mesh.data.vertices
            for g in v.groups if g.group in gi and g.weight > 0.5}
head_v = group(("Head",)); arm_v = group(("Arm", "ForeArm"), ("Shoulder",))

def rough(idxs):
    bm = bmesh.new(); bm.from_mesh(mesh.data); bm.verts.ensure_lookup_table()
    t = 0.0; n = 0
    for i in idxs:
        if i >= len(bm.verts): continue
        v = bm.verts[i]; lk = [e.other_vert(v).co for e in v.link_edges]
        if not lk: continue
        t += (v.co - sum(lk, Vector()) / len(lk)).length; n += 1
    bm.free(); return t / n * S * 1000 if n else 0.0
def crease(centres, r=0.028):
    """段差の指標: 指定した点のまわりで、辺を挟む2面のなす角(度)の95%点。
       段差や折れ目があると大きくなる。滑らかに繋がれば小さくなる。"""
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    out = []
    for e in bm.edges:
        if len(e.link_faces) != 2: continue
        p = (e.verts[0].co + e.verts[1].co) / 2
        if not any((p - c).length * S < r for c in centres): continue
        a, b = e.link_faces[0].normal, e.link_faces[1].normal
        d = max(-1.0, min(1.0, a.dot(b)))
        out.append(math.degrees(math.acos(d)))
    bm.free()
    out.sort()
    if not out: return (0.0, 0.0, 0)
    return out[len(out)//2], out[int(len(out)*0.95)], len(out)

def fill_and_blend(vset, blend):
    bm = bmesh.new(); bm.from_mesh(mesh.data); bm.verts.ensure_lookup_table()
    edges = [e for e in bm.edges if len(e.link_faces) == 1
             and all(v.index in vset for v in e.verts)]
    rest = set(edges); loops = []
    while rest:
        e0 = rest.pop(); lp = [e0]; st = [e0]
        while st:
            e = st.pop()
            for v in e.verts:
                for e2 in v.link_edges:
                    if e2 in rest: rest.discard(e2); lp.append(e2); st.append(e2)
        loops.append(lp)
    co = [mesh.data.vertices[i].co for i in vset]
    c = sum(co, Vector()) / len(co)
    picked, centres = [], []
    for lp in loops:
        vs = {v for e in lp for v in e.verts}
        pts = [v.co for v in vs]
        size = max((max(p[k] for p in pts) - min(p[k] for p in pts)) for k in range(3)) * S
        if size < 0.30:
            picked.append(lp); centres.append(sum(pts, Vector()) / len(pts))
    made = []
    for lp in picked:
        made += bmesh.ops.holes_fill(bm, edges=lp, sides=200).get("faces", [])
    if made:
        bmesh.ops.triangulate(bm, faces=[f for f in made if f.is_valid and len(f.verts) > 3])
        # ⚠️ 蓋は頂点が少なく平らなので、そのままだと縁に折れ目が残る。
        #    細分してから、蓋と**その周りごと**動かして段差を均す。
        cap_e = list({e for f in made if f.is_valid for e in f.edges})
        if cap_e:
            bmesh.ops.subdivide_edges(bm, edges=cap_e, cuts=2, use_grid_fill=True)
        bm.verts.ensure_lookup_table()
        # 段差取り: 蓋のまわり半径 r 内を、周囲を固定したまま Laplacian で均す
        zone = [v for v in bm.verts
                if any((v.co - ct).length * S < 0.030 for ct in centres)]
        edgeset = {v.index for v in zone}
        for _ in range(blend):
            new = {}
            for v in zone:
                lk = [e.other_vert(v) for e in v.link_edges]
                if not lk: continue
                inner = sum(1 for o in lk if o.index in edgeset)
                if inner == len(lk):        # 完全に内側 → よく動かす
                    w = 1.0
                elif inner == 0:            # 外側 → 動かさない
                    continue
                else:                        # 境目 → 半分
                    w = 0.5
                avg = sum((o.co for o in lk), Vector()) / len(lk)
                new[v] = v.co.lerp(avg, w)
            for v, p in new.items(): v.co = p
    bm.to_mesh(mesh.data); bm.free(); mesh.data.update()
    return len(picked), centres
r0, a0 = rough(head_v), rough(arm_v)
np_, centres = fill_and_blend(head_v, BLEND)
c1m, c1, n1 = crease(centres)
# ⚠️ 穴ふさぎで**頂点が増える**（細分）ので、頂点集合を作り直す。
#    作り直さないと、増えた頂点が平滑化の対象から外れて段差が残る
#    （実測: 段差取りをしたのに折れ目が 51.2° → 63.8° と悪化した）。
head_v = group(("Head",)); arm_v = group(("Arm", "ForeArm"), ("Shoulder",))
def smooth(vset, name, it):
    vg = mesh.vertex_groups.new(name=name); vg.add(list(vset), 1.0, 'REPLACE')
    bpy.context.view_layer.objects.active = mesh
    m = mesh.modifiers.new(name, 'SMOOTH'); m.factor = 1.0; m.iterations = it; m.vertex_group = name
    bpy.ops.object.modifier_apply(modifier=m.name)
smooth(head_v, "fFace", FACE_IT); smooth(arm_v, "fArm", ARM_IT)
if CLAMP > 0:
    co = [mesh.data.vertices[i].co for i in head_v]
    c = sum(co, Vector()) / len(co)
    rx = max(abs(v.x-c.x) for v in co) or 1e-6
    ry = max(abs(v.y-c.y) for v in co) or 1e-6
    rz = max(abs(v.z-c.z) for v in co) or 1e-6
    ts = sorted((((v.x-c.x)/rx)**2 + ((v.y-c.y)/ry)**2 + ((v.z-c.z)/rz)**2)**0.5 for v in co)
    fq = ts[int(len(ts)*0.88)]; rx, ry, rz = rx*fq, ry*fq, rz*fq
    for i in head_v:
        v = mesh.data.vertices[i]; d = v.co - c
        t = ((d.x/rx)**2 + (d.y/ry)**2 + (d.z/rz)**2)**0.5
        if t > 1.0: v.co = c + d * (1.0/t*CLAMP + (1-CLAMP))
c2m, c2, _ = crease(centres)
def left_holes(vset):
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    n = sum(1 for e in bm.edges if len(e.link_faces) == 1
            and all(v.index in vset for v in e.verts))
    bm.free(); return n
print(f"塞いだ穴 {np_} 個 / 段差取り {BLEND} 回 / 頭に残った穴の縁 {left_holes(head_v)} 本")
print(f"  穴まわりの折れ目 中央 {c1m:.1f}°→{c2m:.1f}° / 95%点 {c1:.1f}°→{c2:.1f}°（{n1} 辺）")
print(f"  顔の凹凸 {r0:.2f} → {rough(head_v):.2f}mm / 腕 {a0:.2f} → {rough(arm_v):.2f}mm")
def flatten_materials(flat_skin):
    """⚠️ のっぺらぼうの本体はここ。目・眉・口は **Face.jpg に描かれている**ので、
       形をいくら均しても消えない。顔（と肌）のマテリアルから画像を外し、
       髪と同じ「素の単色」にする。"""
    import mathutils
    SKIN = (0.80, 0.62, 0.50, 1.0)
    targets = ("face",) + (("torso", "arms legs") if flat_skin else ())
    done = []
    for m in bpy.data.materials:
        if m.name.lower() not in targets: continue
        m.use_nodes = True
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf: continue
        # 画像へ繋がっている線を切って、単色に置き換える
        for link in list(nt.links):
            if link.to_node == bsdf and link.to_socket.name in ("Base Color", "Specular IOR Level"):
                nt.links.remove(link)
        bsdf.inputs["Base Color"].default_value = SKIN
        if "Roughness" in bsdf.inputs: bsdf.inputs["Roughness"].default_value = 0.9
        for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']:
            nt.nodes.remove(n)
        done.append(m.name)
    print(f"  単色にしたマテリアル: {done}")

if OUT:
    flatten_materials(FLAT_SKIN)
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
