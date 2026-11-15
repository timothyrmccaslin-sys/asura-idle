# Builds the themed stage art: painted backgrounds (upscaled, centre lifted toward
# paper so fighters stay readable) and per-theme prop atlases keyed off white paper.
# Usage: python3 tools/build_themes.py <dir with bg_<theme>.jpg and props_<theme>.jpg (3x2 grid)>
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
SRC = sys.argv[1] if len(sys.argv) > 1 else 'theme-src'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'themes')
os.makedirs(OUT, exist_ok=True)
THEMES = ['oni', 'tengu', 'shogun', 'orochi', 'onryo']
PAPER = np.array([236, 230, 216], np.float32)
LIFT = {'oni': (0.42, 0.0), 'tengu': (0.3, 0.0), 'shogun': (0.3, 0.0), 'orochi': (0.4, 0.05), 'onryo': (0.5, 0.18)}

def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]; return x * x + y * y <= r * r

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keying import key_array, drop_paper

# props whose enclosed white areas are painted (banner cloth, plaster wall), not paper
PAINTED_WHITE = {('shogun', 1), ('shogun', 5)}
# props left out of the scatter pools entirely (the small torii gates read wrong next
# to the big painted torii in the plates; v3.2.3)
DROP = {('oni', 0), ('onryo', 5)}

def key(im, painted_white=False):
    # same keying as the characters: enclosed paper gaps (between willow strands,
    # torii posts, grass) are keyed out, edges are un-blended from the paper and
    # the alpha is eroded and feathered, so props carry no white veil or halo
    rgba = key_array(im)
    if painted_white:
        src = np.asarray(im).astype(np.float32)
        sil = ndi.binary_fill_holes(ndi.binary_closing(rgba[..., 3] > 128, structure=disk(4)))
        sil = ndi.binary_erosion(sil, iterations=2)
        a = np.maximum(rgba[..., 3], sil * 255)
        col = np.where((sil & (rgba[..., 3] < 250))[..., None], src * np.array([241, 235, 222]) / 255.0, rgba[..., :3])
        rgba = np.dstack([col, a]).clip(0, 255).astype(np.uint8)
        return drop_paper(rgba, im, strength=0.0)
    return drop_paper(rgba, im)

meta = {}
for t in THEMES:
    # ---- background
    bg = Image.open(f'{SRC}/bg_{t}.jpg').convert('RGB')
    bg = bg.resize((1536, 864), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    a = np.asarray(bg).astype(np.float32)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    # elliptical lift centred on the ground plane, plus a global lift for dark scenes
    cxn, cyn = W * 0.5, H * 0.6
    r = np.sqrt(((xx - cxn) / (W * 0.42)) ** 2 + ((yy - cyn) / (H * 0.42)) ** 2)
    k_c, k_g = LIFT[t]
    w = np.clip(1 - r, 0, 1) ** 1.5 * k_c + k_g
    a = a * (1 - w[..., None]) + PAPER * w[..., None]
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(f'{OUT}/{t}-bg.webp', 'WEBP', quality=72, method=6)
    # ---- props: 3x2 grid, keyed and cropped
    sheet = np.asarray(Image.open(f'{SRC}/props_{t}.jpg').convert('RGB'))
    sh, sw = sheet.shape[:2]
    frames = []
    for gy in range(2):
        for gx in range(3):
            if (t, gy * 3 + gx) in DROP: continue
            cell = sheet[gy * sh // 2:(gy + 1) * sh // 2, gx * sw // 3:(gx + 1) * sw // 3]
            rgba = key(cell, (t, gy * 3 + gx) in PAINTED_WHITE)
            al = rgba[..., 3]
            # keep only the biggest blob cluster (drop stray specks from neighbours)
            m = ndi.binary_dilation(al > 20, iterations=6)
            lab, n = ndi.label(m)
            if n > 1:
                sizes = ndi.sum(m, lab, range(1, n + 1)); big = 1 + int(np.argmax(sizes))
                rgba[..., 3] = np.where(lab == big, al, 0)
            ys, xs = np.where(rgba[..., 3] > 10)
            crop = Image.fromarray(rgba).crop((xs.min() - 2, ys.min() - 2, xs.max() + 3, ys.max() + 3))
            s = 240 / max(crop.size)
            crop = crop.resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))), Image.LANCZOS)
            frames.append(crop)
    x = 0; atlas = Image.new('RGBA', (sum(f.width + 2 for f in frames), max(f.height for f in frames)), (0, 0, 0, 0))
    rects = []
    for f in frames:
        atlas.paste(f, (x, 0)); al = np.asarray(f)[..., 3] > 128
        rows = np.where(al.sum(axis=1) > 2)[0]
        rects.append({'x': x, 'y': 0, 'w': f.width, 'h': f.height, 'ay': int(rows.max()) if len(rows) else f.height})
        x += f.width + 2
    atlas.save(f'{OUT}/{t}-props.webp', 'WEBP', quality=84, method=6, alpha_quality=88)
    meta[t] = {'bg': f'{t}-bg.webp', 'props': f'{t}-props.webp', 'frames': rects}
json.dump(meta, open(f'{OUT}/themes.json', 'w'), indent=1)
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(f'{OUT}/{f}') // 1024, 'KB')
