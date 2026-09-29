import { MATERIAL_SOUND_KEYS, SPECIAL_SOUND_KEYS, playCeremonySound, readSoundPrefs, resetAudioContext, writeSoundPrefs } from "./sounds";

// Klangsets (E8): neun Material-Sets, sieben Sonderabläufe, Lautstärke und „Ton aus“ aus dem Profil,
// nichts ohne Geste, nichts bei stumm.

function fakeAudio() {
  const nodes = [];
  const node = (extra = {}) => {
    const n = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), ...extra };
    nodes.push(n);
    return n;
  };
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), value: 0 });
  class AC {
    constructor() { this.state = "running"; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    createOscillator() { return node({ frequency: param(), type: "sine" }); }
    createGain() { return node({ gain: param() }); }
    createBufferSource() { return node({ buffer: null }); }
    createBiquadFilter() { return node({ frequency: param(), Q: { value: 1 }, type: "bandpass" }); }
    createBuffer(_c, length) { return { getChannelData: () => new Float32Array(length) }; }
    resume() { return Promise.resolve(); }
  }
  return { AC, nodes };
}

beforeEach(() => { localStorage.clear(); resetAudioContext(); });

describe("ceremony sounds", () => {
  it("hat neun Material-Sets und sieben Sonderabläufe", () => {
    expect(MATERIAL_SOUND_KEYS).toEqual(["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]);
    expect(SPECIAL_SOUND_KEYS).toEqual(["first", "stack", "group", "category", "diamond", "legendary", "levelup"]);
  });

  it("spielt jedes Set und jeden Sonderablauf ohne Fehler und mit Lautstärke aus dem Profil", () => {
    const { AC, nodes } = fakeAudio();
    const win = { AudioContext: AC };
    const nav = { userActivation: { hasBeenActive: true } };
    for (const material of MATERIAL_SOUND_KEYS) expect(playCeremonySound({ material }, { win, nav })).toBe(true);
    for (const special of SPECIAL_SOUND_KEYS) expect(playCeremonySound({ material: "gold", special }, { win, nav })).toBe(true);
    expect(nodes.length).toBeGreaterThan(50);
    const before = nodes.length;
    expect(playCeremonySound({ material: "silver" }, { win, nav, user: { ceremony_volume: 25 } })).toBe(true);
    const master = nodes.slice(before).find((n) => n.gain && n.gain.setValueAtTime.mock.calls.some(([v]) => Math.abs(v - 0.225) < 0.001));
    expect(master).toBeTruthy();
  });

  it("bleibt still ohne Geste, bei stumm und bei „Ton aus“ im Profil", () => {
    const { AC, nodes } = fakeAudio();
    const win = { AudioContext: AC };
    expect(playCeremonySound({ material: "gold" }, { win, nav: { userActivation: { hasBeenActive: false } } })).toBe(false);
    writeSoundPrefs({ muted: true });
    expect(playCeremonySound({ material: "gold" }, { win, nav: {} })).toBe(false);
    writeSoundPrefs({ muted: false, volume: 40 });
    expect(readSoundPrefs()).toEqual({ muted: false, volume: 40 });
    expect(playCeremonySound({ material: "gold" }, { win, nav: {}, user: { ceremony_sound: false } })).toBe(false);
    expect(readSoundPrefs({ ceremony_sound: false, ceremony_volume: 70 })).toEqual({ muted: true, volume: 70 });
    expect(nodes.length).toBe(0);
    expect(playCeremonySound({ material: "gold" }, { win: {}, nav: {} })).toBe(false);
  });
});
