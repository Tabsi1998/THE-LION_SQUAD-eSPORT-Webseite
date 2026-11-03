import { describe, expect, it } from "vitest";
import { historyLine, homeRuleText, limitText, requestStatusLabel, rulesSentences, shortWhen, weekText } from "./leagueSchedule";

const RULES = { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true,
  result_reminder_hours: 24, result_overdue_hours: 48 };

describe("leagueSchedule (#2194)", () => {
  it("schreibt Termine in Wiener Zeit, auch über die Zeitumstellung", () => {
    expect(shortWhen("2026-11-14T19:00:00Z")).toBe("Sa 14.11. 20:00");
    expect(shortWhen("2026-10-24T18:00:00Z")).toBe("Sa 24.10. 20:00");
    expect(shortWhen("2026-10-26T19:00:00Z")).toBe("Mo 26.10. 20:00");
    expect(weekText({ start: "2026-10-19T22:00:00Z", end: "2026-10-26T23:00:00Z" })).toBe("Di 20.10. 00:00 bis Mo 26.10. 23:59");
  });

  it("nennt die Grenze im Klartext", () => {
    expect(limitText({ fixed: true, remaining: 1, request_until: "2026-11-14T19:00:00Z" })).toBe("Noch 1 Verschiebung möglich, beantragen bis Sa 14.11. 20:00.");
    expect(limitText({ fixed: true, remaining: 2, request_until: null })).toBe("Noch 2 Verschiebungen möglich.");
    expect(limitText({ fixed: true, remaining: 0 })).toContain("Liga-Leitung");
    expect(limitText({ fixed: false })).toContain("Terminvorschläge");
    expect(limitText(null)).toBeNull();
  });

  it("fasst die Regeln der Season zusammen", () => {
    const text = rulesSentences(RULES).join(" ");
    expect(text).toContain("72 Stunden");
    expect(text).toContain("höchstens 2-mal je Spiel, innerhalb der Spielwoche");
    expect(rulesSentences({ ...RULES, home_rule: false, reschedule_max: 0 }).join(" ")).toContain("nur die Liga-Leitung");
    expect(rulesSentences({ ...RULES, reschedule_max: 1, reschedule_same_week: false }).join(" ")).toContain("höchstens einmal je Spiel.");
  });

  it("beschreibt Historie und Anträge", () => {
    const line = historyLine({ kind: "reschedule", to: "2026-11-14T19:00:00Z", from: "2026-11-13T19:00:00Z", by_name: "Falke", side_name: "Falken", reason: "Nachtdienst" });
    expect(line).toMatchObject({ kind: "Verschiebung", to: "Sa 14.11. 20:00", from: "Fr 13.11. 20:00", who: "Falke · Falken", reason: "Nachtdienst" });
    expect(historyLine({ kind: "home_rule", to: "2026-11-14T19:00:00Z" }).who).toBe("ohne Antwort der Gastseite");
    expect(historyLine({ kind: "lead", to: null }).to).toBe("kein fester Termin");
    expect(requestStatusLabel({ status: "pending", own: true })).toBe("wartet auf die Gegenseite");
    expect(requestStatusLabel({ status: "superseded" })).toContain("erledigt");
    expect(homeRuleText({ home_rule_at: "2026-11-14T19:00:00Z" })).toContain("Sa 14.11. 20:00");
    expect(homeRuleText({})).toBeNull();
  });
});
