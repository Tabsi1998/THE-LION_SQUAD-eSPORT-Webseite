import {
  emptyText, gapText, medalOf, mobileMain, mobileSub, movement, movementLabel, neighbourLabel, penaltyLabel, personLine,
  pickSession, posLabel, roundEyebrow, roundHeading, roundPath, roundSubline, rowBadges, sessionKey, summaryCards, timeText,
  visibleColumns,
} from "./roundResults";

// Ergebnistabelle je Runde (#1950): Reiter in der Adresse, Spalten ohne Leere, Abzeichen, Start → Ziel und eine
// Zusammenfassung, die fremde Namen nicht außerhalb der Tabelle zeigt. Nur erfundene Namen.

const row = (values) => ({ key: "k", place: 1, status: "finished", marks: [], ...values });

describe("Adresse und Reiter", () => {
  it("bildet den Schlüssel eines Laufs wie der Server", () => {
    expect(sessionKey("Qualifying")).toBe("qualifying");
    expect(sessionKey(" Lauf  1 ")).toBe("lauf-1");
    expect(sessionKey("Läufe & Übungen")).toBe("laeufe-uebungen");
    expect(sessionKey("")).toBe("rennen");
    expect(sessionKey(null)).toBe("rennen");
  });

  it("baut die Adresse der Runde, mit Lauf nur auf Wunsch", () => {
    expect(roundPath("probe-liga", "2026", 3)).toBe("/references/series/probe-liga/2026/runde/3");
    expect(roundPath("probe-liga", "2026", 3, "sprint")).toBe("/references/series/probe-liga/2026/runde/3?lauf=sprint");
    expect(roundPath("", "2026", 3)).toBe("");
    expect(roundPath("probe-liga", "2026", null)).toBe("");
  });

  it("zeigt den Lauf aus der Adresse, sonst das Hauptrennen", () => {
    const page = { main: "rennen", sessions: [{ key: "qualifying" }, { key: "sprint" }, { key: "rennen" }] };
    expect(pickSession(page, "sprint").key).toBe("sprint");
    expect(pickSession(page, "gibt-es-nicht").key).toBe("rennen");
    expect(pickSession(page, null).key).toBe("rennen");
    expect(pickSession({ sessions: [{ key: "a" }] }, null).key).toBe("a");
    expect(pickSession({}, "x")).toBeNull();
  });
});

describe("Zeilen", () => {
  it("Platz, Podium und Ausfall", () => {
    expect(posLabel(row({ place: 4 }))).toBe("4");
    expect(posLabel(row({ status: "dnf", place: null }))).toBe("DNF");
    expect(posLabel(row({ status: "dsq", place: 3 }))).toBe("DSQ");
    expect(medalOf(row({ place: 1 }))).toBe("gold");
    expect(medalOf(row({ place: 3 }))).toBe("bronze");
    expect(medalOf(row({ place: 4 }))).toBeNull();
    expect(medalOf(row({ place: 2, status: "dsq" }))).toBeNull();
  });

  it("Abzeichen: Pole, schnellste Runde, Fahrer des Tages, Ausfall und Strafsekunden", () => {
    const badges = rowBadges(row({ marks: ["pole"], fastest_lap: true, driver_of_the_day: true, status: "dnf", penalty_seconds: 2.5 }));
    expect(badges.map((badge) => badge.key)).toEqual(["pole", "fastest_lap", "driver_of_the_day", "dnf", "penalty"]);
    expect(badges.find((badge) => badge.key === "fastest_lap").short).toBe("Beste Runde");
    expect(badges.find((badge) => badge.key === "penalty").label).toBe("+2,5 s Strafe");
    expect(rowBadges(row({ penalty_seconds: 5 }), { penalty: false })).toEqual([]);
    expect(penaltyLabel(0)).toBe("");
    expect(penaltyLabel("x")).toBe("");
  });

  it("Start → Ziel in Worten", () => {
    expect(movement(row({ gained: 3 }))).toEqual({ dir: "up", by: 3 });
    expect(movement(row({ gained: -1 }))).toEqual({ dir: "down", by: 1 });
    expect(movement(row({ gained: 0 }))).toBeNull();
    expect(movement(row({ gained: null }))).toBeNull();
    expect(movementLabel({ dir: "up", by: 1 })).toBe("1 Platz gutgemacht");
    expect(movementLabel({ dir: "down", by: 2 })).toBe("2 Plätze verloren");
  });

  it("Zeit und Abstand - „+2 Runden“ und Ausfall als Wort", () => {
    expect(timeText(row({ time: "31:55,056" }))).toBe("31:55,056");
    expect(timeText(row({}))).toBe("–");
    expect(timeText(row({ gap: "+6,197" }))).toBe("");
    expect(gapText(row({ gap: "+2 Runden" }))).toBe("+2 Runden");
    expect(gapText(row({ status: "dnf" }))).toBe("Ausfall");
    expect(gapText(row({}))).toBe("");
    expect(mobileMain(row({ gap: "+6,197" }))).toBe("+6,197");
    expect(mobileMain(row({ status: "dnf" }))).toBe("Ausfall");
    expect(mobileSub(row({ time: "1:40,474", gap: "+0,261", points: 25 }), { points: true })).toBe("+0,261 · 25 P");
    expect(mobileSub(row({ gap: "+0,261", points: 12.5 }), { points: true })).toBe("12,5 P");
  });

  it("gespeichert mit Punkt, angezeigt mit Komma wie beim Veranstalter (#1981); Platzhalter beim Ersten ist kein Abstand", () => {
    expect(timeText(row({ time: "1:20.361" }))).toBe("1:20,361");
    expect(gapText(row({ gap: "+0.046" }))).toBe("+0,046");
    expect(gapText(row({ gap: "+1:34.878" }))).toBe("+1:34,878");
    expect(gapText(row({ gap: "+--:--,---" }))).toBe("");
    expect(mobileMain(row({ time: "31:55.056" }))).toBe("31:55,056");
    expect(mobileSub(row({ time: "1:40.474", gap: "+0.261" }))).toBe("+0,261");
  });

  it("Spalten ohne Zeiten: nur Pos, Name, Team und Punkte", () => {
    const race = { kind: "race", columns: ["points"], rows: [row({ team: "Fremd Rot" })] };
    expect(visibleColumns(race)).toEqual(["pos", "name", "team", "points"]);
    const full = { kind: "race", columns: ["start_number", "grid", "time", "gap", "penalty_seconds", "points"], rows: [row({ team: "A" })] };
    expect(visibleColumns(full)).toEqual(["pos", "number", "name", "team", "grid", "time", "gap", "penalty", "points"]);
    // Im Qualifying gibt es kein Start → Ziel.
    expect(visibleColumns({ kind: "qualifying", columns: ["grid", "time"], rows: [row({})] })).toEqual(["pos", "name", "time"]);
  });
});

describe("Zusammenfassung", () => {
  const page = {
    main: "rennen",
    club_drivers: ["eins"],
    summary: {
      winner: { key: "fremd", session: "rennen", grid: 3 },
      pole: { key: "eins", session: "qualifying", time: "1:40,474" },
      fastest_lap: { key: "eins", session: "rennen", time: "1:43,375" },
      driver_of_the_day: { key: "fremd", session: "rennen" },
    },
    sessions: [
      { key: "qualifying", label: "Qualifying", has_result: true, best_club: "eins", rows: [
        { key: "eins", name: "Probe Eins", team: "Probe Löwen", team_color: "#facc15", place: 1, status: "finished", club_member: true, profile_slug: "probe-eins" }] },
      { key: "rennen", label: "Rennen", has_result: true, best_club: "eins", rows: [
        { key: "fremd", name: "Fremd Zwei", team: "Fremd Rot", team_color: "#ef4444", place: 1, grid: 3, status: "finished", start_number: "98" },
        { key: "eins", name: "Probe Eins", team: "Probe Löwen", place: 2, status: "finished", points: 30, club_member: true, profile_slug: "probe-eins" }] },
    ],
  };

  it("fremde Namen nur in der Tabelle - außerhalb steht das Team", () => {
    const cards = summaryCards(page, page.sessions[1]);
    const by = Object.fromEntries(cards.map((card) => [card.key, card]));
    expect(by.winner).toMatchObject({ label: "Sieger", value: "Fremd Rot", named: false, sub: "von Startplatz 3", color: "#ef4444" });
    expect(by.pole).toMatchObject({ value: "Probe Eins", named: true, count: "1:40,474", team: "Probe Löwen" });
    expect(by.fastest_lap.count).toBe("1:43,375");
    expect(by.driver_of_the_day).toMatchObject({ value: "Fremd Rot", sub: "" });
    expect(by.best_club).toMatchObject({ label: "Bester Vereinsfahrer · Rennen", value: "Probe Eins · P2", sub: "Probe Löwen · 30 Punkte" });
    expect(JSON.stringify(cards)).not.toContain("Fremd Zwei");
  });

  it("ohne Team die Startnummer; ohne Daten keine Karte", () => {
    expect(personLine({ key: "x", name: "Fremd", start_number: "7" }, [])).toMatchObject({ value: "Nr. 7", named: false });
    expect(personLine({ key: "x", name: "Fremd" }, [])).toMatchObject({ value: "–" });
    expect(summaryCards({ sessions: [] }, null)).toEqual([]);
  });
});

describe("Kopf", () => {
  it("Land als Name, Strecke darunter, dazu Runde und Tag", () => {
    expect(roundHeading({ country_code: "AZ", venue: "Baku City Circuit" })).toEqual({ heading: "Aserbaidschan", sub: "Baku City Circuit" });
    expect(roundHeading({ country_code: "AZ", venue: "Aserbaidschan" })).toEqual({ heading: "Aserbaidschan", sub: "" });
    expect(roundHeading({ title: "Probe-GP", venue: "Probering" })).toEqual({ heading: "Probe-GP", sub: "Probering" });
    expect(roundHeading({ code: "R4" })).toEqual({ heading: "R4", sub: "" });
    expect(roundEyebrow({ number: 1, total: 24, club_day: "2026-10-08" })).toBe("Runde 1 von 24 · Do., 08.10.2026");
    expect(neighbourLabel({ number: 2, code: "R2", country_code: "SG" })).toBe("R2 Singapur");
    expect(neighbourLabel(null)).toBe("");
    expect(roundSubline({ code: "R1", club_day: "2026-10-08" }, "Baku City Circuit")).toBe("R1 · Do., 08.10.2026 · Baku City Circuit");
    expect(roundSubline({ number: 4 })).toBe("R4");
  });

  it("sagt, wann ein Ergebnis kommt", () => {
    expect(emptyText({ label: "Sprint", state: "planned", club_day: "2026-10-08", time: "20:30" })).toBe("Noch kein Ergebnis – Sprint am Do., 08.10.2026, 20:30 Uhr.");
    expect(emptyText({ label: "Rennen", state: "missing", club_day: "2026-10-08" })).toBe("Ergebnis folgt – Rennen am Do., 08.10.2026.");
    expect(emptyText({ label: "Rennen", state: "cancelled" })).toBe("Rennen abgesagt.");
    expect(emptyText(null)).toBe("Für diese Runde gibt es noch keine Läufe.");
  });
});
