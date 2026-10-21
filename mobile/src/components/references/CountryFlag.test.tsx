import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { CountryFlag, resetFlagCache } from "./CountryFlag";

// Flagge je Termin (#1925, App-Teil in #1945): die SVG-Datei kommt einmal je Land von der eigenen Website und steht in
// einem festen Kasten (nichts springt beim Laden). Ohne Netz oder bei einem Fehler steht der Ländercode als Text da.

const AT = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 9 6\"><path fill=\"#ed2939\" d=\"M0 0h9v6H0z\"/><path fill=\"#fff\" d=\"M0 2h9v2H0z\"/></svg>";
const fetchMock = jest.fn();

beforeEach(() => {
  resetFlagCache();
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

test("lädt die Flagge einmal je Land und zeigt sie mit dem Landesnamen", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => AT });
  await render(<><CountryFlag code="at" /><CountryFlag code="AT" /></>);
  await waitFor(() => expect(screen.getAllByTestId("country-flag-svg")).toHaveLength(2));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/\/assets\/flags\/at\.svg$/);
  expect(screen.getAllByLabelText("Österreich")).toHaveLength(2);
});

test("ohne Netz der Code als Text; ein unbekanntes Land zeigt nichts", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  await render(<CountryFlag code="es" />);
  await waitFor(() => expect(screen.getByText("ES")).toBeTruthy());
  expect(screen.getByLabelText("Spanien")).toBeTruthy();
  const unknown = await render(<CountryFlag code="xx" />);
  expect(unknown.toJSON()).toBeNull();
});

test("eine Antwort, die keine Flagge ist, gilt als Fehler", async () => {
  fetchMock.mockResolvedValue({ ok: true, text: async () => "<html>Fehlerseite</html>" });
  await render(<CountryFlag code="de" />);
  await waitFor(() => expect(screen.getByText("DE")).toBeTruthy());
});
