import React from "react";
import { AccessibilityInfo, Animated, Text } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { FadeIn, ListItemFadeIn, staggerDelay, useListEntrance } from "./FadeIn";

// Sanfte Übergänge (#218): kurz einblenden – und gar nicht, wenn das Handy „Bewegung reduzieren“ sagt.

test("Listen bauen sich nur in den ersten Zeilen nacheinander auf", () => {
  expect(staggerDelay(0)).toBe(0);
  expect(staggerDelay(3)).toBe(210);
  expect(staggerDelay(40)).toBe(560);
  expect(staggerDelay(-2)).toBe(0);
});

test("der Inhalt ist da – mit und ohne „Bewegung reduzieren“", async () => {
  const spy = jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  await render(<FadeIn trigger="a"><Text>Inhalt</Text></FadeIn>);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(screen.getByText("Inhalt")).toBeTruthy();
  spy.mockRestore();
});

// Gestaffelte Listen (#1085): neue Zeilen blenden nacheinander ein (240 ms, 70 ms je Stelle, höchstens acht Stufen),
// schon gezeigte nie noch einmal - auch nicht, wenn sie an eine andere Stelle rücken oder kurz weg waren.
function List({ ids }: { ids: string[] }) {
  const entrance = useListEntrance();
  return (
    <>
      {ids.map((id, index) => (
        <ListItemFadeIn key={id} entrance={entrance} id={id} index={index}>
          <Text>{id}</Text>
        </ListItemFadeIn>
      ))}
    </>
  );
}

describe("gestaffelte Listen", () => {
  let timing: jest.SpyInstance;
  const fadeDelays = () => timing.mock.calls.map(([, config]) => config.delay);

  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    timing = jest.spyOn(Animated, "timing");
  });
  afterEach(() => timing.mockRestore());

  test("die ersten Zeilen nacheinander, schon gezeigte nie noch einmal", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `zeile-${index}`);
    await render(<List ids={ids} />);
    expect(fadeDelays()).toEqual([0, 70, 140, 210, 280, 350, 420, 490, 560, 560]);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, duration: 240, useNativeDriver: true });
    expect(screen.getByText("zeile-0").parent?.props.style).toEqual({ opacity: 0, transform: [{ translateY: 8 }] });

    // Neu geladen, dieselben Zeilen: nichts beginnt von vorn.
    timing.mockClear();
    await screen.rerender(<List ids={[...ids]} />);
    expect(timing).not.toHaveBeenCalled();

    // Oben kommt eine dazu: nur sie blendet ein, die anderen rücken bloß eine Stelle weiter.
    await screen.rerender(<List ids={["neu", ...ids]} />);
    expect(fadeDelays()).toEqual([0]);

    // Eine Suche blendet fast alles aus, danach ist alles wieder da - sofort, ohne Einblenden.
    timing.mockClear();
    await screen.rerender(<List ids={["zeile-3"]} />);
    await screen.rerender(<List ids={ids} />);
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByText("zeile-5").parent?.props.style).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  });

  test("mit „Bewegung reduzieren“ ist alles sofort da, nichts bewegt sich", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await render(<List ids={[]} />);
    // Die Antwort des Handys liegt vor, bevor die Liste geladen ist.
    await act(async () => {});
    await screen.rerender(<List ids={["a", "b", "c"]} />);
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByText("c").parent?.props.style).toEqual({ opacity: 1, transform: [{ translateY: 0 }] });
  });
});
