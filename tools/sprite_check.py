# Contact sheet of every painted sprite composited over dark, red and mid-grey,
# to catch leftover paper (white splotches) and halos after keying.
# Usage: python3 tools/sprite_check.py <out.png> [art dir]
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]; d = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'art')
meta = json.load(open(os.path.join(d, 'atlas.json')))
BG = [(28, 26, 30), (150, 26, 34), (128, 128, 128)]
try: font = ImageFont.truetype('DejaVuSans-Bold.ttf', 16)
except Exception: font = ImageFont.load_default()
cells = []
for sheet in [s for s in ('asura', 'daeva', 'sorcerer', 'foes') if s in meta]:
    atlas = Image.open(os.path.join(d, meta[sheet]['file'])).convert('RGBA')
    for name, f in sorted(meta[sheet]['frames'].items(), key=lambda kv: (len(kv[0]), kv[0])):
        spr = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        k = 300 / max(spr.size); spr = spr.resize((max(1, round(spr.width * k)), max(1, round(spr.height * k))), Image.LANCZOS)
        row = Image.new('RGB', (3 * 310, 330), (240, 236, 228))
        for i, c in enumerate(BG):
            b = Image.new('RGBA', (310, 310), c + (255,)); b.alpha_composite(spr, ((310 - spr.width) // 2, 310 - spr.height - 5))
            row.paste(b.convert('RGB'), (i * 310, 20))
        ImageDraw.Draw(row).text((4, 1), name, font=font, fill=(0, 0, 0))
        cells.append(row)
cols = 3
W = cols * (930 + 10); rows = (len(cells) + cols - 1) // cols
M = Image.new('RGB', (W, rows * 340), (255, 255, 255))
for i, c in enumerate(cells): M.paste(c, ((i % cols) * 940, (i // cols) * 340))
M.save(out); print(out, M.size, len(cells))
