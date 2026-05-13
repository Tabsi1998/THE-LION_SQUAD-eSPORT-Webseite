import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Clipboard, Mail, MessageSquare, MapPin, Send, Check } from "lucide-react";

export default function ContactPage() {
  const { user } = useAuth();
  const [branding, setBranding] = useState(null);
  const [topics, setTopics] = useState([]);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: user?.display_name || user?.username || "",
    email: user?.email || "",
    topic: "general",
    subject: "",
    message: "",
    accept_privacy: false,
  });

  const loadInfo = useCallback(() => {
    api.get("/settings/public").then(({ data }) => setBranding(data)).catch(() => {});
    api.get("/contact/topics").then(({ data }) => setTopics(data)).catch(() => {});
  }, []);
  useEffect(() => { loadInfo(); }, [loadInfo]);
  useApiInvalidation(loadInfo, ["settings", "contact"]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.accept_privacy) { toast.error("Bitte Datenschutz-Hinweis bestätigen."); return; }
    setSubmitting(true);
    try {
      await api.post("/contact/submit", form);
      setDone(true);
      toast.success("Nachricht gesendet — Bestätigungsmail folgt.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Fehler beim Versand.");
    }
    setSubmitting(false);
  };

  const contactEmail = branding?.contact_email || "info@lionsquad.at";

  const copyEmail = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(contactEmail).catch(() => null);
    toast.success("E-Mail-Adresse kopiert.");
  };

  return (
    <PublicLayout>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Kontakt" }]} className="mb-6" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Kontakt</span>
        <h1 className="mt-2 font-heading text-4xl md:text-5xl font-black uppercase">Sag Hallo</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Egal ob Mitgliedschaft, Turnier-Anfrage, Sponsoring oder einfach nur Hallo — schreib uns. Wir antworten schnell.
        </p>

        <div className="mt-8 grid md:grid-cols-2 gap-5">
          <a href={branding?.discord_invite_url || "https://discord.com/invite/thelionsquadesports"} target="_blank" rel="noreferrer" data-testid="contact-discord" className="border border-white/10 hover:border-[#5865F2]/60 rounded-sm bg-[#121212] p-5 transition group">
            <MessageSquare className="w-6 h-6 text-[#5865F2] mb-3" />
            <h3 className="font-heading font-black uppercase text-base">Discord Server</h3>
            <p className="mt-1 text-sm text-white/60">Schnellster Weg zu uns.</p>
          </a>
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <Mail className="w-6 h-6 text-[#29B6E8] mb-3" />
            <h3 className="font-heading font-black uppercase text-base">E-Mail direkt</h3>
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
              <a href={`mailto:${contactEmail}`} className="text-sm text-[#29B6E8] hover:text-white break-all transition">
                {contactEmail}
              </a>
              <button type="button" onClick={copyEmail} className="inline-flex items-center gap-2 self-start px-3 py-1.5 border border-white/10 text-white/60 hover:text-white hover:border-[#29B6E8]/50 rounded-sm text-[11px] font-bold uppercase tracking-wider transition" title="E-Mail-Adresse kopieren">
                <Clipboard className="w-3.5 h-3.5" /> Kopieren
              </button>
            </div>
          </div>
        </div>

        {/* Formular */}
        <div className="mt-10 border border-white/10 rounded-sm bg-[#121212] p-6 md:p-8">
          {done ? (
            <div className="text-center py-12" data-testid="contact-success">
              <div className="w-14 h-14 rounded-full bg-[#00FF88]/10 border-2 border-[#00FF88] flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7 text-[#00FF88]" />
              </div>
              <h2 className="font-heading text-2xl font-black uppercase">Nachricht gesendet</h2>
              <p className="mt-2 text-white/70">Eine Bestätigungsmail ist unterwegs. Wir melden uns so bald wie möglich.</p>
              <button onClick={() => { setDone(false); setForm({ ...form, subject: "", message: "" }); }} className="mt-5 text-xs uppercase tracking-wider text-[#29B6E8] hover:underline">Weitere Nachricht senden</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h2 className="font-heading text-xl font-black uppercase mb-2">Schreib uns</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Name *">
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="contact-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                </Field>
                <Field label="E-Mail *">
                  <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="contact-email-input" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                </Field>
              </div>
              <Field label="Thema *">
                <select required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} data-testid="contact-topic" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                  {topics.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Betreff *">
                <input required minLength={2} maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="contact-subject" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              </Field>
              <Field label="Nachricht *">
                <textarea required minLength={5} maxLength={4000} rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="contact-message" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm resize-y" />
              </Field>
              <label className="flex items-start gap-2 text-sm text-white/70">
                <input type="checkbox" required checked={form.accept_privacy} onChange={(e) => setForm({ ...form, accept_privacy: e.target.checked })} data-testid="contact-privacy" className="mt-1 accent-[#29B6E8]" />
                <span>Ich habe die <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzhinweise</Link> gelesen und stimme der Speicherung meiner Angaben zur Bearbeitung der Anfrage zu.</span>
              </label>
              <button type="submit" disabled={submitting} data-testid="contact-submit" className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition disabled:opacity-50">
                <Send className="w-4 h-4" /> {submitting ? "Sende…" : "Nachricht senden"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-10 border border-white/10 rounded-sm bg-[#121212] p-6">
          <div className="flex items-start gap-4">
            <MapPin className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
            <div>
              <h3 className="font-heading font-black uppercase">{branding?.club_name || "THE LION SQUAD"} — {branding?.tagline || "eSports"}</h3>
              <p className="mt-2 text-sm text-white/65">Offiziell eingetragener Verein, Österreich.</p>
              <p className="mt-1 text-sm text-white/50">Vereinsdaten und ZVR-Nummer findest du im <Link to="/imprint" className="text-[#29B6E8] hover:underline">Impressum</Link>.</p>
            </div>
          </div>
        </div>
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
