import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ContentCard, cardSentence, spokenWhen } from "./ContentCard";
import { SegmentedTabs } from "./SegmentedTabs";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

// Vorlesen (#1155): Karten klingen wie ein Satz, Umschalter sagen, was gewählt ist.

test("eine Karte ist ein Satz: Art, Titel, Tag mit Uhrzeit, Zustand", async () => {
  await render(<ContentCard kind="tournament" title="FC 26 Cup" date="2026-05-23T18:00:00+02:00" status="registration_open" secondaryLabel="Du bist angemeldet" onPress={() => undefined} />);
  expect(screen.getByTestId("content-card").props.accessibilityLabel).toBe("Turnier, FC 26 Cup, Samstag, 23. Mai, 18:00 Uhr, Anmeldung offen, Du bist angemeldet");
});

test("ohne Uhrzeit nur der Tag; ohne Zustand kein „Offen“", () => {
  expect(spokenWhen("2026-05-23T00:00:00+02:00")).toBe("Samstag, 23. Mai");
  expect(spokenWhen(null)).toBe("");
  expect(cardSentence({ kind: "news", title: "Rückblick Herbst-LAN" })).toBe("News, Rückblick Herbst-LAN");
});

test("Reiter melden Rolle, Auswahl und Lage und sind mindestens 48 Punkte hoch", async () => {
  const onChange = jest.fn();
  await render(
    <SegmentedTabs label="Ansicht" value="all" onChange={onChange} items={[{ key: "all", label: "Alle" }, { key: "unread", label: "Ungelesen" }]} />,
  );
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(2);
  expect(tabs[0]).toBeSelected();
  expect(tabs[1]).not.toBeSelected();
  expect(tabs[1].props.accessibilityHint).toBe("2 von 2");
  expect(StyleSheet.flatten(tabs[0].props.style).minHeight).toBeGreaterThanOrEqual(48);
  // Die Liste selbst ist kein eigener Fokus (sonst liest TalkBack alle Reiter als einen) - sie trägt nur Rolle und Namen.
  const list = screen.container.queryAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "tablist");
  expect(list.map((node) => node.props.accessibilityLabel)).toEqual(["Ansicht"]);
  await fireEvent.press(tabs[1]);
  expect(onChange).toHaveBeenCalledWith("unread");
});
