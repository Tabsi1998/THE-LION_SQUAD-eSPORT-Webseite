import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konto löschen mit Rollen in Teams (#2113, L-C5): die Seite nennt je Rolle den Weg und sperrt „Account anonymisieren“,
// bis die Rollen abgegeben sind. Ohne Rolle geht es wie bisher über die Rückfrage. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "nachtfuchs" }, logout: vi.fn().mockResolvedValue(true) }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const promptMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ usePrompt: () => promptMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: PrivacyAccountPage } = await import("./PrivacyAccountPage");

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

test("mit Rollen in Teams: Weg je Rolle mit Link, „Account anonymisieren“ gesperrt", async () => {
  serve({
    can_erase: false,
    closing: "Kommst du so nicht weiter, schreib an datenschutz@verein.example – der Verein löscht dein Konto dann.",
    blockers: [
      { team_id: "t-1", team: "[RDL] Rudel", squad_id: null, squad: null, role: "leader", role_label: "Kapitän", way: "Übergib die Leitung …", link: "/teams/t-1" },
      { team_id: "t-1", team: "[RDL] Rudel", squad_id: "s-1", squad: "Erste", role: "captain", role_label: "Captain", way: "Gib die Rolle … ab.", link: "/teams" },
    ],
  });
  render(<MemoryRouter><PrivacyAccountPage /></MemoryRouter>);
  expect(await screen.findByTestId("dsgvo-erasure-blockers")).toHaveTextContent("Erst deine Rollen in Teams abgeben");
  expect(screen.getByTestId("dsgvo-erasure-blocker-leader")).toHaveTextContent("Kapitän bei [RDL] Rudel");
  expect(screen.getByTestId("dsgvo-erasure-blocker-captain")).toHaveTextContent("Captain im Co-Team Erste von [RDL] Rudel");
  expect(screen.getByRole("link", { name: "Zur Teamseite" })).toHaveAttribute("href", "/teams/t-1");
  expect(screen.getByRole("link", { name: "Zu deinen Teams" })).toHaveAttribute("href", "/teams");
  expect(screen.getByTestId("dsgvo-erasure-closing")).toHaveTextContent("der Verein löscht dein Konto dann");
  expect(screen.getByTestId("dsgvo-anonymize-btn")).toBeDisabled();
  fireEvent.click(screen.getByTestId("dsgvo-anonymize-btn"));
  expect(promptMock).not.toHaveBeenCalled();
});

test("ohne Rolle: kein Hinweis, Löschen über die Rückfrage wie bisher", async () => {
  serve({ can_erase: true, blockers: [], message: null });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  promptMock.mockResolvedValue("LÖSCHEN");
  render(<MemoryRouter><PrivacyAccountPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/dsgvo/anonymize-me/check", expect.anything()));
  expect(screen.queryByTestId("dsgvo-erasure-blockers")).toBeNull();
  expect(screen.getByTestId("dsgvo-anonymize-btn")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("dsgvo-anonymize-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/dsgvo/anonymize-me"));
});
