// Sperrliste der Season (docs/LIGA.md, C.4 #2218) - eigenständiger Baustein der Season-Seite, lädt sich selbst.
// Alles ist erlaubt außer dem, was hier gesperrt ist; je Eintrag in allen Modi oder in einzelnen, an einer Waffe auch nur einzelne
// Aufsätze. Jedes Speichern ist eine neue Version: Staffeln bekommen sie beim Übertragen, ein Spiel mit Ergebnis behält seine. Das
// Regelwerk zeigt die Liste über den Baustein „Sperrliste“ - ist sie neuer als die letzte Fassung, sagt es der Hinweis oben.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, ChevronDown, GitCompare, Search } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { SelectField } from "@/components/tls/FormFields";
import { EquipmentThumb, LoadoutBansView } from "@/components/tls/league/LoadoutBansView";
import {
  countText, fitsWeapon, formPayload, formProblem, groupByCategory, listToForm, matchesSearch, rowKey, sameRows, statusOf,
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
  const line = (row) => `${row.name}${row.kind === "attachments" ? ` (Aufsätze: ${row.attachments.join(", ")})` : ""} · ${row.modes.join(", ")}`;
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
            {diff.added.map((row) => <li key={`a-${row.kind}-${row.item_id}`} className="text-[#29B6E8]">Neu gesperrt: {line(row)}</li>)}
            {diff.changed.map((row) => <li key={`c-${row.kind}-${row.item_id}`} className="text-white/85">Geändert: {line(row)} <span className="text-white/50">(vorher {line(row.before)})</span></li>)}
            {diff.removed.map((row) => <li key={`r-${row.kind}-${row.item_id}`} className="text-warn">Wieder erlaubt: {line(row)}</li>)}
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

function WeaponAttachments({ weapon, attachments, row, keptIds, modes, onChange }) {
  const chosen = row?.attachment_ids || [];
  const toggle = (id) => onChange({ attachment_ids: chosen.includes(id) ? chosen.filter((key) => key !== id) : [...chosen, id] });
  return (
    <div className="mt-2 space-y-2 rounded-sm border border-white/10 bg-[#0A0A0A] p-2.5" data-testid={`season-bans-attachments-${weapon.id}`}>
      <p className="text-[11px] text-white/60">An „{weapon.name}“ gesperrte Aufsätze – alle anderen bleiben erlaubt.</p>
      {attachments.length ? (
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {attachments.map((item) => {
            const blocked = statusOf(item) === "inactive" && !keptIds.has(item.id);
            return (
              <label key={item.id} className={`${CHIP} ${chosen.includes(item.id) ? ON : OFF} ${blocked ? "cursor-not-allowed opacity-50" : ""}`}>
                <input type="checkbox" checked={chosen.includes(item.id)} disabled={blocked && !chosen.includes(item.id)} onChange={() => toggle(item.id)} className="accent-[#29B6E8]" />
                <span className="break-words">{item.name}{statusOf(item) === "inactive" ? " (inaktiv)" : ""}</span>
              </label>
            );
          })}
        </div>
      ) : <p className="text-xs text-white/60">Zu dieser Waffe passt noch kein Aufsatz.</p>}
      {chosen.length && modes.length ? <ModePicker modes={modes} value={row.modes} onChange={(value) => onChange({ modes: value })} label={`Modi für die Aufsätze an ${weapon.name}`} /> : null}
    </div>
  );
}

function ItemLine({ item, role, row, attachmentRow, attachments, kept, keptAttached, modes, open, onToggleOpen, onItem, onAttachments }) {
  const banned = !!row;
  const blocked = statusOf(item) === "inactive" && !kept.has(rowKey("item", item.id));
  const fullyBanned = banned && !row.modes.length;
  const attachmentCount = attachmentRow?.attachment_ids?.length || 0;
  return (
    <li className={`rounded-sm border p-2.5 ${banned ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#121212]"}`} data-testid={`season-bans-item-${item.id}`}>
      <div className="flex items-start gap-3">
        <EquipmentThumb src={item.image_url} sizes="80px" className="w-16 shrink-0 sm:w-20" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <label className={`flex items-start gap-2 ${blocked && !banned ? "cursor-not-allowed text-white/50" : "cursor-pointer text-white"}`}>
            <input type="checkbox" checked={banned} disabled={blocked && !banned} onChange={() => onItem(banned ? null : { modes: [] })}
              className="mt-0.5 accent-[#FF9F0A]" aria-label={`${item.name} sperren`} data-testid={`season-bans-toggle-${item.id}`} />
            <span className="min-w-0 text-sm font-semibold leading-snug break-words">
              {item.name}
              {statusOf(item) === "inactive" ? <span className="ml-1.5 text-[11px] font-normal text-white/55">inaktiv{blocked ? " – nicht neu sperrbar" : ""}</span> : null}
            </span>
          </label>
          {banned && modes.length ? <ModePicker modes={modes} value={row.modes} onChange={(value) => onItem({ modes: value })} label={`Modi für ${item.name}`} /> : null}
          {role === "weapon" && !fullyBanned ? (
            <button type="button" onClick={onToggleOpen} aria-expanded={open} data-testid={`season-bans-open-${item.id}`}
              className="inline-flex items-center gap-1 rounded-sm text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-fast ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              Aufsätze {attachmentCount ? `· ${attachmentCount} gesperrt` : "einzeln sperren"}
            </button>
          ) : null}
        </div>
      </div>
      {role === "weapon" && open && !fullyBanned ? (
        <WeaponAttachments weapon={item} attachments={attachments} row={attachmentRow} keptIds={keptAttached} modes={modes} onChange={onAttachments} />
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
      const form = listToForm(body.list, body.library, body.game?.modes || []);
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
    return (weaponId) => all.filter((item) => fitsWeapon(item, weaponId));
  }, [categories, library]);

  if (error) return <p className="text-sm text-warn" role="alert" data-testid={`${testId}-error`}>{error}</p>;
  if (!data) return null;
  const list = data.list;
  const changed = !sameRows(rows, saved) || dropped.length > 0;
  const bannedCount = Object.values(rows).filter((row) => row.kind === "item" || row.attachment_ids.length).length;

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

  const save = async () => {
    const problem = formProblem(rows, library);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: body } = await api.put(`/admin/leagues/seasons/${seasonId}/loadout-bans`, {
        entries: formPayload(rows, library), expected_version: list?.version || 0 });
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
  const visible = library.filter((item) => matchesSearch(item, search)
    && (!onlyBanned || rows[rowKey("item", item.id)] || rows[rowKey("attachments", item.id)]));
  const groups = groupByCategory(visible, categories).filter((group) => (!only || group.category.key === only) && group.items.length);

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
          <Link to={`/admin/games/${data.game.id}/equipment`} className="text-[11px] font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]" data-testid={`${testId}-library`}>
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
          <div className="space-y-6">
            {groups.map(({ category, items }) => (
              <div key={category.key} data-testid={`${testId}-group-${category.key}`}>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{category.label}</h3>
                <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {items.map((item) => (
                    <ItemLine key={item.id} item={item} role={category.role} row={rows[rowKey("item", item.id)]}
                      attachmentRow={rows[rowKey("attachments", item.id)]} attachments={category.role === "weapon" ? attachmentsByWeapon(item.id) : []}
                      kept={kept} keptAttached={keptAttached(item.id)} modes={modes} open={!!open[item.id] || !!rows[rowKey("attachments", item.id)]}
                      onToggleOpen={() => setOpen((current) => ({ ...current, [item.id]: !current[item.id] }))}
                      onItem={(patch) => setItem(item.id, patch)} onAttachments={(patch) => setAttachments(item.id, patch)} />
                  ))}
                </ul>
              </div>
            ))}
            {!groups.length ? <p className="text-sm text-white/60">Nichts gefunden.</p> : null}
          </div>
          <p className="text-xs text-white/60">Ein Aufsatz in seiner Kategorie gesperrt gilt an jeder Waffe; an einer einzelnen Waffe sperrst du ihn über „Aufsätze einzeln sperren“.</p>
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
