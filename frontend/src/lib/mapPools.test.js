import { describe, expect, it } from "vitest";
import {
  defaultSelection,
  eligibleMaps,
  mapFormPayload,
  mapToForm,
  moveMap,
  poolSections,
  poolSelection,
  sameSelection,
  selectionBody,
  selectionCount,
  toggleMap,
} from "./mapPools";

// Map-Bibliothek und Map-Pools (#1616) - nur erfundene Map-Namen.
const MODES = [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }, { mode: "kontrolle", label: "Kontrolle" }];
const LIBRARY = [
  { id: "hafen", name: "Hafenkante", modes: ["stellung", "snd"] },
  { id: "nebel", name: "Nebelwerk", modes: ["snd"] },
  { id: "glut", name: "Glutsenke", modes: ["kontrolle"] },
];
const POOL = {
  id: "p1", version: 2, origin: "tournament",
  modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "nebel", name: "Nebelwerk" }, { map_id: "hafen", name: "Hafenkante" }] }],
};

describe("Auswahl je Modus", () => {
  it("bietet je Modus nur die freigegebenen Maps an – ohne Modi alle", () => {
    expect(eligibleMaps(LIBRARY, "snd").map((item) => item.id)).toEqual(["hafen", "nebel"]);
    expect(eligibleMaps(LIBRARY, "kontrolle").map((item) => item.id)).toEqual(["glut"]);
    expect(eligibleMaps(LIBRARY, null).map((item) => item.id)).toEqual(["hafen", "nebel", "glut"]);
  });

  it("übernimmt die Vorgabe des Spiels: alle aktiven Maps je Modus in der Reihenfolge der Bibliothek", () => {
    expect(defaultSelection(LIBRARY, MODES)).toEqual({ stellung: ["hafen"], snd: ["hafen", "nebel"], kontrolle: ["glut"] });
    expect(defaultSelection(LIBRARY, [])).toEqual({ "": ["hafen", "nebel", "glut"] });
  });

  it("liest einen gespeicherten Pool und schreibt die Auswahl in Modus-Reihenfolge zurück", () => {
    const selection = poolSelection(POOL);
    expect(selection).toEqual({ snd: ["nebel", "hafen"] });
    const more = toggleMap(selection, "stellung", "hafen");
    expect(selectionBody(more, MODES, 2)).toEqual({
      modes: [{ mode: "stellung", map_ids: ["hafen"] }, { mode: "snd", map_ids: ["nebel", "hafen"] }],
      expected_version: 2,
    });
    expect(selectionBody({ "": ["glut"] }, [], 0)).toEqual({ modes: [{ mode: null, map_ids: ["glut"] }], expected_version: 0 });
  });

  it("wählt ab, hängt hinten an und verschiebt innerhalb des Modus", () => {
    let selection = poolSelection(POOL);
    selection = toggleMap(selection, "snd", "nebel");
    expect(selection.snd).toEqual(["hafen"]);
    selection = toggleMap(selection, "snd", "nebel");
    expect(selection.snd).toEqual(["hafen", "nebel"]);
    expect(moveMap(selection, "snd", "nebel", -1).snd).toEqual(["nebel", "hafen"]);
    expect(moveMap(selection, "snd", "hafen", -1).snd).toEqual(["hafen", "nebel"]);
    expect(selectionCount({ snd: ["a", "b"], stellung: ["a"] })).toBe(3);
  });

  it("merkt, ob sich etwas gegenüber dem gespeicherten Stand geändert hat", () => {
    expect(sameSelection(poolSelection(POOL), { snd: ["nebel", "hafen"], stellung: [] })).toBe(true);
    expect(sameSelection(poolSelection(POOL), { snd: ["hafen", "nebel"] })).toBe(false);
    expect(sameSelection(poolSelection(null), {})).toBe(true);
  });
});

describe("Öffentliche Anzeige", () => {
  it("zeigt den Pool des Turniers und eigene Pools von Phasen als eigene Abschnitte", () => {
    const stagePool = { ...POOL, id: "p2", origin: "stage" };
    const overview = {
      tournament: POOL,
      stages: [
        { stage_id: "s1", name: "Gruppenphase", pool: POOL },
        { stage_id: "s2", name: "Finale", pool: stagePool },
      ],
    };
    expect(poolSections(overview).map((section) => [section.title, section.pool.id])).toEqual([
      ["Map-Pool", "p1"],
      ["Map-Pool · Finale", "p2"],
    ]);
    expect(poolSections({ tournament: null, stages: [{ stage_id: "s2", name: "Finale", pool: stagePool }] })
      .map((section) => section.title)).toEqual(["Map-Pool · Finale"]);
    expect(poolSections({ tournament: null, stages: [] })).toEqual([]);
    expect(poolSections(null)).toEqual([]);
  });
});

describe("Formular einer Map", () => {
  it("rechnet zwischen Map und Formular um – leere Felder werden null", () => {
    const form = mapToForm({ name: "Hafenkante", slug: "hafenkante", image_url: "", modes: ["snd"], note: null, external_ref: "map_hafen" });
    expect(form).toEqual({ name: "Hafenkante", slug: "hafenkante", image_url: "", modes: ["snd"], note: "", external_ref: "map_hafen", aliases: "" });
    expect(mapFormPayload({ ...form, name: "  Hafenkante  ", note: " ", slug: "" })).toEqual({
      name: "Hafenkante", slug: null, image_url: null, modes: ["snd"], note: null, external_ref: "map_hafen", aliases: [],
    });
  });

  it("weitere Schreibweisen stehen im Formular mit Komma getrennt (#1616 an #1931)", () => {
    expect(mapToForm({ name: "Hafenkante", aliases: ["Harbour Edge", "Hafen"] }).aliases).toBe("Harbour Edge, Hafen");
    expect(mapFormPayload({ name: "Hafenkante", aliases: " Harbour  Edge , , Hafen " }).aliases).toEqual(["Harbour Edge", "Hafen"]);
  });
});
