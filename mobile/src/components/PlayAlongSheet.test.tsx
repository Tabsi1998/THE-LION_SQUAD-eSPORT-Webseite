import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PlayAlongSheet } from "./PlayAlongSheet";
import type { PlayAlongEntry } from "../lib/playAlong";

// „Spielst du auch mit?“ (#1184) in der App: Haken je Einzel-Turnier mit 48-Punkt-Tippfläche, Hinweise für Team und
// Fast Lap, „Nein danke“ ohne Rückfrage und das Ergebnis je Eintrag. Erfundene Daten.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../seasons/anchors", () => ({ useSeasonOverlay: () => null }));

const SOLO: PlayAlongEntry = { kind: "tournament", id: "t1", slug: "lan-cup", title: "LAN-Cup", start_date: "2026-10-31T14:00:00+00:00", mode: "Einzel", game: "Rocket League",
  team: false, fee: { total_cents: 1000, currency: "EUR" }, spots_left: 3, full: false, selectable: true, reason: null, captain: false, my_status: null };
const FULL: PlayAlongEntry = { ...SOLO, id: "t2", slug: "mini", title: "Mini-Cup", fee: null, spots_left: 0, full: true };
const TEAM: PlayAlongEntry = { ...SOLO, id: "t3", slug: "team-cup", title: "Team-Cup", mode: "Team", team: true, fee: null, selectable: false, reason: "Dein Kapitän meldet das Team an." };
const LAP: PlayAlongEntry = { kind: "fastlap", id: "f1", slug: "lap", title: "LAN Fast Lap", mode: "Bestzeit fahren", selectable: false, reason: "Keine Anmeldung nötig – du fährst einfach deine Bestzeit." };

async function renderSheet(entries: PlayAlongEntry[], { show = true, from = null as string | null } = {}) {
  mockGet.mockResolvedValue({ data: { show, entries } });
  const onClose = jest.fn();
  const onOpenTournament = jest.fn();
  await render(<PlayAlongSheet eventId="e1" from={from} onClose={onClose} onOpenTournament={onOpenTournament} />);
  return { onClose, onOpenTournament };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("ohne Turniere und Fast Laps gibt es den Schritt nicht", async () => {
  const { onClose } = await renderSheet([], { show: false });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mockGet).toHaveBeenCalledWith("/events/e1/play-along");
  expect(screen.queryByTestId("play-along-sheet")).toBeNull();
});

test("Haken nur bei Einzel-Turnieren (48 Punkte), Team und Fast Lap als Hinweis; Kapitäne bekommen den Weg", async () => {
  const { onOpenTournament } = await renderSheet([SOLO, TEAM, { ...TEAM, id: "t4", slug: "team-zwei", captain: true, reason: "Melde dein Team auf der Turnierseite an." }, LAP]);
  const check = await screen.findByTestId("play-along-check-t1");
  expect(check.props.accessibilityRole).toBe("checkbox");
  expect(check.props.accessibilityState).toEqual({ checked: false });
  expect(check.props.accessibilityLabel).toContain("LAN-Cup");
  expect(Number(StyleSheet.flatten(check.props.style).minHeight)).toBeGreaterThanOrEqual(48);
  expect(screen.getByText("Einzel · Rocket League · 10,00 € Startgeld · 3 Plätze frei")).toBeTruthy();
  expect(screen.queryByTestId("play-along-check-t3")).toBeNull();
  expect(screen.getByTestId("play-along-note-t3")).toHaveTextContent("Dein Kapitän meldet das Team an.");
  expect(screen.queryByTestId("play-along-team-t3")).toBeNull();
  await fireEvent.press(screen.getByTestId("play-along-team-t4"));
  expect(onOpenTournament).toHaveBeenCalledWith("team-zwei");
  expect(screen.getByTestId("play-along-note-f1")).toHaveTextContent("Keine Anmeldung nötig – du fährst einfach deine Bestzeit.");
});

test("„Nein danke“ beendet ohne Rückfrage und ohne Anmeldung", async () => {
  const { onClose } = await renderSheet([SOLO]);
  await fireEvent.press(await screen.findByTestId("play-along-skip"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockPost).not.toHaveBeenCalled();
});

test("Anmelden erst mit Regeln und Kosten; danach das Ergebnis je Eintrag mit Summe", async () => {
  await renderSheet([SOLO, FULL], { from: "lan-cup" });
  expect((await screen.findByTestId("play-along-check-t1")).props.accessibilityState).toEqual({ checked: true });
  await fireEvent.press(screen.getByTestId("play-along-check-t2"));
  expect(screen.getByTestId("play-along-sum")).toHaveTextContent(/10,00 €/);
  expect(screen.getByTestId("play-along-submit").props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByTestId("play-along-rules"));
  await fireEvent.press(screen.getByTestId("play-along-costs"));
  expect(screen.getByTestId("play-along-submit").props.accessibilityState).toMatchObject({ disabled: false });

  mockPost.mockResolvedValue({ data: {
    results: [
      { id: "t1", title: "LAN-Cup", state: "registered", label: "Du bist dabei", detail: null, price: { total_cents: 1000, currency: "EUR" } },
      { id: "t2", title: "Mini-Cup", state: "waitlist", label: "Warteliste", detail: null, price: null },
    ],
    total_cents: 1000, currency: "EUR",
  } });
  await fireEvent.press(screen.getByTestId("play-along-submit"));
  expect(await screen.findByTestId("play-along-result")).toBeTruthy();
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith("/events/e1/play-along", { tournament_ids: ["t1", "t2"], accept_rules: true, accept_privacy: true, accept_costs: true });
  expect(screen.getByTestId("play-along-result-t1")).toHaveTextContent(/Du bist dabei · 10,00 €/);
  expect(screen.getByTestId("play-along-result-t2")).toHaveTextContent(/Warteliste/);
  expect(screen.getByTestId("play-along-total")).toHaveTextContent(/10,00 €/);
  expect(screen.getByText("1 angemeldet, 1 auf der Warteliste.")).toBeTruthy();
  expect(screen.getByText("Zurück zum Turnier")).toBeTruthy();
});

test("ein Fehler steht mit Grund beim Eintrag", async () => {
  await renderSheet([SOLO]);
  await fireEvent.press(await screen.findByTestId("play-along-check-t1"));
  await fireEvent.press(screen.getByTestId("play-along-rules"));
  await fireEvent.press(screen.getByTestId("play-along-costs"));
  mockPost.mockResolvedValue({ data: { results: [{ id: "t1", title: "LAN-Cup", state: "error", label: "Nicht angemeldet", detail: "Für dieses Turnier fehlen Pflicht-IDs: Epic-ID", price: null }], total_cents: 0, currency: "EUR" } });
  await fireEvent.press(screen.getByTestId("play-along-submit"));
  expect(await screen.findByTestId("play-along-result-t1")).toHaveTextContent(/Für dieses Turnier fehlen Pflicht-IDs: Epic-ID/);
  expect(screen.queryByTestId("play-along-total")).toBeNull();
  expect(screen.getByText("Fertig")).toBeTruthy();
});
