import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { UnknownNamesSheet } from "./UnknownNamesSheet";
import { toast } from "sonner";
import { Plus, UserSearch } from "lucide-react";

// Teilnehmer und Zuordnung (#1743): die Namen der Saison wie beim Veranstalter, je als Mitglied (mit Profil), Gast,
// Extern oder noch offen. Offene Namen ordnet der Dialog „Unbekannte Namen“ zu. Aliase und Verknüpfungen sieht nur
// die Verwaltung (Bereich Redaktion). Bekommt `series` (samt `lineage`).

const LINK_LABELS = { member: "Mitglied", guest: "Gast", external: "Extern" };

export function splitNames(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function countsText(counts = {}) {
  const count = (value, one, many) => `${value || 0} ${value === 1 ? one : many}`;
  return [
    count(counts.member, "Mitglied", "Mitglieder"),
    count(counts.guest, "Gast", "Gäste"),
    `${counts.external || 0} Extern`,
    `${counts.open || 0} offen`,
  ].join(" · ");
}

function linkText(row) {
  if (row.link_status === "open") return "Offen";
  if (row.link === "member") return row.profile_name ? `Mitglied · ${row.profile_name}` : LINK_LABELS.member;
  if (row.link === "guest") return row.guest_name && row.guest_name !== row.name ? `Gast · ${row.guest_name}` : LINK_LABELS.guest;
  return LINK_LABELS[row.link] || LINK_LABELS.external;
}

const LINK_TONE = { member: "text-[#29B6E8]", guest: "text-white/75", external: "text-white/45" };

function AddNamesSheet({ series, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const names = splitNames(text);
    if (!names.length) {
      toast.error("Bitte mindestens einen Namen eintragen.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/reference-series/admin/series/${series.id}/participants/batch`, { names });
      const created = data.created || [];
      const recognised = created.filter((row) => row.link_status !== "open").length;
      toast.success([`${created.length} hinzugefügt`, recognised ? `${recognised} schon erkannt` : "", data.skipped ? `${data.skipped} übersprungen` : ""].filter(Boolean).join(" · "));
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Namen hinzufügen" eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving} submitLabel="Hinzufügen" submitTestId="participants-add-save" testId="participants-add">
      <TextAreaField label="Namen" rows={10} value={text} onChange={setText} testId="participants-add-names"
        hint="Ein Name je Zeile, so wie beim Veranstalter. Schon vorhandene werden übersprungen, bekannte Namen gleich zugeordnet." />
    </AdminSheet>
  );
}

export function SeriesParticipantsSection({ series }) {
  const [data, setData] = useState({ participants: [], counts: {} });
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get(`/reference-series/admin/series/${series.id}/participants`);
      setData({ participants: result?.participants || [], counts: result?.counts || {} });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const counts = data.counts || {};
  const open = counts.open || 0;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="series-participants">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Teilnehmer</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-white/45 font-bold" data-testid="series-participants-counts">
            {countsText(counts)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button type="button" onClick={() => setResolving(true)} data-testid="series-unknown-open"
            className={`tls-btn ${open ? "tls-btn--primary" : "tls-btn--secondary"} px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5`}>
            <UserSearch className="w-3.5 h-3.5" /> Unbekannte Namen ({open})
          </button>
          <button type="button" onClick={() => setAdding(true)} data-testid="series-participants-add"
            className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Namen
          </button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-white/5" data-testid="series-participants-list">
        {data.participants.map((row) => (
          <li key={row.id} className="py-2 flex items-center justify-between gap-3" data-testid={`participant-${row.id}`}>
            <div className="min-w-0">
              <span className="font-bold text-white break-words">{row.name}</span>
              {(row.start_number || row.default_team) && (
                <span className="ml-2 text-sm text-white/55">{[row.start_number && `Nr. ${row.start_number}`, row.default_team].filter(Boolean).join(" · ")}</span>
              )}
            </div>
            <span className={`shrink-0 text-[10px] uppercase tracking-widest font-bold ${row.link_status === "open" ? "text-brand" : LINK_TONE[row.link] || ""}`} data-testid={`participant-link-${row.id}`}>
              {linkText(row)}
            </span>
          </li>
        ))}
        {data.participants.length === 0 && <li className="py-2 text-sm text-white/40">Noch keine Teilnehmer.</li>}
      </ul>
      {adding && <AddNamesSheet series={series} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {resolving && <UnknownNamesSheet series={series} onClose={() => { setResolving(false); load(); }} onChanged={load} />}
    </section>
  );
}
