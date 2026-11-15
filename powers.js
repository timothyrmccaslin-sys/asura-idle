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
// painted lightning: ink bleed underlay, red body, hot pale core
let MINW = 1.4;
function bolt(ctx, pts, w, a, core = true) {
  w = Math.max(w, MINW);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (core) stroke(ctx, pts, w * 7, `rgba(200,40,48,${0.12 * a})`); // soft red bloom
  stroke(ctx, pts, w * 3.4, `rgba(22,20,18,${0.28 * a})`);
  stroke(ctx, pts, w * 1.6, `rgba(179,32,42,${0.95 * a})`);
  if (core) stroke(ctx, pts, w * 0.55, `rgba(255,232,224,${0.9 * a})`);
}

export function createPowers() {
  const S = { X: 0, Y: 0, H: 100, scale: 100, SQ: 0.8, dpr: 1, reduced: false, lite: false, dx: 0 };
  let now = 0, stormOn = false, stormT = 9, burstDone = true, crackSeed = 1, crackT = 0;
  const lashes = [];  // live bolts: {pts..., life, max, w, seed, x0,y0,x1,y1, forks}
  let beadAmt = 0, beadAng = 0, beadSpin = 0, beadsOn = false;
  const beadSpr = new Map();
  let hooks = { impact: () => {}, shake: () => {} };
  const BUILD = 0.45;

  const C = () => [S.X + S.dx, S.Y - S.H * 0.45]; // cage centre (chest)
  const cagePt = (a) => { const [cx, cy] = C(); return [cx + Math.cos(a) * S.H * 0.48, cy + Math.sin(a) * S.H * 0.6]; };
  const toS = (x, y) => [S.X + x * S.scale, S.Y + y * S.scale * S.SQ - 0.07 * S.scale];

  function lash(tx, ty, w, life) {
    const [cx, cy] = C();
    const a = Math.atan2(ty - cy, tx - cx);
    const [x0, y0] = cagePt(a);
    lashes.push({ x0, y0, x1: tx, y1: ty, life, max: life, w, seed: (Math.random() * 1e9) | 0, forks: S.reduced ? 0 : 2 });
    if (lashes.length > 24) lashes.shift();
  }

  function update(dt, f, en, env) {
    Object.assign(S, env);
    MINW = 1.3 * S.dpr;
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
    for (let i = lashes.length - 1; i >= 0; i--) { lashes[i].life -= dt; if (lashes[i].life <= 0) lashes.splice(i, 1); }
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
      const gr = ctx.createRadialGradient(S.X, S.Y, 0, S.X, S.Y, S.H * 0.7);
      gr.addColorStop(0, `rgba(179,32,42,${0.22 * q})`); gr.addColorStop(1, 'rgba(179,32,42,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(S.X, S.Y, S.H * 0.7, S.H * 0.7 * S.SQ * 0.5, 0, 0, TAU); ctx.fill();
      // the cage: arcs between points on an ellipse around him, crackling
      const r = rng(crackSeed);
      const N = building ? Math.max(2, Math.ceil(q * 9)) : S.lite || S.reduced ? 3 : 5;
      const base = r() * TAU;
      for (let i = 0; i < N; i++) {
        const a0 = building ? base + (i / 9) * TAU : r() * TAU;
        const a1 = a0 + (building ? TAU / 9 : 0.5 + r() * 0.9);
        const [x0, y0] = cagePt(a0), [x1, y1] = cagePt(a1);
        const pts = boltPts(x0, y0, x1, y1, crackSeed + i * 31, 0.35, S.lite ? 3 : 4);
        bolt(ctx, pts, S.H * (building ? 0.014 + q * 0.014 : 0.012), building ? 0.6 + 0.4 * q : 0.75, !S.lite);
      }
      if (building || (!S.reduced && r() < 0.35)) { // vertical crackle from the ground
        const a = r() * TAU, [x1, y1] = cagePt(a);
        bolt(ctx, boltPts(S.X + (r() - 0.5) * S.H * 0.5, S.Y, x1, y1, crackSeed + 7, 0.3, 4), S.H * 0.01, building ? q : 0.6);
      }
      if (building && q > 0.75) { // charge flash just before the burst
        ctx.fillStyle = `rgba(179,32,42,${(q - 0.75) * 0.5})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, S.H * 0.5, S.H * 0.64, 0, 0, TAU); ctx.fill();
      }
    }
    // bolts lashing out (burst + chain hits), with forks
    for (const L of lashes) {
      const a = Math.min(1, (L.life / L.max) * 2.2);
      const grow = Math.min(1, (1 - L.life / L.max) * 5);
      const x1 = L.x0 + (L.x1 - L.x0) * grow, y1 = L.y0 + (L.y1 - L.y0) * grow;
      const seed = L.seed + ((now * 30) | 0); // re-jag while it lives
      const pts = boltPts(L.x0, L.y0, x1, y1, seed, 0.2, S.lite ? 4 : 5);
      bolt(ctx, pts, L.w, a, !S.lite);
      const r = rng(seed + 3);
      for (let k = 0; k < L.forks; k++) {
        const i = Math.floor(pts.length * (0.3 + r() * 0.5)), [fx, fy] = pts[i];
        const ang = Math.atan2(y1 - L.y0, x1 - L.x0) + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5);
        const len = Math.hypot(x1 - L.x0, y1 - L.y0) * (0.18 + r() * 0.2);
        bolt(ctx, boltPts(fx, fy, fx + Math.cos(ang) * len, fy + Math.sin(ang) * len, seed + k * 13, 0.3, 3), L.w * 0.55, a * 0.85, false);
      }
      if (grow >= 1) { // red ink flash where it lands
        ctx.fillStyle = `rgba(179,32,42,${a * 0.35})`;
        ctx.beginPath(); ctx.arc(L.x1, L.y1, L.w * 4 * (1.2 - a * 0.4), 0, TAU); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ beads
  function beadSprite(r) {
    const key = Math.round(r * 2);
    if (beadSpr.has(key)) return beadSpr.get(key);
    const R = Math.max(3, key / 2), s = Math.ceil(R * 2 + 4), c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), m = s / 2;
    const gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.1, m, m, R);
    gr.addColorStop(0, '#f06a5e'); gr.addColorStop(0.35, '#c62a32'); gr.addColorStop(0.85, '#7c121a'); gr.addColorStop(1, '#4a080d');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(22,20,18,.75)'; g.lineWidth = Math.max(1, R * 0.16); g.beginPath(); g.arc(m, m, R * 0.95, 0.3, TAU - 0.6); g.stroke();
    g.fillStyle = 'rgba(255,245,238,.9)'; g.beginPath(); g.ellipse(m - R * 0.38, m - R * 0.42, R * 0.32, R * 0.2, -0.6, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,230,225,.35)'; g.beginPath(); g.arc(m + R * 0.35, m + R * 0.4, R * 0.16, 0, TAU); g.fill();
    beadSpr.set(key, c); return c;
  }
  function drawBeads(ctx, front) {
    if (beadAmt < 0.01) return;
    const N = 14, H = S.H, bob = Math.sin(now * 1.8) * H * 0.025;
    const cx = S.X + S.dx * 0.6, cy = S.Y - H * 0.42 + bob;
    const grow = 0.55 + 0.45 * beadAmt, rx = H * 0.7 * grow, ry = rx * 0.3, tilt = -0.17 + Math.sin(now * 0.7) * 0.04;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // mala cord: back half behind him, front half in front
    ctx.strokeStyle = `rgba(22,20,18,${0.35 * beadAmt})`; ctx.lineWidth = Math.max(1, H * 0.006);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, tilt, front ? 0 : Math.PI, front ? Math.PI : TAU); ctx.stroke();
    for (let i = 0; i < N; i++) {
      const a = beadAng + (i / N) * TAU, z = Math.sin(a);
      if ((z >= 0) !== front) continue;
      const lx = Math.cos(a) * rx, ly = Math.sin(a) * ry;
      const x = cx + lx * ct - ly * st, y = cy + lx * st + ly * ct;
      const depth = (z + 1) / 2, sc = 0.72 + 0.4 * depth;
      const alpha = beadAmt * (0.55 + 0.45 * depth);
      // faint red ink trail behind each bead along the orbit
      if (!S.reduced && !S.lite) {
        ctx.strokeStyle = `rgba(179,32,42,${0.16 * alpha * Math.min(1, beadSpin / 2)})`; ctx.lineWidth = H * 0.03 * sc;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, tilt, a - 0.55, a); ctx.stroke();
      }
      const spr = beadSprite(H * 0.04 * sc);
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr, x - spr.width / 2, y - spr.height / 2);
      if (depth < 0.5) { // shade beads passing behind him
        ctx.globalAlpha = (0.5 - depth) * 0.7 * beadAmt; ctx.fillStyle = '#161412';
        ctx.beginPath(); ctx.arc(x, y, spr.width / 2 - 2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
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
