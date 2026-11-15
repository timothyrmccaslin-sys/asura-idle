// Sound effects, synthesised live with Web Audio from oscillators, filtered
// noise and envelopes, plus one owner-supplied recording (the punch) that every
// fist, palm, kick, crit and boss strike plays dry.
// Each voice is a function (ctx, out, t, o) so the same code also renders
// offline (OfflineAudioContext) for previews.

const noiseCache = new WeakMap();
function noise(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 1234567;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = s / 2147483648 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
const R = (a, b) => a + Math.random() * (b - a);

// --- building blocks
function env(ctx, out, t, a, d, peak = 1, curve = 'exp') {
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); else g.gain.linearRampToValueAtTime(0, t + a + d);
  g.connect(out); return g;
}
function nz(ctx, out, t, dur, type, f, q = 1, a = 0.002, peak = 1, f2 = null) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = env(ctx, out, t, a, dur, peak);
  s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
  return fl;
}
function tone(ctx, out, t, dur, type, f, f2 = null, a = 0.002, peak = 1, glide = null) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (glide || dur));
  const g = env(ctx, out, t, a, dur, peak);
  o.connect(g); o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
function bell(ctx, out, t, f, dur, peak) { // inharmonic struck metal / chime partials
  for (const [k, p] of [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]]) tone(ctx, out, t, dur / Math.sqrt(k), 'sine', f * k, null, 0.002, peak * p);
}
function pluck(ctx, out, t, f, peak = 0.3) { // koto-like: bright triangle with a fast filter close
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(f * 8, t); fl.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.5); fl.Q.value = 2;
  const g = env(ctx, out, t, 0.002, 0.9, peak); o.connect(fl); fl.connect(g); o.start(t); o.stop(t + 1);
}
function thud(ctx, out, t, f0, f1, dur, peak) { return tone(ctx, out, t, dur, 'sine', f0, f1, 0.001, peak, dur * 0.6); }
// the punch recording, played dry. Each new strike chokes the previous one with a
// ~30 ms fade so overlapping copies at slightly different speeds never comb-filter
// (that phasing is what made rapid hits ring metallic).
const choke = new WeakMap();
function strike(ctx, out, t, buf, rate, gain) {
  const prev = choke.get(ctx);
  if (prev) { prev.gain.cancelScheduledValues(t); prev.gain.setTargetAtTime(0, t, 0.01); }
  const src = ctx.createBufferSource(); src.buffer = buf.buf; src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(out);
  src.start(t, buf.offset); choke.set(ctx, g);
  return (buf.buf.duration - buf.offset) / rate;
}

// --- the voices: (ctx, out, t, o) -> duration (s)
export const VOICES = {
  // strikes
  // soft air only: a fixed low-pass, no sweep and no resonance (the old band-pass sweep read as a "zzzip")
  whoosh(ctx, out, t) { const d = R(0.14, 0.2); nz(ctx, out, t, d, 'lowpass', R(900, 1100), -3, d * 0.5, 0.3); return d; },
  hit(ctx, out, t, o = {}) { // flesh-and-cloth impact; o.v picks punch / kick / palm
    const v = o.v ?? (Math.random() * 3) | 0, p = R(0.88, 1.14);
    // fist, palm and kick strikes play only the owner-supplied punch recording, dry;
    // kicks play it ~10% lower (0.90x +/-3%) and 20% louder so they land heavier
    if (o.buf) {
      const kick = v === 1;
      return strike(ctx, out, t, o.buf, kick ? 0.9 * R(0.97, 1.03) : R(0.94, 1.06), R(0.85, 1.0) * 1.4 * (kick ? 1.2 : 1));
    }
    thud(ctx, out, t, [150, 115, 180][v] * p, 52 * p, [0.09, 0.13, 0.07][v], 0.9);
    nz(ctx, out, t, [0.05, 0.07, 0.035][v], 'bandpass', [1400, 900, 2600][v] * p, 1.2, 0.001, [0.55, 0.5, 0.7][v]);
    if (v === 2) nz(ctx, out, t, 0.02, 'highpass', 4000, 0.7, 0.001, 0.3); // palm slap
    return 0.15;
  },
  grind(ctx, out, t) { return VOICES.hit(ctx, out, t, { v: 2 }); }, // Whirlpool / Lotus contact ticks stay synthesised so they never cut off a strike
  crit(ctx, out, t, o = {}) {
    // with the recording loaded: the same dry strike, harder, plus a clean sine sub (no crack, no ring)
    if (o.buf) { const d = strike(ctx, out, t, o.buf, (o.v === 1 ? 0.88 : 0.95) * R(0.98, 1.02), 1.4 * 1.45); thud(ctx, out, t, 85, 40, 0.18, 0.5); return d; }
    VOICES.hit(ctx, out, t, { v: 1 });
    nz(ctx, out, t, 0.09, 'highpass', 2500, 0.8, 0.001, 0.6);       // crack
    tone(ctx, out, t, 0.25, 'triangle', R(1150, 1300), R(900, 1000), 0.001, 0.14); // ring
    thud(ctx, out, t + 0.01, 90, 40, 0.22, 0.8);
    return 0.3;
  },
  death(ctx, out, t) { // the painting tears: a soft low-Q rip and a dull splatter, no tonal layer
    nz(ctx, out, t + 0.03, 0.22, 'bandpass', R(1100, 1400), 0.3, 0.012, 0.4);
    nz(ctx, out, t + 0.05, 0.14, 'lowpass', 700, -3, 0.004, 0.4);
    return 0.35;
  },
  bossHit(ctx, out, t, o = {}) {
    if (o.buf) { const d = strike(ctx, out, t, o.buf, 0.84 * R(0.98, 1.02), 1.4 * 1.3); thud(ctx, out, t, 75, 35, 0.25, 0.6); return d; }
    thud(ctx, out, t, 95, 38, 0.3, 1); nz(ctx, out, t, 0.12, 'bandpass', 600, 1, 0.001, 0.6); nz(ctx, out, t, 0.05, 'highpass', 3000, 0.7, 0.001, 0.25); return 0.35; },
  bossDeath(ctx, out, t) {
    VOICES.taiko(ctx, out, t, { big: true });
    bell(ctx, out, t + 0.05, 98, 3.2, 0.35);                         // temple gong
    nz(ctx, out, t, 1.8, 'lowpass', 300, 0.8, 0.05, 0.55, 80);       // rumble
    nz(ctx, out, t + 0.1, 1.0, 'bandpass', 2000, 0.8, 0.02, 0.25, 400);
    return 3;
  },
  taiko(ctx, out, t, o = {}) {
    const k = o.big ? 0.8 : 1;
    thud(ctx, out, t, 110 * k, 50 * k, o.big ? 0.9 : 0.6, 1);
    nz(ctx, out, t, 0.25, 'lowpass', 500, 1, 0.001, 0.6);
    nz(ctx, out, t, 0.04, 'bandpass', 2200, 1, 0.001, 0.3);
    return 0.9;
  },
  // Asura
  wrath(ctx, out, t) { // leap (whoosh up) then the slam: sub drop, ground crack, rubble
    nz(ctx, out, t, 0.35, 'bandpass', 300, 1.2, 0.2, 0.35, 1800);
    const s = t + 0.38;
    thud(ctx, out, s, 120, 28, 0.9, 1);
    nz(ctx, out, s, 0.12, 'highpass', 1800, 0.7, 0.001, 0.6);
    nz(ctx, out, s, 1.2, 'lowpass', 400, 0.8, 0.01, 0.6, 90);
    for (let i = 0; i < 6; i++) nz(ctx, out, s + 0.1 + Math.random() * 0.5, 0.05, 'bandpass', R(1500, 3500), 2, 0.001, 0.12);
    return 1.6;
  },
  storm(ctx, out, t) { // crackling red lightning + thunder roll
    for (let i = 0; i < 14; i++) nz(ctx, out, t + Math.random() * 0.6, R(0.01, 0.04), 'highpass', R(2500, 6000), 0.7, 0.0005, R(0.2, 0.5));
    nz(ctx, out, t + 0.4, 0.08, 'highpass', 1500, 0.7, 0.001, 0.8);   // strike
    nz(ctx, out, t + 0.45, 2.0, 'lowpass', 260, 0.9, 0.08, 0.65, 70); // thunder
    return 2.4;
  },
  zap(ctx, out, t) { // chain lightning jump: two short dry crackles, no buzzing sawtooth
    nz(ctx, out, t, 0.025, 'bandpass', R(2500, 3500), 0.5, 0.0005, 0.22);
    nz(ctx, out, t + R(0.02, 0.04), 0.02, 'bandpass', R(2000, 3000), 0.5, 0.0005, 0.14);
    return 0.07;
  },
  beads(ctx, out, t, o = {}) { // a mala shaken into orbit: wooden clicks + a low red hum
    const n = 14;
    for (let i = 0; i < n; i++) { const tt = t + i * 0.035 + Math.random() * 0.02; nz(ctx, out, tt, 0.025, 'bandpass', R(2200, 3600), 4, 0.0005, 0.35); tone(ctx, out, tt, 0.03, 'sine', R(1700, 2300), null, 0.0005, 0.06); }
    tone(ctx, out, t, 1.2, 'sine', o.blue ? 220 : 110, null, 0.25, 0.18);
    tone(ctx, out, t, 1.2, 'sine', o.blue ? 330 : 165, null, 0.3, 0.08);
    return 1.4;
  },
  sixarms(ctx, out, t) { // four arms erupt: whoosh flurry + a struck bronze chord
    for (let i = 0; i < 4; i++) nz(ctx, out, t + i * 0.08, 0.15, 'bandpass', 600 + i * 150, 1.4, 0.06, 0.3, 2800);
    bell(ctx, out, t + 0.3, 147, 1.6, 0.18); bell(ctx, out, t + 0.3, 220, 1.4, 0.12);
    thud(ctx, out, t + 0.3, 80, 40, 0.5, 0.7);
    return 1.8;
  },
  // Daeva
  tide(ctx, out, t) { // a wave gathers and rolls outward
    nz(ctx, out, t, 1.3, 'lowpass', 250, 1, 0.35, 0.8, 1800);
    nz(ctx, out, t + 0.35, 0.8, 'bandpass', 2500, 0.6, 0.05, 0.4, 900); // spray
    thud(ctx, out, t + 0.3, 90, 35, 0.6, 0.6);
    return 1.6;
  },
  rain(ctx, out, t) { // patter swelling in, droplets and a soft healing tone
    nz(ctx, out, t, 1.8, 'bandpass', 3500, 0.5, 0.6, 0.22);
    for (let i = 0; i < 22; i++) VOICES.drop(ctx, out, t + Math.random() * 1.8, { soft: true });
    tone(ctx, out, t, 1.6, 'sine', 523, null, 0.5, 0.05); tone(ctx, out, t, 1.6, 'sine', 784, null, 0.6, 0.035);
    return 2.2;
  },
  drop(ctx, out, t, o = {}) { // a single water droplet: fast upward chirp
    const f = R(1300, 2600);
    tone(ctx, out, t, 0.05, 'sine', f, f * 1.9, 0.001, o.soft ? 0.06 : 0.12, 0.04);
    if (!o.soft) nz(ctx, out, t, 0.03, 'bandpass', 3000, 1.5, 0.001, 0.1);
    return 0.08;
  },
  whirlpool(ctx, out, t) { // churning vortex: filter swirling over noise, pitch spiralling down
    const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 3; fl.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.frequency.setValueAtTime(3, t); lfo.frequency.linearRampToValueAtTime(7, t + 1.6);
    const lg = ctx.createGain(); lg.gain.value = 450; lfo.connect(lg); lg.connect(fl.frequency);
    const g = env(ctx, out, t, 0.3, 1.5, 0.45, 'lin'); s.connect(fl); fl.connect(g);
    s.start(t); lfo.start(t); s.stop(t + 1.9); lfo.stop(t + 1.9);
    tone(ctx, out, t, 1.6, 'sine', 400, 90, 0.2, 0.12);
    return 2;
  },
  lotus(ctx, out, t) { // blue beads: a rising pentatonic chime and the bead rattle
    [880, 988, 1175, 1319, 1760].forEach((f, i) => bell(ctx, out, t + i * 0.07, f, 1.4, 0.06));
    VOICES.beads(ctx, out, t + 0.1, { blue: true });
    return 1.6;
  },
  heal(ctx, out, t) { tone(ctx, out, t, 0.18, 'sine', 880, 1320, 0.01, 0.08, 0.12); return 0.2; },
  // UI and flow
  buy(ctx, out, t) { tone(ctx, out, t, 0.08, 'triangle', 1320, null, 0.002, 0.12); tone(ctx, out, t + 0.05, 0.14, 'triangle', 1980, null, 0.002, 0.1); return 0.2; },
  bossAppear(ctx, out, t) {
    VOICES.taiko(ctx, out, t, { big: true }); VOICES.taiko(ctx, out, t + 0.42, {}); VOICES.taiko(ctx, out, t + 0.62, { big: true });
    tone(ctx, out, t, 2.2, 'sawtooth', 55, 52, 0.4, 0.06); // low drone under it
    return 2.4;
  },
  waveClear(ctx, out, t) { [587, 659, 880].forEach((f, i) => pluck(ctx, out, t + i * 0.09, f, 0.12)); return 1; },
  defeat(ctx, out, t) { bell(ctx, out, t, 73, 3, 0.35); nz(ctx, out, t, 1.2, 'lowpass', 200, 1, 0.1, 0.4, 60); return 3; },
  unlock(ctx, out, t) { [659, 784, 988, 1319].forEach((f, i) => bell(ctx, out, t + i * 0.12, f, 1.6, 0.08)); return 2; },
};

// per-sound throttles (min seconds between plays) and voice classes for the
// concurrency cap, so a flurry of 30 hits/s stays a texture, not a wall
const MIN = { whoosh: 0.09, hit: 0.045, grind: 0.06, crit: 0.08, death: 0.07, bossHit: 0.12, zap: 0.06, drop: 0.07, heal: 0.35, buy: 0.07, waveClear: 1.2 };
const CLASS = { whoosh: 'hit', hit: 'hit', grind: 'hit', crit: 'hit', death: 'hit', bossHit: 'hit', zap: 'hit', drop: 'hit' };
const CAP = { hit: 6 };
const SAMPLED = new Set(['hit', 'crit', 'bossHit']); // voices that play the punch recording when it is loaded
// per-voice level trims (measured short-term loudness, balanced so hits sit low,
// abilities and boss moments stand out, UI blips stay subtle)
export const LEVEL = { whoosh: 1.2, hit: 0.75, grind: 0.75, crit: 0.63, death: 1.6, bossHit: 0.67, wrath: 0.67, storm: 1.7, zap: 1.0, drop: 1, beads: 1.5, sixarms: 0.8,
  tide: 0.9, rain: 2.4, whirlpool: 2.3, lotus: 1.35, heal: 1.8, buy: 2.7, waveClear: 2.1, bossAppear: 0.7, bossDeath: 0.7, defeat: 0.8, unlock: 2.1 };

// skip codec padding / silence so the recorded punch lands on the frame it is triggered
export function sampleStart(buf) {
  const x = buf.getChannelData(0);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.004) return Math.max(0, i - 40) / buf.sampleRate;
  return 0;
}

export function createSfx({ enabled = true, volume = 0.6 } = {}) {
  let ctx = null, master = null, comp = null, on = enabled, vol = volume, hidden = false;
  const last = {}, live = {}; let lastStrike = -9;
  const level = () => (on ? vol * vol * 1.1 : 0); // hits sit just under the music, ability hits level with it
  function unlock() {
    if (ctx) { if (on && !hidden && ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = level();
    comp.connect(master); master.connect(ctx.destination);
    if (!on) ctx.suspend().catch(() => {});
    loadPunch();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    if (!ctx) return;
    if (hidden) ctx.suspend().catch(() => {}); else if (on) ctx.resume().catch(() => {});
  });
  const stats = { played: 0, dropped: 0, punch: 'pending' };
  let punch = null; // { buf, offset } decoded from assets/audio/punch.wav
  async function loadPunch() {
    try {
      const ab = await (await fetch('assets/audio/punch.wav')).arrayBuffer();
      const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
      punch = { buf, offset: sampleStart(buf) }; stats.punch = 'sample';
    } catch (e) { stats.punch = 'synth'; console.warn('punch sample unavailable, using synthesised hit', e); }
  }
  function play(name, o, gain = 1) {
    if (!ctx || !on || hidden || ctx.state !== 'running') return false;
    const v = VOICES[name]; if (!v) return false;
    const now = ctx.currentTime;
    if (MIN[name] && now - (last[name] ?? -9) < MIN[name]) { stats.dropped++; return false; }
    const usesSample = punch && SAMPLED.has(name);
    if (usesSample && now - lastStrike < 0.035) { stats.dropped++; return false; } // no stacked starts of the same recording
    const cls = CLASS[name];
    if (cls) { const l = (live[cls] = (live[cls] || []).filter((e) => e > now)); if (l.length >= CAP[cls]) { stats.dropped++; return false; } }
    last[name] = now;
    const g = ctx.createGain(); g.gain.value = (LEVEL[name] ?? 1) * gain; g.connect(comp);
    o = o || {};
    if (usesSample) { o = { ...o, buf: punch }; lastStrike = now; }
    const d = v(ctx, g, now + 0.005, o);
    setTimeout(() => g.disconnect(), (d + 0.5) * 1000);
    if (cls) live[cls].push(now + Math.min(d, 0.25));
    stats.played++;
    return true;
  }
  return {
    play,
    setEnabled(v) { on = !!v; if (!ctx) return; if (on) ctx.resume().catch(() => {}); master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03); if (!on) setTimeout(() => { if (!on) ctx.suspend().catch(() => {}); }, 200); },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.03); },
    get state() { return { ctx: ctx ? ctx.state : 'locked', on, vol, ...stats }; },
  };
}
