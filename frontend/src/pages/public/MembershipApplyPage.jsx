/**
 * Phase C — Mitgliedsbewerbung Form.
 *
 * Eingeloggte Community-User reichen eine Bewerbung um Vereinsmitgliedschaft ein.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Crown, CheckCircle2, FileText, Mail } from "lucide-react";

const CONTRIB_OPTIONS = [
  { value: "full", label: "Vollmitgliedschaft" },
  { value: "supporter", label: "Unterstützer-Mitgliedschaft" },
  { value: "youth", label: "Jugend-Mitgliedschaft" },
  { value: "honorary", label: "Ehrenmitgliedschaft (auf Einladung)" },
];

export default function MembershipApplyPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    motivation: "",
    contribution_pref: "full",
    accept_statutes: false,
    accept_privacy: false,
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) { nav("/login?next=/membership/apply"); return; }
    api.get("/membership/apply/me").then(({ data }) => { setExisting(data); setLoading(false); }).catch(() => setLoading(false));
  }, [user, nav]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.accept_statutes || !form.accept_privacy) { toast.error("Bitte Statuten und Datenschutz akzeptieren."); return; }
    if (form.motivation.length < 20) { toast.error("Motivation: mind. 20 Zeichen."); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/membership/apply", form);
      setExisting(data);
      toast.success("Bewerbung eingereicht! Wir melden uns per Mail.");
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Fehler"); }
    setSubmitting(false);
  };

  return (
    <PublicLayout>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitgliedschaft</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Mitglied werden</h1>
        <p className="mt-3 text-white/60 max-w-2xl">Werde offiziell Teil von THE LION SQUAD — eSPORTS. Stimmrecht bei Generalversammlungen, Member-Bereiche, Vereinslogo auf deinem Trikot. Eine Bewerbung pro User.</p>

        {loading ? (
          <div className="mt-8 text-white/40 text-sm">Lade …</div>
        ) : existing && existing.status === "pending" ? (
          <StatusCard testId="apply-pending" icon={Mail} color="#29B6E8" title="Bewerbung eingegangen" body={`Eingereicht am ${new Date(existing.created_at).toLocaleDateString("de-DE")}. Du erhältst eine E-Mail sobald entschieden wurde.`} />
        ) : existing && existing.status === "approved" ? (
          <StatusCard testId="apply-approved" icon={Crown} color="#FFD700" title="Du bist Mitglied 🦁" body="Willkommen im Rudel! Schau in den Mitgliederbereich für Benefits und Dokumente." />
        ) : existing && existing.status === "rejected" ? (
          <StatusCard testId="apply-rejected" icon={FileText} color="#FF3B30" title="Bewerbung abgelehnt" body={existing.decision_note || "Du kannst zu einem späteren Zeitpunkt erneut versuchen."} />
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5 border border-white/10 bg-[#121212] rounded-sm p-6" data-testid="apply-form">
            <Field label="Beitragsart">
              <select className="input" value={form.contribution_pref} onChange={(e) => setForm({ ...form, contribution_pref: e.target.value })} data-testid="apply-contribution">
                {CONTRIB_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={`Motivation (${form.motivation.length}/2000)`}>
              <textarea required minLength={20} maxLength={2000} rows={6} value={form.motivation} onChange={(e) => setForm({ ...form, motivation: e.target.value })} placeholder="Warum möchtest du Mitglied werden? Welche Spiele/Plattformen? Wie viel Zeit kannst du einbringen?" className="input" data-testid="apply-motivation" />
            </Field>
            <Field label="Anmerkungen (optional)">
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input" />
            </Field>
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" required checked={form.accept_statutes} onChange={(e) => setForm({ ...form, accept_statutes: e.target.checked })} data-testid="apply-statutes" className="mt-1 accent-[#FFD700]" />
                <span className="text-sm text-white/70">Ich habe die <a href="/imprint" className="text-[#29B6E8] underline">Vereinsstatuten</a> gelesen und akzeptiere sie.</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" required checked={form.accept_privacy} onChange={(e) => setForm({ ...form, accept_privacy: e.target.checked })} data-testid="apply-privacy" className="mt-1 accent-[#FFD700]" />
                <span className="text-sm text-white/70">Ich akzeptiere die <a href="/privacy" className="text-[#29B6E8] underline">Datenschutzerklärung</a>.</span>
              </label>
            </div>
            <button type="submit" disabled={submitting} data-testid="apply-submit" className="w-full px-6 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <Crown className="w-4 h-4" /> {submitting ? "Sende …" : "Bewerbung einreichen"}
            </button>
          </form>
        )}
        <style>{`.input{ width:100%; background:#0A0A0A; border:1px solid rgba(255,255,255,0.1); padding:0.6rem 0.8rem; border-radius:2px; font-size:14px; color:#fff; }`}</style>
      </section>
    </PublicLayout>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function StatusCard({ icon: Icon, color, title, body, testId }) {
  return (
    <div className="mt-8 border border-white/10 bg-[#121212] rounded-sm p-6 flex items-start gap-4" data-testid={testId}>
      <Icon className="w-6 h-6 shrink-0" style={{ color }} />
      <div>
        <h3 className="font-heading text-xl font-black uppercase">{title}</h3>
        <p className="mt-1 text-white/60">{body}</p>
      </div>
    </div>
  );
}
