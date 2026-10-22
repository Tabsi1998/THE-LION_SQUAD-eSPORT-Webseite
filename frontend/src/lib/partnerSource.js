import { roundLabel } from "@/lib/referenceCalendar";
import { MARK_LABELS } from "@/lib/referenceResults";

// Partner-Plattform einer Turnierserie (#1964): Texte und Auswahl der Vorschau „Jetzt holen“. Der Server rechnet, was
// Übernehmen täte (Termin, Blatt, Abweichungen) - hier wird es nur lesbar gemacht und die Auswahl gebaut. Vorgewählt
// ist nur, was nichts Vorhandenes ersetzt: ein Blatt mit Abweichungen hakt der Vorstand selbst an.

export const PARTNER_STATES = {
  new: { label: "Neu", tone: "border-[#29B6E8]/50 text-[#29B6E8]" },
  changed: { label: "Abweichungen", tone: "border-amber-400/50 text-amber-200" },
  same: { label: "Übernommen", tone: "border-emerald-400/40 text-emerald-200" },
  new_round: { label: "Neuer Termin", tone: "border-[#29B6E8]/50 text-[#29B6E8]" },
  link: { label: "Termin verknüpfen", tone: "border-[#29B6E8]/50 text-[#29B6E8]" },
  waiting: { label: "Noch offen", tone: "border-white/15 text-white/55" },
  error: { label: "Fehler", tone: "border-red-400/50 text-red-200" },
};

const SELECTABLE = new Set(["new", "changed", "new_round", "link"]);
const PRESELECTED = new Set(["new", "new_round", "link"]);

export function isSelectable(item) {
  return SELECTABLE.has(item?.state);
}

export function defaultSelection(items = []) {
  return items.filter((item) => PRESELECTED.has(item.state)).map((item) => item.ref);
}

function roundText(item) {
  return item.round ? roundLabel(item.round) : "Neuer Termin";
}

const TARGETS = {
  sheet: "Ergebnis als Entwurf",
  draft: "Entwurf wird ersetzt",
  pending_draft: "Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei",
};

/** Welcher Termin und was mit dem Ergebnis passiert. */
export function targetText(item) {
  const where = roundText(item);
  if (item.finished === false) {
    if (item.state === "link") return `${where} · wird verknüpft`;
    if (item.state === "new_round") return `${where} · Ergebnis folgt, wenn das Turnier fertig ist`;
    return `${where} · Turnier noch offen`;
  }
  if (item.state === "same") return `${where} · schon übernommen`;
  if (item.state === "error") return where;
  return `${where} · ${TARGETS[item.target] || TARGETS.sheet}`;
}

function counted(number, one, many) {
  return `${number} ${number === 1 ? one : many}`;
}

export function countsText(counts) {
  if (!counts) return "";
  const parts = [counted(counts.players, "Spieler", "Spieler"), counted(counts.rounds, "Runde", "Runden"),
    counted(counts.lobbies, "Lobby", "Lobbys")];
  if (counts.bots) parts.push(counted(counts.bots, "Bot", "Bots"));
  if (counts.guests) parts.push(counted(counts.guests, "Gast", "Gäste"));
  return parts.join(" · ");
}

function shown(value) {
  return value === null || value === undefined || value === "" ? "–" : String(value);
}

function roundsShown(entries) {
  if (!entries || !entries.length) return "–";
  return entries.map((entry) => {
    if (!entry) return "–";
    if (entry.points !== null && entry.points !== undefined) return String(entry.points);
    return entry.place ? `P${entry.place}` : "–";
  }).join(" · ");
}

function fieldParts(fields) {
  const parts = [];
  if (fields.place) parts.push(`Platz ${shown(fields.place[0])} → ${shown(fields.place[1])}`);
  if (fields.day_points) parts.push(`Tagespunkte ${shown(fields.day_points[0])} → ${shown(fields.day_points[1])}`);
  if (fields.day_rounds) {
    const [before, after] = fields.day_rounds.map(roundsShown);
    if (before !== after) parts.push(`Runden ${before} → ${after}`);
    else {
      // Gleiche Punkte: nur Platz in der Lobby bzw. Lobby kommen dazu oder ändern sich.
      const located = (fields.day_rounds[0] || []).some((entry) => entry && (entry.place || entry.lobby));
      parts.push(located ? "Runden: Platz bzw. Lobby geändert" : "Runden: Platz und Lobby ergänzt");
    }
  }
  if (fields.marks) {
    // Jede Marke, die dazukommt oder wegfällt - „Ausgestiegen“ als Wort, die übrigen wie im Ergebnisblatt (DSQ …).
    const before = new Set(fields.marks[0] || []);
    const after = new Set(fields.marks[1] || []);
    const name = (mark) => (mark === "left" ? "ausgestiegen" : MARK_LABELS[mark] || mark);
    for (const mark of [...after].sort()) if (!before.has(mark)) parts.push(name(mark));
    for (const mark of [...before].sort()) if (!after.has(mark)) parts.push(`nicht mehr ${name(mark)}`);
  }
  // Saisontabelle (#1928): Punkte, wie sie zählen, Sonderboni und Team.
  if (fields.points_total) parts.push(`Punkte ${shown(fields.points_total[0])} → ${shown(fields.points_total[1])}`);
  if (fields.bonus_keys) parts.push("Sonderboni geändert");
  if (fields.team) parts.push(`Team ${shown(fields.team[0])} → ${shown(fields.team[1])}`);
  if (fields.partner_id) parts.push("Partner geändert");
  if (fields.double_up) parts.push(`Double Up: ${fields.double_up[0] ? "ja" : "nein"} → ${fields.double_up[1] ? "ja" : "nein"}`);
  return parts;
}

/** Je Abweichung eine Zeile: wer und was sich ändert. `removed`: Text, wenn jemand in der Quelle fehlt. */
export function changeLines(changes = [], { removed = "fehlt beim Partner – fällt weg" } = {}) {
  return changes.map((change) => {
    if (change.kind === "added") return { key: change.participant_id, name: change.name, text: "kommt neu dazu" };
    if (change.kind === "removed") return { key: change.participant_id, name: change.name, text: removed };
    if (change.kind === "sheet") return { key: "sheet", name: "Ganzes Blatt", text: fieldParts(change.fields || {}).join(" · ") };
    return { key: change.participant_id, name: change.name, text: fieldParts(change.fields || {}).join(" · ") };
  });
}

/** Was Übernehmen schickt: genau der Stand der Vorschau (Fingerabdruck, Termin, Version). */
export function applyBody(items, selected) {
  const wanted = new Set(selected);
  return {
    items: items.filter((item) => wanted.has(item.ref)).map((item) => ({
      ref: item.ref, fingerprint: item.fingerprint, expected_version: item.expected_version || 0, round_id: item.round?.id || null,
    })),
  };
}

/** Rückmeldung nach dem Übernehmen. */
export function applySummary(results = []) {
  const count = (status) => results.filter((item) => item.status === status).length;
  const saved = count("saved");
  const rounds = count("round");
  const conflicts = count("conflict");
  const errors = count("error");
  const parts = [];
  if (saved) parts.push(`${saved} ${saved === 1 ? "Ergebnis" : "Ergebnisse"} als Entwurf übernommen`);
  if (rounds) parts.push(`${rounds} ${rounds === 1 ? "Termin" : "Termine"} angelegt bzw. verknüpft`);
  if (conflicts) parts.push(`${conflicts} hat sich seit der Vorschau geändert – bitte neu holen`);
  if (errors) parts.push(`${errors} mit Fehler`);
  if (!parts.length) return { ok: true, text: "Nichts zu übernehmen – alles ist schon da." };
  return { ok: !conflicts && !errors, text: `${parts.join(" · ")}.` };
}

export function sourceHost(url) {
  return String(url || "").replace(/^https:\/\//, "").replace(/\/$/, "");
}
