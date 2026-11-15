// Themed stages. Every 10-wave block is themed after the boss waiting at its end
// (Oni Warlord, Tengu King, Shogun, Orochi, Onryo Queen). The painted backdrop is
// cover-fitted, then a seeded RNG keyed to the block scatters painted props around
// the edges (never in the combat circle), varies the ground and picks the ambient
// particles. So each block is unique but identical after a reload. The static
// scene is baked once per block into an offscreen canvas; block changes bleed in
// with an ink-wash transition and a brush-lettered banner.
const BASE = new URL('./assets/themes/', import.meta.url).href;
const PAPER = '#ece6d8';
const SQ = 0.8;

export const THEMES = [
  { key: 'oni', boss: 'Oni Warlord', names: ['Gate of Ashes', 'Ember Hollow', 'The Cinder Torii', 'Bone Furnace'], amb: ['embers', 'ash'], opt: [['smoke', 0.45]], tint: 'rgba(120,20,20,.05)' },
  { key: 'tengu', boss: 'Tengu King', names: ['Peaks of the Tengu', 'Pine Wind Ridge', 'Cloudwalk Crag', 'Feather Summit'], amb: ['feathers', 'mist'], opt: [['rain', 0.3]], tint: null },
  { key: 'shogun', boss: 'The Shogun', names: ["The Shogun's Courtyard", 'Blossom Keep', 'Hall of Banners', 'Lantern Gate'], amb: ['petals'], opt: [['mist', 0.3], ['rain', 0.25]], tint: null },
  { key: 'orochi', boss: 'Orochi', names: ['Delta of Eight Coils', 'Reedmire', 'Serpent Fen', 'Drowned Shallows'], amb: ['mist', 'fireflies'], opt: [['rain', 0.5]], tint: null },
  { key: 'onryo', boss: 'Onryō Queen', names: ['Shrine of the Pale Moon', 'Willow Graves', 'Lantern Hollow', 'Moonless Precinct'], amb: ['wisps', 'fireflies'], opt: [['mist', 0.5]], tint: 'rgba(20,22,40,.06)' },
];
export const blockOf = (wave) => Math.max(0, Math.floor((Math.max(1, wave) - 1) / 10));
export const themeOf = (block) => block % THEMES.length;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
}
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

export function createStage() {
  let meta = null, metaP = null;
  const loaded = new Map(); // theme index -> {bg, props, frames} | Promise
  let V = null;             // view: {W, H, cx, cy, scale, dpr}
  let block = -1, theme = 0, scene = null, sceneBlock = -1, wantBlock = -1;
  let prev = null, transT = 0, transDur = 1.9, banner = null, splat = null;
  let mask = null, maskBig = null, tmp = null;
  const parts = [];
  let ambient = [], spawnAcc = 0;
  const sprites = {};

  function loadMeta() { return metaP || (metaP = fetch(BASE + 'themes.json').then((r) => r.json()).then((m) => (meta = m))); }
  function loadTheme(i) {
    if (loaded.has(i)) return Promise.resolve(loaded.get(i));
    const p = loadMeta().then(async (m) => {
      const d = m[THEMES[i].key];
      const [bg, props] = await Promise.all([loadImg(BASE + d.bg), loadImg(BASE + d.props)]);
      const v = { bg, props, frames: d.frames };
      loaded.set(i, v); return v;
    });
    loaded.set(i, p);
    p.catch(() => loaded.delete(i));
    return p;
  }
  const ready = (i) => { const v = loaded.get(i); return v && !(v instanceof Promise) ? v : null; };

  // ------------------------------------------------------------ scene bake
  function bake(b) {
    const t = themeOf(b), T = THEMES[t], art = ready(t);
    if (!art || !V) return null;
    const { W, H, cx, cy, scale, dpr } = V;
    const r = rng(b * 7919 + 1013);
    const c = mk(W, H), g = c.getContext('2d');
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
    // cover-fit the painting so its ground centre (0.5, 0.6) sits under the Asura
    const iw = art.bg.width, ih = art.bg.height;
    const s = Math.max(W / iw, H / ih) * (1.04 + r() * 0.06);
    const flip = r() < 0.5;
    let ox = cx - iw * s * 0.5 + (r() - 0.5) * W * 0.04, oy = cy - ih * s * 0.6;
    ox = Math.min(0, Math.max(W - iw * s, ox)); oy = Math.min(0, Math.max(H - ih * s, oy));
    g.save();
    if (flip) { g.translate(W, 0); g.scale(-1, 1); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(art.bg, flip ? W - ox - iw * s : ox, oy, iw * s, ih * s);
    g.restore();
    if (T.tint) { g.fillStyle = T.tint; g.fillRect(0, 0, W, H); }
    const toX = (x) => cx + x * scale, toY = (y) => cy + y * scale * SQ;
    // varied ground: a few soft ink pools and dry grass flicks near the edges
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = 0.95 + r() * 0.6;
      const x = toX(Math.cos(a) * d), y = toY(Math.sin(a) * d), rr = (0.1 + r() * 0.22) * scale;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, 'rgba(30,27,24,.10)'); gr.addColorStop(1, 'rgba(30,27,24,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * 1.5, rr * SQ, 0, 0, Math.PI * 2); g.fill();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = 0.55 + r() * 0.9;
      const x = toX(Math.cos(a) * d), y = toY(Math.sin(a) * d);
      if (y < H * 0.3) continue;
      const n = 3 + ((r() * 4) | 0), hgt = (4 + r() * 8) * dpr;
      g.strokeStyle = `rgba(22,20,18,${0.08 + r() * 0.14})`;
      for (let k = 0; k < n; k++) {
        g.lineWidth = (0.6 + r() * 1.1) * dpr;
        g.beginPath(); g.moveTo(x + (k - n / 2) * 2 * dpr, y);
        g.quadraticCurveTo(x + (k - n / 2) * 3 * dpr, y - hgt * 0.6, x + (k - n / 2) * 5 * dpr + (r() - 0.5) * 6 * dpr, y - hgt);
        g.stroke();
      }
    }
    // props: seeded, outside the combat circle, depth-scaled, sorted back to front
    const fr = art.frames, n = 5 + ((r() * 4) | 0), placed = [];
    const order = fr.map((_, i) => i).sort(() => r() - 0.5);
    for (let tries = 0; placed.length < n && tries < 260; tries++) {
      const X = W * (0.02 + r() * 0.96), Y = H * (0.3 + r() * 0.74);
      const wx = (X - cx) / scale, wy = (Y - cy) / (scale * SQ);
      if (Math.hypot(wx, wy) < 1.0) continue;
      if (placed.some((p) => Math.hypot(p.X - X, (p.Y - Y) * 1.6) < W * 0.13)) continue;
      placed.push({ X, Y, k: order[placed.length % order.length], flip: r() < 0.5, sz: 0.85 + r() * 0.35 });
    }
    placed.sort((a, b) => a.Y - b.Y);
    for (const p of placed) {
      const f = fr[p.k], depth = 0.55 + 0.6 * Math.min(1, p.Y / H);
      const h = 0.3 * scale * depth * p.sz, k = h / f.h, w = f.w * k;
      g.fillStyle = 'rgba(22,20,18,.16)';
      g.beginPath(); g.ellipse(p.X, p.Y, w * 0.38, w * 0.07, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.translate(p.X, p.Y); if (p.flip) g.scale(-1, 1);
      g.drawImage(art.props, f.x, f.y, f.w, f.h, -w / 2, -f.ay * k, w, f.h * k);
      g.restore();
    }
    // keep the combat circle calm and readable
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.95);
    cg.addColorStop(0, 'rgba(236,230,216,.32)'); cg.addColorStop(0.7, 'rgba(236,230,216,.12)'); cg.addColorStop(1, 'rgba(236,230,216,0)');
    g.fillStyle = cg; g.beginPath(); g.ellipse(cx, cy, scale * 0.95 * 1.25, scale * 0.95 * SQ * 1.25, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.globalAlpha = 0.035; g.fillStyle = '#161412';
    g.font = `${Math.round(Math.min(W, H) * 0.42)}px Kanji, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('修羅', cx, cy + H * 0.02); g.restore();
    // per-block ambient set
    ambient = [...T.amb];
    for (const [k, p] of T.opt) if (r() < p) ambient.push(k);
    banner = { t: 0, title: T.names[(r() * T.names.length) | 0], sub: `Waves ${b * 10 + 1}–${b * 10 + 10} · ${T.boss} awaits` };
    return c;
  }

  // ------------------------------------------------------------ ambient particles
  function sprite(kind) {
    if (sprites[kind]) return sprites[kind];
    const d = V.dpr;
    let c;
    if (kind === 'ember') {
      c = mk(14 * d, 14 * d); const g = c.getContext('2d'), R = 7 * d;
      const gr = g.createRadialGradient(R, R, 0, R, R, R); gr.addColorStop(0, 'rgba(255,200,170,1)'); gr.addColorStop(0.3, 'rgba(210,50,40,.9)'); gr.addColorStop(1, 'rgba(179,32,42,0)');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    } else if (kind === 'ash') {
      c = mk(6 * d, 6 * d); const g = c.getContext('2d'); g.fillStyle = 'rgba(60,56,52,.75)';
      g.beginPath(); g.moveTo(0, 2 * d); g.lineTo(4 * d, 0); g.lineTo(6 * d, 4 * d); g.lineTo(1 * d, 6 * d); g.fill();
    } else if (kind === 'feather') {
      c = mk(30 * d, 10 * d); const g = c.getContext('2d');
      g.fillStyle = 'rgba(22,20,18,.85)'; g.beginPath(); g.moveTo(1 * d, 5 * d); g.quadraticCurveTo(14 * d, -1 * d, 29 * d, 4 * d); g.quadraticCurveTo(15 * d, 9 * d, 1 * d, 5 * d); g.fill();
      g.strokeStyle = 'rgba(236,230,216,.5)'; g.lineWidth = 0.6 * d; g.beginPath(); g.moveTo(2 * d, 5 * d); g.lineTo(28 * d, 4 * d); g.stroke();
    } else if (kind === 'petal') {
      c = mk(10 * d, 7 * d); const g = c.getContext('2d');
      g.fillStyle = 'rgba(196,52,58,.85)'; g.beginPath(); g.ellipse(5 * d, 3.5 * d, 4.6 * d, 2.6 * d, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,220,220,.4)'; g.beginPath(); g.ellipse(4 * d, 2.8 * d, 2 * d, 1 * d, 0, 0, Math.PI * 2); g.fill();
    } else if (kind === 'firefly') {
      c = mk(18 * d, 18 * d); const g = c.getContext('2d'), R = 9 * d;
      const gr = g.createRadialGradient(R, R, 0, R, R, R); gr.addColorStop(0, 'rgba(255,248,220,1)'); gr.addColorStop(0.25, 'rgba(255,214,150,.75)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    } else if (kind === 'wisp') {
      c = mk(44 * d, 44 * d); const g = c.getContext('2d'), R = 22 * d;
      const gr = g.createRadialGradient(R, R, 0, R, R, R); gr.addColorStop(0, 'rgba(250,248,240,.9)'); gr.addColorStop(0.4, 'rgba(225,225,230,.45)'); gr.addColorStop(1, 'rgba(220,220,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    } else { // mist / smoke blob
      c = mk(128, 128); const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      const col = kind === 'smoke' ? '40,36,34' : '240,236,226';
      gr.addColorStop(0, `rgba(${col},.55)`); gr.addColorStop(0.6, `rgba(${col},.22)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
    return (sprites[kind] = c);
  }
  const CFG = { // per-type: share of the pool, speed etc. (px/s are relative to H)
    embers: { n: 16, k: 'ember' }, ash: { n: 16, k: 'ash' }, feathers: { n: 7, k: 'feather' }, petals: { n: 18, k: 'petal' },
    fireflies: { n: 12, k: 'firefly' }, wisps: { n: 7, k: 'wisp' }, mist: { n: 4, k: 'mist' }, smoke: { n: 4, k: 'smoke' }, rain: { n: 40, k: null },
  };
  function spawn(type, anywhere) {
    const { W, H } = V, R = Math.random;
    const p = parts.find((q) => !q.on) || (parts.length < 120 ? (parts[parts.length] = {}) : null);
    if (!p) return;
    Object.assign(p, { on: true, type, x: R() * W, y: anywhere ? R() * H : -0.05 * H, vx: 0, vy: 0, rot: R() * 6.28, vr: (R() - 0.5) * 3, life: 0, max: 6 + R() * 6, s: 0.7 + R() * 0.6, ph: R() * 6.28 });
    switch (type) {
      case 'embers': p.y = anywhere ? R() * H : H * (0.6 + R() * 0.45); p.vy = -H * (0.05 + R() * 0.07); p.vx = (R() - 0.5) * H * 0.03; p.max = 3 + R() * 4; break;
      case 'ash': p.vy = H * (0.025 + R() * 0.03); p.vx = H * (0.01 + R() * 0.02); break;
      case 'feathers': p.vy = H * (0.03 + R() * 0.03); p.vx = (R() < 0.5 ? -1 : 1) * H * 0.03; p.max = 10; break;
      case 'petals': p.vy = H * (0.04 + R() * 0.04); p.vx = H * (0.02 + R() * 0.03); p.vr = (R() - 0.5) * 6; break;
      case 'fireflies': p.y = H * (0.25 + R() * 0.75); p.vx = (R() - 0.5) * H * 0.02; p.vy = (R() - 0.5) * H * 0.02; p.max = 5 + R() * 5; break;
      case 'wisps': p.y = anywhere ? H * (0.3 + R() * 0.7) : H * (0.7 + R() * 0.35); p.vy = -H * (0.015 + R() * 0.02); p.vx = (R() - 0.5) * H * 0.02; p.max = 6 + R() * 4; break;
      case 'mist': case 'smoke': {
        // drifting banks hug the edges and horizon, never the centre
        const left = R() < 0.5; p.x = left ? -W * 0.2 + R() * W * 0.3 : W * 0.9 + R() * W * 0.3; p.y = H * (0.18 + R() * 0.85);
        p.vx = (left ? 1 : -1) * W * (0.004 + R() * 0.006); p.vy = type === 'smoke' ? -H * 0.006 : 0; p.max = 14 + R() * 8; p.s = 2.4 + R() * 2.2; break;
      }
      case 'rain': p.vy = H * (1.1 + R() * 0.4); p.vx = H * 0.12; p.max = 1.2; break;
    }
    if (anywhere) p.life = R() * p.max * 0.6;
  }
  function stepAmbient(dt, quality) {
    if (!V) return;
    const cap = quality === 'reduced' ? 0 : quality === 'lite' ? 0.35 : 1;
    for (const type of ambient) {
      const want = Math.round(CFG[type].n * cap);
      let have = 0; for (const p of parts) if (p.on && p.type === type) have++;
      if (have < want) for (let i = 0; i < Math.min(want - have, 3); i++) spawn(type, have === 0 && dt === 0);
    }
    for (const p of parts) {
      if (!p.on) continue;
      if (!ambient.includes(p.type)) { p.on = false; continue; }
      p.life += dt; if (p.life > p.max) { p.on = false; continue; }
      const sway = Math.sin(p.life * 1.6 + p.ph);
      p.x += (p.vx + (p.type === 'petals' || p.type === 'feathers' ? sway * V.H * 0.03 : 0)) * dt;
      p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.type === 'fireflies') { p.vx += (Math.random() - 0.5) * V.H * 0.06 * dt; p.vy += (Math.random() - 0.5) * V.H * 0.06 * dt; }
      if (p.y > V.H * 1.08 || p.y < -V.H * 0.12 || p.x < -V.W * 0.4 || p.x > V.W * 1.4) p.on = false;
    }
  }
  function drawAmbient(ctx, back) {
    if (!V) return;
    for (const p of parts) {
      if (!p.on) continue;
      const isBack = p.type === 'mist' || p.type === 'smoke';
      if (isBack !== back) continue;
      const fade = Math.min(1, p.life / 0.8, (p.max - p.life) / 1.2);
      if (p.type === 'rain') {
        ctx.globalAlpha = 0.35 * fade; ctx.strokeStyle = 'rgba(40,38,36,.8)'; ctx.lineWidth = V.dpr;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        continue;
      }
      const spr = sprite(CFG[p.type].k);
      let a = fade;
      if (p.type === 'fireflies') a *= 0.55 + 0.45 * Math.sin(p.life * 4 + p.ph);
      if (p.type === 'embers') a *= 0.7 + 0.3 * Math.sin(p.life * 13 + p.ph);
      if (p.type === 'mist' || p.type === 'smoke') a *= 0.55;
      if (p.type === 'wisps') a *= 0.7;
      ctx.globalAlpha = Math.max(0, a);
      const sc = p.type === 'mist' || p.type === 'smoke' ? (V.H * 0.32 * p.s) / spr.width : p.s;
      const co = Math.cos(p.rot) * sc, si = Math.sin(p.rot) * sc;
      if (p.type === 'mist' || p.type === 'smoke' || p.type === 'fireflies' || p.type === 'wisps' || p.type === 'embers') ctx.setTransform(sc, 0, 0, sc * (p.type === 'mist' || p.type === 'smoke' ? 0.45 : 1), p.x, p.y);
      else ctx.setTransform(co, si, -si, co, p.x, p.y);
      ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
    }
    ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------ transition
  function drawTransition(ctx) {
    if (!prev || !V) return;
    const { W, H, cx, cy } = V, p = Math.min(1, transT / transDur);
    if (p >= 1) { prev = null; return; }
    const mw = Math.ceil(W / 4), mh = Math.ceil(H / 4);
    if (!mask || mask.width !== mw || mask.height !== mh) { mask = mk(mw, mh); maskBig = mk(mw, mh); tmp = mk(W, H); }
    if (tmp.width !== W || tmp.height !== H) tmp = mk(W, H);
    const r = rng(9001 + sceneBlock);
    const mg = mask.getContext('2d'), bg2 = maskBig.getContext('2d');
    mg.clearRect(0, 0, mw, mh); bg2.clearRect(0, 0, mw, mh);
    const R = Math.hypot(mw, mh) * 0.75;
    for (let i = 0; i < 16; i++) {
      const delay = i === 0 ? 0 : 0.15 + r() * 0.45;
      const q = Math.max(0, (p - delay) / (1 - delay));
      const a = r() * Math.PI * 2, d = i === 0 ? 0 : (0.2 + r() * 0.8) * R * 0.8;
      const x = mw / 2 + Math.cos(a) * d, y = mh / 2 + Math.sin(a) * d * 0.8, rot = r() * 6.28;
      if (q <= 0) continue;
      const rad = (i === 0 ? R * 1.35 : R * 0.55) * Math.pow(q, 1.25);
      for (const [g, k] of [[mg, 1], [bg2, 1.14]]) {
        g.save(); g.translate(x, y); g.rotate(rot);
        if (splat) g.drawImage(splat.c, -rad * k, -rad * k, rad * 2 * k, rad * 2 * k);
        else { g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, rad * k, 0, 6.28); g.fill(); }
        g.restore();
      }
    }
    if (p > 0.92) { mg.fillStyle = `rgba(0,0,0,${(p - 0.92) / 0.08})`; mg.fillRect(0, 0, mw, mh); }
    // old scene, darkened at the bleed front, with the new scene showing through
    const t = tmp.getContext('2d');
    t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1; t.clearRect(0, 0, W, H);
    t.drawImage(prev, 0, 0);
    t.globalCompositeOperation = 'source-atop'; t.globalAlpha = 0.7;
    t.drawImage(tintBlack(maskBig), 0, 0, W, H);
    t.globalCompositeOperation = 'destination-out'; t.globalAlpha = 1;
    t.drawImage(mask, 0, 0, W, H);
    t.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0);
  }
  let tb = null;
  function tintBlack(c) {
    if (!tb || tb.width !== c.width || tb.height !== c.height) tb = mk(c.width, c.height);
    const g = tb.getContext('2d'); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, tb.width, tb.height);
    g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgba(18,16,14,1)'; g.fillRect(0, 0, tb.width, tb.height);
    return tb;
  }

  // ------------------------------------------------------------ banner
  function drawBanner(ctx, dt) {
    if (!banner || !V) return;
    banner.t += dt;
    const t = banner.t;
    if (t <= 0) return;
    const life = 3.4;
    if (t > life) { banner = null; return; }
    const a = Math.min(1, t / 0.45, (life - t) / 0.7);
    const { W, H, dpr } = V, m = Math.min(W, H);
    const y = H * 0.2, fs = Math.round(Math.max(22 * dpr, m * 0.07));
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${fs}px Brush, sans-serif`;
    const tw = ctx.measureText(banner.title).width;
    // ink wash band behind the title
    const g = ctx.createLinearGradient(W / 2 - tw * 0.9, 0, W / 2 + tw * 0.9, 0);
    g.addColorStop(0, 'rgba(236,230,216,0)'); g.addColorStop(0.2, 'rgba(236,230,216,.82)'); g.addColorStop(0.8, 'rgba(236,230,216,.82)'); g.addColorStop(1, 'rgba(236,230,216,0)');
    ctx.fillStyle = g; ctx.fillRect(W / 2 - tw * 0.9, y - fs * 0.85, tw * 1.8, fs * 2.1);
    const reveal = Math.min(1, t / 0.6);
    ctx.save(); ctx.beginPath(); ctx.rect(W / 2 - tw / 2 - fs, 0, (tw + fs * 2) * reveal, H); ctx.clip();
    ctx.fillStyle = '#161412'; ctx.fillText(banner.title, W / 2, y);
    // brush underline with a red seal
    ctx.fillStyle = 'rgba(22,20,18,.85)';
    ctx.beginPath(); ctx.moveTo(W / 2 - tw * 0.55, y + fs * 0.6); ctx.quadraticCurveTo(W / 2, y + fs * 0.48, W / 2 + tw * 0.55, y + fs * 0.62);
    ctx.quadraticCurveTo(W / 2, y + fs * 0.58, W / 2 - tw * 0.55, y + fs * 0.6); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#b3202a'; const ss = fs * 0.62;
    ctx.fillRect(W / 2 + tw / 2 + fs * 0.25, y - ss / 2, ss, ss);
    ctx.fillStyle = PAPER; ctx.font = `${Math.round(ss * 0.7)}px Kanji, serif`; ctx.fillText('修', W / 2 + tw / 2 + fs * 0.25 + ss / 2, y + ss * 0.04);
    ctx.font = `${Math.round(fs * 0.38)}px Hand, sans-serif`; ctx.fillStyle = '#4d4842';
    ctx.fillText(banner.sub, W / 2, y + fs * 1.0);
    ctx.restore();
  }

  return {
    setView(v) { V = v; scene = null; sceneBlock = -1; prev = null; for (const k in sprites) delete sprites[k]; },
    setSplat(fr) { splat = fr; },
    // returns true when the baked scene changed (renderer re-bakes its ground layer)
    update(wave, dt, quality) {
      const b = blockOf(wave), t = themeOf(b);
      if (b !== wantBlock) { wantBlock = b; loadTheme(t).catch(() => {}); loadTheme(themeOf(b + 1)).catch(() => {}); }
      let changed = false;
      if (V && (sceneBlock !== b || !scene) && ready(t)) {
        const first = !scene;
        const old = scene;
        const s = bake(b);
        if (s) {
          if (!first && old && quality !== 'reduced') { prev = old; transT = 0; if (banner) banner.t = -0.95; } // let the wave cry clear first
          else if (!first) prev = null;
          scene = s; sceneBlock = b; block = b; theme = t; changed = true;
          if (!first && quality === 'reduced' && banner) banner.t = -0.95;
        }
      }
      if (prev) transT += dt;
      stepAmbient(dt, quality);
      return changed;
    },
    get scene() { return scene; },
    get theme() { return theme; },
    get block() { return block; },
    get transitioning() { return !!prev; },
    drawTransition, drawAmbient, drawBanner,
    debugJump(b) { wantBlock = -1; sceneBlock = -1; },
    _bake: bake, _load: loadTheme, _themes: THEMES,
  };
}
