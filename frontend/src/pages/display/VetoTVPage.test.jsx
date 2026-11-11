import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Map-Veto am TV (#1651): ein laufendes Liga-Spiel für 1920 px - großer Countdown, wer am Zug ist, Brett und Ablauf; nur lesend, immer
// die Zuschauer-Sicht (`display=1`), mit Anzeige-Schlüssel des Turniers. Erfundene Namen.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

const VetoTVPage = (await import("./VetoTVPage")).default;

const SIDES = ["Löwen · Rudel A", "Falken · Horst"];
function live(extra = {}) {
  const now = Date.now();
  return {
    veto: {
      status: "running", version: 3, step_seconds: 60, server_now: new Date(now).toISOString(), own_turn: false, can_pick: false, own_side: null,
      team_a: { registration_id: "a", name: SIDES[0], via: "home" }, team_b: { registration_id: "b", name: SIDES[1] },
      current: { index: 1, number: 2, total: 3, kind: "ban", mode: "hp", mode_label: "Stellung", registration_id: "b", name: SIDES[1], position: null,
        deadline_at: new Date(now + 42000).toISOString(), remaining_seconds: 42 },
      options: [], lead: null, start: null, blocked: null, paused: null, presets: [], planned_games: [],
      remaining: [{ mode: "hp", label: "Stellung", maps: [
        { map_id: "glut", name: "Glut", image_url: "/uploads/maps/glut.webp", status: "banned", side: "A", by_name: SIDES[0], position: null },
        { map_id: "hafen", name: "Hafen", image_url: "/uploads/maps/hafen.webp", status: "open", side: null, by_name: null, position: null }] }],
      history: [{ index: 0, kind: "ban", mode_label: "Stellung", name: SIDES[0], map_name: "Glut", position: null, via: "side", at: "x" }],
      plan: [
        { index: 0, number: 1, kind: "ban", mode: "hp", mode_label: "Stellung", side: "A", name: SIDES[0], position: null, state: "done", map_id: "glut", map_name: "Glut", map_image_url: null, via: "side" },
        { index: 1, number: 2, kind: "ban", mode: "hp", mode_label: "Stellung", side: "B", name: SIDES[1], position: null, state: "current", map_id: null, map_name: null, map_image_url: null, via: null },
        { index: 2, number: 3, kind: "decider", mode: "hp", mode_label: "Stellung", side: null, name: null, position: 1, state: "open", map_id: null, map_name: null, map_image_url: null, via: null },
      ],
      ...extra,
    },
    now: new Date(now).toISOString(), state: null,
    match: { id: "m1", tournament_title: "Probe-Liga · Staffel A", matchday_label: "Spieltag 2", sides: SIDES },
  };
}

function serve(answer) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/matches/m1/veto") {
      if (answer instanceof Error) throw answer;
      return { data: answer };
    }
    return { data: {} };
  });
}

function renderTv(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display/veto/:matchId" element={<VetoTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMock.get.mockReset();
});

test("laufendes Veto: Teams im Kopf, großer Countdown, wer am Zug ist, Brett und Ablauf - nur lesend, mit dem Schlüssel gefragt", async () => {
  serve(live());
  renderTv("/display/veto/m1?key=nur-anschauen");
  expect(await screen.findByTestId("veto-tv-grid")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/veto", { params: { display: 1, key: "nur-anschauen" } });
  expect(screen.getByTestId("tv-header")).toHaveTextContent("Löwen · Rudel A vs Falken · Horst");
  expect(screen.getByTestId("tv-header")).toHaveTextContent("Probe-Liga · Staffel A · Spieltag 2");
  expect(screen.getByTestId("veto-tv-state")).toHaveTextContent("Veto läuft");
  expect(screen.getByTestId("veto-tv-turn")).toHaveAttribute("data-tone", "b");
  expect(screen.getByTestId("veto-tv-who")).toHaveTextContent("Falken · Horst");
  expect(screen.getByTestId("veto-tv-turn")).toHaveTextContent("sperrt eine Map · Stellung");
  expect(screen.getByTestId("veto-countdown-text").textContent).toMatch(/^0:4[12]$/);
  expect(screen.getByTestId("veto-map-hp-glut")).toHaveTextContent("gesperrt von Löwen · Rudel A");
  expect(screen.getByTestId("veto-step-1")).toHaveAttribute("aria-current", "step");
  // Nur lesend: keine Karte ist antippbar.
  expect([...document.querySelectorAll(".tls-veto-card--live")].every((card) => card.disabled)).toBe(true);
  // Der QR-Code führt zur Matchseite - nie mit dem Schlüssel.
  const qr = screen.getByTestId("branded-qr-code").getAttribute("data-value");
  expect(qr).toContain("/matches/m1");
  expect(qr).not.toContain("nur-anschauen");
});

test("fertig: die Spielreihenfolge als große Karten; ohne Veto ein klarer Satz; ungültiger Schlüssel zeigt nichts vom Inhalt", async () => {
  serve(live({ status: "done", current: null, planned_games: [
    { position: 1, mode: "hp", mode_label: "Stellung", map_id: "hafen", map_name: "Hafen", map_image_url: null, role: "decider", by_registration_id: null }],
  plan: live().veto.plan.map((row) => ({ ...row, state: "done", map_name: row.map_name || "Hafen" })) }));
  const { unmount } = renderTv("/display/veto/m1");
  expect(await screen.findByTestId("veto-tv-planned")).toHaveTextContent("Map 1 · Decider");
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/veto", { params: { display: 1 } });
  expect(screen.queryByTestId("veto-countdown")).toBeNull();
  unmount();

  serve({ veto: null, now: new Date().toISOString(), state: null, match: null });
  const none = renderTv("/display/veto/m1");
  expect(await screen.findByTestId("veto-tv-none")).toHaveTextContent("In diesem Spiel gibt es kein Map-Veto");
  none.unmount();

  const refused = Object.assign(new Error("403"), { response: { status: 403 } });
  serve(refused);
  renderTv("/display/veto/m1?key=alt");
  expect(await screen.findByTestId("tv-key-refused")).toBeInTheDocument();
  expect(screen.queryByTestId("veto-tv-grid")).toBeNull();
});

test("Reihenfolge: eine ältere Antwort, die eine neuere überholt, ändert am TV nichts", async () => {
  const newer = live();
  const older = live({ version: 2, server_now: new Date(Date.now() - 5000).toISOString(),
    current: { ...newer.veto.current, index: 0, number: 1, registration_id: "a", name: SIDES[0] },
    plan: newer.veto.plan.map((row) => ({ ...row, state: row.index === 0 ? "current" : "open", map_name: null })) });
  const answers = [newer, older];
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url === "/matches/m1/veto") return { data: answers.shift() || newer };
    return { data: {} };
  });
  renderTv("/display/veto/m1");
  expect(await screen.findByTestId("veto-tv-who")).toHaveTextContent("Falken · Horst");
  // Der nächste Abruf (hier: Tab wieder sichtbar) bringt die ältere Antwort.
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(answers).toHaveLength(0));
  expect(screen.getByTestId("veto-tv-who")).toHaveTextContent("Falken · Horst");
  expect(screen.getByTestId("veto-step-1")).toHaveAttribute("aria-current", "step");
  expect(screen.getByTestId("veto-step-0")).toHaveTextContent("Glut");
});
