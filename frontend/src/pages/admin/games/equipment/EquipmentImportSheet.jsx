// „Aus <Spiel> übernehmen“ für die Ausrüstung (#2218): Einträge einer anderen Spielversion als eigene dieses Spiels - fehlende
// Kategorien kommen mit, Aufsätze finden ihre Waffen über den Namen, das Bild wird mitverwendet. Die Quelle bleibt unberührt.
import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField } from "@/components/tls/FormFields";
import { countText } from "@/lib/loadoutBans";
import { toast } from "sonner";
import { useReportDirty } from "./useReportDirty";

export function equipmentImportText(result) {
  const created = result?.created?.length || 0;
  const skipped = result?.skipped || [];
  const parts = [`${countText(created, "Eintrag", "Einträge")} übernommen.`];
  if (skipped.length) parts.push(`${skipped.length} ausgelassen: ${skipped[0].name} – ${skipped[0].reason}`);
  return parts.join(" ");
}

function samePicks(left, right) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function EquipmentImportSheet({ game, onClose, onDone, onDirtyChange }) {
  const [sources, setSources] = useState(null);
  const [sourceId, setSourceId] = useState("");
  const [firstSource, setFirstSource] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [picked, setPicked] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [saving, setSaving] = useState(false);
  // Ungespeichert (#2218): ein anderes Spiel gewählt oder die Auswahl geändert - die geladene Vorauswahl selbst ist keine Änderung.
  useReportDirty(sources !== null && (sourceId !== firstSource || (candidates !== null && !samePicks(picked, suggested))), onDirtyChange);

  useEffect(() => {
    let live = true;
    api.get(`/games/${game.id}/equipment/import-sources`)
      .then(({ data }) => {
        if (!live) return;
        const rows = Array.isArray(data) ? data : [];
        setSources(rows);
        setSourceId(rows[0]?.id || "");
        setFirstSource(rows[0]?.id || "");
      })
      .catch((err) => { if (live) { setSources([]); toast.error(formatApiError(err.response?.data?.detail)); } });
    return () => { live = false; };
  }, [game.id]);

  useEffect(() => {
    if (!sourceId) return undefined;
    let live = true;
    setCandidates(null);
    api.get(`/games/${game.id}/equipment/import-sources/${sourceId}`)
      .then(({ data }) => {
        if (!live) return;
        const rows = Array.isArray(data?.items) ? data.items : [];
        const free = rows.filter((row) => !row.exists).map((row) => row.id);
        setCandidates(rows);
        setPicked(free);
        setSuggested(free);
      })
      .catch((err) => { if (live) { setCandidates([]); toast.error(formatApiError(err.response?.data?.detail)); } });
    return () => { live = false; };
  }, [game.id, sourceId]);

  // Nach Kategorie der Quelle gruppiert - bei vielen Aufsätzen bleibt es so lesbar.
  const groups = useMemo(() => {
    const out = [];
    for (const row of candidates || []) {
      const label = row.category_label || "Ohne Kategorie";
      let group = out.find((entry) => entry.label === label);
      if (!group) {
        group = { label, rows: [] };
        out.push(group);
      }
      group.rows.push(row);
    }
    return out;
  }, [candidates]);

  const source = (sources || []).find((row) => row.id === sourceId);
  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const toggleGroup = (rows) => {
    const free = rows.filter((row) => !row.exists).map((row) => row.id);
    const all = free.every((id) => picked.includes(id));
    setPicked((list) => (all ? list.filter((id) => !free.includes(id)) : [...new Set([...list, ...free])]));
  };
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post(`/games/${game.id}/equipment/import`, { source_game_id: sourceId, item_ids: picked });
      if ((data?.skipped || []).length) toast.warning(equipmentImportText(data));
      else toast.success(equipmentImportText(data));
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={source ? `Aus ${source.name} übernehmen` : "Ausrüstung übernehmen"} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={`${countText(picked.length, "Eintrag", "Einträge")} übernehmen`} savingLabel="Übernehme …" submitDisabled={!picked.length}
      submitTestId="equipment-import-save" testId="equipment-import-sheet">
      {sources === null ? <p className="text-sm text-white/60">Lade Spiele …</p> : null}
      {sources && !sources.length ? <p className="text-sm text-white/60" data-testid="equipment-import-none">Kein anderes Spiel hat aktive Ausrüstung.</p> : null}
      {sources?.length ? (
        <>
          <SelectField label="Aus welchem Spiel?" value={sourceId} onChange={setSourceId}
            options={sources.map((row) => [row.id, `${row.name} (${row.items})`])} testId="equipment-import-source" />
          <p className="text-xs text-white/60">Es entstehen eigene Einträge dieses Spiels. Fehlende Kategorien kommen dazu, Aufsätze bekommen die Waffen gleichen Namens – darum Waffen mit übernehmen. Die Quelle bleibt unverändert.</p>
          {candidates === null ? <p className="text-sm text-white/60">Lade Einträge …</p> : (
            <div className="space-y-4" data-testid="equipment-import-list">
              {groups.map((group) => (
                <fieldset key={group.label} className="space-y-1">
                  <legend className="flex w-full items-center justify-between gap-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
                    <span className="truncate">{group.label}</span>
                    <button type="button" onClick={() => toggleGroup(group.rows)} className="tls-btn tls-btn--quiet shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Alle</button>
                  </legend>
                  {group.rows.map((row) => (
                    <label key={row.id} data-testid={`equipment-import-row-${row.id}`}
                      className={`flex items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-2.5 py-2 text-sm ${row.exists ? "text-white/45" : "cursor-pointer text-white/85"}`}>
                      <input type="checkbox" disabled={row.exists} checked={picked.includes(row.id)} onChange={() => toggle(row.id)} className="accent-[#29B6E8]" aria-label={row.name} />
                      <span className="min-w-0 flex-1 break-words">{row.name}</span>
                      {row.exists ? <span className="shrink-0 text-[11px] text-white/50">schon da</span> : null}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </>
      ) : null}
    </AdminSheet>
  );
}
