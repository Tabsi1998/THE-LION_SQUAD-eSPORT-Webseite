import { act, configure, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { emitApiInvalidation, setStreamConnected } from "@/lib/apiInvalidation";
// TV-Bäume aus dem echten Generator, Planer, Umbau und den echten Routen (scripts/make_tv_bracket_fixture.py).
import TVG from "../../../e2e/fixtures/tvGenerated.json";

// Turnierbaum-TV (#1564): jedes Turnier-Ereignis hat seinen Moment - genau einmal. Nach einer Neuverbindung holt der TV
// den Stand ruhig nach (nichts fährt, nichts zoomt). „Bewegung reduzieren“: der Moment sagt es in Worten, nichts
// bewegt sich. Unten steht „Als Nächstes“ mit Prognose und Verzug und was gerade läuft, mit Spielzeit.

// Unter Last (ganzer Lauf parallel) braucht das Nachladen mit Entprellung länger als die üblichen 1 s.
configure({ asyncUtilTimeout: 3000 });

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <span data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("@/components/tls/Logo", () => ({ MascotBadge: () => <span data-testid="mascot" /> }));

const BracketTVPage = (await import("./BracketTVPage")).default;

const state = (name) => structuredClone(TVG[name]);
const idOf = (bracket, key) => bracket.matches_v2.find((match) => match.match_key === key).id;
let current = null;

function serve() {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/tv/settings") return { data: { settings: {} } };
    if (url.startsWith("/tournaments/")) return { data: current };
    return { data: [] };
  });
}

function renderTv(query = "") {
  const id = current.tournament.id;
  return render(
    <MemoryRouter initialEntries={[`/display/bracket/${id}?key=k&playlist=tree${query}`]}>
      <Routes>
        <Route path="/display/bracket/:id" element={<BracketTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Der Server meldet eine Änderung - der TV lädt neu (wie über den Änderungsstrom). */
async function change(name) {
  current = state(name);
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
  });
}

const main = () => screen.getByTestId("tv-main");

/** Eine Ersatz-Abfrage ohne Strom: der TV fragt im Takt nach (15 s) - ohne Meldung aus dem Strom. */
async function poll(name) {
  current = state(name);
  await act(async () => { vi.advanceTimersByTime(15000); });
}

beforeEach(() => {
  apiMock.get.mockReset();
  serve();
  setStreamConnected(true);
});

afterEach(() => {
  setStreamConnected(false);
  vi.useRealTimers();
});

test("ein Ergebnis: der Ergebnis-Moment kommt - der Sieger fährt danach entlang der Linie", async () => {
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  expect(main()).not.toHaveAttribute("data-moment");
  await change("se8_after_a");
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  expect(await screen.findByTestId("tv-result-card")).toHaveTextContent("entschieden");
});

test("korrigiert: das geänderte Ergebnis eines entschiedenen Spiels sagt „korrigiert“", async () => {
  current = state("se8_after_a");
  renderTv();
  await screen.findByTestId("tv-tree");
  await change("se8_corrected");
  const card = await screen.findByTestId("tv-result-card");
  expect(card).toHaveAttribute("data-match", idOf(current, "A"));
  expect(card).toHaveTextContent("Korrigiert");
});

test("kampflos: der Ergebnis-Moment sagt „kampflos“", async () => {
  current = state("se8_corrected");
  renderTv();
  await screen.findByTestId("tv-tree");
  await change("se8_walkover");
  const card = await screen.findByTestId("tv-result-card");
  expect(card).toHaveTextContent("kampflos");
});

test("nach einer Neuverbindung holt der TV den Stand ruhig nach - kein Moment, nichts wird nachgeholt", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  act(() => setStreamConnected(false));
  // Eine echte Unterbrechung: während der Trennung läuft eine Ersatz-Abfrage (alle 15 s), noch ohne Neues.
  await act(async () => { vi.advanceTimersByTime(15000); });
  current = state("se8_after_a");
  // Zurück: useLiveRefresh lädt einmal nach - das ist der Stand von „dazwischen“.
  act(() => setStreamConnected(true));
  const winner = state("se8_after_a").matches_v2.find((match) => match.match_key === "A").results.find((row) => row.rank === 1).registration_id;
  await waitFor(() => expect(screen.getByTestId(`tv-match-${idOf(current, "E")}`).querySelector(`[data-tv-reg='${winner}']`)).not.toBeNull());
  expect(main()).not.toHaveAttribute("data-moment");
  expect(screen.queryByTestId("tv-result-card")).not.toBeInTheDocument();
  // Danach wieder mit Moment.
  await change("se8_corrected");
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
});

test("Läufe zusammengelegt: eigener Moment, die frei gewordenen Stationen leuchten kurz im Banner", async () => {
  current = state("ffa8_before_merge");
  renderTv();
  await screen.findByTestId("tv-tree");
  await change("ffa8_after_merge");
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "merge"));
  // Den Banner setzt die Bühne im Effekt nach dem Moment (TvBracketStage) - einen Takt später als `data-moment` (#1614).
  const banner = await screen.findByTestId("tv-live-banner");
  expect(banner).toHaveTextContent("Läufe zusammengelegt");
  expect(screen.getByTestId("tv-freed")).toHaveTextContent("Switch 3 und Switch 4 sind frei");
});

test("„Bewegung reduzieren“: der Moment sagt es in Worten, aber nichts fährt - die Namen stehen sofort im Sammellauf", async () => {
  current = state("ffa8_before_merge");
  renderTv("&reduce_motion=1");
  await screen.findByTestId("tv-tree");
  await change("ffa8_after_merge");
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "merge"));
  expect(screen.queryAllByTestId("tv-rider")).toHaveLength(0);
  const merged = current.matches_v2.find((match) => match.match_key === "A");
  const card = screen.getByTestId(`tv-match-${merged.id}`);
  expect(card.querySelectorAll("[data-tv-reg]")).toHaveLength(4);
  expect(card.querySelector(".tv-row--draw")).toBeNull();
});

test("Auslosung: ein Moment, die Namen kommen nacheinander in die Läufe", async () => {
  const after = state("ffa16");
  const before = structuredClone(after);
  for (const match of before.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
  current = before;
  renderTv();
  await screen.findByTestId("tv-tree");
  current = after;
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
  });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "draw"));
  // Wackelte unter Last (#1614): `data-moment` setzt die Seite sofort, den Banner die Bühne erst im Effekt danach.
  expect(await screen.findByTestId("tv-live-banner")).toHaveTextContent("Auslosung");
  await waitFor(() => expect(document.querySelectorAll(".tv-row--draw").length).toBe(16));
});

test("„Als Nächstes“ unten: Prognose mit Station und Verzug, dazu was läuft - mit Spielzeit", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  current = state("se8_live");
  const live = current.matches_v2.find((match) => match.match_key === "A");
  vi.setSystemTime(new Date(Date.parse(live.started_at) + 40 * 60000 + 5000));
  renderTv();
  const next = await screen.findByTestId("tv-next-up");
  expect(next).toHaveTextContent("Als Nächstes");
  // B war gleichzeitig mit A geplant, ist aber noch nicht gestartet: jetzt, mit 40 Minuten Verzug.
  expect(next).toHaveTextContent(/Spiel B/);
  expect(next).toHaveTextContent(/ca\. \d{2}:\d{2} · Switch 2/);
  expect(next).toHaveTextContent("40 Min. Verzug");
  const now = screen.getByTestId("tv-now-playing");
  expect(now).toHaveTextContent("Spiel A");
  expect(now).toHaveTextContent("Switch 1");
  expect(now).toHaveTextContent(/40:0\d/);
});

test("Aufruf-Tafel ohne Aufrufe: „Als Nächstes geplant“ mit derselben Prognose und dem Verzug", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  current = state("se8_live");
  const live = current.matches_v2.find((match) => match.match_key === "A");
  vi.setSystemTime(new Date(Date.parse(live.started_at) + 40 * 60000 + 5000));
  const id = current.tournament.id;
  render(
    <MemoryRouter initialEntries={[`/display/bracket/${id}?key=k&playlist=calls`]}>
      <Routes>
        <Route path="/display/bracket/:id" element={<BracketTVPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const upcoming = await screen.findByTestId("tv-calls-upcoming");
  const first = upcoming.querySelector(`[data-testid='tv-call-next-${idOf(current, "B")}']`);
  expect(first).toHaveTextContent("Danach an Switch 2");
  expect(first).toHaveTextContent(/ca\. \d{2}:\d{2}/);
  expect(first).toHaveTextContent("40 Min. Verzug");
  // Rundenname aus dem Server wie im Baum.
  expect(first).toHaveTextContent("Viertelfinale");
});

test("überall dieselbe Zeit: Karte und Fuß nennen dieselbe Prognose, die Folgespiele rücken nach", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  current = state("se8_live");
  const live = current.matches_v2.find((match) => match.match_key === "A");
  vi.setSystemTime(new Date(Date.parse(live.started_at) + 40 * 60000 + 5000));
  renderTv();
  const next = await screen.findByTestId("tv-next-up");
  const time = /ca\. (\d{2}:\d{2})/.exec(next.textContent)[1];
  const card = screen.getByTestId(`tv-match-${idOf(current, "B")}`);
  expect(card.querySelector(".tv-node__status")).toHaveTextContent(`ca. ${time}`);
  // Klein dabei, um wie viel es später wird - statt der alten Planzeit.
  expect(card.querySelector(".tv-node__late")).toHaveTextContent("+40 Min.");
  expect(card).not.toHaveTextContent("geplant ca.");
  // Das Halbfinale E (nach A, B und C) rückt ebenfalls nach.
  const semi = screen.getByTestId(`tv-match-${idOf(current, "E")}`);
  expect(semi.querySelector(".tv-node__late")).toHaveTextContent(/^\+\d+ Min\.$/);
});

test("solange der Strom getrennt ist, lädt der TV ruhig nach (Ersatz-Abfrage) - keine Bewegungs-Salve, auch nicht beim Wiederverbinden", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  act(() => setStreamConnected(false));
  // Getrennt: der TV fragt im Takt nach - jeder Stand kommt ohne Moment.
  await poll("se8_after_a");
  await waitFor(() => expect(screen.getByTestId(`tv-match-${idOf(state("se8_after_a"), "A")}`)).toHaveTextContent("Beendet"));
  expect(main()).not.toHaveAttribute("data-moment");
  await poll("se8_corrected");
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  expect(main()).not.toHaveAttribute("data-moment");
  expect(screen.queryByTestId("tv-result-card")).not.toBeInTheDocument();
  // Wieder verbunden: der Nachlade-Stand bleibt ruhig ...
  current = state("se8_walkover");
  act(() => setStreamConnected(true));
  await waitFor(() => expect(screen.getByTestId(`tv-match-${current.matches_v2.find((match) => match.status === "forfeit").id}`)).toHaveAttribute("data-walkover", "1"));
  expect(main()).not.toHaveAttribute("data-moment");
});

test("eine Änderung kommt über den Strom, der danach kurz neu verbindet (wie EventSource nach jedem Ende): der Moment kommt", async () => {
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  current = state("se8_after_a");
  // Die Meldung kommt, gleich danach endet der Strom und verbindet neu - die Abfrage startet, während er getrennt ist.
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
    setStreamConnected(false);
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    setStreamConnected(true);
  });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
});

// ---------------------------------------------------------------- Codex-Nachprüfung: überlappende Abfragen
function deferredBrackets() {
  const pending = [];
  apiMock.get.mockImplementation((url) => {
    if (url === "/tv/settings") return Promise.resolve({ data: { settings: {} } });
    // Die Live-Warteschlange (#1634) ist keine Baum-Abfrage - hier ohne Warteschlange.
    if (url.endsWith("/live-queue")) return Promise.resolve({ data: { applies: false } });
    if (url.startsWith("/tournaments/")) {
      if (!pending.length && current) {
        // Erste Abfrage beim Laden: sofort.
        const data = current;
        current = null;
        return Promise.resolve({ data });
      }
      return new Promise((resolve) => pending.push(resolve));
    }
    return Promise.resolve({ data: [] });
  });
  return pending;
}

async function trigger() {
  await act(async () => {
    emitApiInvalidation({ resource: "matches" });
    await new Promise((resolve) => { setTimeout(resolve, 220); });
  });
}

test("zwei überlappende Abfragen, die Antworten vertauscht: der ältere Stand überschreibt den neueren nicht", async () => {
  current = state("se8_live");
  const id = current.tournament.id;
  const pending = deferredBrackets();
  renderTv();
  await screen.findByTestId("tv-tree");
  await trigger();
  await trigger();
  expect(pending).toHaveLength(2);
  const newer = state("se8_after_a");
  const gameA = () => screen.getByTestId(`tv-match-${idOf(newer, "A")}`);
  await act(async () => { pending[1]({ data: newer }); });
  // Der neue Stand ist da (A entschieden, der Ergebnis-Moment läuft).
  await waitFor(() => expect(gameA()).toHaveTextContent("Beendet"));
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  // Die ältere Antwort kommt zu spät - sie wird verworfen: A bleibt entschieden, kein zweiter Moment für „live“.
  await act(async () => { pending[0]({ data: state("se8_live") }); });
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  expect(gameA()).toHaveTextContent("Beendet");
  expect(gameA()).not.toHaveAttribute("data-live");
  expect(id).toBeTruthy();
});

/** Echte Unterbrechung (Ersatz-Abfrage im Takt), Neuverbinden mit Nachhol-Abfrage, dann eine echte Meldung aus dem Strom. */
async function outageThenReconnectWithMessage(pending) {
  act(() => setStreamConnected(false));
  await act(async () => { vi.advanceTimersByTime(15000); });
  await act(async () => { pending.shift()({ data: state("se8_live") }); });
  await act(async () => {
    setStreamConnected(true);
    await new Promise((resolve) => { setTimeout(resolve, 220); });
  });
  // Während die Nachhol-Abfrage noch aussteht, meldet der Strom eine neue Änderung.
  await trigger();
  expect(pending).toHaveLength(2);
}

test("Nachhol-Abfrage aussteht, eine neue Meldung kommt, deren Antwort zuerst: ihr Moment erscheint, die alte Antwort wird verworfen", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  current = state("se8_live");
  const pending = deferredBrackets();
  renderTv();
  await screen.findByTestId("tv-tree");
  await outageThenReconnectWithMessage(pending);
  await act(async () => { pending[1]({ data: state("se8_after_a") }); });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  // Die Nachhol-Abfrage kommt danach mit einem älteren Stand: verworfen - nichts springt zurück.
  await act(async () => { pending[0]({ data: state("se8_live") }); });
  await new Promise((resolve) => { setTimeout(resolve, 100); });
  expect(screen.getByTestId(`tv-match-${idOf(state("se8_after_a"), "A")}`)).toHaveTextContent("Beendet");
});

test("Nachhol-Abfrage aussteht, eine neue Meldung kommt, die Nachhol-Antwort zuerst: Verpasstes still, der neue Moment erscheint", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  current = state("se8_live");
  const pending = deferredBrackets();
  renderTv();
  await screen.findByTestId("tv-tree");
  await outageThenReconnectWithMessage(pending);
  // Verpasst: A wurde während der Unterbrechung entschieden - still.
  await act(async () => { pending[0]({ data: state("se8_after_a") }); });
  await waitFor(() => expect(screen.getByTestId(`tv-match-${idOf(state("se8_after_a"), "A")}`)).toHaveTextContent("Beendet"));
  expect(main()).not.toHaveAttribute("data-moment");
  // Neu gemeldet: das Ergebnis von A wurde korrigiert - dieser Moment kommt.
  await act(async () => { pending[1]({ data: state("se8_corrected") }); });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  expect(await screen.findByTestId("tv-result-card")).toHaveTextContent("Korrigiert");
});

test("kurzes Neuverbinden des Stroms (wenige 100 ms, z. B. Server oder Proxy) ist keine Unterbrechung - der Moment kommt", async () => {
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  // Der Strom endet und steht 300 ms später wieder - so verhält sich EventSource bei jedem Neuverbinden.
  act(() => setStreamConnected(false));
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 300); }); });
  act(() => setStreamConnected(true));
  await change("se8_after_a");
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
});

test("kurzes Neuverbinden, und die Abfrage danach bringt schon das neue Ergebnis (Meldung kommt gleich hinterher): der Moment kommt trotzdem", async () => {
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  act(() => setStreamConnected(false));
  // Das Ergebnis ist schon gespeichert, bevor der Strom wieder steht - die Abfrage nach dem Neuverbinden holt es.
  current = state("se8_after_a");
  await act(async () => {
    setStreamConnected(true);
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
});

test("Nachhol-Antwort und Meldungs-Antwort im selben Render-Durchgang: nur der neue Moment, nichts Verpasstes", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  current = state("se8_live");
  const pending = deferredBrackets();
  renderTv();
  await screen.findByTestId("tv-tree");
  await outageThenReconnectWithMessage(pending);
  // Beide Antworten kommen zusammen an: verpasst (A entschieden) und neu gemeldet (A korrigiert).
  await act(async () => {
    pending[0]({ data: state("se8_after_a") });
    pending[1]({ data: state("se8_corrected") });
  });
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  // Der Moment ist die Korrektur - nicht das verpasste „entschieden“.
  expect(await screen.findByTestId("tv-result-card")).toHaveTextContent("Korrigiert");
});

// ---------------------------------------------------------------- #1634: Show-Auslosung bereit und sofort zufällig
/** Die Zielspiele der Gruppe WB:2 im Modus `mode`, auf Wunsch „bereit“ (Marker wie am Server). */
function withMode(bracket, mode, { ready = false } = {}) {
  for (const match of bracket.matches_v2) {
    if (match.settings?.draw_group !== "WB:2") continue;
    match.settings = { ...match.settings, advancement_mode: mode };
    if (ready) match.draw_ready = { group: "WB:2", since: "2026-10-31T15:00:00+00:00", pot_size: 4 };
  }
  return bracket;
}

/** Sofort zufällig: ein Platz von E ist gezogen (Los-Kennung und Herkunft aus dem echten gemischten Stand). */
function oneAssigned() {
  const after = withMode(state("se8_mixed_before_draw"), "instant");
  const drawn = state("se8_mixed_drawn").matches_v2.find((match) => match.match_key === "E").slots[0];
  const target = after.matches_v2.find((match) => match.match_key === "E");
  target.slots[0] = { ...target.slots[0], registration_id: drawn.registration_id, status: "filled", source_result: drawn.source_result };
  return { after, registrationId: drawn.registration_id };
}

/** Der letzte Lauf der Runde (D) ist entschieden, der Topf steht - die Zielspiele noch leer, mit Marker „bereit“. */
function roundReady() {
  const ready = withMode(state("se8_mixed_drawn"), "draw_show", { ready: true });
  const empty = state("se8_mixed_before_draw");
  ready.matches_v2 = ready.matches_v2.map((match) => (match.settings?.draw_group === "WB:2"
    ? { ...empty.matches_v2.find((row) => row.id === match.id), settings: match.settings, draw_ready: match.draw_ready }
    : match));
  return ready;
}

async function push(bracket) {
  current = bracket;
  await act(async () => {
    emitApiInvalidation({ resource: "tournaments" });
  });
}

const regName = (bracket, registrationId) => {
  const reg = bracket.registrations.find((row) => row.id === registrationId);
  return reg?.display_name || reg?.user?.display_name || reg?.ingame_name || "";
};

test("Show-Auslosung bereit: eigener Moment, die Zielspiele leuchten, der Hinweis bleibt stehen, bis gelost ist", async () => {
  current = withMode(state("se8_mixed_before_draw"), "draw_show");
  renderTv();
  await screen.findByTestId("tv-tree");
  expect(screen.queryByTestId("tv-live-banner")).not.toBeInTheDocument();
  // Das Ergebnis des letzten Laufs macht die Runde fertig: erst der Ergebnis-Moment, dann „Auslosung bereit“.
  await push(roundReady());
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "result"));
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "draw_ready"), { timeout: 8000 });
  // Den Banner setzt die Bühne im Effekt nach dem Moment (#1614) - darauf warten.
  const banner = await screen.findByTestId("tv-live-banner");
  expect(banner).toHaveAttribute("data-kind", "ready");
  expect(banner).toHaveTextContent("Auslosung bereit · 4 Namen");
  const target = screen.getByTestId(`tv-match-${idOf(current, "E")}`);
  expect(target).toHaveAttribute("data-ready", "1");
  expect(target).toHaveTextContent("Auslosung bereit");
  // Nach dem Moment steht der Hinweis weiter da - dasselbe Element, es kommt nicht noch einmal herein.
  await waitFor(() => expect(main()).not.toHaveAttribute("data-moment"), { timeout: 6000 });
  expect(screen.getByTestId("tv-live-banner")).toBe(banner);
  expect(banner).toHaveTextContent("Auslosung bereit · 4 Namen");
  // Gelost: der Hinweis geht, die Auslosung kommt als eigener Moment, nichts leuchtet mehr.
  await push(withMode(state("se8_mixed_drawn"), "draw_show"));
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "draw"));
  await waitFor(() => expect(screen.getByTestId("tv-live-banner")).toHaveTextContent(/^Auslosung · /));
  expect(screen.getByTestId(`tv-match-${idOf(current, "E")}`)).not.toHaveAttribute("data-ready");
}, 25000);

test("beim ersten Laden ist eine bereite Show-Auslosung gleich als Hinweis da - ohne Moment", async () => {
  current = roundReady();
  renderTv();
  await screen.findByTestId("tv-tree");
  const banner = await screen.findByTestId("tv-live-banner");
  expect(banner).toHaveAttribute("data-kind", "ready");
  expect(main()).not.toHaveAttribute("data-moment");
});

test("sofort zufällig: ein Name landet auf seinem gezogenen Platz - kurzer eigener Moment, keine Auslosung der Runde", async () => {
  current = withMode(state("se8_mixed_before_draw"), "instant");
  renderTv();
  await screen.findByTestId("tv-tree");
  const { after, registrationId } = oneAssigned();
  await push(after);
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "draw_assigned"));
  const banner = await screen.findByTestId("tv-live-banner");
  expect(banner).toHaveTextContent(/^Zufällig gezogen · /);
  expect(banner).toHaveTextContent(regName(after, registrationId));
  // Der Name steht auf seinem Platz (die Zeile gleitet herein) - und der Moment ist kurz.
  const target = screen.getByTestId(`tv-match-${idOf(after, "E")}`);
  await waitFor(() => expect(target.querySelector(`[data-tv-reg='${registrationId}']`)).not.toBeNull());
  await waitFor(() => expect(main()).not.toHaveAttribute("data-moment"), { timeout: 5000 });
}, 15000);

test("sofort zufällig mit „Bewegung reduzieren“: der Name steht sofort da, nichts gleitet", async () => {
  current = withMode(state("se8_mixed_before_draw"), "instant");
  renderTv("&reduce_motion=1");
  await screen.findByTestId("tv-tree");
  const { after, registrationId } = oneAssigned();
  await push(after);
  await waitFor(() => expect(main()).toHaveAttribute("data-moment", "draw_assigned"));
  await screen.findByTestId("tv-live-banner");
  const row = screen.getByTestId(`tv-match-${idOf(after, "E")}`).querySelector(`[data-tv-reg='${registrationId}']`);
  expect(row).not.toBeNull();
  expect(row.className).not.toContain("tv-row--draw");
});
