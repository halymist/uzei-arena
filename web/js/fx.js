import * as THREE from 'three';
import { scene, screenPos, addShake } from './scene.js';

// Juice: floating numbers, hit flashes, particle bursts, banners, killfeed,
// screen vignette. Nothing here affects gameplay.

const layer = document.getElementById('fx-layer');
const bannerEl = document.getElementById('banner');
const bannerTitle = document.getElementById('banner-title');
const bannerSub = document.getElementById('banner-sub');
const killfeedEl = document.getElementById('killfeed');
const vignetteEl = document.getElementById('vignette');
const flashEl = document.getElementById('screen-flash');

const numbers = [];
const particles = [];
const rings = [];
const flashes = [];

const particleGeom = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const ringGeom = new THREE.RingGeometry(0.85, 1.0, 40);

export function damageNumber(x, z, text, cls = 'dmg', y = 1.6) {
  if (!layer) return;
  const el = document.createElement('div');
  el.className = `fx-num ${cls}`;
  el.textContent = text;
  layer.appendChild(el);
  numbers.push({ el, x: x + (Math.random() - 0.5) * 0.6, y, z, born: performance.now(), life: 900, vy: 1.6 });
}

export function hitFlash(mesh, color = 0xffffff, ms = 90) {
  if (!mesh) return;
  const mats = [];
  mesh.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive && !o.isSprite) mats.push(o.material);
  });
  for (const m of mats) {
    if (m.userData._flashing) continue;
    m.userData._flashing = true;
    m.userData._emissive = m.emissive.getHex();
    m.userData._emissiveI = m.emissiveIntensity;
    m.emissive.setHex(color);
    m.emissiveIntensity = 1.4;
  }
  flashes.push({ mats, until: performance.now() + ms });
}

export function burst(x, z, color, { count = 14, speed = 6, life = 600, y = 1.0, size = 1, gravity = 12 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  const group = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(particleGeom, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 5, Math.sin(a) * sp);
    scene.add(m);
    group.push(m);
  }
  particles.push({ group, mat, born: performance.now(), life, gravity });
}

export function deathBurst(x, z, color) {
  burst(x, z, color, { count: 26, speed: 8, life: 900, size: 1.4 });
  burst(x, z, 0xffffff, { count: 10, speed: 4, life: 500, size: 0.8 });
  ringPulse(x, z, color, 3.2, 500);
}

export function muzzleFlash(x, z, color) {
  burst(x, z, color, { count: 5, speed: 3, life: 180, size: 0.7, gravity: 2 });
}

export function ringPulse(x, z, color, radius = 2.5, ms = 450, y = 0.08) {
  const m = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.scale.setScalar(0.2);
  scene.add(m);
  rings.push({ mesh: m, born: performance.now(), life: ms, radius });
}

export function shake(amount) {
  addShake(amount);
}

// LoL-style move order marker: a small ring that shrinks into the target.
export function clickMarker(x, z) {
  const m = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: 0x7bffad, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.06, z);
  scene.add(m);
  rings.push({ mesh: m, born: performance.now(), life: 320, radius: 0.9, shrink: true });
}

let bannerTimer = 0;
export function banner(title, sub = '', ms = 2200, cls = '') {
  if (!bannerEl) return;
  bannerTitle.textContent = title;
  bannerSub.textContent = sub;
  bannerEl.className = `banner show ${cls}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { bannerEl.className = 'banner'; }, ms);
}

export function killfeed(html, cls = '') {
  if (!killfeedEl) return;
  const row = document.createElement('div');
  row.className = `kf-row ${cls}`;
  row.innerHTML = html;
  killfeedEl.prepend(row);
  while (killfeedEl.children.length > 6) killfeedEl.lastChild.remove();
  setTimeout(() => { row.classList.add('fade'); }, 6000);
  setTimeout(() => { row.remove(); }, 7000);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function setVignette(hpRatio) {
  if (!vignetteEl) return;
  const k = hpRatio < 0.45 ? (0.45 - hpRatio) / 0.45 : 0;
  vignetteEl.style.opacity = String(Math.min(1, k * 1.1));
}

export function screenFlash(cls = 'hurt') {
  if (!flashEl) return;
  flashEl.className = `screen-flash ${cls}`;
  // restart animation
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
}

export function update(dt) {
  const now = performance.now();

  for (let i = numbers.length - 1; i >= 0; i--) {
    const n = numbers[i];
    const t = (now - n.born) / n.life;
    if (t >= 1) {
      n.el.remove();
      numbers.splice(i, 1);
      continue;
    }
    n.y += n.vy * dt;
    const p = screenPos(n.x, n.y, n.z);
    n.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${1 + (1 - t) * 0.25})`;
    n.el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    n.el.style.display = p.visible ? '' : 'none';
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const t = (now - p.born) / p.life;
    if (t >= 1) {
      for (const m of p.group) scene.remove(m);
      p.mat.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.mat.opacity = 1 - t * t;
    for (const m of p.group) {
      const v = m.userData.v;
      v.y -= p.gravity * dt;
      m.position.x += v.x * dt;
      m.position.y += v.y * dt;
      m.position.z += v.z * dt;
      if (m.position.y < 0.05) { m.position.y = 0.05; v.y *= -0.3; v.x *= 0.7; v.z *= 0.7; }
      m.rotation.x += dt * 6;
      m.rotation.z += dt * 4;
    }
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    const t = (now - r.born) / r.life;
    if (t >= 1) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      rings.splice(i, 1);
      continue;
    }
    r.mesh.scale.setScalar(r.shrink ? r.radius * (1 - t * 0.7) : 0.2 + r.radius * t);
    r.mesh.material.opacity = 0.9 * (1 - t);
  }

  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    if (now < f.until) continue;
    for (const m of f.mats) {
      m.emissive.setHex(m.userData._emissive ?? 0x000000);
      m.emissiveIntensity = m.userData._emissiveI ?? 0;
      m.userData._flashing = false;
    }
    flashes.splice(i, 1);
  }
}

export function clearAll() {
  for (const n of numbers) n.el.remove();
  numbers.length = 0;
  for (const p of particles) { for (const m of p.group) scene.remove(m); p.mat.dispose(); }
  particles.length = 0;
  for (const r of rings) { scene.remove(r.mesh); r.mesh.material.dispose(); }
  rings.length = 0;
}
