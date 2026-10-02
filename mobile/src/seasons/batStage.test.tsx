import React from "react";
import { Text, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Fledermaus-Leben auf der Bühne (A2): nach dem Verscheuchen kommt eine Fledermaus im Anflug von außerhalb zu einem
// freien Platz zurück und landet mit Einfedern und leichter Haptik; eine unruhige zieht nach der Ruhe mit Start am
// Platz und Bogen zu einem anderen Platz um; Flüge tragen ihre Art; nichts fliegt zu Plätzen außerhalb des Bilds.

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light", Medium: "medium" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@react-navigation/native", () => ({ NavigationRouteContext: require("react").createContext({ name: "Dashboard" }), NavigationContext: require("react").createContext(undefined) }));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { HalloweenCorners } = require("./halloween");
const { Card } = require("../components/Card");
const perches = require("./perches");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");
const { hashString, mulberry32 } = require("./rng");

function season() {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective: "normal", channels: ["app"], texts: {}, data: { night: false } };
}

/** Karten mit Plätzen, deren Messung fest ist (im Test misst nichts) - unten eine außerhalb des Bilds. */
function Page({ ids, timeScale }: { ids: string[]; timeScale: number }) {
  return (
    <View>
      <HalloweenCorners season={season() as never} screen="Dashboard" timeScale={timeScale} />
      {ids.map((id) => <Card key={id} perch={id}><Text>{id}</Text></Card>)}
    </View>
  );
}

function fixMeasurements(rects: Record<string, { x: number; y: number; width: number; height: number } | null>) {
  perches.perchesFor("Dashboard").forEach((perch: { id: string; measure: () => Promise<unknown> }) => {
    if (perch.id in rects) perches.registerPerch({ ...perch, measure: async () => rects[perch.id] });
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  perches.resetPerches();
  flights.resetFlights();
  quiet.resetQuiet();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
  (Haptics.impactAsync as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => motion.resetMotionScheduler(null));

test("Verscheuchen, Abwesenheit, Anflug von außerhalb, Landung mit leichter Haptik auf einem freien sichtbaren Platz", async () => {
  // Nur zwei Plätze, beide im Bild: nach dem Verscheuchen ist erst wieder etwas frei, wenn der geräumte Platz zurückkommt.
  await render(<Page ids={["a", "b"]} timeScale={100} />);
  await act(async () => {
    jest.advanceTimersByTime(10);
  });
  fixMeasurements({ a: { x: 20, y: 200, width: 320, height: 120 }, b: { x: 20, y: 400, width: 320, height: 120 } });
  const initial = screen.getAllByTestId("halloween-bat-perched");
  expect(initial.length).toBe(2);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  // Antippen: Flucht als Flug der Art „flee“, der Platz ist leer.
  await fireEvent.press(initial[0]);
  await act(async () => {
    await Promise.resolve();
  });
  expect(flights.activeFlights().map((flight: { kind: string }) => flight.kind)).toEqual(["flee"]);
  expect(Haptics.impactAsync).toHaveBeenLastCalledWith("medium");
  expect(screen.getAllByTestId("halloween-bat-perched").length).toBe(1);
  // Abwesenheit (20–90 s, hier hundertfach schneller) - dann der Anflug: ein Flug der Art „approach“ mit Landeplatz.
  await act(async () => {
    jest.advanceTimersByTime(1200);
    await Promise.resolve();
    jest.advanceTimersByTime(60);
    await Promise.resolve();
  });
  const flying = screen.queryAllByTestId("halloween-bat-flying");
  const approach = flights.activeFlights().find((flight: { kind: string }) => flight.kind === "approach");
  expect(approach).toBeTruthy();
  expect(["a", "b"]).toContain(approach.landOn.perchId);
  expect(approach.path.p0.x < 0 || approach.path.p0.x > 750).toBe(true);
  expect(flying.length).toBeGreaterThanOrEqual(1);
  // Landung: der Platz ist wieder besetzt, Einfedern mit leichter Haptik.
  await act(async () => {
    jest.advanceTimersByTime(approach.durationMs + 20);
    await Promise.resolve();
  });
  expect(flights.activeFlights().filter((flight: { kind: string }) => flight.kind === "approach").length).toBe(0);
  expect(screen.getAllByTestId("halloween-bat-perched").length).toBe(2);
  expect(perches.perchSnapshot().assignments[approach.landOn.perchId].landed).toBe(true);
  expect(Haptics.impactAsync).toHaveBeenLastCalledWith("light");
});

test("Umzug: eine unruhige Fledermaus startet am Platz und fliegt im Bogen zu einem anderen freien Platz", async () => {
  await render(<Page ids={["r1", "r2", "r3"]} timeScale={1} />);
  await act(async () => {
    jest.advanceTimersByTime(10);
  });
  fixMeasurements({ r1: { x: 20, y: 200, width: 320, height: 120 }, r2: { x: 20, y: 400, width: 320, height: 120 }, r3: { x: 20, y: 600, width: 320, height: 120 } });
  const assigned = Object.keys(perches.perchSnapshot().assignments);
  expect(assigned.length).toBe(2);
  const free = ["r1", "r2", "r3"].find((id) => !assigned.includes(id)) as string;
  // Direkt einen Umzug anstoßen (wie es der Ruhe-Zeitgeber der Fledermaus tut): Bogen, Art „hop“, Landeplatz = der freie.
  await act(async () => {
    flights.requestHop({ perchId: assigned[0], screen: "Dashboard", from: { x: 100, y: 200 }, size: 20, temperament: "roamer" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  const hop = flights.activeFlights().find((flight: { kind: string }) => flight.kind === "hop");
  expect(hop).toBeTruthy();
  expect(hop.landOn.perchId).toBe(free);
  expect(hop.path.p1.y).toBeLessThan(200);
  expect(perches.perchSnapshot().assignments[assigned[0]]).toBeUndefined();
  await act(async () => {
    jest.advanceTimersByTime(hop.durationMs + 20);
    await Promise.resolve();
  });
  expect(perches.perchSnapshot().assignments[free].landed).toBe(true);
  expect(screen.getAllByTestId("halloween-bat-perched").length).toBe(2);
});

test("Ruhe-Zeitgeber: nach der Ruhe hebt eine Unruhige ab und meldet den Umzug; Schläfrige bleiben", async () => {
  const roaming = ["hop-1", "hop-2", "hop-3", "hop-4", "hop-5", "hop-6"].find((id) => {
    const rng = mulberry32(hashString(`life:${id}:roamer`));
    rng();
    rng();
    return rng() < 0.85;
  }) as string;
  const requests: unknown[] = [];
  const stop = flights.subscribeHops((request: unknown) => requests.push(request));
  await render(<Card perch={roaming}><Text>Karte</Text></Card>);
  fixMeasurements({ [roaming]: { x: 20, y: 200, width: 320, height: 120 } });
  await act(async () => {
    perches.assign([{ perchId: roaming, corner: "tl", pose: "sit", size: 20, temperament: "roamer" }]);
  });
  await act(async () => {
    jest.advanceTimersByTime(700);
  });
  const bat = screen.getByTestId(`season-perch-bat-${roaming}`);
  expect(bat.props["data-phase"]).toBe("perched");
  // Ruhe bis 150 s, dann Start (0,45 s), dann die Meldung an die Bühne.
  await act(async () => {
    jest.advanceTimersByTime(151000);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
    await Promise.resolve();
  });
  expect(requests.length).toBe(1);
  expect((requests[0] as { perchId: string }).perchId).toBe(roaming);
  stop();
  perches.resetPerches();
  await screen.unmount();
  await render(<Card perch="sleepy-1"><Text>Karte</Text></Card>);
  await act(async () => {
    perches.assign([{ perchId: "sleepy-1", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }]);
  });
  const stop2 = flights.subscribeHops((request: unknown) => requests.push(request));
  await act(async () => {
    jest.advanceTimersByTime(500000);
    await Promise.resolve();
  });
  expect(requests.length).toBeLessThanOrEqual(2);
  stop2();
});
