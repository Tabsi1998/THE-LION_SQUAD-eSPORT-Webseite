import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Ergebnis-Bild auslesen (#1756) im Ergebnis-Blatt: Knopf und Strg+V, Übersicht, gelbe Felder, „Passt so“, übernommen
// wird erst ohne gelbe Zeilen. Der Server liest - hier nachgestellt. Nur erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { ResultEntrySheet } = await import("./ResultEntrySheet");

const BASE = "/reference-series/admin/series/serie-1/rounds/r1/results";
const PARTICIPANTS = [
  { id: "p1", name: "Anna Probe", start_number: "7", default_team: "Rotor Racing" },
  { id: "p2", name: "Bert Bolzt", start_number: "12", default_team: "Blaupfeil GP" },
];
const DATA = {
  round: { id: "r1", code: "R1", club_day: "2026-10-15", venue: "Probering Nord" },
  series: { id: "serie-1", kind: "racing", rules: { points_mode: "scheme", points_by_place: [25, 18, 15] } },
  access: { role: "board", can_publish: true }, version: 0, sheet: null, target: "sheet", participants: PARTICIPANTS,
};
const INFO = { template: { id: "rennliga-dunkel", name: "Rennliga-Ergebnis (dunkel)" }, available: true, max_mb: 50, formats: ["image/png"] };
const READ = {
  template: { id: "rennliga-dunkel", name: "Rennliga-Ergebnis (dunkel)" },
  rows: [
    { index: 0, place: 1, dnf: false, marks: [], start_number: "7", name: "Anna Probe", participant_id: "p1", team: "Rotor Racing", grid: 2, time: "1:32:15.123", gap: null, uncertain: [], read: {} },
    { index: 1, place: 2, dnf: false, marks: [], start_number: "12", name: "Bert Bolzt", participant_id: "p2", team: "Blaupfeil GP", grid: 1, time: "1:32:17.456", gap: "+2.333", uncertain: ["team"], read: { team: "Blaupted GP" } },
    { index: 2, place: null, dnf: true, marks: ["dnf"], start_number: "31", name: "Dora Nev", participant_id: null, team: "Kometen Team", grid: 3, time: null, gap: null, uncertain: ["name"], read: {} },
  ],
  track: { name: "Probering Nord", uncertain: [] },
  fastest_lap: { name: "Bert Bolzt", participant_id: "p2", time: "1:31.207", uncertain: [] },
  driver_of_the_day: { name: "Anna Probe", participant_id: "p1", uncertain: [] },
  uncertain_rows: 2,
  warnings: [{ code: "blurry", message: "Das Bild ist unscharf oder sehr klein - bitte die gelben Felder genau prüfen." }],
};
const ORIGINALS = "/reference-series/admin/series/serie-1/rounds/r1/originals";
// Alles sicher gelesen - so lässt sich gleich übernehmen.
const SURE = { ...READ, rows: READ.rows.map((row) => ({ ...row, uncertain: [] })), uncertain_rows: 0, warnings: [] };
// Unter Last (ganze Suite parallel) braucht der Ablauf länger als die Vorgabe von 1 s.
const WAIT = { timeout: 5000 };
const PREVIEW = { version: 0, target: "sheet", can_save: true, errors: [], warnings: [], rows: [], unknown_names: [], standings: null, final: null, latest: null };

function setup({ info = INFO } = {}) {
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? info : DATA }));
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? READ : PREVIEW }));
  apiMock.put.mockResolvedValue({ data: { target: "sheet", version: 1, created_participants: [] } });
  render(<ResultEntrySheet series={{ id: "serie-1", lineage: { title: "Probe Racing" } }} round={{ id: "r1", code: "R1" }} onClose={vi.fn()} onSaved={vi.fn()} />);
}

function png(name = "ergebnis.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function pasteImage(file, target = window) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [file], items: [], getData: () => "" } });
  act(() => { target.dispatchEvent(event); });
  return event;
}

// Unter Last hängt das Blatt den Strg+V-Empfänger erst nach dem ersten Bild an: einfügen, bis der Server das Bild bekommt
// (genau einmal), statt nur einmal zu feuern und auf Glück zu hoffen.
async function pasteUntilRead(file) {
  await waitFor(() => {
    if (!apiMock.post.mock.calls.some(([url, body]) => url.endsWith("/image") && body === file)) pasteImage(file);
    expect(apiMock.post).toHaveBeenCalledWith(`${BASE}/image`, file, expect.anything());
  }, WAIT);
}

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("Knopf „Bild auslesen“: gelesen wird im Server, die Zeilen ersetzen die Liste, die Vorschau prüft gleich", async () => {
  setup();
  const pick = await screen.findByTestId("result-image-pick");
  expect(pick).toHaveTextContent("Bild auslesen");
  expect(screen.getByTestId("result-image-paste-hint")).toHaveTextContent("Strg+V");
  const file = png();
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  expect(apiMock.post).toHaveBeenCalledWith(`${BASE}/image`, file, { headers: { "Content-Type": "image/png" } });
  expect(screen.getAllByTestId("result-row-name").map((input) => input.value)).toEqual(["Anna Probe", "Bert Bolzt", "Dora Nev"]);
  // Gleich danach die Vorschau – mit Ausfall ohne Platz, Startplatz, Zeit und Abstand, schnellster Runde und Fahrer
  // des Tages als Felder des Rennens (#1927).
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`${BASE}/preview`, expect.anything()));
  const body = apiMock.post.mock.calls.find(([url]) => url.endsWith("/preview"))[1];
  expect(body.rows.map((row) => [row.participant_id || row.name, row.place, row.marks])).toEqual([
    ["p1", 1, []], ["p2", 2, []], ["Dora Nev", null, ["dnf"]],
  ]);
  expect([body.rows[1].grid, body.rows[1].time, body.rows[1].gap]).toEqual([1, "1:32:17.456", "+2.333"]);
  expect([body.fastest_lap, body.driver_of_the_day]).toEqual([{ participant_id: "p2", time: "1:31.207" }, { participant_id: "p1" }]);
  expect([screen.getByTestId("result-fastest-name").value, screen.getByTestId("result-fastest-time").value, screen.getByTestId("result-dotd").value])
    .toEqual(["Bert Bolzt", "1:31,207", "Anna Probe"]);
  expect(screen.queryByTestId("result-race-ocr")).toBeNull();
  // Übersicht: Vorlage, Kopf, Hinweis, wie viele Zeilen gelb sind.
  const summary = screen.getByTestId("result-image-summary");
  expect(within(summary).getByTestId("result-image-counts")).toHaveTextContent("3 Zeilen in die Liste übernommen · Vorlage Rennliga-Ergebnis (dunkel)");
  expect(within(summary).getByTestId("result-image-header")).toHaveTextContent("Schnellste RennrundeBert Bolzt · 1:31,207");
  expect(within(summary).getByTestId("result-image-status")).toHaveTextContent("2 Zeilen sind gelb");
  expect(within(summary).getByTestId("result-image-warnings")).toHaveTextContent("unscharf");
  // Gelb: genau die unsicheren Felder, darunter was im Bild stand.
  const rows = screen.getAllByTestId("result-row");
  expect(within(rows[1]).getByTestId("result-row-team")).toHaveAttribute("data-ocr-uncertain", "team");
  expect(within(rows[1]).getByTestId("result-row-name")).not.toHaveAttribute("data-ocr-uncertain");
  expect(within(rows[1]).getByTestId("result-row-ocr")).toHaveTextContent("Team (gelesen „Blaupted GP“)");
  expect(within(rows[2]).getByTestId("result-row-name")).toHaveAttribute("data-ocr-uncertain", "name");
  expect(within(rows[0]).queryByTestId("result-row-ocr")).toBeNull();
}, 15000);

test("übernommen wird erst ohne gelbe Zeilen: ändern oder „Passt so“", async () => {
  setup();
  await screen.findByTestId("result-image-pick");
  await pasteUntilRead(png());
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Gelbe Zeilen prüfen"), WAIT);
  expect(screen.queryByTestId("result-save-draft")).toBeNull();
  expect(screen.getByTestId("result-image-open")).toHaveTextContent("2 Zeilen aus dem Bild sind noch gelb");
  fireEvent.click(screen.getByTestId("result-submit"));
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("noch gelb"));
  expect(apiMock.put).not.toHaveBeenCalled();

  // Team korrigiert: die Markierung fällt; der Name der dritten Zeile wird bestätigt.
  const rows = screen.getAllByTestId("result-row");
  fireEvent.change(within(rows[1]).getByTestId("result-row-team"), { target: { value: "Rotor Racing" } });
  expect(within(rows[1]).getByTestId("result-row-team")).not.toHaveAttribute("data-ocr-uncertain");
  fireEvent.click(within(rows[2]).getByTestId("result-row-ocr-confirm"));
  expect(screen.queryByTestId("result-image-open")).toBeNull();
  expect(screen.getByTestId("result-image-status")).toHaveTextContent("Alles sicher gelesen");
  // Nach der Änderung prüft die Vorschau neu, dann wird übernommen.
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Veröffentlichen"), WAIT);
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled(), WAIT);
  const body = apiMock.put.mock.calls[0][1];
  expect(body.status).toBe("published");
  expect(body.rows[1].team).toBe("Rotor Racing");
}, 15000);

test("gelbe Zeit und gelbe Felder des Rennens: „Mehr“ steht offen, ändern oder „Passt so“ gibt das Übernehmen frei", async () => {
  const read = {
    ...READ,
    rows: [{ ...READ.rows[0], uncertain: ["time"], read: { time: "1:32:15.l23" } }, { ...READ.rows[1], uncertain: [] }, { ...READ.rows[2], uncertain: [] }],
    fastest_lap: { name: "Bert Bolzt", participant_id: "p2", time: "1:37.207", uncertain: ["time"], read: "Bert Bolzt 137,207" },
    driver_of_the_day: { name: "Anna Prob3", participant_id: null, uncertain: ["name"], read: "Anna Prob3" },
  };
  setup();
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? read : PREVIEW }));
  await screen.findByTestId("result-image-pick");
  await pasteUntilRead(png());
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Gelbe Zeilen prüfen"), WAIT);
  expect(screen.getByTestId("result-image-open")).toHaveTextContent("2 Zeilen aus dem Bild sind noch gelb");
  // Die gelbe Zeit steht unter „Mehr“ – das ist dafür schon offen.
  const first = screen.getAllByTestId("result-row")[0];
  expect(within(first).getByTestId("result-row-more")).toHaveAttribute("aria-expanded", "true");
  expect(within(first).getByTestId("result-row-time")).toHaveAttribute("data-ocr-uncertain", "time");
  expect(within(first).getByTestId("result-row-ocr")).toHaveTextContent("Zeit (gelesen „1:32:15.l23“)");
  // Felder des Rennens: gelb mit dem, was im Bild stand.
  expect(screen.getByTestId("result-fastest-time")).toHaveAttribute("data-ocr-uncertain", "fastest_lap_time");
  expect(screen.getByTestId("result-fastest-name")).not.toHaveAttribute("data-ocr-uncertain");
  expect(screen.getByTestId("result-dotd")).toHaveAttribute("data-ocr-uncertain", "driver_of_the_day");
  expect(screen.getByTestId("result-race-ocr")).toHaveTextContent("Rundenzeit (gelesen „Bert Bolzt 137,207“), Fahrer des Tages (gelesen „Anna Prob3“)");
  // Zeit korrigiert (das Feld bleibt offen), Rundenzeit korrigiert, der Rest des Rennens mit „Passt so“.
  fireEvent.change(within(first).getByTestId("result-row-time"), { target: { value: "1:32:15.124" } });
  expect(within(first).getByTestId("result-row-time")).not.toHaveAttribute("data-ocr-uncertain");
  expect(within(first).getByTestId("result-row-more")).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByTestId("result-fastest-time"), { target: { value: "1:31.207" } });
  expect(screen.getByTestId("result-fastest-time")).not.toHaveAttribute("data-ocr-uncertain");
  expect(screen.getByTestId("result-dotd")).toHaveAttribute("data-ocr-uncertain", "driver_of_the_day");
  expect(screen.getByTestId("result-image-open")).toHaveTextContent("Eine Zeile aus dem Bild ist noch gelb");
  fireEvent.click(screen.getByTestId("result-race-ocr-confirm"));
  expect(screen.queryByTestId("result-image-open")).toBeNull();
  expect(screen.queryByTestId("result-race-ocr")).toBeNull();
}, 15000);

test("eine eingefügte Liste oder ein zweites Bild ohne Kopf geben ungeprüfte Felder des Rennens nicht frei", async () => {
  const read = {
    ...READ,
    rows: READ.rows.map((row) => ({ ...row, uncertain: [] })),
    fastest_lap: { name: "Bert Bolzt", participant_id: "p2", time: "1:37.207", uncertain: ["time"], read: "Bert Bolzt 137,207" },
  };
  setup();
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? read : PREVIEW }));
  await screen.findByTestId("result-image-pick");
  await pasteUntilRead(png());
  await waitFor(() => expect(screen.getByTestId("result-fastest-time")).toHaveAttribute("data-ocr-uncertain", "fastest_lap_time"), WAIT);
  expect(screen.getByTestId("result-image-open")).toHaveTextContent("Eine Zeile aus dem Bild ist noch gelb");

  // Liste ohne schnellste Runde: die Zeilen sind neu, die gelesene Rundenzeit steht noch da - und bleibt gelb.
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Anna Probe\n2. Bert Bolzt" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(2), WAIT);
  expect(screen.getByTestId("result-fastest-time")).toHaveValue("1:37,207");
  expect(screen.getByTestId("result-fastest-time")).toHaveAttribute("data-ocr-uncertain", "fastest_lap_time");
  expect(screen.getByTestId("result-image-open")).toHaveTextContent("Eine Zeile aus dem Bild ist noch gelb");

  // Zweites Bild ohne Kopf: ebenso.
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? { ...read, fastest_lap: null, driver_of_the_day: null } : PREVIEW }));
  await pasteUntilRead(png("zweites.png"));
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  expect(screen.getByTestId("result-fastest-time")).toHaveAttribute("data-ocr-uncertain", "fastest_lap_time");
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Gelbe Zeilen prüfen"), WAIT);
  fireEvent.click(screen.getByTestId("result-submit"));
  expect(apiMock.put).not.toHaveBeenCalled();

  // Eine Liste mit eigener schnellster Runde ersetzt den Wert - dann ist er geprüft.
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  fireEvent.change(screen.getByTestId("result-paste-text"), { target: { value: "1. Anna Probe\n2. Bert Bolzt\nSchnellste Runde: Bert Bolzt 1:31.207" } });
  fireEvent.click(screen.getByTestId("result-paste-apply"));
  await waitFor(() => expect(screen.getByTestId("result-fastest-time")).toHaveValue("1:31,207"), WAIT);
  expect(screen.getByTestId("result-fastest-time")).not.toHaveAttribute("data-ocr-uncertain");
  expect(screen.queryByTestId("result-image-open")).toBeNull();
}, 15000);

test("Strg+V: Text in einem Feld bleibt Text, ohne Vorlage gibt es kein Auslesen", async () => {
  setup();
  await screen.findByTestId("result-image-pick");
  fireEvent.click(screen.getByTestId("result-paste-toggle"));
  const area = screen.getByTestId("result-paste-text");
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [png()], items: [], getData: () => "1. Anna Probe" } });
  act(() => { area.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ohne Vorlage oder Tesseract: kein Knopf, Strg+V liest nichts aus - das Bild wird Original (#1933)", async () => {
  setup({ info: { template: null, available: false, max_mb: 50, formats: [] } });
  await screen.findByTestId("result-rows-section");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith(`${BASE}/image`));
  expect(screen.queryByTestId("result-image-pick")).toBeNull();
  const file = png();
  await waitFor(() => {
    if (!apiMock.post.mock.calls.length) pasteImage(file);
    expect(apiMock.post).toHaveBeenCalledWith(ORIGINALS, file, expect.objectContaining({ params: { kind: "race", origin: "upload" } }));
  }, WAIT);
  expect(apiMock.post.mock.calls.some(([url]) => url.endsWith("/image"))).toBe(false);
});

// Original-Bilder (#1933): das gelesene Bild hängt erst beim Übernehmen am Termin - mit derselben Datei.
test("ein gelesenes Bild wird beim Übernehmen als Original angehängt, nicht schon beim Lesen", async () => {
  setup();
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? SURE : url === ORIGINALS ? { id: "o1" } : PREVIEW }));
  await screen.findByTestId("result-image-pick");
  const file = png();
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  // Gelesen - aber noch nichts angehängt; das Bild wartet sichtbar in „Original-Bilder“.
  expect(apiMock.post.mock.calls.some(([url]) => url === ORIGINALS)).toBe(false);
  expect(screen.getByTestId("original-pending")).toHaveTextContent("wird beim Übernehmen des Ergebnisses als Original angehängt");
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Veröffentlichen"), WAIT);
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled(), WAIT);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(ORIGINALS, file, expect.objectContaining({
    params: { kind: "race", origin: "reading" } })), WAIT);
  // Erst gespeichert, dann angehängt.
  const order = apiMock.put.mock.invocationCallOrder[0];
  const attached = apiMock.post.mock.calls.findIndex(([url]) => url === ORIGINALS);
  expect(apiMock.post.mock.invocationCallOrder[attached]).toBeGreaterThan(order);
  expect(toastMock.success).toHaveBeenCalledWith("Ergebnis veröffentlicht. Original-Bild angehängt.");
}, 15000);

test("„Nicht anhängen“: das gelesene Bild bleibt nur im Browser", async () => {
  setup();
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? SURE : PREVIEW }));
  await screen.findByTestId("result-image-pick");
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [png()] } });
  await waitFor(() => expect(screen.getByTestId("original-pending")).toBeInTheDocument(), WAIT);
  fireEvent.change(within(screen.getByTestId("original-pending")).getByTestId("original-kind"), { target: { value: "table" } });
  fireEvent.click(screen.getByTestId("original-pending-drop"));
  expect(screen.queryByTestId("original-pending")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("result-submit")).toHaveTextContent("Veröffentlichen"), WAIT);
  fireEvent.click(screen.getByTestId("result-submit"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled(), WAIT);
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Ergebnis veröffentlicht."), WAIT);
  expect(apiMock.post.mock.calls.some(([url]) => url === ORIGINALS)).toBe(false);
}, 15000);

test("Fehler des Servers: feste Meldung, die Liste bleibt", async () => {
  setup();
  await screen.findByTestId("result-image-pick");
  apiMock.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: "Im Bild wurde keine Ergebnistabelle gefunden." } } });
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [png()] } });
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Im Bild wurde keine Ergebnistabelle gefunden."));
  expect(screen.getAllByTestId("result-row")).toHaveLength(1);
  expect(screen.queryByTestId("result-image-summary")).toBeNull();
  // Falsches Format prüft schon der Browser.
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [new File(["x"], "a.heic", { type: "image/heic" })] } });
  expect(toastMock.error).toHaveBeenLastCalledWith(expect.stringContaining("Nur PNG, JPG oder WebP"));
  expect(apiMock.post).toHaveBeenCalledTimes(1);
});

// Teamfarben aus dem Bild (#1950): der Vorschlag geht an die Saison, übernommen wird er erst bei den Teamfarben.
test("die Schriftfarben aus dem Bild gehen als Vorschlag für die Teamfarben an die Saison", async () => {
  setup();
  apiMock.post.mockImplementation(async (url) => ({ data: url.endsWith("/image") ? { ...READ, team_colors: { "Rotor Racing": "#e10600" } } : PREVIEW }));
  await screen.findByTestId("result-image-pick");
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [png()] } });
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    "/reference-series/admin/series/serie-1/team-colors/suggestions", { colors: { "Rotor Racing": "#e10600" } }), WAIT);
});

test("ohne Schriftfarben im Bild geht kein Vorschlag an die Saison", async () => {
  setup();
  await screen.findByTestId("result-image-pick");
  fireEvent.change(screen.getByTestId("result-image-file"), { target: { files: [png()] } });
  await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), WAIT);
  expect(apiMock.post.mock.calls.some(([url]) => url.includes("team-colors"))).toBe(false);
});
