// Soundtrack player. The three loops in assets/music are original pieces
// synthesised by tools/music.py (no samples, no third-party audio).
// Web Audio, sample-accurate looping: each file carries 0.5 s of wrap-around
// audio on both ends, so loopStart/loopEnd sit inside continuous material and
// the codec's start padding never reaches the loop seam.
import { audio } from './audio.js';
const BASE = 'assets/music/';
export const TRACKS = { normal: 'ink-road', alt: 'willow-rain', boss: 'oni-drums' };

export function createMusic({ enabled = true, volume = 0.6 } = {}) {
  let ctx = null, master = null, meta = null, want = null, cur = null, on = enabled, vol = volume, hidden = false;
  const buffers = new Map(), loading = new Map();
  const FADE = 1.6;

  async function loadMeta() {
    if (!meta) meta = await (await fetch(BASE + 'loops.json')).json();
    return meta;
  }
  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (!loading.has(name)) {
      loading.set(name, (async () => {
        const ab = await (await fetch(BASE + name + '.mp3')).arrayBuffer();
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
        buffers.set(name, buf); return buf;
      })().catch((e) => { loading.delete(name); throw e; }));
    }
    return loading.get(name);
  }
  const level = () => (on ? vol * vol : 0); // perceptual-ish volume curve

  // the shared context (audio.js) is created/unlocked inside a real tap; it can
  // be replaced if iOS leaves it dead after backgrounding, so rebuild the graph
  // on every new context (decoded AudioBuffers are reusable across contexts)
  audio.want('music', on);
  audio.onContext((c) => {
    ctx = c; cur = null;
    master = ctx.createGain(); master.gain.value = level(); master.connect(ctx.destination);
    if (want && on) start(want);
  });

  async function start(name) {
    if (!ctx) return;
    try {
      const [m, buf] = await Promise.all([loadMeta(), load(name)]);
      if (want !== name || (cur && cur.name === name)) return;
      const info = m[name], src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = true;
      src.loopStart = info.loopStart; src.loopEnd = info.loopStart + info.loopLength;
      src.connect(g); g.connect(master);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + FADE);
      src.start(now, info.loopStart);
      if (cur) { const o = cur; o.g.gain.cancelScheduledValues(now); o.g.gain.setValueAtTime(o.g.gain.value, now); o.g.gain.linearRampToValueAtTime(0, now + FADE); o.src.stop(now + FADE + 0.05); }
      cur = { name, src, g };
    } catch (e) { console.warn('music', e); }
  }

  return {
    // pick the loop for this wave: boss track on boss waves, stage loops alternate per 10-wave block
    setWave(w) { this.setTrack(w % 10 === 0 ? TRACKS.boss : Math.floor((w - 1) / 10) % 2 ? TRACKS.alt : TRACKS.normal); },
    setTrack(name) { if (name === want) return; want = name; if (ctx && on) start(name); },
    setEnabled(v) {
      on = !!v; audio.want('music', on);
      if (!ctx) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now);
      if (on) { master.gain.linearRampToValueAtTime(level(), now + 0.4); if (want && (!cur || cur.name !== want)) start(want); }
      else master.gain.linearRampToValueAtTime(0, now + 0.3);
    },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05); },
    get state() { return { ctx: ctx ? ctx.state : 'locked', session: audio.state.session, track: cur ? cur.name : null, want, on, vol, gain: master ? master.gain.value : 0 }; },
  };
}
