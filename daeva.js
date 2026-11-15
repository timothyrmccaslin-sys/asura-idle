// The Daeva: a second main character in the same sumi-e language as the
// Asura, with an inky ultramarine accent. This module holds her move set (the
// Asura's animator, re-timed to flow like water) and her painterly water FX:
// Tidal Surge, Healing Rain, Whirlpool, the Blue Lotus shield, and the
// droplets her palm strikes fling. Pure presentation.
import { MOVES } from './asura.js';

const TAU = Math.PI * 2, PI = Math.PI, TIDE_T = 1.15;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- moves
// Same poses names as the Asura (her painted set mirrors his), but she turns
// through most strikes like a dancer: added spins and twists, softer lunges.
const D = JSON.parse(JSON.stringify(MOVES));
D.palm.spin = [0.04, 0.3]; D.palm.lunge = [[0, 0], [0.12, -0.03], [0.34, 0.13], [0.7, 0.08], [1, 0]];
D.palm.trail = { cx: 0.12, cy: -0.6, rx: 0.62, ry: 0.22, a0: PI * 1.25, a1: 0.05, t0: 0.1 };
D.uppercut.twist = [0.06, 0.4, 0.45]; D.uppercut.trail = { cx: 0.15, cy: -0.62, rx: 0.34, ry: 0.56, a0: PI * 0.7, a1: -PI * 0.7, t0: 0.12 };
D.crescent.spin = [0.06, 0.4]; D.crescent.base = 0.66;
D.backfist.base = 0.68; D.roundhouse.twist = [0.1, 0.44, 0.55];
D.sweep.trail = { cx: 0, cy: -0.08, rx: 1.02, ry: 0.32, a0: PI * 1.7, a1: -0.15, t0: 0.06 };
for (const k of Object.keys(D)) { const m = D[k]; if (m.rot) m.rot = m.rot.map(([u, v]) => [u, v * 1.25]); }
export const DAEVA_MOVES = D;

export function daevaPick(c) {
  const vert = c.ty * c.SQ / (Math.hypot(c.tx, c.ty * c.SQ) || 1), r = Math.hypot(c.tx, c.ty) / (c.range || 1);
  if (c.combo > 0 && c.combo % 4 === 3) return c.lastN >= 3 ? 'sweep' : 'tornado'; // a whirling finisher
  const pool = c.lastN >= 3 ? ['tornado', 'sweep', 'crescent', 'palm']
    : r < 0.55 ? (vert < -0.5 ? ['uppercut', 'palm', 'crescent'] : ['palm', 'backfist', 'palm', 'uppercut'])
    : vert > 0.5 ? ['sweep', 'roundhouse', 'crescent'] : ['roundhouse', 'crescent', 'palm', 'backfist', 'tornado'];
  let n = pool[c.i % pool.length];
  if (c.recent[0] === n) n = pool[(c.i + 1) % pool.length];
  return n;
}

// ---------------------------------------------------------------- water FX
// colours: dark ink core, ultramarine wash, pale foam
const INKC = (a) => `rgba(14,16,30,${a})`;
const BLU = (a) => `rgba(38,92,224,${a})`;
const BLU2 = (a) => `rgba(28,62,170,${a})`;
const FOAM = (a) => `rgba(236,240,246,${a})`;

function prng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createWater() {
  const S = { X: 0, Y: 0, H: 100, scale: 100, dpr: 1, reduced: false, lite: false, proj: null, AY: 0.2, dx: 0 };
  let now = 0;
  const tides = [];   // {t, r}
  const drops = [];   // falling rain streaks (world x,y + height)
  const ripples = []; // ground rings
  const strikes = []; // big damaging droplets falling on a foe
  const flecks = [];  // water spatter in the air (screen space)
  let rainAmt = 0, poolAmt = 0, lotusAmt = 0, pool = { x: 0, y: 0, r: 0.3 }, spin = 0;
  const P = (x, y) => S.proj(x, y);

  // a broken dry-brush stroke along a world-space ground ellipse
  function groundArc(ctx, cx, cy, r, a0, a1, w, color, seed, gaps = 0.3) {
    const rr = prng(seed), n = Math.max(8, Math.round((a1 - a0) / 0.12));
    let pen = false; ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n), j = 1 + (rr() - 0.5) * 0.05;
      const [X, Y] = P(cx + Math.cos(a) * r * j, cy + Math.sin(a) * r * j);
      if (rr() < gaps) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  function onTide(radius) {
    tides.push({ t: 0, max: radius, seed: (Math.random() * 1e9) | 0 });
    if (!S.reduced) for (let i = 0; i < (S.lite ? 10 : 24); i++) spray(S.X + (Math.random() - 0.5) * S.H * 0.6, S.Y - Math.random() * S.H * 0.2, 1.4);
  }
  function onPool(x, y, r) { pool = { x, y, r }; }
  function onDrop(x, y) {
    strikes.push({ x, y, h: 1, v: 0 });
    if (strikes.length > 30) strikes.shift();
  }
  // water flung off a palm strike: a few droplets arcing out of the hit point
  function spray(X, Y, power = 1) {
    if (S.reduced) return;
    const n = S.lite ? 2 : 4;
    for (let i = 0; i < n && flecks.length < 90; i++) {
      const a = -PI / 2 + (Math.random() - 0.5) * 2.4, v = S.H * (0.6 + Math.random() * 1.2) * power;
      flecks.push({ x: X, y: Y, px: X, py: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gy: Y + S.H * (0.05 + Math.random() * 0.12), r: S.H * (0.006 + Math.random() * 0.008), life: 0.9 });
    }
  }
  function onHit(x, y) {
    const [X, Y] = P(x, y);
    spray(X, Y - S.H * 0.15, 0.8);
  }

  function update(dt, f, env) {
    Object.assign(S, env);
    now += dt;
    const rain = f[18] > 0, pl = f[19] > 0, lo = f[20] > 0;
    rainAmt = clamp(rainAmt + (rain ? dt * 2 : -dt * 1.2), 0, 1);
    poolAmt = clamp(poolAmt + (pl ? dt * 2.5 : -dt * 1.5), 0, 1);
    lotusAmt = clamp(lotusAmt + (lo ? dt * 3 : -dt * 2), 0, 1);
    if (pl && f[23] > 0) pool = { x: f[21], y: f[22], r: f[23] };
    spin += dt * (2.2 + poolAmt * 1.5);
    for (let i = tides.length - 1; i >= 0; i--) { tides[i].t += dt; if (tides[i].t > TIDE_T) tides.splice(i, 1); }
    // rain: streaks fall from above onto the ground plane around the field
    if (rainAmt > 0.02) {
      const rate = (S.reduced ? 14 : S.lite ? 40 : 95) * rainAmt;
      let k = rate * dt; while (k > 0) { if (Math.random() < k) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 1.15; drops.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.95 + 0.05, h: 0.9 + Math.random() * 0.5, v: 2.6 + Math.random() }); } k -= 1; }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.h -= d.v * dt;
      if (d.h <= 0) { if (!S.reduced || Math.random() < 0.3) ripples.push({ x: d.x, y: d.y, t: 0, s: 0.025 + Math.random() * 0.02 }); drops.splice(i, 1); }
    }
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i]; s.v += dt * 9; s.h -= s.v * dt;
      if (s.h <= 0) {
        ripples.push({ x: s.x, y: s.y, t: 0, s: 0.07, big: true });
        const [X, Y] = P(s.x, s.y); spray(X, Y - S.H * 0.05, 0.9);
        strikes.splice(i, 1);
      }
    }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > (ripples[i].big ? 0.8 : 0.55)) ripples.splice(i, 1); }
    if (ripples.length > 120) ripples.splice(0, ripples.length - 120);
    for (let i = flecks.length - 1; i >= 0; i--) {
      const d = flecks[i]; d.px = d.x; d.py = d.y; d.vy += S.H * 6 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if ((d.vy > 0 && d.y >= d.gy) || d.life <= 0) flecks.splice(i, 1);
    }
  }

  // ground layer: under the figures (whirlpool, tide wave, ripples, rain glow)
  function drawGround(ctx) {
    if (!S.proj) return;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const d = S.dpr;
    // Healing Rain: a mottled blue wash pooling under her
    if (rainAmt > 0.01) {
      const [X, Y] = P(0, S.AY), rx = S.H * 0.75;
      const gr = ctx.createRadialGradient(X, Y, 0, X, Y, rx);
      gr.addColorStop(0, BLU(0.16 * rainAmt)); gr.addColorStop(0.6, BLU(0.08 * rainAmt)); gr.addColorStop(1, BLU(0));
      ctx.save(); ctx.translate(X, Y); ctx.scale(1, 0.32); ctx.translate(-X, -Y);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, rx, 0, TAU); ctx.fill(); ctx.restore();
    }
    if (rainAmt > 0.01 && !S.reduced) {
      for (let i = 0; i < 5; i++) {
        const [X, Y] = P((i - 2) * 0.45 + Math.sin(now * 0.2 + i) * 0.05, -0.95), r = S.H * (0.55 + (i % 2) * 0.2);
        const gr = ctx.createRadialGradient(X, Y, 0, X, Y, r);
        gr.addColorStop(0, BLU2(0.13 * rainAmt)); gr.addColorStop(1, BLU2(0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(X, Y, r * 1.6, r * 0.5, 0, 0, TAU); ctx.fill();
      }
    }
    // Whirlpool: spiral brush arms turning on the ground plane, dark eye, foam
    if (poolAmt > 0.01) {
      const { x, y, r } = pool, a = poolAmt;
      const [X, Y] = P(x, y);
      const g2 = ctx.createRadialGradient(X, Y, 0, X, Y, S.scale * r * 1.2);
      g2.addColorStop(0, INKC(0.5 * a)); g2.addColorStop(0.35, BLU2(0.3 * a)); g2.addColorStop(1, BLU(0));
      ctx.save(); ctx.translate(X, Y); ctx.scale(1, S.proj(x, y + 0.1)[1] - Y > 0 ? (S.proj(x, y + 0.1)[1] - Y) / (S.scale * 0.1) : 0.5); ctx.translate(-X, -Y);
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(X, Y, S.scale * r * 1.2, 0, TAU); ctx.fill(); ctx.restore();
      const arms = S.reduced ? 3 : 5;
      for (let k = 0; k < arms; k++) {
        const base = -spin * (S.reduced ? 0.4 : 1) + (k / arms) * TAU;
        // each arm: a wide wash, then a tapering dry-brush core that skips
        for (const [w, col, dry] of [[S.H * 0.06, BLU(0.26 * a), 0], [S.H * 0.024, INKC(0.8 * a), 0.16]]) {
          const rr = prng(k * 31 + 7), pts = [];
          for (let i = 0; i <= 26; i++) {
            const u = i / 26, rad = r * (1.15 - u * 1.05) * (1 + (rr() - 0.5) * 0.04), ang = base + u * 4.2;
            pts.push(P(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad));
          }
          ctx.strokeStyle = col;
          for (let i = 1; i < pts.length; i++) {
            if (dry && rr() < dry) continue;
            const u = i / 26; ctx.lineWidth = Math.max(0.8 * S.dpr, w * (0.6 + 0.4 * a) * (0.25 + 0.95 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05))));
            ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
          }
        }
      }
      if (!S.reduced) for (let i = 0; i < (S.lite ? 6 : 14); i++) { // foam flecks spiralling inward
        const u = ((now * 0.6 + i / 14) % 1), rad = r * (1.1 - u), ang = -spin * 1.3 + i * 2.4 + u * 4;
        const [px, py] = P(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
        ctx.fillStyle = FOAM(0.7 * a * (1 - u)); ctx.beginPath(); ctx.ellipse(px, py, 2.2 * d, 1.2 * d, ang, 0, TAU); ctx.fill();
      }
    }
    // Tidal Surge: a ring of ink-water rolling outward across the ground
    for (const t of tides) {
      // fast crest, then it slows and soaks into the paper
      const q = t.t / TIDE_T, r = 0.06 + (t.max - 0.06) * (1 - Math.pow(1 - q, 2.6)), a = Math.min(1, (1 - q) * 1.6);
      for (let k = 0; k < 3; k++) groundArc(ctx, 0, S.AY, r * (0.8 + k * 0.06), 0, TAU, S.H * (0.22 - k * 0.05) * a + 2 * d, BLU(0.12 * a), t.seed + 10 + k, 0.05);
      groundArc(ctx, 0, S.AY, r, 0, TAU, S.H * 0.08 * a + 1.5 * d, BLU2(0.6 * a), t.seed + 1, 0.1);
      groundArc(ctx, 0, S.AY, r * 1.02, 0, TAU, S.H * 0.026 * a + d, INKC(0.85 * a), t.seed + 2, 0.3);
      if (!S.reduced) groundArc(ctx, 0, S.AY, r * 1.07, 0, TAU, 2.2 * d, FOAM(0.85 * a), t.seed + 3, 0.5);
    }
    // ripples where rain lands
    for (const p of ripples) {
      const q = p.t / (p.big ? 0.8 : 0.55), [X, Y, sz] = P(p.x, p.y), rx = S.scale * p.s * (0.3 + q) * sz;
      ctx.strokeStyle = p.big ? BLU2(0.75 * (1 - q)) : BLU(0.5 * (1 - q)); ctx.lineWidth = (p.big ? 2.2 : 1.2) * d;
      ctx.beginPath(); ctx.ellipse(X, Y, rx, rx * 0.32, 0, 0, TAU); ctx.stroke();
      if (p.big && q < 0.4) { ctx.fillStyle = INKC(0.5 * (1 - q / 0.4)); ctx.beginPath(); ctx.ellipse(X, Y, rx * 0.35, rx * 0.12, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  // air layer: over the figures (rain streaks, striking drops, spray, shield)
  function drawAir(ctx) {
    if (!S.proj) return;
    const d = S.dpr; ctx.save(); ctx.lineCap = 'round';
    for (const p of drops) {
      const [X, Y, sz] = P(p.x, p.y), top = Y - p.h * S.scale * 0.55 * sz, L = S.H * 0.15 * sz;
      ctx.strokeStyle = BLU(0.2); ctx.lineWidth = (2.6 + sz * 1.6) * d;
      ctx.beginPath(); ctx.moveTo(X + L * 0.14, top - L); ctx.lineTo(X, top); ctx.stroke();
      ctx.strokeStyle = BLU2(0.7); ctx.lineWidth = (0.9 + sz * 0.7) * d;
      ctx.beginPath(); ctx.moveTo(X + L * 0.08, top - L * 0.55); ctx.lineTo(X, top); ctx.stroke();
      ctx.fillStyle = INKC(0.55); ctx.beginPath(); ctx.ellipse(X, top, 1.1 * d * sz, 1.8 * d * sz, 0, 0, TAU); ctx.fill();
    }
    for (const s of strikes) {
      const [X, Y, sz] = P(s.x, s.y), top = Y - s.h * S.scale * 0.6 * sz, L = S.H * 0.16 * sz;
      ctx.strokeStyle = BLU(0.35); ctx.lineWidth = 5 * d * sz; ctx.beginPath(); ctx.moveTo(X + L * 0.1, top - L); ctx.lineTo(X, top); ctx.stroke();
      ctx.strokeStyle = INKC(0.85); ctx.lineWidth = 2 * d * sz; ctx.beginPath(); ctx.moveTo(X + L * 0.06, top - L * 0.6); ctx.lineTo(X, top); ctx.stroke();
      ctx.fillStyle = BLU2(0.9); ctx.beginPath(); ctx.ellipse(X, top, 2.6 * d * sz, 3.6 * d * sz, 0, 0, TAU); ctx.fill();
    }
    for (const p of flecks) {
      const al = Math.min(1, p.life * 1.6), ang = Math.atan2(p.vy, p.vx), sp = Math.min(2.4, 1 + Math.hypot(p.vx, p.vy) / (S.H * 3));
      ctx.fillStyle = BLU(0.35 * al); ctx.beginPath(); ctx.ellipse(p.x - Math.cos(ang) * p.r, p.y - Math.sin(ang) * p.r, p.r * sp * 1.5, p.r * 1.2, ang, 0, TAU); ctx.fill();
      ctx.fillStyle = BLU2(0.95 * al); ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * sp, p.r * 0.85, ang, 0, TAU); ctx.fill();
      ctx.fillStyle = INKC(0.6 * al); ctx.beginPath(); ctx.arc(p.x + Math.cos(ang) * p.r * 0.4, p.y + Math.sin(ang) * p.r * 0.4, p.r * 0.45, 0, TAU); ctx.fill();
    }
    // Blue Lotus shield: broken petals of blue wash circling her body
    if (lotusAmt > 0.01) {
      const cx = S.X + S.dx * 0.6, cy = S.Y - S.H * 0.45, rx = S.H * 0.46, ry = S.H * 0.6;
      const n = S.reduced ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const a0 = now * 0.9 + (i / n) * TAU, len = 0.55 + 0.25 * Math.sin(i * 1.7 + now);
        for (const [w, col] of [[S.H * 0.05, BLU(0.16 * lotusAmt)], [S.H * 0.012, BLU2(0.55 * lotusAmt)]]) {
          ctx.beginPath();
          for (let j = 0; j <= 10; j++) { const a = a0 + len * (j / 10); const X = cx + Math.cos(a) * rx, Y = cy + Math.sin(a) * ry; if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
          ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
        }
      }
    }
    // healing: blue motes rising off her while the rain falls
    if (rainAmt > 0.05 && !S.reduced) {
      for (let i = 0; i < (S.lite ? 4 : 9); i++) {
        const u = (now * 0.5 + i / 9) % 1, X = S.X + Math.sin(i * 2.3 + now) * S.H * 0.3, Y = S.Y - u * S.H * 1.0;
        ctx.fillStyle = BLU(0.5 * rainAmt * (1 - u)); ctx.beginPath(); ctx.ellipse(X, Y, 2 * d, 3 * d, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  return { update, drawGround, drawAir, onTide, onPool, onDrop, onHit, spray, get rain() { return rainAmt; }, get pool() { return poolAmt; }, get lotus() { return lotusAmt; } };
}
