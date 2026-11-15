// One shared Web Audio context for music and sound effects, unlocked in a way
// iOS / iPadOS Safari (and home-screen apps) accept:
//  * created and resumed synchronously inside a touchend / pointerup / click /
//    keydown handler (WebKit does not treat touchstart or pointerdown as a gesture
//    that may start audio), never after an await;
//  * a one-sample silent buffer is played in that same gesture, which is what
//    actually "unlocks" output on older iOS;
//  * navigator.audioSession.type = 'playback' (Safari 16.4+), so the iPad mute /
//    ring-silent setting does not silence the game the way it does 'ambient' web audio;
//  * WebKit's 'interrupted' state (calls, Siri, app switching) and contexts that
//    stay suspended after the app returns from the background are resumed on
//    visibilitychange / pageshow / focus and on the next tap, and a context that
//    will not come back is replaced in the next gesture.
const GESTURES = ['touchend', 'pointerup', 'mouseup', 'click', 'keydown'];
let ctx = null, hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden', replace = false, misses = 0, checking = false;
const listeners = [], wants = new Map();
const stats = { unlocks: 0, recreated: 0, session: 'n/a', lastGesture: '' };

const active = () => { for (const v of wants.values()) if (v) return true; return false; };

function setSession(type) {
  try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch {}
  try { stats.session = navigator.audioSession ? navigator.audioSession.type : 'n/a'; } catch {}
}

function create() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
  ctx.onstatechange = () => {
    // calls / Siri / app switch put WebKit contexts into 'interrupted'; try to come back
    if (ctx && !hidden && active() && ctx.state !== 'running' && ctx.state !== 'closed') setTimeout(tryResume, 250);
  };
  for (const cb of listeners) { try { cb(ctx); } catch (e) { console.warn('audio listener', e); } }
  return ctx;
}

function silentBlip() {
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate || 44100), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination);
    if (s.start) s.start(0); else s.noteOn(0);
  } catch {}
}
function tryResume() {
  if (!ctx || hidden || !active() || ctx.state === 'running' || ctx.state === 'closed') return;
  try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch {}
}

// must stay synchronous: WebKit only honours audio started inside the handler itself
function gesture(e) {
  if (e.type === 'keydown' && (e.repeat || e.metaKey || e.ctrlKey)) return;
  if (!active()) return;
  stats.lastGesture = e.type;
  setSession('playback');
  if (ctx && replace) { // a context that would not resume after the app was backgrounded
    const old = ctx; ctx = null; replace = false; misses = 0; stats.recreated++;
    try { old.onstatechange = null; old.close().catch(() => {}); } catch {}
  }
  if (!ctx && !create()) return;
  if (ctx.state === 'running') { misses = 0; return; }
  try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch {}
  silentBlip();
  stats.unlocks++;
  if (checking) return; // one check per tap (a tap fires touchend, pointerup, mouseup and click)
  const c = ctx; checking = true;
  setTimeout(() => { // still not running after two separate taps: replace it on the next one
    checking = false;
    if (c !== ctx || hidden || !active()) return;
    if (ctx.state === 'running') misses = 0; else if (++misses >= 2) replace = true;
  }, 700);
}

if (typeof window !== 'undefined') {
  for (const ev of GESTURES) window.addEventListener(ev, gesture, { capture: true, passive: true });
  const back = () => { hidden = document.visibilityState === 'hidden'; if (!hidden) tryResume(); };
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    if (!ctx) return;
    if (hidden) { try { ctx.suspend().catch(() => {}); } catch {} } else tryResume();
  });
  window.addEventListener('pageshow', back);
  window.addEventListener('focus', back);
  window.addEventListener('pagehide', () => { hidden = true; if (ctx) try { ctx.suspend().catch(() => {}); } catch {} });
}

export const audio = {
  // cb(ctx) now (if a context exists) and whenever a new one is created
  onContext(cb) { listeners.push(cb); if (ctx) cb(ctx); },
  get ctx() { return ctx; },
  // a consumer (music, sfx) wants sound; the context is suspended only when nobody does
  want(key, on) {
    wants.set(key, !!on);
    if (!ctx) return;
    if (active()) tryResume();
    else setTimeout(() => { if (ctx && !active()) { setSession('auto'); try { ctx.suspend().catch(() => {}); } catch {} } }, 400);
  },
  get hidden() { return hidden; },
  get state() { return { ctx: ctx ? ctx.state : 'locked', hidden, ...stats }; },
};
