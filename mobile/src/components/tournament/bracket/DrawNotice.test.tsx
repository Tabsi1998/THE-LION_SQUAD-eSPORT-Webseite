import React from "react";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import type { MotionPlan } from "../../../lib/bracketMotion";
import type { CardModel } from "../../../lib/bracketCards";
import { auditTree, findingLines, type A11yNode } from "../../../a11y/audit";
import { BracketCard } from "./BracketCard";
import { ASSIGNED_NOTE_MS, DrawNotice, assignedText } from "./DrawNotice";

// Auslosung als Moment (#1633): der Hinweis über dem Baum und die Karte, die sich anhebt - ruhig, genau einmal, bei
// „Bewegung reduzieren“ sofort im Endzustand.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const plan = (patch: Partial<MotionPlan>): MotionPlan => ({
  results: new Set(), rows: new Map(), walkovers: new Set(), fates: new Set(), lifts: new Map(), ready: [], assigned: [], draw: true, key: "k1", ...patch,
});
const matches = [{ id: "e", match_key: "E" }, { id: "f", match_key: "F" }];
const names: Record<string, string> = { r1: "NeonFalke", r2: "PixelPaula" };
const nameOf = (id: string) => names[id] || "";
const one = (mode: "instant" | "draw_show") => [{ key: "s", title: "Turnierbaum", mode }];

test("zufällig gezogen: wie am TV, ein Name oder die Zahl", () => {
  expect(assignedText([{ matchId: "e", registrationId: "r1" }], matches, nameOf)).toBe("Zufällig gezogen · NeonFalke → E");
  expect(assignedText([{ matchId: "e", registrationId: "r1" }, { matchId: "f", registrationId: "r2" }], matches, nameOf)).toBe("Zufällig gezogen · 2 Namen auf ihre Plätze");
  expect(assignedText([], matches, nameOf)).toBe("");
});

test("der Hinweis „zufällig gezogen“ geht nach ein paar Sekunden von selbst", async () => {
  jest.useFakeTimers();
  try {
    await render(<DrawNotice modes={one("instant")} statuses={[]} ready={[]} plan={plan({ assigned: [{ matchId: "e", registrationId: "r1" }] })} matches={matches} nameOf={nameOf} reduce={false} />);
    expect(screen.getByTestId("bracket-draw-assigned")).toHaveTextContent("Zufällig gezogen · NeonFalke → E");
    await act(async () => { jest.advanceTimersByTime(ASSIGNED_NOTE_MS - 100); });
    expect(screen.getByTestId("bracket-draw-assigned")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(screen.queryByTestId("bracket-draw-assigned")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("Topf steht: der Hinweis kommt herein - bei „Bewegung reduzieren“ steht er sofort da", async () => {
  const ready = [{ key: "s/WB:2", group: "WB:2", label: "Runde 1", matchIds: ["e", "f"], names: 4, since: "x" }];
  const moment = plan({ ready });
  const view = await render(<DrawNotice modes={one("draw_show")} statuses={[]} ready={ready} plan={moment} matches={matches} nameOf={nameOf} reduce={false} />);
  expect(StyleSheet.flatten(screen.getByTestId("bracket-draw-ready").props.style).animationName).toBeTruthy();
  await view.rerender(<DrawNotice modes={one("draw_show")} statuses={[]} ready={ready} plan={moment} matches={matches} nameOf={nameOf} reduce />);
  expect(screen.getByTestId("bracket-draw-ready")).toHaveTextContent(/Auslosung bereit · 4 Namen/);
  expect(StyleSheet.flatten(screen.getByTestId("bracket-draw-ready").props.style).animationName).toBeUndefined();
});

describe("die Karte hebt sich", () => {
  const model: CardModel = {
    id: "e", key: "E", kind: "duel", title: "E", height: 94, rowHeight: 32, rows: [], cutAfter: -1,
    text: { name: "E", meta: "", cut: "", rest: "", free: "" }, line: null, walkover: false, mine: false, empty: false, drawState: "ready", anchor: () => 0,
  };
  const card = (reduce: boolean) => (
    <BracketCard model={model} x={0} y={0} w={200} status="Auslosung bereit" live={null} dim={false} selected={null}
      motion={{ lift: { delay: 90, tone: "ready" }, key: "k1" }} reduce={reduce} onOpen={() => {}} onToggle={() => {}} />
  );

  test("sanft an, nur transform - mit Versatz", async () => {
    await render(card(false));
    const style = StyleSheet.flatten(screen.getByTestId("bracket-card-e").props.style);
    expect(style.animationName).toBeTruthy();
    expect(style.animationDelay).toBe(90);
    expect(screen.getByTestId("bracket-lift-e")).toBeTruthy();
  });

  test("„Bewegung reduzieren“: sofort Endzustand, kein Aufleuchten - der goldene Rand bleibt", async () => {
    const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await render(card(true));
    const style = StyleSheet.flatten(screen.getByTestId("bracket-card-e").props.style);
    expect(style.animationName).toBeUndefined();
    expect(style.borderColor).toBe("rgba(255,215,0,0.5)");
    expect(screen.getByTestId("bracket-lift-e").children.length).toBe(0);
    spy.mockRestore();
  });
});

test("ein neuer Stand ohne gezogenen Platz lässt den Hinweis trotzdem gehen", async () => {
  jest.useFakeTimers();
  try {
    const props = { modes: one("instant"), statuses: [], ready: [], matches, nameOf, reduce: false };
    const view = await render(<DrawNotice {...props} plan={plan({ assigned: [{ matchId: "e", registrationId: "r1" }] })} />);
    await view.rerender(<DrawNotice {...props} plan={plan({ key: "k2" })} />);
    expect(screen.getByTestId("bracket-draw-assigned")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(ASSIGNED_NOTE_MS + 100); });
    expect(screen.queryByTestId("bracket-draw-assigned")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

// Große Schrift (#1633, Codex): kein Deckel, nichts auf eine Zeile gekürzt - die Prüf-Hilfe der App (a11y/audit) findet
// nichts. Mehrere Phasen mit verschiedenen Modi: je Phase eine Zeile.
test("große Schrift: alles wächst mit und bricht um; je Phase ihr Modus", async () => {
  const modes = [{ key: "A", title: "Vorrunde", mode: "fixed" as const }, { key: "B", title: "Finalrunde", mode: "draw_show" as const }];
  const ready = [{ key: "B/WB:2", group: "WB:2", label: "Runde 1", matchIds: ["e"], names: 4, since: "x" }];
  const statuses = [{ key: "B/WB:2", round: "Halbfinale", text: "das Los entscheidet", tone: "instant" as const }];
  await render(<DrawNotice modes={modes} statuses={statuses} ready={ready} plan={plan({ assigned: [{ matchId: "e", registrationId: "r1" }] })} matches={matches} nameOf={nameOf} reduce />);
  const rows = screen.getAllByTestId("bracket-mode-stage");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Vorrunde: Fester Baum");
  expect(rows[1]).toHaveTextContent("Finalrunde: Show-Auslosung");
  expect(screen.getByTestId("bracket-draw-ready")).toHaveTextContent(/sonst lost der Server nach der Frist selbst/);
  const findings = findingLines(auditTree(screen.root as unknown as A11yNode)).filter((line) => /^(scaling|clip|target)/.test(line));
  expect(findings).toEqual([]);
});
