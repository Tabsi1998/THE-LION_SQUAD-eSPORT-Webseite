/**
 * Bewerbungen: Anträge zur Mitgliedschaft und Einladungen zum Antrag.
 *
 * #1356: Eingeladen wird hier oben („+ Zum Antrag einladen“, Personensuche nur über Konten ohne Mitgliedschaft), jeder
 * Stand steht als Satz mit dem nächsten Schritt (lib/applicationState.js) - nie ein Rohwert. Annehmen und Ablehnen gibt es
 * nur, wo die Website entscheidet; Anträge über Dolibarr öffnet „In Dolibarr öffnen“.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Check, X as XIcon, Inbox, Eye, ExternalLink, Plus } from "lucide-react";
import { InvitationsBox } from "./membership/InvitationsBox";
import { JoinPageBox } from "./membership/JoinPageBox";
import { viennaDate, viennaDateTime } from "@/lib/vienna";
import { STATE_TONE_CLASS, applicationState } from "@/lib/applicationState";

const TABS = [
  { key: "pending",  label: "Offen",      color: "#29B6E8" },
  { key: "approved", label: "Aufgenommen", color: "#00FF88" },
  { key: "rejected", label: "Abgelehnt",  color: "#FF3B30" },
  // Anträge über Dolibarr (#328): zurückgezogen oder beim Senden hängen geblieben.
  { key: "withdrawn", label: "Zurückgezogen", color: "#FF9500" },
  { key: "submitting", label: "In Übermittlung", color: "#FF9500" },
];
const TAB_KEYS = new Set(TABS.map((tab) => tab.key));

const PREF_LABEL = { full: "Vollmitglied", supporter: "Unterstützer", youth: "Jugend", honorary: "Ehren" };

function day(value) {
  try {
    return viennaDate(value);
  } catch {
    return "";
  }
}

function wish(application) {
  return application.type_label || (application.coupled ? "Mitgliedsart aus Dolibarr" : (PREF_LABEL[application.contribution_pref] || "–"));
}

function StateBadge({ state, testId }) {
  return <span className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${STATE_TONE_CLASS[state.tone] || STATE_TONE_CLASS.unknown}`} data-testid={testId}>{state.label}</span>;
}

export default function AdminMembershipApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(TAB_KEYS.has(searchParams.get("status")) ? searchParams.get("status") : "pending");
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [invitationsKey, setInvitationsKey] = useState(0);
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

  const load = useCallback(() => api.get(`/membership/applications?status=${tab}`).then(({ data }) => setList(Array.isArray(data) ? data : [])), [tab]);
  useEffect(() => { load().catch(() => setList([])); }, [load]);
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
      toast.success(decision === "approve" ? "Aufgenommen." : "Abgelehnt.");
      setSelected(null); load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Das hat nicht geklappt."); }
  };

  const actions = (a, state, idPrefix = "app") => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={() => setSelected(a)} className="text-[#29B6E8] hover:underline text-xs inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Ansehen</button>
      {a.coupled && a.dolibarr?.member_url && (
        <a href={a.dolibarr.member_url} target="_blank" rel="noreferrer" data-testid={`${idPrefix}-dolibarr-${a.id}`} className="text-[#29B6E8] hover:underline text-xs inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" /> In Dolibarr öffnen</a>
      )}
      {state.decide && <>
        <button type="button" onClick={() => decide(a, "approve")} data-testid={`${idPrefix}-approve-${a.id}`} className="text-[#00FF88] hover:underline text-xs inline-flex items-center gap-1"><Check className="w-3 h-3" /> Annehmen</button>
        <button type="button" onClick={() => decide(a, "reject")} data-testid={`${idPrefix}-reject-${a.id}`} className="text-[#FF6B6B] hover:underline text-xs inline-flex items-center gap-1"><XIcon className="w-3 h-3" /> Ablehnen</button>
      </>}
    </div>
  );

  const selectedState = selected ? applicationState(selected, day) : null;
  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitglieder</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex items-center gap-3"><Inbox className="w-6 h-6" /> Bewerbungen</h1>
        </div>
        <button type="button" onClick={() => setInviting(true)} data-testid="apps-invite-open" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#29B6E8] text-black rounded-sm text-xs font-bold uppercase tracking-wider">
          <Plus className="w-3.5 h-3.5" /> Zum Antrag einladen
        </button>
      </div>
      <InvitationsBox reloadKey={invitationsKey} />
      <JoinPageBox />

      <div className="mt-6 flex gap-1 border-b border-white/10 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => selectTab(t.key)} data-testid={`apps-tab-${t.key}`} className={`shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition ${tab === t.key ? "" : "border-transparent text-white/50 hover:text-white"}`} style={tab === t.key ? { borderColor: t.color, color: t.color } : {}}>{t.label}</button>
        ))}
      </div>

      {/* PC: Tabelle; Tablet und Handy: Karten. */}
      <div className="mt-6 hidden lg:block border border-white/10 bg-[#121212] rounded-sm overflow-x-auto">
        <table className="w-full text-sm" data-testid="apps-table">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th className="text-left px-4 py-3">Eingereicht</th>
              <th className="text-left px-4 py-3">Person</th>
              <th className="text-left px-4 py-3">Wunsch</th>
              <th className="text-left px-4 py-3">Stand und nächster Schritt</th>
              <th className="text-right px-4 py-3"><span className="sr-only">Aktionen</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {list.map(a => {
              const state = applicationState(a, day);
              return (
                <tr key={a.id} data-testid={`app-row-${a.id}`}>
                  <td className="px-4 py-3 text-xs text-white/45 whitespace-nowrap">{day(a.created_at)}</td>
                  <td className="px-4 py-3"><div className="font-semibold">{a.user_display_name || a.user_username}</div><div className="text-xs text-white/40">@{a.user_username}</div></td>
                  <td className="px-4 py-3 text-xs">{wish(a)}</td>
                  <td className="px-4 py-3 max-w-md" data-testid={`app-state-${a.id}`}>
                    <StateBadge state={state} />
                    <div className="mt-1 text-xs text-white/60">{state.next}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{actions(a, state)}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan="5" className="px-4 py-12 text-center text-white/40 text-sm">Keine Bewerbungen.</td></tr>}
          </tbody>
        </table>
      </div>
      <ul className="mt-6 lg:hidden space-y-2" data-testid="apps-cards">
        {list.map((a) => {
          const state = applicationState(a, day);
          return (
            <li key={a.id} className="border border-white/10 bg-[#121212] rounded-sm p-3 space-y-2" data-testid={`app-card-${a.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{a.user_display_name || a.user_username}</div>
                  <div className="text-xs text-white/45">{wish(a)} · eingereicht {day(a.created_at)}</div>
                </div>
                <StateBadge state={state} testId={`app-card-state-${a.id}`} />
              </div>
              <p className="text-xs text-white/60">{state.next}</p>
              {actions(a, state, "app-card")}
            </li>
          );
        })}
        {!list.length && <li className="py-10 text-center text-white/40 text-sm">Keine Bewerbungen.</li>}
      </ul>

      {/* Detail als Seitenblatt (#435): Annehmen und Ablehnen stehen in der Leiste unten - nur, wo die Website entscheidet. */}
      {selected && (
        <AdminSheet
          title="Bewerbung"
          eyebrow="Bewerbungen"
          accent="#FFD700"
          onClose={() => setSelected(null)}
          testId="application-sheet"
          footer={selectedState?.decide ? (
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => decide(selected, "reject")} data-testid="application-sheet-reject" className="px-4 py-2 border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-sm text-xs font-bold uppercase">Ablehnen</button>
              <button type="button" onClick={() => decide(selected, "approve")} data-testid="application-sheet-approve" className="px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs font-bold uppercase">Annehmen</button>
            </div>
          ) : null}
        >
          <div className="space-y-3 text-sm">
            <Row k="Person" v={`${selected.user_display_name || selected.user_username} (@${selected.user_username})`} />
            <Row k="E-Mail" v={selected.user_email} />
            <Row k="Wunsch" v={wish(selected)} />
            <Row k="Eingereicht" v={viennaDateTime(selected.created_at)} />
            <div className="border border-white/10 rounded-sm p-3" data-testid="application-sheet-state">
              <StateBadge state={selectedState} />
              <p className="mt-1 text-sm text-white/70">{selectedState.next}</p>
              {selected.coupled && selected.dolibarr?.member_ref ? <p className="mt-1 text-xs text-white/50">Mitglied Nr. {selected.dolibarr.member_ref}</p> : null}
              {selected.coupled && selected.dolibarr?.member_url && <a href={selected.dolibarr.member_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#29B6E8] underline"><ExternalLink className="w-3 h-3" /> In Dolibarr öffnen</a>}
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Motivation</div>
              <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.motivation}</p>
            </div>
            {selected.notes && <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Anmerkungen</div>
              <p className="mt-1 whitespace-pre-wrap text-white/80">{selected.notes}</p>
            </div>}
            {selected.decision_note && <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Notiz zur Entscheidung</div>
              <p className="mt-1 text-white/80">{selected.decision_note}</p>
            </div>}
          </div>
        </AdminSheet>
      )}
      {inviting && <InviteSheet onClose={() => setInviting(false)} onInvited={() => { setInviting(false); setInvitationsKey((value) => value + 1); }} />}
    </AdminLayout>
  );
}

// Zum Antrag einladen (#1356): Personensuche über Konten ohne Mitgliedschaft; wer schon eingeladen ist, steht mit Datum da.
function InviteSheet({ onClose, onInvited }) {
  const [person, setPerson] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const already = person?.invited_at ? `${person.name} ist schon eingeladen – offen seit ${day(person.invited_at)}.` : "";

  const submit = async (event) => {
    event.preventDefault();
    if (!person) {
      toast.error("Bitte ein Konto suchen und wählen.");
      return;
    }
    if (already) return;
    setSaving(true);
    try {
      const { data } = await api.post("/admin/membership-invitations", { user_id: person.id, note: note.trim() || null });
      toast.success(data?.existing ? `${person.name} ist schon eingeladen – offen seit ${day(data.created_at)}.` : `${person.name} ist zum Mitgliedsantrag eingeladen.`);
      onInvited();
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Einladen hat nicht geklappt.");
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Zum Antrag einladen" eyebrow="Bewerbungen" accent="#29B6E8" onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Einladen" savingLabel="Lade ein …" submitTestId="apps-invite-save" testId="apps-invite-sheet">
      <p className="text-sm text-white/60">Die Person bekommt einen Hinweis auf der Website und in der App (und eine Mail, wenn sie Mitgliedschafts-Mails zulässt) und füllt den Antrag direkt aus. Gesucht werden nur Konten ohne Mitgliedschaft.</p>
      <PersonPicker purpose="invite" value={person} onChange={setPerson} label="Konto" placeholder="Name tippen …" testId="apps-invite-person" emptyText="Kein Konto ohne Mitgliedschaft mit diesem Namen." />
      {already && <p className="border border-[#FF9500]/40 bg-[#FF9500]/5 rounded-sm p-3 text-sm text-white/80" data-testid="apps-invite-already">{already}</p>}
      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Persönliche Zeile (optional)</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} data-testid="apps-invite-note" className="mt-1.5 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm min-h-20" placeholder="z. B. Schön, dass du bei den Turnieren dabei bist!" />
      </label>
    </AdminSheet>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-4 border-b border-white/5 pb-2"><span className="text-white/50 text-xs uppercase tracking-wider">{k}</span><span className="text-white text-right break-words min-w-0">{v}</span></div>;
}
