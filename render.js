import { drawFigure, drawAsura as drawAsuraFig, brush } from './figures.js';
import { loadArt, makeFrame, flashOf as paintedFlash, tinted, unwrapRing, blueOf } from './art.js';
import { createAsura } from './asura.js';
import { DAEVA_MOVES, daevaPick, createWater } from './daeva.js';
import { createStage } from './stage.js';
import { createPowers } from './powers.js';
import { createFoeRig } from './foes.js';
import { PERSP, horizonFor, makeCam, px as camX, py as camY, size as camSize, aspect as camAspect, circleBox } from './cam.js';
// Ink renderer — draws the state exported by the Rust/wasm core onto a canvas
// in a sumi-e style. Pure presentation: no game rules live here.

const INK = '#161412';
const INK2 = '#2b2825';
const GREY = '#4d4842';
const WASH = '#8a8277';
const PAPER = '#ece6d8';
const RED = '#b3202a';
const RED2 = '#d23a3a';
const SQ = 0.8; // vertical squash: the ground is seen from slightly above

const EV = { HIT: 1, KILL: 2, ATTACK: 3, WRATH: 4, CHAIN: 5, HURT: 6, WAVE: 7, DEFEAT: 8, BOSS: 9, HEAL: 10, CAST: 11, TIDE: 12, DROP: 13, UNLOCK: 14, SWITCH: 15, POOL: 16 };
const BLUE_INK = '#2f6bff';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fmt(n) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0; n = Math.abs(n);
  let s;
  if (n < 1000) s = n < 10 && n % 1 > 0.05 ? n.toFixed(1) : Math.floor(n).toString();
  else {
    const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    const e = Math.floor(Math.log10(n) / 3);
    if (e < units.length) {
      const v = n / Math.pow(1000, e);
      s = (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + units[e];
    } else s = n.toExponential(2).replace('e+', 'e');
  }
  return (neg ? '-' : '') + s;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, scale = 1, cx = 0, cy = 0;
  let bg = null, far = null, near = null, grain = null;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let numbersOn = true;
  const parts = [];   // ink particles
  const decals = [];  // splatters left on the ground
  const texts = [];   // floating numbers
  const slashes = []; // brush slash marks
  const bolts = [];   // lightning
  const rings = [];   // shockwaves
  const corpses = []; // dissolving foes
  const swipes = [];  // Asura's strike arcs
  const wisps = [];   // ink smoke off the Asura
  let shake = 0, hurtFlash = 0, healFlash = 0, time = 0;
  // painted art (falls back to the procedural figures until the atlases load)
  let art = null, artCache = new Map();
  const animA = createAsura();
  // the Daeva: same animator, her own fluid move set, blue brush arcs and beads
  const animD = createAsura({
    moves: DAEVA_MOVES, pick: daevaPick, trailAll: true, bead: '#2f6bff',
    ribbon: ['rgba(40,92,220,.9)', 'rgba(28,66,180,.85)', 'rgba(22,20,18,.9)', 'rgba(22,20,18,.85)', 'rgba(30,27,24,.7)'],
    tint: blueOf,
  });
  let anim = animA, charId = 0;
  const stage = createStage();
  const powersA = createPowers();
  const powersD = createPowers({ blue: true });
  let powers = powersA;
  const water = createWater();
  const rig = createFoeRig({ frame: (k) => (art ? foeFrame(k) : null), flashOf: paintedFlash });
  for (const pw of [powersA, powersD]) pw.setHooks({
    impact: (x, y) => { const r = pw === powersD ? 'b' : true; stamp(x, y, 0.2, r, 0.3); stamp(x, y, 0.12, r, 5, true); },
    shake: (v) => { if (!reduced) shake = Math.max(shake, v); },
  });
  const tk = (red) => (red === 'b' ? 'b' : red ? 'r' : 'k');
  // switch the drawn character (the core already swapped her rules)
  function setChar(id) {
    if (id === charId) return;
    charId = id; anim = id === 1 ? animD : animA; powers = id === 1 ? powersD : powersA;
  }
  let splatSet = false;
  const stamps = [];   // painted splatter bursts
  const delayed = [];  // events held back to land on an animation beat
  loadArt().then((a) => { art = a; artCache = new Map(); }).catch((e) => console.warn(e));
  const R = rng(1234);

  // ground-plane perspective (cam.js): the stage supplies each scene's camera
  let cam = null, camDefault = null;
  const toX = (x, y) => camX(cam, x, y);
  const toY = (y) => camY(cam, y);
  const dsz = (y) => camSize(cam, y);
  // The Asura is drawn a little toward the camera from the ring's centre (the
  // core still has him at 0,0): standing exactly at the centre reads as too far
  // back, since the near half of a foreshortened ring is larger on screen.
  const AY = 0.2;
  let aY = 0; // his feet on screen, refreshed per frame from the scene camera
  const proj = (x, y) => [camX(cam, x, y), camY(cam, y), camSize(cam, y)];

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
    scale = Math.min(W, H / SQ * 0.96) / 2 * 0.98;
    cx = W / 2; cy = H / 2 + H * 0.02;
    camDefault = makeCam({ W, H, cx, cy, scale }, horizonFor({ W, H, cx, cy }, PERSP.none.hz), PERSP.none.q);
    cam = camDefault;
    buildBackground();
    sprites = new Map();
    artCache = new Map();
    bgLive = null;
    splatSet = false;
    stage.setView({ W, H, cx, cy, scale, dpr });
    camDefault = makeCam({ W, H, cx, cy, scale }, horizonFor({ W, H, cx, cy }, PERSP.none.hz), PERSP.none.q);
    cam = camDefault;
    prewarm();
  }

  // ------------------------------------------------------------ background
  function mountainLayer(w, h, seed, base, peakH, tone, blur) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const r = rng(seed);
    g.filter = blur ? `blur(${blur}px)` : 'none';
    for (let pass = 0; pass < 2; pass++) {
      const by = base + pass * h * 0.05;
      const grad = g.createLinearGradient(0, by - peakH, 0, by + h * 0.12);
      grad.addColorStop(0, `rgba(30,27,24,${tone * (pass ? 0.75 : 1)})`);
      grad.addColorStop(0.55, `rgba(30,27,24,${tone * 0.35})`);
      grad.addColorStop(1, 'rgba(30,27,24,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(0, by + h * 0.14);
      let x = 0, y = by - r() * peakH * 0.4;
      g.lineTo(0, y);
      while (x < w) {
        const step = (12 + r() * 40) * dpr;
        x += step;
        const big = r() < 0.12;
        y = by - (big ? peakH * (0.7 + r() * 0.3) : r() * peakH * 0.55);
        g.lineTo(x, y);
      }
      g.lineTo(w, by + h * 0.14); g.closePath(); g.fill();
    }
    // tree specks on ridges
    g.filter = 'none';
    g.fillStyle = `rgba(22,20,18,${tone * 0.9})`;
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = base - r() * peakH * 0.35;
      const s = (2 + r() * 4) * dpr;
      g.beginPath(); g.moveTo(x, y - s * 2.2); g.lineTo(x - s, y); g.lineTo(x + s, y); g.fill();
    }
    return c;
  }

  function buildBackground() {
    // grain
    if (!grain) {
      grain = document.createElement('canvas'); grain.width = grain.height = 160;
      const g = grain.getContext('2d'); const id = g.createImageData(160, 160); const r = rng(77);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = r(); id.data[i] = id.data[i + 1] = id.data[i + 2] = 40; id.data[i + 3] = v < 0.5 ? 0 : (v - 0.5) * 44;
      }
      g.putImageData(id, 0, 0);
    }
    bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const g = bg.getContext('2d');
    const r = rng(42);
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
    const v = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(255,255,255,.25)'); v.addColorStop(1, 'rgba(70,58,40,.22)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    // ink-wash ground pools
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2, d = 0.3 + r() * 0.9;
      const gy = Math.sin(a) * d, x = toX(Math.cos(a) * d, gy), y = toY(gy);
      const rr = (0.12 + r() * 0.25) * scale * dsz(gy);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(40,36,30,.07)'); gr.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 1.4, rr * 1.4 * camAspect(cam, gy), 0, 0, Math.PI * 2); g.fill();
    }
    // grass tufts — dry brush flicks
    g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2, d = 0.25 + r() * 1.25;
      const gy = Math.sin(a) * d, x = toX(Math.cos(a) * d, gy), y = toY(gy);
      const n = 3 + (r() * 4 | 0), hgt = (5 + r() * 9) * dpr;
      g.strokeStyle = `rgba(22,20,18,${0.12 + r() * 0.18})`;
      for (let k = 0; k < n; k++) {
        g.lineWidth = (0.6 + r() * 1.2) * dpr;
        g.beginPath(); g.moveTo(x + (k - n / 2) * 2 * dpr, y);
        g.quadraticCurveTo(x + (k - n / 2) * 3 * dpr, y - hgt * 0.6, x + (k - n / 2) * 5 * dpr + (r() - 0.5) * 6 * dpr, y - hgt);
        g.stroke();
      }
    }
    // central rock the Asura stands on
    const rx = 0.16 * scale, ry = 0.075 * scale;
    g.save(); g.translate(cx, cy);
    const rg = g.createRadialGradient(0, -ry * 0.3, rx * 0.1, 0, 0, rx * 1.1);
    rg.addColorStop(0, 'rgba(60,55,50,.55)'); rg.addColorStop(0.7, 'rgba(40,36,32,.45)'); rg.addColorStop(1, 'rgba(40,36,32,0)');
    g.fillStyle = rg;
    g.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2, j = 0.8 + r() * 0.35;
      const px = Math.cos(a) * rx * j, py = Math.sin(a) * ry * j;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.fill();
    g.strokeStyle = 'rgba(22,20,18,.35)';
    for (let i = 0; i < 18; i++) {
      g.lineWidth = (0.6 + r() * 1.6) * dpr;
      const a = r() * Math.PI * 2, d = r() * 0.8;
      const px = Math.cos(a) * rx * d, py = Math.sin(a) * ry * d;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + (r() - 0.5) * rx * 0.6, py + (r() - 0.3) * ry * 0.5); g.stroke();
    }
    g.restore();
    // faint watermark kanji
    g.save();
    g.globalAlpha = 0.045; g.fillStyle = INK;
    g.font = `${Math.round(Math.min(W, H) * 0.42)}px Kanji, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('修羅', cx, cy + H * 0.02);
    g.restore();
    // grain over everything
    g.globalAlpha = 1; g.fillStyle = g.createPattern(grain, 'repeat'); g.fillRect(0, 0, W, H);

    const mw = Math.round(W * 1.15);
    far = mountainLayer(mw, Math.round(H * 0.42), 9, H * 0.2, H * 0.17, 0.16, 3 * dpr);
    near = mountainLayer(mw, Math.round(H * 0.42), 21, H * 0.26, H * 0.14, 0.26, 1.2 * dpr);
  }

  // ------------------------------------------------------------ primitives
  function stroke(g, pts, w, color) {
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  }
  function poly(g, pts, color) {
    g.fillStyle = color; g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath(); g.fill();
  }
  function circ(g, x, y, r, color) { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

  // brush ring (range indicator)
  // range ring: a brush circle lying on the ground, projected through the scene
  // camera, so it foreshortens toward the horizon and the strokes thin with depth
  function brushRing(radius, t) {
    const n = 64, sub = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + t * 0.05, a1 = a0 + (Math.PI * 2 / n) * 0.82;
      const k = Math.sin(i * 2.7) * 0.5 + 0.5;
      const rr = radius * (1 + Math.sin(i * 1.3) * 0.006);
      const am = (a0 + a1) / 2, ym = Math.sin(am) * rr, ds = dsz(ym);
      ctx.strokeStyle = `rgba(22,20,18,${(0.16 + k * 0.22) * (0.7 + 0.3 * Math.min(1, ds))})`;
      ctx.lineWidth = (1 + k * 2.4) * dpr * ds;
      ctx.beginPath();
      for (let j = 0; j <= sub; j++) {
        const a = a0 + ((a1 - a0) * j) / sub, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (j) ctx.lineTo(toX(x, y), toY(y)); else ctx.moveTo(toX(x, y), toY(y));
      }
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ sprite cache
  // Figures are vector-drawn once per animation frame, then given an ink-bleed
  // halo, dry-brush grain and soft wash lighting, and cached as bitmaps.
  const FRAMES = 12, TAU = Math.PI * 2;
  const BOX = { x0: -92, x1: 92, y0: -178, y1: 22 };
  const CADENCE = [6.5, 10, 6, 6, 5.5, 3.2, 2.4, 5, 4.5, 3, 4.5, 2.2, 2.2];
  let sprites = new Map(), dryGrain = null, prewarmQ = [];
  function getDryGrain() {
    if (dryGrain) return dryGrain;
    dryGrain = document.createElement('canvas'); dryGrain.width = dryGrain.height = 96;
    const g = dryGrain.getContext('2d'), r = rng(5);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = `rgba(236,230,216,${0.25 + r() * 0.6})`;
      const x = r() * 96, y = r() * 96;
      g.fillRect(x, y, 0.6 + r() * 1.8, 0.4 + r() * 0.8);
    }
    return dryGrain;
  }
  function makeSprite(px, drawFn) {
    const k = px / 100;
    const w = Math.max(2, Math.ceil((BOX.x1 - BOX.x0) * k)), h = Math.max(2, Math.ceil((BOX.y1 - BOX.y0) * k));
    const a = document.createElement('canvas'); a.width = w; a.height = h;
    const g = a.getContext('2d');
    g.setTransform(k, 0, 0, k, -BOX.x0 * k, -BOX.y0 * k);
    drawFn(g);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.filter = `blur(${Math.max(0.8, k * 2.4).toFixed(2)}px)`; o.globalAlpha = 0.5; o.drawImage(a, 0, 0);
    o.filter = 'none'; o.globalAlpha = 1; o.drawImage(a, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    o.globalAlpha = 0.28; o.fillStyle = o.createPattern(getDryGrain(), 'repeat'); o.fillRect(0, 0, w, h);
    o.globalAlpha = 1;
    const lg = o.createLinearGradient(0, 0, w, h);
    lg.addColorStop(0, 'rgba(255,250,240,.12)'); lg.addColorStop(0.6, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,.14)');
    o.fillStyle = lg; o.fillRect(0, 0, w, h);
    o.globalCompositeOperation = 'source-over';
    return { c: out, ox: -BOX.x0 * k, oy: -BOX.y0 * k, flash: null };
  }
  function enemySprite(kind, fr, px) {
    const key = kind + '|' + fr + '|' + Math.round(px);
    let s = sprites.get(key);
    if (!s) { s = makeSprite(px, (g) => drawFigure(g, kind, (fr / FRAMES) * TAU)); sprites.set(key, s); }
    return s;
  }
  function asuraSprite(fr, li, arms, px) {
    const key = 'A|' + fr + '|' + li + '|' + (arms ? 1 : 0) + '|' + Math.round(px);
    let s = sprites.get(key);
    if (!s) { s = makeSprite(px, (g) => drawAsuraFig(g, (fr / FRAMES) * TAU, [0, 0.4, 0.75, 1][li], arms)); sprites.set(key, s); }
    return s;
  }
  function flashOf(s) {
    if (s.flash) return s.flash;
    const f = document.createElement('canvas'); f.width = s.c.width; f.height = s.c.height;
    const g = f.getContext('2d'); g.drawImage(s.c, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(244,239,229,.82)'; g.fillRect(0, 0, f.width, f.height);
    s.flash = f; return f;
  }
  const enemyPx = (kind) => [0.15, 0.14, 0.13, 0.155, 0.165, 0.15, 0.155, 0.21, 0.34, 0.32, 0.34, 0.38, 0.32][kind] * scale * 1.35;
  const asuraPx = () => 0.31 * scale;
  function prewarm() {
    // build the Asura idle cycle and the first foes during idle time
    prewarmQ = [];
    for (let f = 0; f < FRAMES; f++) prewarmQ.push(() => asuraSprite(f, 0, false, asuraPx()));
    for (const k of [0, 1]) for (let f = 0; f < FRAMES; f++) prewarmQ.push(() => enemySprite(k, f, enemyPx(k)));
    for (let li = 1; li < 4; li++) for (let f = 0; f < FRAMES; f += 3) prewarmQ.push(() => asuraSprite(f, li, false, asuraPx()));
    for (let k = 2; k < 8; k++) for (let f = 0; f < FRAMES; f++) prewarmQ.push(() => enemySprite(k, f, enemyPx(k)));
  }
  function pumpPrewarm() {
    const t0 = performance.now();
    while (prewarmQ.length && performance.now() - t0 < 4) prewarmQ.shift()();
  }

  // ------------------------------------------------------------ painted art
  // on-screen heights as a fraction of the arena scale
  const FOE_H = [0.33, 0.31, 0.27, 0.34, 0.35, 0.36, 0.35, 0.42, 0.74, 0.74, 0.74, 0.7, 0.72];
  const HIP = [0.6, 0.6, 0.62, 0.6, 0.6, 0, 0, 0.62, 0.64, 0, 0.64, 0, 0];
  const FLY = new Set([5, 6, 9, 12]);
  const asuraH = () => 0.45 * scale * 1.07; // a touch larger, per his nearer depth
  function cached(key, make) {
    let v = artCache.get(key);
    if (v === undefined) { v = make(); artCache.set(key, v); }
    return v;
  }
  function getPose(name) {
    return cached('A_' + name, () => {
      const m = art.meta.asura.frames.A_idle;
      return makeFrame(art, 'asura', 'A_' + name, asuraH() / m.h);
    });
  }
  // her painted set shares his atlas scale (sizes relative to each other kept)
  function getPoseD(name) {
    if (!art.meta.daeva) return getPose(name);
    return cached('D_' + name, () => {
      const m = art.meta.asura.frames.A_idle;
      const fr = makeFrame(art, 'daeva', 'D_' + name, asuraH() / m.h);
      if (fr) fr.key = 'D_' + name;
      return fr || getPose(name);
    });
  }
  function foeFrame(kind) {
    return cached('E' + kind, () => {
      const m = art.meta.foes.frames['E' + kind];
      return makeFrame(art, 'foes', 'E' + kind, (FOE_H[kind] * scale) / m.h);
    });
  }
  function arcTex(red) {
    return cached('arc' + (red ? 'r' : 'k'), () => {
      const m = art.meta.fx.frames.FX_arc, k = Math.min(1, (asuraH() * 0.9) / m.h);
      const fr = makeFrame(art, 'fx', 'FX_arc', k);
      const c = red ? tinted(fr.c, '#b3202a') : fr.c;
      return { c, cx: 184.5 * k, cy: 176.2 * k, r: 145.9 * k };
    });
  }
  // straight dry-brush strip unwrapped from the painted enso (see art.js)
  function strokeTex(red) {
    return cached('stroke' + tk(red), () => {
      const m = art.meta.fx.frames.FX_arc;
      const fr = makeFrame(art, 'fx', 'FX_arc', 1);
      const strip = unwrapRing(fr.c, 184.5, 176.2, 145.9, 145.9 - 62, 145.9 + 50, 0.3, Math.PI * 2 - 0.3);
      // pre-scale to ~1.3x the on-screen trail thickness so slices draw near 1:1
      const th = Math.max(8, Math.round(asuraH() * 0.13 * 1.3)), kk = th / strip.height;
      const sm = document.createElement('canvas'); sm.width = Math.round(strip.width * kk); sm.height = th;
      const sg = sm.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(strip, 0, 0, sm.width, sm.height);
      return red === 'b' ? tinted(tinted(sm, '#1d47c4', 'source-atop', 0.62), 'rgba(47,107,255,1)', 'source-atop', 0.25) : red ? tinted(sm, '#b3202a') : sm;
    });
  }
  // blue variants: the black splatter washed ultramarine, ink still showing through
  const blueFr = (fr) => {
    if (!fr) return fr;
    // a soft ultramarine wash bleeding out around a dark ink core
    const c = document.createElement('canvas'); c.width = fr.c.width; c.height = fr.c.height;
    const g = c.getContext('2d'), w = c.width, h = c.height;
    g.globalAlpha = 0.6; g.drawImage(tinted(fr.c, '#2f6bff', 'source-in'), 0, 0);
    g.globalAlpha = 0.95; g.drawImage(tinted(fr.c, '#14204a', 'source-atop', 0.7), w * 0.17, h * 0.17, w * 0.66, h * 0.66);
    return { ...fr, c };
  };
  function dropTex(red) {
    return cached('drop' + tk(red), () => {
      const r = red === true, m = art.meta.fx.frames[r ? 'FX_splatred' : 'FX_splat'];
      const fr = makeFrame(art, 'fx', r ? 'FX_splatred' : 'FX_splat', (16 * dpr) / m.w);
      return red === 'b' ? blueFr(fr) : fr;
    });
  }
  function stampTex(red) {
    return cached('splat' + tk(red), () => {
      const r = red === true, m = art.meta.fx.frames[r ? 'FX_splatred' : 'FX_splat'];
      const fr = makeFrame(art, 'fx', r ? 'FX_splatred' : 'FX_splat', Math.min(1, (0.3 * scale) / m.w));
      return red === 'b' ? blueFr(fr) : fr;
    });
  }
  // a painted splatter burst; ground = flattened decal that lingers
  function stamp(x, y, size, red, life = 0.35, ground = false) {
    if (!art) return;
    if (stamps.length > (reduced ? 24 : 64)) { const i = stamps.findIndex((q) => q.ground === ground); stamps.splice(i < 0 ? 0 : i, 1); }
    stamps.push({ x, y, size, red, life, max: life, rot: R() * Math.PI * 2, ground, flip: R() < 0.5 ? -1 : 1 });
  }
  // ground splatter is baked into a live copy of the background: zero per-frame
  // cost, re-baked every 1.5 s so old stains slowly soak into the paper
  let bgLive = null, bakeT = 0;
  function bakeGround(full) {
    if (!bg) return;
    if (!bgLive || bgLive.width !== W || bgLive.height !== H) { bgLive = document.createElement('canvas'); bgLive.width = W; bgLive.height = H; full = true; }
    const g = bgLive.getContext('2d');
    if (full) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; if (stage.scene) g.drawImage(stage.scene, 0, 0); else { g.drawImage(bg, 0, 0); paintScenery(g, reduced ? 0 : time); } }
    for (const st of stamps) if (st.ground && (full || !st.baked)) { drawStampOn(g, st, Math.min(1, st.life / 3) * (st.red ? 0.42 : 0.36), 1); st.baked = true; }
  }
  function drawStamp(s, a, grow) { drawStampOn(ctx, s, a, grow); }
  // parallax mountains (they drift < 1 px/s, so a 1.5 s re-bake is invisible) + mist
  function paintScenery(g, drift) {
    g.globalAlpha = 1;
    g.drawImage(far, -W * 0.075 + Math.sin(drift * 0.03) * W * 0.04, 0);
    g.drawImage(near, -W * 0.075 + Math.sin(drift * 0.03 + 1) * W * 0.07, H * 0.0);
    const mist = g.createLinearGradient(0, H * 0.22, 0, H * 0.4);
    mist.addColorStop(0, 'rgba(236,230,216,0)'); mist.addColorStop(0.5, 'rgba(236,230,216,.85)'); mist.addColorStop(1, 'rgba(236,230,216,0)');
    g.fillStyle = mist; g.fillRect(0, H * 0.22, W, H * 0.18);
  }
  function drawStampOn(ctx, s, a, grow) {
    const ds = dsz(s.y), tex = stampTex(s.red), w = s.size * scale * grow * ds;
    const k = w / tex.w;
    ctx.save(); ctx.globalAlpha = a;
    ctx.translate(toX(s.x, s.y), toY(s.y) - (s.ground ? 0 : 0.08 * scale * ds));
    if (s.ground) ctx.scale(1, Math.min(0.9, camAspect(cam, s.y) * 0.7));
    ctx.rotate(s.rot); ctx.scale(k * s.flip, k);
    ctx.drawImage(tex.c, -tex.w / 2, -tex.h / 2);
    ctx.restore();
  }

  // painted foes are animated by the cutout rig in foes.js
  // death: the painting tears into strips that drift apart and fade into the paper
  function drawFoeDeath(k, l) {
    const fr = foeFrame(k.kind); if (!fr) return;
    const img = l > 0.86 ? paintedFlash(fr) : fr.c;
    const w = fr.w, h = fr.h, N = reduced ? 1 : lite ? 3 : 6, hs = Math.ceil(h / N);
    // a short recoil death pose first, then the painting tears apart from it
    const q = 1 - l, pose = Math.min(1, q / 0.28), p = Math.max(0, (q - 0.28) / 0.72), sz = dsz(k.y);
    ctx.save();
    ctx.translate(toX(k.x, k.y), toY(k.y)); ctx.scale(k.face * sz, sz);
    if (!reduced) rig.deathPose(ctx, pose);
    for (let i = 0; i < N; i++) {
      const y0 = i * hs, hh = Math.min(hs + 1, h - y0);
      const dir = (i % 2 ? 1 : -1) * (0.6 + ((i * 37) % 10) / 20);
      ctx.globalAlpha = Math.max(0, (1 - p) * (0.95 - i * 0.03 * p));
      ctx.save();
      ctx.translate(dir * p * w * 0.35 - p * w * 0.15, -p * h * 0.12 * (1 - i / N) + p * p * h * 0.25);
      ctx.rotate(dir * p * 0.35);
      ctx.drawImage(img, 0, y0, w, hh, -fr.ax, -fr.ay + y0, w, hh);
      ctx.restore();
    }
    ctx.restore();
  }

  // build painted caches a few per frame so the first fight never hitches
  const POSES = ['idle', 'coil', 'backfist', 'roundhouse', 'tornado', 'crescent', 'palm', 'uppercut', 'sweep', 'slam'];
  function warmArt() {
    const t0 = performance.now();
    for (const p of POSES) { if (!artCache.has('A_' + p)) { getPose(p); if (performance.now() - t0 > 6) return; } }
    if (!artCache.has('arck')) { arcTex(false); arcTex(true); stampTex(false); stampTex(true); strokeTex(false); strokeTex(true); dropTex(false); dropTex(true); }
    if (charId === 1 && !artCache.has('splatb')) { stampTex('b'); strokeTex('b'); dropTex('b'); }
    if (charId === 1) for (const p of POSES) { if (!artCache.has('D_' + p)) { getPoseD(p); if (performance.now() - t0 > 6) return; } }
    for (let k = 0; k < 13; k++) { if (!artCache.has('E' + k)) { foeFrame(k); if (performance.now() - t0 > 6) return; } }
  }

  function drawAsura(f, t) {
    if (art) {
      powers.drawBack(ctx);
      if (charId === 1) anim.draw(ctx, lastDt, getPoseD, (red) => strokeTex(red ? 'b' : false), f);
      else anim.draw(ctx, lastDt, getPose, strokeTex, f);
      powers.drawFront(ctx);
      return;
    }
    const atk = f[2], face = f[3] || 1;
    const lunge = atk > 0 ? Math.sin((atk / 0.18) * Math.PI) : 0;
    const li = lunge > 0.85 ? 3 : lunge > 0.55 ? 2 : lunge > 0.2 ? 1 : 0;
    const fr = Math.floor((((t * 2.2) / TAU) % 1) * FRAMES) % FRAMES;
    const s = asuraSprite(reduced ? 0 : fr, li, f[9] > 0, asuraPx());
    ctx.save(); ctx.translate(cx, aY - 2 * dpr); ctx.scale(face, 1);
    ctx.drawImage(s.c, -s.ox, -s.oy);
    ctx.restore();
    powers.drawFront(ctx);
  }

  // ------------------------------------------------------------ effects
  function splat(x, y, n, red, power = 1) {
    const max = reduced ? 30 : lite ? 30 : art ? 70 : 200;
    for (let i = 0; i < n && parts.length < max; i++) {
      const a = R() * Math.PI * 2, v = (0.15 + R() * 0.5) * power;
      parts.push({ x, y, z: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.3 + R() * 0.6 * power, r: (0.6 + R() * 1.9) * dpr, red: red && R() < 0.8 ? red : false, life: 0.7 + R() * 0.5 });
    }
  }
  function decal(x, y, s, red) {
    if (art) { stamp(x + (R() - 0.5) * 0.02, y, 0.07 + s * 0.05, red, 8, true); return; }
    decals.push({ x, y, s, red, life: 8, seed: (R() * 1e9) | 0 });
    if (decals.length > 70) decals.shift();
  }
  function addText(x, y, txt, color, size) {
    if (texts.length > 70) texts.shift();
    texts.push({ x, y, txt, color, size, life: 0.9, vx: (R() - 0.5) * 0.05 });
  }

  let lastF = null;
  function handle(ev, late = false) {
    // Wrath Burst: the slam lands a beat after the cast, so its shockwave and
    // numbers are held for that beat (visual only; the core already applied it)
    let slamDelay = 0;
    for (let i = 0; i < ev.length; i += 6) if (ev[i] === EV.SWITCH || ev[i] === EV.UNLOCK) { if (ev[i] === EV.SWITCH) setChar(ev[i + 3] | 0); }
    if (!late && art) for (let i = 0; i < ev.length; i += 6) if (ev[i] === EV.CAST && ev[i + 3] === 0) { const d = anim.castSlam(); if (ev[i + 4] !== 1) slamDelay = d; }
    const hold = [];
    const storm = lastF ? lastF[7] > 0 : false, arms = lastF ? lastF[9] > 0 : false, range = lastF ? lastF[1] : 0.4;
    for (let i = 0; i < ev.length; i += 6) {
      const t = ev[i], x = ev[i + 1], y = ev[i + 2], a = ev[i + 3], b = ev[i + 4], c = ev[i + 5];
      if (slamDelay > 0 && (t === EV.WRATH || (t === EV.HIT && c === 2))) { for (let k = 0; k < 6; k++) hold.push(ev[i + k]); continue; }
      switch (t) {
        case EV.HIT:
          if (numbersOn) addText(x, y - 0.12, fmt(a) + (b ? '!' : ''), b ? RED : INK, b ? 19 : 14);
          if (art) {
            if (b && c === 0) {
              anim.onCrit();
              const cr = charId === 1 ? 'b' : true;
              stamp(x, y, charId === 1 ? 0.15 : 0.26, cr, 0.45);
              if (R() < 0.25) stamp(x, y, 0.1, cr, 4, true);
            } else if (charId === 1) {
            // her hits: water flung off the strike (rain drops, whirlpool grind, lotus beads)
            stamp(x, y, c === 3 ? 0.08 : c === 4 ? 0.06 : c === 5 ? 0.05 : 0.065, c === 4 || R() < 0.4 ? false : 'b', 0.26);
            if (c === 0 || c === 3) water.onHit(x, y);
          } else stamp(x, y, c === 2 ? 0.14 : c === 1 ? 0.08 : 0.075, false, 0.26);
          } else if (slashes.length < 50) slashes.push({ x, y, ang: R() * Math.PI, life: 0.22, red: !!b, big: c === 2 });
          splat(x, y, b ? 5 : art ? (R() < 0.5 ? 1 : 0) : 2, charId === 1 ? 'b' : !!b, b ? 1.2 : 0.7);
          if (b && !reduced) shake = Math.max(shake, 3);
          break;
        case EV.KILL:
          if (corpses.length < 24) corpses.push({ kind: b, x, y, life: c ? 1.0 : 0.62, max: c ? 1.0 : 0.62, face: x > 0 ? -1 : 1, hold: slamDelay });
          splat(x, y, c ? 40 : 12, false, c ? 2 : 1.1);
          splat(x, y, c ? 20 : 4, true, 1);
          if (art) stamp(x, y, c ? 0.5 : 0.18, R() < 0.2 || !!c, 0.4);
          decal(x, y, c ? 2.4 : 1, art ? R() < 0.12 || !!c : R() < 0.35 || !!c);
          if (numbersOn) addText(x, y - 0.06, '+' + fmt(a), WASH, 12);
          if (c && !reduced) shake = 8;
          break;
        case EV.ATTACK:
          if (art) anim.onAttack(x, y, a, storm, arms, range);
          else if (swipes.length < 6) swipes.push({ x, y, life: 0.17, flip: R() < 0.5 });
          break;
        case EV.WRATH:
          rings.push({ r: 0.05, max: a, life: 0.6, red: true, rot: R() * 6 });
          rings.push({ r: 0.02, max: a * 0.8, life: 0.75, red: false, rot: R() * 6 });
          if (art) for (let k = 0; k < (reduced ? 3 : 7); k++) { const q = R() * Math.PI * 2, d = 0.05 + R() * 0.12; stamp(Math.cos(q) * d, Math.sin(q) * d, 0.16, k === 0, 7, true); }
          if (!reduced) shake = 10;
          break;
        case EV.CHAIN:
          powers.onChain(x, y);
          if (art) stamp(x, y, 0.14, true, 0.25);
          break;
        case EV.HURT:
          hurtFlash = Math.min(1, hurtFlash + 0.35);
          if (!reduced) shake = Math.max(shake, 3);
          break;
        case EV.HEAL:
          healFlash = 1;
          break;
        case EV.TIDE:
          water.onTide(a);
          if (art) for (let k = 0; k < (reduced ? 2 : 6); k++) { const q = R() * Math.PI * 2, d = 0.05 + R() * 0.12; stamp(Math.cos(q) * d, Math.sin(q) * d + AY * 0.5, 0.14, 'b', 6, true); }
          if (!reduced) shake = Math.max(shake, 6);
          break;
        case EV.DROP:
          water.onDrop(x, y);
          break;
        case EV.POOL:
          water.onPool(x, y, a);
          break;
      }
    }
    if (hold.length) delayed.push({ t: slamDelay, ev: hold });
  }

  // ------------------------------------------------------------ frame
  let lastDt = 1 / 60;
  // adaptive quality: if frames run long for a few seconds (slow phone), shed
  // secondary effects (smear ghosts, ribbons, cloth strips, droplets); restore
  // them when there is headroom again
  let lite = false, ema = 1 / 60, slowT = 0, fastT = 0;
  function govern(dtReal) {
    if (dtReal > 0.25) return; // tab switch / hitch, not steady load
    ema += (dtReal - ema) * 0.05;
    if (ema > 1 / 42) { slowT += dtReal; fastT = 0; } else if (ema < 1 / 54) { fastT += dtReal; slowT = 0; }
    if (!lite && slowT > 2.5) { lite = true; slowT = 0; }
    if (lite && fastT > 8) { lite = false; fastT = 0; }
  }
  // radial vignettes rendered once at half resolution (gradient fills are costly per frame)
  const vigs = {};
  function vignette(kind) {
    const key = kind + W + 'x' + H;
    if (vigs[kind] && vigs[kind].key === key) return vigs[kind].c;
    const c = document.createElement('canvas'); c.width = Math.ceil(W / 2); c.height = Math.ceil(H / 2);
    const g = c.getContext('2d'), w = c.width, h = c.height;
    const gr = g.createRadialGradient(w / 2, h / 2 + h * 0.02, Math.min(w, h) * (kind === 'k' ? 0.3 : 0.35), w / 2, h / 2, Math.max(w, h) * 0.7);
    gr.addColorStop(0, kind === 'k' ? 'rgba(22,20,18,0)' : 'rgba(179,32,42,0)'); gr.addColorStop(1, kind === 'k' ? 'rgba(22,20,18,1)' : 'rgba(179,32,42,1)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    vigs[kind] = { key, c };
    return c;
  }
  function draw(f, en, dtReal) {
    // the Asura's crit impact frame slows everything around him for a beat
    let dt = dtReal;
    govern(dtReal);
    cam = stage.cam || camDefault;
    aY = toY(AY);
    if (f.length > 17) setChar(f[17] | 0);
    if (art) dt = dtReal * anim.update(dtReal, f, en, f[1], { reduced, lite, H: asuraH(), X: cx, Y: aY, dpr, SQ: cam.q, scale, proj });
    lastDt = dt;
    time += dt;
    for (let i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dtReal;
      if (delayed[i].t <= 0) { const d = delayed.splice(i, 1)[0]; handle(d.ev, true); }
    }
    lastF = f;
    if (art) warmArt(); else pumpPrewarm();
    if (art && !splatSet) { stage.setSplat(stampTex(false)); splatSet = true; }
    if (stage.update(f[4], dtReal, reduced ? 'reduced' : lite ? 'lite' : 'full')) {
      for (let i = stamps.length - 1; i >= 0; i--) if (stamps[i].ground) stamps.splice(i, 1);
      decals.length = 0; bakeT = 0;
    }
    if (art) rig.update(en, dt, time, (x, y, kind, boss) => {
      // foe strikes land on the Asura: a fleck of ink, bosses slam the ground
      if (boss) { stamp(x * 0.45, y * 0.45, 0.2, true, 0.3); stamp(x * 0.5, y * 0.5, 0.16, false, 4, true); if (!reduced) shake = Math.max(shake, 6); }
      else if (!reduced && !lite) stamp(x * 0.55, y * 0.55, 0.07, R() < 0.3, 0.2);
    });
    { const p = anim.pose, env = { X: cx, Y: aY, H: asuraH(), scale, SQ: cam.q, proj, dpr, reduced, lite, dx: art && p ? p.dx || 0 : 0, AY };
      if (charId === 1) { const g = Array.from(f); g[7] = 0; g[8] = f[20] || 0; powers.update(dt, g, en, env); }
      else powers.update(dt, f, en, env);
      water.update(dt, f, env); }
    const t = time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let sx = 0, sy = 0;
    if (shake > 0 && !reduced) { sx = (R() - 0.5) * shake * dpr; sy = (R() - 0.5) * shake * dpr; shake = Math.max(0, shake - dt * 40); }
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    if (art) {
      let fresh = false;
      for (let i = stamps.length - 1; i >= 0; i--) {
        const st = stamps[i];
        if (!st.ground) continue;
        st.life -= dt;
        if (st.life <= 0) stamps.splice(i, 1);
        else if (!st.baked) fresh = true;
      }
      bakeT -= dtReal;
      if (bakeT <= 0) { bakeGround(true); bakeT = 1.5; } else if (fresh) bakeGround(false);
      ctx.setTransform(1, 0, 0, 1, sx, sy);
    }
    if (art && bgLive) ctx.drawImage(bgLive, 0, 0); // scenery + stains pre-baked
    else if (stage.scene) ctx.drawImage(stage.scene, 0, 0);
    else { ctx.drawImage(bg, 0, 0); paintScenery(ctx, reduced ? 0 : t); }
    if (stage.transitioning) { stage.drawTransition(ctx); ctx.setTransform(1, 0, 0, 1, sx, sy); }
    stage.drawAmbient(ctx, true); ctx.setTransform(1, 0, 0, 1, sx, sy);

    // ground decals
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]; d.life -= dt;
      if (d.life <= 0) { decals.splice(i, 1); continue; }
      const r = rng(d.seed), a = Math.min(1, d.life / 3) * 0.5;
      ctx.fillStyle = d.red ? `rgba(160,24,32,${a})` : `rgba(22,20,18,${a})`;
      const X = toX(d.x, d.y), Y = toY(d.y), s = d.s * 6 * dpr * dsz(d.y);
      for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(X + (r() - 0.5) * s * 2.4, Y + (r() - 0.5) * s, s * (0.3 + r() * 0.6), s * (0.2 + r() * 0.4), 0, 0, Math.PI * 2); ctx.fill(); }
    }

    // range circle
    brushRing(f[1], reduced ? 0 : t);
    water.drawGround(ctx); ctx.setTransform(1, 0, 0, 1, sx, sy);

    // dissolving corpses: the painting tears into strips and fades into the paper
    for (let i = corpses.length - 1; i >= 0; i--) {
      const k = corpses[i];
      if (k.hold > 0) { k.hold -= dt; if (art) rig.draw(ctx, -1, k.kind, toX(k.x, k.y), toY(k.y), dsz(k.y), k.face, { flash: true, spawn: 1, quality: reduced ? 'reduced' : lite ? 'lite' : 'full' }); continue; }
      k.life -= dt;
      if (k.life <= 0) { corpses.splice(i, 1); continue; }
      const l = k.life / k.max;
      if (art) drawFoeDeath(k, l);
      else {
        const spr = enemySprite(k.kind, 0, enemyPx(k.kind));
        ctx.save(); ctx.globalAlpha = l * 0.9; ctx.translate(toX(k.x, k.y), toY(k.y));
        ctx.scale(k.face * (1 + (1 - l) * 0.35), 0.35 + 0.65 * l);
        ctx.drawImage(l > 0.7 ? flashOf(spr) : spr.c, -spr.ox, -spr.oy);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (!reduced && R() < dt * 30 && wisps.length < 60) wisps.push({ x: k.x + (R() - 0.5) * 0.06, y: k.y, h: 0.05, life: 0.9, r: (2 + R() * 3) * dpr });
    }

    // shockwaves
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      r.r += (r.max - r.r) * Math.min(1, dt * 9);
      if (art) {
        const tex = arcTex(r.red), cb = circleBox(cam, r.r, AY), k = cb.rx / tex.r;
        ctx.save(); ctx.translate(cx, cb.cy); ctx.scale(k, cb.ry / tex.r); ctx.rotate(r.rot + (1 - r.life) * (r.red ? 2.2 : -1.6));
        ctx.globalAlpha = Math.min(1, r.life * (r.red ? 1.6 : 1.2));
        ctx.drawImage(tex.c, -tex.cx, -tex.cy);
        ctx.restore(); ctx.globalAlpha = 1;
        continue;
      }
      const cb = circleBox(cam, r.r, AY);
      ctx.save(); ctx.translate(cx, cb.cy);
      ctx.strokeStyle = r.red ? `rgba(179,32,42,${r.life})` : `rgba(22,20,18,${r.life * 0.8})`;
      ctx.lineWidth = (r.red ? 7 : 3) * dpr * (0.4 + r.life);
      ctx.beginPath(); ctx.ellipse(0, 0, cb.rx, cb.ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // depth-sorted figures
    const n = en.length / 11;
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    order.sort((a, b) => en[a * 11 + 3] - en[b * 11 + 3]);
    let asuraDrawn = false;
    const drawEnemy = (i) => {
      const o = i * 11;
      const kind = en[o + 1], x = en[o + 2], y = en[o + 3], hp = en[o + 4], size = en[o + 5], age = en[o + 6], flash = en[o + 7], phase = en[o + 8], boss = en[o + 9], slow = en[o + 10];
      const X = toX(x, y), Y = toY(y), sz = dsz(y), px = enemyPx(kind) * sz;
      const fade = Math.min(1, age / 0.6);
      const face = x > 0 ? -1 : 1;
      const d = Math.hypot(x, y);
      const cad = CADENCE[kind] || 6;
      const melee = d < 0.2;
      const fly = kind === 5 || kind === 6 || kind === 9 || kind === 12;
      let topY = Y - px * (boss ? 1.25 : 1.05);
      ctx.save();
      ctx.globalAlpha = fade;
      // soft wash shadow
      ctx.fillStyle = 'rgba(22,20,18,.2)';
      { const sw = px * (fly ? 0.2 : 0.3); ctx.beginPath(); ctx.ellipse(X, Y, sw, Math.max(sw * camAspect(cam, y) * 0.55, px * 0.04), 0, 0, Math.PI * 2); ctx.fill(); }
      if (art) {
        if (kind === 6 || kind === 12) ctx.globalAlpha = fade * 0.9;
        const R = rig.draw(ctx, en[o], kind, X, Y, sz, face, { flash: flash > 0, spawn: fade, age, quality: reduced ? 'reduced' : lite ? 'lite' : 'full' });
        if (R) topY = Y - R.ay * sz * 1.04 - 2 * dpr;
      } else {
        const ph = reduced ? phase : (melee ? t * 3 : t * cad * (slow > 0 ? 0.4 : 1)) + phase;
        const fr = Math.floor(((((ph / TAU) % 1) + 1) % 1) * FRAMES) % FRAMES;
        const spr = enemySprite(kind, fr, px);
        ctx.translate(X + (melee && !reduced ? Math.sin(t * 9 + phase) * px * 0.04 * -Math.sign(x) : 0), Y);
        ctx.scale(face * sz, sz);
        if (kind === 6 || kind === 12) ctx.globalAlpha = fade * 0.88;
        ctx.drawImage(flash > 0 ? flashOf(spr) : spr.c, -spr.ox, -spr.oy);
      }
      ctx.restore();
      // hp bar
      if (hp < 0.999 || boss) {
        const bw = Math.max(20 * dpr, px * (boss ? 0.9 : 0.6)), bh = (boss ? 5 : 3.2) * dpr * Math.max(0.8, Math.min(1.2, sz));
        const by = topY - 4 * dpr;
        ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(236,230,216,.85)'; ctx.fillRect(X - bw / 2, by, bw, bh);
        ctx.fillStyle = boss ? RED : INK; ctx.fillRect(X - bw / 2, by, bw * hp, bh);
        ctx.strokeStyle = INK; ctx.lineWidth = dpr; ctx.strokeRect(X - bw / 2, by, bw, bh);
        ctx.globalAlpha = 1;
      }
    };
    for (const i of order) {
      if (!asuraDrawn && en[i * 11 + 3] > AY) { drawAsura(f, t); asuraDrawn = true; }
      drawEnemy(i);
    }
    if (!asuraDrawn) drawAsura(f, t);

    // ink smoke rising off the Asura
    if (!reduced && R() < dt * (f[7] > 0 ? 18 : 5) && wisps.length < 60) wisps.push({ x: (R() - 0.5) * 0.1, y: (R() - 0.5) * 0.04, h: 0.02, life: 1.3, r: (2 + R() * 4) * dpr, red: (charId === 1 ? water.rain > 0.1 || f[20] > 0 : f[8] > 0) && R() < 0.5 });
    for (let i = wisps.length - 1; i >= 0; i--) {
      const w = wisps[i]; w.life -= dt; w.h += dt * 0.09; w.x += Math.sin(time * 2 + i) * dt * 0.02;
      if (w.life <= 0) { wisps.splice(i, 1); continue; }
      ctx.fillStyle = w.red ? (charId === 1 ? `rgba(47,107,255,${w.life * 0.16})` : `rgba(179,32,42,${w.life * 0.18})`) : `rgba(22,20,18,${w.life * 0.08})`;
      ctx.beginPath(); ctx.arc(toX(w.x, w.y), toY(w.y) - w.h * scale * dsz(w.y), w.r * (1.8 - w.life), 0, Math.PI * 2); ctx.fill();
    }
    water.drawAir(ctx); ctx.setTransform(1, 0, 0, 1, sx, sy);
    // painted splatter bursts in the air at the point of impact
    if (art) for (let i = stamps.length - 1; i >= 0; i--) {
      const st = stamps[i];
      if (st.ground) continue;
      st.life -= dt;
      if (st.life <= 0) { stamps.splice(i, 1); continue; }
      const q = 1 - st.life / st.max;
      drawStamp(st, Math.min(1, st.life / st.max * 2.2) * 0.95, 0.55 + 0.6 * Math.sqrt(q));
    }
    // the Asura's strike arcs — a tapered crescent of ink toward the target
    for (let i = swipes.length - 1; i >= 0; i--) {
      const sw = swipes[i]; sw.life -= dt;
      if (sw.life <= 0) { swipes.splice(i, 1); continue; }
      const ox = cx, oy = aY - 0.17 * scale;
      const a = Math.atan2(toY(sw.y) - 0.07 * scale * dsz(sw.y) - oy, toX(sw.x, sw.y) - ox);
      const p = 1 - sw.life / 0.17, rr = 0.15 * scale * (1 + p * 0.5);
      const span = 1.1, a0 = a - span * (sw.flip ? -1 : 1), a1 = a + span * (sw.flip ? -1 : 1);
      const pts = [];
      for (let k = 0; k <= 8; k++) { const q = a0 + (a1 - a0) * Math.min(1, k / 8 * (0.4 + p * 1.2)); pts.push([ox + Math.cos(q) * rr, oy + Math.sin(q) * rr * 0.85]); }
      ctx.globalAlpha = Math.min(1, sw.life * 9);
      brush(ctx, pts, 0.8 * dpr, 0.5 * dpr, f[9] > 0 ? 'rgba(179,32,42,.85)' : 'rgba(20,18,16,.8)', 7);
      ctx.globalAlpha = 1;
    }
    // slashes
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i]; s.life -= dt;
      if (s.life <= 0) { slashes.splice(i, 1); continue; }
      const X = toX(s.x, s.y), Y = toY(s.y) - 0.07 * scale * dsz(s.y), L = (s.big ? 0.1 : 0.065) * scale * dsz(s.y);
      const p = 1 - s.life / 0.22;
      ctx.save(); ctx.translate(X, Y); ctx.rotate(s.ang);
      ctx.fillStyle = s.red ? `rgba(179,32,42,${s.life * 4})` : `rgba(22,20,18,${s.life * 4})`;
      ctx.beginPath();
      ctx.moveTo(-L, 0); ctx.quadraticCurveTo(0, -L * 0.45 * (0.6 + p), L, 0); ctx.quadraticCurveTo(0, -L * 0.15, -L, 0);
      ctx.fill(); ctx.restore();
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      p.x += p.vx * dt * 0.5; p.y += p.vy * dt * 0.5; p.vz -= dt * 2.2; p.z = Math.max(0, p.z + p.vz * dt * 0.3);
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      if (art) {
        // painted droplet: a tiny rotated splatter stamp
        // stretched along its flight so it reads as a flung drop, not a star
        const tex = dropTex(p.red), k = (p.r * 4.6) / tex.w;
        const rot = Math.atan2(p.vy * cam.q - p.vz * 0.4, p.vx), co = Math.cos(rot), si = Math.sin(rot);
        const ax = k * 1.7, ay = k * 0.75;
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.setTransform(co * ax, si * ax, -si * ay, co * ay, toX(p.x, p.y) + sx, toY(p.y) - (p.z * 0.4 + 0.06) * scale * dsz(p.y) + sy);
        ctx.drawImage(tex.c, -tex.w / 2, -tex.h / 2);
        continue;
      }
      ctx.fillStyle = p.red ? `rgba(179,32,42,${Math.min(1, p.life * 2)})` : `rgba(22,20,18,${Math.min(1, p.life * 2)})`;
      ctx.beginPath(); ctx.ellipse(toX(p.x, p.y), toY(p.y) - (p.z * 0.4 + 0.06) * scale * dsz(p.y), p.r * 1.8, p.r * 0.8, Math.atan2(p.vy * cam.q - p.vz * 0.4, p.vx), 0, Math.PI * 2); ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, sx, sy); ctx.globalAlpha = 1;
    stage.drawAmbient(ctx, false); ctx.setTransform(1, 0, 0, 1, sx, sy);
    // floating numbers
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = texts.length - 1; i >= 0; i--) {
      const tx = texts[i]; tx.life -= dt;
      if (tx.life <= 0) { texts.splice(i, 1); continue; }
      tx.y -= dt * 0.12; tx.x += tx.vx * dt;
      const pop = tx.life > 0.75 ? 1 + (tx.life - 0.75) * 2 : 1;
      ctx.font = `${Math.round(tx.size * dpr * pop)}px Hand, sans-serif`;
      ctx.globalAlpha = Math.min(1, tx.life * 2.5);
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(236,230,216,.9)';
      ctx.strokeText(tx.txt, toX(tx.x, tx.y), toY(tx.y) - 0.1 * scale * dsz(tx.y));
      ctx.fillStyle = tx.color; ctx.fillText(tx.txt, toX(tx.x, tx.y), toY(tx.y) - 0.1 * scale * dsz(tx.y));
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // vignettes
    if (f[7] > 0) {
      ctx.globalAlpha = 0.35 + (reduced ? 0 : Math.random() * 0.1);
      ctx.drawImage(vignette('k'), 0, 0, W, H); ctx.globalAlpha = 1;
    }
    if (hurtFlash > 0) {
      ctx.globalAlpha = hurtFlash * 0.4;
      ctx.drawImage(vignette('r'), 0, 0, W, H); ctx.globalAlpha = 1;
      hurtFlash = Math.max(0, hurtFlash - dt * 2);
    }
    if (healFlash > 0) {
      ctx.fillStyle = charId === 1 ? `rgba(47,107,255,${healFlash * 0.1})` : `rgba(179,32,42,${healFlash * 0.12})`; ctx.fillRect(0, 0, W, H);
      healFlash = Math.max(0, healFlash - dt * 1.5);
    }
    stage.drawBanner(ctx, dtReal);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  }

  return {
    resize, draw, handle,
    setReduced(v) { reduced = v || matchMedia('(prefers-reduced-motion: reduce)').matches; },
    setNumbers(v) { numbersOn = v; },
    get quality() { return reduced ? 'reduced' : lite ? 'lite' : 'full'; },
    get anim() { return anim; },
    get painted() { return !!art; },
    get stage() { return stage; },
    get powers() { return powers; },
    get water() { return water; },
    get charId() { return charId; },
  };
}
