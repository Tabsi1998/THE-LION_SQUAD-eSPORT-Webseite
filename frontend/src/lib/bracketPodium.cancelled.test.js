// Entfallene Spiele (#2452): ein zusammengelegter Lauf, eine abgekürzte Runde oder ein Grand Final, das nicht mehr
// nötig ist, zählen nicht als letzte Runde. Sonst stand nach dem Abkürzen kein Sieger mit Medaille im Baum.
import { describe, expect, it } from "vitest";
import { buildPodiumMap, finalMatchOf } from "@/lib/bracketPodium";

const heat = (key, round, status, ranking = [], extra = {}) => ({
  id: `m-${key}`, match_key: key, match_type: "ffa", section: extra.section || "main", round, status,
  results: ranking.map((registration_id, index) => ({ registration_id, rank: index + 1 })), ...extra,
});

describe("Podest mit entfallenen Spielen", () => {
  it("abgekürzt: Runde 3 entfällt, der Sammellauf in Runde 2 ist das Finale und vergibt die Medaillen", () => {
    const matches = [
      heat("A", 1, "completed", ["r1", "r2", "r5"]),
      heat("B", 1, "completed", ["r3", "r4", "r6"]),
      heat("C", 1, "cancelled", [], { merged_into_key: "A" }),
      heat("D", 1, "cancelled", [], { merged_into_key: "B" }),
      heat("E", 2, "completed", ["r3", "r1", "r4", "r2"]),
      heat("F", 2, "cancelled", [], { merged_into_key: "E" }),
      heat("G", 3, "cancelled"),
    ];
    expect(finalMatchOf(matches)?.match_key).toBe("E");
    expect(Object.fromEntries(buildPodiumMap(matches))).toEqual({ r3: 1, r1: 2, r4: 3 });
  });

  it("Grand Final entfällt: dann entscheidet die letzte gespielte Runde des Hauptbaums", () => {
    const matches = [
      heat("A", 1, "completed", ["r1", "r2", "r3", "r4"]),
      heat("LA", 2, "cancelled", [], { section: "loser" }),
      heat("FINAL", 3, "cancelled", [], { section: "grand_final" }),
    ];
    expect(Object.fromEntries(buildPodiumMap(matches))).toEqual({ r1: 1, r2: 2, r3: 3 });
  });

  it("Läufe-Cup vom 31.10.: Läufe zusammengelegt, das Grand Final vergibt 1 und 2, das Loser-Finale Platz 3", () => {
    const matches = [
      heat("A", 1, "completed", ["r1", "r2", "r3", "r4"]),
      heat("B", 1, "cancelled", [], { merged_into_key: "A" }),
      heat("G", 3, "completed", ["r1", "r2"]),
      heat("LA", 2, "completed", ["r3", "r4"], { section: "loser" }),
      heat("LB", 2, "cancelled", [], { section: "loser", merged_into_key: "LA" }),
      heat("LF", 6, "completed", ["r3", "r5"], { section: "loser" }),
      heat("FINAL", 7, "completed", ["r1", "r3"], { section: "grand_final" }),
    ];
    expect(finalMatchOf(matches)?.match_key).toBe("FINAL");
    // Wie am Server (competition_standings.decided_places): der Zweite des Loser-Finales ist Dritter.
    expect(Object.fromEntries(buildPodiumMap(matches))).toEqual({ r1: 1, r3: 2, r5: 3 });
  });
});
