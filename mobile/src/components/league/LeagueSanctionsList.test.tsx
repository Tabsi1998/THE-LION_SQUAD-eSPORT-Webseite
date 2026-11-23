import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeagueSanctionsList } from "./LeagueSanctionsList";

// Strafen der Liga in der App (#2173, docs/LIGA.md E.3) wie „Meine Strafen“ im Web: nur Liga-Strafen, mit Stand und Einspruch, den
// der Server erlaubt. Ohne Recht kein Einspruch. Erfundene Namen.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
const mockNavigateToUrl = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ navigateToUrl: (url: string) => mockNavigateToUrl(url) }));

const SANCTION = {
  kind: "league_sanction", ref_id: "s1", label: "Punktabzug", issued_at: "2026-11-20T18:00:00Z", context_title: "Liga 1 · Season 1", context_url: "/leagues/liga-1/season-1",
  team_penalty: true, team_name: "Löwen · Rudel A",
  sanction: { id: "s1", status: "active", rule_ref: "§ 8.3 Nicht angetreten", reason: "Zweimal nicht erschienen.", period: "2 Punkte", points: 2, match_id: "m1",
    can_appeal: true, appeal_until: new Date(Date.now() + 26 * 3600 * 1000).toISOString(), appeal: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
});

test("Strafe gegen das Co-Team: Art, Verstoß, Höhe, Stand - Einspruch erst ab zehn Zeichen, dann an den Server", async () => {
  mockGet.mockResolvedValue({ data: { items: [SANCTION, { kind: "moderation", ref_id: "x1", label: "Chat-Sperre" }] } });
  await render(<LeagueSanctionsList />);
  await waitFor(() => expect(screen.getByTestId("penalty-card-s1")).toBeTruthy());
  expect(screen.queryByTestId("penalty-card-x1")).toBeNull();
  expect(screen.getByText("Strafe der Liga-Leitung gegen das Co-Team Löwen · Rudel A")).toBeTruthy();
  expect(screen.getByTestId("sanction-status-s1")).toHaveTextContent("Gilt");
  expect(screen.getByTestId("sanction-period-s1")).toHaveTextContent("Höhe: 2 Punkte");
  expect(screen.getByTestId("sanction-deadline-s1")).toHaveTextContent(/\(noch 1 Tag/);
  await fireEvent.press(screen.getByText("Zum Spiel"));
  expect(mockNavigateToUrl).toHaveBeenCalledWith("/matches/m1");
  await fireEvent.press(screen.getByTestId("sanction-appeal-open-s1"));
  await fireEvent.changeText(screen.getByTestId("sanction-appeal-input-s1"), "zu kurz");
  await fireEvent.press(screen.getByTestId("sanction-appeal-send-s1"));
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId("sanction-appeal-input-s1"), "Wir waren da, der Server war down.");
  await fireEvent.press(screen.getByTestId("sanction-appeal-send-s1"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/penalties/sanctions/s1/appeal", { text: "Wir waren da, der Server war down." }));
});

test("ohne Recht kein Einspruch; ein offener Einspruch steht mit seinem Stand da", async () => {
  mockGet.mockResolvedValue({ data: { items: [
    { ...SANCTION, sanction: { ...SANCTION.sanction, can_appeal: false } },
    { ...SANCTION, ref_id: "s2", sanction: { ...SANCTION.sanction, id: "s2", can_appeal: false, appeal: { state: "open", at: "2026-11-21T10:00:00Z", by_name: "Anna", text: "Bitte prüfen." } } },
  ] } });
  await render(<LeagueSanctionsList />);
  await waitFor(() => expect(screen.getByTestId("penalty-card-s2")).toBeTruthy());
  expect(screen.queryByTestId("sanction-appeal-box-s1")).toBeNull();
  expect(screen.queryByTestId("sanction-appeal-open-s1")).toBeNull();
  expect(screen.getByTestId("sanction-appeal-s2")).toHaveTextContent(/Einspruch offen/);
});

test("keine Liga-Strafen oder keine Antwort: nichts steht da", async () => {
  mockGet.mockRejectedValue(new Error("offline"));
  await render(<LeagueSanctionsList />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/penalties/me"));
  expect(screen.queryByTestId("league-sanctions")).toBeNull();
});

// Gegen Doppeltippen (#2173, Prüfung): genau ein Einspruch, auch bei zwei Tipps im selben Takt.
test("Doppeltippen auf „Einspruch einlegen“: genau eine Anfrage", async () => {
  mockGet.mockResolvedValue({ data: { items: [SANCTION] } });
  await render(<LeagueSanctionsList />);
  await waitFor(() => expect(screen.getByTestId("sanction-appeal-open-s1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("sanction-appeal-open-s1"));
  await fireEvent.changeText(screen.getByTestId("sanction-appeal-input-s1"), "Wir waren da, der Server war down.");
  mockPost.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 20)));
  const button = screen.getByTestId("sanction-appeal-send-s1");
  await act(async () => {
    void fireEvent.press(button);
    void fireEvent.press(button);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(mockPost).toHaveBeenCalledTimes(1);
});
