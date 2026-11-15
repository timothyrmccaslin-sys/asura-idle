// Ground-plane perspective. Gameplay stays radial in world units (Rust is
// unchanged); this maps a world point (x, y) on the ground to the screen with a
// pinhole camera tilted down at the painted scene:
//   s(y) = D0 / (D0 - y)        depth scale (1 at the Asura, <1 toward the horizon)
//   X = cx + x * gs * s         Y = yH + (cy - yH) * s
// so every ground line converges on the scene's horizon yH. Each theme stores
// the horizon (as a fraction of its painting's height) and the ground's
// foreshortening q at the Asura's feet (ring aspect), measured from the art.
export const PERSP = {
  oni: { hz: 0.24, q: 0.38 },     // flat ash plain, low distant horizon
  tengu: { hz: 0.34, q: 0.36 },   // mist valley line behind the clearing
  shogun: { hz: 0.31, q: 0.42 },  // raked courtyard seen from higher up
  orochi: { hz: 0.24, q: 0.34 },  // wide flat delta, very low horizon
  onryo: { hz: 0.35, q: 0.36 },   // shrine precinct
  none: { hz: 0.26, q: 0.40 },    // procedural fallback while art loads
};
export const ZOOM = 1.06;   // backdrop cover-fit zoom (fixed so the horizon is known)
const D_TARGET = 1.9;       // camera distance in world units: near/far scale ratio
export const S_MIN = 0.62, S_MAX = 1.5; // sprite scale clamp at the far and near edges

// where the painting lands (shared with the stage bake so the horizon is exact)
export function fitImage(v, iw, ih) {
  const s = Math.max(v.W / iw, v.H / ih) * ZOOM;
  const oy = Math.min(0, Math.max(v.H - ih * s, v.cy - ih * s * 0.6));
  return { s, oy, ih: ih * s };
}
export function horizonFor(v, hz, iw = 1536, ih = 864) {
  const f = fitImage(v, iw, ih);
  return f.oy + hz * f.ih;
}
export function makeCam(v, hzY, q) {
  const dy = Math.max(v.H * 0.1, v.cy - hzY);
  let gs = dy / (q * D_TARGET);
  gs = Math.min(v.scale * 0.95, Math.max(v.scale * 0.68, gs));
  const D0 = Math.max(1.45, dy / (q * gs));
  return { cx: v.cx, cy: v.cy, gs, D0, q, yH: v.cy - D0 * q * gs, H: v.H };
}
export function lerpCam(a, b, t) {
  if (!a) return b;
  const m = (k) => a[k] + (b[k] - a[k]) * t;
  return { cx: b.cx, cy: b.cy, gs: m('gs'), D0: m('D0'), q: m('q'), yH: m('yH'), H: b.H };
}
// depth scale for world y (y > 0 is toward the camera)
export function depth(c, y) { return c.D0 / (c.D0 - Math.min(y, c.D0 * 0.8)); }
export function px(c, x, y) { return c.cx + x * c.gs * depth(c, y); }
export function py(c, y) { return c.yH + (c.cy - c.yH) * depth(c, y); }
export function size(c, y) { return Math.min(S_MAX, Math.max(S_MIN, depth(c, y))); }
// local ground aspect (vertical / horizontal) at depth y
export function aspect(c, y) { return c.q * depth(c, y); }
// screen -> world on the ground plane (null above the horizon)
export function unproject(c, X, Y) {
  const s = (Y - c.yH) / (c.cy - c.yH);
  if (s <= 0.05) return null;
  return { x: (X - c.cx) / (c.gs * s), y: c.D0 * (1 - 1 / s), s };
}
// projected circle of radius r around the ground point (0, y0): centre, radii
export function circleBox(c, r, y0 = 0) {
  const top = py(c, y0 - r), bot = py(c, y0 + r);
  let w = 0;
  for (let i = 0; i <= 12; i++) { const yy = -r + (2 * r * i) / 12; w = Math.max(w, Math.sqrt(Math.max(0, r * r - yy * yy)) * c.gs * depth(c, y0 + yy)); }
  return { cy: (top + bot) / 2, rx: w, ry: (bot - top) / 2 };
}
