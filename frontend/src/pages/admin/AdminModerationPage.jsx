import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError } from "@/lib/api";
import { toast } from "sonner";
import { Download, Plus, Trash2, Upload } from "lucide-react";

// Moderation (#417): drei Reiter - die Meldungen der Community, die Funde des Wortfilters
// (zurückgehalten wartet auf eine Entscheidung, markiert steht nur da) und die Wortliste selbst.

const STATUS = ["open", "reviewing", "resolved", "dismissed"];
const STATUS_LABEL = { open: "Offen", reviewing: "In Prüfung", resolved: "Erledigt", dismissed: "Verworfen" };
const TABS = [["reports", "Meldungen"], ["items", "Wortfilter-Funde"], ["filter", "Wortfilter"]];
const ACTION_LABEL = { hold: "zurückhalten", flag: "nur markieren" };
const ITEM_STATE_LABEL = { pending: "wartet", flagged: "markiert", released: "freigegeben", rejected: "zurückgewiesen", noted: "gesehen" };

export default function AdminModerationPage() {
  const [tab, setTab] = useState("reports");
  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Community Safety</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Moderation</h1>
      <div className="flex flex-wrap gap-1 border-b border-white/10 mb-6">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`moderation-tab-${key}`} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition ${tab === key ? "border-[#29B6E8] text-[#29B6E8]" : "border-transparent text-white/50 hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {tab === "reports" && <ReportsTab />}
      {tab === "items" && <ItemsTab />}
      {tab === "filter" && <WordFilterTab />}
    </AdminLayout>
  );
}

function ReportsTab() {
  const [reports, setReports] = useState([]);
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/moderation/reports${filter ? `?status=${filter}` : ""}`);
      setReports(data || []);
    } catch (error) {
      toast.error(formatRequestError(error, "Meldungen konnten nicht geladen werden."));
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const update = async (report, status) => {
    setBusy(report.id);
    try {
      await api.patch(`/moderation/reports/${report.id}`, { status, resolution_note: null });
      toast.success("Moderationsstatus gespeichert.");
      await load();
    } catch (error) {
      toast.error(formatRequestError(error, "Status konnte nicht gespeichert werden."));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        <button type="button" onClick={() => setFilter("")} className={`px-3 py-2 border rounded-sm text-xs font-bold uppercase ${!filter ? "border-[#29B6E8] text-[#29B6E8]" : "border-white/10 text-white/55"}`}>Alle</button>
        {STATUS.map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`px-3 py-2 border rounded-sm text-xs font-bold uppercase ${filter === status ? "border-[#29B6E8] text-[#29B6E8]" : "border-white/10 text-white/55"}`}>{STATUS_LABEL[status]}</button>)}
      </div>
      <div className="space-y-3">
        {reports.map((report) => (
          <article key={report.id} className="border border-white/10 bg-[#121212] rounded-sm p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#FFD700]">{report.category} · {STATUS_LABEL[report.status] || report.status}</div>
                <div className="mt-1 text-sm text-white/80 whitespace-pre-wrap">{report.details}</div>
                <div className="mt-2 text-[11px] text-white/35">Meldung {report.id} · Ziel {report.target_user_id}{report.message_id ? ` · Nachricht ${report.message_id}` : ""} · {report.created_at && new Date(report.created_at).toLocaleString("de-DE")}</div>
              </div>
              <select value={report.status} disabled={busy === report.id} onChange={(event) => update(report, event.target.value)} className="h-10 bg-black/40 border border-white/10 px-3 text-sm">
                {STATUS.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
              </select>
            </div>
          </article>
        ))}
        {reports.length === 0 && <div className="border border-dashed border-white/10 p-10 text-center text-white/40">Keine Meldungen in diesem Status.</div>}
      </div>
    </>
  );
}

// Die Funde des Wortfilters: zurückgehaltene Nachrichten warten auf Freigabe oder Zurückweisung
// (zurückgewiesen zählt als Treffer), markierte lassen sich als gesehen abhaken.
function ItemsTab() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/moderation/items${state ? `?state=${state}` : ""}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(formatRequestError(error, "Funde konnten nicht geladen werden."));
    }
  }, [state]);
  useEffect(() => { load(); }, [load]);

  const decide = async (item, decision) => {
    const note = decision === "reject" ? window.prompt("Grund für die Person (optional):", "") : null;
    if (decision === "reject" && note === null) return;
    setBusy(item.id);
    try {
      await api.patch(`/moderation/items/${item.id}`, { decision, note: note || null });
      toast.success(decision === "release" ? "Nachricht freigegeben." : decision === "reject" ? "Nachricht zurückgewiesen – zählt als Treffer." : "Als gesehen markiert.");
      await load();
    } catch (error) {
      toast.error(formatRequestError(error, "Entscheidung konnte nicht gespeichert werden."));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        {[["", "Offen"], ["pending", "Wartet"], ["flagged", "Markiert"], ["released", "Freigegeben"], ["rejected", "Zurückgewiesen"], ["noted", "Gesehen"]].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setState(key)} data-testid={`items-filter-${key || "open"}`} className={`px-3 py-2 border rounded-sm text-xs font-bold uppercase ${state === key ? "border-[#29B6E8] text-[#29B6E8]" : "border-white/10 text-white/55"}`}>{label}</button>
        ))}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid={`moderation-item-${item.id}`}>
            <div className="flex flex-wrap justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-[#FFD700]">{item.kind_label || item.kind} · {ITEM_STATE_LABEL[item.state] || item.state} · {item.action === "hold" ? "zurückgehalten" : "markiert"}</div>
                <div className="mt-1 text-sm text-white/80 whitespace-pre-wrap break-words">{item.excerpt}</div>
                <div className="mt-2 text-[11px] text-white/35">
                  {item.user?.display_name || item.user?.username || item.user_id}{item.user?.username ? ` (@${item.user.username})` : ""} · Treffer: {(item.matched || []).join(", ")} · {item.created_at && new Date(item.created_at).toLocaleString("de-DE")}
                  {item.note ? ` · Notiz: ${item.note}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0 self-start">
                {item.state === "pending" && (
                  <>
                    <button type="button" disabled={busy === item.id} onClick={() => decide(item, "release")} data-testid={`item-release-${item.id}`} className="px-3 py-2 bg-[#00FF88] text-black rounded-sm text-xs font-bold uppercase disabled:opacity-50">Freigeben</button>
                    <button type="button" disabled={busy === item.id} onClick={() => decide(item, "reject")} data-testid={`item-reject-${item.id}`} className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-xs font-bold uppercase disabled:opacity-50">Zurückweisen</button>
                  </>
                )}
                {item.state === "flagged" && (
                  <button type="button" disabled={busy === item.id} onClick={() => decide(item, "noted")} data-testid={`item-noted-${item.id}`} className="px-3 py-2 border border-white/15 text-white/70 rounded-sm text-xs font-bold uppercase disabled:opacity-50">Gesehen</button>
                )}
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <div className="border border-dashed border-white/10 p-10 text-center text-white/40">Keine Funde in dieser Auswahl.</div>}
      </div>
    </>
  );
}

// Die Wortliste: deutsch und englisch gemischt, je Eintrag zurückhalten oder nur markieren; Groß/Klein,
// Umlaute, Leetspeak und Trennzeichen prüft der Server mit. Export/Import als JSON für Backup und zweiten Verein.
function WordFilterTab() {
  const [view, setView] = useState(null);
  const [term, setTerm] = useState("");
  const [action, setAction] = useState("hold");
  const [note, setNote] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/moderation/word-filter");
      setView(data);
    } catch (error) {
      toast.error(formatRequestError(error, "Wortfilter konnte nicht geladen werden."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (task, success) => {
    setBusy(true);
    try {
      const { data } = await task();
      if (data && Array.isArray(data.entries)) setView(data);
      if (success) toast.success(success);
      return data;
    } catch (error) {
      toast.error(formatRequestError(error, "Das hat nicht geklappt."));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!term.trim()) return;
    const data = await run(() => api.post("/moderation/word-filter/entries", { term: term.trim(), action, note: note.trim() || null }), "Eintrag gespeichert.");
    if (data) { setTerm(""); setNote(""); }
  };
  const exportList = async () => {
    try {
      const { data } = await api.get("/moderation/word-filter/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "wortfilter.json"; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(formatRequestError(error, "Export hat nicht geklappt."));
    }
  };
  const importList = async (replace) => {
    let parsed;
    try { parsed = JSON.parse(importText); } catch { toast.error("Das ist kein gültiges JSON."); return; }
    const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(entries)) { toast.error("Erwartet wird eine Liste oder ein Export mit „entries“."); return; }
    const data = await run(() => api.post("/moderation/word-filter/import", { entries, replace }), replace ? "Liste ersetzt." : "Einträge übernommen.");
    if (data) setImportText("");
  };

  if (!view) return <div className="text-white/40 text-sm">Lade Wortfilter …</div>;
  const entries = view.entries || [];

  return (
    <div className="space-y-6">
      <div className={`border rounded-sm p-4 ${view.enabled ? "border-[#29B6E8]/40 bg-[#29B6E8]/5" : "border-white/10 bg-[#0A0A0A]"}`} data-testid="word-filter-settings">
        <label className="flex items-center gap-2 text-sm font-bold text-white/80">
          <input type="checkbox" checked={!!view.enabled} disabled={busy} onChange={(e) => run(() => api.put("/moderation/word-filter", { enabled: e.target.checked }), e.target.checked ? "Wortfilter eingeschaltet." : "Wortfilter ausgeschaltet.")} data-testid="word-filter-enabled" className="accent-[#29B6E8]" />
          Wortfilter einschalten
        </label>
        <p className="mt-2 text-xs text-white/50">Geprüft wird beim Senden in Direktnachrichten, Team-, Turnier- und Match-Chat sowie bei Profil-Bio, Anzeigename, Teamname und Benutzername. „Zurückhalten“: die Nachricht sieht nur der Absender („wird geprüft“), bis ihr freigebt oder zurückweist – zurückgewiesen zählt als Treffer; bei Namen und Bio wird die Änderung abgewiesen. „Nur markieren“: geht durch, steht aber in den Funden. Groß/Klein, Umlaute, Leetspeak (sch31ße) und Trennzeichen (s.c.h.e.i.ß.e) werden mitgeprüft; kurze Wörter nur als ganzes Wort.</p>
        <div className="mt-2 text-[11px] text-white/40">{view.counts?.entries ?? entries.length} Einträge · {view.counts?.pending ?? 0} warten · {view.counts?.flagged ?? 0} markiert</div>
      </div>

      <form onSubmit={add} className="border border-white/10 bg-[#121212] rounded-sm p-4 grid sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end" data-testid="word-filter-form">
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Wort oder Wendung
          <input value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} data-testid="word-filter-term" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white text-sm font-normal normal-case tracking-normal focus:outline-none" />
        </label>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Wirkung
          <select value={action} onChange={(e) => setAction(e.target.value)} data-testid="word-filter-action" className="mt-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white text-sm font-normal normal-case tracking-normal">
            <option value="hold">zurückhalten</option>
            <option value="flag">nur markieren</option>
          </select>
        </label>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">Notiz (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} data-testid="word-filter-note" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white text-sm font-normal normal-case tracking-normal focus:outline-none" />
        </label>
        <button type="submit" disabled={busy || !term.trim()} data-testid="word-filter-add" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-1 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> Eintragen</button>
      </form>

      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <table className="w-full text-sm" data-testid="word-filter-table">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr><th className="text-left px-4 py-3">Eintrag</th><th className="text-left px-4 py-3">Wirkung</th><th className="text-left px-4 py-3">Notiz</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.map((entry) => (
              <tr key={entry.id} data-testid={`word-filter-entry-${entry.id}`}>
                <td className="px-4 py-2 font-mono text-white/85">{entry.term}</td>
                <td className="px-4 py-2">
                  <select value={entry.action} disabled={busy} onChange={(e) => run(() => api.patch(`/moderation/word-filter/entries/${entry.id}`, { action: e.target.value }), "Wirkung geändert.")} data-testid={`word-filter-entry-action-${entry.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                    {Object.entries(ACTION_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2 text-xs text-white/50">{entry.note || ""}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/moderation/word-filter/entries/${entry.id}`), "Eintrag entfernt.")} data-testid={`word-filter-entry-delete-${entry.id}`} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan="4" className="px-4 py-8 text-center text-white/40 text-sm">Noch keine Einträge.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid="word-filter-transfer">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportList} data-testid="word-filter-export" className="px-3 py-2 border border-white/15 text-white/80 rounded-sm text-xs font-bold uppercase inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export (JSON)</button>
          <span className="text-xs text-white/45">Für ein Backup oder den zweiten Verein.</span>
        </div>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={4} placeholder='{"entries": [{"term": "…", "action": "hold"}]}' data-testid="word-filter-import-text" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white text-xs font-mono focus:outline-none focus:border-[#29B6E8]" />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !importText.trim()} onClick={() => importList(false)} data-testid="word-filter-import" className="px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-xs font-bold uppercase inline-flex items-center gap-1 disabled:opacity-50"><Upload className="w-3.5 h-3.5" /> Einträge übernehmen</button>
          <button type="button" disabled={busy || !importText.trim()} onClick={() => { if (window.confirm("Die ganze Liste durch den Import ersetzen?")) importList(true); }} data-testid="word-filter-import-replace" className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-xs font-bold uppercase disabled:opacity-50">Liste ersetzen</button>
        </div>
      </div>
    </div>
  );
}
