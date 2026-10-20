import React from "react";
import { StyleSheet } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { ZoomableImage } from "./ZoomableImage";

// Galerie-Zoom auf Android (#999): Zwei Finger vergrößern, vergrößert lässt sich das Bild begrenzt verschieben, die
// Galerie blättert währenddessen nicht, und ein anderes Bild setzt den Zoom zurück. Die Gesten laufen über den
// PanResponder von React Native - hier mit nachgebauten Berührungen (touchHistory wie im Responder-System).

type Point = [number, number];
let clock = 1000;

function touchHistory(start: Point[], current: Point[], previous: Point[] = start) {
  clock += 16;
  return {
    numberActiveTouches: current.length,
    indexOfSingleActiveTouch: 0,
    mostRecentTimeStamp: clock,
    touchBank: current.map(([x, y], index) => ({
      touchActive: true,
      startPageX: start[index]?.[0] ?? x,
      startPageY: start[index]?.[1] ?? y,
      startTimeStamp: 1000,
      currentPageX: x,
      currentPageY: y,
      currentTimeStamp: clock,
      previousPageX: previous[index]?.[0] ?? x,
      previousPageY: previous[index]?.[1] ?? y,
      previousTimeStamp: clock - 16,
    })),
  };
}

function touchEvent(start: Point[], current: Point[], previous?: Point[]) {
  return {
    nativeEvent: { touches: current.map(([pageX, pageY]) => ({ pageX, pageY })), changedTouches: [], timestamp: clock },
    touchHistory: touchHistory(start, current, previous),
  };
}

function frame() {
  return screen.getByTestId("zoom");
}

function transformOf() {
  const style = StyleSheet.flatten(frame().props.style) as { transform: Record<string, number>[] };
  return Object.assign({}, ...style.transform) as { translateX: number; translateY: number; scale: number };
}

function setup(active = true) {
  const onZoomChange = jest.fn();
  const onTap = jest.fn();
  const element = (isActive: boolean) => (
    <ZoomableImage uri="/x.jpg" width={400} height={800} active={isActive} label="Bild" onTap={onTap} onZoomChange={onZoomChange} testID="zoom" />
  );
  return { onZoomChange, onTap, element };
}

async function pinch(from: Point[], to: Point[]) {
  const handlers = frame().props;
  expect(handlers.onMoveShouldSetResponderCapture(touchEvent(from, to))).toBe(true);
  await act(async () => {
    handlers.onResponderGrant(touchEvent(from, from));
    handlers.onResponderMove(touchEvent(from, to));
  });
}

test("ein Finger ohne Zoom gehört dem Blättern der Galerie", async () => {
  const { element } = setup();
  await render(element(true));
  expect(frame().props.onMoveShouldSetResponderCapture(touchEvent([[100, 100]], [[180, 100]]))).toBe(false);
  expect(frame().props.onMoveShouldSetResponder(touchEvent([[100, 100]], [[180, 100]]))).toBe(false);
});

test("zwei Finger vergrößern, die Galerie blättert dabei nicht, und vergrößert bleibt es nach dem Loslassen", async () => {
  const { element, onZoomChange } = setup();
  await render(element(true));
  await pinch([[150, 400], [250, 400]], [[100, 400], [300, 400]]);
  expect(onZoomChange).toHaveBeenLastCalledWith(true);
  expect(transformOf().scale).toBeCloseTo(2);
  await act(async () => {
    frame().props.onResponderRelease(touchEvent([[100, 400]], [[100, 400]]));
  });
  expect(onZoomChange).toHaveBeenLastCalledWith(true);
});

test("vergrößert lässt sich mit einem Finger verschieben, aber nur bis zum Bildrand", async () => {
  const { element } = setup();
  await render(element(true));
  await pinch([[150, 400], [250, 400]], [[100, 400], [300, 400]]);
  await act(async () => {
    frame().props.onResponderRelease(touchEvent([[100, 400]], [[100, 400]]));
  });
  // Jetzt will der Zoom auch einen Finger.
  expect(frame().props.onMoveShouldSetResponderCapture(touchEvent([[200, 400]], [[260, 400]], [[200, 400]]))).toBe(true);
  await act(async () => {
    frame().props.onResponderGrant(touchEvent([[200, 400]], [[200, 400]]));
    frame().props.onResponderMove(touchEvent([[200, 400]], [[1200, 400]], [[200, 400]]));
  });
  // Bei Faktor 2 und 400 px Breite reicht das Bild 200 px über den Rand.
  expect(transformOf().translateX).toBe(200);
});

test("fast nicht vergrößert springt beim Loslassen zurück und gibt das Blättern frei", async () => {
  const { element, onZoomChange } = setup();
  await render(element(true));
  await pinch([[150, 400], [250, 400]], [[148, 400], [252, 400]]);
  await act(async () => {
    frame().props.onResponderRelease(touchEvent([[148, 400]], [[148, 400]]));
  });
  expect(onZoomChange).toHaveBeenLastCalledWith(false);
});

test("ein anderes Bild setzt Zoom und Position zurück", async () => {
  const { element } = setup();
  const view = await render(element(true));
  await pinch([[150, 400], [250, 400]], [[100, 400], [300, 400]]);
  expect(transformOf().scale).toBeCloseTo(2);
  await view.rerender(element(false));
  expect(transformOf()).toEqual({ translateX: 0, translateY: 0, scale: 1 });
});
