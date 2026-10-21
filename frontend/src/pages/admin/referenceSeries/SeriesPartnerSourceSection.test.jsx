import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Partner-Plattform der Saison (#1964): Quelle einstellen (nur Adressen der Liste), „Jetzt holen“ als Vorschau,
// Abweichungen ansehen, gezielt übernehmen, unbekannte Namen danach zuordnen - und ein Fehler der Quelle lässt den
// Abschnitt stehen. Nur erfundene Namen.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeriesPartnerSourceSection } = await import("./SeriesPartnerSourceSection");

const URL = "/reference-series/admin/series/serie-1/partner-source";
const CHOICES = [{ key: "tft_dashboard", label: "TFT-Dashboard", provider: "PineApps", base_urls: ["https://tft.pineapps.at"] }];
const PARTNERS = [{ id: "partner-a", name: "Probe Ananas", role: "organizer" }];
const SOURCE = { platform: "tft_dashboard", base_url: "https://tft.pineapps.at", series_ref: "7", series_name: "Probe Masters 2026/27", partner_id: "partner-a" };
const ITEMS = [
  { ref: "901", name: "Turnier 1 - Online", club_day: "2026-09-25", double_up: false, finished: true, state: "new", action: "new", round: null,
    sheet: null, expected_version: 0, target: "sheet", fingerprint: "f901", counts: { players: 6, rounds: 3, lobbies: 4, bots: 1, guests: 1 },
    changes: [], unknown_names: [{ participant_id: "neu:ada", name: "Ada Ausgedacht#AAA" }], errors: [], warnings: [], error: null },
  { ref: "902", name: "Turnier 2 - DOUBLE UP", club_day: "2026-10-16", double_up: true, finished: true, state: "changed", action: "assign",
    round: { id: "r2", code: "T2", position: 2 }, sheet: { status: "published", version: 3 }, expected_version: 3, target: "pending_draft",
    fingerprint: "f902", counts: { players: 8, rounds: 2, lobbies: 2, bots: 0, guests: 1 },
    changes: [{ participant_id: "p-b", name: "Bruno Beispiel", kind: "changed", fields: { place: [1, 2] } }], unknown_names: [], errors: [], warnings: [], error: null },
  { ref: "903", name: "Turnier 3 - Finale", club_day: "2026-12-11", double_up: false, finished: false, state: "waiting", action: "linked",
    round: { id: "r3", code: "T3", position: 3 }, sheet: null, expected_version: 0, target: null, fingerprint: "f903", counts: null,
    changes: [], unknown_names: [], errors: [], warnings: [], error: null },
  { ref: "904", name: "Turnier 4 - kaputt", club_day: "2026-11-01", double_up: false, finished: true, state: "error", action: "new", round: null,
    sheet: null, expected_version: 0, target: "sheet", fingerprint: "f904", counts: null, changes: [], unknown_names: [], errors: [], warnings: [],
    error: "Die Partner-Plattform hat in unerwarteter Form geantwortet - die Anbindung muss geprüft werden." },
];

function mockGet({ source = SOURCE } = {}) {
  apiMock.get.mockImplementation((url) => {
    if (url === URL) return Promise.resolve({ data: { source, choices: CHOICES, partners: PARTNERS } });
    if (url === `${URL}/series`) return Promise.resolve({ data: { items: [{ ref: "7", name: "Probe Masters 2026/27" }, { ref: "6", name: "Probe Saison 2025/26" }] } });
    if (url.endsWith("/unknown-names")) return Promise.resolve({ data: { items: [], profiles: [] } });
    return Promise.reject(new Error(`unerwartet: ${url}`));
  });
}

beforeEach(() => {
  for (const fn of [apiMock.get, apiMock.put, apiMock.post, toastMock.success, toastMock.error]) fn.mockReset();
  mockGet();
});

const series = { id: "serie-1", lineage: { title: "Probe Masters" } };

test("ohne Quelle: Plattform wählen, Serien beim Partner laden, Hinweis-Partner vorgewählt, speichern", async () => {
  mockGet({ source: null });
  apiMock.put.mockResolvedValue({ data: { source: SOURCE } });
  render(<SeriesPartnerSourceSection series={series} />);
  fireEvent.change(await screen.findByTestId("partner-source-platform"), { target: { value: "tft_dashboard" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith(`${URL}/series`, { params: { platform: "tft_dashboard", base_url: "https://tft.pineapps.at" } }));
  expect(screen.getByTestId("partner-source-base")).toHaveValue("https://tft.pineapps.at");
  expect(screen.getByTestId("partner-source-partner")).toHaveValue("partner-a");
  fireEvent.change(await screen.findByTestId("partner-source-series"), { target: { value: "7" } });
  fireEvent.click(screen.getByTestId("partner-source-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith(URL, {
    platform: "tft_dashboard", base_url: "https://tft.pineapps.at", series_ref: "7", series_name: "Probe Masters 2026/27", partner_id: "partner-a" }));
  expect(await screen.findByTestId("partner-source-summary")).toHaveTextContent("TFT-Dashboard · tft.pineapps.at · Serie Probe Masters 2026/27");
  expect(toastMock.success).toHaveBeenCalledWith("Quelle gespeichert.");
});

test("Jetzt holen zeigt je Turnier Termin, Ziel, Zahlen und Abweichungen – vorgewählt ist nur Neues", async () => {
  apiMock.post.mockResolvedValue({ data: { items: ITEMS } });
  render(<SeriesPartnerSourceSection series={series} />);
  fireEvent.click(await screen.findByTestId("partner-source-fetch"));
  const rows = await screen.findAllByTestId("partner-item");
  expect(apiMock.post).toHaveBeenCalledWith(`${URL}/preview`, null, { skipInvalidation: true });
  expect(rows).toHaveLength(4);
  expect(within(rows[0]).getByTestId("partner-item-pick")).toBeChecked();
  expect(rows[0]).toHaveTextContent("Neuer Termin · Ergebnis als Entwurf");
  expect(rows[0]).toHaveTextContent("6 Spieler · 3 Runden · 4 Lobbys · 1 Bot · 1 Gast");
  expect(rows[0]).toHaveTextContent("1 unbekannter Name");
  expect(within(rows[1]).getByTestId("partner-item-pick")).not.toBeChecked();
  expect(rows[1]).toHaveTextContent("Double Up");
  expect(rows[1]).toHaveTextContent("T2 · Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei");
  expect(within(rows[1]).getByTestId("partner-item-changes")).toHaveTextContent("Bruno Beispiel");
  expect(within(rows[1]).getByTestId("partner-item-changes")).toHaveTextContent("Platz 1 → 2");
  expect(within(rows[2]).queryByTestId("partner-item-pick")).toBeNull();
  expect(within(rows[3]).queryByTestId("partner-item-pick")).toBeNull();
  expect(rows[3]).toHaveTextContent("unerwarteter Form");
  expect(screen.getByTestId("partner-source-apply")).toHaveTextContent("Übernehmen (1)");
});

test("Übernehmen schickt den Stand der Vorschau, meldet das Ergebnis und öffnet „Unbekannte Namen“", async () => {
  const onChanged = vi.fn();
  apiMock.post.mockImplementation((url) => {
    if (url === `${URL}/preview`) return Promise.resolve({ data: { items: ITEMS } });
    return Promise.resolve({ data: { items: [{ ref: "901", status: "saved" }, { ref: "902", status: "saved" }], created_participants: [{ id: "p1", name: "Ada Ausgedacht#AAA" }], open_unknown: true } });
  });
  render(<SeriesPartnerSourceSection series={series} onChanged={onChanged} />);
  fireEvent.click(await screen.findByTestId("partner-source-fetch"));
  const rows = await screen.findAllByTestId("partner-item");
  fireEvent.click(within(rows[1]).getByTestId("partner-item-pick"));
  fireEvent.click(screen.getByTestId("partner-source-apply"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${URL}/apply`, { items: [
    { ref: "901", fingerprint: "f901", expected_version: 0, round_id: null },
    { ref: "902", fingerprint: "f902", expected_version: 3, round_id: "r2" }] }));
  expect(toastMock.success).toHaveBeenCalledWith("2 Ergebnisse als Entwurf übernommen.");
  expect(onChanged).toHaveBeenCalled();
  expect(await screen.findByTestId("unknown-names")).toBeInTheDocument();
});

test("ein Fehler der Quelle steht im Abschnitt – Einstellungen und Knöpfe bleiben", async () => {
  apiMock.post.mockRejectedValue({ response: { status: 502, data: { detail: "Die Partner-Plattform hat nicht rechtzeitig geantwortet - bitte später noch einmal holen." } } });
  render(<SeriesPartnerSourceSection series={series} />);
  fireEvent.click(await screen.findByTestId("partner-source-fetch"));
  expect(await screen.findByTestId("partner-source-error")).toHaveTextContent("nicht rechtzeitig geantwortet");
  expect(screen.getByTestId("partner-source-fetch")).toBeEnabled();
  expect(screen.getByTestId("partner-source-summary")).toBeInTheDocument();
});

test("Quelle ändern und abschalten", async () => {
  apiMock.put.mockResolvedValue({ data: { source: null } });
  render(<SeriesPartnerSourceSection series={series} />);
  fireEvent.click(await screen.findByTestId("partner-source-edit"));
  expect(screen.getByTestId("partner-source-series")).toHaveValue("7");
  fireEvent.change(screen.getByTestId("partner-source-platform"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("partner-source-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith(URL, { platform: null }));
  expect(await screen.findByTestId("partner-source-platform")).toHaveValue("");
});
