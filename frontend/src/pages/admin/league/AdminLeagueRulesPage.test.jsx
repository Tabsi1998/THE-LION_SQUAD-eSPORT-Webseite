import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Regelwerk pflegen (docs/LIGA.md, #1646): Entwurf, Vorschau, Veröffentlichen, Vorschlag bei Datenänderung, Zustimmungen. Erfundene Regeln.
const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => () => Promise.resolve(true), usePrompt: () => () => Promise.resolve(false) }));
vi.mock("@/components/tls/MarkdownEditor", async () => {
  const { forwardRef } = await import("react");
  return {
    appendText: (value, text) => `${value}${value && !/\s$/.test(value) ? " " : ""}${text}`,
    MarkdownEditor: forwardRef(({ value, onChange, testId, mediaScope, libraryEndpoint }, _ref) => (
      <textarea data-testid={testId} data-scope={mediaScope} data-library={libraryEndpoint} value={value} onChange={(event) => onChange(event.target.value)} />
    )),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const auth = { user: { role: "superadmin" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

const { default: AdminLeagueRulesPage } = await import("./AdminLeagueRulesPage");

const BLOCKS = [{ key: "map_pool", label: "Map-Pool", hint: "Die Maps je Modus.", token: "[[baustein:map_pool]]" }];
const VARIABLES = [
  { name: "best_of", label: "Best of", hint: "Länge der Serie.", group: "Serie und Kader", token: "{{best_of}}", value: "3" },
  { name: "max_squad_size", label: "Höchstkader", hint: "", group: "Serie und Kader", token: "{{max_squad_size}}", value: null },
  { name: "mode:stellung.target", label: "Stellung · Ziel", hint: "Zielpunkte.", group: "Modi", token: "{{mode:stellung.target}}", value: "250" },
];
const VIEW = {
  scope: "league_season", scope_id: "s1", league: { id: "l1", name: "Probe-Liga", slug: "probe" }, season: { id: "s1", name: "Season 1", slug: "s1", visibility: "public" },
  draft: null, versions: [], inherited: null, current: null, blocks: BLOCKS, variables: VARIABLES, data_changes: null, proposal: null, consents: null,
  public_url: "/liga/probe/s1/regeln", today: "2030-03-05",
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
    revision: 4, valid_from: "2030-03-05", change_reason: "Fairplay neu gefasst", requires_consent: true, confirm_empty: false,
  }));
  expect(apiMock.put).toHaveBeenCalledTimes(1);
});

test("Ohne Grund geht der Knopf nicht", async () => {
  serve({ ...VIEW, draft: DRAFT });
  renderPage();
  expect(await screen.findByTestId("rules-publish")).toBeDisabled();
});

const CHANGES = { version_id: "v1", version: 1, label: "Version 1", rows: [
  { kind: "block", block: "map_pool", label: "Map-Pool", season_id: "s1", season_name: "Season 1", status: "changed",
    before: "Hafenkante", after: "Turmblick", ops: [{ op: "del", text: "Hafenkante" }, { op: "ins", text: "Turmblick" }] },
  { kind: "variable", block: "team_size", label: "{{team_size}} · Teamgröße", season_id: "s1", season_name: "Season 1", status: "changed",
    before: "4", after: "5", ops: [{ op: "del", text: "4" }, { op: "ins", text: "5" }] },
] };
const PROPOSAL = { base: HEAD, unknown_vars: [], empty_vars: [], fingerprint: "abdruck-1",
  sections: [{ anchor: "1-serie", title: "§ 1 Serie", level: 1, kind: "main", body_md: "Gespielt wird mit 5 Spielern.", mark: "changed" }],
  changes: { base: HEAD, changed: [{ anchor: "1-serie", title: "§ 1 Serie" }], new: [], removed: [] } };

test("Regelwerk muss freigegeben werden: Unterschiede je Baustein und Variable, Vorschlag mit Markierung, Freigabe mit Zustimmungspflicht", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, data_changes: CHANGES, proposal: PROPOSAL });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  renderPage();
  const box = await screen.findByTestId("rules-data-changes");
  expect(box).toHaveTextContent("Regelwerk muss freigegeben werden");
  expect(box).toHaveTextContent("1 Baustein, 1 Variable");
  expect(within(box).getByText("Hafenkante").tagName).toBe("DEL");
  expect(within(box).getByText("Turmblick").tagName).toBe("INS");
  expect(screen.getByTestId("rules-change-variable-team_size")).toHaveTextContent("Variable");
  expect(screen.getByTestId("rules-change-variable-team_size")).toHaveTextContent("{{team_size}} · Teamgröße");
  // Der Vorschlag steht da, markiert gegen die letzte Fassung - ohne dass ein Entwurf entstanden wäre.
  expect(screen.getByTestId("rules-proposal-document")).toHaveTextContent("Gespielt wird mit 5 Spielern.");
  expect(screen.getByTestId("rules-proposal-changes")).toHaveTextContent("Geändert");
  expect(apiMock.post).not.toHaveBeenCalled();
  // Freigeben: Grund ist vorbelegt, die Zustimmungspflicht ist an - beides lässt sich ändern.
  expect(screen.getByTestId("rules-approve-reason")).toHaveValue("Einstellungen geändert: Map-Pool, Teamgröße");
  expect(screen.getByTestId("rules-approve-consent")).toBeChecked();
  fireEvent.click(screen.getByTestId("rules-approve-consent"));
  expect(screen.queryByTestId("rules-approve-confirm-empty")).toBeNull();
  fireEvent.click(screen.getByTestId("rules-approve-publish"));
  // Mit dem Fingerabdruck der Datenbasis: Veröffentlicht wird nur, was der Vorschlag gezeigt hat.
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/proposal/publish", {
    base_version_id: "v1", fingerprint: "abdruck-1", valid_from: "2030-03-05", change_reason: "Einstellungen geändert: Map-Pool, Teamgröße",
    requires_consent: false, confirm_empty: false,
  }));
});

test("Leere Variablen im Vorschlag: Freigeben erst mit dem Haken „Trotzdem veröffentlichen“", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, data_changes: CHANGES, proposal: { ...PROPOSAL, empty_vars: ["max_squad_size"] } });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  renderPage();
  expect(await screen.findByTestId("rules-proposal-empty")).toHaveTextContent("{{max_squad_size}}");
  expect(screen.getByTestId("rules-approve-publish")).toBeDisabled();
  fireEvent.click(screen.getByTestId("rules-approve-confirm-empty"));
  expect(screen.getByTestId("rules-approve-publish")).toBeEnabled();
  fireEvent.click(screen.getByTestId("rules-approve-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/proposal/publish",
    expect.objectContaining({ fingerprint: "abdruck-1", confirm_empty: true })));
});

test("Einstellungen haben sich seit dem Vorschlag geändert (409): der Vorschlag wird neu geladen", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, data_changes: CHANGES, proposal: PROPOSAL });
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Die Einstellungen haben sich inzwischen geändert - bitte den Vorschlag neu prüfen." } } });
  renderPage();
  await screen.findByTestId("rules-approve");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("rules-approve-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
});

test("Freigabe der Liga: nennt der Vorschlag keine leere Variable, bringt die Absage (422) Liste und Haken als Rückfall", async () => {
  serve({ ...VIEW, scope: "league", scope_id: "l1", season: null, versions: [HEAD], current: HEAD, data_changes: CHANGES, proposal: PROPOSAL });
  apiMock.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: { code: "empty_vars", names: ["application.slots"],
    message: "Ohne Wert in einer Season dieser Liga: {{application.slots}} - im Text steht dann „(nicht festgelegt)“. Zum Veröffentlichen bitte bestätigen." } } } });
  renderPage("/admin/leagues/rules/league/l1");
  await screen.findByTestId("rules-approve");
  expect(screen.queryByTestId("rules-approve-confirm-empty")).toBeNull();
  fireEvent.click(screen.getByTestId("rules-approve-publish"));
  const check = await screen.findByTestId("rules-approve-confirm-empty");
  expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league/l1/proposal/publish", expect.objectContaining({ fingerprint: "abdruck-1", confirm_empty: false }));
  // Die Liste aus der Absage steht da - und bei der Liga heißt es nicht „in dieser Season“.
  expect(screen.getByTestId("rules-proposal-empty")).toHaveTextContent("Ohne Wert in einer Season dieser Liga");
  expect(screen.getByTestId("rules-proposal-empty")).toHaveTextContent("{{application.slots}}");
  expect(screen.getByTestId("rules-approve-publish")).toBeDisabled();
  fireEvent.click(check);
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  fireEvent.click(screen.getByTestId("rules-approve-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/league-rules/league/l1/proposal/publish",
    expect.objectContaining({ fingerprint: "abdruck-1", confirm_empty: true })));
});

test("Veröffentlichen mit leeren Variablen: 422 mit Liste zeigt den Haken, mit Haken geht es durch", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.put.mockResolvedValue({ data: { ...DRAFT, revision: 4 } });
  apiMock.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: { code: "empty_vars", names: ["application.slots"],
    message: "Ohne Wert in dieser Season: {{application.slots}} - im Text steht dann „(nicht festgelegt)“. Zum Veröffentlichen bitte bestätigen." } } } });
  renderPage();
  fireEvent.change(await screen.findByTestId("rules-reason"), { target: { value: "Startplätze folgen" } });
  expect(screen.queryByTestId("rules-confirm-empty")).toBeNull();
  fireEvent.click(screen.getByTestId("rules-publish"));
  const check = await screen.findByTestId("rules-confirm-empty");
  expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/publish", expect.objectContaining({ confirm_empty: false }));
  expect(screen.getByTestId("rules-publish")).toBeDisabled();
  fireEvent.click(check);
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  fireEvent.click(screen.getByTestId("rules-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/league-rules/league_season/s1/publish", expect.objectContaining({ confirm_empty: true })));
});

test("Freigeben geht nicht mit unbekannter Variable im Vorschlag; „Text vorher anpassen“ bereitet den Entwurf vor", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, data_changes: CHANGES, proposal: { ...PROPOSAL, unknown_vars: ["gibtsnicht"] } });
  apiMock.post.mockResolvedValue({ data: DRAFT });
  renderPage();
  expect(await screen.findByTestId("rules-proposal-unknown")).toHaveTextContent("{{gibtsnicht}}");
  expect(screen.getByTestId("rules-approve-publish")).toBeDisabled();
  fireEvent.click(screen.getByTestId("rules-prepare"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/draft/from-version", {}));
});

test("Mit Entwurf: der Hinweis bleibt, der Vorschlag nicht - der Entwurf nimmt den neuen Stand", async () => {
  serve({ ...VIEW, versions: [HEAD], current: HEAD, draft: DRAFT, data_changes: CHANGES, proposal: null });
  renderPage();
  expect(await screen.findByTestId("rules-pending-draft")).toHaveTextContent("Der Entwurf unten nimmt beim Veröffentlichen den neuen Stand");
  expect(screen.queryByTestId("rules-approve")).toBeNull();
});

test("Variablen einfügen: Liste mit Wert von heute, Suche, Marke landet im Text; die Hilfe nennt Bausteine und Variablen", async () => {
  serve({ ...VIEW, draft: DRAFT });
  renderPage();
  const palette = await screen.findByTestId("rules-variables");
  expect(within(palette).getByTestId("rules-var-best_of")).toHaveTextContent("Best of");
  expect(within(palette).getByTestId("rules-var-best_of")).toHaveTextContent("{{best_of}}");
  expect(within(palette).getByTestId("rules-var-best_of")).toHaveTextContent("3");
  expect(within(palette).getByTestId("rules-var-max_squad_size")).toHaveTextContent("(nicht festgelegt)");
  fireEvent.click(within(palette).getByTestId("rules-var-mode:stellung.target"));
  expect(screen.getByTestId("rules-body")).toHaveValue("# Fairplay\nText {{mode:stellung.target}}");
  fireEvent.change(screen.getByTestId("rules-variables-search"), { target: { value: "stellung" } });
  expect(within(palette).queryByTestId("rules-var-best_of")).toBeNull();
  expect(within(palette).getByTestId("rules-var-mode:stellung.target")).toBeInTheDocument();
  const help = screen.getByTestId("rules-help");
  expect(help).toHaveTextContent("[[baustein:map_pool]]");
  expect(help).toHaveTextContent("{{max_squad_size}}");
});

test("Vorschau nennt unbekannte und leere Variablen", async () => {
  serve({ ...VIEW, draft: DRAFT });
  apiMock.post.mockResolvedValue({ data: { sections: [], changes: { base: null, new: [], changed: [], removed: [] }, blocks_used: [], unknown_blocks: [],
    unknown_vars: ["gibtsnicht"], empty_vars: ["max_squad_size"], foreign_images: [] } });
  renderPage();
  fireEvent.click(await screen.findByTestId("rules-preview"));
  expect(await screen.findByTestId("rules-preview-vars-unknown")).toHaveTextContent("{{gibtsnicht}}");
  expect(screen.getByTestId("rules-preview-vars-empty")).toHaveTextContent("{{max_squad_size}}");
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

test("Entwurf aus der Vorgänger-Season (F.2, #1627): Herkunft, Zustimmung und Grund vorbelegt", async () => {
  serve({ ...VIEW, draft: { ...DRAFT, carried_from: { season_id: "s0", season_name: "Season 1", label: "Version 2" } } });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 1 } });
  renderPage();
  expect(await screen.findByTestId("rules-carried-from")).toHaveTextContent("Übernommen aus Season 1 (Version 2)");
  fireEvent.click(screen.getByTestId("rules-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league_season/s1/publish", expect.objectContaining({
    change_reason: "Neue Season, übernommen aus Season 1", requires_consent: true })));
});


test("Liga-Regelwerk, das eine übernommene Season erbt (F.2): neu zustimmen vorbelegt, mit Hinweis", async () => {
  serve({ ...VIEW, scope: "league", draft: DRAFT, successor_seasons: [{ id: "s2", name: "Season 2" }] });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  renderPage("/admin/leagues/rules/league/l1");
  expect(await screen.findByTestId("rules-successor-seasons")).toHaveTextContent("Season 2");
  fireEvent.change(screen.getByTestId("rules-reason"), { target: { value: "Fairplay neu gefasst" } });
  fireEvent.click(screen.getByTestId("rules-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league/l1/publish", expect.objectContaining({ requires_consent: true })));
});

test("Liga-Regelwerk ohne übernommene Season: neu zustimmen bleibt aus (Gegenprobe)", async () => {
  serve({ ...VIEW, scope: "league", draft: DRAFT, successor_seasons: [] });
  apiMock.post.mockResolvedValue({ data: { ...HEAD, version: 2 } });
  renderPage("/admin/leagues/rules/league/l1");
  fireEvent.change(await screen.findByTestId("rules-reason"), { target: { value: "Fairplay neu gefasst" } });
  expect(screen.queryByTestId("rules-successor-seasons")).toBeNull();
  fireEvent.click(screen.getByTestId("rules-publish"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/league-rules/league/l1/publish", expect.objectContaining({ requires_consent: false })));
});
