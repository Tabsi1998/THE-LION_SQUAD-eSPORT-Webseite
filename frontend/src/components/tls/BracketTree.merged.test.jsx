// Baum mit zusammengelegten Läufen (#2452) - der Läufe-Cup vom 31.10. aus dem echten Generator und Umbau
// (scripts/make_ffa_bracket_fixture.py --merged): 14 Läufe, B in A, D in C, F in E, LB in LA, LD in LC zusammengelegt.
// Nach dem Ende: die zusammengelegten Läufe sagen, wohin; „Plätze frei“ steht nicht mehr in gefahrenen Läufen; der
// Sieger trägt im Grand Final seine Medaille.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MERGED from "../../../e2e/fixtures/mergedHeatsGenerated.json";
import FFA from "../../../e2e/fixtures/ffaGenerated.json";
import { BracketTree } from "./BracketTree";
import { TournamentFlowStepper } from "./TournamentFlowStepper";

const state = (name) => structuredClone(MERGED[name]);
const byKey = (data, key) => data.matches_v2.find((match) => match.match_key === key);

describe("Läufe-Cup mit zusammengelegten Läufen", () => {
  it("der echte Baum: 14 Läufe, fünf zusammengelegt, neun gefahren", () => {
    const data = state("lb8_merged_done");
    expect(data.matches_v2).toHaveLength(14);
    const merged = Object.fromEntries(data.matches_v2.filter((match) => match.status === "cancelled").map((match) => [match.match_key, match.merged_into_key]));
    expect(merged).toEqual({ B: "A", D: "C", F: "E", LB: "LA", LD: "LC" });
  });

  it("Turnier-Ablauf: 9 Spiele, Ergebnisse 9/9 - mit offenem Grand Final 8/9", () => {
    const done = state("lb8_merged_done");
    const { unmount } = render(<TournamentFlowStepper tournament={done.tournament} registrations={done.registrations} matchesV2={done.matches_v2} />);
    expect(screen.getByTestId("flow-step-bracket")).toHaveTextContent("9 Spiele");
    expect(screen.getByTestId("flow-step-results")).toHaveTextContent("9/9");
    expect(screen.getByTestId("flow-step-standings")).toHaveAttribute("aria-current", "step");
    unmount();
    const live = state("lb8_merged_live");
    render(<TournamentFlowStepper tournament={{ ...live.tournament, status: "live" }} registrations={live.registrations} matchesV2={live.matches_v2} />);
    expect(screen.getByTestId("flow-step-results")).toHaveTextContent("8/9");
  });

  it("nach dem Ende: zusammengelegt in …, kein „Plätze frei“ in Lauf G und im Grand Final, Medaillen im Grand Final", () => {
    const data = state("lb8_merged_done");
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId(`bracket-fate-${byKey(data, "B").id}`)).toHaveTextContent("zusammengelegt in A");
    expect(screen.getByTestId(`bracket-fate-${byKey(data, "LD").id}`)).toHaveTextContent("zusammengelegt in LC");
    for (const key of ["G", "FINAL", "LE", "LF"]) {
      expect(screen.queryByTestId(`bracket-heat-free-${byKey(data, key).id}`)).toBeNull();
    }
    const final = screen.getByTestId(`bracket-heat-${byKey(data, "FINAL").id}`);
    expect(final.querySelectorAll(".tls-bracket-row.is-podium")).toHaveLength(2);
    expect(within(final).getByTestId(`bracket-heat-meta-${byKey(data, "FINAL").id}`)).toHaveTextContent("2 Spieler");
  });

  it("vor dem Grand Final: der offene Lauf sagt „2 Plätze bleiben leer“ - dorthin kommt niemand mehr", () => {
    const data = state("lb8_merged_live");
    render(<BracketTree data={{ ...data, tournament: { ...data.tournament, status: "live" } }} layout="tree" />);
    expect(screen.getByTestId(`bracket-heat-free-${byKey(data, "FINAL").id}`)).toHaveTextContent("2 Plätze bleiben leer");
    expect(screen.queryByText("2 Plätze frei")).toBeNull();
    // Lauf G ist schon gefahren: dort steht keine Zeile mehr.
    expect(screen.queryByTestId(`bracket-heat-free-${byKey(data, "G").id}`)).toBeNull();
  });
});

// Gemischte Runde (draw_round, #1548): ein gestrichener Platz ohne Los-Kennung wartet weiter aufs Los - dort kann noch
// jemand hinkommen. Der Baum aus dem echten Umbau: 8 von 16 gemischt und zusammengelegt (ffa8_shuffle_merged).
describe("Gemischte Runde nach dem Zusammenlegen", () => {
  it("die Plätze heißen weiter „frei“, nicht „bleiben leer“", () => {
    const data = structuredClone(FFA.ffa8_shuffle_merged);
    const heat = byKey(data, "E");
    expect(heat.slots.some((slot) => slot.source_result?.skipped && slot.source?.draw && !slot.source_result.draw_id)).toBe(true);
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId(`bracket-heat-free-${heat.id}`)).toHaveTextContent("2 Plätze frei");
  });
});

// Ein Name aus einem Wort bricht nie mitten im Wort um (#2452, „KartKönigi / n“ im Grand Final): er endet mit „…“, der
// ganze Name steht im Hinweis. Namen mit Leerzeichen dürfen weiter umbrechen.
describe("Namen in der Karte", () => {
  it("ein Wort: gekürzt mit vollem Namen im Hinweis; mehrere Wörter: Umbruch wie bisher", () => {
    const data = state("lb8_merged_done");
    const final = byKey(data, "FINAL");
    const second = final.slots.find((slot) => slot.registration_id && slot.registration_id !== final.results[0].registration_id).registration_id;
    const reg = data.registrations.find((row) => row.id === second);
    const long = "Der sehr lange Name";
    data.registrations = data.registrations.map((row) => (row.id === final.results[0].registration_id ? { ...row, display_name: long, ingame_name: long } : row));
    render(<BracketTree data={data} layout="tree" />);
    const card = screen.getByTestId(`bracket-heat-${final.id}`);
    const single = within(card).getByText(reg.display_name);
    expect(single.className).toMatch(/truncate/);
    expect(single).toHaveAttribute("title", reg.display_name);
    const words = within(card).getByText(long);
    expect(words.className).not.toMatch(/truncate/);
    expect(words).not.toHaveAttribute("title");
  });
});
