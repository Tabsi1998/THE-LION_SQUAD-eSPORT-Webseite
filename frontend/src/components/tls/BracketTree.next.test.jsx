import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { clone, decide, doubleElimination, find, heatDoubleElimination, league, singleElimination, start } from "../../../e2e/fixtures/tvBrackets.mjs";
// FFA-Bäume aus dem echten Generator und dem echten Umbau (scripts/make_ffa_bracket_fixture.py) - keine Handarbeit.
import FFA from "../../../e2e/fixtures/ffaGenerated.json";
import { BracketTree } from "./BracketTree";

const ffa = (state) => structuredClone(FFA[state]);
const idOf = (bracket, key) => find(bracket, key).id;
const blankSeeds = (bracket) => {
  const copy = structuredClone(bracket);
  for (const match of copy.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
  return copy;
};

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
  it("Double Elimination mit Reset: Linien ins Loser Bracket, ins Grand Final und in den Reset", async () => {
    render(<BracketTree data={doubleElimination(4, { reset: true })} layout="tree" />);
    const drawn = lines();
    expect(drawn).toContain("m-A>m-C");
    expect(drawn).toContain("m-A>m-LA");
    expect(drawn).toContain("m-LB>m-GF");
    expect(drawn).toContain("m-C>m-GF");
    expect(drawn).toContain("m-GF>m-GFR");
    // Der Fall ins Loser Bracket ist immer da, nur leise gestrichelt; auf dem angetippten Weg voll sichtbar.
    const drop = document.querySelector("[data-testid='bracket-connectors'] path[data-from='m-A'][data-to='m-LA']");
    expect(drop).toHaveAttribute("data-flow", "L");
    expect(drop).toHaveClass("tls-bracket-line--drop");
    expect(drop).not.toHaveAttribute("pathLength");
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");
    expect(css).not.toMatch(/data-cross="1"\]:not\(\[data-path="on"\]\)\s*\{\s*opacity:\s*0;/);
    expect(css).toMatch(/\.tls-bracket-line--drop\s*\{[^}]*stroke-dasharray/);
  });

  it("der Kopf eines Abschnitts ist so breit wie eine Karte - die Gassen bleiben für die Linien frei", () => {
    render(<BracketTree data={doubleElimination(8)} layout="tree" />);
    const heads = document.querySelectorAll("[data-section-head]");
    expect(heads.length).toBe(3);
    for (const head of heads) expect(head.style.maxWidth).toBe("232px");
  });

  it("andere Namen für das Loser Bracket (lower_bracket) zählen wie „LB“", () => {
    const data = doubleElimination(4);
    for (const match of data.matches_v2) if (match.section === "LB") match.section = "lower_bracket";
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId("bracket-section-lower_bracket")).toHaveTextContent("scheidet aus");
    expect(document.querySelector("path[data-from='m-A'][data-to='m-LA']")).toHaveAttribute("data-cross", "1");
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

  it("FFA-Läufe (echter Generator): Linien aus jedem Lauf in den nächsten, auf der Karte „2 kommen weiter → E“", () => {
    const data = ffa("ffa16");
    const id = (key) => idOf(data, key);
    render(<BracketTree data={data} layout="tree" />);
    expect(lines()).toEqual(expect.arrayContaining([`${id("A")}>${id("E")}`, `${id("D")}>${id("E")}`, `${id("E")}>${id("G")}`, `${id("F")}>${id("G")}`]));
    expect(screen.getByTestId(`bracket-heat-cut-${id("A")}`)).toHaveTextContent("2 kommen weiter → E");
  });

  // Läufe mit Loser Bracket gibt es nur als eigenes Schema der Turnierleitung (der Server liest es wie dieses).
  it("Lauf im Doppel-K.-o. (eigenes Schema): wer nicht weiterkommt, geht ins Loser Bracket", () => {
    render(<BracketTree data={heatDoubleElimination()} layout="tree" />);
    expect(screen.getByTestId("bracket-heat-drop-m-A")).toHaveTextContent("→ D");
    expect(screen.getByTestId("bracket-heat-drop-m-C")).toHaveTextContent("→ E");
  });

  it("zusammengelegt (echter Umbau, 8 von 16): alte Läufe als eine Zeile, keine Linie mehr, das Finale ist jetzt E", () => {
    const data = ffa("ffa8_after_merge");
    const id = (key) => idOf(data, key);
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId(`bracket-fate-${id("C")}`)).toHaveTextContent("zusammengelegt in B");
    expect(screen.getByTestId(`bracket-fate-${id("D")}`)).toHaveTextContent("zusammengelegt in A");
    // Die abgekürzte Runde (G, „shortened“) fällt ganz weg - wie in Vorschau 2; sonst stünde „Finale“ zweimal da.
    expect(screen.queryByTestId(`bracket-heat-${id("G")}`)).toBeNull();
    expect(screen.getAllByTestId("bracket-round-title").map((node) => node.textContent)).toEqual(["Runde 1", "Finale"]);
    expect(document.querySelector(`path[data-from='${id("C")}']`)).toBeNull();
    expect(screen.getByTestId(`bracket-heat-meta-${id("E")}`)).toHaveTextContent("Platz 1 gewinnt");
    expect(screen.getByTestId(`bracket-heat-cut-${id("A")}`)).toHaveTextContent("2 kommen weiter → E");
  });

  it("nach dem Umbau werden die Linien neu gemessen: weg aus den alten Läufen, neu in den Sammellauf", () => {
    const before = ffa("ffa8_before_merge");
    const after = ffa("ffa8_after_merge");
    const id = (key) => idOf(after, key);
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    expect(lines()).toContain(`${id("D")}>${id("E")}`);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(lines()).not.toContain(`${id("D")}>${id("E")}`);
    expect(lines().filter((line) => line === `${id("A")}>${id("E")}` || line === `${id("B")}>${id("E")}`)).toHaveLength(4);
  });

  it("Lauf im Finale ohne Folgespiel: „Platz 1 gewinnt“ statt „2 kommen weiter“", () => {
    const data = ffa("ffa16");
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId(`bracket-heat-meta-${idOf(data, "G")}`)).toHaveTextContent("Platz 1 gewinnt");
    expect(screen.getByTestId(`bracket-heat-${idOf(data, "G")}`)).not.toHaveTextContent("kommen weiter");
    expect(screen.getByTestId(`bracket-heat-meta-${idOf(data, "A")}`)).toHaveTextContent("2 kommen weiter");
  });

  it("kein Lauf zeigt mehr Plätze als seine Laufgröße - in allen erzeugten Zuständen", () => {
    for (const state of ["ffa16", "ffa16_round1", "ffa10_balanced", "ffa8_before_merge", "ffa8_after_merge", "ffa40"]) {
      const data = ffa(state);
      const { unmount } = render(<BracketTree data={data} layout="tree" />);
      for (const match of data.matches_v2) {
        const card = screen.queryByTestId(`bracket-heat-${match.id}`);
        if (!card) continue; // eine vom Umbau gestrichene Runde steht nicht mehr da
        const size = Number(match.settings?.match_size || match.slots.length);
        const rows = card.querySelectorAll("[data-slot-anchor]").length;
        const freeText = card.querySelector("[data-testid^='bracket-heat-free-']")?.textContent || "0";
        const free = Number(freeText.match(/[0-9]+/)?.[0] || 0);
        expect(rows + free, `${state} ${match.match_key}`).toBeLessThanOrEqual(size);
        expect(size, `${state} ${match.match_key}`).toBeLessThanOrEqual(4);
      }
      unmount();
    }
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
  it("der Rundentitel trennt nie mitten im Wort", () => {
    render(<BracketTree data={singleElimination(8)} layout="steps" />);
    const title = screen.getByTestId("bracket-round-title");
    expect(title.className).toContain("[hyphens:none]");
    expect(title.className).not.toMatch(/break-words/);
  });

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

  it("kommt ein neuer Stand mitten in der Bewegung, springt alles sofort ans Ende - nichts hängt", () => {
    window.Element.prototype.animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel() {}, onfinish: null }));
    const before = singleElimination(8);
    const middle = decide(clone(before), "A");
    const after = decide(clone(middle), "B");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={middle} layout="tree" />));
    expect(document.querySelectorAll("[data-bracket-flyer]").length).toBeGreaterThan(0);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    // Der erste Flug ist gelandet (kein Abbild mehr von NeonFalke), sein Ziel ist sichtbar.
    const landed = within(screen.getByTestId("bracket-match-v2-m-E")).getByText("NeonFalke").closest("[data-row]");
    expect(landed.style.opacity).toBe("");
    expect([...document.querySelectorAll("[data-bracket-flyer]")].some((node) => node.textContent.includes("NeonFalke"))).toBe(false);
  });

  it("Punkte zählen hoch, statt zu springen - am Ende steht der echte Wert", async () => {
    const before = singleElimination(8);
    const after = decide(clone(before), "A");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    const score = screen.getByTestId("bracket-match-v2-m-A").querySelector("[data-motion='pop'] span");
    expect(score.textContent).toBe("0");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(score.textContent).toBe("22");
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

  it("Auslosung (echter Generator, 16 Fahrer): die Namen kommen nacheinander in die Läufe", () => {
    const after = ffa("ffa16");
    const { rerender } = render(<BracketTree data={blankSeeds(after)} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    const drawn = [...document.querySelectorAll("[data-motion='draw']")];
    expect(drawn).toHaveLength(16);
    expect(drawn.map((node) => Number(node.style.getPropertyValue("--tls-i"))).sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
  });

  it("Zusammenlegen (echter Umbau): die Namen fließen in die Sammelläufe, die alten Läufe verblassen", () => {
    const { rerender } = render(<BracketTree data={ffa("ffa8_before_merge")} layout="tree" />);
    const after = ffa("ffa8_after_merge");
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(window.Element.prototype.animate.mock.calls.length).toBe(4);
    expect(screen.getByTestId(`bracket-heat-${idOf(after, "C")}`)).toHaveAttribute("data-motion", "fade");
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
  it("freie Plätze im Lauf (8 von 16, vor dem Umbau) stehen als eine Zeile, nicht als „Freilos“-Zeilen", () => {
    const data = ffa("ffa8_before_merge");
    const id = idOf(data, "A");
    render(<BracketTree data={data} layout="tree" />);
    const card = screen.getByTestId(`bracket-heat-${id}`);
    expect(within(card).queryAllByText("Freilos")).toHaveLength(0);
    expect(within(card).getByTestId(`bracket-heat-free-${id}`)).toHaveTextContent("2 Plätze frei");
  });

  it("40 Fahrer (echter Generator), lange Namen, leere Läufe vor der Auslosung, Doppel-K.-o. mit Reset", () => {
    const big = ffa("ffa40");
    const { unmount } = render(<BracketTree data={big} layout="tree" />);
    const longNames = screen.getAllByText(/Der unglaublich lange Spielername/);
    expect(longNames.length).toBeGreaterThan(0);
    for (const name of longNames) expect(name.className).not.toMatch(/truncate/);
    unmount();
    const { unmount: unmountEmpty } = render(<BracketTree data={blankSeeds(big)} layout="tree" />);
    expect(screen.getByTestId(`bracket-heat-${idOf(big, "A")}`)).toHaveTextContent("noch leer");
    unmountEmpty();
    render(<BracketTree data={decide(doubleElimination(16, { reset: true }), "A")} layout="tree" />);
    expect(screen.getByTestId("bracket-match-v2-m-GFR")).toBeInTheDocument();
  });
});

// Gegner mischen (#1548): echte Daten aus dem Generator - Sammelschiene vor und nach der Auslosung, Weg, Bewegung.
describe("Gemischte Gruppen im Baum", () => {
  const busOf = (data) => `rail:${data.matches_v2.find((match) => match.settings?.draw_group === "WB:2").stage_id}/WB:2`;
  const path = (from, to) => document.querySelector(`[data-testid='bracket-connectors'] path[data-from='${from}'][data-to='${to}']`);

  it("vor der Auslosung: eine Schiene, Äste aus allen Quellen und in alle Ziele, keine festen Einzel-Linien", () => {
    const data = ffa("se8_draw_before");
    const id = (key) => idOf(data, key);
    render(<BracketTree data={data} layout="tree" />);
    expect(document.querySelector("path[data-rail-group='WB:2']")).not.toBeNull();
    for (const key of ["A", "B", "C", "D"]) {
      expect(path(id(key), busOf(data)), `Ast aus ${key}`).not.toBeNull();
      expect(path(id(key), id("E"))).toBeNull();
      expect(path(id(key), id("F"))).toBeNull();
    }
    expect(path(busOf(data), id("E"))).not.toBeNull();
    expect(path(busOf(data), id("F"))).not.toBeNull();
    expect(screen.getByTestId(`bracket-match-v2-${id("E")}`)).toHaveTextContent("Platz aus Runde 1");
  });

  it("nach der Auslosung: die Schiene bleibt; der echte Weg leuchtet nur auf deinem Weg", () => {
    const data = ffa("se8_draw_after");
    const id = (key) => idOf(data, key);
    render(<BracketTree data={data} layout="tree" />);
    expect(document.querySelector("path[data-rail-group='WB:2']")).not.toBeNull();
    const target = data.matches_v2.find((match) => match.slots.some((slot) => slot.source_result?.from_match_key === "C" && slot.registration_id));
    const player = target.slots.find((slot) => slot.source_result?.from_match_key === "C").registration_id;
    const real = path(id("C"), target.id);
    expect(real).toHaveAttribute("data-real", "1");
    expect(real).not.toHaveAttribute("data-path");
    const name = data.registrations.find((reg) => reg.id === player).display_name;
    fireEvent.click(within(screen.getByTestId(`bracket-match-v2-${target.id}`)).getByText(name));
    expect(real).toHaveAttribute("data-path", "on");
    expect(screen.getByTestId(`bracket-match-v2-${id("C")}`)).toHaveAttribute("data-path", "on");
  });

  it("die Auslosung bewegt die Namen über die Schiene - gestaffelt, der Weg zieht hinter ihnen her", () => {
    const before = ffa("se8_draw_before");
    const after = ffa("se8_draw_after");
    const { rerender } = render(<BracketTree data={before} layout="tree" />);
    act(() => rerender(<BracketTree data={after} layout="tree" />));
    expect(window.Element.prototype.animate.mock.calls.length).toBeGreaterThanOrEqual(4);
    const fresh = [...document.querySelectorAll("path[data-real='1'][data-fresh='1']")];
    expect(fresh).toHaveLength(4);
    const delays = fresh.map((node) => parseInt(node.style.getPropertyValue("--tls-fresh-delay"), 10)).sort((a, b) => a - b);
    expect(new Set(delays).size).toBe(4);
  });

  it("„Bewegung reduzieren“: nach der Auslosung sofort der Endzustand", () => {
    reduce = true;
    const { rerender } = render(<BracketTree data={ffa("se8_draw_before")} layout="tree" />);
    act(() => rerender(<BracketTree data={ffa("se8_draw_after")} layout="tree" />));
    expect(window.Element.prototype.animate.mock.calls.length).toBe(0);
    expect(document.querySelector("[data-fresh]")).toBeNull();
  });

  it("Doppel-K.-o.: jede Gruppe hat ihre Schiene in ihrem Abschnitt; vor der ersten Loser-Spalte ist Platz dafür", () => {
    render(<BracketTree data={ffa("de8_draw_before")} layout="tree" />);
    const spines = [...document.querySelectorAll("path[data-rail-spine]")].map((node) => node.getAttribute("data-rail-group")).sort();
    expect(spines).toEqual(["LB:2", "LB:3", "WB:2"]);
    // Die Schienen bleiben in ihrem Abschnitt: Winner-Schiene im Winner Bracket, Loser-Schienen im Loser Bracket.
    expect(screen.getByTestId("bracket-tree").querySelector("[data-rail-lead='1']")).not.toBeNull();
  });

  it("Läufe in eine gemischte Gruppe sagen „2 kommen weiter → E, F“ (wie die App)", () => {
    const data = ffa("ffa16_draw_before");
    render(<BracketTree data={data} layout="tree" />);
    expect(screen.getByTestId(`bracket-heat-cut-${idOf(data, "D")}`)).toHaveTextContent("2 kommen weiter → E, F");
  });

  it("vor der Auslosung leuchtet dein Weg bis zur Schiene - nur dein Ast und die Schiene", () => {
    const data = ffa("se8_draw_before");
    const a = find(data, "A");
    const winner = data.registrations.find((reg) => reg.id === a.results.find((row) => row.rank === 1).registration_id).display_name;
    render(<BracketTree data={data} layout="tree" />);
    fireEvent.click(within(screen.getByTestId(`bracket-match-v2-${a.id}`)).getByText(winner));
    expect(path(a.id, busOf(data))).toHaveAttribute("data-path", "on");
    expect(document.querySelector("path[data-rail-group='WB:2']")).toHaveAttribute("data-path", "on");
    expect(path(idOf(data, "B"), busOf(data))).toHaveAttribute("data-path", "off");
  });
});

describe("Zwei K.-o.-Phasen mit gemischten Runden", () => {
  it("jede Phase hat ihre eigene Schiene - eindeutige Kennung, keine Äste in die andere Phase", () => {
    const one = ffa("se8_draw_before");
    const tag = (id) => (id ? `${id}#2` : id);
    const copy = structuredClone(one.matches_v2).map((match) => ({
      ...match, id: tag(match.id), stage_id: "phase-2",
      advancement: (match.advancement || []).map((entry) => ({ ...entry, to_match_id: tag(entry.to_match_id) })),
      slots: (match.slots || []).map((slot) => ({ ...slot, registration_id: tag(slot.registration_id) })),
      results: (match.results || []).map((row) => ({ ...row, registration_id: tag(row.registration_id) })),
      winner_id: tag(match.winner_id),
    }));
    const firstStage = one.matches_v2[0].stage_id;
    const data = { ...one, stages: [{ id: firstStage, name: "Vorrunde", number: 1 }, { id: "phase-2", name: "Playoffs", number: 2 }], matches_v2: [...one.matches_v2, ...copy] };
    render(<BracketTree data={data} layout="tree" />);
    const spines = [...document.querySelectorAll("path[data-rail-spine]")].map((node) => node.getAttribute("data-rail-spine"));
    expect(spines).toEqual([`${firstStage}/WB:2`, "phase-2/WB:2"]);
    for (const branch of document.querySelectorAll("path[data-to^='rail:phase-2/']:not([data-rail-spine])")) expect(branch.getAttribute("data-from")).toMatch(/#2$/);
    const ids = [...document.querySelectorAll("[data-testid='bracket-connectors'] path")].map((node) => `${node.closest("[data-testid='bracket-tree']").getAttribute("data-stage")}|${node.getAttribute("data-from")}>${node.getAttribute("data-to")}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
