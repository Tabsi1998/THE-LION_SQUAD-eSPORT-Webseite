// Spielberechtigung in der Liga (docs/LIGA.md, B.3, #2204): nur die Darstellung, geprüft wird im Server
// (services/league_eligibility.py). Ein Geburtsdatum kommt hier nie an, nur „erfüllt“ oder „fehlt“.
import { platformLines } from "@/lib/leaguePlatform";

export const ELIGIBILITY_LABELS = {
  other_team: "in zwei Co-Teams",
  age_missing: "Geburtsdatum fehlt",
  age_not_met: "Altersvorgabe nicht erfüllt",
  platform_not_allowed: "Plattform nicht erlaubt",
  platform_missing: "Plattform fehlt",
  waiting: "Wartezeit",
  banned: "gesperrt",
  late: "wartet auf Freigabe",
  missing: "Spiel-ID fehlt",
  format: "Format der ID passt nicht",
  taken: "ID schon vergeben",
  locked: "spielberechtigt",
  pending: "spielberechtigt",
  free: "spielberechtigt",
};

export const TRANSFER_LABELS = {
  pending: "wartet auf Entscheidung",
  approved: "genehmigt",
  rejected: "abgelehnt",
  withdrawn: "zurückgezogen",
};

/** Mindestalter als Wort für Team-Seite und Kaderübersicht - sonst sichtbar ist nichts. */
export function ageLabel(age) {
  if (age === "met") return "Alter erfüllt";
  if (age === "missing") return "Geburtsdatum fehlt";
  return "";
}

function dayText(day) {
  const [year, month, date] = String(day || "").split("-");
  return year && month && date ? `${Number(date)}.${Number(month)}.${year}` : "";
}

/** Ein Transferfenster in Worten - „1.4.2027 bis 7.4.2027“. */
export function windowText(window) {
  const text = `${dayText(window?.start_date)} bis ${dayText(window?.end_date)}`;
  return window?.label ? `${window.label}: ${text}` : text;
}

/** Die Regeln einer Season in einem Satz je Regel - was die Season nicht trägt, steht nicht da. */
export function rulesLines(rules) {
  if (!rules) return [];
  const lines = [];
  if (rules.min_squad_size || rules.max_squad_size) {
    lines.push(rules.max_squad_size ? `Kader: ${rules.min_squad_size || 1} bis ${rules.max_squad_size} Spieler` : `Kader: mindestens ${rules.min_squad_size} Spieler`);
  }
  if (rules.one_team_per_season) lines.push("Jede Person spielt in dieser Season nur für ein Team.");
  if (rules.min_age) lines.push(`Mindestalter: ${rules.min_age} Jahre, laut Geburtsdatum im Profil.`);
  if (rules.new_player_wait_days) lines.push(`Neue Spieler warten ab dem Ende von Spieltag 1 ${rules.new_player_wait_days} Tage, nach einem Transfer immer.`);
  if (rules.roster_deadline) lines.push(`Stichtag für neue Spieler: ${dayText(rules.roster_deadline)}.`);
  if (rules.one_team_per_season) {
    const windows = rules.transfer_windows || [];
    if (!windows.length) lines.push("Transfers gibt es in dieser Season nicht.");
    else lines.push(`Transferfenster: ${windows.map(windowText).join("; ")}${rules.transfer_open ? " (gerade offen)" : ""}.`);
  }
  return [...lines, ...platformLines(rules.platform)];
}

/** Der Hinweis im Kader-Dialog: was die Season beim Aufnehmen verlangt. */
export function requirementHint(requirement) {
  if (!requirement) return "";
  const parts = [];
  if (requirement.max_size) parts.push(`höchstens ${requirement.max_size} Spieler`);
  // #2313: Aufnehmen geht immer, spielen erst mit passendem Geburtsdatum.
  if (requirement.min_age) parts.push(`spielen dürfen neue Spieler erst mit Geburtsdatum im Profil (mindestens ${requirement.min_age} Jahre), aufnehmen geht trotzdem`);
  if (requirement.transfers_open !== undefined) parts.push("wer schon in einem anderen Co-Team der Season steht, kommt nur per Transfer");
  return parts.length ? `Diese Season verlangt: ${parts.join(", ")}.` : "";
}

/** Der eigene Stand im Profil: was los ist und was zu tun ist. `null`, wenn es nichts zu sagen gibt. */
export function eligibilityNotice(item) {
  if (!item) return null;
  const title = item.title || "Liga";
  if (item.state === "age_missing") {
    return { tone: "warn", text: `${title}: Trag dein Geburtsdatum unter „Grunddaten“ ein. Die Season verlangt mindestens ${item.min_age} Jahre – ohne Datum kannst du nicht spielen.` };
  }
  if (item.ok) {
    return item.age === "met" ? { tone: "info", text: `${title}: Altersvorgabe erfüllt.` } : null;
  }
  return { tone: "warn", text: `${title}: ${item.reason}` };
}

/** Darf die Kaderübersicht eine vollständige Liste zeigen, auch wenn das Spiel keine Pflicht-ID hat? */
export function hasSeasonRules(rules) {
  return Boolean(rules && (rules.one_team_per_season || rules.min_age || rules.new_player_wait_days || rules.platform?.allowed?.length));
}
