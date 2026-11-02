// „Aus <Spiel> übernehmen“ (#2129, SP4): Maps einer anderen Spielversion als eigene Maps dieses Spiels anlegen - ohne Doppel,
// das Bild wird mitverwendet, Modi nur soweit dieses Spiel sie kennt. Die Quelle und gespeicherte Pools bleiben unberührt.
import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField } from "@/components/tls/FormFields";
import { toast } from "sonner";

export function importResultText(result) {
  const created = result?.created?.length || 0;
  const skipped = result?.skipped || [];
  const parts = [created === 1 ? "1 Map übernommen." : `${created} Maps übernommen.`];
  if (skipped.length) parts.push(`${skipped.length} ausgelassen: ${skipped[0].reason}`);
  return parts.join(" ");
}

export function MapImportSheet({ game, onClose, onDone }) {
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/games/${game.id}/maps/import-sources`)
      .then(({ data }) => {
        if (!live) return;
        const rows = Array.isArray(data) ? data : [];
        setSources(rows);
        setSourceId(rows[0]?.id || "");
      })
      .catch((err) => { if (live) { setSources([]); toast.error(formatApiError(err.response?.data?.detail)); } });
    return () => { live = false; };
  }, [game.id]);

  useEffect(() => {
    if (!sourceId) return undefined;
    let live = true;
    setCandidates(null);
    api.get(`/games/${game.id}/maps/import-sources/${sourceId}`)
      .then(({ data }) => {
        if (!live) return;
        const rows = Array.isArray(data?.maps) ? data.maps : [];
        setCandidates(rows);
        setPicked(rows.filter((row) => !row.exists).map((row) => row.id));
      })
      .catch((err) => { if (live) { setCandidates([]); toast.error(formatApiError(err.response?.data?.detail)); } });
    return () => { live = false; };
  }, [game.id, sourceId]);

  const source = (sources || []).find((row) => row.id === sourceId);
  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post(`/games/${game.id}/maps/import`, { source_game_id: sourceId, map_ids: picked });
      if ((data?.skipped || []).length) toast.error(importResultText(data));
      else toast.success(importResultText(data));
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={source ? `Aus ${source.name} übernehmen` : "Maps übernehmen"} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={picked.length === 1 ? "1 Map übernehmen" : `${picked.length} Maps übernehmen`} savingLabel="Übernehme …" submitDisabled={!picked.length}
      submitTestId="map-import-save" testId="map-import-sheet">
      {sources === null ? <p className="text-sm text-white/50">Lade Spiele …</p> : null}
      {sources && !sources.length ? <p className="text-sm text-white/60" data-testid="map-import-none">Kein anderes Spiel hat aktive Maps.</p> : null}
      {sources?.length ? (
        <>
          <SelectField label="Aus welchem Spiel?" value={sourceId} onChange={setSourceId}
            options={sources.map((row) => [row.id, `${row.name} (${row.maps})`])} testId="map-import-source" />
          <p className="text-xs text-white/50">Es entstehen eigene Maps dieses Spiels. Das Bild wird mitverwendet, die Modi nur soweit {game.name} sie kennt. Die Quelle bleibt unverändert.</p>
          {candidates === null ? <p className="text-sm text-white/50">Lade Maps …</p> : (
            <ul className="space-y-1" data-testid="map-import-list">
              {candidates.map((row) => (
                <li key={row.id} data-testid={`map-import-row-${row.id}`} className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-2.5 py-2 text-sm">
                  <label className={`flex min-w-0 flex-1 items-center gap-2 ${row.exists ? "text-white/40" : "cursor-pointer text-white/85"}`}>
                    <input type="checkbox" disabled={row.exists} checked={picked.includes(row.id)} onChange={() => toggle(row.id)} className="accent-[#29B6E8]" aria-label={row.name} />
                    <span className="truncate">{row.name}</span>
                  </label>
                  <span className="shrink-0 text-[11px] text-white/45">{row.exists ? "schon da" : (row.modes || []).join(", ") || "ohne Modus"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </AdminSheet>
  );
}
