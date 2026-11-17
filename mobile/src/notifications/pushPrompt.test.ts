import {
  PUSH_PROMPT_MAX_KEYS,
  afterDashboard,
  afterOwnRegistration,
  dashboardRegistrationKeys,
  dashboardTeamKeys,
  forgetPushPromptAccounts,
  isPushAsked,
  markPushAsked,
  noteRegistrations,
  notePushUpgrade,
  onPushPrompt,
  pushOffHintVisible,
  registrationKey,
  rememberOwnRegistration,
  shouldAskForPush,
} from "./pushPrompt";
import { readPromptState, resetPromptStateForTests } from "./pushPromptStore";
import type { PushPermission } from "./PushService";

// Erlaubnis im richtigen Moment (#1208): Anlass zu fragen ist eine neue Turnier- oder Event-Anmeldung - die eigene sofort,
// die des Teams beim nächsten Öffnen der Startseite. Der Merker liegt nur auf dem Gerät, je Konto; dazu „schon gefragt“,
// weil Android 13 vor der ersten Frage „denied“ meldet.

const USER = "u-1208";
let offers: { reason?: string }[] = [];
let stop: () => void = () => {};

const me = (tournaments: { id: string; team?: boolean }[] = [], events: string[] = []) => ({
  tournaments: tournaments.map(({ id, team }) => ({ id, my_registration: { team_id: team ? "team-1" : null } })),
  events: events.map((id) => ({ id })),
});

beforeEach(() => {
  resetPromptStateForTests(null);
  offers = [];
  stop = onPushPrompt((request) => offers.push({ reason: request.reason }));
});

afterEach(() => stop());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const p = (status: PushPermission["status"], canAskAgain: boolean): PushPermission => ({ status, canAskAgain });

describe("fragen oder Hinweis", () => {
  test("Android 13 vor der ersten Frage („denied“, Android fragt noch, App hat nie gefragt): fragen, kein Hinweis", () => {
    expect(shouldAskForPush(p("denied", true), false)).toBe(true);
    expect(pushOffHintVisible(p("denied", true), false)).toBe(false);
  });

  test("schon gefragt und Nein: Hinweis, keine Frage", () => {
    expect(shouldAskForPush(p("denied", true), true)).toBe(false);
    expect(pushOffHintVisible(p("denied", true), true)).toBe(true);
  });

  test("Android lässt nicht mehr fragen: Hinweis, auch ohne Merker", () => {
    expect(shouldAskForPush(p("denied", false), false)).toBe(false);
    expect(pushOffHintVisible(p("denied", false), false)).toBe(true);
  });

  test("noch nicht entschieden: fragen; erlaubt oder ohne Push: weder noch", () => {
    expect(shouldAskForPush(p("undetermined", true), false)).toBe(true);
    for (const asked of [false, true]) {
      expect(shouldAskForPush(p("granted", true), asked)).toBe(false);
      expect(pushOffHintVisible(p("granted", true), asked)).toBe(false);
      expect(shouldAskForPush(p("unavailable", false), asked)).toBe(false);
      expect(pushOffHintVisible(p("unavailable", false), asked)).toBe(false);
    }
    expect(shouldAskForPush(null, false)).toBe(false);
  });

  test("„Ja, rufen“ merkt sich „gefragt“", async () => {
    expect(await isPushAsked()).toBe(false);
    await markPushAsked();
    expect(await isPushAsked()).toBe(true);
  });
});

describe("Bestandsgeräte nach dem Update", () => {
  test("mit gespeicherter Sitzung und ohne Erlaubnis: gilt als gefragt - Hinweis statt neuer Erklärung", async () => {
    await notePushUpgrade(true, async () => p("denied", true));
    expect(await isPushAsked()).toBe(true);
  });

  test("mit Sitzung und Erlaubnis, ohne Sitzung oder im Emulator: nichts gemerkt", async () => {
    await notePushUpgrade(true, async () => p("granted", true));
    expect(await isPushAsked()).toBe(false);
    resetPromptStateForTests(null);
    await notePushUpgrade(false, async () => p("denied", true));
    expect(await isPushAsked()).toBe(false);
    resetPromptStateForTests(null);
    await notePushUpgrade(true, async () => p("unavailable", false));
    expect(await isPushAsked()).toBe(false);
  });

  test("nur beim ersten Start: ein späterer Start mit Sitzung ohne Erlaubnis gilt nicht als gefragt", async () => {
    await notePushUpgrade(false, async () => p("denied", true));
    await notePushUpgrade(true, async () => p("denied", true));
    expect(await isPushAsked()).toBe(false);
    expect((await readPromptState()).migrated).toBe(true);
  });
});

test("die Anmeldungen der Startseite: Turniere und Events, jede einmal; Team-Anmeldungen erkannt", () => {
  const data = me([{ id: "t1" }, { id: "t1" }, { id: "t2", team: true }], ["e1"]);
  expect(dashboardRegistrationKeys(data)).toEqual(["t:t1", "t:t2", "e:e1"]);
  expect(dashboardTeamKeys(data)).toEqual(["t:t2"]);
  expect(dashboardRegistrationKeys(null)).toEqual([]);
  expect(registrationKey("event", "")).toBeNull();
});

test("kein Dialog nach dem Login: die erste Startseite ist nur der Ausgangsstand", async () => {
  expect(await afterDashboard(USER, me([{ id: "alt" }], ["alt"]))).toBeNull();
  expect(offers).toHaveLength(0);
  expect((await readPromptState()).users[USER]).toEqual({ seen: ["t:alt", "e:alt"] });
});

test("Teammitglied: das Team wurde angemeldet - beim nächsten Öffnen die Frage mit Anlass „Team“, danach nicht noch einmal", async () => {
  await afterDashboard(USER, me([{ id: "alt" }]));
  expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "team-cup", team: true }]))).toBe("team");
  expect(offers).toEqual([{ reason: "team" }]);
  // „Später“ - beim nächsten Öffnen ohne neue Anmeldung keine Frage.
  expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "team-cup", team: true }]))).toBeNull();
  expect(offers).toHaveLength(1);
});

test("auf der Website selbst angemeldet: Anlass „eigene Anmeldung“", async () => {
  await afterDashboard(USER, me([{ id: "alt" }]));
  expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "web-cup" }]))).toBe("own");
});

test("eigene Anmeldung: sofort der Anlass - und die Startseite zählt sie danach nicht noch einmal", async () => {
  await afterDashboard(USER, me([{ id: "alt" }]));
  afterOwnRegistration(USER, "t:neu");
  expect(offers).toEqual([{ reason: "own" }]);
  await flush();
  expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "neu" }]))).toBeNull();
  expect(offers).toHaveLength(1);
});

test("„Später“ fragt frühestens bei der nächsten Anmeldung wieder", async () => {
  await afterDashboard(USER, me());
  afterOwnRegistration(USER, "e:erstes");
  await flush();
  expect(await afterDashboard(USER, me([], ["erstes"]))).toBeNull();
  expect(offers).toHaveLength(1);
  afterOwnRegistration(USER, "t:zweites");
  expect(offers).toHaveLength(2);
});

test("eigene Anmeldung ohne Ausgangsstand: die nächste Startseite gilt als Ausgangsstand", async () => {
  await rememberOwnRegistration(USER, "t:neu");
  expect(await noteRegistrations(USER, ["t:neu", "t:alt", "e:alt"])).toBeNull();
  expect(await noteRegistrations(USER, ["t:neu", "t:alt", "e:alt", "t:team"], ["t:team"])).toBe("team");
});

test("Abmelden: die Merker der Konten gehen - nach dem nächsten Login ist die Startseite wieder Ausgangsstand", async () => {
  await afterDashboard(USER, me([{ id: "alt" }]));
  await markPushAsked();
  await forgetPushPromptAccounts();
  // Inzwischen kam eine Anmeldung dazu - trotzdem keine Frage gleich nach dem Login.
  expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "neu", team: true }]))).toBeNull();
  expect(offers).toHaveLength(0);
  // „Schon gefragt“ gehört dem Gerät und bleibt.
  expect(await isPushAsked()).toBe(true);
});

test("der Merker gehört dem Konto - ein anderes Konto beginnt mit eigenem Ausgangsstand", async () => {
  await afterDashboard(USER, me([{ id: "alt" }]));
  expect(await afterDashboard("u-andere", me([{ id: "alt" }, { id: "x" }]))).toBeNull();
  expect(offers).toHaveLength(0);
});

test("höchstens die neuesten Anmeldungen bleiben gemerkt - der Merker bleibt klein", async () => {
  const many = Array.from({ length: PUSH_PROMPT_MAX_KEYS + 20 }, (_, index) => `t:${index}`);
  await noteRegistrations(USER, many);
  const seen = (await readPromptState()).users[USER].seen;
  expect(seen).toHaveLength(PUSH_PROMPT_MAX_KEYS);
  expect(seen.at(-1)).toBe(`t:${PUSH_PROMPT_MAX_KEYS + 19}`);
  expect(JSON.stringify(await readPromptState()).length).toBeLessThan(2500);
});

test("ohne Konto und ohne Host passiert nichts", async () => {
  afterOwnRegistration(null, "t:x");
  expect(await afterDashboard(undefined, me([{ id: "x" }]))).toBeNull();
  stop();
  afterOwnRegistration(USER, "t:y");
  expect(offers).toHaveLength(0);
});

describe("Speicher auf dem Gerät", () => {
  function fakeFs({ failWrite = false } = {}) {
    const files = new Map<string, string>();
    return {
      files,
      fs: {
        documentDirectory: "file:///daten/",
        getInfoAsync: async (uri: string) => ({ exists: files.has(uri) }),
        readAsStringAsync: async (uri: string) => files.get(uri) as string,
        writeAsStringAsync: async (uri: string, text: string) => {
          if (failWrite) throw new Error("voll");
          files.set(uri, text);
        },
      },
    };
  }

  test("bleibt über den Neustart", async () => {
    const { fs, files } = fakeFs();
    resetPromptStateForTests(fs);
    await afterDashboard(USER, me([{ id: "alt" }]));
    await markPushAsked();
    expect(JSON.parse(files.get("file:///daten/push-prompt.json") as string)).toEqual(expect.objectContaining({ asked: true, users: { [USER]: { seen: ["t:alt"] } } }));
    // Neustart: Arbeitsspeicher leer, die Datei bleibt.
    resetPromptStateForTests(fs);
    expect(await isPushAsked()).toBe(true);
    expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "team", team: true }]))).toBe("team");
  });

  test("Schreiben scheitert: nicht bei jedem Öffnen fragen - im Arbeitsspeicher gemerkt, nach dem Neustart nur Ausgangsstand", async () => {
    const { fs } = fakeFs({ failWrite: true });
    resetPromptStateForTests(fs);
    await afterDashboard(USER, me([{ id: "alt" }]));
    expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "neu" }]))).toBe("own");
    expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "neu" }]))).toBeNull();
    resetPromptStateForTests(fs);
    expect(await afterDashboard(USER, me([{ id: "alt" }, { id: "neu" }, { id: "noch-eins" }]))).toBeNull();
  });

  test("eine Datei aus der Sicherung eines anderen Geräts gilt hier nicht", async () => {
    const { fs, files } = fakeFs();
    files.set("file:///daten/push-prompt.json", JSON.stringify({ asked: true, migrated: true, users: { [USER]: { seen: ["t:alt"] } }, install: "anderes-geraet-0000000" }));
    resetPromptStateForTests(fs);
    expect(await isPushAsked()).toBe(false);
  });
});
