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

def key(im):
    im = im.astype(np.float32); d = 255 - im.min(axis=2)
    ink = d > 24
    lab, n = ndi.label(ink); sizes = ndi.sum(ink, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool); keep[1:] = sizes >= 8; ink = keep[lab]
    closed = ndi.binary_closing(ink, structure=disk(3))
    # fill only small enclosed holes (eyes, lantern panes, bone highlights); big gaps
    # such as the air between willow strands stay transparent
    holes = ndi.binary_fill_holes(closed) & ~closed
    hl, hn = ndi.label(holes)
    if hn:
        hs = ndi.sum(holes, hl, range(1, hn + 1)); small = np.zeros(hn + 1, bool); small[1:] = hs < 900
        fg = closed | small[hl]
    else:
        fg = closed
    inner = ndi.binary_erosion(fg, iterations=2)
    a0 = np.clip(d / 255.0, 0, 1)
    # paper-white inside a prop becomes a light veil rather than an opaque white patch
    alpha = np.where(inner, np.clip(0.62 + a0 * 4, 0, 1), np.where(fg, np.clip(a0 * 1.6, 0, 1), 0.0))
    safe = np.maximum(a0, 0.04)[..., None]
    unbl = np.clip((im - 255 * (1 - a0[..., None])) / safe, 0, 255)
    col = np.where(inner[..., None], im, unbl) * np.array([241, 235, 222], np.float32) / 255.0
    return np.dstack([col, alpha * 255]).astype(np.uint8)

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
            cell = sheet[gy * sh // 2:(gy + 1) * sh // 2, gx * sw // 3:(gx + 1) * sw // 3]
            rgba = key(cell)
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
