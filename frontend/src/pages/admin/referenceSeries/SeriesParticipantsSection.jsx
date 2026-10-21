import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { UnknownNamesSheet } from "./UnknownNamesSheet";
import { ALIAS_HINT, ParticipantEditSheet } from "./ParticipantEditSheet";
import { ParticipantMergeSheet } from "./ParticipantMergeSheet";
import { toast } from "sonner";
import { Combine, Pencil, Plus, Search, UserRound, UserSearch, UserX, X } from "lucide-react";

// Teilnehmer und Zuordnung (#1743): die Namen der Saison wie beim Veranstalter, je als Mitglied (mit Profil), Gast,
// Extern oder noch offen. Offene Namen ordnet der Dialog „Unbekannte Namen“ zu. Aliase und Verknüpfungen sieht nur
// die Verwaltung (Bereich Redaktion). Bekommt `series` (samt `lineage`).
//
// Nachträglich bearbeiten (#1929): je Zeile „Bearbeiten“ (Name, Startnummer, Team, Zuordnung, Entfernen ohne
// Ergebnis), Filter nach Zuordnung und Suche, Mehrfachauswahl mit „Als Gast“ und „Als Extern“ (ein Aufruf, der Server
// rechnet einmal neu; eine Rückfrage für alle, wenn dabei eine Zuordnung verloren geht) und – bei genau zwei –
// „Zusammenführen“. Gewählt zählt nur, was gerade sichtbar ist.

const LINK_LABELS = { member: "Mitglied", guest: "Gast", external: "Extern" };
const FILTERS = [["all", "Alle"], ["member", "Mitglieder"], ["guest", "Gäste"], ["external", "Extern"], ["open", "Offen"]];
const BULK_LABELS = { guest: "Gast", external: "Extern" };

export function splitNames(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function countsText(counts = {}) {
  const count = (value, one, many) => `${value || 0} ${value === 1 ? one : many}`;
  return [
    count(counts.member, "Mitglied", "Mitglieder"),
    count(counts.guest, "Gast", "Gäste"),
    `${counts.external || 0} Extern`,
    `${counts.open || 0} offen`,
  ].join(" · ");
}

function linkState(row) {
  return row.link_status === "open" ? "open" : row.link || "external";
}

function searchable(text) {
  return String(text || "").toLocaleLowerCase("de").split(/\s+/).filter(Boolean).join(" ");
}

/** Die Teilnehmer nach Zuordnung (`all`, `member`, `guest`, `external`, `open`) und Suche (Name, Startnummer, Team,
 * Profil). Offene zählen nie als Extern. */
export function visibleParticipants(rows = [], filter = "all", query = "") {
  const needle = searchable(query);
  return rows.filter((row) => (filter === "all" || linkState(row) === filter)
    && (!needle || [row.name, row.start_number, row.default_team, row.profile_name, row.guest_name]
      .some((value) => searchable(value).includes(needle))));
}

function linkText(row) {
  if (row.link_status === "open") return "Offen";
  if (row.link === "member") return row.profile_name ? `Mitglied · ${row.profile_name}` : LINK_LABELS.member;
  if (row.link === "guest") return row.guest_name && row.guest_name !== row.name ? `Gast · ${row.guest_name}` : LINK_LABELS.guest;
  return LINK_LABELS[row.link] || LINK_LABELS.external;
}

function rowDetails(row) {
  return [row.start_number && `Nr. ${row.start_number}`, row.default_team].filter(Boolean).join(" · ");
}

function describe(row) {
  return [linkText(row), rowDetails(row)].filter(Boolean).join(" · ");
}

function bulkText(data, link) {
  const changed = data?.changed?.length || 0;
  const unchanged = data?.unchanged?.length || 0;
  return [`${changed} als ${BULK_LABELS[link]} markiert`, unchanged ? `${unchanged} ${unchanged === 1 ? "war" : "waren"} es schon` : ""]
    .filter(Boolean).join(" · ");
}

const LINK_TONE = { member: "text-[#29B6E8]", guest: "text-white/75", external: "text-white/45" };
const ACTION_CLASS = "tls-btn px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50";

function AddNamesSheet({ series, onClose, onSaved }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const names = splitNames(text);
    if (!names.length) {
      toast.error("Bitte mindestens einen Namen eintragen.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/reference-series/admin/series/${series.id}/participants/batch`, { names });
      const created = data.created || [];
      const recognised = created.filter((row) => row.link_status !== "open").length;
      toast.success([`${created.length} hinzugefügt`, recognised ? `${recognised} schon erkannt` : "", data.skipped ? `${data.skipped} übersprungen` : ""].filter(Boolean).join(" · "));
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Namen hinzufügen" eyebrow={series.lineage?.title} onClose={onClose} onSubmit={save} saving={saving} submitLabel="Hinzufügen" submitTestId="participants-add-save" testId="participants-add">
      <TextAreaField label="Namen" rows={10} value={text} onChange={setText} testId="participants-add-names"
        hint="Ein Name je Zeile, so wie beim Veranstalter. Schon vorhandene werden übersprungen, bekannte Namen gleich zugeordnet." />
    </AdminSheet>
  );
}

function FilterBar({ filter, onFilter, query, onQuery }) {
  return (
    <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Nach Zuordnung filtern">
        {FILTERS.map(([key, label]) => {
          const on = filter === key;
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => onFilter(key)} data-testid={`participants-filter-${key}`}
              className={`min-h-[36px] px-2 sm:px-3 py-1.5 border rounded-sm text-[10px] font-bold uppercase tracking-wide sm:tracking-wider transition-colors ${on ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/15 text-white/60 hover:text-white hover:border-white/30"}`}>
              {label}
            </button>
          );
        })}
      </div>
      <label className="relative block md:w-64">
        <span className="sr-only">Teilnehmer suchen</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
        <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Name, Nummer, Team …" data-testid="participants-search"
          className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] pl-8 pr-3 py-2 rounded-sm text-sm text-white placeholder:text-white/35 focus:outline-none" />
      </label>
    </div>
  );
}

export function SeriesParticipantsSection({ series }) {
  const [data, setData] = useState({ participants: [], counts: {}, profiles: [] });
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [merging, setMerging] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get(`/reference-series/admin/series/${series.id}/participants`);
      setData({ participants: result?.participants || [], counts: result?.counts || {}, profiles: result?.profiles || [] });
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const counts = data.counts || {};
  const open = counts.open || 0;
  const visible = visibleParticipants(data.participants, filter, query);
  const chosen = visible.filter((row) => selected.has(row.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  const toggle = (id) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((previous) => {
    const next = new Set(previous);
    visible.forEach((row) => (allChosen ? next.delete(row.id) : next.add(row.id)));
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  // Eine Rückfrage für die ganze Auswahl – nur, wenn dabei eine Zuordnung verloren geht.
  const bulkQuestion = (link) => {
    const members = chosen.filter((row) => linkState(row) === "member").length;
    const membersText = `${members} ${members === 1 ? "Mitglied zählt" : "Mitglieder zählen"} dann nicht mehr für Verein und Profil.`;
    if (link === "external") {
      if (!chosen.some((row) => ["member", "guest"].includes(linkState(row)))) return null;
      return {
        title: `${chosen.length} Teilnehmer auf Extern?`,
        description: `Ihre Zuordnung gilt dann in keiner Saison mehr – Mitglied und Gast werden als Alias überall zurückgenommen.${members ? ` ${membersText}` : ""}`,
        confirmLabel: "Auf Extern setzen",
      };
    }
    if (!members) return null;
    return {
      title: `${members} ${members === 1 ? "Mitglied" : "Mitglieder"} als Gast?`,
      description: `${membersText} Sie zählen nur noch fürs Team.`,
      confirmLabel: "Als Gast markieren",
    };
  };

  const bulk = async (link) => {
    const question = bulkQuestion(link);
    if (question && !await confirm(question)) return;
    setBusy(true);
    try {
      const { data: result } = await api.post(`/reference-series/admin/series/${series.id}/participants/bulk-assign`,
        { participant_ids: chosen.map((row) => row.id), link });
      toast.success(bulkText(result, link));
      setNotice(result?.notice || "");
      clearSelection();
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const afterEdit = (message) => {
    setEditing(null);
    setNotice(message || "");
    load();
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="series-participants">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Teilnehmer</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-white/45 font-bold" data-testid="series-participants-counts">
            {countsText(counts)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button type="button" onClick={() => setResolving(true)} data-testid="series-unknown-open"
            className={`${ACTION_CLASS} ${open ? "tls-btn--primary" : "tls-btn--secondary"}`}>
            <UserSearch className="w-3.5 h-3.5" /> Unbekannte Namen ({open})
          </button>
          <button type="button" onClick={() => setAdding(true)} data-testid="series-participants-add" className={`${ACTION_CLASS} tls-btn--secondary`}>
            <Plus className="w-3.5 h-3.5" /> Namen
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-[75ch] text-xs text-white/55 leading-relaxed" data-testid="series-participants-hint">
        <strong className="text-[#29B6E8]">Mitglied</strong> zählt für Verein und Profil. <strong className="text-white/80">Gast</strong> fährt für ein Vereinsteam, ist aber kein Mitglied.
        {" "}<strong className="text-white/80">Extern</strong> sind alle anderen. {ALIAS_HINT}
      </p>

      {data.participants.length > 0 && <FilterBar filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} />}

      {data.participants.length > 0 && (
        <div className="mt-3 flex min-h-[40px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 pb-2" data-testid="participants-bulk">
          <label className="inline-flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={allChosen} onChange={toggleAll} disabled={!visible.length} data-testid="participants-select-all" className="w-4 h-4" style={{ accentColor: "#29B6E8" }}
              ref={(element) => { if (element) element.indeterminate = chosen.length > 0 && !allChosen; }} />
            Alle {visible.length} auswählen
          </label>
          {chosen.length > 0 && (
            <>
              <span className="text-xs font-bold text-white" data-testid="participants-bulk-count">{chosen.length} ausgewählt</span>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <button type="button" disabled={busy} onClick={() => bulk("guest")} data-testid="participants-bulk-guest" className={`${ACTION_CLASS} tls-btn--secondary`}>
                  <UserRound className="w-3.5 h-3.5" /> Als Gast
                </button>
                <button type="button" disabled={busy} onClick={() => bulk("external")} data-testid="participants-bulk-external" className={`${ACTION_CLASS} tls-btn--secondary`}>
                  <UserX className="w-3.5 h-3.5" /> Als Extern
                </button>
                {chosen.length === 2 && (
                  <button type="button" disabled={busy} onClick={() => setMerging(chosen)} data-testid="participants-bulk-merge" className={`${ACTION_CLASS} tls-btn--secondary`}>
                    <Combine className="w-3.5 h-3.5" /> Zusammenführen
                  </button>
                )}
                <button type="button" onClick={clearSelection} aria-label="Auswahl aufheben" data-testid="participants-bulk-clear" className="tls-hit p-2 text-white/50 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {notice && <p className="mt-3 text-xs text-white/55" role="status" data-testid="series-participants-notice">{notice}</p>}

      <ul className="mt-1 divide-y divide-white/5" data-testid="series-participants-list">
        {visible.map((row) => {
          const details = rowDetails(row);
          const on = selected.has(row.id);
          return (
            <li key={row.id} className={`py-1.5 flex items-center gap-3 transition-colors ${on ? "bg-[#29B6E8]/[0.05]" : ""}`} data-testid={`participant-${row.id}`}>
              <label className="flex min-h-[40px] min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={on} onChange={() => toggle(row.id)} aria-label={`${row.name} auswählen`} data-testid={`participant-select-${row.id}`} className="w-4 h-4 shrink-0" style={{ accentColor: "#29B6E8" }} />
                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-3">
                  <span className="block min-w-0">
                    <span className="font-bold text-white break-words">{row.name}</span>
                    {details && <span className="ml-2 text-sm text-white/55">{details}</span>}
                  </span>
                  <span className={`block sm:shrink-0 text-[10px] uppercase tracking-widest font-bold ${row.link_status === "open" ? "text-brand" : LINK_TONE[row.link] || ""}`} data-testid={`participant-link-${row.id}`}>
                    {linkText(row)}
                  </span>
                </span>
              </label>
              <button type="button" onClick={() => setEditing(row)} aria-label={`${row.name} bearbeiten`} data-testid={`participant-edit-${row.id}`} className="tls-hit shrink-0 p-2 text-white/50 hover:text-white">
                <Pencil className="w-4 h-4" />
              </button>
            </li>
          );
        })}
        {data.participants.length === 0 && <li className="py-2 text-sm text-white/40">Noch keine Teilnehmer.</li>}
        {data.participants.length > 0 && visible.length === 0 && (
          <li className="py-3 text-sm text-white/45" data-testid="series-participants-none">Kein Teilnehmer passt zu Filter und Suche.</li>
        )}
      </ul>
      {adding && <AddNamesSheet series={series} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {resolving && <UnknownNamesSheet series={series} onClose={() => { setResolving(false); load(); }} onChanged={load} />}
      {editing && <ParticipantEditSheet series={series} row={editing} profiles={data.profiles} onClose={() => setEditing(null)} onSaved={afterEdit} />}
      {merging && (
        <ParticipantMergeSheet series={series} rows={merging} describe={describe} onClose={() => setMerging(null)}
          onSaved={() => { setMerging(null); clearSelection(); load(); }} />
      )}
    </section>
  );
}
