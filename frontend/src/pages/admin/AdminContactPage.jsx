import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Inbox, MailOpen, Trash2, ArrowLeft, AlertCircle, ShieldCheck } from "lucide-react";
import { viennaDate, viennaDateTime } from "@/lib/vienna";

const STATUS_LABEL = {
  new: { l: "Neu", c: "text-[#29B6E8] bg-[#29B6E8]/10 border-[#29B6E8]/30" },
  in_progress: { l: "In Bearbeitung", c: "text-[#FFD700] bg-[#FFD700]/10 border-[#FFD700]/30" },
  answered: { l: "Beantwortet", c: "text-[#00FF88] bg-[#00FF88]/10 border-[#00FF88]/30" },
  closed: { l: "Geschlossen", c: "text-white/50 bg-white/5 border-white/10" },
  spam: { l: "Spam", c: "text-[#FF3B30] bg-[#FF3B30]/10 border-[#FF3B30]/30" },
};

const TOPIC_LABEL = {
  general: "Allgemein", membership: "Mitgliedschaft", volunteer: "Mitarbeit", tournament: "Turnier",
  fastlap: "Fast Lap", sponsorship: "Sponsoring", press: "Presse",
  report_bug: "Bug", abuse: "Missbrauch", other: "Sonstiges",
};

// Spamschutz (#2067): Gründe, die der Server liefert, falls die Zähler-Antwort keine Beschriftung mitbringt.
const REASON_FALLBACK = {
  honeypot: "Verstecktes Feld", token_missing: "Ohne Token", token_too_fast: "Zu schnell", token_expired: "Token abgelaufen",
  token_forged: "Token gefälscht", random_text: "Zufallszeichen", gmail_dots: "Gmail mit Punkt-Trick", links: "Viele Links",
  spam_words: "Spam-Wörter", word_filter: "Wortfilter", turnstile_missing: "Turnstile nicht gelöst", turnstile_invalid: "Turnstile abgelehnt",
};

function SpamCounter({ stats }) {
  if (!stats) return null;
  const labels = { ...REASON_FALLBACK, ...(stats.labels || {}) };
  const reasons = Object.entries(stats.week?.by_reason || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-4 flex flex-wrap items-start gap-x-8 gap-y-3" data-testid="contact-spam-counter">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-[#00FF88] shrink-0" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Spamschutz – abgefangen</div>
          <div className="text-sm text-white/85">
            <strong className="text-lg font-black" data-testid="contact-spam-today">{stats.today?.caught || 0}</strong> heute ·{" "}
            <strong className="text-lg font-black" data-testid="contact-spam-week">{stats.week?.caught || 0}</strong> in 7 Tagen
            {stats.quote_week != null && <span className="text-white/50"> · Quote {String(stats.quote_week).replace(".", ",")} %</span>}
          </div>
        </div>
      </div>
      {reasons.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Gründe der letzten 7 Tage" data-testid="contact-spam-reasons">
          {reasons.map(([reason, count]) => (
            <li key={reason} className="px-2 py-1 rounded-sm border border-white/10 text-white/70">{labels[reason] || reason}: {count}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminContactPage() {
  const [all, setAll] = useState([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(null);
  const [spamStats, setSpamStats] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const confirm = useConfirm();

  // Alle Nachrichten laden und hier filtern: so stimmen die Zähler je Status. Ohne Filter bleibt „Spam“ draußen.
  const load = useCallback(async () => {
    const { data } = await api.get("/contact");
    setAll(Array.isArray(data) ? data : []);
    api.get("/spam-guard/stats").then(({ data: stats }) => setSpamStats(stats)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["contact"]);
  const list = filter ? all.filter((m) => m.status === filter) : all.filter((m) => m.status !== "spam");

  const notSpam = async (id) => {
    if (releasing) return;
    setReleasing(true);
    try {
      const { data } = await api.post(`/contact/${id}/not-spam`);
      toast.success("Als „kein Spam“ eingeordnet – die Mails gehen jetzt hinaus.");
      setActive(data);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    finally { setReleasing(false); }
  };

  const setStatus = async (id, status, note) => {
    try {
      const { data } = await api.patch(`/contact/${id}`, { status, internal_note: note });
      toast.success(`Status: ${STATUS_LABEL[status]?.l || status}`);
      setActive(data);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  const remove = async (id) => {
    if (!await confirm({
      title: "Nachricht löschen?",
      description: "Diese Nachricht wird unwiderruflich aus der Inbox entfernt.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/contact/${id}`); toast.success("Gelöscht."); setActive(null); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  const counts = all.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {});

  if (active) {
    const s = STATUS_LABEL[active.status] || STATUS_LABEL.new;
    const flagged = active.status === "spam" && active.spam?.reasons && !active.spam?.cleared_at;
    const reasonLabels = { ...REASON_FALLBACK, ...(spamStats?.labels || {}) };
    return (
      <AdminLayout>
        <button onClick={() => setActive(null)} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8] mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Inbox
        </button>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 border border-white/10 bg-[#121212] rounded-sm p-6">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${s.c}`}>{s.l}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border border-white/10 text-white/60">{TOPIC_LABEL[active.topic] || active.topic}</span>
            </div>
            <h1 className="font-heading text-2xl font-black uppercase mb-3">{active.subject}</h1>
            <div className="text-sm text-white/60 mb-4">
              <strong>{active.name}</strong> &lt;<a href={`mailto:${active.email}`} className="text-[#29B6E8] hover:underline">{active.email}</a>&gt; · {viennaDateTime(active.created_at)}
            </div>
            <div className="border-t border-white/10 pt-4">
              <pre className="whitespace-pre-wrap text-sm text-white/85 font-sans leading-relaxed">{active.message}</pre>
            </div>
          </div>
          <div className="space-y-3">
            {flagged && (
              <div className="border border-[#FF3B30]/30 bg-[#FF3B30]/5 rounded-sm p-4" data-testid="contact-spam-box">
                <div className="text-[11px] font-bold uppercase tracking-widest text-[#FF8A80] mb-2">Vom Spamschutz markiert</div>
                <p className="text-xs text-white/70 mb-2">Gründe: {active.spam.reasons.map((r) => reasonLabels[r] || r).join(", ")}. Bisher ging keine Mail hinaus – weder an den Absender noch an den Vorstand.</p>
                <button type="button" onClick={() => notSpam(active.id)} disabled={releasing} data-testid="contact-not-spam"
                  className="w-full px-4 py-2 border border-[#00FF88]/40 text-[#00FF88] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#00FF88]/10 disabled:opacity-50">
                  Kein Spam – einordnen und Mails nachholen
                </button>
              </div>
            )}
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Status setzen</div>
              <div className="flex flex-wrap gap-2">
                {Object.keys(STATUS_LABEL).map((k) => (
                  <button key={k} onClick={() => setStatus(active.id, k, active.internal_note || "")}
                    data-testid={`contact-status-${k}`}
                    className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm border ${active.status === k ? STATUS_LABEL[k].c : "border-white/10 text-white/60 hover:border-white/30"}`}>
                    {STATUS_LABEL[k].l}
                  </button>
                ))}
              </div>
            </div>
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Interne Notiz</div>
              <textarea defaultValue={active.internal_note || ""} onBlur={(e) => setStatus(active.id, active.status, e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" rows={4} />
            </div>
            <a href={`mailto:${active.email}?subject=Re: ${encodeURIComponent(active.subject)}`} className="block w-full px-4 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm text-center hover:bg-[#1E95C2]">Per E-Mail antworten</a>
            <button onClick={() => remove(active.id)} className="w-full px-4 py-2 border border-[#FF3B30]/30 text-[#FF3B30] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#FF3B30]/10 inline-flex items-center justify-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Löschen</button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-4">Kontakt-Inbox</h1>
      <SpamCounter stats={spamStats} />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(filter === k ? "" : k)} data-testid={`contact-stat-${k}`}
            className={`border rounded-sm p-3 text-left ${filter === k ? v.c : "border-white/10 bg-[#121212] text-white/70 hover:border-white/20"}`}>
            <Inbox className="w-4 h-4 mb-1" />
            <div className="text-2xl font-black">{counts[k] || 0}</div>
            <div className="text-[10px] uppercase tracking-widest">{v.l}</div>
          </button>
        ))}
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="tls-swipe pb-0">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Datum</th>
                <th className="text-left px-4 py-3">Von</th>
                <th className="text-left px-4 py-3">Thema</th>
                <th className="text-left px-4 py-3">Betreff</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.length === 0 ? (
                <tr><td colSpan="5" className="text-center py-12">
                  <MailOpen className="w-10 h-10 text-white/20 mx-auto mb-2" />
                  <p className="text-white/50">Keine Nachrichten.</p>
                </td></tr>
              ) : list.map((m) => {
                const s = STATUS_LABEL[m.status] || STATUS_LABEL.new;
                return (
                  <tr key={m.id} onClick={() => setActive(m)} data-testid={`contact-row-${m.id}`} className="cursor-pointer hover:bg-white/5">
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{viennaDate(m.created_at)}</td>
                    <td className="px-4 py-3"><div className="text-white/85">{m.name}</div><div className="text-xs text-white/40">{m.email}</div></td>
                    <td className="px-4 py-3 text-xs text-[#29B6E8]">{TOPIC_LABEL[m.topic] || m.topic}</td>
                    <td className="px-4 py-3"><div className="font-semibold truncate max-w-md">{m.subject}</div></td>
                    <td className="px-4 py-3"><span className={`inline-flex text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-sm border ${s.c}`}>{s.l}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#29B6E8] shrink-0 mt-0.5" />
        <div className="text-sm text-white/80">
          <strong>Hinweis:</strong> Jede Nachricht löst automatisch eine Bestätigungsmail an den Absender und eine Benachrichtigung an die Vereins-E-Mail aus (über die Mail-Queue). Ausnahme: Nachrichten, die der Spamschutz als „Spam“ markiert – sie stehen unter dem Filter „Spam“, und „Kein Spam“ holt die Mails nach. Sicher erkannte Bots werden gar nicht gespeichert, nur gezählt.
        </div>
      </div>
    </AdminLayout>
  );
}
