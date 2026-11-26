import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AnkerBereich, AnkerView, useAnker } from "./Anker";

// Sprungziele (#2059, #1677): ein Link oder Suchtreffer rollt zur Stelle - auch wenn sie in einer Karte in einem Abschnitt
// liegt und erst nach dem Laden erscheint - und lässt sie einmal aufleuchten. Mit „Bewegung reduzieren“ ohne Rollen.

const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 390, height: 40 } } });

function Seite({ ziel, scrollTo, zeigen = true }: { ziel?: string; scrollTo: jest.Mock; zeigen?: boolean }) {
  const ref = React.useRef({ scrollTo } as never);
  const api = useAnker(ref, ziel);
  return (
    <AnkerBereich api={api}>
      <AnkerView id="abschnitt">
        <Text>Abschnitt</Text>
        {zeigen ? (
          <AnkerView id="karte">
            <AnkerView id="schalter"><Text>Schalter</Text></AnkerView>
          </AnkerView>
        ) : null}
      </AnkerView>
    </AnkerBereich>
  );
}

test("rollt zum inneren Ziel: Abschnitt + Karte + Stelle, mit etwas Luft darüber - einmal", async () => {
  const scrollTo = jest.fn();
  await render(<Seite ziel="schalter" scrollTo={scrollTo} />);
  await fireEvent(screen.getByTestId("mb-schalter"), "layout", layout(30));
  // Die Eltern sind noch nicht vermessen - noch kein Sprung.
  expect(scrollTo).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId("mb-karte"), "layout", layout(200));
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(500));
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 718, animated: true });
  // Dieselbe Lage noch einmal gemeldet: kein zweiter Sprung.
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(500));
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

test("lädt darüber etwas nach, rückt der Sprung kurz danach still nach", async () => {
  const scrollTo = jest.fn();
  await render(<Seite ziel="karte" scrollTo={scrollTo} />);
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(100));
  await fireEvent(screen.getByTestId("mb-karte"), "layout", layout(50));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 138, animated: true });
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(180));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 218, animated: false });
});

test("ohne Ziel passiert nichts", async () => {
  const quiet = jest.fn();
  await render(<Seite scrollTo={quiet} />);
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(100));
  expect(quiet).not.toHaveBeenCalled();
});

test("ein neues Ziel auf derselben Seite springt neu", async () => {
  const scrollTo = jest.fn();
  const view = await render(<Seite ziel="abschnitt" scrollTo={scrollTo} />);
  await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(40));
  await fireEvent(screen.getByTestId("mb-karte"), "layout", layout(300));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 28, animated: true });
  await act(async () => { await view.rerender(<Seite ziel="karte" scrollTo={scrollTo} />); });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 328, animated: true });
});

test("„Bewegung reduzieren“: springt ohne zu rollen", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => true);
  try {
    const scrollTo = jest.fn();
    await render(<Seite ziel="abschnitt" scrollTo={scrollTo} />);
    await act(async () => { await Promise.resolve(); });
    await fireEvent(screen.getByTestId("mb-abschnitt"), "layout", layout(400));
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 388, animated: false });
  } finally {
    spy.mockRestore();
  }
});

test("außerhalb eines Bereichs nur eine Hülle mit Kennung", async () => {
  await render(<AnkerView id="lose"><Text>Lose</Text></AnkerView>);
  expect(screen.getByTestId("mb-lose")).toHaveTextContent("Lose");
});
