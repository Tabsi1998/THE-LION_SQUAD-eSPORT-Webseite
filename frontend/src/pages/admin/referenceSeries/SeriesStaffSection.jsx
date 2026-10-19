import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { PersonAvatar, PersonPicker } from "@/components/tls/PersonPicker";
import { CheckField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { publishModeSentence, publishText, todayDay, validityText } from "@/lib/referenceSeriesStaff";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

// Captains der Saison (#1749): nur für den Vorstand. Hinzufügen per Personensuche mit Ablauf (Pflicht) und Recht zum
// Veröffentlichen; je Captain Ablauf ändern, Recht umschalten, entfernen. Jede Änderung protokolliert der Server.
// Ein Captain braucht Zwei-Faktor - fehlt sie am Konto, steht es dabei. Bekommt `series`.

function StaffRow({ row, seriesId, onSaved, onRemove }) {
  const [until, setUntil] = useState(row.valid_until || "");
  useEffect(() => setUntil(row.valid_until || ""), [row.valid_until]);

  const patch = async (body) => {
    try {
      await api.patch(`/reference-series/admin/series/${seriesId}/staff/${row.id}`, body);
      toast.success("Gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setUntil(row.valid_until || "");
    }
  };

  return (
    <li className={`rounded-sm border bg-[#0A0A0A] p-3 md:flex md:items-center md:gap-4 ${row.is_valid ? "border-white/10" : "border-white/5 opacity-70"}`} data-testid={`series-staff-row-${row.id}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <PersonAvatar person={row} />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{row.name}</div>
          <div className="text-xs text-white/55" data-testid={`series-staff-validity-${row.id}`}>
            {validityText(row)} · {publishText(row.publishes_directly)}
          </div>
          {!row.mfa_enabled && (
            <div className="text-xs text-[#FFD700]/80" data-testid={`series-staff-mfa-${row.id}`}>Zwei-Faktor fehlt noch – bis dahin kommt dieser Captain nicht in die Saison.</div>
          )}
          {!row.account_active && <div className="text-xs text-[#FFD700]/80">Konto ist gesperrt oder inaktiv.</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 md:mt-0 md:shrink-0">
        <TextField label="Gilt bis" type="date" value={until} min={todayDay()} onChange={setUntil} testId={`series-staff-until-${row.id}`} className="w-40" />
        {until && until !== row.valid_until && (
          <button type="button" onClick={() => patch({ valid_until: until })} data-testid={`series-staff-until-save-${row.id}`} className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
            Ablauf speichern
          </button>
        )}
        <CheckField label="Darf veröffentlichen" checked={row.can_publish} onChange={(value) => patch({ can_publish: value })} testId={`series-staff-publish-${row.id}`} className="pb-2" />
        <button type="button" onClick={() => onRemove(row)} aria-label={`${row.name} als Captain entfernen`} data-testid={`series-staff-remove-${row.id}`} className="tls-hit p-2 text-white/50 hover:text-white">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}

export function SeriesStaffSection({ series }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState("");
  const [person, setPerson] = useState(null);
  const [until, setUntil] = useState("");
  const [canPublish, setCanPublish] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const seriesId = series.id;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${seriesId}/staff`);
      setRows(data.staff || []);
      setFailed("");
    } catch (err) {
      setFailed(formatApiError(err.response?.data?.detail) || "Captains konnten nicht geladen werden.");
    }
  }, [seriesId]);

  useEffect(() => { load(); }, [load]);

  const add = async (event) => {
    event.preventDefault();
    if (!person || !until) return;
    setSaving(true);
    try {
      await api.post(`/reference-series/admin/series/${seriesId}/staff`, { user_id: person.id, valid_until: until, can_publish: canPublish });
      toast.success(`${person.name} ist jetzt Captain dieser Saison.`);
      setPerson(null);
      setUntil("");
      setCanPublish(false);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!await confirm({ title: `${row.name} als Captain entfernen?`, description: "Das Recht endet sofort. Bereits eingetragene Ergebnisse bleiben.", confirmLabel: "Entfernen" })) return;
    try {
      await api.delete(`/reference-series/admin/series/${seriesId}/staff/${row.id}`);
      toast.success("Captain entfernt.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="series-staff-heading" data-testid="series-staff">
      <h2 id="series-staff-heading" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Captains</h2>
      <p className="mt-1 text-sm text-white/60" data-testid="series-staff-mode">{publishModeSentence(series.publish_mode)}</p>
      {failed && <p className="mt-3 text-sm text-white/60" data-testid="series-staff-error">{failed}</p>}
      {rows && rows.length === 0 && <p className="mt-3 text-sm text-white/50" data-testid="series-staff-empty">Noch kein Captain. Ergebnisse trägt bis dahin der Vorstand ein.</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="series-staff-list">
          {rows.map((row) => <StaffRow key={row.id} row={row} seriesId={seriesId} onSaved={load} onRemove={remove} />)}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 border-t border-white/10 pt-4 space-y-3" data-testid="series-staff-add">
        <PersonPicker purpose="reference_series" value={person} onChange={setPerson} label="Captain hinzufügen" testId="series-staff-person" />
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="Gilt bis" type="date" required value={until} min={todayDay()} onChange={setUntil} hint="Meist das Saisonende." testId="series-staff-new-until" className="w-48" />
          <CheckField label="Darf veröffentlichen" checked={canPublish} onChange={setCanPublish} hint="Sonst sind die Einträge Entwürfe, die der Vorstand freigibt." testId="series-staff-new-publish" className="pb-2" />
        </div>
        <button type="submit" disabled={!person || !until || saving} data-testid="series-staff-submit" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Captain hinzufügen
        </button>
      </form>
    </section>
  );
}
