import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Logo } from "@/components/tls/Logo";
import { Sparkles, Mail, Server, Lock, Check, ArrowRight, ChevronLeft, ShieldCheck, AlertTriangle } from "lucide-react";

const STEPS = [
  { key: "welcome", label: "Willkommen" },
  { key: "branding", label: "Vereinsdaten" },
  { key: "admin", label: "Admin-Passwort" },
  { key: "mail", label: "E-Mail" },
  { key: "done", label: "Fertig" },
];

export default function SetupWizardPage() {
  const nav = useNavigate();
  const { user, isAdmin } = useAuth();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState(null);
  const [data, setData] = useState({
    club_name: "THE LION SQUAD",
    tagline: "eSports Verein",
    site_description: "",
    contact_email: "",
    domain: "lionsquad.at",
    primary_color: "#29B6E8",
    favicon_url: "",
    imprint: "",
    privacy_policy: "",
    discord_invite_url: "",
    twitch_channel: "",
    new_admin_password: "",
    new_admin_password_confirm: "",
    mail_provider: "smtp",
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    smtp_auth: "auto",
    smtp_security: "starttls",
    smtp_tls_verify: true,
    smtp_envelope_from: "",
    sender_name: "THE LION SQUAD",
    sender_email: "noreply@lionsquad.at",
    reply_to_email: "office@lionsquad.at",
    message_id_domain: "lionsquad.at",
    resend_api_key: "",
  });
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(() => {
    api.get("/setup/status").then(({ data }) => {
      setStatus(data);
      if (!isAdmin) {
        toast.error("Setup-Wizard ist nur für Admins.");
        nav("/login");
      }
    }).catch(() => {});
  }, [isAdmin, nav]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get("/setup/defaults").then(({ data: defaults }) => {
      setData((current) => ({
        ...current,
        ...(defaults?.branding || {}),
        ...(defaults?.mail || {}),
        smtp_pass: "",
        resend_api_key: "",
      }));
    }).catch(() => {});
  }, [isAdmin]);
  useApiInvalidation(loadStatus, ["setup", "settings"]);
  useEffect(() => {
    if (status?.has_branding === false) setStep(0);
  }, [status?.has_branding]);

  const upd = (k, v) => setData((p) => ({ ...p, [k]: v }));

  const validateStep = () => {
    if (step === 1 && !data.club_name) { toast.error("Vereinsname ist Pflicht"); return false; }
    if (step === 2 && data.new_admin_password) {
      if (data.new_admin_password.length < 8) { toast.error("Passwort min. 8 Zeichen"); return false; }
      if (data.new_admin_password !== data.new_admin_password_confirm) { toast.error("Passwörter stimmen nicht überein"); return false; }
    }
    return true;
  };

  const next = () => { if (validateStep()) setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const prev = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    if (saving) return;
    try {
      setSaving(true);
      const payload = { ...data };
      delete payload.new_admin_password_confirm;
      if (!payload.new_admin_password) delete payload.new_admin_password;
      if (payload.mail_provider === "resend") {
        delete payload.smtp_host; delete payload.smtp_port; delete payload.smtp_user;
        delete payload.smtp_pass; delete payload.smtp_auth; delete payload.smtp_security; delete payload.smtp_tls_verify; delete payload.smtp_envelope_from;
        delete payload.message_id_domain;
      } else {
        delete payload.resend_api_key;
      }
      await api.post("/setup/complete", payload);
      toast.success("Setup abgeschlossen!");
      setStep(STEPS.length - 1);
      setTimeout(() => nav("/admin"), 1500);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const skip = async () => {
    try { await api.post("/setup/skip"); toast.success("Setup übersprungen"); nav("/admin"); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" />
          <span className="mt-3 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Setup-Assistent</span>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-between mb-8 px-2">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex-1 flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i <= step ? "bg-[#29B6E8] text-black" : "bg-white/10 text-white/40"}`} data-testid={`wizard-step-${i}`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-white/40 mt-1.5 hidden sm:block">{s.label}</span>
              {i < STEPS.length - 1 && <div className={`absolute h-0.5 ${i < step ? "bg-[#29B6E8]" : "bg-white/10"}`} style={{ width: "calc(100% / 5 - 2rem)", transform: "translateY(15px)", display: "none" }} />}
            </div>
          ))}
        </div>

        <div className="border border-white/10 bg-[#121212] rounded-sm p-6 md:p-8 min-h-[400px]">
          {step === 0 && (
            <div className="text-center py-8" data-testid="wizard-welcome">
              <Sparkles className="w-12 h-12 text-[#29B6E8] mx-auto mb-4" />
              <h2 className="font-heading text-3xl font-black uppercase mb-3">Willkommen, Löwe!</h2>
              <p className="text-white/70 max-w-md mx-auto mb-6">
                Lass uns deine Vereinsplattform in 4 schnellen Schritten einrichten. Du kannst alles
                später jederzeit im Admin-Bereich ändern.
              </p>
              {status && (
                <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 text-left mb-6 max-w-md mx-auto">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold">Setup-Status</div>
                    <div className="font-heading font-black text-[#29B6E8]">{status.health_score ?? 0}%</div>
                  </div>
                  <div className="space-y-1.5">
                    {(status.checks || []).map((check) => (
                      <div key={check.key} className="flex items-center gap-2 text-xs">
                        {check.ok ? <ShieldCheck className="w-3.5 h-3.5 text-[#00FF88]" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#FFD700]" />}
                        <span className={check.ok ? "text-white/65" : "text-white/90"}>{check.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4" data-testid="wizard-branding">
              <h2 className="font-heading text-2xl font-black uppercase mb-3">Vereinsdaten</h2>
              <Field label="Vereinsname *" testId="wizard-club-name" value={data.club_name} onChange={(v) => upd("club_name", v)} />
              <Field label="Tagline" testId="wizard-tagline" value={data.tagline} onChange={(v) => upd("tagline", v)} />
              <Field label="Kurzbeschreibung" testId="wizard-description" value={data.site_description} onChange={(v) => upd("site_description", v)} />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Domain" testId="wizard-domain" value={data.domain} onChange={(v) => upd("domain", v)} />
                <Field label="Akzentfarbe" testId="wizard-color" value={data.primary_color} onChange={(v) => upd("primary_color", v)} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Kontakt E-Mail" testId="wizard-contact-email" type="email" value={data.contact_email} onChange={(v) => upd("contact_email", v)} />
                <Field label="Favicon URL" testId="wizard-favicon" value={data.favicon_url} onChange={(v) => upd("favicon_url", v)} />
              </div>
              <Field label="Discord Einladung (URL)" testId="wizard-discord" value={data.discord_invite_url} onChange={(v) => upd("discord_invite_url", v)} />
              <Field label="Twitch Channel" testId="wizard-twitch" value={data.twitch_channel} onChange={(v) => upd("twitch_channel", v)} />
              <div className="grid sm:grid-cols-2 gap-3">
                <TextArea label="Impressum Zusatz" testId="wizard-imprint" value={data.imprint} onChange={(v) => upd("imprint", v)} />
                <TextArea label="Datenschutz Zusatz" testId="wizard-privacy" value={data.privacy_policy} onChange={(v) => upd("privacy_policy", v)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4" data-testid="wizard-admin">
              <h2 className="font-heading text-2xl font-black uppercase mb-3 flex items-center gap-2">
                <Lock className="w-6 h-6 text-[#29B6E8]" />Admin-Passwort
              </h2>
              <p className="text-white/60 text-sm mb-4">
                Optional — leer lassen um das aktuelle Passwort beizubehalten.
              </p>
              <Field type="password" label="Neues Passwort (min. 8 Zeichen)" testId="wizard-new-pw" value={data.new_admin_password} onChange={(v) => upd("new_admin_password", v)} />
              <Field type="password" label="Passwort bestätigen" testId="wizard-new-pw-confirm" value={data.new_admin_password_confirm} onChange={(v) => upd("new_admin_password_confirm", v)} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4" data-testid="wizard-mail">
              <h2 className="font-heading text-2xl font-black uppercase mb-3 flex items-center gap-2">
                <Mail className="w-6 h-6 text-[#29B6E8]" />E-Mail-Versand
              </h2>
              <div className="flex gap-2">
                {[["smtp", "Eigener SMTP", Server], ["resend", "Resend API", Mail]].map(([k, l, Icn]) => (
                  <button key={k} onClick={() => upd("mail_provider", k)} data-testid={`wizard-mail-${k}`}
                    className={`flex-1 border px-4 py-3 rounded-sm text-sm font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 ${data.mail_provider === k ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/60 hover:border-white/20"}`}>
                    <Icn className="w-4 h-4" />{l}
                  </button>
                ))}
              </div>
              {data.mail_provider === "smtp" ? (
                <>
                  <Field label="SMTP Host" testId="wizard-smtp-host" value={data.smtp_host} onChange={(v) => upd("smtp_host", v)} placeholder="mail.example.com" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Port" testId="wizard-smtp-port" type="number" value={data.smtp_port} onChange={(v) => upd("smtp_port", parseInt(v, 10))} />
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Sicherheit</div>
                      <select value={data.smtp_security} onChange={(e) => upd("smtp_security", e.target.value)} data-testid="wizard-smtp-sec" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                        <option value="starttls">STARTTLS</option><option value="tls">SSL/TLS</option><option value="none">Keine</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={data.smtp_tls_verify !== false} onChange={(e) => upd("smtp_tls_verify", e.target.checked)} data-testid="wizard-smtp-tls-verify" className="accent-[#29B6E8]" />
                    <span>TLS Zertifikat pruefen</span>
                  </label>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">SMTP Anmeldung</div>
                    <select value={data.smtp_auth} onChange={(e) => upd("smtp_auth", e.target.value)} data-testid="wizard-smtp-auth" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                      <option value="auto">Automatisch</option>
                      <option value="login">Mit Benutzer/Passwort</option>
                      <option value="none">Ohne Anmeldung</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="User" testId="wizard-smtp-user" value={data.smtp_user} onChange={(v) => upd("smtp_user", v)} />
                    <Field label="Passwort" type="password" testId="wizard-smtp-pass" value={data.smtp_pass} onChange={(v) => upd("smtp_pass", v)} />
                  </div>
                  <Field label="Technischer SMTP-Absender" testId="wizard-smtp-envelope-from" value={data.smtp_envelope_from} onChange={(v) => upd("smtp_envelope_from", v)} placeholder="office@lionsquad.at" />
                  <Field label="Message-ID Domain" testId="wizard-message-id-domain" value={data.message_id_domain} onChange={(v) => upd("message_id_domain", v)} placeholder="lionsquad.at" />
                </>
              ) : (
                <Field label="Resend API Key" type="password" testId="wizard-resend-key" value={data.resend_api_key} onChange={(v) => upd("resend_api_key", v)} placeholder="re_..." />
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Absender Name" testId="wizard-sender-name" value={data.sender_name} onChange={(v) => upd("sender_name", v)} />
                <Field label="Absender E-Mail" testId="wizard-sender-email" type="email" value={data.sender_email} onChange={(v) => upd("sender_email", v)} />
              </div>
              <Field label="Antworten an" testId="wizard-reply-to" type="email" value={data.reply_to_email} onChange={(v) => upd("reply_to_email", v)} placeholder="office@lionsquad.at" />
              <p className="text-xs text-white/40">Du kannst das später unter <em>Einstellungen → SMTP</em> ändern oder leer lassen.</p>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-8" data-testid="wizard-done">
              <div className="w-16 h-16 rounded-full bg-[#00FF88]/10 border-2 border-[#00FF88] flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-[#00FF88]" />
              </div>
              <h2 className="font-heading text-3xl font-black uppercase mb-3">Setup abgeschlossen!</h2>
              <p className="text-white/70 mb-6">Deine TLS-Plattform ist startklar. Du wirst weitergeleitet …</p>
            </div>
          )}
        </div>

        <div className="flex justify-between mt-6">
          {step > 0 && step < STEPS.length - 1 ? (
            <button onClick={prev} data-testid="wizard-back" className="px-4 py-2 text-white/60 hover:text-white inline-flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" /> Zurück
            </button>
          ) : <div />}
          <div className="flex gap-2">
            {step === 0 && <button onClick={skip} data-testid="wizard-skip" className="px-4 py-2 text-white/40 hover:text-white text-sm">Überspringen</button>}
            {step < STEPS.length - 2 && (
              <button onClick={next} data-testid="wizard-next" className="px-6 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
                Weiter <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {step === STEPS.length - 2 && (
              <button onClick={finish} disabled={saving} data-testid="wizard-finish" className="px-6 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-50">
                {saving ? "Speichere..." : "Fertigstellen"} <Check className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testId, type = "text", placeholder = "" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} placeholder={placeholder}
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function TextArea({ label, value, onChange, testId, placeholder = "" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} placeholder={placeholder} rows={4}
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm resize-y" />
    </label>
  );
}
