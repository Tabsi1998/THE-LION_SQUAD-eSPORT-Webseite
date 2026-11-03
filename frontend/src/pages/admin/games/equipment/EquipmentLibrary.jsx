// Ausrüstungs-Bibliothek eines Spiels (docs/LIGA.md, C.4 #2218) - eigenständig, damit sie als Reiter „Ausrüstung“ auf der Spielseite
// (#2249) sitzen kann; bis dahin trägt sie AdminGameEquipmentPage unter /admin/games/<id>/equipment. Je Kategorie die Einträge mit
// Bild, Zustand, „auf N Sperrlisten“ und bei Aufsätzen den Waffen. Was auf einer gespeicherten Sperrliste steht, lässt sich nur
// archivieren - die Liste behält Name und Bild von damals. Keine Werte eines Titels: Kategorien und Einträge legt die Verwaltung an.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Copy, Layers, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { EquipmentThumb } from "@/components/tls/league/LoadoutBansView";
import { countText, groupByCategory, matchesSearch, ROLE_LABELS, statusOf } from "@/lib/loadoutBans";
import { EquipmentCategoriesSheet } from "./EquipmentCategoriesSheet";
import { EquipmentImportSheet } from "./EquipmentImportSheet";
import { EquipmentItemSheet } from "./EquipmentItemSheet";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 rounded-sm text-white/60 hover:text-[#29B6E8] disabled:opacity-30 disabled:hover:text-white/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const CHIP = "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const THUMB_SIZES = "96px";

function listsText(count) {
  if (!count) return "auf keiner Sperrliste";
  return count === 1 ? "auf 1 Sperrliste" : `auf ${count} Sperrlisten`;
}

function fitsText(item, weaponNames) {
  const ids = item.weapon_ids || [];
  if (!ids.length) return "passt zu jeder Waffe";
  const names = ids.map((id) => weaponNames.get(id)).filter(Boolean);
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `passt zu ${shown} und ${names.length - 3} weiteren` : `passt zu ${shown || "einer gelöschten Waffe"}`;
}

function ItemRow({ item, role, weaponNames, onEdit, onStatus, onDelete }) {
  const status = statusOf(item);
  return (
    <li className={`flex items-start gap-3 rounded-sm border border-white/10 bg-[#121212] p-2.5 ${status === "archived" ? "opacity-60" : ""}`}
      data-testid={`equipment-row-${item.id}`}>
      <EquipmentThumb src={item.image_url} sizes={THUMB_SIZES} className="w-20 shrink-0 sm:w-24" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-white break-words" data-testid="equipment-row-name">{item.name}</p>
        <p className="mt-0.5 text-[11px] text-white/60" data-testid="equipment-row-meta">
          {status !== "active" ? <span className="font-semibold text-warn">{status === "inactive" ? "Inaktiv · " : "Archiviert · "}</span> : null}
          {listsText(item.in_lists)}
        </p>
        {role === "attachment" ? <p className="mt-0.5 text-[11px] text-white/60 break-words">{fitsText(item, weaponNames)}</p> : null}
        {item.note ? <p className="mt-0.5 text-[11px] italic text-white/50 break-words">{item.note}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end sm:flex-row sm:items-center">
        <button type="button" className={ICON_BUTTON} onClick={() => onEdit(item)} aria-label={`${item.name} bearbeiten`} data-testid={`equipment-edit-${item.id}`}>
          <Pencil className="h-4 w-4" />
        </button>
        {status !== "archived" ? (
          <button type="button" className={ICON_BUTTON} onClick={() => onStatus(item, status === "active" ? "inactive" : "active")}
            aria-label={status === "active" ? `${item.name} deaktivieren` : `${item.name} aktivieren`} title={status === "active" ? "Deaktivieren: kommt auf keine neue Sperrliste" : "Aktivieren"}
            data-testid={`equipment-toggle-${item.id}`}>
            <Power className={`h-4 w-4 ${status === "inactive" ? "text-warn" : ""}`} />
          </button>
        ) : null}
        <button type="button" className={ICON_BUTTON} onClick={() => onStatus(item, status === "archived" ? "active" : "archived")}
          aria-label={status === "archived" ? `${item.name} zurückholen` : `${item.name} archivieren`} data-testid={`equipment-archive-${item.id}`}>
          {status === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        </button>
        <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live")} onClick={() => onDelete(item)} disabled={item.in_lists > 0}
          title={item.in_lists > 0 ? "Steht auf einer gespeicherten Sperrliste – archivieren statt löschen" : "Löschen"}
          aria-label={`${item.name} löschen`} data-testid={`equipment-delete-${item.id}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

export function EquipmentLibrary({ gameId, onGame }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/games/${gameId}/equipment`);
      setData(body);
      setError("");
      onGame?.(body.game);
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [gameId, onGame]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["games"]);

  const items = useMemo(() => data?.items || [], [data]);
  const categories = useMemo(() => data?.categories || [], [data]);
  const weaponNames = useMemo(() => {
    const keys = new Set(categories.filter((row) => row.role === "weapon").map((row) => row.key));
    return new Map(items.filter((item) => keys.has(item.category)).map((item) => [item.id, item.name]));
  }, [categories, items]);
  const archivedCount = items.filter((item) => statusOf(item) === "archived").length;
  const shown = items.filter((item) => (showArchived || statusOf(item) !== "archived") && matchesSearch(item, search));
  const groups = groupByCategory(shown, categories).filter((group) => !only || group.category.key === only);
  const full = items.length >= (data?.limit || 1000);

  const act = async (action, success) => {
    try {
      await action();
      if (success) toast.success(success);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const setStatus = async (item, status) => {
    if (status === "archived" && !await confirm({ title: `„${item.name}“ archivieren?`, confirmLabel: "Archivieren",
      description: "Er kommt auf keine neue Sperrliste mehr und verschwindet aus der Auswahl. Gespeicherte Listen und Regelwerke zeigen ihn weiter." })) return;
    const words = { active: "aktiviert", inactive: "deaktiviert", archived: "archiviert" };
    act(() => api.patch(`/games/${gameId}/equipment/${item.id}`, { status }), `„${item.name}“ ${words[status]}.`);
  };
  const remove = async (item) => {
    if (!await confirm({ title: `„${item.name}“ löschen?`, description: "Er stand auf keiner Sperrliste und wird dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
    act(() => api.delete(`/games/${gameId}/equipment/${item.id}`), "Eintrag gelöscht.");
  };

  if (error) return <p className="mt-6 text-white/60" role="alert" data-testid="equipment-missing">{error}</p>;
  if (!data) return <p className="mt-6 text-sm text-white/60">Lade Ausrüstung …</p>;

  return (
    <section aria-label="Ausrüstung" data-testid="equipment-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-white/65">
          Waffen, Aufsätze und übrige Ausrüstung mit Bild. Seasons sperren daraus, was nicht gespielt werden darf; spätere Änderungen hier
          ändern keine gespeicherte Sperrliste.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setCategoriesOpen(true)} data-testid="equipment-categories"
            className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">
            <Layers className="h-3.5 w-3.5" /> Kategorien
          </button>
          <button type="button" onClick={() => setImporting(true)} disabled={full} data-testid="equipment-import"
            className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            <Copy className="h-3.5 w-3.5" /> Aus Spiel übernehmen
          </button>
          <button type="button" onClick={() => setEditing({ category: only || "" })} disabled={full || !categories.length} data-testid="equipment-add"
            className="tls-btn tls-btn--primary inline-flex items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Eintrag hinzufügen
          </button>
        </div>
      </div>

      {!categories.length ? (
        <div className="mt-6 rounded-sm border border-dashed border-white/15 px-4 py-6" data-testid="equipment-no-categories">
          <p className="text-sm text-white/75">Für dieses Spiel gibt es noch keine Kategorien. Lege fest, welche Arten von Ausrüstung es hat – etwa Waffen, Aufsätze und Perks.</p>
          <button type="button" onClick={() => setCategoriesOpen(true)} data-testid="equipment-categories-start"
            className="tls-btn tls-btn--primary mt-3 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">Kategorien festlegen</button>
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden="true" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name suchen" aria-label="Ausrüstung suchen"
                data-testid="equipment-search"
                className="w-full rounded-sm border border-white/15 bg-[#0A0A0A] py-2 pl-8 pr-3 text-sm text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
            </label>
            {archivedCount ? (
              <label className="inline-flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[#29B6E8]" data-testid="equipment-show-archived" />
                Archivierte zeigen ({archivedCount})
              </label>
            ) : null}
          </div>
          <div className="tls-swipe mt-3 flex gap-2 pb-1" role="group" aria-label="Kategorie wählen" data-testid="equipment-filter">
            <button type="button" onClick={() => setOnly("")} aria-pressed={!only}
              className={`${CHIP} shrink-0 ${!only ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/70"}`}>
              Alle <span className="tabular-nums text-white/50">{items.length}</span>
            </button>
            {categories.map((category) => (
              <button key={category.key} type="button" onClick={() => setOnly(only === category.key ? "" : category.key)} aria-pressed={only === category.key}
                data-testid={`equipment-filter-${category.key}`}
                className={`${CHIP} shrink-0 ${only === category.key ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/70"}`}>
                {category.label} <span className="tabular-nums text-white/50">{category.count}</span>
              </button>
            ))}
          </div>
          <div className="mt-6 space-y-8">
            {groups.map(({ category, items: rows }) => (
              <div key={category.key} data-testid={`equipment-group-${category.key}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="flex min-w-0 items-baseline gap-2 font-heading text-lg font-bold uppercase">
                    <span className="break-words">{category.label}</span>
                    <span className="text-[11px] font-semibold normal-case tracking-normal text-white/50 tabular-nums">
                      {ROLE_LABELS[category.role]} · {countText(rows.length, "Eintrag", "Einträge")}
                    </span>
                  </h2>
                  <button type="button" onClick={() => setEditing({ category: category.key })} disabled={full} data-testid={`equipment-add-${category.key}`}
                    className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
                    <Plus className="h-3 w-3" /> Hinzufügen
                  </button>
                </div>
                {rows.length ? (
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                    {rows.map((item) => (
                      <ItemRow key={item.id} item={item} role={category.role} weaponNames={weaponNames}
                        onEdit={setEditing} onStatus={setStatus} onDelete={remove} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-sm border border-dashed border-white/15 px-3 py-3 text-sm text-white/60">
                    {search ? "Nichts gefunden." : "Noch kein Eintrag."}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {categoriesOpen ? (
        <EquipmentCategoriesSheet game={data.game} categories={categories} suggested={data.suggested_categories || []} limit={data.categories_limit || 20}
          onClose={() => setCategoriesOpen(false)} onSaved={() => { setCategoriesOpen(false); load(); }} />
      ) : null}
      {importing ? <EquipmentImportSheet game={data.game} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} /> : null}
      {editing ? (
        <EquipmentItemSheet game={data.game} categories={categories} items={items} item={editing.id ? editing : null} initialCategory={editing.category}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      ) : null}
    </section>
  );
}
