import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { EventRecapCard } from "./EventRecapCard";

// Rückblick (#1187): mit Daten „Du warst dabei“, Zahlen, Treppchen und Bericht; ohne Daten nichts.

const mockGet = jest.fn();
jest.mock("../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const RECAP = {
  available: true,
  winners: [{ kind: "tournament", id: "t-mk", slug: "mk", title: "Mario Kart Cup", team: false, podium: [
    { rank: 1, name: "Gast Eins", detail: "1 Sieg" }, { rank: 2, name: "Lena", detail: null },
  ] }],
  fastlaps: [{ kind: "fastlap", id: "f-spa", slug: "spa", title: "Fast Lap Spa", track: "Spa", podium: [{ rank: 1, name: "Lena", detail: "1:31.234" }] }],
  numbers: { participants: 5, matches: 2, tournaments: 1, fastlaps: 1, photos: 0 },
  report: { id: "n1", slug: "rueckblick", title: "Rückblick: Sommer-LAN", excerpt: "So war es" },
  mine: { was_there: true, results: [{ kind: "tournament", id: "t-mk", slug: "mk", title: "Mario Kart Cup", rank: 2, of: 2, team_name: null }] },
};

beforeEach(() => jest.clearAllMocks());

test("mit Daten: Du warst dabei, Zahlen, Treppchen, Bericht - Tippen öffnet das Ziel", async () => {
  mockGet.mockResolvedValue({ data: RECAP });
  const onOpen = jest.fn();
  await render(<EventRecapCard eventKey="sommer-lan" onOpen={onOpen} />);
  expect(await screen.findByTestId("event-recap")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith("/events/sommer-lan/recap");
  expect(screen.getByTestId("event-recap-mine")).toHaveTextContent(/Du warst dabei.*Mario Kart Cup.*Platz 2 von 2/);
  expect(screen.getByTestId("event-recap-number-participants")).toHaveTextContent("5Teilnehmer");
  expect(screen.queryByTestId("event-recap-number-photos")).toBeNull();
  expect(screen.getByTestId("event-recap-podium-t-mk-1").props.accessibilityLabel).toBe("Platz 1: Gast Eins, 1 Sieg");
  expect(screen.getByTestId("event-recap-podium-f-spa-1")).toHaveTextContent(/1:31\.234/);
  await fireEvent.press(screen.getByTestId("event-recap-mine-tournament-t-mk"));
  expect(onOpen).toHaveBeenCalledWith("tournament", "mk");
  await fireEvent.press(screen.getByTestId("event-recap-report"));
  expect(onOpen).toHaveBeenCalledWith("news", "rueckblick");
});

test("ohne Teilnahme kein „Du warst dabei“", async () => {
  mockGet.mockResolvedValue({ data: { ...RECAP, mine: null } });
  await render(<EventRecapCard eventKey="sommer-lan" onOpen={jest.fn()} />);
  expect(await screen.findByTestId("event-recap")).toBeTruthy();
  expect(screen.queryByTestId("event-recap-mine")).toBeNull();
});

test("vor dem Ende nichts", async () => {
  mockGet.mockResolvedValue({ data: { available: false, reason: "not_over" } });
  await render(<EventRecapCard eventKey="sommer-lan" onOpen={jest.fn()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("event-recap")).toBeNull();
});

test("bei einem Fehler nichts", async () => {
  mockGet.mockRejectedValue(new Error("offline"));
  await render(<EventRecapCard eventKey="sommer-lan" onOpen={jest.fn()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("event-recap")).toBeNull();
});
