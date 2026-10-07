import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
