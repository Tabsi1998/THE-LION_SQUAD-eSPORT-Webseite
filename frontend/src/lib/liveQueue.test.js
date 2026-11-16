import { describe, expect, it } from "vitest";
import { DELAY_SHOWN_FROM, delayText, myQueueLine, queueGoneError, queuePollMs, queueRetryDelay, queueSummaryLine, staleText } from "./liveQueue";

// Live vor Ort (#1556): Verzug und die Zeile für Spieler - reine Rechnung. Die Spielzeit-Uhr prüft matchClock.test.js.

describe("delayText", () => {
  it("nennt Verzug ab 5 Minuten, darunter nichts", () => {
    expect(DELAY_SHOWN_FROM).toBe(5);
    expect(delayText(11)).toBe("+11 Min.");
    expect(delayText(4)).toBe("");
    expect(delayText(null)).toBe("");
    expect(delayText(-12)).toBe("12 Min. früher");
  });
});

describe("myQueueLine", () => {
  const base = { station_text: "Station 2 · Switch 2", forecast_at: "2026-10-31T17:40:00Z" };

  it("sagt, was jetzt für dich gilt", () => {
    expect(myQueueLine({ ...base, state: "running" })).toEqual({ title: "Läuft an Station 2 · Switch 2", detail: "", tone: "live" });
    expect(myQueueLine({ ...base, state: "called", report_by: "2026-10-31T17:42:00Z" })).toEqual({
      title: "Du bist dran: Station 2 · Switch 2", detail: "Bitte bis 18:42 antreten", tone: "call" });
    expect(myQueueLine({ ...base, state: "queued", position: 1 })).toEqual({
      title: "Du bist als Nächstes an Station 2 · Switch 2", detail: "ca. 18:40", tone: "next" });
    expect(myQueueLine({ ...base, state: "queued", position: 2, delay_minutes: 11 })).toEqual({
      title: "Danach an Station 2 · Switch 2", detail: "ca. 18:40 · +11 Min.", tone: "later" });
    expect(myQueueLine({ ...base, state: "queued", position: 4 }).title).toBe("Später an Station 2 · Switch 2");
  });

  it("auf der Matchseite ohne „du“ - dort schauen auch Zuschauer", () => {
    expect(myQueueLine({ ...base, state: "queued", position: 1 }, { personal: false }).title).toBe("Als Nächstes an Station 2 · Switch 2");
    expect(myQueueLine({ ...base, state: "called" }, { personal: false }).title).toBe("Aufgerufen: Station 2 · Switch 2");
    expect(myQueueLine({ ...base, state: "queued", position: 3, station_text: "" }, { personal: false }).title).toBe("Noch ohne Station");
  });

  it("sagt ehrlich, wenn die Plätze noch nicht feststehen", () => {
    expect(myQueueLine({ ...base, state: "queued", position: 3, forecast: true }).detail).toBe("voraussichtlich ca. 18:40");
  });

  it("ohne Station und ohne Eintrag", () => {
    expect(myQueueLine({ state: "queued", position: null, forecast_at: base.forecast_at, station_text: "" }).title).toBe("Dein nächstes Spiel");
    expect(myQueueLine(null)).toBeNull();
  });
});

describe("queueSummaryLine", () => {
  it("Verzug und das letzte Spiel mit neuer Zeit", () => {
    const summary = { delay_minutes: 11, last: { label: "Finale", forecast_at: "2026-10-31T19:51:00Z" } };
    expect(queueSummaryLine(summary)).toBe("+11 Min. · Finale jetzt ca. 20:51");
    expect(queueSummaryLine({ ...summary, delay_minutes: 2 })).toBe("Im Plan · Finale ca. 20:51");
    expect(queueSummaryLine(null)).toBe("");
  });
});

// #2440: Nur „gibt es nicht“ (403/404) nimmt die Warteschlange weg - Netz, Server und Zeitüberschreitung nicht.
describe("gescheiterter Abruf (#2440)", () => {
  it("403 und 404 heißen „gibt es nicht“, alles andere ist vorübergehend", () => {
    expect(queueGoneError({ response: { status: 404 } })).toBe(true);
    expect(queueGoneError({ response: { status: 403 } })).toBe(true);
    expect(queueGoneError({ response: { status: 503 } })).toBe(false);
    expect(queueGoneError({ response: { status: 500 } })).toBe(false);
    expect(queueGoneError({ code: "ECONNABORTED" })).toBe(false);
    expect(queueGoneError(new Error("Network Error"))).toBe(false);
    expect(queueGoneError(null)).toBe(false);
  });

  it("nach Fehlern wächst der Abstand: 5, 10, 20, 40, dann höchstens 60 s", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(queueRetryDelay)).toEqual([0, 5000, 10000, 20000, 40000, 60000, 60000]);
  });

  it("der Takt nach Fehlern: nie schneller als der Grundtakt, höchstens 60 s; ohne Takt bleibt es 0", () => {
    expect([0, 1, 3, 4, 5].map((failures) => queuePollMs(20000, failures))).toEqual([20000, 20000, 20000, 40000, 60000]);
    expect([0, 5].map((failures) => queuePollMs(60000, failures))).toEqual([60000, 60000]);
    expect(queuePollMs(0, 4)).toBe(0);
  });

  it("„Letzter Stand vor 25 s“, ab einer Minute in Minuten", () => {
    expect(staleText(25400)).toBe("Letzter Stand vor 25 s – es wird weiter nachgeladen.");
    expect(staleText(0)).toBe("Letzter Stand vor 0 s – es wird weiter nachgeladen.");
    expect(staleText(185000)).toBe("Letzter Stand vor 3 Min. – es wird weiter nachgeladen.");
    expect(staleText(-5)).toBe("Letzter Stand vor 0 s – es wird weiter nachgeladen.");
  });
});
