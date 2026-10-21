import { describe, expect, it } from "vitest";
import {
  canonicalMapName, choiceList, findMap, mapState, pickMap, statFigures, vetoLabel, withMapName,
} from "./teamLeagueMaps";

// Maps der Team-Liga (#1616 an #1931) - nur erfundene Map-Namen.
const CHOICES = {
  source: "pool",
  modes: [
    { mode: "snd", label: "Suchen & Zerstören", maps: [
      { map_id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp", aliases: ["Harbour Edge"] },
      { map_id: "nebel", slug: "nebelwerk", name: "Nebelwerk", image_url: null, aliases: [] },
    ] },
    { mode: "stellung", label: "Stellung", maps: [
      { map_id: "hafen", slug: "hafenkante", name: "Hafenkante", image_url: "/api/static/uploads/hafen.webp", aliases: ["Harbour Edge"] },
      { map_id: "glut", slug: "glutsenke", name: "Glutsenke", image_url: null, aliases: ["Ember Pit"] },
    ] },
  ],
};

describe("Zuordnung eines Namens zur Bibliothek", () => {
  it("findet Name, Slug und weitere Schreibweisen – ohne Groß/klein, Leer- und Satzzeichen", () => {
    expect(findMap("Hafenkante", CHOICES)?.map_id).toBe("hafen");
    expect(findMap("  hafenkante ", CHOICES)?.map_id).toBe("hafen");
    expect(findMap("harbour-edge", CHOICES)?.map_id).toBe("hafen");
    expect(findMap("NEBEL WERK", CHOICES)?.map_id).toBe("nebel");
    expect(findMap("Ember Pit", CHOICES)?.map_id).toBe("glut");
    expect(findMap("Karte Unbekannt", CHOICES)).toBeNull();
    expect(findMap("Hafenkante", null)).toBeNull();
  });

  it("jede Map einmal in der Auswahl, mit ihren Modi", () => {
    expect(choiceList(CHOICES).map((item) => [item.map_id, item.modes])).toEqual([
      ["hafen", ["Suchen & Zerstören", "Stellung"]], ["nebel", ["Suchen & Zerstören"]], ["glut", ["Stellung"]]]);
  });

  it("ein getippter Name setzt die Kennung – ein unbekannter nimmt sie weg, der Text bleibt", () => {
    const item = { key: "m1", name: "", map_id: "" };
    expect(withMapName(item, "harbour edge", CHOICES)).toMatchObject({ name: "harbour edge", map_id: "hafen" });
    expect(withMapName({ ...item, map_id: "hafen" }, "Hafenk", CHOICES)).toMatchObject({ name: "Hafenk", map_id: "" });
    expect(withMapName(item, "Nebelwerk", null)).toMatchObject({ name: "Nebelwerk", map_id: "" });
    // Beim Verlassen des Felds steht der Name aus der Bibliothek da.
    expect(canonicalMapName({ name: "harbour edge", map_id: "hafen" }, CHOICES)).toBe("Hafenkante");
    expect(canonicalMapName({ name: "Freitext", map_id: "" }, CHOICES)).toBe("Freitext");
  });

  it("sagt, ob eine Map aus der Auswahl kommt, unbekannt ist oder Freitext ohne Bibliothek", () => {
    expect(mapState({ name: "Hafenkante", map_id: "hafen" }, CHOICES)).toBe("pool");
    expect(mapState({ name: "Alt", map_id: "archiviert" }, CHOICES)).toBe("saved");
    expect(mapState({ name: "Karte Unbekannt", map_id: "" }, CHOICES)).toBe("unknown");
    expect(mapState({ name: "", map_id: "" }, CHOICES)).toBe("empty");
    expect(mapState({ name: "Karte Unbekannt", map_id: "" }, null)).toBe("free");
  });

  it("ein Klick im Pool füllt die erste leere Map, sonst kommt eine neue dazu", () => {
    const match = { maps: [{ key: "a", name: "Nebelwerk", map_id: "nebel" }, { key: "b", name: "", map_id: "" }] };
    const filled = pickMap(match, { map_id: "hafen", name: "Hafenkante" }, () => ({ key: "neu", name: "", map_id: "" }));
    expect(filled.maps.map((item) => [item.key, item.name, item.map_id])).toEqual([["a", "Nebelwerk", "nebel"], ["b", "Hafenkante", "hafen"]]);
    const added = pickMap(filled, { map_id: "glut", name: "Glutsenke" }, () => ({ key: "neu", name: "", map_id: "" }));
    expect(added.maps.map((item) => item.key)).toEqual(["a", "b", "neu"]);
  });
});

describe("Anzeige", () => {
  it("benennt jeden Schritt im Veto aus eigener Sicht", () => {
    expect(vetoLabel({ role: "banned", by: "own" })).toBe("Bann · wir");
    expect(vetoLabel({ role: "banned", by: "opponent" })).toBe("Bann · Gegner");
    expect(vetoLabel({ role: "banned" })).toBe("Bann");
    expect(vetoLabel({ role: "picked", by: "own" })).toBe("Unsere Wahl");
    expect(vetoLabel({ role: "picked", by: "opponent" })).toBe("Wahl Gegner");
    expect(vetoLabel({ role: "decider" })).toBe("Decider");
    expect(vetoLabel({ role: "played" })).toBe("Gespielt");
  });

  it("nennt je Map nur die Kennzahlen, die vorkommen", () => {
    const figures = statFigures({ played: 3, won: 2, drawn: 0, lost: 1, picked_own: 1, picked_opponent: 0, picked: 0, decider: 1,
      banned_own: 0, banned_opponent: 2, banned: 0 });
    expect(figures.map((item) => `${item.label} ${item.value}`)).toEqual([
      "Gespielt 3", "Siege 2", "Niederlagen 1", "Unsere Wahl 1", "Decider 1", "Bann Gegner 2"]);
    expect(statFigures({ played: 0, won: 0, banned_own: 0 })).toEqual([]);
  });
});
