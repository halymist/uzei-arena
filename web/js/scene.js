import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G } from './state.js';
import { PLAYER_RADIUS } from './config.js';

// Rendering is tuned for office laptops: Lambert shading, two lights, one
// shadow map, and the whole static map drawn as instances of a small prop
// kit modelled in Blender (tools/blender/office_kit.py builds it and exports
// web/models/office_kit.glb). The quality setting mostly controls the render
// resolution; "low" also turns shadows off.

const QUALITY_LEVELS = ['low', 'medium', 'high'];
let quality = 'medium';
try { quality = localStorage.getItem('superhry-quality') || 'medium'; } catch { /* ignore */ }
if (!QUALITY_LEVELS.includes(quality)) quality = 'medium';

function pixelRatioFor(q) {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'low') return Math.min(dpr, 0.7);
  if (q === 'high') return Math.min(dpr, 1.5);
  return Math.min(dpr, 1.0);
}

export const canvas = document.getElementById('game-canvas');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatioFor(quality));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export function qualityLabel() {
  return { low: 'Kvalita: nízká', medium: 'Kvalita: střední', high: 'Kvalita: vysoká' }[quality];
}

export function cycleQuality() {
  quality = QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(quality) + 1) % QUALITY_LEVELS.length];
  try { localStorage.setItem('superhry-quality', quality); } catch { /* ignore */ }
  renderer.setPixelRatio(pixelRatioFor(quality));
  const shadows = quality !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
  resize();
  return qualityLabel();
}

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 44, 110);

export const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
const CAM_OFFSET = new THREE.Vector3(0, 23, 17);
const CAM_LOOK_OFFSET_Z = -2.0;
const CAM_PAN_EDGE = 0.8;
const CAM_PAN_SPEED = 30.0;

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a2f45, 0.8));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.3);
sun.position.set(14, 26, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

export let halfX = 28;
export let halfZ = 18;
export const obstacles = [];          // movement collision rects
export const projectileBlockers = []; // subset that stops shots
let mapGroup = null;

// ------------------------------------------------------------ prop kit

// piece name -> [{ geometry, material, matrix }], one entry per material
const kit = new Map();
const lambertCache = new Map();

// The glTF comes in with PBR materials; Lambert is plenty for this look and
// much cheaper on integrated GPUs.
function toLambert(src) {
  let m = lambertCache.get(src.uuid);
  if (m) return m;
  const seeThrough = src.transparent || src.opacity < 1;
  m = new THREE.MeshLambertMaterial({
    color: src.color,
    emissive: src.emissive,
    emissiveIntensity: src.emissiveIntensity ?? 1,
    transparent: seeThrough,
    opacity: seeThrough ? src.opacity : 1,
    depthWrite: !seeThrough,
    side: seeThrough ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = src.name;
  lambertCache.set(src.uuid, m);
  return m;
}

const kitReady = new GLTFLoader().loadAsync('/models/office_kit.glb').then(gltf => {
  const inv = new THREE.Matrix4();
  for (const node of gltf.scene.children) {
    node.updateWorldMatrix(true, true);
    inv.copy(node.matrixWorld).invert();
    const parts = [];
    node.traverse(o => {
      if (!o.isMesh) return;
      parts.push({ geometry: o.geometry, material: toLambert(o.material), matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
    });
    kit.set(node.name, parts);
  }
});

// Placements are collected per piece and flushed as one InstancedMesh per
// piece material, so the whole office is a few dozen draw calls.
const placements = new Map();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _euler = new THREE.Euler();
const DESK_DEFAULT = new THREE.Color(0xe9e6df);

function place(piece, x, y, z, { sx = 1, sy = 1, sz = 1, ry = 0, color = null } = {}) {
  let list = placements.get(piece);
  if (!list) {
    list = [];
    placements.set(piece, list);
  }
  _euler.set(0, ry, 0);
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _scl.set(sx, sy, sz);
  list.push({ m: new THREE.Matrix4().compose(_pos, _quat, _scl), color });
}

function flushPlacements(group) {
  const tmp = new THREE.Matrix4();
  for (const [piece, list] of placements) {
    const parts = kit.get(piece);
    if (!parts) {
      console.warn('office kit has no piece', piece);
      continue;
    }
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      const tint = part.material.name === 'DeskTop';
      list.forEach((p, i) => {
        inst.setMatrixAt(i, tmp.multiplyMatrices(p.m, part.matrix));
        if (tint) inst.setColorAt(i, p.color || DESK_DEFAULT);
      });
      inst.castShadow = !part.material.transparent;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      inst.matrixAutoUpdate = false;
      group.add(inst);
    }
  }
  placements.clear();
}

// ------------------------------------------------------------ map building

function hexColor(s) {
  return s ? new THREE.Color(parseInt(s.replace('#', ''), 16)) : null;
}

// A 4x4 m carpet tile pattern, repeated over the floor.
function carpetTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a556f';
  ctx.fillRect(0, 0, 256, 256);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      ctx.fillStyle = (tx + ty) % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)';
      ctx.fillRect(tx * 128, ty * 128, 128, 128);
    }
  }
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (const k of [0.5, 128.5]) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(256, k); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// wall / glass segments: the kit piece is 1 m long and 0.6 thick
function addWallSegment(piece, x, z, w, d, h) {
  const alongX = w >= d;
  const len = alongX ? w : d;
  const thick = alongX ? d : w;
  place(piece, x, 0, z, { sx: len, sy: h / 2.4, sz: thick / 0.6, ry: alongX ? 0 : Math.PI / 2 });
}

// A doorway is a gap of 1-4 m between two collinear wall segments.
function addDoorways(segs) {
  for (const a of segs) {
    for (const b of segs) {
      if (a === b) continue;
      const alongX = a.w >= a.d;
      if (alongX !== (b.w >= b.d)) continue;
      if (alongX) {
        if (Math.abs(a.z - b.z) > 0.05) continue;
        const gap = (b.x - b.w / 2) - (a.x + a.w / 2);
        if (gap < 1 || gap > 4) continue;
        const sy = a.h / 2.4;
        place('doorframe', a.x + a.w / 2 + gap / 2, 0, a.z, { sx: gap, sy });
        place('doorpost', a.x + a.w / 2 + 0.06, 0, a.z, { sy });
        place('doorpost', b.x - b.w / 2 - 0.06, 0, a.z, { sy });
      } else {
        if (Math.abs(a.x - b.x) > 0.05) continue;
        const gap = (b.z - b.d / 2) - (a.z + a.d / 2);
        if (gap < 1 || gap > 4) continue;
        const sy = a.h / 2.4;
        const ry = Math.PI / 2;
        place('doorframe', a.x, 0, a.z + a.d / 2 + gap / 2, { sx: gap, sy, ry });
        place('doorpost', a.x, 0, a.z + a.d / 2 + 0.06, { sy, ry });
        place('doorpost', a.x, 0, b.z - b.d / 2 - 0.06, { sy, ry });
      }
    }
  }
}

function addDesk(o) {
  const { x, z, w, d, h } = o;
  const color = hexColor(o.color);
  place('desk_top', x, 0, z, { sx: w, sy: h, sz: d, color });
  for (const s of [-1, 1]) place('desk_panel', x + s * (w / 2 - 0.1), 0, z, { sy: h, sz: d - 0.2 });

  const variant = o.variant || (w >= 3 && d <= 2 ? 'pair' : 'plain');
  const seat = d / 2 + 0.42;
  if (variant === 'pair') {
    // two workstations, chairs on the camera side facing the desk
    for (const dx of [-w / 4, w / 4]) {
      place('monitor', x + dx, h, z - 0.18);
      place('keyboard', x + dx, h, z + 0.22);
      place('chair', x + dx, 0, z + seat, { ry: Math.PI });
    }
  } else if (variant === 'exec') {
    // the boss sits behind the desk, facing the room
    place('monitor', x - 0.7, h, z + 0.15, { ry: Math.PI });
    place('keyboard', x - 0.7, h, z - 0.2, { ry: Math.PI });
    place('chair', x - 0.7, 0, z - seat);
  } else if (variant === 'meeting') {
    const n = Math.max(2, Math.floor(w / 1.5));
    const step = w / n;
    for (let i = 0; i < n; i++) {
      const cx = x - w / 2 + step * (i + 0.5);
      place('chair', cx, 0, z - seat);
      place('chair', cx, 0, z + seat, { ry: Math.PI });
    }
  }
}

function addObstacle(o) {
  const { x, z, w, d, h } = o;
  switch (o.kind) {
    case 'wall':
    case 'glass':
      addWallSegment(o.kind, x, z, w, d, h);
      break;
    case 'desk':
      addDesk(o);
      break;
    case 'rack': {
      // a row of 1 m rack units, fronts toward the middle of the map
      const alongZ = d >= w;
      const n = Math.max(1, Math.round(alongZ ? d : w));
      const ry = alongZ ? (x < 0 ? Math.PI : 0) : (z < 0 ? -Math.PI / 2 : Math.PI / 2);
      for (let i = 0; i < n; i++) {
        const t = -(n - 1) / 2 + i;
        place('rack', alongZ ? x : x + t, 0, alongZ ? z + t : z, { sx: (alongZ ? w : d) / 1.2, sy: h / 2.2, ry });
      }
      break;
    }
    case 'pillar':
      place('pillar', x, 0, z, { sx: w / 1.1, sy: h / 3, sz: d / 1.1 });
      break;
    case 'printer':
      place('printer', x, 0, z, { sx: w, sy: h / 1.3, sz: d });
      break;
    default:
      place('pillar', x, 0, z, { sx: w / 1.1, sy: h / 3, sz: d / 1.1 });
  }
}

function addProp(p) {
  place(p.kind, p.x, p.y || 0, p.z, { ry: p.rot || 0 });
}

function disposeMap() {
  if (!mapGroup) return;
  scene.remove(mapGroup);
  mapGroup.traverse(o => {
    if (o.isInstancedMesh) { o.dispose(); return; } // kit geometry/material stay shared
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  mapGroup = null;
}

function buildVisuals(def) {
  disposeMap();
  mapGroup = new THREE.Group();

  const carpet = carpetTexture();
  carpet.repeat.set(halfX * 2 / 4, halfZ * 2 / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), new THREE.MeshLambertMaterial({ map: carpet }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  mapGroup.add(floor);
  for (const zn of def.zones || []) {
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(zn.w, zn.d),
      new THREE.MeshLambertMaterial({ color: hexColor(zn.color), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(zn.x, 0.01, zn.z);
    zone.receiveShadow = true;
    mapGroup.add(zone);
  }

  const wallH = 2.4;
  for (const [w, d, x, z] of outerWalls()) addWallSegment('wall', x, z, w, d, wallH);
  const obs = def.obstacles || [];
  for (const o of obs) addObstacle(o);
  addDoorways(obs.filter(o => o.kind === 'wall' || o.kind === 'glass'));
  for (const p of def.props || []) addProp(p);

  flushPlacements(mapGroup);
  scene.add(mapGroup);
}

function outerWalls() {
  return [
    [halfX * 2 + 1, 0.5, 0, halfZ + 0.25],
    [halfX * 2 + 1, 0.5, 0, -halfZ - 0.25],
    [0.5, halfZ * 2, halfX + 0.25, 0],
    [0.5, halfZ * 2, -halfX - 0.25, 0],
  ];
}

// Collision is set up synchronously so gameplay never waits for models; the
// visuals follow as soon as the kit has loaded.
export function buildMap(def) {
  obstacles.length = 0;
  projectileBlockers.length = 0;
  halfX = def.halfX;
  halfZ = def.halfZ;

  for (const [w, d, x, z] of outerWalls()) {
    const r = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, kind: 'wall' };
    obstacles.push(r);
    projectileBlockers.push(r);
  }
  for (const o of def.obstacles || []) {
    const r = { minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2, kind: o.kind };
    obstacles.push(r);
    if (o.kind === 'wall' || o.kind === 'rack' || o.kind === 'pillar') projectileBlockers.push(r);
  }

  kitReady.then(() => buildVisuals(def), err => console.error('office kit failed to load', err));
}

// ------------------------------------------------------------ collision

export function pointInObstacle(x, z, rad) {
  for (const o of obstacles) {
    if (x > o.minX - rad && x < o.maxX + rad && z > o.minZ - rad && z < o.maxZ + rad) return o;
  }
  return null;
}

export function pointInProjectileBlocker(x, z, rad) {
  for (const o of projectileBlockers) {
    if (x > o.minX - rad && x < o.maxX + rad && z > o.minZ - rad && z < o.maxZ + rad) return o;
  }
  return null;
}

export function resolveMove(prevX, prevZ, newX, newZ, rad) {
  let x = prevX, z = prevZ;
  if (!pointInObstacle(newX, prevZ, rad)) x = newX;
  if (!pointInObstacle(x, newZ, rad)) z = newZ;
  return { x, z };
}

export function segmentEndpoint(prevX, prevZ, dirX, dirZ, dist, rad) {
  const steps = Math.max(8, Math.ceil(dist / 0.25));
  const step = dist / steps;
  let x = prevX, z = prevZ;
  for (let i = 0; i < steps; i++) {
    const nx = x + dirX * step;
    const nz = z + dirZ * step;
    if (pointInObstacle(nx, nz, rad)) break;
    if (nx < -halfX || nx > halfX || nz < -halfZ || nz > halfZ) break;
    x = nx; z = nz;
  }
  return { x, z };
}

export function clampToMap(x, z) {
  return {
    x: Math.max(-halfX + PLAYER_RADIUS, Math.min(halfX - PLAYER_RADIUS, x)),
    z: Math.max(-halfZ + PLAYER_RADIUS, Math.min(halfZ - PLAYER_RADIUS, z)),
  };
}

// ------------------------------------------------------------ camera

export const cam = {
  anchorX: 0, anchorZ: 0,
  pos: new THREE.Vector3(), look: new THREE.Vector3(),
  ready: false, boostUntil: 0,
  shake: 0,
  locked: true, // follows the player exactly, LoL "locked camera"
};
try { cam.locked = localStorage.getItem('superhry-camlock') !== '0'; } catch { /* ignore */ }

export function toggleCameraLock() {
  cam.locked = !cam.locked;
  try { localStorage.setItem('superhry-camlock', cam.locked ? '1' : '0'); } catch { /* ignore */ }
  if (cam.locked) centerCameraOnMe();
  return cam.locked;
}
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();

export function addShake(amount) {
  cam.shake = Math.min(1.2, cam.shake + amount);
}

export function centerCameraOnMe(snap = false) {
  cam.anchorX = G.myPos.x;
  cam.anchorZ = G.myPos.z;
  if (snap) cam.ready = false;
  else cam.boostUntil = performance.now() + 300;
}

function anchorBounds() {
  return { minX: -halfX + 4, maxX: halfX - 4, minZ: -halfZ + 1, maxZ: halfZ + 3 };
}

export function updateCamera(dt) {
  const m = G.mouse;
  const b = anchorBounds();
  if (cam.locked) {
    // glued to the player: no lag, nothing slides under you
    cam.anchorX = Math.max(b.minX, Math.min(b.maxX, G.myPos.x));
    cam.anchorZ = Math.max(b.minZ, Math.min(b.maxZ, G.myPos.z));
  } else {
    let panX = 0, panZ = 0;
    if (m.has && !G.chargeAnim.active && G.started && document.hasFocus()) {
      if (m.ndcX > CAM_PAN_EDGE) panX = (m.ndcX - CAM_PAN_EDGE) / (1 - CAM_PAN_EDGE);
      else if (m.ndcX < -CAM_PAN_EDGE) panX = (m.ndcX + CAM_PAN_EDGE) / (1 - CAM_PAN_EDGE);
      if (m.ndcY > CAM_PAN_EDGE) panZ = -(m.ndcY - CAM_PAN_EDGE) / (1 - CAM_PAN_EDGE);
      else if (m.ndcY < -CAM_PAN_EDGE) panZ = -(m.ndcY + CAM_PAN_EDGE) / (1 - CAM_PAN_EDGE);
    }
    cam.anchorX = Math.max(b.minX, Math.min(b.maxX, cam.anchorX + panX * CAM_PAN_SPEED * dt));
    cam.anchorZ = Math.max(b.minZ, Math.min(b.maxZ, cam.anchorZ + panZ * CAM_PAN_SPEED * dt));
  }

  wantPos.set(cam.anchorX + CAM_OFFSET.x, CAM_OFFSET.y, cam.anchorZ + CAM_OFFSET.z);
  wantLook.set(cam.anchorX, 0, cam.anchorZ + CAM_LOOK_OFFSET_Z);
  if (!cam.ready || cam.locked) {
    cam.pos.copy(wantPos);
    cam.look.copy(wantLook);
    cam.ready = true;
  } else {
    const rate = performance.now() < cam.boostUntil ? 18 : 8;
    const a = 1 - Math.exp(-rate * dt);
    cam.pos.lerp(wantPos, a);
    cam.look.lerp(wantLook, a);
  }
  if (cam.shake > 0.001) {
    const s = cam.shake;
    camera.position.set(
      cam.pos.x + (Math.random() - 0.5) * s * 0.9,
      cam.pos.y + (Math.random() - 0.5) * s * 0.5,
      cam.pos.z + (Math.random() - 0.5) * s * 0.9,
    );
    cam.shake *= Math.exp(-9 * dt);
  } else {
    cam.shake = 0;
    camera.position.copy(cam.pos);
  }
  camera.lookAt(cam.look.x, cam.look.y, cam.look.z);
  camera.up.set(0, 1, 0);
}

// ------------------------------------------------------------ mouse

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

export function updateMouseWorld() {
  const m = G.mouse;
  if (!m.has) return;
  ndc.set(m.ndcX, m.ndcY);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    m.worldX = hitPoint.x;
    m.worldZ = hitPoint.z;
  }
}

const projV = new THREE.Vector3();
export function screenPos(x, y, z) {
  projV.set(x, y, z).project(camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  return {
    x: (projV.x + 1) / 2 * w,
    y: (1 - projV.y) / 2 * h,
    visible: projV.z < 1 && Math.abs(projV.x) < 1.2 && Math.abs(projV.y) < 1.2,
  };
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
