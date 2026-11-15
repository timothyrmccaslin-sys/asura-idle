// The Sorcerer: the third main character, in the same sumi-e language with a
// deep violet accent. His strikes are close bursts of violet energy thrown from
// the hands; his four spells are Arcane Bolts, Flame Wave, Chain Lightning and
// Frozen Hell. This module holds his move set (the shared animator with shorter
// lunges, his weight staying over his feet) and all of his FX: hand bursts,
// seeking arcane bolts, the flame-ink wave, inky violet chain lightning and the
// crackle on paralyzed foes, ice blocks on frozen foes, the Frozen Hell frost
// over the whole field, and shatter shards. Pure presentation.
import { MOVES } from './asura.js';

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------- moves
const M = JSON.parse(JSON.stringify(MOVES));
for (const k of Object.keys(M)) {
  const m = M[k];
  if (m.lunge) m.lunge = m.lunge.map(([u, v]) => [u, v * 0.55]); // he casts, he does not charge
  if (m.hop) m.hop = m.hop.map(([u, v]) => [u, v * (k === 'tornado' ? 0.7 : 0.6)]);
  if (m.trail) { m.trail.w = 0.1; m.trail.rx *= 0.85; m.trail.ry *= 0.9; }
}
M.palm.trail = { cx: 0.28, cy: -0.62, rx: 0.3, ry: 0.12, a0: PI * 0.85, a1: 0.1, t0: 0.16, w: 0.09 };
M.uppercut.trail = { cx: 0.26, cy: -0.6, rx: 0.2, ry: 0.42, a0: PI * 0.55, a1: -PI * 0.55, t0: 0.16, w: 0.09 };
M.crescent.base = 0.62;
export const SORC_MOVES = M;
// his spells: the painted gesture each cast plays
export const SORC_CAST = ['palm', 'slam', 'crescent', 'uppercut'];

export function sorcPick(c) {
  const vert = c.ty * c.SQ / (Math.hypot(c.tx, c.ty * c.SQ) || 1), r = Math.hypot(c.tx, c.ty) / (c.range || 1);
  if (c.combo > 0 && c.combo % 5 === 4) return c.lastN >= 3 ? 'roundhouse' : 'tornado';
  const pool = c.lastN >= 3 ? ['roundhouse', 'crescent', 'sweep', 'palm']
    : r < 0.55 ? (vert < -0.5 ? ['uppercut', 'palm', 'backfist'] : ['palm', 'backfist', 'palm', 'uppercut'])
    : vert > 0.5 ? ['sweep', 'crescent', 'palm'] : ['crescent', 'palm', 'backfist', 'crescent', 'uppercut'];
  let n = pool[c.i % pool.length];
  if (c.recent[0] === n) n = pool[(c.i + 1) % pool.length];
  return n;
}

// ---------------------------------------------------------------- colours
const INK = (a) => `rgba(18,14,30,${a})`;
const VIO = (a) => `rgba(122,63,208,${a})`;   // violet energy
const VIO2 = (a) => `rgba(78,36,150,${a})`;   // deep violet ink
const ICE = (a) => `rgba(206,228,246,${a})`;  // pale ice
const ICE2 = (a) => `rgba(150,186,232,${a})`; // icy blue
const LIL = (a) => `rgba(196,170,240,${a})`;  // lilac tinge in the ice
const SNOW = (a) => `rgba(248,250,255,${a})`;
const FLM = (a) => `rgba(206,58,28,${a})`;    // vermilion flame
const ORG = (a) => `rgba(240,132,40,${a})`;   // orange flame body
const GLD = (a) => `rgba(255,214,128,${a})`;  // flame core
const SMK = (a) => `rgba(40,32,30,${a})`;     // ink smoke

function prng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createIce() {
  const S = { X: 0, Y: 0, H: 100, scale: 100, dpr: 1, reduced: false, lite: false, proj: null, AY: 0.2, dx: 0, face: 1 };
  let now = 0, zeroAmt = 0, zeroR = 0.5, spin = 0, hellFlash = 0;
  const bursts = [], puffs = [], flames = [], bolts = [], arcs = [], shards = [], flakes = [], blooms = [], embers = [];
  const P = (x, y) => S.proj(x, y);
  const lift = (sz) => S.scale * 0.11 * sz; // a foe's chest above its feet
  const hand = () => [S.X + S.dx + S.face * S.H * 0.3, S.Y - S.H * 0.62];

  // a broken brush ring on the ground plane
  function groundRing(ctx, cx, cy, r, w, color, seed, gaps = 0.25, n0 = 0) {
    const rr = prng(seed), n = Math.max(24, Math.round(r * 90));
    let pen = false; ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = n0 + (i / n) * TAU, j = 1 + (rr() - 0.5) * 0.06;
      const [X, Y] = P(cx + Math.cos(a) * r * j, cy + Math.sin(a) * r * j);
      if (rr() < gaps) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }
  // a filled ring on the ground plane, following the perspective (r0 inner, r1 outer)
  function groundBand(ctx, cx, cy, r0, r1, color, seed) {
    const rr = prng(seed), n = 72; ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, j = 1 + (rr() - 0.5) * 0.04, [X, Y] = P(cx + Math.cos(a) * r1 * j, cy + Math.sin(a) * r1 * j); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    for (let i = n; i >= 0; i--) { const a = (i / n) * TAU, [X, Y] = P(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(X, Y); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function groundDisc(ctx, cx, cy, r, stops) {
    const [X, Y] = P(cx, cy), [, Y2] = P(cx, cy + r), [X3] = P(cx + r, cy);
    const rx = Math.abs(X3 - X) || 1, ry = Math.max(1, Math.abs(Y2 - Y));
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, rx);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.save(); ctx.translate(X, Y); ctx.scale(1, ry / rx); ctx.translate(-X, -Y);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, rx, 0, TAU); ctx.fill(); ctx.restore();
  }

  // ---- events
  // a close burst of violet energy from his hand onto a foe
  function onBurst(x, y, crit) {
    const [X, Y, sz] = P(x, y), [hx, hy] = hand();
    bursts.push({ hx, hy, X, Y: Y - lift(sz), sz, t: 0, life: crit ? 0.36 : 0.26, crit, seed: (Math.random() * 1e9) | 0 });
    if (bursts.length > 14) bursts.shift();
    if (!S.reduced) for (let i = 0; i < (S.lite ? 2 : crit ? 7 : 4); i++) spark(X, Y - lift(sz), crit ? 1.3 : 0.8, i % 3 === 0);
  }
  function onSplash(x, y) { // energy spilling onto packed foes
    const [X, Y, sz] = P(x, y);
    blooms.push({ X, Y: Y - lift(sz), r: S.H * 0.09 * sz, t: 0, life: 0.22, vio: true });
    if (blooms.length > 24) blooms.shift();
  }
  function onFrost(x, y, big) { // ice damage landing: a puff of frost
    const [X, Y, sz] = P(x, y);
    puffs.push({ X, Y: Y - lift(sz) * 0.8, r: S.H * (big ? 0.2 : 0.13) * sz, t: 0, life: big ? 0.5 : 0.38, seed: (Math.random() * 1e9) | 0 });
    if (puffs.length > 30) puffs.shift();
    if (!S.reduced) for (let i = 0; i < (S.lite ? 1 : 3); i++) spark(X, Y - lift(sz), 0.6, true);
  }
  function onFreeze(x, y, boss) {
    onFrost(x, y, boss);
    const [X, Y, sz] = P(x, y);
    blooms.push({ X, Y, r: S.H * 0.22 * sz * (boss ? 1.5 : 1), t: 0, life: 0.45, ground: true });
  }
  // Flame Wave: a ring of flame-ink rolls out from him to the spawn edge
  function onFlame(r) {
    flames.push({ t: 0, life: 0.95, max: r, seed: (Math.random() * 1e9) | 0 });
    if (flames.length > 3) flames.shift();
  }
  function onEmber(x, y) { // a foe singed by the wave
    if (S.reduced || embers.length > 90) return;
    const [X, Y, sz] = P(x, y);
    for (let i = 0; i < (S.lite ? 1 : 3); i++) embers.push({ x: X + (Math.random() - 0.5) * S.H * 0.15 * sz, y: Y - lift(sz) * Math.random(), vx: (Math.random() - 0.5) * S.H * 0.3, vy: -S.H * (0.4 + Math.random() * 0.6), r: S.H * (0.006 + Math.random() * 0.008), life: 0.5 + Math.random() * 0.4, t: 0 });
  }
  // Arcane Bolts: violet orbs leave his hand one after another and seek the furthest foes
  function onBolt(x, y, k) {
    const [X, Y, sz] = P(x, y), [hx, hy] = hand();
    const side = k % 2 ? -1 : 1;
    bolts.push({ ox: hx, oy: hy, X, Y: Y - lift(sz) * 0.8, sz, t: -k * 0.08, fly: 0.34, life: 0.6, cx: (hx + X) / 2 + side * S.H * 0.35 * (k + 1) * 0.5, cy: Math.min(hy, Y) - S.H * (0.7 + 0.25 * k), hit: false, seed: (Math.random() * 1e9) | 0 });
    if (bolts.length > 9) bolts.shift();
  }
  // Chain Lightning: one hop from (px, py) (his hands for the first) to the foe at (x, y)
  function onArc(x, y, k, px, py) {
    const [X, Y, sz] = P(x, y);
    let ax, ay;
    if (k === 0) [ax, ay] = hand(); else { const [PX, PY, ps] = P(px, py); ax = PX; ay = PY - lift(ps) * 0.8; }
    arcs.push({ ax, ay, X, Y: Y - lift(sz) * 0.8, sz, t: -k * 0.07, life: 0.42, seed: (Math.random() * 1e9) | 0, k, flashed: false });
    if (arcs.length > 12) arcs.shift();
  }
  // Frozen Hell: a white-out flash, then frost over the whole field (the field itself rides f[27..28])
  function onHell() {
    hellFlash = 1;
    if (S.reduced) return;
    for (let i = 0; i < (S.lite ? 10 : 26); i++) {
      const a = Math.random() * TAU, d = 0.05 + Math.random() * 0.12, [X, Y] = P(Math.cos(a) * d, Math.sin(a) * d + S.AY * 0.5);
      spark(X, Y - S.H * 0.2, 1.8, true);
    }
  }
  function onShatter(x, y) {
    const [X, Y, sz] = P(x, y), cy = Y - lift(sz) * 0.9;
    blooms.push({ X, Y: cy, r: S.H * 0.26 * sz, t: 0, life: 0.3, white: true });
    if (S.reduced) return;
    for (let i = 0; i < (S.lite ? 6 : 14) && shards.length < 120; i++) {
      const a = -PI / 2 + (Math.random() - 0.5) * PI * 1.6, v = S.H * (0.8 + Math.random() * 1.8) * sz;
      shards.push({ x: X + (Math.random() - 0.5) * S.H * 0.1 * sz, y: cy + (Math.random() - 0.5) * S.H * 0.15 * sz, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        gy: Y + S.H * 0.03, r: S.H * (0.02 + Math.random() * 0.035) * sz, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 18, life: 0.9, lil: Math.random() < 0.35 });
    }
  }
  function spark(X, Y, power, ice) {
    if (shards.length > 140) return;
    const a = Math.random() * TAU, v = S.H * (0.5 + Math.random()) * power;
    shards.push({ x: X, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - S.H * 0.4, gy: Y + S.H * 0.2, r: S.H * 0.008 * (1 + Math.random()), rot: a, vr: 0, life: 0.35 + Math.random() * 0.2, spark: true, ice });
  }

  function update(dt, f, env) {
    Object.assign(S, env);
    now += dt; spin += dt;
    const zl = f[27] || 0;
    if (f[28] > 0) zeroR = f[28];
    zeroAmt = clamp(zeroAmt + (zl > 0 ? dt * 2.5 : -dt * 1.4), 0, 1);
    const age = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t > arr[i].life) arr.splice(i, 1); } };
    age(bursts); age(puffs); age(blooms); age(flames); age(bolts); age(arcs); age(embers);
    hellFlash = Math.max(0, hellFlash - dt * 2.2);
    for (const l of bolts) if (!l.hit && l.t >= l.fly) {
      l.hit = true; blooms.push({ X: l.X, Y: l.Y, r: S.H * 0.2 * l.sz, t: 0, life: 0.3, vio: true });
      if (!S.reduced) for (let i = 0; i < (S.lite ? 2 : 6); i++) spark(l.X, l.Y, 1.0, i % 3 === 0);
    }
    for (const c of arcs) if (!c.flashed && c.t >= 0) {
      c.flashed = true; blooms.push({ X: c.X, Y: c.Y, r: S.H * 0.16 * c.sz, t: 0, life: 0.22, vio: true });
      if (!S.reduced) for (let i = 0; i < (S.lite ? 1 : 4); i++) spark(c.X, c.Y, 0.9, false);
    }
    for (const e of embers) { e.vy += S.H * 0.25 * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
    for (let i = shards.length - 1; i >= 0; i--) {
      const p = shards[i]; p.vy += S.H * (p.spark ? 3 : 7) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt;
      if (p.life <= 0 || (p.vy > 0 && p.y >= p.gy)) shards.splice(i, 1);
    }
    // Frozen Hell: snow falling over the whole field
    if (zeroAmt > 0.02) {
      const rate = (S.reduced ? 14 : S.lite ? 45 : 120) * zeroAmt;
      let k = rate * dt;
      while (k > 0) { if (Math.random() < k) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * zeroR; flakes.push({ x: Math.cos(a) * d, y: Math.sin(a) * d + S.AY * 0.5, h: 0.5 + Math.random() * 0.6, v: 0.25 + Math.random() * 0.3, ph: Math.random() * TAU, s: 0.6 + Math.random() * 0.8 }); } k -= 1; }
    }
    for (let i = flakes.length - 1; i >= 0; i--) { const p = flakes[i]; p.h -= p.v * dt; p.x += Math.sin(now * 2 + p.ph) * dt * 0.02; if (p.h <= 0) flakes.splice(i, 1); }
    if (flakes.length > 220) flakes.splice(0, flakes.length - 220);
  }

  // ---- drawing: ground layer (under the figures)
  function drawGround(ctx) {
    if (!S.proj) return;
    const d = S.dpr;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (zeroAmt > 0.01) {
      const a = zeroAmt, r = zeroR;
      groundBand(ctx, 0, S.AY * 0.5, 0, r, ICE(0.22 * a), 10);
      groundBand(ctx, 0, S.AY * 0.5, r * 0.55, r, LIL(0.1 * a), 14);
      groundRing(ctx, 0, S.AY * 0.5, r, S.H * 0.05 * a + d, ICE2(0.45 * a), 11, 0.12, spin * 0.15);
      groundRing(ctx, 0, S.AY * 0.5, r * 1.01, S.H * 0.014 * a + d, VIO2(0.75 * a), 12, 0.35, spin * 0.15);
      groundRing(ctx, 0, S.AY * 0.5, r * 0.62, 1.6 * d, SNOW(0.7 * a), 13, 0.45, -spin * 0.25);
      // frost crystals etched into the ground
      if (!S.reduced) {
        const rr = prng(77);
        for (let i = 0; i < (S.lite ? 10 : 22); i++) {
          const ang = rr() * TAU, dd = Math.sqrt(rr()) * r * 0.95, [X, Y, sz] = P(Math.cos(ang) * dd, Math.sin(ang) * dd + S.AY * 0.5);
          const L = S.H * 0.06 * sz * (0.6 + rr()), tw = 0.6 + 0.4 * Math.sin(now * 3 + i);
          ctx.strokeStyle = i % 4 ? SNOW(0.65 * a * tw) : LIL(0.8 * a * tw); ctx.lineWidth = 1.2 * d;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) { const q = (k / 3) * PI; ctx.moveTo(X - Math.cos(q) * L, Y - Math.sin(q) * L * 0.35); ctx.lineTo(X + Math.cos(q) * L, Y + Math.sin(q) * L * 0.35); }
          ctx.stroke();
        }
      }
    }
    // Flame Wave: a scorched band and a crest of flame-ink tongues rolling outward
    for (const n of flames) {
      const q = n.t / n.life, r = 0.06 + (n.max - 0.06) * (1 - Math.pow(1 - Math.min(1, q * 1.15), 2.2)), a = Math.min(1, (1 - q) * 2.2);
      const cy0 = S.AY * 0.5;
      groundBand(ctx, 0, cy0, r * 0.62, r * 0.93, SMK(0.12 * a), n.seed);
      groundBand(ctx, 0, cy0, r * 0.9, r * 1.0, FLM(0.3 * a), n.seed + 1);
      groundRing(ctx, 0, cy0, r * 0.97, S.H * 0.035 * a + d, SMK(0.5 * a), n.seed + 2, 0.35);
      groundRing(ctx, 0, cy0, r, S.H * 0.02 * a + d, ORG(0.8 * a), n.seed + 3, 0.12);
      if (S.reduced) continue;
      const rr = prng(n.seed + 9), m = S.lite ? 30 : 64, items = [];
      for (let i = 0; i < m; i++) {
        const ang = (i / m) * TAU + rr() * 0.08, jit = 1 + (rr() - 0.5) * 0.05;
        const [X, Y, sz] = P(Math.cos(ang) * r * jit, Math.sin(ang) * r * jit + cy0);
        items.push({ X, Y, sz, i, h0: 0.22 + rr() * 0.22, w0: 0.05 + rr() * 0.03, ph: rr() * TAU });
      }
      items.sort((u, v) => u.Y - v.Y);
      for (const it of items) {
        const { X, Y, sz, i } = it, fl = 0.7 + 0.3 * Math.sin(now * 24 + it.ph);
        const h = S.H * it.h0 * sz * a * fl, w = S.H * it.w0 * sz * (0.6 + 0.4 * a);
        const sway = Math.sin(now * 13 + it.ph) * w * 0.9;
        const tongue = (k, dx) => {
          ctx.beginPath(); ctx.moveTo(X - w * k + dx, Y);
          ctx.bezierCurveTo(X - w * k * 1.1 + dx, Y - h * k * 0.45, X + sway * k - w * 0.5 * k + dx, Y - h * k * 0.7, X + sway * k * 1.4 + dx, Y - h * k);
          ctx.bezierCurveTo(X + sway * k + w * 0.4 * k + dx, Y - h * k * 0.62, X + w * k * 1.05 + dx, Y - h * k * 0.4, X + w * k + dx, Y);
          ctx.closePath();
        };
        tongue(1.12, 0); ctx.fillStyle = SMK(0.55 * a); ctx.fill();
        tongue(1, 0); ctx.fillStyle = FLM(0.9 * a); ctx.fill();
        tongue(0.7, w * 0.15); ctx.fillStyle = ORG(0.9 * a); ctx.fill();
        tongue(0.38, w * 0.1); ctx.fillStyle = GLD(0.85 * a); ctx.fill();
        if (i % 5 === 0) { // ink smoke curling off the crest
          const sy = Y - h * (1.1 + 0.3 * Math.sin(now * 3 + i)), sr = w * 1.6;
          ctx.fillStyle = SMK(0.18 * a); ctx.beginPath(); ctx.arc(X + sway * 2, sy, sr, 0, TAU); ctx.fill();
        }
      }
    }
    for (const b of blooms) {
      if (!b.ground) continue;
      const q = b.t / b.life, a = 1 - q;
      ctx.strokeStyle = ICE2(0.7 * a); ctx.lineWidth = 2 * d;
      ctx.beginPath(); ctx.ellipse(b.X, b.Y, b.r * (0.4 + q), b.r * (0.4 + q) * 0.32, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  // the ice block encasing a frozen foe (called per foe, right after it is drawn)
  function drawFrozen(ctx, X, Y, h, sz, left, seed, boss) {
    const d = S.dpr, rr = prng(seed * 7919 + 13), w = h * (boss ? 0.62 : 0.5), top = Y - h * 1.02;
    const a = clamp(left / 0.35, 0, 1) * (left < 0.6 && !S.reduced ? 0.75 + 0.25 * Math.sin(now * 30) : 1);
    if (a <= 0.01) return;
    ctx.save();
    // a jagged crystal silhouette
    const pts = [], n = 9;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      pts.push([X - w * 0.55 + w * 1.1 * u + (rr() - 0.5) * w * 0.12, top + (Math.abs(u - 0.5) * 0.35 + rr() * 0.12) * h]);
    }
    const body = [[X + w * 0.6, Y - h * 0.3], [X + w * 0.5, Y + h * 0.02], [X - w * 0.5, Y + h * 0.02], [X - w * 0.62, Y - h * 0.35]];
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); for (const p of body) ctx.lineTo(p[0], p[1]); ctx.closePath(); };
    const g = ctx.createLinearGradient(X - w, top, X + w, Y);
    g.addColorStop(0, ICE(0.5 * a)); g.addColorStop(0.45, LIL(0.26 * a)); g.addColorStop(1, ICE2(0.38 * a));
    path(); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = VIO2(0.55 * a); ctx.lineWidth = 1.6 * d; ctx.stroke();
    ctx.strokeStyle = SNOW(0.85 * a); ctx.lineWidth = 1.1 * d; path(); ctx.save(); ctx.clip();
    // facets
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const x0 = X - w * 0.5 + rr() * w, y0 = top + rr() * h * 0.4; ctx.moveTo(x0, y0); ctx.lineTo(x0 + (rr() - 0.3) * w * 0.6, y0 + h * (0.3 + rr() * 0.4)); }
    ctx.stroke();
    // a sheen sliding across
    const sx = X - w + ((now * 0.6 + rr()) % 1.6) * w * 1.6;
    const sg = ctx.createLinearGradient(sx - w * 0.2, 0, sx + w * 0.2, 0);
    sg.addColorStop(0, SNOW(0)); sg.addColorStop(0.5, SNOW(0.35 * a)); sg.addColorStop(1, SNOW(0));
    ctx.fillStyle = sg; ctx.fillRect(X - w, top, w * 2, h * 1.1);
    ctx.restore();
    // frost creeping over the ground at its feet
    ctx.fillStyle = ICE(0.45 * a); ctx.beginPath(); ctx.ellipse(X, Y + 1 * d, w * 0.75, w * 0.18, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // violet crackle over a foe paralyzed by Chain Lightning (called per foe)
  function drawStun(ctx, X, Y, h, sz, left, seed) {
    if (S.reduced && Math.floor(now * 8) % 2) return;
    const d = S.dpr, rr = prng(seed * 31 + Math.floor(now * 24)), w = h * 0.45, a = clamp(left / 0.15, 0, 1);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      let x = X + (rr() - 0.5) * w, y = Y - h * (0.2 + rr() * 0.7);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rr() - 0.5) * w * 0.5; y += (rr() - 0.5) * h * 0.25; ctx.lineTo(x, y); }
      ctx.strokeStyle = VIO(0.35 * a); ctx.lineWidth = 4 * d; ctx.stroke();
      ctx.strokeStyle = k ? LIL(0.9 * a) : INK(0.8 * a); ctx.lineWidth = 1.3 * d; ctx.stroke();
    }
    ctx.restore();
  }
  // a jagged lightning path between two points, re-rolled a few times a second
  function bolt(ctx, x0, y0, x1, y1, seed, rough) {
    const rr = prng(seed), n = 7, pts = [[x0, y0]], dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (let i = 1; i < n; i++) { const u = i / n, o = (rr() - 0.5) * rough * Math.sin(u * PI) * 2; pts.push([x0 + dx * u + nx * o, y0 + dy * u + ny * o]); }
    pts.push([x1, y1]);
    return pts;
  }
  function strokePts(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }

  // ---- drawing: air layer (over the figures)
  function drawAir(ctx) {
    if (!S.proj) return;
    const d = S.dpr;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // falling snow while Frozen Hell holds
    for (const p of flakes) {
      const [X, Y, sz] = P(p.x, p.y), top = Y - p.h * S.scale * 0.6 * sz, a = Math.min(1, p.h * 3) * zeroAmt;
      ctx.fillStyle = SNOW(0.9 * a); ctx.beginPath(); ctx.arc(X, top, p.s * 1.6 * d * sz, 0, TAU); ctx.fill();
      ctx.fillStyle = LIL(0.5 * a); ctx.beginPath(); ctx.arc(X + d * 0.5, top + d * 0.5, p.s * 0.8 * d * sz, 0, TAU); ctx.fill();
    }
    // hand bursts: a short violet stream from the palm, a bloom on the foe
    for (const b of bursts) {
      const q = b.t / b.life, a = 1 - q, head = easeOut(clamp(q / 0.35, 0, 1));
      const dist = Math.hypot(b.X - b.hx, b.Y - b.hy), near = dist < S.H * 1.3;
      // palm flare
      if (q < 0.5) {
        const r = S.H * (0.07 + 0.05 * q) * (b.crit ? 1.3 : 1);
        const g = ctx.createRadialGradient(b.hx, b.hy, 0, b.hx, b.hy, r);
        g.addColorStop(0, SNOW(0.9 * (1 - q * 2))); g.addColorStop(0.35, VIO(0.75 * (1 - q * 2))); g.addColorStop(1, VIO(0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.hx, b.hy, r, 0, TAU); ctx.fill();
      }
      // the energy stream (only for close targets; far ones get the bloom alone, like a ki burst)
      if (near && !S.reduced) {
        const ex = b.hx + (b.X - b.hx) * head, ey = b.hy + (b.Y - b.hy) * head, tail = clamp((q - 0.25) / 0.6, 0, 1);
        const sx = b.hx + (b.X - b.hx) * tail, sy = b.hy + (b.Y - b.hy) * tail;
        const wob = Math.sin(b.seed + now * 40) * S.H * 0.015;
        ctx.strokeStyle = VIO(0.35 * a); ctx.lineWidth = S.H * 0.06 * a;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, (sy + ey) / 2 + wob, ex, ey); ctx.stroke();
        ctx.strokeStyle = VIO2(0.85 * a); ctx.lineWidth = S.H * 0.022 * a + d;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, (sy + ey) / 2 - wob, ex, ey); ctx.stroke();
        ctx.strokeStyle = SNOW(0.8 * a); ctx.lineWidth = d;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      }
      // the bloom on the foe: ink core, violet wash, a pale rim
      if (head > 0.6 || !near) {
        const u = clamp((q - 0.2) / 0.8, 0, 1), r = S.H * (b.crit ? 0.2 : 0.13) * b.sz * (0.5 + u * 0.8);
        const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, r);
        g.addColorStop(0, INK(0.7 * a)); g.addColorStop(0.3, VIO2(0.7 * a)); g.addColorStop(0.7, VIO(0.4 * a)); g.addColorStop(1, LIL(0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.X, b.Y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = LIL(0.8 * a); ctx.lineWidth = 1.5 * d;
        const rr = prng(b.seed);
        ctx.beginPath();
        for (let k = 0; k < (b.crit ? 8 : 5); k++) { const an = rr() * TAU, r0 = r * 0.5, r1 = r * (1 + rr() * 0.6); ctx.moveTo(b.X + Math.cos(an) * r0, b.Y + Math.sin(an) * r0); ctx.lineTo(b.X + Math.cos(an) * r1, b.Y + Math.sin(an) * r1); }
        ctx.stroke();
      }
    }
    // frost puffs
    for (const p of puffs) {
      const q = p.t / p.life, a = 1 - q, r = p.r * (0.5 + q * 0.7);
      const g = ctx.createRadialGradient(p.X, p.Y, 0, p.X, p.Y, r);
      g.addColorStop(0, SNOW(0.8 * a)); g.addColorStop(0.45, ICE(0.55 * a)); g.addColorStop(0.8, LIL(0.25 * a)); g.addColorStop(1, ICE(0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.X, p.Y, r, 0, TAU); ctx.fill();
    }
    // flashes and splash blooms
    for (const b of blooms) {
      if (b.ground) continue;
      const q = b.t / b.life, a = 1 - q, r = b.r * (0.6 + q * 0.6);
      const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, r);
      if (b.vio) { g.addColorStop(0, VIO2(0.6 * a)); g.addColorStop(0.6, VIO(0.3 * a)); g.addColorStop(1, VIO(0)); }
      else { g.addColorStop(0, SNOW(0.95 * a)); g.addColorStop(0.5, ICE(0.5 * a)); g.addColorStop(1, ICE(0)); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.X, b.Y, r, 0, TAU); ctx.fill();
    }
    // arcane bolts: a violet orb with an ink tail, curving in from above
    for (const l of bolts) {
      if (l.t < 0) continue;
      const pos = (u) => { const v = 1 - u; return [v * v * l.ox + 2 * v * u * l.cx + u * u * l.X, v * v * l.oy + 2 * v * u * l.cy + u * u * l.Y]; };
      if (!l.hit) {
        const q = clamp(l.t / l.fly, 0, 1), e = q * q * (3 - 2 * q);
        const tail = [];
        for (let i = 0; i <= 10; i++) tail.push(pos(Math.max(0, e - 0.28 * (1 - i / 10))));
        for (let i = 1; i < tail.length; i++) {
          const u = i / tail.length;
          ctx.strokeStyle = i % 2 ? INK(0.55 * u) : VIO2(0.7 * u); ctx.lineWidth = (S.H * 0.035 * u + d) * (0.6 + 0.4 * l.sz);
          ctx.beginPath(); ctx.moveTo(tail[i - 1][0], tail[i - 1][1]); ctx.lineTo(tail[i][0], tail[i][1]); ctx.stroke();
        }
        const [x, y] = pos(e), r = S.H * 0.065 * (0.7 + 0.3 * l.sz);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
        g.addColorStop(0, SNOW(0.95)); g.addColorStop(0.25, LIL(0.95)); g.addColorStop(0.55, VIO(0.75)); g.addColorStop(1, VIO(0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, TAU); ctx.fill();
        ctx.strokeStyle = INK(0.7); ctx.lineWidth = 1.2 * d; ctx.beginPath(); ctx.arc(x, y, r * 0.55, now * 9, now * 9 + PI * 1.3); ctx.stroke();
      } else {
        const q = clamp((l.t - l.fly) / (l.life - l.fly), 0, 1), a = 1 - q;
        ctx.strokeStyle = VIO2(0.8 * a); ctx.lineWidth = 2 * d;
        ctx.beginPath(); ctx.ellipse(l.X, l.Y, S.H * 0.1 * l.sz * (0.5 + q * 1.4), S.H * 0.06 * l.sz * (0.5 + q * 1.4), 0, 0, TAU); ctx.stroke();
      }
    }
    // chain lightning: inky violet forks, each hop a beat after the last
    for (const c of arcs) {
      if (c.t < 0) continue;
      const q = c.t / c.life, a = q < 0.15 ? 1 : 1 - (q - 0.15) / 0.85, L = Math.hypot(c.X - c.ax, c.Y - c.ay);
      const pts = bolt(ctx, c.ax, c.ay, c.X, c.Y, c.seed + Math.floor(now * 22), Math.min(L * 0.22, S.H * 0.5));
      ctx.strokeStyle = VIO(0.28 * a); ctx.lineWidth = S.H * 0.07 * a + 2 * d; strokePts(ctx, pts);
      ctx.strokeStyle = INK(0.9 * a); ctx.lineWidth = S.H * 0.02 + 1.5 * d; strokePts(ctx, pts);
      ctx.strokeStyle = LIL(0.95 * a); ctx.lineWidth = d; strokePts(ctx, pts);
      if (!S.reduced) { // a couple of forks off the main stroke
        const rr = prng(c.seed + Math.floor(now * 22) * 3);
        for (let k = 0; k < 2; k++) {
          const p = pts[1 + Math.floor(rr() * (pts.length - 2))], an = Math.atan2(c.Y - c.ay, c.X - c.ax) + (rr() - 0.5) * 2.2, fl = L * (0.12 + rr() * 0.15);
          const f = bolt(ctx, p[0], p[1], p[0] + Math.cos(an) * fl, p[1] + Math.sin(an) * fl, c.seed + k + 7, fl * 0.4);
          ctx.strokeStyle = INK(0.7 * a); ctx.lineWidth = 1.4 * d; strokePts(ctx, f);
          ctx.strokeStyle = VIO(0.6 * a); ctx.lineWidth = 0.8 * d; strokePts(ctx, f);
        }
      }
    }
    // embers from the flame wave
    for (const e of embers) { const a = 1 - e.t / e.life; ctx.fillStyle = e.t < e.life * 0.4 ? GLD(0.9 * a) : ORG(0.8 * a); ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); }
    // shards and sparks
    for (const s of shards) {
      const a = Math.min(1, s.life * 3);
      if (s.spark) { ctx.fillStyle = s.ice ? SNOW(0.9 * a) : VIO(0.9 * a); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill(); continue; }
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.beginPath(); ctx.moveTo(0, -s.r); ctx.lineTo(s.r * 0.45, 0); ctx.lineTo(0, s.r * 0.8); ctx.lineTo(-s.r * 0.4, 0); ctx.closePath();
      ctx.fillStyle = s.lil ? LIL(0.85 * a) : ICE(0.9 * a); ctx.fill(); ctx.strokeStyle = VIO2(0.6 * a); ctx.lineWidth = d; ctx.stroke();
      ctx.restore();
    }
    // Frozen Hell: a white-out on the cast, then a frost vignette while the ice holds
    if (hellFlash > 0 || zeroAmt > 0.01) {
      const W = ctx.canvas.width, Hh = ctx.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (hellFlash > 0) { ctx.fillStyle = SNOW(0.55 * hellFlash * hellFlash); ctx.fillRect(0, 0, W, Hh); }
      if (zeroAmt > 0.01) {
        const g = ctx.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * 0.3, W / 2, Hh / 2, Math.hypot(W, Hh) * 0.55);
        g.addColorStop(0, ICE(0)); g.addColorStop(0.7, ICE(0.18 * zeroAmt)); g.addColorStop(1, LIL(0.45 * zeroAmt));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
      }
    }
    ctx.restore();
  }

  return { update, drawGround, drawAir, drawFrozen, drawStun, onBurst, onSplash, onFrost, onFreeze, onFlame, onEmber, onBolt, onArc, onHell, onShatter, get zero() { return zeroAmt; },
    get counts() { return { bursts: bursts.length, puffs: puffs.length, flames: flames.length, bolts: bolts.length, arcs: arcs.length, shards: shards.length, flakes: flakes.length, embers: embers.length }; } };
}
