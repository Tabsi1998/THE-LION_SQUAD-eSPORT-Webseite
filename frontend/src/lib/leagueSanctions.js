// Strafen im Wettbewerb (E.3, docs/LIGA.md „E.3 Strafen“): Bezeichnungen, Formular und Anfrage für den Reiter „Strafen“ der
// Season-Seite und für „Meine Strafen“. Der Server prüft alles noch einmal - hier steht nur, was die Oberfläche zum Führen braucht.
import { fromViennaInput } from "@/lib/vienna";

export const SANCTION_STATUS = {
  provisional: { label: "Vorläufig", tone: "warn" },
  active: { label: "Gilt", tone: "live" },
  served: { label: "Abgelaufen", tone: "calm" },
  revoked: { label: "Widerrufen", tone: "calm" },
};

export const APPEAL_STATE_LABELS = { open: "Einspruch offen", upheld: "Einspruch abgelehnt, Strafe bleibt", granted: "Einspruch stattgegeben, Strafe aufgehoben",
  // Erledigt: Die Leitung hat die Strafe widerrufen, bevor über den Einspruch entschieden wurde.
  moot: "Einspruch erledigt, Strafe widerrufen" };

export const EMPTY_SANCTION_FORM = {
  catalog_key: "", kind: "warning", target_type: "squad", tournament_id: "", registration_id: "", user_id: "", match_id: "",
  rule_ref: "", reason: "", points: "1", provisional: false, period: "matches", matches: "1", ends_at: "", proof_ids: [],
};

/** Die Art aus der Liste des Servers. */
export function kindOf(kinds, key) {
  return (kinds || []).find((row) => row.key === key) || null;
}

/** Ein Katalogeintrag füllt Art und Regelverstoß vor - beides bleibt änderbar. Das Ziel passt sich der Art an. */
export function applyCatalog(form, entry, kinds) {
  if (!entry) return { ...form, catalog_key: "" };
  return applyKind({ ...form, catalog_key: entry.key, rule_ref: `${entry.label} (${entry.rule_ref})` }, entry.kind, kinds);
}

/** Wechselt die Art: Ziel (Person oder Co-Team) bleibt, wenn die Art es erlaubt; „vorläufig“ fällt weg, wenn sie es nicht kennt. */
export function applyKind(form, key, kinds) {
  const kind = kindOf(kinds, key);
  const targets = kind?.targets || ["squad"];
  return {
    ...form, kind: key,
    target_type: targets.includes(form.target_type) ? form.target_type : targets[0],
    provisional: Boolean(kind?.provisional) && form.provisional,
    period: key === "player_ban" ? form.period : "until",
  };
}

/** Braucht diese Sperre ein Ende oder eine Anzahl Spiele? Vorläufige und der Ligaausschluss nicht. */
export function needsPeriod(form) {
  return ["player_ban", "team_ban", "external"].includes(form.kind) && !form.provisional;
}

/** Was im Formular noch fehlt - der erste Punkt, als Satz. Leer: bereit zum Absenden. */
export function sanctionProblem(form, kinds) {
  const kind = kindOf(kinds, form.kind);
  if (!kind) return "Bitte die Art der Strafe wählen.";
  if (!form.registration_id && (form.target_type === "squad" || !form.user_id)) return "Bitte das Co-Team wählen.";
  if (form.target_type === "player" && !form.user_id) return "Bitte die Person wählen.";
  if (kind.match && !form.match_id) return "Bitte das Spiel wählen, auf das sich die Strafe bezieht.";
  if (String(form.rule_ref || "").trim().length < 2) return "Bitte den Regelverstoß nennen.";
  if (String(form.reason || "").trim().length < 5) return "Bitte die Strafe begründen (mindestens fünf Zeichen).";
  if (form.kind === "point_deduction" && !(Number.parseInt(form.points, 10) >= 1)) return "Bitte die Höhe des Punktabzugs eintragen.";
  if (needsPeriod(form)) {
    if (form.kind === "player_ban" && form.period === "matches") {
      if (!(Number.parseInt(form.matches, 10) >= 1)) return "Eine Spielsperre dauert mindestens ein Liga-Spiel.";
    } else if (!form.ends_at && form.kind !== "external") {
      return "Bitte das Ende der Sperre eintragen.";
    }
  }
  return "";
}

/** Der Zeitraum, wie er mitgeht: Anzahl Spiele oder Ende - nie beides. */
export function periodPayload(form) {
  if (!needsPeriod(form)) return {};
  if (form.kind === "player_ban" && form.period === "matches") return { matches: Number.parseInt(form.matches, 10) };
  return form.ends_at ? { ends_at: fromViennaInput(form.ends_at) } : {};
}

/** Das Formular als Anfrage an POST …/sanctions. */
export function sanctionPayload(form, kinds) {
  const kind = kindOf(kinds, form.kind);
  const out = {
    kind: form.kind, target_type: form.target_type, rule_ref: String(form.rule_ref || "").trim(), reason: String(form.reason || "").trim(),
    state: form.provisional && kind?.provisional ? "provisional" : "final",
  };
  if (form.catalog_key) out.catalog_key = form.catalog_key;
  if (form.registration_id) out.registration_id = form.registration_id;
  if (form.target_type === "player") out.user_id = form.user_id;
  if (form.match_id) {
    out.match_id = form.match_id;
    if (form.proof_ids?.length) out.proof_ids = form.proof_ids;
  }
  if (form.kind === "point_deduction") out.points = Number.parseInt(form.points, 10);
  return { ...out, ...periodPayload(form) };
}

/** Die Spiele eines Co-Teams in seiner Staffel - für die Auswahl „Spiel“. */
export function matchesOf(target, registrationId) {
  return (target?.matches || []).filter((match) => !registrationId || match.registration_ids.includes(registrationId));
}
