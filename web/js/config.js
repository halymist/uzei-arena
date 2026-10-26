// Spell tuning shared by prediction code. The server has its own copy of the
// numbers that matter for authority (damage, mana, stuns).

export const MOVE_SPEED = 7.2;
export const PLAYER_RADIUS = 0.6;
export const SEND_HZ = 20;
export const INTERP_DELAY_MS = 100; // two server snapshots of buffer

export const AA = { speedStart: 14, speedMax: 24, accel: 28, range: 17, radius: 0.28, dmg: 24, cooldownMs: 700 };
export const Q = { speedStart: 27, speedMax: 31, accel: 0, range: 19, radius: 0.24, dmg: 6, cooldownMs: 5600, cost: 35, burstMs: 760, intervalMs: 130 };
export const W = { speedMult: 1.3, durationMs: 8000, cost: 30 };
export const E = { range: 7.5, cooldownMs: 8000, outMs: 80, inMs: 140, cost: 50 };
export const R = { speedStart: 9, speedMax: 36, accel: 18, range: 60, radius: 1.45, dmg: 100, cooldownMs: 2500, cost: 75, castMs: 1000 };
export const C = { cooldownMs: 7000, cost: 30, dashDist: 10.2, dashMs: 220 };
export const V = { cooldownMs: 13000, cost: 55, durationMs: 5000, radius: 5.7 };
export const X = { cooldownMs: 9000, cost: 45, speedStart: 22, speedMax: 26, accel: 0, range: 22, radius: 0.72, dmg: 12 };
export const Z = { cooldownMs: 3000, cost: 50, delayMs: 700, lingerMs: 2000, tickMs: 250, lingerFactor: 0.125, castRange: 13, radius: 1.55, dmg: 36 };
export const S = { cooldownMs: 12000, cost: 40 };
export const F = { cooldownMs: 14000, cost: 45, durationMs: 6000, radius: 5.5, periodMs: 2500 };
export const G_WAVE = { cooldownMs: 9800, cost: 40, speed: 8.5, range: 19, baseRadius: 0.24, maxRadius: 1.35, dmg: 18 };

export const BUFF_DURATION_MS = 30000;
export const PICKUP_RADIUS = 0.6;
export const POINT_COLLECT_MS = 1200;
export const POINT_COLLECT_RANGE = 1.5;
export const REDITEL_BEAM_WARN_MS = 800;
export const REDITEL_BEAM_WARN_RANGE = 44;

export const PLAYER_MODEL_COLORS = [0x58c7ff, 0xff7b7b, 0x7be39a, 0xffd26b];

export const SPELL_DEFS = {
  aa: { id: 'aa', name: 'Útok', short: 'LMB', cost: 0, desc: 'Základní střela. Levé tlačítko myši.' },
  q: { id: 'q', name: 'Salva', cost: Q.cost, desc: 'Dávka rychlých projektilů směrem k myši.' },
  w: { id: 'w', name: 'Sprint', cost: W.cost, desc: 'Na 8 s o 30 % rychlejší pohyb.' },
  e: { id: 'e', name: 'Teleport', cost: E.cost, desc: 'Skok až 7,5 jednotek směrem k myši.' },
  r: { id: 'r', name: 'Střela', cost: R.cost, desc: 'Sekundu nabíjíš, pak velký projektil skrz zdi.' },
  c: { id: 'c', name: 'Náraz', cost: C.cost, desc: 'Výpad vpřed, zasažení jsou omráčeni.' },
  v: { id: 'v', name: 'Pole', cost: V.cost, desc: 'Aura 5 s: zraňuje okolí, část vrací jako životy.' },
  x: { id: 'x', name: 'Omráčení', cost: X.cost, desc: 'Projektil, který cíl na 1,6 s zastaví.' },
  z: { id: 'z', name: 'Dopad', cost: Z.cost, desc: 'Výbuch na pozici myši po krátké prodlevě.' },
  s: { id: 's', name: 'Štít', cost: S.cost, desc: 'Štít za 30 % max HP na 5 s, blokuje omráčení.' },
  f: { id: 'f', name: 'Orbit', cost: F.cost, desc: 'Tři koule krouží kolem tebe 6 s.' },
  g: { id: 'g', name: 'Vlna', cost: G_WAVE.cost, desc: 'Pomalá rostoucí vlna, prochází nepřáteli.' },
};

export const SPELL_COLORS = {
  aa: 0xa6f0ff, q: 0xffe48a, r: 0xff7df6, x: 0x89ffde, g: 0x9ce8ff,
  reditel: 0xffc46b, reditel_beam: 0xff6d8a, curda_stun: 0x8b7cff, curda_salva: 0xffb06b,
};

export const BUFF_DEFS = {
  speed: { label: 'Rychlost', color: '#4fc3ff', desc: '+10 % rychlost' },
  hp: { label: 'Životy', color: '#ff6e8a', desc: '+20 % max HP' },
  mana: { label: 'Mana', color: '#6bb7ff', desc: '+20 % max mana' },
  dmg: { label: 'Poškození', color: '#ff9b5c', desc: '+10 % poškození' },
};

export const DAY_NAMES = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
export const SLOT_KEYS = ['q', 'w', 'e', 'r', 'd', 'f'];
export const BASE_SPELLS = ['aa', 'q', 'w'];

// Mirror of deriveStats in talents.go.
export function deriveStats(talentIds, talentById) {
  const d = {
    dmgMult: 1, speedMult: 1, cdrMult: 1, hpMult: 1, manaMult: 1, regenMult: 1, sprintMult: 1,
    rDmgMult: 1, eRangeMult: 1, lifesteal: 0, shieldPct: 0.30,
    salvaExtra: 0, spells: new Set(BASE_SPELLS),
  };
  for (const id of talentIds || []) {
    const t = talentById.get(id);
    if (!t) continue;
    d.dmgMult += t.dmgPct || 0;
    d.speedMult += t.speedPct || 0;
    d.cdrMult -= t.cdrPct || 0;
    d.hpMult += t.hpPct || 0;
    d.manaMult += t.manaPct || 0;
    d.regenMult += t.regenPct || 0;
    d.sprintMult += t.sprintPct || 0;
    d.rDmgMult += t.rDmgPct || 0;
    d.eRangeMult += t.eRangePct || 0;
    d.lifesteal += t.lifestealPct || 0;
    d.shieldPct += t.shieldPct || 0;
    d.salvaExtra += t.salvaExtra || 0;
    if (t.spell) d.spells.add(t.spell);
  }
  if (d.cdrMult < 0.4) d.cdrMult = 0.4;
  return d;
}
