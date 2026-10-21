import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { toast } from "sonner";

// Zusammenführen (#1929): zwei Einträge derselben Person (zwei Schreibweisen). Gewählt wird, wer bleibt; der andere
// geht in ihm auf – seine Ergebnisse wandern mit, auch Entwürfe, danach rechnet der Server neu. Stehen beide im selben
// Ergebnis, lehnt der Server ab und sagt, wo; das Blatt bleibt dann offen. Bekommt genau zwei Teilnehmer.

/** Vorausgewählt bleibt der schon zugeordnete – sind beide offen oder beide zugeordnet, der erste. */
export function preferredKeep(rows) {
  const decided = rows.filter((row) => row.link_status !== "open");
  return (decided.length === 1 ? decided[0] : rows[0]).id;
}

export function ParticipantMergeSheet({ series, rows, describe, onClose, onSaved }) {
  const [keepId, setKeepId] = useState(() => preferredKeep(rows));
  const [saving, setSaving] = useState(false);
  const kept = rows.find((row) => row.id === keepId) || rows[0];
  const other = rows.find((row) => row.id !== kept.id);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`/reference-series/admin/series/${series.id}/participants/${kept.id}/merge`, { duplicate_id: other.id });
      toast.success(`Zusammengeführt: ${kept.name} bleibt.`);
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Zusammenführen" eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving} submitLabel="Zusammenführen" savingLabel="Führe zusammen …" submitTestId="participant-merge-save" testId="participant-merge">
      <p className="text-sm text-white/60 leading-relaxed">
        Für dieselbe Person unter zwei Schreibweisen. Der andere Eintrag geht im behaltenen auf: Seine Ergebnisse wandern mit, auch Entwürfe, danach wird neu gerechnet.
        Name und Zuordnung des behaltenen bleiben und gelten dann auch für die andere Schreibweise, in allen Saisons; fehlende Startnummer und fehlendes Team kommen dazu.
      </p>
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Welcher Eintrag bleibt?</legend>
        {rows.map((row) => {
          const on = row.id === kept.id;
          return (
            <label key={row.id} className={`flex items-start gap-3 rounded-sm border p-3 cursor-pointer transition-colors ${on ? "border-[#29B6E8]/60 bg-[#29B6E8]/[0.06]" : "border-white/10 hover:border-white/25"}`}>
              <input type="radio" name="participant-merge-keep" checked={on} onChange={() => setKeepId(row.id)} data-testid={`participant-merge-keep-${row.id}`} className="mt-1 shrink-0" style={{ accentColor: "#29B6E8" }} />
              <span className="min-w-0">
                <span className="block font-bold text-white break-words">{row.name}</span>
                <span className="block text-xs text-white/55">{describe(row)}</span>
                {row.in_results && <span className="block text-xs text-white/45">Steht in Ergebnissen</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-xs text-white/45 leading-relaxed">
        Stehen beide im selben Ergebnis, geht es nicht – dann erst dort eine der beiden Zeilen entfernen.
      </p>
    </AdminSheet>
  );
}
