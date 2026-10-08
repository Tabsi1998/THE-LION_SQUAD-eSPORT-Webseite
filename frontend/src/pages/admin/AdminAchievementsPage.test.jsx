import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Erfolge im Admin (E10, #620): neun Reiter an einem Ort (der Jahresrückblick kam mit #1195). Die API ist eine Attrappe; geprüft wird, was die
// Reiter zeigen und was sie an den Server schicken.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : ""), resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));

const { default: AdminAchievementsPage, TABS } = await import("./AdminAchievementsPage");
const { allowedMaterials, slugFrom } = await import("./achievements/CatalogTab");
const { parseNames, toIso } = await import("./achievements/AwardTab");

const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", description: "Spiel Matches.", public: true, icon: "swords", art: "crossed-swords" },
  { code: "secret_door", name: "Geheimtür", category: "hidden", hidden: true, description: "Psst.", public: true },
  { code: "season_mvp", name: "Saison-MVP", category: "special", is_special: true, description: "MVP.", public: true },
];
const TIERS = [
  { code: "matches_played_1", group_code: "matches_played", name: "Spielmacher I", material: "wood", rank: 1, points: 5, condition_key: "matches_played", progress_target: 1, condition_status: "live" },
  { code: "matches_played_2", group_code: "matches_played", name: "Spielmacher II", material: "iron", rank: 2, points: 10, condition_key: "matches_played", progress_target: 5, condition_status: "live" },
  { code: "matches_played_3", group_code: "matches_played", name: "Spielmacher III", material: "bronze", rank: 3, points: 20, condition_key: "matches_played", progress_target: 10, condition_status: "live" },
  { code: "matches_played_4", group_code: "matches_played", name: "Spielmacher IV", material: "silver", rank: 4, points: 35, condition_key: "matches_played", progress_target: 25, condition_status: "live" },
  { code: "secret_door_1", group_code: "secret_door", name: "Gefunden", material: "hidden", rank: 9, points: 40, manual_only: true },
  { code: "season_mvp_1", group_code: "season_mvp", name: "Saison-MVP I", material: "legendary", rank: 8, points: 250, manual_only: true },
];
const PAULA = { id: "u1", username: "paula", display_name: "Paula", email: "p@example.test", is_club_member: true };
const OVERVIEW = {
  unlocks_7d: 4, unlocks_30d: 17, users_total: 40, users_without_award: 9, prestige_holders: 2,
  rarest: { code: "matches_played_4", name: "Spielmacher IV", group_name: "Spielmacher", material: "silver", holders: 1, percent: 2.5 },
  most_active_category: { key: "match", label: "Spielen", count: 12 },
  per_category_30d: { match: 12, season: 5 }, levels: { "1-9": 30, "10-19": 8, "60": 1 },
  queue: { waiting: 3, unannounced: 1, last_queue_run_at: "2026-10-03T08:00:00+00:00" },
  reconcile: { at: "2026-10-03T02:10:00+00:00", checked: 12, drift: 2, awarded: 1 },
  catalog: { groups: 3, tiers: 6 },
};
const PREVIEW = {
  season: { id: "s1", name: "Herbst", status: "active" }, ranked: 2, already_written: false, finished: false, awards_total: 3,
  standings: [
    { rank: 1, user_id: "u1", username: "paula", display_name: "Paula", points: 120, awards: [{ code: "season_champion_1", name: "Saisonmeister I", material: "bronze" }, { code: "season_top10_1", name: "Saisonspitze I", material: "bronze" }] },
    { rank: 2, user_id: "u2", username: "max", display_name: "Max", points: 80, awards: [{ code: "season_top10_1", name: "Saisonspitze I", material: "bronze" }] },
  ],
  season_groups: [], mvp: { code: "season_mvp_1", name: "Saison-MVP I", material: "legendary", holders: [] },
};
const CAPS = {
  day: "2026-10-03",
  rows: [{ source: "daily_login", xp: 10, cap: 1, used: 1, full: true }, { source: "match_played", xp: 20, cap: null, used: 2, full: false }],
  view: { level: 7, xp: 1450, title: "Kämpfer", prestige: 2, next_level_xp: 1600, login_streak: 4, prestige_available: false },
};
const STATS = {
  base: 40, members_base: 12,
  weekly: [{ week: "2026-W38", unlocks: 2 }, { week: "2026-W39", unlocks: 0 }, { week: "2026-W40", unlocks: 5 }],
  top: [{ id: "u1", rank: 1, display_name: "Paula", username: "paula", points: 420, count: 9, level: 7 }],
  rarity: [
    { code: "matches_played_4", name: "Spielmacher IV", group_name: "Spielmacher", category: "match", material: "silver", holders: 1, percent: 2.5 },
    { code: "season_top10_1", name: "Saisonspitze I", group_name: "Saisonspitze", category: "season", material: "bronze", holders: 6, percent: 15 },
  ],
};

const YEAR_REVIEW = { start: "12-15", end: "01-31", start_label: "15.12.", end_label: "31.1.", open: false, year: 2026, from_label: "15.12.2026", until_label: "31.1.2027", notified: 0 };

let board = true;
function routeGet(url) {
  const path = url.split("?")[0];
  const table = {
    "/admin/achievements/me": { board },
    "/admin/achievements/overview": OVERVIEW,
    "/admin/achievements/groups": GROUPS,
    "/admin/achievements/tiers": TIERS,
    "/admin/achievements/catalog/check": {
      ok: false, counts: { groups: 3, tiers: 6, errors: 1, warnings: 1 },
      errors: [{ code: "group_description_missing", message: "Gruppe „Geheimtür“ hat keine Beschreibung.", group: "secret_door" }],
      warnings: [{ code: "group_art_missing", message: "Gruppe „Saison-MVP“ hat kein Motiv.", group: "season_mvp" }],
    },
    "/admin/achievements/users/search": [PAULA],
    "/admin/achievements/users/u1/awards": [{ tier_code: "matches_played_1", tier_name: "Spielmacher I", group_name: "Spielmacher", material: "wood", earned_at: "2026-09-01T18:00:00+00:00", silent: false, note: null, is_negative: false }],
    "/admin/achievements/events": [{ id: "e1", kind: "bulk_award", at: "2026-10-02T18:00:00+00:00", actor_name: "Chef", tier_name: "Spielmacher I", material: "wood", note: "LAN", data: { awarded: 37, already: 2, notify: false } }],
    "/tournaments": [{ id: "t1", name: "Herbst-Cup" }],
    "/events": [],
    "/teams": [],
    "/seasons": [{ id: "s1", name: "Herbst", status: "active" }],
    "/admin/achievements/season/s1/preview": PREVIEW,
    "/admin/achievements/xp/caps": CAPS,
    "/admin/achievements/negative/awards": [],
    "/admin/achievements/incident-types": [{ key: "afk", tier_code: "neg_afk" }],
    "/admin/achievements/stats": STATS,
    "/admin/year-review": YEAR_REVIEW,
  };
  if (!(path in table)) return Promise.reject(new Error(`unerwartet: ${url}`));
  return Promise.resolve({ data: table[path] });
}

function renderAt(tab) {
  return render(<MemoryRouter initialEntries={[tab ? `/admin/achievements?tab=${tab}` : "/admin/achievements"]}><AdminAchievementsPage /></MemoryRouter>);
}

async function pickPaula(prefix) {
  fireEvent.change(await screen.findByTestId(`${prefix}-search`), { target: { value: "pau" } });
  fireEvent.click(await screen.findByTestId(`${prefix}-option-u1`));
}

beforeEach(() => {
  board = true;
  apiMock.get.mockReset().mockImplementation(routeGet);
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
  apiMock.patch.mockReset().mockResolvedValue({ data: {} });
  apiMock.put.mockReset().mockResolvedValue({ data: { ...YEAR_REVIEW, start: "12-01", start_label: "1.12.", from_label: "1.12.2026" } });
  apiMock.delete.mockReset().mockResolvedValue({ data: { ok: true } });
  Object.values(toastMock).forEach((fn) => fn.mockReset());
});

describe("Reiter", () => {
  it("hat genau die neun Reiter mit Namen und öffnet den per ?tab= gewünschten", async () => {
    renderAt("xp");
    expect(TABS.map((t) => t.label)).toEqual(["Übersicht", "Katalog", "Vergeben", "Saison", "Jahresrückblick", "XP", "Vorschau", "Negativ & Vorfälle", "Statistik"]);
    expect(screen.getAllByRole("tab")).toHaveLength(9);
    expect(screen.getByTestId("ach-tab-xp")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByTestId("xp-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ach-tab-stats"));
    expect(await screen.findByTestId("ach-stats")).toBeInTheDocument();
  });
});

describe("Übersicht", () => {
  it("zeigt Kennzahlen, Verteilung, Warteschlange und den Abgleich – und wertet auf Wunsch alle aus", async () => {
    apiMock.post.mockResolvedValue({ data: { queued: 40 } });
    renderAt();
    expect(await screen.findByTestId("ov-unlocks-7d")).toHaveTextContent("4");
    expect(screen.getByTestId("ov-without")).toHaveTextContent("9");
    expect(screen.getByTestId("ov-without")).toHaveTextContent("von 40 Personen");
    expect(screen.getByTestId("ov-rarest")).toHaveTextContent("Spielmacher IV");
    expect(screen.getByTestId("ov-active")).toHaveTextContent("Spielen");
    expect(screen.getByTestId("ov-level-bars-1-9")).toHaveTextContent("30");
    expect(screen.getByTestId("ov-queue-waiting")).toHaveTextContent("3");
    expect(screen.getByTestId("ov-reconcile-drift")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("ach-evaluate-all"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/evaluation/all"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("40 Konten")));
  });
});

describe("Katalog", () => {
  it("zeigt Gruppen je Kategorie, versteckte mit Hinweis, und die Prüfung mit Namen", async () => {
    renderAt("catalog");
    expect(await screen.findByTestId("catalog-section-match")).toHaveTextContent("Spielmacher");
    expect(screen.getByTestId("catalog-section-hidden")).toHaveTextContent("Geheimtür");
    expect(screen.getByTestId("group-hidden-secret_door")).toHaveTextContent("versteckt");
    expect(screen.queryByText("matches_played")).toBeNull();
    fireEvent.click(screen.getByTestId("group-toggle-matches_played"));
    const tiers = screen.getByTestId("group-tiers-matches_played");
    expect(within(tiers).getByTestId("tier-row-matches_played_3")).toHaveTextContent("Automatik · Ziel 10");
    fireEvent.click(screen.getByTestId("catalog-check"));
    const report = await screen.findByTestId("catalog-report");
    expect(report).toHaveTextContent("1 Fehler");
    expect(report).toHaveTextContent("Gruppe „Geheimtür“ hat keine Beschreibung.");
    expect(within(report).getAllByTestId("finding-warning")).toHaveLength(1);
  });

  it("bietet beim Bearbeiten nur Materialien zwischen den Nachbarstufen an", async () => {
    renderAt("catalog");
    fireEvent.click(await screen.findByTestId("group-toggle-matches_played"));
    fireEvent.click(screen.getByTestId("tier-edit-matches_played_4"));
    const select = await screen.findByTestId("tier-material");
    expect([...select.options].map((o) => o.value)).toEqual(["silver", "gold", "platinum", "diamond"]);
    fireEvent.change(select, { target: { value: "gold" } });
    fireEvent.submit(screen.getByTestId("tier-sheet"));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/achievements/tiers/matches_played_4", expect.objectContaining({ material: "gold" })));
  });

  it("rechnet die Leiter wie der Server und bildet Kennungen aus Namen", () => {
    const ladder = TIERS.filter((t) => t.group_code === "matches_played");
    expect(allowedMaterials(ladder[2], ladder)).toEqual(["bronze"]);
    expect(allowedMaterials(ladder[0], ladder)).toEqual(["wood"]);
    expect(allowedMaterials(ladder[3], ladder)).toEqual(["silver", "gold", "platinum", "diamond"]);
    expect(allowedMaterials(TIERS[5], [TIERS[5]])).toEqual(["legendary"]);
    expect(allowedMaterials(null, ladder)).toEqual(["gold", "platinum", "diamond", "legendary", "hidden"]);
    expect(slugFrom("Größter Fan – 2026!")).toBe("grosster_fan_2026");
  });

  it("spielt eine Exportdatei nur nach der Prüfung ein – und nur für den Vorstand", async () => {
    apiMock.post.mockImplementation((url, body) => Promise.resolve({ data: { groups: 1, tiers: 1, applied: !body.dry_run, check: { ok: true, errors: [], counts: { errors: 0 } } } }));
    renderAt("catalog");
    const file = new File([JSON.stringify({ groups: [{ code: "x" }], tiers: [{ code: "x_1" }] })], "katalog.json", { type: "application/json" });
    fireEvent.change(await screen.findByTestId("catalog-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/catalog/import", expect.objectContaining({ dry_run: true })));
    fireEvent.click(await screen.findByTestId("catalog-import-apply"));
    await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/achievements/catalog/import", expect.objectContaining({ dry_run: false })));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});

describe("Vergeben", () => {
  it("vergibt einzeln mit Grund, Datum, ohne Zeremonie und ohne Benachrichtigung", async () => {
    apiMock.post.mockResolvedValue({ data: { ok: true, newly_awarded: true } });
    renderAt("award");
    await pickPaula("award-person");
    fireEvent.change(screen.getByTestId("award-tier-select"), { target: { value: "matches_played_2" } });
    expect(screen.getByTestId("award-tier-select")).toHaveTextContent("Spielmacher · Eisen · Spielmacher II");
    fireEvent.change(screen.getByTestId("award-note"), { target: { value: "LAN-Abend" } });
    fireEvent.change(screen.getByTestId("award-date"), { target: { value: "2026-09-01T18:00" } });
    fireEvent.click(screen.getByTestId("award-silent"));
    fireEvent.click(screen.getByTestId("award-notify"));
    fireEvent.click(screen.getByTestId("award-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/award", {
      user_id: "u1", tier_code: "matches_played_2", note: "LAN-Abend", earned_at: new Date("2026-09-01T18:00").toISOString(), silent: true, notify: false,
    }));
  });

  it("nimmt eine Vergabe nur mit Grund zurück", async () => {
    renderAt("award");
    await pickPaula("award-person");
    fireEvent.click(await screen.findByTestId("revoke-matches_played_1"));
    fireEvent.click(screen.getByTestId("revoke-confirm-matches_played_1"));
    expect(toastMock.error).toHaveBeenCalledWith("Bitte einen Grund angeben.");
    expect(apiMock.delete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("revoke-reason-matches_played_1"), { target: { value: "versehentlich" } });
    fireEvent.click(screen.getByTestId("revoke-confirm-matches_played_1"));
    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/achievements/award", { data: { user_id: "u1", tier_code: "matches_played_1", note: "versehentlich" } }));
  });

  it("zeigt bei der Massenvergabe erst die Vorschau je Person, dann wird vergeben", async () => {
    apiMock.post.mockImplementation((url, body) => Promise.resolve({ data: body.dry_run
      ? { recipients: 2, would_award: 1, already: 1, skipped: 0, awarded: 0, unknown: ["niemand"], people: [{ id: "u1", username: "paula", display_name: "Paula", state: "new" }, { id: "u2", username: "max", display_name: "Max", state: "already" }] }
      : { recipients: 2, awarded: 1, already: 1, skipped: 0 } }));
    renderAt("award");
    fireEvent.change(await screen.findByTestId("bulk-tier-select"), { target: { value: "matches_played_1" } });
    fireEvent.change(screen.getByTestId("bulk-names"), { target: { value: "Benutzername\npaula;Paula\nmax\nniemand\npaula" } });
    expect(screen.getByTestId("bulk-name-count")).toHaveTextContent("3 Namen");
    await waitFor(() => expect(screen.getByTestId("bulk-tournament")).toHaveTextContent("Herbst-Cup"));
    fireEvent.change(screen.getByTestId("bulk-tournament"), { target: { value: "t1" } });
    fireEvent.click(screen.getByTestId("bulk-preview"));
    const result = await screen.findByTestId("bulk-result");
    expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/award/bulk", expect.objectContaining({ tier_code: "matches_played_1", names: ["paula", "max", "niemand"], tournament_id: "t1", dry_run: true, notify: true }));
    expect(screen.getByTestId("bulk-would")).toHaveTextContent("1 bekommen es");
    expect(result).toHaveTextContent("hat es schon");
    expect(screen.getByTestId("bulk-unknown")).toHaveTextContent("1 nicht gefunden");
    fireEvent.click(screen.getByTestId("bulk-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/achievements/award/bulk", expect.objectContaining({ dry_run: false, names: ["paula", "max", "niemand"] })));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("1 vergeben")));
  });

  it("Massenvergabe nur für den Vorstand; das Protokoll zeigt Art, Admin, Grund und Details", async () => {
    board = false;
    renderAt("award");
    const bulk = await screen.findByTestId("award-bulk");
    await waitFor(() => expect(within(bulk).getByTestId("board-only")).toHaveTextContent("Vorstand"));
    expect(screen.queryByTestId("bulk-names")).toBeNull();
    const row = await screen.findByTestId("protocol-row-bulk_award");
    expect(row).toHaveTextContent("Massenvergabe");
    expect(row).toHaveTextContent("Chef");
    expect(row).toHaveTextContent("„LAN“");
    expect(row).toHaveTextContent("37 vergeben");
    expect(row).toHaveTextContent("ohne Benachrichtigung");
  });

  it("liest Namen aus CSV-Zeilen und Datumsfelder als Ortszeit", () => {
    expect(parseNames("E-Mail;Name\nanna@example.test;Anna\n\"bert\",x\n\tcarla\nanna@example.test")).toEqual(["anna@example.test", "bert", "carla"]);
    expect(toIso("")).toBeNull();
    expect(toIso("2026-09-01T18:00")).toBe(new Date("2026-09-01T18:00").toISOString());
  });
});

describe("Saison", () => {
  it("zeigt je Platz, was der Abschluss vergibt, verweist zum Abschließen auf die Jahreswertung und zeichnet den MVP aus", async () => {
    apiMock.post.mockResolvedValue({ data: { ok: true, newly_awarded: true } });
    renderAt("season");
    const first = await screen.findByTestId("season-row-1");
    expect(within(first).getByTestId("season-award-season_champion_1")).toHaveTextContent("Saisonmeister I");
    expect(screen.getByTestId("season-summary")).toHaveTextContent("2 Plätze · 3 Erfolge beim Abschluss");
    expect(screen.queryByTestId("season-award")).toBeNull();
    expect(screen.getByTestId("season-to-ranking")).toHaveAttribute("href", "/admin/seasons");
    fireEvent.click(screen.getByTestId("season-mvp-1"));
    fireEvent.click(screen.getByTestId("season-mvp-award"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/award", { user_id: "u1", tier_code: "season_mvp_1", note: "Saison-MVP Herbst" }));
  });
});

describe("XP", () => {
  it("zeigt Stand und Tagesdeckel und korrigiert mit Grund", async () => {
    renderAt("xp");
    await pickPaula("xp-person");
    expect(await screen.findByTestId("xp-level")).toHaveTextContent("7");
    expect(screen.getByTestId("xp-cap-daily_login")).toHaveTextContent("Täglicher Besuch");
    expect(screen.getByTestId("xp-cap-daily_login")).toHaveTextContent("1 / 1 · voll");
    expect(screen.getByTestId("xp-cap-match_played")).toHaveTextContent("ohne Deckel");
    fireEvent.change(screen.getByTestId("xp-amount"), { target: { value: "-20" } });
    fireEvent.change(screen.getByTestId("xp-reason"), { target: { value: "Doppelt gezählt" } });
    fireEvent.click(screen.getByTestId("xp-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/xp", { user_id: "u1", amount: -20, reason: "Doppelt gezählt" }));
    fireEvent.change(screen.getByTestId("xp-reset-reason"), { target: { value: "Testkonto" } });
    fireEvent.click(screen.getByTestId("xp-reset-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/xp/prestige-reset", { user_id: "u1", reason: "Testkonto" }));
  });
});

describe("Negativ und Vorfälle", () => {
  it("trägt einen Vorfall für eine Person ein", async () => {
    apiMock.post.mockResolvedValue({ data: { ok: true, newly_awarded: true } });
    renderAt("negative");
    await pickPaula("negative-person");
    fireEvent.change(screen.getByTestId("negative-type"), { target: { value: "afk" } });
    fireEvent.change(screen.getByTestId("negative-note"), { target: { value: "Runde 3" } });
    fireEvent.click(screen.getByTestId("negative-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/trigger-incident", { user_id: "u1", incident_type: "afk", note: "Runde 3" }));
  });
});

describe("Statistik", () => {
  it("zeigt Wochen, die Besten und die Seltenheit – filterbar nach Kategorie", async () => {
    renderAt("stats");
    expect(await screen.findByTestId("stats-week-2026-W40")).toHaveTextContent("KW 40");
    expect(screen.getByTestId("stats-top")).toHaveTextContent("Paula");
    expect(screen.getByTestId("stats-row-matches_played_4")).toHaveTextContent("2,5 %");
    fireEvent.change(screen.getByTestId("stats-category"), { target: { value: "season" } });
    expect(screen.queryByTestId("stats-row-matches_played_4")).toBeNull();
    expect(screen.getByTestId("stats-row-season_top10_1")).toHaveTextContent("Saisonspitze");
  });
});

describe("Jahresrückblick", () => {
  it("zeigt den Zeitraum, speichert Start und Ende und führt zur Vorschau", async () => {
    renderAt("year");
    expect(await screen.findByTestId("year-review-window")).toHaveTextContent("Nächster Rückblick: 2026 – zu sehen vom 15.12.2026 bis 31.1.2027. Die Meldung geht am Starttag raus.");
    expect(screen.getByTestId("year-review-start")).toHaveValue("15.12.");
    fireEvent.change(screen.getByTestId("year-review-start"), { target: { value: "1.12." } });
    fireEvent.click(screen.getByTestId("year-review-save"));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/year-review", { start: "1.12.", end: "31.1." }));
    expect(await screen.findByTestId("year-review-window")).toHaveTextContent("vom 1.12.2026 bis 31.1.2027");
    expect(toastMock.success).toHaveBeenCalledWith("Zeitraum gespeichert.");
    expect(screen.getByTestId("year-review-preview")).toHaveAttribute("href", "/dein-jahr?vorschau=1");
  });
});
