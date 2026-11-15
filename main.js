// Thin JS glue: loads the Rust/wasm core, renders, wires the DOM UI,
// and persists saves to localStorage. All game rules live in Rust.
import init, { Game } from './pkg/asura_core.js';
import { createRenderer, fmt } from './render.js';
import { macronHTML } from './macron.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';

const SAVE_KEY = 'asura-idle-save-v1';
const PREFS_KEY = 'asura-idle-prefs-v1';
const AUTOSAVE_MS = 5000;
const APP_VERSION = '3.5.1'; // keep in step with VERSION in sw.js

const UPS = {
  damage:   { name: 'Wrath',        desc: 'Raw striking power. Doubles every 25 levels.', f: (v) => fmt(v) },
  speed:    { name: 'Fury',         desc: 'Attacks per second.',                       f: (v) => v.toFixed(2) + '/s' },
  range:    { name: 'Reach',        desc: 'Radius of the ink circle he strikes within.', f: (v) => Math.round(v * 100) + '' },
  crit:     { name: 'Red Eye',      desc: 'Chance to land a crimson critical.',        f: (v) => Math.round(v * 100) + '%' },
  critdmg:  { name: 'Scar Memory',  desc: 'Critical damage multiplier.',               f: (v) => '×' + v.toFixed(2) },
  cleave:   { name: 'Cleave',       desc: 'Foes struck by every swing.',               f: (v) => v + ' foes' },
  vitality: { name: 'Iron Flesh',   desc: 'Maximum health.',                           f: (v) => fmt(v) },
  regen:    { name: 'Breath',       desc: 'Health restored per second.',               f: (v) => fmt(v) + '/s' },
  greed:    { name: 'Soul Hunger',  desc: 'Souls reaped from every kill.',             f: (v) => '×' + fmt(v) },
  siphon:   { name: 'Blood Rite',   desc: 'Heal for a share of damage dealt.',         f: (v) => (v * 100).toFixed(1) + '%' },
};
const SHOP = {
  wrathMala:    { name: 'Mala of Wrath',  desc: '+50% damage per level.' },
  goldMala:     { name: 'Golden Mala',    desc: '+35% souls per level.' },
  ironBody:     { name: 'Iron Body',      desc: '+50% health and regen per level.' },
  swiftMala:    { name: 'Swift Mala',     desc: '+6% attack speed per level.' },
  karmicLeap:   { name: 'Karmic Leap',    desc: 'Each new life starts 3 waves further (up to half your best).' },
  meditation:   { name: 'Meditation',     desc: '+10% offline souls and +1h offline cap per level.' },
  tempestHeart: { name: 'Tempest Heart',  desc: 'Ability cooldowns −6% per level.' },
};
// Characters (data-driven; the rules for each live in the Rust core's CHARS)
const CHARS = {
  asura: {
    name: 'Asura', title: 'Wrathful Guardian', accent: '#b3202a', portrait: 'assets/chars/asura.webp',
    lore: 'A demon-god of fury who fights the dark with fists, red beads and lightning.',
    abs: {
      wrath:   { name: 'Wrath Burst', glyph: '怒', sub: 'radial blast', desc: 'A leaping slam: a ring of ink that smashes every foe in reach.' },
      storm:   { name: 'Storm',       glyph: '嵐', sub: 'I am the storm', desc: 'Lightning lashes the field; every strike chains to more foes, faster.' },
      beads:   { name: 'Blood Beads', glyph: '血', sub: 'heal · ×2 souls', desc: 'Orbiting red beads heal him and double the souls reaped.' },
      sixarms: { name: 'Six Arms',    glyph: '臂', sub: '+5 foes · ×2 dmg', desc: 'Four more arms: strikes hit 5 more foes for double damage.' },
    },
  },
  daeva: {
    name: 'Daeva', title: 'Tide-Dancer', accent: '#2a5bd8', portrait: 'assets/chars/daeva.webp',
    lore: 'A celestial dancer of water and mercy. Less raw force, far more staying power.',
    abs: {
      tide:      { name: 'Tidal Surge',      glyph: '潮', sub: 'wave · push · slow', desc: 'A ring of ink-water rolls out, hurling foes back and slowing them.' },
      rain:      { name: 'Healing Rain',     glyph: '雨', sub: 'heal over time', desc: 'Blue rain heals her for 10s; falling droplets strike nearby foes.' },
      whirlpool: { name: 'Whirlpool',        glyph: '渦', sub: 'pull · grind', desc: 'A vortex opens in the thickest knot of foes, dragging them in and grinding them down.' },
      lotus:     { name: 'Blue Lotus Beads', glyph: '蓮', sub: 'shield · heal', desc: 'Blue beads orbit her: each hit heals, and they shield 60% of harm.' },
    },
  },
};
let ABS = CHARS.asura.abs, curChar = '';
const BOSSES = { 8: 'Oni Warlord', 9: 'Tengu King', 10: 'The Shogun', 11: 'Orochi', 12: 'Onryō Queen' };

const $ = (id) => document.getElementById(id);
const prefs = Object.assign({ buy: 1, fx: false, nums: true, intro: false, music: true, vol: 0.6, sfx: true, sfxVol: 0.6 }, safeJSON(localStorage.getItem(PREFS_KEY)) || {});
function safeJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }
function dur(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

let game, renderer, ui = null, music = null, sfx = null;

function save() {
  if (!game) return;
  try { localStorage.setItem(SAVE_KEY, game.save_json(Date.now())); } catch (e) { console.warn('save failed', e); }
  const el = $('last-saved'); if (el) el.textContent = 'Last saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) + '.';
}

// ------------------------------------------------------------ modal / toast
function modal(title, html, actions) {
  const d = $('modal');
  $('modal-title').textContent = '— ' + title + ' —';
  $('modal-body').innerHTML = html;
  const row = $('modal-actions'); row.innerHTML = '';
  return new Promise((resolve) => {
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || ''); b.textContent = a.label; b.value = a.value;
      b.addEventListener('click', (e) => { if (a.onClick && a.onClick(e) === false) { e.preventDefault(); return; } });
      row.appendChild(b);
    }
    d.onclose = () => resolve(d.returnValue);
    d.returnValue = '';
    d.showModal();
  });
}
let toastT = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
let bannerT = 0;
function banner(text, sub, red) {
  const b = $('banner');
  b.hidden = false; b.className = 'banner' + (red ? ' red' : '');
  b.innerHTML = macronHTML(text) + (sub ? `<small>${macronHTML(sub)}</small>` : '');
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerT); bannerT = setTimeout(() => (b.hidden = true), 2100);
}

// ------------------------------------------------------------ UI build
const upEls = {}, shopEls = {}, abEls = {};
function buildUI() {
  const list = $('up-list');
  for (const [key, d] of Object.entries(UPS)) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="c-name">${d.name}<span class="c-lvl"></span></div><div class="c-desc">${d.desc}</div><div class="c-val"></div>
      <button class="buy" data-key="${key}"><span class="b-n"></span><span class="b-cost"></span></button>`;
    list.appendChild(c);
    upEls[key] = { lvl: c.querySelector('.c-lvl'), val: c.querySelector('.c-val'), btn: c.querySelector('.buy'), n: c.querySelector('.b-n'), cost: c.querySelector('.b-cost') };
  }
  const shop = $('shop-list');
  Object.entries(SHOP).forEach(([key, d], i) => {
    const c = document.createElement('div'); c.className = 'card bead-card';
    c.innerHTML = `<div class="c-name">${d.name}<span class="c-lvl"></span></div><div class="c-desc">${d.desc}</div><div class="c-val"></div>
      <button class="buy"><span class="b-n">beads</span><span class="b-cost"></span></button>`;
    c.querySelector('.buy').addEventListener('click', () => { if (game.buy_shop(i)) { sfx.play('buy'); refresh(true); save(); } });
    shop.appendChild(c);
    shopEls[key] = { lvl: c.querySelector('.c-lvl'), btn: c.querySelector('.buy'), cost: c.querySelector('.b-cost') };
  });
  buildChars();

  // hold-to-repeat buying
  list.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.buy'); if (!btn || btn.disabled) return;
    const idx = Object.keys(UPS).indexOf(btn.dataset.key);
    const buyOnce = () => { const n = game.buy(idx, prefs.buy); if (n) { sfx.play('buy'); refresh(true); } return n; };
    buyOnce();
    let iv = null;
    const to = setTimeout(() => { iv = setInterval(() => { if (!buyOnce()) stop(); }, 110); }, 420);
    const stop = () => { clearTimeout(to); clearInterval(iv); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); btn.removeEventListener('pointerleave', stop); };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); btn.addEventListener('pointerleave', stop);
  });
  list.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.buy'); if (!btn || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); if (game.buy(Object.keys(UPS).indexOf(btn.dataset.key), prefs.buy)) { sfx.play('buy'); refresh(true); }
  });

  document.querySelectorAll('#buy-mult button').forEach((b) => {
    b.classList.toggle('on', +b.dataset.m === prefs.buy);
    b.addEventListener('click', () => {
      prefs.buy = +b.dataset.m; savePrefs();
      document.querySelectorAll('#buy-mult button').forEach((x) => x.classList.toggle('on', x === b));
      refresh(true);
    });
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
    document.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.dataset.body !== t.dataset.tab));
    refresh(true);
  }));
  $('auto-btn').addEventListener('click', () => { game.set_auto(!ui.auto); refresh(true); toast(ui.auto ? 'Auto-advance on: pushing to new waves.' : 'Auto-advance off: farming this wave.'); });
  $('opt-autocast').addEventListener('change', (e) => { game.set_autocast(e.target.checked); refresh(true); });
  $('opt-fx').checked = prefs.fx;
  $('opt-fx').addEventListener('change', (e) => { prefs.fx = e.target.checked; savePrefs(); renderer.setReduced(prefs.fx); });
  $('opt-nums').checked = prefs.nums;
  $('opt-nums').addEventListener('change', (e) => { prefs.nums = e.target.checked; savePrefs(); renderer.setNumbers(prefs.nums); });
  $('opt-music').checked = prefs.music;
  $('opt-music').addEventListener('change', (e) => { prefs.music = e.target.checked; savePrefs(); music.setEnabled(prefs.music); $('opt-vol').disabled = !prefs.music; });
  $('opt-vol').value = Math.round(prefs.vol * 100); $('opt-vol').disabled = !prefs.music;
  $('opt-vol').addEventListener('input', (e) => { prefs.vol = +e.target.value / 100; music.setVolume(prefs.vol); $('vol-val').textContent = e.target.value + '%'; });
  $('opt-vol').addEventListener('change', savePrefs);
  $('vol-val').textContent = Math.round(prefs.vol * 100) + '%';
  $('opt-sfx').checked = prefs.sfx; $('opt-sfxvol').disabled = !prefs.sfx;
  $('opt-sfx').addEventListener('change', (e) => { prefs.sfx = e.target.checked; savePrefs(); sfx.setEnabled(prefs.sfx); $('opt-sfxvol').disabled = !prefs.sfx; });
  $('opt-sfxvol').value = Math.round(prefs.sfxVol * 100);
  $('opt-sfxvol').addEventListener('input', (e) => { prefs.sfxVol = +e.target.value / 100; sfx.setVolume(prefs.sfxVol); $('sfxvol-val').textContent = e.target.value + '%'; });
  $('opt-sfxvol').addEventListener('change', () => { savePrefs(); sfx.play('hit', { v: 0 }); });
  $('sfxvol-val').textContent = Math.round(prefs.sfxVol * 100) + '%';
  $('save-btn').addEventListener('click', () => { save(); toast('Saved to this browser.'); });
  $('export-btn').addEventListener('click', doExport);
  $('import-btn').addEventListener('click', doImport);
  $('reset-btn').addEventListener('click', doReset);
  $('rebirth-btn').addEventListener('click', doRebirth);
}

async function doExport() {
  const code = game.export_save(Date.now());
  const html = `<p class="note">Copy this scroll somewhere safe. Paste it into Import on any device to restore.</p><textarea id="export-text" readonly>${code}</textarea>`;
  modal('Export Save', html, [
    { label: 'Copy', cls: 'primary', value: 'copy', onClick: () => {
      const ta = $('export-text'); ta.select();
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => toast('Save copied.'), () => { document.execCommand && document.execCommand('copy'); toast('Save selected; copy it.'); });
      return false;
    } },
    { label: 'Close', value: 'close' },
  ]);
  setTimeout(() => $('export-text') && $('export-text').select(), 50);
}
async function doImport() {
  const html = `<p class="note">Paste an exported save. This replaces your current progress.</p><textarea id="import-text" placeholder="ASURA1:..."></textarea><p class="note red" id="import-err"></p>`;
  modal('Import Save', html, [
    { label: 'Import', cls: 'primary', value: 'ok', onClick: () => {
      const txt = $('import-text').value;
      if (!game.import_save(txt)) { $('import-err').textContent = 'That scroll is unreadable. Nothing was changed.'; return false; }
      save(); refresh(true); toast('Save imported.');
    } },
    { label: 'Cancel', value: 'cancel' },
  ]);
}
async function doReset() {
  const r = await modal('Hard Reset', `<p>Erase <b>everything</b>: souls, upgrades, prayer beads and stats? This cannot be undone.</p><p class="note">Tip: Export first if you might want it back.</p>`,
    [{ label: 'Erase everything', cls: 'danger primary', value: 'yes' }, { label: 'Cancel', value: 'no' }]);
  if (r !== 'yes') return;
  game.hard_reset();
  try { localStorage.removeItem(SAVE_KEY); } catch {}
  save(); refresh(true); toast('A new life begins.');
}
async function doRebirth() {
  const g = ui.rebirthBeads;
  if (g <= 0) return;
  const r = await modal('Rebirth', `<p class="center">Lay down this life at wave ${ui.maxWave}?</p><div class="away-big red">+${fmt(g)} beads</div>
    <p class="note center">Souls and upgrades reset. Beads, the shrine and unlocked abilities stay.</p>`,
    [{ label: 'Be reborn', cls: 'danger primary', value: 'yes' }, { label: 'Not yet', value: 'no' }]);
  if (r !== 'yes') return;
  const got = game.rebirth();
  save(); refresh(true);
  banner('Reborn', `+${fmt(got)} prayer beads`, true);
}

// ------------------------------------------------------------ characters
// ability buttons follow the active character
function buildAbilities(key) {
  if (curChar === key) return;
  curChar = key; ABS = (CHARS[key] || CHARS.asura).abs;
  const abs = $('abilities'); abs.innerHTML = '';
  for (const k of Object.keys(abEls)) delete abEls[k];
  Object.entries(ABS).forEach(([k, d], i) => {
    const b = document.createElement('button'); b.className = 'ab locked'; b.dataset.key = k;
    b.innerHTML = `<span class="cd"></span><span class="ab-glyph">${d.glyph}</span><span class="ab-name">${d.name}</span><span class="ab-sub"></span>`;
    b.addEventListener('click', () => { if (game.cast(i)) refresh(true); });
    abs.appendChild(b);
    abEls[k] = { b, cd: b.querySelector('.cd'), sub: b.querySelector('.ab-sub') };
  });
  document.body.classList.toggle('daeva', key === 'daeva');
  document.body.dataset.char = key;
}
const charEls = {};
function buildChars() {
  const list = $('char-list');
  for (const [key, c] of Object.entries(CHARS)) {
    const el = document.createElement('div'); el.className = 'char-card'; el.dataset.char = key;
    el.style.setProperty('--c-accent', c.accent);
    el.innerHTML = `<div class="ch-portrait" style="background-image:url(${c.portrait})" role="img" aria-label="${c.name} portrait"></div>
      <div class="ch-head"><span class="ch-name">${c.name}</span><span class="ch-title">${c.title}</span></div>
      <p class="ch-lore">${c.lore}</p>
      <ul class="ch-abs">${Object.values(c.abs).map((a) => `<li><span class="g">${a.glyph}</span><span><b>${a.name}</b><span class="d">${a.desc}</span> <span class="d ab-u"></span></span></li>`).join('')}</ul>
      <button class="ch-btn"></button>`;
    el.querySelector('.ch-btn').addEventListener('click', () => selectChar(key));
    list.appendChild(el);
    charEls[key] = { el, btn: el.querySelector('.ch-btn'), us: [...el.querySelectorAll('.ab-u')] };
  }
}
function selectChar(key) {
  const def = ui && ui.chars.find((c) => c.key === key);
  if (!def || !def.unlocked || ui.char === key) return;
  if (game.set_char(def.id)) {
    refresh(true); save();
    toast(`${CHARS[key].name} steps into the circle.`);
  }
}
function refreshChars() {
  for (const c of ui.chars) {
    const el = charEls[c.key]; if (!el) continue;
    const sel = ui.char === c.key;
    el.el.classList.toggle('selected', sel); el.el.classList.toggle('locked', !c.unlocked);
    el.btn.disabled = !c.unlocked || sel;
    el.btn.textContent = !c.unlocked ? `Locked · reach wave ${c.unlock}` : sel ? 'Fighting' : 'Choose ' + CHARS[c.key].name;
    c.abs.forEach((a, i) => { if (el.us[i]) el.us[i].textContent = `(wave ${a.unlock}, ${Math.round(a.cd)}s cd)`; });
  }
}

// ------------------------------------------------------------ UI refresh
let lastRefresh = 0;
function refresh(force) {
  const now = performance.now();
  if (!force && now - lastRefresh < 220) return;
  lastRefresh = now;
  ui = JSON.parse(game.ui(prefs.buy));
  buildAbilities(ui.char);
  $('souls').textContent = fmt(ui.souls);
  $('sps').textContent = ui.sps > 0 ? '+' + fmt(ui.sps) + '/s' : '';
  $('beads').textContent = fmt(ui.beads);
  $('wave-label').textContent = `— Wave ${ui.wave}${ui.wave % 10 === 0 ? ' · Boss' : ''} —`;
  const ab = $('auto-btn'); ab.classList.toggle('on', ui.auto); ab.setAttribute('aria-pressed', ui.auto); ab.textContent = ui.auto ? 'Auto ▸' : 'Farm ↻';
  $('opt-autocast').checked = ui.autocast;

  const tab = document.querySelector('.tab.active').dataset.tab;
  if (tab === 'up' || force) {
    for (const u of ui.ups) {
      const el = upEls[u.key], d = UPS[u.key];
      el.lvl.textContent = 'Lv ' + u.lvl + (u.max ? ' / ' + u.max : '');
      el.val.innerHTML = u.maxed ? d.f(u.now) + ' <span class="arrow">· mastered</span>' : `${d.f(u.now)} <span class="arrow">→</span> ${d.f(u.next)}`;
      el.btn.disabled = !u.afford;
      el.btn.classList.toggle('maxed', u.maxed);
      el.n.textContent = u.maxed ? '' : '+' + u.n + (u.n === 1 ? ' lv' : ' lvs');
      el.cost.textContent = u.maxed ? 'MAX' : fmt(u.cost);
    }
  }
  if (tab === 'rebirth' || force) {
    $('reb-wave').textContent = ui.maxWave;
    $('reb-gain').textContent = fmt(ui.rebirthBeads);
    $('reb-life').textContent = fmt(ui.beadsLife);
    $('rebirth-btn').disabled = ui.rebirthBeads <= 0;
    $('reb-note').textContent = ui.rebirthBeads > 0
      ? 'Higher waves string more beads. Each lifetime bead adds +4% damage and +2% souls, forever.'
      : `Reach wave 30 to be reborn (best this life: ${ui.maxWave}). Each lifetime bead adds +4% damage and +2% souls, forever.`;
    for (const s of ui.shop) {
      const el = shopEls[s.key];
      el.lvl.textContent = 'Lv ' + s.lvl + (s.max ? ' / ' + s.max : '');
      el.btn.disabled = !s.afford;
      el.cost.textContent = s.maxed ? 'MAX' : fmt(s.cost);
    }
  }
  if (tab === 'chars' || force) refreshChars();
  if (tab === 'scroll' || force) {
    const rows = [
      ['Damage', fmt(ui.dmg)], ['Attack speed', ui.aps.toFixed(2) + '/s'], ['Reach', Math.round(ui.range * 100)],
      ['Crit chance', Math.round(ui.crit * 100) + '%'], ['Crit damage', '×' + ui.critMult.toFixed(2)], ['Foes per swing', ui.targets],
      ['Health', fmt(ui.hp) + ' / ' + fmt(ui.maxHp)], ['Regen', fmt(ui.regen) + '/s'], ['Soul multiplier', '×' + fmt(ui.soulMult)],
      ['Lifesteal', (ui.siphon * 100).toFixed(1) + '%'], ['Bead damage bonus', '×' + fmt(ui.beadDmg)],
      ['Offline', Math.round(ui.offlineEff * 100) + '% for up to ' + Math.round(ui.offlineCap / 3600) + 'h'],
      ['Best wave ever', ui.bestWave], ['Foes slain', fmt(ui.kills)], ['Souls reaped', fmt(ui.totalSouls)],
      ['Rebirths', ui.rebirths], ['Time fighting', dur(ui.playTime)],
    ];
    $('stats-label').textContent = `— ${(CHARS[ui.char] || CHARS.asura).name} Stats —`;
    $('stat-list').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
  updateAbilities();
}
function updateAbilities() {
  ui.abs.forEach((a) => {
    const el = abEls[a.key]; if (!el) return;
    el.b.classList.toggle('locked', !a.unlocked);
    el.b.disabled = !a.unlocked;
    const ready = a.unlocked && a.cd <= 0;
    el.b.classList.toggle('ready', ready && a.active <= 0);
    el.b.classList.toggle('active', a.active > 0);
    el.cd.style.setProperty('--p', a.unlocked && a.cd > 0 ? (a.cd / a.cdMax) * 100 + '%' : '0%');
    el.sub.textContent = !a.unlocked ? 'wave ' + a.unlock : a.active > 0 ? Math.ceil(a.active) + 's' : a.cd > 0 ? Math.ceil(a.cd) + 's' : ABS[a.key].sub;
  });
}

// ------------------------------------------------------------ events from the core
function onEvents(ev) {
  for (let i = 0; i < ev.length; i += 6) {
    const t = ev[i], a = ev[i + 3];
    if (t === 7) { // wave cleared
      if (a % 10 === 0) banner('Wave ' + a + ' broken', ui && ui.auto ? 'onward' : 'holding ground', true);
    } else if (t === 8) {
      banner('Fallen', `retreat to wave ${Math.max(1, a - 1)} · auto paused`, true);
      toast('Defeated at wave ' + a + '. Upgrade, then tap Farm to push again.');
      refresh(true);
    } else if (t === 9) {
      banner(BOSSES[a] || 'Boss', 'approaches', true);
    } else if (t === 11 && a === 1 && ev[i + 4] === 0) {
      banner('I am the storm', '', false);
    } else if (t === 14) { // a character unlocked
      const c = ui && ui.chars ? ui.chars.find((x) => x.id === a) : null, d = c && CHARS[c.key];
      if (d) { banner(d.name + ' awakens', 'choose her in Characters', true); toast(`${d.name} unlocked. Open the Characters tab to fight as her.`); }
      refresh(true);
    } else if (t === 15) {
      refresh(true);
    }
  }
}

// ------------------------------------------------------------ sound effects
const CAST_SFX = [['wrath', 'storm', 'beads', 'sixarms'], ['tide', 'rain', 'whirlpool', 'lotus']];
function nearBoss(x, y) {
  const en = game.enemies();
  for (let o = 0; o < en.length; o += 11) if (en[o + 9] > 0 && Math.abs(en[o + 2] - x) < 0.12 && Math.abs(en[o + 3] - y) < 0.12) return true;
  return false;
}
// which body part is landing: the painted pose the fighter is in right now
const KICKS = new Set(['roundhouse', 'crescent', 'tornado', 'sweep', 'hook', 'slam']);
function strikeKind() {
  const p = renderer.anim && renderer.anim.pose;
  const name = p && (p.next && p.mix > 0.5 ? p.next : p.pose);
  return name && KICKS.has(name) ? 1 : name === 'palm' ? 2 : 0;
}
function sounds(ev) {
  if (!sfx.state.on) return;
  for (let i = 0; i < ev.length; i += 6) {
    const t = ev[i], x = ev[i + 1], y = ev[i + 2], a = ev[i + 3], b = ev[i + 4], c = ev[i + 5];
    switch (t) {
      case 1: // hit: kind c 0 basic, 1 cleave, 2 Wrath, 3 rain drop, 4 whirlpool grind, 5 lotus bead
        if (c === 3) sfx.play('drop');
        else if (c === 4 || c === 5) sfx.play('hit', { v: 2 }, 0.45);
        else if (b) sfx.play('crit');
        else if (c !== 2) { if (nearBoss(x, y)) sfx.play('bossHit'); else sfx.play('hit', { v: strikeKind() }); }
        break;
      case 2: sfx.play(c ? 'bossDeath' : 'death'); break;
      case 3: sfx.play('whoosh'); break;
      case 5: sfx.play('zap'); break;
      case 7: if (a % 10 !== 0) sfx.play('waveClear'); break;
      case 8: sfx.play('defeat'); break;
      case 9: sfx.play('bossAppear'); break;
      case 10: sfx.play('heal'); break;
      case 11: { const n = (CAST_SFX[b | 0] || CAST_SFX[0])[a | 0]; if (n) sfx.play(n); break; }
      case 14: sfx.play('unlock'); break;
    }
  }
}

// ------------------------------------------------------------ main loop
let last = performance.now(), lastSaveT = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 30) {
    awayReport(dt, true);
  } else {
    while (dt > 0) { const s = Math.min(dt, 0.25); game.tick(s); dt -= s; }
  }
  const ev = game.drain_events();
  if (ev.length) { renderer.handle(ev); onEvents(ev); sounds(ev); }
  const f = game.frame();
  music.setWave(f[4] | 0);
  renderer.draw(f, game.enemies(), Math.min((now - (frame.prev || now)) / 1000, 0.1));
  frame.prev = now;
  $('hp-fill').style.width = (f[0] * 100).toFixed(1) + '%';
  $('hp-text').textContent = fmt(f[13]) + ' / ' + fmt(f[14]);
  $('wave-fill').style.width = (f[6] ? (f[5] / f[6]) * 100 : 0).toFixed(1) + '%';
  refresh(false);
  if (now - lastSaveT > AUTOSAVE_MS) { save(); lastSaveT = now; }
  requestAnimationFrame(frame);
}

function awayReport(seconds, resumed) {
  const r = JSON.parse(game.apply_offline(seconds));
  save();
  refresh(true);
  if (r.souls <= 0 && r.kills <= 0) return;
  if (seconds < 300 && resumed) { toast(`Away ${dur(seconds)}: +${fmt(r.souls)} souls`); return; }
  modal('While You Were Away', `
    <p class="center">For ${dur(r.seconds)} your Asura held wave ${r.wave} alone.</p>
    <div class="away-big">+${fmt(r.souls)} souls</div>
    <p class="center">${fmt(r.kills)} foes cut down.</p>
    <p class="note center">Offline gains run at ${Math.round(r.eff * 100)}% for up to ${Math.round(r.cap / 3600)}h${r.capped ? ' (capped, you were gone longer)' : ''}. Raise both with Meditation in the shrine.</p>`,
    [{ label: 'Return to battle', cls: 'primary', value: 'ok' }]);
}


// ------------------------------------------------------------ installable app (PWA)
let deferredPrompt = null, refreshing = false;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function updateInstallUI() {
  const chip = $('install-chip'), btn = $('install-btn'), hint = $('ios-hint'), status = $('app-status');
  if (isStandalone()) {
    chip.hidden = true; btn.hidden = true; hint.hidden = true;
    status.textContent = 'Running as an installed app. It works offline, and your save stays on this device.';
    return;
  }
  const ios = isIOS() && !deferredPrompt;
  chip.hidden = !(deferredPrompt || ios);
  btn.hidden = !deferredPrompt;
  hint.hidden = !ios;
}
async function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredPrompt = null; updateInstallUI();
    if (outcome === 'accepted') toast('Installing Asura…');
  } else if (isIOS()) {
    modal('Add to Home Screen', `<p>In Safari, tap <b>Share</b> <span aria-hidden="true">⬆︎</span>, then <b>Add to Home Screen</b>.</p><p class="note">Asura then opens full-screen and plays offline. Your save stays on this device.</p>`,
      [{ label: 'Got it', cls: 'primary', value: 'ok' }]);
  }
}
function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; updateInstallUI(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; updateInstallUI(); toast('Asura installed. Find it on your home screen.'); });
  $('install-chip').addEventListener('click', promptInstall);
  $('install-btn').addEventListener('click', promptInstall);
  $('app-version').textContent = 'v' + APP_VERSION + '.';
  updateInstallUI();
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) location.reload(); });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    const offer = (w) => {
      if (!w || !navigator.serviceWorker.controller) return; // first install: nothing to update
      const pill = $('update-pill');
      pill.hidden = false;
      pill.onclick = () => { save(); refreshing = true; pill.textContent = 'Updating…'; w.postMessage({ type: 'SKIP_WAITING' }); };
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('service worker registration failed', e));
}

async function main() {
  try {
    await init();
  } catch (e) {
    const l = $('loading'); l.classList.add('err'); l.textContent = 'This browser could not start WebAssembly. Try a recent Chrome, Firefox or Safari.';
    throw e;
  }
  game = new Game(Math.floor(Math.random() * 2 ** 31));
  renderer = createRenderer($('arena'));
  music = createMusic({ enabled: prefs.music, volume: prefs.vol });
  sfx = createSfx({ enabled: prefs.sfx, volume: prefs.sfxVol });
  renderer.setReduced(prefs.fx); renderer.setNumbers(prefs.nums);
  buildUI();
  setupPWA();

  const raw = localStorage.getItem(SAVE_KEY);
  let loaded = false;
  if (raw) {
    loaded = game.load_json(raw);
    if (!loaded) { try { localStorage.setItem(SAVE_KEY + '-corrupt', raw); } catch {} toast('Save was unreadable; starting fresh (backup kept).'); }
  }
  await document.fonts.ready.catch(() => {});
  renderer.resize();
  new ResizeObserver(() => renderer.resize()).observe($('arena-box'));
  $('loading').remove();
  refresh(true);

  if (loaded && game.last_save() > 0) {
    const gap = (Date.now() - game.last_save()) / 1000;
    if (gap > 60) awayReport(gap, false);
  } else if (!prefs.intro) {
    prefs.intro = true; savePrefs();
    modal('Wrath Incarnate', `
      <p>You are the <b>Asura</b>. Ninja, samurai, oni, tengu and worse come for you from <b>every direction</b>.</p>
      <p>You fight on your own. Spend <b>souls</b> on Wrath, Fury, Reach and more. Bosses rise every 10 waves.</p>
      <p>At wave 30, be <b class="red">reborn</b> for red prayer beads that make every life stronger.</p>
      <p class="note">Progress saves in this browser, and you keep earning while away.</p>`,
      [{ label: 'I am the storm', cls: 'primary', value: 'ok' }]);
  }
  save();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
    else { last = performance.now(); const gap = (Date.now() - game.last_save()) / 1000; if (gap > 30) awayReport(gap, true); }
  });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);

  // test/debug handle (no effect on play)
  window.__asura = { game, save, refresh, SAVE_KEY, get renderer() { return renderer; }, get music() { return music; }, get sfx() { return sfx; } };
  requestAnimationFrame((t) => { last = t; frame.prev = t; frame(t); });
}

main();
