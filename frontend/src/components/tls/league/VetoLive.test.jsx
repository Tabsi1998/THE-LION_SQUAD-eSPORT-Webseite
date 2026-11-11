import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Map-Veto live (D.4, #1651): Karten mit Bild und Zustand, Countdown nach der Serverzeit mit ruhiger Betonung der letzten Sekunden,
// Ablauf-Leiste, reduzierte Bewegung und stabile Schlüssel (der kurze Abruf baut nichts neu auf, Fokus bleibt). Erfundene Namen.

const apiMock = { post: vi.fn(), get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (url) => url }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { VetoPanel } = await import("./VetoPanel");
const { VetoCountdown } = await import("./VetoLive");
const { ROLE_COLORS, SURFACE_COLORS, contrastRatio } = await import("@/lib/categoryColors");

const SIDES = ["Löwen · Rudel A", "Falken · Horst"];
const MAP = (map_id, name, extra = {}) => ({ map_id, name, image_url: `/uploads/maps/${map_id}.webp`, status: "open", by_name: null, side: null, position: null, ...extra });
const PLAN = [
  { index: 0, number: 1, kind: "ban", mode: "hp", mode_label: "Stellung", side: "A", name: SIDES[0], position: null, state: "done", map_id: "glut", map_name: "Glut", map_image_url: null, via: "side" },
  { index: 1, number: 2, kind: "ban", mode: "hp", mode_label: "Stellung", side: "B", name: SIDES[1], position: null, state: "current", map_id: null, map_name: null, map_image_url: null, via: null },
  { index: 2, number: 3, kind: "pick", mode: "hp", mode_label: "Stellung", side: "A", name: SIDES[0], position: 1, state: "open", map_id: null, map_name: null, map_image_url: null, via: null },
  { index: 3, number: 4, kind: "decider", mode: "ctl", mode_label: "Kontrolle", side: null, name: null, position: 2, state: "open", map_id: null, map_name: null, map_image_url: null, via: null },
];

function block(extra = {}, maps = {}) {
  const now = Date.now();
  return {
    status: "running", skipped_reason: null, version: 4, step_seconds: 60, server_now: new Date(now).toISOString(),
    team_a: { registration_id: "a", name: SIDES[0], via: "home" }, team_b: { registration_id: "b", name: SIDES[1] },
    current: { index: 1, number: 2, total: 4, kind: "ban", mode: "hp", mode_label: "Stellung", registration_id: "b", name: SIDES[1], position: null,
      deadline_at: new Date(now + 40000).toISOString(), remaining_seconds: 40 },
    own_turn: true, can_pick: true, own_side: "B", pick_hint: null,
    options: [{ map_id: "glut", name: "Glut", image_url: null, allowed: false, hint: "Glut ist in diesem Modus schon gesperrt oder gewählt." },
      { map_id: "hafen", name: "Hafen", image_url: null, allowed: true, hint: null }, { map_id: "turm", name: "Turm", image_url: null, allowed: true, hint: null }],
    remaining: [
      { mode: "hp", label: "Stellung", maps: [MAP("glut", "Glut", { status: "banned", side: "A", by_name: SIDES[0] }), MAP("hafen", "Hafen", maps.hafen), MAP("turm", "Turm", maps.turm)] },
      { mode: "ctl", label: "Kontrolle", maps: [MAP("kai", "Kai", { status: "preset", position: 3 }), MAP("ruine", "Ruine", maps.ruine)] },
    ],
    history: [{ index: 0, kind: "ban", mode_label: "Stellung", name: SIDES[0], map_name: "Glut", position: null, via: "side", at: "x" }],
    planned_games: [], paused: null, lead: null, presets: [], plan: PLAN, ...extra,
  };
}

const RUN = async (task) => { await task(); return true; };
const panel = (value, props = {}) => <VetoPanel block={value} matchId="m1" busy={false} run={RUN} onChanged={async () => {}} {...props} />;

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { version: 5, status: "running" } });
  delete window.matchMedia;
});

test("Karten: Bild, Zustand und Seite je Map - gesperrt mit Bann-Symbol und wer, Vorgabe fest, eigene Wahl antippbar", async () => {
  render(panel(block()));
  const glut = screen.getByTestId("veto-option-glut");
  expect(glut).toBeDisabled();
  expect(glut).toHaveAttribute("data-status", "banned");
  expect(glut).toHaveAttribute("data-tone", "a");
  expect(glut).toHaveAccessibleName("Glut: gesperrt von Löwen · Rudel A – Glut ist in diesem Modus schon gesperrt oder gewählt.");
  expect(glut.querySelector(".tls-veto-card__label")).toHaveTextContent("Gesperrt");
  expect(glut.querySelector("img")).toHaveAttribute("src", expect.stringContaining("glut"));
  expect(screen.getByTestId("veto-map-ctl-kai")).toHaveTextContent("Map 3 · Vorgabe der Woche");
  // Karten außerhalb des laufenden Modus sind keine Auswahl.
  const kai = screen.getByTestId("veto-map-ctl-kai").querySelector("button");
  expect(kai).toBeDisabled();
  expect(kai).not.toHaveAttribute("data-testid");
  const hafen = screen.getByTestId("veto-option-hafen");
  expect(hafen).toHaveAttribute("data-selectable", "true");
  expect(hafen).toHaveAccessibleName("Hafen: offen – antippen zum Sperren");
  fireEvent.click(hafen);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/veto/pick", { map_id: "hafen", version: 4 }));
  // Der Rahmen um den Modus des laufenden Zugs: einmal je Schritt, in der Farbe der Seite am Zug (B).
  expect(screen.getByTestId("veto-mode-hp").querySelector("[data-testid='veto-trace']")).toHaveAttribute("data-tone", "b");
  expect(screen.getByTestId("veto-mode-ctl").querySelector("[data-testid='veto-trace']")).toBeNull();
});

test("gewählt, Decider und Vorgabe tragen Position und Seite; Zuschauer sehen alles, antippen können sie nichts", () => {
  const value = block({ own_turn: false, can_pick: false, own_side: null, options: [] },
    { hafen: { status: "picked", side: "B", by_name: SIDES[1], position: 1 }, ruine: { status: "decider", position: 2 } });
  render(panel(value, { readOnly: true }));
  const hafen = screen.getByTestId("veto-map-hp-hafen").querySelector("button");
  expect(hafen).toHaveAttribute("data-tone", "b");
  expect(hafen.querySelector(".tls-veto-card__label")).toHaveTextContent("Map 1");
  expect(hafen).toHaveTextContent("Map 1 · Falken · Horst");
  expect(screen.getByTestId("veto-map-ctl-ruine")).toHaveTextContent("Decider · Map 2");
  expect(screen.getByTestId("veto-panel")).toHaveAttribute("data-read-only", "true");
  expect(screen.queryByTestId("veto-own")).toBeNull();
  expect(screen.queryByTestId("veto-lead")).toBeNull();
  expect(document.querySelectorAll("[data-testid^='veto-option-']")).toHaveLength(0);
  expect([...document.querySelectorAll(".tls-veto-card--live")].every((card) => card.disabled)).toBe(true);
});

test("Pause bei Zuschauern: ohne Grund kein leeres „Pausiert – “, sondern ihr Hinweis; die Seiten sehen den Grund", () => {
  const hint = "Das Veto ist pausiert – die Liga-Leitung setzt es fort.";
  const paused = block({ status: "paused", own_turn: false, can_pick: false, own_side: null, options: [], pick_hint: hint,
    current: { ...block().current, deadline_at: null, remaining_seconds: 21 }, paused: { at: "x", reason: null, remaining_seconds: 21 } });
  const { rerender } = render(panel(paused, { readOnly: true }));
  expect(screen.getByTestId("veto-paused")).toHaveTextContent(hint);
  expect(screen.getByTestId("veto-paused").textContent).not.toMatch(/Pausiert –\s*$/);
  expect(screen.getByTestId("veto-countdown-text")).toHaveTextContent("0:21");
  // Ohne Satz vom Server: derselbe Hinweis aus der Seite.
  rerender(panel({ ...paused, pick_hint: null }, { readOnly: true }));
  expect(screen.getByTestId("veto-paused")).toHaveTextContent(hint);
  // Die Seiten: Grund wie bisher.
  rerender(panel({ ...paused, paused: { ...paused.paused, reason: "Störung bei einem Team" } }));
  expect(screen.getByTestId("veto-paused")).toHaveTextContent("Pausiert – Störung bei einem Team");
});

test("Countdown nach der Serverzeit: das Gerät geht 10 Minuten nach - es zählt trotzdem 40 Sekunden", () => {
  const device = Date.now();
  const server = device + 10 * 60 * 1000;
  const value = block({ server_now: new Date(server).toISOString(), current: { ...block().current, deadline_at: new Date(server + 40000).toISOString() } });
  render(panel(value));
  expect(screen.getByTestId("veto-countdown-text").textContent).toMatch(/^0:(40|39)$/);
  // Gegenprobe ohne Serverzeit: die Uhr des Geräts - über zehn Minuten.
  const { unmount } = render(<VetoCountdown block={value} offset={0} />);
  expect(screen.getAllByTestId("veto-countdown-text")[1].textContent).toMatch(/^10:(40|39)$/);
  unmount();
});

test("die letzten zehn Sekunden: rot und - nur ohne „Bewegung reduzieren“ - ruhig atmend; angesagt bei 30, 10, 5", () => {
  vi.useFakeTimers();
  const start = Date.now();
  const value = block({ current: { ...block().current, deadline_at: new Date(start + 35000).toISOString() } });
  render(panel(value));
  const clock = screen.getByTestId("veto-countdown");
  expect(clock).toHaveAttribute("data-urgent", "false");
  expect(clock).toHaveAttribute("data-tone", "b");
  expect(screen.getByTestId("veto-countdown-caption")).toHaveTextContent("noch");
  expect(screen.getByTestId("veto-countdown-announce")).toHaveTextContent("");
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.getByTestId("veto-countdown-announce")).toHaveTextContent("Noch 30 Sekunden.");
  act(() => { vi.advanceTimersByTime(20000); });
  expect(clock).toHaveAttribute("data-urgent", "true");
  expect(clock).toHaveAttribute("data-tone", "urgent");
  // Nicht nur Rot (Review): Sanduhr und „gleich vorbei“ stehen da - auch ohne Farbe und ohne Bewegung lesbar.
  expect(screen.getByTestId("veto-countdown-caption")).toHaveTextContent("gleich vorbei");
  expect(screen.getByTestId("veto-countdown-caption").querySelector("svg")).not.toBeNull();
  expect(screen.getByTestId("veto-countdown-announce")).toHaveTextContent("Noch 10 Sekunden.");
  act(() => { vi.advanceTimersByTime(10000); });
  expect(screen.getByTestId("veto-countdown-text")).toHaveTextContent("0:00");
  expect(screen.getByTestId("veto-countdown-caption")).toHaveTextContent("Zeit um");
  expect(screen.getByTestId("veto-countdown-announce")).toHaveTextContent("Zeit abgelaufen – das System wählt.");
  vi.useRealTimers();
  // Die Regeln: Atmen nur über opacity, mit „Bewegung reduzieren“ abgeschaltet.
  const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8").replace(/\r\n/g, "\n");
  expect(css).toContain("@keyframes tls-veto-breathe { 50% { opacity: 0.55; } }");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .tls-veto-clock"));
  expect(reduced.slice(0, reduced.indexOf("}\n}") + 1)).toContain(".tls-veto-clock[data-urgent=\"true\"] .tls-veto-clock__arc { animation: none; }");
});

test("Teamfarben: A blau, B orange - keine Status-Farbe, nicht Event-Violett, lesbar auf dem dunklen Grund und als Schild", () => {
  const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8").replace(/\r\n/g, "\n");
  const live = css.slice(css.indexOf("/* Map-Veto live (D.4, #1651)"), css.indexOf("/* Bestätigungs-Blatt der Anmeldung"));
  const toneOf = (tone) => {
    const lead = `[data-tone="${tone}"] { --tls-veto-rgb: var(--tls-`;
    const at = live.indexOf(lead);
    return at < 0 ? null : live.slice(at + lead.length, live.indexOf("-rgb)", at));
  };
  expect(toneOf("a")).toBe("brand");
  expect(toneOf("b")).toBe("veto-b");
  // Team B ist weder Achtung (warn), noch läuft (live), noch Ehre/Decider (honor), noch frei (ok), noch die Art „Event“ (Violett).
  expect(["warn", "live", "honor", "ok", "event"]).not.toContain(toneOf("b"));
  const tv = readFileSync(path.join(process.cwd(), "src/components/tv/tv.css"), "utf8");
  expect(tv).toContain('.tv-veto__turn[data-tone="b"] .tv-veto__who { color: rgb(var(--tls-veto-b-rgb)); }');
  // Das Orange steht als eigenes Token in styles/system.css und hebt sich sichtbar von jeder Rolle ab (ein Kanal mind. 40 weg).
  const system = readFileSync(path.join(process.cwd(), "src/styles/system.css"), "utf8");
  const match = system.match(/--tls-veto-b-rgb: (\d+) (\d+) (\d+);/);
  expect(match).not.toBeNull();
  const channels = match.slice(1).map(Number);
  const teamB = `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  for (const role of ["warn", "live", "honor", "ok", "event", "brand"]) {
    const other = [1, 3, 5].map((index) => parseInt(ROLE_COLORS[role].slice(index, index + 2), 16));
    expect(Math.max(...channels.map((value, index) => Math.abs(value - other[index]))), `Team B gegen ${role}`).toBeGreaterThanOrEqual(40);
  }
  // Kontrast: Schrift in der Farbe auf dem Grund und dunkle Schrift auf dem Schild (mind. 4,5 : 1).
  expect(contrastRatio(teamB, SURFACE_COLORS.base)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio("#050505", teamB)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(ROLE_COLORS.live, SURFACE_COLORS.base)).toBeGreaterThanOrEqual(4.5);
});

test("Ablauf-Leiste: Schritte mit Art, Seite und Modus - fertige zeigen die Map, der laufende ist markiert", () => {
  render(panel(block()));
  const steps = screen.getByTestId("veto-timeline").children;
  expect(steps).toHaveLength(4);
  expect(screen.getByTestId("veto-step-0")).toHaveAttribute("data-state", "done");
  expect(screen.getByTestId("veto-step-0")).toHaveTextContent("Glut");
  expect(screen.getByTestId("veto-step-0")).toHaveAttribute("data-tone", "a");
  expect(screen.getByTestId("veto-step-1")).toHaveAttribute("aria-current", "step");
  expect(screen.getByTestId("veto-step-1")).toHaveAccessibleName("Schritt 2 von 4: Falken · Horst sperrt eine Map (Stellung) – läuft");
  expect(screen.getByTestId("veto-step-3")).toHaveTextContent("System");
  expect(screen.getByTestId("veto-step-3")).toHaveTextContent("Decider · Map 2");
  expect(screen.getByTestId("veto-step-3")).not.toHaveAttribute("aria-current");
});

test("stabile Schlüssel: ein neuer Abruf mit gleichem Stand baut nichts neu auf, spielt nichts ab und lässt den Fokus stehen", () => {
  const { rerender } = render(panel(block()));
  const hafen = screen.getByTestId("veto-option-hafen");
  const step = screen.getByTestId("veto-step-1");
  hafen.focus();
  expect(document.activeElement).toBe(hafen);
  rerender(panel(block()));
  expect(screen.getByTestId("veto-option-hafen")).toBe(hafen);
  expect(screen.getByTestId("veto-step-1")).toBe(step);
  expect(document.activeElement).toBe(hafen);
  expect(document.querySelectorAll(".tls-veto-card__flash")).toHaveLength(0);
  // Der Rahmen des laufenden Zugs bleibt dasselbe Element, solange der Schritt derselbe ist.
  const trace = screen.getByTestId("veto-trace");
  rerender(panel(block()));
  expect(screen.getByTestId("veto-trace")).toBe(trace);
});

test("Aufleuchten: die Aktion der Gegenseite und jede Wahl leuchten einmal - die eigene Sperre nicht, Nachfragen spielt nichts neu ab", () => {
  const { rerender } = render(panel(block({ own_side: "A", own_turn: false, can_pick: false })));
  expect(document.querySelectorAll(".tls-veto-card__flash")).toHaveLength(0);
  // Die Gegenseite (B) sperrt Hafen.
  const theirs = block({ own_side: "A", own_turn: false, can_pick: false }, { hafen: { status: "banned", side: "B", by_name: SIDES[1] } });
  rerender(panel(theirs));
  const flash = screen.getByTestId("veto-flash-hafen");
  expect(flash).toHaveClass("tls-veto-card__flash");
  // Gleicher Stand noch einmal: dasselbe Element, kein neuer Schein.
  rerender(panel({ ...theirs, server_now: new Date().toISOString() }));
  expect(screen.getByTestId("veto-flash-hafen")).toBe(flash);
  expect(document.querySelectorAll(".tls-veto-card__flash")).toHaveLength(1);
  // Die eigene Seite (A) sperrt Turm: dimmt nur.
  rerender(panel(block({ own_side: "A" }, { hafen: { status: "banned", side: "B" }, turm: { status: "banned", side: "A" } })));
  expect(screen.queryByTestId("veto-flash-turm")).toBeNull();
  // Eine Wahl leuchtet immer.
  rerender(panel(block({ own_side: "A" }, { hafen: { status: "banned", side: "B" }, turm: { status: "banned", side: "A" }, ruine: { status: "picked", side: "A", position: 1 } })));
  expect(screen.getByTestId("veto-flash-ruine")).toBeInTheDocument();
});

test("reduzierte Bewegung: der Ring läuft ohne Bild-Schleife, Aufbau, Schein und Rahmen hängen an den Bewegungs-Regeln", () => {
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const frame = vi.spyOn(window, "requestAnimationFrame");
  render(panel(block()));
  expect(frame).not.toHaveBeenCalled();
  frame.mockRestore();
  delete window.matchMedia;
  const css = readFileSync(path.join(process.cwd(), "src/index.css"), "utf8").replace(/\r\n/g, "\n");
  const live = css.slice(css.indexOf("/* Map-Veto live (D.4, #1651)"), css.indexOf("/* Bestätigungs-Blatt der Anmeldung"));
  // Keyframes nur mit transform und opacity.
  const frames = [...live.matchAll(/@keyframes [a-z-]+ \{([^@]*?)\}\s*\}?/g)].map((hit) => hit[1]).join(" ");
  const animated = [...frames.matchAll(/([a-z-]+):/g)].map((hit) => hit[1]);
  expect([...new Set(animated)].sort()).toEqual(["opacity", "transform"]);
  // Übergänge nur über translate, scale und opacity.
  const transitions = [...live.matchAll(/transition: ([^;]+);/g)].flatMap((hit) => hit[1].split(",").map((part) => part.trim().split(" ")[0]));
  expect([...new Set(transitions)].sort()).toEqual(["opacity", "scale", "translate"]);
  // Wege hängen am Schalter --tls-motion-on, Dauern an den Bewegungs-Variablen.
  expect(live).toContain("translate: 0 calc(3px * var(--tls-motion-on)); scale: calc(1 - 0.03 * var(--tls-motion-on));");
  expect(live).toContain("translate: 0 calc(-4px * var(--tls-motion-on));");
  expect(live).toContain("animation-delay: calc(360ms * var(--tls-motion-on));");
  expect(live).toContain("animation: tls-veto-preset-glow var(--tls-motion-glow) var(--tls-ease) backwards;");
  // Anheben nur mit echtem Zeiger (am Handy kein klebendes Hover).
  expect(live).toContain("@media (hover: hover) and (pointer: fine) {\n  .tls-veto-card--live[data-selectable=\"true\"]:hover");
});
