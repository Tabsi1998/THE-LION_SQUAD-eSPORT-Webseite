// Jahreszeiten in der TV-Kopfleiste (#1114): welche Deko je Jahreszeit, nur eine gleichzeitig, leise.
import { TV_DECO_BY_SEASON, TV_DECO_LABELS, decoParticles, tvDecoFor } from "./tvSeasonDeco";

const season = (key, effective = "normal") => ({ key, effective });

test("je Jahreszeit eine Deko - Schnee im Winter, Fledermäuse zu Halloween", () => {
  expect(tvDecoFor([season("snow")])).toEqual({ kind: "snow", season: "snow", subtle: false });
  expect(tvDecoFor([season("halloween")])?.kind).toBe("bats");
  expect(tvDecoFor([season("christmas")])?.kind).toBe("stars");
  expect(tvDecoFor([season("new_year")])?.kind).toBe("sparks");
  expect(tvDecoFor([season("carnival")])?.kind).toBe("confetti");
  expect(tvDecoFor([season("club_birthday")])?.kind).toBe("confetti");
  expect(tvDecoFor([season("easter")])?.kind).toBe("petals");
  expect(tvDecoFor([season("advent")])?.kind).toBe("candles");
  expect(tvDecoFor([season("nikolaus")])?.kind).toBe("snow");
  for (const kind of Object.values(TV_DECO_BY_SEASON)) expect(TV_DECO_LABELS[kind]).toBeTruthy();
});

test("ohne laufende Jahreszeit oder nur Wetter, Kalender, Eiersuche: keine Deko", () => {
  expect(tvDecoFor([])).toBeNull();
  expect(tvDecoFor(undefined)).toBeNull();
  expect(tvDecoFor([season("weather"), season("advent_calendar"), season("easter_hunt")])).toBeNull();
  expect(tvDecoFor([season("snow", "off")])).toBeNull();
});

test("immer nur eine: der besondere Tag vor der langen Zeit", () => {
  expect(tvDecoFor([season("snow"), season("advent"), season("christmas")])?.season).toBe("christmas");
  expect(tvDecoFor([season("snow"), season("advent")])?.season).toBe("snow");
  expect(tvDecoFor([season("snow"), season("new_year")])?.season).toBe("new_year");
});

test("leise: wenige Teilchen, „dezent“ halbiert, gleiches Bild nach dem Neuladen", () => {
  const normal = decoParticles("snow");
  const subtle = decoParticles("snow", { subtle: true });
  expect(normal.length).toBeLessThanOrEqual(16);
  expect(subtle.length).toBe(Math.ceil(normal.length / 2));
  expect(tvDecoFor([season("snow", "subtle")])?.subtle).toBe(true);
  expect(decoParticles("snow")).toEqual(normal);
  for (const particle of normal) {
    expect(particle.left).toBeGreaterThanOrEqual(0);
    expect(particle.left).toBeLessThanOrEqual(100);
    expect(particle.top).toBeGreaterThanOrEqual(0);
    expect(particle.top).toBeLessThanOrEqual(100);
    // Langsam: mindestens 14 Sekunden je Weg.
    expect(particle.duration).toBeGreaterThanOrEqual(14);
  }
  expect(decoParticles("gibt-es-nicht")).toEqual([]);
});
