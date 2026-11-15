// Procedural sumi-e figures. Every figure is drawn in a 100-unit-tall local
// space (feet at 0,0, facing +x) for a given animation phase `c` (0..2π, loops).
// render.js rasterises these once per frame into an ink-bled sprite cache.

export const INK = '#141210', INK2 = '#221f1c', MID = '#38342f', WASH = '#5f5850', LIGHT = '#9c9386',
  PALE = '#cfc7b8', PAPER = '#ece6d8', RED = '#b3202a', RED2 = '#d6403c', DRED = '#6a0f15';
const TAU = Math.PI * 2;

// ------------------------------------------------------------ brush toolkit
function cr(pts, seg = 5) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// tapered calligraphic stroke along a smooth path
export function brush(g, pts, w0, w1, color, swell = 0.25) {
  const p = cr(pts), n = p.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const t = n > 1 ? i / (n - 1) : 0;
    const w = (w0 + (w1 - w0) * t) * (1 + swell * Math.sin(Math.PI * t)) / 2;
    L.push([p[i][0] - dy * w, p[i][1] + dx * w]); R.push([p[i][0] + dy * w, p[i][1] - dx * w]);
  }
  g.fillStyle = color; g.beginPath(); g.moveTo(L[0][0], L[0][1]);
  for (const q of L) g.lineTo(q[0], q[1]);
  g.arc(p[n - 1][0], p[n - 1][1], Math.max(0.01, w1 / 2), 0, TAU);
  for (let i = n - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath(); g.fill();
}
// smooth closed shape
export function blob(g, pts, fill) {
  const ring = [pts[pts.length - 1], ...pts, pts[0], pts[1]];
  const p = cr(ring, 4).slice(4, -4);
  g.fillStyle = fill; g.beginPath(); g.moveTo(p[0][0], p[0][1]);
  for (const q of p) g.lineTo(q[0], q[1]);
  g.closePath(); g.fill();
}
function grad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr;
}
function dot(g, x, y, r, c) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function ell(g, x, y, rx, ry, c, rot = 0) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); }
function line(g, pts, w, c) {
  g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.stroke();
}
// flowing ribbon (scarf, sash tail, sleeve tatter)
function ribbon(g, x, y, len, dir, amp, c, phase, w0, w1, color, segs = 6, droop = 0.25) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([x + Math.cos(dir) * len * t, y + Math.sin(dir) * len * t + Math.sin(c - i * 0.9 + phase) * amp * t + droop * len * t * t]);
  }
  brush(g, pts, w0, w1, color, 0.1);
}
// leg with knee bend
function leg(g, hx, hy, fx, fy, knee, w0, w1, color) {
  brush(g, [[hx, hy], [(hx + fx) / 2 + knee, (hy + fy) / 2], [fx, fy]], w0, w1, color, 0.15);
}
function foot(g, x, y, len, color) { brush(g, [[x - 2, y], [x + len, y + 0.5]], 4.2, 2, color, 0); }

// ------------------------------------------------------------ enemies
function ashigaru(g, c) {
  const s = Math.sin(c), bob = Math.abs(Math.cos(c)) * 2.2, hip = -40 - bob;
  const fb = -s * 12, ff = s * 12, lb = Math.max(0, s) * 5, lf = Math.max(0, -s) * 5;
  leg(g, -2, hip, fb, -2 - lb, 5, 8, 5, MID); foot(g, fb, -1 - lb, 6, MID);
  // yari behind
  const py = -bob;
  brush(g, [[-20, -8 + py], [32, -124 + py]], 2.6, 2, INK, 0);
  blob(g, [[32, -124 + py], [29, -110 + py], [35, -111 + py], [34, -128 + py], [33, -136 + py]], INK);
  ribbon(g, 30, -110 + py, 10, 1.9, 2, c * 2, 0, 2.4, 0.6, RED, 4, 0.1);
  leg(g, 2, hip, ff, -2 - lf, 6, 9, 5.5, INK); foot(g, ff, -1 - lf, 6, INK);
  line(g, [ff - 4 + (hip + 20) * 0, -16, ff + 2, -18], 1, LIGHT);
  // kusazuri plates swing
  for (let i = -1; i <= 1; i++) {
    const sw = Math.sin(c + i) * 2;
    blob(g, [[i * 8 - 5, hip - 4], [i * 8 + 5, hip - 4], [i * 8 + 6 + sw, hip + 12], [i * 8 - 5 + sw, hip + 12]], i ? MID : INK2);
    line(g, [i * 8 - 4 + sw * 0.5, hip + 3, i * 8 + 5 + sw * 0.5, hip + 3], 0.8, LIGHT);
  }
  // torso (lamellar do)
  blob(g, [[-11, hip - 4], [-13, hip - 20], [-12, hip - 34], [0, hip - 37], [12, hip - 34], [13, hip - 20], [11, hip - 4]],
    grad(g, -12, hip - 36, 12, hip, [[0, WASH], [1, INK2]]));
  for (let y = hip - 8; y > hip - 32; y -= 5) for (let x = -9; x <= 9; x += 3) dot(g, x, y, 0.55, PALE);
  // arms on the spear
  brush(g, [[-8, hip - 30], [-9, hip - 18], [3, hip - 22]], 6.5, 4.5, INK2);
  brush(g, [[8, hip - 31], [13, hip - 18], [0, hip - 10]], 7, 5, INK);
  // head + jingasa
  dot(g, 1, hip - 42, 7, INK2);
  ell(g, 3, hip - 40, 5, 3, 'rgba(0,0,0,.35)');
  blob(g, [[-27, hip - 44], [-10, hip - 52], [0, hip - 59], [10, hip - 52], [27, hip - 44], [0, hip - 41]],
    grad(g, -20, hip - 58, 20, hip - 42, [[0, WASH], [0.5, MID], [1, INK]]));
  line(g, [-26, hip - 44, 0, hip - 41, 26, hip - 44], 1.6, INK);
  line(g, [-14, hip - 50, -2, hip - 57], 1, 'rgba(236,230,216,.35)');
}

function ninja(g, c) {
  const s = Math.sin(c), co = Math.cos(c), bob = Math.abs(co) * 3;
  const hip = -40 - bob;
  const fb = -s * 17, ff = s * 17, lb = Math.max(0, s) * 8, lf = Math.max(0, -s) * 8;
  // scarf tails behind
  ribbon(g, -6, hip - 42, 30, Math.PI + 0.15, 5, c * 2, 0, 4.4, 0.8, INK, 7, 0.05);
  ribbon(g, -6, hip - 40, 24, Math.PI + 0.35, 4, c * 2, 1.4, 3.4, 0.6, MID, 6, 0.05);
  leg(g, -2, hip, fb, -2 - lb, 8, 8, 4, MID); foot(g, fb, -1 - lb, 5, MID);
  g.save(); g.transform(1, 0, -0.22, 1, 0, 0); // forward lean
  // sword on back
  brush(g, [[-14, hip - 6], [10, hip - 54]], 3, 2.4, INK2, 0);
  line(g, [-9, hip - 18, -4, hip - 14], 2.2, INK);
  // back arm swung behind
  brush(g, [[-5, hip - 32], [-14 - s * 4, hip - 20], [-22 - s * 6, hip - 16]], 5.5, 3.5, MID);
  // torso
  blob(g, [[-9, hip - 2], [-11, hip - 18], [-10, hip - 33], [0, hip - 36], [10, hip - 32], [10, hip - 16], [9, hip - 2]],
    grad(g, -10, hip - 34, 10, hip, [[0, MID], [1, INK]]));
  brush(g, [[-10, hip - 8], [10, hip - 9]], 4, 4, INK2, 0);
  line(g, [-6, hip - 30, 6, hip - 12], 0.9, 'rgba(207,199,184,.5)');
  g.restore();
  leg(g, 2, hip, ff, -2 - lf, 9, 8.5, 4.5, INK); foot(g, ff, -1 - lf, 5, INK);
  for (let i = 0; i < 3; i++) line(g, [ff * 0.6 - 3 + i, -14 - i * 5, ff * 0.6 + 3 + i, -15 - i * 5], 0.8, LIGHT);
  g.save(); g.transform(1, 0, -0.22, 1, 0, 0);
  // front arm with reversed kunai
  brush(g, [[6, hip - 32], [16, hip - 24], [25, hip - 28]], 6, 4, INK);
  brush(g, [[25, hip - 28], [24, hip - 18]], 3, 0.4, WASH, 0);
  dot(g, 25, hip - 29, 2.6, INK);
  // hooded head
  dot(g, 2, hip - 44, 9.5, INK);
  blob(g, [[-8, hip - 50], [-4, hip - 56], [4, hip - 55], [-2, hip - 47]], INK);
  g.fillStyle = PAPER; g.fillRect(0, hip - 48, 12, 4.2);
  dot(g, 4, hip - 46, 1.3, INK); dot(g, 9, hip - 46, 1.3, INK);
  line(g, [3, hip - 49.5, 6, hip - 48.6], 0.8, INK);
  g.restore();
}

function kappa(g, c) {
  const s = Math.sin(c);
  g.save(); g.rotate(s * 0.07);
  const hop = Math.abs(Math.cos(c)) * 2;
  leg(g, -6, -16 - hop, -8 - s * 4, -1, 2, 7, 5, MID);
  blob(g, [[-14 - s * 4, 0], [-8 - s * 4, -2], [-2 - s * 4, 0], [-8 - s * 4, 1]], MID);
  leg(g, 6, -16 - hop, 8 + s * 4, -1, 2, 7.5, 5, INK2);
  blob(g, [[2 + s * 4, 0], [8 + s * 4, -2], [15 + s * 4, 0], [8 + s * 4, 1]], INK2);
  // shell with hex pattern
  ell(g, -7, -36 - hop, 17, 22, grad(g, -20, -56, 5, -16, [[0, MID], [1, INK]]), -0.15);
  g.strokeStyle = WASH; g.lineWidth = 1;
  for (const [hx, hy] of [[-8, -44], [-14, -32], [-2, -30], [-9, -22], [-15, -47]]) {
    g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * TAU; g.lineTo(-0 + hx + Math.cos(a) * 4.5, hy - hop + Math.sin(a) * 4.5); } g.stroke();
  }
  line(g, [-22, -44 - hop, -17, -16 - hop], 1.2, PALE);
  // body with lighter belly plate
  ell(g, 4, -36 - hop, 12, 19, grad(g, 0, -55, 10, -18, [[0, WASH], [1, MID]]));
  ell(g, 7, -34 - hop, 6, 13, 'rgba(207,199,184,.55)');
  for (let y = -44; y < -24; y += 5) line(g, [3, y - hop, 11, y - hop], 0.8, 'rgba(56,52,47,.6)');
  // arm, webbed hand
  brush(g, [[8, -48 - hop], [17, -40 - hop], [21, -30 - hop]], 5, 3.2, INK2);
  blob(g, [[19, -30 - hop], [25, -27 - hop], [22, -24 - hop], [18, -26 - hop]], INK2);
  // head, dish, hair fringe, beak
  dot(g, 7, -61 - hop, 12, grad(g, 0, -72, 14, -50, [[0, WASH], [1, MID]]));
  for (let i = -5; i <= 5; i++) brush(g, [[7 + i * 2.2, -69 - hop], [7 + i * 3, -76 - hop - Math.abs(i) * 0.3 + Math.sin(c + i) * 0.8]], 2.2, 0.3, INK, 0);
  ell(g, 7, -71 - hop, 9, 3.4, PAPER);
  ell(g, 5, -71.5 - hop, 4, 1.2, 'rgba(255,255,255,.8)');
  g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.ellipse(7, -71 - hop, 9, 3.4, 0, 0, TAU); g.stroke();
  brush(g, [[15, -61 - hop], [26, -58 - hop]], 6, 1, INK, 0);
  dot(g, 12, -64 - hop, 2.4, PAPER); dot(g, 12.8, -64 - hop, 1.2, INK);
  g.restore();
}

function ronin(g, c) {
  const s = Math.sin(c), bob = Math.abs(Math.cos(c)) * 2, hip = -42 - bob;
  // back sleeve tatters
  for (let i = 0; i < 3; i++) ribbon(g, -10, hip - 26 + i * 4, 12 + i * 3, Math.PI * 0.62, 2.5, c * 2, i, 3, 0.5, WASH, 4, 0.2);
  // hakama: wide, ragged hem swaying
  const sw = s * 5;
  blob(g, [[-12, hip], [12, hip], [16 + sw, -6], [10 + sw, -3], [6 + sw, -8], [1, -18], [-4 - sw, -7], [-9 - sw, -3], [-16 - sw, -6]],
    grad(g, 0, hip, 0, 0, [[0, INK2], [1, MID]]));
  line(g, [-6, hip + 4, -10 - sw, -8], 0.9, LIGHT); line(g, [5, hip + 4, 10 + sw, -8], 0.9, LIGHT);
  foot(g, -10 - sw, -1, 6, INK); foot(g, 10 + sw, -1, 6, INK);
  // kimono torso, open collar
  blob(g, [[-11, hip + 2], [-13, hip - 18], [-11, hip - 34], [0, hip - 37], [11, hip - 34], [12, hip - 18], [10, hip + 2]],
    grad(g, -10, hip - 36, 10, hip, [[0, LIGHT], [1, WASH]]));
  blob(g, [[-2, hip - 34], [5, hip - 34], [2, hip - 20]], PALE);
  line(g, [-3, hip - 35, 3, hip - 18, 7, hip - 34], 1.3, INK);
  brush(g, [[-12, hip - 2], [12, hip - 3]], 5, 5, INK2, 0);
  // katana in saya at hip
  brush(g, [[-24, hip + 4], [18, hip - 6]], 3.2, 2.6, INK, 0);
  line(g, [11, hip - 4, 22, hip - 8], 3.4, INK2);
  for (let i = 0; i < 4; i++) line(g, [12 + i * 2.5, hip - 6, 13 + i * 2.5, hip - 3.5], 0.7, PALE);
  // arm resting on hilt
  brush(g, [[8, hip - 32], [15, hip - 18], [14, hip - 8]], 7, 5, WASH);
  ribbon(g, 12, hip - 22, 9, 1.9, 1.5, c * 2, 0, 2.5, 0.5, LIGHT, 3, 0.2);
  // head, shadow, sandogasa
  dot(g, 1, hip - 42, 7, MID);
  ell(g, 2, hip - 44, 7, 3, 'rgba(0,0,0,.45)');
  blob(g, [[-29, hip - 45], [-18, hip - 52], [0, hip - 55], [18, hip - 52], [29, hip - 45], [0, hip - 46]],
    grad(g, -20, hip - 56, 20, hip - 44, [[0, PALE], [1, WASH]]));
  g.strokeStyle = 'rgba(56,52,47,.7)'; g.lineWidth = 0.7;
  for (let i = -5; i <= 5; i++) { g.beginPath(); g.moveTo(0, hip - 55); g.lineTo(i * 5.2, hip - 46 + Math.abs(i) * 0.1); g.stroke(); }
  brush(g, [[-29, hip - 45], [0, hip - 46], [29, hip - 45]], 2, 1.4, INK, 0);
}

function samurai(g, c) {
  const s = Math.sin(c), bob = Math.abs(Math.cos(c)) * 1.6, hip = -42 - bob;
  const fb = -s * 11, ff = s * 11;
  leg(g, -3, hip, fb, -2, 4, 10, 7, MID); foot(g, fb, -1, 7, MID);
  // sashimono-less back cord
  ribbon(g, -10, hip - 30, 14, Math.PI * 0.75, 2, c * 2, 0, 2.2, 0.6, RED, 4, 0.3);
  // raised katana (two hands, behind head)
  const kx = 10, ky = hip - 44 + s * 1.5;
  brush(g, [[kx, ky], [-6, ky - 26], [-24, ky - 40]], 3.2, 1.2, MID, 0.05);
  line(g, [kx - 2, ky - 4, -18, ky - 36], 0.7, PALE);
  ell(g, kx + 1, ky + 1, 3.6, 1.6, INK, -0.9);
  leg(g, 3, hip, ff, -2, 5, 11, 7.5, INK); foot(g, ff, -1, 7, INK);
  for (let i = 0; i < 3; i++) line(g, [ff * 0.55 - 4, -10 - i * 6, ff * 0.55 + 4, -11 - i * 6], 1, LIGHT);
  // kusazuri: laced plate rows
  for (let i = -1; i <= 1; i++) {
    const sw = Math.sin(c + i * 1.3) * 2;
    blob(g, [[i * 9 - 6, hip - 4], [i * 9 + 6, hip - 4], [i * 9 + 7 + sw, hip + 15], [i * 9 - 6 + sw, hip + 15]], i ? INK2 : MID);
    for (let r = 0; r < 3; r++) line(g, [i * 9 - 5 + sw * r / 3, hip + r * 5, i * 9 + 6 + sw * r / 3, hip + r * 5], 0.8, r === 1 ? 'rgba(179,32,42,.75)' : LIGHT);
  }
  // do (cuirass)
  blob(g, [[-14, hip - 2], [-15, hip - 20], [-13, hip - 35], [0, hip - 38], [13, hip - 35], [15, hip - 20], [14, hip - 2]],
    grad(g, -14, hip - 38, 14, hip, [[0, WASH], [0.5, INK2], [1, INK]]));
  for (let y = hip - 6; y > hip - 34; y -= 5.5) line(g, [-13, y, 13, y - 1], 0.9, 'rgba(156,147,134,.8)');
  dot(g, -2, hip - 22, 2, RED); ribbon(g, -2, hip - 21, 7, 1.7, 1, c, 0, 1.4, 0.4, RED, 3, 0);
  // sode (shoulder guards) swinging
  for (const [sx, k] of [[-1, 0], [1, 1]]) {
    const sw = Math.sin(c + k) * 0.12;
    g.save(); g.translate(sx * 15, hip - 34); g.rotate(sx * 0.18 + sw);
    blob(g, [[-6, 0], [6, 0], [7, 16], [-7, 16]], k ? INK : MID);
    for (let r = 4; r < 16; r += 4) line(g, [-6, r, 6, r], 0.8, LIGHT);
    g.restore();
  }
  // arms up to the hilt
  brush(g, [[12, hip - 32], [17, hip - 40], [kx + 1, ky + 1]], 7, 5, INK);
  brush(g, [[-10, hip - 32], [-2, hip - 42], [kx - 2, ky + 2]], 6, 4.5, INK2);
  // menpo + kabuto
  dot(g, 1, hip - 44, 7.5, INK2);
  blob(g, [[-3, hip - 44], [8, hip - 44], [7, hip - 38], [-2, hip - 38]], INK);
  line(g, [0, hip - 41, 6, hip - 41], 0.7, PALE);
  for (let r = 0; r < 3; r++) brush(g, [[-12 - r * 2, hip - 46 + r * 4], [0, hip - 48 + r * 3], [10 + r, hip - 46 + r * 4]], 3.2, 2, r % 2 ? MID : INK, 0.3);
  g.fillStyle = grad(g, -10, hip - 58, 10, hip - 46, [[0, MID], [1, INK]]);
  g.beginPath(); g.arc(0, hip - 48, 11, Math.PI, 0); g.fill();
  for (let i = -2; i <= 2; i++) line(g, [i * 3.6, hip - 58 + Math.abs(i) * 0.8, i * 4.6, hip - 48], 0.6, LIGHT);
  brush(g, [[-2, hip - 57], [-12, hip - 66], [-12, hip - 80]], 3.4, 0.8, INK, 0.2);
  brush(g, [[2, hip - 57], [12, hip - 66], [13, hip - 80]], 3.4, 0.8, INK, 0.2);
}

function tengu(g, c, big = 1) {
  const fly = -18 - Math.sin(c) * 4;
  g.save(); g.translate(0, fly);
  const flap = Math.sin(c * 2);
  // wings with individual feathers
  const wing = (dir, dark, sc) => {
    g.save(); g.translate(-3, -66); g.rotate(dir * (0.15 + flap * 0.42)); g.scale(sc * big * 0.82, sc * big * 0.82 * (0.8 + flap * 0.2));
    const tip = [-50, -24];
    brush(g, [[0, 0], [-22, -18], tip], 6, 2, dark);
    for (let i = 0; i < 9; i++) {
      const t = i / 8, bx = -50 * t + (-22 + 22 * t) * (1 - t) * 0, by = -24 * t - 10 * Math.sin(t * Math.PI);
      const len = 16 + t * 20;
      brush(g, [[bx, by], [bx - 6 - t * 8, by + len * 0.6], [bx - 4 - t * 12, by + len]], 6.5 - t * 1.5, 0.6, i % 2 ? dark : INK, 0.3);
    }
    g.restore();
  };
  wing(-1, MID, 0.86);
  // dangling legs + ippon-ba geta
  const sw = Math.sin(c) * 3;
  leg(g, -3, -34, -6 + sw, -8, 2, 6, 4, INK2); line(g, [-10 + sw, -6, -1 + sw, -6], 2.4, INK); line(g, [-5 + sw, -6, -5 + sw, -1], 2, INK);
  leg(g, 3, -34, 6 - sw, -8, 2, 6.5, 4, INK); line(g, [2 - sw, -6, 11 - sw, -6], 2.4, INK); line(g, [6 - sw, -6, 6 - sw, -1], 2, INK);
  // robe (suzukake) with red bonten pom-poms
  blob(g, [[-11, -30], [-13, -50], [-10, -70], [0, -73], [10, -70], [13, -50], [12, -30], [0, -26]],
    grad(g, -12, -72, 12, -28, [[0, LIGHT], [1, WASH]]));
  line(g, [-4, -71, 3, -40], 1, INK); line(g, [5, -71, 0, -52], 1, INK);
  for (let i = 0; i < 3; i++) { dot(g, -1 + i * 3.5, -60 + i * 6, 2.4, RED); dot(g, -1.6 + i * 3.5, -60.6 + i * 6, 0.8, RED2); }
  brush(g, [[-12, -36], [12, -38]], 4, 4, INK2, 0);
  wing(1, INK, 1);
  // arm with feather fan (hauchiwa)
  brush(g, [[9, -66], [17, -56], [22, -60]], 6, 4, WASH);
  line(g, [22, -60, 30, -74], 1.6, INK2);
  blob(g, [[30, -74], [22, -86], [30, -96], [40, -90], [40, -78]], INK);
  for (let i = 0; i < 5; i++) line(g, [30, -75, 25 + i * 3.5, -92 + Math.abs(i - 2) * 1.5], 0.6, WASH);
  // red face, long nose, white mane, tokin
  for (let i = 0; i < 7; i++) brush(g, [[-4, -82 + i * 2], [-12 - i, -74 + i * 3 + Math.sin(c + i) * 1.5]], 3, 0.4, PALE, 0);
  for (let i = 0; i < 7; i++) brush(g, [[-4, -82 + i * 2], [-12 - i, -74 + i * 3 + Math.sin(c + i) * 1.5]], 0.8, 0.2, MID, 0);
  dot(g, 2, -79, 8.5, DRED);
  dot(g, 3, -80, 7, RED);
  brush(g, [[7, -80], [18, -79], [28, -77]], 5.5, 1.6, RED2, 0);
  line(g, [8, -78.5, 26, -77], 0.6, DRED);
  brush(g, [[1, -84], [7, -86]], 2.4, 1, PAPER, 0);
  dot(g, 5, -82, 1.2, INK);
  blob(g, [[-2, -88], [5, -88], [5, -95], [1, -97], [-2, -94]], INK);
  g.restore();
}

function yurei(g, c, queen = false) {
  g.save(); g.translate(0, -10 - Math.sin(c) * 4);
  const robe = queen ? '#f2ede4' : '#f5f1e8';
  // dissolving tail wisps
  for (let i = 0; i < 5; i++) {
    const x0 = -10 + i * 5;
    brush(g, [[x0, -22], [x0 + Math.sin(c + i) * 4, -10], [x0 + Math.sin(c * 1 + i * 1.7) * 7 - 4, 4]], 6, 0.3, 'rgba(245,241,232,.75)', 0.2);
    brush(g, [[x0 + 2, -22], [x0 + 2 + Math.sin(c + i) * 4, -10], [x0 + Math.sin(c + i * 1.7) * 7 - 2, 4]], 0.8, 0.1, 'rgba(20,18,16,.35)', 0);
  }
  // robe
  const body = [[-10, -74], [10, -74], [15, -50], [14, -24], [-14, -22], [-15, -50]];
  blob(g, body, grad(g, 0, -74, 0, -16, [[0, robe], [0.8, robe], [1, 'rgba(245,241,232,.4)']]));
  g.strokeStyle = 'rgba(20,18,16,.6)'; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(-10, -74); g.quadraticCurveTo(-17, -50, -14, -24); g.moveTo(10, -74); g.quadraticCurveTo(16, -50, 14, -26); g.stroke();
  line(g, [4, -74, -4, -56, -2, -40], 1, 'rgba(20,18,16,.55)');
  if (queen) { line(g, [6, -74, -2, -56], 2.2, RED); brush(g, [[-12, -34], [14, -36]], 4, 4, RED, 0); }
  // limp arms, long sleeves
  blob(g, [[4, -68], [22, -60], [30, -56], [28, -48], [14, -50], [6, -56]], robe);
  line(g, [4, -68, 22, -60, 30, -56, 28, -48, 14, -50], 0.9, 'rgba(20,18,16,.55)');
  brush(g, [[28, -55], [33, -50], [32, -45]], 2.6, 1, '#efe9de');
  line(g, [29, -55, 33, -50, 32, -45], 0.5, 'rgba(20,18,16,.5)');
  // pale face + hitaikakushi
  dot(g, 2, -82, 7.5, '#f0ebe1');
  line(g, [-5, -82, 2, -90, 9, -82], 0.7, 'rgba(20,18,16,.4)');
  blob(g, [[-1, -88], [6, -88], [2.5, -84]], PAPER);
  dot(g, 5, -81, queen ? 1.4 : 1.1, queen ? RED2 : INK);
  // long black hair, strands drifting
  dot(g, 0, -85, 8.5, INK);
  for (let i = 0; i < 9; i++) {
    const x0 = -8 + i * 2, len = 30 + (i % 3) * 8 + (queen ? 16 : 0);
    brush(g, [[x0, -86], [x0 - 2 + Math.sin(c + i) * 2, -86 + len * 0.5], [x0 - 4 + Math.sin(c * 1 + i * 0.7) * 5, -86 + len]], 3.2, 0.3, INK, 0.1);
  }
  brush(g, [[6, -88], [9, -76], [8 + Math.sin(c) * 2, -64]], 2.6, 0.3, INK, 0);
  g.restore();
}

function oni(g, c, warlord = false) {
  const s = Math.sin(c), bob = Math.abs(Math.cos(c)) * 3.5, hip = -40 - bob;
  const fb = -s * 10, ff = s * 10;
  leg(g, -6, hip, fb - 2, -2, 4, 15, 10, MID);
  for (let i = 0; i < 3; i++) brush(g, [[fb - 4 + i * 3, -2], [fb - 1 + i * 4, -1]], 3, 1, INK, 0);
  // back arm
  brush(g, [[-18, hip - 32], [-26, hip - 18], [-24, hip - 4]], 11, 8, MID);
  dot(g, -24, hip - 3, 5, INK2);
  leg(g, 6, hip, ff + 2, -2, 5, 16, 10, INK2);
  for (let i = 0; i < 3; i++) brush(g, [[ff + i * 3, -2], [ff + 4 + i * 4, -1]], 3, 1, INK, 0);
  line(g, [ff * 0.5 + 2, hip + 16, ff * 0.6 + 6, hip + 26], 1, WASH);
  // tiger-pelt loincloth
  blob(g, [[-16, hip + 2], [16, hip + 2], [18, hip + 14], [6, hip + 18], [-6, hip + 16], [-18, hip + 14]], PALE);
  for (let i = -14; i <= 14; i += 5) brush(g, [[i, hip + 2], [i + 2, hip + 9], [i, hip + 15]], 2.6, 0.6, INK, 0);
  if (warlord) brush(g, [[-18, hip + 1], [18, hip]], 4.5, 4.5, RED, 0);
  // torso, muscles
  blob(g, [[-17, hip + 2], [-22, hip - 16], [-20, hip - 34], [-6, hip - 39], [12, hip - 38], [22, hip - 32], [20, hip - 14], [16, hip + 2]],
    grad(g, -18, hip - 38, 20, hip, [[0, WASH], [0.55, INK2], [1, INK]]));
  g.strokeStyle = 'rgba(156,147,134,.55)'; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(-10, hip - 30); g.quadraticCurveTo(-2, hip - 25, 6, hip - 30); g.moveTo(-2, hip - 24); g.lineTo(-2, hip - 4);
  g.moveTo(-8, hip - 16); g.lineTo(4, hip - 16); g.moveTo(-8, hip - 9); g.lineTo(4, hip - 9); g.stroke();
  if (warlord) for (const sx of [-1, 1]) blob(g, [[sx * 14, hip - 36], [sx * 26, hip - 40], [sx * 30, hip - 46], [sx * 24, hip - 32]], INK);
  // front arm + kanabo
  const ang = -0.95 + s * 0.28;
  brush(g, [[16, hip - 34], [26, hip - 22], [30, hip - 14]], 12, 9, INK2);
  g.save(); g.translate(31, hip - 14); g.rotate(ang);
  brush(g, [[0, 4], [0, -16], [0, -52]], 5, 13, INK, 0);
  for (let y = -16; y > -52; y -= 6) for (const x of [-4, 0, 4]) dot(g, x + (y % 12 ? 1 : -1), y, 1.1, PALE);
  line(g, [-4, -12, 4, -12], 1.6, LIGHT);
  g.restore();
  dot(g, 30, hip - 13, 5.4, INK);
  // head: mane, horns, red eyes, fangs
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (0.65 + i * 0.09);
    brush(g, [[2 + Math.cos(a) * 8, hip - 48 + Math.sin(a) * 8], [2 + Math.cos(a) * 20 + Math.sin(c + i) * 1.5, hip - 48 + Math.sin(a) * 18]], 4, 0.4, INK, 0);
  }
  dot(g, 3, hip - 47, 11.5, grad(g, -6, hip - 58, 12, hip - 38, [[0, MID], [1, INK]]));
  for (const sx of [-1, 1]) {
    brush(g, [[sx * 5 + 2, hip - 55], [sx * 10 + 2, hip - 64], [sx * 13 + 3, hip - 74]], 6, 0.8, PALE, 0.1);
    line(g, [sx * 7 + 2, hip - 58, sx * 9.5 + 2, hip - 58.5], 0.8, MID);
    if (warlord) brush(g, [[sx * 12 + 2, hip - 69], [sx * 13 + 3, hip - 74]], 2.6, 0.6, RED, 0);
  }
  brush(g, [[2, hip - 52], [14, hip - 51]], 3, 1.6, INK, 0);
  dot(g, 7, hip - 49, 2.6, 'rgba(214,64,60,.35)'); dot(g, 7, hip - 49, 1.6, RED2);
  dot(g, 12, hip - 49, 2.2, 'rgba(214,64,60,.35)'); dot(g, 12, hip - 49, 1.3, RED2);
  blob(g, [[6, hip - 41], [8, hip - 36], [9.5, hip - 41]], PAPER);
  blob(g, [[11, hip - 41], [12, hip - 37.5], [13.5, hip - 41]], PAPER);
}

function orochi(g, c) {
  // coiled body
  ell(g, 0, -12, 38, 15, grad(g, 0, -27, 0, 3, [[0, MID], [1, INK]]));
  ell(g, -6, -22, 26, 10, INK2);
  g.strokeStyle = 'rgba(156,147,134,.55)'; g.lineWidth = 0.8;
  for (let i = -30; i < 32; i += 6) for (let r = 0; r < 2; r++) { g.beginPath(); g.arc(i + r * 3, -12 + r * 5, 3.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
  for (let h = 0; h < 7; h++) {
    const a = -1.3 + h * 0.43, sw = Math.sin(c + h * 1.7) * 8;
    const bx = Math.sin(a) * 22, ex = Math.sin(a) * 44 + sw, ey = -78 - Math.cos(a) * 30 + Math.abs(sw) * 0.4;
    brush(g, [[bx, -18], [bx * 1.4 - sw * 0.5, -46], [ex - 3, ey + 8], [ex, ey]], 11, 6, h % 2 ? INK : INK2, 0.1);
    line(g, [bx * 1.2, -26, ex - 2, ey + 6], 0.8, 'rgba(156,147,134,.6)');
    g.save(); g.translate(ex, ey); g.rotate(a * 0.5 + (ex > 0 ? 0 : 0));
    blob(g, [[-7, 3], [4, 2], [15, -1], [4, -7], [-6, -6]], INK);
    brush(g, [[-4, -6], [-10, -12]], 2, 0.4, PALE, 0);
    dot(g, 4, -3.5, 2.2, 'rgba(214,64,60,.4)'); dot(g, 4, -3.5, 1.3, RED2);
    if (h % 2) brush(g, [[15, -1], [21, 1 + Math.sin(c * 3 + h) * 2], [24, -1]], 1.1, 0.3, RED, 0);
    g.restore();
  }
}

function shogun(g, c) {
  // sashimono banner on the back
  const sw = Math.sin(c) * 2;
  line(g, [-8, -60, -12, -146], 2, INK);
  blob(g, [[-12, -146], [-40 + sw, -144], [-40 + sw * 1.4, -106], [-12, -108]], '#f4f0e6');
  line(g, [-12, -146, -40 + sw, -144, -40 + sw * 1.4, -106, -12, -108], 1.2, INK);
  dot(g, -26 + sw * 0.6, -126, 8, RED);
  samurai(g, c);
  const hip = -42 - Math.abs(Math.cos(c)) * 1.6;
  blob(g, [[-3, hip - 57], [0, hip - 74], [3, hip - 57]], RED);
  brush(g, [[-16, hip - 62], [0, hip - 56], [16, hip - 62]], 2.6, 1.2, RED, 0.3);
}

export function drawFigure(g, kind, c) {
  switch (kind) {
    case 0: return ashigaru(g, c);
    case 1: return ninja(g, c);
    case 2: return kappa(g, c);
    case 3: return ronin(g, c);
    case 4: return samurai(g, c);
    case 5: return tengu(g, c);
    case 6: return yurei(g, c);
    case 7: return oni(g, c);
    case 8: return oni(g, c, true);
    case 9: {
      tengu(g, c, 1.3);
      g.save(); g.translate(0, -18 - Math.sin(c) * 4);
      blob(g, [[-6, -84], [10, -86], [10, -72], [-4, -70]], RED);
      brush(g, [[7, -80], [20, -79], [32, -77]], 6, 1.8, RED2, 0);
      line(g, [0, -82, 8, -84], 1.4, INK);
      g.restore(); return;
    }
    case 10: return shogun(g, c);
    case 11: return orochi(g, c);
    case 12: return yurei(g, c, true);
    default: return ashigaru(g, c);
  }
}

// ------------------------------------------------------------ the Asura
export function drawAsura(g, c, lunge, arms) {
  const br = Math.sin(c) * 1.2;
  const lean = lunge * 4;
  // flowing sash tails behind
  ribbon(g, -12, -48, 30, Math.PI * 0.86, 5, c * 2, 0, 7, 1.2, RED, 7, 0.1);
  ribbon(g, -10, -45, 24, Math.PI * 0.72, 4, c * 2, 1.2, 5, 0.8, DRED, 6, 0.2);
  // hair strands behind the head
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (1.0 + i * 0.09), len = 18 + (i % 3) * 7;
    brush(g, [[lean - 3, -98 + br], [lean - 3 + Math.cos(a) * len * 0.6, -98 + br + Math.sin(a) * len * 0.5 + 4], [lean - 3 + Math.cos(a) * len + Math.sin(c + i) * 2.5, -98 + br + Math.sin(a) * len * 0.3 + 10 + i]], 3.6, 0.3, INK, 0.2);
  }
  // hakama — wide, torn, flowing
  const hs = Math.sin(c) * 2;
  blob(g, [[-15, -48], [15, -48], [24, -30], [31 + hs, -8], [24 + hs, -4], [20 + hs, -10], [15, -3], [8, -20], [0, -26], [-8, -20], [-15, -3], [-20 - hs, -10], [-24 - hs, -4], [-31 - hs, -8], [-24, -30]],
    grad(g, -20, -48, 20, 0, [[0, MID], [0.6, INK2], [1, INK]]));
  g.strokeStyle = 'rgba(207,199,184,.32)'; g.lineWidth = 0.9;
  for (let i = 0; i < 5; i++) {
    g.beginPath(); g.moveTo(-12 + i * 2.5, -44); g.quadraticCurveTo(-18 + i * 2, -26, -24 + i * 3 - hs, -8); g.stroke();
    g.beginPath(); g.moveTo(5 + i * 2.5, -44); g.quadraticCurveTo(12 + i * 2.5, -26, 18 + i * 3 + hs, -8); g.stroke();
  }
  for (let i = 0; i < 4; i++) ribbon(g, -26 + i * 4 - hs, -6, 6 + i, Math.PI * 0.6, 1.5, c * 2, i, 2.6, 0.4, INK2, 3, 0.2);
  for (let i = 0; i < 4; i++) ribbon(g, 16 + i * 4 + hs, -6, 6 + i, Math.PI * 0.4, 1.5, c * 2, i, 2.6, 0.4, INK2, 3, 0.2);
  // bare feet + ankle beads
  foot(g, -24, -1, 8, MID); foot(g, 22, -1, 9, MID);
  for (const sx of [-22, 21]) for (let i = -2; i <= 2; i++) dot(g, sx + i * 2.6, -5, 1.7, INK);
  // sash knot
  blob(g, [[-16, -53], [16, -54], [15, -44], [-15, -43]], grad(g, 0, -54, 0, -43, [[0, RED2], [1, RED]]));
  line(g, [-14, -48, 14, -49], 0.9, DRED);
  blob(g, [[-6, -52], [-1, -50], [-4, -45], [-9, -47]], DRED);
  // back arm
  brush(g, [[-20 + lean * 0.5, -80 + br], [-31, -66], [-26, -55]], 10, 7.5, '#2b2723');
  dot(g, -26, -54, 6.2, INK);
  for (let i = 0; i < 5; i++) dot(g, -29.5 + i * 1.6, -60 + i * 0.3, 1.8, INK);
  // torso — muscled, scarred
  blob(g, [[-14, -52], [-22 + lean * 0.5, -70], [-23 + lean, -84 + br], [0 + lean, -88 + br], [23 + lean, -84 + br], [21 + lean, -70], [14, -52]],
    grad(g, -20, -88, 20, -52, [[0, '#57504a'], [0.5, '#34302c'], [1, '#1f1c19']]));
  g.strokeStyle = 'rgba(207,199,184,.35)'; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-12 + lean, -79 + br); g.quadraticCurveTo(-3 + lean, -73, 4 + lean, -79 + br);
  g.moveTo(4 + lean, -79 + br); g.quadraticCurveTo(11 + lean, -73, 18 + lean, -80 + br);
  g.moveTo(-1 + lean, -72); g.lineTo(-1 + lean * 0.6, -56);
  g.moveTo(-8, -66); g.lineTo(6, -66); g.moveTo(-7, -60); g.lineTo(6, -60);
  g.stroke();
  g.strokeStyle = 'rgba(236,230,216,.85)'; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(-13 + lean, -82); g.lineTo(-4 + lean, -70); g.moveTo(-11 + lean, -76); g.lineTo(-6 + lean, -78);
  g.moveTo(8 + lean, -84); g.lineTo(16 + lean, -73); g.moveTo(-6, -63); g.lineTo(5, -57); g.stroke();
  // ghost arms (Six Arms)
  if (arms) {
    g.globalAlpha = 0.5;
    for (const [ax, ay, sx] of [[38, -96, 1], [40, -60, 1], [-36, -98, -1], [-38, -62, -1]]) {
      brush(g, [[sx * 16 + lean, -78], [sx * 28 + lean, (ay - 78) / 2 - 40], [ax + lean, ay]], 7, 5, INK2);
      dot(g, ax + lean, ay, 5, INK);
    }
    g.globalAlpha = 1;
  }
  // front (striking) arm — extends with the lunge
  const reach = 8 + lunge * 26;
  brush(g, [[20 + lean, -81 + br], [26 + reach * 0.45, -72 + lunge * 2], [28 + reach, -72 + lunge * 5]], 10.5, 8, '#2b2723');
  dot(g, 30 + reach, -72 + lunge * 5, 6.8, INK);
  for (let i = 0; i < 5; i++) dot(g, 21 + reach * 0.8 + i * 1.5, -71.5 + lunge * 4, 1.8, INK);
  if (lunge > 0.5) for (let i = 0; i < 3; i++) brush(g, [[18 + reach * 0.5, -76 + i * 4], [6 + reach * 0.2, -77 + i * 5]], 1.6, 0.2, 'rgba(20,18,16,.5)', 0);
  // neck + head
  brush(g, [[lean, -86 + br], [lean + 1, -92 + br]], 8, 7, '#2b2723', 0);
  dot(g, lean + 1, -95 + br, 9, grad(g, -8, -104, 10, -86, [[0, '#4c4640'], [1, '#221f1c']]));
  // wild hair crown + topknot
  const hx = lean + 1, hy = -97 + br;
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI * (1.08 - i * 0.045), len = 17 + ((i * 7) % 5) * 4.5;
    const sway = Math.sin(c + i * 0.6) * 2.5;
    brush(g, [[hx + Math.cos(a) * 5, hy + Math.sin(a) * 5], [hx + Math.cos(a) * len * 0.6 - len * 0.15 + sway * 0.5, hy + Math.sin(a) * len * 0.62], [hx + Math.cos(a) * len - len * 0.42 + sway, hy + Math.sin(a) * len * 0.8 + 2]], 5.2, 0.4, INK, 0.25);
  }
  dot(g, hx - 1, hy - 4, 8, INK);
  brush(g, [[hx - 3, hy - 9], [hx - 6, hy - 18], [hx - 4 + Math.sin(c) * 2, hy - 28]], 6, 1, INK, 0.3);
  line(g, [hx - 6, hy - 14, hx - 1, hy - 15], 1.6, PALE);
  // brow, red eyes with glow, scar
  brush(g, [[hx + 1, hy - 1], [hx + 10, hy + 0.5]], 2.6, 1, INK, 0);
  dot(g, hx + 5, hy + 2, 2.6, 'rgba(214,64,60,.35)'); dot(g, hx + 5, hy + 2, 1.5, RED2);
  dot(g, hx + 9.4, hy + 2.2, 2.2, 'rgba(214,64,60,.35)'); dot(g, hx + 9.4, hy + 2.2, 1.2, RED2);
  line(g, [hx + 3, hy - 3, hx + 7, hy + 6], 0.8, 'rgba(236,230,216,.8)');
  line(g, [hx + 5, hy + 7, hx + 9, hy + 6.5], 0.9, INK);
  // oversized red prayer beads + tassel
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * 0.08 + (i / 10) * Math.PI * 0.84;
    const bx = lean + Math.cos(a) * 16, by = -86 + br + Math.sin(a) * 10;
    dot(g, bx, by, 3.9, DRED); dot(g, bx, by, 3.2, RED); dot(g, bx - 1.1, by - 1.2, 1, 'rgba(255,225,220,.85)');
  }
  brush(g, [[lean + 5, -76 + br], [lean + 7, -68], [lean + 4 + Math.sin(c) * 1.5, -60]], 1.8, 0.6, RED, 0);
  for (let i = -1; i <= 1; i++) brush(g, [[lean + 4, -61], [lean + 4 + i * 2 + Math.sin(c + i) * 1.2, -54]], 1, 0.3, RED, 0);
}
