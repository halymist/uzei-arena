import { G, me, send } from './state.js';
import { buildMap } from './scene.js';
import { deriveStats, SPELL_DEFS, DAY_NAMES, SPELL_COLORS, REDITEL_BEAM_WARN_MS } from './config.js';
import * as ent from './entities.js';
import * as spells from './spells.js';
import * as hud from './hud.js';
import * as fx from './fx.js';
import { sfx } from './audio.js';

let reconnectTimer = 0;

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/arena`);
  G.ws = ws;
  ws.addEventListener('open', () => {
    send({ type: 'join', data: { name: G.myName, model: G.selectedModel } });
  });
  ws.addEventListener('message', ev => onMessage(ev.data));
  ws.addEventListener('close', () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1200);
  });
}

function onMessage(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m.type) {
    case 'welcome': onWelcome(m.data); break;
    case 'snap': onSnapshot(m.data); break;
    case 'fire': onFire(m.data); break;
    case 'hit': onHit(m.data); break;
    case 'kill': onKill(m.data); break;
    case 'round': onRound(m.data); break;
    case 'effect': onEffect(m.data); break;
    case 'leave': ent.removePlayer(m.data.id); hud.updateScoreboard(); break;
  }
}

function onWelcome(d) {
  // reconnected to a rebuilt server: the scripts in this tab may be stale
  if (G.buildId && d.build && d.build !== G.buildId) {
    location.reload();
    return;
  }
  G.buildId = d.build || 0;
  G.myId = d.youId;
  G.startHP = d.startHp;
  G.startMana = d.startMana || 100;
  G.respawnMs = d.respawnMs || 4000;
  G.serverOffset = (d.nowMs || Date.now()) - Date.now();
  G.map = d.map;
  buildMap(d.map);
  G.talentTree = d.talents || [];
  G.talentById = new Map(G.talentTree.map(t => [t.id, t]));
  G.match = d.match || G.match;
  G.myMana = G.startMana;
  G.myTalents = [];
  G.myStats = deriveStats([], G.talentById);
  // players/npcs will be rebuilt by the first snapshot
  for (const id of [...G.players.keys()]) ent.removePlayer(id);
  spells.clearEffects();
  spells.resetCooldowns();
  hud.autoEquip();
  hud.renderTalents();
}

let lastTalentKey = '';

function onSnapshot(snap) {
  // keep a gentle estimate of server clock offset
  const off = snap.t - Date.now();
  G.serverOffset = G.serverOffset === 0 ? off : G.serverOffset * 0.9 + off * 0.1;

  const prevMatch = G.match;
  G.match = snap.match || prevMatch;

  ent.applyPlayersSnapshot(snap);
  ent.applyNPCsSnapshot(snap);
  ent.applyPickupsSnapshot(snap);

  const m = me();
  if (m) {
    if (typeof m.mana === 'number') G.myMana = m.mana;
    G.myStunUntil = m.stunUntil || 0;
    G.myTalentPts = m.talentPts || 0;
    G.myLock.spell = m.lockedSpell || '';
    G.myLock.until = m.lockUntil || 0;
    const key = (m.talents || []).join(',');
    if (key !== lastTalentKey) {
      lastTalentKey = key;
      G.myTalents = [...(m.talents || [])];
      G.myStats = deriveStats(G.myTalents, G.talentById);
      hud.autoEquip();
      hud.renderTalents();
    } else if (hud.isOverlayOpen()) {
      // points can change without talents changing (round end)
      hud.renderTalents();
    }
    G.myBuffs.clear();
    const now = Date.now();
    for (const b of m.buffs || []) {
      if (b && b.until > now) G.myBuffs.set(b.kind, b.until);
    }
    fx.setVignette(m.alive ? m.hp / Math.max(1, m.maxHp || G.startHP) : 1);
  }
  hud.onMatchChanged(G.match, prevMatch);
  hud.updateScoreboard();
}

// which clip a shot or cast plays on its owner
const FIRE_ANIM = {
  aa: 'attack', q: 'attack', x: 'attack', g: 'attack', r: 'cast', z: 'cast', pool_cast: 'cast', f_orbit: 'cast',
  reditel: 'attack', reditel_beam: 'cast', curda_stun: 'cast', curda_salva: 'attack',
};
const CAST_ANIM = { w: 'cast', e: 'cast', c: 'dash', v: 'cast', s: 'cast', f: 'cast', q: 'attack' };

function onFire(d) {
  if (d.kind === 'reditel_beam_warn') ent.animHold(d.owner, 'channel', REDITEL_BEAM_WARN_MS);
  else if (d.owner !== G.myId && FIRE_ANIM[d.kind]) ent.animEvent(d.owner, FIRE_ANIM[d.kind], { timeScale: d.kind === 'q' || d.kind === 'curda_salva' ? 1.6 : 1 });
  switch (d.kind) {
    case 'pool_cast':
      if (d.owner !== G.myId) spells.spawnPoolEffect(d.owner, d.dx, d.dz * 1000);
      return;
    case 'f_orbit':
      if (d.owner !== G.myId) spells.spawnOrbitEffect(d.owner, d.dx, d.dz * 1000);
      return;
    case 'reditel_beam_warn':
      spells.spawnBeamWarning(d);
      return;
    case 'z':
      if (d.owner !== G.myId) spells.spawnGroundBurst(d.owner, d.ox, d.oz, d.dx, d.dz * 1000, 0);
      return;
  }
  if (d.owner === G.myId) return; // own shots were spawned locally
  spells.spawnProjectile(d);
}

function onHit(d) {
  const pos = ent.playerPos(d.target);
  const isMe = d.target === G.myId;
  const byMe = d.shooter === G.myId;
  const targetPlayer = G.players.get(d.target);
  const targetNpc = G.npcs.get(d.target);
  const mesh = targetPlayer ? targetPlayer.mesh : targetNpc?.mesh;

  if (targetPlayer) targetPlayer.hp = d.hp;
  if (targetNpc) targetNpc.hp = d.hp;
  spells.removeProjectileOf(d.shooter, d.pid);
  if (d.dmg > 0 && !d.killed) ent.animEvent(d.target, 'hit', { priority: 0 });
  const shooterNpc = G.npcs.get(d.shooter);
  if (shooterNpc && (shooterNpc.kind === 'pes' || shooterNpc.kind === 'namestek')) ent.animEvent(d.shooter, 'attack');

  if (pos && d.dmg > 0) {
    const cls = isMe ? 'dmg-me' : (d.shield ? 'shield' : (byMe ? 'dmg-mine' : 'dmg'));
    fx.damageNumber(pos.x, pos.z, String(d.dmg), cls, targetNpc?.kind === 'reditel' ? 2.4 : 1.7);
    if (mesh) fx.hitFlash(mesh, isMe ? 0xff3355 : 0xffffff);
    const color = SPELL_COLORS[d.kind] || 0xffe48a;
    fx.burst(pos.x, pos.z, color, { count: 5, speed: 2.5, life: 260, size: 0.6, y: 1.1 });
  }
  if (isMe) {
    sfx.hurt();
    fx.shake(Math.min(0.9, 0.15 + d.dmg / 60));
    fx.screenFlash('hurt');
  } else if (byMe) {
    if (d.shield) sfx.shieldHit(); else sfx.hit();
  }
}

function onKill(d) {
  const pos = ent.playerPos(d.victim);
  const victimPlayer = G.players.get(d.victim);
  const victimNpc = G.npcs.get(d.victim);
  const color = victimPlayer ? victimPlayer.color : (victimNpc?.mesh.userData.color || 0xffffff);
  if (pos) fx.deathBurst(pos.x, pos.z, color);
  if (victimPlayer) victimPlayer.alive = false;

  const killer = fx.escapeHtml(d.killerName || '?');
  const victim = fx.escapeHtml(d.victimName || '?');
  const pts = d.points > 0 ? ` <span class="kf-pts">+${d.points}</span>` : '';
  fx.killfeed(`<b class="${d.killer === G.myId ? 'me' : ''}">${killer}</b> ✕ <b class="victim ${d.victim === G.myId ? 'me' : ''}">${victim}</b>${pts}`, d.victimNpc ? 'npc' : '');

  if (d.victim === G.myId) {
    sfx.death();
    fx.shake(0.8);
    fx.banner(`${d.killerName} tě dostal`, '', 1800, 'bad');
  } else if (d.killer === G.myId) {
    sfx.kill();
    if (!d.victimNpc || d.bonus === 'boss') fx.banner(`${d.victimName} ✕`, '', 1400, 'good');
  }
}

function onRound(d) {
  const prev = G.match;
  G.match = d.match;
  G.lastRound = d;
  const day = DAY_NAMES[d.match.day] || '';
  switch (d.match.phase) {
    case 'warmup':
      spells.clearEffects();
      spells.resetCooldowns();
      fx.clearAll();
      ent.clearWorldEntities();
      hud.resetReadyButton();
      hud.setOverlay('');
      ent.cancelCollectLocal();
      if (d.match.phaseEndsAt - Date.now() - G.serverOffset > 20000) {
        fx.banner('Rozcvička', 'Ostrý start za minutu', 2400);
      } else {
        fx.banner(day, d.match.day === 0 ? `Týden ${d.match.week}` : '', 2000);
      }
      break;
    case 'playing':
      spells.clearEffects();
      spells.resetCooldowns();
      hud.setOverlay('');
      fx.banner('Do práce!', '', 1600, 'good');
      sfx.go();
      break;
    case 'intermission':
      spells.clearEffects();
      spells.resetCooldowns();
      hud.resetReadyButton();
      hud.showRoundEnd(d);
      if (d.winnerId === G.myId) sfx.win(); else sfx.roundEnd();
      break;
    case 'weekend':
      spells.clearEffects();
      hud.resetReadyButton();
      hud.showWeekend(d);
      if (d.winnerId === G.myId) sfx.win(); else sfx.roundEnd();
      break;
  }
  hud.onMatchChanged(G.match, prev);
  hud.updateScoreboard();
}

function onEffect(d) {
  switch (d.kind) {
    case 'cast': {
      // own casts are animated locally the moment the key is pressed
      if (d.target !== G.myId && CAST_ANIM[d.spell]) ent.animEvent(d.target, CAST_ANIM[d.spell], { timeScale: d.spell === 'w' || d.spell === 'e' ? 2 : 1 });
      break;
    }
    case 'lock': {
      const name = SPELL_DEFS[d.spell]?.name || d.spell;
      if (d.target === G.myId) {
        G.myLock.spell = d.spell;
        G.myLock.until = d.until;
        sfx.lock();
      }
      const pos = ent.playerPos(d.target);
      if (pos) fx.damageNumber(pos.x, pos.z, `−${name}`, 'lock', 2.2);
      break;
    }
    case 'heal': {
      const pos = ent.playerPos(d.target);
      if (pos && d.amount > 0) fx.damageNumber(pos.x, pos.z, `+${d.amount}`, 'heal');
      if (d.target === G.myId) sfx.heal();
      break;
    }
    case 'score': {
      const pos = ent.playerPos(d.target) || { x: d.x, z: d.z };
      fx.damageNumber(pos.x, pos.z, `+${d.amount}`, 'pts', 2.0);
      fx.burst(d.x, d.z, 0xffd84a, { count: 14, speed: 4, life: 500, size: 0.8, y: 0.5 });
      if (d.target === G.myId) { sfx.pickup(); ent.cancelCollectLocal(); }
      break;
    }
    case 'leader': {
      if (d.target === G.myId) sfx.leader();
      break;
    }
  }
}
