import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { LearnedSpellings } from "./LearnedSpellings";
import { kindShows } from "@/lib/seriesKinds";

// Teilnehmer bearbeiten (#1929): Name wie beim Veranstalter, Startnummer, Standard-Team und die Zuordnung (Mitglied mit
// Profil, Gast, Extern). Geschickt wird nur, was sich geändert hat – Name, Nummer und Team über PATCH, die Zuordnung
// über „assign“ (wie im Dialog „Unbekannte Namen“). Wird ein Mitglied oder Gast extern, fragt die Seite nach: Der Alias
// geht dann auch in anderen Saisons. Entfernen gibt es nur ohne Ergebnis, sonst führt der Weg übers Zusammenführen.

export const LINK_HINT = "Mitglied zählt für Verein und Profil. Gast fährt für ein Vereinsteam, ist aber kein Mitglied. Extern sind alle anderen.";
export const ALIAS_HINT = "Mitglied und Gast gelten als Alias in allen Saisons, Extern nimmt den Alias zurück.";

function currentLink(row) {
  return row.link_status === "open" ? "" : row.link || "external";
}

/** Was sich an Name, Startnummer und Team geändert hat – leere Felder heißen „keine Angabe“ (`null`). */
export function fieldChanges(row, form) {
  const out = {};
  const name = form.name.trim();
  if (name && name !== row.name) out.name = name;
  for (const [key, value] of [["start_number", form.start_number], ["default_team", form.default_team], ["current_team", form.current_team ?? ""]]) {
    const next = value.trim() || null;
    if (next !== (row[key] || null)) out[key] = next;
  }
  // Gelernte Schreibweisen aus Bildern (#2012): nur entfernen - es gehen die bleibenden mit.
  const learned = learnedNames(row);
  if (form.read_aliases && form.read_aliases.length !== learned.length) out.read_aliases = form.read_aliases;
  return out;
}

function learnedNames(row) {
  return (row.read_aliases || []).map((item) => item?.name).filter(Boolean);
}

/** Die neue Zuordnung oder `null`, wenn sie bleibt. Mitglied ohne Profil ist noch keine. */
export function linkChange(row, form) {
  if (!form.link) return null;
  if (form.link === "member") {
    if (currentLink(row) === "member" && form.profile_id === row.profile_id) return null;
    return { link: "member", profile_id: form.profile_id };
  }
  return form.link === currentLink(row) ? null : { link: form.link };
}

export function ParticipantEditSheet({ series, row, profiles = [], onClose, onSaved }) {
  const confirm = useConfirm();
  const [form, setForm] = useState(() => ({
    name: row.name || "", start_number: row.start_number || "", default_team: row.default_team || "", current_team: row.current_team || "",
    link: currentLink(row), profile_id: row.profile_id || "", read_aliases: learnedNames(row),
  }));
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));
  const base = `/reference-series/admin/series/${series.id}/participants/${row.id}`;

  const linkOptions = [
    ...(row.link_status === "open" ? [["", "Noch offen"]] : []),
    ["member", "Mitglied"], ["guest", "Gast"], ["external", "Extern"],
  ];
  const profileOptions = [["", "Mitglied wählen …"], ...profiles.map((profile) => [profile.id, profile.name])];

  const save = async (event) => {
    event.preventDefault();
    if (form.link === "member" && !form.profile_id) {
      toast.error("Bitte ein Mitglied wählen.");
      return;
    }
    const changes = fieldChanges(row, form);
    const link = linkChange(row, form);
    if (!Object.keys(changes).length && !link) {
      onClose();
      return;
    }
    const was = currentLink(row);
    if (link?.link === "external" && (was === "member" || was === "guest") && !await confirm({
      title: `${row.name} als Extern?`,
      description: `Die Zuordnung als ${was === "member" ? "Mitglied" : "Gast"} gilt dann in keiner Saison mehr – der Alias wird überall zurückgenommen.${was === "member" ? " Der Name zählt nicht mehr für Verein und Profil." : ""}`,
      confirmLabel: "Als Extern speichern",
    })) return;
    setSaving(true);
    try {
      if (Object.keys(changes).length) await api.patch(base, changes);
      const answer = link ? await api.post(`${base}/assign`, link) : null;
      toast.success("Gespeichert.");
      onSaved(answer?.data?.notice || "");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!await confirm({
      title: `${row.name} entfernen?`,
      description: "Der Name verschwindet aus dieser Saison. Ein Alias bleibt bestehen.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(base);
      toast.success(`${row.name} entfernt.`);
      onSaved("");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const footer = row.in_results ? null : (
    <button type="button" onClick={remove} data-testid="participant-edit-remove"
      className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs uppercase tracking-wider font-bold rounded-sm text-white/55 hover:text-[#FF3B30] transition-colors">
      <Trash2 className="w-3.5 h-3.5" /> Entfernen
    </button>
  );

  return (
    <AdminSheet title="Teilnehmer bearbeiten" eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving} footer={footer} submitTestId="participant-edit-save" testId="participant-edit">
      <TextField label="Name" required maxLength={120} value={form.name} onChange={set("name")} testId="participant-edit-name"
        hint="So, wie der Veranstalter ihn schreibt. Gibt es den Namen in der Saison schon, führt beide zusammen." />
      {/* Art-Profil (#2024): Startnummern nur, wo die Art sie kennt - eine gesetzte bleibt sichtbar. */}
      <div className={`grid grid-cols-1 gap-4 ${kindShows(series.profile, "start_number") || form.start_number ? "sm:grid-cols-[10rem_1fr]" : ""}`}>
        {(kindShows(series.profile, "start_number") || form.start_number) && <TextField label="Startnummer" maxLength={10} value={form.start_number} onChange={set("start_number")} testId="participant-edit-number" />}
        <TextField label="Standard-Team" maxLength={120} value={form.default_team} onChange={set("default_team")} testId="participant-edit-team"
          hint="Gilt, wenn im Ergebnis kein Team steht." />
      </div>
      {/* #1960: Teamwertung nach aktueller Besetzung - wer ohne Fahrt umgesetzt wurde oder die Liga verlassen hat. */}
      {series.rules?.team_scoring?.mode === "current_lineup" && (
        <TextField label="Aktuelles Team (von Hand)" maxLength={120} value={form.current_team} onChange={set("current_team")} testId="participant-edit-current-team"
          hint="Leer: das Team der letzten Fahrt. „Ersatzfahrer“ heißt: in keinem Team (etwa nach dem Ausstieg)." />
      )}
      <div className="space-y-3">
        <SelectField label="Zuordnung" value={form.link} onChange={set("link")} options={linkOptions} testId="participant-edit-link" />
        {form.link === "member" && (
          <SelectField label="Mitglied" value={form.profile_id} onChange={set("profile_id")} options={profileOptions} testId="participant-edit-profile" />
        )}
        <p className="text-xs text-white/55 leading-relaxed">{LINK_HINT} {ALIAS_HINT}</p>
      </div>
      <LearnedSpellings items={form.read_aliases.map((name) => ({ key: name, label: name }))}
        removed={learnedNames(row).length - form.read_aliases.length} testId="participant-edit-read-aliases"
        onRemove={(name) => set("read_aliases")(form.read_aliases.filter((item) => item !== name))}
        hint="So stand der Name in Ergebnis-Bildern, bevor ihr ihn im Blatt korrigiert habt – die Bild-Erkennung erkennt ihn daran wieder." />
      {row.in_results && (
        <p className="text-xs text-white/55 leading-relaxed" data-testid="participant-edit-in-results">
          Steht in Ergebnissen dieser Saison und lässt sich deshalb nicht entfernen. Doppelt angelegt? Wählt beide in der Liste aus und führt sie zusammen.
        </p>
      )}
    </AdminSheet>
  );
}
