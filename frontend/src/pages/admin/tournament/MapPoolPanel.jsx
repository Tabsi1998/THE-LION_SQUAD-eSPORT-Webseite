// Reiter „Maps“ im Turnier (#1616): der Pool des Turniers und je Phase entweder „übernimmt den Pool des Turniers“ oder
// ein eigener Pool. Schreiben dürfen Turnierleitung und Strukturrollen (wie bei den Phasen) - der Server prüft das.
import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MapPoolEditor } from "@/pages/admin/maps/MapPoolEditor";
import { toast } from "sonner";

function stageLine(row) {
  if (!row.pool) return "übernimmt den Pool des Turniers";
  return `eigener Pool · Version ${row.pool.version}${row.pool.stale ? " · gehört zu einem anderen Spiel" : ""}`;
}

export function MapPoolPanel({ tournamentId, canEdit = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/map-pools/tournaments/${tournamentId}/admin`);
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["map-pools", "games"]);

  // 409: inzwischen hat jemand anderes gespeichert - Hinweis zeigen und den aktuellen Stand laden.
  const failed = async (err) => {
    toast.error(formatApiError(err.response?.data?.detail));
    if (err.response?.status === 409) await load();
    return false;
  };
  const save = (path) => async (body) => {
    try {
      await api.put(`/map-pools/tournaments/${tournamentId}${path}`, body);
      toast.success("Map-Pool gespeichert.");
      await load();
      return true;
    } catch (err) {
      return failed(err);
    }
  };
  const clear = (path, question) => async () => {
    if (!await confirm(question)) return false;
    try {
      await api.delete(`/map-pools/tournaments/${tournamentId}${path}`);
      toast.success("Map-Pool entfernt.");
      await load();
      return true;
    } catch (err) {
      return failed(err);
    }
  };

  if (error) return <p className="text-sm text-white/60" data-testid="map-pool-panel-error">{error}</p>;
  if (!data) return <p className="text-sm text-white/50">Lade Maps …</p>;
  const tournamentPool = data.tournament && !data.tournament.stale ? data.tournament : null;
  const sources = tournamentPool ? [{ key: "tournament", label: "Pool des Turniers", pool: tournamentPool }] : [];

  return (
    <div className="space-y-4" data-testid="map-pool-panel">
      <MapPoolEditor
        key={`t-${data.tournament?.id || "neu"}`}
        title="Map-Pool des Turniers"
        hint="Gilt für alle Phasen ohne eigenen Pool. Ein Speichern ist eine neue Version – Spiele, die eine Version festhalten, behalten sie."
        game={data.game} library={data.library} entry={data.tournament} canEdit={canEdit} libraryLink
        onSave={save("")}
        onClear={clear("", { title: "Map-Pool entfernen?", description: "Phasen ohne eigenen Pool haben dann keine Maps mehr. Gespeicherte Versionen bleiben nachlesbar.", confirmLabel: "Entfernen" })}
        testId="tournament-pool"
      />
      {data.game && (data.stages || []).length ? (
        <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="stage-pools-heading" data-testid="stage-pools">
          <h3 id="stage-pools-heading" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Phasen</h3>
          <p className="mt-0.5 text-xs text-white/50">Eine Phase mit eigenem Pool, etwa ein Finale mit anderen Maps, überschreibt den des Turniers.</p>
          <ul className="mt-3 space-y-2">
            {data.stages.map((row) => (
              <li key={row.stage_id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border border-white/10 rounded-sm bg-[#0A0A0A] px-3 py-2" data-testid={`stage-pool-row-${row.stage_id}`}>
                  <span className="min-w-0 text-sm text-white">
                    <span className="font-semibold">{row.name || `Phase ${row.number}`}</span>
                    <span className="ml-2 text-xs text-white/55">{stageLine(row)}</span>
                  </span>
                  {canEdit ? (
                    <button type="button" onClick={() => setOpen((state) => ({ ...state, [row.stage_id]: !state[row.stage_id] }))}
                      aria-expanded={Boolean(open[row.stage_id])} data-testid={`stage-pool-edit-${row.stage_id}`}
                      className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider">
                      {open[row.stage_id] ? "Schließen" : row.pool ? "Bearbeiten" : "Eigenen Pool festlegen"}
                    </button>
                  ) : null}
                </div>
                {open[row.stage_id] ? (
                  <MapPoolEditor
                    key={`s-${row.stage_id}-${row.pool?.id || "neu"}`}
                    title={`Eigener Pool · ${row.name || `Phase ${row.number}`}`}
                    game={data.game} library={data.library} entry={row.pool} sources={sources} canEdit={canEdit}
                    onSave={save(`/stages/${row.stage_id}`)}
                    onClear={clear(`/stages/${row.stage_id}`, { title: "Eigenen Pool der Phase entfernen?", description: "Danach gilt wieder der Pool des Turniers.", confirmLabel: "Entfernen" })}
                    testId={`stage-pool-${row.stage_id}`}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
