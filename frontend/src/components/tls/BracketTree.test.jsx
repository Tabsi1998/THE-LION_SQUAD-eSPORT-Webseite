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
    expect(screen.getByTestId("bracket-heat-title-h1")).toHaveTextContent("Durchgang A · 4 Spieler · 2 kommen weiter");
    expect(screen.getByTestId("bracket-heat-h1")).not.toHaveTextContent("Platz");
    expect(screen.getByTestId("bracket-heat-h1")).not.toHaveTextContent("#");
    const played = screen.getByTestId("bracket-heat-h2").textContent;
    expect(played.indexOf("Ben")).toBeLessThan(played.indexOf("Anna"));
    expect(played).toContain("#1");
  });
});
