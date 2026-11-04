// Ausrüstungs-Bibliothek eines Spiels (docs/LIGA.md, C.4 #2218) - der Reiter „Ausrüstung“ der Spielseite (#2249, Sprungmarke
// #ausruestung; die alte Adresse /admin/games/<id>/equipment leitet dorthin). Speichert je Eintrag sofort. Je Kategorie die Einträge mit
// Bild, Zustand, „auf N Sperrlisten“ und bei Aufsätzen den Waffen. Was auf einer gespeicherten Sperrliste steht, lässt sich nur
// archivieren - die Liste behält Name und Bild von damals. Keine Werte eines Titels: Kategorien und Einträge legt die Verwaltung an.
// Unterkategorien (#2287): je Kategorie einklappbare Gruppen mit Zähler, eigenes Blatt zum Pflegen, mehrere Einträge auf einmal
// verschieben.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArchiveRestore, ChevronDown, Copy, FolderInput, Layers, ListChecks, ListTree, Pencil, Plus, Power, Search, Trash2, X,
} from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { EquipmentThumb, SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import {
  countText, groupByCategory, groupBySubcategory, matchesSearch, NO_SUBCATEGORY, ROLE_LABELS, statusOf, weaponClasses,
} from "@/lib/loadoutBans";
import { EquipmentCategoriesSheet } from "./EquipmentCategoriesSheet";
import { EquipmentImportSheet } from "./EquipmentImportSheet";
import { EquipmentItemSheet } from "./EquipmentItemSheet";
import { EquipmentSubcategoriesSheet } from "./EquipmentSubcategoriesSheet";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 rounded-sm text-white/60 hover:text-[#29B6E8] disabled:opacity-30 disabled:hover:text-white/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const CHIP = "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const SMALL_BUTTON = "tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const THUMB_SIZES = "96px";

function listsText(count) {
  if (!count) return "auf keiner Sperrliste";
  return count === 1 ? "auf 1 Sperrliste" : `auf ${count} Sperrlisten`;
}

function fitsText(item, weaponNames, classNames) {
  const names = [
    ...(item.weapon_class_ids || []).map((key) => classNames.get(key)).filter(Boolean).map((name) => `${name} (Klasse)`),
    ...(item.weapon_ids || []).map((id) => weaponNames.get(id)).filter(Boolean),
  ];
  if (!names.length) return "";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `passt zu ${shown} und ${names.length - 3} weiteren` : `passt zu ${shown}`;
}

// Aufsätze ohne Waffe (Obmann, 03.11.): Sie passen zu keiner Waffe und lassen sich an keiner einzeln sperren. Wie „Maps ohne Modus“
// nennt der Hinweis sie und ordnet allen auf einmal die gewählten Waffen und Waffenklassen (#2287) zu.
// Codex Runde 1: Die Auswahl ist zugeklappt und hat eine Suche - bei vielen Waffen bleibt der Hinweis am Handy kurz.
function WithoutWeaponNotice({ rows, weapons, classes, onAssign }) {
  const [chosen, setChosen] = useState([]);
  const [chosenClasses, setChosenClasses] = useState([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const shownClasses = classes.filter((klass) => matchesSearch({ name: klass.label }, search));
  const shownWeapons = weapons.filter((weapon) => matchesSearch(weapon, search));
  const picked = chosen.length + chosenClasses.length;
  const names = rows.slice(0, 5).map((row) => row.name).join(", ");
  const more = rows.length > 5 ? ` und ${rows.length - 5} weitere` : "";
  const toggle = (setter) => (id) => setter((list) => (list.includes(id) ? list.filter((key) => key !== id) : [...list, id]));
  const chip = (key, label, checked, onToggle, testId) => (
    <label key={key} className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-sm border border-white/15 bg-[#0A0A0A] px-2.5 py-1 text-xs text-white/80">
      <input type="checkbox" checked={checked} onChange={onToggle} className="accent-[#29B6E8]" data-testid={testId} />
      <span className="break-words">{label}</span>
    </label>
  );
  return (
    <section className="mt-5 space-y-2 rounded-sm border border-warn/30 bg-warn/5 p-3" aria-label="Aufsätze ohne Waffe" data-testid="equipment-without-weapon">
      <p className="text-sm font-semibold text-warn">Diese Aufsätze passen noch zu keiner Waffe</p>
      <p className="text-xs text-white/70 break-words">{names}{more}. An einer Waffe einzeln sperren lassen sie sich erst mit Zuordnung.</p>
      {weapons.length || classes.length ? (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="equipment-assign-choice"
          data-testid="equipment-assign-open"
          className="inline-flex items-center gap-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          Waffen wählen{picked ? ` · ${picked} gewählt` : ""}
        </button>
      ) : <p className="text-xs text-white/60">Noch keine Waffe angelegt.</p>}
      {open ? (
        <div id="equipment-assign-choice" className="space-y-2">
          {weapons.length + classes.length > 1 ? (
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden="true" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Waffe oder Klasse suchen"
                aria-label="Waffe oder Klasse suchen" data-testid="equipment-assign-search"
                className="w-full rounded-sm border border-white/15 bg-[#0A0A0A] py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
            </label>
          ) : null}
          {shownClasses.length ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="equipment-assign-classes">
              <span className="text-[11px] text-white/55">Waffenklassen</span>
              {shownClasses.map((klass) => chip(klass.key, klass.label, chosenClasses.includes(klass.key), () => toggle(setChosenClasses)(klass.key), `equipment-assign-class-${klass.key}`))}
            </div>
          ) : null}
          {shownWeapons.length ? (
            <div className="flex max-h-48 flex-wrap items-center gap-2 overflow-y-auto pr-1">
              {classes.length ? <span className="text-[11px] text-white/55">Waffen</span> : null}
              {shownWeapons.map((weapon) => chip(weapon.id, weapon.name, chosen.includes(weapon.id), () => toggle(setChosen)(weapon.id), `equipment-assign-${weapon.id}`))}
            </div>
          ) : null}
          {!shownClasses.length && !shownWeapons.length ? <p className="text-xs text-white/60">Nichts gefunden.</p> : null}
        </div>
      ) : null}
      <button type="button" disabled={!picked} onClick={() => onAssign(chosen, chosenClasses)} data-testid="equipment-assign"
        className="tls-btn tls-btn--primary rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
        {rows.length === 1 ? "Dem Aufsatz zuordnen" : `Allen ${rows.length} Aufsätzen zuordnen`}
      </button>
    </section>
  );
}

function ItemRow({ item, role, weaponNames, classNames, selecting, selected, onSelect, onEdit, onStatus, onDelete }) {
  const status = statusOf(item);
  return (
    <li className={`flex items-start gap-3 rounded-sm border p-2.5 ${selected ? "border-[#29B6E8]/60 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"} ${status === "archived" ? "opacity-60" : ""}`}
      data-testid={`equipment-row-${item.id}`}>
      {selecting ? (
        <input type="checkbox" checked={selected} onChange={() => onSelect(item)} aria-label={`${item.name} auswählen`}
          className="mt-1 h-4 w-4 shrink-0 accent-[#29B6E8]" data-testid={`equipment-select-${item.id}`} />
      ) : null}
      <EquipmentThumb src={item.image_url} sizes={THUMB_SIZES} className="w-20 shrink-0 sm:w-24" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-white break-words" data-testid="equipment-row-name">{item.name}</p>
        <p className="mt-0.5 text-[11px] text-white/60" data-testid="equipment-row-meta">
          {status !== "active" ? <span className="font-semibold text-warn">{status === "inactive" ? "Inaktiv · " : "Archiviert · "}</span> : null}
          {listsText(item.in_lists)}
        </p>
        {role === "attachment" ? (fitsText(item, weaponNames, classNames)
          ? <p className="mt-0.5 text-[11px] text-white/60 break-words">{fitsText(item, weaponNames, classNames)}</p>
          : <p className="mt-0.5 text-[11px] font-semibold text-warn">keiner Waffe zugeordnet – passt zu keiner</p>) : null}
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

function ItemGrid({ rows, children }) {
  return rows.length ? <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">{children}</ul> : null;
}

// Eine Unterkategorie als einklappbare Gruppe: Kopf mit Symbol, Name, Zähler und „Hinzufügen“; beim Suchen zeigt sie nur Treffer.
function SubGroup({ id, sub, rows, total, open, onToggle, onAdd, full, searching, selecting, onSelectAll, allSelected, children }) {
  const label = sub ? sub.label : NO_SUBCATEGORY;
  return (
    <div className="rounded-sm border border-white/10 bg-[#0D0D0D]" data-testid={`equipment-sub-${sub ? sub.key : "ohne"}`}>
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
        {selecting && rows.length ? (
          <input type="checkbox" checked={allSelected} onChange={() => onSelectAll(rows)} aria-label={`Alle in ${label} auswählen`} className="h-4 w-4 accent-[#29B6E8]" />
        ) : null}
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} data-testid={`equipment-sub-toggle-${sub ? sub.key : "ohne"}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
          <ChevronDown className={`h-4 w-4 shrink-0 text-white/50 transition-transform duration-fast ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
          <SubcategoryIcon src={sub?.icon_url} />
          <span className={`min-w-0 break-words text-xs font-bold uppercase tracking-widest ${sub ? "text-[#29B6E8]" : "text-white/60"}`}>{label}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-white/50" data-testid="equipment-sub-count">
            {searching && rows.length !== total ? `${rows.length} von ${total}` : total}
          </span>
        </button>
        {sub ? (
          <button type="button" onClick={onAdd} disabled={full} className={SMALL_BUTTON} aria-label={`Eintrag in ${label} hinzufügen`} data-testid={`equipment-sub-add-${sub.key}`}>
            <Plus className="h-3 w-3" aria-hidden="true" /> Hinzufügen
          </button>
        ) : null}
      </div>
      {open ? (
        <div id={id} className="border-t border-white/10 p-2.5">
          {rows.length ? children : (
            <p className="text-xs text-white/55">
              {searching ? "Nichts gefunden." : "Noch kein Eintrag – über „Hinzufügen“ oder „Auswählen“ und „Verschieben“ zuordnen."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Mehrere Einträge auf einmal in eine Unterkategorie (#2287): nur innerhalb einer Kategorie.
function MoveBar({ selected, categories, onMove, onCancel }) {
  const [target, setTarget] = useState("");
  const categoryKeys = [...new Set(selected.map((item) => item.category))];
  const category = categoryKeys.length === 1 ? categories.find((row) => row.key === categoryKeys[0]) : null;
  const subs = category?.subcategories || [];
  const problem = !selected.length ? "Wähle Einträge aus der Liste."
    : categoryKeys.length > 1 ? "Verschieben geht nur innerhalb einer Kategorie – bitte Einträge derselben Kategorie wählen."
      : !subs.length ? `„${category?.label}“ hat noch keine Unterkategorien.` : "";
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 bg-[#121212]/95 px-3 py-3 backdrop-blur" data-testid="equipment-move-bar">
      <span className="text-xs font-semibold text-white tabular-nums">{countText(selected.length, "Eintrag", "Einträge")} gewählt</span>
      {problem ? <span className="min-w-0 flex-1 basis-48 text-xs text-white/60" role="status">{problem}</span> : (
        <label className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-xs text-white/70">
          <span className="shrink-0">Nach</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Ziel-Unterkategorie" data-testid="equipment-move-target"
            className="min-w-0 flex-1 rounded-sm border border-white/15 bg-[#0A0A0A] px-2 py-1.5 text-sm text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
            <option value="">{NO_SUBCATEGORY}</option>
            {subs.map((sub) => <option key={sub.key} value={sub.key}>{sub.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" disabled={Boolean(problem)} onClick={() => onMove(target || null)} data-testid="equipment-move"
        className="tls-btn tls-btn--primary inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
        <FolderInput className="h-3.5 w-3.5" aria-hidden="true" /> Verschieben
      </button>
      <button type="button" onClick={onCancel} className={SMALL_BUTTON} data-testid="equipment-move-cancel">
        <X className="h-3 w-3" aria-hidden="true" /> Fertig
      </button>
    </div>
  );
}

// `onDirtyChange(bool)`: ein offenes Blatt mit Änderungen meldet sich - die Spielseite zeigt dann den Punkt am Reiter und fragt beim Verlassen.
export function EquipmentLibrary({ gameId, onDirtyChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [subsFor, setSubsFor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [closed, setClosed] = useState({});
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/games/${gameId}/equipment`);
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [gameId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["games"]);

  const items = useMemo(() => data?.items || [], [data]);
  const categories = useMemo(() => data?.categories || [], [data]);
  const weaponNames = useMemo(() => {
    const keys = new Set(categories.filter((row) => row.role === "weapon").map((row) => row.key));
    return new Map(items.filter((item) => keys.has(item.category)).map((item) => [item.id, item.name]));
  }, [categories, items]);
  const classes = useMemo(() => weaponClasses(categories), [categories]);
  const classNames = useMemo(() => new Map(classes.map((klass) => [klass.key, klass.label])), [classes]);
  const archivedCount = items.filter((item) => statusOf(item) === "archived").length;
  const listed = items.filter((item) => showArchived || statusOf(item) !== "archived");
  const shown = listed.filter((item) => matchesSearch(item, search));
  const groups = groupByCategory(shown, categories).filter((group) => !only || group.category.key === only);
  const full = items.length >= (data?.limit || 1000);
  const searching = Boolean(search.trim());

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
  const assignWeapons = (weaponIds, classIds) => act(async () => {
    const { data: body } = await api.post(`/games/${gameId}/equipment/assign-weapons`, { weapon_ids: weaponIds, weapon_class_ids: classIds });
    toast.success(body.updated === 1 ? "1 Aufsatz zugeordnet." : `${body.updated} Aufsätze zugeordnet.`);
  });
  const toggleSelected = (item) => setSelected((list) => (list.some((row) => row.id === item.id) ? list.filter((row) => row.id !== item.id) : [...list, item]));
  const toggleAll = (rows) => setSelected((list) => {
    const every = rows.every((row) => list.some((entry) => entry.id === row.id));
    return every ? list.filter((entry) => !rows.some((row) => row.id === entry.id)) : [...list, ...rows.filter((row) => !list.some((entry) => entry.id === row.id))];
  });
  const stopSelecting = () => { setSelecting(false); setSelected([]); };
  const move = (target) => act(async () => {
    const { data: body } = await api.post(`/games/${gameId}/equipment/move`, { item_ids: selected.map((item) => item.id), subcategory: target });
    const label = target ? categories.flatMap((row) => row.subcategories || []).find((sub) => sub.key === target)?.label : NO_SUBCATEGORY;
    toast.success(`${countText(body.updated, "Eintrag", "Einträge")} nach „${label}“ verschoben.`);
    setSelected([]);
  });
  const lonely = data?.attachments_without_weapon || [];
  const assignable = items.filter((item) => weaponNames.has(item.id) && statusOf(item) !== "archived");

  if (error) return <p className="mt-6 text-white/60" role="alert" data-testid="equipment-missing">{error}</p>;
  if (!data) return <p className="mt-6 text-sm text-white/60">Lade Ausrüstung …</p>;

  const itemRow = (category, item) => (
    <ItemRow key={item.id} item={item} role={category.role} weaponNames={weaponNames} classNames={classNames}
      selecting={selecting} selected={selected.some((entry) => entry.id === item.id)} onSelect={toggleSelected}
      onEdit={setEditing} onStatus={setStatus} onDelete={remove} />
  );

  return (
    <section aria-label="Ausrüstung" data-testid="equipment-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-white/65">
          Waffen, Aufsätze und übrige Ausrüstung mit Bild, geordnet in Kategorien und Unterkategorien. Seasons sperren daraus, was nicht
          gespielt werden darf; spätere Änderungen hier ändern keine gespeicherte Sperrliste.
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
          {lonely.length ? <WithoutWeaponNotice rows={lonely} weapons={assignable} classes={classes} onAssign={assignWeapons} /> : null}
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
            <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting} data-testid="equipment-select-mode"
              className={`tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider ${selecting ? "text-[#29B6E8]" : ""}`}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> {selecting ? "Auswahl beenden" : "Auswählen"}
            </button>
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
          <div className="mt-6 space-y-9">
            {groups.map(({ category, items: rows }) => {
              const subs = category.subcategories || [];
              const all = listed.filter((item) => item.category === category.key);
              const sections = groupBySubcategory(rows, category).filter((group) => !searching || group.items.length);
              return (
                <div key={category.key} data-testid={`equipment-group-${category.key}`}>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-2">
                    <h2 className="flex min-w-0 items-baseline gap-2 font-heading text-lg font-bold uppercase">
                      <span className="break-words">{category.label}</span>
                      <span className="text-[11px] font-semibold normal-case tracking-normal text-white/50 tabular-nums">
                        {ROLE_LABELS[category.role]} · {countText(rows.length, "Eintrag", "Einträge")}{subs.length ? ` · ${countText(subs.length, "Unterkategorie", "Unterkategorien")}` : ""}
                      </span>
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSubsFor(category.key)} className={SMALL_BUTTON} data-testid={`equipment-subcategories-${category.key}`}>
                        <ListTree className="h-3 w-3" aria-hidden="true" /> Unterkategorien
                      </button>
                      <button type="button" onClick={() => setEditing({ category: category.key })} disabled={full} data-testid={`equipment-add-${category.key}`} className={SMALL_BUTTON}>
                        <Plus className="h-3 w-3" aria-hidden="true" /> Hinzufügen
                      </button>
                    </div>
                  </div>
                  {!subs.length ? (
                    rows.length ? <ItemGrid rows={rows}>{rows.map((item) => itemRow(category, item))}</ItemGrid> : (
                      <p className="rounded-sm border border-dashed border-white/15 px-3 py-3 text-sm text-white/60">
                        {searching ? "Nichts gefunden." : "Noch kein Eintrag."}
                      </p>
                    )
                  ) : !sections.length ? (
                    <p className="rounded-sm border border-dashed border-white/15 px-3 py-3 text-sm text-white/60">Nichts gefunden.</p>
                  ) : (
                    <div className="space-y-2">
                      {sections.map(({ sub, items: subRows }) => {
                        const key = `${category.key}:${sub ? sub.key : ""}`;
                        const total = all.filter((item) => (sub ? item.subcategory === sub.key : !subs.some((entry) => entry.key === item.subcategory))).length;
                        return (
                          <SubGroup key={key} id={`equipment-sub-body-${category.key}-${sub ? sub.key : "ohne"}`} sub={sub} rows={subRows} total={total}
                            open={searching || !closed[key]} onToggle={() => setClosed((state) => ({ ...state, [key]: !state[key] }))}
                            onAdd={() => setEditing({ category: category.key, subcategory: sub?.key || "" })} full={full} searching={searching}
                            selecting={selecting} onSelectAll={toggleAll} allSelected={subRows.length > 0 && subRows.every((item) => selected.some((entry) => entry.id === item.id))}>
                            <ItemGrid rows={subRows}>{subRows.map((item) => itemRow(category, item))}</ItemGrid>
                          </SubGroup>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {selecting ? <MoveBar selected={selected} categories={categories} onMove={move} onCancel={stopSelecting} /> : null}
        </>
      )}

      {categoriesOpen ? (
        <EquipmentCategoriesSheet game={data.game} categories={categories} suggested={data.suggested_categories || []} limit={data.categories_limit || 20}
          onClose={() => setCategoriesOpen(false)} onSaved={() => { setCategoriesOpen(false); load(); }} onDirtyChange={onDirtyChange} />
      ) : null}
      {subsFor ? (() => {
        const category = categories.find((entry) => entry.key === subsFor);
        return category ? (
          <EquipmentSubcategoriesSheet game={data.game} category={category} counts={data.subcategory_counts || {}}
            suggested={(data.suggested_subcategories || {})[category.role] || []} limit={data.subcategories_limit || 30}
            onClose={() => setSubsFor(null)} onSaved={() => { setSubsFor(null); load(); }} onDirtyChange={onDirtyChange} />
        ) : null;
      })() : null}
      {importing ? (
        <EquipmentImportSheet game={data.game} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }}
          onDirtyChange={onDirtyChange} />
      ) : null}
      {editing ? (
        <EquipmentItemSheet game={data.game} categories={categories} items={items} item={editing.id ? editing : null} initialCategory={editing.category}
          initialSubcategory={editing.subcategory || ""} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onDirtyChange={onDirtyChange} />
      ) : null}
    </section>
  );
}
