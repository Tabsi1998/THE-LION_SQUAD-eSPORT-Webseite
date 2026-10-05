import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Der Korb der Ostereiersuche in der App (#647, wie /ostern im Web): ohne Suche nur der nächste Start; als Gast die
// Einladung (Anmelden), Preise, die Schnellsten und Regeln - kein Korb; angemeldet der Korb mit echten Mustern und
// leeren Mulden, Hinweise ab Tag zwei; voller Korb mit Platz.

const mockAuth: { user: Record<string, unknown> | null } = { user: null };
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null }));
const mockPage = jest.fn();
jest.mock("../../seasons/easterHunt/api", () => ({ fetchHuntPage: (...args: unknown[]) => mockPage(...args), onHuntProgress: () => () => {} }));

const { EasterHuntScreen, durationLabel, phaseText } = require("./EasterHuntScreen");

const RUNNING = {
  phase: "running", year: 2027, starts_at: "2027-03-26T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", egg_count: 4, completed: 1,
  prizes: [{ kind: "raffle_all", label: "TLS-Hoodie", value: "50 €", title: "Verlosung unter allen mit vollem Korb" }],
  fastest: [{ rank: 1, display_name: "Paula", username: "paula", duration_seconds: 3720 }],
  terms: ["Die Suche läuft von Karfreitag bis Ostermontag."], me: null,
};

async function renderScreen() {
  await render(<EasterHuntScreen />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockPage.mockReset();
  mockAuth.user = null;
  mockOpenSignIn.mockClear();
});

test("Zeiten in Worten und die Phase", () => {
  expect(durationLabel(3720)).toBe("1 Std. 2 Min.");
  expect(durationLabel(90061)).toBe("1 Tag 1 Std. 1 Min.");
  expect(phaseText({ phase: "ended" })).toBe("Die Suche ist vorbei – ausgewertet wird in Kürze.");
  expect(phaseText({ phase: "none", next_start: null })).toBe("Gerade ist keine Eiersuche geplant.");
});

test("als Gast: Einladung zum Anmelden, Preise, Schnellste und Regeln - kein Korb", async () => {
  mockAuth.user = { id: "live-public-guest" };
  mockPage.mockResolvedValue(RUNNING);
  await renderScreen();
  expect(screen.getByTestId("hunt-guest")).toBeTruthy();
  expect(screen.queryByTestId("hunt-basket")).toBeNull();
  expect(screen.getByTestId("hunt-prizes")).toHaveTextContent("TLS-Hoodie", { exact: false });
  expect(screen.getByTestId("hunt-fastest-1")).toHaveTextContent("Paula", { exact: false });
  expect(screen.getByTestId("hunt-fastest-1")).toHaveTextContent("1 Std. 2 Min.", { exact: false });
  expect(screen.getByTestId("hunt-terms")).toHaveTextContent("Karfreitag bis Ostermontag", { exact: false });
  await fireEvent.press(screen.getByText("Anmelden"));
  expect(mockOpenSignIn).toHaveBeenCalled();
});

test("Hinweise ab Tag zwei - mit „(Website)“ für Eier auf der Website", async () => {
  mockAuth.user = { id: "u1" };
  mockPage.mockResolvedValue({ ...RUNNING, me: { active: true, found: 0, total: 4, eggs: [], hints_open: true, hints: [{ channel: "app", hint: "Schau unter Mehr." }, { channel: "web", hint: "Schau bei den News." }], completed_at: null } });
  await renderScreen();
  expect(screen.getByTestId("hunt-hints")).toHaveTextContent("Schau unter Mehr.", { exact: false });
  expect(screen.getByTestId("hunt-hints")).toHaveTextContent("Schau bei den News. (Website)", { exact: false });
});

test("angemeldet: Korb mit echten Mustern und leeren Mulden; Hinweise ab Tag zwei", async () => {
  mockAuth.user = { id: "u1" };
  mockPage.mockResolvedValue({ ...RUNNING, me: { active: true, found: 1, total: 4, eggs: [{ egg_no: 3, pattern: "lion", found_at: "2027-03-26T09:00:00+01:00" }], hints_open: false, hints_open_at: "2027-03-27T00:00:00+01:00", hints: [], missing: 3, completed_at: null } });
  await renderScreen();
  expect(screen.getByTestId("hunt-basket-count")).toHaveTextContent("1 von 4");
  expect(screen.getByTestId("hunt-basket-egg-3")).toBeTruthy();
  expect(screen.getAllByTestId("hunt-basket-hole")).toHaveLength(3);
  expect(screen.getByTestId("hunt-hints-later")).toHaveTextContent("gibt es zu jedem fehlenden Ei einen Hinweis", { exact: false });
  expect(screen.queryByTestId("hunt-guest")).toBeNull();
});

test("voller Korb: Platz, keine Hinweise mehr; ohne Suche nur der nächste Start", async () => {
  mockAuth.user = { id: "u1" };
  mockPage.mockResolvedValue({ ...RUNNING, egg_count: 2, me: { active: true, found: 2, total: 2, eggs: [{ egg_no: 1, pattern: "dots", found_at: "x" }, { egg_no: 2, pattern: "waves", found_at: "y" }], hints_open: true, hints: [{ channel: "app", hint: "x" }], completed_at: "2027-03-26T10:00:00+01:00", rank: 2 } });
  await renderScreen();
  expect(screen.getByTestId("hunt-basket-done")).toHaveTextContent("Korb voll – Platz 2!", { exact: false });
  expect(screen.queryByTestId("hunt-hints")).toBeNull();
  await screen.unmount();
  mockPage.mockResolvedValue({ phase: "none", next_start: null });
  await renderScreen();
  expect(screen.getByTestId("hunt-phase")).toHaveTextContent("Gerade ist keine Eiersuche geplant.");
  expect(screen.queryByTestId("hunt-prizes")).toBeNull();
});
