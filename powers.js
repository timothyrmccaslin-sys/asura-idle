// Ability visuals around the Asura: Storm's red lightning cage that builds for a
// beat then lashes out at the foes (plus a crackling aura and chain bolts), and
// Blood Beads orbiting on a tilted plane with depth. Presentation only.
const TAU = Math.PI * 2;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// jagged midpoint-displacement path
function boltPts(x0, y0, x1, y1, seed, jag = 0.22, depth = 5) {
  const r = rng(seed);
  let pts = [[x0, y0], [x1, y1]];
  let disp = Math.hypot(x1 - x0, y1 - y0) * jag;
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const o = (r() - 0.5) * disp;
      out.push([(ax + bx) / 2 - (dy / L) * o, (ay + by) / 2 + (dx / L) * o], [bx, by]);
    }
    pts = out; disp *= 0.55;
  }
  return pts;
}
function stroke(ctx, pts, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}
// Sumi-e lightning: one bold brush stroke per bolt. A red wash bleeds around a
// dark ink core whose weight swells and tapers along the stroke and breaks in
// places; dry-brush bristle strands feather off its edges. No neon glow.
let MINW = 1.4, INKFX = true;
function bolt(ctx, pts, w, a, core = true, seed = 1) {
  w = Math.max(w, MINW);
  const n = pts.length - 1; if (n < 1) return;
  const r = rng(seed * 7 + 3);
  const wt = new Array(n), gap = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    wt[i] = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04)), 0.55) * (0.65 + r() * 0.7);
    gap[i] = r() < 0.07 && i > 1 && i < n - 2;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const seg = (i, width, color) => { ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.6, width); ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke(); };
  // red wash soaking into the paper around the stroke
  if (core) stroke(ctx, pts, w * 5, `rgba(170,28,36,${0.16 * a})`);
  for (let i = 0; i < n; i++) seg(i, w * 3 * wt[i], `rgba(168,26,34,${0.68 * a})`);
  // dark ink core, broken here and there
  for (let i = 0; i < n; i++) if (!gap[i]) seg(i, w * 1.5 * wt[i], `rgba(24,14,13,${0.92 * a})`);
  // dry-brush bristles feathering off both edges
  if (core && INKFX) {
    for (const side of [-1, 1]) {
      const off = side * w * (0.9 + r() * 0.5);
      ctx.strokeStyle = `rgba(30,16,15,${0.38 * a})`; ctx.lineWidth = Math.max(0.5, w * 0.28);
      ctx.beginPath(); let pen = false;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / L * off * wt[i], ny = (bx - ax) / L * off * wt[i];
        if (r() < 0.45) { pen = false; continue; }
        if (!pen) { ctx.moveTo(ax + nx, ay + ny); pen = true; }
        ctx.lineTo(bx + nx, by + ny);
      }
      ctx.stroke();
    }
  }
}

// palette: the Daeva's Blue Lotus beads reuse the Blood Beads painting with
// every red tone pushed to ultramarine (neutrals, ink and highlights unchanged)
function toBlue(c) {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  let r, g, b, a = null;
  if (hex) { const v = parseInt(hex[1], 16); r = v >> 16; g = (v >> 8) & 255; b = v & 255; }
  else { const m = /^rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)$/.exec(c.replace(/\s/g, '')); if (!m) return c; r = +m[1]; g = +m[2]; b = +m[3]; a = m[4] ?? null; }
  if (!(r > g + 40)) return c;
  const nr = Math.round(g * 0.8 + 20), ng = Math.round(r * 0.38 + 40), nb = Math.min(255, Math.round(r * 1.1 + 60));
  return a === null ? `rgb(${nr},${ng},${nb})` : `rgba(${nr},${ng},${nb},${a})`;
}

export function createPowers(opts = {}) {
  const col = opts.blue ? toBlue : (c) => c;
  const S = { X: 0, Y: 0, H: 100, scale: 100, SQ: 0.8, dpr: 1, reduced: false, lite: false, dx: 0, proj: null };
  let now = 0, stormOn = false, stormT = 9, burstDone = true, crackSeed = 1, crackT = 0;
  const lashes = [];  // live bolts: {pts..., life, max, w, seed, x0,y0,x1,y1, forks}
  const inkSplats = []; // spatter and drips left where bolts fork and land
  const smears = [];    // fading ink afterimages of spent bolts
  let beadAmt = 0, beadAng = 0, beadSpin = 0, beadsOn = false;
  const beadSpr = new Map();
  let hooks = { impact: () => {}, shake: () => {} };
  const BUILD = 0.45;

  const C = () => [S.X + S.dx, S.Y - S.H * 0.45]; // cage centre (chest)
  const cagePt = (a) => { const [cx, cy] = C(); return [cx + Math.cos(a) * S.H * 0.48, cy + Math.sin(a) * S.H * 0.6]; };
  // world ground point -> screen (through the scene's perspective camera), at hit height
  const toS = (x, y) => { if (S.proj) { const p = S.proj(x, y); return [p[0], p[1] - 0.07 * S.scale * p[2]]; } return [S.X + x * S.scale, S.Y + y * S.scale * S.SQ - 0.07 * S.scale]; };

  function lash(tx, ty, w, life) {
    const [cx, cy] = C();
    const a = Math.atan2(ty - cy, tx - cx);
    const [x0, y0] = cagePt(a);
    lashes.push({ x0, y0, x1: tx, y1: ty, life, max: life, w, seed: (Math.random() * 1e9) | 0, forks: S.reduced ? 0 : 1, landed: false, last: null });
    if (lashes.length > 24) lashes.shift();
  }

  function splatAt(x, y, sz, red) {
    if (S.reduced) return;
    const n = S.lite ? 3 : 6;
    for (let k = 0; k < n; k++) { const a = Math.random() * TAU, d = Math.random() * sz * 2.2; inkSplats.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, r: sz * (0.15 + Math.random() * 0.5), life: 1.1, max: 1.1, red: red || Math.random() < 0.5, vy: Math.random() < 0.25 ? S.H * 0.25 : 0 }); }
    if (inkSplats.length > 90) inkSplats.splice(0, inkSplats.length - 90);
  }
  function update(dt, f, en, env) {
    Object.assign(S, env);
    MINW = 1.6 * S.dpr; INKFX = !S.reduced && !S.lite;
    now += dt;
    const on = f[7] > 0;
    if (on && !stormOn) { stormT = 0; burstDone = false; }
    stormOn = on;
    stormT += dt;
    // the build-up ends in a burst of bolts at the nearest foes on the field
    if (!burstDone && stormT >= (S.reduced ? 0.15 : BUILD)) {
      burstDone = true;
      const list = [];
      for (let o = 0; o < en.length; o += 11) { const d = Math.hypot(en[o + 2], en[o + 3]); if (d < 1.25) list.push([d, en[o + 2], en[o + 3]]); }
      list.sort((a, b) => a[0] - b[0]);
      const n = Math.min(list.length, S.reduced ? 3 : 8);
      for (let i = 0; i < n; i++) { const [X, Y] = toS(list[i][1], list[i][2]); lash(X, Y, S.H * 0.026, 0.32); hooks.impact(list[i][1], list[i][2]); }
      for (let i = n; i < (S.reduced ? 3 : 7); i++) { // fill the ring with radial strikes
        const a = (i / 7) * TAU + Math.random() * 0.5, d = 0.7 + Math.random() * 0.4;
        const [X, Y] = toS(Math.cos(a) * d, Math.sin(a) * d); lash(X, Y, S.H * 0.02, 0.26);
      }
      hooks.shake(9);
    }
    crackT -= dt; if (crackT <= 0) { crackSeed = (Math.random() * 1e9) | 0; crackT = S.reduced ? 0.16 : 0.055; }
    for (let i = lashes.length - 1; i >= 0; i--) {
      const L = lashes[i]; L.life -= dt;
      if (L.life <= 0) { if (!S.reduced && L.last && smears.length < 14) smears.push({ pts: L.last, w: L.w, life: 0.55, max: 0.55 }); lashes.splice(i, 1); }
    }
    for (let i = smears.length - 1; i >= 0; i--) { smears[i].life -= dt; if (smears[i].life <= 0) smears.splice(i, 1); }
    for (let i = inkSplats.length - 1; i >= 0; i--) { const p = inkSplats[i]; p.life -= dt; if (p.vy) { p.y += p.vy * dt; p.vy *= 0.92; } if (p.life <= 0) inkSplats.splice(i, 1); }
    // beads: spin up and grow in, then spin down and fade out
    const bOn = f[8] > 0;
    if (bOn && !beadsOn) beadSpin = 9;
    beadsOn = bOn;
    const target = bOn ? 1 : 0;
    beadAmt += (target - beadAmt) * Math.min(1, dt * (bOn ? 3 : 2.2));
    const cruise = bOn ? 2.1 : 0.5;
    beadSpin += (cruise - beadSpin) * Math.min(1, dt * 1.6);
    beadAng += beadSpin * dt * (S.reduced ? 0.5 : 1);
  }

  function onChain(x, y) {
    const [X, Y] = toS(x, y);
    lash(X, Y, S.H * 0.018, 0.2);
  }

  // ------------------------------------------------------------ storm drawing
  function drawStorm(ctx) {
    const [cx, cy] = C();
    const building = stormOn && stormT < BUILD && !S.reduced;
    if (stormOn) {
      const q = building ? stormT / BUILD : 1;
      // red ground glow under him
      // a mottled red ink wash pooling on the ground under him
      { const tex = wash(), wr = S.H * 0.75;
        ctx.save(); ctx.globalAlpha = Math.min(1, 1.1 * q); ctx.translate(S.X, S.Y); ctx.scale(1, Math.min(0.6, S.SQ * 1.05)); ctx.rotate(-now * 0.2);
        ctx.drawImage(tex, -wr, -wr, wr * 2, wr * 2); ctx.restore(); }
      // the cage: arcs between points on an ellipse around him, crackling
      const r = rng(crackSeed);
      const N = building ? Math.max(2, Math.ceil(q * 6)) : S.lite || S.reduced ? 2 : 3;
      const base = r() * TAU;
      for (let i = 0; i < N; i++) {
        const a0 = building ? base + (i / 6) * TAU : r() * TAU;
        const a1 = a0 + (building ? TAU / 6 : 0.7 + r() * 0.9);
        const [x0, y0] = cagePt(a0), [x1, y1] = cagePt(a1);
        const pts = boltPts(x0, y0, x1, y1, crackSeed + i * 31, 0.3, 3);
        bolt(ctx, pts, S.H * (building ? 0.018 + q * 0.016 : 0.017), building ? 0.6 + 0.4 * q : 0.8, true, crackSeed + i);
      }
      if (building || (!S.reduced && r() < 0.35)) { // vertical crackle from the ground
        const a = r() * TAU, [x1, y1] = cagePt(a);
        bolt(ctx, boltPts(S.X + (r() - 0.5) * S.H * 0.5, S.Y, x1, y1, crackSeed + 7, 0.3, 3), S.H * 0.014, building ? q : 0.6, true, crackSeed + 7);
      }
      if (building && q > 0.75) { // charge flash just before the burst
        ctx.fillStyle = `rgba(160,24,32,${(q - 0.75) * 0.35})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, S.H * 0.5, S.H * 0.64, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(24,14,13,${(q - 0.75) * 1.2})`; ctx.lineWidth = Math.max(MINW, S.H * 0.012);
        ctx.beginPath(); ctx.ellipse(cx, cy, S.H * 0.5, S.H * 0.64, 0, 0.3, TAU - 0.5); ctx.stroke();
      }
    }
    // ink afterimages of spent bolts, soaking out
    for (const m of smears) {
      const k = m.life / m.max;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      stroke(ctx, m.pts, Math.max(MINW, m.w) * (2.4 + (1 - k) * 1.5), `rgba(150,24,30,${0.16 * k})`);
      stroke(ctx, m.pts, Math.max(MINW, m.w) * 0.8, `rgba(40,18,16,${0.3 * k})`);
    }
    // spatter and drips at forks and impacts
    for (const p of inkSplats) {
      const k = p.life / p.max;
      ctx.fillStyle = p.red ? `rgba(160,22,30,${0.75 * k})` : `rgba(24,14,13,${0.7 * k})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * (1.3 - 0.3 * k), p.r * (p.vy ? 1.6 : 0.8), 0, 0, TAU); ctx.fill();
    }
    // bolts lashing out (burst + chain hits), with forks
    for (const L of lashes) {
      const a = Math.min(1, (L.life / L.max) * 2.2);
      const grow = Math.min(1, (1 - L.life / L.max) * 5);
      const x1 = L.x0 + (L.x1 - L.x0) * grow, y1 = L.y0 + (L.y1 - L.y0) * grow;
      const seed = L.seed + ((now * 30) | 0); // re-jag while it lives
      const pts = boltPts(L.x0, L.y0, x1, y1, seed, 0.18, 4);
      bolt(ctx, pts, L.w * 1.25, a, true, L.seed);
      if (grow >= 1) L.last = pts;
      const r = rng(seed + 3);
      for (let k = 0; k < L.forks; k++) {
        const i = Math.floor(pts.length * (0.3 + r() * 0.5)), [fx, fy] = pts[i];
        const ang = Math.atan2(y1 - L.y0, x1 - L.x0) + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5);
        const len = Math.hypot(x1 - L.x0, y1 - L.y0) * (0.18 + r() * 0.2);
        bolt(ctx, boltPts(fx, fy, fx + Math.cos(ang) * len, fy + Math.sin(ang) * len, seed + k * 13, 0.3, 3), L.w * 0.7, a * 0.85, false, L.seed + k);
        if (!L.forked && grow >= 1) { L.forked = true; splatAt(fx, fy, S.H * 0.02, false); }
      }
      if (grow >= 1) { // a blot of red ink where it lands, splashing out once
        if (!L.landed) { L.landed = true; splatAt(L.x1, L.y1, S.H * 0.03, true); }
        ctx.fillStyle = `rgba(160,22,30,${a * 0.4})`;
        ctx.beginPath(); ctx.ellipse(L.x1, L.y1, L.w * 3.4 * (1.2 - a * 0.4), L.w * 2.4 * (1.2 - a * 0.4), 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(24,14,13,${a * 0.55})`;
        ctx.beginPath(); ctx.arc(L.x1, L.y1, L.w * 1.1, 0, TAU); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ beads
  // Painted in the sumi-e manner: each bead is an uneven blot of red with a
  // dry-brush ink rim and a broken glossy highlight (4 variants, cached per
  // size); the cord is a wavering brush stroke; trails are smears that bleed
  // and drip; droplets flick off and land as spatter; a red wash pools on the
  // ground under the orbit.
  const prng = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };
  function beadSprite(r, v) {
    const key = Math.round(r * 2) * 8 + v;
    if (beadSpr.has(key)) return beadSpr.get(key);
    const R = Math.max(3, Math.round(r * 2) / 2), s = Math.ceil(R * 2.6 + 6), c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), m = s / 2, rr = prng(977 + v * 131 + Math.round(R) * 7);
    // irregular blot outline
    const pts = [], n = 22;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([Math.cos(a), Math.sin(a), R * (0.9 + rr() * 0.16 + (i % 7 === 0 ? 0.08 : 0))]); }
    const path = (k = 1, dx = 0, dy = 0) => { g.beginPath(); pts.forEach(([cx, cy, pr], i) => { const x = m + dx + cx * pr * k, y = m + dy + cy * pr * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
    // bleed: a soft red halo soaking into the paper
    g.fillStyle = col('rgba(150,22,30,.16)'); path(1.18, rr() - 0.5, rr() - 0.5); g.fill();
    const gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.08, m, m, R * 1.05);
    gr.addColorStop(0, col('#d24a40')); gr.addColorStop(0.3, col('#a61d27')); gr.addColorStop(0.75, col('#5c0c13')); gr.addColorStop(1, col('#2a0508'));
    g.fillStyle = gr; path(); g.fill();
    // pigment pooling: darker mottles inside
    g.save(); path(); g.clip();
    for (let i = 0; i < 10; i++) { g.fillStyle = col(`rgba(40,4,8,${0.16 + rr() * 0.24})`); g.beginPath(); g.ellipse(m + (rr() - 0.4) * R * 1.3, m + (rr() - 0.3) * R * 1.3, R * (0.15 + rr() * 0.3), R * (0.1 + rr() * 0.2), rr() * 3, 0, TAU); g.fill(); }
    // dry-brush bristle streaks across the lower side
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) { g.strokeStyle = col(`rgba(22,12,12,${0.15 + rr() * 0.25})`); g.lineWidth = Math.max(0.6, R * (0.04 + rr() * 0.06)); const y = m + R * (0.1 + rr() * 0.8); g.beginPath(); g.moveTo(m - R, y); g.quadraticCurveTo(m, y + (rr() - 0.5) * R * 0.3, m + R, y - R * 0.2 * rr()); g.stroke(); }
    g.restore();
    // broken ink rim: dry-brush arcs with gaps, uneven weight
    let a = rr() * TAU;
    while (a < TAU * 1.9) {
      const len = 0.5 + rr() * 1.3;
      g.strokeStyle = col(`rgba(18,12,12,${0.7 + rr() * 0.3})`); g.lineWidth = Math.max(1, R * (0.12 + rr() * 0.16));
      g.beginPath(); g.arc(m + (rr() - 0.5) * 0.8, m + (rr() - 0.5) * 0.8, R * (0.92 + rr() * 0.1), a, a + len); g.stroke();
      a += len + 0.15 + rr() * 0.6;
    }
    // uneven gloss: a broken streak plus a speck or two
    g.fillStyle = col('rgba(255,244,236,.85)');
    g.beginPath(); g.ellipse(m - R * 0.36, m - R * 0.42, R * (0.2 + rr() * 0.14), R * (0.09 + rr() * 0.07), -0.6 - rr() * 0.4, 0, TAU); g.fill();
    g.fillStyle = col('rgba(255,240,232,.6)');
    for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(m - R * (0.1 + rr() * 0.3), m - R * (0.55 + rr() * 0.2), R * (0.05 + rr() * 0.06), 0, TAU); g.fill(); }
    g.fillStyle = col('rgba(255,225,220,.22)'); g.beginPath(); g.arc(m + R * 0.38, m + R * 0.42, R * 0.16, 0, TAU); g.fill();
    // a fleck of ink spatter off the edge
    if (v % 2 === 0) { g.fillStyle = col('rgba(120,16,22,.7)'); g.beginPath(); g.arc(m + R * (1.05 + rr() * 0.15), m + R * (0.2 + rr() * 0.4), Math.max(0.6, R * 0.09), 0, TAU); g.fill(); }
    beadSpr.set(key, c); return c;
  }
  // soft red ink wash for the ground under the orbit (mottled, cached)
  let washTex = null;
  function wash() {
    if (washTex) return washTex;
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), rr = prng(4242);
    for (let i = 0; i < 26; i++) {
      const a = rr() * TAU, d = Math.sqrt(rr()) * s * 0.3, x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d, r = s * (0.08 + rr() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col(`rgba(170,26,34,${0.12 + rr() * 0.12})`)); gr.addColorStop(1, col('rgba(170,26,34,0)'));
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }
    g.globalCompositeOperation = 'destination-in';
    const mk = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
    mk.addColorStop(0, col('rgba(0,0,0,1)')); mk.addColorStop(0.7, col('rgba(0,0,0,.7)')); mk.addColorStop(1, col('rgba(0,0,0,0)'));
    g.fillStyle = mk; g.fillRect(0, 0, s, s);
    return (washTex = c);
  }
  const BEADS = 14;
  const beadVar = Array.from({ length: BEADS }, (_, i) => { const r = prng(31 + i * 17); return { k: 0.84 + r() * 0.32, sq: 0.9 + r() * 0.18, rot: r() * TAU, v: i % 4, ph: r() * TAU }; });
  const drops = [];   // flicked droplets (screen space)
  const splats = [];  // landed spatter and drips fading into the paper
  let lastBeadT = 0, flickT = 0;
  function orbit() {
    const H = S.H, bob = Math.sin(now * 1.8) * H * 0.025;
    const cx = S.X + S.dx * 0.6, cy = S.Y - H * 0.42 + bob;
    const grow = 0.55 + 0.45 * beadAmt, rx = H * 0.7 * grow, ry = rx * 0.3, tilt = -0.17 + Math.sin(now * 0.7) * 0.04;
    return { cx, cy, rx, ry, ct: Math.cos(tilt), st: Math.sin(tilt) };
  }
  const onOrbit = (o, a, k = 1) => { const lx = Math.cos(a) * o.rx * k, ly = Math.sin(a) * o.ry * k; return [o.cx + lx * o.ct - ly * o.st, o.cy + lx * o.st + ly * o.ct]; };
  function stepBeadFx(o) {
    const dt = Math.min(0.05, Math.max(0, now - lastBeadT)); lastBeadT = now;
    if (S.reduced) { drops.length = 0; splats.length = 0; return; }
    const H = S.H, fast = Math.min(1, beadSpin / 3);
    // flick a droplet off a front bead now and then (more while spinning fast)
    flickT -= dt * (0.6 + fast * 2.4) * beadAmt;
    if (flickT <= 0 && beadAmt > 0.3 && drops.length < (S.lite ? 4 : 10)) {
      flickT = 0.25 + Math.random() * 0.5;
      const i = (Math.random() * BEADS) | 0, a = beadAng + (i / BEADS) * TAU;
      const [x, y] = onOrbit(o, a);
      const tx = -Math.sin(a) * o.rx * o.ct - Math.cos(a) * o.ry * o.st, ty = -Math.sin(a) * o.rx * o.st + Math.cos(a) * o.ry * o.ct;
      const tl = Math.hypot(tx, ty) || 1, sp = H * (1.2 + Math.random() * 1.4) * (0.5 + fast);
      drops.push({ x, y, px: x, py: y, vx: (tx / tl) * sp, vy: (ty / tl) * sp - H * 0.6, life: 0.5 + Math.random() * 0.3, r: H * (0.008 + Math.random() * 0.008), gy: S.Y + H * (0.02 + Math.random() * 0.1) });
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.px = d.x; d.py = d.y;
      d.vy += H * 6 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.y >= d.gy || d.life <= 0) {
        // lands: a little burst of spatter that bleeds and fades
        const n = S.lite ? 2 : 4;
        for (let k = 0; k < n; k++) splats.push({ x: d.x + (Math.random() - 0.5) * H * 0.05, y: Math.min(d.y, d.gy) + (Math.random() - 0.5) * H * 0.012, r: d.r * (0.4 + Math.random() * 0.9), life: 0.9, max: 0.9 });
        drops.splice(i, 1);
      }
    }
    for (let i = splats.length - 1; i >= 0; i--) { const p = splats[i]; p.life -= dt; if (p.vy) { p.y += p.vy * dt; p.vy *= 0.9; } if (p.life <= 0) splats.splice(i, 1); }
    if (splats.length > 60) splats.splice(0, splats.length - 60);
  }
  function drawBeads(ctx, front) {
    if (beadAmt < 0.01 && !drops.length && !splats.length) return;
    const H = S.H, o = orbit(), red = S.reduced, lite = S.lite;
    if (!front) {
      stepBeadFx(o);
      // red ink wash on the ground under the orbit
      if (beadAmt > 0.01) {
        const tex = wash(), wr = o.rx * 1.25;
        ctx.save(); ctx.globalAlpha = (red ? 0.5 : 0.85) * beadAmt * (0.85 + 0.15 * Math.sin(now * 2.3));
        ctx.translate(S.X, S.Y); ctx.scale(1, Math.min(0.6, S.SQ * 1.05)); ctx.rotate(now * 0.15);
        ctx.drawImage(tex, -wr, -wr, wr * 2, wr * 2); ctx.restore();
      }
      // spatter and drips soak into the paper
      for (const p of splats) { ctx.fillStyle = col(`rgba(150,20,28,${0.55 * (p.life / p.max)})`); ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * (1.6 - 0.4 * p.life / p.max), p.r * 0.7, 0, 0, TAU); ctx.fill(); }
    }
    if (beadAmt < 0.01) return;
    // mala cord: a wavering brush stroke, thick and thin, broken in places
    ctx.lineCap = 'round';
    const seg = red ? 10 : 22, a0 = front ? 0 : Math.PI;
    let prev = null;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + (j / seg) * Math.PI, wob = 1 + Math.sin(a * 5 + now * 1.3) * 0.015;
      const p = onOrbit(o, a, wob);
      if (prev) {
        const k = Math.sin(j * 1.7 + 0.5) * 0.5 + 0.5;
        if (red || k > 0.12) {
          ctx.strokeStyle = col(`rgba(22,16,14,${(0.4 + k * 0.4) * beadAmt})`);
          ctx.lineWidth = Math.max(1, H * (0.004 + k * 0.01));
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
        }
      }
      prev = p;
    }
    for (let i = 0; i < BEADS; i++) {
      const bv = beadVar[i];
      const a = beadAng + (i / BEADS) * TAU, z = Math.sin(a);
      if ((z >= 0) !== front) continue;
      const [x, y] = onOrbit(o, a);
      const depth = (z + 1) / 2, sc = (0.72 + 0.4 * depth) * bv.k;
      const alpha = beadAmt * (0.55 + 0.45 * depth);
      // ink smear behind each bead: overlapping blots that thin and bleed out
      if (!red && beadSpin > 0.8) {
        const n = lite ? 3 : 6, sp = Math.min(0.75, 0.16 * beadSpin);
        for (let k = n; k >= 1; k--) {
          const f = k / n, [tx, ty] = onOrbit(o, a - sp * f, 1 + Math.sin(k * 2.1 + bv.ph) * 0.02);
          ctx.fillStyle = col(`rgba(${150 - k * 10},20,28,${0.4 * alpha * (1 - f) + 0.05})`);
          ctx.beginPath(); ctx.ellipse(tx, ty + f * H * 0.012, H * 0.03 * sc * (1 - f * 0.5), H * 0.017 * sc * (1 - f * 0.3), Math.atan2(o.st, o.ct), 0, TAU); ctx.fill();
        }
        // a tapering dark brush tail through the smear
        { const m = lite ? 4 : 7; let pp = null;
          for (let k = 0; k <= m; k++) {
            const f = k / m, p = onOrbit(o, a - sp * 1.1 * f, 1 + Math.sin(k * 1.9 + bv.ph + now) * 0.012);
            if (pp) { ctx.strokeStyle = col(`rgba(70,8,14,${0.5 * alpha * (1 - f)})`); ctx.lineWidth = Math.max(0.6, H * 0.016 * sc * (1 - f)); ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); }
            pp = p;
          } }
        // a drip now and then hangs off the smear and runs down
        if (!lite && Math.random() < 0.012 * beadSpin && splats.length < 60) splats.push({ x: x + (Math.random() - 0.5) * H * 0.02, y: y + H * 0.02, r: H * 0.006, life: 0.7, max: 0.7, vy: H * 0.5 });
      }
      const spr = beadSprite(H * 0.042 * sc, bv.v);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(bv.rot + a * 0.3); ctx.scale(1, bv.sq);
      ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
      if (depth < 0.5) { // shade beads passing behind him
        ctx.globalAlpha = (0.5 - depth) * 0.7 * beadAmt; ctx.fillStyle = col('#161412');
        ctx.beginPath(); ctx.arc(0, 0, spr.width * 0.36, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (front && !red) {
      // flicked droplets with a short tapering ink streak
      for (const d of drops) {
        ctx.strokeStyle = col(`rgba(170,24,32,${Math.min(1, d.life * 2) * 0.8})`); ctx.lineWidth = d.r * 1.4;
        ctx.beginPath(); ctx.moveTo(d.px - (d.x - d.px) * 1.5, d.py - (d.y - d.py) * 1.5); ctx.lineTo(d.x, d.y); ctx.stroke();
        ctx.fillStyle = col('rgba(150,18,26,.9)'); ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
      }
    }
  }

  return {
    update, onChain,
    setHooks(h) { hooks = { ...hooks, ...h }; },
    drawBack(ctx) { drawBeads(ctx, false); },
    drawFront(ctx) { drawBeads(ctx, true); drawStorm(ctx); },
    get stormBuilding() { return stormOn && stormT < BUILD; },
  };
}
