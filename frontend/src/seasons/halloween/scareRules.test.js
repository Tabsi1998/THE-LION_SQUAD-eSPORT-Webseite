import { FIGURES, FRAMES, MIN_SECONDS_AFTER_LOAD, SCARE_STORAGE, SKIP_FIRST_VISITS, VARIANTS, buildVariants, dayKey, markScared, noteVisit, pageState, pickVariant, readScareState, scareDuration, setScaresDisabled, shouldScare } from "./scareRules";

// Jumpscares (#680): die Regeln entscheiden ohne Browser; die Varianten sind viele, kuratiert und nie zweimal dieselbe Figur.

const T0 = Date.parse("2026-10-30T20:00:00Z");

function env(overrides = {}) {
  return { allowed: true, disabled: false, reducedMotion: false, soundsOn: true, quiet: false, inputFocused: false, mediaPlaying: false, visits: 3, lastDay: null, today: "2026-10-30", loadedAt: T0 - 60000, ...overrides };
}

afterEach(() => {
  Object.values(SCARE_STORAGE).forEach((key) => localStorage.removeItem(key));
});

test("rund 130 Varianten aus Figur, Auftritt, Klang und Rahmen - kuratiert: die Katze fällt nicht von oben, die Spinne steigt nicht auf", () => {
  expect(VARIANTS.length).toBeGreaterThanOrEqual(100);
  expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(VARIANTS.length);
  expect(buildVariants()).toEqual(VARIANTS);
  expect(VARIANTS.some((v) => v.figure === "cat" && v.entrance === "drop")).toBe(false);
  expect(VARIANTS.some((v) => v.figure === "spider" && v.entrance === "rise")).toBe(false);
  expect(new Set(VARIANTS.map((v) => v.frame))).toEqual(new Set(FRAMES));
  expect(Object.keys(FIGURES).length).toBe(6);
});

test("Würfeln: nachts alle Figuren, tagsüber nur die milden, nie dieselbe Figur zweimal hintereinander", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(pickVariant(() => i / 200, { night: true }).figure);
  expect(seen).toEqual(new Set(Object.keys(FIGURES)));
  const day = new Set();
  for (let i = 0; i < 200; i += 1) day.add(pickVariant(() => i / 200, { night: false }).figure);
  expect(day).toEqual(new Set(["cat", "shadow"]));
  for (let i = 0; i < 200; i += 1) expect(pickVariant(() => i / 200, { night: true, lastFigure: "ghost" }).figure).not.toBe("ghost");
  expect(scareDuration(() => 0)).toBe(900);
  expect(scareDuration(() => 1)).toBe(1800);
});

test("Regeln: jede Sperre nennt ihren Grund, am Ende darf es losgehen", () => {
  expect(shouldScare(env({ allowed: false }), T0)).toEqual({ ok: false, reason: "age" });
  expect(shouldScare(env({ disabled: true }), T0).reason).toBe("off");
  expect(shouldScare(env({ reducedMotion: true }), T0).reason).toBe("motion");
  expect(shouldScare(env({ soundsOn: false }), T0).reason).toBe("mute");
  expect(shouldScare(env({ quiet: true }), T0).reason).toBe("quiet");
  expect(shouldScare(env({ inputFocused: true }), T0).reason).toBe("input");
  expect(shouldScare(env({ mediaPlaying: true }), T0).reason).toBe("media");
  expect(shouldScare(env({ visits: SKIP_FIRST_VISITS }), T0).reason).toBe("warmup");
  expect(shouldScare(env({ lastDay: "2026-10-30" }), T0).reason).toBe("today");
  expect(shouldScare(env({ loadedAt: T0 - (MIN_SECONDS_AFTER_LOAD - 1) * 1000 }), T0).reason).toBe("early");
  expect(shouldScare(env(), T0)).toEqual({ ok: true, reason: "go" });
  expect(shouldScare(env({ lastDay: "2026-10-29" }), T0).ok).toBe(true);
});

test("Speicher: Besuche zählen einmal je Tag, der Schreck merkt sich den Tag, aus bleibt aus", () => {
  expect(readScareState(localStorage, "2026-10-30")).toEqual({ disabled: false, lastDay: null, visits: 0 });
  expect(noteVisit(localStorage, "2026-10-30")).toBe(1);
  expect(noteVisit(localStorage, "2026-10-30")).toBe(1);
  expect(noteVisit(localStorage, "2026-10-31")).toBe(2);
  markScared(localStorage, "2026-10-31");
  expect(readScareState(localStorage, "2026-10-31")).toMatchObject({ lastDay: "2026-10-31", visits: 2, visitedToday: true });
  setScaresDisabled(localStorage, true);
  expect(readScareState(localStorage, "2026-10-31").disabled).toBe(true);
  setScaresDisabled(localStorage, false);
  expect(readScareState(localStorage, "2026-10-31").disabled).toBe(false);
  expect(dayKey(T0)).toBe("2026-10-30");
  expect(readScareState({ getItem: () => { throw new Error("nein"); } }, "x")).toEqual({ disabled: false, lastDay: null, visits: 0 });
});

test("Seite: Eingabefeld im Fokus oder laufendes Video sperren", () => {
  expect(pageState(document)).toEqual({ inputFocused: false, mediaPlaying: false });
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  expect(pageState(document).inputFocused).toBe(true);
  input.remove();
  const iframe = document.createElement("iframe");
  iframe.src = "https://player.twitch.tv/?channel=lions";
  document.body.appendChild(iframe);
  expect(pageState(document).mediaPlaying).toBe(true);
  iframe.remove();
  expect(pageState(null)).toEqual({ inputFocused: false, mediaPlaying: false });
});
