import { G, me } from './state.js';
import { canvas, centerCameraOnMe, updateMouseWorld, toggleCameraLock } from './scene.js';
import { SLOT_KEYS, SPELL_DEFS } from './config.js';
import * as spells from './spells.js';
import * as hud from './hud.js';
import * as fx from './fx.js';

const KEY_TO_SLOT = { KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyD: 'd', KeyF: 'f' };

function castSlot(slotKey) {
  const kind = G.equippedBySlot[slotKey];
  if (!kind) return;
  spells.cast(kind);
}

export function initInput() {
  window.addEventListener('keydown', e => {
    if (!G.started) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const slot = KEY_TO_SLOT[e.code];
    if (slot) {
      e.preventDefault();
      if (!hud.pickerKey(slot)) castSlot(slot);
      return;
    }
    switch (e.code) {
      case 'KeyB':
      case 'KeyT':
      case 'Tab':
        e.preventDefault();
        hud.toggleTalents();
        break;
      case 'Space':
        e.preventDefault();
        centerCameraOnMe();
        break;
      case 'KeyY':
        e.preventDefault();
        toggleCameraLock();
        break;
      case 'Escape':
        hud.closeOverlayIfTalents();
        break;
    }
  });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    const m = G.mouse;
    m.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    m.ndcY = -((e.clientY - r.top) / r.height) * 2 + 1;
    m.clientX = e.clientX;
    m.clientY = e.clientY;
    m.has = true;
    if (m.rightDown) {
      updateMouseWorld();
      G.moveTarget.x = m.worldX;
      G.moveTarget.z = m.worldZ;
      G.hasMoveTarget = true;
    }
  });

  canvas.addEventListener('mousedown', e => {
    if (!G.started) return;
    if (e.button === 0) {
      if (hud.overlayModeNow() === 'talents') hud.closeOverlayIfTalents();
      spells.cast('aa');
    } else if (e.button === 2) {
      G.mouse.rightDown = true;
      updateMouseWorld();
      G.moveTarget.x = G.mouse.worldX;
      G.moveTarget.z = G.mouse.worldZ;
      G.hasMoveTarget = true;
      fx.clickMarker(G.mouse.worldX, G.mouse.worldZ);
    }
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 2) G.mouse.rightDown = false;
  });
  window.addEventListener('blur', () => { G.mouse.rightDown = false; });
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ability bar clicks + drag & drop of spell chips
  for (const k of SLOT_KEYS) {
    const el = document.getElementById(`slot-${k}`);
    if (!el) continue;
    el.addEventListener('click', () => castSlot(k));
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const kind = e.dataTransfer?.getData('text/spell-kind');
      if (!kind || !(kind in SPELL_DEFS) || !G.myStats.spells.has(kind)) return;
      hud.equipSpell(kind, k);
    });
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', e => {
      const kind = G.equippedBySlot[k];
      if (!kind) { e.preventDefault(); return; }
      e.dataTransfer?.setData('text/spell-kind', kind);
    });
  }
  void me;
}
