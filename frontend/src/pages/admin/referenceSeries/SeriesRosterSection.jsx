import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { parseLineupPaste } from "@/lib/lineupPaste";
import { ownTeamMatcher, rosterFor } from "@/lib/teamLeagueEntry";
import { toast } from "sonner";
import { ClipboardList, X } from "lucide-react";

// Kader je Saison-Team (#1931): wer für ein eigenes Team der Saison spielt (#1926). Der Kader ist das Team der
// Teilnehmer (`default_team`) - „Kader einfügen“ legt neue Namen gleich mit dem Team an und ordnet vorhandene zu, das
// Kreuz nimmt jemanden wieder heraus (das Team wird geleert, der Teilnehmer bleibt). Die Ankreuzliste im Ergebnisblatt
// und die Einsätze auf der Serienseite („5 von 7 Spielen“) lesen diesen Kader. Nur für den Vorstand.

const LINK_LABELS = { member: "Mitglied", guest: "Gast", external: "Extern" };

function linkLabel(row) {
  return row.link_status === "open" ? "offen" : LINK_LABELS[row.link] || LINK_LABELS.external;
}

function RosterPasteSheet({ series, team, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseLineupPaste(text), [text]);
  const save = async (event) => {
    event.preventDefault();
    const names = parsed.rows.map((row) => row.name);
    if (!names.length) {
      toast.error("Bitte mindestens einen Namen einfügen.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/reference-series/admin/series/${series.id}/participants/batch`, { names, team });
      const created = data.created?.length || 0;
      const assigned = data.assigned?.length || 0;
      toast.success([`${created} neu im Kader`, assigned ? `${assigned} zugeordnet` : "", data.skipped ? `${data.skipped} schon dabei` : ""].filter(Boolean).join(" · "));
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminSheet title={`Kader ${team}`} eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving}
      submitLabel={parsed.rows.length ? `${parsed.rows.length} übernehmen` : "Übernehmen"} submitTestId="roster-paste-save" testId="roster-paste">
      <TextAreaField label="Namen" rows={10} value={text} onChange={setText} testId="roster-paste-names"
        placeholder={"Seasonteam-Mitglieder\tWarorga\nName A\nName B"}
        hint="Ein Name je Zeile, so wie beim Veranstalter – gern die Liste „Seasonteam-Mitglieder“ von der Match-Seite. Häkchen-Spalten und die Kopfzeile stören nicht. Neue Namen kommen gleich in den Kader, vorhandene werden zugeordnet." />
      {parsed.errors.length > 0 && (
        <ul className="text-xs text-red-200 space-y-0.5" role="alert" data-testid="roster-paste-errors">
          {parsed.errors.map((error, index) => <li key={index}>{error.line ? `Zeile ${error.line}: ` : ""}{error.message}</li>)}
        </ul>
      )}
      {parsed.rows.length > 0 && <p className="text-xs text-white/55" data-testid="roster-paste-count">{parsed.rows.map((row) => row.name).join(", ")}</p>}
    </AdminSheet>
  );
}

export function SeriesRosterSection({ series }) {
  const [participants, setParticipants] = useState([]);
  const [pasting, setPasting] = useState(null);
  const [busy, setBusy] = useState(false);
  const teams = useMemo(() => (series.own_teams?.length ? series.own_teams : [{ name: series.team_name, aliases: [] }]).filter((team) => team?.name), [series]);
  const isOwn = useMemo(() => ownTeamMatcher(teams), [teams]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${series.id}/participants`);
      setParticipants(data?.participants || []);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const remove = async (row) => {
    setBusy(true);
    try {
      await api.patch(`/reference-series/admin/series/${series.id}/participants/${row.id}`, { default_team: null });
      toast.success(`${row.name} ist nicht mehr im Kader.`);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="series-roster" aria-labelledby="series-roster-title">
      <h2 id="series-roster-title" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Kader</h2>
      <p className="mt-1 max-w-[75ch] text-xs text-white/55">
        Wer für ein eigenes Team spielt. Im Ergebnis wird die Aufstellung aus dem Kader angekreuzt; wer im Kader steht und nicht aufgestellt ist, gilt an dem Spieltag als Ersatz.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {teams.map((team) => {
          const roster = rosterFor(participants, team.name, isOwn);
          return (
            <div key={team.name} className="border border-white/10 rounded-sm bg-[#0A0A0A] p-3" data-testid="roster-team">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-white break-words">{team.name}</div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">{roster.length} Spieler</div>
                </div>
                <button type="button" onClick={() => setPasting(team.name)} data-testid="roster-paste-open"
                  className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 shrink-0">
                  <ClipboardList className="w-3.5 h-3.5" /> Kader einfügen
                </button>
              </div>
              {roster.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="roster-players">
                  {roster.map((row) => (
                    <li key={row.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 min-h-[32px] border border-white/10 rounded-sm text-xs text-white/85" data-testid="roster-player">
                      {row.name}
                      <span className={`text-[9px] font-bold uppercase tracking-widest ${row.link === "member" && row.link_status !== "open" ? "text-[#29B6E8]" : "text-white/40"}`}>{linkLabel(row)}</span>
                      <button type="button" disabled={busy} onClick={() => remove(row)} aria-label={`${row.name} aus dem Kader nehmen`} data-testid="roster-remove"
                        className="tls-hit p-1 text-white/40 hover:text-white disabled:opacity-40"><X className="w-3.5 h-3.5" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-white/45" data-testid="roster-empty">Noch niemand im Kader.</p>}
            </div>
          );
        })}
      </div>
      {pasting && <RosterPasteSheet series={series} team={pasting} onClose={() => setPasting(null)} onSaved={() => { setPasting(null); load(); }} />}
    </section>
  );
}
