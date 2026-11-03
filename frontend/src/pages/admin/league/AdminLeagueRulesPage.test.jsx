import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Regelwerk pflegen (docs/LIGA.md, #1646): Entwurf, Vorschau, Veröffentlichen, Vorschlag bei Datenänderung, Zustimmungen. Erfundene Regeln.
const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => () => Promise.resolve(true), usePrompt: () => () => Promise.resolve(false) }));
vi.mock("@/components/tls/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange, testId, mediaScope, libraryEndpoint }) => (
    <textarea data-testid={testId} data-scope={mediaScope} data-library={libraryEndpoint} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const auth = { user: { role: "superadmin" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

const { default: AdminLeagueRulesPage } = await import("./AdminLeagueRulesPage");

const BLOCKS = [{ key: "map_pool", label: "Map-Pool", hint: "Die Maps je Modus.", token: "[[baustein:map_pool]]" }];
const VIEW = {
  scope: "league_season", scope_id: "s1", league: { id: "l1", name: "Probe-Liga", slug: "probe" }, season: { id: "s1", name: "Season 1", slug: "s1", visibility: "public" },
  draft: null, versions: [], inherited: null, current: null, blocks: BLOCKS, data_changes: null, consents: null, public_url: "/liga/probe/s1/regeln", today: "2030-03-05",
};
const DRAFT = { id: "d1", status: "draft", revision: 3, title: "Regelwerk", body_md: "# Fairplay\nText", annexes: [{ key: "A", title: "Strafen", body_md: "Katalog" }] };
const HEAD = { id: "v1", version: 1, label: "Version 1", scope: "league_season", valid_from: "2030-01-01", published_at: "2030-01-01T10:00:00+00:00", change_reason: "Erste Fassung", is_current: true };

function serve(view = VIEW) {
  apiMock.get.mockImplementation(() => Promise.resolve({ data: view }));
}

function renderPage(path = "/admin/leagues/rules/league_season/s1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/admin/leagues/rules/:scope/:scopeId" element={<AdminLeagueRulesPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMock)) mock.mockReset();
  serve();
});

test("Zuständige ohne Admin-Medien bekommen im Haupttext und in Anlagen die eigenen Bilder", async () => {
  auth.user = { role: "player", areas: [], has_league_staff: true };
  serve({ ...VIEW, draft: DRAFT });
  renderPage();
  for (const testId of ["rules-body", "rules-annex-body-0"]) {
    const editor = await screen.findByTestId(testId);
    expect(editor).toHaveAttribute("data-scope", "user");
    expect(editor).toHaveAttribute("data-library", "/media?type=images");
  }
  auth.user = { role: "superadmin" };
});

test("Ohne alles: Entwurf anfangen, speichern schickt Text und Anlagen", async () => {
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-new-draft"));
  fireEvent.change(screen.getByTestId("rules-title"), { target: { value: "Regelwerk" } });
  fireEvent.change(screen.getByTestId("rules-body"), { target: { value: "# Eins\nText" } });
  fireEvent.click(screen.getByTestId("rules-annex-add"));
  fireEvent.change(screen.getByTestId("rules-annex-title-0"), { target: { value: "Strafen" } });
  fireEvent.change(screen.getByTestId("rules-annex-body-0"), { target: { value: "Katalog" } });
  expect(screen.getByTestId("rules-annex-0")).toHaveTextContent("Anlage A");
  apiMock.put.mockResolvedValue({ data: DRAFT });
  fireEvent.click(screen.getByTestId("rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/draft", {
    title: "Regelwerk", body_md: "# Eins\nText", annexes: [{ title: "Strafen", body_md: "Katalog" }],
  }));
});

test("Baustein einfügen setzt die Marke in den Text", async () => {
  serve({ ...VIEW, draft: DRAFT });
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-block-map_pool"));
  expect(screen.getByTestId("rules-body")).toHaveValue("# Fairplay\nText\n\n[[baustein:map_pool]]\n");
});

test("Vorhandener Entwurf: speichern mit Revision, Vorschau zeigt die Seite und nennt unbekannte Bausteine", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.post.mockResolvedValue({ data: { sections: [{ anchor: "fairplay", title: "Fairplay", level: 1, kind: "main", body_md: "Text aus der Vorschau", mark: "new" }],
    changes: { base: HEAD, new: [{ anchor: "fairplay", title: "Fairplay" }], changed: [], removed: [] }, blocks_used: [], unknown_blocks: ["gibtsnicht"] } });
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-preview"));
  const preview = await screen.findByTestId("rules-preview-panel");
  expect(preview).toHaveTextContent("Text aus der Vorschau");
  expect(preview).toHaveTextContent("gibtsnicht");
  expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/preview", expect.objectContaining({ body_md: "# Fairplay\nText" }));
  apiMock.put.mockResolvedValue({ data: { ...DRAFT, revision: 4 } });
  fireEvent.click(screen.getByTestId("rules-save"));
  await waitFor(() => expect(apiMock.put.mock.calls[0][1].revision).toBe(3));
});

test("Vorschau nennt fremde Bilder", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.post.mockResolvedValue({ data: { sections: [], changes: { base: null, new: [], changed: [], removed: [] }, blocks_used: [], unknown_blocks: [],
    foreign_images: ["https://bilder.example.test/plan.png"] } });
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-preview"));
  expect(await screen.findByTestId("rules-preview-foreign")).toHaveTextContent("bilder.example.test");
});

test("Veröffentlichen schickt Revision, Tag, Grund und die Wahl zur Zustimmung; ungespeichert wird erst gespeichert", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.put.mockResolvedValue({ data: { ...DRAFT, revision: 4 } });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  renderPage();
  fireEvent.change(await screen.findByTestId("rules-body"), { target: { value: "# Fairplay\nNeu" } });
  fireEvent.change(screen.getByTestId("rules-reason"), { target: { value: "Fairplay neu gefasst" } });
  fireEvent.click(screen.getByTestId("rules-requires-consent"));
  fireEvent.click(screen.getByTestId("rules-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/publish", {
    revision: 4, valid_from: "2030-03-05", change_reason: "Fairplay neu gefasst", requires_consent: true,
  }));
  expect(apiMock.put).toHaveBeenCalledTimes(1);
});

test("Ohne Grund geht der Knopf nicht", async () => {
  serve({ ...VIEW, draft: DRAFT });
  renderPage();
  expect(await screen.findByTestId("rules-publish")).toBeDisabled();
});

test("Daten geändert: Unterschied sehen und neue Version vorbereiten, nichts geht von selbst raus", async () => {
  const changes = { version_id: "v1", version: 1, label: "Version 1", rows: [{ block: "map_pool", label: "Map-Pool", season_id: "s1", season_name: "Season 1", status: "changed",
    before: "Hafenkante", after: "Turmblick", ops: [{ op: "del", text: "Hafenkante" }, { op: "ins", text: "Turmblick" }] }] };
  serve({ ...VIEW, versions: [HEAD], current: HEAD, data_changes: changes });
  apiMock.post.mockResolvedValue({ data: DRAFT });
  renderPage();
  const box = await screen.findByTestId("rules-data-changes");
  expect(box).toHaveTextContent("Daten geändert");
  expect(within(box).getByText("Hafenkante").tagName).toBe("DEL");
  expect(within(box).getByText("Turmblick").tagName).toBe("INS");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.click(within(box).getByRole("button", { name: /Neue Version vorbereiten/ }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/draft/from-version", {}));
});

test("Season erbt die Liga: das steht da, eigene Fassung geht aus dem Geerbten", async () => {
  serve({ ...VIEW, inherited: { ...HEAD, scope: "league", label: "Version 1 (Liga)" }, current: HEAD });
  apiMock.post.mockResolvedValue({ data: DRAFT });
  renderPage();
  const box = await screen.findByTestId("rules-inherited");
  expect(box).toHaveTextContent("Version 1 (Liga)");
  expect(within(box).getByRole("link", { name: /Regelwerk der Liga/ })).toHaveAttribute("href", "/admin/leagues/rules/league/l1");
  fireEvent.click(within(box).getByRole("button", { name: /Eigenes Regelwerk/ }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/draft/from-version", {}));
});

test("Fassungen mit Grund und PDF, Zustimmungen je Co-Team", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, consents: { version_id: "v1", label: "Version 1", rows: [
    { squad_id: "a", squad_name: "Rudel A", team_name: "Löwen · Rudel A", agreed: true, agreed_at: "2030-01-02T10:00:00+00:00", agreed_by: "Testkapitän" },
    { squad_id: "b", squad_name: "Horst", team_name: "Falken · Horst", agreed: false, agreed_at: null, agreed_by: "" },
  ] } });
  renderPage();
  const versions = await screen.findByTestId("rules-versions");
  expect(versions).toHaveTextContent("Erste Fassung");
  expect(within(versions).getByRole("link", { name: /PDF/ }).getAttribute("href")).toContain("/versions/v1/pdf");
  const consents = screen.getByTestId("rules-consents");
  expect(consents).toHaveTextContent("Testkapitän");
  expect(within(consents).getByTestId("rules-consent-row-b")).toHaveTextContent("offen");
});

test("Entwurf verwerfen", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-discard"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/draft"));
});

test("Fehler vom Server stehen da", async () => {
  apiMock.get.mockRejectedValue({ response: { data: { detail: "Keine Season" } } });
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent("Keine Season");
});

// Season-Seite mit Reitern (#2267): zurück geht es in den Reiter „Regelwerk und Sperrliste“.
test("der Weg zurück führt in den Reiter Regelwerk der Season", async () => {
  renderPage();
  expect(await screen.findByTestId("rules-back")).toHaveAttribute("href", "/admin/leagues/seasons/s1#regelwerk");
});
