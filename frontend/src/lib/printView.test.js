// Druckansicht (#1283): Aufteilung auf A4 - nichts darf über den Rand, Rundennamen wie im Web-Baum, Teile und Rechte.
import { describe, expect, test } from "vitest";
import { displayRoundLabels, roundName } from "@/lib/bracketNames";
import {
  CHECKIN, PRINT_DEFAULTS, bracketBlocks, bracketPages, cardHeight, checkinPages, columnHeight, dayPlanPages, eventCheckinSections, listCapacity,
  TITLE_MAX, paginate, parseParts, scheduleRowHeight, schedulePages, sheetBody, splitBands, stampText, titleTier, tournamentCheckinSections, treeColumnCapacity, treeColumns,
} from "@/lib/printView";

let next = 0;
const reg = (name) => ({ id: `r-${name}`, display_name: name });

function match({ section = "WB", round, order, key, slots = 2, regs = [], stage = "s1", label, ...rest }) {
  next += 1;
  return {
    id: `m-${next}`, stage_id: stage, section, round, order, match_key: key ?? `M${next}`, round_label: label, status: "pending",
    slots: Array.from({ length: slots }, (_, index) => ({ slot: index + 1, registration_id: regs[index] ? `r-${regs[index]}` : null })),
    ...rest,
  };
}

/** Einfaches K.-o. mit `size` Plätzen: Runde 1 hat size/2 Spiele, dann halbiert. */
function singleElim(size) {
  const matches = [];
  let count = size / 2;
  for (let round = 1; count >= 1; round += 1, count /= 2) {
    for (let order = 0; order < count; order += 1) matches.push(match({ round, order, label: `Runde ${round}` }));
  }
  return { stages: [{ id: "s1", number: 1, name: "K.-o." }], matches_v2: matches, registrations: [] };
}

/** Doppel-K.-o. mit 8: Winner 4-2-1, Loser 2-2-1-1, Grand Final mit Reset. Loser-Runden nach der Uhr benannt. */
function doubleElim() {
  const players = ["Anna", "Ben", "Cleo", "Dino", "Ella", "Finn", "Gina", "Hugo"];
  const matches = [
    ...[0, 1, 2, 3].map((order) => match({ round: 1, order, key: "ABCD"[order], regs: players.slice(order * 2, order * 2 + 2), label: "Viertelfinale" })),
    ...[0, 1].map((order) => match({ round: 2, order, key: "EF"[order], label: "Halbfinale" })),
    match({ round: 3, order: 0, key: "G", label: "Winner Final" }),
    ...[0, 1].map((order) => match({ section: "LB", round: 2, order, key: `L${order + 1}`, label: "Loser Runde 2" })),
    ...[0, 1].map((order) => match({ section: "LB", round: 3, order, key: `L${order + 3}`, label: "Loser Runde 3" })),
    match({ section: "LB", round: 4, order: 0, key: "L5", label: "Loser Runde 4" }),
    match({ section: "LB", round: 5, order: 0, key: "L6", label: "Loser Final" }),
    match({ section: "GF", round: 6, order: 0, key: "GF", label: "Grand Final" }),
    match({ section: "GF", round: 7, order: 0, key: "GFR", label: "Grand Final Reset", settings: { bracket_reset: true } }),
  ];
  return { stages: [{ id: "s1", number: 1, name: "Doppel-K.-o." }], matches_v2: matches, registrations: players.map(reg) };
}

/** Läufe (FFA): 32 Plätze in Läufen zu 8, dann 2 Läufe, dann Finale. */
function heats() {
  const matches = [
    ...[0, 1, 2, 3].map((order) => match({ round: 1, order, slots: 8, key: `H${order + 1}`, label: "Runde 1", match_type: "ffa" })),
    ...[0, 1].map((order) => match({ round: 2, order, slots: 8, key: `S${order + 1}`, label: "Runde 2", match_type: "ffa" })),
    match({ round: 3, order: 0, slots: 8, key: "F", label: "Finale", match_type: "ffa" }),
  ];
  return { stages: [{ id: "s1", number: 1, name: "Läufe" }], matches_v2: matches, registrations: [] };
}

function everyColumnFits(pages, orientation) {
  const capacity = treeColumnCapacity(orientation);
  const max = treeColumns(orientation);
  for (const page of pages) {
    expect(page.blocks.reduce((sum, block) => sum + block.columns.length, 0)).toBeLessThanOrEqual(max);
    for (const block of page.blocks) for (const column of block.columns) expect(columnHeight(column.matches)).toBeLessThanOrEqual(capacity);
  }
}

describe("Blatt", () => {
  test("A4 quer und hoch: Inhalt ist kleiner als das Papier, quer passen mehr Runden nebeneinander", () => {
    expect(sheetBody("landscape")).toEqual({ width: 277, height: 148 });
    expect(sheetBody("portrait")).toEqual({ width: 190, height: 235 });
    expect(treeColumns("landscape")).toBe(4);
    expect(treeColumns("portrait")).toBe(3);
  });

  test("Name im Kopf: stufenweise kleiner statt abgeschnitten - bis 80 Zeichen hoch und quer", () => {
    expect(TITLE_MAX).toBe(80);
    expect(titleTier("Herbst-Cup", "portrait")).toBe("normal");
    expect(titleTier("Abnahme Doppel-K.-o. (19.10. 19:01)", "portrait")).toBe("long");
    expect(titleTier("Abnahme Doppel-K.-o. (19.10. 19:01)", "landscape")).toBe("long");
    expect(titleTier("x".repeat(80), "portrait")).toBe("longer");
    expect(titleTier("x".repeat(80), "landscape")).toBe("longer");
  });

  test("Druckzeit mit Datum und Uhrzeit in Wiener Zeit", () => {
    expect(stampText(Date.parse("2026-10-30T18:05:00Z"))).toBe("Stand 30.10. 19:05");
  });
});

describe("Teile und Rechte", () => {
  test("ohne Recht gibt es die Check-in-Liste nicht - auch nicht über die Adresse", () => {
    expect(parseParts("baum,liste", "tournament")).toEqual(["baum"]);
    expect(parseParts("liste", "tournament")).toEqual(["baum", "spielplan"]);
    expect(parseParts("liste", "event")).toEqual(["tagesplan"]);
  });

  test("mit Recht auf Wunsch dazu, immer in Papier-Reihenfolge; ohne Auswahl nur Öffentliches", () => {
    expect(parseParts("liste,baum", "tournament", { staff: true })).toEqual(["baum", "liste"]);
    expect(parseParts("", "tournament", { staff: true })).toEqual(["baum", "spielplan"]);
    expect(parseParts("tagesplan,liste,quatsch", "event", { staff: true })).toEqual(["tagesplan", "liste"]);
    expect(parseParts("baum", "event", { staff: true })).toEqual(["tagesplan"]);
    expect(parseParts("none", "tournament", { staff: true })).toEqual([]);
  });
});

describe("Baum", () => {
  test("Rundennamen wie im Web-Baum - auch die Loser-Runden nach der Uhr heißen fortlaufend", () => {
    const bracket = doubleElim();
    const web = displayRoundLabels(bracket.matches_v2);
    const blocks = bracketBlocks(bracket);
    expect(blocks.map((block) => block.title)).toEqual(["Winner Bracket", "Loser Bracket", "Grand Final"]);
    expect(blocks[0].columns.map((column) => column.title)).toEqual(["Viertelfinale", "Halbfinale", "Winner Final"]);
    const loserWeb = [...new Set(web.filter((item) => item.section === "LB").map((item) => roundName(item)))];
    expect(blocks[1].columns.map((column) => column.title)).toEqual(loserWeb);
    expect(loserWeb).toEqual(["Loser Runde 1", "Loser Runde 2", "Loser Runde 3", "Loser Final"]);
    // Der Abschnitt heißt schon „Grand Final“ - die erste Spalte wiederholt es nicht, der Reset schon.
    expect(blocks[2].columns.map((column) => column.title)).toEqual(["", "Grand Final Reset"]);
  });

  test("Doppel-K.-o. auf A4 quer: Winner und Grand Final passen, Loser bekommt eigene Seite, nichts zu hoch", () => {
    const pages = bracketPages(doubleElim(), { orientation: "landscape" });
    everyColumnFits(pages, "landscape");
    expect(pages.flatMap((page) => page.blocks.map((block) => block.title))).toEqual(["Winner Bracket", "Loser Bracket", "Grand Final"]);
    expect(pages.every((page) => page.blocks.every((block) => !block.overflow))).toBe(true);
    // Namen und wer kommt: die Plätze der ersten Runde tragen Namen, später „Sieger aus A“.
    const first = pages[0].blocks[0].columns[0].matches[0];
    expect(first.slots.map((slot) => slot.label)).toEqual(["Anna", "Ben"]);
  });

  test("32er-Baum: mehr Runden als Spalten → zweite Seite; Runde 1 zu hoch → Bänder mit wiederholtem Rundennamen", () => {
    const pages = bracketPages(singleElim(32), { orientation: "landscape" });
    everyColumnFits(pages, "landscape");
    const titles = pages.map((page) => page.blocks[0].columns.map((column) => column.title));
    // 5 Runden, 4 nebeneinander: erst Runden 1-4 in Bändern, dann Runde 5.
    expect(titles[0]).toEqual(["Runde 1", "Runde 2", "Runde 3", "Runde 4"]);
    expect(titles[titles.length - 1]).toEqual(["Runde 5"]);
    const roundOnePages = pages.filter((page) => page.blocks[0].columns[0].title === "Runde 1");
    expect(roundOnePages.length).toBeGreaterThan(1);
    roundOnePages.forEach((page, index) => expect(page.blocks[0].columns[0].continued).toEqual({ band: index + 1, of: roundOnePages.length }));
    // Alle 16 Spiele der ersten Runde stehen genau einmal auf dem Papier.
    expect(roundOnePages.flatMap((page) => page.blocks[0].columns[0].matches).length).toBe(16);
    expect(pages[0].blocks[0].part).toEqual({ index: 1, of: pages.length });
  });

  test("Spalten mit wenigen Spielen stehen auf der ersten Seite; keine Seite zeigt eine leere Spalte", () => {
    for (const bracket of [singleElim(32), singleElim(16), doubleElim()]) {
      const pages = bracketPages(bracket, { orientation: "landscape" });
      for (const page of pages) for (const block of page.blocks) for (const column of block.columns) expect(column.matches.length).toBeGreaterThan(0);
    }
    const pages = bracketPages(singleElim(16), { orientation: "landscape" });
    // 16er: Runde 1 in zwei Bändern - das Finale (Runde 4, ein Spiel) steht auf Seite 1, ohne „1/2“.
    const final = pages[0].blocks[0].columns.find((column) => column.title === "Runde 4");
    expect(final.matches).toHaveLength(1);
    expect(final.continued).toBeNull();
    expect(pages[1].blocks[0].columns.map((column) => column.title)).not.toContain("Runde 4");
  });

  test("hochkant passen weniger Spalten - trotzdem nichts abgeschnitten", () => {
    const pages = bracketPages(singleElim(16), { orientation: "portrait" });
    everyColumnFits(pages, "portrait");
    expect(pages[0].blocks[0].columns.length).toBe(3);
  });

  test("Läufe (FFA): Karten mit 8 Plätzen sind höher und verteilen sich auf Bänder", () => {
    expect(cardHeight(8)).toBeGreaterThan(cardHeight(2) * 3);
    const pages = bracketPages(heats(), { orientation: "landscape" });
    everyColumnFits(pages, "landscape");
    const all = pages.flatMap((page) => page.blocks.flatMap((block) => block.columns.flatMap((column) => column.matches)));
    expect(all.length).toBe(7);
    expect(all.every((item) => item.heat && item.slots.length === 8)).toBe(true);
  });

  test("Gruppen: je Gruppe ein Block mit ihren Runden", () => {
    const bracket = {
      stages: [{ id: "g", number: 1, name: "Gruppenphase" }, { id: "k", number: 2, name: "Finalrunde" }],
      matches_v2: [
        match({ stage: "g", section: "group_a", round: 1, order: 0, label: "Spieltag 1" }),
        match({ stage: "g", section: "group_a", round: 2, order: 0, label: "Spieltag 2" }),
        match({ stage: "g", section: "group_b", round: 1, order: 0, label: "Spieltag 1" }),
        match({ stage: "k", section: "WB", round: 1, order: 0, label: "Finale" }),
      ],
      registrations: [],
    };
    const blocks = bracketBlocks(bracket);
    expect(blocks.map((block) => block.title)).toEqual(["Gruppenphase · Gruppe A", "Gruppenphase · Gruppe B", "Finalrunde · Winner Bracket"]);
    expect(blocks[0].columns.map((column) => column.title)).toEqual(["Spieltag 1", "Spieltag 2"]);
  });

  test("Bänder: jede Spalte gibt ihren Anteil ab, eine zu hohe Einzelkarte meldet overflow", () => {
    const columns = [{ title: "R1", matches: Array.from({ length: 8 }, () => ({ slots: [1, 2] })) }, { title: "R2", matches: Array.from({ length: 4 }, () => ({ slots: [1, 2] })) }];
    const { bands, overflow } = splitBands(columns, columnHeight(columns[0].matches.slice(0, 4)));
    expect(overflow).toBe(false);
    expect(bands.map((band) => band.map((column) => column.matches.length))).toEqual([[4, 2], [4, 2]]);
    expect(splitBands([{ title: "X", matches: [{ slots: Array(40).fill(0) }] }], 100).overflow).toBe(true);
  });
});

describe("Großer Lauf (64 Plätze in einem Lauf)", () => {
  function bigHeat() {
    const regs = Array.from({ length: 64 }, (_, index) => `P${index + 1}`);
    return {
      stages: [{ id: "s1", number: 1 }],
      registrations: regs.map(reg),
      matches_v2: [match({ round: 1, order: 0, slots: 64, regs, key: "A", label: "Runde 1", match_type: "ffa", scheduled_at: "2026-10-31T09:00:00Z" })],
    };
  }

  test("Baum: die Karte wird in Teilkarten geteilt, alle 64 Plätze genau einmal, nichts zu hoch", () => {
    for (const orientation of ["landscape", "portrait"]) {
      const pages = bracketPages(bigHeat(), { orientation });
      everyColumnFits(pages, orientation);
      const cards = pages.flatMap((page) => page.blocks.flatMap((block) => block.columns.flatMap((column) => column.matches)));
      expect(cards.length).toBeGreaterThan(1);
      expect(cards.every((card) => card.piece && card.piece.of === cards.length)).toBe(true);
      expect(cards.flatMap((card) => card.slots.map((slot) => slot.label))).toEqual(Array.from({ length: 64 }, (_, index) => `P${index + 1}`));
      expect(pages.every((page) => page.blocks.every((block) => !block.overflow))).toBe(true);
    }
  });

  test("Spielplan: die Zeile geht in Teilzeilen weiter, jede Seite passt", () => {
    const pages = schedulePages(bigHeat(), { orientation: "portrait" });
    const rows = pages.flatMap((page) => page.sections.flatMap((section) => section.rows));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.flatMap((row) => row.sides).length).toBe(64);
    for (const page of pages) {
      const used = 8 + page.sections.reduce((sum, section) => sum + 9 + section.rows.reduce((total, row) => total + scheduleRowHeight(row), 0), 0);
      expect(used).toBeLessThanOrEqual(listCapacity("portrait"));
    }
  });
});

describe("Listen", () => {
  test("Abschnitt läuft auf der nächsten Seite mit Fortsetzung weiter, Kopf nie allein am Seitenende", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: index }));
    const pages = paginate([{ key: "a", title: "A", rows: rows.slice(0, 5) }, { key: "b", title: "B", rows }], { capacity: 100, tableHead: 10, sectionHead: 10, rowHeight: () => 8 });
    for (const page of pages) {
      const used = 10 + page.sections.reduce((sum, section) => sum + 10 + section.rows.length * 8, 0);
      expect(used).toBeLessThanOrEqual(100);
      page.sections.forEach((section) => expect(section.rows.length).toBeGreaterThan(0));
    }
    expect(pages.flatMap((page) => page.sections).filter((section) => section.key === "b").map((section) => section.continued)).toEqual([false, true, true, true]);
    expect(pages.flatMap((page) => page.sections.flatMap((section) => section.rows)).length).toBe(35);
  });

  test("Spielplan nach Zeit: Läufe sind so hoch wie ihre Plätze, nichts über den Rand", () => {
    const bracket = heats();
    bracket.matches_v2.forEach((item, index) => { item.scheduled_at = `2026-10-31T${String(9 + index).padStart(2, "0")}:00:00Z`; });
    const pages = schedulePages(bracket, { orientation: "portrait" });
    const rows = pages.flatMap((page) => page.sections.flatMap((section) => section.rows));
    expect(rows.length).toBe(7);
    expect(rows[0].time).toBe("10:00");
    expect(scheduleRowHeight(rows[0])).toBeGreaterThan(scheduleRowHeight({ heat: false, sides: [{}, {}] }));
    expect(pages[0].sections[0].title).toBe("Samstag, 31. Oktober");
  });

  test("Spielplan nach Station: je Station ein Abschnitt", () => {
    const bracket = doubleElim();
    bracket.matches_v2[0].station_text = "Station 1";
    bracket.matches_v2[1].station_text = "Station 2";
    const pages = schedulePages(bracket, { order: "station" });
    expect(pages[0].sections.map((section) => section.title).slice(0, 2)).toEqual(["Station 1", "Station 2"]);
  });

  test("Check-in-Liste Turnier: Kästchen-Stand, Warteliste darunter; 100 Namen → mehrere Seiten, alle passen", () => {
    const expected = Array.from({ length: 100 }, (_, index) => ({ id: `e${index}`, name: `Spieler ${index}`, seed: index + 1, checked_in: index < 3 }));
    const sections = tournamentCheckinSections({ expected, waitlist: [{ id: "w", name: "Wanda" }], counts: { expected: 100, checked_in: 3, waitlist: 1 } });
    expect(sections.map((section) => section.title)).toEqual(["Erwartet", "Warteliste"]);
    expect(sections[0].note).toBe("3 von 100 schon da");
    const pages = checkinPages(sections, { orientation: PRINT_DEFAULTS.listOrientation });
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
      const used = CHECKIN.tableHead + page.sections.reduce((sum, section) => sum + CHECKIN.sectionHead + section.rows.length * CHECKIN.row, 0);
      expect(used).toBeLessThanOrEqual(listCapacity("portrait"));
    }
  });

  test("Check-in-Liste Event: Begleitpersonen und Warteliste, Stornierte fehlen", () => {
    const sections = eventCheckinSections({ registrations: [
      { id: "1", display_name: "Paula", status: "registered", companion_count: 1 },
      { id: "2", display_name: "Max", status: "checked_in", companion_count: 0 },
      { id: "3", display_name: "Zoe", status: "waitlist" },
      { id: "4", display_name: "Weg", status: "cancelled" },
    ] });
    expect(sections[0].rows.map((row) => [row.name, row.checked, row.extra])).toEqual([["Paula", false, "+1 Begleitung"], ["Max", true, ""]]);
    expect(sections[1].rows.map((row) => row.name)).toEqual(["Zoe"]);
  });

  test("Tagesplan: Einlass, Turniere und Fast Lap je Tag nach Zeit, mit Check-in", () => {
    const event = {
      start_date: "2026-10-31T08:00:00Z", end_date: "2026-10-31T20:00:00Z", door_time: "2026-10-31T07:30:00Z",
      tournaments: [{ id: "t", title: "Herbst-Cup", start_date: "2026-10-31T10:00:00Z", end_date: "2026-10-31T14:00:00Z", check_in_from: "2026-10-31T09:00:00Z" }],
      f1_challenges: [{ id: "f", title: "Fast Lap", start_date: "2026-10-31T09:00:00Z" }],
    };
    const pages = dayPlanPages(event);
    expect(pages).toHaveLength(1);
    expect(pages[0].sections[0].rows.map((row) => [row.time, row.title, row.note])).toEqual([
      ["08:30", "Einlass", ""], ["ab 10:00", "Fast Lap", ""], ["11:00–15:00", "Herbst-Cup", "Check-in ab 10:00"],
    ]);
  });
});
