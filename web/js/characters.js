import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// Rigged characters from web/models/characters.glb (built by
// tools/blender/characters.py). One humanoid rig is shared by the player and
// the office NPCs, the dog has its own. Each in-game character is a clone of
// the rig with only its own meshes kept, driven by an AnimationMixer.
//
// Animation model: a looping "base" clip (idle / run / stun / ...) chosen
// every frame from the character's state, and short one-shot clips
// (attack, cast, hit, ...) that temporarily take over and then fade back.
// "hold" keeps a looping clip up for a while (channeling a spell).

// scale: the rig is modelled at 1.9 m; everything is a bit larger than life
// so it reads from the high camera
export const VARIANTS = {
  player: { rig: 'Rig', scale: 1.15, idle: 'idle' },
  namestek: { rig: 'Rig', scale: 1.15, idle: 'idle' },
  reditel: { rig: 'Rig', scale: 1.5, idle: 'boss_idle' },
  sofie: { rig: 'Rig', scale: 1.27, idle: 'heal' },
  curda: { rig: 'Rig', scale: 1.15, idle: 'phone' },
  pes: { rig: 'DogRig', scale: 1.25, idle: 'idle', prefix: 'dog_' },
};

// the dog has fewer clips; logical names map onto what it has
const DOG_ALIAS = { attack: 'bite', cast: 'bite', dash: 'run', channel: 'idle', shout: 'idle', pickup: 'idle', boss_idle: 'idle', heal: 'idle', phone: 'idle' };

// below this speed a character walks instead of running (wandering NPCs)
const WALK_SPEED = 3.0;

const rigs = new Map();  // rig name -> template node with every variant mesh
const clips = new Map(); // clip name -> AnimationClip
let loaded = false;

function toLambert(src) {
  const m = new THREE.MeshLambertMaterial({ color: src.color, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity ?? 1 });
  m.name = src.name;
  return m;
}

export const ready = new GLTFLoader().loadAsync('/models/characters.glb').then(gltf => {
  gltf.scene.traverse(o => { if (o.isMesh) o.material = toLambert(o.material); });
  for (const node of gltf.scene.children) rigs.set(node.name, node);
  for (const c of gltf.animations) clips.set(c.name, c);
  loaded = true;
}).catch(err => console.error('characters failed to load', err));

export function createCharacter(kind, tint = null) {
  const v = VARIANTS[kind] || VARIANTS.player;
  const root = new THREE.Group();
  const ch = { kind, v, root, mixer: null, actions: new Map(), tintMats: [], base: null, current: null, oneShot: null, hold: null, dead: false };
  const template = loaded && rigs.get(v.rig);
  if (!template) {
    console.error('character rig missing for', kind);
    return ch;
  }
  const inst = skeletonClone(template);
  const keep = kind in VARIANTS ? kind : 'player';
  for (const child of [...inst.children]) {
    if (child.isBone) continue;
    if (child.name.replace(/_\d+$/, '') !== keep) {
      inst.remove(child);
      continue;
    }
    child.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds are rest-pose only
      if (o.material.name === 'Tint') ch.tintMats.push(o.material);
    });
  }
  inst.scale.setScalar(v.scale);
  root.add(inst);
  ch.mixer = new THREE.AnimationMixer(inst);
  if (tint != null) setTint(ch, tint);
  setBase(ch, v.idle);
  return ch;
}

export function setTint(ch, color) {
  for (const m of ch.tintMats) {
    m.color.setHex(color);
    m.emissive.setHex(color);
    m.emissiveIntensity = 0.12;
  }
}

export function disposeCharacter(ch) {
  if (!ch.mixer) return;
  ch.mixer.stopAllAction();
  ch.mixer.uncacheRoot(ch.mixer.getRoot());
  ch.root.traverse(o => { if (o.isMesh && o.material) o.material.dispose(); }); // geometry is shared with the template
}

function clipName(ch, name) {
  if (!ch.v.prefix) return clips.has(name) ? name : ch.v.idle;
  const n = ch.v.prefix + (DOG_ALIAS[name] || name);
  return clips.has(n) ? n : ch.v.prefix + 'idle';
}

function getAction(ch, name) {
  const cn = clipName(ch, name);
  let a = ch.actions.get(cn);
  if (!a) {
    a = ch.mixer.clipAction(clips.get(cn));
    ch.actions.set(cn, a);
  }
  return a;
}

function crossTo(ch, a, fade) {
  if (ch.current === a) return;
  if (ch.current) ch.current.fadeOut(fade);
  a.enabled = true;
  a.setEffectiveTimeScale(a.timeScale);
  a.setEffectiveWeight(1);
  a.fadeIn(fade);
  a.play();
  ch.current = a;
}

// Looping clip that plays whenever nothing else is going on.
export function setBase(ch, name, { timeScale = 1, fade = 0.14 } = {}) {
  if (!ch.mixer) return;
  const a = getAction(ch, name);
  a.setLoop(THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = false;
  a.timeScale = timeScale;
  if (a === ch.current) a.setEffectiveTimeScale(timeScale);
  ch.base = a;
  if (!ch.oneShot && !ch.dead) crossTo(ch, a, fade);
}

// Short clip that takes over, then fades back to the base clip. A running
// one-shot of higher priority is not interrupted.
export function trigger(ch, name, { timeScale = 1, fade = 0.07, priority = 1 } = {}) {
  if (!ch.mixer || ch.dead) return;
  const now = performance.now();
  if (ch.oneShot && now < ch.oneShot.endAt && ch.oneShot.priority > priority) return;
  const a = getAction(ch, name);
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.timeScale = timeScale;
  const ms = (a.getClip().duration / timeScale) * 1000;
  if (ch.current === a) ch.current = null; // retrigger: restart instead of ignoring
  crossTo(ch, a, fade);
  ch.oneShot = { action: a, priority, endAt: now + Math.max(60, ms - 90) };
}

// Looping clip held for a while (spell channeling); null clears it.
export function hold(ch, name, ms) {
  ch.hold = name && ms > 0 ? { name, until: performance.now() + ms } : null;
}

export function die(ch) {
  if (!ch.mixer || ch.dead) return;
  ch.dead = true;
  ch.hold = null;
  ch.oneShot = null;
  const a = getAction(ch, 'death');
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.timeScale = 1;
  crossTo(ch, a, 0.08);
}

export function revive(ch) {
  if (!ch.mixer) return;
  ch.dead = false;
  ch.oneShot = null;
  ch.hold = null;
  ch.current = null;
  ch.mixer.stopAllAction();
  setBase(ch, ch.v.idle, { fade: 0.01 });
}

// Picks the base clip from the character's state and advances the mixer.
export function drive(ch, { moving = false, speed = 0, stunned = false, collecting = false, channeling = false, charging = false }, dt) {
  if (!ch.mixer) return;
  const now = performance.now();
  if (!ch.dead) {
    if (ch.oneShot && now >= ch.oneShot.endAt) {
      ch.oneShot = null;
      crossTo(ch, ch.base, 0.12);
    }
    if (ch.hold && now >= ch.hold.until) ch.hold = null;
    if (stunned) setBase(ch, 'stun');
    else if (charging) setBase(ch, 'dash', { fade: 0.05 });
    else if (channeling) setBase(ch, 'channel');
    else if (ch.hold) setBase(ch, ch.hold.name);
    else if (moving && speed < WALK_SPEED) setBase(ch, 'walk', { timeScale: Math.max(0.6, Math.min(1.6, speed / 1.7)) });
    else if (moving) setBase(ch, 'run', { timeScale: Math.max(0.7, Math.min(1.9, speed / 6.5)) });
    else if (collecting) setBase(ch, 'pickup');
    else setBase(ch, ch.v.idle);
  }
  ch.mixer.update(dt);
}
