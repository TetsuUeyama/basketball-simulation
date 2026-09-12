# 頭を「切れ込みの無い一枚の面」に作り直す。
# ⚠️ 唇やまぶたの切れ込みは数mm。穴(境界辺)としては検出されず、深さの格子でも見えない。
#    ボクセルリメッシュなら、ボクセルより細い切れ込みは埋まる。
import bpy, bmesh, sys, os
from mathutils import Vector
A = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VOX = float(A[0]); SMOOTH_IT = int(A[1]); OUT = A[2] if len(A) > 2 else ""
DEC = float(A[3]) if len(A) > 3 else 0.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:/Users/user/Downloads/player-one/Spanish+footballer+FBX.FBX")
body = next(o for o in bpy.data.objects if o.type == 'MESH')
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
names = [ms.material.name.lower() if ms.material else "" for ms in body.material_slots]
# 目・まつげ・髪・頭皮を消す
kill = [i for i, n in enumerate(names) if any(k in n for k in ("eye","lash","hair","scalp"))]
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(body.data)
for f in bm.faces: f.select = f.material_index in kill
bmesh.update_edit_mesh(body.data); bpy.ops.mesh.delete(type='FACE')
# 頭（世界座標 z>1.55）を切り出す
bpy.ops.mesh.select_all(action='DESELECT')
bm = bmesh.from_edit_mesh(body.data)
mw = body.matrix_world
for f in bm.faces: f.select = (mw @ f.calc_center_median()).z > 1.55
bmesh.update_edit_mesh(body.data)
bpy.ops.mesh.separate(type='SELECTED')
bpy.ops.object.mode_set(mode='OBJECT')
head = [o for o in bpy.data.objects if o.type == 'MESH' and o is not body][0]
head.name = "headpart"
def slit(o, tag):
    """顔の前から 1mm 刻みで光線を当て、隣どうしで最初に当たる深さが急に変わる所を探す。
       ⚠️ 切れ込み（唇・まぶた）はここで出る。境界辺でも深さの粗い格子でも検出できない。"""
    import mathutils
    mwi = o.matrix_world.inverted()
    sc = o.matrix_world.to_scale().x
    # ⚠️ 顔の内側だけを見る。輪郭の縁は深さが急に変わって当たり前なので、
    #    そこまで入れると切れ込みと区別できない。
    xs = [i for i in range(-40, 41)]        # -4cm〜+4cm を 1mm 刻み
    zs = [1.60 + k * 0.001 for k in range(0, 131)]   # 1.60〜1.73m
    depth = {}
    for ix in xs:
        for iz, z in enumerate(zs):
            org = mwi @ mathutils.Vector((ix * 0.001, -0.5, z))
            dr = (mwi.to_3x3() @ mathutils.Vector((0, 1, 0))).normalized()
            ok, loc, _, _ = o.ray_cast(org, dr)
            if ok: depth[(ix, iz)] = ((loc - org).length * sc)
    jumps = []; worst = (0, 0, 0)
    for (ix, iz), d in depth.items():
        for nb in ((ix+1, iz), (ix, iz+1)):
            if nb in depth:
                j = abs(depth[nb] - d); jumps.append(j)
                if j > worst[0]: worst = (j, ix, iz)
    jumps.sort()
    big = sum(1 for j in jumps if j > 0.004)
    print(f"  {tag}: 当たった点 {len(depth)} / 段差4mm超 {big} 箇所 / 最大 {(jumps[-1]*1000 if jumps else 0):.1f}mm"
          f" (x {worst[1]}mm, y {1.60 + worst[2]*0.001:.3f}m)")
    return big

def interior(o, tag):
    """顔の前面で、一番前の面より 5mm 以上奥にある面の数（口の中・まぶたの奥）。"""
    mwo = o.matrix_world
    cells = {}
    faces = []
    for f in o.data.polygons:
        c = mwo @ f.center
        if c.z < 1.58 or c.z > 1.76 or c.y >= 0: continue
        k = (round(c.x * 200), round(c.z * 200))    # 5mm 格子
        cells[k] = min(cells.get(k, 1e9), c.y)      # -Y が前 → 最小が一番前
        faces.append((k, c.y))
    n = sum(1 for k, y in faces if y > cells[k] + 0.005)
    print(f"  {tag}: 顔の面 {len(faces)} 枚 / 奥に隠れている面 {n} 枚")
    return n
interior(head, "リメッシュ前"); slit(head, "リメッシュ前")
# ⚠️ 切り出した頭は下（首）が開いた殻。開いたままリメッシュすると殻の裏面が残り、
#    「奥に隠れた面」として数えられてしまう。先に首を塞いで中身のある形にする。
bmh = bmesh.new(); bmh.from_mesh(head.data)
open_e = [e for e in bmh.edges if len(e.link_faces) == 1]
if open_e:
    bmesh.ops.holes_fill(bmh, edges=open_e, sides=2000)
left = sum(1 for e in bmh.edges if len(e.link_faces) == 1)
bmh.to_mesh(head.data); bmh.free(); head.data.update()
print(f"  首を塞ぐ: 開いた辺 {len(open_e)} → {left} 本")
# ボクセルリメッシュ
bpy.context.view_layer.objects.active = head
m = head.modifiers.new("re", 'REMESH')
# ⚠️ voxel_size は**オブジェクトのローカル単位**。この FBX はスケール 0.01 なので、
# ワールドで 6mm にしたければ 0.6 を渡す。ワールド値をそのまま渡すと 0.06mm 相当になり、
# 三角形が 132 万枚に爆発する（実測）。
m.mode = 'VOXEL'; m.voxel_size = VOX / head.matrix_world.to_scale().x; m.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier=m.name)
print(f"  リメッシュ(ボクセル {VOX*1000:.0f}mm) → 三角形 {len(head.data.polygons)}")
interior(head, "リメッシュ後"); slit(head, "リメッシュ後")
# ⚠️ リメッシュで頂点ウェイトが消える。元のメッシュから最近傍で移す。
for vg in body.vertex_groups:
    if vg.name not in head.vertex_groups: head.vertex_groups.new(name=vg.name)
bpy.ops.object.select_all(action='DESELECT')
head.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = head
# ⚠️ ウェイトは演算子(data_transfer)ではなく自前で移す。Blender の版で引数名が変わり
#    使えなかった。元のメッシュの最近傍の頂点から、そのままコピーする。
from mathutils import kdtree
kd = kdtree.KDTree(len(body.data.vertices))
for _i, _v in enumerate(body.data.vertices):
    kd.insert(_v.co, _i)
kd.balance()
gname = [g.name for g in body.vertex_groups]
for hv in head.data.vertices:
    _co, _idx, _d = kd.find(hv.co)
    for g in body.data.vertices[_idx].groups:
        head.vertex_groups[gname[g.group]].add([hv.index], g.weight, "REPLACE")
w = [v for v in head.data.vertices if any(g.weight > 0.01 for g in v.groups)]
print(f"  ウェイトが入った頂点 {len(w)} / {len(head.data.vertices)}")
# 均す
if SMOOTH_IT > 0:
    bpy.context.view_layer.objects.active = head
    sm = head.modifiers.new("s", 'SMOOTH'); sm.factor = 1.0; sm.iterations = SMOOTH_IT
    bpy.ops.object.modifier_apply(modifier=sm.name)
# 単色マテリアルを付ける
mat = bpy.data.materials.new("skin"); mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs["Base Color"].default_value = (0.80, 0.62, 0.50, 1.0)
bsdf.inputs["Roughness"].default_value = 0.9
head.data.materials.clear(); head.data.materials.append(mat)
# 体側も肌を単色に
for mm in bpy.data.materials:
    if mm.name.lower() in ("torso", "arms legs", "face"):
        mm.use_nodes = True
        nt = mm.node_tree
        b2 = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not b2: continue
        for lk in list(nt.links):
            if lk.to_node == b2 and lk.to_socket.name == "Base Color": nt.links.remove(lk)
        b2.inputs["Base Color"].default_value = (0.80, 0.62, 0.50, 1.0)
        for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']: nt.nodes.remove(n)
# 合体
bpy.ops.object.select_all(action='DESELECT')
head.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "bodyAll"
if DEC > 0:
    bpy.context.view_layer.objects.active = body
    d = body.modifiers.new("dec", 'DECIMATE'); d.ratio = DEC
    bpy.ops.object.modifier_apply(modifier=d.name)
print(f"  合体後 三角形 {sum(len(p.vertices)-2 for p in body.data.polygons)}")
if OUT:
    for img in bpy.data.images:
        if img.size[0] > 1024: img.scale(1024, 1024)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                              export_skins=True, export_yup=True, export_animations=False)
    print("WROTE", os.path.basename(OUT), os.path.getsize(OUT)//1024, "KB")
