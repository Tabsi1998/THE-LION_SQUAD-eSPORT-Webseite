import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Prüfseite der Mitgliedskarte (#346): gültig mit dem Nötigsten, sonst „nicht gültig“ - ohne Grund.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");
const MemberCardVerifyPage = (await import("./MemberCardVerifyPage")).default;

const renderAt = (token) => render(
  <MemoryRouter initialEntries={[`/karte/pruefen/${token}`]}>
    <Routes><Route path="/karte/pruefen/:token" element={<MemberCardVerifyPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => vi.clearAllMocks());

test("gültig: Vorname, Mitgliedsart, gültig bis - und die Seite bleibt für Suchmaschinen unsichtbar", async () => {
  apiMock.get.mockResolvedValue({ data: { valid: true, club_name: "THE LION SQUAD", name: "Paula B.", type_label: "Ordentliches Mitglied", valid_until: "2026-12-31", checked_at: "2026-09-22T10:00:00+00:00" } });
  renderAt("abc123");
  const result = await screen.findByTestId("card-verify-result");
  await vi.waitFor(() => expect(result).toHaveAttribute("data-valid", "true"));
  expect(apiMock.get).toHaveBeenCalledWith("/card/verify/abc123");
  expect(result).toHaveTextContent("Gültige Mitgliedskarte");
  expect(result).toHaveTextContent("Paula B.");
  expect(result).toHaveTextContent("Ordentliches Mitglied");
  expect(result).toHaveTextContent("bis 31.12.2026");
  expect(useDocumentTitle).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ robots: "noindex, nofollow" }));
});

test("nicht gültig: kein Name, kein Grund", async () => {
  apiMock.get.mockResolvedValue({ data: { valid: false, club_name: "THE LION SQUAD" } });
  renderAt("abgelaufen");
  const result = await screen.findByTestId("card-verify-result");
  await vi.waitFor(() => expect(result).toHaveAttribute("data-valid", "false"));
  expect(result).toHaveTextContent("Nicht gültig");
  expect(result).not.toHaveTextContent(/abgelaufen|beendet|unbekannt/i);
});

test("Server nicht erreichbar: Hinweis, noch einmal scannen", async () => {
  apiMock.get.mockRejectedValue(new Error("offline"));
  renderAt("x");
  expect(await screen.findByTestId("card-verify-failed")).toBeInTheDocument();
});
