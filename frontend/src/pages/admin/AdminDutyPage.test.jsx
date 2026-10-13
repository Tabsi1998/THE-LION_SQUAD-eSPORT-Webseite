import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Mein Dienst“ (#1352): Helfer sehen genau ihre Turniere mit ihrer Rolle, heute zuerst, je mit einem Knopf zur
// Turnierleitung; Moderation sieht die Meldungen; wer nichts hat, liest einen Satz statt einer leeren Seite.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

const { default: AdminDutyPage } = await import("./AdminDutyPage");

function renderWith(data) {
  apiMock.get.mockResolvedValue({ data });
  return render(<MemoryRouter><AdminDutyPage /></MemoryRouter>);
}

const TODAY = {
  kind: "tournament", id: "t-1", slug: "herbst-cup", title: "Herbst-Cup", today: true, starts_at: "2026-10-13T16:00:00Z",
  roles: ["referee", "scorekeeper"], url: "/tournaments/herbst-cup/leitung", admin_url: "/admin/tournaments/t-1",
};
const LATER = {
  kind: "fastlap", id: "f-1", title: "Monza Fast Lap", today: false, starts_at: "2026-10-17T10:00:00Z",
  roles: ["scorekeeper"], url: "/admin/f1/f-1", admin_url: "/admin/f1/f-1",
};

beforeEach(() => apiMock.get.mockReset());

test("Helfer: eigene Einsätze in der Reihenfolge des Servers, mit Rolle und Knopf zur Turnierleitung", async () => {
  renderWith({ assignments: [TODAY, LATER], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-heading")).toHaveTextContent("Mein Dienst");
  const rows = within(screen.getByTestId("duty-assignments")).getAllByRole("listitem");
  expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual(["duty-row-t-1", "duty-row-f-1"]);
  expect(screen.getByTestId("duty-when-t-1")).toHaveTextContent(/^Heute · \d\d:\d\d$/);
  expect(screen.getByTestId("duty-roles-t-1")).toHaveTextContent("Deine Rolle: Schiedsrichter, Ergebnisdienst");
  expect(screen.getByTestId("duty-open-t-1")).toHaveAttribute("href", "/tournaments/herbst-cup/leitung");
  expect(screen.getByTestId("duty-open-t-1")).toHaveTextContent("Turnierleitung öffnen");
  expect(screen.getByTestId("duty-admin-t-1")).toHaveAttribute("href", "/admin/tournaments/t-1");
  expect(screen.getByTestId("duty-open-f-1")).toHaveTextContent("Fast Lap öffnen");
  expect(screen.queryByTestId("duty-moderation")).toBeNull();
  expect(apiMock.get).toHaveBeenCalledWith("/users/me/duty");
});

test("Moderation: die Meldungen mit Zähler, keine Turnierliste", async () => {
  renderWith({ assignments: [], moderation: { open_reports: 3 }, lead_today: [] });
  expect(await screen.findByTestId("duty-moderation-count")).toHaveTextContent("3 offene Meldungen");
  expect(screen.getByTestId("duty-moderation-open")).toHaveAttribute("href", "/admin/moderation");
  expect(screen.queryByTestId("duty-assignments")).toBeNull();
  expect(screen.queryByTestId("duty-empty")).toBeNull();
});

test("ohne Einsatz ein Satz statt einer leeren Seite", async () => {
  renderWith({ assignments: [], moderation: null, lead_today: [] });
  expect(await screen.findByTestId("duty-empty")).toHaveTextContent("Gerade hast du keinen Einsatz.");
});
