import * as THREE from 'three';

// Canvas-backed billboard sprites: names, HP bars, speech bubbles, markers.

function canvasSprite(w, h, scaleX, scaleY) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(scaleX, scaleY, 1);
  sp.userData.canvas = c;
  sp.userData.ctx = ctx;
  sp.userData.tex = tex;
  return sp;
}

export function disposeSprite(sp) {
  if (!sp) return;
  sp.userData.tex?.dispose();
  sp.material?.dispose();
}

// ---- names
export function makeNameSprite(text, color = '#e6e8ee') {
  const sp = canvasSprite(256, 64, 2.6, 0.65);
  setNameSprite(sp, text, color);
  return sp;
}

export function setNameSprite(sp, text, color = '#e6e8ee') {
  const key = `${text}|${color}`;
  if (sp.userData.lastKey === key) return;
  sp.userData.lastKey = key;
  const ctx = sp.userData.ctx;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 28px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  sp.userData.tex.needsUpdate = true;
}

// ---- speech bubbles
export function makeTalkSprite(text) {
  const sp = canvasSprite(420, 76, 3.8, 0.72);
  setTalkSprite(sp, text || '');
  return sp;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function setTalkSprite(sp, text) {
  const t = text || '';
  const c = sp.userData.canvas;
  const ctx = sp.userData.ctx;
  const fontPx = 28;
  ctx.font = `bold ${fontPx}px ui-monospace, Consolas, monospace`;
  const measured = t ? Math.ceil(ctx.measureText(t).width) : 0;
  const w = Math.max(220, Math.min(1200, measured + 44));
  const h = 76;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    sp.scale.set((w / 420) * 3.8, 0.72, 1);
  }
  ctx.clearRect(0, 0, w, h);
  if (t) {
    ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
    roundRect(ctx, 6, 8, w - 12, h - 20, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // bubble tail
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8, h - 12);
    ctx.lineTo(w / 2, h - 2);
    ctx.lineTo(w / 2 + 8, h - 12);
    ctx.fillStyle = 'rgba(8, 12, 22, 0.78)';
    ctx.fill();
    ctx.font = `bold ${fontPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f8ff';
    ctx.fillText(t, w / 2, h / 2 - 2);
  }
  sp.userData.tex.needsUpdate = true;
}

// ---- HP bars
export function makeHpSprite() {
  const sp = canvasSprite(128, 24, 1.7, 0.28);
  setHpSprite(sp, 1, 1, 0);
  return sp;
}

export function setHpSprite(sp, hp, maxHp, shield = 0, color = '#ff5d7a') {
  // redrawing uploads a texture; skip when nothing changed
  const key = `${hp}|${maxHp}|${shield}|${color}`;
  if (sp.userData.lastKey === key) return;
  sp.userData.lastKey = key;
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const shieldRatio = maxHp > 0 ? Math.max(0, Math.min(1 - ratio, shield / maxHp)) : 0;
  const ctx = sp.userData.ctx;
  const w = 128, h = 24;
  const ix = 4, iy = 6, iw = 120, ih = 12;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2b1a24';
  ctx.fillRect(ix, iy, iw, ih);
  const hpW = iw * ratio;
  const shW = iw * shieldRatio;
  if (shW > 0) {
    ctx.fillStyle = '#ffd6f2';
    ctx.fillRect(ix + hpW, iy, shW, ih);
  }
  ctx.fillStyle = color;
  ctx.fillRect(ix, iy, hpW, ih);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  sp.userData.tex.needsUpdate = true;
}

// ---- small text markers (stun stars, leader tag, bounty)
export function makeTextSprite(text, color, fontPx = 40, scaleX = 2.1, scaleY = 0.55) {
  const sp = canvasSprite(256, 64, scaleX, scaleY);
  const ctx = sp.userData.ctx;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = `bold ${fontPx}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  sp.userData.tex.needsUpdate = true;
  return sp;
}

export function makeStunSprite() {
  return makeTextSprite('✦ ✦ ✦', '#8bf6ff', 36);
}

export function makeLeaderSprite() {
  return makeTextSprite('★', '#ffd84a', 44, 1.2, 0.5);
}

export function makeBountySprite(points) {
  return makeTextSprite(`+${points} b.`, '#ffd84a', 34, 1.6, 0.42);
}
