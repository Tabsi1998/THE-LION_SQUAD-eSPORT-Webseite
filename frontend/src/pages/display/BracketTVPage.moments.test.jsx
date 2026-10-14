import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { emitApiInvalidation, setStreamConnected } from "@/lib/apiInvalidation";
// TV-Bäume aus dem echten Generator, Planer, Umbau und den echten Routen (scripts/make_tv_bracket_fixture.py).
import TVG from "../../../e2e/fixtures/tvGenerated.json";

// Turnierbaum-TV (#1564): jedes Turnier-Ereignis hat seinen Moment - genau einmal. Nach einer Neuverbindung holt der TV
// den Stand ruhig nach (nichts fährt, nichts zoomt). „Bewegung reduzieren“: der Moment sagt es in Worten, nichts
// bewegt sich. Unten steht „Als Nächstes“ mit Prognose und Verzug und was gerade läuft, mit Spielzeit.

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
  expect(screen.getByTestId("tv-result-card")).toHaveTextContent("entschieden");
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
  current = state("se8_live");
  renderTv();
  await screen.findByTestId("tv-tree");
  act(() => setStreamConnected(false));
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
  const banner = screen.getByTestId("tv-live-banner");
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
  expect(screen.getByTestId("tv-live-banner")).toHaveTextContent("Auslosung");
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
