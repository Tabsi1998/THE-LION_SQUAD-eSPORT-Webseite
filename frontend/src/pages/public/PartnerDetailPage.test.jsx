import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Partnerseite (#469): Kopf mit Art, „seit“, Live-Pille und Kanal-Symbolen; Twitch-Stream nur live
// (ohne Zustimmung der Hinweis), Kanäle mit Zuschauern und Discord-Online-Zahl, Tools mit
// Einbetten nach Zustimmung, News mit dem Partner; unbekannter Partner → Hinweis.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, openSettings: () => {}, consent: {}, allow: () => {} }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));

const { default: PartnerDetailPage, channelDetail } = await import("./PartnerDetailPage");

const PARTNER = {
  id: "p1", slug: "pineapps-tft", name: "PineApps TFT", kind: "Community", since: "2025", logo_url: "/api/static/pine.png",
  description: "TFT-Community aus Tirol.", about: "Spielt viel TFT.\nBaut Tools dafür.",
  channels: [
    { key: "website", label: "Website", url: "https://pineapps.at", handle: null },
    { key: "discord", label: "Discord", url: "https://discord.gg/pine", handle: null },
    { key: "twitch", label: "Twitch", url: "https://www.twitch.tv/pineapps", handle: "pineapps" },
  ],
  twitch: { configured: true, live: true, title: "TFT Ranked Grind", viewer_count: 23, game_name: "Teamfight Tactics" },
  discord: { enabled: true, name: "PineApps", online: 12, invite: "https://discord.gg/pine" },
  tools: [{ id: "t1", title: "TFT Dashboard", url: "https://tft.pineapps.at", description: "Ranglisten", embed: true }, { id: "t2", title: "Discord-Bot", url: "https://bot.pineapps.at", embed: false }],
  news: [{ id: "n1", slug: "tft-abend", title: "TFT-Abend mit PineApps TFT", published_at: "2026-09-01T10:00:00Z" }],
  shared: {
    events: [{ id: "e1", slug: "sommer-cup", name: "Sommer-Cup", start_date: "2026-08-10T10:00:00Z" }],
    tournaments: [{ id: "t1", slug: "tft-open", title: "TFT Open", start_date: "2026-09-05T18:00:00Z", game: { name: "Teamfight Tactics" } }],
    references: [{ id: "r1", title: "PineApps Open", placement: 2, game_name: "Teamfight Tactics", start_date: "2026-06-01", matched_by: "organizer" }],
  },
  redirected: false,
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/partners/:slug" element={<PartnerDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

test("Kopf, Live-Stream, Kanäle mit Stand, Tools mit Einbetten und News", async () => {
  apiMock.get.mockResolvedValue({ data: PARTNER });
  renderAt("/partners/pineapps-tft");
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("PineApps TFT");
  expect(apiMock.get).toHaveBeenCalledWith("/partners/pineapps-tft");
  expect(screen.getByTestId("partner-hero")).toHaveTextContent("Partner seit 2025");
  expect(screen.getByTestId("partner-live-pill")).toBeInTheDocument();
  expect(screen.getByTestId("partner-icon-twitch")).toHaveAttribute("href", "https://www.twitch.tv/pineapps");

  const live = screen.getByTestId("partner-twitch-live");
  expect(live).toHaveTextContent("23 Zuschauer");
  expect(live).toHaveTextContent("TFT Ranked Grind · Teamfight Tactics");
  expect(screen.getByTestId("partner-twitch-consent-notice")).toBeInTheDocument();
  expect(live.querySelector("iframe")).toBeNull();

  expect(screen.getByTestId("partner-channel-discord")).toHaveTextContent("12 gerade online · PineApps");
  expect(screen.getByTestId("partner-channel-discord")).toHaveTextContent("Beitreten");
  expect(screen.getByTestId("partner-channel-twitch")).toHaveTextContent("Live · 23 Zuschauer");
  expect(screen.getByTestId("partner-channel-website")).toHaveTextContent("pineapps.at");
  expect(screen.getByTestId("partner-about")).toHaveTextContent("Baut Tools dafür.");

  expect(screen.getByTestId("partner-tools")).toHaveTextContent("Vom Partner (2)");
  expect(screen.queryByTestId("partner-tool-embed-t2")).toBeNull();
  expect(screen.getByTestId("partner-tool-open-t1")).toHaveAttribute("href", "https://tft.pineapps.at");
  fireEvent.click(screen.getByTestId("partner-tool-embed-t1"));
  const embed = screen.getByTestId("partner-tool-embed");
  expect(embed.querySelector("iframe")).toBeNull();
  expect(screen.getByTestId("partner-tool-consent-notice")).toBeInTheDocument();

  expect(screen.getByTestId("partner-news-tft-abend")).toHaveAttribute("href", "/news/tft-abend");
  // Teil 2: gemeinsame Events und Turniere mit Link auf ihre Seite.
  expect(screen.getByTestId("partner-shared")).toHaveTextContent("Turnier · Teamfight Tactics");
  expect(screen.getByTestId("partner-event-sommer-cup")).toHaveAttribute("href", "/events/sommer-cup");
  expect(screen.getByTestId("partner-tournament-tft-open")).toHaveAttribute("href", "/tournaments/tft-open");
  // Teil 3: echte Teilnahmen des Vereins (Referenzen) mit Platz.
  expect(screen.getByTestId("partner-reference-r1")).toHaveAttribute("href", "/references/r1");
  expect(screen.getByTestId("partner-reference-r1")).toHaveTextContent("Teilnahme · Platz 2 · Teamfight Tactics");
});

test("ohne Stream und Widget bleiben Links; unbekannter Partner zeigt den Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { ...PARTNER, twitch: { configured: false, live: false }, discord: { enabled: false }, tools: [], news: [], about: "", shared: { events: [], tournaments: [], references: [] } } });
  renderAt("/partners/pineapps-tft");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByTestId("partner-live-pill")).toBeNull();
  expect(screen.queryByTestId("partner-twitch-live")).toBeNull();
  expect(screen.getByTestId("partner-channel-twitch")).toHaveTextContent("twitch.tv/pineapps");
  expect(screen.getByTestId("partner-channel-discord")).toHaveTextContent("Einladung");
  expect(screen.getByTestId("partner-empty")).toBeInTheDocument();

  apiMock.get.mockRejectedValue(Object.assign(new Error("404"), { response: { status: 404 } }));
  renderAt("/partners/gibtsnicht");
  expect(await screen.findByTestId("partner-missing")).toHaveTextContent("Partner nicht gefunden");
});

test("channelDetail: Live-Zuschauer, offline, Online-Zahl, Hostname", () => {
  expect(channelDetail({ key: "twitch", handle: "x" }, { configured: true, live: true, viewer_count: 5 }, null).text).toBe("Live · 5 Zuschauer");
  expect(channelDetail({ key: "twitch", handle: "x" }, { configured: true, live: false }, null).text).toBe("gerade offline");
  expect(channelDetail({ key: "discord", url: "https://discord.gg/a" }, null, { enabled: true, online: 3 }).text).toBe("3 gerade online");
  expect(channelDetail({ key: "youtube", url: "https://www.youtube.com/@pine" }, null, null).text).toBe("youtube.com");
});


// ---------------------------------------------------------------- Ligen und Serien mit uns (#1934)
const SERIES = [{
  lineage: { title: "Probe Ananas Liga", slug: "probe-ananas-liga", kind: "racing", label: "F1", game_name: "Probespiel" },
  role: "organizer", running: true,
  seasons: [
    { season: "2026", tier: null, title: null, season_slug: "2026", status: "active", running: true, club: { rank: 4, of: 12 } },
    { season: "2025", tier: "Liga 1", title: null, season_slug: "2025-liga-1", status: "completed", running: false, club: { rank: 2, of: 10 } },
    { season: "2024", tier: null, title: null, season_slug: "2024", status: "completed", running: false, club: null },
  ],
}];

test("Ligen und Serien mit uns: Spur mit Rolle, Saisons mit Stand bzw. Endplatz und läuft gerade", async () => {
  apiMock.get.mockResolvedValue({ data: { ...PARTNER, shared: { ...PARTNER.shared, series: SERIES } } });
  renderAt("/partners/pineapps-tft");
  const section = await screen.findByTestId("partner-series");
  expect(section).toHaveTextContent("Ligen und Serien mit uns");
  const card = screen.getByTestId("partner-series-probe-ananas-liga");
  expect(card).toHaveTextContent("Veranstalter: PineApps TFT · Rennliga · Probespiel");
  const running = screen.getByTestId("partner-season-probe-ananas-liga-2026");
  expect(running).toHaveAttribute("href", "/references/series/probe-ananas-liga/2026");
  expect(running).toHaveTextContent("Läuft gerade");
  expect(running).toHaveTextContent("Stand: 4. von 12");
  const done = screen.getByTestId("partner-season-probe-ananas-liga-2025-liga-1");
  expect(done).toHaveTextContent("2025 · Liga 1");
  expect(done).toHaveTextContent("Endplatz 2. von 10");
  expect(within(done).queryByTestId("partner-season-running")).toBeNull();
  expect(within(screen.getByTestId("partner-season-probe-ananas-liga-2024")).queryByTestId("partner-season-place")).toBeNull();
});

test("ohne Ligen und Serien kein Bereich", async () => {
  apiMock.get.mockResolvedValue({ data: PARTNER });
  renderAt("/partners/pineapps-tft");
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByTestId("partner-series")).toBeNull();
});
