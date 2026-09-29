// Die Halloween-Palette (#679): jedes Geräusch aus Oszillatoren, gefiltertem Rauschen und kurzen Hüllkurven -
// dezent, dunkel, nie kindlich. Dazu die Musik: ein leiser Klangteppich aus Orgel-Drone, Wind, seltenen Glocken
// und einem Herzschlag, dessen Motive gewürfelt werden, damit nichts wie ein Band loopt. Alles im Türkis-Dunkel
// der Saison gedacht: viel Tiefe, wenig Höhen, kein Schlag über der Grenze.

const FM_BELL_RATIO = 1.5;

function envelope(param, t, peak, attack, decay, floor = 0.0001) {
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(floor, t + attack + decay);
}

/** Rauschen durch ein Filter mit Hüllkurve - der Baustein für Wind, Hauch, Flattern, Knistern. */
function noiseBurst(ctx, dest, noise, { t, seconds, type = "bandpass", freq = 800, q = 1, sweep = null, peak = 0.5, attack = 0.01 }) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx, Math.max(0.05, seconds + 0.05), Math.round(freq));
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + seconds);
  filter.Q.value = q;
  const gain = ctx.createGain();
  envelope(gain.gain, t, peak, attack, Math.max(0.02, seconds - attack));
  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(t);
  source.stop(t + seconds + 0.05);
  return gain;
}

/** Eine dunkle FM-Glocke: Träger plus Modulator, langes Ausklingen. */
function bell(ctx, dest, { t, freq = 220, seconds = 1.8, peak = 0.35, index = 3 }) {
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  modulator.frequency.value = freq * FM_BELL_RATIO;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(freq * index, t);
  depth.gain.exponentialRampToValueAtTime(freq * 0.2, t + seconds);
  modulator.connect(depth);
  depth.connect(carrier.frequency);
  const gain = ctx.createGain();
  envelope(gain.gain, t, peak, 0.005, seconds);
  carrier.connect(gain);
  gain.connect(dest);
  modulator.start(t);
  carrier.start(t);
  modulator.stop(t + seconds + 0.1);
  carrier.stop(t + seconds + 0.1);
}

/** Ein tiefer Schlag: Sinus, der nach unten fällt. */
function thump(ctx, dest, { t, from = 90, to = 45, seconds = 0.25, peak = 0.6 }) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
  const gain = ctx.createGain();
  envelope(gain.gain, t, peak, 0.005, seconds);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + seconds + 0.05);
}

export const instruments = {
  /** Flügelschläge, die sich entfernen: sechs Rausch-Stöße, leiser und tiefer werdend. */
  bat_scare(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    for (let i = 0; i < 6; i += 1) {
      noiseBurst(ctx, dest, noise, { t: t0 + i * 0.09, seconds: 0.07, freq: 1400 - i * 150, q: 2, peak: 0.5 - i * 0.06, attack: 0.008 });
    }
  },
  /** Ein Ankerfaden reißt: ein feiner Klick, dann ein Nachzucken. */
  web_tear(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    noiseBurst(ctx, dest, noise, { t: t0, seconds: 0.03, type: "highpass", freq: 2400, peak: 0.7, attack: 0.002 });
    noiseBurst(ctx, dest, noise, { t: t0 + 0.06, seconds: 0.05, type: "highpass", freq: 1800, peak: 0.35, attack: 0.004 });
    thump(ctx, dest, { t: t0 + 0.02, from: 120, to: 60, seconds: 0.18, peak: 0.25 });
  },
  /** Das ganze Netz kommt los: tiefer Schlag und ein Windhauch, der es davonträgt. */
  web_fly(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    thump(ctx, dest, { t: t0, from: 80, to: 40, seconds: 0.3, peak: 0.5 });
    noiseBurst(ctx, dest, noise, { t: t0 + 0.05, seconds: 1.6, freq: 320, q: 0.7, sweep: 1400, peak: 0.4, attack: 0.3 });
  },
  /** Das Netz wird gepackt: ein kurzes Spannen. */
  web_grab(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    noiseBurst(ctx, dest, noise, { t: t0, seconds: 0.12, freq: 600, q: 3, sweep: 1500, peak: 0.25, attack: 0.02 });
  },
  /** Ein Geist steigt auf: ein Hauch mit Vibrato, darunter ein Sub-Bass. */
  ghost(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    const breath = noiseBurst(ctx, dest, noise, { t: t0, seconds: 2.2, freq: 420, q: 8, sweep: 700, peak: 0.45, attack: 0.5 });
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = 0.15;
    lfo.connect(depth);
    depth.connect(breath.gain);
    lfo.start(t0);
    lfo.stop(t0 + 2.3);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 55;
    const subGain = ctx.createGain();
    envelope(subGain.gain, t0, 0.3, 0.6, 1.4);
    sub.connect(subGain);
    subGain.connect(dest);
    sub.start(t0);
    sub.stop(t0 + 2.3);
  },
  /** Die Katze läuft los: vier gedämpfte Tapser, dann ein kurzes Schnurren. `at` verschiebt den Beginn (nach dem Miauen). */
  cat_walk(ctx, dest, { noise, at = 0 }) {
    const t0 = ctx.currentTime + at;
    for (let i = 0; i < 4; i += 1) {
      thump(ctx, dest, { t: t0 + i * 0.21, from: 220, to: 160, seconds: 0.05, peak: 0.18 });
    }
    const purr = ctx.createOscillator();
    purr.type = "sawtooth";
    purr.frequency.value = 28;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 260;
    const tremolo = ctx.createOscillator();
    tremolo.type = "sine";
    tremolo.frequency.value = 25;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = 0.5;
    const gain = ctx.createGain();
    envelope(gain.gain, t0 + 0.9, 0.22, 0.2, 1.0);
    tremolo.connect(tremoloDepth);
    tremoloDepth.connect(gain.gain);
    purr.connect(low);
    low.connect(gain);
    gain.connect(dest);
    purr.start(t0 + 0.9);
    tremolo.start(t0 + 0.9);
    purr.stop(t0 + 2.2);
    tremolo.stop(t0 + 2.2);
    void noise;
  },
  /** Kürbis: Kerzenknistern und eine dunkle Glocke. */
  pumpkin(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    for (let i = 0; i < 6; i += 1) {
      noiseBurst(ctx, dest, noise, { t: t0 + i * 0.09 + (i % 2) * 0.03, seconds: 0.02, type: "highpass", freq: 3200, peak: 0.12, attack: 0.002 });
    }
    bell(ctx, dest, { t: t0 + 0.05, freq: 196, seconds: 1.6, peak: 0.3 });
  },
  /** Laterne: Deckel knarrt, eine hellere Glocke, ein Flattern. */
  lantern(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    const creak = ctx.createOscillator();
    creak.type = "sawtooth";
    creak.frequency.setValueAtTime(180, t0);
    creak.frequency.exponentialRampToValueAtTime(130, t0 + 0.3);
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 500;
    const gain = ctx.createGain();
    envelope(gain.gain, t0, 0.12, 0.05, 0.3);
    creak.connect(low);
    low.connect(gain);
    gain.connect(dest);
    creak.start(t0);
    creak.stop(t0 + 0.4);
    bell(ctx, dest, { t: t0 + 0.25, freq: 330, seconds: 1.4, peak: 0.28 });
    for (let i = 0; i < 4; i += 1) {
      noiseBurst(ctx, dest, noise, { t: t0 + 0.5 + i * 0.1, seconds: 0.06, freq: 1200, q: 2, peak: 0.25, attack: 0.008 });
    }
  },
  /** Ein Grab wackelt: ein dumpfer Stein. */
  grave(ctx, dest, { noise }) {
    const t0 = ctx.currentTime;
    thump(ctx, dest, { t: t0, from: 140, to: 70, seconds: 0.12, peak: 0.3 });
    noiseBurst(ctx, dest, noise, { t: t0, seconds: 0.08, type: "lowpass", freq: 500, peak: 0.2, attack: 0.005 });
  },
};

/** Jumpscare-Klänge (#680): Fauchen der Katze, Flüstern des Schattens, der Schlag zum Auftritt - alle im Rahmen der Regler. */
instruments.hiss = function hiss(ctx, dest, { noise }) {
  const t0 = ctx.currentTime;
  noiseBurst(ctx, dest, noise, { t: t0, seconds: 0.55, type: "bandpass", freq: 2600, q: 1.2, sweep: 4200, peak: 0.55, attack: 0.03 });
  noiseBurst(ctx, dest, noise, { t: t0 + 0.05, seconds: 0.4, type: "highpass", freq: 5000, peak: 0.25, attack: 0.02 });
  thump(ctx, dest, { t: t0, from: 160, to: 70, seconds: 0.12, peak: 0.3 });
};
instruments.whisper = function whisper(ctx, dest, { noise }) {
  const t0 = ctx.currentTime;
  for (let i = 0; i < 5; i += 1) {
    noiseBurst(ctx, dest, noise, { t: t0 + i * 0.17, seconds: 0.14, type: "bandpass", freq: 1500 + (i % 2) * 900, q: 4, sweep: 900, peak: 0.28, attack: 0.03 });
  }
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 48;
  const gain = ctx.createGain();
  envelope(gain.gain, t0, 0.25, 0.3, 1.0);
  sub.connect(gain);
  gain.connect(dest);
  sub.start(t0);
  sub.stop(t0 + 1.4);
};
instruments.scare_hit = function scareHit(ctx, dest, { noise }) {
  const t0 = ctx.currentTime;
  thump(ctx, dest, { t: t0, from: 110, to: 32, seconds: 0.45, peak: 0.85 });
  noiseBurst(ctx, dest, noise, { t: t0, seconds: 0.2, type: "lowpass", freq: 900, peak: 0.5, attack: 0.004 });
  noiseBurst(ctx, dest, noise, { t: t0 + 0.02, seconds: 0.9, type: "bandpass", freq: 250, q: 0.8, sweep: 90, peak: 0.35, attack: 0.05 });
};

/**
 * Ein Miauen (Rückmeldung des Betreibers, 29.09.): eine Sägezahn-Stimme mit Tonhöhenbogen (hinauf, dann hinab),
 * leichtem Vibrato und zwei wandernden Formanten („mi-a-u“) - kurz und leise, nie niedlich überzeichnet.
 */
export function meow(ctx, dest, { t, pitch = 1, seconds = 0.58, peak = 0.3 }) {
  const voice = ctx.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.setValueAtTime(430 * pitch, t);
  voice.frequency.linearRampToValueAtTime(640 * pitch, t + seconds * 0.28);
  voice.frequency.exponentialRampToValueAtTime(360 * pitch, t + seconds);
  const vibrato = ctx.createOscillator();
  vibrato.type = "sine";
  vibrato.frequency.value = 6.5;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 9 * pitch;
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(voice.frequency);
  // Zwei Formanten: der erste öffnet sich und schließt wieder, der zweite fällt - so wird aus dem Ton ein Laut.
  const first = ctx.createBiquadFilter();
  first.type = "bandpass";
  first.Q.value = 5;
  first.frequency.setValueAtTime(420, t);
  first.frequency.linearRampToValueAtTime(950, t + seconds * 0.35);
  first.frequency.exponentialRampToValueAtTime(480, t + seconds);
  const second = ctx.createBiquadFilter();
  second.type = "bandpass";
  second.Q.value = 7;
  second.frequency.setValueAtTime(2300, t);
  second.frequency.exponentialRampToValueAtTime(1500, t + seconds * 0.45);
  second.frequency.exponentialRampToValueAtTime(900, t + seconds);
  const high = ctx.createGain();
  high.gain.value = 0.55;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.07);
  gain.gain.linearRampToValueAtTime(peak * 0.8, t + seconds * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  voice.connect(first);
  voice.connect(second);
  first.connect(gain);
  second.connect(high);
  high.connect(gain);
  gain.connect(dest);
  voice.start(t);
  vibrato.start(t);
  voice.stop(t + seconds + 0.05);
  vibrato.stop(t + seconds + 0.05);
}

/** Drei Arten zu miauen: kurz und hell, gewöhnlich, lang und dunkel - gewürfelt, damit sie nicht immer gleich klingt. */
export const MEOWS = [{ pitch: 1.18, seconds: 0.42, peak: 0.26 }, { pitch: 1, seconds: 0.58, peak: 0.3 }, { pitch: 0.86, seconds: 0.78, peak: 0.3 }];

/** Die Katze wird angeklickt: sie miaut und läuft dann los (Tapser und Schnurren wie `cat_walk`). */
instruments.cat_meow = function catMeow(ctx, dest, { noise, rng = Math.random }) {
  const roll = rng();
  const kind = MEOWS[roll < 0.3 ? 0 : roll < 0.75 ? 1 : 2];
  meow(ctx, dest, { t: ctx.currentTime, ...kind });
  instruments.cat_walk(ctx, dest, { noise, at: kind.seconds + 0.12 });
};

/** D-Moll für die Glocken - die Töne, aus denen die Motive gewürfelt werden (Hz). */
export const BELL_NOTES = [146.83, 174.61, 220.0, 233.08, 261.63, 293.66];

/**
 * Die Musik: ein Sequenzer mit Vorlauf (Uhr des AudioContext). Drone und Wind laufen durch, Glocken alle 8–16 Takte
 * als gewürfeltes Motiv, ein Herzschlag alle 20–40 s; bei Tag nur Drone und Wind. `rng` und `interval` sind für
 * Tests austauschbar. Gibt `stop()` zurück.
 */
export function music(ctx, dest, { noise, night = true, rng = Math.random, interval = (fn, ms) => setInterval(fn, ms), clear = (id) => clearInterval(id) } = {}) {
  const t0 = ctx.currentTime;
  const nodes = [];
  // Drone: zwei leicht verstimmte Sägezähne durch einen Tiefpass, langsam atmend.
  const droneGain = ctx.createGain();
  droneGain.gain.setValueAtTime(0.0001, t0);
  droneGain.gain.linearRampToValueAtTime(0.5, t0 + 4);
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 180;
  [55, 55.4].forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.connect(low);
    osc.start(t0);
    nodes.push(osc);
  });
  const breathe = ctx.createOscillator();
  breathe.type = "sine";
  breathe.frequency.value = 0.07;
  const breatheDepth = ctx.createGain();
  breatheDepth.gain.value = 0.2;
  breathe.connect(breatheDepth);
  breatheDepth.connect(droneGain.gain);
  breathe.start(t0);
  nodes.push(breathe);
  low.connect(droneGain);
  droneGain.connect(dest);
  // Wind: Rauschen durch einen Tiefpass, der langsam wandert.
  const wind = ctx.createBufferSource();
  wind.buffer = noise(ctx, 4, 7);
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 400;
  const windLfo = ctx.createOscillator();
  windLfo.type = "sine";
  windLfo.frequency.value = 0.05;
  const windDepth = ctx.createGain();
  windDepth.gain.value = 250;
  windLfo.connect(windDepth);
  windDepth.connect(windFilter.frequency);
  const windGain = ctx.createGain();
  windGain.gain.setValueAtTime(0.0001, t0);
  windGain.gain.linearRampToValueAtTime(night ? 0.35 : 0.2, t0 + 6);
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(dest);
  wind.start(t0);
  windLfo.start(t0);
  nodes.push(wind, windLfo);

  const bar = 4;
  let nextBells = t0 + 8 + rng() * 8;
  let nextHeart = t0 + 20 + rng() * 20;
  const scheduled = [];
  const tick = () => {
    const now = ctx.currentTime;
    const horizon = now + 1.0;
    if (night && nextBells <= horizon) {
      const count = 3 + Math.floor(rng() * 3);
      let at = nextBells;
      for (let i = 0; i < count; i += 1) {
        const note = BELL_NOTES[Math.floor(rng() * BELL_NOTES.length)];
        bell(ctx, dest, { t: at, freq: note, seconds: 2.4, peak: 0.22, index: 2.2 });
        scheduled.push({ kind: "bell", at, freq: note });
        at += (rng() < 0.4 ? 0.5 : 1) * (60 / 60);
      }
      nextBells = at + (8 + rng() * 8) * bar;
    }
    if (night && nextHeart <= horizon) {
      thump(ctx, dest, { t: nextHeart, from: 70, to: 45, seconds: 0.16, peak: 0.28 });
      thump(ctx, dest, { t: nextHeart + 0.14, from: 60, to: 40, seconds: 0.16, peak: 0.2 });
      scheduled.push({ kind: "heart", at: nextHeart });
      nextHeart += 20 + rng() * 20;
    }
  };
  tick();
  const timer = interval(tick, 250);
  return {
    scheduled,
    stop() {
      clear(timer);
      const t = ctx.currentTime;
      [droneGain, windGain].forEach((gain) => {
        gain.gain.cancelScheduledValues?.(t);
        gain.gain.setValueAtTime(gain.gain.value ?? 0.3, t);
        gain.gain.linearRampToValueAtTime(0.0001, t + 1.5);
      });
      nodes.forEach((node) => {
        try {
          node.stop(t + 1.6);
        } catch {
          // schon aus
        }
      });
    },
  };
}

/** Die Palette, die das Halloween-Modul der Engine gibt. `night` kommt aus den Saisondaten. */
export function palette({ night = true } = {}) {
  return {
    key: "halloween",
    instruments,
    music: (ctx, dest, extra = {}) => music(ctx, dest, { ...extra, night }),
  };
}
