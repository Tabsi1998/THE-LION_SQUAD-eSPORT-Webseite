import { describe, expect, test } from "vitest";
import {
  APPLICATION_STATES,
  applicationPayload,
  applicationToForm,
  canStartApplication,
  seatsLine,
  statsLine,
  submittedToast,
  teamStateLabel,
  waitingLine,
  windowLine,
} from "./leagueApplications";

// Selbstanmeldung (docs/LIGA.md, B.4, #2205): Texte aus der Antwort des Servers, Formular der Season. Wiener Zeit, unabhängig vom Rechner.

describe("Fenster und Plätze", () => {
  const block = { opens_at: "2026-11-01T17:00:00+00:00", closes_at: "2026-11-20T19:00:00+00:00" };

  test("das Fenster nennt die Wiener Uhrzeit je Stand", () => {
    expect(windowLine({ ...block, state: "open" })).toBe("Offen bis 20.11.2026, 20:00 Uhr");
    expect(windowLine({ ...block, state: "upcoming" })).toBe("Öffnet am 01.11.2026, 18:00 Uhr");
    expect(windowLine({ ...block, state: "closed" })).toBe("Vorbei seit 20.11.2026, 20:00 Uhr");
  });

  test("freie Plätze, volle Plätze mit und ohne Warteliste, keine Grenze", () => {
    expect(seatsLine({ slots: 8, slots_free: 3 })).toBe("3 von 8 Startplätzen frei");
    expect(seatsLine({ slots: 8, slots_free: 1 })).toBe("1 von 8 Startplätzen frei");
    expect(seatsLine({ slots: 8, slots_free: 0, waitlist: true })).toBe("Alle 8 Startplätze vergeben, die Warteliste ist offen");
    expect(seatsLine({ slots: 8, slots_free: 0, waitlist: true, waitlist_full: true })).toBe("Alle 8 Startplätze vergeben, auch die Warteliste ist voll");
    expect(seatsLine({ slots: 8, slots_free: 0, waitlist: false })).toBe("Alle 8 Startplätze vergeben");
    expect(seatsLine({ slots: null })).toBe("");
  });

  test("die Zahlen für den Eingang", () => {
    expect(statsLine({ slots: 8, taken: 3, open: 2, waiting: 1, unassigned: 1 })).toBe("3 von 8 Startplätzen belegt · 2 offen · 1 auf der Warteliste · 1 noch ohne Staffel");
    expect(statsLine({ slots: null, taken: 0, open: 0, waiting: 0, unassigned: 0 })).toBe("Keine Grenze bei den Startplätzen · nichts offen");
  });

  test("alle Zustände aus dem Auftrag haben einen Namen", () => {
    expect(Object.keys(APPLICATION_STATES).sort()).toEqual(["accepted", "in_review", "none", "open", "rejected", "submitted", "waitlist", "withdrawn"]);
    expect(APPLICATION_STATES.in_review.label).toBe("In Prüfung");
  });
});

describe("Automatisch annehmen (#2348)", () => {
  test("das eigene Team liest Angemeldet, die übrigen Stände wie gehabt", () => {
    expect(teamStateLabel("accepted", { staffel: "Liga 1 · Staffel A" })).toBe("Angemeldet");
    expect(teamStateLabel("accepted", { staffel: null })).toBe("Angemeldet – Zuteilung folgt");
    expect(teamStateLabel("accepted", { staffel: "Liga 1 · Staffel A", staffel_left: true })).toBe("Angenommen");
    expect(teamStateLabel("submitted", null)).toBe("Eingereicht");
    expect(teamStateLabel("unbekannt", null)).toBe("Nicht angemeldet");
  });

  test("die Meldung nach dem Einreichen folgt dem Stand", () => {
    expect(submittedToast("accepted")).toBe("Angemeldet. Ihr habt einen Startplatz.");
    expect(submittedToast("waitlist")).toBe("Eingereicht. Ihr steht auf der Warteliste.");
    expect(submittedToast("submitted")).toBe("Anmeldung eingereicht. Die Liga-Leitung prüft sie jetzt.");
  });

  test("der Hinweis auf offene Anmeldungen zählt richtig", () => {
    expect(waitingLine(0)).toBe("");
    expect(waitingLine(1)).toBe("1 Anmeldung wartet auf Prüfung und hält ihren Platz frei");
    expect(waitingLine(3)).toBe("3 Anmeldungen warten auf Prüfung und halten ihren Platz frei");
  });

  test("die Einstellung reist mit dem Formular, Vorgabe aus", () => {
    const opened = { application_opens_at: "2026-07-01T16:00:00+00:00", application_closes_at: "2026-07-02T16:00:00+00:00" };
    expect(applicationToForm(opened).application_auto_accept).toBe(false);
    expect(applicationPayload(applicationToForm({ ...opened, application_auto_accept: true })).application_auto_accept).toBe(true);
    expect(applicationPayload(applicationToForm(opened)).application_auto_accept).toBe(false);
  });
});

describe("Knopf „Mit Co-Team anmelden“", () => {
  const open = { application: { state: "open" } };

  test("nur im offenen Fenster und nur für Captain oder Vertreter ohne offenen Antrag", () => {
    expect(canStartApplication({ ...open, squads: [{ can_apply: true, state: "open" }] })).toBe(true);
    expect(canStartApplication({ ...open, squads: [{ can_apply: true, state: "rejected" }] })).toBe(true);
    expect(canStartApplication({ ...open, squads: [{ can_apply: true, state: "withdrawn" }] })).toBe(true);
    expect(canStartApplication({ ...open, squads: [{ can_apply: false, state: "open" }] })).toBe(false);
    expect(canStartApplication({ ...open, squads: [{ can_apply: true, state: "submitted" }] })).toBe(false);
    expect(canStartApplication({ application: { state: "closed" }, squads: [{ can_apply: true, state: "none" }] })).toBe(false);
    expect(canStartApplication(null)).toBe(false);
  });
});

describe("Formular der Season", () => {
  test("Wiener Zeit hin und zurück, Vorgaben ohne Feld", () => {
    const form = applicationToForm({ application_opens_at: "2026-07-01T16:00:00+00:00", application_closes_at: "2026-07-02T16:00:00+00:00", entry_policy: "members", application_slots: 8 });
    expect(form.application_opens).toBe("2026-07-01T18:00");
    expect(form.application_slots).toBe("8");
    expect(form.entry_policy).toBe("members");
    const payload = applicationPayload(form);
    expect(payload.application_opens_at).toBe("2026-07-01T16:00:00.000Z");
    expect(payload.application_closes_at).toBe("2026-07-02T16:00:00.000Z");
    expect(payload.application_slots).toBe(8);
    expect(payload.entry_policy).toBe("members");
  });

  test("eine ältere Season ohne Felder bleibt, wie sie ist", () => {
    expect(applicationPayload(applicationToForm({}))).toEqual({});
  });

  test("wer das Fenster dort einträgt, schickt alles mit, leer heißt null", () => {
    const payload = applicationPayload({ ...applicationToForm({}), application_opens: "2026-07-01T18:00", application_closes: "2026-07-02T18:00" });
    expect(payload.application_slots).toBeNull();
    expect(payload.application_waitlist).toBe(true);
    expect(payload.sibling_squads_in_staffel).toBe(false);
    expect(payload.application_privacy_text).toBeNull();
  });

  test("eine neue Season darf das Fenster wieder leeren", () => {
    const payload = applicationPayload({ ...applicationToForm({ entry_policy: "all", application_opens_at: "2026-07-01T16:00:00+00:00", application_closes_at: "2026-07-02T16:00:00+00:00" }), application_opens: "", application_closes: "" });
    expect(payload.application_opens_at).toBeNull();
    expect(payload.application_closes_at).toBeNull();
  });
});
