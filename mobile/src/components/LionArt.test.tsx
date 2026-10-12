import React from "react";
import { render, screen } from "@testing-library/react-native";
import { EmptyState, ErrorState } from "./ListState";
import { LION_PATH, LionArt } from "./LionArt";

// Leer, Fehler und offline mit dem Löwen (#1325) - dieselben Bilder wie im Web.

test("jedes Bild: der Löwe und sein Zeichen, für den Vorleser unsichtbar", async () => {
  await render(<LionArt art="search" />);
  const svg = screen.getByTestId("lion-art-search", { includeHiddenElements: true });
  expect(svg.props.accessibilityElementsHidden).toBe(true);
  const paths = screen.container.queryAll((node) => node.props.d === LION_PATH);
  expect(paths.length).toBeGreaterThan(0);
});

test("leer zeigt den schlafenden Löwen, Fehler den passenden", async () => {
  await render(
    <>
      <EmptyState title="Noch keine Turniere" />
      <ErrorState problem={{ kind: "notFound", message: "" }} title="Turnier nicht gefunden" />
      <ErrorState problem={{ kind: "offline", message: "" }} onRetry={() => undefined} testID="offline-state" />
      <ErrorState problem={{ kind: "error", message: "" }} testID="broken-state" />
    </>,
  );
  expect(screen.getByTestId("lion-art-sleep", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId("lion-art-search", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getAllByTestId("lion-art-offline", { includeHiddenElements: true })).toHaveLength(2);
  expect(screen.getByText(/Da ist uns ein Kabel rausgerutscht/)).toBeTruthy();
});
