import { G, me, send } from './state.js';
import { renderer, scene, camera, resize, updateCamera, updateMouseWorld, resolveMove, halfX, halfZ, centerCameraOnMe } from './scene.js';
import { MOVE_SPEED, PLAYER_RADIUS, SEND_HZ, W, E, PLAYER_MODEL_COLORS } from './config.js';
import * as ent from './entities.js';
import * as spells from './spells.js';
import * as hud from './hud.js';
import * as fx from './fx.js';
import { initInput } from './input.js';
import { connect } from './net.js';
import * as audio from './audio.js';
import { ready as charactersReady } from './characters.js';

// ------------------------------------------------------------ name modal

const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('name-input');
const nameGo = document.getElementById('name-go');

const savedName = sessionStorage.getItem('superhry-name') || localStorage.getItem('superhry-name') || '';
// a random colour each visit so a group does not all end up the same
G.selectedModel = Math.floor(Math.random() * PLAYER_MODEL_COLORS.length);
if (savedName) nameInput.value = savedName;


function startWithName() {
  const n = (nameInput.value || 'player').trim().slice(0, 16);
  G.myName = n || 'player';
  try {
    sessionStorage.setItem('superhry-name', G.myName);
    sessionStorage.setItem('superhry-model', String(G.selectedModel));
    localStorage.setItem('superhry-name', G.myName);
    localStorage.setItem('superhry-model', String(G.selectedModel));
  } catch { /* ignore */ }
  nameModal.style.display = 'none';
  audio.init();
  // the rigs are small and local; wait for them so the first snapshot has bodies
  charactersReady.then(startGame);
}
nameGo.addEventListener('click', startWithName);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') startWithName(); });

// ------------------------------------------------------------ game loop

let lastT = 0;
let lastSendT = 0;

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  const now = performance.now();

  updateMouseWorld();
  const m = me();
  const alive = m ? m.alive : false;

  if (alive) {
    const stunned = Date.now() < G.myStunUntil;
    const ca = G.chargeAnim;
    if (ca.active) {
      const k = Math.max(0, Math.min(1, (now - ca.startAt) / Math.max(1, ca.endAt - ca.startAt)));
      G.myPos.x = ca.fromX + (ca.toX - ca.fromX) * k;
      G.myPos.z = ca.fromZ + (ca.toZ - ca.fromZ) * k;
      G.hasMoveTarget = false;
      G.myVel.x = 0; G.myVel.y = 0;
      if (k >= 1) ca.active = false;
    }

    const sprintActive = now < G.wActiveUntil;
    const speedBuff = G.myBuffs.has('speed') && G.myBuffs.get('speed') > Date.now() ? 1.1 : 1.0;
    const moveSpeed = MOVE_SPEED * G.myStats.speedMult * speedBuff * (sprintActive ? W.speedMult : 1);
    G.myVel.x = 0; G.myVel.y = 0;
    if (stunned) G.hasMoveTarget = false;
    if (!stunned && !ca.active && G.hasMoveTarget) {
      const dx = G.moveTarget.x - G.myPos.x;
      const dz = G.moveTarget.z - G.myPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 0.06) {
        G.hasMoveTarget = false;
      } else {
        G.myVel.x = (dx / dist) * moveSpeed;
        G.myVel.y = (dz / dist) * moveSpeed;
      }
    }
    // moving cancels the R charge
    if (G.rCastUntil > 0 && (G.myVel.x !== 0 || G.myVel.y !== 0)) {
      G.rCastUntil = 0;
      G.cd.r = now;
    }

    let moved = 0;
    if (!ca.active) {
      const nx = G.myPos.x + G.myVel.x * dt;
      const nz = G.myPos.z + G.myVel.y * dt;
      const res = resolveMove(G.myPos.x, G.myPos.z, nx, nz, PLAYER_RADIUS);
      moved = Math.hypot(res.x - G.myPos.x, res.z - G.myPos.z);
      G.myPos.x = res.x;
      G.myPos.z = res.z;
    }
    G.myPos.x = Math.max(-halfX + PLAYER_RADIUS, Math.min(halfX - PLAYER_RADIUS, G.myPos.x));
    G.myPos.z = Math.max(-halfZ + PLAYER_RADIUS, Math.min(halfZ - PLAYER_RADIUS, G.myPos.z));
    if (moved < 0.0005 && G.hasMoveTarget) {
      const rem = Math.hypot(G.moveTarget.x - G.myPos.x, G.moveTarget.z - G.myPos.z);
      if (rem < 0.25 || !G.mouse.rightDown) G.hasMoveTarget = false;
    }
    // face where you run; a shot turns you toward the aim for a moment
    if (now < G.aimUntil) {
      G.myFacing = G.aimFacing;
    } else if (G.myVel.x !== 0 || G.myVel.y !== 0) {
      G.myFacing = Math.atan2(G.myVel.x, G.myVel.y);
    } else if (ca.active) {
      G.myFacing = Math.atan2(ca.toX - ca.fromX, ca.toZ - ca.fromZ);
    }
  } else {
    G.chargeAnim.active = false;
    G.hasMoveTarget = false;
    G.myVel.x = 0; G.myVel.y = 0;
  }

  if (m) {
    m.mesh.position.x = G.myPos.x;
    m.mesh.position.z = G.myPos.z;
    m.mesh.rotation.y = G.myFacing;
    let s = 1;
    if (G.blink.active) {
      const dtMs = now - G.blink.start;
      const total = E.outMs + E.inMs;
      if (dtMs >= total) { G.blink.active = false; s = 1; }
      else if (dtMs < E.outMs) s = 1 - dtMs / E.outMs;
      else s = (dtMs - E.outMs) / E.inMs;
    }
    m.mesh.scale.setScalar(Math.max(0.05, s));
    const movingNow = G.myVel.x !== 0 || G.myVel.y !== 0 || G.chargeAnim.active;
    ent.driveMe(m, movingNow, Math.hypot(G.myVel.x, G.myVel.y), now, dt);
  }

  ent.interpolateRemote(now, dt);
  ent.refreshCollisionTargets();
  spells.update(dt, alive);
  ent.updatePickups();
  ent.updateNpcVisuals(Date.now(), dt);
  fx.update(dt);
  updateCamera(dt);
  hud.updateFrame(now);

  if (t - lastSendT > 1000 / SEND_HZ) {
    lastSendT = t;
    if (alive && G.myId) send({ type: 'state', data: { x: G.myPos.x, z: G.myPos.z, facing: G.myFacing } });
  }

  renderer.render(scene, camera);
}

function startGame() {
  G.started = true;
  resize();
  hud.initHud();
  initInput();
  centerCameraOnMe(true);
  connect();
  requestAnimationFrame(t => { lastT = t; loop(t); });
}

resize();
