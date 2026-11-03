// Liga-Termine auf der Matchseite (#2194, docs/LIGA.md D.1): Grenzen, Regeln und Historie im Klartext, damit Captains
// ohne Vorwissen sehen, was geht - „Noch 1 Verschiebung möglich, bis Sa 14.11. 20:00“. Die Zahlen kommen vom Server
// (`schedule_block`), hier wird nur formuliert.
import { viennaDate, viennaTime } from "@/lib/vienna";

/** „Sa 14.11. 20:00“ in Wiener Zeit. */
export function shortWhen(value) {
  if (!value) return "";
  const day = viennaDate(value, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\.,/, "").replace(",", "");
  return `${day} ${viennaTime(value, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Die Spielwoche: „Di 10.11. 00:00 bis Mo 16.11. 23:59“ (Ende ausschließlich, darum eine Minute davor). */
export function weekText(window) {
  if (!window?.start || !window?.end) return "";
  const last = new Date(new Date(window.end).getTime() - 60 * 1000).toISOString();
  return `${shortWhen(window.start)} bis ${shortWhen(last)}`;
}

/** Die Grenze in einem Satz - oder `null`, wenn es nichts zu sagen gibt. */
export function limitText(block) {
  if (!block) return null;
  if (!block.fixed) return "Verschieben geht erst, wenn ein Termin feststeht – vorher einigt ihr euch über Terminvorschläge.";
  const remaining = Number(block.remaining || 0);
  if (remaining <= 0) return "Keine Verschiebung mehr möglich – das entscheidet jetzt die Liga-Leitung.";
  const count = remaining === 1 ? "Noch 1 Verschiebung möglich" : `Noch ${remaining} Verschiebungen möglich`;
  return block.request_until ? `${count}, beantragen bis ${shortWhen(block.request_until)}.` : `${count}.`;
}

/** Die Regeln der Season als kurze Sätze. */
export function rulesSentences(rules) {
  if (!rules) return [];
  const out = [];
  out.push(rules.home_rule
    ? `Antwortet die Gastseite ${rules.home_rule_hours} Stunden lang nicht auf einen Vorschlag der Heimseite, gilt er – wenn er in der Spielwoche liegt.`
    : "Ein unbeantworteter Vorschlag gilt nicht von selbst – ohne Einigung gilt der Standardtermin.");
  if (Number(rules.reschedule_max) > 0) {
    out.push(`Verschieben: beide Seiten stimmen zu, mit Grund, spätestens ${rules.reschedule_notice_hours} Stunden vor dem Termin, `
      + `höchstens ${rules.reschedule_max === 1 ? "einmal" : `${rules.reschedule_max}-mal`} je Spiel`
      + `${rules.reschedule_same_week ? ", innerhalb der Spielwoche" : ""}.`);
  } else {
    out.push("Verschieben entscheidet in dieser Season nur die Liga-Leitung.");
  }
  out.push(`Ohne Ergebnis erinnert die Seite nach ${rules.result_reminder_hours} Stunden, nach ${rules.result_overdue_hours} Stunden entscheidet die Leitung.`);
  return out;
}

export const HISTORY_LABELS = {
  agreement: "Einigung",
  home_rule: "72-h-Regel",
  default: "Standardtermin",
  reschedule: "Verschiebung",
  lead: "Liga-Leitung",
};

/** Eine Zeile der Historie: was, wohin, von wem, warum. */
export function historyLine(entry) {
  const kind = HISTORY_LABELS[entry?.kind] || "Änderung";
  const to = entry?.to ? shortWhen(entry.to) : "kein fester Termin";
  const who = entry?.kind === "home_rule" ? "ohne Antwort der Gastseite" : entry?.kind === "default" ? "automatisch"
    : [entry?.by_name, entry?.side_name].filter(Boolean).join(" · ");
  return { kind, to, from: entry?.from ? shortWhen(entry.from) : "", who, reason: entry?.reason || "", at: entry?.at ? shortWhen(entry.at) : "" };
}

export const REQUEST_STATUS_LABELS = {
  pending: "wartet auf Zustimmung",
  accepted: "angenommen",
  declined: "abgelehnt",
  withdrawn: "zurückgezogen",
  expired: "abgelaufen",
  superseded: "erledigt – Termin anders gesetzt",
};

export function requestStatusLabel(request) {
  if (request?.status === "pending" && request?.own) return "wartet auf die Gegenseite";
  return REQUEST_STATUS_LABELS[request?.status] || "unbekannt";
}

/** Für den Kopf der Matchseite: Wann gilt ein offener Heimvorschlag nach der 72-h-Regel? */
export function homeRuleText(block) {
  if (!block?.home_rule_at) return null;
  return `Ohne Antwort gilt der Vorschlag der Heimseite ab ${shortWhen(block.home_rule_at)}.`;
}
