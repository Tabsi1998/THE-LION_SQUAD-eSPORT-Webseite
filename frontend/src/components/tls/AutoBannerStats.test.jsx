import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Automatische Hinweisbanner (#2352): die Liste unter Einstellungen → Banner und die Zahlen am Turnier.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { AutoBannerList, AutoBannerStats } = await import("./AutoBannerStats");

beforeEach(() => {
  apiMock.get.mockReset();
});

test("die Liste zeigt jeden laufenden automatischen Banner mit Zahlen und Link zur Schaltstelle", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [{
    id: "auto-tournament-registration-t-1", kind: "tournament", template: "registration", title: "Herbst-Cup",
    text: "Anmeldung offen: Herbst-Cup", period_start: "", period_end: "", manage_url: "/admin/tournaments/t-1?tab=edit",
    stats: { impressions: 12, clicks: 4, last_impression_at: "", last_click_at: "" },
  }] } });
  render(<MemoryRouter><AutoBannerList /></MemoryRouter>);
  const row = await screen.findByTestId("auto-banner-auto-tournament-registration-t-1");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/site-banners/admin/auto");
  expect(row).toHaveTextContent("Turnier · Anmeldung / Check-in");
  expect(row).toHaveTextContent("Herbst-Cup");
  expect(row).toHaveTextContent("Views 12 · Klicks 4");
  expect(screen.getByRole("link", { name: "Zum Turnier Herbst-Cup" })).toHaveAttribute("href", "/admin/tournaments/t-1?tab=edit");
});

test("ohne laufende Banner sagt die Liste das", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [] } });
  render(<MemoryRouter><AutoBannerList /></MemoryRouter>);
  expect(await screen.findByText("Gerade läuft kein automatischer Banner.")).toBeInTheDocument();
});

test("am Turnier: Summe und Aufschlüsselung je Vorlage", async () => {
  apiMock.get.mockResolvedValue({ data: {
    items: [
      { id: "auto-tournament-registration-t-1", template: "registration", stats: { impressions: 4, clicks: 2 } },
      { id: "auto-tournament-event-t-1", template: "event", stats: { impressions: 5, clicks: 1 } },
    ],
    total: { impressions: 9, clicks: 3, last_impression_at: "" },
  } });
  render(<AutoBannerStats kind="tournament" refId="t-1" />);
  const box = await screen.findByTestId("auto-banner-stats-tournament");
  expect(apiMock.get).toHaveBeenCalledWith("/settings/site-banners/admin/stats/tournament/t-1");
  expect(box).toHaveTextContent("Views 9 · Klicks 3");
  expect(box).toHaveTextContent("Anmeldung / Check-in: Views 4 · Klicks 2");
  expect(box).toHaveTextContent("Startet bald: Views 5 · Klicks 1");
});

test("ein Turnier ohne Zahlen zeigt nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [], total: { impressions: 0, clicks: 0, last_impression_at: "" } } });
  render(<AutoBannerStats kind="tournament" refId="t-2" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("auto-banner-stats-tournament")).toBeNull();
});
