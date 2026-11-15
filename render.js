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

  // ------------------------------------------------------------ figures
  // Each figure is drawn in a 100-unit-tall local space, feet at (0,0), facing +x.
  function legs(g, walk, spread, w, color, hip = -40) {
    const s = Math.sin(walk) * 8;
    stroke(g, [-3, hip, -spread + s, -2], w, color);
    stroke(g, [3, hip, spread - s, -2], w, color);
  }

  const drawers = {
    0(g, t, w) { // ashigaru: jingasa hat + yari
      legs(g, w, 10, 7, INK);
      poly(g, [-11, -42, -12, -72, 12, -72, 11, -42], GREY);
      stroke(g, [-10, -52, 10, -52], 1.5, PAPER); stroke(g, [-10, -60, 10, -60], 1.5, PAPER);
      stroke(g, [8, -66, 18, -52], 6, INK);
      stroke(g, [-14, -8, 36, -118], 2.6, INK);
      poly(g, [36, -118, 32, -104, 40, -106], INK);
      circ(g, 0, -80, 8, INK2);
      poly(g, [-24, -84, 24, -84, 0, -98], INK);
    },
    1(g, t, w) { // ninja: mask band, scarf, short blade
      legs(g, w * 1.4, 12, 6, INK);
      poly(g, [-9, -42, -11, -72, 11, -72, 9, -42], INK);
      stroke(g, [8, -68, 20, -56], 5, INK);
      stroke(g, [18, -58, 42, -76], 2.2, INK2);
      stroke(g, [-8, -66, -16, -50], 5, INK);
      circ(g, 0, -82, 10, INK);
      g.fillStyle = PAPER; g.fillRect(-2, -87, 13, 5);
      circ(g, 3, -84.5, 1.4, INK); circ(g, 8, -84.5, 1.4, INK);
      const fl = Math.sin(t * 9 + w) * 4;
      g.lineCap = 'round';
      g.strokeStyle = INK; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-8, -84); g.quadraticCurveTo(-22, -84 + fl, -34, -78 - fl); g.stroke();
    },
    2(g, t, w) { // kappa: shell, dish, beak
      const b = Math.abs(Math.sin(w)) * 3;
      stroke(g, [-6, -14, -12, -1], 5, INK); stroke(g, [6, -14, 12, -1], 5, INK);
      g.fillStyle = INK2; g.beginPath(); g.ellipse(-6, -34 - b, 17, 22, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = PAPER; g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(-6, -34 - b, 11, 15, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = GREY; g.beginPath(); g.ellipse(4, -34 - b, 11, 18, 0, 0, Math.PI * 2); g.fill();
      circ(g, 6, -60 - b, 12, GREY);
      g.fillStyle = PAPER; g.beginPath(); g.ellipse(6, -70 - b, 9, 3.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = INK; g.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(6 + i * 3.2, -68 - b); g.lineTo(6 + i * 4, -74 - b); g.stroke(); }
      poly(g, [16, -60 - b, 26, -57 - b, 16, -54 - b], INK);
      circ(g, 11, -62 - b, 1.6, INK);
    },
    3(g, t, w) { // ronin: tattered kimono, wide straw hat
      legs(g, w, 9, 6, INK);
      poly(g, [-10, -76, 10, -76, 15, -40, 10, -34, 6, -40, 0, -32, -6, -38, -12, -32, -15, -40], GREY);
      stroke(g, [-8, -74, 6, -50], 1.5, INK);
      stroke(g, [-16, -46, 18, -42], 2.6, INK); // sheathed sword
      stroke(g, [8, -68, 14, -48], 5, INK2);
      circ(g, 0, -82, 8, INK2);
      g.fillStyle = WASH; g.beginPath(); g.ellipse(0, -86, 25, 8, 0, Math.PI, 0); g.fill();
      g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -86, 25, 8, 0, Math.PI, 0); g.stroke();
      stroke(g, [-25, -86, 25, -86], 2, INK);
    },
    4(g, t, w) { // samurai: kabuto with crescent, lamellar armour, raised katana
      const s = Math.sin(w) * 5;
      poly(g, [-10, -42, 10, -42, 18 - s, 0, 4, 0, 0, -26, -4, 0, -18 + s, 0], INK2);
      poly(g, [-13, -42, -14, -74, 14, -74, 13, -42], INK);
      for (let y = -48; y > -72; y -= 6) stroke(g, [-12, y, 12, y], 1, '#8b8378');
      poly(g, [-20, -74, -11, -76, -11, -60, -21, -62], GREY);
      poly(g, [20, -74, 11, -76, 11, -60, 21, -62], GREY);
      stroke(g, [-2, -64, 4, -56], 1.6, RED);
      stroke(g, [14, -70, 22, -86], 5, INK);
      stroke(g, [22, -86, 8, -124], 2.4, INK2);
      circ(g, 0, -82, 8, INK2);
      g.fillStyle = INK; g.beginPath(); g.arc(0, -86, 11, Math.PI, 0); g.fill();
      poly(g, [-13, -86, 13, -86, 16, -78, -16, -78], INK);
      g.strokeStyle = INK; g.lineWidth = 2.4; g.beginPath();
      g.moveTo(-2, -95); g.quadraticCurveTo(-16, -104, -14, -116); g.moveTo(2, -95); g.quadraticCurveTo(16, -104, 14, -116); g.stroke();
    },
    5(g, t, w) { // tengu: wings, long red nose, floating
      const fl = Math.sin(t * 10 + w) * 0.35 + 0.65;
      g.save(); g.translate(0, -16 - Math.sin(t * 3 + w) * 3);
      g.fillStyle = INK;
      for (const side of [-1, 1]) {
        g.save(); g.translate(side * -3, -66); g.scale(side, fl);
        g.beginPath(); g.moveTo(0, 0);
        g.quadraticCurveTo(-30, -30, -46, -14); g.lineTo(-38, -8); g.lineTo(-44, 2); g.lineTo(-34, 4); g.lineTo(-38, 14); g.lineTo(-24, 10);
        g.closePath(); g.fill(); g.restore();
      }
      poly(g, [-10, -70, 10, -70, 14, -28, -14, -28], GREY);
      stroke(g, [-8, -66, 6, -40], 1.4, INK);
      stroke(g, [10, -64, 22, -48], 5, INK2);
      stroke(g, [22, -30, 26, -90], 2, INK2);
      circ(g, 0, -78, 9, INK2);
      stroke(g, [6, -79, 22, -76], 3.4, RED);
      circ(g, 4, -82, 1.4, PAPER);
      g.fillStyle = INK; g.fillRect(-4, -94, 8, 7);
      g.restore();
    },
    6(g, t, w) { // yurei: white robe, long black hair, legless
      g.save(); g.translate(0, -10 - Math.sin(t * 2 + w) * 4);
      g.globalAlpha *= 0.82 + Math.sin(t * 7 + w * 3) * 0.08;
      const gr = g.createLinearGradient(0, -74, 0, 6);
      gr.addColorStop(0, '#f7f3ea'); gr.addColorStop(0.75, 'rgba(247,243,234,.75)'); gr.addColorStop(1, 'rgba(247,243,234,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-10, -74); g.lineTo(10, -74); g.quadraticCurveTo(18, -30, 8 + Math.sin(t * 3) * 6, 6);
      g.lineTo(-12 + Math.sin(t * 3 + 1) * 6, 6); g.quadraticCurveTo(-18, -30, -10, -74); g.fill();
      g.strokeStyle = 'rgba(22,20,18,.55)'; g.lineWidth = 1.2; g.stroke();
      stroke(g, [6, -66, 24, -60, 30, -62], 2.4, 'rgba(240,236,226,1)');
      stroke(g, [6, -66, 24, -60, 30, -62], 0.8, 'rgba(22,20,18,.5)');
      circ(g, 0, -82, 8, '#f3efe6');
      g.fillStyle = INK; g.beginPath();
      g.moveTo(-10, -86); g.quadraticCurveTo(0, -96, 10, -86); g.lineTo(9, -52); g.lineTo(4, -62); g.lineTo(2, -50); g.lineTo(-3, -60); g.lineTo(-6, -48); g.lineTo(-11, -58);
      g.closePath(); g.fill();
      g.restore();
    },
    7(g, t, w) { // oni: horns, kanabo club, red eyes
      legs(g, w * 0.8, 13, 10, INK);
      poly(g, [-14, -40, 14, -40, 16, -26, -16, -26], GREY);
      for (let i = -12; i < 14; i += 6) stroke(g, [i, -40, i + 3, -27], 2, INK);
      poly(g, [-18, -40, -22, -74, 22, -76, 18, -40], INK2);
      stroke(g, [-4, -70, -4, -48], 1, '#6c655c'); stroke(g, [-14, -62, 10, -60], 1, '#6c655c');
      stroke(g, [18, -72, 30, -56], 9, INK2);
      g.save(); g.translate(30, -56); g.rotate(-0.9 + Math.sin(t * 2 + w) * 0.12);
      poly(g, [-3, 0, 3, 0, 6, -46, -6, -46], INK);
      g.fillStyle = PAPER; for (let y = -12; y > -44; y -= 8) { circ(g, -3, y, 1.4, PAPER); circ(g, 3, y - 4, 1.4, PAPER); }
      g.restore();
      stroke(g, [-18, -70, -26, -48], 9, INK2);
      circ(g, 2, -84, 12, INK);
      g.fillStyle = PAPER; g.strokeStyle = INK; g.lineWidth = 1.2;
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 6, -93); g.quadraticCurveTo(sx * 10, -104, sx * 14, -110); g.lineTo(sx * 10, -94); g.closePath(); g.fill(); g.stroke(); }
      circ(g, 5, -86, 2, RED2); circ(g, 11, -86, 2, RED2);
      poly(g, [6, -78, 8, -73, 10, -78], PAPER);
    },
  };
  // bosses reuse silhouettes with extra regalia
  drawers[8] = (g, t, w) => { // oni warlord
    drawers[7](g, t, w);
    g.strokeStyle = RED; g.lineWidth = 2.4; g.beginPath(); g.moveTo(-10, -104); g.lineTo(-14, -110); g.moveTo(10, -104); g.lineTo(14, -110); g.stroke();
    stroke(g, [-18, -44, 18, -44], 3.5, RED);
  };
  drawers[9] = (g, t, w) => { // tengu king
    drawers[5](g, t, w);
    g.save(); g.translate(0, -16 - Math.sin(t * 3 + w) * 3);
    stroke(g, [-10, -62, 10, -62], 3, RED); circ(g, 0, -78, 9.5, RED); stroke(g, [6, -79, 26, -77], 3.6, RED2);
    circ(g, 4, -82, 1.6, INK); g.restore();
  };
  drawers[10] = (g, t, w) => { // shogun with sashimono banner
    stroke(g, [-8, -60, -14, -140], 2, INK);
    poly(g, [-14, -140, -40, -140, -40, -104, -14, -104], '#f4f0e6');
    g.strokeStyle = INK; g.lineWidth = 1.2; g.strokeRect(-40, -140, 26, 36);
    circ(g, -27, -122, 8, RED);
    drawers[4](g, t, w);
    poly(g, [-3, -96, 0, -112, 3, -96], RED);
  };
  drawers[11] = (g, t, w) => { // orochi — many-headed serpent
    g.fillStyle = INK2; g.beginPath(); g.ellipse(0, -14, 34, 15, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#6c655c'; g.lineWidth = 1;
    for (let i = -24; i < 28; i += 8) { g.beginPath(); g.arc(i, -14, 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    for (let h = 0; h < 6; h++) {
      const a = -1.2 + h * 0.48, sw = Math.sin(t * 2 + h * 1.7 + w) * 8;
      const bx = Math.sin(a) * 18, ex = Math.sin(a) * 40 + sw, ey = -70 - Math.cos(a) * 30 + Math.abs(sw) * 0.5;
      g.strokeStyle = h % 2 ? INK : INK2; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(bx, -20); g.quadraticCurveTo(bx * 1.6 - sw, -50, ex, ey); g.stroke();
      g.save(); g.translate(ex, ey); g.rotate(a * 0.6);
      poly(g, [-6, 2, 12, -2, -6, -8], INK);
      circ(g, 2, -4, 1.6, RED2); g.restore();
    }
  };
  drawers[12] = (g, t, w) => { // onryo queen
    drawers[6](g, t, w);
    g.save(); g.translate(0, -10 - Math.sin(t * 2 + w) * 4);
    stroke(g, [-9, -66, 9, -66], 2.6, RED);
    stroke(g, [-11, -56, -14, -20], 1.6, RED);
    circ(g, 3, -80, 1.6, RED2);
    g.restore();
  };

  function drawAsura(f, t) {
    const [, , atk, face] = f;
    const size = 0.3 * scale;
    const k = size / 100;
    const x = cx, y = cy - 2 * dpr;
    ctx.save(); ctx.translate(x, y); ctx.scale(k * (face || 1), k);
    const g = ctx;
    const br = Math.sin(t * 2.2) * 1.2;
    const lunge = atk > 0 ? Math.sin((atk / 0.18) * Math.PI) : 0;
    // hakama (wide ink wash trousers, torn hem)
    poly(g, [-14, -46, 14, -46, 30, -6, 22, 0, 16, -8, 10, -2, 4, -24, -4, -24, -10, -2, -16, -8, -22, 0, -30, -6], INK2);
    g.strokeStyle = 'rgba(236,230,216,.35)'; g.lineWidth = 1;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-10 + i * 3, -40); g.lineTo(-18 + i * 2, -10); g.stroke(); g.beginPath(); g.moveTo(8 + i * 3, -40); g.lineTo(14 + i * 4, -10); g.stroke(); }
    // ankle beads
    for (const sx of [-22, 22]) for (let i = -2; i <= 2; i++) circ(g, sx + i * 2.6, -4, 1.6, INK);
    // sash
    poly(g, [-16, -52, 16, -52, 15, -44, -15, -44], RED);
    const sw = Math.sin(t * 4) * 5;
    g.fillStyle = RED;
    g.beginPath(); g.moveTo(-12, -48); g.quadraticCurveTo(-26, -40 + sw, -38, -32 - sw); g.lineTo(-34, -28 - sw); g.quadraticCurveTo(-24, -36, -10, -44); g.fill();
    g.beginPath(); g.moveTo(-10, -46); g.quadraticCurveTo(-20, -30 + sw, -28, -18); g.lineTo(-24, -16); g.quadraticCurveTo(-16, -30, -6, -44); g.fill();
    stroke(g, [-14, -50, 14, -50], 1, 'rgba(90,10,14,.7)');
    // torso
    poly(g, [-22, -84 + br, 22, -84 + br, 14, -52, -14, -52], '#2f2b28');
    g.strokeStyle = 'rgba(236,230,216,.55)'; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(-12, -78); g.lineTo(-2, -66); g.moveTo(6, -80); g.lineTo(14, -70); g.moveTo(-6, -62); g.lineTo(4, -58); g.stroke();
    // arms — punching arm extends toward the target
    const reach = 10 + lunge * 22;
    stroke(g, [-20, -80 + br, -30, -64, -24, -54], 9, '#2f2b28');
    circ(g, -24, -53, 6, INK);
    stroke(g, [20, -80 + br, 24 + reach * 0.5, -70, 26 + reach, -72 + lunge * 6], 9, '#2f2b28');
    circ(g, 28 + reach, -72 + lunge * 6, 6.5, INK);
    for (let i = 0; i < 4; i++) circ(g, -27 + i * 1.2, -58 + i * 0.4, 1.7, INK);
    for (let i = 0; i < 4; i++) circ(g, 18 + reach * 0.85 + i * 1.2, -71 + lunge * 5, 1.7, INK);
    if (f[9] > 0) { // six arms — ghostly extra limbs
      g.globalAlpha = 0.45;
      for (const [ax, ay] of [[34, -92], [36, -58], [-34, -94], [-36, -60]]) { stroke(g, [ax > 0 ? 16 : -16, -76, ax, ay], 6, INK2); circ(g, ax, ay, 5, INK); }
      g.globalAlpha = 1;
    }
    // head
    circ(g, 0, -92 + br, 9, '#2f2b28');
    // hair — wild spikes and topknot
    g.fillStyle = INK;
    const hs = Math.sin(t * 3) * 2;
    g.beginPath(); g.moveTo(-10, -92 + br);
    const spikes = [[-22, -100], [-12, -98], [-24, -112], [-10, -106], [-14, -122], [-2, -110], [4, -128], [8, -110], [20, -118], [12, -102], [24, -104], [11, -94]];
    for (const [sx, sy] of spikes) g.lineTo(sx + (sy < -110 ? hs : hs * 0.4), sy + br);
    g.closePath(); g.fill();
    stroke(g, [-14, -100 + br, -30 + hs, -94, -38 + hs * 1.5, -98], 2, INK);
    stroke(g, [-12, -96 + br, -28 + hs, -84, -34 + hs, -86], 1.6, INK);
    // red eyes
    circ(g, 4, -93 + br, 1.6, RED2); circ(g, 8.5, -93 + br, 1.4, RED2);
    stroke(g, [2, -96 + br, 10, -95 + br], 1.4, INK);
    // bead necklace
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.12 + (i / 8) * Math.PI * 0.76;
      const bx = Math.cos(a) * 15, by = -84 + br + Math.sin(a) * 9;
      circ(g, bx, by, 3.6, '#5a0c10'); circ(g, bx, by, 3.0, RED); circ(g, bx - 1, by - 1.1, 0.9, 'rgba(255,220,220,.8)');
    }
    stroke(g, [4, -76 + br, 6, -66, 3, -60], 1.2, RED);
    ctx.restore();
  }

  // ------------------------------------------------------------ effects
  function splat(x, y, n, red, power = 1) {
    const max = reduced ? 60 : 320;
    for (let i = 0; i < n && parts.length < max; i++) {
      const a = R() * Math.PI * 2, v = (0.15 + R() * 0.5) * power;
      parts.push({ x, y, z: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.3 + R() * 0.6 * power, r: (1 + R() * 2.5) * dpr, red: red && R() < 0.8, life: 0.7 + R() * 0.5 });
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
          splat(x, y, c ? 40 : 12, false, c ? 2 : 1.1);
          splat(x, y, c ? 20 : 4, true, 1);
          decal(x, y, c ? 2.4 : 1, R() < 0.35 || !!c);
          if (numbersOn) addText(x, y - 0.06, '+' + fmt(a), WASH, 12);
          if (c && !reduced) shake = 8;
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
      const X = toX(x), Y = toY(y), px = size * scale * 1.35;
      const fade = Math.min(1, age / 0.6);
      ctx.save();
      ctx.globalAlpha = fade;
      // shadow
      ctx.fillStyle = 'rgba(22,20,18,.18)';
      ctx.beginPath(); ctx.ellipse(X, Y, px * 0.28, px * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(X, Y);
      const face = x > 0 ? -1 : 1;
      ctx.scale(px / 100 * face, px / 100);
      const walk = (reduced ? 0 : t * 7 * (slow > 0 ? 0.4 : 1)) + phase;
      (drawers[kind] || drawers[0])(ctx, reduced ? phase : t, walk);
      if (flash > 0) { // hit flash: paper-white wash over the silhouette
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(236,230,216,${flash * 5})`; ctx.fillRect(-60, -150, 120, 160);
        ctx.globalCompositeOperation = 'source-over';
      }
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
      ctx.beginPath(); ctx.arc(toX(p.x), toY(p.y) - p.z * scale * 0.4 - 0.06 * scale, p.r, 0, Math.PI * 2); ctx.fill();
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
