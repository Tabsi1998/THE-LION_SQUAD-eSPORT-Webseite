import { describe, expect, it } from "vitest";
import { EMPTY_SANCTION_FORM, applyCatalog, applyKind, matchesOf, sanctionPayload, sanctionProblem } from "./leagueSanctions";
import { deductionText, standingNotes } from "./leagueTable";
import { standingsSections } from "./printView";

// Strafen im Wettbewerb (E.3): das Formular führt - es sagt, was fehlt, und schickt nur, was zur Art gehört.
const KINDS = [
  { key: "warning", label: "Verwarnung", targets: ["player", "squad"] },
  { key: "point_deduction", label: "Punktabzug", targets: ["squad"] },
  { key: "map_loss", label: "Mapverlust", targets: ["squad"], match: true },
  { key: "player_ban", label: "Spielsperre", targets: ["player"], ban: true, provisional: true },
  { key: "team_ban", label: "Teamsperre", targets: ["squad"], ban: true, provisional: true },
  { key: "external", label: "Externe Sperre", targets: ["player"], ban: true },
];
const BASE = { ...EMPTY_SANCTION_FORM, tournament_id: "t1", registration_id: "r1", rule_ref: "§ 13.1", reason: "Begründung der Leitung" };

describe("Formular „Strafe verhängen“", () => {
  it("nennt den ersten fehlenden Punkt als Satz", () => {
    expect(sanctionProblem(EMPTY_SANCTION_FORM, KINDS)).toBe("Bitte das Co-Team wählen.");
    expect(sanctionProblem({ ...BASE, rule_ref: " " }, KINDS)).toBe("Bitte den Regelverstoß nennen.");
    expect(sanctionProblem({ ...BASE, reason: "kurz" }, KINDS)).toMatch(/begründen/);
    expect(sanctionProblem(BASE, KINDS)).toBe("");
    expect(sanctionProblem({ ...BASE, kind: "map_loss" }, KINDS)).toMatch(/Spiel wählen/);
    expect(sanctionProblem({ ...BASE, kind: "player_ban", target_type: "player" }, KINDS)).toBe("Bitte die Person wählen.");
    expect(sanctionProblem({ ...BASE, kind: "player_ban", target_type: "player", user_id: "u1", matches: "0" }, KINDS)).toMatch(/mindestens ein Liga-Spiel/);
    expect(sanctionProblem({ ...BASE, kind: "team_ban", period: "until" }, KINDS)).toBe("Bitte das Ende der Sperre eintragen.");
    // Vorläufig braucht keinen Zeitraum, die externe Sperre kein Ende.
    expect(sanctionProblem({ ...BASE, kind: "team_ban", period: "until", provisional: true }, KINDS)).toBe("");
    expect(sanctionProblem({ ...BASE, kind: "external", target_type: "player", user_id: "u1", period: "until" }, KINDS)).toBe("");
    expect(sanctionProblem({ ...BASE, kind: "point_deduction", points: "0" }, KINDS)).toMatch(/Höhe/);
  });

  it("der Katalog füllt Art und Regelverstoß vor, die Art bestimmt das Ziel", () => {
    const entry = { key: "cheating", label: "Cheating", rule_ref: "Anlage C.4", kind: "player_ban" };
    const filled = applyCatalog({ ...BASE, provisional: true }, entry, KINDS);
    expect(filled).toMatchObject({ catalog_key: "cheating", kind: "player_ban", target_type: "player", rule_ref: "Cheating (Anlage C.4)", period: "matches" });
    // „Vorläufig“ fällt weg, wenn die Art es nicht kennt; das Ziel wechselt, wenn die Art nur ein Co-Team treffen kann.
    expect(applyKind(filled, "point_deduction", KINDS)).toMatchObject({ kind: "point_deduction", target_type: "squad", provisional: false });
    expect(applyKind({ ...BASE, target_type: "player" }, "warning", KINDS).target_type).toBe("player");
    expect(applyCatalog(filled, undefined, KINDS).catalog_key).toBe("");
  });

  it("schickt nur, was zur Art gehört - Spiele oder Ende, nie beides", () => {
    expect(sanctionPayload(BASE, KINDS)).toEqual({ kind: "warning", target_type: "squad", rule_ref: "§ 13.1", reason: "Begründung der Leitung", state: "final", registration_id: "r1" });
    const ban = { ...BASE, kind: "player_ban", target_type: "player", user_id: "u1", matches: "2", ends_at: "2026-12-01T18:00", period: "matches" };
    expect(sanctionPayload(ban, KINDS)).toMatchObject({ user_id: "u1", matches: 2, state: "final" });
    expect(sanctionPayload(ban, KINDS)).not.toHaveProperty("ends_at");
    const until = sanctionPayload({ ...ban, period: "until" }, KINDS);
    expect(until.ends_at).toBe("2026-12-01T17:00:00.000Z");
    expect(until).not.toHaveProperty("matches");
    const provisional = sanctionPayload({ ...ban, provisional: true }, KINDS);
    expect(provisional.state).toBe("provisional");
    expect(provisional).not.toHaveProperty("matches");
    // „Vorläufig“ an einer Art, die es nicht kennt, geht nie mit.
    expect(sanctionPayload({ ...BASE, provisional: true }, KINDS).state).toBe("final");
    expect(sanctionPayload({ ...BASE, kind: "point_deduction", points: "3" }, KINDS).points).toBe(3);
    // Nachweise nur zusammen mit dem Spiel.
    expect(sanctionPayload({ ...BASE, proof_ids: ["p1"] }, KINDS)).not.toHaveProperty("proof_ids");
    expect(sanctionPayload({ ...BASE, match_id: "m1", proof_ids: ["p1"] }, KINDS)).toMatchObject({ match_id: "m1", proof_ids: ["p1"] });
  });

  it("bietet nur die Spiele des gewählten Co-Teams an", () => {
    const target = { matches: [{ id: "m1", registration_ids: ["r1", "r2"] }, { id: "m2", registration_ids: ["r3", "r4"] }] };
    expect(matchesOf(target, "r1").map((row) => row.id)).toEqual(["m1"]);
    expect(matchesOf(target, "").length).toBe(2);
    expect(matchesOf(null, "r1")).toEqual([]);
  });
});

describe("Punktabzug in der Tabelle - Web, TV und Druck derselbe Satz", () => {
  it("nennt die Höhe, nie den Grund", () => {
    expect(deductionText({ deducted_points: 2 })).toBe("−2 Punkte Abzug");
    expect(deductionText({ deducted_points: 1 })).toBe("−1 Punkt Abzug");
    expect(deductionText({ deducted_points: 0 })).toBe("");
    expect(deductionText(null)).toBe("");
    expect(standingNotes({ deducted_points: 2 }).find((note) => note.key === "deducted").text).toBe("−2 Punkte Abzug");
    expect(standingNotes({ deducted_points: 0 }).some((note) => note.key === "deducted")).toBe(false);
  });

  it("steht auf Papier an der Zeile", () => {
    const row = (name, rank, extra = {}) => ({ registration_id: name, display_name: name, rank, played: 1, won: 1, drawn: 0, lost: 0, score_diff: 1, points: 3, ...extra });
    const [league] = standingsSections([row("Nordlicht", 1), row("Steinbock", 2, { deducted_points: 2 }), row("Eisfuchs", 3, { exit: { kind: "disqualified" } })]);
    expect(league.rows.map((item) => item.name)).toEqual(["Nordlicht", "Steinbock (−2 Punkte Abzug)", "Eisfuchs (disqualifiziert)"]);
  });
});
