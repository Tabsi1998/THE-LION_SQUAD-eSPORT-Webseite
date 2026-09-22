import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// „Turnier anlegen“ mit Voreinstellung aus dem Leitfaden (#368): Format, Teilnahme, Teamgröße,
// Best of und Spielregel-Vorgabe sind gesetzt, ein Hinweis nennt die Turnierform; ohne
// `?preset=` ist alles wie immer, ein unbekannter Schlüssel ändert nichts.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MarkdownEditor", () => ({ MarkdownEditor: () => <div data-testid="markdown-editor" /> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AdminTournamentNewPage = (await import("./AdminTournamentNewPage")).default;

function renderAt(search) {
  return render(
    <MemoryRouter initialEntries={[`/admin/tournaments/new${search}`]}>
      <Routes><Route path="/admin/tournaments/new" element={<AdminTournamentNewPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: [] });
});

test("mit ?preset=arcade-sport sind Format, Team, Teamgröße, Best of und Spielregel gesetzt", async () => {
  renderAt("?preset=arcade-sport");
  expect(await screen.findByTestId("new-tr-preset-hint")).toHaveTextContent("Arcade-Sport 3v3");
  expect(screen.getByTestId("new-tr-format")).toHaveValue("groups");
  expect(screen.getByTestId("new-tr-mode")).toHaveValue("team");
  expect(screen.getByTestId("new-tr-team-size")).toHaveValue(3);
  expect(screen.getByTestId("new-tr-bestof")).toHaveValue(5);
  expect(screen.getByTestId("new-tr-event-mode")).toHaveValue("online");
  expect(screen.getByTestId("new-tr-result-entry-mode")).toHaveValue("player_confirmed");
});

test("Party und LAN übernimmt die Vor-Ort-Regel; ohne oder mit unbekanntem Schlüssel bleibt alles wie immer", async () => {
  renderAt("?preset=party-lan");
  expect(await screen.findByTestId("new-tr-preset-hint")).toHaveTextContent("Party und LAN");
  expect(screen.getByTestId("new-tr-event-mode")).toHaveValue("local");
  expect(screen.getByTestId("new-tr-schedule-mode")).toHaveValue("fixed_by_staff");
  expect(screen.getByTestId("new-tr-mode")).toHaveValue("solo");
  expect(screen.queryByTestId("new-tr-team-size")).not.toBeInTheDocument();
});

test("ohne Voreinstellung kein Hinweis und die Standardwerte", async () => {
  renderAt("?preset=gibt-es-nicht");
  expect(await screen.findByTestId("new-tr-format")).toHaveValue("single_elim");
  expect(screen.queryByTestId("new-tr-preset-hint")).not.toBeInTheDocument();
  expect(screen.getByTestId("new-tr-bestof")).toHaveValue(1);
});
