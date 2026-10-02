// Silvester-Klang (N4, #742): Zischen beim Aufstieg, Knall beim Zerplatzen, Knistern danach - live aus der Web Audio
// API, keine Dateien. Nur nach ausdrücklichem Einschalten (#640: Ton nur auf Wunsch): eigener Schalter, Vorgabe aus,
// gemerkt je Gerät. Ferne Raketen sind leiser und ihr Knall kommt später; höchstens wenige Klänge gleichzeitig, kein
// Übersteuern (Begrenzer am Ausgang). Pausiert, wenn der Tab unsichtbar ist.

import { soundDelay } from "./fireworks";

export const NEW_YEAR_SOUND_KEY = "tls-newyear-sound";
export const NEW_YEAR_SOUND_EVENT = "tls:newyear-sound-pref";
/** So viele Klänge dürfen gleichzeitig klingen - in der Show knallt es sonst wie ein Gewitter aus dem Lautsprecher. */
export const MAX_VOICES = 6;
export const MASTER_LEVEL = 0.18;

export function readNewYearSound(storage = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    return storage?.getItem(NEW_YEAR_SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeNewYearSound(on, storage = typeof localStorage === "undefined" ? null : localStorage, win = typeof window === "undefined" ? null : window) {
  try {
    storage?.setItem(NEW_YEAR_SOUND_KEY, on ? "on" : "off");
  } catch {
    // dann eben nur für diese Seite
  }
  try {
    win?.dispatchEvent(new CustomEvent(NEW_YEAR_SOUND_EVENT, { detail: { on: Boolean(on) } }));
  } catch {
    // ohne Ereignis merkt es die Seite beim nächsten Laden
  }
}

/** Lautstärke nach Entfernung: nah voll, fern ein Drittel. */
export function volumeFor(distance) {
  return Math.round((1 - 0.65 * Math.max(0, Math.min(1, Number(distance) || 0))) * 100) / 100;
}

/** Wie ein Knall je Art klingt: Länge, Tiefe (Filter), Knistern danach. */
export const BURST_VOICES = {
  peony: { seconds: 0.9, cutoff: 900, crackle: 0 },
  chrysanthemum: { seconds: 1.1, cutoff: 1100, crackle: 0.25 },
  willow: { seconds: 1.6, cutoff: 600, crackle: 0.15 },
  crackle: { seconds: 0.7, cutoff: 1400, crackle: 1 },
  ring: { seconds: 0.8, cutoff: 1000, crackle: 0 },
  heart: { seconds: 0.9, cutoff: 950, crackle: 0.2 },
};

/**
 * Die Klangmaschine: wartet auf das Einschalten (eine Geste der Person ist dann schon geschehen), spielt Zischen und
 * Knall mit Entfernung und Verzögerung, begrenzt die Stimmen. `AudioContextImpl` ist für Tests austauschbar.
 */
export function createNewYearSound({ win = typeof window === "undefined" ? null : window, AudioContextImpl = win ? win.AudioContext || win.webkitAudioContext : null, enabled = readNewYearSound() } = {}) {
  let ctx = null;
  let master = null;
  let on = Boolean(enabled);
  let voices = 0;

  const ensure = () => {
    if (ctx || !AudioContextImpl) return ctx;
    try {
      ctx = new AudioContextImpl();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 12;
      master = ctx.createGain();
      master.gain.value = MASTER_LEVEL;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  };

  const noise = (seconds) => {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  };

  const voice = (build, seconds) => {
    if (!on || !ensure() || voices >= MAX_VOICES || (win && win.document && win.document.hidden)) return false;
    voices += 1;
    build();
    win?.setTimeout?.(() => {
      voices = Math.max(0, voices - 1);
    }, seconds * 1000 + 50);
    return true;
  };

  return {
    isOn: () => on,
    setOn(next) {
      on = Boolean(next);
      if (on && ensure() && ctx.state === "suspended") ctx.resume?.();
    },
    /** Das Zischen der aufsteigenden Rakete: gefiltertes Rauschen, das in der Tonhöhe steigt. */
    whistle(distance = 0.5, rise = 1.4) {
      return voice(() => {
        const t = ctx.currentTime;
        const src = noise(rise);
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.setValueAtTime(1800, t);
        band.frequency.exponentialRampToValueAtTime(4200, t + rise);
        band.Q.value = 3;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18 * volumeFor(distance), t + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + rise);
        src.connect(band).connect(gain).connect(master);
        src.start(t);
        src.stop(t + rise);
      }, rise);
    },
    /** Der Knall: tiefes Rauschen mit schnellem Abklingen, je Art anders lang und dumpf; ferne kommen später. */
    burst(type = "peony", distance = 0.5) {
      const shape = BURST_VOICES[type] || BURST_VOICES.peony;
      const delay = soundDelay(distance);
      return voice(() => {
        const t = ctx.currentTime + delay;
        const src = noise(shape.seconds);
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.setValueAtTime(shape.cutoff * (1 - 0.4 * distance), t);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9 * volumeFor(distance), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + shape.seconds);
        src.connect(low).connect(gain).connect(master);
        src.start(t);
        src.stop(t + shape.seconds);
        if (shape.crackle > 0) {
          // Knistern: kurze, helle Klicks nach dem Knall.
          const clicks = Math.round(8 * shape.crackle) + 2;
          for (let i = 0; i < clicks; i += 1) {
            const at = t + 0.25 + Math.random() * 0.6;
            const click = noise(0.02);
            const high = ctx.createBiquadFilter();
            high.type = "highpass";
            high.frequency.value = 3000;
            const level = ctx.createGain();
            level.gain.setValueAtTime(0.25 * volumeFor(distance), at);
            level.gain.exponentialRampToValueAtTime(0.001, at + 0.02);
            click.connect(high).connect(level).connect(master);
            click.start(at);
            click.stop(at + 0.03);
          }
        }
      }, delay + shape.seconds + 0.9);
    },
    dispose() {
      try {
        ctx?.close?.();
      } catch {
        // nichts mehr zu tun
      }
      ctx = null;
      master = null;
    },
  };
}
