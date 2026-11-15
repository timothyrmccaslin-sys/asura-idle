// Painted sumi-e art: loads the webp atlases (hand-painted ink figures keyed
// onto transparency) and caches every frame pre-scaled to its on-screen size,
// so the per-frame cost is a plain 1:1 drawImage.
const BASE = new URL('./assets/art/', import.meta.url).href;

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('art: ' + src));
    i.src = src;
  });
}

export async function loadArt() {
  const meta = await (await fetch(BASE + 'atlas.json')).json();
  const [asura, foes, fx, daeva, sorcerer] = await Promise.all([meta.asura, meta.foes, meta.fx, meta.daeva, meta.sorcerer].map((m) => (m ? loadImg(BASE + m.file) : null)));
  return { meta, img: { asura, foes, fx, daeva, sorcerer } };
}

// high quality downscale: halve step by step, then a final resample
function scaled(img, sx, sy, sw, sh, dw, dh) {
  let src = img, x = sx, y = sy, w = sw, h = sh;
  while (w / 2 > dw * 1.05 && h / 2 > dh * 1.05) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w / 2)); c.height = Math.max(1, Math.round(h / 2));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    src = c; x = 0; y = 0; w = c.width; h = c.height;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(dw)); c.height = Math.max(1, Math.round(dh));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

export function tinted(c, color, mode = 'source-in', alpha = 1) {
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0);
  g.globalCompositeOperation = mode; g.globalAlpha = alpha; g.fillStyle = color; g.fillRect(0, 0, o.width, o.height);
  return o;
}

// One cached, scaled frame. k = output px per atlas px.
export function makeFrame(art, sheet, name, k) {
  const m = art.meta[sheet].frames[name];
  if (!m) return null;
  const w = m.w * k, h = m.h * k;
  const c = scaled(art.img[sheet], m.x, m.y, m.w, m.h, w, h);
  const kx = c.width / m.w, ky = c.height / m.h;
  const pt = (p) => (p ? [p[0] * kx, p[1] * ky] : null);
  return { c, w: c.width, h: c.height, ax: m.ax * kx, ay: m.ay * ky, sash: pt(m.sash), beads: pt(m.beads), head: pt(m.head), flash: null, red: null };
}

export function flashOf(fr) {
  return fr.flash || (fr.flash = tinted(fr.c, 'rgba(246,241,231,.86)', 'source-atop'));
}
export function redOf(fr) {
  return fr.red || (fr.red = tinted(fr.c, 'rgba(179,32,42,1)', 'source-in'));
}
// the Daeva's accent: an inky ultramarine
export const BLUE = '#2f6bff';
export function blueOf(fr) {
  return fr.blue || (fr.blue = tinted(fr.c, 'rgba(38,92,224,1)', 'source-in'));
}

// the Sorcerer's accent: a deep violet ink
export const PURPLE = '#7a3fd0';
export function purpleOf(fr) {
  return fr.purple || (fr.purple = tinted(fr.c, 'rgba(122,63,208,1)', 'source-in'));
}

// Unwrap the painted enso (a ring) into a straight dry-brush strip, so a trail
// can bend it along any ellipse with uniform thickness: natural tapered ends,
// bristle streaks along the stroke.
export function unwrapRing(c, cx, cy, r, rIn, rOut, a0, a1) {
  const g = c.getContext('2d');
  const src = g.getImageData(0, 0, c.width, c.height).data;
  const L = Math.round(r * (a1 - a0)), Hs = Math.round(rOut - rIn);
  const o = document.createElement('canvas'); o.width = L; o.height = Hs;
  const og = o.getContext('2d'), id = og.createImageData(L, Hs), d = id.data;
  for (let x = 0; x < L; x++) {
    const a = a0 + (x / L) * (a1 - a0), ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < Hs; y++) {
      const rr = rOut - y;
      const sx = Math.round(cx + ca * rr), sy = Math.round(cy + sa * rr);
      if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) continue;
      const si = (sy * c.width + sx) * 4, di = (y * L + x) * 4;
      d[di] = src[si]; d[di + 1] = src[si + 1]; d[di + 2] = src[si + 2]; d[di + 3] = src[si + 3];
    }
  }
  og.putImageData(id, 0, 0);
  return o;
}
