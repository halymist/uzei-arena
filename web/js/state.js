import { deriveStats } from './config.js';

// One shared mutable game state object. Modules read and write it directly;
// the networking layer is the only thing that touches the socket.
export const G = {
  ws: null,
  myId: 0,
  myName: '',
  selectedModel: 0,
  startHP: 100,
  startMana: 100,
  respawnMs: 4000,

  map: null,
  talentTree: [],
  talentById: new Map(),

  match: { phase: 'idle', day: 0, week: 1, phaseEndsAt: 0, scoreTarget: 10, leaderId: 0, lastWinnerId: 0, weekWinnerId: 0 },
  lastRound: null,          // last "round" message (standings etc.)
  serverOffset: 0,          // serverNow - Date.now()

  players: new Map(),       // id -> { mesh, name, hp, alive, snapshots, ... }
  npcs: new Map(),          // id -> { id, mesh, kind, ... }
  pickups: new Map(),       // id -> { id, kind, x, z, mesh, ... }

  // local player simulation
  myPos: { x: 0, z: 0 },
  myVel: { x: 0, y: 0 }, // y is the z axis velocity (kept as Vector2 semantics)
  myFacing: 0,
  aimFacing: 0,
  aimUntil: 0,              // after a shot the body faces the aim briefly
  moveTarget: { x: 0, z: 0 },
  hasMoveTarget: false,
  myMana: 100,
  myStunUntil: 0,
  myTalents: [],
  myTalentPts: 0,
  myStats: deriveStats([], new Map()),
  myLock: { spell: '', until: 0 },
  myBuffs: new Map(),
  myProjectileSeq: 1,
  collect: null,            // { id, value, startedAt } while standing on a coin

  cd: { q: 0, e: 0, r: 0, c: 0, v: 0, x: 0, z: 0, s: 0, f: 0, g: 0, aa: 0 },
  wActiveUntil: 0,
  qBurstUntil: 0,
  qBurstNextShotAt: 0,
  rCastUntil: 0,
  chargeAnim: { active: false, startAt: 0, endAt: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0 },
  blink: { active: false, start: 0 },
  ignoreServerSnapUntil: 0,

  mouse: { has: false, rightDown: false, ndcX: 0, ndcY: 0, worldX: 0, worldZ: 0, clientX: 0, clientY: 0 },
  equippedBySlot: { q: 'q', w: 'w', e: null, r: null, d: null, f: null },

  started: false,
};

export function me() {
  return G.players.get(G.myId);
}

export function serverNow() {
  return Date.now() + G.serverOffset;
}

export function send(obj) {
  if (G.ws && G.ws.readyState === WebSocket.OPEN) {
    G.ws.send(JSON.stringify(obj));
  }
}

export function isPlaying() {
  return G.match.phase === 'playing';
}

export function canAct() {
  return G.match.phase === 'playing' || G.match.phase === 'warmup';
}
