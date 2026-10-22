import React from "react";
import { render, screen } from "@testing-library/react-native";
import { CountUp } from "./BracketMotion";

// Spielstände im Turnierbaum zählen mit der gemeinsamen Rechnung (lib/countUp.ts, #1969): ruhig auslaufend, ohne
// Aufblitzen des Endwerts vor dem Start, am Ende genau der Wert. Nicht-Zahlen und „Bewegung reduzieren“ stehen sofort.

const reanimated = jest.requireMock("react-native-reanimated");

afterEach(() => jest.restoreAllMocks());

// Das Zählfeld: es beginnt bei „0“ (nicht beim Endwert).
function input() {
  return screen.getByDisplayValue("0", { includeHiddenElements: true });
}

test("zählt über den gemeinsamen Fortschritt 0 → 1 und beginnt bei null", async () => {
  const timing = jest.spyOn(reanimated, "withTiming").mockImplementation(() => 0.5);
  const view = await render(<CountUp value="12" delay={0} reduce={false} style={{}} />);
  // Im Test rechnet Reanimated die Werte beim Zeichnen - neu zeichnen zeigt den Stand nach dem Start.
  await view.rerender(<CountUp value="12" delay={0} reduce={false} style={{}} />);
  // Fortschritt statt Endwert, Dauer wie bisher im Baum.
  expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 520 }));
  const node = input();
  // Halbe Zeit: ease-out wie überall in der App - 12 · (1 − 0,5³) = 10,5 → 11.
  expect(node.props.animatedProps.text).toBe("11");
});

test("am Ende genau der Wert; Text ohne Zahl und „Bewegung reduzieren“ stehen sofort", async () => {
  const first = await render(<CountUp value="3" delay={0} reduce={false} style={{}} />);
  await first.rerender(<CountUp value="3" delay={0} reduce={false} style={{}} />);
  expect(input().props.animatedProps.text).toBe("3");
  await first.unmount();
  const second = await render(<CountUp value="W" delay={0} reduce={false} style={{}} />);
  expect(screen.getByText("W")).toBeTruthy();
  await second.unmount();
  await render(<CountUp value="7" delay={0} reduce style={{}} />);
  expect(screen.getByText("7")).toBeTruthy();
});
