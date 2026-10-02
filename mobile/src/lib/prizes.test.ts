import { prizeKindLabel, prizeKindMark, prizePlaceText, prizeSourceLabel, prizeTarget } from "./prizes";
import type { PrizePickup } from "../types";

// Gewinne in der App (#641): ein Gewinn aus einer Verlosung heißt „Verlosung“, hat keinen Platz und führt nirgends hin.

const tournament: PrizePickup = { id: "p1", source_type: "tournament", tournament_id: "t1", tournament_slug: "sommer-cup", tournament_title: "Sommer-Cup", place: 1, place_label: "1." };
const legacy: PrizePickup = { id: "p2", tournament_id: "t2", place: 3 };
const fastlap: PrizePickup = { id: "p3", source_type: "fastlap", fastlap_challenge_id: "c1", fastlap_challenge_slug: "monza", fastlap_source_label: "Gesamtwertung", place: 2 };
const raffle: PrizePickup = { id: "p4", source_type: "season", tournament_title: "Adventkalender 2026", season_source_label: "Türchen 12", place: 0, place_label: "Verlosung", prize_label: "TLS-Hoodie" };

test("wohin die Karte führt", () => {
  expect(prizeTarget(tournament)).toEqual({ kind: "tournament", id: "sommer-cup" });
  expect(prizeTarget(legacy)).toEqual({ kind: "tournament", id: "t2" });
  expect(prizeTarget(fastlap)).toEqual({ kind: "fastlap", id: "monza" });
  expect(prizeTarget(raffle)).toEqual({ kind: "season", id: "" });
});

test("wie die Quelle heißt", () => {
  expect(prizeSourceLabel(tournament)).toBe("Turnier");
  expect(prizeSourceLabel(legacy)).toBe("Turnier");
  expect(prizeSourceLabel(fastlap)).toBe("Gesamtwertung");
  expect(prizeSourceLabel({ id: "p5", source_type: "fastlap" })).toBe("Fast Lap");
  expect(prizeSourceLabel(raffle)).toBe("Verlosung, Türchen 12");
  expect(prizeSourceLabel({ id: "p6", source_type: "season" })).toBe("Verlosung");
  expect(["tournament", "fastlap", "season"].map((kind) => prizeKindLabel(kind as never))).toEqual(["Turnier", "Fast Lap", "Verlosung"]);
  expect(["tournament", "fastlap", "season"].map((kind) => prizeKindMark(kind as never))).toEqual(["T", "FL", "V"]);
});

test("Platz oder Verlosung", () => {
  expect(prizePlaceText(tournament)).toBe("1.");
  expect(prizePlaceText(legacy)).toBe("#3");
  expect(prizePlaceText({ id: "p7", place_label: "Platz 2" })).toBe("#2");
  expect(prizePlaceText({ id: "p8" })).toBe("#");
  expect(prizePlaceText(raffle)).toBe("Verlosung");
  expect(prizePlaceText({ id: "p9", source_type: "season", place: 0 })).toBe("Verlosung");
});
