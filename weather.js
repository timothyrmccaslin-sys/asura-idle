// Painterly weather and light per theme (v3.2.2). Everything is sumi-e wash:
// fog banks and cloud shadows lie on the perspective ground plane, smoke plumes
// rise from the hell gate, rain lands as ink ripple rings, lanterns flicker and
// moonlight falls in pale shafts. A seeded plan per 10-wave block picks the mix
// (rain or not, fog density, how many plumes/shafts), so a reload looks the same.
// Cheap by construction: ground washes are painted into a quarter-res layer from
// cached scrolling textures, particles are pooled and capped, and the combat
// circle is masked lighter so fighters stay readable. Reduced effects freezes all
// motion (static wash only); lite mode halves the work.
import { px, py, depth, aspect, circleBox } from './cam.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const LAYER = 0.25; // ground-wash layer resolution

export function createWeather() {
  let V = null, plan = null, t = 0, lay = null, frame = 0;
  const tex = {};
  const ripples = [], puffs = [];
  const gust = { v: 0, t: 0, next: 5, streaks: [] };

  // tileable wash band: soft blotches + dry-brush streaks, wrapped horizontally
  function bandTex(kind) {
    if (tex[kind]) return tex[kind];
    const W = 256, H = 64, c = mk(W, H), g = c.getContext('2d'), r = rng(kind.length * 977 + 13);
    const col = kind === 'smoke' ? '34,30,28' : kind === 'ghost' ? '226,230,242' : '242,238,228';
    for (let i = 0; i < 46; i++) {
      const x = r() * W, y = H * (0.3 + r() * 0.45), rx = 14 + r() * 40, ry = rx * (0.25 + r() * 0.25), a = 0.4 + r() * 0.35;
      for (const ox of [-W, 0, W]) {
        const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rx);
        gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
        g.save(); g.translate(x + ox, y); g.scale(1, ry / rx); g.translate(-(x + ox), -y);
        g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y, rx, 0, 6.29); g.fill(); g.restore();
      }
    }
    // dry-brush streaks so it reads as a painted wash, not a blur
    g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const x = r() * W, y = H * (0.35 + r() * 0.35), l = 30 + r() * 70;
      g.strokeStyle = `rgba(${col},${0.08 + r() * 0.1})`; g.lineWidth = 1 + r() * 3;
      for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y - 2 + r() * 4, x + ox + l, y + (r() - 0.5) * 3); g.stroke(); }
    }
    // a faint grey underside on mist so the pale bank reads against pale paper
    if (kind !== 'smoke') for (let i = 0; i < 12; i++) {
      const x = r() * W, y = H * (0.58 + r() * 0.12), l = 40 + r() * 80;
      g.strokeStyle = `rgba(96,92,86,${0.07 + r() * 0.07})`; g.lineWidth = 2 + r() * 3;
      for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(x + ox, y); g.quadraticCurveTo(x + ox + l / 2, y + 2 + r() * 3, x + ox + l, y); g.stroke(); }
    }
    // feather the top and bottom so bands never show a hard edge
    g.globalCompositeOperation = 'destination-in';
    const fe = g.createLinearGradient(0, 0, 0, H);
    fe.addColorStop(0, 'rgba(0,0,0,0)'); fe.addColorStop(0.35, 'rgba(0,0,0,1)'); fe.addColorStop(0.7, 'rgba(0,0,0,1)'); fe.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fe; g.fillRect(0, 0, W, H);
    return (tex[kind] = c);
  }
  // blotchy ink blob (cloud shadow, smoke puff)
  function blobTex(kind) {
    if (tex['b' + kind]) return tex['b' + kind];
    const S = 96, c = mk(S, S), g = c.getContext('2d'), r = rng(kind === 'smoke' ? 71 : 29);
    const col = kind === 'smoke' ? '38,34,32' : '22,20,18';
    for (let i = 0; i < 14; i++) {
      const a = r() * 6.28, d = r() * S * 0.22, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, rr = S * (0.14 + r() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(${col},${0.22 + r() * 0.14})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 6.29); g.fill();
    }
    return (tex['b' + kind] = c);
  }

  function setPlan(key, seed, opts) {
    const r = rng(seed);
    const p = { key, fog: null, shadows: [], plumes: [], glow: 0, shimmer: false, gusts: false, banners: [], lights: opts.lights || [], shafts: [], ripples: !!opts.rain };
    const shadows = (n) => { for (let i = 0; i < n; i++) p.shadows.push({ x: -3 + r() * 6, y: -1.2 + r() * 2.3, s: 0.8 + r() * 0.8, v: 0.05 + r() * 0.05 }); };
    if (key === 'oni') {
      p.fog = { kind: 'smoke', dens: 0.35 + r() * 0.35, bands: 2, far: true };
      const n = 2 + ((r() * 3) | 0);
      for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; p.plumes.push({ x: side * (1.5 + r() * 0.9), y: -0.5 - r() * 1.1, rate: 0.6 + r() * 0.5, acc: r() }); }
      p.glow = 0.1 + r() * 0.08; p.shimmer = true;
    } else if (key === 'tengu') {
      p.fog = { kind: 'mist', dens: 0.45 + r() * 0.45, bands: 4, far: false };
      shadows(2 + ((r() * 2) | 0)); p.gusts = true;
    } else if (key === 'shogun') {
      if (r() < 0.75) shadows(2);
      if (r() < 0.35) p.fog = { kind: 'mist', dens: 0.25 + r() * 0.2, bands: 2, far: true };
      const n = 1 + ((r() * 2) | 0);
      for (let i = 0; i < n; i++) { const side = (i === 0 ? (r() < 0.5 ? -1 : 1) : -p.banners[0].side); p.banners.push({ side, fx: side > 0 ? 0.86 + r() * 0.08 : 0.06 + r() * 0.08, y: -0.55 - r() * 0.6, ph: r() * 6.28 }); }
    } else if (key === 'orochi') {
      p.fog = { kind: 'mist', dens: 0.6 + r() * 0.35, bands: 5, far: false, low: true };
      if (r() < 0.5) shadows(1);
    } else if (key === 'onryo') {
      p.fog = { kind: 'ghost', dens: 0.35 + r() * 0.4, bands: 3, far: false };
      if (r() < 0.7) { const n = 2 + ((r() * 2) | 0); for (let i = 0; i < n; i++) p.shafts.push({ x: 0.1 + r() * 0.8, w: 0.05 + r() * 0.07, a: 0.2 + r() * 0.1, ph: r() * 6.28 }); }
    }
    plan = p; ripples.length = 0; puffs.length = 0; gust.v = 0; gust.next = 4 + r() * 5;
  }

  function step(dt, quality, cam) {
    if (!plan || !V) return;
    if (quality === 'reduced') { gust.v = 0; puffs.length = 0; ripples.length = 0; return; }
    t += dt; frame++;
    const lite = quality === 'lite', R = Math.random;
    // gusts sweep through the peaks every few seconds
    if (plan.gusts) {
      gust.next -= dt;
      if (gust.next <= 0) { gust.t = 2.6; gust.next = 7 + R() * 7; gust.streaks = []; for (let i = 0; i < (lite ? 3 : 6); i++) gust.streaks.push({ y: 0.25 + R() * 0.6, d: R() * 0.6, l: 0.25 + R() * 0.3, k: (R() - 0.5) * 0.06 }); }
      gust.t = Math.max(0, gust.t - dt);
      const want = gust.t > 0 ? Math.sin(Math.PI * (1 - gust.t / 2.6)) : 0;
      gust.v += (want - gust.v) * Math.min(1, dt * 4);
    }
    for (const s of plan.shadows) { s.x += s.v * dt * (1 + gust.v * 2); if (s.x > 3.4) s.x = -3.4; }
    // smoke plumes: pooled puffs rising from seeded vents
    if (cam) for (const pl of plan.plumes) {
      pl.acc += dt * pl.rate * (lite ? 0.5 : 1);
      while (pl.acc >= 1 && puffs.length < (lite ? 14 : 30)) {
        pl.acc -= 1;
        puffs.push({ x: px(cam, pl.x, pl.y) + (R() - 0.5) * 10 * V.dpr, y: py(cam, pl.y), d: depth(cam, pl.y), life: 0, max: 5 + R() * 3, vx: (R() - 0.3) * 0.012, s: 0.5 + R() * 0.4, rot: R() * 6.28 });
      }
      if (pl.acc > 1) pl.acc = 1;
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i]; q.life += dt;
      if (q.life > q.max) { puffs.splice(i, 1); continue; }
      q.y -= V.H * 0.035 * q.d * dt; q.x += V.H * q.vx * dt;
    }
    // rain ripples land anywhere on the ground plane
    if (plan.ripples) {
      const rate = lite ? 7 : 18;
      let n = dt * rate; while (n > 0) { if (R() < n && ripples.length < 40) ripples.push({ x: -2.2 + R() * 4.4, y: -1.5 + R() * 2.9, life: 0, max: 0.7 + R() * 0.4, s: 0.6 + R() * 0.6 }); n -= 1; }
    }
    for (let i = ripples.length - 1; i >= 0; i--) { const q = ripples[i]; q.life += dt; if (q.life > q.max) ripples.splice(i, 1); }
  }

  // ground washes into the quarter-res layer, then masked over the combat circle
  function paintLayer(cam, quality) {
    const { W, H } = V, lw = Math.ceil(W * LAYER), lh = Math.ceil(H * LAYER);
    if (!lay || lay.width !== lw || lay.height !== lh) lay = mk(lw, lh);
    const g = lay.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, lw, lh);
    g.setTransform(LAYER, 0, 0, LAYER, 0, 0);
    const still = quality === 'reduced', lite = quality === 'lite';
    // cloud shadows: blotches squashed onto the ground at their depth
    if (plan.shadows.length) {
      const bt = blobTex('shadow');
      for (const s of plan.shadows) {
        const X = px(cam, s.x, s.y), Y = py(cam, s.y), w = s.s * cam.gs * depth(cam, s.y) * 1.6, h = w * aspect(cam, s.y);
        g.globalAlpha = 0.42; g.drawImage(bt, X - w / 2, Y - h / 2, w, h);
      }
    }
    // fog banks: horizontal bands on ground rows, scrolling with parallax
    if (plan.fog) {
      const f = plan.fog, bt = bandTex(f.kind), nb = lite ? Math.max(1, Math.ceil(f.bands / 2)) : f.bands;
      const yFar = -cam.D0 * 0.62, yNear = f.kind === 'smoke' ? -1.25 : f.far ? -0.6 : f.low ? 1.35 : 1.1;
      for (let i = 0; i < nb; i++) {
        const k = nb === 1 ? 0.3 : i / (nb - 1), wy = yFar + (yNear - yFar) * k, d = depth(cam, wy);
        const Y = py(cam, wy), bh = cam.gs * d * (f.low ? 0.75 : 0.95) * cam.q * 2.2, sc = bh / bt.height, tw = bt.width * sc * 1.8;
        const off = still ? i * 37 : ((t * (6 + i * 3) * d * (1 + gust.v * 3) * V.dpr + i * 97) % tw + tw) % tw;
        g.globalAlpha = Math.min(1, f.dens * (0.6 + 0.4 * (1 - k)) * (f.kind === 'smoke' ? 0.38 : 1.25));
        for (let x = -off; x < W; x += tw) g.drawImage(bt, x, Y - bh * 0.55, tw, bh);
        const off2 = (off * 1.7 + tw * 0.45) % tw;
        for (let x = -off2; x < W; x += tw) g.drawImage(bt, x, Y - bh * 0.35, tw, bh * 0.8);
      }
    }
    // smoke puffs
    if (puffs.length) {
      const bt = blobTex('smoke');
      for (const q of puffs) {
        const u = q.life / q.max, s = (0.6 + u * 2.2) * q.s * V.H * 0.12 * q.d;
        g.globalAlpha = Math.min(1, q.life / 0.8) * (1 - u) * 0.9;
        g.drawImage(bt, q.x - s / 2, q.y - s / 2, s, s);
      }
    }
    // calm the combat circle: wash it back out so fighters read cleanly
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-out';
    const cb = circleBox(cam, 1.2);
    g.save(); g.translate(cam.cx, cb.cy); g.scale(1, cb.ry / cb.rx);
    const cg = g.createRadialGradient(0, 0, 0, 0, 0, cb.rx);
    cg.addColorStop(0, 'rgba(0,0,0,.72)'); cg.addColorStop(0.65, 'rgba(0,0,0,.45)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.beginPath(); g.arc(0, 0, cb.rx, 0, 6.29); g.fill(); g.restore();
    g.globalCompositeOperation = 'source-over'; g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function flick(i) { return 0.78 + 0.12 * Math.sin(t * 7.3 + i * 2.1) + 0.07 * Math.sin(t * 17.9 + i) + 0.05 * Math.sin(t * 31 + i * 5); }

  function drawBack(ctx, cam, scene, quality) {
    if (!plan || !V || !cam) return;
    const { W, H, dpr } = V, still = quality === 'reduced', lite = quality === 'lite';
    // heat shimmer over the hell-gate horizon: scene slices nudged sideways
    if (plan.shimmer && quality === 'full') {
      // sample the frame already on the canvas so the band matches exactly
      const src = ctx.canvas, y0 = Math.max(0, cam.yH - H * 0.02), hh = H * 0.16, n = 14, sh = hh / n;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.45;
      for (let i = 0; i < n; i++) { const dx = Math.sin(t * 3.1 + i * 0.9) * 1.6 * dpr; const yy = Math.round(y0 + i * sh), hs = Math.round(sh) + 1; if (yy + hs > src.height) break; ctx.drawImage(src, 0, yy, src.width, hs, dx, yy, src.width, hs); }
      ctx.restore();
    }
    // red under-glow of the gate, breathing
    if (plan.glow) {
      const a = plan.glow * (still ? 1 : 0.85 + 0.15 * Math.sin(t * 1.3));
      const gy = cam.yH + H * 0.04, rx = W * 0.6;
      ctx.save(); ctx.translate(W / 2, gy); ctx.scale(1, 0.35);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, `rgba(186,36,28,${a})`); gr.addColorStop(1, 'rgba(186,36,28,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.29); ctx.fill(); ctx.restore();
      for (const sx of [0, W]) {
        const gr2 = ctx.createRadialGradient(sx, H, 0, sx, H, H * 0.45);
        gr2.addColorStop(0, `rgba(170,30,26,${a * 0.9})`); gr2.addColorStop(1, 'rgba(170,30,26,0)');
        ctx.fillStyle = gr2; ctx.fillRect(sx - H * 0.45, H * 0.55, H * 0.9, H * 0.45);
      }
    }
    // moonlight shafts
    if (plan.shafts.length) {
      ctx.save();
      for (const s of plan.shafts) {
        const a = s.a * (still ? 1 : 0.75 + 0.25 * Math.sin(t * 0.35 + s.ph));
        const x0 = W * s.x, w = W * s.w, x1 = x0 - W * 0.16, y1 = H * 0.98;
        const gr = ctx.createLinearGradient(0, 0, 0, y1);
        gr.addColorStop(0, `rgba(238,240,250,${a})`); gr.addColorStop(0.7, `rgba(238,240,250,${a * 0.6})`); gr.addColorStop(1, 'rgba(238,240,250,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + w, 0); ctx.lineTo(x1 + w * 2.2, y1); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // ground washes (fog, cloud shadows, smoke)
    if (!lite || frame % 2 === 0 || !lay) paintLayer(cam, quality);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(lay, 0, 0, W, H);
    // rain ripple rings on the ground
    if (ripples.length) {
      ctx.lineWidth = 1.4 * dpr;
      for (const q of ripples) {
        const u = q.life / q.max, X = px(cam, q.x, q.y), Y = py(cam, q.y), d = depth(cam, q.y);
        const rx = (0.02 + u * 0.085) * q.s * cam.gs * d, ry = rx * aspect(cam, q.y);
        const inside = q.x * q.x + q.y * q.y < 1.1 ? 0.5 : 1;
        ctx.strokeStyle = `rgba(30,28,26,${0.6 * (1 - u) * inside})`;
        ctx.beginPath(); ctx.ellipse(X, Y, rx, ry, 0, 0, 6.29); ctx.stroke();
        if (u < 0.5) { ctx.strokeStyle = `rgba(30,28,26,${0.3 * (1 - u * 2) * inside})`; ctx.beginPath(); ctx.ellipse(X, Y, rx * 0.5, ry * 0.5, 0, 0, 6.29); ctx.stroke(); }
      }
    }
    // rippling nobori banners in the courtyard
    for (const b of plan.banners) {
      const X = W * b.fx, Y = py(cam, b.y), d = depth(cam, b.y), h = V.scale * 0.42 * d;
      if (Math.hypot((X - cam.cx) / (cam.gs * d), b.y) < 1.15) continue;
      ctx.save(); ctx.translate(X, Y); if (b.side > 0) ctx.scale(-1, 1);
      ctx.strokeStyle = 'rgba(24,20,18,.9)'; ctx.lineWidth = Math.max(1.2 * dpr, h * 0.022); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.moveTo(-h * 0.02, -h * 0.96); ctx.lineTo(h * 0.26, -h * 0.96); ctx.stroke();
      const top = -h * 0.95, bot = -h * 0.3, cw = h * 0.24, N = 9, pts = [];
      for (let j = 0; j <= N; j++) {
        const v = j / N, yy = top + (bot - top) * v, wave = still ? 0 : Math.sin(t * 3.2 + v * 5 + b.ph) * h * 0.035 * v;
        pts.push([wave, yy, cw + (still ? 0 : Math.sin(t * 2.4 + v * 4 + b.ph) * h * 0.02 * v)]);
      }
      ctx.beginPath(); ctx.moveTo(0, top);
      for (const [w, yy, c] of pts) ctx.lineTo(c + w, yy);
      for (let j = N; j >= 0; j--) { const [w, yy] = pts[j]; ctx.lineTo(w * 0.2, yy); }
      ctx.closePath();
      ctx.fillStyle = 'rgba(232,226,212,.94)'; ctx.fill();
      ctx.strokeStyle = 'rgba(28,24,22,.75)'; ctx.lineWidth = Math.max(1, h * 0.01); ctx.stroke();
      const m = pts[3]; ctx.fillStyle = 'rgba(179,32,42,.9)';
      ctx.beginPath(); ctx.ellipse(m[0] + cw * 0.5, m[1] + h * 0.02, cw * 0.28, cw * 0.28, 0, 0, 6.29); ctx.fill();
      ctx.restore();
    }
    // lantern light: soft radial pools, flickering
    if (plan.lights.length) {
      for (let i = 0; i < plan.lights.length; i++) {
        const L = plan.lights[i], f = still ? 0.85 : flick(i), r = L.r * (0.92 + 0.08 * f);
        const gr = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
        gr.addColorStop(0, `rgba(255,190,110,${0.5 * f})`); gr.addColorStop(0.35, `rgba(240,130,60,${0.24 * f})`); gr.addColorStop(1, 'rgba(240,120,60,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(L.x, L.y, r, 0, 6.29); ctx.fill();
        ctx.save(); ctx.translate(L.x, L.gy); ctx.scale(1, 0.32);
        const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.2);
        g2.addColorStop(0, `rgba(230,140,70,${0.28 * f})`); g2.addColorStop(1, 'rgba(230,140,70,0)');
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, 6.29); ctx.fill(); ctx.restore();
      }
    }
  }

  function drawFront(ctx, quality) {
    if (!plan || !V) return;
    // gust streaks: a few pale dry-brush swishes crossing the screen
    if (plan.gusts && gust.v > 0.05 && quality !== 'reduced') {
      const { W, H, dpr } = V;
      ctx.lineCap = 'round';
      for (const s of gust.streaks) {
        const u = 1 - gust.t / 2.6 - s.d * 0.3, x = -W * 0.3 + (W * 1.6) * u, y = H * s.y, l = W * s.l;
        ctx.strokeStyle = `rgba(60,56,52,${0.16 * gust.v})`; ctx.lineWidth = 1.4 * dpr;
        ctx.beginPath(); ctx.moveTo(x - l, y); ctx.quadraticCurveTo(x - l / 2, y - H * 0.02 + H * s.k, x, y); ctx.stroke();
        ctx.strokeStyle = `rgba(236,230,216,${0.3 * gust.v})`; ctx.lineWidth = 0.8 * dpr;
        ctx.beginPath(); ctx.moveTo(x - l * 0.8, y + 2 * dpr); ctx.quadraticCurveTo(x - l * 0.4, y - H * 0.018 + H * s.k, x, y + 2 * dpr); ctx.stroke();
      }
    }
  }

  return {
    setView(v) { V = v; lay = null; },
    plan: setPlan,
    step, drawBack, drawFront,
    get gust() { return gust.v; },
    get info() { return plan && { key: plan.key, fog: plan.fog && +plan.fog.dens.toFixed(2), rain: plan.ripples, shadows: plan.shadows.length, plumes: plan.plumes.length, shafts: plan.shafts.length, lights: plan.lights.length, banners: plan.banners.length }; },
  };
}
