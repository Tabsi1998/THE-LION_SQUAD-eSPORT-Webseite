import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ROW_TALL, type CardModel } from "../../../lib/bracketCards";
import { BracketCard } from "./BracketCard";

// Lauf-Karte nach dem Zusammenlegen (#2459, wie im Web #2452): die Zeile zu freien Plätzen kommt aus dem Modell,
// ein Name aus einem Wort bleibt einzeilig mit „…“.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const row = (key: string, label: string) => ({
  key, slot: Number(key), registrationId: `r${key}`, label, pending: false, result: "", winner: false, loser: false, qualified: false, out: false, mine: false,
});

function heat(freeLine: string): CardModel {
  return {
    id: "final", key: "FINAL", kind: "heat", title: "Grand Final", height: 200, rowHeight: ROW_TALL,
    rows: [row("1", "KartKöniginDerHerzenAusTirol"), row("2", "Der sehr lange Name aus Tirol")], cutAfter: -1,
    text: { name: "Grand Final", meta: "2 von 4 Spielern", cut: "", rest: "", free: "2 Plätze frei" }, freeLine,
    line: null, walkover: false, mine: false, empty: false, drawState: null, anchor: () => 0,
  };
}

function show(model: CardModel) {
  return render(
    <BracketCard model={model} x={0} y={0} w={200} status="offen" live={null} dim={false} selected={null}
      motion={null} reduce onOpen={() => {}} onToggle={() => {}} />,
  );
}

test("die Karte zeigt die Zeile aus dem Modell: „bleiben leer“ statt „frei“", async () => {
  await show(heat("2 Plätze bleiben leer"));
  expect(screen.getByTestId("bracket-heat-free-final")).toHaveTextContent("2 Plätze bleiben leer");
  expect(screen.queryByText("2 Plätze frei")).toBeNull();
});

test("nach dem Lauf keine Zeile", async () => {
  await show(heat(""));
  expect(screen.queryByTestId("bracket-heat-free-final")).toBeNull();
  expect(screen.queryByText("2 Plätze frei")).toBeNull();
});

test("ein langer Name aus einem Wort: eine Zeile mit „…“, mehrere Wörter: zwei Zeilen", async () => {
  await show(heat(""));
  expect(screen.getByText("KartKöniginDerHerzenAusTirol").props.numberOfLines).toBe(1);
  expect(screen.getByText("KartKöniginDerHerzenAusTirol").props.ellipsizeMode).toBe("tail");
  expect(screen.getByText("Der sehr lange Name aus Tirol").props.numberOfLines).toBe(2);
});
