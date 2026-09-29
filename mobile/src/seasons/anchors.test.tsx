import React from "react";
import { Text, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Anker (A1): eine Karte mit `perch` meldet sich als Platz, zeigt die zugeteilte Fledermaus (sitzend oder hängend),
// Antippen startet einen Flug in Fensterkoordinaten und räumt den Platz; Dialoge verdecken und sperren.

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light", Medium: "medium" } }));
jest.mock("@react-navigation/native", () => ({ NavigationRouteContext: require("react").createContext({ name: "NewsList" }) }));

const { Card } = require("../components/Card");
const { SeasonPerch, useSeasonOverlay } = require("./anchors");
const perches = require("./perches");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");

beforeEach(() => {
  perches.resetPerches();
  flights.resetFlights();
  quiet.resetQuiet();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
});

afterAll(() => motion.resetMotionScheduler(null));

test("Karte mit Platz: meldet sich an, zeigt die zugeteilte Fledermaus, Antippen fliegt und räumt", async () => {
  await render(<Card perch="news-1"><Text>Beitrag</Text></Card>);
  expect(perches.perchesFor("NewsList").map((entry: { id: string }) => entry.id)).toEqual(["news-1"]);
  expect(screen.queryByTestId("halloween-bat-perched")).toBeNull();
  await act(async () => {
    perches.assign([{ perchId: "news-1", corner: "tr", pose: "sit", size: 20, temperament: "curious" }]);
  });
  expect(screen.getByTestId("halloween-bat-perched")).toBeTruthy();
  // Messen gibt es im Test nicht: der Platz wird mit einer festen Messung neu angemeldet.
  const registered = perches.perchesFor("NewsList")[0];
  perches.registerPerch({ ...registered, measure: async () => ({ x: 20, y: 300, width: 320, height: 140 }) });
  await fireEvent.press(screen.getByTestId("halloween-bat-perched"));
  await act(async () => {
    await Promise.resolve();
  });
  const active = flights.activeFlights();
  expect(active.length).toBe(1);
  expect(active[0].perchId).toBe("news-1");
  expect(active[0].screen).toBe("NewsList");
  expect(active[0].from.x).toBe(20 + 320 - 22);
  expect(active[0].path.p0).toEqual(active[0].from);
  expect(perches.perchSnapshot().assignments).toEqual({});
  await screen.unmount();
  expect(perches.perchesFor("NewsList")).toEqual([]);
});

function Sheet({ open }: { open: boolean }) {
  useSeasonOverlay("sheet", open);
  return <View />;
}

function Page({ open }: { open: boolean }) {
  return (
    <View>
      <Card perch="news-2" perchKind="banner"><Text>Banner</Text></Card>
      <Sheet open={open} />
    </View>
  );
}

test("hängend unter der Unterkante; offene Dialoge verdecken die Figur und sperren den Planer", async () => {
  await render(<Page open={false} />);
  await act(async () => {
    perches.assign([{ perchId: "news-2", corner: "bottom", pose: "hang", size: 22, temperament: "sleepy" }]);
  });
  expect(screen.getByTestId("halloween-bat-perched")).toBeTruthy();
  await screen.rerender(<Page open />);
  expect(screen.queryByTestId("halloween-bat-perched")).toBeNull();
  expect(quiet.anyOverlayOpen()).toBe(true);
  expect(motion.getMotionScheduler().request("rappel")).toBeNull();
  expect(motion.getMotionScheduler().lastReason()).toBe("hidden");
  await screen.rerender(<Page open={false} />);
  expect(quiet.anyOverlayOpen()).toBe(false);
  expect(screen.getByTestId("halloween-bat-perched")).toBeTruthy();
  expect(motion.getMotionScheduler().request("rappel")).not.toBeNull();
});

test("ohne perch bleibt die Karte, wie sie war", async () => {
  await render(<Card testID="plain"><Text>Nur Inhalt</Text></Card>);
  expect(screen.getByTestId("plain")).toBeTruthy();
  expect(perches.perchSnapshot().perches).toEqual([]);
  expect(screen.queryByTestId(/season-perch/)).toBeNull();
  expect(SeasonPerch).toBeDefined();
});

test("Ecknetz (A4): eine Karte ohne Fledermaus bekommt ein kleines, nicht klickbares Netz - links oder rechts oben; ein Dialog blendet es aus", async () => {
  await render(<Card perch="web-1"><Text>Karte</Text></Card>);
  expect(screen.queryByTestId("halloween-corner-web")).toBeNull();
  await act(async () => {
    perches.assignWebs([{ perchId: "web-1", side: "tr", seed: 0.42, radius: 26 }]);
  });
  const web = screen.getByTestId("halloween-corner-web");
  expect(web.props["data-side"]).toBe("tr");
  expect(web.props.pointerEvents).toBe("none");
  expect(web.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ right: 0 })]));
  await act(async () => {
    quiet.setOverlay("dialog", true);
  });
  expect(screen.queryByTestId("halloween-corner-web")).toBeNull();
  await act(async () => {
    quiet.setOverlay("dialog", false);
  });
  expect(screen.getByTestId("halloween-corner-web")).toBeTruthy();
  const chosen = perches.chooseWebPerches(perches.perchesFor("NewsList"), 2, () => 0.3, []);
  expect(chosen.length).toBe(1);
  expect(chosen[0].perchId).toBe("web-1");
  expect(perches.chooseWebPerches(perches.perchesFor("NewsList"), 2, () => 0.3, ["web-1"])).toEqual([]);
});

