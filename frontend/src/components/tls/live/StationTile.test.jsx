import { fireEvent, render, screen, within } from "@testing-library/react";
import { StationTile, moveTargets, stationHolds, stationTone } from "./StationTile";
import { StationQueueBoard } from "./StationQueueBoard";

// Stations-Kachel (#1162): je Zustand Kennzeichen und Knöpfe - frei, aufgerufen, läuft, defekt. Namen sind erfunden.

const entry = (id, extra = {}) => ({
  match_id: id, match_key: id, label: "Viertelfinale", names: ["NeonFalke", "PixelPanther"], open_slots: 0, ready: true,
  state: "queued", position: 1, forecast_at: "2026-10-31T16:40:00Z", duration_minutes: 30, ...extra,
});
const free = { id: "st1", name: "1", station_text: "Station 1 · Switch 2", status: "free", running: null, next: entry("QF1"), after: null };
const called = { id: "st2", name: "2", station_text: "Station 2", status: "reserved", running: null, next: entry("QF2", { state: "called", called_at: "2026-10-31T16:18:00Z" }), after: null };
const running = { id: "st3", name: "3", station_text: "Station 3", status: "busy", running: entry("QF3", { state: "running", position: 0, started_at: "2026-10-31T16:00:00Z" }), next: null, after: null };
const brokenRunning = { ...running, id: "st4", station_text: "Station 4", status: "broken" };
const brokenEmpty = { id: "st5", name: "5", station_text: "Station 5", status: "broken", running: null, next: null, after: null };

function tile(station, props = {}) {
  const handlers = { onCall: vi.fn(), onStart: vi.fn(), onRelease: vi.fn(), onBroken: vi.fn(), onMove: vi.fn() };
  render(<StationTile station={station} canOperate targets={[free]} {...handlers} {...props} />);
  return handlers;
}

test("Zustand und was die Station hält", () => {
  expect([free, called, running, brokenRunning].map(stationTone)).toEqual(["free", "called", "running", "broken"]);
  expect(stationHolds(free)).toBeNull();
  expect(stationHolds(called).match_id).toBe("QF2");
  expect(stationHolds(brokenRunning).match_id).toBe("QF3");
});

test("frei: „Aufrufen“; Freigeben und Umlegen sind aus, „Defekt“ geht", () => {
  const handlers = tile(free);
  expect(screen.getByTestId("live-chip-st1")).toHaveTextContent("Frei");
  expect(screen.getByTestId("live-chip-st1")).toHaveAttribute("data-tone", "free");
  expect(screen.getByTestId("live-release-st1")).toBeDisabled();
  expect(screen.getByTestId("live-move-st1")).toBeDisabled();
  fireEvent.click(screen.getByTestId("live-call-st1"));
  expect(handlers.onCall).toHaveBeenCalledWith(expect.objectContaining({ id: "st1" }), expect.objectContaining({ match_id: "QF1" }));
  fireEvent.click(screen.getByTestId("live-broken-st1"));
  expect(handlers.onBroken).toHaveBeenCalledWith(expect.objectContaining({ id: "st1" }), true);
});

test("aufgerufen: „Starten“, „Freigeben“ nimmt den Aufruf zurück, „Umlegen“ zeigt die freien Stationen", () => {
  const handlers = tile(called);
  expect(screen.getByTestId("live-chip-st2")).toHaveAttribute("data-tone", "called");
  expect(screen.getByTestId("live-start-st2")).toHaveTextContent("Starten");
  fireEvent.click(screen.getByTestId("live-start-st2"));
  expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "st2" }), expect.objectContaining({ match_id: "QF2" }));
  fireEvent.click(screen.getByTestId("live-release-st2"));
  expect(handlers.onRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "st2" }), expect.objectContaining({ match_id: "QF2" }));
  fireEvent.click(screen.getByTestId("live-move-st2"));
  const picker = screen.getByTestId("live-move-picker-st2");
  expect(picker).toHaveTextContent("Aufruf an welche Station?");
  fireEvent.click(within(picker).getByTestId("live-move-to-st2-st1"));
  expect(handlers.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: "st2" }), expect.objectContaining({ match_id: "QF2" }), expect.objectContaining({ id: "st1" }));
  expect(screen.queryByTestId("live-move-picker-st2")).toBeNull();
});

test("läuft: „Freigeben“ fragt erst nach - das Ergebnis kommt danach", () => {
  const handlers = tile(running);
  expect(screen.getByTestId("live-chip-st3")).toHaveTextContent("Läuft");
  fireEvent.click(screen.getByTestId("live-release-st3"));
  expect(handlers.onRelease).not.toHaveBeenCalled();
  expect(screen.getByTestId("live-release-confirm-st3")).toHaveTextContent("Das Spiel läuft noch");
  fireEvent.click(screen.getByTestId("live-release-yes-st3"));
  expect(handlers.onRelease).toHaveBeenCalledWith(expect.objectContaining({ id: "st3" }), expect.objectContaining({ match_id: "QF3" }));
});

test("defekt mit laufendem Spiel: Hinweis auf „Umlegen“, „Bereit“ meldet sie wieder bereit; ohne freie Station steht es da", () => {
  const handlers = tile(brokenRunning, { targets: [] });
  expect(screen.getByTestId("live-chip-st4")).toHaveTextContent("Defekt");
  expect(screen.getByTestId("live-broken-hint-st4")).toHaveTextContent("Umlegen");
  fireEvent.click(screen.getByTestId("live-move-st4"));
  expect(screen.getByTestId("live-move-picker-st4")).toHaveTextContent("Gerade ist keine Station frei.");
  fireEvent.click(screen.getByTestId("live-broken-st4"));
  expect(handlers.onBroken).toHaveBeenCalledWith(expect.objectContaining({ id: "st4" }), false);
});

test("defekt mit Aufruf: kein „Starten“; defekt ohne Spiel: kein Hinweis", () => {
  tile({ ...called, id: "st6", status: "broken" });
  expect(screen.queryByTestId("live-start-st6")).toBeNull();
  expect(screen.getByTestId("live-broken-hint-st6")).toHaveTextContent("neu aufrufen");
  tile(brokenEmpty);
  expect(screen.queryByTestId("live-broken-hint-st5")).toBeNull();
  expect(screen.getByTestId("live-station-st5")).toHaveTextContent("Station ist defekt");
});

test("ohne Recht oder ohne Handler keine Knöpfe", () => {
  render(<StationTile station={called} canOperate={false} onCall={vi.fn()} onStart={vi.fn()} onRelease={vi.fn()} onBroken={vi.fn()} onMove={vi.fn()} />);
  expect(screen.queryByTestId("live-tools-st2")).toBeNull();
  expect(screen.queryByTestId("live-start-st2")).toBeNull();
});

test("Umlegen nur auf freie Stationen, die die Person bedienen darf", () => {
  const all = [free, called, running, brokenEmpty, { ...free, id: "st7" }, { ...free, id: "st8" }];
  expect(moveTargets(all, running).map((row) => row.id)).toEqual(["st1", "st7", "st8"]);
  expect(moveTargets(all, free).map((row) => row.id)).toEqual(["st7", "st8"]);
  expect(moveTargets(all, running, (row) => row.id !== "st7").map((row) => row.id)).toEqual(["st1", "st8"]);
});

test("schlimmster Fall: 20 Stationen, lange Namen, Lauf mit 8 Plätzen - alles da, keine Knöpfe ohne Handler", () => {
  const long = "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]";
  const stations = Array.from({ length: 20 }, (_, index) => ({
    id: `s${index}`, name: `${index + 1}`, station_text: `Station ${index + 1} · Übertragungsplatz mit sehr langem Gerätenamen`,
    status: index % 5 === 0 ? "broken" : "free", running: null, after: null,
    next: index % 2 ? entry(`H${index}`, { heat: true, label: "Runde 1", names: [long, "S2", "S3", "S4", "S5", "S6", "S7", "S8"] }) : null,
  }));
  render(<StationQueueBoard queue={{ applies: true, stations, operate: { all: true, station_ids: [] } }} onCall={vi.fn()} onStart={vi.fn()} />);
  expect(screen.getAllByTestId(/^live-station-/)).toHaveLength(20);
  expect(screen.getByTestId("live-next-s1")).toHaveTextContent(long);
  expect(screen.getByTestId("live-next-s1")).toHaveTextContent("+4");
  expect(screen.queryByTestId("live-tools-s1")).toBeNull();
});

test("geteilte Station, an der ein anderes Turnier spielt (#1162): kein Aufrufen, Defekt erst nach Rückfrage", () => {
  const shared = { id: "sx", name: "S", station_text: "Station S", status: "reserved", running: null, next: entry("QX"), after: null,
    hold_issue: { kind: "other", tournament_title: "Mario Kart Cup" } };
  const handlers = tile(shared);
  expect(stationTone(shared)).toBe("other");
  expect(screen.getByTestId("live-chip-sx")).toHaveTextContent("Anderes Turnier");
  expect(screen.getByTestId("live-other-hint-sx")).toHaveTextContent("Mario Kart Cup");
  expect(screen.queryByTestId("live-call-sx")).toBeNull();
  expect(screen.getByTestId("live-release-sx")).toBeDisabled();
  fireEvent.click(screen.getByTestId("live-broken-sx"));
  expect(handlers.onBroken).not.toHaveBeenCalled();
  expect(screen.getByTestId("live-broken-confirm-sx")).toHaveTextContent("Trotzdem als defekt melden?");
  fireEvent.click(screen.getByTestId("live-broken-yes-sx"));
  expect(handlers.onBroken).toHaveBeenCalledWith(expect.objectContaining({ id: "sx" }), true, { confirm_other: true });
});

test("hängende Station (#1162): „Hängt“ statt „Frei“, kein Aufrufen, „Station räumen“", () => {
  const onClear = vi.fn();
  const stuck = { id: "sh", name: "H", station_text: "Station H", status: "busy", running: null, next: entry("QH"), after: null, hold_issue: { kind: "stuck", tournament_title: null } };
  tile(stuck, { onClear });
  expect(stationTone(stuck)).toBe("stuck");
  expect(screen.getByTestId("live-chip-sh")).toHaveTextContent("Hängt");
  expect(screen.queryByTestId("live-call-sh")).toBeNull();
  fireEvent.click(screen.getByTestId("live-clear-sh"));
  expect(onClear).toHaveBeenCalledWith(expect.objectContaining({ id: "sh" }));
});
