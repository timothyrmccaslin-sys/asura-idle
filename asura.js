// The Asura's martial-arts animator. Painted key poses (sumi-e, keyed from
// hand-painted art) are driven like a cutout rig: whole-body spins (scaleX
// turns with pose swaps at the back-facing instant), lunges, hops, leans and
// squash, plus smear ghosts, painted enso arc trails, whipping sash/hair
// ribbons and flying mala beads. Moves are chained into combos and timed so
// their impact frame lands exactly on the core's swing event. Pure
// presentation: never feeds anything back into the game simulation.
import { brush } from './figures.js';
import { redOf } from './art.js';

const PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
function curve(pts, u, def = 0) {
  if (!pts) return def;
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [u0, v0] = pts[i - 1], [u1, v1] = pts[i];
      return v0 + (v1 - v0) * ease((u - u0) / (u1 - u0 || 1));
    }
  }
  return pts[pts.length - 1][1];
}

// u = normalised move time. Distances are in Asura heights; y up is negative.
// trail: enso arc in the body frame (cx, cy centre; rx, ry radii; a0 -> a1 sweep).
export const MOVES = {
  backfist: {
    base: 0.62, imp: 0.46, spin: [0.1, 0.42], keys: [[0, 'idle'], [0.08, 'coil'], [0.26, 'backfist'], [0.84, 'idle']],
    lunge: [[0, 0], [0.12, -0.04], [0.46, 0.12], [0.76, 0.08], [1, 0]], rot: [[0, 0], [0.12, -0.06], [0.46, 0.05], [1, 0]],
    sy: [[0, 1], [0.1, 0.95], [0.3, 1.02], [0.6, 1]],
    trail: { cx: 0.05, cy: -0.66, rx: 0.62, ry: 0.2, a0: PI * 1.1, a1: -0.15, t0: 0.28 },
  },
  roundhouse: {
    base: 0.6, imp: 0.4, twist: [0.12, 0.42, 0.45], keys: [[0, 'idle'], [0.1, 'coil'], [0.28, 'roundhouse'], [0.82, 'idle']],
    lunge: [[0, 0], [0.12, -0.04], [0.4, 0.07], [1, 0]], rot: [[0, 0], [0.14, 0.05], [0.4, -0.1], [0.7, -0.05], [1, 0]],
    hop: [[0, 0], [0.3, 0.025], [0.48, 0]],
    trail: { cx: 0.1, cy: -0.66, rx: 0.72, ry: 0.22, a0: PI * 1.2, a1: -0.12, t0: 0.18 },
  },
  hook: { // spinning hook kick
    base: 0.72, imp: 0.5, spin: [0.08, 0.46], keys: [[0, 'idle'], [0.06, 'coil'], [0.28, 'roundhouse'], [0.86, 'idle']],
    lunge: [[0, 0], [0.5, 0.09], [1, 0]], rot: [[0, 0], [0.5, -0.13], [0.8, -0.04], [1, 0]],
    hop: [[0, 0], [0.3, 0.06], [0.5, 0.035], [0.66, 0]], sy: [[0, 1], [0.06, 0.94], [0.2, 1.03], [0.7, 1]],
    trail: { cx: 0.05, cy: -0.8, rx: 0.74, ry: 0.24, a0: PI * 1.55, a1: -0.1, t0: 0.12 },
  },
  tornado: {
    base: 0.8, imp: 0.5, spin: [0.05, 0.47], keys: [[0, 'coil'], [0.16, 'tornado'], [0.74, 'idle']],
    lunge: [[0, 0], [0.5, 0.08], [1, 0]], rot: [[0, 0], [0.45, -0.08], [0.7, 0], [1, 0]],
    hop: [[0, 0], [0.08, -0.02], [0.42, 0.25], [0.62, 0]], sy: [[0, 1], [0.08, 0.9], [0.2, 1.05], [0.6, 1], [0.66, 0.88], [0.8, 1]],
    trail: { cx: 0, cy: -0.72, rx: 0.78, ry: 0.28, a0: PI * 1.6, a1: -0.1, t0: 0.1 },
  },
  crescent: {
    base: 0.6, imp: 0.42, twist: [0.1, 0.44, 0.3], keys: [[0, 'idle'], [0.1, 'coil'], [0.28, 'crescent'], [0.8, 'idle']],
    lunge: [[0, 0], [0.42, 0.05], [1, 0]], rot: [[0, 0], [0.28, -0.07], [0.46, 0.04], [1, 0]], hop: [[0, 0], [0.34, 0.025], [0.5, 0]],
    trail: { cx: 0.14, cy: -0.62, rx: 0.36, ry: 0.54, a0: PI * 0.95, a1: PI * 2.1, t0: 0.2 },
  },
  palm: {
    base: 0.5, imp: 0.34, keys: [[0, 'idle'], [0.08, 'coil'], [0.24, 'palm'], [0.78, 'idle']],
    lunge: [[0, 0], [0.1, -0.05], [0.34, 0.17], [0.7, 0.1], [1, 0]], rot: [[0, 0], [0.1, -0.05], [0.34, 0.07], [1, 0]],
    sy: [[0, 1], [0.1, 0.95], [0.3, 1]],
    trail: { cx: 0.2, cy: -0.64, rx: 0.48, ry: 0.15, a0: PI * 0.9, a1: 0.05, t0: 0.16 },
  },
  uppercut: {
    base: 0.58, imp: 0.38, keys: [[0, 'idle'], [0.08, 'coil'], [0.26, 'uppercut'], [0.8, 'idle']],
    sy: [[0, 1], [0.14, 0.9], [0.32, 1.06], [0.5, 1]], hop: [[0, 0], [0.14, -0.02], [0.4, 0.07], [0.6, 0]],
    lunge: [[0, 0], [0.38, 0.09], [1, 0]], rot: [[0, 0], [0.14, 0.06], [0.38, -0.05], [1, 0]],
    trail: { cx: 0.22, cy: -0.6, rx: 0.25, ry: 0.5, a0: PI * 0.55, a1: -PI * 0.62, t0: 0.16 },
  },
  sweep: {
    base: 0.66, imp: 0.44, spin: [0.06, 0.44], keys: [[0, 'coil'], [0.12, 'sweep'], [0.8, 'idle']],
    sy: [[0, 1], [0.12, 0.95], [0.7, 1]], lunge: [[0, 0], [0.44, 0.04], [1, 0]],
    trail: { cx: 0, cy: -0.06, rx: 0.98, ry: 0.3, a0: PI * 1.6, a1: -0.1, t0: 0.08 },
  },
  slam: { // Wrath Burst: leaping spin into a ground slam
    base: 0.9, imp: 0.44, spin: [0.04, 0.36], keys: [[0, 'coil'], [0.1, 'tornado'], [0.38, 'slam'], [0.86, 'idle']],
    hop: [[0, 0], [0.06, -0.02], [0.24, 0.32], [0.42, 0]], sy: [[0, 1], [0.05, 0.88], [0.2, 1.06], [0.42, 1], [0.47, 0.84], [0.62, 1]],
    trail: { cx: 0, cy: -0.72, rx: 0.72, ry: 0.26, a0: PI * 1.6, a1: -0.1, t0: 0.04, red: true },
  },
};
const POSE_K = { slam: 0.9, sweep: 1.0, tornado: 0.97, coil: 1.0 };

export function createAsura() {
  let now = 0, face = 1, cur = null, prev = null, hitstop = 0, critGlow = 0;
  let lastImpact = -9, lastN = 1, combo = 0, comboIdx = 0, recent = [];
  const trails = [], hist = [], beadHist = [], waves = [];
  let ribbons = null, lastSt = null, lastDist = new Map();
  const S = { reduced: false, lite: false, H: 100, X: 0, Y: 0, dpr: 1, SQ: 0.8, scale: 1 };

  function dur(M, aps, storm, arms) {
    const minD = storm ? 0.22 : arms ? 0.26 : 0.3;
    return clamp(Math.min(M.base, 1.45 / Math.max(aps, 0.1)), minD, M.base);
  }
  // visual cap: about 3.3 full moves/s (5 during Storm); faster swings become echo strikes
  const minGapFor = (storm, arms) => (storm ? 0.2 : arms ? 0.24 : 0.3);

  function pick(tx, ty, range, storm, arms) {
    const d = Math.hypot(tx, ty * S.SQ) || 1, r = Math.hypot(tx, ty) / (range || 1), vert = (ty * S.SQ) / d;
    let pool;
    if (arms) pool = ['palm', 'palm', 'uppercut', 'palm', 'backfist'];
    else if (storm) pool = ['palm', 'backfist', 'uppercut', 'roundhouse', 'palm', 'crescent'];
    else if (lastN >= 3) pool = ['tornado', 'sweep', 'backfist', 'hook'];
    else if (r < 0.55) pool = vert < -0.5 ? ['uppercut', 'crescent', 'palm', 'backfist'] : vert > 0.5 ? ['sweep', 'palm', 'backfist', 'uppercut'] : ['palm', 'backfist', 'uppercut', 'crescent'];
    else pool = vert < -0.5 ? ['crescent', 'hook', 'roundhouse', 'tornado'] : vert > 0.5 ? ['sweep', 'roundhouse', 'hook', 'crescent'] : ['roundhouse', 'hook', 'crescent', 'tornado'];
    combo = now - lastImpact < 1.1 ? combo + 1 : 0;
    if (!storm && !arms && combo > 0 && combo % 5 === 4) return lastN >= 3 ? 'sweep' : 'tornado'; // combo finisher
    let name = pool[comboIdx++ % pool.length];
    if (recent[0] === name) name = pool[comboIdx++ % pool.length];
    return name;
  }

  const stats = { moves: 0, attacks: 0, snapped: 0, echoes: 0, fresh: 0, shiftMs: 0 };
  function start(name, D, t0, tx, ty) {
    const M = MOVES[name]; stats.moves++;
    const nf = Math.abs(tx) < 0.02 ? face : tx < 0 ? -1 : 1;
    if (cur) prev = { st: lastSt, until: now + 0.07 };
    const dx = tx, dy = ty * S.SQ, dd = Math.hypot(dx, dy) || 1;
    cur = { name, M, D, start: t0, impactT: t0 + M.imp * D, hitDone: false, f0: face, f1: nf, dir: [dx / dd, dy / dd],
      tilt: clamp(Math.atan2(dy, Math.abs(dx)), -0.45, 0.45) * 0.8, red: !!M.trail.red, locked: false };
    face = nf;
    recent.unshift(name); recent.length = Math.min(recent.length, 3);
    if (M.trail) addTrail(M.trail, cur, false);
    return cur;
  }

  function addTrail(sp, m, echo) {
    trails.push({ sp, m, echo, f: m.f1, tilt: m.tilt, red: m.red || sp.red,
      t0: m.start + sp.t0 * m.D, ti: m.impactT, te: m.impactT + (echo ? 0.12 : 0.26) });
    if (trails.length > 7) trails.shift();
  }

  function echo(tx, ty, red) {
    const dx = tx, dy = ty * S.SQ, dd = Math.hypot(dx, dy) || 1;
    const f1 = tx < 0 ? -1 : 1;
    const hgt = -0.48 - Math.random() * 0.34, up = Math.random() < 0.5;
    const sp = up ? { cx: 0.2, cy: hgt, rx: 0.28, ry: 0.42, a0: PI * 0.6, a1: -PI * 0.5, t0: 0 }
      : { cx: 0.15, cy: hgt, rx: 0.55, ry: 0.16, a0: PI * 0.95, a1: 0.1, t0: 0 };
    const m = { start: now, impactT: now + 0.06, D: 0.06, f1, tilt: clamp(Math.atan2(dy, Math.abs(dx)), -0.45, 0.45) * 0.8, red };
    addTrail(sp, m, true);
  }

  // ---- state evaluation
  function evalState() {
    let st = { pose: 'idle', next: null, mix: 0, sx: face, sy: 1, dx: 0, dy: 0, rot: 0, u: 1, spinV: 0, smear: 0 };
    const breath = S.reduced ? 0 : Math.sin(now * 2.4);
    if (cur) {
      const m = cur, M = m.M, u = clamp((now - m.start) / m.D, 0, 1);
      st.u = u;
      let k = 0;
      for (let i = 0; i < M.keys.length; i++) if (u >= M.keys[i][0]) k = i;
      st.pose = M.keys[k][1];
      const nk = M.keys[k + 1];
      if (nk && nk[1] === 'idle') { const w = 0.08; st.mix = clamp((u - (nk[0] - w)) / w, 0, 1); st.next = 'idle'; }
      // facing / rotation
      let sx = m.f1;
      if (!S.reduced) {
        if (M.spin) {
          const s = ease(clamp((u - M.spin[0]) / (M.spin[1] - M.spin[0]), 0, 1));
          const N = 2 + (m.f0 !== m.f1 ? 1 : 0);
          const c = Math.cos(PI * N * s);
          sx = m.f0 * c;
          st.spinV = s > 0 && s < 1 ? Math.abs(Math.sin(PI * N * s)) : 0;
          if (s > 0 && s < 1 && Math.abs(c) < 0.5 && u < M.imp) st.smear = 1;
        } else if (m.f0 !== m.f1) {
          const s = ease(clamp(u / 0.14, 0, 1));
          sx = m.f0 * Math.cos(PI * s);
          st.spinV = s > 0 && s < 1 ? 1 : 0;
        }
        if (M.twist) {
          const [a, b, amt] = M.twist;
          sx *= 1 - amt * Math.sin(PI * clamp((u - a) / (b - a), 0, 1));
        }
      }
      // keep the body from collapsing to a sliver mid-turn (a torso has depth)
      const sg = sx < 0 ? -1 : 1;
      st.sx = sg * (0.36 + 0.64 * Math.abs(sx));
      const L = curve(M.lunge, u) * S.H;
      st.dx = m.dir[0] * L; st.dy = m.dir[1] * L - curve(M.hop, u) * S.H;
      st.rot = curve(M.rot, u); st.sy = curve(M.sy, u, 1);
      if (u > M.imp - 0.07 && u < M.imp + 0.02) st.smear = Math.max(st.smear, 0.7);
      if (u >= 1) cur = null;
    }
    if (!cur) st.sy *= 1 + breath * 0.012;
    else st.sy *= 1 + breath * 0.006;
    return st;
  }

  // ---- public: per frame
  function update(dt, f, en, range, env) {
    Object.assign(S, env);
    const timeScale = hitstop > 0 ? 0.14 : 1;
    if (hitstop > 0) hitstop -= dt;
    critGlow = Math.max(0, critGlow - dt * 5);
    now += dt * timeScale;
    const storm = f[7] > 0, arms = f[9] > 0, aps = f[16] || 1, phase = f[15] || 0;
    // the core's next target: nearest foe in range, or the first one about to
    // step into range (approach speed tracked per foe id) so the wind-up can
    // start before the swing instead of snapping straight to the impact frame
    let best = 1e9, tx = 0, ty = 0, tEnter = 1e9, ex = 0, ey = 0;
    const seen = new Map();
    for (let o = 0; o < en.length; o += 11) {
      const id = en[o], x = en[o + 2], y = en[o + 3], d = Math.hypot(x, y);
      seen.set(id, d);
      if (d <= range) { if (d < best) { best = d; tx = x; ty = y; } continue; }
      const pd = lastDist.get(id);
      if (pd !== undefined && dt > 0 && dt * timeScale > 0) {
        const v = (pd - d) / dt;
        if (v > 1e-3) { const te = (d - range) / v; if (te < tEnter) { tEnter = te; ex = x; ey = y; } }
      }
    }
    lastDist = seen;
    let tNext = 1e9;
    if (best < 1e9) tNext = (1 - phase) / aps;
    else if (tEnter < 0.6) { tNext = tEnter; tx = ex; ty = ey; best = 0; }
    if (best < 1e9 && (!cur || (cur.hitDone && !cur.locked))) {
      const name = peekName(tx, ty, range, storm, arms);
      const D = dur(MOVES[name], aps, storm, arms), lead = MOVES[name].imp * D;
      if (tNext <= lead && now - lastImpact >= minGapFor(storm, arms) && (!cur || now - cur.impactT > 0.05)) {
        pick(tx, ty, range, storm, arms); // commit the combo step
        start(name, D, now - (lead - tNext), tx, ty);
      }
    }
    if (cur && cur.locked && now > cur.impactT + 0.12) cur.locked = false;
    return timeScale;
  }
  // non-committing preview of the next pick (same rules, no state change)
  function peekName(tx, ty, range, storm, arms) {
    const save = [combo, comboIdx, recent.slice()];
    const n = pick(tx, ty, range, storm, arms);
    [combo, comboIdx] = save; recent = save[2];
    return n;
  }

  // ---- public: events from the core
  function onAttack(x, y, n, storm, arms, range) {
    lastN = n; stats.attacks++;
    if (cur && cur.locked) { echo(x, y, arms); return null; }
    if (cur && !cur.hitDone) {
      stats.snapped++;
      const shift = now - cur.impactT;
      stats.shiftMs += Math.abs(shift) * 1000;
      cur.start += shift; cur.impactT = now;
      for (const t of trails) if (t.m === cur) { t.t0 += shift; t.ti += shift; t.te += shift; }
    } else if (!cur || now - lastImpact >= minGapFor(storm, arms)) {
      stats.fresh++;
      const name = pick(x, y, range, storm, arms);
      const M = MOVES[name], D = dur(M, 4, storm, arms);
      start(name, D, now - M.imp * D, x, y);
    } else {
      stats.echoes++;
      echo(x, y, arms);
      kiWave(x, y, arms);
      return null;
    }
    cur.hitDone = true; lastImpact = now;
    kiWave(x, y, arms);
    return cur.name;
  }
  // a painted crescent of ki that flies from the strike to a foe at range
  function kiWave(x, y, red) {
    const tx = S.X + x * S.scale, ty = S.Y + y * S.scale * S.SQ - 0.07 * S.scale;
    const ox = S.X + (x < 0 ? -1 : 1) * S.H * 0.18, oy = S.Y - S.H * 0.6;
    const dist = Math.hypot(tx - ox, ty - oy);
    if (dist < S.H * 0.45) return; // in reach of the limb itself
    waves.push({ ox, oy, tx, ty, t0: now, life: clamp(dist / (S.H * 14), 0.06, 0.12), red });
    if (waves.length > 8) waves.shift();
  }
  function drawWaves(ctx, strokeTex) {
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], q = (now - w.t0) / w.life;
      if (q >= 1.25) { waves.splice(i, 1); continue; }
      const p = easeOut(clamp(q, 0, 1));
      const x = w.ox + (w.tx - w.ox) * p, y = w.oy + (w.ty - w.oy) * p;
      const dir = Math.atan2(w.ty - w.oy, w.tx - w.ox);
      const tex = strokeTex(w.red), L = tex.width, Th = tex.height;
      const R = S.H * (0.12 + 0.08 * p), span = 1.9, N = 7, thick = S.H * 0.07;
      ctx.save();
      ctx.globalAlpha = q < 1 ? 0.9 : Math.max(0, 0.9 * (1.25 - q) * 4);
      ctx.translate(x, y); ctx.rotate(dir); ctx.scale(0.55, 1); // crescent bowed toward travel
      for (let k = 0; k < N; k++) {
        const a0 = -span / 2 + (span * k) / N, a1 = a0 + span / N, am = (a0 + a1) / 2;
        const seg = R * (a1 - a0);
        ctx.save(); ctx.translate(Math.cos(am) * R - R, Math.sin(am) * R); ctx.rotate(am + Math.PI / 2);
        ctx.drawImage(tex, (0.2 + 0.6 * k / N) * L, 0, (0.6 / N) * L, Th, -seg * 0.6, -thick / 2, seg * 1.2, thick);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  function onCrit() {
    critGlow = 1;
    if (!S.reduced) hitstop = 0.1;
  }
  // Wrath Burst: returns the delay (s) until the slam lands, so the renderer
  // can hold the shockwave/damage numbers for that beat.
  function castSlam() {
    const M = MOVES.slam, D = S.reduced ? 0.6 : M.base;
    start('slam', D, now, face * 0.1, 0.0001);
    cur.locked = true; cur.hitDone = true;
    lastImpact = cur.impactT;
    return M.imp * D;
  }

  // ---- drawing
  // red ghost of just the striking arm (masked off the palm pose with soft fades)
  function armGhost(fr) {
    if (fr.arm) return fr.arm;
    const c = document.createElement('canvas'); c.width = fr.w; c.height = fr.h;
    const g = c.getContext('2d'); g.drawImage(redOf(fr), 0, 0);
    const px = fr.beads ? fr.beads[0] : fr.w * 0.55, py = fr.beads ? fr.beads[1] : fr.h * 0.3;
    g.globalCompositeOperation = 'destination-in';
    const gx = g.createLinearGradient(px + fr.w * 0.02, 0, px + fr.w * 0.2, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gx; g.fillRect(0, 0, fr.w, fr.h);
    const gy = g.createLinearGradient(0, py - fr.h * 0.2, 0, py + fr.h * 0.24);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.35, 'rgba(0,0,0,1)'); gy.addColorStop(0.65, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, fr.w, fr.h);
    return (fr.arm = c);
  }
  function frameFor(getPose, name) { return getPose(name) || getPose('idle'); }
  function xform(ctx, st, fr, pk) {
    ctx.translate(S.X + st.dx, S.Y + st.dy);
    ctx.rotate(st.rot * (st.sx < 0 ? -1 : 1));
    ctx.scale(st.sx * pk, st.sy * pk);
  }
  function drawPose(ctx, st, fr, alpha, img) {
    const pk = POSE_K[st.pose] || 1;
    ctx.save(); xform(ctx, st, fr, pk);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img || fr.c, -fr.ax, -fr.ay);
    ctx.restore();
  }
  function toScreen(st, fr, p) {
    const pk = POSE_K[st.pose] || 1, s = st.sx < 0 ? -1 : 1, r = st.rot * s;
    const lx = (p[0] - fr.ax) * st.sx * pk, ly = (p[1] - fr.ay) * st.sy * pk;
    return [S.X + st.dx + lx * Math.cos(r) - ly * Math.sin(r), S.Y + st.dy + lx * Math.sin(r) + ly * Math.cos(r)];
  }

  function stepRibbons(dt, st, fr) {
    const H = S.H;
    const sash = fr.sash ? toScreen(st, fr, [fr.sash[0] - fr.w * 0.06 * 0, fr.sash[1]]) : [S.X, S.Y - H * 0.4];
    const head = fr.head ? toScreen(st, fr, fr.head) : [S.X, S.Y - H * 0.85];
    const back = st.sx < 0 ? 1 : -1;
    const specs = [
      { a: sash, n: 7, L: H * 0.055, g: H * 1.6, wind: H * 0.5, off: [back * H * 0.05, 0] },
      { a: sash, n: 6, L: H * 0.05, g: H * 1.9, wind: H * 0.35, off: [back * H * 0.03, H * 0.02] },
      { a: head, n: 6, L: H * 0.045, g: -H * 0.25, wind: H * 0.9, off: [back * H * 0.04, -H * 0.01] },
      { a: head, n: 5, L: H * 0.042, g: -H * 0.4, wind: H * 0.7, off: [back * H * 0.03, -H * 0.03] },
      { a: head, n: 5, L: H * 0.038, g: H * 0.1, wind: H * 0.8, off: [back * H * 0.05, H * 0.01] },
    ];
    if (!ribbons || dt > 0.2) ribbons = specs.map((s) => Array.from({ length: s.n }, (_, i) => ({ x: s.a[0] + s.off[0] + back * i * s.L, y: s.a[1] + s.off[1], px: 0, py: 0 })).map((p) => ((p.px = p.x), (p.py = p.y), p)));
    const h = Math.min(dt, 1 / 30);
    specs.forEach((s, k) => {
      const pts = ribbons[k];
      pts[0].x = s.a[0] + s.off[0]; pts[0].y = s.a[1] + s.off[1];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
        p.px = p.x; p.py = p.y;
        const flutter = Math.sin(now * 9 + i * 0.9 + k * 2) * s.wind * 0.35;
        p.x += vx + back * s.wind * h * h * 6;
        p.y += vy + (s.g + flutter) * h * h;
      }
      for (let it = 0; it < 2; it++) for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, e = (d - s.L) / d;
        b.x -= dx * e; b.y -= dy * e;
      }
    });
  }
  function drawRibbons(ctx) {
    if (!ribbons) return;
    const H = S.H;
    const col = ['rgba(165,28,36,.92)', 'rgba(140,22,30,.85)', 'rgba(22,20,18,.9)', 'rgba(22,20,18,.85)', 'rgba(30,27,24,.7)'];
    const w0 = [0.03, 0.022, 0.018, 0.014, 0.012];
    ribbons.forEach((pts, k) => brush(ctx, pts.map((p) => [p.x, p.y]), w0[k] * H, 0.003 * H, col[k], 0.4));
  }

  // bend the painted dry-brush strip along the trail's ellipse in slices
  function drawTrails(ctx, strokeTex) {
    for (let i = trails.length - 1; i >= 0; i--) {
      const t = trails[i];
      if (now > t.te) { trails.splice(i, 1); continue; }
      if (now < t.t0) continue;
      const sp = t.sp, H = S.H;
      const head = easeOut(clamp((now - t.t0) / Math.max(0.001, t.ti - t.t0), 0, 1));
      const tail = ease(clamp((now - t.ti) / (t.te - t.ti), 0, 1));
      if (head - tail < 0.01) continue;
      const tex = strokeTex(t.red), L = tex.width, Th = tex.height;
      const rx = sp.rx * H, ry = sp.ry * H, span = sp.a1 - sp.a0;
      const thick = H * (t.echo ? 0.08 : sp.w || 0.13);
      const N = S.reduced || S.lite || t.echo ? 8 : 14;
      ctx.save();
      ctx.globalAlpha = (t.echo ? 0.7 : 0.92) * (1 - tail * 0.45) * (S.reduced ? 0.6 : 1);
      ctx.translate(S.X + sp.cx * H * t.f, S.Y + sp.cy * H);
      ctx.scale(t.f, 1); ctx.rotate(t.tilt);
      const q0 = Math.floor(tail * N), q1 = Math.ceil(head * N);
      for (let k = q0; k < q1; k++) {
        const u0 = Math.max(k / N, tail), u1 = Math.min((k + 1) / N, head);
        const a = sp.a0 + span * (u0 + u1) / 2;
        const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
        const tx = -Math.sin(a) * rx * span, ty = Math.cos(a) * ry * span;
        const seg = Math.hypot(tx, ty) * (u1 - u0);
        ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(ty, tx));
        // the trail thins toward the leading edge while it is still being drawn
        const lead = head < 1 ? 0.55 + 0.45 * clamp((head - (u0 + u1) / 2) * 4, 0, 1) : 1;
        ctx.drawImage(tex, u0 * L, 0, Math.max(1, (u1 - u0) * L), Th, -seg * 0.08, -thick * lead / 2, seg * 1.16, thick * lead);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  function draw(ctx, dt, getPose, strokeTex, f) {
    const st = evalState();
    const fr = frameFor(getPose, st.pose);
    const arms = f[9] > 0, storm = f[7] > 0;
    // ground shadow (stays on the ground during hops)
    const lift = Math.max(0, -(st.dy - (cur ? cur.dir[1] * curve(cur.M.lunge, st.u) * S.H : 0)));
    ctx.fillStyle = `rgba(22,20,18,${0.26 - Math.min(0.14, lift / S.H * 0.4)})`;
    ctx.beginPath(); ctx.ellipse(S.X + st.dx * 0.8, S.Y + (cur ? cur.dir[1] * curve(cur.M.lunge, st.u) * S.H : 0), S.H * (0.3 - lift / S.H * 0.25), S.H * 0.06, 0, 0, PI * 2); ctx.fill();

    // smear ghosts from the last frames
    if (!S.reduced && !S.lite && hist.length >= 3 && (st.spinV > 0.3 || st.smear > 0)) {
      const g1 = hist[hist.length - 3], g2 = hist[hist.length - 1];
      const fa = frameFor(getPose, g1.pose), fb = frameFor(getPose, g2.pose);
      drawPose(ctx, g1, fa, 0.14 + 0.1 * st.smear);
      drawPose(ctx, g2, fb, 0.22 + 0.12 * st.smear);
    }
    // Six Arms: a fan of red ghost arms striking in a staggered barrage
    if (arms) {
      const pf = frameFor(getPose, 'palm'), red = armGhost(pf);
      const piv = pf.beads ? pf.beads : [pf.ax, pf.ay * 0.35];
      const base = { ...st, pose: 'palm' };
      [-0.75, -0.42, -0.14, 0.2, 0.5, 0.8].forEach((a, i) => {
        const pulse = Math.max(0, Math.sin(now * (S.reduced ? 6 : 17) + i * 2.1));
        if (pulse < 0.05) return;
        ctx.save();
        const P = toScreen(base, pf, piv), sg = st.sx < 0 ? -1 : 1;
        ctx.translate(P[0], P[1]); ctx.rotate(a * sg); ctx.translate(-P[0], -P[1]);
        drawPose(ctx, { ...base, dx: base.dx + sg * (pulse - 0.4) * S.H * 0.12 }, pf, 0.6 * pulse, red);
        ctx.restore();
      });
    }
    // previous move cross-fade (when a combo interrupts a follow-through)
    if (prev && prev.st && now < prev.until) drawPose(ctx, prev.st, frameFor(getPose, prev.st.pose), 0.5 * (prev.until - now) / 0.07);
    else prev = null;

    if (!S.reduced && !S.lite) stepRibbons(dt, st, fr);
    else ribbons = null;
    // impact smear: the pose stretched along the strike
    if (!S.reduced && st.smear >= 0.7 && cur) {
      const sm = { ...st, sx: st.sx * 1.16, dx: st.dx - cur.dir[0] * S.H * 0.05 };
      drawPose(ctx, sm, fr, 0.22);
    }
    drawRibbons(ctx);
    if (st.mix > 0 && st.next) {
      drawPose(ctx, st, fr, 1 - st.mix * 0.6);
      const st2 = { ...st, pose: st.next };
      drawPose(ctx, st2, frameFor(getPose, st.next), st.mix);
    } else drawPose(ctx, st, fr, 1);
    // crit: a single red-ink impact echo, stretched along the strike
    if (critGlow > 0.6 && !S.reduced && cur) drawPose(ctx, { ...st, sx: st.sx * (1 + (1 - critGlow) * 0.5) }, fr, (critGlow - 0.6) * 0.5, redOf(fr));

    // flying mala beads during spins
    const bp = fr.beads ? toScreen(st, fr, fr.beads) : null;
    if (bp) { beadHist.push(bp); if (beadHist.length > 7) beadHist.shift(); }
    if (!S.reduced && st.spinV > 0.25 && beadHist.length > 4) {
      ctx.fillStyle = '#b3202a';
      for (let i = 0; i < beadHist.length - 1; i++) {
        const p = beadHist[i], q = (i + 1) / beadHist.length;
        ctx.globalAlpha = q * 0.8;
        ctx.beginPath(); ctx.arc(p[0], p[1] + Math.sin(i * 1.3) * S.H * 0.02, S.H * 0.014 * (0.6 + q * 0.5), 0, PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    drawTrails(ctx, strokeTex);
    drawWaves(ctx, strokeTex);
    hist.push(st); if (hist.length > 4) hist.shift();
    lastSt = st;
    return st;
  }

  // harness hook for the contact sheet: play one move toward (tx, ty)
  function debugPlay(name, tx = 0.3, ty = 0, D) {
    const M = MOVES[name]; cur = null; face = 1;
    start(name, D || M.base, now, tx, ty);
    if (name === 'slam') cur.locked = true;
  }
  return { update, draw, onAttack, onCrit, castSlam, debugPlay, get now() { return now; }, get busy() { return !!cur; }, get pose() { return lastSt; }, stats, MOVES };
}
