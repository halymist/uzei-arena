import * as THREE from 'three';
import { G, me, send } from './state.js';
import { scene, centerCameraOnMe, screenPos } from './scene.js';
import { PLAYER_RADIUS, PLAYER_MODEL_COLORS, PICKUP_RADIUS, INTERP_DELAY_MS, POINT_COLLECT_RANGE } from './config.js';
import { makeNameSprite, setNameSprite, makeHpSprite, setHpSprite, makeStunSprite, disposeSprite } from './sprites.js';
import * as fx from './fx.js';
import { sfx } from './audio.js';

export function modelColor(model) {
  const i = Math.max(0, Math.min(PLAYER_MODEL_COLORS.length - 1, Math.trunc(model || 0)));
  return PLAYER_MODEL_COLORS[i];
}

function disposeObject(root) {
  root.traverse(o => {
    if (o.isSprite) { disposeSprite(o); return; }
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose();
    }
  });
}

// ------------------------------------------------------------ players

export function makeBody(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.8, 4, 10),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.12 })
  );
  body.position.y = 0.9;
  g.add(body);

  const tie = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.5, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x1b2238 })
  );
  tie.position.set(0, 0.85, 0.6);
  g.add(tie);

  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 14, 10),
    new THREE.MeshLambertMaterial({ color: 0xe8f6ff, emissive: 0x9adfff, emissiveIntensity: 0.38 })
  );
  face.position.set(0, 1.12, 0.6);
  g.add(face);

  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x11253d, emissive: 0x8de7ff, emissiveIntensity: 0.5 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), eyeMat);
  eyeL.position.set(-0.055, 1.14, 0.72);
  g.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.055;
  g.add(eyeR);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 0.98, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.userData.ring = ring;

  const shieldBubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x8bd8ff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  );
  shieldBubble.position.y = 0.95;
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
  nameSprite.position.y = 2.2;
  g.add(nameSprite);
  g.userData.nameSprite = nameSprite;

  const hpSprite = makeHpSprite();
  hpSprite.position.y = 1.85;
  g.add(hpSprite);
  g.userData.hpSprite = hpSprite;

  const stunSp = makeStunSprite();
  stunSp.position.y = 2.9;
  stunSp.visible = false;
  g.add(stunSp);
  g.userData.stunSprite = stunSp;

  g.rotation.order = 'YXZ'; // turn first, then lean while running
  g.userData.bodyMat = body.material;
  g.userData.color = color;
  return g;
}

export function applyPlayerModelVisual(pl, model) {
  const color = modelColor(model);
  pl.color = color;
  pl.model = model;
  pl.mesh.userData.bodyMat.color.setHex(color);
  pl.mesh.userData.bodyMat.emissive.setHex(color);
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
    pl.mesh.visible = p.alive;

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

// A little run cycle for the capsule people: forward lean, a quick bob and a
// slight side-to-side roll. Idle settles back to upright.
export function animateBody(mesh, moving, now, dt) {
  const ud = mesh.userData;
  ud.runK = ud.runK ?? 0;
  const target = moving ? 1 : 0;
  ud.runK += (target - ud.runK) * Math.min(1, dt * 14);
  const k = ud.runK;
  const phase = now / 95;
  mesh.rotation.x = 0.16 * k;
  mesh.rotation.z = Math.sin(phase) * 0.06 * k;
  mesh.position.y = Math.abs(Math.sin(phase)) * 0.11 * k;
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
    const moved = Math.hypot(pl.mesh.position.x - prevX, pl.mesh.position.z - prevZ) > 0.002;
    animateBody(pl.mesh, moved, now, dt);
  }
}

// ------------------------------------------------------------ NPCs

export function makeNPCMesh(n) {
  const g = new THREE.Group();
  const kind = n.kind;
  if (kind === 'pes') {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8c6a45, emissive: 0x3d2a18, emissiveIntensity: 0.2 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xa67b4f });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.62), bodyMat);
    body.position.y = 0.58;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.43, 0.45), headMat);
    head.position.set(0, 0.72, 0.72);
    g.add(head);
    const earMat = new THREE.MeshLambertMaterial({ color: 0x3f2b17 });
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 8), earMat);
    earL.position.set(-0.13, 0.95, 0.76);
    earL.rotation.x = Math.PI;
    g.add(earL);
    const earR = earL.clone();
    earR.position.x = 0.13;
    g.add(earR);
    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.44, 8);
    for (const p of [[-0.42, 0.24, 0.22], [0.42, 0.24, 0.22], [-0.42, 0.24, -0.2], [0.42, 0.24, -0.2]]) {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(p[0], p[1], p[2]);
      g.add(leg);
    }
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.42, 8), bodyMat);
    tail.position.set(0, 0.72, -0.72);
    tail.rotation.x = -0.8;
    g.add(tail);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshLambertMaterial({ color: 0x1d130d, emissive: 0x3a2516, emissiveIntensity: 0.35 }));
    muzzle.position.set(0, 0.65, 0.98);
    g.add(muzzle);
  } else if (kind === 'reditel') {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3b3f52, emissive: 0x1a1c28, emissiveIntensity: 0.25 });
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.88, 20, 14), bodyMat);
    torso.scale.set(1.18, 0.92, 1.04);
    torso.position.y = 0.98;
    g.add(torso);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.1), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }));
    shirt.position.set(0, 1.05, 0.86);
    g.add(shirt);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.05), new THREE.MeshLambertMaterial({ color: 0xc0273a }));
    tie.position.set(0, 1.0, 0.93);
    g.add(tie);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshLambertMaterial({ color: 0xf4e2c8 }));
    head.position.set(0, 1.72, 0.3);
    g.add(head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), new THREE.MeshLambertMaterial({ color: 0xf4f9ff, emissive: 0xffb15c, emissiveIntensity: 0.3 }));
    face.position.set(0, 1.74, 0.62);
    g.add(face);
  } else if (kind === 'sofie') {
    const dressMat = new THREE.MeshLambertMaterial({ color: 0x84b6ff, emissive: 0x335b95, emissiveIntensity: 0.16 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.05, 16), dressMat);
    torso.position.y = 0.94;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 11), new THREE.MeshLambertMaterial({ color: 0xf2dccf }));
    head.position.set(0, 1.58, 0.2);
    g.add(head);
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x3f2217 });
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), hairMat);
    hairCap.scale.set(1.04, 0.74, 1.05);
    hairCap.position.set(0, 1.72, 0.12);
    g.add(hairCap);
    const pony = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.55, 10), hairMat);
    pony.position.set(0, 1.48, -0.22);
    pony.rotation.x = 0.46;
    g.add(pony);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 9), new THREE.MeshLambertMaterial({ color: 0xf8fbff, emissive: 0x8adfff, emissiveIntensity: 0.2 }));
    face.position.set(0, 1.58, 0.48);
    g.add(face);
    const healRing = new THREE.Mesh(new THREE.RingGeometry(2.25, 2.4, 48), new THREE.MeshBasicMaterial({ color: 0x8dffb6, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    healRing.rotation.x = -Math.PI / 2;
    healRing.position.y = 0.05;
    g.add(healRing);
    g.userData.healRing = healRing;
  } else if (kind === 'curda') {
    const coatMat = new THREE.MeshLambertMaterial({ color: 0xb4cc64, emissive: 0x4f5f28, emissiveIntensity: 0.2 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.45, 1.08, 16), coatMat);
    torso.position.y = 0.95;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 11), new THREE.MeshLambertMaterial({ color: 0xf0dccd }));
    head.position.set(0, 1.58, 0.2);
    g.add(head);
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: 0x1d1f29 }));
    glasses.position.set(0, 1.59, 0.45);
    g.add(glasses);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.24, 0.03), new THREE.MeshLambertMaterial({ color: 0x2b2f3f, emissive: 0x6cf0ff, emissiveIntensity: 0.6 }));
    phone.position.set(0.26, 1.0, 0.35);
    phone.rotation.y = -0.6;
    g.add(phone);
  } else {
    // namestek: suit, no tie, big nose
    const color = 0x6b8fcf;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, 0.9, 4, 8), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.12 }));
    body.position.y = 0.95;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 11), new THREE.MeshLambertMaterial({ color: 0xf0d8c4 }));
    head.position.set(0, 1.75, 0.15);
    g.add(head);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0xe8b9a0 }));
    nose.position.set(0, 1.72, 0.44);
    nose.rotation.x = Math.PI / 2;
    g.add(nose);
    const folder = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.05), new THREE.MeshLambertMaterial({ color: 0xf2e6b0 }));
    folder.position.set(0.5, 1.0, 0.3);
    g.add(folder);
  }

  // vertical stack above the head: hp bar, name, (bounty), stun stars, speech bubble
  const stack = kind === 'pes'
    ? { hp: 1.45, name: 1.8, stun: 2.2, talk: 2.85 }
    : kind === 'reditel'
      ? { hp: 2.35, name: 2.7, stun: 3.3, talk: 3.95 }
      : { hp: 2.05, name: 2.4, stun: 2.85, talk: 3.5 };

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
      obj = { id: n.id, mesh, kind: n.kind, name: n.name, hp: n.hp || 0, maxHp: n.maxHp || 0, alive: n.alive !== false, say: '', sayUntil: 0, lastSay: '', stunUntil: 0 };
      G.npcs.set(n.id, obj);
      mesh.position.set(n.x, 0, n.z);
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
    if (!wasAlive && obj.alive) {
      m.position.set(n.x, 0, n.z);
    } else {
      m.position.x += (n.x - m.position.x) * 0.5;
      m.position.z += (n.z - m.position.z) * 0.5;
    }
    let da = (n.facing || 0) - m.rotation.y;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    m.rotation.y += da * 0.4;
    m.visible = obj.alive;
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

export function updateNpcVisuals(nowMs) {
  const placed = [];
  for (const n of G.npcs.values()) {
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
