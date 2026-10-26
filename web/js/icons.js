// Inline SVG icon set (24x24, stroke based) for spells and talent effects.
// No asset files: everything is a string.

const wrap = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // ---- spells
  aa: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  q: wrap('<path d="M4 18 10 12M6 20l8-8M4 14l4-4"/><circle cx="17" cy="7" r="2"/><circle cx="19.5" cy="12.5" r="1.5"/><circle cx="12.5" cy="4.5" r="1.5"/>'),
  w: wrap('<path d="M3 8h9M5 12h11M3 16h7"/><path d="M15 6l5 6-5 6"/>'),
  e: wrap('<circle cx="6" cy="16" r="3"/><circle cx="18" cy="8" r="3"/><path d="M9 14l6-4"/><path d="M13 8h5v5"/>'),
  r: wrap('<path d="M4 20 14 10"/><path d="M12 6l6 6 3-9z"/><path d="M4 20l3-1-2-2z"/>'),
  c: wrap('<path d="M3 12h11"/><path d="M10 7l5 5-5 5"/><path d="M17 5v14M21 8v8"/>'),
  v: wrap('<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v2M12 18v2"/>'),
  x: wrap('<path d="M13 2 5 13h6l-1 9 9-12h-6z"/>'),
  z: wrap('<circle cx="12" cy="14" r="6"/><circle cx="12" cy="14" r="2"/><path d="M12 3v3M8 5l1.5 2M16 5l-1.5 2"/>'),
  s: wrap('<path d="M12 3l8 3v6c0 4.5-3.4 7.6-8 9-4.6-1.4-8-4.5-8-9V6z"/><path d="M12 8v6M9 11h6"/>'),
  f: wrap('<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 4"/><circle cx="12" cy="4" r="2"/><circle cx="5" cy="16" r="2"/><circle cx="19" cy="16" r="2"/>'),
  g: wrap('<path d="M3 13c3-5 6-5 9 0s6 5 9 0"/><path d="M3 18c3-5 6-5 9 0s6 5 9 0"/><path d="M3 8c3-5 6-5 9 0s6 5 9 0"/>'),

  // ---- passive effects
  dmg: wrap('<path d="M14 4l6 6-9 9-6-6z"/><path d="M5 13l-2 2 6 6 2-2"/><path d="M15 9l-5 5"/>'),
  speed: wrap('<path d="M4 7h10M4 12h14M4 17h8"/><path d="M15 15l5-3-5-3"/>'),
  cdr: wrap('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 3h6"/>'),
  hp: wrap('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  mana: wrap('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>'),
  regen: wrap('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M12 8v6M9 11h6"/>'),
  sprint: wrap('<path d="M13 4l-3 7h5l-4 9"/><path d="M4 10h5M3 14h4"/>'),
  lifesteal: wrap('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9 14l2 3 2-3"/>'),
  shield: wrap('<path d="M12 3l8 3v6c0 4.5-3.4 7.6-8 9-4.6-1.4-8-4.5-8-9V6z"/><path d="M8 12l3 3 5-6"/>'),
  rdmg: wrap('<path d="M3 21l9-9"/><path d="M10 4l10 10 1-11z"/><path d="M3 21l4-1-3-3z"/>'),
  erange: wrap('<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M8 12h8"/><path d="M13 9l3 3-3 3"/>'),
  salva: wrap('<path d="M3 20l6-6M5 22l6-6"/><circle cx="14" cy="10" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="12" cy="5" r="1.6"/>'),
  star: wrap('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>'),
};

export function spellIcon(kind) {
  return ICONS[kind] || ICONS.star;
}

// Pick an icon for a talent from what it unlocks or boosts.
export function talentIcon(t) {
  if (t.spell) return spellIcon(t.spell);
  if (t.salvaExtra) return ICONS.salva;
  if (t.rDmgPct) return ICONS.rdmg;
  if (t.eRangePct) return ICONS.erange;
  if (t.lifestealPct) return ICONS.lifesteal;
  if (t.shieldPct) return ICONS.shield;
  if (t.regenPct) return ICONS.regen;
  if (t.sprintPct) return ICONS.sprint;
  if (t.dmgPct) return ICONS.dmg;
  if (t.cdrPct) return ICONS.cdr;
  if (t.hpPct) return ICONS.hp;
  if (t.manaPct) return ICONS.mana;
  if (t.speedPct) return ICONS.speed;
  return ICONS.star;
}
