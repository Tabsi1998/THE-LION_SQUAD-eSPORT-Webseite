import { describe, expect, it } from "vitest";
import { DELAY_SHOWN_FROM, delayText, myQueueLine, queueSummaryLine } from "./liveQueue";

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
