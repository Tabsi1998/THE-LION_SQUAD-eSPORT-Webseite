import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Jahreswertung: Liga-Staffeln zählen nie (docs/LIGA.md, #1622) - die Turnierauswahl fragt deshalb ohne sie.
const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminSeasonsPage } = await import("./AdminSeasonsPage");

test("die Turnierauswahl der Jahreswertung lädt ohne Liga-Staffeln", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  render(<MemoryRouter><AdminSeasonsPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tournaments?include_drafts=true&league=exclude"));
});

// Jahreswertung verwalten (#2123): Abschließen nur über den Knopf mit Vorschau, Löschen nur als Entwurf, Korrekturen mit Grund.
const SEASONS = [
  { id: "s-a", slug: "jw-2026", name: "Jahreswertung 2026", status: "active", kind: "season" },
  { id: "s-d", slug: "jw-2027", name: "Jahreswertung 2027", status: "draft", kind: "season" },
];
const PREVIEW = { season: { id: "s-a", name: "Jahreswertung 2026" }, ranked: 2, awards_total: 1, standings: [
  { rank: 1, user_id: "u1", display_name: "Anna", points: 320, awards: [{ code: "season_wins_1", name: "Saisonmeister" }] },
  { rank: 2, user_id: "u2", display_name: "Bert", points: 210, awards: [] },
] };

function seasonsApi() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/seasons") return { data: SEASONS };
    if (url === "/seasons/s-a/completion-preview") return { data: PREVIEW };
    if (url === "/seasons/s-a/adjustments") return { data: [{ id: "adj-1", recipient_label: "Cleo", total_points: -10, bonus_reason: "Regelverstoß" }] };
    return { data: [] };
  });
}

test("Abschließen zeigt erst die Vorschau, Löschen gibt es nur beim Entwurf", async () => {
  seasonsApi();
  apiMock.post.mockResolvedValue({ data: {} });
  render(<MemoryRouter><AdminSeasonsPage /></MemoryRouter>);
  expect(await screen.findByTestId("season-complete-s-a")).toBeInTheDocument();
  expect(screen.queryByTestId("season-complete-s-d")).toBeNull();
  expect(screen.queryByTestId("season-delete-s-a")).toBeNull();
  expect(screen.getByTestId("season-delete-s-d")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-complete-s-a"));
  const preview = await screen.findByTestId("season-complete-preview");
  expect(preview).toHaveTextContent("2 Plätze · 1 Erfolg beim Abschluss");
  expect(preview).toHaveTextContent("Saisonmeister");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("season-complete-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/seasons/s-a/complete"));
});

test("Bearbeiten: kein „Abgeschlossen“ im Status, keine Fallback-Tabelle, Korrekturen mit Grund", async () => {
  seasonsApi();
  render(<MemoryRouter><AdminSeasonsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByTestId("season-edit-s-a"));
  const status = await screen.findByTestId("season-status");
  expect([...status.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Entwurf", "Aktiv", "Archiv"]);
  expect(screen.queryByTestId("season-points")).toBeNull();
  expect(screen.getByText(/Volle Saison \(Pflichttermine\)/)).toBeInTheDocument();
  expect(await screen.findByTestId("season-adjust-list")).toHaveTextContent("Regelverstoß");
  expect(screen.getByTestId("season-adjust-submit")).toBeDisabled();
});
