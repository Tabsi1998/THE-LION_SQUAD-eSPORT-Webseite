import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Regelseite (docs/LIGA.md, #1646): Inhaltsverzeichnis, Änderungen mit Schalter, Versionen, Vergleich, Rückfall, Zustimmung,
// noindex. Erfundene Regeln.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
const titleMock = vi.fn();
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: (...args) => titleMock(...args) }));

const { default: LeagueRulesPage } = await import("./LeagueRulesPage");

const VERSION_TWO = { id: "v2", scope: "league_season", version: 2, label: "Version 2", title: "Regelwerk Probe", valid_from: "2030-03-05",
  published_at: "2030-03-01T10:00:00+00:00", change_reason: "Pool erneuert", is_current: true, pdf_url: "/api/league-rules/seasons/probe/s1/versions/v2/pdf" };
const VERSION_ONE = { id: "v1", scope: "league_season", version: 1, label: "Version 1", title: "Regelwerk Probe", valid_from: "2030-01-01",
  published_at: "2030-01-01T10:00:00+00:00", change_reason: "Erste Fassung", is_current: false };
const PAGE = {
  league: { slug: "probe", name: "Probe-Liga" }, season: { id: "s1", slug: "s1", name: "Season 1" }, look: {}, public: true,
  source: "rules", version: VERSION_TWO, versions: [VERSION_TWO, VERSION_ONE], upcoming: null, seasons: [], consent: null, fallback_text: null,
  sections: [
    { anchor: "einleitung", title: null, level: 0, kind: "main", body_md: "Vorwort der Regeln.", mark: null },
    { anchor: "fairplay", title: "§ 1 Fairplay", level: 1, kind: "main", body_md: "Fair spielen.", mark: "changed" },
    { anchor: "maps", title: "§ 2 Maps", level: 1, kind: "main", body_md: "| Modus | Maps |\n| --- | --- |\n| Stellung | Hafenkante |", mark: "new" },
    { anchor: "anlage-a", title: "Anlage A: Strafen", level: 1, kind: "annex", body_md: "Verwarnung.", mark: null },
  ],
  changes: { base: VERSION_ONE, changed: [{ anchor: "fairplay", title: "§ 1 Fairplay" }], new: [{ anchor: "maps", title: "§ 2 Maps" }], removed: [{ anchor: "weg", title: "Alte Regel" }] },
};
const COMPARE = {
  base: VERSION_ONE, target: VERSION_TWO,
  sections: [
    { anchor: "fairplay", title: "§ 1 Fairplay", level: 1, status: "changed", ops: [{ op: "eq", text: "Fair " }, { op: "del", text: "bleiben" }, { op: "ins", text: "spielen" }] },
    { anchor: "gleich", title: "Gleich", level: 1, status: "same" },
    { anchor: "weg", title: "Alte Regel", level: 1, status: "removed", ops: [{ op: "del", text: "Entfernter Satz" }] },
  ],
};

function serve(page = PAGE, compare = COMPARE) {
  apiMock.get.mockImplementation((url, options) => {
    if (url === "/league-rules/seasons/probe/s1/compare") return Promise.resolve({ data: compare });
    if (url === "/league-rules/seasons/probe/s1") return Promise.resolve({ data: options?.params?.version === "v1" ? { ...page, version: VERSION_ONE, changes: { base: null, new: [], changed: [], removed: [] }, sections: page.sections.map((row) => ({ ...row, mark: null })) } : page });
    if (url === "/league-rules/leagues/probe") return Promise.resolve({ data: { ...page, season: null } });
    return Promise.reject(new Error(url));
  });
}

function renderPage(path = "/liga/probe/s1/regeln") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/liga/:league/regeln" element={<LeagueRulesPage />} />
        <Route path="/liga/:league/:season/regeln" element={<LeagueRulesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  titleMock.mockReset();
  serve();
});

// Namen stehen an der Fassung fest (#2269): Der Kopf nennt Liga und Season, wie sie beim Veröffentlichen hießen.
test("der Kopf nimmt die eingefrorenen Namen der Fassung, nicht die heutigen", async () => {
  serve({ ...PAGE, league: { slug: "probe", name: "Umbenannte Liga" }, version: { ...VERSION_TWO, names: { league: "Probe-Liga", season: "Season 1" } } });
  renderPage();
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByText("Probe-Liga Season 1")).toBeInTheDocument();
  expect(titleMock).toHaveBeenCalledWith("Regeln Probe-Liga Season 1", expect.any(String), expect.any(Object));
});

test("Kopf mit Version, Stand und PDF, Inhaltsverzeichnis mit Anlagen und festen Ankern", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Regelwerk Probe");
  const head = screen.getByTestId("rules-meta");
  expect(head).toHaveTextContent("Version 2");
  expect(head).toHaveTextContent("gültig ab 05.03.2030");
  expect(screen.getByTestId("rules-pdf")).toHaveAttribute("href", "/api/league-rules/seasons/probe/s1/versions/v2/pdf");
  const toc = screen.getByTestId("rules-toc");
  expect(within(toc).getByRole("link", { name: "§ 1 Fairplay" })).toHaveAttribute("href", "#fairplay");
  expect(within(toc).getByRole("link", { name: "Anlage A: Strafen" })).toHaveAttribute("href", "#anlage-a");
  expect(document.getElementById("fairplay")).toHaveTextContent("Fair spielen.");
  expect(screen.getByRole("link", { name: /Link auf § 1 Fairplay/ })).toHaveAttribute("href", "#fairplay");
});

test("Neu in Version X mit Links, Markierung sagt es in Worten, Schalter blendet alles aus", async () => {
  renderPage();
  const panel = await screen.findByTestId("rules-changes");
  expect(panel).toHaveTextContent("Neu in Version 2");
  expect(within(panel).getByRole("link", { name: "§ 2 Maps" })).toHaveAttribute("href", "#maps");
  expect(panel).toHaveTextContent("Entfernt: Alte Regel");
  const section = document.getElementById("fairplay");
  expect(section).toHaveAttribute("data-mark", "changed");
  expect(section).toHaveTextContent("Geändert in Version 2");
  expect(document.getElementById("maps")).toHaveTextContent("Neu in Version 2");

  fireEvent.click(screen.getByRole("switch", { name: /Änderungen markieren/ }));
  expect(document.getElementById("fairplay")).not.toHaveAttribute("data-mark");
  expect(document.getElementById("fairplay")).not.toHaveTextContent("Geändert in Version 2");
  expect(screen.getByTestId("rules-pdf").getAttribute("href")).toContain("marks=0");
});

test("Tabellen stehen im eigenen Scroll-Bereich, rohes HTML bleibt Text", async () => {
  serve({ ...PAGE, sections: [{ ...PAGE.sections[2], body_md: `${PAGE.sections[2].body_md}\n\n<script>alert(1)</script>` }] });
  renderPage();
  const section = await waitFor(() => { const row = document.getElementById("maps"); expect(row).toBeTruthy(); return row; });
  expect(section.querySelector(".prose-cms-table table")).toBeTruthy();
  expect(section.querySelector("script")).toBeNull();
  expect(section).toHaveTextContent("<script>alert(1)</script>");
});

test("Alte Version: Hinweis mit Link zur gültigen, nichts für Suchmaschinen", async () => {
  renderPage("/liga/probe/s1/regeln?version=v1");
  const old = await screen.findByTestId("rules-old-version");
  expect(old).toHaveTextContent("Version 1");
  expect(within(old).getByRole("link")).toHaveAttribute("href", "/liga/probe/s1/regeln");
  expect(apiMock.get).toHaveBeenCalledWith("/league-rules/seasons/probe/s1", { params: { version: "v1" } });
  await waitFor(() => expect(titleMock.mock.calls.at(-1)[2].robots).toBe("noindex, nofollow"));
});

test("Gültige öffentliche Fassung darf in den Index, sonst nicht", async () => {
  renderPage();
  await screen.findByTestId("rules-document");
  expect(titleMock.mock.calls.at(-1)[2].robots).toBe("index, follow");
  expect(titleMock.mock.calls.at(-1)[2].canonical).toContain("/liga/probe/s1/regeln");
});

test("Nur für Mitglieder: noindex", async () => {
  serve({ ...PAGE, public: false });
  renderPage();
  await screen.findByTestId("rules-document");
  expect(titleMock.mock.calls.at(-1)[2].robots).toBe("noindex, nofollow");
});

test("Versionen wählen und Wort für Wort vergleichen, auch entfernter Text", async () => {
  renderPage();
  await screen.findByTestId("rules-document");
  expect(within(screen.getByTestId("rules-version-select")).getByRole("option", { name: /Version 1/ })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("rules-compare-select"), { target: { value: "v1" } });
  const view = await screen.findByTestId("rules-compare");
  expect(apiMock.get).toHaveBeenCalledWith("/league-rules/seasons/probe/s1/compare", { params: { base: "v1", target: "v2" } });
  expect(within(view).getByText("bleiben").tagName).toBe("DEL");
  expect(within(view).getByText("spielen").tagName).toBe("INS");
  expect(within(view).getByText("Entfernter Satz").tagName).toBe("DEL");
  expect(view).toHaveTextContent("Entfernt");
  expect(view).toHaveTextContent("1 Abschnitt unverändert");
  expect(screen.queryByTestId("rules-document")).toBeNull();
  fireEvent.click(within(view).getByRole("button", { name: /Zurück zum Text/ }));
  expect(await screen.findByTestId("rules-document")).toBeInTheDocument();
});

test("Großer Vergleich: geänderter Abschnitt steht ganz da und sagt warum", async () => {
  serve(PAGE, { ...COMPARE, sections: [{ anchor: "fairplay", title: "§ 1 Fairplay", level: 1, status: "changed", coarse: true,
    ops: [{ op: "del", text: "Alter langer Text" }, { op: "ins", text: "Neuer langer Text" }] }] });
  renderPage("/liga/probe/s1/regeln?vergleich=v1");
  expect(await screen.findByTestId("rules-compare-coarse")).toHaveTextContent("erst alt, dann neu");
});

test("Rückfall: Season ohne Regelwerk zeigt ihren Regeltext", async () => {
  serve({ ...PAGE, source: "fallback", version: null, versions: [], sections: [], fallback_text: "## Alt\nAlter Regeltext",
    changes: { base: null, new: [], changed: [], removed: [] } });
  renderPage();
  const body = await screen.findByTestId("rules-fallback");
  expect(body).toHaveTextContent("Alter Regeltext");
  expect(screen.queryByTestId("rules-pdf")).toBeNull();
  expect(screen.queryByTestId("rules-toc")).toBeNull();
});

test("Ganz ohne Text: ein Satz statt einer leeren Seite", async () => {
  serve({ ...PAGE, source: "none", version: null, versions: [], sections: [], changes: { base: null, new: [], changed: [], removed: [] } });
  renderPage();
  expect(await screen.findByTestId("rules-empty")).toHaveTextContent("noch keine Regeln");
});

test("Unsichtbar antwortet wie „gibt es nicht“", async () => {
  apiMock.get.mockRejectedValue(new Error("404"));
  renderPage();
  expect(await screen.findByTestId("rules-missing")).toBeInTheDocument();
});

test("Künftige Fassung wird angekündigt", async () => {
  serve({ ...PAGE, upcoming: { id: "v3", version: 3, label: "Version 3", valid_from: "2031-01-02" } });
  renderPage();
  const note = await screen.findByTestId("rules-upcoming");
  expect(note).toHaveTextContent("Version 3 gilt ab 02.01.2031");
  expect(within(note).getByRole("link")).toHaveAttribute("href", "/liga/probe/s1/regeln?version=v3");
});

test("Kapitäns-Hinweis: Zustimmen schreibt genau diese Version, danach steht es da, Spiel läuft trotzdem", async () => {
  const open = { version_id: "v2", version: 2, label: "Version 2", squads: [{ squad_id: "sq1", squad_name: "Rudel A", agreed: false, agreed_at: null }] };
  serve({ ...PAGE, consent: open });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  renderPage();
  const hint = await screen.findByTestId("rules-consent");
  expect(hint).toHaveTextContent("Rudel A");
  expect(hint).toHaveTextContent("Spiele laufen auch ohne Zustimmung weiter");
  serve({ ...PAGE, consent: { ...open, squads: [{ ...open.squads[0], agreed: true, agreed_at: "2030-03-06T10:00:00+00:00" }] } });
  fireEvent.click(within(hint).getByRole("button", { name: /Zustimmen/ }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/league-rules/consents", { version_id: "v2", season_id: "s1", squad_id: "sq1" }));
  expect(await screen.findByTestId("rules-consent-done-sq1")).toHaveTextContent("zugestimmt");
});

test("Keine Zustimmungs-Knöpfe auf einer alten Fassung", async () => {
  const open = { version_id: "v2", version: 2, label: "Version 2", squads: [{ squad_id: "sq1", squad_name: "Rudel A", agreed: false, agreed_at: null }] };
  serve({ ...PAGE, consent: open });
  renderPage("/liga/probe/s1/regeln?version=v1");
  await screen.findByTestId("rules-old-version");
  expect(screen.queryByTestId("rules-consent")).toBeNull();
});

test("Seite der Liga: kommt ohne Season aus und verlinkt die Seasons", async () => {
  serve({ ...PAGE, seasons: [{ name: "Season 1", slug: "s1", url: "/liga/probe/s1/regeln" }] });
  renderPage("/liga/probe/regeln");
  await screen.findByTestId("rules-document");
  expect(apiMock.get).toHaveBeenCalledWith("/league-rules/leagues/probe", { params: {} });
  expect(within(screen.getByTestId("rules-seasons")).getByRole("link", { name: "Season 1" })).toHaveAttribute("href", "/liga/probe/s1/regeln");
});

test("Suche in der Seite zählt Treffer und springt, Löschen räumt auf", async () => {
  renderPage();
  await screen.findByTestId("rules-document");
  const input = screen.getByRole("searchbox", { name: /In den Regeln suchen/ });
  fireEvent.change(input, { target: { value: "fair" } });
  expect(await screen.findByTestId("rules-search-count")).toHaveTextContent("1 von 2");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("rules-search-count")).toHaveTextContent("2 von 2");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByTestId("rules-search-count")).toHaveTextContent("1 von 2");
  fireEvent.change(input, { target: { value: "gibtesnicht" } });
  expect(await screen.findByTestId("rules-search-count")).toHaveTextContent("Keine Treffer");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
});
