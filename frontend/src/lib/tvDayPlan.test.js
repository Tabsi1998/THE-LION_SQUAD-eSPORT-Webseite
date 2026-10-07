// Hallen-Tafel (#1126): Zeitleiste aus den Event-Tagen - ein Tag, mehrere Tage, über Mitternacht; „jetzt“ rückt mit der
// Uhr weiter; was läuft und was als Nächstes kommt, mit Hinweis.
import { hallEvent } from "../../e2e/fixtures/tvHall.mjs";
import { dayIndexOf, dayPlan, eventDays, packLane, pickDay } from "./tvDayPlan";

const NOW = Date.parse("2026-10-10T14:32:00+02:00");
const at = (text) => Date.parse(text);

test("ein Tag: Zeitraum mit Stunden, Einlass, Turniere und Fast Lap in eigenen Bahnen, „jetzt“ an der richtigen Stelle", () => {
  const { event } = hallEvent({ now: NOW, stations: 6 });
  const plan = dayPlan(event, NOW);
  expect(plan.multi).toBe(false);
  expect(plan.title).toBe("Samstag, 10. Oktober");
  expect(plan.from).toBe(at("2026-10-10T09:00:00+02:00"));
  expect(plan.to).toBe(at("2026-10-10T22:00:00+02:00"));
  expect(plan.ticks[0].label).toBe("09:00");
  expect(plan.ticks.at(-1).label).toBe("21:00");
  expect(plan.door.label).toBe("Einlass 09:30");
  expect(plan.lanes.map((lane) => lane.label)).toEqual(["Turniere", "Fast Lap"]);
  expect(plan.lanes[0].blocks.map((block) => `${block.title} ${block.timeText} ${block.state}`)).toEqual([
    "Lions Herbst-Cup 12:00–16:00 live",
    "Kart-Sprint 13:30–17:00 live",
    "Abend-Turnier 18:00–21:00 next",
  ]);
  expect(plan.now.label).toBe("14:32");
  expect(plan.now.share).toBeCloseTo((5 * 60 + 32) / (13 * 60), 5);
  // Eine Minute später rückt die Linie weiter.
  expect(dayPlan(event, NOW + 60000).now.share).toBeGreaterThan(plan.now.share);
  expect(plan.running.map((block) => block.title)).toEqual(["Lions Herbst-Cup", "Kart-Sprint", "Lions Fast Lap"]);
  expect(plan.next).toMatchObject({ title: "Abend-Turnier", hint: "Check-in ab 17:30 bei der Turnierleitung" });
});

test("mehrere Tage: „Tag 2 von 3“, nur die Einträge dieses Tages, zwischen den Tagen der nächste", () => {
  const { event } = hallEvent({ now: NOW, stations: 6, multiDay: true });
  const plan = dayPlan(event, NOW);
  expect(plan.multi).toBe(true);
  expect(plan.title).toBe("Tag 2 von 3 · Samstag");
  expect(plan.lanes[0].blocks).toHaveLength(3);
  // Freitagabend: Tag 1 läuft.
  const friday = dayPlan(event, at("2026-10-09T19:00:00+02:00"));
  expect(friday.title).toBe("Tag 1 von 3 · Freitag");
  expect(friday.lanes).toEqual([]);
  // Sonntag früh um 8, vor dem Beginn um 10: Tag 3 ist der nächste.
  const sunday = dayPlan(event, at("2026-10-11T08:00:00+02:00"));
  expect(sunday.title).toBe("Tag 3 von 3 · Sonntag");
  expect(sunday.state).toBe("break");
  expect(sunday.now).toBeNull();
  expect(sunday.startsText).toBe("Tag 3 beginnt um 10:00");
  // Nach dem Event: der letzte Tag.
  expect(pickDay(eventDays(event), at("2026-10-12T20:00:00+02:00")).state).toBe("after");
});

test("über Mitternacht: Samstag 10:00 bis 02:00 - um 00:30 läuft noch der Samstag, ein Turnier um 01:00 gehört dazu", () => {
  const { event } = hallEvent({ now: NOW, stations: 6, multiDay: true });
  const late = { id: "t9", title: "Mitternachts-Cup", status: "scheduled", start_date: "2026-10-11T01:00:00+02:00", end_date: "2026-10-11T01:45:00+02:00" };
  const withLate = { ...event, tournaments: [...event.tournaments, late] };
  const days = eventDays(withLate);
  expect(dayIndexOf(days, late.start_date)).toBe(1);
  const plan = dayPlan(withLate, at("2026-10-11T00:30:00+02:00"));
  expect(plan.title).toBe("Tag 2 von 3 · Samstag");
  expect(plan.to).toBe(at("2026-10-11T02:00:00+02:00"));
  // 17 Stunden: alle zwei Stunden ein Strich, über Mitternacht weiter gezählt.
  expect(plan.ticks.map((tick) => tick.label)).toEqual(["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:00", "01:00"]);
  expect(plan.lanes[0].blocks.at(-1)).toMatchObject({ title: "Mitternachts-Cup", state: "next", timeText: "01:00–01:45" });
  expect(plan.now.label).toBe("00:30");
});

test("ohne Ende: bis zum nächsten Turnier, sonst drei Stunden - „ab 18:00“", () => {
  const event = {
    start_date: "2026-10-10T10:00:00+02:00",
    end_date: "2026-10-10T20:00:00+02:00",
    tournaments: [
      { id: "a", title: "Früh-Cup", status: "scheduled", start_date: "2026-10-10T11:00:00+02:00" },
      { id: "b", title: "Spät-Cup", status: "scheduled", start_date: "2026-10-10T15:00:00+02:00" },
    ],
  };
  const plan = dayPlan(event, at("2026-10-10T09:00:00+02:00"));
  const [early, late] = plan.lanes[0].blocks;
  expect(early).toMatchObject({ open: true, timeText: "ab 11:00", to: at("2026-10-10T15:00:00+02:00") });
  expect(late.to).toBe(at("2026-10-10T18:00:00+02:00"));
  expect(plan.now).toBeNull();
  expect(plan.startsText).toBe("Beginn um 10:00");
  expect(plan.next).toMatchObject({ title: "Früh-Cup", hint: "ab 11:00" });
});

test("Blöcke einer Bahn überdecken sich nie: was sich überschneidet, kommt in eine zweite Reihe", () => {
  const plan = { from: 0, to: 10 };
  const blocks = [{ id: "a", from: 0, to: 4 }, { id: "b", from: 3, to: 6 }, { id: "c", from: 6, to: 8 }];
  const packed = packLane(blocks, plan);
  expect(packed.rows).toBe(2);
  expect(packed.blocks.map((block) => block.row)).toEqual([0, 1, 0]);
  // Ein kurzer Block bekommt so viel Platz, dass sein Name lesbar ist - dann kann auch er in die nächste Reihe rutschen.
  const wide = packLane([{ id: "a", from: 0, to: 1 }, { id: "b", from: 1, to: 2 }], plan, 0.3);
  expect(wide.blocks.map((block) => block.row)).toEqual([0, 1]);
});
