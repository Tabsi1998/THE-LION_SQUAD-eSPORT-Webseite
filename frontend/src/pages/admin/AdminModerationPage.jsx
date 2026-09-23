import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError } from "@/lib/api";
import { toast } from "sonner";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { formatMoment } from "@/components/tls/ModerationStandingCard";

// Moderation (#417): drei Reiter - die Meldungen der Community, die Funde des Wortfilters
// (zurückgehalten wartet auf eine Entscheidung, markiert steht nur da) und die Wortliste selbst.

// „Berechtigt“ (#416) erledigt die Meldung und zählt als Treffer für die Stufen.
const STATUS = ["open", "reviewing", "resolved", "justified", "dismissed"];
const STATUS_LABEL = { open: "Offen", reviewing: "In Prüfung", resolved: "Erledigt", justified: "Berechtigt (zählt als Treffer)", dismissed: "Verworfen" };
const TABS = [["reports", "Meldungen"], ["items", "Wortfilter-Funde"], ["filter", "Wortfilter"], ["people", "Personen"], ["levels", "Stufen"]];
const SANCTION_ACTIONS = [["notice", "Hinweis"], ["warning", "Verwarnung mit Chat-Sperre"], ["suspension", "Sperre bis zur Entscheidung"]];
const SANCTION_STATUS = { active: "läuft", lifted: "aufgehoben", expired: "abgelaufen", superseded: "durch höhere Stufe ersetzt" };
const ACTION_LABEL = { hold: "zurückhalten", flag: "nur markieren" };
const ITEM_STATE_LABEL = { pending: "wartet", flagged: "markiert", released: "freigegeben", rejected: "zurückgewiesen", noted: "gesehen" };

export default function AdminModerationPage() {
  // Reiter per ?tab= ansteuerbar - die Einspruch-Benachrichtigung führt direkt zu „Personen“.
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const [tab, setTabState] = useState(TABS.some(([key]) => key === requested) ? requested : "reports");
  const setTab = (key) => {
    setTabState(key);
    setParams(key === "reports" ? {} : { tab: key }, { replace: true });
  };
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
      {tab === "people" && <PeopleTab />}
      {tab === "levels" && <LevelsTab />}
    </AdminLayout>
  );
}

// Personen (#416): wer Treffer oder Maßnahmen hat, mit Historie - Treffer eintragen oder
// zurücknehmen, Stufe von Hand setzen oder aufheben, Einsprüche entscheiden, CSV für den Vorstand.
function PeopleTab() {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState("");
  const [strikeNote, setStrikeNote] = useState("");
  const [sanction, setSanction] = useState({ action: "warning", reason: "", chat_hours: "" });
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/moderation/people");
      setPeople(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error(formatRequestError(error, "Personen konnten nicht geladen werden."));
    }
  }, []);
  const loadDetail = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/moderation/people/${userId}`);
      setDetail(data);
    } catch (error) {
      toast.error(formatRequestError(error, "Historie konnte nicht geladen werden."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDetail(selected); }, [selected, loadDetail]);

  const run = async (key, action, success) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await Promise.all([load(), loadDetail(selected)]);
    } catch (error) {
      toast.error(formatRequestError(error, "Das hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  const active = detail?.active;
  return (
    <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)] gap-4">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/60">{people.length} Personen</div>
          <a href="/api/moderation/people/export.csv" data-testid="people-export" className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"><Download className="w-3 h-3" /> CSV</a>
        </div>
        {people.length === 0 ? <div className="text-sm text-white/40 py-6 text-center">Noch keine Treffer oder Maßnahmen.</div> : (
          <ul className="divide-y divide-white/5">
            {people.map((row) => (
              <li key={row.user_id}>
                <button type="button" onClick={() => setSelected(row.user_id)} data-testid={`people-row-${row.user.username}`} className={`w-full text-left py-2 px-2 rounded-sm ${selected === row.user_id ? "bg-[#29B6E8]/10" : "hover:bg-white/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm truncate">{row.user.display_name || row.user.username}</span>
                    {row.open_appeal && <span className="text-[10px] font-black uppercase tracking-widest text-[#FFD700]">Einspruch</span>}
                  </div>
                  <div className="text-[11px] text-white/50">{row.active_strikes} Treffer{row.active ? ` · ${row.active.label}` : ""}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!detail ? (
        <div className="border border-dashed border-white/10 rounded-sm p-10 text-center text-white/40">Person links wählen.</div>
      ) : (
        <div className="space-y-4" data-testid="people-detail">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-heading font-bold uppercase">{detail.user.display_name || detail.user.username} <span className="text-white/40 normal-case font-normal text-sm">@{detail.user.username}</span></div>
                <div className="text-xs text-white/50 mt-1">{detail.active_strike_count} Treffer in den letzten {detail.settings?.strike_ttl_months} Monaten · {detail.sanctions.length} Maßnahmen · {detail.reports.length} Meldungen gegen die Person</div>
              </div>
              {active ? (
                <div className="text-right">
                  <div className="text-[#FF9500] font-bold text-sm" data-testid="people-active">{active.label}</div>
                  <div className="text-[11px] text-white/50">{active.chat_blocked_until ? `Chat bis ${formatMoment(active.chat_blocked_until)}` : active.open_until_decision ? "bis zur Entscheidung" : "ohne Einschränkung"}</div>
                </div>
              ) : <div className="text-[11px] text-white/45">keine laufende Maßnahme</div>}
            </div>
            {active?.appeal && (
              <div className="mt-3 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-3 text-sm" data-testid="people-appeal">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#FFD700]">Einspruch vom {formatMoment(active.appeal.created_at)} · {active.appeal.status === "open" ? "offen" : `entschieden: ${active.appeal.decision === "lift" ? "aufgehoben" : "bleibt"}`}</div>
                <p className="mt-1 whitespace-pre-wrap text-white/80">{active.appeal.message}</p>
                {active.appeal.status === "open" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={!!busy} onClick={() => run("appeal", () => api.post(`/moderation/sanctions/${active.id}/appeal-decision`, { decision: "lift", note: note || null }), "Einspruch angenommen – Maßnahme aufgehoben.")} data-testid={`appeal-lift-${active.id}`} className="px-3 py-1.5 border border-[#00FF88]/50 text-[#00FF88] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Annehmen und aufheben</button>
                    <button type="button" disabled={!!busy} onClick={() => run("appeal", () => api.post(`/moderation/sanctions/${active.id}/appeal-decision`, { decision: "keep", note: note || null }), "Einspruch abgelehnt – Maßnahme bleibt.")} data-testid={`appeal-keep-${active.id}`} className="px-3 py-1.5 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Ablehnen</button>
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="border border-white/10 rounded-sm p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Treffer eintragen</div>
                <input value={strikeNote} onChange={(e) => setStrikeNote(e.target.value)} placeholder="Was ist passiert? (steht im Hinweis an die Person)" data-testid="people-strike-note" className="w-full bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm" />
                <button type="button" disabled={!!busy} onClick={() => run("strike", () => api.post(`/moderation/people/${detail.user.id}/strikes`, { note: strikeNote || null }).then(() => setStrikeNote("")), "Treffer eingetragen – die Stufe wurde neu bestimmt.")} data-testid="people-strike-add" className="mt-2 px-3 py-1.5 border border-[#FFD700]/50 text-[#FFD700] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Treffer eintragen</button>
              </div>
              <div className="border border-white/10 rounded-sm p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Stufe von Hand setzen</div>
                <div className="flex flex-wrap gap-2">
                  <select value={sanction.action} onChange={(e) => setSanction((c) => ({ ...c, action: e.target.value }))} data-testid="people-sanction-action" className="bg-black/40 border border-white/10 px-2 py-2 rounded-sm text-sm">
                    {SANCTION_ACTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  {sanction.action === "warning" && <input type="number" min="1" max="720" value={sanction.chat_hours} onChange={(e) => setSanction((c) => ({ ...c, chat_hours: e.target.value }))} placeholder="Stunden" aria-label="Chat-Sperre in Stunden" data-testid="people-sanction-hours" className="w-24 bg-black/40 border border-white/10 px-2 py-2 rounded-sm text-sm" />}
                </div>
                <input value={sanction.reason} onChange={(e) => setSanction((c) => ({ ...c, reason: e.target.value }))} placeholder="Grund (steht in der Benachrichtigung)" data-testid="people-sanction-reason" className="mt-2 w-full bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm" />
                <button type="button" disabled={!!busy || sanction.reason.trim().length < 3} onClick={() => run("sanction", () => api.post(`/moderation/people/${detail.user.id}/sanctions`, { action: sanction.action, reason: sanction.reason.trim(), ...(sanction.action === "warning" && sanction.chat_hours ? { chat_hours: Number(sanction.chat_hours) } : {}) }).then(() => setSanction((c) => ({ ...c, reason: "" }))), "Stufe gesetzt – die Person ist benachrichtigt.")} data-testid="people-sanction-set" className="mt-2 px-3 py-1.5 border border-[#FF9500]/50 text-[#FF9500] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Stufe setzen</button>
              </div>
            </div>
            <div className="mt-3">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz für Aufheben, Zurücknehmen oder Einspruch (optional)" data-testid="people-note" className="w-full bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Treffer</div>
              {detail.strikes.length === 0 ? <div className="text-sm text-white/40">Keine.</div> : (
                <ul className="space-y-2 text-sm">
                  {detail.strikes.map((strike) => (
                    <li key={strike.id} className={`flex items-start justify-between gap-2 ${strike.revoked ? "opacity-50 line-through" : ""}`} data-testid={`people-strike-${strike.id}`}>
                      <span><span className="text-white/45 text-xs">{formatMoment(strike.created_at)}</span> · {strike.source_label}{strike.note ? ` · ${strike.note}` : ""}{strike.revoked && strike.revoke_note ? ` (zurückgenommen: ${strike.revoke_note})` : ""}</span>
                      {!strike.revoked && <button type="button" disabled={!!busy} onClick={() => run("revoke", () => api.post(`/moderation/strikes/${strike.id}/revoke`, { note: note || null }), "Treffer zurückgenommen.")} data-testid={`strike-revoke-${strike.id}`} className="text-[10px] font-bold uppercase tracking-wider text-white/50 hover:text-[#FF3B30] shrink-0">Zurücknehmen</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Maßnahmen</div>
              {detail.sanctions.length === 0 ? <div className="text-sm text-white/40">Keine.</div> : (
                <ul className="space-y-2 text-sm">
                  {detail.sanctions.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-2" data-testid={`people-sanction-${entry.id}`}>
                      <span><span className="text-white/45 text-xs">{formatMoment(entry.created_at)}</span> · {entry.label} · {SANCTION_STATUS[entry.status] || entry.status}{entry.automatic ? "" : " · von Hand"}{entry.reason ? ` · ${entry.reason}` : ""}</span>
                      {entry.status === "active" && <button type="button" disabled={!!busy} onClick={() => run("lift", () => api.post(`/moderation/sanctions/${entry.id}/lift`, { note: note || null }), "Maßnahme aufgehoben.")} data-testid={`sanction-lift-${entry.id}`} className="text-[10px] font-bold uppercase tracking-wider text-[#00FF88] shrink-0">Aufheben</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {detail.reports.length > 0 && (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mb-2">Meldungen gegen die Person</div>
              <ul className="space-y-1 text-sm">
                {detail.reports.map((report) => <li key={report.id}><span className="text-white/45 text-xs">{formatMoment(report.created_at)}</span> · {report.category} · {STATUS_LABEL[report.status] || report.status}{report.resolution_note ? ` · ${report.resolution_note}` : ""}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Stufen (#416): ab wie vielen Treffern welche Maßnahme, wie lange die Chat-Sperre dauert, wann Treffer verfallen.
function LevelsTab() {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/moderation/levels").then(({ data }) => setSettings(data && Array.isArray(data.levels) ? data : { levels: [], strike_ttl_months: 12 })).catch(() => setSettings({ levels: [], strike_ttl_months: 12 }));
  }, []);

  if (!settings) return <div className="text-white/40 text-sm">Lade Stufen …</div>;
  const setLevel = (index, key, value) => setSettings((c) => ({ ...c, levels: c.levels.map((level, i) => (i === index ? { ...level, [key]: value } : level)) }));
  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        levels: settings.levels.map((level) => ({ strikes: Number(level.strikes), action: level.action, chat_hours: Number(level.chat_hours || 0) })),
        strike_ttl_months: Number(settings.strike_ttl_months),
      };
      const { data } = await api.put("/moderation/levels", payload);
      setSettings(data);
      toast.success("Stufen gespeichert.");
    } catch (error) {
      toast.error(formatRequestError(error, "Stufen konnten nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
        <p className="text-xs text-white/50 mb-3">Nach jedem Treffer wird die Stufe neu bestimmt; eine Maßnahme entsteht nur, wenn sie höher ist als die laufende. Die Sperre bis zur Entscheidung hebt immer ein Mensch auf.</p>
        <div className="space-y-2">
          {settings.levels.map((level, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`levels-row-${index}`}>
              <span className="text-white/50">ab</span>
              <input type="number" min="1" max="50" value={level.strikes} onChange={(e) => setLevel(index, "strikes", e.target.value)} aria-label="Treffer" data-testid={`levels-strikes-${index}`} className="w-20 bg-black/40 border border-white/10 px-2 py-2 rounded-sm" />
              <span className="text-white/50">Treffern:</span>
              <select value={level.action} onChange={(e) => setLevel(index, "action", e.target.value)} aria-label="Maßnahme" data-testid={`levels-action-${index}`} className="bg-black/40 border border-white/10 px-2 py-2 rounded-sm">
                {SANCTION_ACTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              {level.action === "warning" && (
                <>
                  <input type="number" min="1" max="720" value={level.chat_hours || ""} onChange={(e) => setLevel(index, "chat_hours", e.target.value)} aria-label="Chat-Sperre in Stunden" data-testid={`levels-hours-${index}`} className="w-24 bg-black/40 border border-white/10 px-2 py-2 rounded-sm" />
                  <span className="text-white/50">Stunden Chat-Sperre</span>
                </>
              )}
              <button type="button" onClick={() => setSettings((c) => ({ ...c, levels: c.levels.filter((_, i) => i !== index) }))} aria-label="Stufe entfernen" data-testid={`levels-remove-${index}`} className="ml-auto text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        {settings.levels.length < 5 && (
          <button type="button" onClick={() => setSettings((c) => ({ ...c, levels: [...c.levels, { strikes: (Number(c.levels[c.levels.length - 1]?.strikes) || 0) + 1, action: "warning", chat_hours: 24 }] }))} data-testid="levels-add" className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"><Plus className="w-3 h-3" /> Stufe hinzufügen</button>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/50">Treffer verfallen nach</span>
          <input type="number" min="1" max="60" value={settings.strike_ttl_months} onChange={(e) => setSettings((c) => ({ ...c, strike_ttl_months: e.target.value }))} aria-label="Verfall in Monaten" data-testid="levels-ttl" className="w-20 bg-black/40 border border-white/10 px-2 py-2 rounded-sm" />
          <span className="text-white/50">Monaten</span>
        </div>
        <button type="button" onClick={save} disabled={busy} data-testid="levels-save" className="mt-4 px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{busy ? "Speichere…" : "Stufen speichern"}</button>
      </div>
    </div>
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
