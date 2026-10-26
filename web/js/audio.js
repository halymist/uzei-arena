// Tiny WebAudio synth. No asset files: every sound is built from oscillators
// and filtered noise. Call init() from a user gesture.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function init() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1.0;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  try {
    muted = localStorage.getItem('superhry-muted') === '1';
  } catch { /* ignore */ }
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('superhry-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  return muted;
}

export function isMuted() { return muted; }

function now() { return ctx.currentTime; }

function env(node, t0, attack, hold, release, peak = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  node.connect(g);
  g.connect(master);
  return g;
}

function tone(type, f0, f1, dur, peak = 0.5, delay = 0) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(o, t0, 0.005, dur * 0.3, dur * 0.7, peak);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur, peak = 0.4, filterHz = 2000, q = 1, delay = 0) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterHz;
  f.Q.value = q;
  src.connect(f);
  env(f, t0, 0.003, dur * 0.2, dur * 0.8, peak);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export const sfx = {
  shoot(kind) {
    switch (kind) {
      case 'aa': tone('square', 520, 180, 0.09, 0.18); noise(0.05, 0.12, 3000, 2); break;
      case 'q': tone('square', 760, 320, 0.06, 0.14); break;
      case 'r': tone('sawtooth', 120, 60, 0.5, 0.5); noise(0.35, 0.35, 900, 1); break;
      case 'x': tone('triangle', 300, 900, 0.18, 0.3); break;
      case 'g': noise(0.45, 0.3, 500, 0.8); tone('sine', 90, 140, 0.4, 0.3); break;
      default: tone('square', 440, 220, 0.08, 0.15);
    }
  },
  cast(kind) {
    switch (kind) {
      case 'w': tone('sine', 300, 900, 0.25, 0.25); break;
      case 'e': noise(0.15, 0.3, 4000, 3); tone('sine', 1200, 300, 0.2, 0.25); break;
      case 'c': noise(0.2, 0.4, 700, 1); tone('sawtooth', 200, 80, 0.2, 0.3); break;
      case 'v': tone('sine', 220, 330, 0.6, 0.25); tone('sine', 277, 415, 0.6, 0.2, 0.05); break;
      case 's': tone('triangle', 400, 800, 0.3, 0.3); tone('triangle', 600, 1200, 0.3, 0.2, 0.08); break;
      case 'f': tone('sine', 500, 1000, 0.35, 0.25); tone('sine', 750, 1500, 0.35, 0.2, 0.1); break;
      case 'z': tone('sawtooth', 90, 45, 0.4, 0.3); break;
      case 'rcharge': tone('sine', 200, 800, 1.0, 0.18); break;
      default: tone('sine', 500, 700, 0.15, 0.2);
    }
  },
  hit() { noise(0.07, 0.35, 1800, 1.5); tone('square', 180, 90, 0.06, 0.2); },
  hurt() { noise(0.12, 0.45, 600, 1); tone('sawtooth', 140, 60, 0.15, 0.35); },
  shieldHit() { tone('triangle', 900, 500, 0.12, 0.3); },
  kill() { tone('square', 440, 880, 0.12, 0.3); tone('square', 660, 1320, 0.15, 0.3, 0.1); tone('square', 880, 1760, 0.25, 0.3, 0.2); },
  death() { tone('sawtooth', 400, 60, 0.7, 0.4); noise(0.5, 0.3, 400, 0.7); },
  explode() { noise(0.5, 0.6, 300, 0.6); tone('sine', 120, 30, 0.5, 0.5); },
  pickup() { tone('sine', 880, 1320, 0.12, 0.25); tone('sine', 1320, 1760, 0.15, 0.2, 0.08); },
  heal() { tone('sine', 523, 784, 0.2, 0.2); tone('sine', 659, 988, 0.25, 0.18, 0.1); },
  lock() { tone('square', 300, 150, 0.2, 0.3); tone('square', 150, 75, 0.3, 0.3, 0.18); },
  stun() { tone('triangle', 1200, 300, 0.3, 0.3); },
  tick() { tone('square', 1000, 1000, 0.05, 0.2); },
  go() { tone('square', 660, 660, 0.08, 0.3); tone('square', 880, 880, 0.08, 0.3, 0.1); tone('square', 1320, 1320, 0.3, 0.35, 0.2); },
  roundEnd() { tone('triangle', 660, 440, 0.4, 0.3); tone('triangle', 440, 330, 0.6, 0.3, 0.3); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.3, 0.3, i * 0.12)); },
  talent() { tone('sine', 700, 1400, 0.15, 0.25); },
  leader() { tone('square', 523, 523, 0.1, 0.2); tone('square', 784, 784, 0.15, 0.2, 0.1); },
  beamWarn() { tone('sawtooth', 220, 440, 0.5, 0.2); },
  dog() { tone('square', 300, 200, 0.08, 0.2); tone('square', 320, 210, 0.08, 0.2, 0.12); },
};
