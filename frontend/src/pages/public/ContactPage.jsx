import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { toast } from "sonner";
import { Mail, MessageSquare, MapPin, Send, Check } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ContactPage() {
  useDocumentTitle(
    "Kontakt",
    "Kontakt zu THE LION SQUAD eSports für Mitgliedschaft, Turniere, Events, Sponsoring, Kooperationen und Gaming-Anfragen in Tirol."
  );

  const { user } = useAuth();
  const branding = usePublicSiteSettings();
  const [topics, setTopics] = useState([]);
  const [done, setDone] = useState(false);
  const { submitting, submitOnce } = useSubmissionGuard();
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [form, setForm] = useState({
    name: user?.display_name || user?.username || "",
    email: user?.email || "",
    topic: "general",
    subject: "",
    message: "",
    accept_privacy: false,
  });

  const loadTopics = useCallback(() => {
    api.get("/contact/topics").then(({ data }) => setTopics(data)).catch(() => {});
  }, []);
  useEffect(() => { loadTopics(); }, [loadTopics]);
  useApiInvalidation(loadTopics, ["contact"]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: null }));
    setSubmitError("");
  };

  const validate = () => {
    const errors = {};
    if (form.name.trim().length < 2) errors.name = "Bitte gib deinen Namen mit mindestens 2 Zeichen ein.";
    if (!form.email.trim()) errors.email = "Bitte gib deine E-Mail-Adresse ein.";
    else if (!EMAIL_RE.test(form.email.trim())) errors.email = "Bitte gib eine gültige E-Mail-Adresse ein.";
    if (!form.topic) errors.topic = "Bitte wähle ein Thema aus.";
    if (form.subject.trim().length < 2) errors.subject = "Bitte gib einen Betreff mit mindestens 2 Zeichen ein.";
    if (form.message.trim().length < 5) errors.message = "Bitte beschreibe dein Anliegen mit mindestens 5 Zeichen.";
    if (!form.accept_privacy) errors.accept_privacy = "Bitte akzeptiere den Datenschutz-Hinweis.";
    setFieldErrors(errors);
    const first = ["name", "email", "topic", "subject", "message", "accept_privacy"].find((field) => errors[field]);
    if (first) document.getElementById(`contact-${first.replace("accept_privacy", "privacy")}`)?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const payload = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      subject: form.subject.trim(),
      message: form.message.trim(),
    };
    setSubmitError("");
    const attempt = await submitOnce(() => api.post("/contact/submit", payload));
    if (!attempt.started) return;
    if (!attempt.error) {
      setDone(true);
      toast.success("Nachricht gesendet — Bestätigungsmail folgt.");
    } else {
      const err = attempt.error;
      const message = formatApiError(err.response?.data?.detail) || "Fehler beim Versand.";
      setSubmitError(message);
      toast.error(message);
    }
  };

  const contactEmail = branding?.contact_email;

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
          {contactEmail ? (
            <a href={`mailto:${contactEmail}`} data-testid="contact-email-link" className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm bg-[#121212] p-5 transition group">
              <Mail className="w-6 h-6 text-[#29B6E8] mb-3" />
              <h3 className="font-heading font-black uppercase text-base">E-Mail direkt</h3>
              <p className="mt-1 text-sm text-white/60 group-hover:text-white/80 break-all transition">{contactEmail}</p>
            </a>
          ) : (
            <div data-testid="contact-email-unavailable" className="border border-white/10 rounded-sm bg-[#121212] p-5">
              <Mail className="w-6 h-6 text-white/35 mb-3" />
              <h3 className="font-heading font-black uppercase text-base">Kontaktformular</h3>
              <p className="mt-1 text-sm text-white/60">Nutze bitte das Formular auf dieser Seite.</p>
            </div>
          )}
        </div>

        {/* Formular */}
        <div className="mt-10 border border-white/10 rounded-sm bg-[#121212] p-6 md:p-8">
          {done ? (
            <div className="text-center py-12" data-testid="contact-success" role="status" aria-live="polite">
              <div className="w-14 h-14 rounded-full bg-[#00FF88]/10 border-2 border-[#00FF88] flex items-center justify-center mx-auto mb-4">
                <Check className="w-7 h-7 text-[#00FF88]" />
              </div>
              <h2 className="font-heading text-2xl font-black uppercase">Nachricht gesendet</h2>
              <p className="mt-2 text-white/70">Eine Bestätigungsmail ist unterwegs. Wir melden uns so bald wie möglich.</p>
              <button type="button" onClick={() => { setDone(false); setFieldErrors({}); setSubmitError(""); setForm((current) => ({ ...current, subject: "", message: "", accept_privacy: false })); }} className="mt-5 text-xs uppercase tracking-wider text-[#29B6E8] hover:underline">Weitere Nachricht senden</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <h2 className="font-heading text-xl font-black uppercase mb-2">Schreib uns</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <Field id="contact-name" label="Name *" error={fieldErrors.name}>
                  <input id="contact-name" required value={form.name} onChange={(e) => updateField("name", e.target.value)} data-testid="contact-name" aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? "contact-name-error" : undefined} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                </Field>
                <Field id="contact-email" label="E-Mail *" error={fieldErrors.email}>
                  <input id="contact-email" type="email" required value={form.email} onChange={(e) => updateField("email", e.target.value)} data-testid="contact-email-input" aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "contact-email-error" : undefined} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                </Field>
              </div>
              <Field id="contact-topic" label="Thema *" error={fieldErrors.topic}>
                <select id="contact-topic" required value={form.topic} onChange={(e) => updateField("topic", e.target.value)} data-testid="contact-topic" aria-invalid={!!fieldErrors.topic} aria-describedby={fieldErrors.topic ? "contact-topic-error" : undefined} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                  {topics.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field id="contact-subject" label="Betreff *" error={fieldErrors.subject}>
                <input id="contact-subject" required minLength={2} maxLength={200} value={form.subject} onChange={(e) => updateField("subject", e.target.value)} data-testid="contact-subject" aria-invalid={!!fieldErrors.subject} aria-describedby={fieldErrors.subject ? "contact-subject-error" : undefined} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              </Field>
              <Field id="contact-message" label="Nachricht *" error={fieldErrors.message}>
                <textarea id="contact-message" required minLength={5} maxLength={4000} rows={6} value={form.message} onChange={(e) => updateField("message", e.target.value)} data-testid="contact-message" aria-invalid={!!fieldErrors.message} aria-describedby={fieldErrors.message ? "contact-message-error" : undefined} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm resize-y" />
              </Field>
              <label className="flex items-start gap-2 text-sm text-white/70">
                <input id="contact-privacy" type="checkbox" required checked={form.accept_privacy} onChange={(e) => updateField("accept_privacy", e.target.checked)} data-testid="contact-privacy" aria-invalid={!!fieldErrors.accept_privacy} aria-describedby={fieldErrors.accept_privacy ? "contact-privacy-error" : undefined} className="mt-1 accent-[#29B6E8]" />
                <span>Ich habe die <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzhinweise</Link> gelesen und stimme der Speicherung meiner Angaben zur Bearbeitung der Anfrage zu.{fieldErrors.accept_privacy && <span id="contact-privacy-error" role="alert" className="block mt-1 text-xs text-[#FF8A80]">{fieldErrors.accept_privacy}</span>}</span>
              </label>
              {submitError && <AuthFormAlert id="contact-submit-error">{submitError}</AuthFormAlert>}
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

function Field({ id, label, error, children }) {
  return (
    <label htmlFor={id} className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
      {error && <div id={`${id}-error`} role="alert" className="mt-1 text-xs text-[#FF8A80]">{error}</div>}
    </label>
  );
}
