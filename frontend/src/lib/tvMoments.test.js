// Momente am TV (#1110, #1118): immer nur einer gleichzeitig, Champion und Ergebnis vor dem Start-Zoom, Sponsor und
// Zahlen warten; Ergebnisse nacheinander, mehr als drei auf einmal als Sammelkarte; ein alter Start-Zoom fällt weg.
import { COLLECT_AFTER, MOMENT_MAX_WAIT_MS, MOMENT_PRIORITY, createMomentQueue } from "./tvMoments";

function queue() {
  let clock = 0;
  const instance = createMomentQueue({ now: () => clock });
  return { instance, tick: (ms) => { clock += ms; } };
}

test("immer nur ein Moment: der nächste kommt erst, wenn der laufende fertig ist", () => {
  const { instance } = queue();
  instance.enqueue({ type: "result", items: ["m1"] });
  instance.enqueue({ type: "result", items: ["m2"] });
  const first = instance.next();
  expect(first.items).toEqual(["m1"]);
  expect(instance.next()).toBe(first);
  expect(instance.finish("falsche-id")).toBe(false);
  expect(instance.finish(first.id)).toBe(true);
  expect(instance.next().items).toEqual(["m2"]);
});

test("Champion und Ergebnis gehen vor, der Start-Zoom kommt danach, Sponsor und Zahlen warten bis zuletzt", () => {
  const { instance } = queue();
  instance.enqueue({ type: "sponsor", sponsorId: "sp1" });
  instance.enqueue({ type: "live", matchIds: ["m3"] });
  instance.enqueue({ type: "result", items: ["m1"] });
  instance.enqueue({ type: "champion", key: "gf:r1" });
  const order = [];
  for (let moment = instance.next(); moment; moment = instance.next()) {
    order.push(moment.type);
    instance.finish(moment.id);
  }
  expect(order).toEqual(["champion", "result", "live", "sponsor"]);
  expect(MOMENT_PRIORITY.champion).toBeGreaterThan(MOMENT_PRIORITY.result);
  expect(MOMENT_PRIORITY.stats).toBeLessThan(MOMENT_PRIORITY.live);
});

test("bis zu drei Ergebnisse nacheinander, mehr als drei auf einmal als eine Sammelkarte", () => {
  const { instance } = queue();
  for (const id of ["m1", "m2", "m3"]) instance.enqueue({ type: "result", items: [id] });
  expect(instance.getPending()).toHaveLength(3);
  instance.enqueue({ type: "result", items: ["m4"] });
  const pending = instance.getPending();
  expect(pending).toHaveLength(1);
  expect(pending[0].items).toEqual(["m1", "m2", "m3", "m4"]);
  expect(COLLECT_AFTER).toBe(3);
  // Läuft schon ein Ergebnis, zählen nur die wartenden: zwei wartende bleiben einzeln.
  const other = queue().instance;
  other.enqueue({ type: "result", items: ["a"] });
  other.next();
  other.enqueue({ type: "result", items: ["b"] });
  other.enqueue({ type: "result", items: ["c"] });
  expect(other.getPending().map((entry) => entry.items)).toEqual([["b"], ["c"]]);
});

test("Starts, solange der Zoom noch wartet, werden ein Zoom; ein zu alter Zoom fällt weg", () => {
  const { instance, tick } = queue();
  instance.enqueue({ type: "result", items: ["m1"] });
  instance.next();
  instance.enqueue({ type: "live", matchIds: ["m2"] });
  instance.enqueue({ type: "live", matchIds: ["m3", "m2"] });
  expect(instance.getPending()).toHaveLength(1);
  expect(instance.getPending()[0].matchIds).toEqual(["m2", "m3"]);
  tick(MOMENT_MAX_WAIT_MS.live + 1);
  instance.finish(instance.getCurrent().id);
  expect(instance.next()).toBeNull();
  // Wartende lassen sich gezielt entfernen (Spiel läuft nicht mehr).
  instance.enqueue({ type: "live", matchIds: ["m9"] });
  instance.drop((entry) => entry.type === "live");
  expect(instance.getPending()).toEqual([]);
});

test("der Speicher meldet jede Änderung", () => {
  const { instance } = queue();
  const seen = [];
  const stop = instance.subscribe(() => seen.push(instance.getVersion()));
  instance.enqueue({ type: "result", items: ["m1"] });
  instance.next();
  instance.clear();
  stop();
  instance.enqueue({ type: "result", items: ["m2"] });
  expect(seen).toEqual([1, 2, 3]);
  expect(instance.enqueue({})).toBeNull();
});

test("Sponsor und Zahlen machen Platz: kommt ein Ergebnis, weicht der leise Moment und kommt danach noch einmal ganz", () => {
  const { instance } = queue();
  instance.enqueue({ type: "sponsor", ms: 6000 });
  const sponsor = instance.next();
  expect(sponsor.type).toBe("sponsor");
  instance.enqueue({ type: "result", items: ["m1"] });
  expect(instance.getCurrent()).toBeNull();
  const result = instance.next();
  expect(result.type).toBe("result");
  instance.finish(result.id);
  const again = instance.next();
  expect(again.id).toBe(sponsor.id);
  expect(again.yielded).toBe(1);
  // Ein gleich wichtiger leiser Moment drängelt nicht: die Zahlen warten hinter dem Sponsor.
  instance.enqueue({ type: "stats", ms: 8000 });
  expect(instance.getCurrent().id).toBe(sponsor.id);
});

test("die neue Bestzeit am Fast-Lap-TV zählt wie ein Ergebnis - vor dem Sponsor", () => {
  const { instance } = queue();
  instance.enqueue({ type: "sponsor" });
  instance.enqueue({ type: "best", userId: "u5" });
  expect(instance.next().type).toBe("best");
  expect(MOMENT_PRIORITY.best).toBe(MOMENT_PRIORITY.result);
});
