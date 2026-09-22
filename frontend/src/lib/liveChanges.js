// Dynamik-Block (#224, #225): Der Änderungsstrom lädt Seiten still neu. Diese Helfer sagen,
// *was* sich dabei geändert hat, damit die Seite es kurz zeigen kann - ohne React, damit es
// sich testen lässt.

/** Welche Einträge sich zwischen zwei Ständen geändert haben - nach einer Signatur je Eintrag. */
export function changedKeys(previous, next, keyOf, signatureOf) {
  const before = new Map();
  for (const item of previous || []) before.set(keyOf(item), signatureOf(item));
  const changed = new Set();
  for (const item of next || []) {
    const key = keyOf(item);
    if (before.has(key) && before.get(key) !== signatureOf(item)) changed.add(key);
  }
  return changed;
}

/** Wer den Platz gewechselt hat: Schlüssel → { from, to } (nur, wenn beide Stände ihn kennen). */
export function movedKeys(previous, next, keyOf) {
  const positions = new Map();
  (previous || []).forEach((item, index) => positions.set(keyOf(item), index));
  const moved = new Map();
  (next || []).forEach((item, index) => {
    const key = keyOf(item);
    const from = positions.get(key);
    if (from !== undefined && from !== index) moved.set(key, { from, to: index });
  });
  return moved;
}

// ---------------------------------------------------------------- Startseite (#224)

/** Was an einer Karte sichtbar ist - ändert sich das, leuchtet die Karte kurz. */
export function timelineSignature(item) {
  const counts = item?.live_counts || {};
  return [
    item?.status, item?.public_phase?.state, item?.public_phase?.label, item?.start_date,
    counts.registered, counts.capacity, counts.running_matches, counts.participants,
  ].map((value) => (value === undefined || value === null ? "" : String(value))).join("|");
}

/** „12 von 16 angemeldet · 3 Matches laufen“ - nur, was es gibt. */
export function liveCountLine(item) {
  const counts = item?.live_counts;
  if (!counts) return "";
  const parts = [];
  if (counts.registered !== undefined && counts.registered !== null) {
    parts.push(counts.capacity ? `${counts.registered} von ${counts.capacity} angemeldet` : `${counts.registered} angemeldet`);
  } else if (counts.participants) {
    parts.push(`${counts.participants} Fahrer`);
  }
  if (counts.running_matches) parts.push(counts.running_matches === 1 ? "1 Match läuft" : `${counts.running_matches} Matches laufen`);
  if (counts.viewers) parts.push(`${counts.viewers} Zuschauer`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- Countdown (#224)

/** „in 3 Tagen, 14 Stunden“ - grob genug, dass es nicht jede Sekunde springt. */
export function formatCountdown(targetMs, now = Date.now()) {
  if (!Number.isFinite(targetMs)) return "";
  const diff = targetMs - now;
  if (diff <= 0) return "jetzt";
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const unit = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (days > 0) return hours > 0 ? `in ${unit(days, "Tag", "Tagen")}, ${unit(hours, "Stunde", "Stunden")}` : `in ${unit(days, "Tag", "Tagen")}`;
  if (hours > 0) return mins > 0 ? `in ${unit(hours, "Stunde", "Stunden")}, ${unit(mins, "Minute", "Minuten")}` : `in ${unit(hours, "Stunde", "Stunden")}`;
  if (minutes >= 1) return `in ${unit(minutes, "Minute", "Minuten")}`;
  return "in unter einer Minute";
}

/** Wie oft der Countdown nachsieht: unter einer Stunde jede Sekunde reicht nicht, jede Minute schon. */
export function countdownTickMs(targetMs, now = Date.now()) {
  const diff = targetMs - now;
  if (diff <= 0) return null;
  return diff < 60 * 60 * 1000 ? 15 * 1000 : 60 * 1000;
}

/** Der Termin, auf den die Startseite hinzählt: der nächste, der noch nicht läuft. */
export function nextCountdownTarget(items, now = Date.now()) {
  for (const item of items || []) {
    if (item?.public_phase?.state === "live") continue;
    const target = item?.public_phase?.target_at || item?.start_date;
    const ms = target ? new Date(target).getTime() : NaN;
    if (Number.isFinite(ms) && ms > now) return { item, targetMs: ms };
  }
  return null;
}

// ---------------------------------------------------------------- Turnierseiten (#225)

export function standingSignature(row) {
  return [row?.rank, row?.won ?? row?.wins, row?.lost ?? row?.losses, row?.points ?? row?.furthest_round].map((value) => String(value ?? "")).join("|");
}

/** Ergebnis eines Matches als Text: „Team A 2:1 Team B“ - oder leer, wenn keins da ist. */
export function matchResultSignature(match) {
  const results = (match?.results || []).map((r) => `${r.registration_id}:${r.score ?? r.points ?? ""}:${r.rank ?? ""}`).sort().join(",");
  return `${match?.status || ""}|${match?.score_a ?? ""}:${match?.score_b ?? ""}|${match?.winner_id || match?.winner_registration_id || ""}|${results}`;
}

function nameOf(registrationId, registrations) {
  const reg = registrations?.[registrationId] || {};
  return reg.display_name || reg.ingame_name || reg.user?.display_name || "Offen";
}

/** „Ergebnis eingetragen: Team A 2:1 Team B“ für den Hinweis unten (#225). */
export function describeResult(match, registrations) {
  if (!match) return "";
  if (Array.isArray(match.slots) && match.slots.length) {
    const byReg = new Map((match.results || []).map((r) => [r.registration_id, r]));
    const parts = match.slots.slice(0, 2).map((slot) => {
      const result = byReg.get(slot.registration_id);
      const score = result?.score ?? result?.points;
      return `${nameOf(slot.registration_id, registrations)}${score !== undefined && score !== null ? ` ${score}` : ""}`;
    });
    if (match.slots.length > 2) {
      const winner = (match.results || []).find((r) => r.rank === 1);
      return winner ? `Ergebnis eingetragen: ${nameOf(winner.registration_id, registrations)} gewinnt ${match.match_key || "den Durchgang"}` : `Ergebnis eingetragen: ${match.match_key || "Durchgang"}`;
    }
    return `Ergebnis eingetragen: ${parts.join(" : ")}`;
  }
  const a = nameOf(match.participant_a_id, registrations);
  const b = nameOf(match.participant_b_id, registrations);
  const hasScore = match.score_a !== undefined && match.score_a !== null && match.score_b !== undefined && match.score_b !== null;
  return hasScore ? `Ergebnis eingetragen: ${a} ${match.score_a}:${match.score_b} ${b}` : `Ergebnis eingetragen: ${a} gegen ${b}`;
}

const FINISHED = new Set(["completed", "finished", "done", "played"]);

/** Matches, deren Ergebnis seit dem letzten Stand neu ist - nur die, die jetzt fertig sind. */
export function freshResults(previousMatches, nextMatches) {
  const changed = changedKeys(previousMatches, nextMatches, (m) => m.id, matchResultSignature);
  return (nextMatches || []).filter((match) => changed.has(match.id) && (FINISHED.has(String(match.status)) || (match.results || []).some((r) => r.rank === 1)));
}
