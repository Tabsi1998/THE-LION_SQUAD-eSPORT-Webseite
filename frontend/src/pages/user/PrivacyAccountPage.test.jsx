import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konto löschen mit Rollen in Teams (#2113, L-C5): die Karte nennt je Rolle den Weg und sperrt „Konto löschen“, bis die
// Rollen abgegeben sind. Ohne Rolle geht es wie bisher über die Rückfrage. Seit #2059 ein Name für eine Sache: „Konto
// löschen“ (vorher „Konto anonymisieren“), „Daten herunterladen“ statt „Datenexport“. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "nachtfuchs", role: "tournament_admin" }, logout: vi.fn().mockResolvedValue(true) }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const promptMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ usePrompt: () => promptMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { DatenHerunterladen, KontoAngaben, KontoLoeschen } = await import("./PrivacyAccountPage");

function serve(check) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/dsgvo/anonymize-me/check") return { data: check };
    return { data: [] };
  });
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  promptMock.mockReset();
});

test("mit Rollen in Teams: Weg je Rolle mit Link, „Konto löschen“ gesperrt", async () => {
  serve({
    can_erase: false,
    closing: "Kommst du so nicht weiter, schreib an datenschutz@verein.example – der Verein löscht dein Konto dann.",
    blockers: [
      { team_id: "t-1", team: "[RDL] Rudel", squad_id: null, squad: null, role: "leader", role_label: "Teamleitung", way: "Übergib die Leitung …", link: "/teams/t-1" },
      { team_id: "t-1", team: "[RDL] Rudel", squad_id: "s-1", squad: "Erste", role: "captain", role_label: "Captain", way: "Gib die Rolle … ab.", link: "/teams" },
    ],
  });
  render(<MemoryRouter><KontoLoeschen /></MemoryRouter>);
  expect(await screen.findByTestId("dsgvo-erasure-blockers")).toHaveTextContent("Erst deine Rollen in Teams abgeben");
  expect(screen.getByTestId("dsgvo-erasure-blocker-leader")).toHaveTextContent("Teamleitung bei [RDL] Rudel");
  expect(screen.getByTestId("dsgvo-erasure-blocker-captain")).toHaveTextContent("Captain im Co-Team Erste von [RDL] Rudel");
  expect(screen.getByRole("link", { name: "Zur Teamseite" })).toHaveAttribute("href", "/teams/t-1");
  expect(screen.getByRole("link", { name: "Zu deinen Teams" })).toHaveAttribute("href", "/teams");
  expect(screen.getByTestId("dsgvo-erasure-closing")).toHaveTextContent("der Verein löscht dein Konto dann");
  expect(screen.getByTestId("dsgvo-anonymize-btn")).toBeDisabled();
  fireEvent.click(screen.getByTestId("dsgvo-anonymize-btn"));
  expect(promptMock).not.toHaveBeenCalled();
});

test("„Dein Konto“ nennt die Rolle als Wort, nicht als Rohwert (#2126)", async () => {
  render(<MemoryRouter><KontoAngaben /></MemoryRouter>);
  expect(await screen.findByTestId("privacy-account-role")).toHaveTextContent(/^Turnierleitung$/);
});

test("ohne Rolle: kein Hinweis, Löschen über die Rückfrage wie bisher", async () => {
  serve({ can_erase: true, blockers: [], message: null });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  promptMock.mockResolvedValue("LÖSCHEN");
  render(<MemoryRouter><KontoLoeschen /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/dsgvo/anonymize-me/check", expect.anything()));
  expect(screen.queryByTestId("dsgvo-erasure-blockers")).toBeNull();
  expect(screen.getByTestId("dsgvo-anonymize-btn")).not.toBeDisabled();
  expect(screen.getByTestId("dsgvo-anonymize-btn")).toHaveTextContent(/^Konto löschen$/);
  fireEvent.click(screen.getByTestId("dsgvo-anonymize-btn"));
  await waitFor(() => expect(promptMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Konto löschen?", confirmLabel: "Konto löschen", label: "Tippe LÖSCHEN zur Bestätigung" })));
  const { validate, placeholder } = promptMock.mock.calls[0][0];
  expect(placeholder).toBeUndefined();
  expect(validate("loeschen")).toMatch(/genau LÖSCHEN/);
  expect(validate("LÖSCHEN")).toBe("");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/dsgvo/anonymize-me"));
});

// Prüfung #2059: Dialog und Seite vergleichen gleich - mit Leerzeichen am Rand geht es los, statt still zu schließen.
test("Leerzeichen um das Wort: der Dialog lässt es durch, also löscht die Seite auch", async () => {
  serve({ can_erase: true, blockers: [], message: null });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  promptMock.mockResolvedValue(" LÖSCHEN ");
  render(<MemoryRouter><KontoLoeschen /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/dsgvo/anonymize-me/check", expect.anything()));
  fireEvent.click(screen.getByTestId("dsgvo-anonymize-btn"));
  await waitFor(() => expect(promptMock).toHaveBeenCalled());
  expect(promptMock.mock.calls[0][0].validate(" LÖSCHEN ")).toBe("");
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/dsgvo/anonymize-me"));
});

test("Daten herunterladen: ein Knopf mit dem neuen Namen", () => {
  render(<MemoryRouter><DatenHerunterladen /></MemoryRouter>);
  expect(screen.getByTestId("dsgvo-export-btn")).toHaveTextContent(/^Daten herunterladen$/);
  expect(screen.getByRole("heading", { name: "Daten herunterladen" })).toBeInTheDocument();
  expect(screen.queryByText(/anonymisieren|Datenexport/)).toBeNull();
});
