import React from "react";
import { render, screen } from "@testing-library/react-native";
import { Badge, arcPath, notchPath } from "./Badge";

// Erfolge II (E13, #623): das Abzeichen der App - Material und Rang im Namen, Kerben, Löwenkopf bei
// Legendär, Silhouette mit Fortschrittsring, und ein Motiv auch dann, wenn die Gruppe keins hat.

function kids(node: { props: { children?: unknown } }): unknown[] {
  return React.Children.toArray(node.props.children as React.ReactNode);
}

function strokes(d: string): number {
  return (d.match(/M /g) || []).length;
}

test("ein erreichtes Abzeichen: Material und Rang im Namen, je Rang eine Kerbe, das Motiv", async () => {
  await render(<Badge material="gold" rank={5} art="crown" testID="b" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("Gold V");
  expect(strokes(screen.getByTestId("badge-notches").props.d)).toBe(5);
  expect(strokes(notchPath(7))).toBe(7);
  expect(notchPath(0)).toBe("");
  expect(screen.getByTestId("badge-motif")).toBeTruthy();
  expect(screen.queryByTestId("badge-progress")).toBeNull();
  expect(screen.queryByTestId("badge-lion-crest")).toBeNull();
});

test("Legendär trägt den Löwenkopf und keine Kerben", async () => {
  await render(<Badge material="legendary" rank={8} art="mvp" testID="b" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("Legendär");
  expect(screen.getByTestId("badge-lion-crest")).toBeTruthy();
  expect(screen.queryByTestId("badge-notches")).toBeNull();
});

test("nicht erreicht: Silhouette mit Fortschrittsring, ohne Fortschritt kein Ring", async () => {
  const { rerender } = await render(<Badge material="iron" rank={2} art="crossed-swords" earned={false} percent={40} testID="b" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("Eisen II, noch nicht erreicht");
  expect(screen.getByTestId("badge-progress").props.d).toBe(arcPath(50, 50, 43, 0, 0.4 * 359.9));
  await rerender(<Badge material="iron" rank={2} art="crossed-swords" earned={false} percent={0} testID="b" />);
  expect(screen.queryByTestId("badge-progress")).toBeNull();
});

test("alte Stufen (nur Level) und Gruppen ohne Motiv bekommen trotzdem ein Abzeichen", async () => {
  await render(<Badge level={4} art="gibt-es-nicht" icon="auch-nicht" testID="b" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("Platin VI");
  expect(kids(screen.getByTestId("badge-motif")).length).toBe(1);
});
