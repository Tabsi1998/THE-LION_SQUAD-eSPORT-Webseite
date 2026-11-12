// Reiter „Maps“ der Spielseite (#2249, vorher eigene Seite /admin/games/<id>/maps aus #1616). Die Map-Bibliothek eines Spiels
// als Tabelle Map × Modus: ein Häkchen gibt die Map in diesem Modus frei und speichert sofort. Dazu je Map Bild, Zustand (C.2,
// #2207: aktiv, inaktiv, archiviert - mit Rückfrage, die betroffene Seasons nennt), Pool-Zählung, Reihenfolge, Bearbeiten und
// Löschen (nur, solange sie in keinem Pool stand). „Aus Spiel übernehmen“ holt Maps einer anderen Version, der Standard-Pool
// steht darunter. Modi sind dieselben wie im Reiter Modi - kein zweites Modussystem.
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Map as MapIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { LazyImg } from "@/components/tls/LazyImg";
import { TableScroll } from "@/components/tls/TableScroll";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { mapFormPayload, mapStatusOf, mapToForm, mapsWithoutMode } from "@/lib/mapPools";
import { modeStatusOf } from "@/lib/gameMatchData";
import { MapPoolEditor } from "../maps/MapPoolEditor";
import { MapStatusActions } from "../maps/MapStatusActions";
import { MapImportSheet } from "../maps/MapImportSheet";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] disabled:opacity-25 disabled:hover:text-white/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const STATE_TEXT = { active: "Aktiv", inactive: "Inaktiv", archived: "Archiviert" };
const STATE_CLASS = { active: "text-ok", inactive: "text-warn", archived: "text-white/50" };

function poolsText(count) {
  if (!count) return "in keinem Pool";
  return count === 1 ? "in 1 Pool" : `in ${count} Pools`;
}

function modeSuffix(mode) {
  const status = modeStatusOf(mode);
  return status === "active" ? "" : status === "inactive" ? "inaktiv" : "archiviert";
}

/** Die Modus-Spalten: alle nicht archivierten, archivierte nur, solange noch eine Map sie hat. */
export function matrixModes(modes, maps) {
  return (modes || []).filter((mode) => modeStatusOf(mode) !== "archived" || (maps || []).some((item) => (item.modes || []).includes(mode.mode)));
}

/** Die Modi einer Map nach dem Umschalten - nur Modi, die das Spiel noch kennt (ein entfernter würde das Speichern blockieren). */
export function toggledModes(item, mode, known) {
  const kept = (item.modes || []).filter((key) => known.includes(key));
  return kept.includes(mode) ? kept.filter((key) => key !== mode) : [...kept, mode];
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
    <section className="rounded-sm border border-warn/30 bg-warn/5 p-3 space-y-2" aria-label="Maps ohne Modus" data-testid="game-maps-without-mode">
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

// Anlegen mit Modi; beim Bearbeiten nicht - die Modi einer Map stehen nur in der Tabelle (eine Angabe, eine Stelle).
function MapSheet({ game, item, onClose, onSaved }) {
  const [form, setForm] = useState(() => mapToForm(item));
  const [saving, setSaving] = useState(false);
  const isNew = !item?.id;
  // Archivierte Modi (#2206) lassen sich nicht neu zuordnen; inaktive schon, mit „(inaktiv)“.
  const choices = game.modes.filter((mode) => modeStatusOf(mode) !== "archived")
    .map((mode) => (modeStatusOf(mode) === "active" ? mode : { ...mode, label: `${mode.label} (inaktiv)` }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleMode = (mode) => set("modes", form.modes.includes(mode) ? form.modes.filter((key) => key !== mode) : [...form.modes, mode]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { modes, ...rest } = mapFormPayload(form);
      if (isNew) await api.post(`/games/${game.id}/maps`, { ...rest, modes });
      else await api.patch(`/games/${game.id}/maps/${item.id}`, rest);
      toast.success(isNew ? "Map angelegt." : "Map gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  return (
    <AdminSheet title={isNew ? "Map hinzufügen" : "Map bearbeiten"} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitTestId="game-map-save" testId="game-map-sheet">
      <FormGrid>
        <TextField label="Name" required maxLength={80} value={form.name} onChange={(value) => set("name", value)} placeholder="z. B. Hafenkante" testId="game-map-name" />
        <TextField label="Slug" maxLength={80} value={form.slug} onChange={(value) => set("slug", value)}
          placeholder={isNew ? "leer: aus dem Namen" : ""} hint="Eindeutig in diesem Spiel; bleibt beim Umbenennen gleich." testId="game-map-slug" />
      </FormGrid>
      <TextField label="Weitere Schreibweisen" value={form.aliases} onChange={(value) => set("aliases", value)} placeholder="z. B. Harbour Edge, Hafen"
        hint="Mit Komma getrennt, etwa wie der Veranstalter die Map nennt – das Ergebnisblatt der Team-Liga erkennt sie daran." testId="game-map-aliases" />
      <ImageUpload value={form.image_url} onChange={(value) => set("image_url", value || "")} label="Bild (16 : 9)" testId="game-map-image" variant="wide" allowLibrary />
      {isNew ? (
        <fieldset className="space-y-2">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Freigegeben in</legend>
          {choices.length ? (
            <>
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
              <p className="text-xs text-white/45">Nur in den gewählten Modi kann die Map in einen Pool. Später änderst du das in der Tabelle.</p>
            </>
          ) : (
            <p className="text-xs text-white/45">Das Spiel hat keine Modi – die Map gilt dann für jeden Pool. Modi legst du im Reiter Modi an.</p>
          )}
        </fieldset>
      ) : null}
      <TextAreaField label="Notiz" rows={2} value={form.note} onChange={(value) => set("note", value)} placeholder="nur für die Verwaltung" testId="game-map-note" />
      <TextField label="Externe Kennung" maxLength={120} value={form.external_ref} onChange={(value) => set("external_ref", value)}
        hint="Etwa die Kennung beim Veranstalter – freiwillig." testId="game-map-external" />
    </AdminSheet>
  );
}

function MapThumb({ item }) {
  return (
    <span className="relative hidden sm:block h-9 w-16 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]">
      {item.image_url ? (
        <LazyImg src={item.image_url} alt="" sizes="64px" widths={[160]} width={64} height={36} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-white/25" aria-hidden="true"><MapIcon className="w-4 h-4" /></span>
      )}
    </span>
  );
}

export function GameMapsTab({ gameId, reloadKey = 0, onOpenModes }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(() => new Set());
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
  useEffect(() => { load(); }, [load, reloadKey]);
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
  const game = data?.game;
  const archivedCount = maps.filter((item) => item.status === "archived").length;
  const shown = maps.filter((item) => showArchived || item.status !== "archived");
  const columns = matrixModes(game?.modes, shown);
  const known = (game?.modes || []).map(({ mode }) => mode);
  const withoutMode = mapsWithoutMode(maps, game?.modes);
  const full = maps.length >= (data?.limit || 200);

  // Ein Häkchen speichert sofort (#2249). Solange es unterwegs ist, wartet die Zeile - so überholen sich zwei Klicks nicht.
  const toggle = async (item, mode) => {
    const next = toggledModes(item, mode.mode, known);
    const on = next.includes(mode.mode);
    setBusy((current) => new Set(current).add(item.id));
    setData((current) => ({ ...current, maps: current.maps.map((row) => (row.id === item.id ? { ...row, modes: next } : row)) }));
    try {
      await api.patch(`/games/${gameId}/maps/${item.id}`, { modes: next });
      toast.success(`${item.name}: ${on ? "in" : "nicht mehr in"} ${mode.label} freigegeben.`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      await load();
    }
    setBusy((current) => {
      const rest = new Set(current);
      rest.delete(item.id);
      return rest;
    });
  };
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

  if (missing) return <p className="text-white/60" data-testid="game-maps-missing">{missing}</p>;
  if (!data) return <p className="py-10 text-center text-white/40">Wird geladen …</p>;

  return (
    <div className="space-y-5" data-testid="game-maps">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-white/55">
          Turniere, Phasen und Seasons wählen daraus ihren Map-Pool. {columns.length ? "Häkchen = in diesem Modus freigegeben; nur dort lässt sich die Map in einen Pool wählen. Jedes Häkchen speichert sofort." : ""}
          {" "}Spätere Änderungen ändern keinen gespeicherten Pool.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {archivedCount ? (
            <label className="inline-flex items-center gap-2 text-xs text-white/65">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[#29B6E8]" data-testid="game-maps-show-archived" />
              Archivierte zeigen ({archivedCount})
            </label>
          ) : null}
          <button type="button" onClick={() => setImporting(true)} disabled={full} data-testid="game-maps-import"
            className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Aus Spiel übernehmen
          </button>
          <button type="button" onClick={() => setEditing({})} disabled={full} data-testid="game-maps-add"
            className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Map hinzufügen
          </button>
        </div>
      </div>
      {!game.modes.length ? (
        <p className="rounded-sm border border-white/10 bg-[#121212] px-4 py-3 text-xs text-white/60" data-testid="game-maps-no-modes">
          Das Spiel hat keine Modi – jede Map gilt dann für jeden Pool.{" "}
          <button type="button" onClick={onOpenModes} className="text-[#29B6E8] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">Modi anlegen</button>
        </p>
      ) : null}
      {withoutMode.length ? <WithoutModeNotice game={game} maps={withoutMode} onAssign={assignModes} /> : null}
      {shown.length === 0 ? (
        <p className="border border-dashed border-white/15 rounded-sm px-4 py-6 text-sm text-white/55" data-testid="game-maps-empty">
          Noch keine Map. Lege die Maps an, die in Turnieren und Saisons gespielt werden – mit Bild, damit Pools und Spieltage sie zeigen.
        </p>
      ) : (
        <TableScroll label={`Maps von ${game.name}`} testId="game-maps-table">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-[#0A0A0A] text-[10px] uppercase tracking-widest text-white/50">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-[#0A0A0A] text-left px-3 py-2.5 font-bold">Map</th>
                {columns.map((mode) => {
                  const count = shown.filter((item) => (item.modes || []).includes(mode.mode)).length;
                  return (
                    <th key={mode.mode} scope="col" className="px-2 py-2.5 text-center font-bold normal-case tracking-normal" data-testid={`game-maps-mode-${mode.mode}`}>
                      <span className={`block text-xs ${modeStatusOf(mode) === "active" ? "text-white/80" : "text-white/45"}`}>{mode.label}</span>
                      <span className="block text-[10px] font-normal text-white/40">{modeSuffix(mode) || (count === 1 ? "1 Map" : `${count} Maps`)}</span>
                    </th>
                  );
                })}
                <th scope="col" className="text-left px-3 py-2.5 font-bold">Zustand</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.map((item, index) => {
                const status = mapStatusOf(item);
                const archived = status === "archived";
                const waiting = busy.has(item.id);
                return (
                  <tr key={item.id} className={archived ? "opacity-60" : undefined} data-testid={`game-map-row-${item.slug}`} data-slug={item.slug}>
                    <td className="sticky left-0 z-10 bg-[#121212] px-3 py-2">
                      <div className="flex items-center gap-3">
                        <MapThumb item={item} />
                        <div className="min-w-0">
                          <div className="max-w-[8.5rem] sm:max-w-[16rem] truncate font-semibold text-white" title={item.name}>{item.name}</div>
                          <div className="max-w-[8.5rem] sm:max-w-[16rem] truncate text-[11px] text-white/40">{item.slug}</div>
                        </div>
                      </div>
                    </td>
                    {columns.map((mode) => {
                      const on = (item.modes || []).includes(mode.mode);
                      // Archivierte Modi (#2206) nur abwählen; eine archivierte Map bleibt, wie sie ist.
                      const locked = archived || (!on && modeStatusOf(mode) === "archived");
                      return (
                        <td key={mode.mode} className="px-2 py-2 text-center">
                          <input type="checkbox" checked={on} disabled={locked || waiting} onChange={() => toggle(item, mode)}
                            aria-label={`${item.name} in ${mode.label} freigeben`} data-testid={`game-map-mode-${item.slug}-${mode.mode}`}
                            className="h-4 w-4 accent-[#29B6E8] cursor-pointer disabled:cursor-not-allowed" />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 whitespace-nowrap text-xs" data-testid={`game-map-state-${item.slug}`}>
                      <span className={`font-semibold ${STATE_CLASS[status]}`}>{STATE_TEXT[status]}</span>
                      <span className="block text-white/45 tabular-nums">{poolsText(item.in_pools)}</span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end">
                        <button type="button" className={ICON_BUTTON} onClick={() => move(item, -1)} disabled={index === 0} aria-label={`${item.name} nach vorne`} data-testid={`game-map-up-${item.slug}`}><ArrowUp className="w-4 h-4" aria-hidden="true" /></button>
                        <button type="button" className={ICON_BUTTON} onClick={() => move(item, 1)} disabled={index === shown.length - 1} aria-label={`${item.name} nach hinten`} data-testid={`game-map-down-${item.slug}`}><ArrowDown className="w-4 h-4" aria-hidden="true" /></button>
                        <button type="button" className={ICON_BUTTON} onClick={() => setEditing(item)} aria-label={`${item.name} bearbeiten`} data-testid={`game-map-edit-${item.slug}`}><Pencil className="w-4 h-4" aria-hidden="true" /></button>
                        {/* Zustand (#2207): deaktivieren, aktivieren, archivieren - mit Rückfrage, die betroffene Seasons nennt. */}
                        <MapStatusActions gameId={gameId} item={item} onChanged={load} />
                        <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-[#FF3B30]")} onClick={() => remove(item)} disabled={item.in_pools > 0}
                          title={item.in_pools > 0 ? "Steht in einem gespeicherten Pool – archivieren statt löschen" : "Löschen"}
                          aria-label={`${item.name} löschen`} data-testid={`game-map-delete-${item.slug}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      {maps.some((item) => item.status !== "archived") ? (
        <details className="group rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="game-default-pool-box">
          <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
            Standard-Pool {data.default_pool ? `· Version ${data.default_pool.version}` : "· noch keiner"}
          </summary>
          <div className="mt-3">
            <MapPoolEditor key={data.default_pool?.id || "neu"} title="Standard-Pool des Spiels"
              hint="Den lädt „Vorgabe des Spiels“ in Turnier, Phase, Season und Saison. Ohne Standard-Pool sind das alle aktiven Maps. Gespeicherte Pools ändert er nicht."
              game={game} library={maps.filter((item) => item.status !== "archived")} entry={data.default_pool} defaultsLabel="Alle aktiven Maps"
              onSave={saveDefault} onClear={clearDefault} testId="game-default-pool" />
          </div>
        </details>
      ) : null}
      {importing ? <MapImportSheet game={game} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} /> : null}
      {editing ? <MapSheet game={game} item={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}
