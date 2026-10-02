import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarCheck, Crown, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MaterialChip, Panel, errorText, personName } from "./shared";

const STATUS_LABELS = { active: "läuft", completed: "abgeschlossen", archived: "archiviert", planned: "geplant", draft: "Entwurf" };

/**
 * Saison (E10): was der Saisonabschluss vergibt - je Platz, als Vorschau vor dem Bestätigen (Saisonmeister,
 * Saisonspitze, Volle Saison), dazu der Saison-MVP von Hand. Abgeschlossen wird in der Jahreswertung; hier
 * lässt sich ein Abschluss nachholen.
 */
export function SeasonTab() {
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mvp, setMvp] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    api.get("/seasons").then(({ data }) => {
      const list = Array.isArray(data) ? data : [];
      setSeasons(list);
      const preferred = list.find((s) => s.status === "active") || list[0];
      if (preferred) setSeasonId((current) => current || preferred.id);
    }).catch(() => setSeasons([]));
  }, []);

  const load = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/achievements/season/${seasonId}/preview`);
      setPreview(data);
      setMvp("");
    } catch (err) {
      toast.error(errorText(err));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);

  const awardSeason = async () => {
    if (!await confirm({ title: "Saisonabschluss vergeben?", description: `Die Rangliste von „${preview.season.name}“ wird festgeschrieben und die Saison-Erfolge werden vergeben – so wie in der Vorschau.`, confirmLabel: "Vergeben" })) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/admin/achievements/season/${seasonId}/award`);
      toast.success(`${data.awarded} Erfolge vergeben · ${data.ranked} Plätze festgeschrieben`);
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const awardMvp = async () => {
    const row = preview.standings.find((r) => r.user_id === mvp);
    if (!row) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/award", { user_id: row.user_id, tier_code: preview.mvp.code, note: `Saison-MVP ${preview.season.name}` });
      if (data.already_awarded) toast.info(`${personName(row)} ist schon Saison-MVP.`);
      else toast.success(`${personName(row)} ist Saison-MVP von „${preview.season.name}“.`);
      load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const holders = new Set(preview?.mvp?.holders || []);
  return (
    <div className="space-y-6" data-testid="ach-season">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[16rem]">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Saison</span>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} data-testid="season-select" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {!seasons.length && <option value="">Keine Saison angelegt</option>}
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name} · {STATUS_LABELS[s.status] || s.status}</option>)}
          </select>
        </label>
        {preview && (
          <p className="text-xs text-white/50 pb-2" data-testid="season-summary">
            {preview.ranked} Plätze · {preview.awards_total} Erfolg{preview.awards_total === 1 ? "" : "e"} beim Abschluss{preview.already_written ? " · Rangliste schon festgeschrieben" : ""}
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-white/40">Lädt …</p>}
      {preview && !loading && (
        <>
          <Panel
            title={preview.finished ? "Saisonabschluss" : "Vorschau: wenn die Saison jetzt endet"}
            icon={CalendarCheck}
            accent="#29B6E8"
            hint={preview.finished
              ? "Die Saison ist abgeschlossen. Ein erneuter Abschluss schreibt die Rangliste neu und vergibt, was noch fehlt – doppelt wird nichts."
              : "Die Saison läuft noch. Abgeschlossen wird sie in der Jahreswertung (Status „abgeschlossen“) – dabei werden genau diese Erfolge vergeben."}
            actions={preview.finished ? (
              <button type="button" onClick={awardSeason} disabled={busy} data-testid="season-award" className="px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">Abschluss vergeben</button>
            ) : (
              <Link to="/admin/seasons" className="px-3 py-1.5 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-widest rounded-sm hover:text-white" data-testid="season-to-ranking">Zur Jahreswertung</Link>
            )}
            testId="season-preview"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-[10px] uppercase tracking-widest text-white/45">
                  <tr>
                    <th className="text-left py-2 pr-3 w-12">Platz</th>
                    <th className="text-left py-2 pr-3">Person</th>
                    <th className="text-right py-2 pr-3">Punkte</th>
                    <th className="text-left py-2 pr-3">Bekommt beim Abschluss</th>
                    {preview.mvp && <th className="text-center py-2 w-16">MVP</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {preview.standings.map((row) => (
                    <tr key={row.user_id || row.rank} data-testid={`season-row-${row.rank}`}>
                      <td className="py-2 pr-3 font-heading font-black tabular-nums" style={{ color: row.rank === 1 ? "#FFD700" : undefined }}>{row.rank}</td>
                      <td className="py-2 pr-3">{personName(row)} {row.username && <span className="text-[11px] text-white/35">@{row.username}</span>}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(row.points || 0).toLocaleString("de-DE")}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {row.awards.map((a) => (
                            <span key={a.code} className="inline-flex items-center gap-1 border border-white/10 rounded-sm px-1.5 py-0.5 text-[11px]" data-testid={`season-award-${a.code}`}>
                              {a.name} <MaterialChip tier={a} />
                            </span>
                          ))}
                          {!row.awards.length && <span className="text-[11px] text-white/30">–</span>}
                        </div>
                      </td>
                      {preview.mvp && (
                        <td className="py-2 text-center">
                          {holders.has(row.user_id)
                            ? <Crown className="inline w-4 h-4 text-[#FF3B30]" aria-label="schon Saison-MVP" />
                            : <input type="radio" name="season-mvp" checked={mvp === row.user_id} onChange={() => setMvp(row.user_id)} aria-label={`${personName(row)} als MVP`} data-testid={`season-mvp-${row.rank}`} />}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!preview.standings.length && <tr><td colSpan="5" className="py-6 text-center text-xs text-white/40">Noch keine Punkte in dieser Saison.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>

          {preview.mvp && (
            <Panel title="Saison-MVP" icon={Star} accent="#FF3B30" hint="Die Spielerin oder der Spieler der Saison – von der Vereinsleitung gewählt. In der Tabelle auswählen, dann auszeichnen." testId="season-mvp">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-white/70">{mvp ? `Ausgewählt: ${personName(preview.standings.find((r) => r.user_id === mvp))}` : "Noch niemand ausgewählt."}</span>
                <button type="button" onClick={awardMvp} disabled={busy || !mvp} data-testid="season-mvp-award" className="px-3 py-1.5 bg-[#FF3B30] text-white text-[10px] font-bold uppercase tracking-widest rounded-sm disabled:opacity-40">
                  Als Saison-MVP auszeichnen
                </button>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
