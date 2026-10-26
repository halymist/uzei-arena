import * as THREE from 'three';
import { G, me, send, canAct } from './state.js';
import { scene, pointInObstacle, pointInProjectileBlocker, segmentEndpoint, clampToMap, halfX, halfZ, updateMouseWorld } from './scene.js';
import * as C from './config.js';
import { collision, playerPos } from './entities.js';
import * as fx from './fx.js';
import { sfx } from './audio.js';

// Casting, projectiles and the visual side of area spells. The owner of a
// projectile detects its hits and tells the server.

const projectiles = [];
const beamWarnings = [];
const activePools = [];
const activeOrbits = [];
const activeGroundBursts = [];

// ------------------------------------------------------------ queries

export function cooldownMs(base) {
  return Math.max(250, Math.round(base * G.myStats.cdrMult));
}

export function isLocked(kind) {
  return G.myLock.spell === kind && G.myLock.until > Date.now();
}

export function hasSpell(kind) {
  return G.myStats.spells.has(kind);
}

export function canCast(kind, now = performance.now()) {
  const m = me();
  if (!m || !m.alive || !kind) return false;
  if (!canAct()) return false;
  if (Date.now() < G.myStunUntil) return false;
  if (!hasSpell(kind) || isLocked(kind)) return false;
  const def = C.SPELL_DEFS[kind];
  if (!def || G.myMana < def.cost) return false;
  switch (kind) {
    case 'q': return now >= G.cd.q && now >= G.qBurstUntil;
    case 'w': return now >= G.wActiveUntil;
    case 'r': return now >= G.cd.r && now >= G.rCastUntil;
    case 'aa': return now >= G.cd.aa;
    default: return now >= (G.cd[kind] || 0);
  }
}

const BASE_CD = { q: C.Q.cooldownMs, e: C.E.cooldownMs, r: C.R.cooldownMs, c: C.C.cooldownMs, v: C.V.cooldownMs, x: C.X.cooldownMs, z: C.Z.cooldownMs, s: C.S.cooldownMs, f: C.F.cooldownMs, g: C.G_WAVE.cooldownMs, aa: C.AA.cooldownMs };

export function cooldownInfo(kind, now = performance.now()) {
  if (kind === 'w') {
    const remain = Math.max(0, G.wActiveUntil - now);
    const total = C.W.durationMs * G.myStats.sprintMult;
    return { ratio: Math.min(1, remain / total), remain };
  }
  const remain = Math.max(0, (G.cd[kind] || 0) - now);
  const total = kind === 'aa' ? C.AA.cooldownMs : cooldownMs(BASE_CD[kind] || 1000);
  return { ratio: Math.min(1, remain / total), remain };
}

// ------------------------------------------------------------ casting

export function cast(kind) {
  if (!canCast(kind)) return false;
  const now = performance.now();
  updateMouseWorld();
  switch (kind) {
    case 'aa':
      G.cd.aa = now + C.AA.cooldownMs;
      fireProjectile('aa');
      return true;
    case 'q':
      G.cd.q = now + cooldownMs(C.Q.cooldownMs);
      G.qBurstUntil = now + C.Q.burstMs + G.myStats.salvaExtra * C.Q.intervalMs;
      G.qBurstNextShotAt = now;
      G.myMana -= C.Q.cost;
      send({ type: 'cast', data: { kind: 'q' } });
      return true;
    case 'w':
      G.wActiveUntil = now + C.W.durationMs * G.myStats.sprintMult;
      G.myMana -= C.W.cost;
      send({ type: 'cast', data: { kind: 'w' } });
      sfx.cast('w');
      fx.ringPulse(G.myPos.x, G.myPos.z, 0xa9f6ff, 1.8, 350);
      return true;
    case 'e':
      return tryTeleport(now);
    case 'r':
      G.hasMoveTarget = false;
      G.mouse.rightDown = false;
      G.myVel.x = 0; G.myVel.y = 0;
      G.cd.r = now + cooldownMs(C.R.cooldownMs);
      G.rCastUntil = now + C.R.castMs;
      sfx.cast('rcharge');
      return true;
    case 'c':
      return tryCharge(now);
    case 'v':
      G.cd.v = now + cooldownMs(C.V.cooldownMs);
      G.myMana -= C.V.cost;
      spawnPoolEffect(G.myId, C.V.radius, C.V.durationMs);
      send({ type: 'cast', data: { kind: 'v' } });
      sfx.cast('v');
      return true;
    case 'x':
      G.cd.x = now + cooldownMs(C.X.cooldownMs);
      G.myMana -= C.X.cost;
      fireProjectile('x');
      return true;
    case 'z':
      return tryCastZ(now);
    case 's':
      G.cd.s = now + cooldownMs(C.S.cooldownMs);
      G.myMana -= C.S.cost;
      send({ type: 'cast', data: { kind: 's' } });
      sfx.cast('s');
      fx.ringPulse(G.myPos.x, G.myPos.z, 0x8bd8ff, 2.2, 400);
      return true;
    case 'f':
      G.cd.f = now + cooldownMs(C.F.cooldownMs);
      G.myMana -= C.F.cost;
      spawnOrbitEffect(G.myId, C.F.radius, C.F.durationMs);
      send({ type: 'cast', data: { kind: 'f' } });
      sfx.cast('f');
      return true;
    case 'g':
      G.cd.g = now + cooldownMs(C.G_WAVE.cooldownMs);
      G.myMana -= C.G_WAVE.cost;
      fireProjectile('g');
      return true;
  }
  return false;
}

function isTeleportBlocked(x, z) {
  if (pointInObstacle(x, z, C.PLAYER_RADIUS)) return true;
  for (const [id, pl] of G.players) {
    if (id === G.myId || !pl.alive) continue;
    const dx = pl.mesh.position.x - x;
    const dz = pl.mesh.position.z - z;
    if (dx * dx + dz * dz < (C.PLAYER_RADIUS * 2) ** 2 * 0.9) return true;
  }
  for (const n of G.npcs.values()) {
    if (!n.alive) continue;
    const nRad = n.kind === 'reditel' ? 1.0 : 0.72;
    const dx = n.mesh.position.x - x;
    const dz = n.mesh.position.z - z;
    if (dx * dx + dz * dz < (C.PLAYER_RADIUS + nRad) ** 2 * 0.9) return true;
  }
  return false;
}

function findTeleportSpot(targetX, targetZ, maxSearchRadius = 2.8) {
  const primary = clampToMap(targetX, targetZ);
  if (!isTeleportBlocked(primary.x, primary.z)) return primary;
  const step = 0.2;
  const samples = 24;
  for (let r = step; r <= maxSearchRadius + 0.001; r += step) {
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const cand = clampToMap(targetX + Math.cos(a) * r, targetZ + Math.sin(a) * r);
      if (!isTeleportBlocked(cand.x, cand.z)) return cand;
    }
  }
  return null;
}

function tryTeleport(now) {
  let dx, dz;
  if (G.mouse.has) {
    dx = G.mouse.worldX - G.myPos.x;
    dz = G.mouse.worldZ - G.myPos.z;
  } else {
    dx = Math.sin(G.myFacing);
    dz = Math.cos(G.myFacing);
  }
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return false;
  const ux = dx / dist, uz = dz / dist;
  const want = Math.min(C.E.range * G.myStats.eRangeMult, dist);
  const spot = findTeleportSpot(G.myPos.x + ux * want, G.myPos.z + uz * want);
  if (!spot) return false;

  fx.burst(G.myPos.x, G.myPos.z, 0x78c3ff, { count: 10, speed: 3, life: 350, size: 0.7 });
  G.myPos.x = spot.x;
  G.myPos.z = spot.z;
  G.hasMoveTarget = false;
  G.cd.e = now + cooldownMs(C.E.cooldownMs);
  G.myMana -= C.E.cost;
  G.blink.active = true;
  G.blink.start = now;
  G.ignoreServerSnapUntil = now + 350;
  send({ type: 'state', data: { x: G.myPos.x, z: G.myPos.z, facing: G.myFacing } });
  send({ type: 'cast', data: { kind: 'e', x: G.myPos.x, z: G.myPos.z } });
  fx.burst(spot.x, spot.z, 0x78c3ff, { count: 10, speed: 3, life: 350, size: 0.7 });
  sfx.cast('e');
  return true;
}

function tryCharge(now) {
  // dash toward the mouse, not wherever the body happens to face
  let dirX = Math.sin(G.myFacing);
  let dirZ = Math.cos(G.myFacing);
  if (G.mouse.has) {
    const mx = G.mouse.worldX - G.myPos.x;
    const mz = G.mouse.worldZ - G.myPos.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) { dirX = mx / ml; dirZ = mz / ml; }
  }
  G.aimFacing = Math.atan2(dirX, dirZ);
  G.aimUntil = now + C.C.dashMs;
  const end = segmentEndpoint(G.myPos.x, G.myPos.z, dirX, dirZ, C.C.dashDist, C.PLAYER_RADIUS);
  const ca = G.chargeAnim;
  ca.active = true;
  ca.startAt = now;
  ca.endAt = now + C.C.dashMs;
  ca.fromX = G.myPos.x;
  ca.fromZ = G.myPos.z;
  ca.toX = Math.max(-halfX, Math.min(halfX, end.x));
  ca.toZ = Math.max(-halfZ, Math.min(halfZ, end.z));
  G.hasMoveTarget = false;
  G.mouse.rightDown = false;
  G.myVel.x = 0; G.myVel.y = 0;
  G.cd.c = now + cooldownMs(C.C.cooldownMs);
  G.myMana -= C.C.cost;
  send({ type: 'state', data: { x: ca.fromX, z: ca.fromZ, facing: G.aimFacing } });
  send({ type: 'cast', data: { kind: 'c' } });
  send({ type: 'state', data: { x: ca.toX, z: ca.toZ, facing: G.aimFacing } });
  G.ignoreServerSnapUntil = now + 400;
  sfx.cast('c');
  return true;
}

function tryCastZ(now) {
  let tx = G.myPos.x + Math.sin(G.myFacing) * 3.5;
  let tz = G.myPos.z + Math.cos(G.myFacing) * 3.5;
  if (G.mouse.has) { tx = G.mouse.worldX; tz = G.mouse.worldZ; }
  const dx = tx - G.myPos.x;
  const dz = tz - G.myPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > C.Z.castRange && dist > 0.001) {
    tx = G.myPos.x + (dx / dist) * C.Z.castRange;
    tz = G.myPos.z + (dz / dist) * C.Z.castRange;
  }
  tx = Math.max(-halfX + 0.5, Math.min(halfX - 0.5, tx));
  tz = Math.max(-halfZ + 0.5, Math.min(halfZ - 0.5, tz));
  G.cd.z = now + cooldownMs(C.Z.cooldownMs);
  G.myMana -= C.Z.cost;
  spawnGroundBurst(G.myId, tx, tz, C.Z.radius, C.Z.delayMs, C.Z.dmg);
  send({ type: 'fire', data: { pid: G.myProjectileSeq++, ox: tx, oz: tz, dx: C.Z.radius, dz: C.Z.delayMs / 1000, kind: 'z' } });
  sfx.cast('z');
  return true;
}

// ------------------------------------------------------------ projectiles

export function projectileSpec(kind) {
  switch (kind) {
    case 'reditel': return { radius: 0.22, startSpeed: 12, maxSpeed: 12, accel: 0, range: 11, dmg: 8, pierce: false };
    case 'reditel_beam': return { radius: 0.92, startSpeed: 78, maxSpeed: 78, accel: 0, range: 44, dmg: 55, pierce: true };
    case 'curda_stun': return { radius: 0.6, startSpeed: 22, maxSpeed: 22, accel: 0, range: 18, dmg: 12, pierce: false };
    case 'curda_salva': return { radius: 0.3, startSpeed: 24, maxSpeed: 24, accel: 0, range: 16, dmg: 7, pierce: false };
    case 'r': return { radius: C.R.radius, startSpeed: C.R.speedStart, maxSpeed: C.R.speedMax, accel: C.R.accel, range: C.R.range, dmg: C.R.dmg, pierce: true };
    case 'aa': return { radius: C.AA.radius, startSpeed: C.AA.speedStart, maxSpeed: C.AA.speedMax, accel: C.AA.accel, range: C.AA.range, dmg: C.AA.dmg, pierce: false };
    case 'x': return { radius: C.X.radius, startSpeed: C.X.speedStart, maxSpeed: C.X.speedMax, accel: C.X.accel, range: C.X.range, dmg: C.X.dmg, pierce: false };
    case 'g': return { radius: C.G_WAVE.baseRadius, startSpeed: C.G_WAVE.speed, maxSpeed: C.G_WAVE.speed, accel: 0, range: C.G_WAVE.range, dmg: C.G_WAVE.dmg, pierce: true, waveGrow: C.G_WAVE.maxRadius - C.G_WAVE.baseRadius, waveMax: C.G_WAVE.maxRadius };
    default: return { radius: C.Q.radius, startSpeed: C.Q.speedStart, maxSpeed: C.Q.speedMax, accel: C.Q.accel, range: C.Q.range, dmg: C.Q.dmg, pierce: false };
  }
}

export function fireProjectile(kind) {
  let dx = G.mouse.worldX - G.myPos.x;
  let dz = G.mouse.worldZ - G.myPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001 || !G.mouse.has) {
    dx = Math.sin(G.myFacing); dz = Math.cos(G.myFacing);
  } else {
    dx /= len; dz /= len;
  }
  const pid = G.myProjectileSeq++;
  const ox = G.myPos.x + dx * (C.PLAYER_RADIUS + 0.3);
  const oz = G.myPos.z + dz * (C.PLAYER_RADIUS + 0.3);
  G.aimFacing = Math.atan2(dx, dz);
  G.aimUntil = performance.now() + 320;
  spawnProjectile({ owner: G.myId, pid, ox, oz, dx, dz, kind });
  send({ type: 'fire', data: { pid, ox, oz, dx, dz, kind } });
  sfx.shoot(kind);
  fx.muzzleFlash(ox, oz, C.SPELL_COLORS[kind] || 0xffe48a);
}

export function spawnProjectile(p) {
  const kind = p.kind || 'q';
  const spec = projectileSpec(kind);
  const mine = p.owner === G.myId;
  let color = C.SPELL_COLORS[kind] ?? 0xffe48a;
  if (!mine && (kind === 'q' || kind === 'aa')) color = 0xff9b66;

  const isBolt = kind === 'x' || kind === 'curda_stun';
  const geom = isBolt ? new THREE.BoxGeometry(1.2, 0.4, 0.4) : new THREE.SphereGeometry(spec.radius, 12, 9);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(p.ox, 1.0, p.oz);
  if (isBolt) mesh.rotation.y = Math.atan2(p.dx, p.dz);
  scene.add(mesh);

  // simple trail: a stretched transparent copy behind the head
  const trail = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius * 0.5, spec.radius * 0.1, 1.6, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
  );
  trail.rotation.x = Math.PI / 2;
  trail.position.z = -0.9;
  const head = new THREE.Group();
  head.add(trail);
  head.rotation.y = Math.atan2(p.dx, p.dz);
  head.position.set(p.ox, 1.0, p.oz);
  if (!isBolt) scene.add(head);

  if (kind === 'reditel_beam') sfx.shoot('r');
  else if (!mine && (kind === 'reditel' || kind === 'curda_salva' || kind === 'curda_stun')) sfx.shoot('q');
  else if (!mine) sfx.shoot(kind);

  projectiles.push({
    pid: p.pid, owner: p.owner, x: p.ox, z: p.oz, dirX: p.dx, dirZ: p.dz,
    speed: spec.startSpeed, maxSpeed: spec.maxSpeed, accel: spec.accel,
    radius: spec.radius, baseRadius: spec.radius, waveGrow: spec.waveGrow || 0, waveMax: spec.waveMax || spec.radius,
    range: spec.range, dmg: spec.dmg, pierce: spec.pierce, kind, dist: 0, mesh, head: isBolt ? null : head, hitSet: new Set(), color,
  });
}

function disposeProjectile(i) {
  const pr = projectiles[i];
  if (!pr) return;
  scene.remove(pr.mesh);
  pr.mesh.geometry.dispose();
  pr.mesh.material.dispose();
  if (pr.head) {
    scene.remove(pr.head);
    pr.head.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  projectiles.splice(i, 1);
}

// Projectiles advance in sub-steps of at most SUBSTEP units so a fast shot
// cannot pass through a body between two frames on a slow machine.
const SUBSTEP = 0.35;
const HIT_FORGIVE = 0.08; // a touch more than the visual capsule

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.speed = Math.min(pr.maxSpeed, pr.speed + pr.accel * dt);
    const total = pr.speed * dt;
    const steps = Math.max(1, Math.ceil(total / SUBSTEP));
    const stepLen = total / steps;
    let remove = false;

    for (let s = 0; s < steps && !remove; s++) {
      pr.x += pr.dirX * stepLen;
      pr.z += pr.dirZ * stepLen;
      pr.dist += stepLen;
      if (pr.waveGrow > 0) {
        const ratio = Math.max(0, Math.min(1, pr.dist / Math.max(0.001, pr.range)));
        pr.radius = Math.min(pr.waveMax, pr.baseRadius + pr.waveGrow * ratio);
      }

      if (pr.dist > pr.range || Math.abs(pr.x) > halfX + 1 || Math.abs(pr.z) > halfZ + 1) { remove = true; break; }

      // walls stop everything except R and the beam
      if (!pr.pierce && pointInProjectileBlocker(pr.x, pr.z, pr.radius)) {
        fx.burst(pr.x, pr.z, pr.color, { count: 5, speed: 2.5, life: 250, size: 0.6 });
        remove = true;
        break;
      }
      // neutral NPCs body-block
      for (const n of collision.blockers) {
        if (n.id === pr.owner) continue;
        const dxn = n.x - pr.x, dzn = n.z - pr.z;
        if (dxn * dxn + dzn * dzn <= (pr.radius + n.rad) ** 2) {
          fx.burst(pr.x, pr.z, pr.color, { count: 5, speed: 2.5, life: 250, size: 0.6 });
          remove = true;
          break;
        }
      }
      if (remove) break;

      if (pr.owner !== G.myId) continue; // only the shooter decides hits

      for (const target of collision.targets) {
        if (pr.hitSet.has(target.id)) continue;
        const dx = target.x - pr.x, dz = target.z - pr.z;
        const extra = (pr.kind === 'r' ? 0.35 : 0.0) + HIT_FORGIVE;
        if (dx * dx + dz * dz <= (pr.radius + C.PLAYER_RADIUS + extra) ** 2) {
          pr.hitSet.add(target.id);
          send({ type: 'hit', data: { pid: pr.pid, target: target.id, dmg: pr.dmg } });
          fx.burst(pr.x, pr.z, pr.color, { count: 6, speed: 3, life: 280, size: 0.7 });
          if (!pr.pierce) { remove = true; break; }
        }
      }
      if (remove) break;
      for (const n of collision.npcTargets) {
        const nk = `n${n.id}`;
        if (pr.hitSet.has(nk)) continue;
        const dx = n.x - pr.x, dz = n.z - pr.z;
        if (dx * dx + dz * dz <= (pr.radius + n.rad + HIT_FORGIVE) ** 2) {
          pr.hitSet.add(nk);
          send({ type: 'hit', data: { pid: pr.pid, target: n.id, dmg: pr.dmg } });
          fx.burst(pr.x, pr.z, pr.color, { count: 6, speed: 3, life: 280, size: 0.7 });
          if (!pr.pierce) { remove = true; break; }
        }
      }
    }

    if (remove) { disposeProjectile(i); continue; }
    if (pr.waveGrow > 0) {
      const sc = pr.radius / Math.max(0.001, pr.baseRadius);
      pr.mesh.scale.set(sc, Math.max(0.7, sc * 0.75), sc);
    }
    pr.mesh.position.x = pr.x;
    pr.mesh.position.z = pr.z;
    if (pr.head) { pr.head.position.x = pr.x; pr.head.position.z = pr.z; }
  }
}

// Called when the server confirms a hit by someone else's projectile: the
// copy flying on this screen vanishes where the real hit happened.
export function removeProjectileOf(owner, pid) {
  if (!pid || owner === G.myId) return;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    if (pr.owner === owner && pr.pid === pid && !pr.pierce) {
      fx.burst(pr.x, pr.z, pr.color, { count: 6, speed: 3, life: 280, size: 0.7 });
      disposeProjectile(i);
      return;
    }
  }
}

// ------------------------------------------------------------ area effects

export function spawnBeamWarning(p) {
  const sx = p.ox, sz = p.oz;
  const ex = sx + p.dx * C.REDITEL_BEAM_WARN_RANGE;
  const ez = sz + p.dz * C.REDITEL_BEAM_WARN_RANGE;
  const geom = new THREE.PlaneGeometry(C.REDITEL_BEAM_WARN_RANGE, 1.9);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5f7f, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const plane = new THREE.Mesh(geom, mat);
  plane.rotation.x = -Math.PI / 2;
  plane.rotation.z = -Math.atan2(p.dz, p.dx);
  plane.position.set((sx + ex) / 2, 0.1, (sz + ez) / 2);
  scene.add(plane);
  beamWarnings.push({ mesh: plane, startAt: performance.now(), endAt: performance.now() + C.REDITEL_BEAM_WARN_MS });
  sfx.beamWarn();
}

function updateBeamWarnings(now) {
  for (let i = beamWarnings.length - 1; i >= 0; i--) {
    const w = beamWarnings[i];
    if (now >= w.endAt) {
      scene.remove(w.mesh);
      w.mesh.geometry.dispose();
      w.mesh.material.dispose();
      beamWarnings.splice(i, 1);
      continue;
    }
    const k = (now - w.startAt) / Math.max(1, w.endAt - w.startAt);
    w.mesh.material.opacity = 0.25 + 0.45 * k * (0.5 + 0.5 * Math.sin(now / 40));
  }
}

export function spawnPoolEffect(ownerId, radius, durationMS) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: 0x76ffd1, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  scene.add(disc);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.12, radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xbfffe8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.07;
  scene.add(rim);
  activePools.push({ ownerId, disc, rim, startAt: performance.now(), endAt: performance.now() + durationMS });
}

function updatePools(now) {
  for (let i = activePools.length - 1; i >= 0; i--) {
    const p = activePools[i];
    if (now >= p.endAt) {
      for (const m of [p.disc, p.rim]) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      activePools.splice(i, 1);
      continue;
    }
    const pos = playerPos(p.ownerId);
    if (pos) {
      p.disc.position.x = pos.x; p.disc.position.z = pos.z;
      p.rim.position.x = pos.x; p.rim.position.z = pos.z;
    }
    const t = (now - p.startAt) * 0.01;
    p.disc.material.opacity = 0.26 + 0.12 * (0.5 + 0.5 * Math.sin(t));
  }
}

export function spawnOrbitEffect(ownerId, radius, durationMS) {
  for (let i = activeOrbits.length - 1; i >= 0; i--) {
    if (activeOrbits[i].ownerId === ownerId) {
      for (const m of activeOrbits[i].meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      activeOrbits.splice(i, 1);
    }
  }
  const meshes = [];
  for (let i = 0; i < 3; i++) {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 9), new THREE.MeshBasicMaterial({ color: 0xb5f6ff }));
    scene.add(orb);
    meshes.push(orb);
  }
  activeOrbits.push({ ownerId, radius, startAt: performance.now(), endAt: performance.now() + durationMS, meshes });
}

function updateOrbits(now) {
  for (let i = activeOrbits.length - 1; i >= 0; i--) {
    const o = activeOrbits[i];
    if (now >= o.endAt) {
      for (const m of o.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      activeOrbits.splice(i, 1);
      continue;
    }
    const pos = playerPos(o.ownerId) || { x: 0, z: 0 };
    const t = ((Date.now() % C.F.periodMs) / C.F.periodMs) * Math.PI * 2;
    for (let k = 0; k < o.meshes.length; k++) {
      const a = t + k * (Math.PI * 2 / o.meshes.length);
      o.meshes[k].position.set(pos.x + Math.sin(a) * o.radius, 1.0, pos.z + Math.cos(a) * o.radius);
    }
  }
}

export function spawnGroundBurst(ownerId, x, z, radius, delayMS, damage) {
  const telegraph = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.1, radius - 0.09), radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xffb37a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  telegraph.rotation.x = -Math.PI / 2;
  telegraph.position.set(x, 0.08, z);
  scene.add(telegraph);
  const fillDisc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xff8a4a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
  );
  fillDisc.rotation.x = -Math.PI / 2;
  fillDisc.position.set(x, 0.07, z);
  scene.add(fillDisc);
  const now = performance.now();
  activeGroundBursts.push({
    ownerId, x, z, radius, damage,
    startAt: now, detonateAt: now + delayMS, lingerUntil: now + delayMS + C.Z.lingerMs,
    nextTickAt: now + delayMS, endAt: now + delayMS + C.Z.lingerMs,
    telegraph, fillDisc, exploded: false,
  });
}

function applyGroundBurstDamage(x, z, radius, damage) {
  if (damage <= 0) return;
  for (const t of collision.targets) {
    const dx = t.x - x, dz = t.z - z;
    if (dx * dx + dz * dz <= (radius + C.PLAYER_RADIUS) ** 2) send({ type: 'hit', data: { pid: 0, target: t.id, dmg: damage } });
  }
  for (const n of collision.npcTargets) {
    const dx = n.x - x, dz = n.z - z;
    if (dx * dx + dz * dz <= (radius + n.rad) ** 2) send({ type: 'hit', data: { pid: 0, target: n.id, dmg: damage } });
  }
}

function updateGroundBursts(now) {
  for (let i = activeGroundBursts.length - 1; i >= 0; i--) {
    const b = activeGroundBursts[i];
    if (!b.exploded && now >= b.detonateAt) {
      b.exploded = true;
      scene.remove(b.telegraph);
      b.telegraph.geometry.dispose();
      b.telegraph.material.dispose();
      b.fillDisc.material.opacity = 0.66;
      fx.burst(b.x, b.z, 0xff8a4a, { count: 22, speed: 7, life: 600, size: 1.2, y: 0.3 });
      fx.ringPulse(b.x, b.z, 0xffb37a, b.radius * 1.6, 350);
      sfx.explode();
      if (Math.hypot(b.x - G.myPos.x, b.z - G.myPos.z) < 9) fx.shake(0.35);
      if (b.ownerId === G.myId && b.damage > 0) applyGroundBurstDamage(b.x, b.z, b.radius, b.damage);
      b.nextTickAt = now + C.Z.tickMs;
    }
    if (b.exploded) {
      if (b.ownerId === G.myId && b.damage > 0 && now < b.lingerUntil) {
        const dot = Math.max(1, Math.round(b.damage * C.Z.lingerFactor));
        while (now >= b.nextTickAt && b.nextTickAt < b.lingerUntil) {
          applyGroundBurstDamage(b.x, b.z, b.radius, dot);
          b.nextTickAt += C.Z.tickMs;
        }
      }
      const left = Math.max(0, Math.min(1, (b.endAt - now) / Math.max(1, C.Z.lingerMs)));
      b.fillDisc.material.opacity = 0.2 + 0.4 * left;
    } else {
      const pre = Math.max(0, Math.min(1, (b.detonateAt - now) / Math.max(1, b.detonateAt - b.startAt)));
      b.telegraph.material.opacity = 0.35 + 0.6 * (1 - pre);
      b.telegraph.scale.setScalar(1 + 0.05 * Math.sin(now / 40));
    }
    if (now >= b.endAt) {
      if (b.telegraph.parent) { scene.remove(b.telegraph); b.telegraph.geometry.dispose(); b.telegraph.material.dispose(); }
      scene.remove(b.fillDisc);
      b.fillDisc.geometry.dispose();
      b.fillDisc.material.dispose();
      activeGroundBursts.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------ aim line

const aimLineMat = new THREE.LineBasicMaterial({ color: 0x80e7ff, transparent: true, opacity: 0.4 });
const aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), aimLineMat);
aimLine.visible = false;
scene.add(aimLine);

function updateAimLine(alive) {
  if (!alive || !G.mouse.has) { aimLine.visible = false; return; }
  const dx = G.mouse.worldX - G.myPos.x;
  const dz = G.mouse.worldZ - G.myPos.z;
  const len = Math.hypot(dx, dz);
  if (len <= 0.001) { aimLine.visible = false; return; }
  const ux = dx / len, uz = dz / len;
  const charging = G.rCastUntil > performance.now();
  const reach = charging ? C.R.range : C.AA.range;
  aimLineMat.color.setHex(charging ? 0xff7df6 : 0x80e7ff);
  aimLineMat.opacity = charging ? 0.9 : 0.35;
  const start = new THREE.Vector3(G.myPos.x + ux * (C.PLAYER_RADIUS + 0.2), 0.08, G.myPos.z + uz * (C.PLAYER_RADIUS + 0.2));
  const end = new THREE.Vector3(start.x + ux * reach, 0.08, start.z + uz * reach);
  aimLine.geometry.setFromPoints([start, end]);
  aimLine.visible = true;
}

// ------------------------------------------------------------ per frame

export function update(dt, alive) {
  const now = performance.now();
  if (alive) {
    while (now < G.qBurstUntil && now >= G.qBurstNextShotAt) {
      fireProjectile('q');
      G.qBurstNextShotAt += C.Q.intervalMs;
    }
    if (G.rCastUntil > 0 && now >= G.rCastUntil) {
      fireProjectile('r');
      fx.shake(0.25);
      G.rCastUntil = 0;
    }
  } else {
    G.qBurstUntil = 0;
    G.rCastUntil = 0;
  }
  updateProjectiles(dt);
  updateGroundBursts(now);
  updateBeamWarnings(now);
  updatePools(now);
  updateOrbits(now);
  updateAimLine(alive);
}

export function clearEffects() {
  while (projectiles.length) disposeProjectile(projectiles.length - 1);
  for (const w of beamWarnings) { scene.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); }
  beamWarnings.length = 0;
  for (const p of activePools) for (const m of [p.disc, p.rim]) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  activePools.length = 0;
  for (const o of activeOrbits) for (const m of o.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  activeOrbits.length = 0;
  for (const b of activeGroundBursts) {
    for (const m of [b.telegraph, b.fillDisc]) { if (m.parent) scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }
  activeGroundBursts.length = 0;
}

export function resetCooldowns() {
  for (const k of Object.keys(G.cd)) G.cd[k] = 0;
  G.wActiveUntil = 0;
  G.qBurstUntil = 0;
  G.rCastUntil = 0;
  G.chargeAnim.active = false;
  G.blink.active = false;
}
