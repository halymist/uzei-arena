import { G, me, send, serverNow } from './state.js';
import { SPELL_DEFS, SLOT_KEYS, BUFF_DEFS, BUFF_DURATION_MS, DAY_NAMES, POINT_COLLECT_MS } from './config.js';
import * as spells from './spells.js';
import { escapeHtml } from './fx.js';
import { sfx, toggleMute, isMuted } from './audio.js';
import { cycleQuality, qualityLabel } from './scene.js';
import { spellIcon, talentIcon } from './icons.js';
import { modelColor } from './entities.js';

const $ = id => document.getElementById(id);

const el = {
  dayName: $('day-name'), phaseLabel: $('phase-label'), roundTimer: $('round-timer'), scoreTarget: $('score-target'),
  scoreList: $('score-list'),
  hpFill: $('hp-fill'), hpShield: $('hp-shield-fill'), hpText: $('hp-text'), mpFill: $('mp-fill'), mpText: $('mp-text'),
  rCastWrap: $('r-cast-wrap'), rCastFill: $('r-cast-fill'), sprint: $('buff-w-indicator'),
  collectWrap: $('collect-wrap'), collectFill: $('collect-fill'), collectText: $('collect-text'),
  buffs: $('active-buffs'), respawn: $('respawn-indicator'), stunNote: $('stun-note'),
  talentBtn: $('talent-btn'), talentBadge: $('talent-badge'), muteBtn: $('mute-btn'), qualityBtn: $('quality-btn'),
  overlay: $('overlay'), ovTitle: $('overlay-title'), ovSub: $('overlay-sub'), ovTimer: $('overlay-timer'),
  standings: $('standings'), talentPanel: $('talent-panel'), talentPts: $('talent-pts'), talentTip: $('talent-tip'),
  spellCards: $('spell-cards'), ovSlots: $('ov-slots'), pickerHint: $('picker-hint'),
  readyBtn: $('ready-btn'), weekBox: $('week-box'),
  helpBtn: $('help-btn'), help: $('help'), helpClose: $('help-close'),
};

const slots = {};
for (const k of SLOT_KEYS) {
  slots[k] = { root: $(`slot-${k}`), icon: $(`slot-${k}-icon`), label: $(`slot-${k}-label`), cost: $(`slot-${k}-cost`), mask: $(`slot-${k}-mask`), cdText: $(`slot-${k}-cd`), lock: $(`slot-${k}-lock`) };
}

let overlayMode = ''; // '' | 'intermission' | 'weekend'
let lastTickSecond = -1;
let lastPhase = '';

// caches so the DOM is only touched when something actually changed
let lastScoreHtml = '';
let lastBuffKey = '';
let lastTalentKey = '';
let lastHpText = '';
let lastMpText = '';

// ------------------------------------------------------------ equipped slots

export function loadEquipped() {
  try {
    const raw = sessionStorage.getItem('superhry-slots');
    if (raw) {
      const obj = JSON.parse(raw);
      for (const k of SLOT_KEYS) G.equippedBySlot[k] = obj[k] || null;
    }
  } catch { /* ignore */ }
  if (!Object.values(G.equippedBySlot).includes('q')) G.equippedBySlot.q = 'q';
  if (!Object.values(G.equippedBySlot).includes('w')) G.equippedBySlot.w = G.equippedBySlot.w || 'w';
}

function saveEquipped() {
  try { sessionStorage.setItem('superhry-slots', JSON.stringify(G.equippedBySlot)); } catch { /* ignore */ }
}

function slotOf(spellKind) {
  return SLOT_KEYS.find(k => G.equippedBySlot[k] === spellKind) || null;
}

// moveSpell puts a spell on a slot; whatever was there goes to the spell's
// previous slot (swap) or is bumped off the bar.
export function moveSpell(spellKind, slotKey) {
  if (!spellKind || !G.myStats.spells.has(spellKind)) return;
  const from = slotOf(spellKind);
  const other = G.equippedBySlot[slotKey];
  G.equippedBySlot[slotKey] = spellKind;
  if (from && from !== slotKey) G.equippedBySlot[from] = other && other !== spellKind ? other : null;
  saveEquipped();
  renderSlots();
  renderPicker();
}

export function clearSlot(slotKey) {
  G.equippedBySlot[slotKey] = null;
  saveEquipped();
  renderSlots();
  renderPicker();
}

export function equipSpell(spellKind, slotKey) { moveSpell(spellKind, slotKey); }

export function autoEquip() {
  const placed = new Set(Object.values(G.equippedBySlot).filter(Boolean));
  for (const k of [...placed]) {
    if (!G.myStats.spells.has(k)) {
      for (const s of SLOT_KEYS) if (G.equippedBySlot[s] === k) G.equippedBySlot[s] = null;
      placed.delete(k);
    }
  }
  for (const spell of G.myStats.spells) {
    if (spell === 'aa' || placed.has(spell)) continue;
    const free = SLOT_KEYS.find(s => !G.equippedBySlot[s]);
    if (!free) break;
    G.equippedBySlot[free] = spell;
    placed.add(spell);
  }
  saveEquipped();
  renderSlots();
  renderPicker();
}

export function renderSlots() {
  for (const k of SLOT_KEYS) {
    const s = slots[k];
    const kind = G.equippedBySlot[k];
    const def = kind ? SPELL_DEFS[kind] : null;
    s.label.textContent = def ? def.name : '';
    s.cost.textContent = def && def.cost ? String(def.cost) : '';
    if (s.icon) s.icon.innerHTML = def ? spellIcon(kind) : '';
    s.root.classList.toggle('empty', !def);
    s.root.title = def ? `${def.name} (${def.cost} many): ${def.desc}` : 'Prázdný slot';
    s.root.dataset.spell = kind || '';
  }
}

// ------------------------------------------------------------ per frame

export function updateFrame(now) {
  const m = me();
  const alive = m ? m.alive : false;

  if (m) {
    const maxHp = m.maxHp || G.startHP;
    const maxMana = m.maxMana || G.startMana;
    const shield = m.shield || 0;
    const hpText = shield > 0 ? `${m.hp}+${shield} / ${maxHp}` : `${m.hp} / ${maxHp}`;
    if (hpText !== lastHpText) {
      lastHpText = hpText;
      el.hpText.textContent = hpText;
      el.hpFill.style.width = `${Math.max(0, m.hp) / maxHp * 100}%`;
      const hpPct = Math.max(0, Math.min(1, m.hp / Math.max(1, maxHp)));
      const shieldPct = Math.max(0, Math.min(1 - hpPct, shield / Math.max(1, maxHp)));
      el.hpShield.style.left = `${hpPct * 100}%`;
      el.hpShield.style.width = `${shieldPct * 100}%`;
      el.hpShield.style.opacity = shieldPct > 0 ? '1' : '0';
    }
    const mpText = `${Math.round(Math.max(0, G.myMana))} / ${maxMana}`;
    if (mpText !== lastMpText) {
      lastMpText = mpText;
      el.mpText.textContent = mpText;
      el.mpFill.style.width = `${Math.max(0, G.myMana) / Math.max(1, maxMana) * 100}%`;
    }
  }

  if (m && !alive && m.respawnAt) {
    const remain = Math.ceil(Math.max(0, m.respawnAt - serverNow()) / 1000);
    el.respawn.hidden = false;
    el.respawn.textContent = String(remain);
  } else {
    el.respawn.hidden = true;
  }
  el.stunNote.hidden = !(alive && Date.now() < G.myStunUntil);

  for (const k of SLOT_KEYS) {
    const s = slots[k];
    const kind = G.equippedBySlot[k];
    if (!kind) {
      s.mask.style.transform = 'scaleY(0)';
      if (s.cdText.textContent) s.cdText.textContent = '';
      s.lock.hidden = true;
      s.root.classList.add('disabled');
      continue;
    }
    const info = spells.cooldownInfo(kind, now);
    s.mask.style.transform = `scaleY(${info.ratio})`;
    const cdTxt = info.remain > 0 && kind !== 'w' ? (info.remain / 1000).toFixed(info.remain < 1000 ? 1 : 0) : '';
    if (cdTxt !== s.cdText.textContent) s.cdText.textContent = cdTxt;
    const locked = spells.isLocked(kind);
    s.lock.hidden = !locked;
    if (locked) s.lock.textContent = `ZABAVENO ${Math.ceil((G.myLock.until - Date.now()) / 1000)}s`;
    s.root.classList.toggle('disabled', !spells.canCast(kind, now));
    s.root.classList.toggle('active-buff', kind === 'w' && G.wActiveUntil > now);
  }

  const wRemain = Math.max(0, G.wActiveUntil - now);
  el.sprint.hidden = wRemain <= 0;
  if (wRemain > 0) el.sprint.textContent = `Sprint ${Math.ceil(wRemain / 1000)}s`;
  const rRemain = Math.max(0, G.rCastUntil - now);
  if (alive && rRemain > 0) {
    el.rCastWrap.hidden = false;
    el.rCastFill.style.width = `${Math.round((1 - rRemain / 1000) * 100)}%`;
  } else {
    el.rCastWrap.hidden = true;
  }
  if (alive && G.collect) {
    const k = Math.max(0, Math.min(1, (now - G.collect.startedAt) / POINT_COLLECT_MS));
    el.collectWrap.hidden = false;
    el.collectFill.style.width = `${Math.round(k * 100)}%`;
    el.collectText.textContent = `+${G.collect.value}`;
  } else {
    el.collectWrap.hidden = true;
  }

  updateBuffs(Date.now());
  updateTimer();

  const inBreak = G.match.phase === 'intermission' || G.match.phase === 'weekend';
  const pts = G.myTalentPts;
  el.talentBtn.hidden = !inBreak;
  el.talentBadge.hidden = pts <= 0;
  el.talentBadge.textContent = String(pts);
  el.talentBtn.classList.toggle('pulse', pts > 0);
}

function updateBuffs(nowMs) {
  const entries = [];
  for (const [kind, until] of G.myBuffs.entries()) if (until > nowMs) entries.push({ kind, until });
  entries.sort((a, b) => a.until - b.until);
  const key = entries.map(e => `${e.kind}:${Math.ceil((e.until - nowMs) / 1000)}`).join('|');
  if (key === lastBuffKey) return;
  lastBuffKey = key;
  el.buffs.textContent = '';
  for (const e of entries) {
    const def = BUFF_DEFS[e.kind];
    if (!def) continue;
    const remain = Math.max(0, e.until - nowMs);
    const row = document.createElement('div');
    row.className = 'buff-row';
    row.title = def.desc;
    const fill = document.createElement('div');
    fill.className = 'buff-row-fill';
    fill.style.background = def.color;
    fill.style.width = `${Math.min(100, remain / BUFF_DURATION_MS * 100)}%`;
    const text = document.createElement('div');
    text.className = 'buff-row-text';
    text.textContent = `${def.label} ${Math.ceil(remain / 1000)}s`;
    row.append(fill, text);
    el.buffs.appendChild(row);
  }
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function updateTimer() {
  const mt = G.match;
  const remain = mt.phaseEndsAt ? mt.phaseEndsAt - serverNow() : 0;
  setText(el.dayName, DAY_NAMES[mt.day] || '');
  switch (mt.phase) {
    case 'warmup':
      setText(el.phaseLabel, remain > 20000 ? 'rozcvička, ostrý start za' : 'začíná za');
      setText(el.roundTimer, fmtTime(remain));
      setText(el.scoreTarget, '');
      break;
    case 'playing':
      setText(el.phaseLabel, '');
      setText(el.roundTimer, fmtTime(remain));
      setText(el.scoreTarget, '');
      break;
    case 'intermission':
      setText(el.phaseLabel, 'přestávka');
      setText(el.roundTimer, mt.phaseEndsAt ? fmtTime(remain) : '…');
      setText(el.scoreTarget, '');
      break;
    case 'weekend':
      setText(el.phaseLabel, 'víkend');
      setText(el.roundTimer, mt.phaseEndsAt ? fmtTime(remain) : '…');
      setText(el.scoreTarget, '');
      break;
    default:
      setText(el.phaseLabel, 'čekám na hráče');
      setText(el.roundTimer, '');
      setText(el.scoreTarget, '');
  }
  el.roundTimer.classList.toggle('urgent', mt.phase === 'playing' && remain < 30000);

  if (mt.phase === 'warmup') {
    const sec = Math.ceil(remain / 1000);
    if (sec !== lastTickSecond && sec <= 3 && sec > 0) sfx.tick();
    lastTickSecond = sec;
  } else {
    lastTickSecond = -1;
  }
  if (overlayMode) {
    if (mt.phaseEndsAt) {
      setText(el.ovTimer, `Všichni připraveni, start za ${Math.max(1, Math.ceil(remain / 1000))} s`);
    } else {
      const waiting = [...G.players.values()].filter(p => !p.ready).map(p => p.name);
      setText(el.ovTimer, waiting.length ? `Čekáme na: ${waiting.join(', ')}` : 'Čekáme na hráče');
    }
  }
}

// ------------------------------------------------------------ scoreboard

export function updateScoreboard() {
  const rows = [...G.players.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0) || a.name.localeCompare(b.name));
  let html = '';
  for (const p of rows) {
    const cls = [];
    if (p.id === G.myId) cls.push('me');
    if (p.id === G.match.leaderId) cls.push('lead');
    if (!p.alive) cls.push('dead');
    const ho = p.hoDays ? ` <span class="ho">${'🏠'.repeat(Math.min(5, p.hoDays))}</span>` : '';
    const dot = `<span class="dot" style="background:#${(p.color ?? modelColor(p.model)).toString(16).padStart(6, '0')}"></span>`;
    html += `<li class="${cls.join(' ')}"><span class="sc-name">${dot}${escapeHtml(p.name)}${ho}</span><span class="sc-score">${p.score || 0}</span></li>`;
  }
  if (html === lastScoreHtml) return;
  lastScoreHtml = html;
  el.scoreList.innerHTML = html;
}

// ------------------------------------------------------------ overlay

export function setOverlay(mode) {
  overlayMode = mode;
  el.overlay.hidden = !mode;
  el.overlay.dataset.mode = mode;
  el.weekBox.hidden = true;
  selectedSpell = null;
  if (mode) {
    lastTalentKey = '';
    renderTalents();
    renderPicker();
  }
}

export function isOverlayOpen() { return !!overlayMode; }
export function overlayModeNow() { return overlayMode; }

export function toggleTalents() {
  const inBreak = G.match.phase === 'intermission' || G.match.phase === 'weekend';
  if (!inBreak || overlayMode || !G.lastRound) return;
  if (G.match.phase === 'weekend') showWeekend(G.lastRound); else showRoundEnd(G.lastRound);
}

export function closeOverlayIfTalents() { /* break overlays stay open */ }

export function showRoundEnd(msg) {
  const mt = msg.match;
  const day = DAY_NAMES[mt.day] || '';
  const winner = msg.standings?.find(s => s.id === msg.winnerId);
  el.ovTitle.textContent = winner ? `Vyhrál ${winner.name}` : 'Remíza';
  el.ovSub.textContent = day;
  renderStandings(msg.standings || [], true);
  setOverlay('intermission');
}

export function showWeekend(msg) {
  const winner = msg.standings?.find(s => s.id === msg.winnerId);
  el.ovTitle.textContent = winner ? `Týden vyhrál ${winner.name}` : 'Konec týdne';
  el.ovSub.textContent = '';
  renderStandings(msg.standings || [], false);
  setOverlay('weekend');
}

function renderStandings(st, dayResult) {
  // two columns: who, and the number that mattered (today's points, or
  // home office days at the end of the week)
  let html = `<table><thead><tr><th>Hráč</th><th>${dayResult ? 'Body' : '🏠'}</th></tr></thead><tbody>`;
  for (const s of st) {
    const cls = s.id === G.myId ? 'me' : '';
    const ho = dayResult && s.hoDays ? ` <span class="ho">${'🏠'.repeat(Math.min(5, s.hoDays))}</span>` : '';
    html += `<tr class="${cls}"><td>${escapeHtml(s.name || '?')}${ho}</td><td class="num">${dayResult ? s.score : s.hoDays}</td></tr>`;
  }
  html += '</tbody></table>';
  el.standings.innerHTML = html;
}

// ------------------------------------------------------------ talent tree

const TREE_COLS = 7;

function talentState(t, owned) {
  if (owned.has(t.id)) return 'owned';
  if (!t.requires || owned.has(t.requires)) return G.myTalentPts > 0 ? 'avail' : 'open';
  return 'locked';
}

export function renderTalents() {
  if (!el.talentPanel) return;
  const key = `${G.myTalents.join(',')}|${G.myTalentPts}|${overlayMode}`;
  if (key === lastTalentKey) return;
  lastTalentKey = key;

  el.talentPts.textContent = G.myTalentPts > 0 ? `${G.myTalentPts} bodů k rozdělení` : 'žádné volné body';
  el.talentPts.classList.toggle('has', G.myTalentPts > 0);
  const owned = new Set(G.myTalents);
  let html = '<div class="t-grid">';
  for (const t of G.talentTree) {
    const state = talentState(t, owned);
    const spell = t.spell ? `<span class="t-spell">${escapeHtml(SPELL_DEFS[t.spell]?.name || '')}</span>` : '';
    html += `<button type="button" class="t-node b-${t.branch} ${state}" data-talent="${t.id}" style="grid-row:${t.row + 1};grid-column:${Math.min(TREE_COLS, t.col + 1)}"><span class="t-icon">${talentIcon(t)}</span><span class="t-name">${escapeHtml(t.name)}</span>${spell}</button>`;
  }
  html += '<svg class="t-arrows"></svg></div>';
  el.talentPanel.innerHTML = html;
  requestAnimationFrame(drawTalentArrows);
}

function drawTalentArrows() {
  const grid = el.talentPanel.querySelector('.t-grid');
  const svg = grid?.querySelector('.t-arrows');
  if (!grid || !svg) return;
  const w = grid.clientWidth, h = grid.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  let paths = '';
  for (const node of grid.querySelectorAll('.t-node')) {
    const t = G.talentById.get(node.dataset.talent);
    if (!t || !t.requires) continue;
    const parent = grid.querySelector(`.t-node[data-talent="${t.requires}"]`);
    if (!parent) continue;
    const x1 = parent.offsetLeft + parent.offsetWidth / 2;
    const y1 = parent.offsetTop + parent.offsetHeight;
    const x2 = node.offsetLeft + node.offsetWidth / 2;
    const y2 = node.offsetTop;
    const midY = y1 + (y2 - y1) * 0.5;
    const lit = node.classList.contains('owned') || node.classList.contains('avail') || node.classList.contains('open');
    paths += `<path class="${lit ? 'lit' : ''}" d="M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2 - 2}"/><path class="head ${lit ? 'lit' : ''}" d="M${x2 - 5} ${y2 - 7} L${x2} ${y2 - 1} L${x2 + 5} ${y2 - 7}"/>`;
  }
  svg.innerHTML = paths;
}

// Floating tooltip under the hovered node.
function showTalentTip(node) {
  const t = node && G.talentById.get(node.dataset.talent);
  if (!t) { el.talentTip.hidden = true; return; }
  const owned = new Set(G.myTalents);
  const req = t.requires && !owned.has(t.requires) ? `vyžaduje ${G.talentById.get(t.requires)?.name || t.requires}` : '';
  el.talentTip.innerHTML = `<b>${escapeHtml(t.name)}</b>${escapeHtml(t.desc)}${req ? `<div class="t-req">${escapeHtml(req)}</div>` : ''}`;
  el.talentTip.hidden = false;
  const r = node.getBoundingClientRect();
  const w = el.talentTip.offsetWidth || 240;
  const h = el.talentTip.offsetHeight || 60;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.bottom + 8;
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  if (y + h > window.innerHeight - 8) y = r.top - h - 8;
  el.talentTip.style.left = `${Math.round(x)}px`;
  el.talentTip.style.top = `${Math.round(y)}px`;
}

// ------------------------------------------------------------ spell picker

let selectedSpell = null; // card picked, waiting for a slot / key

function selectSpell(kind) {
  selectedSpell = selectedSpell === kind ? null : kind;
  renderPicker();
}

export function renderPicker() {
  if (!el.spellCards || !overlayMode) return;
  let cards = '';
  for (const kind of G.myStats.spells) {
    if (kind === 'aa') continue;
    const def = SPELL_DEFS[kind];
    cards += `<div class="card ${selectedSpell === kind ? 'selected' : ''} ${slotOf(kind) ? 'equipped' : ''}" draggable="true" data-spell="${kind}">
      <div class="card-top"><span class="card-icon">${spellIcon(kind)}</span><span class="card-name">${escapeHtml(def.name)}</span><span class="card-cost">${def.cost}</span></div>
      <div class="card-desc">${escapeHtml(def.desc)}</div></div>`;
  }
  el.spellCards.innerHTML = cards;
  let slotsHtml = '';
  for (const k of SLOT_KEYS) {
    const kind = G.equippedBySlot[k];
    const def = kind ? SPELL_DEFS[kind] : null;
    slotsHtml += `<div class="ov-slot ${def ? '' : 'empty'} ${selectedSpell ? 'target' : ''} ${selectedSpell && kind === selectedSpell ? 'held' : ''}" data-slot="${k}" draggable="${def ? 'true' : 'false'}"><span class="key">${k.toUpperCase()}</span><span class="icon">${kind ? spellIcon(kind) : ''}</span><span class="name">${def ? escapeHtml(def.name) : ''}</span></div>`;
  }
  el.ovSlots.innerHTML = slotsHtml;
  el.pickerHint.textContent = selectedSpell
    ? `${SPELL_DEFS[selectedSpell].name}: stiskni klávesu nebo klikni na slot`
    : 'klikni na kouzlo a pak na klávesu, nebo ho přetáhni · pravé tlačítko slot vyprázdní';
}

// Keys pressed while the break screen is open go to the picker.
export function pickerKey(slotKey) {
  if (!overlayMode) return false;
  if (selectedSpell) {
    moveSpell(selectedSpell, slotKey);
    selectedSpell = null;
    renderPicker();
    sfx.talent();
  }
  return true;
}

function initPicker() {
  el.spellCards.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) selectSpell(card.dataset.spell);
  });
  el.spellCards.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer?.setData('text/spell-kind', card.dataset.spell);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  el.spellCards.addEventListener('dragend', e => e.target.closest?.('.card')?.classList.remove('dragging'));

  el.ovSlots.addEventListener('click', e => {
    const slot = e.target.closest('.ov-slot');
    if (!slot) return;
    const k = slot.dataset.slot;
    if (selectedSpell) {
      moveSpell(selectedSpell, k);
      selectedSpell = null;
      renderPicker();
      sfx.talent();
    } else if (G.equippedBySlot[k]) {
      selectSpell(G.equippedBySlot[k]);
    }
  });
  el.ovSlots.addEventListener('contextmenu', e => {
    const slot = e.target.closest('.ov-slot');
    if (!slot) return;
    e.preventDefault();
    clearSlot(slot.dataset.slot);
  });
  el.ovSlots.addEventListener('dragstart', e => {
    const slot = e.target.closest('.ov-slot');
    const kind = slot && G.equippedBySlot[slot.dataset.slot];
    if (!kind) { e.preventDefault(); return; }
    e.dataTransfer?.setData('text/spell-kind', kind);
  });
  el.ovSlots.addEventListener('dragover', e => {
    const slot = e.target.closest('.ov-slot');
    if (!slot) return;
    e.preventDefault();
    slot.classList.add('drag-over');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  el.ovSlots.addEventListener('dragleave', e => e.target.closest?.('.ov-slot')?.classList.remove('drag-over'));
  el.ovSlots.addEventListener('drop', e => {
    const slot = e.target.closest('.ov-slot');
    if (!slot) return;
    e.preventDefault();
    const kind = e.dataTransfer?.getData('text/spell-kind');
    if (kind) { moveSpell(kind, slot.dataset.slot); selectedSpell = null; renderPicker(); sfx.talent(); }
  });
}

// ------------------------------------------------------------ phase transitions

export function onMatchChanged(mt) {
  if (mt.phase === lastPhase) return;
  lastPhase = mt.phase;
  if (mt.phase === 'playing' || mt.phase === 'warmup' || mt.phase === 'idle') {
    if (overlayMode) setOverlay('');
  }
}

export function setReady(ready) {
  send({ type: 'ready', data: { ready } });
  el.readyBtn.classList.toggle('on', ready);
  el.readyBtn.textContent = ready ? 'Připraven ✓' : 'Připraven';
}

export function resetReadyButton() {
  el.readyBtn.classList.remove('on');
  el.readyBtn.textContent = 'Připraven';
}

export function initHud() {
  loadEquipped();
  renderSlots();
  el.readyBtn.addEventListener('click', () => setReady(!el.readyBtn.classList.contains('on')));
  el.talentBtn.addEventListener('click', () => toggleTalents());
  el.muteBtn.addEventListener('click', () => { el.muteBtn.textContent = toggleMute() ? '🔇' : '🔊'; });
  el.muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  el.qualityBtn.textContent = qualityLabel();
  el.qualityBtn.addEventListener('click', () => { el.qualityBtn.textContent = cycleQuality(); });
  el.helpBtn.addEventListener('click', () => { el.help.hidden = !el.help.hidden; });
  el.helpClose.addEventListener('click', () => { el.help.hidden = true; });
  el.talentPanel.addEventListener('click', e => {
    const btn = e.target.closest('.t-node');
    if (!btn || !btn.classList.contains('avail')) return;
    send({ type: 'talent', data: { id: btn.dataset.talent } });
    sfx.talent();
  });
  el.talentPanel.addEventListener('mouseover', e => showTalentTip(e.target.closest('.t-node')));
  el.talentPanel.addEventListener('mouseleave', () => showTalentTip(null));
  window.addEventListener('resize', () => { if (overlayMode) requestAnimationFrame(drawTalentArrows); });
  initPicker();
}
