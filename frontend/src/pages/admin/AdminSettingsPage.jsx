import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { toast } from "sonner";
import { Mail, Palette, Send, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Server, Inbox, RefreshCw, Trash2, FileText, Activity } from "lucide-react";

export default function AdminSettingsPage() {
  const [tab, setTab] = useState("email");
  const [email, setEmail] = useState({ resend_api_key: "", sender_name: "", sender_email: "", reply_to_email: "", enabled: true, resend_api_key_masked: "" });
  const [smtp, setSmtp] = useState({ provider: "resend", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_auth: "login", smtp_security: "auto", smtp_tls_verify: false, smtp_envelope_from: "", smtp_helo_name: "", sender_name: "", sender_email: "", reply_to_email: "", message_id_domain: "", enabled: true, smtp_pass_masked: "" });
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [smtpDiag, setSmtpDiag] = useState(null);
  const [smtpDeliverability, setSmtpDeliverability] = useState(null);
  const [queue, setQueue] = useState([]);
  const [queueFilter, setQueueFilter] = useState("");
  const [brand, setBrand] = useState({
    club_name: "", tagline: "", site_description: "", primary_color: "#29B6E8",
    logo_url: "", mascot_url: "", favicon_url: "", contact_email: "", domain: "", timezone: "Europe/Vienna",
    legal_name: "", legal_form: "eingetragener Verein nach oesterreichischem Vereinsrecht", zvr_number: "",
    street_address: "", address_extra: "", postal_code: "", city: "", state: "Tirol", country: "Oesterreich",
    registered_seat: "", register_authority: "", representative_name: "", representative_role: "",
    content_responsible: "", phone: "", privacy_contact_email: "", hosting_provider: "", hosting_country: "Oesterreich/EU",
    vat_number: "", tournament_terms_url: "", paid_tournaments_enabled: false,
    imprint: "", privacy_policy: "", legal_extra: "", privacy_extra: "",
    discord_invite_url: "", twitch_channel: "",
  });
  const [discord, setDiscord] = useState({ webhook_url: "", username: "", avatar_url: "", enabled: true, configured: false, webhook_url_masked: "", last_status: "", last_error: "", last_event_key: "", last_checked_at: "" });
  const [testEmail, setTestEmail] = useState("");
  const [logs, setLogs] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);

  const load = async () => {
    const requests = await Promise.allSettled([
      api.get("/settings/email"),
      api.get("/settings/branding"),
      api.get("/settings/discord"),
      api.get("/settings/email/logs"),
      api.get("/settings/smtp"),
      api.get("/settings/mail-queue?limit=100"),
      api.get("/admin/system-status"),
    ]);
    const value = (i) => requests[i].status === "fulfilled" ? requests[i].value.data : null;
    const e = value(0), b = value(1), d = value(2), l = value(3), sm = value(4), q = value(5), st = value(6);
    if (e) setEmail((prev) => ({ ...prev, ...e, resend_api_key: "" }));
    if (b) setBrand((prev) => ({ ...prev, ...b }));
    if (d) setDiscord((prev) => ({ ...prev, ...d, webhook_url: "" }));
    if (l) setLogs(l);
    if (sm) setSmtp((prev) => ({ ...prev, ...sm, smtp_pass: "" }));
    if (q) setQueue(q);
    if (st) setSystemStatus(st);
    if (requests.some((r) => r.status === "rejected")) {
      toast.error("Ein Teil der Einstellungen konnte nicht geladen werden. Die verfuegbaren Tabs bleiben nutzbar.");
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const saveEmail = async () => {
    const payload = { ...email };
    if (!payload.resend_api_key) delete payload.resend_api_key;
    try { await api.put("/settings/email", payload); toast.success("E-Mail-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const saveBrand = async () => {
    try { await api.put("/settings/branding", brand); toast.success("Branding gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const saveDiscord = async () => {
    const payload = { ...discord };
    if (!payload.webhook_url) delete payload.webhook_url;
    delete payload.configured;
    delete payload.webhook_url_masked;
    delete payload.last_status;
    delete payload.last_error;
    delete payload.last_event_key;
    delete payload.last_checked_at;
    try { await api.put("/settings/discord", payload); toast.success("Discord gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendTest = async () => {
    if (!testEmail) return toast.error("E-Mail-Adresse eingeben");
    try {
      const { data } = await api.post("/settings/email/test", { to: testEmail });
      if (data.ok) toast.success(`Testmail gesendet (ID: ${data.id || "—"})`);
      else toast.error(`Fehler: ${data.reason}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendDiscordTest = async () => {
    try {
      const { data } = await api.post("/settings/discord/test");
      if (data.ok) toast.success(`Discord-Test gesendet${data.status_code ? ` (${data.status_code})` : ""}.`);
      else toast.error(`Fehler: ${data.error || data.reason || "unbekannt"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const clearDiscordWebhook = async () => {
    if (!window.confirm("Discord Webhook wirklich entfernen?")) return;
    try {
      await api.put("/settings/discord", { clear_webhook: true });
      toast.success("Discord Webhook entfernt.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const saveSmtp = async () => {
    const payload = { ...smtp };
    if (payload.provider === "smtp" && payload.smtp_auth === "login") {
      if (!payload.smtp_user) return toast.error("SMTP User fehlt. Fuer einfachen Versand bitte office@... eintragen.");
      if (!payload.smtp_pass && !payload.smtp_pass_masked) return toast.error("SMTP Passwort fehlt.");
    }
    if (!payload.smtp_pass) delete payload.smtp_pass;
    try { await api.put("/settings/smtp", payload); toast.success("SMTP-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const applySubmissionPreset = () => {
    setSmtp({
      ...smtp,
      provider: "smtp",
      smtp_port: 587,
      smtp_auth: "login",
      smtp_security: "auto",
      smtp_tls_verify: false,
      smtp_envelope_from: "",
    });
    toast.success("Standard SMTP-Login gesetzt: 587, Auto-TLS, Benutzer/Passwort.");
  };
  const applyLocalIpPreset = () => {
    setSmtp({
      ...smtp,
      provider: "smtp",
      smtp_port: 587,
      smtp_auth: "login",
      smtp_security: "auto",
      smtp_tls_verify: false,
      smtp_envelope_from: "",
      smtp_helo_name: "",
      message_id_domain: "",
    });
    toast.success("Lokale IP vorbereitet: Auto-TLS, Login, ohne Host-Domain.");
  };
  const sendSmtpTest = async () => {
    if (!smtpTestEmail) return toast.error("E-Mail-Adresse eingeben");
    try {
      const { data } = await api.post("/settings/smtp/test", { to: smtpTestEmail });
      if (data.ok) toast.success(`SMTP-Testmail gesendet (ID: ${data.id || "—"})`);
      else toast.error(`Fehler: ${data.reason}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const diagnoseSmtp = async () => {
    if (!smtpTestEmail) return toast.error("E-Mail-Adresse fuer Diagnose eingeben");
    try {
      const { data } = await api.post("/settings/smtp/diagnose", { to: smtpTestEmail });
      setSmtpDiag(data);
      if (data.ok) toast.success("SMTP Diagnose erfolgreich.");
      else toast.error("SMTP Diagnose zeigt ein Problem.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const checkDeliverability = async () => {
    try {
      const { data } = await api.get("/settings/smtp/deliverability");
      setSmtpDeliverability(data);
      if (data.ok) toast.success("Zustellbarkeit sieht grundsaetzlich okay aus.");
      else toast.error("Zustellbarkeit hat offene Punkte.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const processQueueNow = async () => {
    try { const { data } = await api.post("/settings/mail-queue/process"); toast.success(`Queue verarbeitet: ${data.sent}/${data.processed} gesendet`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const retryJob = async (id) => {
    try { await api.post(`/settings/mail-queue/${id}/retry`); toast.success("Job neu eingereiht."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const deleteJob = async (id) => {
    if (!window.confirm("Mail-Job wirklich löschen?")) return;
    try { await api.delete(`/settings/mail-queue/${id}`); toast.success("Job gelöscht."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const emailNotConfigured = !email.resend_api_key_masked;
  const discordNotConfigured = !discord.configured && !discord.webhook_url_masked;

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Einstellungen</h1>

      <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
        {[["email", "Resend", Mail], ["smtp", "SMTP", Server], ["queue", "Mail-Queue", Inbox], ["discord", "Discord", MessageSquare], ["brand", "Branding", Palette], ["legal", "Rechtliches", FileText], ["system", "Status", Activity], ["logs", "Versandlogs", Send]].map(([k, l, Icn]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`settings-tab-${k}`}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 whitespace-nowrap ${tab === k ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}>
            <Icn className="w-3.5 h-3.5" />{l}
          </button>
        ))}
      </div>

      {tab === "email" && (
        <div className="max-w-2xl space-y-4">
          {emailNotConfigured && (
            <div data-testid="email-not-configured" className="flex items-start gap-3 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-4">
              <AlertTriangle className="w-5 h-5 text-[#FFD700] shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-bold text-[#FFD700] uppercase tracking-wider text-xs">Kein Resend API Key hinterlegt</div>
                <p className="text-white/70 mt-1">Alle E-Mails (Anmeldungen, Passwort-Reset, Check-in-Reminder, Match-Nachrichten) werden aktuell übersprungen. Hole dir einen kostenlosen Key auf <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">resend.com/api-keys</a> und trage ihn unten ein.</p>
              </div>
            </div>
          )}
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-heading font-bold uppercase">Resend API</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={email.enabled} onChange={(e) => setEmail({ ...email, enabled: e.target.checked })} className="accent-[#29B6E8]" data-testid="email-enabled" />
                <span>Versand aktiv</span>
              </label>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">API Key {email.resend_api_key_masked && <span className="text-white/40 normal-case">(aktuell: {email.resend_api_key_masked})</span>}</div>
              <input type="password" placeholder="re_..." value={email.resend_api_key} onChange={(e) => setEmail({ ...email, resend_api_key: e.target.value })} data-testid="email-api-key" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
              <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Key beizubehalten.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
                <input value={email.sender_name || ""} onChange={(e) => setEmail({ ...email, sender_name: e.target.value })} data-testid="email-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender-E-Mail</div>
                <input value={email.sender_email || ""} onChange={(e) => setEmail({ ...email, sender_email: e.target.value })} data-testid="email-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@lionsquad.at" />
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Antworten an</div>
              <input type="email" value={email.reply_to_email || ""} onChange={(e) => setEmail({ ...email, reply_to_email: e.target.value })} data-testid="email-reply-to" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="office@lionsquad.at" />
              <p className="text-xs text-white/40 mt-1">Reply-To fuer Rueckfragen. Leer = sichtbare Absender-E-Mail.</p>
            </div>
            <button onClick={saveEmail} data-testid="email-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="font-heading font-bold uppercase">Testmail senden</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="email" placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} data-testid="email-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <button onClick={sendTest} data-testid="email-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
            </div>
          </div>
        </div>
      )}

      {tab === "smtp" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-heading font-bold uppercase">Eigener SMTP-Server</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={smtp.enabled} onChange={(e) => setSmtp({ ...smtp, enabled: e.target.checked })} className="accent-[#29B6E8]" data-testid="smtp-enabled" />
                <span>Versand aktiv</span>
              </label>
            </div>
            <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-xs text-white/65">
              <div className="font-bold uppercase tracking-widest text-[#29B6E8] mb-2">Einfacher Versand ohne Relay</div>
              <p>Wie beim OmniFM-Server: Host/IP, Port, User, Passwort, Absender. TLS steht auf Auto: 465 = SSL/TLS, 25 = ohne TLS, alles andere = STARTTLS. Die lokale IP als Host ist okay.</p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={applySubmissionPreset} data-testid="smtp-preset-submission" className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm">
                  Standard Auto Login
                </button>
                <button type="button" onClick={applyLocalIpPreset} data-testid="smtp-preset-local-ip" className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm">
                  Lokale IP vorbereiten
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Provider</div>
              <select value={smtp.provider} onChange={(e) => setSmtp({ ...smtp, provider: e.target.value })} data-testid="smtp-provider" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                <option value="smtp">SMTP (eigener Server)</option>
                <option value="resend">Resend (API)</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">SMTP Host</div>
                <input value={smtp.smtp_host || ""} onChange={(e) => setSmtp({ ...smtp, smtp_host: e.target.value })} data-testid="smtp-host" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="mail.example.com" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Port</div>
                <input type="number" value={smtp.smtp_port || 587} onChange={(e) => setSmtp({ ...smtp, smtp_port: parseInt(e.target.value, 10) })} data-testid="smtp-port" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">SMTP Anmeldung</div>
                <select value={smtp.smtp_auth || "login"} onChange={(e) => setSmtp({ ...smtp, smtp_auth: e.target.value })} data-testid="smtp-auth" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                  <option value="login">Mit Benutzer/Passwort (empfohlen)</option>
                  <option value="auto">Automatisch (Altbestand)</option>
                  <option value="none">Ohne Anmeldung (lokaler Relay)</option>
                </select>
                <p className="mt-1 text-[11px] text-white/40">Fuer normalen Versand: Benutzer/Passwort auf Port 587.</p>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">User</div>
                <input value={smtp.smtp_user || ""} onChange={(e) => setSmtp({ ...smtp, smtp_user: e.target.value })} data-testid="smtp-user" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Passwort {smtp.smtp_pass_masked && <span className="text-white/40 normal-case">(aktuell: {smtp.smtp_pass_masked})</span>}</div>
                <input type="password" value={smtp.smtp_pass || ""} onChange={(e) => setSmtp({ ...smtp, smtp_pass: e.target.value })} data-testid="smtp-pass" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="••••••" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Sicherheit</div>
                <select value={smtp.smtp_security || "auto"} onChange={(e) => setSmtp({ ...smtp, smtp_security: e.target.value })} data-testid="smtp-security" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                  <option value="auto">Auto nach Port</option>
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">SSL/TLS (465)</option>
                  <option value="none">Keine (25)</option>
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">TLS Zertifikat</div>
                <label className="h-[38px] flex items-center gap-2 bg-[#0A0A0A] border border-white/10 px-3 rounded-sm text-sm">
                  <input type="checkbox" checked={smtp.smtp_tls_verify !== false} onChange={(e) => setSmtp({ ...smtp, smtp_tls_verify: e.target.checked })} data-testid="smtp-tls-verify" className="accent-[#29B6E8]" />
                  <span>Pruefen</span>
                </label>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
                <input value={smtp.sender_name || ""} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} data-testid="smtp-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender E-Mail</div>
                <input type="email" value={smtp.sender_email || ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} data-testid="smtp-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@lionsquad.at" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Technischer SMTP-Absender</div>
                <input
                  type="email"
                  value={smtp.smtp_envelope_from || ""}
                  onChange={(e) => setSmtp({ ...smtp, smtp_envelope_from: e.target.value })}
                  data-testid="smtp-envelope-from"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
                  placeholder="office@lionsquad.at"
                />
                <p className="mt-1 text-[11px] text-white/40">MAIL FROM / Return-Path. Leer = SMTP User.</p>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Antworten an</div>
                <input
                  type="email"
                  value={smtp.reply_to_email || ""}
                  onChange={(e) => setSmtp({ ...smtp, reply_to_email: e.target.value })}
                  data-testid="smtp-reply-to"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
                  placeholder="office@lionsquad.at"
                />
                <p className="mt-1 text-[11px] text-white/40">Reply-To fuer Rueckfragen.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Message-ID Domain</div>
                <input
                  value={smtp.message_id_domain || ""}
                  onChange={(e) => setSmtp({ ...smtp, message_id_domain: e.target.value })}
                  data-testid="smtp-message-id-domain"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
                  placeholder="lionsquad.at"
                />
                <p className="mt-1 text-[11px] text-white/40">Optional. Leer = Domain der Absender-E-Mail. Das ist nicht der SMTP Host.</p>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">HELO/EHLO Name</div>
                <input
                  value={smtp.smtp_helo_name || ""}
                  onChange={(e) => setSmtp({ ...smtp, smtp_helo_name: e.target.value })}
                  data-testid="smtp-helo-name"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"
                  placeholder="lionsquad.at"
                />
                <p className="mt-1 text-[11px] text-white/40">Optional. Leer lassen ist erlaubt; dann nutzt die SMTP-Bibliothek ihren Standardnamen.</p>
              </div>
              <div className="text-xs text-white/45 flex items-end pb-1">
                Hinweis: Diese Domain-Felder sind Mail-Identitaet, nicht Verbindung. Der SMTP Host darf weiterhin nur die IP sein.
              </div>
            </div>
            <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-xs text-white/60">
              <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-2">DNS Checkliste gegen Spam</div>
              <p>Gmail bewertet die oeffentliche Ausgangs-IP deines Mailservers. Wichtig sind SPF, DKIM, DMARC, PTR/rDNS und die Mailserver-Logs. Der SMTP Host in dieser App darf trotzdem eine lokale IP sein.</p>
            </div>
            <button onClick={saveSmtp} data-testid="smtp-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="font-heading font-bold uppercase">SMTP Testmail</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="email" placeholder="test@example.com" value={smtpTestEmail} onChange={(e) => setSmtpTestEmail(e.target.value)} data-testid="smtp-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <button onClick={diagnoseSmtp} data-testid="smtp-diagnose" className="px-4 py-2 border border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Diagnose</button>
              <button onClick={checkDeliverability} data-testid="smtp-deliverability" className="px-4 py-2 border border-[#00FF88] text-[#00FF88] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" /> Zustellbarkeit</button>
              <button onClick={sendSmtpTest} data-testid="smtp-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
            </div>
            {smtpDiag && (
              <div data-testid="smtp-diagnose-result" className={`border rounded-sm p-4 text-xs space-y-3 ${smtpDiag.ok ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FF3B30]/25 bg-[#FF3B30]/5"}`}>
                <div className="flex items-center gap-2 font-bold uppercase tracking-widest">
                  {smtpDiag.ok ? <CheckCircle2 className="w-4 h-4 text-[#00FF88]" /> : <XCircle className="w-4 h-4 text-[#FF3B30]" />}
                  SMTP Diagnose: {smtpDiag.ok ? "OK" : "Problem gefunden"}
                </div>
                <div className="grid sm:grid-cols-2 gap-2 text-white/55">
                  <div>Host: <span className="font-mono text-white/75">{smtpDiag.host || "-"}</span></div>
                  <div>Port: <span className="font-mono text-white/75">{smtpDiag.port || "-"}</span></div>
                  <div>Security: <span className="font-mono text-white/75">{smtpDiag.security || "-"}</span></div>
                  <div>AUTH: <span className="font-mono text-white/75">{smtpDiag.auth_supported ? "angeboten" : "nicht angeboten"}</span></div>
                </div>
                <div className="space-y-1">
                  {(smtpDiag.steps || []).map((s, i) => (
                    <div key={i} className="flex gap-2 text-white/70">
                      <span className={s.ok ? "text-[#00FF88]" : "text-[#FF3B30]"}>{s.ok ? "OK" : "NO"}</span>
                      <span className="break-words">{s.label}</span>
                    </div>
                  ))}
                </div>
                {(smtpDiag.port_checks || []).length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <div className="font-bold uppercase tracking-widest text-white/55 mb-2">Port-Check</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(smtpDiag.port_checks || []).map((c, i) => (
                        <div key={`${c.port}-${c.security}-${i}`} className="border border-white/10 bg-black/20 rounded-sm p-2 text-white/65">
                          <div className="font-mono text-white/80">{c.port} / {String(c.security || "").toUpperCase()}</div>
                          <div>Verbindung: {c.connect_ok ? "OK" : "NO"}</div>
                          <div>AUTH: {c.auth_supported ? "ja" : "nein"}</div>
                          {c.error && <div className="text-[#FF3B30] break-words">{c.error}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(smtpDiag.recommendations || []).length > 0 && (
                  <div className="border-t border-white/10 pt-3 space-y-1 text-white/70">
                    {(smtpDiag.recommendations || []).map((r, i) => <div key={i}>{r}</div>)}
                  </div>
                )}
              </div>
            )}
            {smtpDeliverability && (
              <div data-testid="smtp-deliverability-result" className={`border rounded-sm p-4 text-xs space-y-3 ${smtpDeliverability.ok ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FFD700]/25 bg-[#FFD700]/5"}`}>
                <div className="flex items-center gap-2 font-bold uppercase tracking-widest">
                  {smtpDeliverability.ok ? <CheckCircle2 className="w-4 h-4 text-[#00FF88]" /> : <AlertTriangle className="w-4 h-4 text-[#FFD700]" />}
                  Gmail Zustellbarkeit: {smtpDeliverability.ok ? "Basis OK" : "Pruefen"}
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-white/55">
                  <div>From: <span className="font-mono text-white/75">{smtpDeliverability.from_domain || "-"}</span></div>
                  <div>Envelope: <span className="font-mono text-white/75">{smtpDeliverability.envelope_domain || "-"}</span></div>
                  <div>Message-ID: <span className="font-mono text-white/75">{smtpDeliverability.message_id_domain || "-"}</span></div>
                </div>
                <div className="space-y-1">
                  {(smtpDeliverability.checks || []).map((c, i) => (
                    <div key={i} className="flex gap-2 text-white/70">
                      <span className={c.ok ? "text-[#00FF88]" : c.severity === "error" ? "text-[#FF3B30]" : "text-[#FFD700]"}>{c.ok ? "OK" : c.severity === "error" ? "NO" : "INFO"}</span>
                      <span className="break-words"><strong>{c.label}:</strong> {c.detail}</span>
                    </div>
                  ))}
                </div>
                {(smtpDeliverability.recommendations || []).length > 0 && (
                  <div className="border-t border-white/10 pt-3 space-y-1 text-white/70">
                    {(smtpDeliverability.recommendations || []).map((r, i) => <div key={i}>{r}</div>)}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-white/50">Testet die SMTP-Verbindung direkt. Auto-TLS verhaelt sich wie beim OmniFM-Bot: Port 465 SSL/TLS, Port 25 plain, sonst STARTTLS.</p>
            <p className="text-xs text-white/50">Bei self-signed Zertifikat kann "TLS Zertifikat pruefen" deaktiviert werden; besser ist ein vertrauenswuerdiges Zertifikat am Mailserver.</p>
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={processQueueNow} data-testid="queue-process-now" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Jetzt verarbeiten</button>
            <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)} data-testid="queue-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">Alle</option>
              <option value="pending">pending</option>
              <option value="sending">sending</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
              <option value="skipped">skipped</option>
            </select>
            <span className="text-xs text-white/50">{queue.length} Jobs · Worker läuft alle 30s automatisch</span>
          </div>
          <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                  <tr>
                    <th className="text-left px-4 py-3">Erstellt</th>
                    <th className="text-left px-4 py-3">An</th>
                    <th className="text-left px-4 py-3">Template</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Versuche</th>
                    <th className="text-left px-4 py-3">Nächster</th>
                    <th className="text-left px-4 py-3">Fehler</th>
                    <th className="text-right px-4 py-3">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {queue.filter((j) => !queueFilter || j.status === queueFilter).map((j) => (
                    <tr key={j.id} data-testid={`queue-row-${j.id}`}>
                      <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{new Date(j.created_at).toLocaleString("de-DE")}</td>
                      <td className="px-4 py-3">{j.to}</td>
                      <td className="px-4 py-3 text-[#29B6E8] text-xs">{j.template_key}</td>
                      <td className="px-4 py-3">
                        {j.status === "sent" && <span className="text-[#00FF88] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> sent</span>}
                        {j.status === "failed" && <span className="text-[#FF3B30] inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> failed</span>}
                        {j.status === "pending" && <span className="text-[#FFD700]">pending</span>}
                        {j.status === "sending" && <span className="text-[#29B6E8]">sending</span>}
                        {j.status === "skipped" && <span className="text-white/50">skipped</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">{j.attempts}</td>
                      <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{j.next_attempt_at ? new Date(j.next_attempt_at).toLocaleString("de-DE") : "—"}</td>
                      <td className="px-4 py-3 text-white/40 text-xs truncate max-w-xs">{j.last_error || "—"}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => retryJob(j.id)} data-testid={`queue-retry-${j.id}`} className="text-[#29B6E8] hover:underline mr-3 text-xs"><RefreshCw className="w-3 h-3 inline mr-1" />Retry</button>
                        <button onClick={() => deleteJob(j.id)} data-testid={`queue-delete-${j.id}`} className="text-[#FF3B30] hover:underline text-xs"><Trash2 className="w-3 h-3 inline mr-1" />Löschen</button>
                      </td>
                    </tr>
                  ))}
                  {queue.length === 0 && <tr><td colSpan="8" className="text-center py-10 text-white/40">Mail-Queue ist leer.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "discord" && (
        <div className="max-w-2xl space-y-4">
          {discordNotConfigured && (
            <div className="flex items-start gap-3 border border-[#5865F2]/30 bg-[#5865F2]/10 rounded-sm p-4">
              <MessageSquare className="w-5 h-5 text-[#5865F2] shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-bold text-[#5865F2] uppercase tracking-wider text-xs">Kein Webhook konfiguriert</div>
                <p className="text-white/70 mt-1">Erstelle in deinem Discord-Server einen Webhook (Server-Einstellungen → Integrationen → Webhooks → Neuer Webhook), kopiere die URL und füge sie unten ein. Damit werden Turniere, Matches und F1-Ergebnisse automatisch im Channel gepostet.</p>
              </div>
            </div>
          )}
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-heading font-bold uppercase">Discord Webhook</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={discord.enabled} onChange={(e) => setDiscord({ ...discord, enabled: e.target.checked })} className="accent-[#29B6E8]" data-testid="discord-enabled" />
                <span>Versand aktiv</span>
              </label>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Webhook URL {discord.webhook_url_masked && <span className="text-white/40 normal-case">(aktuell: {discord.webhook_url_masked})</span>}</div>
              <input type="password" placeholder="https://discord.com/api/webhooks/…" value={discord.webhook_url} onChange={(e) => setDiscord({ ...discord, webhook_url: e.target.value })} data-testid="discord-webhook" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
              <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Webhook beizubehalten. Erlaubt sind https://discord.com/api/webhooks/... URLs.</p>
            </div>
            {discord.last_status && (
              <div className={`border rounded-sm p-3 text-xs ${discord.last_status === "sent" ? "border-[#00FF88]/25 bg-[#00FF88]/5 text-white/60" : "border-[#FF3B30]/25 bg-[#FF3B30]/5 text-white/60"}`}>
                <div className="font-bold uppercase tracking-widest mb-1">Letzter Discord Status: {discord.last_status}</div>
                <div>{discord.last_checked_at ? new Date(discord.last_checked_at).toLocaleString("de-DE") : ""}{discord.last_event_key ? ` - ${discord.last_event_key}` : ""}</div>
                {discord.last_error && <div className="mt-1 text-[#FF3B30] break-words">{discord.last_error}</div>}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bot-Name</div>
                <input value={discord.username || ""} onChange={(e) => setDiscord({ ...discord, username: e.target.value })} data-testid="discord-username" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
              </div>
              <ImageUpload value={discord.avatar_url || ""} onChange={(v) => setDiscord({ ...discord, avatar_url: v })} label="Avatar" testId="discord-avatar" variant="square" allowLibrary />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={saveDiscord} data-testid="discord-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
              <button onClick={sendDiscordTest} data-testid="discord-test" className="px-4 py-2 border border-[#5865F2] text-[#5865F2] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Test senden</button>
              {discord.configured && <button onClick={clearDiscordWebhook} data-testid="discord-clear" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm">Webhook entfernen</button>}
            </div>
          </div>
        </div>
      )}

      {tab === "brand" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <BrandField label="Vereinsname" value={brand.club_name} onChange={(v) => setBrand({ ...brand, club_name: v })} testId="brand-club-name" />
            <BrandField label="Tagline" value={brand.tagline} onChange={(v) => setBrand({ ...brand, tagline: v })} testId="brand-tagline" />
            <BrandField label="SEO Beschreibung" value={brand.site_description} onChange={(v) => setBrand({ ...brand, site_description: v })} testId="brand-site-description" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Akzentfarbe (HEX)" value={brand.primary_color} onChange={(v) => setBrand({ ...brand, primary_color: v })} testId="brand-color" />
              <BrandField label="Domain" value={brand.domain} onChange={(v) => setBrand({ ...brand, domain: v })} testId="brand-domain" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Zeitzone" value={brand.timezone} onChange={(v) => setBrand({ ...brand, timezone: v })} testId="brand-tz" />
              <BrandField label="Kontakt E-Mail" value={brand.contact_email} onChange={(v) => setBrand({ ...brand, contact_email: v })} testId="brand-contact-email" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Discord Einladung" value={brand.discord_invite_url} onChange={(v) => setBrand({ ...brand, discord_invite_url: v })} testId="brand-discord-invite" />
              <BrandField label="Twitch Channel" value={brand.twitch_channel} onChange={(v) => setBrand({ ...brand, twitch_channel: v })} testId="brand-twitch-channel" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ImageUpload value={brand.logo_url} onChange={(v) => setBrand({ ...brand, logo_url: v })} label="Vereinslogo" testId="brand-logo" variant="square" allowLibrary />
              <ImageUpload value={brand.mascot_url} onChange={(v) => setBrand({ ...brand, mascot_url: v })} label="Maskottchen" testId="brand-mascot" variant="square" allowLibrary />
              <ImageUpload value={brand.favicon_url} onChange={(v) => setBrand({ ...brand, favicon_url: v })} label="Favicon / Browser Icon" testId="brand-favicon" variant="square" allowLibrary />
            </div>
            <p className="text-xs text-white/45">Impressum, Datenschutz und Vereinsdaten liegen im Tab Rechtliches.</p>
            <button onClick={saveBrand} data-testid="brand-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>
        </div>
      )}

      {tab === "legal" && (
        <div className="max-w-4xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
            <div>
              <div className="font-heading font-bold uppercase">Vereinsdaten fuer Impressum und Datenschutz</div>
              <p className="text-xs text-white/50 mt-1">Diese Angaben werden dynamisch auf /imprint und /privacy ausgegeben. ZVR, Adresse und vertretungsbefugte Person bitte mit den echten Vereinsdaten eintragen.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Rechtlicher Vereinsname" value={brand.legal_name} onChange={(v) => setBrand({ ...brand, legal_name: v })} testId="legal-name" />
              <BrandField label="ZVR-Zahl" value={brand.zvr_number} onChange={(v) => setBrand({ ...brand, zvr_number: v })} testId="legal-zvr" />
              <BrandField label="Rechtsform" value={brand.legal_form} onChange={(v) => setBrand({ ...brand, legal_form: v })} testId="legal-form" />
              <BrandField label="Vereinssitz" value={brand.registered_seat} onChange={(v) => setBrand({ ...brand, registered_seat: v })} testId="legal-seat" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Strasse und Hausnummer" value={brand.street_address} onChange={(v) => setBrand({ ...brand, street_address: v })} testId="legal-street" />
              <BrandField label="Adresszusatz" value={brand.address_extra} onChange={(v) => setBrand({ ...brand, address_extra: v })} testId="legal-address-extra" />
              <BrandField label="PLZ" value={brand.postal_code} onChange={(v) => setBrand({ ...brand, postal_code: v })} testId="legal-postal" />
              <BrandField label="Ort" value={brand.city} onChange={(v) => setBrand({ ...brand, city: v })} testId="legal-city" />
              <BrandField label="Bundesland" value={brand.state} onChange={(v) => setBrand({ ...brand, state: v })} testId="legal-state" />
              <BrandField label="Land" value={brand.country} onChange={(v) => setBrand({ ...brand, country: v })} testId="legal-country" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Vereinsbehoerde" value={brand.register_authority} onChange={(v) => setBrand({ ...brand, register_authority: v })} testId="legal-authority" />
              <BrandField label="Telefon" value={brand.phone} onChange={(v) => setBrand({ ...brand, phone: v })} testId="legal-phone" />
              <BrandField label="Vertretungsbefugte Person" value={brand.representative_name} onChange={(v) => setBrand({ ...brand, representative_name: v })} testId="legal-representative" />
              <BrandField label="Funktion" value={brand.representative_role} onChange={(v) => setBrand({ ...brand, representative_role: v })} testId="legal-role" />
              <BrandField label="Inhaltlich verantwortlich" value={brand.content_responsible} onChange={(v) => setBrand({ ...brand, content_responsible: v })} testId="legal-content-responsible" />
              <BrandField label="Datenschutz E-Mail" value={brand.privacy_contact_email} onChange={(v) => setBrand({ ...brand, privacy_contact_email: v })} testId="legal-privacy-email" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Hosting / Betreiber" value={brand.hosting_provider} onChange={(v) => setBrand({ ...brand, hosting_provider: v })} testId="legal-hosting" />
              <BrandField label="Hosting-Region" value={brand.hosting_country} onChange={(v) => setBrand({ ...brand, hosting_country: v })} testId="legal-hosting-country" />
              <BrandField label="UID-Nummer falls vorhanden" value={brand.vat_number} onChange={(v) => setBrand({ ...brand, vat_number: v })} testId="legal-vat" />
              <BrandField label="Turnierbedingungen URL" value={brand.tournament_terms_url} onChange={(v) => setBrand({ ...brand, tournament_terms_url: v })} testId="legal-terms-url" />
            </div>
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={!!brand.paid_tournaments_enabled} onChange={(e) => setBrand({ ...brand, paid_tournaments_enabled: e.target.checked })} data-testid="legal-paid-tournaments" className="accent-[#29B6E8] mt-1" />
              <span>Preisturniere oder Turniere mit Startgeld koennen stattfinden.</span>
            </label>
            <LegalTextArea label="Freitext Impressum" value={brand.imprint} onChange={(v) => setBrand({ ...brand, imprint: v })} testId="brand-imprint" rows={4} />
            <LegalTextArea label="Zusaetzliche rechtliche Hinweise" value={brand.legal_extra} onChange={(v) => setBrand({ ...brand, legal_extra: v })} testId="legal-extra" rows={4} />
            <LegalTextArea label="Freitext Datenschutz" value={brand.privacy_policy} onChange={(v) => setBrand({ ...brand, privacy_policy: v })} testId="brand-privacy" rows={5} />
            <LegalTextArea label="Zusaetzliche Datenschutzhinweise" value={brand.privacy_extra} onChange={(v) => setBrand({ ...brand, privacy_extra: v })} testId="privacy-extra" rows={5} />
            <button onClick={saveBrand} data-testid="legal-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Rechtliches speichern</button>
          </div>
        </div>
      )}

      {tab === "system" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={load} data-testid="system-refresh" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Aktualisieren</button>
            <span className="text-xs text-white/50">Live-Status fuer Versand, Uploads, Scheduler und Queue.</span>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            <SystemCard title="Datenbank" ok={systemStatus?.database?.ok} detail={systemStatus?.database?.error || "MongoDB Ping"} />
            <SystemCard title="SMTP / Mail" ok={systemStatus?.smtp?.ok} detail={`${systemStatus?.smtp?.provider || "-"} ${systemStatus?.smtp?.host || ""}`} problem={systemStatus?.smtp?.latest_problem?.error} />
            <SystemCard title="Discord" ok={systemStatus?.discord?.ok} detail={systemStatus?.discord?.configured ? "Webhook konfiguriert" : "Kein Webhook"} problem={systemStatus?.discord?.latest?.error} />
            <SystemCard title="Uploads" ok={systemStatus?.uploads?.ok} detail={(systemStatus?.uploads?.checks || []).map((c) => `${c.label}: ${c.exists && c.writable ? "OK" : "NO"}`).join(" · ")} />
            <SystemCard title="Scheduler" ok={systemStatus?.scheduler?.running} detail={(systemStatus?.scheduler?.jobs || []).map((j) => `${j.id}: ${j.next_run_time ? new Date(j.next_run_time).toLocaleString("de-DE") : "-"}`).join(" · ")} />
            <SystemCard title="Mail-Queue" ok={(systemStatus?.mail_queue?.failed || 0) === 0} detail={systemStatus?.mail_queue ? `pending ${systemStatus.mail_queue.pending || 0} · failed ${systemStatus.mail_queue.failed || 0} · sent ${systemStatus.mail_queue.sent || 0}` : "-"} />
          </div>
          {systemStatus?.uploads?.checks?.length > 0 && (
            <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
              <div className="font-heading font-bold uppercase mb-3">Upload-Pfade</div>
              <div className="space-y-2 text-xs">
                {systemStatus.uploads.checks.map((c) => (
                  <div key={c.label} className="grid md:grid-cols-[120px_1fr_120px] gap-2 border-b border-white/5 pb-2">
                    <span className="text-white/70">{c.label}</span>
                    <span className="font-mono text-white/50 break-all">{c.path}</span>
                    <span className={c.exists && c.writable ? "text-[#00FF88]" : "text-[#FF3B30]"}>{c.exists && c.writable ? "beschreibbar" : "pruefen"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr><th className="text-left px-4 py-3">Zeit</th><th className="text-left px-4 py-3">An</th><th className="text-left px-4 py-3">Template</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Details</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString("de-DE")}</td>
                    <td className="px-4 py-3">{l.to || l.channel || "—"}</td>
                    <td className="px-4 py-3 text-[#29B6E8] text-xs">{l.template_key || l.event_key || "—"}</td>
                    <td className="px-4 py-3">
                      {l.status === "sent" ? <span className="text-[#00FF88] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> sent</span>
                        : l.status === "failed" ? <span className="text-[#FF3B30] inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> failed</span>
                          : <span className="text-white/50">{l.status}</span>}
                    </td>
                    <td className="px-4 py-3 text-white/40 text-xs truncate max-w-xs">{l.error || l.message_id || "—"}</td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Nachrichten gesendet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function BrandField({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function LegalTextArea({ label, value, onChange, testId, rows = 4 }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={rows} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function SystemCard({ title, ok, detail, problem }) {
  const ready = !!ok;
  return (
    <div className={`border rounded-sm bg-[#121212] p-5 ${ready ? "border-[#00FF88]/25" : "border-[#FFD700]/30"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-heading font-bold uppercase">{title}</div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${ready ? "text-[#00FF88]" : "text-[#FFD700]"}`}>
          {ready ? "OK" : "Pruefen"}
        </span>
      </div>
      <div className="mt-3 text-xs text-white/55 break-words">{detail || "-"}</div>
      {problem && <div className="mt-2 text-xs text-[#FF3B30] break-words">{problem}</div>}
    </div>
  );
}
