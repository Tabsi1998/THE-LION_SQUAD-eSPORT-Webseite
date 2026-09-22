import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberDocumentsScreen } from "./MemberDocumentsScreen";

// Vereinsdokumente (#341): Öffnen lädt mit Anmeldung; klappt es nicht, steht der Grund beim Dokument.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, accessToken: "tok-1" }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "docs", name: "MemberDocuments" } as never;

const docs = [
  { id: "d1", title: "Statuten", category: "statutes", visibility: "members", file_size: 20480, mime: "application/pdf", pinned: true, view_url: "/api/documents/d1/view" },
  { id: "d2", title: "Vorstandsprotokoll", category: "minutes", visibility: "internal", mime: "application/pdf", view_url: "/api/documents/d2/view" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: docs });
});

test("Liste mit Kategorie und Kennzeichen; Öffnen ruft den Lader mit Anmeldung", async () => {
  const opener = jest.fn().mockResolvedValue(undefined);
  await render(<MemberDocumentsScreen navigation={navigation} route={route} opener={opener} />);
  await waitFor(() => expect(screen.getByTestId("document-d1")).toBeTruthy());
  expect(screen.getByText(/Protokolle · Vorstand/)).toBeTruthy();
  expect(screen.getByText(/20 KB/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("document-d1"));
  await waitFor(() => expect(opener).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "tok-1"));
});

test("Fehler beim Öffnen steht beim Dokument", async () => {
  const opener = jest.fn().mockRejectedValue(new Error("Kein Zugriff: Dieses Dokument ist nur für Mitglieder bzw. den Vorstand."));
  await render(<MemberDocumentsScreen navigation={navigation} route={route} opener={opener} />);
  await waitFor(() => expect(screen.getByTestId("document-d2")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("document-d2"));
  await waitFor(() => expect(screen.getByTestId("document-error-d2")).toHaveTextContent(/Kein Zugriff/));
  expect(screen.queryByTestId("document-error-d1")).toBeNull();
});

test("Filter nach Kategorie, leere Liste mit Hinweis", async () => {
  await render(<MemberDocumentsScreen navigation={navigation} route={route} opener={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("document-d1")).toBeTruthy());
  await fireEvent.press(screen.getByText("Protokolle"));
  expect(screen.queryByTestId("document-d1")).toBeNull();
  expect(screen.getByText("Vorstandsprotokoll")).toBeTruthy();

  mockGet.mockResolvedValue({ data: [] });
  await render(<MemberDocumentsScreen navigation={navigation} route={route} opener={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("Keine Dokumente")).toBeTruthy());
});
