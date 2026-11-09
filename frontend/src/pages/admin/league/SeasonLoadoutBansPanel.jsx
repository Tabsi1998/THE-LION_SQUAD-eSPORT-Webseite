// Sperrliste der Season (docs/LIGA.md, C.4 #2218) - eigenständiger Baustein der Season-Seite, lädt sich selbst.
// Alles ist erlaubt außer dem, was hier gesperrt ist; je Eintrag in allen Modi oder in einzelnen, an einer Waffe auch nur einzelne
// Aufsätze. Jedes Speichern ist eine neue Version: Staffeln bekommen sie beim Übertragen, ein Spiel mit Ergebnis behält seine. Das
// Regelwerk zeigt die Liste über den Baustein „Sperrliste“ - ist sie neuer als die letzte Fassung, sagt es der Hinweis oben.
// Unterkategorien (#2287): je Kategorie gruppiert, je Unterkategorie der Schalter „Ganze Klasse sperren“ (auch je Modus) - er gilt für
// alle Einträge der Klasse, auch spätere. Darunter die Einzelnen wie bisher.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, ChevronDown, GitCompare, Search } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { gamePageUrl } from "@/lib/gameForm";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { SelectField } from "@/components/tls/FormFields";
import { EquipmentThumb, LoadoutBansView, SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import {
  attachmentModes, attachmentSlots, banAttachmentEverywhere, bannedAttachmentCount, classRow, copyAttachmentsToClass, countText, effectiveRows, fitsWeapon, formPayload, formProblem,
  groupByCategory, groupBySubcategory, listToForm, matchesSearch, NO_SUBCATEGORY, rowKey, sameRows, statusOf, subcategoryOf,
} from "@/lib/loadoutBans";
import { viennaDate } from "@/lib/vienna";
import { toast } from "sonner";

const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const CHIP = "inline-flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8]";
const ON = "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white";
const OFF = "border-white/10 bg-[#0A0A0A] text-white/70 hover:border-white/25";

function ModePicker({ modes, value, onChange, label }) {
  // Inaktive und archivierte Modi nur, wo sie schon gesetzt sind (#2206).
  const offered = modes.filter((mode) => mode.status === "active" || !mode.status || value.includes(mode.mode));
  if (!offered.length) return null;
  const toggle = (key) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-[11px] text-white/55">Gilt in</span>
      <label className={`${CHIP} ${value.length ? OFF : ON}`}>
        <input type="checkbox" checked={!value.length} onChange={() => onChange([])} className="accent-[#29B6E8]" />
        allen Modi
      </label>
      {offered.map((mode) => (
        <label key={mode.mode} className={`${CHIP} ${value.includes(mode.mode) ? ON : OFF}`}>
          <input type="checkbox" checked={value.includes(mode.mode)} onChange={() => toggle(mode.mode)} className="accent-[#29B6E8]" />
          <span className="break-words">{mode.label}{mode.status && mode.status !== "active" ? " (inaktiv)" : ""}</span>
        </label>
      ))}
    </div>
  );
}

// Notiz des Eintrags aus der Bibliothek (#2302): klein und leise unter dem Namen, nur in der Verwaltung; leer = nichts.
function ItemNote({ item, className = "" }) {
  if (!item.note) return null;
  return <p className={`${className} text-[11px] italic text-white/50 break-words`} data-testid={`season-bans-note-${item.id}`}>{item.note}</p>;
}

function versionLabel(row) {
  const day = row.saved_at ? ` · ${viennaDate(row.saved_at, DAY)}` : "";
  return `Version ${row.version}${day}${row.cleared ? " · entfernt" : ` · ${countText(row.entries, "Eintrag", "Einträge")}`}`;
}

function VersionCompare({ seasonId, versions }) {
  const [base, setBase] = useState(versions[1] ? String(versions[1].version) : "");
  const [target, setTarget] = useState(versions[0] ? String(versions[0].version) : "");
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState("");
  if (versions.length < 2) return null;
  const options = versions.map((row) => [String(row.version), versionLabel(row)]);
  const run = async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/loadout-bans/compare`, { params: { base, target } });
      setDiff(data);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  };
  const line = (row) => {
    if (row.kind === "class") return `ganze Klasse ${row.name} · ${row.modes.join(", ")}`;
    return `${row.name}${row.kind === "attachments" ? ` (Aufsätze: ${row.attachments.join(", ")})` : ""} · ${row.modes.join(", ")}`;
  };
  return (
    <details className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid="season-bans-compare">
      <summary className="cursor-pointer select-none rounded-sm text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
        Versionen vergleichen
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField label="Von Version" value={base} onChange={setBase} options={options} testId="season-bans-compare-base" />
          <SelectField label="Zu Version" value={target} onChange={setTarget} options={options} testId="season-bans-compare-target" />
          <button type="button" onClick={run} disabled={!base || !target} data-testid="season-bans-compare-run"
            className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" /> Vergleichen
          </button>
        </div>
        {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
        {diff ? (diff.same ? <p className="text-sm text-white/60" data-testid="season-bans-compare-same">Beide Versionen sperren dasselbe.</p> : (
          <ul className="space-y-1 text-sm break-words" data-testid="season-bans-compare-result" aria-live="polite">
            {diff.added.map((row) => <li key={`a-${row.kind}-${row.item_id || row.subcategory}`} className="text-[#29B6E8]">Neu gesperrt: {line(row)}</li>)}
            {diff.changed.map((row) => <li key={`c-${row.kind}-${row.item_id || row.subcategory}`} className="text-white/85">Geändert: {line(row)} <span className="text-white/50">(vorher {line(row.before)})</span></li>)}
            {diff.removed.map((row) => <li key={`r-${row.kind}-${row.item_id || row.subcategory}`} className="text-warn">Wieder erlaubt: {line(row)}</li>)}
          </ul>
        )) : null}
      </div>
    </details>
  );
}

function RulesHint({ rules }) {
  if (!rules?.uses_block) {
    return (
      <p className="text-xs text-white/60" data-testid="season-bans-rules-none">
        Ins Regelwerk kommt die Liste mit dem Baustein „Sperrliste“ (etwa als Anlage A); jede Fassung hält ihren Stand fest.
      </p>
    );
  }
  if (!rules.outdated) return <p className="text-xs text-white/60" data-testid="season-bans-rules-ok">Das Regelwerk (Version {rules.version}) zeigt diesen Stand.</p>;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn" data-testid="season-bans-rules-outdated">
      <span>Das Regelwerk (Version {rules.version}) zeigt noch die alte Liste. Die Unterschiede sind dort markiert.</span>
      <Link to={rules.admin_url} className="tls-btn tls-btn--secondary rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Neue Version vorbereiten</Link>
    </div>
  );
}

// Ein Aufsatz an der Waffe (#2299): Häkchen „gesperrt“, darunter seine Modi und „An allen Waffen sperren“. Ist er überall gesperrt (eigene
// Zeile oder ganze Klasse in allen Modi), steht das nur da.
function AttachmentLine({ item, weapon, row, everywhere, viaClass, kept, modes, locked = false, onToggle, onModes, onEverywhere }) {
  const chosen = (row?.attachment_ids || []).includes(item.id);
  // Ganz gesperrte Waffe (`locked`): die Häkchen bleiben im Formular stehen, gelten aber nicht und entfallen beim Speichern.
  const fixed = Boolean((everywhere && !everywhere.modes.length) || viaClass || locked);
  const blocked = statusOf(item) === "inactive" && !kept;
  const value = attachmentModes(row, item.id);
  return (
    <li className={`rounded-sm border px-2.5 py-2 ${locked ? "border-white/10 bg-[#121212] opacity-50" : chosen || fixed ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#121212]"}`}
      data-testid={`season-bans-attachment-${weapon.id}-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <label className={`flex min-w-0 items-center gap-2.5 ${fixed || (blocked && !chosen) ? "cursor-not-allowed text-white/70" : "cursor-pointer text-white"}`}>
          <input type="checkbox" checked={chosen || (fixed && !locked)} disabled={fixed || (blocked && !chosen)} onChange={onToggle} className="accent-[#FF9F0A]"
            aria-label={`${item.name} an ${weapon.name} sperren`} data-testid={`season-bans-attachment-toggle-${weapon.id}-${item.id}`} />
          <EquipmentThumb src={item.image_url} sizes="56px" className="w-14 shrink-0" />
          <span className="min-w-0 text-sm font-semibold leading-snug break-words">
            {item.name}
            {statusOf(item) === "inactive" ? <span className="ml-1.5 text-[11px] font-normal text-white/55">inaktiv{blocked ? " – nicht neu sperrbar" : ""}</span> : null}
          </span>
        </label>
        {chosen && !fixed && statusOf(item) === "active" ? (
          <button type="button" onClick={() => onEverywhere(value)} data-testid={`season-bans-everywhere-${weapon.id}-${item.id}`}
            className="tls-btn tls-btn--quiet rounded-sm px-2 py-1 text-[11px] font-semibold">
            An allen Waffen sperren
          </button>
        ) : null}
      </div>
      <ItemNote item={item} className="mt-1" />
      {viaClass ? <p className="mt-1 text-[11px] text-warn">Mit der ganzen Klasse gesperrt</p> : null}
      {everywhere && !viaClass ? (
        <p className="mt-1 text-[11px] text-warn">{everywhere.modes.length ? `An allen Waffen gesperrt in ${modeNames(everywhere.modes, modes)}` : "An allen Waffen gesperrt"}</p>
      ) : null}
      {chosen && !fixed && modes.length ? (
        <div className="mt-1.5"><ModePicker modes={modes} value={value} onChange={onModes} label={`Modi für ${item.name} an ${weapon.name}`} /></div>
      ) : null}
    </li>
  );
}

function WeaponAttachments({ weapon, attachments, categories, rows, row, keptIds, modes, lockedText = "", onChange, onCopyToClass, onEverywhere }) {
  const chosen = row?.attachment_ids || [];
  const own = row?.attachment_modes || {};
  const slots = attachmentSlots(attachments, categories);
  const classLabel = weapon.subcategory ? subcategoryOf(categories, weapon.subcategory)?.label : null;
  const toggle = (id) => {
    if (chosen.includes(id)) {
      const rest = { ...own };
      delete rest[id];
      onChange({ attachment_ids: chosen.filter((key) => key !== id), attachment_modes: rest });
    } else onChange({ attachment_ids: [...chosen, id] });
  };
  const setModes = (id, value) => onChange({ attachment_modes: { ...own, [id]: value } });
  return (
    <div className="mt-2 space-y-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-2.5" data-testid={`season-bans-attachments-${weapon.id}`}>
      {lockedText ? (
        <p className="text-[11px] text-warn" role="status" data-testid={`season-bans-attachments-locked-${weapon.id}`}>{lockedText}</p>
      ) : null}
      <p className="text-[11px] text-white/60">Passende Aufsätze an „{weapon.name}“ – angehakt ist gesperrt, alle anderen bleiben erlaubt.</p>
      {!slots.length ? <p className="text-xs text-white/60">Zu dieser Waffe passt noch kein Aufsatz.</p> : null}
      {slots.map((slot) => (
        <div key={slot.key} data-testid={`season-bans-slot-${weapon.id}`}>
          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
            <SubcategoryIcon src={slot.icon_url} className="h-4 w-4" />
            <span className="break-words">{slot.label || NO_SUBCATEGORY}</span>
          </p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {slot.items.map((item) => {
              const klass = classRow(rows, item.subcategory);
              return (
                <AttachmentLine key={item.id} item={item} weapon={weapon} row={row} everywhere={rows[rowKey("item", item.id)]}
                  viaClass={Boolean(klass && !klass.modes.length)} kept={keptIds.has(item.id)} modes={modes} locked={Boolean(lockedText)}
                  onToggle={() => toggle(item.id)} onModes={(value) => setModes(item.id, value)} onEverywhere={(value) => onEverywhere(item.id, value)} />
              );
            })}
          </ul>
        </div>
      ))}
      {classLabel && !lockedText ? (
        <button type="button" onClick={onCopyToClass} data-testid={`season-bans-copy-class-${weapon.id}`}
          className="tls-btn tls-btn--secondary rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
          Für alle {classLabel} übernehmen
        </button>
      ) : null}
    </div>
  );
}

// Kopf einer Unterkategorie (#2287): Symbol, Name, Zahl der Einträge und der Schalter „Ganze Klasse sperren“ mit den Modi.
function ClassHead({ sub, count, row, modes, onChange, testId }) {
  const on = Boolean(row);
  return (
    <div className={`mb-2 rounded-sm border px-2.5 py-2 ${on ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#0D0D0D]"}`} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
          <SubcategoryIcon src={sub.icon_url} />
          <span className="break-words">{sub.label}</span>
          <span className="font-semibold normal-case tracking-normal text-white/50 tabular-nums">{countText(count, "Eintrag", "Einträge")}</span>
        </p>
        <label className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-sm border px-2.5 py-1 text-xs font-semibold focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${on ? "border-warn/60 bg-warn/10 text-warn" : "border-white/15 bg-[#0A0A0A] text-white/75 hover:border-white/30"}`}>
          <input type="checkbox" checked={on} onChange={() => onChange(on ? null : { modes: [] })} className="accent-[#FF9F0A]"
            aria-label={`Ganze Klasse ${sub.label} sperren`} data-testid={`${testId}-toggle`} />
          Ganze Klasse sperren
        </label>
      </div>
      {on ? (
        <div className="mt-2 space-y-1.5">
          {modes.length ? <ModePicker modes={modes} value={row.modes} onChange={(value) => onChange({ modes: value })} label={`Modi für die Klasse ${sub.label}`} /> : null}
          <p className="text-[11px] text-white/60">Gilt für alle Einträge der Klasse – auch für später angelegte.</p>
        </div>
      ) : null}
    </div>
  );
}

function modeNames(keys, modes) {
  return keys.map((key) => modes.find((mode) => mode.mode === key)?.label || key).join(", ");
}

function ItemLine({ item, role, row, classBan, attachmentRow, attachments, kept, keptAttached, modes, open, onToggleOpen, onItem, onAttachments,
  categories, rows, onCopyToClass, onEverywhere }) {
  // Ganze Klasse in allen Modi gesperrt (#2287): der Eintrag ist mitgesperrt, einzeln gibt es nichts mehr zu tun.
  const viaClass = Boolean(classBan && !classBan.modes.length);
  const banned = !!row || viaClass;
  const blocked = statusOf(item) === "inactive" && !kept.has(rowKey("item", item.id));
  const fullyBanned = (row && !row.modes.length) || viaClass;
  // K zählt, was aufgeklappt als gesperrt angehakt erscheint - auch über die Zeile des Aufsatzes oder seine Klasse (Codex zu #2299).
  const attachmentCount = bannedAttachmentCount(rows, item.id, attachments, item);
  // Die Aufsatz-Häkchen bleiben im Formular, gelten aber nicht: bei einer ganz gesperrten Waffe entfallen sie beim Speichern.
  const lockedText = viaClass
    ? "Die Klasse der Waffe ist in allen Modi gesperrt – Aufsatz-Sperren entfallen beim Speichern."
    : "Die Waffe ist in allen Modi gesperrt – Aufsatz-Sperren entfallen beim Speichern.";
  return (
    <li className={`rounded-sm border p-2.5 ${banned ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#121212]"}`} data-testid={`season-bans-item-${item.id}`}>
      <div className="flex items-start gap-3">
        <EquipmentThumb src={item.image_url} sizes="80px" className="w-16 shrink-0 sm:w-20" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <label className={`flex items-start gap-2 ${(blocked && !banned) || viaClass ? "cursor-not-allowed text-white/70" : "cursor-pointer text-white"}`}>
            <input type="checkbox" checked={banned} disabled={(blocked && !banned) || viaClass} onChange={() => onItem(row ? null : { modes: [] })}
              className="mt-0.5 accent-[#FF9F0A]" aria-label={`${item.name} sperren`} data-testid={`season-bans-toggle-${item.id}`} />
            <span className="min-w-0 text-sm font-semibold leading-snug break-words">
              {item.name}
              {statusOf(item) === "inactive" ? <span className="ml-1.5 text-[11px] font-normal text-white/55">inaktiv{blocked ? " – nicht neu sperrbar" : ""}</span> : null}
            </span>
          </label>
          <ItemNote item={item} />
          {viaClass ? (
            <p className="text-[11px] text-warn" data-testid={`season-bans-via-class-${item.id}`}>
              Mit der ganzen Klasse gesperrt{row ? " – die Einzel-Sperre entfällt beim Speichern" : ""}
            </p>
          ) : null}
          {classBan && !viaClass ? (
            <p className="text-[11px] text-white/60" data-testid={`season-bans-via-class-${item.id}`}>Klasse gesperrt in {modeNames(classBan.modes, modes)} – einzeln zusätzlich möglich</p>
          ) : null}
          {row && !viaClass && modes.length ? <ModePicker modes={modes} value={row.modes} onChange={(value) => onItem({ modes: value })} label={`Modi für ${item.name}`} /> : null}
          {role === "weapon" ? (
            <button type="button" onClick={onToggleOpen} aria-expanded={open} data-testid={`season-bans-open-${item.id}`}
              className="inline-flex items-center gap-1 rounded-sm text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              {countText(attachments.length, "Aufsatz", "Aufsätze")}{attachmentCount ? ` · ${attachmentCount} gesperrt` : ""}
            </button>
          ) : null}
        </div>
      </div>
      {role === "weapon" && open ? (
        <WeaponAttachments weapon={item} attachments={attachments} categories={categories} rows={rows} row={attachmentRow} keptIds={keptAttached}
          modes={modes} lockedText={fullyBanned ? lockedText : ""} onChange={onAttachments} onCopyToClass={onCopyToClass} onEverywhere={onEverywhere} />
      ) : null}
    </li>
  );
}

export function SeasonLoadoutBansPanel({ seasonId, canEdit, onSaved, testId = "season-bans" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [rows, setRows] = useState({});
  const [saved, setSaved] = useState({});
  const [dropped, setDropped] = useState([]);
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("");
  const [onlyBanned, setOnlyBanned] = useState(false);
  const [open, setOpen] = useState({});
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/loadout-bans`);
      const form = listToForm(body.list, body.library, body.game?.modes || [], body.categories || []);
      setData(body);
      setRows(form.rows);
      setSaved(form.rows);
      setDropped(form.dropped);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);

  const library = useMemo(() => data?.library || [], [data]);
  const categories = useMemo(() => data?.categories || [], [data]);
  const modes = data?.game?.modes || [];
  const kept = useMemo(() => new Set(Object.keys(saved)), [saved]);
  const attachmentsByWeapon = useMemo(() => {
    const keys = new Set(categories.filter((row) => row.role === "attachment").map((row) => row.key));
    const all = library.filter((item) => keys.has(item.category));
    return (weapon) => all.filter((item) => fitsWeapon(item, weapon));
  }, [categories, library]);

  if (error) return <p className="text-sm text-warn" role="alert" data-testid={`${testId}-error`}>{error}</p>;
  if (!data) return null;
  const list = data.list;
  const changed = !sameRows(rows, saved, library) || dropped.length > 0;
  const bannedCount = Object.values(effectiveRows(rows, library)).filter((row) => row.kind !== "attachments" || row.attachment_ids.length).length;

  // Ganze Klasse (#2287): an oder aus, dazu die Modi. In allen Modi gesperrt, entfallen Einzelzeilen darin beim Speichern (`formPayload`) -
  // im Formular bleiben sie stehen, damit sie bei „aus“ wieder da sind.
  const setClass = (subKey, patch) => setRows((current) => {
    const key = rowKey("class", subKey);
    const next = { ...current };
    if (patch === null) {
      delete next[key];
      return next;
    }
    next[key] = { kind: "class", subcategory: subKey, modes: [], attachment_ids: [], ...current[key], ...patch };
    return next;
  });

  const setItem = (id, patch) => setRows((current) => {
    const next = { ...current };
    const key = rowKey("item", id);
    if (patch === null) delete next[key];
    else next[key] = { kind: "item", item_id: id, modes: [], attachment_ids: [], ...current[key], ...patch };
    return next;
  });
  const setAttachments = (id, patch) => setRows((current) => {
    const key = rowKey("attachments", id);
    const row = { kind: "attachments", item_id: id, modes: [], attachment_ids: [], ...current[key], ...patch };
    const next = { ...current };
    if (row.attachment_ids.length) next[key] = row;
    else delete next[key];
    return next;
  });
  // „Für alle <Waffenklasse> übernehmen“ (#2299): nur im Formular, gespeichert wird wie immer als neue Version.
  const copyToClass = (weaponId) => {
    const result = copyAttachmentsToClass(rows, saved, weaponId, library);
    setRows(result.rows);
    if (result.count) toast.success(`Auf ${countText(result.count, "weitere Waffe", "weitere Waffen")} übernommen – noch nicht gespeichert.`);
    else toast("In dieser Klasse gibt es keine weitere Waffe, an der das geht.");
  };

  const save = async () => {
    const problem = formProblem(rows, library);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: body } = await api.put(`/admin/leagues/seasons/${seasonId}/loadout-bans`, {
        entries: formPayload(rows, library, categories), expected_version: list?.version || 0 });
      toast.success(`Sperrliste gespeichert (Version ${body.version}).`);
      onSaved?.(body.staffeln_to_sync || 0);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };
  const clear = async () => {
    if (!await confirm({ title: "Sperrliste entfernen?", confirmLabel: "Entfernen",
      description: "Dann ist alles erlaubt. Staffeln verlieren ihre Kopie erst beim Übertragen und nur ohne Ergebnis; gespielte Spiele behalten ihre Liste." })) return;
    try {
      const { data: body } = await api.delete(`/admin/leagues/seasons/${seasonId}/loadout-bans`);
      toast.success("Sperrliste entfernt.");
      onSaved?.(body.staffeln_to_sync || 0);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const keptAttached = (weaponId) => new Set((saved[rowKey("attachments", weaponId)]?.attachment_ids) || []);
  const searching = Boolean(search.trim());
  const visible = library.filter((item) => matchesSearch(item, search)
    && (!onlyBanned || rows[rowKey("item", item.id)] || rows[rowKey("attachments", item.id)] || classRow(rows, item.subcategory)));
  // Je Kategorie die Abschnitte: ohne Unterkategorie zuerst, dann je Unterkategorie - eine Klasse bleibt sichtbar, solange sie gesperrt
  // ist oder (ohne Suche und Filter) zum Sperren angeboten wird, auch leer.
  const groups = groupByCategory(visible, categories)
    .filter((group) => !only || group.category.key === only)
    .map((group) => ({ ...group, sections: groupBySubcategory(group.items, group.category).filter(({ sub, items }) => items.length
      || (sub && (classRow(rows, sub.key) || (!searching && !onlyBanned)))) }))
    .filter((group) => group.sections.length);
  const newInClasses = list?.class_new_items || [];

  return (
    <section className="space-y-4 rounded-sm border border-white/10 bg-[#121212] p-4 md:p-5" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${testId}-title`} className="flex items-center gap-2 font-heading text-xl font-bold uppercase">
            <Ban className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" /> Sperrliste
          </h2>
          <p className="mt-1 text-sm text-white/65" data-testid={`${testId}-head`}>
            {list ? `Version ${list.version} · ${countText(list.entries.length, "Zeile", "Zeilen")}` : "Noch keine – alles ist erlaubt."}
            {data.staffeln ? ` · ${countText(data.staffeln, "Staffel bekommt", "Staffeln bekommen")} Änderungen beim Übertragen.` : ""}
          </p>
        </div>
        {data.game ? (
          <Link to={gamePageUrl(data.game.id, "ausruestung")} className="text-[11px] font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]" data-testid={`${testId}-library`}>
            Bibliothek pflegen
          </Link>
        ) : null}
      </div>
      <RulesHint rules={data.rules} />
      {list?.outdated_item_ids?.length ? (
        <p className="text-xs text-white/65" data-testid={`${testId}-outdated`}>
          In der Bibliothek geändert seit dieser Version: {countText(list.outdated_item_ids.length, "Eintrag", "Einträge")}. Neu speichern übernimmt Namen und Bilder.
        </p>
      ) : null}

      {!canEdit ? (
        list ? <LoadoutBansView list={list} title="Gesperrt" className="" headingId={`${testId}-view`} testId={`${testId}-view`} /> : null
      ) : !data.game ? (
        <p className="text-sm text-white/60">Die Liga hat kein Spiel – ohne Spiel gibt es keine Sperrliste.</p>
      ) : !library.length ? (
        <p className="rounded-sm border border-dashed border-white/15 px-3 py-4 text-sm text-white/65" data-testid={`${testId}-empty-library`}>
          Für {data.game.name} gibt es noch keine Ausrüstung. Lege sie in der Bibliothek an – mit Bild, damit Regelwerk und Ligaseite sie zeigen.
        </p>
      ) : (
        <>
          {dropped.length ? (
            <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn" role="status" data-testid={`${testId}-dropped`}>
              Fällt beim Speichern weg, weil archiviert oder gelöscht: {dropped.join(", ")}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden="true" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name suchen" aria-label="In der Bibliothek suchen"
                data-testid={`${testId}-search`}
                className="w-full rounded-sm border border-white/15 bg-[#0A0A0A] py-2 pl-8 pr-3 text-sm text-white placeholder:text-white/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={onlyBanned} onChange={(event) => setOnlyBanned(event.target.checked)} className="accent-[#29B6E8]" data-testid={`${testId}-only-banned`} />
              Nur gesperrte ({bannedCount})
            </label>
          </div>
          <div className="tls-swipe flex gap-2 pb-1" role="group" aria-label="Kategorie wählen">
            {[{ key: "", label: "Alle" }, ...categories].map((category) => (
              <button key={category.key || "alle"} type="button" onClick={() => setOnly(category.key)} aria-pressed={only === category.key}
                className={`shrink-0 rounded-sm border px-2.5 py-1 text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] ${only === category.key ? ON : OFF}`}>
                {category.label}
              </button>
            ))}
          </div>
          {newInClasses.length ? (
            <p className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-xs text-white/70" role="status" data-testid={`${testId}-class-new`}>
              Seit dieser Version neu in gesperrten Klassen und schon mitgesperrt: {newInClasses.map((row) => `${row.label}: ${row.names.join(", ")}`).join(" · ")}.
            </p>
          ) : null}
          {(data.unusable_attachments || []).length ? (
            // Nr. 81 (Codex Runde 1): Aufsätze ohne erlaubte Waffe sind nicht spielbar - Regelwerk, Liga- und Matchseite zeigen sie nicht.
            <section className="space-y-0.5 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-xs" role="status" data-testid={`${testId}-unusable`}>
              <p className="font-semibold text-warn">Diese Aufsätze erscheinen nicht als erlaubt</p>
              <p className="text-white/70 break-words">
                {data.unusable_attachments.map((row) => `${row.name} (${row.reason})`).join(", ")}. Nach der gespeicherten Liste passen sie an
                keiner erlaubten Waffe – in der Bibliothek einer Waffe oder Waffenklasse zuordnen oder hier weniger sperren.
              </p>
            </section>
          ) : null}
          <div className="space-y-8">
            {groups.map(({ category, sections }) => (
              <div key={category.key} data-testid={`${testId}-group-${category.key}`}>
                <h3 className="mb-3 border-b border-white/10 pb-2 font-heading text-base font-bold uppercase text-white">{category.label}</h3>
                <div className="space-y-5">
                  {sections.map(({ sub, items }) => (
                    <div key={sub?.key || "ohne"} data-testid={`${testId}-section-${sub?.key || `${category.key}-ohne`}`}>
                      {sub ? (
                        <ClassHead sub={sub} count={library.filter((item) => item.subcategory === sub.key).length} row={classRow(rows, sub.key)} modes={modes}
                          onChange={(patch) => setClass(sub.key, patch)} testId={`${testId}-class-${sub.key}`} />
                      ) : category.subcategories?.length ? (
                        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/55">{NO_SUBCATEGORY}</p>
                      ) : null}
                      {items.length ? (
                        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                          {items.map((item) => (
                            <ItemLine key={item.id} item={item} role={category.role} row={rows[rowKey("item", item.id)]} classBan={classRow(rows, item.subcategory)}
                              attachmentRow={rows[rowKey("attachments", item.id)]} attachments={category.role === "weapon" ? attachmentsByWeapon(item) : []}
                              kept={kept} keptAttached={keptAttached(item.id)} modes={modes} open={!!open[item.id]}
                              onToggleOpen={() => setOpen((current) => ({ ...current, [item.id]: !current[item.id] }))}
                              onItem={(patch) => setItem(item.id, patch)} onAttachments={(patch) => setAttachments(item.id, patch)}
                              categories={categories} rows={rows} onCopyToClass={() => copyToClass(item.id)}
                              onEverywhere={(attachmentId, value) => setRows((current) => banAttachmentEverywhere(current, attachmentId, value))} />
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-sm border border-dashed border-white/15 px-3 py-2 text-xs text-white/55">
                          Noch kein Eintrag in dieser Klasse – eine Sperre gilt ab dem ersten.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length ? <p className="text-sm text-white/60">Nichts gefunden.</p> : null}
          </div>
          <p className="text-xs text-white/60">
            Eine ganze Klasse gesperrt gilt für alle ihre Einträge, auch später angelegte. Ein Aufsatz in seiner Kategorie gesperrt gilt an
            jeder Waffe; an einer einzelnen Waffe sperrst du ihn, indem du bei der Waffe die Aufsätze aufklappst.
          </p>
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#121212]/95 px-4 py-3 md:-mx-5 md:px-5">
            <button type="button" onClick={save} disabled={saving || !changed} data-testid={`${testId}-save`}
              className="tls-btn tls-btn--primary rounded-sm px-5 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {saving ? "Speichere …" : list ? "Neue Version speichern" : "Sperrliste speichern"}
            </button>
            {list ? (
              <button type="button" onClick={clear} data-testid={`${testId}-clear`}
                className="tls-btn tls-btn--quiet rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">Entfernen</button>
            ) : null}
            <span className="text-xs text-white/60" aria-live="polite">{changed ? `${countText(bannedCount, "Zeile", "Zeilen")} – noch nicht gespeichert` : "Keine Änderung"}</span>
          </div>
        </>
      )}
      <VersionCompare key={list?.id || "keine"} seasonId={seasonId} versions={data.versions || []} />
    </section>
  );
}
