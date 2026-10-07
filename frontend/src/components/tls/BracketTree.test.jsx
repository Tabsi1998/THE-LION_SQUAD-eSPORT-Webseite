import { describe, expect, it } from "vitest";

import { isTableFormat } from "./BracketTree";

describe("isTableFormat", () => {
  it("erkennt Formate, die über Spieltage laufen", () => {
    // Liga, Gruppen und Schweizer System spielen alle gleichzeitig an einem
    // Spieltag - nebeneinander scrollende Runden wären dafür die falsche Form.
    for (const stage_type of ["league", "round_robin_groups", "swiss"]) {
      expect(isTableFormat([{ stage_type }])).toBe(true);
    }
  });

  it("erkennt K.-o.-Bäume, die von links nach rechts fließen", () => {
    for (const stage_type of ["single_elimination", "double_elimination", "custom_bracket", "simple"]) {
      expect(isTableFormat([{ stage_type }])).toBe(false);
    }
  });

  it("fällt auf den Abschnittsnamen zurück, wenn der Typ fehlt", () => {
    expect(isTableFormat([{ section: "group_A" }])).toBe(true);
    expect(isTableFormat([{ section: "LIGA" }])).toBe(true);
    expect(isTableFormat([{ section: "round_robin" }])).toBe(true);
    expect(isTableFormat([{ section: "swiss" }])).toBe(true);
    expect(isTableFormat([{ section: "WB" }])).toBe(false);
    expect(isTableFormat([{ section: "GF" }])).toBe(false);
  });

  it("zieht den Typ dem Abschnittsnamen vor", () => {
    expect(isTableFormat([{ stage_type: "single_elimination", section: "group_A" }])).toBe(false);
  });

  it("kommt mit leeren Angaben zurecht", () => {
    expect(isTableFormat([])).toBe(false);
    expect(isTableFormat()).toBe(false);
    expect(isTableFormat([{}])).toBe(false);
  });
});

// Turnierbaum (#399): Verbindungslinien je Runde, leere Setzplätze, Durchgang-Karten ohne
// „Platz“ vor dem Spiel, Runde für Runde am Handy, „Dein nächstes Spiel“ für Angemeldete.
const { render, screen, act } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { BracketTree, connectorTargets, nextMatchFor } = await import("./BracketTree");

function knockout() {
  const reg = (id, name) => ({ id, display_name: name, user: {} });
  const slot = (registration_id) => ({ slot: 1, registration_id, status: registration_id ? "filled" : "empty" });
  return {
    registrations: [reg("r1", "Koblauchgeist"), reg("r2", "DerSushi"), reg("r3", "Angos"), reg("r4", "RyuUu")],
    matches_v2: [
      { id: "m1", section: "WB", round: 1, order: 0, match_key: "WA1", status: "completed", slots: [slot("r1"), { slot: 2, registration_id: "r2", status: "filled" }], results: [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 0 }] },
      { id: "m2", section: "WB", round: 1, order: 1, match_key: "WA2", status: "scheduled", scheduled_at: "2026-10-05T18:30:00+02:00", station_label: "Station A", slots: [slot("r3"), { slot: 2, registration_id: "r4", status: "filled" }], results: [] },
      { id: "m3", section: "WB", round: 2, order: 0, match_key: "WF", status: "pending", slots: [slot("r1"), { slot: 2, registration_id: null, status: "empty", source: { raw: "WA2" } }], results: [] },
    ],
  };
}

describe("BracketTree", () => {
  it("verteilt die Verbindungslinien auf die nächste Runde", () => {
    expect(connectorTargets(4, 2)).toEqual([0, 0, 1, 1]);
    expect(connectorTargets(2, 2)).toEqual([0, 1]);
    expect(connectorTargets(3, 1)).toEqual([0, 0, 0]);
    expect(connectorTargets(2, 4)).toEqual([]);
  });

  it("sagt bei leeren Plätzen späterer Runden im Klartext, wer kommt (#1113) - Setzplätze bleiben leer", () => {
    const data = knockout();
    data.matches_v2.push(
      { id: "m4", section: "WB", round: 3, order: 0, match_key: "GF", status: "pending", slots: [
        { slot: 1, registration_id: null, status: "pending", source: { type: "rank", flow: "W", match_key: "WF", rank: 1, raw: "W:WF:1" } },
        { slot: 2, registration_id: null, status: "pending", source: { type: "seed", seed: 5, raw: "5" } },
      ], results: [] },
      { id: "m5", section: "BRONZE", round: 3, order: 1, match_key: "P3", status: "pending", slots: [
        { slot: 1, registration_id: null, status: "pending", source: { type: "rank", flow: "L", match_key: "WA1", rank: 1, raw: "L:WA1:1" } },
        { slot: 2, registration_id: null, status: "bye", source: { type: "bye", raw: "bye" } },
      ], results: [] },
    );
    render(<BracketTree data={data} />);
    const final = screen.getByTestId("bracket-match-v2-m4");
    expect(final).toHaveTextContent("Sieger aus WF");
    expect(final).not.toHaveTextContent("W:WF:1");
    expect(final).toHaveTextContent("—");
    const bronze = screen.getByTestId("bracket-match-v2-m5");
    expect(bronze).toHaveTextContent("Verlierer aus WA1");
    expect(bronze).toHaveTextContent("Freilos");
  });

  it("zeigt den Baum mit leeren Setzplätzen, Sieger-Akzent und Uhrzeit", () => {
    render(<BracketTree data={knockout()} />);
    expect(screen.getByTestId("bracket-tree")).toBeInTheDocument();
    expect(screen.getByTestId("bracket-connectors")).toBeInTheDocument();
    // Der Setzplatz aus „WA2“ bleibt leer - kein Kürzel.
    expect(screen.getByTestId("bracket-match-v2-m3")).not.toHaveTextContent("WA2");
    expect(screen.getByTestId("bracket-match-v2-m3")).toHaveTextContent("—");
    expect(screen.getByTestId("bracket-match-v2-m1")).toHaveTextContent("Koblauchgeist");
    expect(screen.getByTestId("bracket-match-v2-m2")).toHaveTextContent("Station A");
  });

  it("Sieger-Schimmer nur, wenn das Ergebnis gerade eintrifft - und nur über die Siegerzeile (#1076)", () => {
    const { unmount } = render(<BracketTree data={knockout()} />);
    expect(screen.getByTestId("bracket-match-v2-m1").querySelector("[data-sweep]")).toBeNull();
    unmount();
    render(<BracketTree data={knockout()} changedMatchIds={new Set(["m1", "m2"])} />);
    const swept = screen.getByTestId("bracket-match-v2-m1").querySelectorAll("[data-sweep='1']");
    expect(swept).toHaveLength(1);
    expect(swept[0]).toHaveTextContent("Koblauchgeist");
    expect(swept[0]).toHaveClass("tls-winner-sweep");
    // Eine geänderte Partie ohne Ergebnis hat keine Siegerzeile.
    expect(screen.getByTestId("bracket-match-v2-m2").querySelector("[data-sweep]")).toBeNull();
  });

  it("am Handy Runde für Runde mit „Runde x von y“", async () => {
    render(<BracketTree data={knockout()} layout="steps" />);
    expect(screen.getByTestId("bracket-step-label")).toHaveTextContent("Runde 1 von 2");
    expect(screen.getByTestId("bracket-match-v2-m1")).toBeInTheDocument();
    expect(screen.queryByTestId("bracket-match-v2-m3")).toBeNull();
    await act(async () => { await userEvent.click(screen.getByTestId("bracket-step-next")); });
    expect(screen.getByTestId("bracket-step-label")).toHaveTextContent("Runde 2 von 2");
    expect(screen.getByTestId("bracket-match-v2-m3")).toBeInTheDocument();
  });

  it("markiert das eigene nächste Spiel", () => {
    const data = knockout();
    expect(nextMatchFor(data.matches_v2, "r1")?.id).toBe("m3");
    expect(nextMatchFor(data.matches_v2, "r2")).toBeNull();
    render(<BracketTree data={data} mineId="r3" />);
    expect(screen.getByTestId("bracket-next-match")).toHaveTextContent("Dein nächstes Spiel");
    expect(screen.getByTestId("bracket-next-match")).toHaveTextContent("gegen RyuUu");
    expect(screen.getByTestId("bracket-match-v2-m2")).toHaveAttribute("data-mine", "true");
  });

  it("Durchgang: Titel mit Spielerzahl, vor dem Spiel keine Plätze, danach sortiert", () => {
    const reg = (id, name) => ({ id, display_name: name, user: {} });
    const data = {
      registrations: [reg("a", "Anna"), reg("b", "Ben"), reg("c", "Cem"), reg("d", "Dana")],
      matches_v2: [
        { id: "h1", section: "MAIN", round: 1, order: 0, match_key: "A", match_type: "ffa", status: "scheduled", settings: { qualifiers_per_match: 2 }, slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }, { slot: 3, registration_id: "c" }, { slot: 4, registration_id: "d" }], results: [] },
        { id: "h2", section: "MAIN", round: 1, order: 1, match_key: "B", match_type: "ffa", status: "completed", settings: { qualifiers_per_match: 2 }, slots: [{ slot: 1, registration_id: "a" }, { slot: 2, registration_id: "b" }], results: [{ registration_id: "b", rank: 1, score: 15 }, { registration_id: "a", rank: 2, score: 12 }] },
      ],
    };
    render(<BracketTree data={data} />);
    // Zweizeilig statt abgeschnitten (#833): der Name oben, Spielerzahl und Weiterkommer darunter.
    expect(screen.getByTestId("bracket-heat-title-h1")).toHaveTextContent("Durchgang A");
    expect(screen.getByTestId("bracket-heat-meta-h1")).toHaveTextContent("4 Spieler · 2 kommen weiter");
    expect(screen.getByTestId("bracket-heat-h1")).not.toHaveTextContent("Platz");
    expect(screen.getByTestId("bracket-heat-h1")).not.toHaveTextContent("#");
    const played = screen.getByTestId("bracket-heat-h2").textContent;
    expect(played.indexOf("Ben")).toBeLessThan(played.indexOf("Anna"));
    expect(played).toContain("#1");
  });
});

// Turniere I (#833): Kürzel statt leerer Quadrate, der Weg eines Spielers, „nicht gespielt“ nach dem Ende,
// „Spiel um Platz 3“ statt „TP“, atmende Live-Partien.
const { initials, pathState, roundTitle } = await import("./BracketTree");
const { formatBracketSection, formatRoundName } = await import("@/lib/tournamentLabels");

describe("Turniere I", () => {
  it("rechnet Kürzel, Weg und Runden-Kopf", () => {
    expect(initials("Joey Jo-Jo Junior")).toBe("JJ");
    // Zusammengeschriebene Namen geben seit #1113 zwei Buchstaben - wie am TV.
    expect(initials("MrBelt")).toBe("MB");
    expect(initials("NeonFalke")).toBe("NF");
    expect(initials("c1resa")).toBe("C");
    expect(initials("  ")).toBe("");
    expect(pathState(null, ["a"])).toBe("");
    expect(pathState(new Set(["a"]), ["a", "b"])).toBe("on");
    expect(pathState(new Set(["a"]), ["b", null])).toBe("off");
    expect(formatBracketSection("TP")).toBe("Spiel um Platz 3");
    expect(formatRoundName("Platz 3 Match", 1)).toBe("Spiel um Platz 3");
    expect(roundTitle({ round_name: "Platz 3 Match" }, 1, "Spiel um Platz 3")).toBe("");
    expect(roundTitle({ round_name: "Round 2" }, 2, "Winner Bracket")).toBe("Runde 2");
  });

  it("zeigt Kürzel statt leerer Quadrate - leere Plätze bleiben gestrichelt", () => {
    render(<BracketTree data={knockout()} />);
    const node = screen.getByTestId("bracket-match-v2-m1");
    expect(node.querySelector("[data-testid='bracket-initials']")).toHaveTextContent("K");
    const open = screen.getByTestId("bracket-match-v2-m3");
    expect(open.querySelectorAll("[data-testid='bracket-initials']")).toHaveLength(1);
  });

  it("Fahren über einen Namen hebt den Weg hervor, Fokus auf einer Partie die Wege ihrer Spieler", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({ matches: query === "(hover: hover)", addEventListener() {}, removeEventListener() {} });
    try {
      render(<BracketTree data={knockout()} layout="tree" />);
      await userEvent.hover(screen.getAllByText("Koblauchgeist")[0]);
      expect(screen.getByTestId("bracket-match-v2-m1")).toHaveAttribute("data-path", "on");
      expect(screen.getByTestId("bracket-match-v2-m3")).toHaveAttribute("data-path", "on");
      expect(screen.getByTestId("bracket-match-v2-m2")).toHaveAttribute("data-path", "off");
      await userEvent.unhover(screen.getAllByText("Koblauchgeist")[0]);
      expect(screen.getByTestId("bracket-match-v2-m2")).not.toHaveAttribute("data-path");

      // Fokus wie nach einem Tippen (nicht „focus-visible“): kein Weg - die Partie öffnet sich ja.
      act(() => screen.getByTestId("bracket-match-v2-m2").focus());
      expect(screen.getByTestId("bracket-match-v2-m1")).not.toHaveAttribute("data-path");
      act(() => screen.getByTestId("bracket-match-v2-m2").blur());
      // Tastatur-Fokus: die Wege der Spieler dieser Partie.
      const realMatches = window.Element.prototype.matches;
      window.Element.prototype.matches = function matches(selector) { return selector === ":focus-visible" ? true : realMatches.call(this, selector); };
      try {
        act(() => screen.getByTestId("bracket-match-v2-m2").focus());
        expect(screen.getByTestId("bracket-match-v2-m2")).toHaveAttribute("data-path", "on");
        expect(screen.getByTestId("bracket-match-v2-m1")).toHaveAttribute("data-path", "off");
        act(() => screen.getByTestId("bracket-match-v2-m2").blur());
        expect(screen.getByTestId("bracket-match-v2-m1")).not.toHaveAttribute("data-path");
      } finally {
        window.Element.prototype.matches = realMatches;
      }
    } finally {
      window.matchMedia = original;
    }
  });

  it("nach dem Ende heißt Ungespieltes „nicht gespielt“, und es gibt kein „Dein nächstes Spiel“", () => {
    render(<BracketTree data={{ ...knockout(), tournament: { status: "archived" } }} mineId="r3" />);
    expect(screen.getAllByTestId("bracket-not-played")).toHaveLength(2);
    expect(screen.queryByTestId("bracket-next-match")).toBeNull();
  });

  it("eine laufende Partie atmet - nach dem Ende nicht mehr", () => {
    const data = knockout();
    data.matches_v2[1].status = "in_progress";
    const { unmount } = render(<BracketTree data={data} />);
    expect(screen.getByTestId("bracket-match-v2-m2").className).toContain("tls-bracket-live");
    unmount();
    render(<BracketTree data={{ ...data, tournament: { status: "completed" } }} />);
    expect(screen.getByTestId("bracket-match-v2-m2").className).not.toContain("tls-bracket-live");
  });
});

describe("Podium bei mehreren Phasen (#833)", () => {
  it("nur die letzte Phase vergibt Plätze - Vorrunden-Sieger stehen nicht auf dem Podest", async () => {
    const { buildPodiumMap, lastStageId } = await import("./BracketTree");
    const heat = (id, a, b) => ({ id, stage_id: "s0", section: "MAIN", round: 1, status: "completed", slots: [{ registration_id: a }, { registration_id: b }],
      results: [{ registration_id: a, rank: 1 }, { registration_id: b, rank: 2 }] });
    const final = { id: "f", stage_id: "s1", section: "WB", round: 1, status: "completed", slots: [{ registration_id: "c" }, { registration_id: "a" }],
      results: [{ registration_id: "c", rank: 1 }, { registration_id: "a", rank: 2 }] };
    const stages = [{ id: "s0", number: 1 }, { id: "s1", number: 2 }];
    expect(lastStageId([heat("h1", "a", "b"), final], stages)).toBe("s1");
    expect(lastStageId([final], stages)).toBeNull();
    const podium = buildPodiumMap([heat("h1", "a", "b"), heat("h2", "c", "d"), final], stages);
    expect(podium.get("c")).toBe(1);
    expect(podium.get("a")).toBe(2);
    expect(podium.has("b")).toBe(false);
    expect(podium.has("d")).toBe(false);
  });
});
