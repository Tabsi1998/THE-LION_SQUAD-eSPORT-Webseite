import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { toast } from "sonner";
import { Mail, Palette, Send, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Server, Inbox, RefreshCw, Trash2 } from "lucide-react";

export default function AdminSettingsPage() {
  const [tab, setTab] = useState("email");
  const [email, setEmail] = useState({ resend_api_key: "", sender_name: "", sender_email: "", enabled: true, resend_api_key_masked: "" });
  const [smtp, setSmtp] = useState({ provider: "resend", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_security: "starttls", sender_name: "", sender_email: "", enabled: true, smtp_pass_masked: "" });
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [queue, setQueue] = useState([]);
  const [queueFilter, setQueueFilter] = useState("");
  const [brand, setBrand] = useState({ club_name: "", tagline: "", primary_color: "#29B6E8", logo_url: "", mascot_url: "", domain: "", timezone: "Europe/Vienna", imprint: "", privacy_policy: "" });
  const [discord, setDiscord] = useState({ webhook_url: "", username: "", avatar_url: "", enabled: true, webhook_url_masked: "" });
  const [testEmail, setTestEmail] = useState("");
  const [logs, setLogs] = useState([]);

  const load = async () => {
    const [e, b, d, l, sm, q] = await Promise.all([
      api.get("/settings/email"),
      api.get("/settings/branding"),
      api.get("/settings/discord"),
      api.get("/settings/email/logs"),
      api.get("/settings/smtp"),
      api.get("/settings/mail-queue?limit=100"),
    ]);
    setEmail((prev) => ({ ...prev, ...e.data, resend_api_key: "" }));
    setBrand((prev) => ({ ...prev, ...b.data }));
    setDiscord((prev) => ({ ...prev, ...d.data, webhook_url: "" }));
    setLogs(l.data);
    setSmtp((prev) => ({ ...prev, ...sm.data, smtp_pass: "" }));
    setQueue(q.data);
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
      if (data.ok) toast.success("Discord-Test gesendet.");
      else toast.error(`Fehler: ${data.reason || "unbekannt"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const saveSmtp = async () => {
    const payload = { ...smtp };
    if (!payload.smtp_pass) delete payload.smtp_pass;
    try { await api.put("/settings/smtp", payload); toast.success("SMTP-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendSmtpTest = async () => {
    if (!smtpTestEmail) return toast.error("E-Mail-Adresse eingeben");
    try {
      const { data } = await api.post("/settings/smtp/test", { to: smtpTestEmail });
      if (data.ok) toast.success(`SMTP-Testmail gesendet (ID: ${data.id || "—"})`);
      else toast.error(`Fehler: ${data.reason}`);
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
  const discordNotConfigured = !discord.webhook_url_masked;

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Einstellungen</h1>

      <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
        {[["email", "Resend", Mail], ["smtp", "SMTP", Server], ["queue", "Mail-Queue", Inbox], ["discord", "Discord", MessageSquare], ["brand", "Branding", Palette], ["logs", "Versandlogs", Send]].map(([k, l, Icn]) => (
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
                <input value={email.sender_name || ""} onChange={(e) => setEmail({ ...email, sender_name: e.target.value })} data-testid="email-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="TLS ARENA" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender-E-Mail</div>
                <input value={email.sender_email || ""} onChange={(e) => setEmail({ ...email, sender_email: e.target.value })} data-testid="email-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@thelionsquad.at" />
              </div>
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
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">User</div>
                <input value={smtp.smtp_user || ""} onChange={(e) => setSmtp({ ...smtp, smtp_user: e.target.value })} data-testid="smtp-user" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Passwort {smtp.smtp_pass_masked && <span className="text-white/40 normal-case">(aktuell: {smtp.smtp_pass_masked})</span>}</div>
                <input type="password" value={smtp.smtp_pass || ""} onChange={(e) => setSmtp({ ...smtp, smtp_pass: e.target.value })} data-testid="smtp-pass" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="••••••" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Sicherheit</div>
                <select value={smtp.smtp_security || "starttls"} onChange={(e) => setSmtp({ ...smtp, smtp_security: e.target.value })} data-testid="smtp-security" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">SSL/TLS (465)</option>
                  <option value="none">Keine (25)</option>
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
                <input value={smtp.sender_name || ""} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} data-testid="smtp-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender E-Mail</div>
                <input type="email" value={smtp.sender_email || ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} data-testid="smtp-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@thelionsquad.at" />
              </div>
            </div>
            <button onClick={saveSmtp} data-testid="smtp-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="font-heading font-bold uppercase">SMTP Testmail</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="email" placeholder="test@example.com" value={smtpTestEmail} onChange={(e) => setSmtpTestEmail(e.target.value)} data-testid="smtp-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <button onClick={sendSmtpTest} data-testid="smtp-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
            </div>
            <p className="text-xs text-white/50">Testet die SMTP-Verbindung direkt — ohne Queue. Provider muss auf SMTP gesetzt sein.</p>
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
              <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Webhook beizubehalten.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Bot-Name</div>
                <input value={discord.username || ""} onChange={(e) => setDiscord({ ...discord, username: e.target.value })} data-testid="discord-username" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="TLS ARENA" />
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Avatar URL</div>
                <input value={discord.avatar_url || ""} onChange={(e) => setDiscord({ ...discord, avatar_url: e.target.value })} data-testid="discord-avatar" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={saveDiscord} data-testid="discord-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
              <button onClick={sendDiscordTest} data-testid="discord-test" className="px-4 py-2 border border-[#5865F2] text-[#5865F2] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Test senden</button>
            </div>
          </div>
        </div>
      )}

      {tab === "brand" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <BrandField label="Vereinsname" value={brand.club_name} onChange={(v) => setBrand({ ...brand, club_name: v })} testId="brand-club-name" />
            <BrandField label="Tagline" value={brand.tagline} onChange={(v) => setBrand({ ...brand, tagline: v })} testId="brand-tagline" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Akzentfarbe (HEX)" value={brand.primary_color} onChange={(v) => setBrand({ ...brand, primary_color: v })} testId="brand-color" />
              <BrandField label="Domain" value={brand.domain} onChange={(v) => setBrand({ ...brand, domain: v })} testId="brand-domain" />
            </div>
            <BrandField label="Zeitzone" value={brand.timezone} onChange={(v) => setBrand({ ...brand, timezone: v })} testId="brand-tz" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ImageUpload value={brand.logo_url} onChange={(v) => setBrand({ ...brand, logo_url: v })} label="Vereinslogo" testId="brand-logo" variant="square" />
              <ImageUpload value={brand.mascot_url} onChange={(v) => setBrand({ ...brand, mascot_url: v })} label="Maskottchen" testId="brand-mascot" variant="square" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Impressum</div>
              <textarea value={brand.imprint || ""} onChange={(e) => setBrand({ ...brand, imprint: e.target.value })} rows={4} data-testid="brand-imprint" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Datenschutz-Text</div>
              <textarea value={brand.privacy_policy || ""} onChange={(e) => setBrand({ ...brand, privacy_policy: e.target.value })} rows={6} data-testid="brand-privacy" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </div>
            <button onClick={saveBrand} data-testid="brand-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>
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
