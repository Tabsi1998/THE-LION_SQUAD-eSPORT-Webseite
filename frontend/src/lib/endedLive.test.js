import { describe, expect, it } from "vitest";
import { endedLiveText, endText, liveAfterEnd } from "./endedLive";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

describe("endedLive (#2194)", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");

  it("erkennt „live“ nach dem Ende - sonst nichts", () => {
    expect(liveAfterEnd({ status: "live", end_date: "2026-10-31T22:00:00Z" }, now)).toBe(true);
    expect(liveAfterEnd({ status: "live", end_date: "2026-11-03T22:00:00Z" }, now)).toBe(false);
    expect(liveAfterEnd({ status: "completed", end_date: "2026-10-31T22:00:00Z" }, now)).toBe(false);
    expect(liveAfterEnd({ status: "live" }, now)).toBe(false);
  });

  it("sagt Ende und offene Spiele in Wiener Zeit", () => {
    expect(endText("2026-10-31T22:00:00Z")).toBe("Sa 31. Oktober · 23:00");
    expect(endedLiveText({ end_date: "2026-10-31T22:00:00Z", open_matches: 2 })).toBe(
      "Läuft laut Stand noch, Ende war am Sa 31. Oktober · 23:00. 2 Spiele sind noch offen – öffentlich steht „Läuft“.");
    expect(endedLiveText({ end_date: "2026-10-31T22:00:00Z", open_matches: 0 })).toContain("Beenden oder Ergebnisse veröffentlichen?");
    expect(endedLiveText({ end_date: "2026-10-31T22:00:00Z", open_matches: 1 })).toContain("1 Spiel ist noch offen");
  });
});
