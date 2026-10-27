import * as THREE from 'three';
import { G, me, send } from './state.js';
import { scene, centerCameraOnMe, screenPos } from './scene.js';
import { PLAYER_RADIUS, PLAYER_MODEL_COLORS, PICKUP_RADIUS, INTERP_DELAY_MS, POINT_COLLECT_RANGE } from './config.js';
import { makeNameSprite, setNameSprite, makeHpSprite, setHpSprite, makeStunSprite, disposeSprite } from './sprites.js';
import * as fx from './fx.js';
import { sfx } from './audio.js';
import * as chars from './characters.js';

export function modelColor(model) {
  const i = Math.max(0, Math.min(PLAYER_MODEL_COLORS.length - 1, Math.trunc(model || 0)));
  return PLAYER_MODEL_COLORS[i];
}

function disposeObject(root) {
  if (root.userData.ch) chars.disposeCharacter(root.userData.ch);
  root.traverse(o => {
    if (o.isSprite) { disposeSprite(o); return; }
    if (o.isSkinnedMesh) return; // handled by disposeCharacter
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose();
    }
  });
}

// Solid body parts throw a shadow on the floor; rings, bubbles and sprites do not.
function castShadows(root) {
  root.traverse(o => {
    if (o.isMesh && !o.material.transparent) o.castShadow = true;
  });
}

// ------------------------------------------------------------ players

export function makeBody(color) {
  const g = new THREE.Group();
  const ch = chars.createCharacter('player', color);
  g.add(ch.root);
  g.userData.ch = ch;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.98, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.userData.ring = ring;

  const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x8bd8ff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  );
  shieldBubble.position.y = 1.0;
  shieldBubble.visible = false;
  g.add(shieldBubble);
  g.userData.shieldBubble = shieldBubble;

  const invulnRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.07, 10, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, depthWrite: false })
  );
  invulnRing.rotation.x = -Math.PI / 2;
  invulnRing.position.y = 0.18;
  invulnRing.visible = false;
  g.add(invulnRing);
  g.userData.invulnRing = invulnRing;

  const nameSprite = makeNameSprite('');
  nameSprite.position.y = 2.5;
  g.add(nameSprite);
  g.userData.nameSprite = nameSprite;

  const hpSprite = makeHpSprite();
  hpSprite.position.y = 2.2;
  g.add(hpSprite);
  g.userData.hpSprite = hpSprite;

  const stunSp = makeStunSprite();
  stunSp.position.y = 3.05;
  stunSp.visible = false;
  g.add(stunSp);
  g.userData.stunSprite = stunSp;

  g.userData.color = color;
  return g;
}


export function applyPlayerModelVisual(pl, model) {
  const color = modelColor(model);
  pl.color = color;
  pl.model = model;
  chars.setTint(pl.mesh.userData.ch, color);
  pl.mesh.userData.ring.material.color.setHex(color);
}

export function removePlayer(id) {
  const pl = G.players.get(id);
  if (!pl) return;
  scene.remove(pl.mesh);
  disposeObject(pl.mesh);
  G.players.delete(id);
}

export function playerPos(id) {
  if (id === G.myId) return { x: G.myPos.x, z: G.myPos.z };
  const p = G.players.get(id);
  if (p) return { x: p.mesh.position.x, z: p.mesh.position.z };
  const n = G.npcs.get(id);
  if (n) return { x: n.mesh.position.x, z: n.mesh.position.z };
  return null;
}

export function entityName(id) {
  const p = G.players.get(id);
  if (p) return p.name;
  const n = G.npcs.get(id);
  if (n) return n.name;
  return '?';
}

export function applyPlayersSnapshot(snap) {
  const seen = new Set();
  const now = Date.now();
  for (const p of snap.players) {
    seen.add(p.id);
    let pl = G.players.get(p.id);
    if (!pl) {
      const color = modelColor(p.model || 0);
      const mesh = makeBody(color);
      scene.add(mesh);
      pl = { id: p.id, mesh, name: p.name, hp: p.hp, alive: p.alive, snapshots: [], color, model: p.model || 0, _initSync: false };
      G.players.set(p.id, pl);
      setNameSprite(mesh.userData.nameSprite, p.name);
      mesh.position.set(p.x, 0, p.z);
    }
    const model = Math.max(0, Math.min(3, Math.trunc(p.model || 0)));
    if (pl.model !== model) applyPlayerModelVisual(pl, model);
    if (pl.name !== p.name) {
      pl.name = p.name;
      setNameSprite(pl.mesh.userData.nameSprite, p.name);
    }
    const wasAlive = pl.alive;
    Object.assign(pl, {
      hp: p.hp, mana: p.mana, maxHp: p.maxHp || G.startHP, maxMana: p.maxMana || G.startMana,
      score: p.score || 0, kills: p.kills || 0, deaths: p.deaths || 0, hoDays: p.hoDays || 0, weekScore: p.weekScore || 0,
      talentPts: p.talentPts || 0, talents: p.talents || [], ready: !!p.ready,
      shield: p.shield || 0, shieldUntil: p.shieldUntil || 0, invulnUntil: p.invulnUntil || 0,
      lockedSpell: p.lockedSpell || '', lockUntil: p.lockUntil || 0,
      collectPickup: p.collectPickup || 0, collectUntil: p.collectUntil || 0,
      buffs: Array.isArray(p.buffs) ? p.buffs : [], stunUntil: p.stunUntil || 0, respawnAt: p.respawnAt || 0,
      alive: p.alive,
    });
    const ud = pl.mesh.userData;
    setHpSprite(ud.hpSprite, p.hp, pl.maxHp, pl.shield);
    ud.hpSprite.visible = p.id !== G.myId && p.alive;
    ud.shieldBubble.visible = p.alive && pl.shield > 0 && (!pl.shieldUntil || now < pl.shieldUntil);
    ud.invulnRing.visible = p.alive && pl.invulnUntil > now;
    ud.stunSprite.visible = p.alive && now < pl.stunUntil;

    if (p.id !== G.myId) {
      pl.snapshots.push({ t: snap.t, x: p.x, z: p.z, facing: p.facing });
      const cutoff = snap.t - 1000;
      while (pl.snapshots.length > 2 && pl.snapshots[0].t < cutoff) pl.snapshots.shift();
    }
    // the kill message may flip pl.alive before this snapshot, so the
    // character's own flag is the source of truth for the transition
    if (!p.alive && !ud.ch.dead) {
      pl.diedAt = performance.now();
      chars.die(ud.ch);
    } else if (p.alive && ud.ch.dead) {
      chars.revive(ud.ch);
    }
    // the body stays for a moment so the death animation is seen
    pl.mesh.visible = p.alive || performance.now() - (pl.diedAt || 0) < DEATH_SHOW_MS;

    if (p.id === G.myId) {
      const desync = Math.hypot(G.myPos.x - p.x, G.myPos.z - p.z);
      const ignoreSnap = performance.now() < G.ignoreServerSnapUntil;
      if (!pl._initSync || (!wasAlive && p.alive) || (desync > 2.5 && !ignoreSnap)) {
        G.myPos.x = p.x; G.myPos.z = p.z;
        G.myVel.x = 0; G.myVel.y = 0;
        G.hasMoveTarget = false;
        centerCameraOnMe(!pl._initSync);
        pl._initSync = true;
      }
    }
  }
  for (const id of [...G.players.keys()]) {
    if (!seen.has(id)) removePlayer(id);
  }
}

const DEATH_SHOW_MS = 1200;

// Local player: the animation state comes straight from the simulation.
export function driveMe(pl, moving, speed, now, dt) {
  const ch = pl.mesh.userData.ch;
  chars.drive(ch, {
    moving,
    speed,
    stunned: Date.now() < G.myStunUntil,
    collecting: !!G.collect,
    channeling: G.rCastUntil > now,
    charging: G.chargeAnim.active,
  }, dt);
}

// One-shot clip on any player or NPC (spell casts, hits, bites).
export function animEvent(id, name, opts) {
  const e = G.players.get(id) || G.npcs.get(id);
  if (e) chars.trigger(e.mesh.userData.ch, name, opts);
}

export function animHold(id, name, ms) {
  const e = G.players.get(id) || G.npcs.get(id);
  if (e) chars.hold(e.mesh.userData.ch, name, ms);
}

export function interpolateRemote(now, dt) {
  const renderT = Date.now() - INTERP_DELAY_MS;
  for (const [id, pl] of G.players) {
    if (id === G.myId) continue;
    const buf = pl.snapshots;
    if (buf.length === 0) continue;
    const prevX = pl.mesh.position.x, prevZ = pl.mesh.position.z;
    if (buf.length === 1 || renderT <= buf[0].t) {
      const s = buf[0];
      pl.mesh.position.x = s.x;
      pl.mesh.position.z = s.z;
      pl.mesh.rotation.y = s.facing;
    } else {
      let a = buf[0], b = buf[1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderT && buf[i + 1].t >= renderT) { a = buf[i]; b = buf[i + 1]; break; }
        a = buf[i]; b = buf[i + 1];
      }
      const span = Math.max(1, b.t - a.t);
      const k = Math.max(0, Math.min(1, (renderT - a.t) / span));
      pl.mesh.position.x = a.x + (b.x - a.x) * k;
      pl.mesh.position.z = a.z + (b.z - a.z) * k;
      let da = b.facing - a.facing;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      pl.mesh.rotation.y = a.facing + da * k;
    }
    const dist = Math.hypot(pl.mesh.position.x - prevX, pl.mesh.position.z - prevZ);
    const nowMs = Date.now();
    chars.drive(pl.mesh.userData.ch, {
      moving: dist > 0.002,
      speed: dist / Math.max(0.001, dt),
      stunned: nowMs < pl.stunUntil,
      collecting: !!pl.collectPickup,
    }, dt);
    if (!pl.alive && pl.mesh.visible && performance.now() - (pl.diedAt || 0) >= DEATH_SHOW_MS) pl.mesh.visible = false;
  }
}

// ------------------------------------------------------------ NPCs

export function makeNPCMesh(n) {
  const g = new THREE.Group();
  const kind = n.kind;
  const ch = chars.createCharacter(kind);
  g.add(ch.root);
  g.userData.ch = ch;

  if (kind === 'sofie') {
    const healRing = new THREE.Mesh(new THREE.RingGeometry(2.25, 2.4, 48), new THREE.MeshBasicMaterial({ color: 0x8dffb6, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    healRing.rotation.x = -Math.PI / 2;
    healRing.position.y = 0.05;
    g.add(healRing);
    g.userData.healRing = healRing;
  }

  // vertical stack above the head: hp bar, name, stun stars, speech bubble
  const k = (chars.VARIANTS[kind] || chars.VARIANTS.player).scale;
  const stack = kind === 'pes'
    ? { hp: 1.3, name: 1.65, stun: 2.05, talk: 2.7 }
    : { hp: 1.85 * k, name: 2.15 * k, stun: 2.55 * k, talk: 3.1 * k };

  const nameSp = makeNameSprite(n.name || n.kind, '#e6f2ff');
  nameSp.position.y = stack.name;
  g.add(nameSp);
  g.userData.nameSprite = nameSp;

  if (kind !== 'sofie') {
    const hpSp = makeHpSprite();
    hpSp.position.y = stack.hp;
    g.add(hpSp);
    g.userData.hpSprite = hpSp;
  }

  g.userData.talkY = stack.talk;

  const stunSp = makeStunSprite();
  stunSp.position.y = stack.stun;
  stunSp.visible = false;
  g.add(stunSp);
  g.userData.stunSprite = stunSp;

  g.scale.setScalar(n.scale || 1);
  g.userData.color = kind === 'pes' ? 0xa67b4f : kind === 'reditel' ? 0xc0273a : kind === 'sofie' ? 0x84b6ff : kind === 'curda' ? 0xb4cc64 : 0x6b8fcf;
  return g;
}


export function applyNPCsSnapshot(snap) {
  const seen = new Set();
  const now = Date.now();
  for (const n of (snap.npcs || [])) {
    seen.add(n.id);
    let obj = G.npcs.get(n.id);
    if (!obj) {
      const mesh = makeNPCMesh(n);
      scene.add(mesh);
      obj = { id: n.id, mesh, kind: n.kind, name: n.name, hp: n.hp || 0, maxHp: n.maxHp || 0, alive: n.alive !== false, say: '', sayUntil: 0, lastSay: '', stunUntil: 0, sx: n.x, sz: n.z, st: snap.t, speed: 0, diedAt: 0 };
      G.npcs.set(n.id, obj);
      mesh.position.set(n.x, 0, n.z);
    }
    // server-side speed, used to pick walk/run/charge clips
    const sdt = (snap.t - obj.st) / 1000;
    if (sdt > 0.01) {
      obj.speed = Math.hypot(n.x - obj.sx, n.z - obj.sz) / sdt;
      obj.sx = n.x; obj.sz = n.z; obj.st = snap.t;
    }
    const wasAlive = obj.alive;
    obj.kind = n.kind;
    obj.name = n.name;
    obj.hp = n.hp || 0;
    obj.maxHp = n.maxHp || 0;
    obj.alive = n.alive !== false;
    obj.respawnAt = n.respawnAt || 0;
    // smooth NPC movement a little: lerp toward server position
    const m = obj.mesh;
    if (!obj.alive && !m.userData.ch.dead) {
      obj.diedAt = performance.now();
      chars.die(m.userData.ch);
    }
    if (!wasAlive && obj.alive) {
      chars.revive(m.userData.ch);
      m.position.set(n.x, 0, n.z);
    } else {
      m.position.x += (n.x - m.position.x) * 0.5;
      m.position.z += (n.z - m.position.z) * 0.5;
    }
    let da = (n.facing || 0) - m.rotation.y;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    m.rotation.y += da * 0.4;
    m.visible = obj.alive || performance.now() - obj.diedAt < DEATH_SHOW_MS;
    if (m.userData.hpSprite) {
      setHpSprite(m.userData.hpSprite, obj.hp, obj.maxHp || 1, 0, n.kind === 'reditel' ? '#ffb347' : '#ff5d7a');
      m.userData.hpSprite.visible = obj.alive;
    }
    obj.say = n.say || '';
    obj.sayUntil = n.sayUntil || 0;
    obj.stunUntil = n.stunUntil || 0;
    if (!obj.say) {
      obj.lastSay = '';
    } else if (obj.say !== obj.lastSay) {
      obj.lastSay = obj.say;
      if (n.kind === 'pes') sfx.dog();
      if (n.kind === 'namestek') chars.trigger(m.userData.ch, 'shout');
      if (n.kind === 'pes') chars.trigger(m.userData.ch, 'attack');
    }
    m.userData.stunSprite.visible = obj.alive && now < obj.stunUntil;
  }
  for (const id of [...G.npcs.keys()]) {
    if (!seen.has(id)) {
      const n = G.npcs.get(id);
      removeBubble(n);
      scene.remove(n.mesh);
      disposeObject(n.mesh);
      G.npcs.delete(id);
    }
  }
}

// Speech bubbles are HTML so they can be laid out in screen space: when two
// would overlap, the later one is pushed up.
const bubbleLayer = document.getElementById('fx-layer');

function removeBubble(n) {
  if (n.bubbleEl) {
    n.bubbleEl.remove();
    n.bubbleEl = null;
  }
}

export function updateNpcVisuals(nowMs, dt) {
  const placed = [];
  for (const n of G.npcs.values()) {
    chars.drive(n.mesh.userData.ch, {
      moving: n.speed > 0.25,
      speed: n.speed,
      stunned: n.alive && nowMs < n.stunUntil,
      charging: n.kind === 'namestek' && n.speed > 9,
    }, dt);
    if (!n.alive && n.mesh.visible && performance.now() - n.diedAt >= DEATH_SHOW_MS) n.mesh.visible = false;
    if (n.mesh.userData.healRing) {
      n.mesh.userData.healRing.material.opacity = 0.25 + 0.15 * Math.sin(nowMs / 300);
    }
    const show = n.alive && !!n.say && nowMs <= n.sayUntil;
    if (!show) { removeBubble(n); continue; }
    if (!n.bubbleEl) {
      n.bubbleEl = document.createElement('div');
      n.bubbleEl.className = 'bubble';
      bubbleLayer.appendChild(n.bubbleEl);
      n.bubbleText = '';
    }
    if (n.bubbleText !== n.say) {
      n.bubbleText = n.say;
      n.bubbleEl.textContent = n.say;
    }
    const p = screenPos(n.mesh.position.x, n.mesh.userData.talkY || 3.2, n.mesh.position.z);
    if (!p.visible) { n.bubbleEl.style.display = 'none'; continue; }
    n.bubbleEl.style.display = '';
    const w = n.bubbleEl.offsetWidth || 120;
    const h = n.bubbleEl.offsetHeight || 30;
    let x = p.x, y = p.y; // bubble bottom-center anchor
    // push up while overlapping an already placed bubble
    for (let pass = 0; pass < 3; pass++) {
      for (const o of placed) {
        const overlapX = Math.abs(x - o.x) < (w + o.w) / 2 + 6;
        const overlapY = y > o.y - o.h - 6 && y - h < o.y + 6;
        if (overlapX && overlapY) y = o.y - o.h - 8;
      }
    }
    placed.push({ x, y, w, h });
    n.bubbleEl.style.transform = `translate(-50%, -100%) translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}

// ------------------------------------------------------------ pickups

const PICKUP_COLORS = {
  hp: 0xff5d8c, mana: 0x56d9ff, point: 0xffd84a,
  buff_speed: 0x4fc3ff, buff_hp: 0xff6e8a, buff_mana: 0x6bb7ff, buff_dmg: 0xff9b5c,
};
const PICKUP_LABELS = {
  hp: '+HP', mana: '+MP', buff_speed: 'Rychlost', buff_hp: 'Životy', buff_mana: 'Mana', buff_dmg: 'Poškození',
};

function spawnPickupMesh(pk) {
  const color = PICKUP_COLORS[pk.kind] || 0xffffff;
  const g = new THREE.Group();
  const isBuff = pk.kind.startsWith('buff_');
  const isPoint = pk.kind === 'point';
  const orbMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: isPoint ? 0.6 : 0.85, transparent: true, opacity: 1.0 });
  let geom;
  if (isPoint) geom = new THREE.CylinderGeometry(0.45, 0.45, 0.12, 20);
  else if (isBuff) geom = new THREE.OctahedronGeometry(0.42);
  else geom = new THREE.SphereGeometry(0.3, 14, 10);
  const orb = new THREE.Mesh(geom, orbMat);
  orb.position.y = isPoint ? 0.4 : 0.55;
  if (isPoint) orb.rotation.x = Math.PI / 2;
  g.add(orb);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(isPoint ? 1.3 : 0.45, isPoint ? 1.45 : 0.6, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  g.add(ring);
  const label = isPoint ? '' : (PICKUP_LABELS[pk.kind] || pk.kind);

  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(label, 64, 24);
  ctx.fillStyle = isPoint ? '#ffe9a0' : '#f6fbff';
  ctx.fillText(label, 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.3, 0.5, 1);
  sp.position.set(0, 1.15, 0);
  sp.userData.tex = tex;
  g.add(sp);

  g.position.set(pk.x, 0, pk.z);
  scene.add(g);
  G.pickups.set(pk.id, { id: pk.id, kind: pk.kind, value: pk.value || 1, x: pk.x, z: pk.z, mesh: g, t0: performance.now(), expireAtMs: pk.expireAtMs || 0, orbMat, ringMat, orb });
}

export function removePickup(id) {
  const pk = G.pickups.get(id);
  if (!pk) return;
  if (G.collect && G.collect.id === id) G.collect = null;
  scene.remove(pk.mesh);
  disposeObject(pk.mesh);
  G.pickups.delete(id);
}

export function applyPickupsSnapshot(snap) {
  const seen = new Set();
  for (const pk of (snap.pickups || [])) {
    seen.add(pk.id);
    if (!G.pickups.has(pk.id)) spawnPickupMesh(pk);
    else G.pickups.get(pk.id).expireAtMs = pk.expireAtMs || 0;
  }
  for (const id of [...G.pickups.keys()]) {
    if (!seen.has(id)) removePickup(id);
  }
}

export function updatePickups() {
  const now = performance.now();
  const nowMs = Date.now();
  for (const pk of G.pickups.values()) {
    pk.mesh.position.y = Math.sin((now - pk.t0) / 400) * 0.08;
    pk.orb.rotation.y = (now - pk.t0) / 500;
    if (pk.expireAtMs > 0) {
      const remain = pk.expireAtMs - nowMs;
      const fade = remain <= 10000 ? Math.max(0, Math.min(1, remain / 10000)) : 1;
      pk.orbMat.opacity = 0.2 + 0.8 * fade;
      pk.ringMat.opacity = 0.5 * (0.25 + 0.75 * fade);
    }
  }
  const m = me();
  if (!m || !m.alive) {
    stopCollect();
    return;
  }
  for (const pk of G.pickups.values()) {
    if (pk.kind === 'point') continue;
    const dx = pk.x - G.myPos.x;
    const dz = pk.z - G.myPos.z;
    if (dx * dx + dz * dz <= (PICKUP_RADIUS + PLAYER_RADIUS) ** 2) {
      send({ type: 'pickup', data: { id: pk.id } });
      const color = PICKUP_COLORS[pk.kind] || 0xffffff;
      fx.burst(pk.x, pk.z, color, { count: 10, speed: 3, life: 450, size: 0.7, y: 0.6 });
      sfx.pickup();
      removePickup(pk.id);
    }
  }
  updateCollect(m);
}

// Coins are collected by standing still on them for a moment. The server
// owns the timer; the client only says "I am standing here" / "I left".
function stopCollect() {
  if (!G.collect) return;
  send({ type: 'collect', data: { id: G.collect.id, start: false } });
  G.collect = null;
}

function updateCollect(m) {
  const stillStanding = G.myVel.x === 0 && G.myVel.y === 0 && !G.hasMoveTarget && !G.chargeAnim.active;
  const ok = G.match.phase === 'playing' && stillStanding && Date.now() >= G.myStunUntil;
  let best = null;
  let bestD2 = POINT_COLLECT_RANGE * POINT_COLLECT_RANGE;
  if (ok) {
    for (const pk of G.pickups.values()) {
      if (pk.kind !== 'point') continue;
      const dx = pk.x - G.myPos.x;
      const dz = pk.z - G.myPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; best = pk; }
    }
  }
  if (!best) {
    stopCollect();
    return;
  }
  if (G.collect && G.collect.id === best.id) {
    // server dropped our attempt (stun, moved) -> retry
    if (!m.collectPickup && performance.now() - G.collect.sentAt > 500) {
      G.collect = null;
    } else {
      return;
    }
  } else if (G.collect) {
    stopCollect();
  }
  send({ type: 'collect', data: { id: best.id, start: true } });
  G.collect = { id: best.id, value: best.value, startedAt: performance.now(), sentAt: performance.now() };
}

export function cancelCollectLocal() {
  G.collect = null;
}

// ------------------------------------------------------------ collision targets

export const collision = { targets: [], npcTargets: [], blockers: [] };

export function refreshCollisionTargets() {
  collision.targets.length = 0;
  collision.npcTargets.length = 0;
  collision.blockers.length = 0;
  for (const [id, pl] of G.players) {
    if (!pl.alive || id === G.myId) continue;
    collision.targets.push({ id, x: pl.mesh.position.x, z: pl.mesh.position.z });
  }
  for (const [nid, n] of G.npcs) {
    if (!n.alive) continue;
    if (n.kind === 'sofie') {
      collision.blockers.push({ id: nid, x: n.mesh.position.x, z: n.mesh.position.z, rad: 0.72 });
    } else {
      const rad = n.kind === 'reditel' ? 1.05 : (n.kind === 'pes' ? 0.6 : 0.72);
      collision.npcTargets.push({ id: nid, x: n.mesh.position.x, z: n.mesh.position.z, rad });
    }
  }
}

export function clearWorldEntities() {
  for (const id of [...G.pickups.keys()]) removePickup(id);
}
