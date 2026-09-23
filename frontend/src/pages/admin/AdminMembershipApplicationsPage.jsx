/**
 * Phase C — Admin Mitgliedsbewerbungen Inbox.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Check, X as XIcon, Inbox, Eye, ExternalLink } from "lucide-react";

const TABS = [
  { key: "pending",  label: "Offen",      color: "#29B6E8" },
  { key: "approved", label: "Akzeptiert", color: "#00FF88" },
  { key: "rejected", label: "Abgelehnt",  color: "#FF3B30" },
  // Anträge über Dolibarr (#328): zurückgezogen oder beim Senden hängen geblieben.
  { key: "withdrawn", label: "Zurückgezogen", color: "#FFD700" },
  { key: "submitting", label: "In Übermittlung", color: "#FFD700" },
];
const DOLIBARR_STATE = { received: "eingegangen", in_review: "in Prüfung", accepted: "aufgenommen", rejected: "abgelehnt", withdrawn: "zurückgezogen" };
const TAB_KEYS = new Set(TABS.map((tab) => tab.key));

const PREF_LABEL = { full: "Vollmitglied", supporter: "Unterstützer", youth: "Jugend", honorary: "Ehren" };

export default function AdminMembershipApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(TAB_KEYS.has(searchParams.get("status")) ? searchParams.get("status") : "pending");
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const prompt = usePrompt();

  useEffect(() => {
    const nextTab = searchParams.get("status");
    if (TAB_KEYS.has(nextTab) && nextTab !== tab) setTab(nextTab);
  }, [searchParams, tab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextTab === "pending") params.delete("status");
      else params.set("status", nextTab);
      return params;
    }, { replace: true });
  };

  const load = useCallback(() => api.get(`/membership/applications?status=${tab}`).then(({ data }) => setList(data)), [tab]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["membership", "users"]);

  const decide = async (a, decision) => {
    const note = await prompt({
      title: decision === "reject" ? "Bewerbung ablehnen" : "Bewerbung annehmen",
      description: decision === "reject" ? "Diese Begründung wird per Mail gesendet." : "Optionale interne oder externe Notiz.",
      placeholder: decision === "reject" ? "Kurze, klare Begründung..." : "Optionale Notiz...",
      confirmLabel: decision === "reject" ? "Ablehnen" : "Annehmen",
      required: decision === "reject",
      tone: decision === "reject" ? "danger" : "info",
    });
    if (note === false) return;
    if (decision === "reject" && !note) return;
    try {
      await api.patch(`/membership/applications/${a.id}`, { decision, note: note || undefined });
      toast.success(decision === "approve" ? "Akzeptiert" : "Abgelehnt");
      setSelected(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase C</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex items-center gap-3"><Inbox className="w-6 h-6" /> Mitgliedsbewerbungen</h1>

      <div className="mt-6 flex gap-1 border-b border-white/10">
        {TABS.map(t => (
          <button key={t.key} onClick={() => selectTab(t.key)} data-testid={`apps-tab-${t.key}`} className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition ${tab === t.key ? "" : "border-transparent text-white/50 hover:text-white"}`} style={tab === t.key ? { borderColor: t.color, color: t.color } : {}}>{t.label}</button>
        ))}
      </div>

      <div className="mt-6 border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]" data-testid="apps-table">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Eingereicht</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-left px-4 py-3">Wunsch</th>
                <th className="text-left px-4 py-3">Motivation</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map(a => (
                <tr key={a.id} data-testid={`app-row-${a.id}`}>
                  <td className="px-4 py-3 text-xs text-white/45 whitespace-nowrap">{new Date(a.created_at).toLocaleDateString("de-DE")}</td>
                  <td className="px-4 py-3"><div className="font-semibold">{a.user_display_name || a.user_username}</div><div className="text-xs text-white/40">@{a.user_username}</div></td>
                  <td className="px-4 py-3 text-xs uppercase tracking-wider">{a.coupled ? (a.type_label || "Mitgliedsart aus Dolibarr") : (PREF_LABEL[a.contribution_pref] || a.contribution_pref)}</td>
                  <td className="px-4 py-3 max-w-md text-white/60 truncate">{a.motivation}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setSelected(a)} className="text-[#29B6E8] hover:underline text-xs mr-3 inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Detail</button>
                    {a.coupled && (
                      <span className="inline-flex items-center gap-2" data-testid={`app-dolibarr-${a.id}`}>
                        <span className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700]">{DOLIBARR_STATE[a.dolibarr?.application_status] || a.status}</span>
                        {a.dolibarr?.member_url && <a href={a.dolibarr.member_url} target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline text-xs inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> In Dolibarr</a>}
                      </span>
                    )}
                    {!a.coupled && a.status === "pending" && <>
                      <button onClick={() => decide(a, "approve")} data-testid={`app-approve-${a.id}`} className="text-[#00FF88] hover:underline text-xs mr-3 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Annehmen</button>
                      <button onClick={() => decide(a, "reject")} data-testid={`app-reject-${a.id}`} className="text-[#FF3B30] hover:underline text-xs inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Ablehnen</button>
                    </>}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan="5" className="px-4 py-12 text-center text-white/40 text-sm">Keine Bewerbungen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail als Seitenblatt (#435): Annehmen und Ablehnen stehen in der Leiste unten. */}
      {selected && (
        <AdminSheet
          title="Bewerbung Detail"
          eyebrow="Mitgliedsbewerbungen"
          accent="#FFD700"
          onClose={() => setSelected(null)}
          testId="application-sheet"
          footer={!selected.coupled && selected.status === "pending" ? (
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => decide(selected, "reject")} data-testid="application-sheet-reject" className="px-4 py-2 border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-sm text-xs font-bold uppercase">Ablehnen</button>
              <button type="button" onClick={() => decide(selected, "approve")} data-testid="application-sheet-approve" className="px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-bold uppercase">Annehmen</button>
            </div>
          ) : null}
        >
          <div className="space-y-3 text-sm">
            <Row k="Spieler" v={`${selected.user_display_name || selected.user_username} (@${selected.user_username})`} />
            <Row k="E-Mail" v={selected.user_email} />
            <Row k="Wunsch" v={selected.coupled ? (selected.type_label || "aus Dolibarr") : PREF_LABEL[selected.contribution_pref]} />
            {selected.coupled && (
              <div className="border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-3 text-xs text-white/70" data-testid="application-sheet-dolibarr">
                Dieser Antrag liegt in der Mitgliederverwaltung (Dolibarr): Stand <span className="text-white font-bold">{DOLIBARR_STATE[selected.dolibarr?.application_status] || selected.status}</span>
                {selected.dolibarr?.member_ref ? <>, Mitglied Nr. <span className="text-white">{selected.dolibarr.member_ref}</span></> : null}. Aufnehmen oder ablehnen dort – die Website übernimmt den Stand.
                {selected.dolibarr?.member_url && <a href={selected.dolibarr.member_url} target="_blank" rel="noreferrer" className="block mt-2 text-[#29B6E8] underline">Mitgliedskarte in Dolibarr öffnen</a>}
              </div>
            )}
            <Row k="Eingereicht" v={new Date(selected.created_at).toLocaleString("de-DE")} />
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Motivation</div>
              <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.motivation}</p>
            </div>
            {selected.notes && <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Anmerkungen</div>
              <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.notes}</p>
            </div>}
            {selected.decision_note && <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Admin-Notiz</div>
              <p className="mt-1 text-white/80">{selected.decision_note}</p>
            </div>}
          </div>
        </AdminSheet>
      )}
    </AdminLayout>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-4 border-b border-white/5 pb-2"><span className="text-white/50 text-xs uppercase tracking-wider">{k}</span><span className="text-white text-right">{v}</span></div>;
}
