import { drawFigure, drawAsura as drawAsuraFig, brush } from './figures.js';
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

const EV = { HIT: 1, KILL: 2, ATTACK: 3, WRATH: 4, CHAIN: 5, HURT: 6, WAVE: 7, DEFEAT: 8, BOSS: 9, HEAL: 10, CAST: 11 };

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
  const R = rng(1234);

  const toX = (x) => cx + x * scale;
  const toY = (y) => cy + y * scale * SQ;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    canvas.width = W; canvas.height = H;
    scale = Math.min(W, H / SQ * 0.96) / 2 * 0.98;
    cx = W / 2; cy = H / 2 + H * 0.02;
    buildBackground();
    sprites = new Map();
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
      const x = toX(Math.cos(a) * d), y = toY(Math.sin(a) * d);
      const rr = (0.12 + r() * 0.25) * scale;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(40,36,30,.07)'); gr.addColorStop(1, 'rgba(40,36,30,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 1.4, rr * SQ, 0, 0, Math.PI * 2); g.fill();
    }
    // grass tufts — dry brush flicks
    g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2, d = 0.25 + r() * 1.25;
      const x = toX(Math.cos(a) * d), y = toY(Math.sin(a) * d);
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
  function brushRing(radius, t) {
    const n = 64;
    ctx.save(); ctx.translate(cx, cy);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + t * 0.05, a1 = a0 + (Math.PI * 2 / n) * 0.82;
      const k = Math.sin(i * 2.7) * 0.5 + 0.5;
      ctx.strokeStyle = `rgba(22,20,18,${0.16 + k * 0.22})`;
      ctx.lineWidth = (1 + k * 2.4) * dpr;
      const rr = radius * scale * (1 + Math.sin(i * 1.3) * 0.006);
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * SQ, 0, a0, a1); ctx.stroke();
    }
    ctx.restore();
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

  function drawAsura(f, t) {
    const atk = f[2], face = f[3] || 1;
    const lunge = atk > 0 ? Math.sin((atk / 0.18) * Math.PI) : 0;
    const li = lunge > 0.85 ? 3 : lunge > 0.55 ? 2 : lunge > 0.2 ? 1 : 0;
    const fr = Math.floor((((t * 2.2) / TAU) % 1) * FRAMES) % FRAMES;
    const s = asuraSprite(reduced ? 0 : fr, li, f[9] > 0, asuraPx());
    ctx.save(); ctx.translate(cx, cy - 2 * dpr); ctx.scale(face, 1);
    ctx.drawImage(s.c, -s.ox, -s.oy);
    ctx.restore();
  }

  // ------------------------------------------------------------ effects
  function splat(x, y, n, red, power = 1) {
    const max = reduced ? 60 : 320;
    for (let i = 0; i < n && parts.length < max; i++) {
      const a = R() * Math.PI * 2, v = (0.15 + R() * 0.5) * power;
      parts.push({ x, y, z: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.3 + R() * 0.6 * power, r: (0.6 + R() * 1.9) * dpr, red: red && R() < 0.8, life: 0.7 + R() * 0.5 });
    }
  }
  function decal(x, y, s, red) {
    decals.push({ x, y, s, red, life: 8, seed: (R() * 1e9) | 0 });
    if (decals.length > 70) decals.shift();
  }
  function addText(x, y, txt, color, size) {
    if (texts.length > 70) texts.shift();
    texts.push({ x, y, txt, color, size, life: 0.9, vx: (R() - 0.5) * 0.05 });
  }

  function handle(ev) {
    for (let i = 0; i < ev.length; i += 6) {
      const t = ev[i], x = ev[i + 1], y = ev[i + 2], a = ev[i + 3], b = ev[i + 4], c = ev[i + 5];
      switch (t) {
        case EV.HIT:
          if (numbersOn) addText(x, y - 0.12, fmt(a) + (b ? '!' : ''), b ? RED : INK, b ? 19 : 14);
          if (slashes.length < 50) slashes.push({ x, y, ang: R() * Math.PI, life: 0.22, red: !!b, big: c === 2 });
          splat(x, y, b ? 6 : 2, !!b, b ? 1.2 : 0.7);
          if (b && !reduced) shake = Math.max(shake, 2);
          break;
        case EV.KILL:
          if (corpses.length < 24) corpses.push({ kind: b, x, y, life: c ? 0.9 : 0.55, max: c ? 0.9 : 0.55, face: x > 0 ? -1 : 1 });
          splat(x, y, c ? 40 : 12, false, c ? 2 : 1.1);
          splat(x, y, c ? 20 : 4, true, 1);
          decal(x, y, c ? 2.4 : 1, R() < 0.35 || !!c);
          if (numbersOn) addText(x, y - 0.06, '+' + fmt(a), WASH, 12);
          if (c && !reduced) shake = 8;
          break;
        case EV.ATTACK:
          if (swipes.length < 6) swipes.push({ x, y, life: 0.17, flip: R() < 0.5 });
          break;
        case EV.WRATH:
          rings.push({ r: 0.05, max: a, life: 0.6, red: true });
          rings.push({ r: 0.02, max: a * 0.8, life: 0.75, red: false });
          if (!reduced) shake = 10;
          break;
        case EV.CHAIN:
          bolts.push({ x, y, life: 0.2, seed: (R() * 1e9) | 0 });
          break;
        case EV.HURT:
          hurtFlash = Math.min(1, hurtFlash + 0.35);
          if (!reduced) shake = Math.max(shake, 3);
          break;
        case EV.HEAL:
          healFlash = 1;
          break;
      }
    }
  }

  // ------------------------------------------------------------ frame
  function draw(f, en, dt) {
    time += dt;
    pumpPrewarm();
    const t = time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let sx = 0, sy = 0;
    if (shake > 0 && !reduced) { sx = (R() - 0.5) * shake * dpr; sy = (R() - 0.5) * shake * dpr; shake = Math.max(0, shake - dt * 40); }
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.drawImage(bg, 0, 0);
    // parallax mountains drift slowly
    const drift = reduced ? 0 : t;
    ctx.globalAlpha = 1;
    ctx.drawImage(far, -W * 0.075 + Math.sin(drift * 0.03) * W * 0.04, 0);
    ctx.drawImage(near, -W * 0.075 + Math.sin(drift * 0.03 + 1) * W * 0.07, H * 0.0);
    // mist band over the mountain feet
    const mist = ctx.createLinearGradient(0, H * 0.22, 0, H * 0.4);
    mist.addColorStop(0, 'rgba(236,230,216,0)'); mist.addColorStop(0.5, 'rgba(236,230,216,.85)'); mist.addColorStop(1, 'rgba(236,230,216,0)');
    ctx.fillStyle = mist; ctx.fillRect(0, H * 0.22, W, H * 0.18);

    // ground decals
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]; d.life -= dt;
      if (d.life <= 0) { decals.splice(i, 1); continue; }
      const r = rng(d.seed), a = Math.min(1, d.life / 3) * 0.5;
      ctx.fillStyle = d.red ? `rgba(160,24,32,${a})` : `rgba(22,20,18,${a})`;
      const X = toX(d.x), Y = toY(d.y), s = d.s * 6 * dpr;
      for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(X + (r() - 0.5) * s * 2.4, Y + (r() - 0.5) * s, s * (0.3 + r() * 0.6), s * (0.2 + r() * 0.4), 0, 0, Math.PI * 2); ctx.fill(); }
    }

    // range circle
    brushRing(f[1], reduced ? 0 : t);
    // storm aura
    if (f[7] > 0) {
      ctx.save(); ctx.translate(cx, cy);
      const pulse = 0.5 + Math.sin(t * 20) * 0.5;
      ctx.strokeStyle = `rgba(22,20,18,${0.25 + pulse * 0.25})`; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.ellipse(0, -0.12 * scale, 0.14 * scale, 0.16 * scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (f[8] > 0) { // blood beads — red mala circling
      ctx.save(); ctx.translate(cx, cy - 0.1 * scale);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * (reduced ? 0 : 1.2);
        const bx = Math.cos(a) * 0.17 * scale, by = Math.sin(a) * 0.17 * scale * SQ;
        circ(ctx, bx, by, 3.6 * dpr, RED); circ(ctx, bx - dpr, by - dpr, 1.1 * dpr, 'rgba(255,220,220,.8)');
      }
      ctx.restore();
    }

    // dissolving corpses: melt into the paper as ink
    for (let i = corpses.length - 1; i >= 0; i--) {
      const k = corpses[i]; k.life -= dt;
      if (k.life <= 0) { corpses.splice(i, 1); continue; }
      const l = k.life / k.max, spr = enemySprite(k.kind, 0, enemyPx(k.kind));
      ctx.save(); ctx.globalAlpha = l * 0.9; ctx.translate(toX(k.x), toY(k.y));
      ctx.scale(k.face * (1 + (1 - l) * 0.35), 0.35 + 0.65 * l);
      ctx.drawImage(l > 0.7 ? flashOf(spr) : spr.c, -spr.ox, -spr.oy);
      ctx.restore();
      if (!reduced && R() < dt * 30 && wisps.length < 60) wisps.push({ x: k.x + (R() - 0.5) * 0.06, y: k.y, h: 0.05, life: 0.9, r: (2 + R() * 3) * dpr });
    }

    // shockwaves
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.life -= dt;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      r.r += (r.max - r.r) * Math.min(1, dt * 9);
      ctx.save(); ctx.translate(cx, cy);
      ctx.strokeStyle = r.red ? `rgba(179,32,42,${r.life})` : `rgba(22,20,18,${r.life * 0.8})`;
      ctx.lineWidth = (r.red ? 7 : 3) * dpr * (0.4 + r.life);
      ctx.beginPath(); ctx.ellipse(0, 0, r.r * scale, r.r * scale * SQ, 0, 0, Math.PI * 2); ctx.stroke();
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
      const X = toX(x), Y = toY(y), px = enemyPx(kind);
      const fade = Math.min(1, age / 0.6);
      ctx.save();
      ctx.globalAlpha = fade;
      // soft wash shadow
      ctx.fillStyle = 'rgba(22,20,18,.2)';
      const fly = kind === 5 || kind === 6 || kind === 9 || kind === 12;
      ctx.beginPath(); ctx.ellipse(X, Y, px * (fly ? 0.2 : 0.3), px * 0.075, 0, 0, Math.PI * 2); ctx.fill();
      const face = x > 0 ? -1 : 1;
      const d = Math.hypot(x, y);
      const cad = CADENCE[kind] || 6;
      const melee = d < 0.2;
      const ph = reduced ? phase : (melee ? t * 3 : t * cad * (slow > 0 ? 0.4 : 1)) + phase;
      const fr = Math.floor(((((ph / TAU) % 1) + 1) % 1) * FRAMES) % FRAMES;
      const spr = enemySprite(kind, fr, px);
      ctx.translate(X + (melee && !reduced ? Math.sin(t * 9 + phase) * px * 0.04 * -Math.sign(x) : 0), Y);
      ctx.scale(face, 1);
      if (kind === 6 || kind === 12) ctx.globalAlpha = fade * 0.88;
      ctx.drawImage(flash > 0 ? flashOf(spr) : spr.c, -spr.ox, -spr.oy);
      ctx.restore();
      // hp bar
      if (hp < 0.999 || boss) {
        const bw = Math.max(22 * dpr, px * (boss ? 0.9 : 0.6)), bh = (boss ? 5 : 3.2) * dpr;
        const by = Y - px * (boss ? 1.25 : 1.05) - 4 * dpr;
        ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(236,230,216,.85)'; ctx.fillRect(X - bw / 2, by, bw, bh);
        ctx.fillStyle = boss ? RED : INK; ctx.fillRect(X - bw / 2, by, bw * hp, bh);
        ctx.strokeStyle = INK; ctx.lineWidth = dpr; ctx.strokeRect(X - bw / 2, by, bw, bh);
        ctx.globalAlpha = 1;
      }
    };
    for (const i of order) {
      if (!asuraDrawn && en[i * 11 + 3] > 0) { drawAsura(f, t); asuraDrawn = true; }
      drawEnemy(i);
    }
    if (!asuraDrawn) drawAsura(f, t);

    // ink smoke rising off the Asura
    if (!reduced && R() < dt * (f[7] > 0 ? 18 : 5) && wisps.length < 60) wisps.push({ x: (R() - 0.5) * 0.1, y: (R() - 0.5) * 0.04, h: 0.02, life: 1.3, r: (2 + R() * 4) * dpr, red: f[8] > 0 && R() < 0.5 });
    for (let i = wisps.length - 1; i >= 0; i--) {
      const w = wisps[i]; w.life -= dt; w.h += dt * 0.09; w.x += Math.sin(time * 2 + i) * dt * 0.02;
      if (w.life <= 0) { wisps.splice(i, 1); continue; }
      ctx.fillStyle = w.red ? `rgba(179,32,42,${w.life * 0.18})` : `rgba(22,20,18,${w.life * 0.08})`;
      ctx.beginPath(); ctx.arc(toX(w.x), toY(w.y) - w.h * scale, w.r * (1.8 - w.life), 0, Math.PI * 2); ctx.fill();
    }
    // the Asura's strike arcs — a tapered crescent of ink toward the target
    for (let i = swipes.length - 1; i >= 0; i--) {
      const sw = swipes[i]; sw.life -= dt;
      if (sw.life <= 0) { swipes.splice(i, 1); continue; }
      const ox = cx, oy = cy - 0.17 * scale;
      const a = Math.atan2(toY(sw.y) - 0.07 * scale - oy, toX(sw.x) - ox);
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
      const X = toX(s.x), Y = toY(s.y) - 0.07 * scale, L = (s.big ? 0.1 : 0.065) * scale;
      const p = 1 - s.life / 0.22;
      ctx.save(); ctx.translate(X, Y); ctx.rotate(s.ang);
      ctx.fillStyle = s.red ? `rgba(179,32,42,${s.life * 4})` : `rgba(22,20,18,${s.life * 4})`;
      ctx.beginPath();
      ctx.moveTo(-L, 0); ctx.quadraticCurveTo(0, -L * 0.45 * (0.6 + p), L, 0); ctx.quadraticCurveTo(0, -L * 0.15, -L, 0);
      ctx.fill(); ctx.restore();
    }
    // lightning
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.life -= dt;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      const r = rng(b.seed + ((t * 30) | 0));
      const x0 = cx, y0 = cy - 0.3 * scale, x1 = toX(b.x), y1 = toY(b.y) - 0.07 * scale;
      for (const [w, c] of [[4, `rgba(22,20,18,${b.life * 4})`], [1.4, `rgba(210,58,58,${b.life * 5})`]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w * dpr; ctx.beginPath(); ctx.moveTo(x0, y0);
        for (let k = 1; k < 8; k++) { const q = k / 8; ctx.lineTo(x0 + (x1 - x0) * q + (r() - 0.5) * 16 * dpr, y0 + (y1 - y0) * q + (r() - 0.5) * 16 * dpr); }
        ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    // particles
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life -= dt;
      p.x += p.vx * dt * 0.5; p.y += p.vy * dt * 0.5; p.vz -= dt * 2.2; p.z = Math.max(0, p.z + p.vz * dt * 0.3);
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.fillStyle = p.red ? `rgba(179,32,42,${Math.min(1, p.life * 2)})` : `rgba(22,20,18,${Math.min(1, p.life * 2)})`;
      ctx.beginPath(); ctx.ellipse(toX(p.x), toY(p.y) - p.z * scale * 0.4 - 0.06 * scale, p.r * 1.8, p.r * 0.8, Math.atan2(p.vy * SQ - p.vz * 0.4, p.vx), 0, Math.PI * 2); ctx.fill();
    }
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
      ctx.strokeText(tx.txt, toX(tx.x), toY(tx.y) - 0.1 * scale);
      ctx.fillStyle = tx.color; ctx.fillText(tx.txt, toX(tx.x), toY(tx.y) - 0.1 * scale);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // vignettes
    if (f[7] > 0) {
      const g2 = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7);
      g2.addColorStop(0, 'rgba(22,20,18,0)'); g2.addColorStop(1, `rgba(22,20,18,${0.35 + (reduced ? 0 : Math.random() * 0.1)})`);
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    }
    if (hurtFlash > 0) {
      const g3 = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, Math.max(W, H) * 0.7);
      g3.addColorStop(0, 'rgba(179,32,42,0)'); g3.addColorStop(1, `rgba(179,32,42,${hurtFlash * 0.4})`);
      ctx.fillStyle = g3; ctx.fillRect(0, 0, W, H);
      hurtFlash = Math.max(0, hurtFlash - dt * 2);
    }
    if (healFlash > 0) {
      ctx.fillStyle = `rgba(179,32,42,${healFlash * 0.12})`; ctx.fillRect(0, 0, W, H);
      healFlash = Math.max(0, healFlash - dt * 1.5);
    }
  }

  return {
    resize, draw, handle,
    setReduced(v) { reduced = v || matchMedia('(prefers-reduced-motion: reduce)').matches; },
    setNumbers(v) { numbersOn = v; },
  };
}
