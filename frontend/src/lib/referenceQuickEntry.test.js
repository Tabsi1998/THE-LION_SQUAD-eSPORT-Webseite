import { describe, expect, test } from "vitest";
import { anyPlacement, countKey, hasMoreDetails, lastReference, likeLastTime, quickDate, quickStatus } from "./referenceQuickEntry";

// Schnell-Eintrag (#1936): Vorgaben für ein Tagesturnier und wann „Weitere Angaben“ offen stehen.

const TODAY = "2026-10-21";
const BASE = {
  title: "Probe Cup", organizer: "", partner_ids: [], league: "", season: "", format: "", platforms: [], game_id: "g1", game_name: "",
  start_date: "2026-10-18", end_date: "2026-10-18", location: "", mode: "online", external_url: "", bracket_url: "", match_url: "",
  result_url: "", description: "", highlights: "", visibility: "public", status: "completed", is_active: true, order_index: 0, series_id: "",
  entries: [{ kind: "team", team_name: "THE LION SQUAD", member_profile_ids: ["p1"], lineup_text: "", placement: "3", placement_label: "", participant_count: "", team_count: "12" }],
};

describe("quickStatus", () => {
  test("vorbei heißt abgeschlossen, in der Zukunft geplant, ohne Datum abgeschlossen", () => {
    expect(quickStatus("2026-10-18", "", TODAY)).toBe("completed");
    expect(quickStatus("2026-11-02", "", TODAY)).toBe("planned");
    expect(quickStatus("", "", TODAY)).toBe("completed");
  });
  test("heute: mit Platz abgeschlossen, sonst laufend", () => {
    expect(quickStatus(TODAY, "", TODAY)).toBe("active");
    expect(quickStatus(TODAY, "2", TODAY)).toBe("completed");
  });
});

describe("quickDate", () => {
  test("ein Tag: das Ende folgt dem Start, solange es leer oder gleich war", () => {
    expect(quickDate({ start_date: "", end_date: "" }, "2026-10-18")).toEqual({ start_date: "2026-10-18", end_date: "2026-10-18" });
    expect(quickDate({ start_date: "2026-10-18", end_date: "2026-10-18" }, "2026-10-19")).toEqual({ start_date: "2026-10-19", end_date: "2026-10-19" });
  });
  test("ein eigenes Ende (mehrtägig) bleibt", () => {
    expect(quickDate({ start_date: "2026-10-18", end_date: "2026-10-20" }, "2026-10-17")).toEqual({ start_date: "2026-10-17", end_date: "2026-10-20" });
  });
});

describe("countKey", () => {
  test("„von N“: Teams zählen Teams, Einzelstarter die Teilnehmer", () => {
    expect(countKey({ kind: "team", team_count: "", participant_count: "" })).toBe("team_count");
    expect(countKey({ kind: "solo", team_count: "", participant_count: "" })).toBe("participant_count");
  });
  test("eine alte Team-Zeile nur mit Teilnehmerzahl zeigt diese", () => {
    expect(countKey({ kind: "team", team_count: "", participant_count: 20 })).toBe("participant_count");
    expect(countKey({ kind: "team", team_count: 8, participant_count: 20 })).toBe("team_count");
  });
});

describe("hasMoreDetails", () => {
  test("ein Tagesturnier hat nichts unter „Weitere Angaben“", () => {
    expect(hasMoreDetails(BASE, TODAY)).toBe(false);
  });
  test.each([
    ["Veranstalter", { organizer: "Probe Verband" }],
    ["Partner", { partner_ids: ["x"] }],
    ["Liga", { league: "Liga A" }],
    ["Saison", { season: "2026" }],
    ["Format", { format: "HC" }],
    ["Plattform", { platforms: ["PC"] }],
    ["freier Spielname", { game_name: "Probespiel" }],
    ["mehrtägig", { end_date: "2026-10-19" }],
    ["Ort", { location: "Wien" }],
    ["Modus", { mode: "offline" }],
    ["weiterer Link", { bracket_url: "https://example.org" }],
    ["Beschreibung", { description: "Text" }],
    ["Highlights", { highlights: "Text" }],
    ["Sichtbarkeit", { visibility: "members" }],
    ["Status abweichend", { status: "archived" }],
    ["inaktiv", { is_active: false }],
    ["Reihenfolge", { order_index: 3 }],
    ["Saison-Verknüpfung", { series_id: "s1" }],
  ])("%s öffnet den Bereich", (_, patch) => {
    expect(hasMoreDetails({ ...BASE, ...patch }, TODAY)).toBe(true);
  });
  test("Angaben am Eintrag und weitere Einträge öffnen den Bereich", () => {
    const entry = BASE.entries[0];
    expect(hasMoreDetails({ ...BASE, entries: [{ ...entry, placement_label: "Podium" }] }, TODAY)).toBe(true);
    expect(hasMoreDetails({ ...BASE, entries: [{ ...entry, lineup_text: "Gast" }] }, TODAY)).toBe(true);
    expect(hasMoreDetails({ ...BASE, entries: [{ ...entry, participant_count: 40 }] }, TODAY)).toBe(true);
    expect(hasMoreDetails({ ...BASE, entries: [entry, { ...entry }] }, TODAY)).toBe(true);
  });
  test("der Link „Turnier-Webseite“ steht oben und zählt nicht", () => {
    expect(hasMoreDetails({ ...BASE, external_url: "https://example.org" }, TODAY)).toBe(false);
  });
});

describe("Wie letztes Mal", () => {
  const items = [
    { id: "a", created_at: "2026-09-01T10:00:00+00:00", game_id: "g1", organizer: "Alt", entries: [] },
    { id: "b", created_at: "2026-10-12T10:00:00+00:00", game_id: "g2", game_name: "", organizer: "Probe Verband",
      entries: [{ kind: "team", team_name: "Probe Löwen", member_profile_ids: ["p1", "p2"], lineup: ["Fremder Gast"], placement: 1 }] },
    { id: "c", entries: [] },
  ];
  test("die zuletzt angelegte Referenz", () => {
    expect(lastReference(items).id).toBe("b");
    expect(lastReference([])).toBeNull();
  });
  test("übernimmt Spiel, Veranstalter und Teamname - keine Aufstellung, nicht Platz und Name", () => {
    const form = { ...BASE, title: "Neu", game_id: "", organizer: "", entries: [{ ...BASE.entries[0], member_profile_ids: [], lineup_text: "", placement: "", team_count: "" }] };
    const next = likeLastTime(form, items[1]);
    expect(next.title).toBe("Neu");
    expect(next.game_id).toBe("g2");
    expect(next.organizer).toBe("Probe Verband");
    expect(next.entries[0]).toEqual(expect.objectContaining({ kind: "team", team_name: "Probe Löwen", member_profile_ids: [], lineup_text: "", placement: "" }));
  });
  test("schon gewählte Spieler bleiben, ein Einzelstarter der letzten Referenz ändert den Eintrag nicht", () => {
    const form = { ...BASE, entries: [{ ...BASE.entries[0], member_profile_ids: ["p9"] }] };
    expect(likeLastTime(form, items[1]).entries[0].member_profile_ids).toEqual(["p9"]);
    const solo = { game_id: "g1", entries: [{ kind: "solo", member_profile_ids: ["p3"], lineup: ["Gast"] }] };
    expect(likeLastTime(form, solo).entries[0]).toEqual(form.entries[0]);
  });
});

describe("anyPlacement", () => {
  test("der Platz irgendeines Eintrags zählt", () => {
    expect(anyPlacement([{ placement: "" }, { placement: 5 }])).toBe(5);
    expect(anyPlacement([{ placement: "" }, {}])).toBe("");
    expect(anyPlacement(undefined)).toBe("");
  });
  test("heute mit Platz im zweiten Eintrag: abgeschlossen, kein Grund für „Weitere Angaben“ wegen des Status", () => {
    expect(quickStatus(TODAY, anyPlacement([{ placement: "" }, { placement: "2" }]), TODAY)).toBe("completed");
    const form = { ...BASE, start_date: TODAY, end_date: TODAY, entries: [{ ...BASE.entries[0], placement: "" }] };
    expect(hasMoreDetails({ ...form, status: "active" }, TODAY)).toBe(false);
  });
});
