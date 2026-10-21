import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField } from "@/components/tls/FormFields";
import { entryLine, entryName, targetOptions } from "@/lib/seasonClose";
import { AlertTriangle, User, Users } from "lucide-react";
import { toast } from "sonner";

// Saison abschließen (#1750): der Vorschlag mit den Endständen der Saison - je eigenem Team der Platz aus Tabelle bzw.
// Teamwertung, je Vereinsmitglied die Einzelwertung. Die Bestätigung legt die Referenz an oder aktualisiert die der
// Saison bzw. eine schon verknüpfte; der Server rechnet den Vorschlag dabei neu (services/season_close.py).

function openText(count) {
  return `${count} ${count === 1 ? "Termin" : "Termine"} ohne Ergebnis – der Vorschlag nimmt den letzten gespeicherten Stand.`;
}

export function SeasonCloseSheet({ series, label, preview, onClose, onDone }) {
  const [target, setTarget] = useState(() => preview?.current?.id || preview?.target_id || "");
  const [saving, setSaving] = useState(false);
  const entries = preview?.entries || [];

  const save = async (event) => {
    event.preventDefault();
    if (!entries.length) {
      toast.error("Noch kein Endstand – erst Ergebnisse oder die Tabelle des Veranstalters eintragen.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/reference-series/admin/series/${series.id}/close`, { reference_id: target || null });
      toast.success(data?.created ? "Saison abgeschlossen – die Referenz ist angelegt." : "Saison abgeschlossen – die Referenz ist aktualisiert.");
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Saison abschließen" eyebrow={label} size="lg" onClose={onClose} onSubmit={save} saving={saving}
      submitLabel={target ? "Referenz aktualisieren" : "Referenz anlegen"} savingLabel="Schließe ab …" submitTestId="season-close-save" testId="season-close">
      {!preview ? (
        <p className="text-sm text-white/50" data-testid="season-close-loading">Lade den Endstand …</p>
      ) : (
        <>
          <p className="text-sm text-white/60 leading-relaxed">
            Aus dem Endstand wird die Referenz: Team und Einzelwertungen mit Platz und Feldgröße, dazu die Vereinsspieler aus den Aufstellungen. Der Endplatz wird hier in der Saison gepflegt – erneut abschließen aktualisiert dieselbe Referenz.
          </p>
          {preview.cancelled && (
            <p className="border border-warn/40 bg-warn/10 rounded-sm px-3 py-2 text-sm text-white/80" data-testid="season-close-cancelled">
              Die Saison wurde abgebrochen – die Referenz bekommt keine Platzierung.
            </p>
          )}
          {preview.open_rounds > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warn" role="status" data-testid="season-close-open">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" /> {openText(preview.open_rounds)}
            </p>
          )}
          <section aria-labelledby="season-close-entries-title">
            <h3 id="season-close-entries-title" className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Endstand</h3>
            {entries.length === 0 ? (
              <p className="border border-dashed border-white/15 rounded-sm p-4 text-sm text-white/45" data-testid="season-close-empty">
                Noch kein Endstand – erst Ergebnisse eintragen oder die Tabelle des Veranstalters einfügen.
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => <EntryRow key={entry.key} entry={entry} />)}
              </ul>
            )}
          </section>
          <SelectField label="Referenz" value={target} onChange={setTarget} options={targetOptions(preview)} testId="season-close-target"
            hint={preview.current
              ? "Die Saison hat schon ihre Referenz – sie wird aktualisiert, nie doppelt angelegt. Titel und Texte bleiben."
              : "Gehört schon eine Referenz zur Saison, wird sie aktualisiert statt doppelt angelegt. Titel und Texte bleiben."} />
        </>
      )}
    </AdminSheet>
  );
}

function EntryRow({ entry }) {
  const solo = entry.kind === "solo";
  const Icon = solo ? User : Users;
  const people = solo ? [] : (entry.members || []).map((member) => member.name);
  return (
    <li className="flex items-start gap-3 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2.5" data-testid={`season-close-entry-${entry.key}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-[#29B6E8]" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold text-white break-words [overflow-wrap:anywhere]">{entryName(entry)}</span>
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/45">{solo ? "Einzel" : "Team"}</span>
        </span>
        <span className="block text-sm text-white/70 tabular-nums">{entryLine(entry)}</span>
        {people.length > 0 && <span className="block text-xs text-white/45 break-words">{people.join(", ")}</span>}
      </span>
    </li>
  );
}
