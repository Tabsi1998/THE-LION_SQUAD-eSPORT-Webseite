import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierbaum-TV (#1110, #1113, #1115): der Anzeige-Schlüssel geht mit an die API, ein widerrufener zeigt nichts mehr vom
// Turnier; leere Plätze sagen im Klartext, wer kommt - kein „W:A:1“, kein „Freier Slot“, keine „Keine Station“. Seit
// Meilenstein 59 ist es der echte Baum mit Linien; die Karte nennt oben die geplante Zeit („geplant ca. 14:20“).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

const BracketTVPage = (await import("./BracketTVPage")).default;

const seed = (n) => ({ type: "seed", seed: n, raw: String(n) });
const winner = (key) => ({ type: "rank", flow: "W", match_key: key, rank: 1, raw: `W:${key}:1` });

const BRACKET = {
  tournament: { id: "t1", slug: "cup", title: "Lions Herbst-Cup", status: "live" },
  registrations: [{ id: "r1", display_name: "NeonFalke" }, { id: "r2", display_name: "KartKönigin" }],
  stages: [{ id: "s1", name: "Turnierbaum", number: 1 }],
  matches_v2: [
    { id: "m1", stage_id: "s1", section: "WB", round: 1, order: 0, match_key: "A", status: "ready", settings: { match_size: 2, qualifiers_per_match: 1 },
      slots: [{ slot: 1, registration_id: "r1", source: seed(1) }, { slot: 2, registration_id: "r2", source: seed(2) }], results: [],
      scheduled_at: "2026-10-10T14:20:00+02:00", duration_minutes: 30 },
    { id: "m2", stage_id: "s1", section: "WB", round: 1, order: 1, match_key: "B", status: "pending", settings: { match_size: 2, qualifiers_per_match: 1 },
      slots: [{ slot: 1, registration_id: null, status: "preview", source: seed(3) }, { slot: 2, registration_id: null, status: "preview", source: seed(4) }], results: [],
      duration_minutes: 30 },
    { id: "m3", stage_id: "s1", section: "WB", round: 2, order: 0, match_key: "C", status: "pending", settings: { match_size: 2, qualifiers_per_match: 1 },
      slots: [{ slot: 1, registration_id: null, status: "pending", source: winner("A") }, { slot: 2, registration_id: null, status: "pending", source: winner("B") }], results: [],
      duration_minutes: 30 },
  ],
};

function renderTv(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display/bracket/:id" element={<BracketTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

function serve(bracket) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url.startsWith("/tournaments/t1/bracket/display")) return bracket();
    return { data: [] };
  });
}

test("mit Schlüssel im Link fragt der TV mit Schlüssel - und zeigt leere Plätze im Klartext", async () => {
  serve(async () => ({ data: BRACKET }));
  renderTv("/display/bracket/t1?key=nur-anschauen&text_size=large");
  expect(await screen.findByText("Sieger aus A")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/bracket/display", { params: { key: "nur-anschauen" } });
  const tv = screen.getByTestId("bracket-tv");
  expect(tv).toHaveTextContent("Sieger aus B");
  expect(tv).toHaveTextContent("NeonFalke");
  for (const old of ["W:A:1", "W:B:1", "Freier Slot", "Keine Station", "Min."]) expect(tv).not.toHaveTextContent(old);
  // Setzplätze vor dem Start bleiben leer: Spiel B hat zwei leise Zeilen ohne Namen.
  const open = screen.getByTestId("tv-match-m2");
  expect(open.querySelectorAll("[data-slot-kind='empty']")).toHaveLength(2);
  expect(open.querySelectorAll("[data-tv-name]")).toHaveLength(0);
  // Kürzel aus zwei Buchstaben, die geplante Zeit im Klartext.
  expect(screen.getByTestId("tv-match-m1")).toHaveTextContent("NF");
  expect(screen.getByTestId("tv-match-m1")).toHaveTextContent("KK");
  expect(screen.getByTestId("tv-match-m1")).toHaveTextContent(/geplant ca\. .*14:20/);
  // Der echte Baum: Winner Bracket als Block, zwischen den Runden Linien, keine Spalten-Seiten mehr.
  expect(screen.getByTestId("tv-tree")).toBeInTheDocument();
  expect(screen.getByTestId("bracket-section-title-wb")).toHaveTextContent("Winner Bracket");
  expect(screen.queryByTestId("tv-column")).not.toBeInTheDocument();
  // Ton gibt es nur mit Einstellung - ohne sie auch kein „Für Ton einmal klicken“.
  expect(screen.queryByTestId("tv-sound-hint")).not.toBeInTheDocument();
  // Der QR-Code zeigt die öffentliche Seite - nie den Schlüssel.
  expect(screen.getByTestId("branded-qr-code").getAttribute("data-value")).not.toContain("nur-anschauen");
  expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-tv-text", "large");
});

test("ein widerrufener Schlüssel zeigt nichts mehr vom Turnier", async () => {
  serve(async () => {
    const error = new Error("forbidden");
    error.response = { status: 403, data: { detail: "Dieser TV-Link gilt nicht mehr." } };
    throw error;
  });
  renderTv("/display/bracket/t1?key=widerrufen");
  expect(await screen.findByTestId("tv-key-refused")).toHaveTextContent("Dieser TV-Link gilt nicht mehr");
  expect(screen.queryByText("Lions Herbst-Cup")).not.toBeInTheDocument();
});

test("Ton beim Ergebnis im Link: der TV bittet einmal klein um einen Klick - danach ist der Hinweis weg", async () => {
  const created = [];
  class FakeAudioContext {
    constructor(options = {}) {
      this.options = options;
      this.state = "suspended";
      created.push(this);
    }

    async resume() {
      this.state = "running";
    }
  }
  window.AudioContext = FakeAudioContext;
  try {
    serve(async () => ({ data: BRACKET }));
    renderTv("/display/bracket/t1?key=nur-anschauen&result_sound=1");
    await screen.findByText("Sieger aus A");
    expect(screen.getByTestId("tv-sound-hint")).toHaveTextContent("Für Ton einmal klicken");
    // Vor dem Klick legt der TV nichts für Ton an - danach ist der Ton bereit.
    expect(created).toHaveLength(0);
    fireEvent.pointerDown(window);
    await waitFor(() => expect(screen.queryByTestId("tv-sound-hint")).not.toBeInTheDocument());
    expect(created[0].state).toBe("running");
  } finally {
    delete window.AudioContext;
  }
});

test("ohne Schlüssel fragt der TV ohne - für die angemeldete Turnierleitung", async () => {
  serve(async () => ({ data: BRACKET }));
  renderTv("/display/bracket/t1");
  await screen.findByText("Sieger aus A");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/bracket/display", undefined));
});

// ---------------------------------------------------------------- Meilenstein 60 (#1121-#1125)

const NOW_ISO = () => new Date().toISOString();
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

function serveAll({ bracket, stations = [], sponsors = [], settings = {} }) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings } };
    if (url.startsWith("/tournaments/t1/bracket/display")) return { data: bracket };
    if (url.startsWith("/stations")) return { data: stations };
    if (url.startsWith("/sponsors")) return { data: sponsors };
    return { data: [] };
  });
}

test("#1123: „Pausiert“ zeigt die Pause - mit „Weiter um“ und Countdown; ohne Uhrzeit nur „Kurze Pause“", async () => {
  serveAll({ bracket: { ...BRACKET, tournament: { ...BRACKET.tournament, status: "paused", paused_until: inMinutes(12.5) } } });
  renderTv("/display/bracket/t1?key=k");
  expect(await screen.findByTestId("tv-pause-screen")).toHaveAttribute("data-state", "running");
  expect(screen.getByTestId("tv-pause-headline")).toHaveTextContent(/^Weiter um \d{2}:\d{2}$/);
  expect(screen.getByTestId("tv-pause-countdown")).toHaveTextContent(/noch\s*12:\d{2}/);
  expect(screen.getByTestId("tv-pause-next")).toHaveTextContent("Danach: Winner Bracket, Runde 1 · Spiel A");
  expect(screen.queryByTestId("tv-tree")).not.toBeInTheDocument();
});

test("#1123: ist „Pause bis“ vorbei, steht „Gleich geht es weiter“ statt einer Minuszeit", async () => {
  serveAll({ bracket: { ...BRACKET, tournament: { ...BRACKET.tournament, status: "paused", paused_until: inMinutes(-3) } } });
  renderTv("/display/bracket/t1?key=k");
  expect(await screen.findByTestId("tv-pause-headline")).toHaveTextContent("Gleich geht es weiter");
  expect(screen.queryByTestId("tv-pause-countdown")).not.toBeInTheDocument();
  expect(screen.getByTestId("tv-pause-screen")).not.toHaveTextContent(/-\d/);
});

test("#1123: Check-in läuft - „1 von 2 da“, alle Namen mit Haken, wer fehlt zuerst", async () => {
  const registrations = [{ id: "r1", display_name: "NeonFalke", status: "checked_in" }, { id: "r2", display_name: "KartKönigin", status: "approved" }];
  serveAll({ bracket: { ...BRACKET, registrations, tournament: { ...BRACKET.tournament, status: "check_in", check_in_until: inMinutes(13) } } });
  renderTv("/display/bracket/t1?key=k");
  expect(await screen.findByTestId("tv-checkin-screen")).toBeInTheDocument();
  expect(screen.getByTestId("tv-checkin-count")).toHaveTextContent("1von 2 da");
  expect(screen.getByTestId("tv-check-r1")).toHaveAttribute("data-present", "1");
  expect(screen.getByTestId("tv-check-r2")).toHaveAttribute("data-present", "0");
  expect(screen.getByTestId("tv-checkin-hint")).toHaveTextContent(/Check-in schließt um \d{2}:\d{2}\. Noch nicht da\? Bitte bei der Turnierleitung melden\./);
});

test("#1123: Anmeldung offen - großer QR-Code zur Anmeldung und freie Plätze", async () => {
  serveAll({ bracket: { ...BRACKET, matches_v2: [], seats: { taken: 10, capacity: 16 }, tournament: { ...BRACKET.tournament, status: "registration_open", registration_enabled: true, start_date: inMinutes(120) } } });
  renderTv("/display/bracket/t1?key=k");
  expect(await screen.findByTestId("tv-registration-screen")).toBeInTheDocument();
  expect(screen.getByTestId("tv-registration-seats")).toHaveTextContent("Noch 6 von 16 Plätzen frei");
  const codes = screen.getAllByTestId("branded-qr-code").map((element) => element.getAttribute("data-value"));
  expect(codes).toContain(`${window.location.origin}/tournaments/cup`);
  expect(codes.join(" ")).not.toContain("key");
});

test("#1121/#1122: ein Link mit nur einer Folie - die Aufruf-Tafel, ohne Balken", async () => {
  const bracket = JSON.parse(JSON.stringify(BRACKET));
  Object.assign(bracket.matches_v2[0], { called_at: NOW_ISO(), station_id: "st-pc-3", station_name: "PC 3" });
  delete bracket.matches_v2[0].scheduled_at;
  serveAll({ bracket, stations: [{ id: "st-pc-3", name: "PC 3", status: "reserved", current_match_id: "m1", called_at: bracket.matches_v2[0].called_at }] });
  renderTv("/display/bracket/t1?key=k&playlist=calls");
  expect(await screen.findByTestId("tv-call-board")).toHaveAttribute("data-count", "1");
  expect(screen.getByTestId("tv-call-station-m1")).toHaveTextContent("PC 3");
  expect(screen.getByTestId("tv-call-m1")).toHaveTextContent("Bitte jetzt zur Station");
  expect(screen.getByTestId("tv-call-clock-m1")).toHaveTextContent(/^[12]:\d{2}$/);
  expect(screen.queryByTestId("tv-slide-bar")).not.toBeInTheDocument();
  // Ohne Baum in der Liste gibt es auch keine Baum-Momente.
  expect(screen.queryByTestId("tv-tree")).not.toBeInTheDocument();
});

test("#1122: ohne Aufrufe zeigt die Aufruf-Tafel „Gerade keine Aufrufe“", async () => {
  serveAll({ bracket: BRACKET });
  renderTv("/display/bracket/t1?key=k&playlist=calls");
  expect(await screen.findByTestId("tv-calls-none")).toHaveTextContent("Gerade keine Aufrufe");
});

test("#1121: mehrere Folien mit Inhalt - der Balken zeigt, wann gewechselt wird", async () => {
  const bracket = JSON.parse(JSON.stringify(BRACKET));
  Object.assign(bracket.matches_v2[0], { called_at: NOW_ISO(), station_id: "st-pc-3", station_name: "PC 3" });
  serveAll({ bracket });
  renderTv("/display/bracket/t1?key=k");
  expect(await screen.findByTestId("tv-tree")).toBeInTheDocument();
  expect(screen.getByTestId("bracket-tv")).toHaveAttribute("data-slide", "tree");
  expect(screen.getByTestId("tv-slide-bar")).toHaveAttribute("data-total", "12000");
});

test("#1125: „Runde 1 präsentiert von“ oben - nur mit Sponsor aus der TV-Liste und nur mit dem Schalter", async () => {
  const bracket = { ...BRACKET, tournament: { ...BRACKET.tournament, round_sponsors: [{ stage_id: "s1", section: "WB", round: 1, sponsor_id: "sp1" }] } };
  serveAll({ bracket, sponsors: [{ id: "sp1", name: "Pixelwerk", logo_url: "/logo.png" }] });
  renderTv("/display/bracket/t1?key=k");
  const presented = await screen.findByTestId("tv-presented-by");
  expect(presented).toHaveTextContent("Runde 1");
  expect(presented).toHaveTextContent("präsentiert von");
  expect(presented.querySelector("[title='Pixelwerk']")).not.toBeNull();
});

test("#1125: mit „präsentiert von“ aus und ohne Laufband - keine Sponsoren am TV", async () => {
  const bracket = { ...BRACKET, tournament: { ...BRACKET.tournament, round_sponsors: [{ stage_id: "s1", section: "WB", round: 1, sponsor_id: "sp1" }] } };
  serveAll({ bracket, sponsors: [{ id: "sp1", name: "Pixelwerk", logo_url: "/logo.png" }] });
  renderTv("/display/bracket/t1?key=k&sponsor_presented=0");
  await screen.findByTestId("tv-tree");
  expect(screen.queryByTestId("tv-presented-by")).not.toBeInTheDocument();
  expect(screen.queryByTestId("sponsor-grid")).not.toBeInTheDocument();
});

test("#1121: bleibt es bei derselben Folie, wird sie nicht neu eingeblendet - nur ihre Zeit beginnt von vorn", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const bracket = JSON.parse(JSON.stringify(BRACKET));
    Object.assign(bracket.matches_v2[0], { called_at: NOW_ISO(), station_id: "st-pc-3", station_name: "PC 3" });
    serveAll({ bracket, stations: [{ id: "st-pc-3", name: "PC 3", status: "reserved", current_match_id: "m1", called_at: bracket.matches_v2[0].called_at }] });
    renderTv("/display/bracket/t1?key=k&playlist=calls-8");
    const board = await screen.findByTestId("tv-call-board");
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(screen.getByTestId("tv-call-board")).toBe(board);
  } finally {
    vi.useRealTimers();
  }
});

test("#1125: ein Link nur mit Sponsor - die Sponsoren stehen dauerhaft und wechseln sich ab, ohne Balken", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const sponsors = [{ id: "sp1", name: "Pixelwerk", logo_url: "/a.png" }, { id: "sp2", name: "Muster Energie", logo_url: "/b.png" }];
    serveAll({ bracket: BRACKET, sponsors });
    renderTv("/display/bracket/t1?key=k&playlist=sponsor-6");
    expect(await screen.findByTestId("tv-sponsor-moment")).toHaveAttribute("data-sponsor", "sp1");
    expect(screen.getByTestId("bracket-tv")).toHaveAttribute("data-slide", "sponsor");
    await act(async () => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.getByTestId("tv-sponsor-moment")).toHaveAttribute("data-sponsor", "sp2");
    expect(screen.queryByTestId("tv-slide-bar")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("#1124/#1125: ein Link nur mit Sponsor oder Zahlen, aber nichts davon da - ein ruhiger Satz statt leerer Fläche", async () => {
  serveAll({ bracket: BRACKET, sponsors: [{ id: "sp1", name: "Pixelwerk", logo_url: "/a.png" }] });
  const { unmount } = renderTv("/display/bracket/t1?key=k&playlist=sponsor&sponsor_moment=0");
  expect(await screen.findByTestId("tv-slide-empty")).toHaveTextContent("Sponsoren am TV sind ausgeschaltet");
  unmount();
  renderTv("/display/bracket/t1?key=k&playlist=stats");
  // Noch kein Spiel gespielt: keine Zahlen.
  expect(await screen.findByTestId("tv-slide-empty")).toHaveTextContent("Noch keine Zahlen zum Turnier");
});
