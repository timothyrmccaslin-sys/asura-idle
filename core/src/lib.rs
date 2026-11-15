//! Asura Idle — core simulation.
//!
//! Everything that decides the outcome of the game lives here: state, wave
//! spawning (360° around the centred Asura), combat, upgrades, abilities,
//! prestige (Rebirth / prayer beads), offline progress and save
//! serialisation. The JS layer only renders, reads input and talks to
//! localStorage.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

mod b64;

// ---------------------------------------------------------------- constants

pub const SAVE_VERSION: u32 = 1;
const SPAWN_RADIUS: f64 = 1.2;
/// Half-width of the keep-clear cones on the screen's vertical axis (15° total
/// each): +y points toward the camera (bottom of the screen), -y away (top).
/// Nothing spawns or approaches inside them, so foes never stand in front of
/// the Asura, and he never hides a foe coming down from the top.
const CONE_HALF: f64 = 7.5 * std::f64::consts::PI / 180.0;
/// Below this distance foes are in the melee crush and may drift anywhere.
const CONE_FREE_R: f64 = 0.35;

/// Uniform angle over the allowed arcs (everything outside the two cones).
fn spawn_angle(u: f64) -> f64 {
    use std::f64::consts::PI;
    let arc = PI - 2.0 * CONE_HALF; // each side: right half and left half
    let t = u * 2.0 * arc;
    if t < arc { -PI / 2.0 + CONE_HALF + t } else { PI / 2.0 + CONE_HALF + (t - arc) }
}
/// Angular distance (radians) from the vertical axis, 0..PI/2.
fn off_axis(x: f64, y: f64) -> f64 {
    let a = y.atan2(x).abs(); // 0..PI
    (a - std::f64::consts::FRAC_PI_2).abs()
}
/// Rotate a point out of a cone to its nearest edge, keeping its distance.
fn clear_cone(x: f64, y: f64) -> (f64, f64) {
    use std::f64::consts::FRAC_PI_2;
    if off_axis(x, y) >= CONE_HALF { return (x, y); }
    let d = (x * x + y * y).sqrt();
    let side = if x >= 0.0 { 1.0 } else { -1.0 };
    let up = if y >= 0.0 { 1.0 } else { -1.0 };
    let a = up * (FRAC_PI_2 - CONE_HALF * 1.0001);
    let a = if side > 0.0 { a } else { up * std::f64::consts::PI - a };
    (d * a.cos(), d * a.sin())
}
const ASURA_RADIUS: f64 = 0.075;
pub const N_UP: usize = 12;
pub const N_SHOP: usize = 10;
pub const N_AB: usize = 4;
const ENEMY_STRIDE: usize = 11;
const EVENT_STRIDE: usize = 6;
const MAX_ENEMIES: usize = 80;

// event types (JS mirrors these)
pub const EV_HIT: f64 = 1.0;
pub const EV_KILL: f64 = 2.0;
pub const EV_ATTACK: f64 = 3.0;
pub const EV_WRATH: f64 = 4.0;
pub const EV_CHAIN: f64 = 5.0;
pub const EV_HURT: f64 = 6.0;
pub const EV_WAVE: f64 = 7.0;
pub const EV_DEFEAT: f64 = 8.0;
pub const EV_BOSS: f64 = 9.0;
pub const EV_HEAL: f64 = 10.0;
pub const EV_CAST: f64 = 11.0;
pub const EV_TIDE: f64 = 12.0; // Daeva Tidal Surge: a = radius
pub const EV_DROP: f64 = 13.0; // Healing Rain droplet strike at (x, y)
pub const EV_UNLOCK: f64 = 14.0; // a = character id newly unlocked
pub const EV_SWITCH: f64 = 15.0; // a = character id now active
pub const EV_POOL: f64 = 16.0; // Whirlpool opened at (x, y), a = radius
pub const EV_FREEZE: f64 = 17.0; // a foe at (x, y) frozen for a seconds; b = 1 for a boss
pub const EV_FLAME: f64 = 18.0; // Flame Wave rolls out to radius a
pub const EV_BOLT: f64 = 19.0; // Arcane Bolt number a flies to the foe at (x, y)
pub const EV_HELL: f64 = 20.0; // Frozen Hell: a = radius of the frost, b = duration
pub const EV_SHATTER: f64 = 21.0; // a frozen foe's ice shattered at (x, y)
pub const EV_ARC: f64 = 22.0; // Chain Lightning hop a: from (b, c) to the foe at (x, y)

struct UpDef {
    key: &'static str,
    base: f64,
    growth: f64,
    max: u32, // 0 = unlimited
}

const UPS: [UpDef; N_UP] = [
    UpDef { key: "damage", base: 8.0, growth: 1.15, max: 0 },
    UpDef { key: "speed", base: 20.0, growth: 1.19, max: 60 },
    UpDef { key: "range", base: 45.0, growth: 1.30, max: 30 },
    UpDef { key: "crit", base: 100.0, growth: 1.24, max: 45 },
    UpDef { key: "critdmg", base: 150.0, growth: 1.20, max: 0 },
    UpDef { key: "cleave", base: 400.0, growth: 3.4, max: 9 },
    UpDef { key: "vitality", base: 15.0, growth: 1.16, max: 0 },
    UpDef { key: "regen", base: 40.0, growth: 1.18, max: 0 },
    UpDef { key: "greed", base: 60.0, growth: 1.21, max: 0 },
    UpDef { key: "siphon", base: 300.0, growth: 1.6, max: 20 },
    // Sorcerer only (shown in the list while he is active; levels persist)
    UpDef { key: "manapool", base: 500.0, growth: 1.24, max: 50 },
    UpDef { key: "manaregen", base: 750.0, growth: 1.26, max: 50 },
];
pub const UP_MANAPOOL: usize = 10;
pub const UP_MANAREGEN: usize = 11;

struct ShopDef {
    key: &'static str,
    base: f64,
    growth: f64,
    max: u32,
}

const SHOP: [ShopDef; N_SHOP] = [
    ShopDef { key: "wrathMala", base: 1.0, growth: 1.5, max: 0 },
    ShopDef { key: "goldMala", base: 1.0, growth: 1.5, max: 0 },
    ShopDef { key: "ironBody", base: 2.0, growth: 1.5, max: 0 },
    ShopDef { key: "swiftMala", base: 3.0, growth: 1.7, max: 15 },
    ShopDef { key: "karmicLeap", base: 4.0, growth: 1.8, max: 15 },
    ShopDef { key: "meditation", base: 2.0, growth: 1.7, max: 8 },
    ShopDef { key: "tempestHeart", base: 4.0, growth: 1.9, max: 8 },
    ShopDef { key: "deepWell", base: 3.0, growth: 1.6, max: 20 },     // +15% max mana
    ShopDef { key: "risingTide", base: 3.0, growth: 1.6, max: 20 },   // +15% mana per strike
    ShopDef { key: "abilityPower", base: 4.0, growth: 1.7, max: 0 },  // +10% ability strength, all characters
];
pub const SHOP_MANAPOOL: usize = 7;
pub const SHOP_MANAREGEN: usize = 8;
pub const SHOP_ABILITY: usize = 9;

struct AbDef {
    key: &'static str,
    unlock: u32,
    cd: f64,
    dur: f64,
    cost: f64, // mana cost (Sorcerer); 0 = cooldown ability
}

// ---------------------------------------------------------------- characters
// Data-driven roster: each main character has a key, a first-unlock wave and
// four abilities. Progress (wave, souls, upgrades, beads, rebirth) is shared;
// the active character changes visuals, attack style and abilities.
struct CharDef {
    key: &'static str,
    unlock: u32,
    dmg: f64,   // basic-attack damage multiplier
    regen: f64, // regen multiplier
    aspd: f64,  // attack-speed multiplier
    abs: [AbDef; N_AB],
}
pub const N_CHARS: usize = 3;
pub const CH_ASURA: u32 = 0;
pub const CH_DAEVA: u32 = 1;
pub const CH_SORC: u32 = 2;
/// Sorcerer: a short global lockout after any cast stops accidental double taps
const SORC_GCD: f64 = 0.4;
/// his hand bursts splash this share of the hit onto foes packed around the target
const BURST_SPLASH: f64 = 0.30;
const BURST_R: f64 = 0.12;
/// Arcane Bolts: three bolts at the furthest foes, this many strikes' worth each
const BOLT_MULT: f64 = 3.0;
/// Flame Wave: a token singe; its worth is the shove back to the spawn edge
const FLAME_MULT: f64 = 0.3;
/// Chain Lightning: 120% of a strike on the first foe, each jump 40% weaker (x0.6), up to 5 foes
const CHAIN_FIRST: f64 = 1.2;
const CHAIN_FALLOFF: f64 = 0.6;
const CHAIN_MAX: usize = 5;
const CHAIN_JUMP: f64 = 0.6; // furthest a bolt will leap to the next foe
const CHAIN_STUN: f64 = 0.5;
/// Frozen Hell: every foe on the field held in ice for 3 s (bosses half as long);
/// the ice shatters for damage as it lets go, and thawed foes resist fresh ice briefly
const HELL_FREEZE: f64 = 3.0;
const HELL_CAST_MULT: f64 = 0.5;
const HELL_SHATTER_MULT: f64 = 2.0;
const THAW_GRACE: f64 = 1.5;
const CHARS: [CharDef; N_CHARS] = [
    CharDef {
        key: "asura", unlock: 0, dmg: 1.0, regen: 1.0, aspd: 1.0,
        abs: [
            AbDef { key: "wrath", unlock: 5, cd: 30.0, dur: 0.0, cost: 0.0 },
            AbDef { key: "storm", unlock: 15, cd: 60.0, dur: 8.0, cost: 0.0 },
            AbDef { key: "beads", unlock: 25, cd: 90.0, dur: 15.0, cost: 0.0 },
            AbDef { key: "sixarms", unlock: 40, cd: 120.0, dur: 10.0, cost: 0.0 },
        ],
    },
    // Daeva: trades some burst for sustain and control
    CharDef {
        key: "daeva", unlock: 50, dmg: 0.85, regen: 1.6, aspd: 1.0,
        abs: [
            AbDef { key: "tide", unlock: 5, cd: 30.0, dur: 0.0, cost: 0.0 },
            AbDef { key: "rain", unlock: 15, cd: 60.0, dur: 10.0, cost: 0.0 },
            AbDef { key: "whirlpool", unlock: 25, cd: 75.0, dur: 8.0, cost: 0.0 },
            AbDef { key: "lotus", unlock: 40, cd: 100.0, dur: 12.0, cost: 0.0 },
        ],
    },
    // Sorcerer: close-range hand bursts that splash; arcane, flame, lightning and ice spells cost mana
    // (refilled by his strikes) instead of running on cooldowns
    CharDef {
        key: "sorcerer", unlock: 100, dmg: 1.0, regen: 1.0, aspd: 0.92,
        abs: [
            AbDef { key: "bolts", unlock: 5, cd: 0.0, dur: 0.0, cost: 25.0 },
            AbDef { key: "flame", unlock: 15, cd: 0.0, dur: 0.0, cost: 35.0 },
            AbDef { key: "chain", unlock: 25, cd: 0.0, dur: 0.0, cost: 20.0 },
            AbDef { key: "hell", unlock: 40, cd: 0.0, dur: 3.0, cost: 80.0 },
        ],
    },
];


#[derive(Clone, Copy)]
struct Kind {
    hp: f64,
    speed: f64,
    dmg: f64,
    gold: f64,
    size: f64,
    unlock: u32,
}

// 0 ashigaru 1 ninja 2 kappa 3 ronin 4 samurai 5 tengu 6 yurei 7 oni
// 8 oni warlord 9 tengu king 10 shogun 11 orochi 12 onryo queen
const KINDS: [Kind; 13] = [
    Kind { hp: 1.0, speed: 0.17, dmg: 1.0, gold: 1.0, size: 0.15, unlock: 1 },
    Kind { hp: 0.6, speed: 0.30, dmg: 0.8, gold: 0.9, size: 0.14, unlock: 1 },
    Kind { hp: 1.3, speed: 0.15, dmg: 1.0, gold: 1.2, size: 0.13, unlock: 3 },
    Kind { hp: 1.6, speed: 0.20, dmg: 1.5, gold: 1.5, size: 0.155, unlock: 5 },
    Kind { hp: 2.6, speed: 0.15, dmg: 2.0, gold: 2.2, size: 0.165, unlock: 8 },
    Kind { hp: 1.2, speed: 0.27, dmg: 1.2, gold: 1.8, size: 0.15, unlock: 12 },
    Kind { hp: 1.5, speed: 0.12, dmg: 1.8, gold: 2.0, size: 0.155, unlock: 16 },
    Kind { hp: 5.0, speed: 0.11, dmg: 3.0, gold: 4.0, size: 0.21, unlock: 20 },
    Kind { hp: 14.0, speed: 0.08, dmg: 6.0, gold: 16.0, size: 0.34, unlock: 0 },
    Kind { hp: 12.0, speed: 0.10, dmg: 6.0, gold: 16.0, size: 0.32, unlock: 0 },
    Kind { hp: 15.0, speed: 0.08, dmg: 7.0, gold: 18.0, size: 0.34, unlock: 0 },
    Kind { hp: 17.0, speed: 0.07, dmg: 7.0, gold: 20.0, size: 0.38, unlock: 0 },
    Kind { hp: 13.0, speed: 0.09, dmg: 8.0, gold: 18.0, size: 0.32, unlock: 0 },
];

// ---------------------------------------------------------------- helpers

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        ((x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

fn geo_sum(base: f64, growth: f64, from: u32, n: u32) -> f64 {
    // cost of levels from..from+n
    if n == 0 {
        return 0.0;
    }
    let first = base * growth.powi(from as i32);
    first * (growth.powi(n as i32) - 1.0) / (growth - 1.0)
}

// ---------------------------------------------------------------- state

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Save {
    pub v: u32,
    pub souls: f64,
    pub beads: f64,
    pub beads_life: f64,
    pub wave: u32,
    pub max_wave: u32,
    pub best_wave: u32,
    pub auto: bool,
    pub autocast: bool,
    pub up: Vec<u32>,
    pub shop: Vec<u32>,
    pub cds: Vec<f64>,
    pub kills: f64,
    pub total_souls: f64,
    pub run_souls: f64,
    pub rebirths: u32,
    pub play_time: f64,
    pub rate_sps: f64,
    pub rate_kps: f64,
    pub rate_wave: u32,
    pub last_save: f64,
    pub created: f64,
    /// active main character (0 Asura, 1 Daeva); old saves default to the Asura
    pub ch: u32,
    /// bitmask of unlocked characters (bit 0 = Asura, always set)
    pub unlocked: u32,
}

impl Default for Save {
    fn default() -> Self {
        Save {
            v: SAVE_VERSION,
            souls: 0.0,
            beads: 0.0,
            beads_life: 0.0,
            wave: 1,
            max_wave: 1,
            best_wave: 1,
            auto: true,
            autocast: false,
            up: vec![0; N_UP],
            shop: vec![0; N_SHOP],
            cds: vec![0.0; N_AB],
            kills: 0.0,
            total_souls: 0.0,
            run_souls: 0.0,
            rebirths: 0,
            play_time: 0.0,
            rate_sps: 0.0,
            rate_kps: 0.0,
            rate_wave: 0,
            last_save: 0.0,
            created: 0.0,
            ch: 0,
            unlocked: 1,
        }
    }
}

impl Save {
    fn sanitize(&mut self) {
        self.up.resize(N_UP, 0);
        self.shop.resize(N_SHOP, 0);
        self.cds.resize(N_AB, 0.0);
        for (i, d) in UPS.iter().enumerate() {
            if d.max > 0 && self.up[i] > d.max {
                self.up[i] = d.max;
            }
        }
        for (i, d) in SHOP.iter().enumerate() {
            if d.max > 0 && self.shop[i] > d.max {
                self.shop[i] = d.max;
            }
        }
        let fix = |x: &mut f64| {
            if !x.is_finite() || *x < 0.0 {
                *x = 0.0;
            }
        };
        fix(&mut self.souls);
        fix(&mut self.beads);
        fix(&mut self.beads_life);
        fix(&mut self.kills);
        fix(&mut self.total_souls);
        fix(&mut self.run_souls);
        fix(&mut self.play_time);
        fix(&mut self.rate_sps);
        fix(&mut self.rate_kps);
        for c in self.cds.iter_mut() {
            fix(c);
        }
        self.wave = self.wave.max(1);
        self.max_wave = self.max_wave.max(self.wave);
        self.best_wave = self.best_wave.max(self.max_wave);
        self.unlocked |= 1;
        for (i, c) in CHARS.iter().enumerate() {
            if self.best_wave >= c.unlock { self.unlocked |= 1 << i; }
        }
        if self.ch as usize >= N_CHARS || self.unlocked & (1 << self.ch) == 0 { self.ch = 0; }
        self.v = SAVE_VERSION;
    }
}

#[derive(Clone)]
struct Enemy {
    id: u32,
    kind: usize,
    boss: bool,
    x: f64,
    y: f64,
    hp: f64,
    max_hp: f64,
    speed: f64,
    dmg: f64,
    gold: f64,
    size: f64,
    atk_timer: f64,
    age: f64,
    flash: f64,
    phase: f64,
    slow: f64,
    frozen: f64, // seconds left encased in ice: no movement, no attacks
    stun: f64,   // seconds left paralyzed by lightning: no movement, no attacks
    shatter: f64, // damage dealt when the ice lets go (Frozen Hell)
    thaw: f64,   // seconds of resistance to fresh ice after thawing
}

#[wasm_bindgen]
pub struct Game {
    s: Save,
    rng: Rng,
    enemies: Vec<Enemy>,
    next_id: u32,
    hp: f64,
    atk_timer: f64,
    atk_anim: f64,
    face: f64,
    to_spawn: u32,
    spawn_timer: f64,
    wave_total: u32,
    wave_killed: u32,
    boss_pending: bool,
    active: [f64; N_AB],
    events: Vec<f64>,
    // rolling measurement of income for offline progress
    win_t: f64,
    win_souls: f64,
    win_kills: f64,
    wave_intro: f64,
    // Daeva ability state
    pool: (f64, f64),
    pool_r: f64,
    rain_acc: f64,
    pool_acc: f64,
    lotus_acc: f64,
    // Sorcerer state
    mana: f64,
    gcd: f64,
    auto_lock: f64,
    zero_r: f64,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: f64) -> Game {
        let mut g = Game {
            s: Save::default(),
            rng: Rng((seed as u64) ^ 0x9E37_79B9_7F4A_7C15 | 1),
            enemies: Vec::new(),
            next_id: 1,
            hp: 0.0,
            atk_timer: 0.0,
            atk_anim: 0.0,
            face: 1.0,
            to_spawn: 0,
            spawn_timer: 0.0,
            wave_total: 0,
            wave_killed: 0,
            boss_pending: false,
            active: [0.0; N_AB],
            events: Vec::new(),
            win_t: 0.0,
            win_souls: 0.0,
            win_kills: 0.0,
            wave_intro: 0.0,
            pool: (0.0, 0.0),
            pool_r: 0.0,
            rain_acc: 0.0,
            pool_acc: 0.0,
            lotus_acc: 0.0,
            mana: 0.0,
            gcd: 0.0,
            auto_lock: 0.0,
            zero_r: 0.0,
        };
        g.hp = g.max_hp();
        g.mana = g.max_mana();
        g.start_wave();
        g
    }

    // ------------------------------------------------------------ stats

    fn bead_dmg_mult(&self) -> f64 {
        (1.0 + 0.04 * self.s.beads_life) * (1.0 + 0.5 * self.s.shop[0] as f64)
    }
    fn soul_mult(&self) -> f64 {
        let l = self.s.up[8] as f64;
        let mut m = (1.0 + 0.2 * l) * 1.01f64.powf(l);
        m *= (1.0 + 0.02 * self.s.beads_life) * (1.0 + 0.35 * self.s.shop[1] as f64);
        if self.asura() && self.active[2] > 0.0 {
            m *= 2.0;
        }
        m
    }
    pub fn damage(&self) -> f64 {
        let l = self.s.up[0] as f64;
        let mut d = 5.0 * (1.0 + l) * 1.07f64.powf(l) * 2f64.powi((self.s.up[0] / 25) as i32);
        d *= self.bead_dmg_mult() * CHARS[self.s.ch as usize].dmg;
        if self.asura() && self.active[3] > 0.0 {
            d *= 2.0;
        }
        d
    }
    pub fn attack_speed(&self) -> f64 {
        let mut a = (1.0 + 0.075 * self.s.up[1] as f64) * (1.0 + 0.06 * self.s.shop[3] as f64) * CHARS[self.s.ch as usize].aspd;
        if self.asura() && self.active[1] > 0.0 {
            a *= 2.5;
        }
        a
    }
    pub fn range(&self) -> f64 {
        0.4 + 0.012 * self.s.up[2] as f64
    }
    pub fn crit_chance(&self) -> f64 {
        0.05 + 0.01 * self.s.up[3] as f64
    }
    pub fn crit_mult(&self) -> f64 {
        2.0 + 0.15 * self.s.up[4] as f64
    }
    pub fn targets(&self) -> u32 {
        1 + self.s.up[5] + if self.asura() && self.active[3] > 0.0 { 5 } else { 0 }
    }
    pub fn max_hp(&self) -> f64 {
        let l = self.s.up[6] as f64;
        100.0 * (1.0 + 0.15 * l) * 1.1f64.powf(l) * (1.0 + 0.5 * self.s.shop[2] as f64)
    }
    pub fn regen(&self) -> f64 {
        let frac = (0.005 + 0.001 * self.s.up[7] as f64).min(0.03);
        self.max_hp() * frac * CHARS[self.s.ch as usize].regen
    }
    pub fn siphon(&self) -> f64 {
        0.005 * self.s.up[9] as f64
    }
    /// Sorcerer mana pool: 100, +12% per Mana Pool level, +15% per Deep Well bead level
    pub fn max_mana(&self) -> f64 {
        100.0 * (1.0 + 0.12 * self.s.up[UP_MANAPOOL] as f64) * (1.0 + 0.15 * self.s.shop[SHOP_MANAPOOL] as f64)
    }
    /// mana refilled by each normal strike (once per swing, however many foes it hits)
    pub fn mana_per_strike(&self) -> f64 {
        6.0 * (1.0 + 0.12 * self.s.up[UP_MANAREGEN] as f64) * (1.0 + 0.15 * self.s.shop[SHOP_MANAREGEN] as f64)
    }
    /// Ability Power (rebirth): +10% damage and healing from every character's abilities
    pub fn ability_power(&self) -> f64 {
        1.0 + 0.1 * self.s.shop[SHOP_ABILITY] as f64
    }
    /// ...and a little longer freezes (+3% per level, capped at +75%)
    fn freeze_mult(&self) -> f64 {
        1.0 + 0.03 * (self.s.shop[SHOP_ABILITY].min(25)) as f64
    }
    fn sorc(&self) -> bool {
        self.s.ch == CH_SORC
    }
    fn asura(&self) -> bool {
        self.s.ch == CH_ASURA
    }
    fn daeva(&self) -> bool {
        self.s.ch == CH_DAEVA
    }
    fn ab(&self, i: usize) -> &'static AbDef {
        &CHARS[self.s.ch as usize].abs[i]
    }
    fn check_unlocks(&mut self) {
        for (i, c) in CHARS.iter().enumerate() {
            if self.s.best_wave >= c.unlock && self.s.unlocked & (1 << i) == 0 {
                self.s.unlocked |= 1 << i;
                self.push_ev(EV_UNLOCK, 0.0, 0.0, i as f64, 0.0, 0.0);
            }
        }
    }
    /// Make `id` the active character (must be unlocked). Ongoing ability
    /// effects end and the new character's four abilities start ready.
    pub fn set_char(&mut self, id: u32) -> bool {
        if id as usize >= N_CHARS || self.s.unlocked & (1 << id) == 0 {
            return false;
        }
        if id != self.s.ch {
            let frac = (self.hp / self.max_hp()).clamp(0.0, 1.0);
            self.s.ch = id;
            self.s.cds = vec![0.0; N_AB];
            self.active = [0.0; N_AB];
            self.pool_r = 0.0;
            self.zero_r = 0.0;
            self.gcd = 0.0;
            self.hp = self.max_hp() * frac;
            self.mana = self.max_mana() * 0.5;
            self.push_ev(EV_SWITCH, 0.0, 0.0, id as f64, 0.0, 0.0);
        }
        true
    }
    pub fn char_id(&self) -> u32 {
        self.s.ch
    }
    fn cd_mult(&self) -> f64 {
        1.0 - 0.06 * self.s.shop[6] as f64
    }
    fn offline_eff(&self) -> f64 {
        0.5 + 0.1 * self.s.shop[5] as f64
    }
    fn offline_cap(&self) -> f64 {
        (8.0 + self.s.shop[5] as f64) * 3600.0
    }

    fn enemy_hp(&self, w: u32) -> f64 {
        6.0 * 1.165f64.powi(w as i32 - 1) * 1.06f64.powi(w.saturating_sub(40) as i32)
    }
    fn enemy_gold(&self, w: u32) -> f64 {
        2.0 * 1.145f64.powi(w as i32 - 1)
    }
    fn enemy_dmg(&self, w: u32) -> f64 {
        3.0 * 1.14f64.powi(w as i32 - 1)
    }
    fn spawn_interval(&self) -> f64 {
        (1.1 - self.s.wave as f64 * 0.01).max(0.3)
    }
    fn is_boss_wave(&self) -> bool {
        self.s.wave % 10 == 0
    }

    // ------------------------------------------------------------ waves

    fn start_wave(&mut self) {
        self.enemies.clear();
        let w = self.s.wave;
        if self.is_boss_wave() {
            self.to_spawn = (6 + w / 5).min(16);
            self.boss_pending = true;
            self.wave_total = self.to_spawn + 1;
        } else {
            self.to_spawn = (8 + w / 2).min(36);
            self.boss_pending = false;
            self.wave_total = self.to_spawn;
        }
        self.wave_killed = 0;
        self.spawn_timer = 0.4;
        self.wave_intro = 2.0;
    }

    fn pick_kind(&mut self) -> usize {
        let w = self.s.wave;
        let avail: Vec<usize> = (0..8).filter(|&k| KINDS[k].unlock <= w).collect();
        // later kinds get more weight as waves rise
        let mut total = 0.0;
        let weights: Vec<f64> = avail
            .iter()
            .map(|&k| {
                let wt = if k == 7 { 0.5 } else { 1.0 } + (w.saturating_sub(KINDS[k].unlock) as f64 * 0.02).min(1.0);
                total += wt;
                wt
            })
            .collect();
        let mut r = self.rng.next() * total;
        for (i, wt) in weights.iter().enumerate() {
            if r < *wt {
                return avail[i];
            }
            r -= wt;
        }
        avail[avail.len() - 1]
    }

    fn spawn(&mut self, boss: bool) {
        if self.enemies.len() >= MAX_ENEMIES {
            return;
        }
        let w = self.s.wave;
        let kind = if boss { 8 + ((w / 10 - 1) % 5) as usize } else { self.pick_kind() };
        let k = KINDS[kind];
        let a = spawn_angle(self.rng.next());
        let r = SPAWN_RADIUS + self.rng.next() * 0.12;
        let hp = self.enemy_hp(w) * k.hp * (0.92 + self.rng.next() * 0.16);
        let e = Enemy {
            id: self.next_id,
            kind,
            boss,
            x: a.cos() * r,
            y: a.sin() * r,
            hp,
            max_hp: hp,
            speed: k.speed * (0.9 + self.rng.next() * 0.2),
            dmg: self.enemy_dmg(w) * k.dmg,
            gold: self.enemy_gold(w) * k.gold,
            size: k.size,
            atk_timer: 0.6,
            age: 0.0,
            flash: 0.0,
            phase: self.rng.next() * 10.0,
            slow: 0.0,
            frozen: 0.0,
            stun: 0.0,
            shatter: 0.0,
            thaw: 0.0,
        };
        self.next_id = self.next_id.wrapping_add(1);
        if boss {
            self.push_ev(EV_BOSS, e.x, e.y, kind as f64, 0.0, 0.0);
        }
        self.enemies.push(e);
    }

    fn push_ev(&mut self, t: f64, x: f64, y: f64, a: f64, b: f64, c: f64) {
        if self.events.len() > EVENT_STRIDE * 600 {
            return;
        }
        self.events.extend_from_slice(&[t, x, y, a, b, c]);
    }

    // ------------------------------------------------------------ simulation

    /// Advance the simulation by `dt` seconds (internally sub-stepped).
    pub fn tick(&mut self, dt: f64) {
        let mut left = dt.clamp(0.0, 5.0);
        while left > 0.0 {
            let step = left.min(1.0 / 30.0);
            self.step(step);
            left -= step;
        }
    }

    fn step(&mut self, dt: f64) {
        self.s.play_time += dt;
        self.atk_anim = (self.atk_anim - dt).max(0.0);
        if self.wave_intro > 0.0 {
            self.wave_intro -= dt;
        }
        for i in 0..N_AB {
            if self.s.cds[i] > 0.0 {
                self.s.cds[i] = (self.s.cds[i] - dt).max(0.0);
            }
            if self.active[i] > 0.0 {
                self.active[i] = (self.active[i] - dt).max(0.0);
            }
        }
        self.gcd = (self.gcd - dt).max(0.0);
        self.auto_lock = (self.auto_lock - dt).max(0.0);
        if self.s.autocast && self.sorc() {
            self.sorc_autocast();
        } else if self.s.autocast {
            for i in 0..N_AB {
                let sustain = if self.asura() { i == 2 } else { i == 1 || i == 3 };
                if self.can_cast(i) && (i != 0 || !self.enemies.is_empty()) && (!sustain || self.hp < self.max_hp() * 0.6 || !self.enemies.is_empty()) {
                    // only cast offensive skills when foes are near
                    let near = self.enemies.iter().any(|e| (e.x * e.x + e.y * e.y).sqrt() < self.range() * 1.4);
                    if near || sustain {
                        self.cast(i as u32);
                    }
                }
            }
        }

        // measure income for offline progress
        self.win_t += dt;
        if self.win_t >= 20.0 {
            let sps = self.win_souls / self.win_t;
            let kps = self.win_kills / self.win_t;
            if self.s.rate_wave != self.s.wave || self.s.rate_sps == 0.0 {
                self.s.rate_sps = sps;
                self.s.rate_kps = kps;
            } else {
                self.s.rate_sps = self.s.rate_sps * 0.6 + sps * 0.4;
                self.s.rate_kps = self.s.rate_kps * 0.6 + kps * 0.4;
            }
            self.s.rate_wave = self.s.wave;
            self.win_t = 0.0;
            self.win_souls = 0.0;
            self.win_kills = 0.0;
        }

        // spawning
        if self.to_spawn > 0 || self.boss_pending {
            self.spawn_timer -= dt;
            if self.spawn_timer <= 0.0 {
                if self.boss_pending && self.to_spawn <= (6 + self.s.wave / 5).min(16) / 2 {
                    self.boss_pending = false;
                    self.spawn(true);
                } else if self.to_spawn > 0 {
                    self.to_spawn -= 1;
                    self.spawn(false);
                    // occasional pair from the opposite side
                    if self.to_spawn > 0 && self.rng.next() < 0.25 {
                        self.to_spawn -= 1;
                        self.spawn(false);
                    }
                } else if self.boss_pending {
                    self.boss_pending = false;
                    self.spawn(true);
                }
                self.spawn_timer = self.spawn_interval() * (0.7 + self.rng.next() * 0.6);
            }
        }

        if self.daeva() {
            self.daeva_step(dt);
        }
        if self.sorc() {
            self.sorc_step(dt);
        }

        // regen
        let maxhp = self.max_hp();
        self.hp = (self.hp + self.regen() * dt).min(maxhp);

        // enemy movement & attacks
        let mut hurt = 0.0;
        let mut thawed: Vec<usize> = Vec::new();
        let n = self.enemies.len();
        for i in 0..n {
            let (ex, ey, size) = (self.enemies[i].x, self.enemies[i].y, self.enemies[i].size);
            let d = (ex * ex + ey * ey).sqrt().max(1e-6);
            let stop = ASURA_RADIUS + size * 0.35;
            let e = &mut self.enemies[i];
            e.age += dt;
            e.flash = (e.flash - dt).max(0.0);
            e.slow = (e.slow - dt).max(0.0);
            e.thaw = (e.thaw - dt).max(0.0);
            if e.frozen > 0.0 {
                e.frozen = (e.frozen - dt).max(0.0);
                if e.frozen <= 0.0 {
                    e.thaw = THAW_GRACE;
                    thawed.push(i);
                }
                continue; // encased: no step, no strike
            }
            if e.stun > 0.0 {
                e.stun = (e.stun - dt).max(0.0);
                continue; // paralyzed: no step, no strike
            }
            if d > stop {
                let sp = e.speed * if e.slow > 0.0 { 0.4 } else { 1.0 };
                let mv = (sp * dt).min(d - stop);
                e.x -= ex / d * mv;
                e.y -= ey / d * mv;
            } else {
                e.atk_timer -= dt;
                if e.atk_timer <= 0.0 {
                    e.atk_timer = 1.0;
                    hurt += e.dmg;
                }
            }
        }
        // Frozen Hell's ice shatters as it lets go
        for &i in &thawed {
            let (x, y, amt) = (self.enemies[i].x, self.enemies[i].y, self.enemies[i].shatter);
            self.enemies[i].shatter = 0.0;
            self.push_ev(EV_SHATTER, x, y, 0.0, 0.0, 0.0);
            if amt > 0.0 && self.enemies[i].hp > 0.0 {
                let (a, c) = self.roll_hit(amt);
                self.damage_enemy(i, a, c, 9.0);
            }
        }
        // light separation so crowds fan out around him
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = self.enemies[j].x - self.enemies[i].x;
                let dy = self.enemies[j].y - self.enemies[i].y;
                let min = (self.enemies[i].size + self.enemies[j].size) * 0.32;
                let d2 = dx * dx + dy * dy;
                if d2 < min * min && d2 > 1e-9 {
                    // frozen foes are blocks of ice: the crowd flows around them
                    let (fi, fj) = (self.enemies[i].frozen > 0.0, self.enemies[j].frozen > 0.0);
                    if fi && fj {
                        continue;
                    }
                    let d = d2.sqrt();
                    let push = (min - d) * if fi || fj { 1.0 } else { 0.5 };
                    let (ux, uy) = (dx / d * push, dy / d * push);
                    if !fi {
                        self.enemies[i].x -= ux;
                        self.enemies[i].y -= uy;
                    }
                    if !fj {
                        self.enemies[j].x += ux;
                        self.enemies[j].y += uy;
                    }
                }
            }
        }
        // jostling must not walk an approaching foe into the keep-clear cones
        for e in self.enemies.iter_mut() {
            if e.x * e.x + e.y * e.y > CONE_FREE_R * CONE_FREE_R {
                let (x, y) = clear_cone(e.x, e.y);
                e.x = x;
                e.y = y;
            }
        }
        if hurt > 0.0 {
            // Blue Lotus Beads shield the Daeva
            if self.daeva() && self.active[3] > 0.0 {
                hurt *= 0.4;
            }
            self.hp -= hurt;
            self.push_ev(EV_HURT, 0.0, 0.0, hurt, 0.0, 0.0);
            if self.hp <= 0.0 {
                self.defeat();
                return;
            }
        }

        // Asura attacks
        let aps = self.attack_speed();
        self.atk_timer += dt * aps;
        let mut swings = 0;
        while self.atk_timer >= 1.0 && swings < 8 {
            swings += 1;
            if !self.attack() {
                self.atk_timer = self.atk_timer.min(1.0);
                break;
            }
            self.atk_timer -= 1.0;
        }

        self.reap();

        // wave cleared?
        if self.to_spawn == 0 && !self.boss_pending && self.enemies.is_empty() {
            let w = self.s.wave;
            self.push_ev(EV_WAVE, 0.0, 0.0, w as f64, 0.0, 0.0);
            if self.s.auto {
                self.s.wave += 1;
                if self.s.wave > self.s.max_wave {
                    self.s.max_wave = self.s.wave;
                }
                if self.s.max_wave > self.s.best_wave {
                    self.s.best_wave = self.s.max_wave;
                }
                self.check_unlocks();
            }
            self.start_wave();
        }
    }

    fn roll_hit(&mut self, base: f64) -> (f64, bool) {
        let crit = self.rng.next() < self.crit_chance();
        let var = 0.9 + self.rng.next() * 0.2;
        if crit {
            (base * var * self.crit_mult(), true)
        } else {
            (base * var, false)
        }
    }

    fn damage_enemy(&mut self, idx: usize, amount: f64, crit: bool, kind: f64) {
        let lifesteal = self.siphon();
        // ice makes foes brittle: +20% damage from everything while frozen
        let amount = if self.enemies[idx].frozen > 0.0 { amount * 1.2 } else { amount };
        let e = &mut self.enemies[idx];
        let dealt = amount.min(e.hp.max(0.0));
        e.hp -= amount;
        e.flash = 0.12;
        let (x, y) = (e.x, e.y);
        // tiny knockback (ice holds frozen foes in place)
        let d = (x * x + y * y).sqrt().max(1e-6);
        if !e.boss && e.frozen <= 0.0 {
            e.x += x / d * 0.006;
            e.y += y / d * 0.006;
        }
        if lifesteal > 0.0 {
            let mh = self.max_hp();
            self.hp = (self.hp + dealt * lifesteal).min(mh);
        }
        self.push_ev(EV_HIT, x, y, amount, if crit { 1.0 } else { 0.0 }, kind);
    }

    /// One swing. Returns false when no target is in range.
    fn attack(&mut self) -> bool {
        let range = self.range();
        let mut cands: Vec<(f64, usize)> = self
            .enemies
            .iter()
            .enumerate()
            .filter(|(_, e)| e.hp > 0.0)
            .map(|(i, e)| ((e.x * e.x + e.y * e.y).sqrt(), i))
            .filter(|(d, _)| *d <= range)
            .collect();
        if cands.is_empty() {
            return false;
        }
        cands.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let n = (self.targets() as usize).min(cands.len());
        let base = self.damage();
        let (fx, fy) = (self.enemies[cands[0].1].x, self.enemies[cands[0].1].y);
        self.face = if fx < 0.0 { -1.0 } else { 1.0 };
        self.atk_anim = 0.18;
        self.push_ev(EV_ATTACK, fx, fy, n as f64, 0.0, 0.0);
        if self.sorc() {
            self.mana = (self.mana + self.mana_per_strike()).min(self.max_mana());
            self.sorc_strike(&cands[..n], base);
            return true;
        }
        for t in 0..n {
            let idx = cands[t].1;
            let (amt, crit) = self.roll_hit(base);
            self.damage_enemy(idx, amt, crit, 0.0);
            if self.daeva() {
                // her water-palm strikes leave foes briefly sluggish
                let e = &mut self.enemies[idx];
                e.slow = e.slow.max(0.5);
            }
        }
        // Storm: lightning chains to a foe anywhere on the field
        if self.asura() && self.active[1] > 0.0 {
            let alive: Vec<usize> = (0..self.enemies.len())
                .filter(|&i| self.enemies[i].hp > 0.0 && (self.enemies[i].x.powi(2) + self.enemies[i].y.powi(2)).sqrt() < 1.25)
                .collect();
            if !alive.is_empty() {
                let pick = alive[(self.rng.next() * alive.len() as f64) as usize % alive.len()];
                let (amt, crit) = self.roll_hit(base * 0.6 * self.ability_power());
                let (tx, ty) = (self.enemies[pick].x, self.enemies[pick].y);
                self.push_ev(EV_CHAIN, tx, ty, 0.0, 0.0, 0.0);
                self.damage_enemy(pick, amt, crit, 1.0);
            }
        }
        true
    }

    fn reap(&mut self) {
        let mult = self.soul_mult();
        let mut i = 0;
        while i < self.enemies.len() {
            if self.enemies[i].hp <= 0.0 {
                let e = self.enemies.swap_remove(i);
                let g = e.gold * mult;
                self.s.souls += g;
                self.s.total_souls += g;
                self.s.run_souls += g;
                self.s.kills += 1.0;
                self.win_souls += g;
                self.win_kills += 1.0;
                self.wave_killed += 1;
                self.push_ev(EV_KILL, e.x, e.y, g, e.kind as f64, if e.boss { 1.0 } else { 0.0 });
            } else {
                i += 1;
            }
        }
    }

    fn defeat(&mut self) {
        let w = self.s.wave;
        self.push_ev(EV_DEFEAT, 0.0, 0.0, w as f64, 0.0, 0.0);
        self.s.wave = if w > 1 { w - 1 } else { 1 };
        self.s.auto = false;
        self.hp = self.max_hp();
        self.start_wave();
    }

    // ------------------------------------------------------------ abilities

    pub fn can_cast(&self, i: usize) -> bool {
        if i >= N_AB || self.s.best_wave < self.ab(i).unlock {
            return false;
        }
        if self.sorc() {
            // no cooldowns: only mana and the short global lockout
            return self.gcd <= 0.0 && self.mana + 1e-9 >= self.ab(i).cost;
        }
        self.s.cds[i] <= 0.0
    }

    pub fn cast(&mut self, i: u32) -> bool {
        let i = i as usize;
        if !self.can_cast(i) {
            return false;
        }
        if self.sorc() {
            return self.sorc_cast(i);
        }
        self.s.cds[i] = self.ab(i).cd * self.cd_mult();
        self.active[i] = self.ab(i).dur;
        self.push_ev(EV_CAST, 0.0, 0.0, i as f64, self.s.ch as f64, 0.0);
        if self.daeva() {
            self.daeva_cast(i);
            return true;
        }
        match i {
            0 => {
                // Wrath Burst — radial shockwave
                let radius = self.range() * 1.6;
                self.push_ev(EV_WRATH, 0.0, 0.0, radius, 0.0, 0.0);
                let base = self.damage() * 20.0 * self.ability_power();
                for idx in 0..self.enemies.len() {
                    let (x, y) = (self.enemies[idx].x, self.enemies[idx].y);
                    let d = (x * x + y * y).sqrt().max(1e-6);
                    if d <= radius {
                        let (amt, crit) = self.roll_hit(base);
                        self.damage_enemy(idx, amt, crit, 2.0);
                        let e = &mut self.enemies[idx];
                        if !e.boss {
                            e.x += x / d * 0.18;
                            e.y += y / d * 0.18;
                        }
                        e.slow = 2.0;
                    }
                }
                self.reap();
            }
            2 => {
                let mh = self.max_hp();
                let heal = mh * 0.6 * self.ability_power();
                self.hp = (self.hp + heal).min(mh);
                self.push_ev(EV_HEAL, 0.0, 0.0, heal, 0.0, 0.0);
            }
            _ => {}
        }
        true
    }

    // ------------------------------------------------------------ upgrades

    fn up_quote(&self, i: usize, want: i32) -> (u32, f64) {
        let d = &UPS[i];
        let lvl = self.s.up[i];
        let room = if d.max > 0 { d.max.saturating_sub(lvl) } else { u32::MAX };
        if room == 0 {
            return (0, 0.0);
        }
        if want > 0 {
            let n = (want as u32).min(room);
            return (n, geo_sum(d.base, d.growth, lvl, n));
        }
        // max affordable
        let first = d.base * d.growth.powi(lvl as i32);
        let mut n = if self.s.souls < first {
            0
        } else {
            ((self.s.souls * (d.growth - 1.0) / first + 1.0).ln() / d.growth.ln()).floor() as u32
        };
        n = n.min(room);
        while n > 0 && geo_sum(d.base, d.growth, lvl, n) > self.s.souls * (1.0 + 1e-9) {
            n -= 1;
        }
        if n == 0 {
            return (1, first);
        }
        (n, geo_sum(d.base, d.growth, lvl, n))
    }

    /// Buy `want` levels of upgrade `i` (want <= 0 means as many as affordable).
    /// Returns the number of levels bought.
    pub fn buy(&mut self, i: u32, want: i32) -> u32 {
        let i = i as usize;
        if i >= N_UP {
            return 0;
        }
        let (n, cost) = self.up_quote(i, want);
        if n == 0 || cost > self.s.souls * (1.0 + 1e-9) {
            return 0;
        }
        let hp_frac = self.hp / self.max_hp();
        let mana_frac = self.mana / self.max_mana();
        self.s.souls = (self.s.souls - cost).max(0.0);
        self.s.up[i] += n;
        if i == UP_MANAPOOL {
            self.mana = mana_frac * self.max_mana();
        }
        if i == 6 {
            self.hp = hp_frac * self.max_hp();
        }
        n
    }

    fn shop_cost(&self, i: usize) -> f64 {
        let d = &SHOP[i];
        (d.base * d.growth.powi(self.s.shop[i] as i32)).ceil()
    }

    pub fn buy_shop(&mut self, i: u32) -> bool {
        let i = i as usize;
        if i >= N_SHOP {
            return false;
        }
        let d = &SHOP[i];
        if d.max > 0 && self.s.shop[i] >= d.max {
            return false;
        }
        let c = self.shop_cost(i);
        if self.s.beads < c {
            return false;
        }
        self.s.beads -= c;
        self.s.shop[i] += 1;
        if i == 2 {
            self.hp = self.hp.min(self.max_hp());
        }
        true
    }

    // ------------------------------------------------------------ prestige

    pub fn rebirth_beads(&self) -> f64 {
        let w = self.s.max_wave;
        if w < 30 {
            return 0.0;
        }
        (((w - 20) as f64 / 5.0).powf(1.7) + self.s.run_souls.max(1.0).log10() * 0.0).floor()
    }

    pub fn rebirth(&mut self) -> f64 {
        let g = self.rebirth_beads();
        if g <= 0.0 {
            return 0.0;
        }
        self.s.beads += g;
        self.s.beads_life += g;
        self.s.rebirths += 1;
        self.s.souls = 0.0;
        self.s.run_souls = 0.0;
        self.s.up = vec![0; N_UP];
        self.s.cds = vec![0.0; N_AB];
        self.active = [0.0; N_AB];
        let leap = 1 + 3 * self.s.shop[4];
        let start = leap.min((self.s.best_wave / 2).max(1));
        self.s.wave = start;
        self.s.max_wave = start;
        self.s.auto = true;
        self.s.rate_sps = 0.0;
        self.s.rate_kps = 0.0;
        self.hp = self.max_hp();
        self.mana = self.max_mana();
        self.zero_r = 0.0;
        self.start_wave();
        g
    }

    // ------------------------------------------------------------ offline

    fn estimate_rates(&self) -> (f64, f64) {
        // Analytic estimate of steady farming on the current wave: kills are
        // limited either by damage output or by how fast foes arrive.
        let w = self.s.wave;
        let avg_hp = self.enemy_hp(w) * 1.5;
        let dps = self.damage()
            * self.attack_speed()
            * (1.0 + self.crit_chance().min(1.0) * (self.crit_mult() - 1.0))
            * (self.targets().min(3) as f64);
        let arrive = 1.15 / self.spawn_interval();
        let kps = arrive.min(dps * 0.85 / avg_hp);
        let sps = kps * self.enemy_gold(w) * 1.4 * self.soul_mult();
        (sps, kps)
    }

    /// Grant progress for `seconds` away. Returns a JSON summary.
    pub fn apply_offline(&mut self, seconds: f64) -> String {
        let secs = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
        let cap = self.offline_cap();
        let used = secs.min(cap);
        let eff = self.offline_eff();
        let (sps, kps) = self.estimate_rates();
        let souls = sps * used * eff;
        let kills = (kps * used * eff).floor();
        self.s.souls += souls;
        self.s.total_souls += souls;
        self.s.run_souls += souls;
        self.s.kills += kills;
        for c in self.s.cds.iter_mut() {
            *c = (*c - secs).max(0.0);
        }
        self.hp = self.max_hp();
        serde_json::json!({
            "seconds": secs,
            "used": used,
            "capped": secs > cap,
            "cap": cap,
            "eff": eff,
            "souls": souls,
            "kills": kills,
            "wave": self.s.wave,
        })
        .to_string()
    }

    // ------------------------------------------------------------ persistence

    pub fn save_json(&mut self, now_ms: f64) -> String {
        self.s.last_save = now_ms;
        if self.s.created == 0.0 {
            self.s.created = now_ms;
        }
        serde_json::to_string(&self.s).unwrap_or_default()
    }

    pub fn load_json(&mut self, json: &str) -> bool {
        match serde_json::from_str::<Save>(json) {
            Ok(mut s) => {
                s.sanitize();
                self.s = s;
                self.active = [0.0; N_AB];
                self.hp = self.max_hp();
                self.mana = self.max_mana() * 0.5;
                self.zero_r = 0.0;
                self.start_wave();
                true
            }
            Err(_) => false,
        }
    }

    pub fn last_save(&self) -> f64 {
        self.s.last_save
    }

    pub fn export_save(&mut self, now_ms: f64) -> String {
        let j = self.save_json(now_ms);
        format!("ASURA1:{}", b64::encode(j.as_bytes()))
    }

    /// Import an exported string. Returns false (and changes nothing) if invalid.
    pub fn import_save(&mut self, text: &str) -> bool {
        let t: String = text.trim().chars().filter(|c| !c.is_whitespace()).collect();
        let body = t.strip_prefix("ASURA1:").unwrap_or(&t);
        let bytes = match b64::decode(body) {
            Some(b) => b,
            None => return false,
        };
        let json = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return false,
        };
        // must look like one of our saves
        let ok = serde_json::from_str::<serde_json::Value>(&json)
            .map(|v| v.get("v").is_some() && v.get("souls").is_some())
            .unwrap_or(false);
        if !ok {
            return false;
        }
        self.load_json(&json)
    }

    pub fn hard_reset(&mut self) {
        self.s = Save::default();
        self.active = [0.0; N_AB];
        self.hp = self.max_hp();
        self.start_wave();
    }

    // ------------------------------------------------------------ controls

    pub fn set_auto(&mut self, on: bool) {
        self.s.auto = on;
    }
    pub fn set_autocast(&mut self, on: bool) {
        self.s.autocast = on;
    }
    /// Jump to an earlier/later wave (only up to the best wave this life).
    pub fn goto_wave(&mut self, w: u32) {
        let w = w.clamp(1, self.s.max_wave);
        if w != self.s.wave {
            self.s.wave = w;
            self.start_wave();
        }
    }

    // ------------------------------------------------------------ render feed

    /// Flat enemy buffer: [id, kind, x, y, hpFrac, size, age, flash, phase, boss, slow] * n
    /// (slow in (-100, 0) means frozen for -slow seconds; slow <= -100 means paralyzed)
    pub fn enemies(&self) -> Vec<f32> {
        let mut v = Vec::with_capacity(self.enemies.len() * ENEMY_STRIDE);
        for e in &self.enemies {
            v.extend_from_slice(&[
                e.id as f32,
                e.kind as f32,
                e.x as f32,
                e.y as f32,
                (e.hp / e.max_hp).max(0.0) as f32,
                e.size as f32,
                e.age as f32,
                e.flash as f32,
                e.phase as f32,
                if e.boss { 1.0 } else { 0.0 },
                // frozen foes report the ice time left as a negative value; paralyzed
                // foes report -(100 + seconds left)
                if e.frozen > 0.0 { -(e.frozen.max(0.01)) as f32 } else if e.stun > 0.0 { -(100.0 + e.stun) as f32 } else { e.slow as f32 },
            ]);
        }
        v
    }

    /// Drain queued events: [type, x, y, a, b, c] * n
    pub fn drain_events(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.events)
    }

    /// Per-frame scalars: [hpFrac, range, atkAnim, face, wave, waveKilled, waveTotal,
    ///   stormLeft, beadsLeft, armsLeft, waveIntro, souls, isBossWave, hp, maxHp,
    ///   atkPhase (0..1 toward the next swing), attacksPerSecond] — the last two are
    ///   read-only hints so the renderer can start a move's wind-up before the hit lands.
    pub fn frame(&self) -> Vec<f64> {
        vec![
            (self.hp / self.max_hp()).clamp(0.0, 1.0),
            self.range(),
            self.atk_anim,
            self.face,
            self.s.wave as f64,
            self.wave_killed as f64,
            self.wave_total as f64,
            if self.asura() { self.active[1] } else { 0.0 },
            if self.asura() { self.active[2] } else { 0.0 },
            if self.asura() { self.active[3] } else { 0.0 },
            self.wave_intro.max(0.0),
            self.s.souls,
            if self.is_boss_wave() { 1.0 } else { 0.0 },
            self.hp.max(0.0),
            self.max_hp(),
            self.atk_timer.clamp(0.0, 1.0),
            self.attack_speed(),
            // 17.. character & Daeva effects: [char, rainLeft, poolLeft, lotusLeft, poolX, poolY, poolR]
            self.s.ch as f64,
            if self.daeva() { self.active[1] } else { 0.0 },
            if self.daeva() { self.active[2] } else { 0.0 },
            if self.daeva() { self.active[3] } else { 0.0 },
            self.pool.0,
            self.pool.1,
            self.pool_r,
            // 24.. Sorcerer: [manaFrac, mana, maxMana, hellLeft, hellR, gcd]
            if self.sorc() { (self.mana / self.max_mana()).clamp(0.0, 1.0) } else { 0.0 },
            self.mana,
            self.max_mana(),
            if self.sorc() { self.active[3] } else { 0.0 },
            if self.sorc() { self.zero_r } else { 0.0 },
            self.gcd,
        ]
    }

    /// Full UI snapshot as JSON (call a few times per second).
    pub fn ui(&self, buy_mult: i32) -> String {
        let ups: Vec<serde_json::Value> = (0..N_UP)
            .map(|i| {
                let d = &UPS[i];
                let (n, cost) = self.up_quote(i, buy_mult);
                let maxed = d.max > 0 && self.s.up[i] >= d.max;
                // value now / value after n levels
                let mut tmp = Game::preview_clone(self);
                let now = tmp.stat_value(i);
                tmp.s.up[i] += n.max(if maxed { 0 } else { 1 });
                let next = tmp.stat_value(i);
                serde_json::json!({
                    "only": if i == UP_MANAPOOL || i == UP_MANAREGEN { "sorcerer" } else { "" },
                    "key": d.key, "lvl": self.s.up[i], "max": d.max, "n": n, "cost": cost,
                    "afford": !maxed && n > 0 && cost <= self.s.souls * (1.0 + 1e-9), "maxed": maxed,
                    "now": now, "next": next,
                })
            })
            .collect();
        let shop: Vec<serde_json::Value> = (0..N_SHOP)
            .map(|i| {
                let d = &SHOP[i];
                let maxed = d.max > 0 && self.s.shop[i] >= d.max;
                let c = self.shop_cost(i);
                // the mana beads show once the Sorcerer has been unlocked
                let shown = !(i == SHOP_MANAPOOL || i == SHOP_MANAREGEN) || self.s.unlocked & (1 << CH_SORC) != 0;
                serde_json::json!({
                    "shown": shown,
                    "key": d.key, "lvl": self.s.shop[i], "max": d.max, "cost": c,
                    "afford": !maxed && self.s.beads >= c, "maxed": maxed,
                })
            })
            .collect();
        let abs: Vec<serde_json::Value> = (0..N_AB)
            .map(|i| {
                let d = self.ab(i);
                serde_json::json!({
                    "key": d.key, "unlock": d.unlock, "unlocked": self.s.best_wave >= d.unlock,
                    "cd": self.s.cds[i], "cdMax": d.cd * self.cd_mult(), "active": self.active[i], "dur": d.dur,
                    "cost": d.cost, "afford": d.cost <= 0.0 || self.mana + 1e-9 >= d.cost, "gcd": self.gcd,
                })
            })
            .collect();
        let (sps, _) = self.estimate_rates();
        let chars: Vec<serde_json::Value> = CHARS.iter().enumerate().map(|(i, c)| {
            let abs: Vec<serde_json::Value> = c.abs.iter().map(|a| serde_json::json!({"key": a.key, "unlock": a.unlock, "cd": a.cd, "dur": a.dur, "cost": a.cost})).collect();
            serde_json::json!({ "id": i, "key": c.key, "unlock": c.unlock, "unlocked": self.s.unlocked & (1 << i) != 0, "abs": abs })
        }).collect();
        serde_json::json!({
            "souls": self.s.souls, "beads": self.s.beads, "beadsLife": self.s.beads_life,
            "wave": self.s.wave, "maxWave": self.s.max_wave, "bestWave": self.s.best_wave,
            "auto": self.s.auto, "autocast": self.s.autocast,
            "kills": self.s.kills, "totalSouls": self.s.total_souls, "rebirths": self.s.rebirths,
            "playTime": self.s.play_time, "rebirthBeads": self.rebirth_beads(),
            "dmg": self.damage(), "aps": self.attack_speed(), "range": self.range(),
            "crit": self.crit_chance(), "critMult": self.crit_mult(), "targets": self.targets(),
            "maxHp": self.max_hp(), "hp": self.hp, "regen": self.regen(), "soulMult": self.soul_mult(),
            "siphon": self.siphon(), "beadDmg": self.bead_dmg_mult(),
            "offlineEff": self.offline_eff(), "offlineCap": self.offline_cap(), "cdMult": self.cd_mult(),
            "sps": sps, "ups": ups, "shop": shop, "abs": abs,
            "char": CHARS[self.s.ch as usize].key, "charId": self.s.ch,
            "mana": self.mana, "maxMana": self.max_mana(), "manaGain": self.mana_per_strike(), "abilityPower": self.ability_power(),
            "chars": chars,
        })
        .to_string()
    }

    fn preview_clone(g: &Game) -> Game {
        Game {
            s: g.s.clone(),
            rng: Rng(1),
            enemies: Vec::new(),
            next_id: 0,
            hp: 0.0,
            atk_timer: 0.0,
            atk_anim: 0.0,
            face: 1.0,
            to_spawn: 0,
            spawn_timer: 0.0,
            wave_total: 0,
            wave_killed: 0,
            boss_pending: false,
            active: [0.0; N_AB],
            events: Vec::new(),
            win_t: 0.0,
            win_souls: 0.0,
            win_kills: 0.0,
            wave_intro: 0.0,
            pool: (0.0, 0.0),
            pool_r: 0.0,
            rain_acc: 0.0,
            pool_acc: 0.0,
            lotus_acc: 0.0,
            mana: g.mana,
            gcd: 0.0,
            auto_lock: 0.0,
            zero_r: 0.0,
        }
    }

    fn stat_value(&self, i: usize) -> f64 {
        match i {
            0 => self.damage(),
            1 => self.attack_speed(),
            2 => self.range(),
            3 => self.crit_chance(),
            4 => self.crit_mult(),
            5 => self.targets() as f64,
            6 => self.max_hp(),
            7 => self.regen(),
            8 => self.soul_mult(),
            9 => self.siphon(),
            10 => self.max_mana(),
            11 => self.mana_per_strike(),
            _ => 0.0,
        }
    }

    // ------------------------------------------------------------ test hooks

    /// Debug/balance helper: simulate `seconds` with a greedy auto-buyer.
    /// Not used by the UI; handy for play-testing and tuning.
    pub fn debug_sim(&mut self, seconds: f64, autobuy: bool) -> String {
        let mut t = 0.0;
        let mut defeats = 0;
        while t < seconds {
            self.step(1.0 / 20.0);
            t += 1.0 / 20.0;
            let ev = std::mem::take(&mut self.events);
            for c in ev.chunks(EVENT_STRIDE) {
                if c[0] == EV_DEFEAT {
                    defeats += 1;
                    self.s.auto = true; // keep pushing
                }
            }
            if autobuy && (t * 20.0) as u64 % 20 == 0 {
                loop {
                    let mut best: Option<(usize, f64)> = None;
                    for i in 0..N_UP {
                        if i == 9 || i == 2 && self.s.up[2] > 12 {
                            continue;
                        }
                        if (i == UP_MANAPOOL || i == UP_MANAREGEN) && !self.sorc() {
                            continue;
                        }
                        let (n, c) = self.up_quote(i, 1);
                        if n == 0 {
                            continue;
                        }
                        let w = match i { 0 => 1.0, 6 => 1.6, 7 => 2.5, 8 => 1.5, 10 => 2.0, 11 => 1.6, _ => 1.2 };
                        let score = c * w;
                        if best.map_or(true, |(_, s)| score < s) {
                            best = Some((i, score));
                        }
                    }
                    match best {
                        Some((i, _)) if self.buy(i as u32, 1) > 0 => {}
                        _ => break,
                    }
                }
                if self.sorc() {
                    self.auto_lock = 0.0;
                    self.sorc_autocast();
                } else {
                    for i in 0..N_AB {
                        if self.can_cast(i) {
                            self.cast(i as u32);
                        }
                    }
                }
            }
        }
        self.events.clear();
        serde_json::json!({"wave": self.s.wave, "maxWave": self.s.max_wave, "souls": self.s.souls,
            "kills": self.s.kills, "defeats": defeats, "up": self.s.up, "dmg": self.damage()}).to_string()
    }

    pub fn debug_set_souls(&mut self, v: f64) {
        self.s.souls = v;
    }
    pub fn debug_set_wave(&mut self, w: u32) {
        self.s.wave = w.max(1);
        self.s.max_wave = self.s.max_wave.max(self.s.wave);
        self.s.best_wave = self.s.best_wave.max(self.s.max_wave);
        self.check_unlocks();
        self.start_wave();
    }
}

// ---------------------------------------------------------------- Daeva
impl Game {
    fn daeva_cast(&mut self, i: usize) {
        match i {
            0 => {
                // Tidal Surge — a radial wave of ink-water: less burst than Wrath,
                // but it shoves foes far back and leaves them slowed
                let radius = self.range() * 1.8;
                self.push_ev(EV_TIDE, 0.0, 0.0, radius, 0.0, 0.0);
                let base = self.damage() * 10.0 * self.ability_power();
                for idx in 0..self.enemies.len() {
                    let (x, y) = (self.enemies[idx].x, self.enemies[idx].y);
                    let d = (x * x + y * y).sqrt().max(1e-6);
                    if d <= radius {
                        let (amt, crit) = self.roll_hit(base);
                        self.damage_enemy(idx, amt, crit, 3.0);
                        let e = &mut self.enemies[idx];
                        let push = if e.boss { 0.05 } else { 0.3 };
                        let nd = (d + push).min(SPAWN_RADIUS);
                        let (nx, ny) = clear_cone(x / d * nd, y / d * nd);
                        e.x = nx;
                        e.y = ny;
                        e.slow = 4.0;
                    }
                }
                self.reap();
            }
            1 => {
                // Healing Rain — opens with a small heal; the rest ticks in daeva_step
                let mh = self.max_hp();
                let heal = mh * 0.1 * self.ability_power();
                self.hp = (self.hp + heal).min(mh);
                self.push_ev(EV_HEAL, 0.0, 0.0, heal, 0.0, 0.0);
                self.rain_acc = 0.0;
            }
            2 => {
                // Whirlpool — opens on the densest knot of foes in reach
                let reach = self.range() * 1.6;
                let mut best = (0.0f64, 0.0f64, -1.0f64);
                for a in &self.enemies {
                    let da = (a.x * a.x + a.y * a.y).sqrt();
                    if da > reach || da < 0.12 {
                        continue;
                    }
                    let n = self.enemies.iter().filter(|b| (b.x - a.x).powi(2) + (b.y - a.y).powi(2) < 0.09).count() as f64 - da * 0.5;
                    if n > best.2 {
                        best = (a.x, a.y, n);
                    }
                }
                if best.2 < 0.0 {
                    best = (self.face * self.range() * 0.6, 0.0, 0.0);
                }
                self.pool = (best.0, best.1);
                self.pool_r = 0.3;
                self.pool_acc = 0.0;
                self.push_ev(EV_POOL, best.0, best.1, self.pool_r, 0.0, 0.0);
            }
            3 => {
                // Blue Lotus Beads — orbiting beads that heal per hit and shield her
                let mh = self.max_hp();
                let heal = mh * 0.2 * self.ability_power();
                self.hp = (self.hp + heal).min(mh);
                self.push_ev(EV_HEAL, 0.0, 0.0, heal, 1.0, 0.0);
                self.lotus_acc = 0.0;
            }
            _ => {}
        }
    }

    fn daeva_step(&mut self, dt: f64) {
        let mh = self.max_hp();
        let ap = self.ability_power();
        let base = self.damage() * ap;
        // Healing Rain: 4% max HP per second; droplets strike foes on the field
        if self.active[1] > 0.0 {
            self.hp = (self.hp + mh * 0.04 * ap * dt).min(mh);
            self.rain_acc += dt;
            while self.rain_acc >= 0.2 {
                self.rain_acc -= 0.2;
                let alive: Vec<usize> = (0..self.enemies.len())
                    .filter(|&i| self.enemies[i].hp > 0.0 && (self.enemies[i].x.powi(2) + self.enemies[i].y.powi(2)).sqrt() < 1.2)
                    .collect();
                if alive.is_empty() {
                    break;
                }
                let pick = alive[(self.rng.next() * alive.len() as f64) as usize % alive.len()];
                let (amt, crit) = self.roll_hit(base * 0.7);
                let (tx, ty) = (self.enemies[pick].x, self.enemies[pick].y);
                self.push_ev(EV_DROP, tx, ty, 0.0, 0.0, 0.0);
                self.damage_enemy(pick, amt, crit, 3.0);
            }
        }
        // Whirlpool: pull foes in and grind them
        if self.active[2] > 0.0 && self.pool_r > 0.0 {
            let (cx, cy, r) = (self.pool.0, self.pool.1, self.pool_r);
            for e in self.enemies.iter_mut() {
                let (dx, dy) = (cx - e.x, cy - e.y);
                let d = (dx * dx + dy * dy).sqrt();
                if d < r * 1.6 && d > 1e-4 {
                    let pull = if e.boss { 0.06 } else { 0.32 } * dt;
                    let mv = pull.min(d * 0.9);
                    // swirl: mostly inward with a tangential twist
                    e.x += (dx / d) * mv - (dy / d) * mv * 0.6;
                    e.y += (dy / d) * mv + (dx / d) * mv * 0.6;
                    e.slow = e.slow.max(0.3);
                }
            }
            self.pool_acc += dt;
            while self.pool_acc >= 0.25 {
                self.pool_acc -= 0.25;
                for idx in 0..self.enemies.len() {
                    let e = &self.enemies[idx];
                    if e.hp > 0.0 && (e.x - cx).powi(2) + (e.y - cy).powi(2) < r * r {
                        let (amt, crit) = self.roll_hit(base * 0.55);
                        self.damage_enemy(idx, amt, crit, 4.0);
                    }
                }
            }
        } else if self.active[2] <= 0.0 {
            self.pool_r = 0.0;
        }
        // Blue Lotus Beads: hits foes the orbit sweeps through; each hit heals
        if self.active[3] > 0.0 {
            self.lotus_acc += dt;
            while self.lotus_acc >= 0.25 {
                self.lotus_acc -= 0.25;
                let mut healed = 0.0;
                for idx in 0..self.enemies.len() {
                    let e = &self.enemies[idx];
                    let d = (e.x * e.x + e.y * e.y).sqrt();
                    if e.hp > 0.0 && d < 0.3 + e.size * 0.3 {
                        let (amt, crit) = self.roll_hit(base * 0.6);
                        self.damage_enemy(idx, amt, crit, 5.0);
                        healed += mh * 0.004 * ap;
                    }
                }
                let healed = healed.min(mh * 0.03 * ap);
                if healed > 0.0 {
                    self.hp = (self.hp + healed).min(mh);
                }
            }
        }
        self.reap();
    }
}

// ---------------------------------------------------------------- Sorcerer
impl Game {
    fn dist(e: &Enemy) -> f64 {
        (e.x * e.x + e.y * e.y).sqrt()
    }
    /// Encase foe `idx` in ice for `dur` seconds (bosses are held half as long).
    /// Foes already in ice, or just thawed, are skipped. Returns whether it took.
    fn freeze(&mut self, idx: usize, dur: f64) -> bool {
        let d = dur * self.freeze_mult() * if self.enemies[idx].boss { 0.5 } else { 1.0 };
        let e = &mut self.enemies[idx];
        if e.hp <= 0.0 || e.frozen > 0.0 || e.thaw > 0.0 {
            return false;
        }
        e.frozen = d;
        e.stun = 0.0;
        let (x, y, b) = (e.x, e.y, e.boss);
        self.push_ev(EV_FREEZE, x, y, d, if b { 1.0 } else { 0.0 }, 0.0);
        true
    }
    /// A normal swing: a close burst of energy from his hands on each target,
    /// splashing foes packed around it.
    fn sorc_strike(&mut self, targets: &[(f64, usize)], base: f64) {
        let mut hit: Vec<usize> = targets.iter().map(|t| t.1).collect();
        for t in targets {
            let idx = t.1;
            let (amt, crit) = self.roll_hit(base);
            self.damage_enemy(idx, amt, crit, 6.0);
            let (cx, cy) = (self.enemies[idx].x, self.enemies[idx].y);
            let mut splashed = 0;
            for j in 0..self.enemies.len() {
                if splashed >= 3 || hit.contains(&j) {
                    continue;
                }
                let e = &self.enemies[j];
                if e.hp > 0.0 && (e.x - cx).powi(2) + (e.y - cy).powi(2) < BURST_R * BURST_R {
                    let (a2, c2) = self.roll_hit(base * BURST_SPLASH);
                    self.damage_enemy(j, a2, c2, 7.0);
                    hit.push(j);
                    splashed += 1;
                }
            }
        }
    }
    /// the order Chain Lightning visits foes: the nearest foe to him, then each
    /// time the nearest foe not yet struck within a jump of the last
    fn chain_path(&self) -> Vec<usize> {
        let alive = |e: &Enemy| e.hp > 0.0;
        let first = self.enemies.iter().enumerate().filter(|(_, e)| alive(e))
            .min_by(|a, b| Game::dist(a.1).partial_cmp(&Game::dist(b.1)).unwrap()).map(|(j, _)| j);
        let mut path = Vec::new();
        let mut cur = match first { Some(j) => j, None => return path };
        path.push(cur);
        while path.len() < CHAIN_MAX {
            let (cx, cy) = (self.enemies[cur].x, self.enemies[cur].y);
            let next = self.enemies.iter().enumerate()
                .filter(|(j, e)| alive(e) && !path.contains(j))
                .map(|(j, e)| (((e.x - cx).powi(2) + (e.y - cy).powi(2)).sqrt(), j))
                .filter(|(d, _)| *d <= CHAIN_JUMP)
                .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            match next {
                Some((_, j)) => { path.push(j); cur = j; }
                None => break, // nobody left to leap to: the bolt grounds out
            }
        }
        path
    }
    fn sorc_cast(&mut self, i: usize) -> bool {
        let ap = self.ability_power();
        let base = self.damage() * ap;
        if !self.enemies.iter().any(|e| e.hp > 0.0) {
            return false; // nothing to strike: no mana spent
        }
        match i {
            0 => {
                // Arcane Bolts: three bolts seek the furthest foes on the field
                let mut c: Vec<(f64, usize)> = self.enemies.iter().enumerate()
                    .filter(|(_, e)| e.hp > 0.0).map(|(j, e)| (Game::dist(e), j)).collect();
                c.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
                self.spend(i);
                for (k, &(_, idx)) in c.iter().take(3).enumerate() {
                    let (x, y) = (self.enemies[idx].x, self.enemies[idx].y);
                    self.push_ev(EV_BOLT, x, y, k as f64, 0.0, 0.0);
                    let (amt, crit) = self.roll_hit(base * BOLT_MULT);
                    self.damage_enemy(idx, amt, crit, 10.0);
                }
            }
            1 => {
                // Flame Wave: a wave of flame-ink rolls out and drives every foe
                // (bosses too) back to the spawn edge, singeing them
                self.spend(i);
                self.push_ev(EV_FLAME, 0.0, 0.0, SPAWN_RADIUS, 0.0, 0.0);
                for idx in 0..self.enemies.len() {
                    if self.enemies[idx].hp <= 0.0 {
                        continue;
                    }
                    let (amt, crit) = self.roll_hit(base * FLAME_MULT);
                    self.damage_enemy(idx, amt, crit, 11.0);
                    let e = &mut self.enemies[idx];
                    let (x, y) = (e.x, e.y);
                    let d = (x * x + y * y).sqrt();
                    let (ux, uy) = if d > 1e-6 { (x / d, y / d) } else { (1.0, 0.0) };
                    if d < SPAWN_RADIUS {
                        let (nx, ny) = clear_cone(ux * SPAWN_RADIUS, uy * SPAWN_RADIUS);
                        e.x = nx;
                        e.y = ny;
                    }
                    e.atk_timer = e.atk_timer.max(0.6);
                }
            }
            2 => {
                // Chain Lightning: leaps foe to foe, nearest first, paralyzing each
                let path = self.chain_path();
                self.spend(i);
                let (mut px, mut py) = (0.0, 0.0);
                let mut mult = CHAIN_FIRST;
                let stun = CHAIN_STUN * self.freeze_mult();
                for (k, &idx) in path.iter().enumerate() {
                    let (x, y) = (self.enemies[idx].x, self.enemies[idx].y);
                    self.push_ev(EV_ARC, x, y, k as f64, px, py);
                    let (amt, crit) = self.roll_hit(base * mult);
                    if self.enemies[idx].frozen <= 0.0 {
                        self.enemies[idx].stun = self.enemies[idx].stun.max(stun);
                    }
                    self.damage_enemy(idx, amt, crit, 12.0);
                    mult *= CHAIN_FALLOFF;
                    px = x;
                    py = y;
                }
            }
            3 => {
                // Frozen Hell: every foe on the field is locked in ice
                self.spend(i);
                let dur = self.ab(3).dur * self.freeze_mult();
                self.active[3] = dur;
                self.zero_r = SPAWN_RADIUS + 0.15;
                self.push_ev(EV_HELL, 0.0, 0.0, self.zero_r, dur, 0.0);
                for idx in 0..self.enemies.len() {
                    if self.enemies[idx].hp > 0.0 && self.freeze(idx, HELL_FREEZE) {
                        self.enemies[idx].shatter = base * HELL_SHATTER_MULT;
                        let (amt, crit) = self.roll_hit(base * HELL_CAST_MULT);
                        self.damage_enemy(idx, amt, crit, 8.0);
                    }
                }
            }
            _ => return false,
        }
        self.reap();
        true
    }
    fn spend(&mut self, i: usize) {
        self.mana = (self.mana - self.ab(i).cost).max(0.0);
        self.gcd = SORC_GCD;
        self.push_ev(EV_CAST, 0.0, 0.0, i as f64, CH_SORC as f64, 0.0);
    }
    fn sorc_step(&mut self, _dt: f64) {
        if self.active[3] <= 0.0 {
            self.zero_r = 0.0;
        }
    }
    /// Auto-cast (when enabled): spends mana sensibly, keeping a reserve for
    /// emergencies, with a short lockout so it never machine-guns his mana.
    fn sorc_autocast(&mut self) {
        if self.auto_lock > 0.0 || self.gcd > 0.0 || self.enemies.is_empty() {
            return;
        }
        let range = self.range();
        let mm = self.max_mana();
        let reserve = mm * 0.2;
        let near = |e: &Enemy, r: f64| e.hp > 0.0 && Game::dist(e) <= r;
        let nn = self.enemies.iter().filter(|e| near(e, range * 1.5)).count();
        let freezable = |e: &Enemy| e.hp > 0.0 && e.frozen <= 0.0 && e.thaw <= 0.0;
        let boss_free = self.enemies.iter().any(|e| e.boss && freezable(e) && near(e, range * 2.0));
        let n_free = self.enemies.iter().filter(|e| freezable(e) && near(e, range * 2.0)).count();
        let far = self.enemies.iter().filter(|e| e.hp > 0.0 && Game::dist(e) > range * 1.2).count();
        let chain_len = self.chain_path().len();
        let low = self.hp < self.max_hp() * 0.4;
        let ok = |g: &Game, i: usize, keep: f64| g.can_cast(i) && g.mana >= g.ab(i).cost + keep;
        let pick = if ok(self, 3, 0.0) && (n_free >= 8 || boss_free || low && n_free >= 2) {
            Some(3)
        } else if ok(self, 1, 0.0) && low && nn >= 3 {
            Some(1) // emergency: shove the crowd back to the edge
        } else if ok(self, 2, reserve) && chain_len >= 3 {
            Some(2)
        } else if ok(self, 0, reserve) && far >= 2 {
            Some(0)
        } else if self.mana >= mm * 0.92 {
            // about to cap: spend rather than waste the refill
            [2usize, 0].into_iter().find(|&i| ok(self, i, 0.0))
        } else {
            None
        };
        if let Some(i) = pick {
            if self.cast(i as u32) {
                self.auto_lock = 0.6;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_roundtrip() {
        let mut g = Game::new(7.0);
        g.debug_sim(120.0, true);
        let ex = g.export_save(123.0);
        let mut h = Game::new(1.0);
        assert!(h.import_save(&ex));
        assert_eq!(h.s.souls, g.s.souls);
        assert_eq!(h.s.up, g.s.up);
        assert!(!h.import_save("garbage!!"));
    }

    #[test]
    fn spawns_avoid_vertical_cones() {
        // direct sampling of the angle mapping, edges included
        for i in 0..=100_000 {
            let a = spawn_angle(i as f64 / 100_000.0 * 0.999_999_9);
            assert!(off_axis(a.cos(), a.sin()) >= CONE_HALF - 1e-9, "angle {} in cone", a.to_degrees());
        }
        // and the allowed arcs are covered evenly (no clumping at cone edges)
        let mut bins = [0u32; 36];
        let mut g = Game::new(11.0);
        for n in 0..40_000 {
            if n % 40 == 0 { g.enemies.clear(); }
            g.s.wave = if n % 9 == 0 { 10 + (n as u32 % 5) * 10 } else { 1 + n as u32 % 60 };
            g.spawn(n % 9 == 0);
            let e = g.enemies.last().unwrap();
            assert!(off_axis(e.x, e.y) >= CONE_HALF - 1e-9, "spawn at {:.2}°", e.y.atan2(e.x).to_degrees());
            let deg = e.y.atan2(e.x).to_degrees().rem_euclid(360.0);
            bins[(deg / 10.0) as usize % 36] += 1;
        }
        // bins fully inside the allowed arcs should hold about 1/(360-30)*10 of the spawns
        let full: Vec<u32> = (0..36).filter(|b| ![8, 9, 26, 27].contains(b)).map(|b| bins[b]).collect();
        let mean = full.iter().sum::<u32>() as f64 / full.len() as f64;
        for c in &full { assert!((*c as f64 - mean).abs() < mean * 0.15, "uneven bins {:?}", bins); }
        // a simulated fight: approaching foes (outside the melee crush) stay out of the cones
        let mut g = Game::new(5.0);
        g.debug_set_wave(40);
        let mut seen = 0usize;
        for _ in 0..6000 {
            g.tick(1.0 / 30.0);
            seen += g.enemies.len();
            for e in &g.enemies {
                if (e.x * e.x + e.y * e.y).sqrt() > CONE_FREE_R + 1e-6 {
                    assert!(off_axis(e.x, e.y) >= CONE_HALF - 1e-6, "foe drifted into a cone at d={:.2}", (e.x * e.x + e.y * e.y).sqrt());
                }
            }
        }
        assert!(seen > 10_000, "the fight should have had foes on the field ({})", seen);
    }

    #[test]
    fn characters_unlock_switch_persist() {
        let mut g = Game::new(9.0);
        assert_eq!(g.s.ch, 0);
        assert!(!g.set_char(1), "Daeva is locked before wave 50");
        g.debug_set_wave(50);
        assert!(g.s.unlocked & 2 != 0);
        g.s.cds = vec![10.0; N_AB];
        assert!(g.set_char(1));
        assert_eq!(g.s.cds, vec![0.0; N_AB], "cooldowns reset on switch");
        let j = g.save_json(1.0);
        let mut h = Game::new(1.0);
        assert!(h.load_json(&j));
        assert_eq!(h.s.ch, 1);
        // old saves (no ch/unlocked fields) default to the Asura, but unlock by best wave
        let mut o = Game::new(2.0);
        assert!(o.load_json(r#"{"v":1,"souls":5,"wave":12,"best_wave":12}"#));
        assert_eq!(o.s.ch, 0);
        assert_eq!(o.s.unlocked, 1);
        assert!(o.load_json(r#"{"v":1,"souls":5,"wave":60,"best_wave":72}"#));
        assert_eq!(o.s.unlocked & 2, 2, "best wave >= 50 unlocks her immediately");
    }

    #[test]
    fn daeva_abilities_work() {
        let mut g = Game::new(11.0);
        g.debug_set_wave(60);
        assert!(g.set_char(1));
        for _ in 0..30 { for k in 0..10 { g.buy(k, 1); } }
        g.debug_set_souls(1e30);
        for _ in 0..60 { for k in 0..10 { g.buy(k, 3); } }
        for _ in 0..300 { g.tick(1.0 / 30.0); }
        // Tidal Surge pushes foes back and slows them
        let before: Vec<(u32, f64)> = g.enemies.iter().map(|e| (e.id, (e.x * e.x + e.y * e.y).sqrt())).collect();
        assert!(g.cast(0));
        let moved = g.enemies.iter().filter(|e| e.slow > 3.0 && before.iter().any(|(id, d)| *id == e.id && (e.x * e.x + e.y * e.y).sqrt() > *d)).count();
        assert!(g.enemies.is_empty() || moved > 0, "tide pushed foes");
        // Healing Rain heals over time
        g.hp = g.max_hp() * 0.3;
        let h0 = g.hp;
        assert!(g.cast(1));
        g.tick(2.0);
        assert!(g.hp > h0 + g.max_hp() * 0.15, "rain heals");
        // Whirlpool opens with a radius
        assert!(g.cast(2));
        assert!(g.pool_r > 0.0);
        // Lotus shields: damage taken is reduced
        assert!(g.cast(3));
        assert!(g.active[3] > 0.0);
        let f = g.frame();
        assert_eq!(f[17], 1.0);
        assert!(f[18] > 0.0 && f[19] > 0.0 && f[20] > 0.0);
        assert_eq!(f[7], 0.0, "no Asura storm visuals while she is active");
    }

    fn sorc_game(seed: f64) -> Game {
        let mut g = Game::new(seed);
        g.debug_set_wave(100);
        assert!(g.set_char(CH_SORC));
        g
    }

    #[test]
    fn sorcerer_unlocks_at_100_and_loads_from_old_saves() {
        let mut g = Game::new(3.0);
        g.debug_set_wave(99);
        assert!(!g.set_char(CH_SORC), "locked before wave 100");
        g.debug_set_wave(100);
        assert!(g.s.unlocked & 4 != 0);
        assert!(g.set_char(CH_SORC));
        // an old save with only 10 upgrades / 7 shop items and no mana fields
        let mut o = Game::new(4.0);
        assert!(o.load_json(r#"{"v":1,"souls":5,"wave":120,"best_wave":130,"up":[1,2,3,4,5,6,7,8,9,10],"shop":[1,1,1,1,1,1,1],"ch":1,"unlocked":3}"#));
        assert_eq!(o.s.up.len(), N_UP);
        assert_eq!(o.s.shop.len(), N_SHOP);
        assert_eq!(o.s.up[UP_MANAPOOL], 0);
        assert_eq!(o.s.shop[SHOP_ABILITY], 0);
        assert!(o.s.unlocked & 4 != 0, "best wave >= 100 unlocks him at once");
        assert_eq!(o.s.ch, 1);
        assert!(o.mana > 0.0);
    }

    #[test]
    fn mana_refills_on_strikes_and_abilities_spend_it_without_cooldowns() {
        let mut g = sorc_game(5.0);
        g.mana = 0.0;
        // strikes refill mana, once per swing
        let mut swings = 0;
        for _ in 0..600 {
            let ev_before = g.events.len();
            g.tick(1.0 / 30.0);
            swings += g.events[ev_before..].chunks(EVENT_STRIDE).filter(|c| c[0] == EV_ATTACK).count();
            if swings >= 3 { break; }
        }
        assert!(swings >= 3, "he should have swung");
        let expect = (g.mana_per_strike() * swings as f64).min(g.max_mana());
        assert!((g.mana - expect).abs() < 1e-6, "mana {} vs {} after {} swings", g.mana, expect, swings);
        // abilities: no cooldown, only mana and a short global lockout
        g.mana = g.max_mana();
        g.debug_set_wave(100);
        for _ in 0..200 { g.tick(1.0 / 30.0); if g.enemies.len() >= 3 { break; } }
        let m0 = g.mana;
        assert!(g.cast(1), "flame wave casts");
        assert!((m0 - g.mana - 35.0).abs() < 1e-9);
        assert!(!g.cast(1), "global lockout blocks an instant double tap");
        g.gcd = 0.0;
        assert!(g.cast(1), "no cooldown: casts again once the lockout passes");
        assert_eq!(g.s.cds, vec![0.0; N_AB]);
        g.gcd = 0.0;
        g.mana = 34.0;
        assert!(!g.can_cast(1), "not enough mana");
        assert!(!g.cast(1));
        assert_eq!(g.mana, 34.0);
        // Frozen Hell can be cast again at once (no cooldown) given the mana
        g.mana = g.max_mana();
        assert!(g.cast(3));
        assert!(g.active[3] >= 3.0 && g.zero_r > SPAWN_RADIUS);
        g.gcd = 0.0;
        g.mana = g.max_mana();
        assert!(g.can_cast(3), "no cooldown on Frozen Hell either");
    }

    /// a sorcerer facing hand-placed, unkillable foes and nothing else
    fn sorc_field(seed: f64, pts: &[(f64, f64)]) -> Game {
        let mut g = sorc_game(seed);
        g.enemies.clear();
        g.to_spawn = 0; g.boss_pending = false;
        for &(x, y) in pts {
            g.spawn(false);
            let e = g.enemies.last_mut().unwrap();
            e.x = x; e.y = y; e.hp = 1e15; e.max_hp = 1e15;
        }
        g.mana = g.max_mana();
        g.events.clear();
        g
    }
    fn hits_of(g: &Game, kind: f64) -> Vec<(f64, f64, f64, bool)> {
        g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_HIT && c[5] == kind).map(|c| (c[1], c[2], c[3], c[4] > 0.0)).collect()
    }

    #[test]
    fn arcane_bolts_strike_the_three_furthest() {
        let mut g = sorc_field(11.0, &[(0.1, 0.0), (0.3, 0.1), (-0.5, 0.2), (0.0, 0.9), (0.8, -0.3), (-0.2, -0.15)]);
        assert!(g.cast(0));
        let mut xs: Vec<(f64, f64)> = hits_of(&g, 10.0).iter().map(|h| (h.0, h.1)).collect();
        xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        assert_eq!(xs.len(), 3, "three bolts");
        let want = [(-0.5, 0.2), (0.0, 0.9), (0.8, -0.3)];
        for (h, w) in xs.iter().zip(want.iter()) {
            assert!((h.0 - w.0).abs() < 0.02 && (h.1 - w.1).abs() < 0.02, "bolt hit {:?} wanted {:?}", h, w);
        }
        assert_eq!(g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_BOLT).count(), 3);
        // fewer foes than bolts: each foe still takes exactly one
        let mut g = sorc_field(12.0, &[(0.4, 0.1)]);
        assert!(g.cast(0));
        assert_eq!(hits_of(&g, 10.0).len(), 1);
        // nobody on the field: no cast, no mana spent
        let mut g = sorc_field(13.0, &[]);
        let m = g.mana;
        assert!(!g.cast(0));
        assert_eq!(g.mana, m);
    }

    #[test]
    fn flame_wave_drives_every_foe_to_the_spawn_edge() {
        let mut g = sorc_field(14.0, &[(0.1, 0.02), (0.3, 0.2), (-0.5, 0.25), (0.6, -0.4)]);
        g.s.wave = 100; g.spawn(true);
        { let e = g.enemies.last_mut().unwrap(); e.x = -0.2; e.y = -0.1; e.hp = 1e15; e.max_hp = 1e15; }
        let hp: Vec<f64> = g.enemies.iter().map(|e| e.hp).collect();
        assert!(g.cast(1));
        for (e, h0) in g.enemies.iter().zip(hp) {
            let d = Game::dist(e);
            assert!((d - SPAWN_RADIUS).abs() < 0.03, "foe pushed to the edge, got {} (boss {})", d, e.boss);
            let dealt = h0 - e.hp;
            assert!(dealt > 0.0 && dealt < g.damage() * g.crit_mult(), "very low damage: {}", dealt);
        }
        assert!(g.events.chunks(EVENT_STRIDE).any(|c| c[0] == EV_FLAME));
    }

    #[test]
    fn chain_lightning_leaps_nearest_first_with_falling_damage() {
        // a line of foes stepping away from him, plus one far off that it cannot reach
        let mut g = sorc_field(15.0, &[(0.3, 0.0), (0.15, 0.0), (0.45, 0.0), (0.6, 0.0), (0.75, 0.0), (0.9, 0.0), (-1.0, 0.0)]);
        assert!(g.cast(2));
        let arcs: Vec<Vec<f64>> = g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_ARC).map(|c| c.to_vec()).collect();
        assert_eq!(arcs.len(), 5, "five foes at most");
        let xs: Vec<f64> = arcs.iter().map(|c| c[1]).collect();
        for (x, w) in xs.iter().zip([0.15, 0.3, 0.45, 0.6, 0.75]) { assert!((x - w).abs() < 0.02, "order {:?}", xs); }
        assert_eq!((arcs[0][4], arcs[0][5]), (0.0, 0.0), "the first leaps from his hands");
        assert!((arcs[1][4] - 0.15).abs() < 0.02, "each next leaps from the last");
        let hits = hits_of(&g, 12.0);
        assert_eq!(hits.len(), 5);
        let base = g.damage() * g.ability_power();
        for (k, h) in hits.iter().enumerate() {
            let want = base * 1.2 * 0.6f64.powi(k as i32) * if h.3 { g.crit_mult() } else { 1.0 };
            assert!((h.2 / want - 1.0).abs() < 0.11, "hit {} = {} want ~{} (±variance)", k, h.2, want);
        }
        // each struck foe is paralyzed for ~0.5 s: it does not move
        let struck: Vec<usize> = (0..g.enemies.len()).filter(|&j| g.enemies[j].stun > 0.0).collect();
        assert_eq!(struck.len(), 5);
        assert!(struck.iter().all(|&j| (g.enemies[j].stun - 0.5).abs() < 1e-9));
        assert!(g.enemies()[struck[0] * ENEMY_STRIDE + 10] <= -100.0, "the feed marks paralysis");
        let p0: Vec<(f64, f64)> = struck.iter().map(|&j| (g.enemies[j].x, g.enemies[j].y)).collect();
        for _ in 0..10 { g.tick(1.0 / 30.0); }
        for (k, &j) in struck.iter().enumerate() { assert!((g.enemies[j].x - p0[k].0).abs() < 0.02, "paralyzed foes hold still"); }
        for _ in 0..20 { g.tick(1.0 / 30.0); }
        assert!(struck.iter().all(|&j| g.enemies[j].stun == 0.0), "paralysis wears off");
        // stops early when nobody is left to leap to
        let mut g = sorc_field(16.0, &[(0.2, 0.0), (0.3, 0.05)]);
        assert!(g.cast(2));
        assert_eq!(g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_ARC).count(), 2);
    }

    #[test]
    fn frozen_hell_freezes_all_then_shatters() {
        let pts: Vec<(f64, f64)> = (0..10).map(|k| { let a = k as f64 * 0.6 + 0.3; let r = 0.2 + 0.09 * k as f64; (a.cos() * r, a.sin() * r) }).collect();
        let mut g = sorc_field(17.0, &pts);
        g.s.wave = 100; g.spawn(true);
        { let e = g.enemies.last_mut().unwrap(); e.x = 0.5; e.y = 0.3; e.hp = 1e15; e.max_hp = 1e15; }
        assert!(g.cast(3));
        for e in &g.enemies {
            if e.boss { assert!((e.frozen - 1.5).abs() < 1e-9, "bosses held half as long: {}", e.frozen); }
            else { assert!((e.frozen - 3.0).abs() < 1e-9, "every foe frozen 3 s: {}", e.frozen); }
        }
        let hp0 = g.hp;
        g.enemies[0].x = 0.08; g.enemies[0].y = 0.0; g.enemies[0].atk_timer = 0.0;
        g.tick(1.0 / 30.0); // hand-placed foes inside the keep-clear cones get nudged out once
        let p0: Vec<(f64, f64)> = g.enemies.iter().map(|e| (e.x, e.y)).collect();
        for _ in 0..30 { g.tick(1.0 / 30.0); }
        assert!(g.hp >= hp0 - 1e-9, "frozen foes do not attack");
        for (k, e) in g.enemies.iter().enumerate() { if !e.boss { assert_eq!((e.x, e.y), p0[k], "frozen foes do not move"); } }
        assert!(g.enemies()[10] < 0.0 && g.enemies()[10] > -100.0);
        // recasting while the ice holds does not extend it (no perma-freeze)
        g.gcd = 0.0; g.mana = g.max_mana();
        let left = g.enemies[0].frozen;
        assert!(g.cast(3));
        assert!((g.enemies[0].frozen - left).abs() < 1e-9);
        // the ice shatters on release, for damage (keep him alive through the boss's blows)
        g.events.clear();
        for e in g.enemies.iter_mut() { e.dmg = 0.0; }
        for _ in 0..70 { g.tick(1.0 / 30.0); }
        let sh = g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_SHATTER).count();
        assert_eq!(sh, g.enemies.len(), "every block shatters as it lets go");
        assert!(!hits_of(&g, 9.0).is_empty(), "shatter damage");
        assert!(g.enemies.iter().all(|e| e.frozen == 0.0));
        // just-thawed foes resist fresh ice for a moment
        g.gcd = 0.0; g.mana = g.max_mana();
        assert!(g.cast(3));
        assert!(g.enemies.iter().filter(|e| !e.boss).all(|e| e.frozen == 0.0), "thaw grace");
    }

    #[test]
    fn mana_upgrades_only_for_the_sorcerer_and_persist() {
        let mut g = Game::new(8.0);
        g.debug_set_wave(100);
        g.debug_set_souls(1e9);
        let ui: serde_json::Value = serde_json::from_str(&g.ui(1)).unwrap();
        let ups = ui["ups"].as_array().unwrap();
        assert_eq!(ups.len(), N_UP);
        assert_eq!(ups[UP_MANAPOOL]["only"], "sorcerer");
        assert_eq!(ups[UP_MANAREGEN]["only"], "sorcerer");
        assert_eq!(ups[0]["only"], "");
        assert!(g.set_char(CH_SORC));
        let m0 = g.max_mana();
        let r0 = g.mana_per_strike();
        assert!(g.buy(UP_MANAPOOL as u32, 5) == 5 && g.buy(UP_MANAREGEN as u32, 5) == 5);
        assert!((g.max_mana() - m0 * 1.6).abs() < 1e-9);
        assert!((g.mana_per_strike() - r0 * 1.6).abs() < 1e-9);
        assert!(g.set_char(CH_ASURA) && g.set_char(CH_SORC));
        assert_eq!(g.s.up[UP_MANAPOOL], 5, "levels persist across switching");
        // the mana beads in the shrine show once he is unlocked
        let mut h = Game::new(9.0);
        let ui: serde_json::Value = serde_json::from_str(&h.ui(1)).unwrap();
        assert_eq!(ui["shop"][SHOP_MANAPOOL]["shown"], false);
        assert_eq!(ui["shop"][SHOP_ABILITY]["shown"], true);
        h.debug_set_wave(100);
        let ui: serde_json::Value = serde_json::from_str(&h.ui(1)).unwrap();
        assert_eq!(ui["shop"][SHOP_MANAPOOL]["shown"], true);
        h.s.beads = 1e6;
        assert!(h.buy_shop(SHOP_MANAPOOL as u32) && h.buy_shop(SHOP_MANAREGEN as u32));
        assert!((h.max_mana() - 115.0).abs() < 1e-9 && (h.mana_per_strike() - 6.9).abs() < 1e-9);
    }

    #[test]
    fn ability_power_strengthens_every_character() {
        // measure one ability hit per character with and without Ability Power
        fn wrath_hit(ap: u32, ch: u32) -> f64 {
            let mut g = Game::new(21.0);
            g.debug_set_wave(100);
            assert!(g.set_char(ch));
            g.s.shop[SHOP_ABILITY] = ap;
            g.enemies.clear(); g.to_spawn = 0; g.boss_pending = false;
            g.spawn(false);
            g.enemies[0].x = 0.2; g.enemies[0].y = 0.15; g.enemies[0].hp = 1e15; g.enemies[0].max_hp = 1e15;
            g.mana = g.max_mana();
            g.events.clear();
            assert!(g.cast(if ch == CH_SORC { 1 } else { 0 }));
            let hits: Vec<f64> = g.events.chunks(EVENT_STRIDE).filter(|c| c[0] == EV_HIT && c[4] == 0.0).map(|c| c[3]).collect();
            assert!(!hits.is_empty());
            hits[0]
        }
        for ch in [CH_ASURA, CH_DAEVA, CH_SORC] {
            let a = wrath_hit(0, ch);
            let b = wrath_hit(5, ch);
            let ratio = b / a;
            // same seed -> same variance roll; +10% per level
            assert!((ratio - 1.5).abs() < 0.12, "char {} ability power ratio {}", ch, ratio);
        }
        // heals scale too (Blood Beads)
        let mut g = Game::new(2.0);
        g.debug_set_wave(30);
        g.s.shop[SHOP_ABILITY] = 10;
        g.hp = 1.0;
        let mh = g.max_hp();
        assert!(g.cast(2));
        assert!(g.hp >= mh * 0.99, "beads heal scaled (capped at max)");
    }

    #[test]
    fn balance_report() {
        let mut g = Game::new(3.0);
        for m in [1.0, 5.0, 15.0, 30.0, 60.0, 120.0] {
            let prev: f64 = if m == 1.0 { 0.0 } else { 0.0 };
            let _ = prev;
            let r = g.debug_sim(if m == 1.0 { 60.0 } else { 0.0 }, true);
            let _ = r;
        }
        let mut g = Game::new(3.0);
        let mut elapsed = 0.0;
        for target in [60.0, 300.0, 900.0, 1800.0, 3600.0, 7200.0] {
            let r = g.debug_sim(target - elapsed, true);
            elapsed = target;
            println!("t={:>5}s {}", target, r);
        }
        println!("rebirth beads now: {}", g.rebirth_beads());
    }
}

#[cfg(test)]
mod balance {
    use super::*;
    // cargo test --release balance_compare -- --ignored --nocapture
    #[test]
    #[ignore]
    fn balance_compare() {
        for ch in 0..3u32 {
            for &(start, secs) in &[(1u32, 1800.0), (50, 1800.0)] {
                let mut g = Game::new(7.0);
                g.debug_set_wave(100);
                g.set_char(ch);
                g.s.wave = start; g.s.max_wave = start; g.start_wave();
                if start == 50 { g.s.souls = 5e7; }
                g.s.auto = true;
                let r = g.debug_sim(secs, true);
                println!("char {} start {} -> {}", ch, start, &r[..r.find("\"up\"").unwrap_or(r.len())]);
            }
        }
    }
}
