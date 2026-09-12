# 髪を書き出す。⚠️ 基準点は「上から20%の帯の中心(x,y) と 上端(z)」で統一する。
#    bbox の下端や中心を使うと、長い髪ほど下へ引っ張られて髪型ごとに基準がずれる。
#    倍率も**全髪型で共通**の1つだけ使う（大きさの差は髪型本来の差なので残す）。
import bpy, os, sys, statistics as st
A = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUTDIR = A[0]; RATIO = float(A[1]) if len(A) > 1 else 1.0; SUF = A[2] if len(A) > 2 else ""
PICK = ["Man_Hair_001","Man_Hair_010","Man_Hair_030","Man_Hair_050",
        "Man_Hair_070","Man_Hair_090","Man_Hair_110","Man_Hair_130"]
# ⚠️ 実際の頭の幅に合わせること。ずれると髪だけ小さく/大きく見える。
# のっぺらぼう素体の頭の最大幅は実測 15.7cm（y=1.68m）。髪はそれを覆うので少し大きめの 15.8cm。
HEAD_W = 0.158   # 頭の幅の目安(m)。帯の幅の中央値をここへ合わせる
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:/Users/user/Downloads/hair/Man_Hair_Collection_fbx/Man_Hair_Collection.fbx")
keep = []
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True); continue
    if o.name in PICK: keep.append(o)
    else: bpy.data.objects.remove(o, do_unlink=True)
def cap(o):
    co = [o.matrix_world @ v.co for v in o.data.vertices]
    zs = [c.z for c in co]; top = max(zs); lo = min(zs)
    band = [c for c in co if c.z >= top - (top - lo) * 0.20]
    cx = (max(c.x for c in band) + min(c.x for c in band)) / 2
    cy = (max(c.y for c in band) + min(c.y for c in band)) / 2
    return cx, cy, top, max(c.x for c in band) - min(c.x for c in band)
widths = [cap(o)[3] for o in keep]
K = HEAD_W / st.median(widths)      # 全髪型で共通の倍率
print(f"帯の幅 中央 {st.median(widths):.3f} → 共通倍率 {K:.4f}")
for o in keep:
    cx, cy, top, w = cap(o)
    # 基準点（帯の中心・上端）を原点へ持ってくる
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        v.co = ((p.x - cx) * K, (p.y - cy) * K, (p.z - top) * K)
    o.matrix_world.identity()
    o.scale = (1, 1, 1); o.location = (0, 0, 0)
    co = [v.co for v in o.data.vertices]
    print(f"  {o.name:16} 幅 {max(c.x for c in co)-min(c.x for c in co):.3f}m"
          f" 高 {max(c.z for c in co)-min(c.z for c in co):.3f}m"
          f" 上端 {max(c.z for c in co):+.4f}")
for img in bpy.data.images:
    if img.size[0] > 512: img.scale(512, 512)
if RATIO < 1.0:
    for o in keep:
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = RATIO
        bpy.ops.object.modifier_apply(modifier=m.name)
tri = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in keep)
path = os.path.join(OUTDIR, f"hair{SUF}.glb")
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                          export_yup=True, export_animations=False)
print(f"WROTE {os.path.basename(path)} {os.path.getsize(path)//1024}KB 三角形計 {tri} / 1つ平均 {tri//len(keep)}")
