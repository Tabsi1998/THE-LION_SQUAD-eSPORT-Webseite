import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { clone, decide, doubleElimination, find, heatDoubleElimination, heats, league, singleElimination, start } from "../../../e2e/fixtures/tvBrackets.mjs";
import { BracketTree } from "./BracketTree";

// Web-Turnierbaum neu (#1561): Linien aus den echten Quellen, dein Weg per Tipp (auch am Handy), Live mit Station und
// Spielzeit, Bewegungen aus dem Vergleich alter/neuer Stand - genau einmal, mit „Bewegung reduzieren“ sofort am Ende.

let reduce = false;
let hover = false;
const realMatchMedia = window.matchMedia;
const realRect = window.Element.prototype.getBoundingClientRect;
const realAnimate = window.Element.prototype.animate;

beforeEach(() => {
  reduce = false;
  hover = false;
  window.matchMedia = (query) => ({
    matches: (query.includes("reduce") && reduce) || (query.includes("hover: hover") && hover) || query.includes("min-width: 768px"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  // jsdom misst nichts - jede Karte bekommt eine Größe, damit die Linien gezogen werden.
  window.Element.prototype.getBoundingClientRect = function rect() {
    return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON() {} };
  };
  window.Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null }));
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  window.Element.prototype.getBoundingClientRect = realRect;
  window.Element.prototype.animate = realAnimate;
  document.querySelectorAll("[data-bracket-flyer]").forEach((node) => node.remove());
});

const lines = () => [...document.querySelectorAll("[data-testid='bracket-connectors'] path")].map((path) => `${path.getAttribute("data-from")}>${path.getAttribute("data-to")}`);

describe("Linien aus den echten Quellen", () => {
  it("Double Elimination mit Reset: Linien ins Loser Bracket, ins Grand Final und in den Reset", () => {
    render(<BracketTree data={doubleElimination(4, { reset: true })} layout="tree" />);
    const drawn = lines();
    expect(drawn).toContain("m-A>m-C");
    expect(drawn).toContain("m-A>m-LA");
    expect(drawn).toContain("m-LB>m-GF");
    expect(drawn).toContain("m-C>m-GF");
    expect(drawn).toContain("m-GF>m-GFR");
    // Der Fall ins Loser Bracket ist leise gestrichelt.
    const drop = document.querySelector("[data-testid='bracket-connectors'] path[data-from='m-A'][data-to='m-LA']");
    expect(drop).toHaveAttribute("data-flow", "L");
  });

  it("alte Bäume ohne Herkunft der Plätze bekommen ihre Linien wie früher nach der Reihenfolge - am Web und am TV", () => {
    const strip = (bracket) => { for (const match of bracket.matches_v2) for (const slot of match.slots) delete slot.source; return bracket; };
    const { unmount } = render(<BracketTree data={strip(singleElimination(4))} layout="tree" />);
    expect(lines().sort()).toEqual(["m-A>m-C", "m-B>m-C", "m-C>bracket-champion"]);
    unmount();
    const Card = ({ match }) => <div>{match.match_key}</div>;
    render(<BracketTree data={strip(singleElimination(4))} viewMode="tv" nodeRenderer={Card} tvLayout={{ columns: 4 }} />);
    expect(lines().sort()).toEqual(["m-A>m-C", "m-B>m-C"]);
  });

  it("FFA-Läufe: Linien aus jedem Lauf ins Finale, auf der Karte „2 kommen weiter → C“", () => {
    render(<BracketTree data={heats(8)} layout="tree" />);
    expect(lines()).toEqual(expect.arrayContaining(["m-A>m-C", "m-B>m-C"]));
    expect(screen.getByTestId("bracket-heat-cut-m-A")).toHaveTextContent("2 kommen weiter → C");
  });

  it("Lauf im Doppel-K.-o.: wer nicht weiterkommt, geht ins Loser Bracket", () => {
    render(<BracketTree data={heatDoubleElimination()} layout="tree" />);
    expect(screen.getByTestId("bracket-heat-drop-m-A")).toHaveTextContent("→ D");
    expect(screen.getByTestId("bracket-heat-drop-m-C")).toHaveTextContent("→ E");
  });

  it("zusammengelegter Lauf steht ruhig als eine Zeile „zusammengelegt in A“, seine Linie ist leise", () => {
    const data = heats(16);
    Object.assign(find(data, "B"), { status: "cancelled", merged_into_key: "A", merged_into: "m-A", result_meta: { source: "heat_rebuild", merged_into: "m-A" },
      slots: find(data, "B").slots.map((slot) => ({ ...slot, registration_id: null, status: "bye", moved_to: "m-A" })) });
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId("bracket-fate-m-B")).toHaveTextContent("zusammengelegt in A");
    expect(document.querySelector("path[data-from='m-B']")).toHaveAttribute("data-void", "1");
  });
});

describe("Runden, Freilos, Karten, Pokal", () => {
  it("Rundennamen aus dem Server stehen über den Spalten", () => {
    const data = singleElimination(8);
    for (const match of data.matches_v2) match.round_label = { 1: "Viertelfinale", 2: "Halbfinale", 3: "Finale" }[match.round];
    render(<BracketTree data={data} layout="tree" />);
    const titles = screen.getAllByTestId("bracket-round-title").map((node) => node.textContent);
    expect(titles[0]).toMatch(/^Viertelfinale/);
    expect(titles[1]).toMatch(/^Halbfinale/);
    expect(titles[2]).toMatch(/^Finale/);
  });

  it("ein Freilos ist eine schmale Zeile ohne Zeit und Station", () => {
    const data = singleElimination(4);
    const a = find(data, "A");
    a.slots[1] = { slot: 2, registration_id: null, status: "bye", source: { type: "bye", raw: "bye" } };
    Object.assign(a, { status: "completed", winner_id: "r1", station_label: "PC 3", scheduled_at: "2026-10-31T14:00:00+01:00", result_meta: { source: "auto_bye" } });
    render(<BracketTree data={data} layout="tree" />);
    const line = screen.getByTestId("bracket-bye-m-A");
    expect(line).toHaveTextContent("Freilos: NeonFalke kommt weiter");
    expect(line).not.toHaveTextContent("PC 3");
  });

  it("der Sieger trägt `is-winner`, der Pokal am Ende nennt ihn - vorher „noch offen“", () => {
    const data = singleElimination(4);
    const { unmount } = render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId("bracket-champion")).toHaveTextContent("noch offen");
    unmount();
    const done = decide(decide(decide(clone(data), "A"), "B"), "C");
    render(<BracketTree data={done} layout="tree" />);
    expect(screen.getByTestId("bracket-champion")).toHaveTextContent("NeonFalke");
    const winnerRow = within(screen.getByTestId("bracket-match-v2-m-A")).getByText("NeonFalke").closest("[data-row]");
    expect(winnerRow).toHaveClass("is-winner");
    expect(document.querySelector("path[data-to='bracket-champion']")).not.toBeNull();
  });

  it("Gruppen, Liga und Swiss sind keine Baum-Spalten, sondern ein Verweis auf Tabelle und Spielplan", () => {
    render(<BracketTree data={league(4)} layout="tree" />);
    const hint = screen.getByTestId("bracket-table-hint");
    expect(hint).toHaveTextContent("Tabelle");
    expect(hint.querySelector("a[href='/tournaments/herbst-cup/standings']")).not.toBeNull();
    expect(hint.querySelector("a[href='/tournaments/herbst-cup/matches']")).not.toBeNull();
    expect(screen.queryByTestId("bracket-tree")).toBeNull();
  });
});

describe("Dein Weg per Tipp", () => {
  it("ein Tipp auf einen Namen zeigt den Weg - auch ohne Maus; ein Tipp ins Leere hebt ihn auf", () => {
    const data = decide(singleElimination(8), "A");
    render(<BracketTree data={data} layout="tree" />);
    fireEvent.click(within(screen.getByTestId("bracket-match-v2-m-A")).getByText("NeonFalke"));
    expect(screen.getByTestId("bracket-match-v2-m-A")).toHaveAttribute("data-path", "on");
    expect(screen.getByTestId("bracket-match-v2-m-E")).toHaveAttribute("data-path", "on");
    expect(screen.getByTestId("bracket-match-v2-m-B")).toHaveAttribute("data-path", "off");
    expect(document.querySelector("path[data-from='m-A'][data-to='m-E']")).toHaveAttribute("data-path", "on");
    fireEvent.click(screen.getByTestId("bracket-tree"));
    expect(screen.getByTestId("bracket-match-v2-m-B")).not.toHaveAttribute("data-path");
  });

  it("am Handy (Runde für Runde) genauso, Escape hebt auf", () => {
    render(<BracketTree data={singleElimination(4)} layout="steps" />);
    fireEvent.click(within(screen.getByTestId("bracket-match-v2-m-A")).getByText("NeonFalke"));
    expect(screen.getByTestId("bracket-match-v2-m-B")).toHaveAttribute("data-path", "off");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("bracket-match-v2-m-B")).not.toHaveAttribute("data-path");
  });
});

describe("Runde für Runde", () => {
  it("die neue Runde kommt von der Seite, in die geblättert wurde", () => {
    render(<BracketTree data={singleElimination(8)} layout="steps" />);
    fireEvent.click(screen.getByTestId("bracket-step-next"));
    expect(screen.getByTestId("bracket-match-v2-m-E").parentElement).toHaveAttribute("data-step-dir", "next");
    fireEvent.click(screen.getByTestId("bracket-step-prev"));
    expect(screen.getByTestId("bracket-match-v2-m-A").parentElement).toHaveAttribute("data-step-dir", "prev");
  });
});

describe("Live", () => {
  it("ein laufendes Spiel atmet und zeigt Station und Spielzeit", () => {
    const data = start(singleElimination(4), "A", { station: "PC 3", startedAt: new Date(Date.now() - 125000).toISOString() });
    render(<BracketTree data={data} layout="tree" />);
    const card = screen.getByTestId("bracket-match-v2-m-A");
    expect(card.className).toContain("tls-bracket-live");
    expect(card).toHaveTextContent("PC 3");
    expect(within(card).getByTestId("bracket-live-clock")).toHaveTextContent(/^0?2:0[5-9]$/);
  });

  it("am Handy stehen laufende Spiele oben angepinnt", () => {
    const data = start(singleElimination(8), "C", { station: "Switch 2" });
    render(<BracketTree data={data} layout="steps" />);
    const strip = screen.getByTestId("bracket-live-strip");
    expect(strip).toHaveTextContent("Switch 2");
    expect(strip).toHaveTextContent("KartKönigin");
  });
});

describe("Bewegungen beim Live-Neuladen", () => {
  const flyers = () => window.Element.prototype.animate.mock.calls.length;

  it("Weiterkommen: Plätze poppen, der Sieger gleitet ins nächste Spiel, die Linie zieht nach - genau einmal", () => {
    const before = singleElimination(8);
    const after = decide(clone(before), "A");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(flyers()).toBeGreaterThan(0);
    expect(screen.getByTestId("bracket-match-v2-m-A").querySelector("[data-motion='pop']")).not.toBeNull();
    expect(document.querySelector("path[data-from='m-A'][data-to='m-E']")).toHaveAttribute("data-fresh", "1");
    const calls = flyers();
    // Derselbe Stand noch einmal (z. B. nach einer Neuverbindung): nichts wird nachgeholt.
    act(() => rerender(<BracketTree data={clone(after)} layout="tree" />));
    expect(flyers()).toBe(calls);
  });

  it("nach einer Neuverbindung wird nichts nachgeholt", () => {
    const before = singleElimination(8);
    const after = decide(clone(before), "A");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" quietUpdate />));
    expect(flyers()).toBe(0);
    expect(screen.getByTestId("bracket-match-v2-m-E")).toHaveTextContent("NeonFalke");
  });

  it("„Bewegung reduzieren“: sofort der Endzustand, keine Bewegung", () => {
    reduce = true;
    const before = singleElimination(8);
    const after = decide(clone(before), "A");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(flyers()).toBe(0);
    expect(document.querySelector("[data-bracket-flyer]")).toBeNull();
    expect(document.querySelector("[data-motion]")).toBeNull();
    const target = within(screen.getByTestId("bracket-match-v2-m-E")).getByText("NeonFalke");
    expect(target.closest("[data-row]").style.opacity).toBe("");
  });

  it("Sieger-Moment: steht das Finale fest, schimmert der Pokal einmal", () => {
    const before = decide(decide(singleElimination(4), "A"), "B");
    const after = decide(clone(before), "C");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    expect(screen.getByTestId("bracket-champion")).not.toHaveAttribute("data-sweep");
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(screen.getByTestId("bracket-champion")).toHaveAttribute("data-sweep", "1");
  });

  it("Auslosung: die Namen kommen nacheinander in die Läufe", () => {
    const after = heats(8);
    const before = clone(after);
    for (const match of before.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    const drawn = [...document.querySelectorAll("[data-motion='draw']")];
    expect(drawn).toHaveLength(8);
    expect(drawn.map((node) => node.style.getPropertyValue("--tls-i"))).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
  });

  it("kampflos: Schild „kampflos“, der Platz blinkt einmal; ausgefallen: durchgestrichen", () => {
    const before = singleElimination(4);
    const after = clone(before);
    Object.assign(find(after, "A"), { status: "forfeit", winner_id: "r1", results: [{ registration_id: "r1", rank: 1 }, { registration_id: "r4", rank: 2, forfeit: true }] });
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    const card = screen.getByTestId("bracket-match-v2-m-A");
    expect(card).toHaveTextContent("kampflos");
    expect(card.querySelector("[data-motion='blink']")).not.toBeNull();
    expect(within(card).getByText(after.registrations[3].display_name).closest("[data-row]")).toHaveAttribute("data-out", "1");
  });
});

describe("Worst Case (break-ui)", () => {
  it("freie Plätze im Lauf stehen als eine Zeile, nicht als vier „Freilos“-Zeilen", () => {
    const data = heats(8);
    const a = find(data, "A");
    a.slots = a.slots.map((slot, index) => (index >= 2 ? { ...slot, registration_id: null, status: "bye" } : slot));
    render(<BracketTree data={data} layout="tree" />);
    const card = screen.getByTestId("bracket-heat-m-A");
    expect(within(card).queryAllByText("Freilos")).toHaveLength(0);
    expect(within(card).getByTestId("bracket-heat-free-m-A")).toHaveTextContent("2 Plätze frei");
  });


  it("40 Teilnehmer in Läufen, lange Namen, leere Läufe, Freilose und Doppel-K.-o. mit Reset", () => {
    const big = heats(32, { size: 8, qualifiers: 2 });
    big.registrations[0].display_name = "Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter";
    for (let index = 32; index < 40; index += 1) big.registrations.push({ id: `r${index + 1}`, display_name: `Gast ${index + 1}` });
    big.matches_v2.push({ ...clone(find(big, "A")), id: "m-X", match_key: "X", order: 50, slots: Array.from({ length: 8 }, (_, index) => ({ slot: index + 1, registration_id: null, status: "bye" })) });
    const { unmount } = render(<BracketTree data={big} layout="tree" />);
    const longNames = screen.getAllByText(/Der unglaublich lange Spielername/);
    expect(longNames.length).toBeGreaterThan(0);
    for (const name of longNames) expect(name.className).not.toMatch(/truncate/);
    expect(screen.getByTestId("bracket-heat-m-X")).toHaveTextContent("noch leer");
    unmount();
    render(<BracketTree data={decide(doubleElimination(16, { reset: true }), "A")} layout="tree" />);
    expect(screen.getByTestId("bracket-match-v2-m-GFR")).toBeInTheDocument();
  });
});
