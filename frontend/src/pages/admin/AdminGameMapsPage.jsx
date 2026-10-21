// Map-Bibliothek eines Spiels bzw. einer Spielversion (#1616) unter /admin/games/<id>/maps - erreichbar aus der
// Spieleliste. Je Map: Name, Slug (eindeutig je Spiel, bleibt beim Umbenennen), Bild über Upload oder Mediathek, Modi
// des Spiels (dieselben wie für die Dauer, kein zweites Modussystem), Notiz, externe Kennung, Reihenfolge, aktiv oder
// archiviert. Was in einem gespeicherten Pool steht, lässt sich nur archivieren - der Pool behält Name und Bild von
// damals. Keine eingebauten Hersteller-Maps: jede Map legt die Verwaltung selbst an.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowLeft, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MapCard } from "@/components/tls/maps/MapPoolView";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { mapFormPayload, mapToForm } from "@/lib/mapPools";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";

function poolsText(count) {
  if (!count) return "in keinem Pool";
  return count === 1 ? "in 1 Pool" : `in ${count} Pools`;
}

function MapSheet({ game, item, onClose, onSaved }) {
  const [form, setForm] = useState(() => mapToForm(item));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleMode = (mode) => set("modes", form.modes.includes(mode) ? form.modes.filter((key) => key !== mode) : [...form.modes, mode]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = mapFormPayload(form);
      if (item?.id) await api.patch(`/games/${game.id}/maps/${item.id}`, payload);
      else await api.post(`/games/${game.id}/maps`, payload);
      toast.success(item?.id ? "Map gespeichert." : "Map angelegt.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  return (
    <AdminSheet title={item?.id ? "Map bearbeiten" : "Map hinzufügen"} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitTestId="game-map-save" testId="game-map-sheet">
      <FormGrid>
        <TextField label="Name" required maxLength={80} value={form.name} onChange={(value) => set("name", value)} placeholder="z. B. Hafenkante" testId="game-map-name" />
        <TextField label="Slug" maxLength={80} value={form.slug} onChange={(value) => set("slug", value)}
          placeholder={item?.id ? "" : "leer: aus dem Namen"} hint="Eindeutig in diesem Spiel; bleibt beim Umbenennen gleich." testId="game-map-slug" />
      </FormGrid>
      <TextField label="Weitere Schreibweisen" value={form.aliases} onChange={(value) => set("aliases", value)} placeholder="z. B. Harbour Edge, Hafen"
        hint="Mit Komma getrennt, etwa wie der Veranstalter die Map nennt – das Ergebnisblatt der Team-Liga erkennt sie daran." testId="game-map-aliases" />
      <ImageUpload value={form.image_url} onChange={(value) => set("image_url", value || "")} label="Bild (16 : 9)" testId="game-map-image" variant="wide" allowLibrary />
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Modi</legend>
        {game.modes.length ? (
          <div className="flex flex-wrap gap-2">
            {game.modes.map(({ mode, label }) => {
              const on = form.modes.includes(mode);
              return (
                <label key={mode} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${on ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65 hover:border-white/25"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleMode(mode)} className="accent-[#29B6E8]" />
                  {label}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-white/45">Das Spiel hat keine Modi – die Map gilt dann für jeden Pool. Modi legst du unter „Spiel bearbeiten → Für Turniere“ an.</p>
        )}
        {game.modes.length ? <p className="text-xs text-white/45">Nur in den gewählten Modi kann die Map in einen Pool. Kein Modus: in keinem Pool wählbar.</p> : null}
      </fieldset>
      <TextAreaField label="Notiz" rows={2} value={form.note} onChange={(value) => set("note", value)} placeholder="nur für die Verwaltung" testId="game-map-note" />
      <TextField label="Externe Kennung" maxLength={120} value={form.external_ref} onChange={(value) => set("external_ref", value)}
        hint="Etwa die Kennung beim Veranstalter – freiwillig." testId="game-map-external" />
    </AdminSheet>
  );
}

export default function AdminGameMapsPage() {
  const { gameId } = useParams();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/games/${gameId}/maps`);
      setData(body);
      setMissing("");
    } catch (err) {
      setMissing(formatApiError(err.response?.data?.detail));
    }
  }, [gameId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["games"]);

  const act = async (action, success) => {
    try {
      await action();
      if (success) toast.success(success);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const maps = data?.maps || [];
  const archivedCount = maps.filter((item) => item.status === "archived").length;
  const shown = maps.filter((item) => showArchived || item.status !== "archived");
  const labels = Object.fromEntries((data?.game?.modes || []).map(({ mode, label }) => [mode, label]));
  const move = (item, delta) => {
    const ids = maps.map((row) => row.id);
    const from = ids.indexOf(item.id);
    const visible = shown.map((row) => row.id);
    const neighbour = visible[visible.indexOf(item.id) + delta];
    const to = ids.indexOf(neighbour);
    if (from < 0 || to < 0) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    act(() => api.put(`/games/${gameId}/maps/order`, { ids }));
  };
  const setStatus = (item, status) => act(() => api.patch(`/games/${gameId}/maps/${item.id}`, { status }),
    status === "archived" ? "Map archiviert." : "Map zurückgeholt.");
  const remove = async (item) => {
    if (!await confirm({ title: `„${item.name}“ löschen?`, description: "Die Map stand noch in keinem Pool und wird dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
    act(() => api.delete(`/games/${gameId}/maps/${item.id}`), "Map gelöscht.");
  };

  return (
    <AdminLayout>
      <Link to="/admin/games" data-testid="game-maps-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="w-3.5 h-3.5" /> Spiele
      </Link>
      {missing ? <p className="mt-6 text-white/60" data-testid="game-maps-missing">{missing}</p> : null}
      {data ? (
        <>
          <div className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spiele</span>
              <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 break-words">Maps · {data.game.name}</h1>
              <p className="mt-1 text-sm text-white/55">
                Turniere, Phasen und Saisons wählen daraus ihren Map-Pool. Spätere Änderungen hier ändern keinen gespeicherten Pool.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {archivedCount ? (
                <label className="inline-flex items-center gap-2 text-xs text-white/65">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[#29B6E8]" data-testid="game-maps-show-archived" />
                  Archivierte zeigen ({archivedCount})
                </label>
              ) : null}
              <button type="button" onClick={() => setEditing({})} disabled={maps.length >= (data.limit || 200)} data-testid="game-maps-add"
                className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> Map hinzufügen
              </button>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-white/55" data-testid="game-maps-modes">
            <span className="font-bold uppercase tracking-widest text-white/45 text-[11px]">Modi</span>
            {data.game.modes.length ? data.game.modes.map(({ mode, label }) => (
              <span key={mode} className="px-2 py-0.5 rounded-sm border border-white/10 bg-[#0A0A0A] text-white/70">{label}</span>
            )) : <span>keine – Maps gelten dann für jeden Pool</span>}
          </div>
          {shown.length === 0 ? (
            <p className="border border-dashed border-white/15 rounded-sm px-4 py-6 text-sm text-white/55" data-testid="game-maps-empty">
              Noch keine Map. Lege die Maps an, die in Turnieren und Saisons gespielt werden – mit Bild, damit Pools und Spieltage sie zeigen.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {shown.map((item, index) => {
                const archived = item.status === "archived";
                return (
                  <li key={item.id} className={`border border-white/10 rounded-sm bg-[#121212] p-2 ${archived ? "opacity-60" : ""}`}
                    data-testid={`game-map-card-${item.slug}`} data-slug={item.slug}>
                    <MapCard item={item} index={index} position={archived ? null : index + 1}
                      sizes="(min-width: 1280px) 280px, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" />
                    <div className="mt-2 space-y-1 px-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-white/45">
                        <span className="truncate">{item.slug}</span>
                        <span className="shrink-0 tabular-nums">{archived ? "Archiviert · " : ""}{poolsText(item.in_pools)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 min-h-[1.25rem]">
                        {item.modes.length ? item.modes.map((mode) => (
                          <span key={mode} className="px-1.5 py-0.5 rounded-sm bg-white/5 text-[10px] font-bold uppercase tracking-wider text-white/70">{labels[mode] || mode}</span>
                        )) : data.game.modes.length ? <span className="text-[11px] text-[#FFD700]/80">keinem Modus zugeordnet</span> : null}
                      </div>
                      <div className="flex items-center justify-between gap-1 pt-1">
                        <span className="flex items-center">
                          <button type="button" className={ICON_BUTTON} onClick={() => move(item, -1)} disabled={index === 0} aria-label={`${item.name} nach vorne`} data-testid={`game-map-up-${item.slug}`}><ArrowUp className="w-4 h-4" /></button>
                          <button type="button" className={ICON_BUTTON} onClick={() => move(item, 1)} disabled={index === shown.length - 1} aria-label={`${item.name} nach hinten`} data-testid={`game-map-down-${item.slug}`}><ArrowDown className="w-4 h-4" /></button>
                        </span>
                        <span className="flex items-center">
                          <button type="button" className={ICON_BUTTON} onClick={() => setEditing(item)} aria-label={`${item.name} bearbeiten`} data-testid={`game-map-edit-${item.slug}`}><Pencil className="w-4 h-4" /></button>
                          <button type="button" className={ICON_BUTTON} onClick={() => setStatus(item, archived ? "active" : "archived")}
                            aria-label={archived ? `${item.name} zurückholen` : `${item.name} archivieren`} data-testid={`game-map-archive-${item.slug}`}>
                            {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                          </button>
                          <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-[#FF3B30]")} onClick={() => remove(item)} disabled={item.in_pools > 0}
                            title={item.in_pools > 0 ? "Steht in einem gespeicherten Pool – archivieren statt löschen" : "Löschen"}
                            aria-label={`${item.name} löschen`} data-testid={`game-map-delete-${item.slug}`}><Trash2 className="w-4 h-4" /></button>
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {editing ? <MapSheet game={data.game} item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
        </>
      ) : null}
    </AdminLayout>
  );
}
