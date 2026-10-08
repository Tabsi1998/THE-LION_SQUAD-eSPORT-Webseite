import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { emptyTitle, MyDocumentsScreen } from "./MyDocumentsScreen";

// Deine Unterlagen (#1255): nur die eigenen Schreiben aus der Vereinsakte; Öffnen lädt mit Anmeldung. Ohne Bindung der
// Weg über den Einladungscode, antwortet die Akte nicht, steht das da - statt einer leeren Liste.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, accessToken: "tok-1" }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "own-docs", name: "MyDocuments" } as never;

const own = [
  { id: "dolibarr-23", source: "dolibarr", personal: true, title: "Spendenbestätigung 2025", category: "letter", mime: "application/pdf", created_at: "2026-09-01T10:00:00+00:00" },
  { id: "dolibarr-22", source: "dolibarr", personal: true, title: "Beitrittsbestätigung", category: "letter", mime: "application/pdf", created_at: "2026-03-02T10:00:00+00:00" },
];

beforeEach(() => {
  jest.clearAllMocks();
});

test("die eigenen Unterlagen; Öffnen ruft den Lader mit Anmeldung, ein Fehler steht beim Dokument", async () => {
  mockGet.mockResolvedValue({ data: { available: true, reason: null, documents: own } });
  const opener = jest.fn().mockRejectedValueOnce(new Error("Kein Zugriff")).mockResolvedValue(undefined);
  await render(<MyDocumentsScreen navigation={navigation} route={route} opener={opener} />);
  await waitFor(() => expect(screen.getByTestId("my-document-dolibarr-23")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/account/documents");
  expect(screen.getByText(/Schreiben · 01\.09\.2026/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("my-document-dolibarr-23"));
  await waitFor(() => expect(screen.getByTestId("my-document-error-dolibarr-23")).toHaveTextContent("Kein Zugriff"));
  await fireEvent.press(screen.getByTestId("my-document-dolibarr-22"));
  await waitFor(() => expect(opener).toHaveBeenLastCalledWith(expect.objectContaining({ id: "dolibarr-22" }), "tok-1"));
});

test("ohne Bindung: der Weg über den Einladungscode; Ausfall und Fehler: „gerade nicht abrufbar“", async () => {
  mockGet.mockResolvedValue({ data: { available: true, reason: "not_bound", text: "", documents: [] } });
  const first = await render(<MyDocumentsScreen navigation={navigation} route={route} opener={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("my-documents-empty")).toBeTruthy());
  expect(screen.getByText("Noch keine Unterlagen")).toBeTruthy();
  expect(screen.getByText(/Einladungscode unter Verein → Mitgliedschaft/)).toBeTruthy();
  await first.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "unreachable", text: "Die Vereinsakte antwortet gerade nicht.", documents: [] } });
  const second = await render(<MyDocumentsScreen navigation={navigation} route={route} opener={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("Gerade nicht abrufbar")).toBeTruthy());
  expect(screen.getByText("Die Vereinsakte antwortet gerade nicht.")).toBeTruthy();
  await second.unmount();

  mockGet.mockRejectedValue(new Error("offline"));
  await render(<MyDocumentsScreen navigation={navigation} route={route} opener={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("Gerade nicht abrufbar")).toBeTruthy());
});

test("Überschrift der leeren Liste je Grund", () => {
  expect(emptyTitle({ available: true, documents: [] })).toBe("Noch keine Unterlagen");
  expect(emptyTitle({ available: false, reason: "no_access", documents: [] })).toBe("Gerade nicht abrufbar");
  expect(emptyTitle({ available: false, reason: "not_member", documents: [] })).toBe("Keine Unterlagen");
});
