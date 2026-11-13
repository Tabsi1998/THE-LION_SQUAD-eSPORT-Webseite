import { describe, expect, it } from "vitest";
import { broadcastProblem, deskResponsible, deskWhen, filterGroups, peopleText, scopeOptions, splitScope } from "./leagueDesk";

// Leitstand (E.4): Filter, Frist, Zuständigkeit und die Kreise der Rundnachricht.

describe("Leitstand", () => {
  it("„Nur meine“ behält nur, was die Person selbst erledigen kann", () => {
    const groups = [{ key: "overdue", items: [{ id: "a", mine: true }, { id: "b", mine: false }] }];
    expect(filterGroups(groups, "mine")[0].items.map((row) => row.id)).toEqual(["a"]);
    expect(filterGroups(groups, "all")[0].items).toHaveLength(2);
  });

  it("Frist vor „seit“, abgelaufene Frist markiert, sonst nichts", () => {
    const now = new Date("2026-11-13T12:00:00Z").getTime();
    expect(deskWhen({ due_at: "2026-11-15T12:00:00Z" }, now)).toMatchObject({ kind: "due", over: false });
    expect(deskWhen({ due_at: "2026-11-15T12:00:00Z" }, now).text).toMatch(/^Frist noch 2 Tage · /);
    expect(deskWhen({ due_at: "2026-11-12T12:00:00Z" }, now)).toMatchObject({ over: true, text: expect.stringMatching(/^Frist abgelaufen/) });
    expect(deskWhen({ since: "2026-11-12T12:00:00Z" }, now).text).toMatch(/^seit /);
    expect(deskWhen({}, now)).toBeNull();
  });

  it("nennt, wer übernommen hat, sonst die Zuständigkeit der Gruppe", () => {
    const group = { responsible: "„Proteste“" };
    expect(deskResponsible({ assignee: { name: "Zweitleitung", own: false } }, group)).toBe("Übernommen von Zweitleitung");
    expect(deskResponsible({ assignee: { name: "Ich", own: true } }, group)).toBe("Von dir übernommen");
    expect(deskResponsible({ kind: "reschedule" }, group)).toBe("Gegenseite, sonst „Proteste“");
    expect(deskResponsible({}, group)).toBe("„Proteste“");
  });
});

describe("Rundnachricht", () => {
  it("Kreise: ganze Season, je aktive Liga N und je Staffel", () => {
    const options = scopeOptions([
      { id: "d1", level: 1, label: "Liga 1", status: "active", staffeln: [{ tournament_id: "t1", staffel: "A" }, { tournament_id: "t2", staffel: "B" }] },
      { id: "d2", level: 2, label: "Liga 2", status: "archived", staffeln: [{ tournament_id: "t3", staffel: "A" }] },
    ]);
    expect(options.map((row) => row.value)).toEqual(["season:", "division:d1", "staffel:t1", "staffel:t2"]);
    expect(options[2].label).toBe("Liga 1 · Staffel A");
    expect(splitScope("staffel:t1")).toEqual({ scope: "staffel", scope_id: "t1" });
    expect(splitScope("season:")).toEqual({ scope: "season", scope_id: null });
  });

  it("prüft die Länge von Betreff und Nachricht", () => {
    expect(broadcastProblem({ title: "ab", text: "lang genug hier" })).toMatch(/^Betreff/);
    expect(broadcastProblem({ title: "x".repeat(81), text: "lang genug hier" })).toMatch(/höchstens 80/);
    expect(broadcastProblem({ title: "Spieltag", text: "kurz" })).toMatch(/^Nachricht/);
    expect(broadcastProblem({ title: "Spieltag", text: "y".repeat(1001) })).toMatch(/höchstens 1000/);
    expect(broadcastProblem({ title: "Spieltag", text: "Bitte einchecken." })).toBe("");
    expect(peopleText(1)).toBe("1 Person");
    expect(peopleText(3)).toBe("3 Personen");
  });
});
