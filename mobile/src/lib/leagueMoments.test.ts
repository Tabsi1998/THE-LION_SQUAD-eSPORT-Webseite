import * as SecureStore from "expo-secure-store";
import {
  MAX_DONE_MARKS, MOMENT_MARKS_KEY, clearMomentMarks, crestTier, forgetMomentDone, isLeagueMoment, markMomentDone, momentToken, momentsDoneHere,
  planCeremonies, type LeagueMoment,
} from "./leagueMoments";

// Saisonende-Moment in der App (#2584, docs/LIGA.md F.8, Web: moment/momentPackage.js und lib/momentMarks.js): Geräte-Schlüssel je
// Gerät und Konto, Marken für „fertig, aber noch nicht beim Server“ und die Reihenfolge der Zeremonien - Meister, Aufstieg, Abstieg
// vor den Belohnungen; was der Meister mitbringt, kommt nie ein zweites Mal als eigene Zeremonie.

const texts = { label: "Aufstieg", kicker: "Aufstieg", title: "Liga 1", name: "Löwen", meta: "CoD-Liga · Season 2", line: "Löwen steigt von Liga 2 in Liga 1 auf.", summary: "Löwen steigt von Liga 2 in Liga 1 auf.", aria: "Aufstieg: Löwen steigt von Liga 2 in Liga 1 auf." };
const moment = (id: string, extra: Partial<LeagueMoment> = {}): LeagueMoment => ({
  id, outcome: "up", season_id: "se2", title: "CoD-Liga · Season 2", url: "/liga/cod/season-2", texts, from: { level: 2 }, to: { level: 1 },
  badge_from: { level: 2, champion: false }, badge_to: { level: 1, champion: false }, rewards: [], ...extra,
});
const award = (id: string, tournament = "t1") => ({ id, kind: "trophy", tournament: { id: tournament }, reward: { kind: "medal", name: `Medaille ${id}` } });

describe("Geräte-Schlüssel je Gerät und Konto", () => {
  test("bleibt je Konto gleich und überlebt den Neustart (sicherer Speicher)", async () => {
    const first = await momentToken("u1");
    expect(first).toMatch(/^[A-Za-z0-9-]{8,80}$/);
    expect(await momentToken("u1")).toBe(first);
    expect(await SecureStore.getItemAsync(MOMENT_MARKS_KEY)).toContain(first);
    expect(await momentToken("u2")).not.toBe(first);
  });

  test("zwei gleichzeitige Abrufe legen nur einen Schlüssel an", async () => {
    const [a, b] = await Promise.all([momentToken("u1"), momentToken("u1")]);
    expect(a).toBe(b);
  });

  test("Abmelden leert alle Marken - danach gibt es einen neuen Schlüssel", async () => {
    const before = await momentToken("u1");
    await markMomentDone("u1", "m1");
    await clearMomentMarks();
    expect(await SecureStore.getItemAsync(MOMENT_MARKS_KEY)).toBeNull();
    expect(await momentsDoneHere("u1")).toEqual([]);
    expect(await momentToken("u1")).not.toBe(before);
  });

  test("kaputter Speicher zählt als leer", async () => {
    await SecureStore.setItemAsync(MOMENT_MARKS_KEY, "{kaputt");
    expect(await momentsDoneHere("u1")).toEqual([]);
    expect(await momentToken("u1")).toMatch(/^[A-Za-z0-9-]{8,80}$/);
  });
});

describe("fertig, aber noch nicht beim Server", () => {
  test("je Konto: die Marke von u1 gilt für u2 nicht", async () => {
    await markMomentDone("u1", "m1");
    expect(await momentsDoneHere("u1")).toEqual(["m1"]);
    expect(await momentsDoneHere("u2")).toEqual([]);
    await forgetMomentDone("u1", "m1");
    expect(await momentsDoneHere("u1")).toEqual([]);
  });

  test("doppelt gemerkt zählt einmal, höchstens MAX_DONE_MARKS (die ältesten gehen)", async () => {
    await markMomentDone("u1", "m1");
    await markMomentDone("u1", "m1");
    expect(await momentsDoneHere("u1")).toEqual(["m1"]);
    for (let index = 2; index <= MAX_DONE_MARKS + 3; index += 1) await markMomentDone("u1", `m${index}`);
    const done = await momentsDoneHere("u1");
    expect(done).toHaveLength(MAX_DONE_MARKS);
    expect(done).not.toContain("m1");
    expect(done).toContain(`m${MAX_DONE_MARKS + 3}`);
  });
});

describe("planCeremonies: Reihenfolge und Einmaligkeit", () => {
  test("Momente in der Reihenfolge des Servers vor den Belohnungen; was der Meister mitbringt, kommt nicht noch einmal", () => {
    const queued = new Set<string>();
    const champion = moment("c", { outcome: "champion", rewards: [award("r1") as never, { id: "leer" } as never] });
    const plan = planCeremonies([champion, moment("u")], [award("r1") as never, award("r2", "t2") as never], { queued, doneHere: new Set() });
    expect(plan.items.map((item) => item.key)).toEqual(["moment:c", "moment:u", "rewards:r2"]);
    expect(plan.items[0]).toMatchObject({ kind: "moment", rewards: [{ id: "r1" }] });
    expect(plan.reportDone).toEqual([]);
    // Ein zweiter Abruf reiht nichts doppelt ein.
    const again = planCeremonies([champion, moment("u")], [award("r1") as never, award("r2", "t2") as never], { queued, doneHere: new Set() });
    expect(again.items).toEqual([]);
  });

  test("auf diesem Gerät schon geschlossen: still nachmelden, nicht noch einmal zeigen", () => {
    const plan = planCeremonies([moment("m1"), moment("m2")], [], { queued: new Set(), doneHere: new Set(["m1"]) });
    expect(plan.items.map((item) => item.key)).toEqual(["moment:m2"]);
    expect(plan.reportDone).toEqual(["m1"]);
  });

  test("ohne Texte oder Kennung, mit fremdem Ausgang: kein Moment", () => {
    const plan = planCeremonies([
      moment("ohne", { texts: undefined }), { ...moment("x"), id: "" }, moment("seltsam", { outcome: "bleibt" as never }), null as never,
    ], [], { queued: new Set(), doneHere: new Set() });
    expect(plan.items).toEqual([]);
    expect(isLeagueMoment(moment("ok"))).toBe(true);
  });
});

test("Stufe des Wappens wie das Liga-Abzeichen: Liga 1 mit Krone, Liga 2 doppelter Rand, ab Liga 3 schlicht", () => {
  expect(crestTier(1)).toBe("top");
  expect(crestTier(2)).toBe("mid");
  expect(crestTier(3)).toBe("base");
  expect(crestTier(12)).toBe("base");
  expect(crestTier(0)).toBeNull();
  expect(crestTier(null)).toBeNull();
  expect(crestTier("2" as never)).toBe("mid");
});
