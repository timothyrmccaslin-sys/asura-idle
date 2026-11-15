# Asura — Wrath Incarnate · Idle Defense

An idle tower defense game in sumi-e ink. You are the Asura, standing in the centre of the field; ninja, ashigaru, kappa, ronin, samurai, tengu, yūrei and oni come at you from every direction, with a boss (Oni Warlord, Tengu King, the Shogun, Orochi, Onryō Queen) every 10 waves.

**Play:** https://timothyrmccaslin-sys.github.io/asura-idle/

- **Rust + WebAssembly core** (`core/`): game state, 360° wave spawning, combat, upgrades, abilities, Rebirth / prayer-bead prestige, offline-progress math, and save serialisation (JSON + base64 export/import).
- **Thin JS layer**: `render.js` draws the exported state on a canvas in ink-wash style (all art is procedural); `main.js` handles the DOM UI, input and localStorage.
- Saves to `localStorage` every 5 s and when you leave; offline progress up to 8 h (more with Meditation).
- No build step needed to host: the compiled `pkg/` is committed. To rebuild: `./build.sh` (needs Rust, the `wasm32-unknown-unknown` target and `wasm-pack`).

No tracking, no accounts, no external requests (fonts are self-hosted).
