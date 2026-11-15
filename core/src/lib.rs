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
const ASURA_RADIUS: f64 = 0.075;
pub const N_UP: usize = 10;
pub const N_SHOP: usize = 7;
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
];

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
];

struct AbDef {
    key: &'static str,
    unlock: u32,
    cd: f64,
    dur: f64,
}

const ABS: [AbDef; N_AB] = [
    AbDef { key: "wrath", unlock: 5, cd: 30.0, dur: 0.0 },
    AbDef { key: "storm", unlock: 15, cd: 60.0, dur: 8.0 },
    AbDef { key: "beads", unlock: 25, cd: 90.0, dur: 15.0 },
    AbDef { key: "sixarms", unlock: 40, cd: 120.0, dur: 10.0 },
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
        };
        g.hp = g.max_hp();
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
        if self.active[2] > 0.0 {
            m *= 2.0;
        }
        m
    }
    pub fn damage(&self) -> f64 {
        let l = self.s.up[0] as f64;
        let mut d = 5.0 * (1.0 + l) * 1.07f64.powf(l) * 2f64.powi((self.s.up[0] / 25) as i32);
        d *= self.bead_dmg_mult();
        if self.active[3] > 0.0 {
            d *= 2.0;
        }
        d
    }
    pub fn attack_speed(&self) -> f64 {
        let mut a = (1.0 + 0.075 * self.s.up[1] as f64) * (1.0 + 0.06 * self.s.shop[3] as f64);
        if self.active[1] > 0.0 {
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
        1 + self.s.up[5] + if self.active[3] > 0.0 { 5 } else { 0 }
    }
    pub fn max_hp(&self) -> f64 {
        let l = self.s.up[6] as f64;
        100.0 * (1.0 + 0.15 * l) * 1.1f64.powf(l) * (1.0 + 0.5 * self.s.shop[2] as f64)
    }
    pub fn regen(&self) -> f64 {
        let frac = (0.005 + 0.001 * self.s.up[7] as f64).min(0.03);
        self.max_hp() * frac
    }
    pub fn siphon(&self) -> f64 {
        0.005 * self.s.up[9] as f64
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
        let a = self.rng.next() * std::f64::consts::TAU;
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
        if self.s.autocast {
            for i in 0..N_AB {
                if self.can_cast(i) && (i != 0 || !self.enemies.is_empty()) && (i != 2 || self.hp < self.max_hp() * 0.6 || !self.enemies.is_empty()) {
                    // only cast offensive skills when foes are near
                    let near = self.enemies.iter().any(|e| (e.x * e.x + e.y * e.y).sqrt() < self.range() * 1.4);
                    if near || i == 2 {
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

        // regen
        let maxhp = self.max_hp();
        self.hp = (self.hp + self.regen() * dt).min(maxhp);

        // enemy movement & attacks
        let mut hurt = 0.0;
        let n = self.enemies.len();
        for i in 0..n {
            let (ex, ey, size) = (self.enemies[i].x, self.enemies[i].y, self.enemies[i].size);
            let d = (ex * ex + ey * ey).sqrt().max(1e-6);
            let stop = ASURA_RADIUS + size * 0.35;
            let e = &mut self.enemies[i];
            e.age += dt;
            e.flash = (e.flash - dt).max(0.0);
            e.slow = (e.slow - dt).max(0.0);
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
        // light separation so crowds fan out around him
        for i in 0..n {
            for j in (i + 1)..n {
                let dx = self.enemies[j].x - self.enemies[i].x;
                let dy = self.enemies[j].y - self.enemies[i].y;
                let min = (self.enemies[i].size + self.enemies[j].size) * 0.32;
                let d2 = dx * dx + dy * dy;
                if d2 < min * min && d2 > 1e-9 {
                    let d = d2.sqrt();
                    let push = (min - d) * 0.5;
                    let (ux, uy) = (dx / d * push, dy / d * push);
                    self.enemies[i].x -= ux;
                    self.enemies[i].y -= uy;
                    self.enemies[j].x += ux;
                    self.enemies[j].y += uy;
                }
            }
        }
        if hurt > 0.0 {
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
        let e = &mut self.enemies[idx];
        let dealt = amount.min(e.hp.max(0.0));
        e.hp -= amount;
        e.flash = 0.12;
        let (x, y) = (e.x, e.y);
        // tiny knockback
        let d = (x * x + y * y).sqrt().max(1e-6);
        if !e.boss {
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
        for t in 0..n {
            let idx = cands[t].1;
            let (amt, crit) = self.roll_hit(base);
            self.damage_enemy(idx, amt, crit, 0.0);
        }
        // Storm: lightning chains to a foe anywhere on the field
        if self.active[1] > 0.0 {
            let alive: Vec<usize> = (0..self.enemies.len())
                .filter(|&i| self.enemies[i].hp > 0.0 && (self.enemies[i].x.powi(2) + self.enemies[i].y.powi(2)).sqrt() < 1.25)
                .collect();
            if !alive.is_empty() {
                let pick = alive[(self.rng.next() * alive.len() as f64) as usize % alive.len()];
                let (amt, crit) = self.roll_hit(base * 0.6);
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
        i < N_AB && self.s.best_wave >= ABS[i].unlock && self.s.cds[i] <= 0.0
    }

    pub fn cast(&mut self, i: u32) -> bool {
        let i = i as usize;
        if !self.can_cast(i) {
            return false;
        }
        self.s.cds[i] = ABS[i].cd * self.cd_mult();
        self.active[i] = ABS[i].dur;
        self.push_ev(EV_CAST, 0.0, 0.0, i as f64, 0.0, 0.0);
        match i {
            0 => {
                // Wrath Burst — radial shockwave
                let radius = self.range() * 1.6;
                self.push_ev(EV_WRATH, 0.0, 0.0, radius, 0.0, 0.0);
                let base = self.damage() * 20.0;
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
                let heal = mh * 0.6;
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
        self.s.souls = (self.s.souls - cost).max(0.0);
        self.s.up[i] += n;
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
                e.slow as f32,
            ]);
        }
        v
    }

    /// Drain queued events: [type, x, y, a, b, c] * n
    pub fn drain_events(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.events)
    }

    /// Per-frame scalars: [hpFrac, range, atkAnim, face, wave, waveKilled, waveTotal,
    ///   stormLeft, beadsLeft, armsLeft, waveIntro, souls, isBossWave, hp, maxHp]
    pub fn frame(&self) -> Vec<f64> {
        vec![
            (self.hp / self.max_hp()).clamp(0.0, 1.0),
            self.range(),
            self.atk_anim,
            self.face,
            self.s.wave as f64,
            self.wave_killed as f64,
            self.wave_total as f64,
            self.active[1],
            self.active[2],
            self.active[3],
            self.wave_intro.max(0.0),
            self.s.souls,
            if self.is_boss_wave() { 1.0 } else { 0.0 },
            self.hp.max(0.0),
            self.max_hp(),
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
                serde_json::json!({
                    "key": d.key, "lvl": self.s.shop[i], "max": d.max, "cost": c,
                    "afford": !maxed && self.s.beads >= c, "maxed": maxed,
                })
            })
            .collect();
        let abs: Vec<serde_json::Value> = (0..N_AB)
            .map(|i| {
                let d = &ABS[i];
                serde_json::json!({
                    "key": d.key, "unlock": d.unlock, "unlocked": self.s.best_wave >= d.unlock,
                    "cd": self.s.cds[i], "cdMax": d.cd * self.cd_mult(), "active": self.active[i], "dur": d.dur,
                })
            })
            .collect();
        let (sps, _) = self.estimate_rates();
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
                        let (n, c) = self.up_quote(i, 1);
                        if n == 0 {
                            continue;
                        }
                        let w = match i { 0 => 1.0, 6 => 1.6, 7 => 2.5, 8 => 1.5, _ => 1.2 };
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
                for i in 0..N_AB {
                    if self.can_cast(i) {
                        self.cast(i as u32);
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
        self.start_wave();
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
