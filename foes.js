// Painted foe animation: a cutout rig over each painted sprite.
//
// Each sprite is split once (per on-screen size) into parts with feathered
// masks: the legs below the hip (left and right of the feet anchor, swung like
// scissors about the hip), the upper body (bent about the hip and rippled in
// strips for cloth, hair and banners), and per-type pieces with their own
// pivots: weapon arms, tengu wings, the Shogun's banner. Flyers hover and flap;
// Orochi's heads slither in a travelling wave.
//
// Per foe (keyed by id) the rig tracks ground speed (the walk cycle advances
// with distance covered, so slowed foes stride slower), melee contact (the
// windup and strike are timed to the core's 0.6 s first hit then 1 s cadence),
// hit flinch with knockback, a boss entrance roar, and an idle breath.
const TAU = Math.PI * 2;
// fractions of the frame: hip line, parts {rect, pivot}, attack style
const RIG = {
  0: { hip: 0.6, atk: 'thrust', parts: [{ n: 'arm', r: [0.52, 0, 1, 0.46], p: [0.55, 0.42] }] },
  1: { hip: 0.6, atk: 'slash', parts: [{ n: 'arm', r: [0.6, 0.25, 1, 0.6], p: [0.6, 0.36] }] },
  2: { hip: 0.62, atk: 'swipe', hop: true, parts: [{ n: 'arm', r: [0.64, 0.3, 1, 0.66], p: [0.64, 0.38] }] },
  3: { hip: 0.62, atk: 'lunge', parts: [] },
  4: { hip: 0.6, atk: 'chop', parts: [] },
  5: { fly: true, atk: 'swipe', parts: [{ n: 'arm', r: [0.68, 0.3, 1, 0.62], p: [0.68, 0.42] }, { n: 'wingL', r: [0, 0, 0.32, 0.62], p: [0.34, 0.35] }] },
  6: { fly: true, ghost: true, atk: 'reach', parts: [{ n: 'arm', r: [0.62, 0.25, 1, 0.55], p: [0.62, 0.3] }] },
  7: { hip: 0.62, atk: 'chop', heavy: true, parts: [] },
  8: { hip: 0.64, atk: 'chop', heavy: true, parts: [] },
  9: { fly: true, atk: 'swipe', parts: [{ n: 'arm', r: [0.72, 0.02, 1, 0.4], p: [0.75, 0.36] }, { n: 'wingL', r: [0, 0, 0.36, 0.5], p: [0.38, 0.35] }, { n: 'wingR', r: [0.74, 0.38, 1, 0.58], p: [0.72, 0.42] }] },
  10: { hip: 0.64, atk: 'slash', parts: [{ n: 'arm', r: [0.66, 0.52, 1, 0.94], p: [0.62, 0.55], fade: 0.3 }, { n: 'banner', r: [0, 0, 0.45, 0.45], p: [0.42, 0.45] }] },
  11: { serpent: true, atk: 'strike', parts: [] },
  12: { fly: true, ghost: true, atk: 'reach', parts: [{ n: 'arm', r: [0.74, 0.28, 1, 0.52], p: [0.75, 0.34] }] },
};
const STRIDE = 0.11;   // world units per half stride
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) * (1 - x));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

// feathered rectangle mask: interior 1, ramping to 0 over F px at cut edges
// (edges on the frame border stay hard)
function rectMask(w, h, r, F) {
  const c = mk(w, h), g = c.getContext('2d');
  const x0 = r[0] * w, y0 = r[1] * h, x1 = r[2] * w, y1 = r[3] * h;
  g.globalCompositeOperation = 'lighter';
  const n = Math.max(1, Math.round(F));
  g.globalAlpha = 1 / n; g.fillStyle = '#fff';
  for (let i = 0; i < n; i++) {
    const e = i - n / 2;
    const ax0 = r[0] <= 0 ? -2 : x0 + e, ay0 = r[1] <= 0 ? -2 : y0 + e;
    const ax1 = r[2] >= 1 ? w + 2 : x1 - e, ay1 = r[3] >= 1 ? h + 2 : y1 - e;
    g.fillRect(ax0, ay0, ax1 - ax0, ay1 - ay0);
  }
  return c;
}
function cut(src, mask, keepInside, amount = 1) {
  const c = mk(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = keepInside ? 'destination-in' : 'destination-out';
  g.globalAlpha = amount;
  g.drawImage(mask, 0, 0);
  return c;
}

export function createFoeRig({ frame, flashOf }) {
  const rigs = new Map(); // kind -> split parts for the current frame canvas
  const st = new Map();   // id -> per-foe animation state
  let now = 0;

  function rigFor(kind) {
    const fr = frame(kind); if (!fr) return null;
    let R = rigs.get(kind);
    if (R && R.src === fr.c) return R;
    const spec = RIG[kind] || { hip: 0.6, parts: [] };
    const w = fr.w, h = fr.h, F = Math.max(3, h * 0.025);
    let body = fr.c;
    const parts = [];
    for (const p of spec.parts) {
      const m = rectMask(w, h, p.r, F);
      parts.push({ n: p.n, c: cut(body, m, true), px: p.p[0] * w, py: p.p[1] * h, flash: null });
      body = cut(body, m, false, p.fade != null ? p.fade : p.n === 'banner' ? 1 : 0.62);
    }
    R = { src: fr.c, fr, spec, w, h, ax: fr.ax, ay: fr.ay, body: { c: body, flash: null }, parts, hip: spec.hip ? Math.round(h * spec.hip) : 0 };
    rigs.set(kind, R);
    return R;
  }

  // ------------------------------------------------------------ state
  function update(en, dt, t, onStrike) {
    now = t;
    for (const s of st.values()) s.seen = false;
    for (let o = 0; o < en.length; o += 11) {
      const id = en[o], kind = en[o + 1], x = en[o + 2], y = en[o + 3], size = en[o + 5], flash = en[o + 7], boss = en[o + 9] > 0;
      let s = st.get(id);
      if (!s) { s = { x, y, ph: Math.random() * TAU, v: 0, hit: 0, lf: 0, melee: -1, seed: Math.random() * TAU, struck: -1, boss, kind, kb: 1 }; st.set(id, s); }
      s.seen = true;
      const d = Math.hypot(x, y), mv = Math.hypot(x - s.x, y - s.y);
      const v = dt > 0 ? mv / dt : 0;
      s.v += (Math.min(v, 1.5) - s.v) * Math.min(1, dt * 8);
      s.ph += (mv / STRIDE) * Math.PI;
      s.x = x; s.y = y;
      if (flash > s.lf + 1e-4) { s.hit = 1; s.kb = boss ? 0.4 : 1; }
      s.lf = flash;
      s.hit = Math.max(0, s.hit - dt / 0.26);
      const stop = 0.075 + size * 0.35;
      if (d <= stop + 0.012) {
        if (s.melee < 0) s.melee = 0;
        s.melee += dt;
        // the core hits 0.6 s after contact, then every 1 s
        const k = s.melee >= 0.6 ? Math.floor(s.melee - 0.6) : -1;
        if (k >= 0 && k !== s.struck) { s.struck = k; if (onStrike) onStrike(x, y, kind, boss); }
      } else if (s.melee >= 0 && d > stop + 0.05) { s.melee = -1; s.struck = -1; }
    }
    for (const [id, s] of st) if (!s.seen) st.delete(id);
  }
  // attack curve: -1 at full windup, peaks past +1 on the strike, eases home
  function attack(s) {
    if (s.melee < 0) return 0;
    const tm = s.melee, P = 1.0;
    let u;
    if (tm < 0.6) u = 1 - (0.6 - tm) / P; // the run-up to the first hit
    else u = ((tm - 0.6) % P) / P;
    if (u < 0.1) return -1 + 2.25 * easeOut(u / 0.1);
    if (u < 0.45) return 1.25 * (1 - ease((u - 0.1) / 0.35));
    if (u < 0.6) return 0;
    return -ease((u - 0.6) / 0.4);
  }

  // ------------------------------------------------------------ draw
  // X, Y: feet on screen; sz: perspective scale; face: 1 = facing right
  function draw(ctx, id, kind, X, Y, sz, face, o) {
    const R = rigFor(kind); if (!R) return null;
    const s = st.get(id) || { ph: 0, v: 0, hit: 0, melee: -1, seed: 0, boss: false };
    const { w, h, ax, ay, spec } = R;
    const q = o.quality; // 'full' | 'lite' | 'reduced'
    const fl = o.flash;
    const bodyC = fl ? (R.body.flash || (R.body.flash = flashOf(R.body))) : R.body.c;
    ctx.save();
    ctx.translate(X, Y); ctx.scale(sz * face, sz);
    if (o.spawn < 1) ctx.scale(1, 0.75 + 0.25 * o.spawn);
    if (q === 'reduced') {
      ctx.drawImage(fl ? flashOf(R.fr) : R.fr.c, -ax, -ay);
      ctx.restore(); return R;
    }
    const t = now + s.seed;
    const run = Math.min(1, s.v / 0.12);           // 0 standing .. 1 full stride
    const a = attack(s), heavy = spec.heavy || s.boss;
    const hit = ease(s.hit) * (s.kb || 1);
    const age = o.age || 9;
    const roar = s.boss && age < 1.4 ? Math.sin(Math.PI * Math.min(1, age / 1.4)) : 0;
    const breathe = Math.sin(t * (s.boss ? 1.8 : 2.6)) * (1 - run);
    // whole-body motion
    let dx = -hit * w * 0.08 + Math.max(0, a) * w * (heavy ? 0.06 : 0.1) + Math.min(0, a) * w * 0.03;
    let lean = run * 0.07 + a * (heavy ? 0.2 : 0.14) - hit * 0.22 - roar * 0.18;
    let bob = 0;
    if (spec.fly) bob = (Math.sin(t * 2.1) * 0.035 + 0.03) * h;
    else if (spec.hop) bob = Math.max(0, Math.sin(s.ph)) * h * 0.07 * run;
    else bob = Math.abs(Math.sin(s.ph)) * h * 0.022 * run;
    ctx.translate(dx, -bob);
    if (roar) ctx.scale(1 + roar * 0.05, 1 + roar * 0.07);
    const sy = 1 + breathe * 0.012 - hit * 0.05;
    ctx.scale(1, sy);
    const N = q === 'lite' ? 3 : 6;
    if (spec.serpent) {
      drawSerpent(ctx, R, bodyC, t, a, run, q);
      ctx.restore(); return R;
    }
    if (spec.fly) {
      // hover: the whole figure leans into motion; robe hem and hair trail in strips
      const pivotY = -ay * 0.55;
      ctx.translate(0, pivotY); ctx.rotate(lean * 0.8 + 0.05); ctx.translate(0, -pivotY);
      const hs = Math.ceil(h / N);
      for (let i = 0; i < N; i++) {
        const y0 = i * hs, hh = Math.min(hs + 1, h - y0); if (hh <= 0) break;
        const qy = i / (N - 1);
        const off = Math.sin(t * 2.6 - i * 0.8) * w * (spec.ghost ? 0.03 : 0.018) * (0.25 + qy) - run * w * 0.03 * qy;
        ctx.drawImage(bodyC, 0, y0, w, hh, -ax + off, -ay + y0, w, hh);
      }
      drawParts(ctx, R, s, t, a, run, fl);
      ctx.restore(); return R;
    }
    // legs: left and right of the feet anchor swing like scissors about the hip
    const hip = R.hip, hy = hip - ay;
    const stride = Math.sin(s.ph) * (0.34 * run + (a > 0 ? a * 0.1 : 0));
    const ov = Math.round(h * 0.05); // legs start a little above the hip so no seam opens
    const legs = (sgn) => {
      const x0 = sgn < 0 ? 0 : ax, ww = sgn < 0 ? ax : w - ax;
      if (ww <= 0) return;
      ctx.save(); ctx.translate(0, hy);
      // shear about the hip: the hip line stays put, the foot swings
      ctx.transform(1, 0, Math.tan(sgn * stride), 1, 0, 0);
      const lift = 1 - Math.max(0, sgn * Math.cos(s.ph)) * 0.07 * run; // knee lift on the swing
      ctx.scale(1, lift);
      ctx.drawImage(bodyC, x0, hip - ov, ww, h - hip + ov, x0 - ax, -ov, ww, h - hip + ov);
      ctx.restore();
    };
    legs(-1); legs(1);
    // upper body: bend about the hip, cloth and hair ripple, head lags a touch
    ctx.save();
    ctx.translate(0, hy); ctx.rotate(lean); ctx.translate(0, -hy);
    const top = hip + Math.round(h * 0.03), hs = Math.ceil(top / N);
    for (let i = 0; i < N; i++) {
      const y0 = i * hs, hh = Math.min(hs + 1, top - y0); if (hh <= 0) break;
      const qy = 1 - i / Math.max(1, N - 1);
      const off = Math.sin(t * 2.2 + s.ph * 0.5 - i * 0.7) * w * 0.012 * qy - (run * 0.012 + a * 0.01) * w * qy;
      ctx.drawImage(bodyC, 0, y0, w, hh, -ax + off, -ay + y0, w, hh);
    }
    drawParts(ctx, R, s, t, a, run, fl);
    ctx.restore();
    ctx.restore();
    return R;
  }

  function drawParts(ctx, R, s, t, a, run, fl) {
    const { ax, ay, spec } = R;
    for (const p of R.parts) {
      const img = fl ? (p.flash || (p.flash = flashOf(p))) : p.c;
      let rot = 0, tx = 0, ty = 0;
      if (p.n === 'arm') {
        const st2 = spec.atk;
        const swing = Math.sin(s.ph) * 0.12 * run + Math.sin(t * 2.4) * 0.03;
        if (st2 === 'thrust') { const k = (Math.max(0, a) * 0.06 + Math.min(0, a) * 0.03) * R.h; tx = k * 0.59; ty = -k * 0.81; rot = swing * 0.2; } // slides along the spear shaft
        else if (st2 === 'reach') { rot = -a * 0.35 + swing; tx = Math.max(0, a) * R.w * 0.08; }
        else rot = a * (st2 === 'slash' ? 0.6 : 0.48) + swing;   // windup back (-), strike forward (+)
      } else if (p.n === 'wingL' || p.n === 'wingR') {
        const f = Math.sin(t * (7 + run * 3)) * (0.32 + run * 0.1) + a * 0.15;
        rot = p.n === 'wingL' ? f : -f * 0.8;
      } else if (p.n === 'banner') {
        rot = Math.sin(t * 1.7) * 0.05 - run * 0.05;
      }
      const X = p.px - ax, Y = p.py - ay;
      ctx.save(); ctx.translate(X + tx, Y + ty); ctx.rotate(rot); ctx.translate(-X, -Y);
      ctx.drawImage(img, -ax, -ay);
      ctx.restore();
    }
  }

  // Orochi: the coiled body breathes; the heads above it slither in a wave
  // travelling across the columns, and lunge together on the strike
  function drawSerpent(ctx, R, img, t, a, run, q) {
    const { w, h, ax, ay } = R;
    const top = Math.round(h * 0.58), cols = q === 'lite' ? 6 : 12, rows = q === 'lite' ? 2 : 4, cw = w / cols, rh = top / rows;
    ctx.drawImage(img, 0, top - 4, w, h - top + 4, -ax, -ay + top - 4, w, h - top + 4);
    // rows lower down move less, so the necks stay rooted in the coils
    for (let j = 0; j < rows; j++) {
      const y0 = j * rh, hh = Math.min(h - y0, rh + Math.round(h * 0.05)), fall = 1 - (j + 0.5) / rows;
      for (let i = 0; i < cols; i++) {
        const x0 = i * cw, ph = t * 2.3 - i * 0.38;
        const strike = Math.max(0, a) * (0.4 + 0.6 * (i / (cols - 1)));
        const dx = (Math.sin(ph) * w * 0.02 + strike * w * 0.08 - Math.max(0, -a) * w * 0.03) * fall;
        const dy = (Math.cos(ph * 1.3) * h * 0.016 - strike * h * 0.03 + Math.max(0, -a) * h * 0.02) * fall;
        ctx.drawImage(img, x0, y0, cw + 1, hh, -ax + x0 + dx, -ay + y0 + dy, cw + 1, hh);
      }
    }
  }

  // death: a short recoil pose, then the renderer's ink dissolve runs from it
  function deathPose(ctx, p) { // p: 0..1 through the pose
    const e = easeOut(Math.min(1, p));
    ctx.rotate(-0.32 * e);
    ctx.translate(-e * 6, 0);
    ctx.scale(1 + e * 0.04, 1 - e * 0.12);
  }

  return { update, draw, deathPose, state: st, rigFor, RIG };
}
