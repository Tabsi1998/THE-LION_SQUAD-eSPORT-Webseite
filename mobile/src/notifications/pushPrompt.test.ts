import * as SecureStore from "expo-secure-store";
import {
  afterDashboard,
  afterOwnRegistration,
  dashboardRegistrationKeys,
  noteRegistrations,
  onPushPrompt,
  pushOffHintVisible,
  pushPromptKey,
  registrationKey,
  rememberOwnRegistration,
  shouldAskForPush,
} from "./pushPrompt";

// Erlaubnis im richtigen Moment (#1208): Anlass zu fragen ist eine neue Turnier- oder Event-Anmeldung - die eigene sofort,
// die des Teams beim nächsten Öffnen der Startseite. Der Merker liegt nur auf dem Gerät, je Konto.

const USER = "u-1208";
let offers: unknown[] = [];
let stop: () => void = () => {};

beforeEach(() => {
  offers = [];
  stop = onPushPrompt((request) => offers.push(request));
});

afterEach(() => stop());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("gefragt wird nur, solange Android noch nicht entschieden hat; der Hinweis nur nach einem Nein", () => {
  expect(shouldAskForPush({ status: "undetermined", canAskAgain: true })).toBe(true);
  expect(shouldAskForPush({ status: "granted", canAskAgain: true })).toBe(false);
  expect(shouldAskForPush({ status: "denied", canAskAgain: true })).toBe(false);
  expect(shouldAskForPush({ status: "unavailable", canAskAgain: false })).toBe(false);
  expect(shouldAskForPush(null)).toBe(false);
  expect(pushOffHintVisible({ status: "denied", canAskAgain: false })).toBe(true);
  expect(pushOffHintVisible({ status: "undetermined", canAskAgain: true })).toBe(false);
  expect(pushOffHintVisible({ status: "granted", canAskAgain: true })).toBe(false);
});

test("die Anmeldungen der Startseite: Turniere und Events, jede einmal", () => {
  expect(dashboardRegistrationKeys({ tournaments: [{ id: "t1" }, { id: "t1" }, { id: null }], events: [{ id: "e1" }] })).toEqual(["t:t1", "e:e1"]);
  expect(dashboardRegistrationKeys(null)).toEqual([]);
  expect(registrationKey("event", "")).toBeNull();
});

test("kein Dialog nach dem Login: die erste Startseite ist nur der Ausgangsstand", async () => {
  expect(await afterDashboard(USER, ["t:alt", "e:alt"])).toBe(false);
  expect(offers).toHaveLength(0);
  expect(JSON.parse((await SecureStore.getItemAsync(pushPromptKey(USER))) as string)).toEqual({ seen: ["t:alt", "e:alt"] });
});

test("Teammitglied: das Team wurde angemeldet - beim nächsten Öffnen kommt die Frage, danach nicht noch einmal", async () => {
  await afterDashboard(USER, ["t:alt"]);
  expect(await afterDashboard(USER, ["t:alt", "t:team-cup"])).toBe(true);
  expect(offers).toHaveLength(1);
  // „Später“ - beim nächsten Öffnen ohne neue Anmeldung keine Frage.
  expect(await afterDashboard(USER, ["t:alt", "t:team-cup"])).toBe(false);
  expect(offers).toHaveLength(1);
});

test("eigene Anmeldung: sofort der Anlass - und die Startseite zählt sie danach nicht noch einmal", async () => {
  await afterDashboard(USER, ["t:alt"]);
  afterOwnRegistration(USER, "t:neu");
  expect(offers).toHaveLength(1);
  await flush();
  expect(await afterDashboard(USER, ["t:alt", "t:neu"])).toBe(false);
  expect(offers).toHaveLength(1);
});

test("„Später“ fragt frühestens bei der nächsten Anmeldung wieder", async () => {
  await afterDashboard(USER, []);
  afterOwnRegistration(USER, "e:erstes");
  await flush();
  expect(offers).toHaveLength(1);
  // Später: weder Öffnen noch Startseite fragen erneut ...
  expect(await afterDashboard(USER, ["e:erstes"])).toBe(false);
  expect(offers).toHaveLength(1);
  // ... erst die nächste Anmeldung.
  afterOwnRegistration(USER, "t:zweites");
  expect(offers).toHaveLength(2);
});

test("eigene Anmeldung ohne Ausgangsstand: die nächste Startseite gilt als Ausgangsstand, alte Anmeldungen fragen nicht", async () => {
  await rememberOwnRegistration(USER, "t:neu");
  expect(await noteRegistrations(USER, ["t:neu", "t:alt", "e:alt"])).toBe(false);
  expect(await noteRegistrations(USER, ["t:neu", "t:alt", "e:alt", "t:team"])).toBe(true);
});

test("der Merker gehört dem Konto auf diesem Gerät - ein anderes Konto beginnt mit eigenem Ausgangsstand", async () => {
  await afterDashboard(USER, ["t:alt"]);
  expect(await afterDashboard("u-andere", ["t:alt", "t:x"])).toBe(false);
  expect(offers).toHaveLength(0);
});

test("ohne Konto und ohne Host passiert nichts", async () => {
  afterOwnRegistration(null, "t:x");
  expect(await afterDashboard(undefined, ["t:x"])).toBe(false);
  stop();
  afterOwnRegistration(USER, "t:y");
  expect(offers).toHaveLength(0);
});
