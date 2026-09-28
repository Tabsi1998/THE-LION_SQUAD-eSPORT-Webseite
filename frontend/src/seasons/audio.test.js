import { DUCK_LEVEL, MIN_GAP_MS, MUSIC_LEVEL, SFX_LEVEL, SOUND_EVENT, SOUND_STORAGE_KEY, createSoundEngine, emitSound, getActiveEngine, noiseBuffer, readSoundPrefs, setActiveEngine, writeSoundPrefs } from "./audio";
import { BELL_NOTES, instruments, music, palette } from "./halloween/sounds";

// Saison-Klänge (#679): die Engine wartet auf die erste Geste, spielt Instrumente der Palette, begrenzt die Dichte,
// duckt die Musik, merkt sich Töne/Musik an oder aus; die Halloween-Palette baut für jedes Geräusch einen endlichen
// Knoten-Graph und die Musik würfelt Glocken und Herzschlag nur bei Nacht.

/** Ein AudioContext aus Pappe: zeichnet Knoten, Verbindungen, Starts und Stopps auf. */
function fakeAudioContext() {
  const log = { nodes: [], connections: 0, starts: 0, stops: 0, params: [] };
  const param = (name) => ({
    value: 0,
    setValueAtTime: (v, t) => log.params.push([name, "set", v, t]),
    linearRampToValueAtTime: (v, t) => log.params.push([name, "lin", v, t]),
    exponentialRampToValueAtTime: (v, t) => log.params.push([name, "exp", v, t]),
    cancelScheduledValues: () => {},
  });
  const node = (kind, extra = {}) => {
    const created = {
      kind,
      connect: () => {
        log.connections += 1;
      },
      disconnect: () => {},
      start: () => {
        log.starts += 1;
      },
      stop: () => {
        log.stops += 1;
      },
      ...extra,
    };
    log.nodes.push(created);
    return created;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: "running",
    destination: { kind: "destination" },
    resumed: 0,
    suspended: 0,
    closed: false,
    createGain: () => node("gain", { gain: param("gain") }),
    createOscillator: () => node("osc", { type: "sine", frequency: param("frequency"), detune: param("detune") }),
    createBiquadFilter: () => node("filter", { type: "lowpass", frequency: param("filter"), Q: param("Q") }),
    createBufferSource: () => node("source", { buffer: null, loop: false }),
    createBuffer: (channels, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    resume: async () => {
      ctx.resumed += 1;
    },
    suspend: async () => {
      ctx.suspended += 1;
    },
    close: () => {
      ctx.closed = true;
    },
  };
  ctx.log = log;
  return ctx;
}

class FakeContextClass {
  constructor() {
    const ctx = fakeAudioContext();
    FakeContextClass.last = ctx;
    return ctx;
  }
}

function fakeWindow() {
  const listeners = {};
  return {
    listeners,
    addEventListener: (name, fn) => {
      listeners[name] = listeners[name] || [];
      listeners[name].push(fn);
    },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter((entry) => entry !== fn);
    },
    dispatchEvent: (event) => {
      (listeners[event.type] || []).forEach((fn) => fn(event));
      return true;
    },
    fire: (name, event = {}) => (listeners[name] || []).forEach((fn) => fn({ type: name, ...event })),
  };
}

afterEach(() => {
  localStorage.removeItem(SOUND_STORAGE_KEY);
  setActiveEngine(null);
});

test("Vorlieben: Vorgabe Töne und Musik an, gespeichert je Gerät, kaputter Speicher stört nicht", () => {
  expect(readSoundPrefs()).toEqual({ sounds: true, music: true });
  writeSoundPrefs({ sounds: false, music: true });
  expect(readSoundPrefs()).toEqual({ sounds: false, music: true });
  localStorage.setItem(SOUND_STORAGE_KEY, "kaputt");
  expect(readSoundPrefs()).toEqual({ sounds: true, music: true });
  expect(readSoundPrefs({ getItem: () => { throw new Error("nein"); } })).toEqual({ sounds: true, music: true });
});

test("Rauschen: ein Puffer voller Werte zwischen -1 und 1, gleich für gleichen Samen", () => {
  const ctx = fakeAudioContext();
  const a = noiseBuffer(ctx, 0.5, 3);
  expect(a.length).toBe(4000);
  const b = noiseBuffer(ctx, 0.5, 3);
  expect(a.length).toBe(b.length);
});

test("Engine: vor der Geste stumm, die Geste erzeugt den Kontext und startet die Musik; Töne sind begrenzt und ducken die Musik", () => {
  const win = fakeWindow();
  const doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  let stamp = 1000;
  const engine = createSoundEngine({ win, doc, AudioContextClass: FakeContextClass, now: () => stamp });
  const played = [];
  engine.setPalette({ instruments: { ping: (ctx, dest) => played.push([ctx, dest]) }, music: () => ({ stop: vi.fn() }) });
  expect(engine.unlocked).toBe(false);
  expect(engine.play("ping")).toBe(false);
  expect(win.listeners.pointerdown.length).toBe(1);
  win.fire("pointerdown");
  expect(engine.unlocked).toBe(true);
  expect(engine.context).toBe(FakeContextClass.last);
  expect(win.listeners.pointerdown.length).toBe(0);
  expect(engine.musicRunning).toBe(true);
  const ctx = FakeContextClass.last;
  expect(ctx.log.nodes.filter((n) => n.kind === "gain").length).toBe(3);
  expect(engine.play("ping")).toBe(true);
  expect(played.length).toBe(1);
  expect(played[0][1].gain.value).toBe(SFX_LEVEL);
  // Zu dicht: der zweite Ton derselben Quelle binnen 150 ms fällt weg.
  stamp += MIN_GAP_MS - 10;
  expect(engine.play("ping")).toBe(false);
  stamp += 20;
  expect(engine.play("ping")).toBe(true);
  // Ducking: die Musik geht kurz zurück und kommt wieder.
  const ducks = ctx.log.params.filter(([name, kind, value]) => name === "gain" && kind === "set" && value === MUSIC_LEVEL * DUCK_LEVEL);
  expect(ducks.length).toBe(2);
  // Unbekannte Instrumente und der Bus
  expect(engine.play("nichts")).toBe(false);
  win.dispatchEvent({ type: SOUND_EVENT, detail: { name: "ping" } });
  stamp += 200;
  win.dispatchEvent({ type: SOUND_EVENT, detail: { name: "ping" } });
  expect(engine.played.length).toBe(3);
  engine.dispose();
  expect(ctx.closed).toBe(true);
  expect(win.listeners[SOUND_EVENT].length).toBe(0);
});

test("Engine: Töne aus stellt den Regler auf null, Musik aus stoppt sie, an startet sie wieder; Tab versteckt pausiert", () => {
  const win = fakeWindow();
  const visibility = {};
  const doc = { hidden: false, addEventListener: (name, fn) => { visibility[name] = fn; }, removeEventListener: vi.fn() };
  const engine = createSoundEngine({ win, doc, AudioContextClass: FakeContextClass, prefs: { sounds: true, music: false } });
  const stop = vi.fn();
  engine.setPalette({ instruments: {}, music: () => ({ stop }) });
  win.fire("keydown");
  expect(engine.musicRunning).toBe(false);
  engine.setPrefs({ music: true });
  expect(engine.musicRunning).toBe(true);
  expect(readSoundPrefs()).toEqual({ sounds: true, music: true });
  engine.setPrefs({ music: false });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(engine.musicRunning).toBe(false);
  const ctx = FakeContextClass.last;
  const sfx = ctx.log.nodes.filter((n) => n.kind === "gain")[1];
  engine.setPrefs({ sounds: false });
  expect(sfx.gain.value).toBe(0);
  doc.hidden = true;
  visibility.visibilitychange();
  expect(ctx.suspended).toBe(1);
  doc.hidden = false;
  visibility.visibilitychange();
  expect(ctx.resumed).toBeGreaterThanOrEqual(1);
  engine.dispose();
});

test("Bus und aktive Engine: emitSound schickt das Ereignis, ohne Fenster nichts", () => {
  const win = fakeWindow();
  expect(emitSound("ping", { x: 1 }, win)).toBe(true);
  expect(emitSound("ping", {}, null)).toBe(false);
  expect(getActiveEngine()).toBeNull();
  const engine = createSoundEngine({ win, doc: null, AudioContextClass: FakeContextClass });
  setActiveEngine(engine);
  expect(getActiveEngine()).toBe(engine);
  engine.dispose();
});

test("Halloween-Palette: jedes Instrument baut einen endlichen Graph mit Start und Stopp, alles hängt am Ziel", () => {
  const ctx = fakeAudioContext();
  const dest = ctx.createGain();
  Object.entries(instruments).forEach(([name, play]) => {
    const before = ctx.log.nodes.length;
    play(ctx, dest, { noise: noiseBuffer });
    const created = ctx.log.nodes.length - before;
    expect(created, name).toBeGreaterThanOrEqual(2);
    expect(created, name).toBeLessThan(80);
  });
  expect(ctx.log.starts).toBeGreaterThan(20);
  expect(ctx.log.stops).toBe(ctx.log.starts);
  expect(ctx.log.connections).toBeGreaterThan(ctx.log.starts);
  expect(Object.keys(instruments).sort()).toEqual(["bat_scare", "cat_walk", "ghost", "grave", "hiss", "lantern", "pumpkin", "scare_hit", "web_fly", "web_grab", "web_tear", "whisper"]);
});

test("Halloween-Musik: Drone und Wind laufen, bei Nacht kommen gewürfelte Glocken und ein Herzschlag, am Tag nicht; stop räumt", () => {
  const ctx = fakeAudioContext();
  const dest = ctx.createGain();
  const timers = [];
  const rolls = [0.5, 0.5, 0.5, 0.2, 0.9, 0.1, 0.5, 0.3];
  let i = 0;
  const rng = () => rolls[i++ % rolls.length];
  const night = music(ctx, dest, { noise: noiseBuffer, night: true, rng, interval: (fn) => { timers.push(fn); return 1; }, clear: vi.fn() });
  expect(ctx.log.nodes.filter((n) => n.kind === "osc").length).toBeGreaterThanOrEqual(4);
  expect(ctx.log.nodes.filter((n) => n.kind === "source").length).toBe(1);
  expect(night.scheduled).toEqual([]);
  ctx.currentTime = 60;
  timers[0]();
  expect(night.scheduled.some((entry) => entry.kind === "bell")).toBe(true);
  expect(night.scheduled.some((entry) => entry.kind === "heart")).toBe(true);
  expect(night.scheduled.filter((entry) => entry.kind === "bell").every((entry) => BELL_NOTES.includes(entry.freq))).toBe(true);
  const stopsBefore = ctx.log.stops;
  night.stop();
  expect(ctx.log.stops).toBeGreaterThan(stopsBefore);
  const day = music(fakeAudioContext(), dest, { noise: noiseBuffer, night: false, rng, interval: (fn) => { fn(); return 2; }, clear: vi.fn() });
  expect(day.scheduled).toEqual([]);
  day.stop();
  const set = palette({ night: false });
  expect(set.key).toBe("halloween");
  expect(set.instruments).toBe(instruments);
  const quiet = set.music(fakeAudioContext(), dest, { noise: noiseBuffer, interval: (fn) => { fn(); return 3; }, clear: vi.fn() });
  expect(quiet.scheduled).toEqual([]);
  quiet.stop();
});
