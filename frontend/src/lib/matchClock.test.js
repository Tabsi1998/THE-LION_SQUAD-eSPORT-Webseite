import { describe, expect, it } from "vitest";
import { serverNow, serverOffset } from "@/seasons/clock";
import { CLOCK_WARN_AT, clockLabel, clockText, elapsedSeconds, matchClock } from "./matchClock";

// Spielzeit-Uhr (#1167): dieselben festen Fälle wie in der App (Jest, #2393) - 50 %, 80 %, 100 %, 150 %, ohne Dauer,
// über eine Stunde, Pause und eine falsch gehende Geräteuhr.

const START = Date.parse("2026-10-31T16:00:00Z"); // 17:00 in Wien
const ISO = new Date(START).toISOString();
const at = (minutes, seconds = 0) => START + minutes * 60000 + seconds * 1000;

describe("matchClock", () => {
  it("50 %: läuft ruhig, Balken halb", () => {
    expect(matchClock(ISO, 20, at(10))).toMatchObject({ text: "10:00", limit: "20 Min.", ratio: 0.5, tone: "run", status: "", overMinutes: 0 });
  });

  it("80 %: knapp (Orange), knapp darunter noch ruhig", () => {
    expect(CLOCK_WARN_AT).toBe(0.8);
    expect(matchClock(ISO, 20, at(15, 59)).tone).toBe("run");
    expect(matchClock(ISO, 20, at(16))).toMatchObject({ text: "16:00", ratio: 0.8, tone: "warn", status: "knapp" });
  });

  it("100 %: Zeit überschritten, Balken voll", () => {
    expect(matchClock(ISO, 20, at(19, 59)).tone).toBe("warn");
    expect(matchClock(ISO, 20, at(20))).toMatchObject({ text: "20:00", ratio: 1, tone: "over", status: "Zeit überschritten", overMinutes: 0 });
  });

  it("150 %: bleibt überschritten, Balken voll, „+10 Min.“", () => {
    expect(matchClock(ISO, 20, at(30, 5))).toMatchObject({ text: "30:05", ratio: 1, tone: "over", overMinutes: 10 });
  });

  it("ohne Dauer nur die laufende Zeit, ohne Farbe; ohne Start nichts", () => {
    expect(matchClock(ISO, null, at(3, 9))).toMatchObject({ text: "03:09", limit: "", ratio: null, tone: "none", status: "" });
    expect(matchClock(ISO, 0, at(3, 9)).tone).toBe("none");
    expect(matchClock(null, 30, at(3))).toBeNull();
    expect(matchClock("kein Datum", 30, at(3))).toBeNull();
  });

  it("über eine Stunde mit Stunden; vor dem Start 00:00", () => {
    expect(matchClock(ISO, 90, at(65, 12)).text).toBe("1:05:12");
    expect(matchClock(ISO, null, at(125, 3)).text).toBe("2:05:03");
    expect(matchClock(ISO, 30, at(-1)).text).toBe("00:00");
  });

  it("mit „Bewegung reduzieren“ springt der Balken minutenweise, die Farbe bleibt sekundengenau", () => {
    const smooth = matchClock(ISO, 30, at(10, 30));
    const stepped = matchClock(ISO, 30, at(10, 30), { stepped: true });
    expect(smooth.ratio).toBeCloseTo(10.5 / 30);
    expect(stepped.ratio).toBeCloseTo(10 / 30);
    expect(matchClock(ISO, 20, at(16), { stepped: true }).tone).toBe("warn");
  });

  it("Pause: die Uhr steht ab `pausedAt`, frühere Pausen zählen nicht mit", () => {
    const paused = matchClock(ISO, 20, at(40), { pausedAt: new Date(at(12, 30)).toISOString() });
    expect(paused).toMatchObject({ text: "12:30", tone: "run", paused: true });
    expect(matchClock(ISO, 20, at(18), { pausedSeconds: 5 * 60 })).toMatchObject({ text: "13:00", tone: "run", paused: false });
    // Eine Pause nach „jetzt“ hält nichts an.
    expect(matchClock(ISO, 20, at(5), { pausedAt: at(12) }).text).toBe("05:00");
  });

  it("falsch gehende Geräteuhr: mit dem Abstand zur Serverzeit zeigen Handy und TV dieselbe Zeit", () => {
    const server = at(16); // Serverzeit bei der Antwort
    const phone = server - 7 * 60 * 1000; // das Handy geht 7 Minuten nach
    const tv = server + 2500; // der TV 2,5 Sekunden vor
    const phoneOffset = serverOffset(new Date(server).toISOString(), phone, phone);
    const tvOffset = serverOffset(new Date(server).toISOString(), tv, tv);
    const onPhone = matchClock(ISO, 20, serverNow(phoneOffset, phone + 4000));
    const onTv = matchClock(ISO, 20, serverNow(tvOffset, tv + 4000));
    expect(onPhone).toEqual(onTv);
    expect(onPhone).toMatchObject({ text: "16:04", tone: "warn" });
    // Ohne Abgleich läge das Handy 7 Minuten daneben - und ruhig statt knapp.
    expect(matchClock(ISO, 20, phone + 4000)).toMatchObject({ text: "09:04", tone: "run" });
  });
});

describe("clockText, elapsedSeconds, clockLabel", () => {
  it("formatiert mm:ss und ab einer Stunde h:mm:ss", () => {
    expect(clockText(0)).toBe("00:00");
    expect(clockText(274)).toBe("04:34");
    expect(clockText(3723)).toBe("1:02:03");
    expect(clockText(null)).toBe("");
    expect(clockText("x")).toBe("");
  });

  it("zählt Sekunden ab dem Start, ohne gültigen Start null", () => {
    expect(elapsedSeconds(ISO, at(4, 34))).toBe(274);
    expect(elapsedSeconds(null, at(1))).toBeNull();
    expect(elapsedSeconds("kein Datum", at(1))).toBeNull();
  });

  it("sagt dem Screenreader Zeit, Dauer und Zustand", () => {
    expect(clockLabel(matchClock(ISO, 20, at(10)))).toBe("Spielzeit 10:00 von 20 Min.");
    expect(clockLabel(matchClock(ISO, 20, at(16)))).toBe("Spielzeit 16:00 von 20 Min., knapp");
    expect(clockLabel(matchClock(ISO, 20, at(21)))).toBe("Spielzeit 21:00 von 20 Min., Zeit überschritten");
    expect(clockLabel(matchClock(ISO, null, at(3)))).toBe("Spielzeit 03:00");
    expect(clockLabel(matchClock(ISO, 20, at(30), { pausedAt: at(5) }))).toBe("Spielzeit 05:00 von 20 Min., angehalten");
    expect(clockLabel(null)).toBe("");
  });
});
