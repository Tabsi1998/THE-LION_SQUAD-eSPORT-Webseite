// Ton beim Ergebnis (#1118): ohne Klick auf die Seite kein Ton (der Browser erlaubt ihn nicht), ohne Web Audio still,
// nach dem Klick ein Gong aus drei Tönen.
import { GONG_PARTIALS, createGong, pageActivated } from "./tvGong";

class FakeParam {
  constructor() {
    this.value = 0;
    this.calls = [];
  }

  setValueAtTime(value, time) { this.calls.push(["set", value, time]); }

  exponentialRampToValueAtTime(value, time) { this.calls.push(["ramp", value, time]); }
}

class FakeNode {
  constructor() {
    this.frequency = new FakeParam();
    this.gain = new FakeParam();
    this.started = null;
    this.stopped = null;
  }

  connect(target) { this.target = target; }

  start(time) { this.started = time; }

  stop(time) { this.stopped = time; }
}

function fakeWindow() {
  const made = [];
  class FakeAudioContext {
    constructor(options = {}) {
      this.options = options;
      this.state = "suspended";
      this.currentTime = 10;
      this.destination = { name: "Lautsprecher" };
      made.push(this);
    }

    async resume() { this.state = "running"; }

    createOscillator() { const node = new FakeNode(); this.oscillators = [...(this.oscillators || []), node]; return node; }

    createGain() { return new FakeNode(); }
  }
  return { win: { AudioContext: FakeAudioContext }, made };
}

test("vor dem Klick kein Ton und kein Klang-Baukasten; danach ein Gong aus drei Tönen", async () => {
  const { win, made } = fakeWindow();
  const gong = createGong({ win });
  expect(gong.supported).toBe(true);
  expect(gong.play()).toBe(false);
  expect(made).toHaveLength(0);
  expect(await gong.unlock()).toBe(true);
  expect(gong.running()).toBe(true);
  expect(gong.play()).toBe(true);
  expect(made[0].oscillators).toHaveLength(GONG_PARTIALS.length);
  expect(made[0].oscillators[0].frequency.value).toBeCloseTo(523.25);
  // Der Ton klingt aus: am Ende ist jede Stimme still.
  expect(made[0].oscillators.every((node) => node.stopped > node.started)).toBe(true);
});

test("ohne Web Audio bleibt der TV still - und es fällt nichts um", async () => {
  const gong = createGong({ win: {} });
  expect(gong.supported).toBe(false);
  expect(await gong.unlock()).toBe(false);
  expect(gong.play()).toBe(false);
  expect(createGong({ win: null }).play()).toBe(false);
});

test("hat schon jemand auf die Seite geklickt?", () => {
  expect(pageActivated({ userActivation: { hasBeenActive: true } })).toBe(true);
  expect(pageActivated({ userActivation: { hasBeenActive: false } })).toBe(false);
  expect(pageActivated({})).toBe(false);
  expect(pageActivated(null)).toBe(false);
});
