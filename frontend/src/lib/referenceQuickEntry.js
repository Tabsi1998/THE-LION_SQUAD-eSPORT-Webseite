// Schnell-Eintrag für Tagesturniere (#1936): Oben im Referenz-Formular stehen nur Turniername, Spiel, Datum, wer
// angetreten ist, „Platz von N“ und ein Link. Alles andere liegt unter „Weitere Angaben“. Hier stehen die Vorgaben
// dazu - Status nach dem Datum, ein Tag als Start und Ende, „Wie letztes Mal“ - und wann der Bereich offen steht.

/** Status nach dem Datum: vorbei = abgeschlossen, heute = mit Platz abgeschlossen, sonst laufend, später = geplant. */
export function quickStatus(day, placement, today) {
  const date = String(day || "").slice(0, 10);
  if (!date || !today || date < today) return "completed";
  if (date > today) return "planned";
  return String(placement ?? "").trim() ? "completed" : "active";
}

/** Ein Tag: Das Ende folgt dem Start, solange es leer ist oder auf dem alten Start stand. Ein eigenes Ende bleibt. */
export function quickDate(form, day) {
  const start = String(form.start_date || "").slice(0, 10);
  const end = String(form.end_date || "").slice(0, 10);
  return { start_date: day, end_date: !end || end === start ? day : form.end_date };
}

/** Wohin „von N“ schreibt: Teams zählen Teams, Einzelstarter die Teilnehmer. Eine alte Team-Zeile nur mit Teilnehmerzahl behält diese. */
export function countKey(entry) {
  if (entry?.kind === "solo") return "participant_count";
  return !filled(entry?.team_count) && filled(entry?.participant_count) ? "participant_count" : "team_count";
}

function filled(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value != null && String(value).trim() !== "";
}

const MORE_TEXT_FIELDS = ["organizer", "league", "season", "format", "game_name", "location", "bracket_url", "match_url", "result_url",
  "description", "highlights", "series_id"];

/** Steht unter „Weitere Angaben“ etwas, das vom Tagesturnier abweicht? Dann ist der Bereich beim Öffnen offen. */
export function hasMoreDetails(form, today) {
  if (!form) return false;
  if (MORE_TEXT_FIELDS.some((key) => filled(form[key]))) return true;
  if (filled(form.partner_ids) || filled(form.platforms)) return true;
  const start = String(form.start_date || "").slice(0, 10);
  const end = String(form.end_date || "").slice(0, 10);
  if (end && end !== start) return true;
  if ((form.mode || "online") !== "online" || (form.visibility || "public") !== "public") return true;
  if (form.is_active === false || (Number(form.order_index) || 0) !== 0) return true;
  const entries = form.entries || [];
  if (entries.length > 1) return true;
  const first = entries[0];
  if (first) {
    const other = countKey(first) === "team_count" ? "participant_count" : "team_count";
    if (filled(first.placement_label) || filled(first.lineup_text) || filled(first[other])) return true;
  }
  return (form.status || "completed") !== quickStatus(start, first?.placement, today);
}

/** Die zuletzt angelegte Referenz (nach `created_at`); ohne Zeitstempel zählt sie nicht. */
export function lastReference(items) {
  let last = null;
  for (const item of items || []) {
    if (!item?.created_at) continue;
    if (!last || String(item.created_at) > String(last.created_at)) last = item;
  }
  return last;
}

/** „Wie letztes Mal“: Spiel, Veranstalter und Team (bzw. Einzelstarter) der letzten Referenz als Vorschlag. Name, Datum und Platz bleiben. */
export function likeLastTime(form, last) {
  if (!last) return form;
  const source = (last.entries || [])[0];
  const entries = [...(form.entries || [])];
  if (source && entries[0]) {
    const solo = source.kind === "solo";
    entries[0] = {
      ...entries[0],
      kind: solo ? "solo" : "team",
      team_name: solo ? "" : (source.team_name || entries[0].team_name || ""),
      member_profile_ids: [...(source.member_profile_ids || [])],
      lineup_text: (source.lineup || []).join(", "),
    };
  }
  return {
    ...form,
    game_id: last.game_id || "",
    game_name: last.game_id ? "" : (last.game_name || ""),
    organizer: last.organizer || "",
    entries,
  };
}
