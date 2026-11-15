# Asura — Wrath Incarnate · Idle Defense

An idle tower defense game in sumi-e ink. You are the Asura, standing in the centre of the field; ninja, ashigaru, kappa, ronin, samurai, tengu, yūrei and oni come at you from every direction, with a boss (Oni Warlord, Tengu King, the Shogun, Orochi, Onryō Queen) every 10 waves.

**Play:** https://timothyrmccaslin-sys.github.io/asura-idle/

- **Rust + WebAssembly core** (`core/`): game state, 360° wave spawning, combat, upgrades, abilities, Rebirth / prayer-bead prestige, offline-progress math, and save serialisation (JSON + base64 export/import).
- **Thin JS layer**: `render.js` draws the exported state on a canvas in ink-wash style; `main.js` handles the DOM UI, input and localStorage.
- **Installable PWA**: `manifest.json` (regular + maskable icons, install screenshots) and `sw.js`, which precaches the whole app shell (HTML, JS, the wasm `pkg/`, art atlases, fonts, icons) so the game runs fully offline. Each release bumps the cache `VERSION` (and `APP_VERSION` in `main.js`); the game then shows “New version, tap to refresh”. There's an Install button (Android/desktop) and an Add to Home Screen hint on iOS. Saves stay in localStorage and survive updates.
- **Painted art** (`assets/art/`): every character is hand-painted sumi-e: dry brush, ink bleed, splatter, red-only accents. That means the Asura in 10 key poses, 8 foes and 5 bosses, plus enso and splatter stamps for effects. Each was keyed off the paper to transparency with the edge colours un-blended, so there are no halos, then packed into three webp atlases (`asura`, `foes`, `fx`, about 850 KB in total) with `atlas.json` holding the rects and anchors (feet, sash, beads, head). `art.js` loads them and caches each frame pre-scaled to its on-screen size. Foes are animated with strip warps: the legs shear and stride below the hip, robes, hair and banners ripple, flyers float, and deaths tear the painting into drifting strips. The procedural `figures.js` is only a fallback while the atlases load.
- **The Asura's martial arts** (`asura.js`): a cutout-style rig over the painted key poses. Moves are a spinning backfist, roundhouse, spinning hook kick, crescent kick, palm strike, uppercut, tornado kick and sweep:
  - Each move has anticipation, a full-body turn (a scale flip with the pose swapped at the back-facing instant), a lunge toward the target, a hop, lean and squash, and smear ghosts. It finishes with follow-through and a weight shift back to stance.
  - Painted dry-brush arc trails come from an enso unwrapped into a strip and bent along each arc. The sash, hair and mala beads whip with the rotation.
  - Moves are picked by the target's direction and distance; multi-target cleaves use the spinning moves. They chain into combos with a finisher.
  - Each move's impact frame is timed to the core's swing, using the attack phase and approach speed. Crits get a slowed impact frame and a red ink burst. Far targets are struck by a flying ki crescent.
  - Signatures: Wrath Burst is a leaping spin into a ground slam, with the shockwave held to land on the slam. Storm is a rapid flurry. Six Arms is a fan of red ghost palms.
  - Animation speed follows attack speed, capped at about 3 full moves per second (5 during Storm); faster swings are blended in as echo strikes. The Reduced effects setting drops the spins, ghosts and ribbons. An adaptive governor sheds secondary effects on slow devices.
- **Ability effects** (`powers.js`): when Storm triggers, a crackling red painted-lightning cage builds around the Asura for about half a second, then forks out to the nearest foes with red ink flashes where it lands. While Storm lasts, a red aura crackles around him and every chain hit sends a forked bolt. Blood Beads orbit on a tilted, bobbing plane. They pass in front of and behind him, scaling and shading with depth, and leave glossy highlights and faint red trails. They spin up when cast and spin down and fade when the ability ends.
- **Themed stages** (`stage.js`, `assets/themes/`): each 10-wave block is painted after the boss waiting at its end:
  - Oni Warlord: volcanic hell gate.
  - Tengu King: misty peaks.
  - Shogun: castle courtyard.
  - Orochi: swamp delta.
  - Onryō Queen: haunted shrine at night.

  An RNG seeded by the block flips and frames the backdrop and scatters painted props around the edges, never in the combat circle. It also varies the ground and picks the ambient particles: embers and ash, feathers, petals, mist, fireflies, rain or ghost wisps. So each block is unique, but the same after a reload. After the boss dies, the new scene bleeds in with an ink wash and a brush-lettered area banner (e.g. “Gate of Ashes”). Each scene is baked once per block into an offscreen canvas, and particles are pooled and capped; Reduced effects turns both the particles and the transition off. Theme art is about 350 KB per theme. It is lazy-loaded (the current and next themes only), and the service worker caches it in the background so every stage works offline. To rebuild from the painted sources: `python3 tools/build_themes.py <src dir>`.
- Saves to `localStorage` every 5 s and when you leave; offline progress up to 8 h (more with Meditation).
- No build step needed to host: the compiled `pkg/` and the art atlases are committed. To rebuild the core: `./build.sh` (needs Rust, the `wasm32-unknown-unknown` target and `wasm-pack`). To re-pack the atlases from the painted sources: `python3 tools/build_atlas.py <src dir>` (needs numpy, scipy, Pillow).

No tracking, no accounts, no external requests (fonts are self-hosted).
