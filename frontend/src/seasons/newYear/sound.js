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
 * Das Kaliber im Klang (#853): die kleine Kugel knistert leise und hell, die große knallt wie bisher etwas leiser, die
 * sehr große tief und lang - nie lauter als der lauteste Knall bis #853 (`BURST_LEVEL`).
 */
export const CALIBER_VOICES = {
  small: { gain: 0.42, seconds: 0.75, cutoff: 1.5, crackle: 0.5, whistle: 0.6 },
  large: { gain: 0.8, seconds: 1, cutoff: 1, crackle: 0, whistle: 0.85 },
  giant: { gain: 1, seconds: 1.3, cutoff: 0.75, crackle: 0, whistle: 1 },
};
/** So laut war der lauteste Knall bis #853 (nahe Rakete) - darüber geht keiner. */
export const BURST_LEVEL = 0.9;

/** Wie laut ein Knall ist: Kaliber und Entfernung, höchstens `BURST_LEVEL`. */
export function burstLevel(caliber, distance) {
  const voice = CALIBER_VOICES[caliber] || CALIBER_VOICES.large;
  return Math.round(Math.min(BURST_LEVEL, BURST_LEVEL * voice.gain * volumeFor(distance)) * 1000) / 1000;
}

/** Länge, Tiefe und Knistern eines Knalls nach Art und Kaliber. */
export function burstShape(type, caliber) {
  const shape = BURST_VOICES[type] || BURST_VOICES.peony;
  const voice = CALIBER_VOICES[caliber] || CALIBER_VOICES.large;
  return { seconds: Math.round(shape.seconds * voice.seconds * 100) / 100, cutoff: Math.round(shape.cutoff * voice.cutoff), crackle: Math.max(shape.crackle, voice.crackle) };
}

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
    /** Das Zischen der aufsteigenden Rakete: gefiltertes Rauschen, das in der Tonhöhe steigt - kleine zischen leiser. */
    whistle(distance = 0.5, rise = 1.4, caliber = "large") {
      const level = (CALIBER_VOICES[caliber] || CALIBER_VOICES.large).whistle;
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
        gain.gain.linearRampToValueAtTime(0.18 * level * volumeFor(distance), t + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + rise);
        src.connect(band).connect(gain).connect(master);
        src.start(t);
        src.stop(t + rise);
      }, rise);
    },
    /** Der Knall: tiefes Rauschen mit schnellem Abklingen, je Art und Kaliber anders lang, laut und dumpf; ferne kommen später. */
    burst(type = "peony", distance = 0.5, caliber = "large") {
      const shape = burstShape(type, caliber);
      const level = burstLevel(caliber, distance);
      const delay = soundDelay(distance);
      return voice(() => {
        const t = ctx.currentTime + delay;
        const src = noise(shape.seconds);
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.setValueAtTime(shape.cutoff * (1 - 0.4 * distance), t);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(level, t);
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
            const clickGain = ctx.createGain();
            clickGain.gain.setValueAtTime((0.25 / BURST_LEVEL) * level, at);
            clickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.02);
            click.connect(high).connect(clickGain).connect(master);
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
