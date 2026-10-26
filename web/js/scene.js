import * as THREE from 'three';
import { G } from './state.js';
import { PLAYER_RADIUS } from './config.js';

// Rendering is tuned for office laptops: Lambert shading, two lights, the
// whole static map merged into a handful of draw calls, and a quality
// setting that mostly controls the render resolution.

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

export function qualityLabel() {
  return { low: 'Kvalita: nízká', medium: 'Kvalita: střední', high: 'Kvalita: vysoká' }[quality];
}

export function cycleQuality() {
  quality = QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(quality) + 1) % QUALITY_LEVELS.length];
  try { localStorage.setItem('superhry-quality', quality); } catch { /* ignore */ }
  renderer.setPixelRatio(pixelRatioFor(quality));
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

scene.add(new THREE.HemisphereLight(0xa9c8ff, 0x2a1f3a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.1);
sun.position.set(14, 26, 12);
scene.add(sun);

export let halfX = 28;
export let halfZ = 18;
export const obstacles = [];          // movement collision rects
export const projectileBlockers = []; // subset that stops shots
let mapGroup = null;

// ------------------------------------------------------------ map building

// Every static piece is pushed into a bucket keyed by material, then each
// bucket becomes one merged mesh.
const buckets = new Map();

// Minimal merge (position + normal + uv) so no addon has to be fetched.
function mergeGeometries(geoms) {
  const parts = geoms.map(g => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let off = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
    off += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpPos = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

function part(geom, color, x, y, z, opts = {}) {
  const key = `${opts.basic ? 'b' : 'l'}|${color}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let b = buckets.get(key);
  if (!b) {
    b = { geoms: [], color, opts };
    buckets.set(key, b);
  }
  tmpEuler.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
  tmpQuat.setFromEuler(tmpEuler);
  tmpPos.set(x, y, z);
  tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
  const g = geom.clone();
  g.applyMatrix4(tmpMatrix);
  geom.dispose();
  b.geoms.push(g);
}

function boxPart(w, h, d, color, x, y, z, opts) {
  part(new THREE.BoxGeometry(w, h, d), color, x, y, z, opts);
}

function flushBuckets(group) {
  for (const b of buckets.values()) {
    if (!b.geoms.length) continue;
    const merged = mergeGeometries(b.geoms);
    for (const g of b.geoms) g.dispose();
    let mat;
    if (b.opts.basic) {
      mat = new THREE.MeshBasicMaterial({ color: b.color, transparent: (b.opts.opacity ?? 1) < 1, opacity: b.opts.opacity ?? 1, side: THREE.DoubleSide, depthWrite: (b.opts.opacity ?? 1) >= 1 });
    } else {
      mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: (b.opts.opacity ?? 1) < 1, opacity: b.opts.opacity ?? 1, emissive: b.opts.emissive ?? 0x000000, emissiveIntensity: b.opts.emissiveIntensity ?? 1 });
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  buckets.clear();
}

function addObstacle(o) {
  const colorHex = o.color ? parseInt(o.color.replace('#', ''), 16) : null;
  const { x, z, w, d, h } = o;
  switch (o.kind) {
    case 'wall':
      boxPart(w, h, d, 0x4b5f8a, x, h / 2, z);
      boxPart(w + 0.06, 0.12, d + 0.06, 0x7f93bf, x, h + 0.06, z);
      break;
    case 'glass':
      boxPart(w, h, d, 0x9fd8ff, x, h / 2, z, { opacity: 0.22 });
      boxPart(w + 0.05, 0.1, d + 0.05, 0xd8e8ff, x, h, z);
      boxPart(w + 0.05, 0.16, d + 0.05, 0xd8e8ff, x, 0.08, z);
      break;
    case 'desk': {
      boxPart(w, 0.12, d, colorHex ?? 0x6b7aa0, x, h - 0.06, z);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        boxPart(0.12, h - 0.12, 0.12, 0x2d3650, x + sx * (w / 2 - 0.2), (h - 0.12) / 2, z + sz * (d / 2 - 0.2));
      }
      if (w >= 3 && d <= 2) {
        for (const sx of [-0.8, 0.8]) {
          boxPart(0.7, 0.45, 0.06, 0x121826, x + sx, h + 0.3, z, { emissive: 0x3a86ff, emissiveIntensity: 0.4 });
          boxPart(0.08, 0.14, 0.08, 0x1c2233, x + sx, h + 0.07, z);
        }
      }
      break;
    }
    case 'rack':
      boxPart(w, h, d, 0x1b2130, x, h / 2, z);
      for (let i = 0; i < 6; i++) {
        boxPart(0.08, 0.08, 0.05, 0x00ff88, x + w / 2 + 0.01, 0.4 + i * 0.3, z - d / 2 + 0.4 + (i % 3) * 0.5, { emissive: 0x00ff88, emissiveIntensity: 1.2 });
      }
      break;
    case 'pillar':
      boxPart(w, h, d, 0x5f7199, x, h / 2, z);
      break;
    case 'printer':
      boxPart(w, h * 0.7, d, 0x8a93a8, x, h * 0.35, z);
      boxPart(w * 0.8, h * 0.3, d * 0.8, 0xb9c1d4, x, h * 0.85, z);
      break;
    default:
      boxPart(w, h, d, 0x4b5f8a, x, h / 2, z);
  }
}

function addProp(p) {
  const { x, z } = p;
  const ry = p.rot || 0;
  switch (p.kind) {
    case 'plant':
      part(new THREE.CylinderGeometry(0.32, 0.26, 0.5, 8), 0x8c5a3c, x, 0.25, z);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        part(new THREE.SphereGeometry(0.38, 7, 5), 0x3f9a4f, x + Math.cos(a) * 0.18, 0.9 + (i % 2) * 0.22, z + Math.sin(a) * 0.18);
      }
      break;
    case 'watercooler':
      boxPart(0.5, 1.0, 0.5, 0xdfe6f3, x, 0.5, z);
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.55, 10), 0x7fd4ff, x, 1.3, z, { opacity: 0.55 });
      break;
    case 'whiteboard':
      boxPart(1.8, 1.1, 0.08, 0xf4f7fb, x, 1.4, z, { ry });
      boxPart(1.9, 1.2, 0.05, 0x7b8597, x - Math.sin(ry) * 0.03, 1.4, z - Math.cos(ry) * 0.03, { ry });
      break;
  }
}

export function buildMap(def) {
  if (mapGroup) {
    scene.remove(mapGroup);
    mapGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  mapGroup = new THREE.Group();
  obstacles.length = 0;
  projectileBlockers.length = 0;
  halfX = def.halfX;
  halfZ = def.halfZ;

  // floor + zones as unlit planes (no need to shade a flat carpet)
  part(new THREE.PlaneGeometry(halfX * 2, halfZ * 2), 0x2b3a5c, 0, 0, 0, { rx: -Math.PI / 2, basic: true });
  for (const zn of def.zones || []) {
    part(new THREE.PlaneGeometry(zn.w, zn.d), parseInt(zn.color.replace('#', ''), 16), zn.x, 0.02, zn.z, { rx: -Math.PI / 2, basic: true });
  }
  const grid = new THREE.GridHelper(Math.max(halfX, halfZ) * 2, Math.max(halfX, halfZ), 0x3b4d75, 0x33436a);
  grid.position.y = 0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.4;
  mapGroup.add(grid);

  const wallH = 2.4;
  const outer = [
    [halfX * 2 + 1, 0.5, 0, halfZ + 0.25],
    [halfX * 2 + 1, 0.5, 0, -halfZ - 0.25],
    [0.5, halfZ * 2, halfX + 0.25, 0],
    [0.5, halfZ * 2, -halfX - 0.25, 0],
  ];
  for (const [w, d, x, z] of outer) {
    boxPart(w, wallH, d, 0x3a4c74, x, wallH / 2, z);
    boxPart(w + 0.06, 0.12, d + 0.06, 0x6f84b3, x, wallH + 0.06, z);
    const r = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, kind: 'wall' };
    obstacles.push(r);
    projectileBlockers.push(r);
  }

  for (const o of def.obstacles || []) {
    addObstacle(o);
    const r = { minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2, kind: o.kind };
    obstacles.push(r);
    if (o.kind === 'wall' || o.kind === 'rack' || o.kind === 'pillar') projectileBlockers.push(r);
  }
  for (const p of def.props || []) addProp(p);

  flushBuckets(mapGroup);
  scene.add(mapGroup);
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
