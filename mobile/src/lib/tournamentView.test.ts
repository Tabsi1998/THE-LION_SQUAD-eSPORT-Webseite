import fs from "fs";
import path from "path";
import type { BracketMatch } from "./bracketGraph";
import {
  byeLine,
  checkInState,
  liveClockText,
  matchStatusText,
  roundLabels,
  scheduleSections,
  stageKind,
  standingsTables,
  treeKind,
} from "./tournamentView";

// Turnieransicht der App (#1563): Rundennamen, Spielplan, Tabellen, Check-in-Ende - auf echten Bäumen aus dem
// Generator (docs/bracket-trees.json, scripts/make_app_bracket_fixture.py).
type Tree = { format: string; matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string; status?: string }>; stages: any[]; round_labels: Record<string, string>; standings?: any[] };
const TREES: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));
const STATES = Object.keys(TREES).filter((key) => !key.startsWith("_"));
const idOf = (state: string, name: string) => TREES[state].registrations.find((reg) => reg.display_name === name)?.id as string;
const nameOf = (state: string) => (id: string) => TREES[state].registrations.find((reg) => reg.id === id)?.display_name || "";

describe("Rundennamen", () => {
  test.each(STATES)("ohne round_label rechnet die App wie der Server: %s", (state) => {
    const tree = TREES[state];
    const labels = roundLabels(tree.matches_v2, tree.stages, tree.format);
    expect(Object.fromEntries(tree.matches_v2.map((match) => [match.match_key, labels.get(match.id)]))).toEqual(tree.round_labels);
  });

  test("round_label aus der Baum-Antwort gewinnt", () => {
    const tree = TREES.se6_live;
    const matches = tree.matches_v2.map((match) => (match.match_key === "G" ? { ...match, round_label: "Finale Nord" } : match));
    expect(roundLabels(matches, tree.stages, tree.format).get(matches[6].id)).toBe("Finale Nord");
  });

  test("ganz alte Daten ohne Runde und Abschnitt", () => {
    expect(roundLabels([{ id: "x" }], [], "single_elim").get("x")).toBe("Runde");
  });
});

describe("Baum oder Tabelle", () => {
  test("Liga, Gruppen und Swiss sind Tabellen, Läufe sind Läufe, K.-o. ist ein Baum", () => {
    expect(["league6", "groups8", "swiss6", "ffa16", "se6_live", "de4_reset_cancelled"].map((state) => treeKind(TREES[state].stages, TREES[state].format, TREES[state].matches_v2)))
      .toEqual(["table", "table", "table", "heats", "knockout", "knockout"]);
  });

  test("ältere Antworten ohne Phasen: das Format entscheidet", () => {
    expect(stageKind(undefined, "round_robin")).toBe("table");
    expect(stageKind(undefined, "ffa")).toBe("heats");
    expect(stageKind(undefined, "single_elim")).toBe("knockout");
    expect(treeKind(undefined, "swiss", [])).toBe("table");
  });
});

describe("Spielplan", () => {
  test("nach Spieltag gruppiert, in der Reihenfolge der Runden", () => {
    const tree = TREES.league6;
    const sections = scheduleSections(tree.matches_v2, { by: "day", labels: roundLabels(tree.matches_v2, tree.stages, tree.format) });
    expect(sections.map((section) => [section.title, section.items.map((match) => match.match_key).join("")]))
      .toEqual([["Spieltag 1", "ABC"], ["Spieltag 2", "DEF"], ["Spieltag 3", "GHI"], ["Spieltag 4", "JKL"], ["Spieltag 5", "MNO"]]);
  });

  test("Doppel-K.-o.: Winner, Loser, Grand Final", () => {
    const tree = TREES.de4_reset_cancelled;
    const sections = scheduleSections(tree.matches_v2, { by: "day", labels: roundLabels(tree.matches_v2, tree.stages, tree.format) });
    expect(sections.map((section) => section.title)).toEqual(["Winner Runde 1", "Winner Final", "Loser Runde 1", "Loser Runde 2", "Grand Final", "Grand Final Reset"]);
  });

  test("„Nur meine“: nur die Spiele der eigenen Anmeldung", () => {
    const tree = TREES.league6;
    const mine = idOf("league6", "NeonFalke");
    const sections = scheduleSections(tree.matches_v2, { by: "day", mine, labels: roundLabels(tree.matches_v2, tree.stages, tree.format) });
    expect(sections.flatMap((section) => section.items).length).toBe(5);
    expect(sections.every((section) => section.items.every((match) => (match.slots || []).some((slot) => slot.registration_id === mine)))).toBe(true);
  });

  test("nach Station: laufende zuerst, ohne Station am Ende", () => {
    const tree = TREES.ffa16_round1;
    const sections = scheduleSections(tree.matches_v2, { by: "station", labels: roundLabels(tree.matches_v2, tree.stages, tree.format) });
    expect(sections.map((section) => [section.title, section.live, section.items.map((match) => match.match_key).join("")]))
      .toEqual([["Switch 2", true, "E"], ["Ohne Station", false, "FGABCD"]]);
  });
});

describe("Tabellen", () => {
  test("Gruppen: eine Tabelle je Gruppe (`[{group, standings}]`)", () => {
    const tables = standingsTables(TREES.groups8.standings, "groups", idOf("groups8", "NeonFalke"));
    expect(tables.map((table) => table.title)).toEqual(["Gruppe A", "Gruppe B"]);
    expect(tables[0].columns).toEqual(["Sp", "S", "U", "N", "Diff", "Pkt"]);
    expect(tables[0].rows[0]).toMatchObject({ rank: 1, name: "NeonFalke", mine: true, cells: ["1", "1", "0", "0", "+3", "3"] });
  });

  test("Liga und Swiss", () => {
    const league = standingsTables(TREES.league6.standings, "round_robin", null);
    expect(league).toHaveLength(1);
    expect(league[0].title).toBe("");
    expect(league[0].rows[0]).toMatchObject({ rank: 1, name: "NeonFalke", cells: ["2", "2", "0", "0", "+6", "6"] });
    const swiss = standingsTables(TREES.swiss6.standings, "swiss", null);
    expect(swiss[0].columns).toEqual(["Sp", "S", "U", "N", "BH", "Pkt"]);
    expect(swiss[0].rows[0].cells).toEqual(["2", "2", "0", "0", "1", "2"]);
  });

  test("leere Antwort und Ausgeschiedene", () => {
    expect(standingsTables([], "groups", null)).toEqual([]);
    expect(standingsTables(null, "swiss", null)).toEqual([]);
    const rows = [{ registration_id: "r1", display_name: "Lena", rank: 1, played: 1, won: 1, lost: 0, drawn: 0, points: 3 }];
    const tables = standingsTables(rows, "round_robin", null, new Map([["r1", "withdrawn"]]));
    expect(tables[0].rows[0]).toMatchObject({ out: "Ausgetreten" });
  });
});

describe("Check-in", () => {
  const now = new Date("2026-10-31T13:00:00Z");
  test("offen, solange das Fenster läuft", () => {
    expect(checkInState({ status: "check_in", check_in_until: "2026-10-31T13:30:00Z" }, now)).toEqual({ open: true, over: false });
  });
  test("vorbei, sobald der Server den Check-in geschlossen hat - auch ohne Ende", () => {
    expect(checkInState({ status: "check_in", check_in_closed_at: "2026-10-31T12:59:00Z" }, now)).toEqual({ open: false, over: true });
  });
  test("vorbei, sobald „Check-in endet“ um ist - auch bevor der Job den Baum gebaut hat (wie der Server)", () => {
    expect(checkInState({ status: "check_in", check_in_until: "2026-10-31T12:30:00Z" }, now)).toEqual({ open: false, over: true });
  });
  test("ältere Server ohne Feld: wie bisher nach Status", () => {
    expect(checkInState({ status: "check_in" }, now)).toEqual({ open: true, over: false });
    expect(checkInState({ status: "live" }, now)).toEqual({ open: false, over: false });
  });
});

describe("Kleinigkeiten", () => {
  test("Live-Uhr ab dem Start", () => {
    expect(liveClockText("2026-10-31T13:00:00Z", new Date("2026-10-31T13:07:41Z").getTime())).toBe("07:41");
    expect(liveClockText("2026-10-31T13:00:00Z", new Date("2026-10-31T14:02:05Z").getTime())).toBe("62:05");
    expect(liveClockText(null, Date.now())).toBe("");
    expect(liveClockText("2026-10-31T13:00:00Z", new Date("2026-10-31T12:59:00Z").getTime())).toBe("00:00");
  });

  test("Freilos als eine Zeile - und nach einer Disqualifikation kampflos", () => {
    const tree = TREES.se6_live;
    const byKey = Object.fromEntries(tree.matches_v2.map((match) => [match.match_key, match]));
    expect(byeLine(byKey.A, nameOf("se6_live"))).toEqual({ tag: "Freilos", text: "NeonFalke kommt weiter", registrationId: idOf("se6_live", "NeonFalke") });
    expect(byeLine(byKey.D, nameOf("se6_live"))).toEqual({ tag: "kampflos", text: "BoostBerta kommt weiter", registrationId: idOf("se6_live", "BoostBerta") });
    expect(byeLine(byKey.B, nameOf("se6_live"))).toBeNull();
  });
});

test("Status eines Spiels in Worten: entfällt, zusammengelegt, kampflos, läuft", () => {
  const byKey = (state: string) => Object.fromEntries(TREES[state].matches_v2.map((match) => [match.match_key, match]));
  expect(matchStatusText(byKey("de4_reset_cancelled").GFR)).toBe("entfällt · nicht nötig");
  expect(matchStatusText(byKey("ffa8_after_merge").C)).toBe("zusammengelegt in B");
  expect(matchStatusText(byKey("ffa8_after_merge").G)).toBe("entfällt");
  expect(matchStatusText(byKey("se6_done").F)).toBe("kampflos");
  expect(matchStatusText(byKey("se6_live").E)).toBe("Läuft");
  expect(matchStatusText(byKey("se6_live").F)).toBe("Bereit");
  expect(matchStatusText(byKey("se6_done").G)).toBe("Beendet");
});

test("gemischt: Zielspiele sagen, woraus gemischt wird - bis zur Auslosung", () => {
  const byKey = (state: string) => Object.fromEntries(TREES[state].matches_v2.map((match) => [match.match_key, match]));
  expect(matchStatusText(byKey("se8_mixed_open").E)).toBe("gemischt aus Runde 1");
  expect(matchStatusText(byKey("de8_mixed_r1").LC)).toBe("gemischt aus Winner Runde 2 / Loser Runde 1");
  expect(matchStatusText(byKey("se8_mixed_drawn").E)).toBe("Bereit");
  expect(matchStatusText(byKey("se8_mixed_open").G)).toBe("Ausstehend");
});
