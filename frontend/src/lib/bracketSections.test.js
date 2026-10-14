import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRONZE_SECTIONS, FINAL_SECTIONS, LOSER_SECTIONS, MAIN_SECTIONS, sectionKind } from "./bracketSections";
import { sectionGroup } from "./bracketGraph";
import { finalMatchOf, isBronzeMatch } from "./bracketPodium";
import { matchName } from "./bracketNames";

// Eine Wahrheit für Abschnittsnamen (#1591): Server (services/round_labels.py) und Frontend lesen dieselben Listen.
const serverSet = (name) => {
  const source = readFileSync(path.join(process.cwd(), "../backend/services/round_labels.py"), "utf8");
  const set = new RegExp(`^${name} = \\{([^}]*)\\}`, "m").exec(source)[1];
  return [...set.matchAll(/"([^"]*)"/g)].map((match) => match[1]).sort();
};

describe("bracketSections", () => {
  it("spiegelt die Listen des Servers 1:1", () => {
    expect([...MAIN_SECTIONS].sort()).toEqual(serverSet("MAIN_SECTIONS"));
    expect([...LOSER_SECTIONS].sort()).toEqual(serverSet("LOSER_SECTIONS"));
    expect([...FINAL_SECTIONS].sort()).toEqual(serverSet("FINAL_SECTIONS"));
    expect([...BRONZE_SECTIONS].sort()).toEqual(serverSet("BRONZE_SECTIONS"));
  });

  it("ordnet wie section_kind am Server zu - auch „BR“ ist das Spiel um Platz 3", () => {
    expect(sectionKind("BR")).toBe("bronze");
    expect(sectionGroup("BR")).toBe("bronze");
    expect(sectionGroup("Spiel um Platz 3")).toBe("bronze");
    for (const name of FINAL_SECTIONS) expect(sectionGroup(name.toUpperCase()), name).toBe("final");
    for (const name of LOSER_SECTIONS) expect(sectionGroup(name.toUpperCase()), name).toBe("loser");
    expect(sectionGroup("WB")).toBe("main");
  });

  it("Podium: „[FINAL]“ ist das Grand Final, „BR“ das Spiel um Platz 3", () => {
    const matches = [
      { id: "g", section: "WB", round: 3, match_key: "G", status: "completed" },
      { id: "f", section: "FINAL", round: 6, match_key: "FINAL", status: "completed" },
      { id: "b", section: "BR", round: 3, match_key: "P3", status: "completed" },
    ];
    expect(finalMatchOf(matches, [])?.id).toBe("f");
    expect(isBronzeMatch(matches[2])).toBe(true);
  });

  it("Grand Final heißt wie seine Runde, auch mit kurzem Kürzel", () => {
    expect(matchName({ match_key: "GF", section: "GF", round_label: "Grand Final" })).toBe("Grand Final");
    expect(matchName({ match_key: "GFR", section: "GF", round_label: "Grand Final Reset" })).toBe("Grand Final Reset");
    expect(matchName({ match_key: "LA", section: "LB", round_label: "Loser Runde 1" })).toBe("LA");
  });
});
