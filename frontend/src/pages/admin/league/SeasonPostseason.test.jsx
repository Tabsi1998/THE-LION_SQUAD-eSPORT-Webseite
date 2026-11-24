import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Playoffs und Relegation im Reiter „Abschluss“ (#2404): Vorschau der Setzung, Anlegen mit dem Fingerabdruck der Vorschau, Sperrgründe,
// Befangenheit, Setzliste neu berechnen, Einstellungen. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { SeasonPostseason } = await import("./SeasonPostseason");

const seed = (number, staffel = "A", extra = {}) => ({ seed: number, display_name: `Probe ${staffel}${number}`, staffel, rank: number, tie: null, ...extra });
const SETTINGS = {
  playoffs: { enabled: true, per_staffel: 4, format: "single_elim", seeding: "cross", best_of: 3, best_of_rounds: [], third_place: false, home: "better_seed", start_date: null },
  relegation: { enabled: false, best_of: 3, start_date: null }, champion_source: "table", reopen_guard: "hint", own: { playoffs: false, relegation: false },
};
const OPTIONS = { best_of: [1, 3, 5, 7], per_staffel: [1, 16], round_max: 6, home: {}, champion_source: {}, reopen_guard: {} };
const SEEDS = [seed(1), seed(2), seed(3), seed(4)];
const playoffs = (extra = {}) => ({
  enabled: true, state: "ready", blockers: [], stamp: "abc123", per_staffel: 4, seeds: SEEDS, byes: 0, open_lot: [], swaps: 0, estimated: false, own_team: false,
  pairings: [{ order: 1, a: SEEDS[0], b: SEEDS[3] }, { order: 2, a: SEEDS[1], b: SEEDS[2] }],
  rounds: [{ round: 1, label: "Halbfinale", best_of: 3, start_day: "2031-03-31", end_day: "2031-04-06" }, { round: 2, label: "Finale", best_of: 3, start_day: "2031-04-07", end_day: "2031-04-13" }],
  staffel: null, stale: false, can_reseed: false, reseed_refusal: null, can_create: true, ...extra });
const division = (extra = {}) => ({ division_id: "d1", level: 1, label: "Liga 1", settings: SETTINGS, own_settings: null, locked: false, top: true, has_lower: false,
  lower_label: null, zones: {}, playoffs: playoffs(), relegation: null, ...extra });
const cockpit = (divisions, extra = {}) => ({ season: { id: "s1", name: "Season 1", best_of: 3, regular_end_day: "2031-03-30" }, settings: SETTINGS, configured: true,
  can_act: true, superadmin: false, responsible: "„Season konfigurieren“", options: OPTIONS, missing: [], divisions, ...extra });

function renderPanel(body, props = {}) {
  apiMock.get.mockResolvedValue({ data: body });
  return render(<MemoryRouter><SeasonPostseason seasonId="s1" {...props} /></MemoryRouter>);
}

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.post.mockResolvedValue({ data: { ok: true, replay: false } });
  apiMock.put.mockResolvedValue({ data: { ok: true } });
});

test("ohne Einstellung steht ein Satz und kein Kasten je Liga", async () => {
  renderPanel(cockpit([division({ playoffs: null })], { configured: false, settings: { ...SETTINGS, playoffs: { ...SETTINGS.playoffs, enabled: false } } }));
  expect(await screen.findByTestId("postseason-summary")).toHaveTextContent("keine Playoffs und keine Relegation");
  expect(screen.queryByTestId("postseason-division-d1")).not.toBeInTheDocument();
  expect(screen.getByTestId("postseason-settings")).toBeInTheDocument();
});

test("die Vorschau zeigt Setzliste, Paarungen und Wochen - anlegen schickt den Fingerabdruck", async () => {
  const onChanged = vi.fn();
  renderPanel(cockpit([division()]), { onChanged });
  expect(await screen.findByTestId("postseason-playoffs-state-d1")).toHaveTextContent("Bereit zum Anlegen");
  expect(screen.getByTestId("postseason-playoffs-line-d1")).toHaveTextContent("4 je Staffel · Best of 3 · Platz 3 geteilt · Heimrecht: besser Gesetzter");
  const seeds = within(screen.getByTestId("postseason-seeds-d1")).getAllByRole("listitem");
  expect(seeds).toHaveLength(4);
  expect(seeds[0]).toHaveTextContent("Probe A1");
  expect(seeds[0]).toHaveTextContent("Staffel A · Platz 1");
  // Die erste Runde als Karten: je Paarung beide Seiten mit Setzplatz - für Screenreader ein Satz.
  expect(within(screen.getByTestId("postseason-pairings-d1")).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByTestId("postseason-pairing-d1-1")).toHaveAttribute("aria-label", "1 Probe A1 – 4 Probe A4");
  expect(screen.getByTestId("postseason-pairing-d1-1")).toHaveTextContent("Probe A4");
  expect(screen.getByTestId("postseason-rounds-d1")).toHaveTextContent("Finale · Best of 3 · 07.04.–13.04.2031");
  fireEvent.click(screen.getByTestId("postseason-create-playoffs-d1"));
  expect(apiMock.post).not.toHaveBeenCalled();
  const sheet = screen.getByTestId("postseason-create-sheet");
  expect(sheet).toHaveTextContent("eigene K.-o.-Staffel mit 4 Teams");
  fireEvent.click(within(sheet).getByTestId("postseason-create-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/postseason/playoffs", { division_id: "d1", stamp: "abc123", confirm: true }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Playoffs angelegt. Der Baum steht."));
  expect(onChanged).toHaveBeenCalled();
});

test("was noch fehlt, steht als Sperrgrund da und hält den Knopf zu", async () => {
  renderPanel(cockpit([division({ playoffs: playoffs({ state: "waiting", can_create: false, seeds: [], pairings: [], estimated: true,
    blockers: [{ code: "regular_open", label: "Reguläre Staffeln noch offen", text: "Erst alle regulären Staffeln von Liga 1 abschließen (1 von 2 abgeschlossen)." }] }) })],
  { missing: [{ kind: "playoff", division_id: "d1", text: "Die Playoffs von Liga 1 sind noch nicht angelegt." }] }));
  expect(await screen.findByTestId("postseason-playoffs-blockers-d1")).toHaveTextContent("1 von 2 abgeschlossen");
  expect(screen.getByTestId("postseason-playoffs-state-d1")).toHaveTextContent("Wartet");
  expect(screen.getByTestId("postseason-create-playoffs-d1")).toBeDisabled();
  expect(screen.getByTestId("postseason-missing")).toHaveTextContent("Solange läuft die Season weiter.");
  expect(screen.getByText("Wochen (voraussichtlich)")).toBeInTheDocument();
});

test("gleich stehende Staffelsieger werden erst beim Anlegen gelost - die Vorschau sagt es", async () => {
  renderPanel(cockpit([division({ playoffs: playoffs({ open_lot: [["Probe A1", "Probe B1"]] }) })]));
  expect(await screen.findByTestId("postseason-lot-d1")).toHaveTextContent("wird beim Anlegen gelost: Probe A1, Probe B1");
  fireEvent.click(screen.getByTestId("postseason-create-playoffs-d1"));
  expect(screen.getByTestId("postseason-create-lot")).toHaveTextContent("Das Los fällt einmal und steht im Protokoll.");
});

test("beim eigenen Team steht der Satz statt des Knopfs - der Superadmin gibt einen Grund an", async () => {
  const { unmount } = renderPanel(cockpit([division({ playoffs: playoffs({ own_team: true, can_create: false }) })]));
  expect(await screen.findByTestId("postseason-own-d1")).toHaveTextContent("Anlegen muss eine andere Person");
  expect(screen.queryByTestId("postseason-create-playoffs-d1")).not.toBeInTheDocument();
  unmount();
  renderPanel(cockpit([division({ playoffs: playoffs({ own_team: true }) })], { superadmin: true }));
  fireEvent.click(await screen.findByTestId("postseason-create-playoffs-d1"));
  fireEvent.click(screen.getByTestId("postseason-create-confirm"));
  expect(toastMock.error).toHaveBeenCalledWith("Bitte den Grund für die Notausnahme mit mindestens 5 Zeichen angeben.");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("postseason-conflict-reason"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("postseason-create-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/postseason/playoffs",
    { division_id: "d1", stamp: "abc123", confirm: true, conflict_reason: "Niemand sonst erreichbar" }));
});

test("ohne das Recht gibt es keinen Knopf, nur den Hinweis", async () => {
  renderPanel(cockpit([division({ playoffs: playoffs({ can_create: false }) })], { can_act: false }));
  expect(await screen.findByTestId("postseason-playoffs-d1")).toHaveTextContent("Anlegen darf, wer „Season konfigurieren“ hat.");
  expect(screen.queryByTestId("postseason-create-playoffs-d1")).not.toBeInTheDocument();
  expect(screen.queryByTestId("postseason-settings")).not.toBeInTheDocument();
});

test("angelegt: Stand der Spiele, Links - und bei geändertem Endstand das Neuberechnen mit Grund", async () => {
  const staffel = { tournament_id: "po1", slug: "probe-liga-po", title: "Probe-Liga · Playoffs", status: "live", closed: false, matches: { total: 2, decided: 0 }, veto_notes: [] };
  renderPanel(cockpit([division({ playoffs: playoffs({ state: "created", staffel, can_create: false, stale: true, can_reseed: true, stamp: "neu456",
    stale_note: "Der Endstand hat sich seit dem Anlegen geändert.", next_seeds: [seed(2), seed(1), seed(3), seed(4)] }) })]));
  expect(await screen.findByTestId("postseason-playoffs-state-d1")).toHaveTextContent("Angelegt");
  expect(screen.getByTestId("postseason-staffel-po1")).toHaveTextContent("0 von 2 Spielen entschieden");
  expect(screen.getByRole("link", { name: "Staffel verwalten" })).toHaveAttribute("href", "/admin/leagues/staffeln/po1");
  expect(screen.getByRole("link", { name: "Baum ansehen" })).toHaveAttribute("href", "/tournaments/probe-liga-po/bracket");
  expect(screen.getByTestId("postseason-stale-d1")).toHaveTextContent("Der Endstand hat sich seit dem Anlegen geändert.");
  expect(within(screen.getByTestId("postseason-next-seeds-d1")).getAllByRole("listitem")[0]).toHaveTextContent("Probe A2");
  fireEvent.click(screen.getByTestId("postseason-reseed-d1"));
  fireEvent.click(screen.getByTestId("postseason-reseed-confirm"));
  expect(toastMock.error).toHaveBeenCalledWith("Bitte einen Grund mit mindestens 5 Zeichen angeben.");
  fireEvent.change(screen.getByTestId("postseason-reseed-reason"), { target: { value: "Endstand korrigiert" } });
  fireEvent.click(screen.getByTestId("postseason-reseed-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/postseason/po1/reseed",
    { stamp: "neu456", confirm: true, reason: "Endstand korrigiert" }));
});

test("die Relegation zeigt Paarungen mit Heimrecht und die Woche hinter den Playoffs der Liga darunter", async () => {
  const relegation = { enabled: true, state: "ready", lower_division_id: "d2", lower_label: "Liga 2", blockers: [], stamp: "rel789", open_lot: [], best_of: 3,
    pairs: [{ upper: seed(3), lower: seed(2, "B") }], start_day: "2031-04-14", end_day: "2031-04-20", after_playoffs_of: "Liga 2", moved: false, own_team: false,
    staffel: null, stale: false, can_create: true };
  renderPanel(cockpit([division({ has_lower: true, lower_label: "Liga 2", playoffs: null, relegation,
    settings: { ...SETTINGS, playoffs: { ...SETTINGS.playoffs, enabled: false }, relegation: { enabled: true, best_of: 3 } } })]));
  const block = await screen.findByTestId("postseason-relegation-d1");
  expect(block).toHaveTextContent("Relegation gegen Liga 2");
  expect(screen.getByTestId("postseason-pairs-d1")).toHaveTextContent("Liga 1 · Staffel A · Platz 3 · Heim");
  expect(screen.getByTestId("postseason-pairs-d1")).toHaveTextContent("Liga 2 · Staffel B · Platz 2");
  expect(screen.getByTestId("postseason-relegation-week-d1")).toHaveTextContent("Woche 14.04.–20.04.2031 · nach den Playoffs von Liga 2");
  fireEvent.click(screen.getByTestId("postseason-create-relegation-d1"));
  fireEvent.click(screen.getByTestId("postseason-create-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/postseason/relegation", { division_id: "d1", stamp: "rel789", confirm: true }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Relegation angelegt. Die Paarungen stehen."));
});

test("Einstellungen der Season: speichern schickt Zahlen, fehlende Plätze sagt das Formular selbst", async () => {
  renderPanel(cockpit([division({ playoffs: null })], { settings: { ...SETTINGS, playoffs: { ...SETTINGS.playoffs, enabled: false, per_staffel: null } } }));
  fireEvent.click(await screen.findByTestId("postseason-settings"));
  fireEvent.click(screen.getByTestId("postseason-playoffs-enabled"));
  fireEvent.click(screen.getByTestId("postseason-settings-save"));
  expect(toastMock.error).toHaveBeenCalledWith("Bitte angeben, wie viele Teams je Staffel in die Playoffs kommen.");
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("postseason-per-staffel"), { target: { value: "4" } });
  fireEvent.change(screen.getByTestId("postseason-best-of"), { target: { value: "5" } });
  fireEvent.click(screen.getByTestId("postseason-third-place"));
  fireEvent.change(screen.getByTestId("postseason-champion-source"), { target: { value: "playoffs" } });
  fireEvent.click(screen.getByTestId("postseason-settings-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/postseason", {
    playoffs: { enabled: true, per_staffel: 4, best_of: 5, third_place: true, home: "better_seed", start_date: null, best_of_rounds: [] },
    relegation: { enabled: false, best_of: 3, start_date: null }, champion_source: "playoffs", reopen_guard: "hint" }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Einstellungen gespeichert."));
});

test("die Abweichung einer Liga: ohne Haken folgt sie wieder der Season", async () => {
  renderPanel(cockpit([division({ own_settings: { playoffs: { enabled: true, per_staffel: 2 } }, settings: { ...SETTINGS, own: { playoffs: true, relegation: false } } })]));
  fireEvent.click(await screen.findByTestId("postseason-division-edit-d1"));
  const own = screen.getByTestId("postseason-division-own-playoffs");
  expect(own).toBeChecked();
  fireEvent.click(own);
  fireEvent.click(screen.getByTestId("postseason-division-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/divisions/d1/postseason", {}));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Die Liga folgt wieder der Season."));
});

test("ein Fehler des Servers beim Speichern bleibt im Fenster stehen", async () => {
  apiMock.put.mockRejectedValue({ response: { data: { detail: "In Liga 1 ist schon eine Staffel abgeschlossen." } } });
  renderPanel(cockpit([division({ locked: true })]));
  fireEvent.click(await screen.findByTestId("postseason-settings"));
  expect(screen.getByTestId("postseason-settings-locked")).toHaveTextContent("schon eine Staffel abgeschlossen");
  fireEvent.click(screen.getByTestId("postseason-settings-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("In Liga 1 ist schon eine Staffel abgeschlossen."));
  expect(screen.getByTestId("postseason-settings-sheet")).toBeInTheDocument();
});

test("ein Freilos steht in der Karte der Paarung", async () => {
  renderPanel(cockpit([division({ playoffs: playoffs({ seeds: SEEDS.slice(0, 3), byes: 1, pairings: [{ order: 1, a: SEEDS[0], b: null }, { order: 2, a: SEEDS[1], b: SEEDS[2] }] }) })]));
  expect(await screen.findByTestId("postseason-pairing-d1-1")).toHaveTextContent("Freilos");
  expect(screen.getByTestId("postseason-pairing-d1-1")).toHaveAttribute("aria-label", "1 Probe A1 – Freilos");
});

test("zu wenige Teams: der Hinweis steht an der Liga und nach dem Speichern im Satz", async () => {
  const hint = "In Liga 1 kommen mit 1 Platz je Staffel und 1 Staffel weniger als zwei Teams zusammen. Dort gibt es keine Playoffs - der Meister kommt aus der Tabelle, die Season wartet nicht darauf.";
  apiMock.put.mockResolvedValue({ data: { ok: true, warnings: [hint] } });
  renderPanel(cockpit([division({ playoffs: playoffs({ state: "waiting", can_create: false, seeds: [], pairings: [], too_few_hint: hint }) })]));
  expect(await screen.findByTestId("postseason-too-few-d1")).toHaveTextContent("weniger als zwei Teams");
  fireEvent.click(screen.getByTestId("postseason-settings"));
  fireEvent.click(screen.getByTestId("postseason-settings-save"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(`Einstellungen gespeichert. ${hint}`));
});

test("ab dem Season-Start sind Best of, Platz 3 und Heimrecht ausgegraut - mit Hinweis", async () => {
  renderPanel(cockpit([division()], { started: true, settings: { ...SETTINGS, playoffs: { ...SETTINGS.playoffs, best_of_rounds: [{ round: 2, best_of: 5 }] } } }));
  fireEvent.click(await screen.findByTestId("postseason-settings"));
  expect(screen.getByTestId("postseason-start-locked")).toHaveTextContent("Seit dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht fest");
  for (const id of ["postseason-best-of", "postseason-home", "postseason-third-place", "postseason-round-0", "postseason-round-best-of-0"]) {
    expect(screen.getByTestId(id)).toBeDisabled();
  }
  expect(screen.queryByTestId("postseason-round-add")).not.toBeInTheDocument();
  // Was nicht dazugehört, bleibt offen: Plätze je Staffel, Start, Relegation, Meister.
  for (const id of ["postseason-per-staffel", "postseason-start", "postseason-relegation-enabled", "postseason-champion-source"]) {
    expect(screen.getByTestId(id)).toBeEnabled();
  }
});

test("vor dem Season-Start ist nichts ausgegraut", async () => {
  renderPanel(cockpit([division()], { started: false }));
  fireEvent.click(await screen.findByTestId("postseason-settings"));
  expect(screen.queryByTestId("postseason-start-locked")).not.toBeInTheDocument();
  expect(screen.getByTestId("postseason-best-of")).toBeEnabled();
  expect(screen.getByTestId("postseason-third-place")).toBeEnabled();
});

test("passt keine Veto-Vorlage zum Best of, steht das schon in der Vorschau", async () => {
  renderPanel(cockpit([division({ playoffs: playoffs({ veto_notes: ["Veto für Best of 5: Für dieses Spiel gilt kein Map-Pool."] }) })]));
  expect(await screen.findByTestId("postseason-veto-note-d1")).toHaveTextContent("Veto für Best of 5");
});
