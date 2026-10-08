import {
  formatDate,
  formatDateTime,
  formatWhen,
  fromDateTimeLocal,
  getRegistrationState,
  hasOnlineRegistration,
  normalizeDateTimeFields,
  toDateTimeLocalInput,
} from "./datetime";

// getRegistrationState entscheidet, ob sich jemand anmelden darf.
// normalizeDateTimeFields wandelt Formulareingaben vor dem Speichern um.

describe("Formatierung", () => {
  test("leere Werte bekommen den Platzhalter", () => {
    expect(formatDateTime(null)).toBe("TBD");
    expect(formatDate(undefined)).toBe("TBD");
    expect(formatDateTime("", { fallback: "offen" })).toBe("offen");
  });

  test("unlesbare Werte werden unveraendert durchgereicht statt zu crashen", () => {
    expect(formatDateTime("kein datum")).toBe("kein datum");
    expect(formatDate("kein datum")).toBe("kein datum");
  });
});

describe("Formularfelder", () => {
  test("Eingabe und Rueckwandlung ergeben denselben Zeitpunkt", () => {
    const input = toDateTimeLocalInput("2026-09-08T20:30:00Z");
    expect(input).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(fromDateTimeLocal(input)).getTime()).toBe(new Date("2026-09-08T20:30:00Z").getTime());
  });

  test("ungueltige Eingaben ergeben null statt eines kaputten Datums", () => {
    expect(fromDateTimeLocal("")).toBeNull();
    expect(fromDateTimeLocal("morgen")).toBeNull();
    expect(toDateTimeLocalInput("morgen")).toBe("");
    expect(toDateTimeLocalInput(null)).toBe("");
  });

  test("gesetzte Felder werden nach ISO umgewandelt", () => {
    const payload = normalizeDateTimeFields(
      { start_date: "2026-09-08T20:30", name: "Cup" },
      ["start_date"]
    );

    expect(payload.start_date).toBe(new Date("2026-09-08T20:30").toISOString());
    expect(payload.name).toBe("Cup");
  });

  test("geleerte Felder werden zu null, fehlende bleiben abwesend", () => {
    const payload = normalizeDateTimeFields(
      { start_date: "", other: "x" },
      ["start_date", "end_date"]
    );

    expect(payload.start_date).toBeNull();
    expect("end_date" in payload).toBe(false);
  });
});

describe("Anmeldestatus", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  test("ohne Turnier ist keine Anmeldung moeglich", () => {
    expect(getRegistrationState(null).canRegister).toBe(false);
  });

  test("Entwuerfe sind nicht anmeldbar", () => {
    const state = getRegistrationState({ status: "draft" });
    expect(state.canRegister).toBe(false);
    expect(state.state).toBe("draft");
  });

  test("deaktivierte und Nur-Einladung-Turniere sind gesperrt", () => {
    expect(getRegistrationState({ status: "registration_open", registration_enabled: false }).canRegister).toBe(false);
    expect(getRegistrationState({ status: "registration_open", is_invite_only: true }).canRegister).toBe(false);
  });

  test("offen im Zeitfenster", () => {
    const state = getRegistrationState({
      status: "registration_open",
      registration_open_from: past,
      registration_open_until: future,
    });

    expect(state.canRegister).toBe(true);
    expect(state.state).toBe("open");
  });

  test("vor dem Start noch nicht offen", () => {
    const state = getRegistrationState({ status: "registration_open", registration_open_from: future });

    expect(state.canRegister).toBe(false);
    expect(state.state).toBe("scheduled");
  });

  test("nach dem Ende geschlossen", () => {
    const state = getRegistrationState({ status: "registration_open", registration_open_until: past });

    expect(state.canRegister).toBe(false);
    expect(state.state).toBe("closed");
  });

  test("ein anderer Status als registration_open bleibt geschlossen", () => {
    expect(getRegistrationState({ status: "live" }).canRegister).toBe(false);
    expect(getRegistrationState({ status: "completed" }).canRegister).toBe(false);
  });

  test("das Substantiv der Beschriftung ist anpassbar", () => {
    expect(getRegistrationState({ status: "live" }, "Einreichung").label).toContain("Einreichung");
  });
});

describe("Online-Anmeldung", () => {
  test("braucht beide Schalter und mindestens einen Zeitpunkt", () => {
    expect(hasOnlineRegistration({
      online_registration_enabled: true,
      registration_enabled: true,
      registration_open_from: "2026-09-01T10:00:00Z",
    })).toBe(true);

    expect(hasOnlineRegistration({ online_registration_enabled: true, registration_enabled: true })).toBe(false);
    expect(hasOnlineRegistration({ online_registration_enabled: false, registration_enabled: true, registration_open_from: "x" })).toBe(false);
    expect(hasOnlineRegistration(null)).toBe(false);
  });
});

// Wann (#1220, Wahl des Betreibers): „Sa 23. Mai · 18:00“, „heute 18:00“, „morgen 18:00“ - Jahr nur, wenn es nicht das
// laufende ist. Gerechnet in Wiener Zeit; die Uhr steht in diesen Tests fest.
describe("formatWhen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  test("Wochentag, Tag, Monat ausgeschrieben und Uhrzeit - ohne Jahr im laufenden Jahr", () => {
    expect(formatWhen("2026-05-23T16:00:00Z")).toBe("Sa 23. Mai · 18:00");
    expect(formatWhen("2026-01-04T18:30:00Z")).toBe("So 4. Jänner · 19:30");
  });

  test("heute und morgen in Wiener Tagen - auch kurz vor und nach Mitternacht", () => {
    expect(formatWhen("2026-05-20T16:00:00Z")).toBe("heute 18:00");
    expect(formatWhen("2026-05-21T16:00:00Z")).toBe("morgen 18:00");
    // 21:59 UTC am 20.5. ist in Wien 23:59 - noch heute; 22:01 UTC ist schon der 21.5. in Wien, also morgen.
    expect(formatWhen("2026-05-20T21:59:00Z")).toBe("heute 23:59");
    expect(formatWhen("2026-05-20T22:01:00Z")).toBe("morgen 00:01");
    expect(formatWhen("2026-05-22T08:00:00Z")).toBe("Fr 22. Mai · 10:00");
    expect(formatWhen("2026-05-19T08:00:00Z")).toBe("Di 19. Mai · 10:00");
  });

  test("ein anderes Jahr steht dabei, ein fester Bezugszeitpunkt geht vor", () => {
    expect(formatWhen("2025-05-23T16:00:00Z")).toBe("Fr 23. Mai 2025 · 18:00");
    expect(formatWhen("2027-01-01T11:00:00Z")).toBe("Fr 1. Jänner 2027 · 12:00");
    expect(formatWhen("2026-12-31T22:30:00Z", { now: new Date("2026-12-31T12:00:00Z") })).toBe("heute 23:30");
    expect(formatWhen("2026-12-31T23:30:00Z", { now: new Date("2026-12-31T12:00:00Z") })).toBe("morgen 00:30");
    expect(formatWhen("2027-01-02T12:00:00Z", { now: new Date("2026-12-31T12:00:00Z") })).toBe("Sa 2. Jänner 2027 · 13:00");
  });

  test("ohne gültigen Wert kommt der Platzhalter", () => {
    expect(formatWhen(null)).toBe("");
    expect(formatWhen("", { fallback: "Termin offen" })).toBe("Termin offen");
    expect(formatWhen("kein datum", { fallback: "Termin offen" })).toBe("Termin offen");
  });
});
