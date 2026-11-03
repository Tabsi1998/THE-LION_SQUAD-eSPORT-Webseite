// Map-Bibliothek eines Spiels bzw. einer Spielversion (#1616) unter /admin/games/<id>/maps - erreichbar aus der
// Spieleliste. Je Map: Name, Slug (eindeutig je Spiel, bleibt beim Umbenennen), Bild über Upload oder Mediathek, Modi
// des Spiels (dieselben wie für die Dauer, kein zweites Modussystem), Notiz, externe Kennung, Reihenfolge, aktiv oder
// archiviert. Was in einem gespeicherten Pool steht, lässt sich nur archivieren - der Pool behält Name und Bild von
// damals. Keine eingebauten Hersteller-Maps: jede Map legt die Verwaltung selbst an.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowLeft, ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MapCard } from "@/components/tls/maps/MapPoolView";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { mapFormPayload, mapToForm, mapsWithoutMode } from "@/lib/mapPools";
import { modeStatusOf } from "@/lib/gameMatchData";
import { MapPoolEditor } from "./maps/MapPoolEditor";
import { MapImportSheet } from "./maps/MapImportSheet";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";

function poolsText(count) {
  if (!count) return "in keinem Pool";
  return count === 1 ? "in 1 Pool" : `in ${count} Pools`;
}

// Maps ohne Modus (#2129, SP2): Sobald das Spiel Modi hat, steht eine Map ohne Modus in keinem Pool zur Wahl. Das sagt dieser
// Hinweis, statt sie still zu sperren; ein Klick ordnet alle zu. Vorbelegt sind alle Modi, abwählen geht vorher.
function WithoutModeNotice({ game, maps, onAssign }) {
  // Archivierte Modi stehen nicht zur Wahl (#2206), inaktive schon, sind aber nicht vorbelegt.
  const offered = game.modes.filter((mode) => modeStatusOf(mode) !== "archived");
  const [off, setOff] = useState(() => offered.filter((mode) => modeStatusOf(mode) === "inactive").map(({ mode }) => mode));
  const chosen = offered.map(({ mode }) => mode).filter((mode) => !off.includes(mode));
  const names = maps.slice(0, 5).map((item) => item.name).join(", ");
  const more = maps.length > 5 ? ` und ${maps.length - 5} weitere` : "";
  return (
    <section className="mb-4 rounded-sm border border-warn/30 bg-warn/5 p-3 space-y-2" aria-label="Maps ohne Modus" data-testid="game-maps-without-mode">
      <p className="text-sm font-semibold text-warn">Diese Maps haben noch keinen Modus</p>
      <p className="text-xs text-white/70 break-words">
        {names}{more}. In neuen Pools stehen sie erst mit Modus zur Wahl. Gespeicherte Pools und laufende Spiele betrifft das nicht.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {offered.map(({ mode, label, status }) => (
          <label key={mode} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm border border-white/15 bg-[#0A0A0A] text-xs text-white/80 cursor-pointer">
            <input type="checkbox" checked={chosen.includes(mode)} onChange={() => setOff((list) => (list.includes(mode) ? list.filter((key) => key !== mode) : [...list, mode]))}
              className="accent-[#29B6E8]" data-testid={`game-maps-assign-${mode}`} />
            {label}{status === "inactive" ? " (inaktiv)" : ""}
          </label>
        ))}
        <button type="button" disabled={!chosen.length} onClick={() => onAssign(chosen)} data-testid="game-maps-assign"
          className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
          {maps.length === 1 ? "Der Map zuordnen" : `Allen ${maps.length} Maps zuordnen`}
        </button>
      </div>
    </section>
  );
}

function MapSheet({ game, item, onClose, onSaved }) {
  // Ein Modus, den das Spiel nicht mehr hat, fällt beim Öffnen weg - er würde sonst jedes Speichern blockieren.
  const [form, setForm] = useState(() => {
    const start = mapToForm(item);
    return { ...start, modes: start.modes.filter((mode) => game.modes.some((known) => known.mode === mode)) };
  });
  const [saving, setSaving] = useState(false);
  // Archivierte Modi (#2206) nur, wenn die Map sie schon hat - neu zuordnen geht nicht.
  // Inaktive darf eine Map haben (nur Pools, Reihenfolgen und Turniere sperren sie), sie stehen mit „(inaktiv)“ da.
  const had = item?.modes || [];
  const choices = game.modes
    .filter((mode) => modeStatusOf(mode) !== "archived" || had.includes(mode.mode))
    .map((mode) => (modeStatusOf(mode) === "active" ? mode : { ...mode, label: `${mode.label} (${modeStatusOf(mode) === "inactive" ? "inaktiv" : "archiviert"})` }));
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
            {choices.map(({ mode, label }) => {
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
  const [importing, setImporting] = useState(false);
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
  const withoutMode = mapsWithoutMode(maps, data?.game?.modes);
  const assignModes = (modes) => act(async () => {
    const { data: body } = await api.post(`/games/${gameId}/maps/assign-modes`, { modes });
    toast.success(body.updated === 1 ? "1 Map zugeordnet." : `${body.updated} Maps zugeordnet.`);
  });
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
  // Standard-Pool (#2129, SP3): lädt „Vorgabe des Spiels“ in Turnier, Phase, Season und Saison.
  const saveDefault = async (body) => {
    try {
      await api.put(`/games/${gameId}/default-pool`, body);
      toast.success("Standard-Pool gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    await load();
  };
  const clearDefault = async () => {
    if (!await confirm({ title: "Standard-Pool entfernen?", description: "„Vorgabe des Spiels“ lädt dann wieder alle aktiven Maps. Gespeicherte Pools ändern sich nicht.", confirmLabel: "Entfernen" })) return false;
    await act(() => api.delete(`/games/${gameId}/default-pool`), "Standard-Pool entfernt.");
    return true;
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
              <button type="button" onClick={() => setImporting(true)} disabled={maps.length >= (data.limit || 200)} data-testid="game-maps-import"
                className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
                <Copy className="w-3.5 h-3.5" /> Aus Spiel übernehmen
              </button>
              <button type="button" onClick={() => setEditing({})} disabled={maps.length >= (data.limit || 200)} data-testid="game-maps-add"
                className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> Map hinzufügen
              </button>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-white/55" data-testid="game-maps-modes">
            <span className="font-bold uppercase tracking-widest text-white/45 text-[11px]">Modi</span>
            {data.game.modes.length ? data.game.modes.map((entry) => (
              <span key={entry.mode} data-testid={`game-maps-mode-${entry.mode}`}
                className={`px-2 py-0.5 rounded-sm border border-white/10 bg-[#0A0A0A] ${modeStatusOf(entry) === "active" ? "text-white/70" : "text-white/45"}`}>
                {entry.label}{modeStatusOf(entry) !== "active" ? ` · ${modeStatusOf(entry) === "inactive" ? "inaktiv" : "archiviert"}` : ""}
              </span>
            )) : <span>keine – Maps gelten dann für jeden Pool</span>}
          </div>
          {withoutMode.length ? <WithoutModeNotice game={data.game} maps={withoutMode} onAssign={assignModes} /> : null}
          {shown.length === 0 ? (
            <p className="border border-dashed border-white/15 rounded-sm px-4 py-6 text-sm text-white/55" data-testid="game-maps-empty">
              Noch keine Map. Lege die Maps an, die in Turnieren und Saisons gespielt werden – mit Bild, damit Pools und Spieltage sie zeigen.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {shown.map((item, index) => {
                const archived = item.status === "archived";
                // Nur Modi, die das Spiel noch hat - nie eine rohe Kennung.
                const itemModes = item.modes.filter((mode) => labels[mode]);
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
                        {itemModes.length ? itemModes.map((mode) => (
                          <span key={mode} className="px-1.5 py-0.5 rounded-sm bg-white/5 text-[10px] font-bold uppercase tracking-wider text-white/70">{labels[mode]}</span>
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
          {maps.some((item) => item.status !== "archived") ? (
            <details className="mt-6 group" data-testid="game-default-pool-box">
              <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
                Standard-Pool {data.default_pool ? `· Version ${data.default_pool.version}` : "· noch keiner"}
              </summary>
              <div className="mt-3">
                <MapPoolEditor key={data.default_pool?.id || "neu"} title="Standard-Pool des Spiels"
                  hint="Den lädt „Vorgabe des Spiels“ in Turnier, Phase, Season und Saison. Ohne Standard-Pool sind das alle aktiven Maps. Gespeicherte Pools ändert er nicht."
                  game={data.game} library={maps.filter((item) => item.status !== "archived")} entry={data.default_pool} defaultsLabel="Alle aktiven Maps"
                  onSave={saveDefault} onClear={clearDefault} testId="game-default-pool" />
              </div>
            </details>
          ) : null}
          {importing ? <MapImportSheet game={data.game} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} /> : null}
          {editing ? <MapSheet game={data.game} item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
        </>
      ) : null}
    </AdminLayout>
  );
}
