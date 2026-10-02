import { PHONE_CAT_SIZE, catSpot, phoneCatTarget } from "./catSpot";

// Die Katze am Handy (Rückmeldung 02.10.2026): sie sucht sich auf dem Strich eine Stelle, über der kein Text, Link
// oder Symbol liegt, und läuft nur in diesem freien Stück; ohne Platz bleibt sie weg.

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const slot = rect(16, 500, 358, 0);
const line = rect(16, 600, 358, 1);

test("ohne Hindernis bleibt sie an ihrer Stelle; das freie Stück ist der ganze Strich", () => {
  const spot = catSpot({ line, slot, blockers: [], size: PHONE_CAT_SIZE, startX: 60 });
  expect(spot.x).toBe(60);
  expect(spot.min).toBe(8);
  expect(spot.max).toBeGreaterThan(280);
});

test("Text über dem Strich sperrt: sie rückt ins nächste freie Stück, nie darunter", () => {
  // Ein Link sitzt links über dem Strich (x 16…216 im Fenster) - die Katze wollte bei 40 sitzen.
  const blockers = [rect(16, 560, 200, 30)];
  const spot = catSpot({ line, slot, blockers, size: PHONE_CAT_SIZE, startX: 40 });
  expect(spot.x + slot.left).toBeGreaterThanOrEqual(216 - 2);
  expect(spot.min + slot.left).toBeGreaterThanOrEqual(214);
  // Etwas weit über ihr (oberhalb ihrer Höhe) stört nicht.
  expect(catSpot({ line, slot, blockers: [rect(16, 400, 200, 30)], size: PHONE_CAT_SIZE, startX: 40 }).x).toBe(40);
});

test("überall Text: dann bleibt sie weg; ohne Strich oder Platz ebenso", () => {
  expect(catSpot({ line, slot, blockers: [rect(0, 560, 400, 30)], size: PHONE_CAT_SIZE, startX: 40 })).toBeNull();
  expect(catSpot({ line: null, slot, blockers: [], size: 52 })).toBeNull();
  expect(catSpot({ line, slot: rect(0, 0, 0, 0), blockers: [], size: 52 })).toBeNull();
});

test("laufen nur im freien Stück, mindestens 40 px weit - sonst sitzen bleiben", () => {
  const spot = { x: 100, min: 80, max: 260 };
  for (let i = 0; i < 20; i += 1) {
    const target = phoneCatTarget(100, spot, () => i / 20);
    expect(target).toBeGreaterThanOrEqual(80);
    expect(target).toBeLessThanOrEqual(260);
    expect(Math.abs(target - 100)).toBeGreaterThanOrEqual(40);
  }
  expect(phoneCatTarget(100, { x: 100, min: 90, max: 110 })).toBe(100);
  expect(phoneCatTarget(100, null)).toBe(100);
});
