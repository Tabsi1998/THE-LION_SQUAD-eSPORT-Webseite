import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
// TV-Bäume aus dem echten Generator und den echten Routen, so wie der Beamer sie bekommt (scripts/make_tv_bracket_fixture.py).
import TVG from "../../../e2e/fixtures/tvGenerated.json";
import { BracketTree } from "./BracketTree";
import { TvTreeNode } from "@/components/tv/TvTreeNode";
import { pathHits } from "@/lib/bracketLines";

// TV-Baum mit denselben Regeln wie der Web-Baum (#1564): die Linien kommen aus lib/bracketGraph (Quellen der Plätze),
// geführt mit lib/bracketLines (nur durch Gassen) - über die Blöcke hinweg: der Abstieg ins Loser Bracket (leise), die
// Linien ins Grand Final und in den Reset. Eine Leinwand je Phase, die Linien enden in der Zeile des Platzes.

const state = (name) => structuredClone(TVG[name]);
const idOf = (bracket, key) => bracket.matches_v2.find((match) => match.match_key === key).id;
const realRect = window.Element.prototype.getBoundingClientRect;

// jsdom misst nichts: jede Karte bekommt ihren Platz aus Spalte (Runde) und Reihe (Reihenfolge), damit die Führung echte
// Hindernisse hat. Abschnitte liegen untereinander (WB oben, LB darunter, GF rechts).
function layoutRects(bracket) {
  const top = { WB: 0, LB: 2000, GF: 0 };
  const left = { WB: 0, LB: 0, GF: 3000 };
  const byId = new Map(bracket.matches_v2.map((match) => [match.id, match]));
  window.Element.prototype.getBoundingClientRect = function rect() {
    // Der Blocktitel ist eine ganze Zeile über dem Block - nur Marke und Text darin sind wirklich belegt.
    const titleOf = this.classList?.contains("tv-block__title") ? this : this.parentElement?.classList?.contains("tv-block__title") ? this.parentElement : null;
    const block = titleOf ? titleOf.closest("[data-tv-block]")?.getAttribute("data-tv-block") : this.getAttribute?.("data-tv-block");
    if (block) {
      const own = bracket.matches_v2.filter((match) => String(match.section).toLowerCase() === block);
      const x1 = Math.min(...own.map((match) => left[match.section] + (match.round - 1) * 300));
      const x2 = Math.max(...own.map((match) => left[match.section] + (match.round - 1) * 300 + 240));
      const y1 = Math.min(...own.map((match) => top[match.section] + (match.order || 0) * 160)) - 60;
      const y2 = Math.max(...own.map((match) => top[match.section] + (match.order || 0) * 160 + 120));
      if (titleOf === this) return { left: x1, top: y1, right: x2, bottom: y1 + 30, width: x2 - x1, height: 30, x: x1, y: y1, toJSON() {} };
      if (titleOf) return { left: x1, top: y1, right: x1 + 200, bottom: y1 + 30, width: 200, height: 30, x: x1, y: y1, toJSON() {} };
      return { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1, x: x1, y: y1, toJSON() {} };
    }
    const card = this.closest?.("[data-tv-card]");
    const id = card?.getAttribute("data-tv-card");
    const match = id ? byId.get(id) : null;
    if (!match) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
    const x = left[match.section] + (match.round - 1) * 300;
    const y = top[match.section] + (match.order || 0) * 160;
    const slot = this.getAttribute?.("data-slot-anchor");
    if (slot) {
      const index = Number(slot.split(":").pop()) - 1;
      return { left: x, top: y + 40 + index * 40, right: x + 240, bottom: y + 80 + index * 40, width: 240, height: 40, x, y, toJSON() {} };
    }
    return { left: x, top: y, right: x + 240, bottom: y + 120, width: 240, height: 120, x, y, toJSON() {} };
  };
}

beforeEach(() => {
  window.Element.prototype.getBoundingClientRect = realRect;
});

afterEach(() => {
  window.Element.prototype.getBoundingClientRect = realRect;
});

const paths = () => [...document.querySelectorAll("[data-testid='bracket-connectors'] path")];
const line = (from, to) => document.querySelector(`[data-testid='bracket-connectors'] path[data-from='${from}'][data-to='${to}']`);

describe("TV-Linien aus den echten Quellen (#1564)", () => {
  it("Doppel-K.-o. mit Reset: Abstieg ins Loser Bracket leise, Linien ins Grand Final und in den Reset - über die Blöcke", () => {
    const data = state("de16");
    layoutRects(data);
    render(<BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={{ columns: 4 }} />);
    // Eine Leinwand je Phase - nicht mehr je Block.
    expect(document.querySelectorAll("[data-testid='bracket-connectors']")).toHaveLength(1);
    const drop = paths().find((path) => path.getAttribute("data-flow") === "L");
    expect(drop).toBeTruthy();
    expect(drop).toHaveAttribute("data-cross", "1");
    expect(drop).toHaveClass("tls-bracket-line--drop");
    const gf = idOf(data, "GF");
    const into = paths().filter((path) => path.getAttribute("data-to") === gf).map((path) => data.matches_v2.find((match) => match.id === path.getAttribute("data-from")).section);
    expect(new Set(into)).toEqual(new Set(["WB", "LB"]));
    expect(line(gf, idOf(data, "GFR"))).not.toBeNull();
  });

  it("jede Linie endet in der Zeile ihres Platzes und schneidet keine Karte", () => {
    const data = state("de16");
    layoutRects(data);
    render(<BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={{ columns: 4 }} />);
    const cards = [...document.querySelectorAll("[data-tv-card]")].map((node) => node.getBoundingClientRect());
    expect(paths().length).toBeGreaterThan(20);
    for (const path of paths()) {
      const points = path.getAttribute("data-points").split(" ").map((pair) => pair.split(",").map(Number)).map(([x, y]) => ({ x, y }));
      const rectOf = (id) => document.querySelector(`[data-tv-card='${id}']`).getBoundingClientRect();
      const same = (a, b) => a.left === b.left && a.top === b.top;
      const from = rectOf(path.getAttribute("data-from"));
      const to = rectOf(path.getAttribute("data-to"));
      const others = cards.filter((rect) => !same(rect, from) && !same(rect, to));
      expect(pathHits(points, others), `${path.getAttribute("data-from")} > ${path.getAttribute("data-to")}`).toBe(false);
      // Der letzte Punkt liegt auf der Höhe des Ziel-Platzes (Zeile), nicht in der Kartenmitte.
      const slot = Number(path.getAttribute("data-to-slot"));
      const anchor = document.querySelector(`[data-slot-anchor='${path.getAttribute("data-to")}:${slot}']`)?.getBoundingClientRect();
      if (anchor) expect(points.at(-1).y).toBe(anchor.top + anchor.height / 2);
    }
  });

  it("entfällt der Reset, ist seine Linie gestrichelt und leise", () => {
    const data = state("de16_no_reset");
    layoutRects(data);
    render(<BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={{ columns: 4 }} />);
    const reset = line(idOf(data, "GF"), idOf(data, "GFR"));
    expect(reset).toHaveAttribute("data-void", "1");
    expect(reset).toHaveClass("tls-bracket-line--void");
  });
});

describe("Sammelschiene am TV (#1548, wie im Web-Baum)", () => {
  it("vor der Auslosung: eine Schiene mit Ästen aus allen Quellspielen und in alle Zielspiele - keine festen Linien", () => {
    const data = state("se8_mixed");
    layoutRects(data);
    render(<BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={{ columns: 4 }} />);
    expect(document.querySelector("[data-rail-spine='WB:2']")).not.toBeNull();
    const branchesIn = paths().filter((path) => path.getAttribute("data-to") === "rail:WB:2" && !path.hasAttribute("data-rail-spine")).map((path) => path.getAttribute("data-from"));
    expect(new Set(branchesIn)).toEqual(new Set(["A", "B", "C", "D"].map((key) => idOf(data, key))));
    const branchesOut = paths().filter((path) => path.getAttribute("data-from") === "rail:WB:2" && !path.hasAttribute("data-rail-spine")).map((path) => path.getAttribute("data-to"));
    expect(new Set(branchesOut)).toEqual(new Set(["E", "F"].map((key) => idOf(data, key))));
    expect(line(idOf(data, "A"), idOf(data, "E"))).toBeNull();
  });

  it("nach der Auslosung: die Schiene bleibt, der echte Weg über sie liegt unsichtbar darunter - die Bahn der Fahrt", () => {
    const data = state("se8_mixed_drawn");
    layoutRects(data);
    render(<BracketTree data={data} viewMode="tv" nodeRenderer={TvTreeNode} tvLayout={{ columns: 4 }} />);
    expect(document.querySelector("[data-rail-spine='WB:2']")).not.toBeNull();
    const e = data.matches_v2.find((match) => match.match_key === "E");
    const from = idOf(data, e.slots[1].source_result.from_match_key);
    const real = line(from, e.id);
    expect(real).toHaveAttribute("data-real", "1");
    expect(real).toHaveClass("tls-bracket-line--real");
    expect(real.getAttribute("data-points")).toBeTruthy();
  });
});
