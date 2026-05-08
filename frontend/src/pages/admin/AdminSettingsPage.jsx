import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { setCachedBranding } from "@/lib/brandingEvents";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload, useImageUploadBusy } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Mail, Palette, Send, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Server, Inbox, RefreshCw, Trash2, FileText, Activity, Radio, Eye, Search } from "lucide-react";

const MAIL_TEMPLATE_LABELS = {
  user_invite: "Einladungsmail",
  registration: "Registrierung",
  password_reset: "Passwort zurücksetzen",
  registration_received: "Turnier-Anmeldung",
  registration_approved: "Anmeldung bestätigt",
  registration_rejected: "Anmeldung abgelehnt",
  checkin_reminder: "Check-in-Erinnerung",
  match_reminder: "Match-Erinnerung",
  score_reported: "Ergebnis gemeldet",
  dispute_opened: "Dispute eröffnet",
  dispute_resolved: "Dispute entschieden",
  tournament_finished: "Turnier beendet",
  membership_activated: "Mitgliedschaft aktiviert",
  membership_deactivated: "Mitgliedschaft deaktiviert",
  membership_blocked: "Mitgliedschaft gesperrt",
  newsletter_news: "Newsletter: News",
  newsletter_event: "Newsletter: Event",
  contact_autoreply: "Kontakt-Antwort",
  contact_admin_notify: "Kontaktmeldung",
  test: "Testmail",
};

const STATUS_LABELS = {
  pending: "wartet auf Versand",
  sending: "wird versendet",
  sent: "gesendet",
  failed: "fehlgeschlagen",
  skipped: "übersprungen",
};

function mailTemplateLabel(job) {
  return MAIL_TEMPLATE_LABELS[job?.template_key] || job?.template_key || "Mail";
}

export default function AdminSettingsPage() {
  const [tab, setTab] = useState("email");
  const [email, setEmail] = useState({ resend_api_key: "", sender_name: "", sender_email: "", reply_to_email: "", enabled: true, resend_api_key_masked: "" });
  const [smtp, setSmtp] = useState({ provider: "resend", smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_auth: "login", smtp_security: "auto", smtp_tls_verify: false, smtp_envelope_from: "", smtp_helo_name: "", sender_name: "", sender_email: "", reply_to_email: "", message_id_domain: "", enabled: true, smtp_pass_masked: "" });
  const [smtpTestEmail, setSmtpTestEmail] = useState("");
  const [smtpDiag, setSmtpDiag] = useState(null);
  const [smtpDeliverability, setSmtpDeliverability] = useState(null);
  const [queue, setQueue] = useState([]);
  const [queueStats, setQueueStats] = useState(null);
  const [queueFilter, setQueueFilter] = useState("");
  const [newsletterSources, setNewsletterSources] = useState({ news: [], events: [] });
  const [newsletter, setNewsletter] = useState({ kind: "news", id: "", force: false });
  const [newsletterPreview, setNewsletterPreview] = useState(null);
  const [loadingNewsletterPreview, setLoadingNewsletterPreview] = useState(false);
  const [sendingNewsletter, setSendingNewsletter] = useState(false);
  const [brand, setBrand] = useState({
    club_name: "", tagline: "", site_title: "THE LION SQUAD - eSPORTS", site_description: "", primary_color: "#29B6E8",
    logo_url: "", mascot_url: "", favicon_url: "", contact_email: "", domain: "", timezone: "Europe/Vienna",
    legal_name: "", legal_form: "eingetragener Verein nach österreichischem Vereinsrecht", zvr_number: "",
    street_address: "", address_extra: "", postal_code: "", city: "", state: "Tirol", country: "Oesterreich",
    registered_seat: "", register_authority: "", representative_name: "", representative_role: "",
    content_responsible: "", phone: "", privacy_contact_email: "", hosting_provider: "", hosting_country: "Oesterreich/EU",
    vat_number: "", tournament_terms_url: "", paid_tournaments_enabled: false,
    imprint: "", privacy_policy: "", legal_extra: "", privacy_extra: "",
    discord_invite_url: "", twitch_channel: "", twitch_client_id: "", twitch_client_secret: "",
    twitch_client_secret_masked: "", twitch_live_detection: true,
  });
  const [discord, setDiscord] = useState({ webhook_url: "", username: "", avatar_url: "", enabled: true, configured: false, webhook_url_masked: "", last_status: "", last_error: "", last_event_key: "", last_checked_at: "" });
  const [discordCounters, setDiscordCounters] = useState([]);
  const [discordCounterQuery, setDiscordCounterQuery] = useState("");
  const [discordCounterValues, setDiscordCounterValues] = useState({});
  const [savingDiscordCounter, setSavingDiscordCounter] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [logs, setLogs] = useState([]);
  const [systemStatus, setSystemStatus] = useState(null);
  const [twitchStatus, setTwitchStatus] = useState(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingDiscord, setSavingDiscord] = useState(false);
  const [savingTwitch, setSavingTwitch] = useState(false);
  const [refreshingTwitch, setRefreshingTwitch] = useState(false);
  const imageUploadBusy = useImageUploadBusy();
  const brandDirtyRef = useRef(false);
  const discordDirtyRef = useRef(false);
  const loadSeqRef = useRef(0);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const requests = await Promise.allSettled([
      api.get("/settings/email"),
      api.get("/settings/branding"),
      api.get("/settings/discord"),
      api.get("/settings/email/logs"),
      api.get("/settings/smtp"),
      api.get("/settings/mail-queue?limit=100"),
      api.get("/settings/mail-queue/stats"),
      api.get("/admin/system-status"),
      api.get("/admin/streams/status"),
      api.get("/admin/discord/counters?limit=50"),
    ]);
    if (seq !== loadSeqRef.current) return;
    const value = (i) => requests[i].status === "fulfilled" ? requests[i].value.data : null;
    const e = value(0), b = value(1), d = value(2), l = value(3), sm = value(4), q = value(5), qs = value(6), st = value(7), tw = value(8), dc = value(9);
    if (e) setEmail((prev) => ({ ...prev, ...e, resend_api_key: "" }));
    if (b && !brandDirtyRef.current) setBrand((prev) => ({ ...prev, ...b }));
    if (d && !discordDirtyRef.current) setDiscord((prev) => ({ ...prev, ...d, webhook_url: "" }));
    if (l) setLogs(l);
    if (sm) setSmtp((prev) => ({ ...prev, ...sm, smtp_pass: "" }));
    if (q) setQueue(q);
    if (qs) setQueueStats(qs);
    if (st) setSystemStatus(st);
    if (tw) setTwitchStatus(tw);
    if (dc) setDiscordCounters(dc);
    if (requests.some((r) => r.status === "rejected")) {
      toast.error("Ein Teil der Einstellungen konnte nicht geladen werden. Die verfuegbaren Tabs bleiben nutzbar.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["settings", "users"]);

  const loadNewsletterSources = useCallback(async () => {
    const [newsRes, eventsRes] = await Promise.allSettled([
      api.get("/admin/news"),
      api.get("/events"),
    ]);
    const news = newsRes.status === "fulfilled" && Array.isArray(newsRes.value.data) ? newsRes.value.data : [];
    const events = eventsRes.status === "fulfilled" && Array.isArray(eventsRes.value.data) ? eventsRes.value.data : [];
    setNewsletterSources({ news, events });
    setNewsletter((prev) => {
      const options = prev.kind === "event" ? events : news;
      if (prev.id && options.some((item) => item.id === prev.id || item.slug === prev.id)) return prev;
      return { ...prev, id: options[0]?.id || "" };
    });
  }, []);

  useEffect(() => { loadNewsletterSources(); }, [loadNewsletterSources]);
  useApiInvalidation(loadNewsletterSources, ["news", "events"]);

  useEffect(() => {
    if (tab !== "queue" && tab !== "twitch") return undefined;
    load();
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, [tab, load]);

  const setBrandField = (key, value) => {
    brandDirtyRef.current = true;
    setBrand((prev) => ({ ...prev, [key]: value }));
  };

  const setDiscordField = (key, value) => {
    discordDirtyRef.current = true;
    setDiscord((prev) => ({ ...prev, [key]: value }));
  };

  const loadDiscordCounters = useCallback((query = discordCounterQuery) => {
    api.get(`/admin/discord/counters?q=${encodeURIComponent(query)}&limit=50`)
      .then(({ data }) => setDiscordCounters(Array.isArray(data) ? data : []))
      .catch(() => setDiscordCounters([]));
  }, [discordCounterQuery]);

  useEffect(() => {
    if (tab !== "discord") return undefined;
    const id = window.setTimeout(() => loadDiscordCounters(discordCounterQuery), 250);
    return () => window.clearTimeout(id);
  }, [tab, discordCounterQuery, loadDiscordCounters]);

  const refreshPublicBranding = async () => {
    try {
      const { data } = await api.get("/settings/public", { params: { _: Date.now() } });
      setCachedBranding(data || {});
    } catch {
      setCachedBranding(brand);
    }
  };

  const saveEmail = async () => {
    if (savingEmail) return;
    const payload = { ...email };
    if (!payload.resend_api_key) delete payload.resend_api_key;
    setSavingEmail(true);
    try { await api.put("/settings/email", payload); toast.success("E-Mail-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingEmail(false); }
  };
  const buildBrandPayload = (source = brand) => {
    const payload = { ...source };
    if (!payload.twitch_client_secret) delete payload.twitch_client_secret;
    delete payload.twitch_client_secret_masked;
    return payload;
  };
  const saveBrand = async () => {
    if (savingBrand) return;
    if (imageUploadBusy) return toast.error("Bild-Upload läuft noch. Bitte kurz warten und dann speichern.");
    setSavingBrand(true);
    try {
      loadSeqRef.current += 1;
      const { data } = await api.put("/settings/branding", buildBrandPayload());
      brandDirtyRef.current = false;
      if (data && !data.ok) setBrand((prev) => ({ ...prev, ...data }));
      await refreshPublicBranding();
      toast.success("Branding gespeichert.");
      load();
    }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingBrand(false); }
  };
  const saveTwitch = async () => {
    if (savingTwitch) return;
    setSavingTwitch(true);
    try {
      const payload = buildBrandPayload({
        twitch_channel: brand.twitch_channel,
        twitch_client_id: brand.twitch_client_id,
        twitch_client_secret: brand.twitch_client_secret,
        twitch_live_detection: !!brand.twitch_live_detection,
      });
      loadSeqRef.current += 1;
      const { data } = await api.put("/settings/branding", payload);
      brandDirtyRef.current = false;
      setBrand((prev) => ({ ...prev, ...data, twitch_client_secret: "" }));
      toast.success("Twitch-Einstellungen gespeichert.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingTwitch(false); }
  };
  const refreshTwitch = async () => {
    if (refreshingTwitch) return;
    setRefreshingTwitch(true);
    try {
      const { data } = await api.post("/admin/streams/refresh");
      if (data?.ok) toast.success(`Twitch geprüft: ${data.live || 0} live von ${data.checked || 0} Kanälen.`);
      else toast.error(`Twitch nicht geprüft: ${data?.skipped || "unbekannt"}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setRefreshingTwitch(false); }
  };
  const saveDiscord = async () => {
    if (savingDiscord) return;
    if (imageUploadBusy) return toast.error("Bild-Upload läuft noch. Bitte kurz warten und dann speichern.");
    const payload = { ...discord };
    if (!payload.webhook_url) delete payload.webhook_url;
    delete payload.configured;
    delete payload.webhook_url_masked;
    delete payload.last_status;
    delete payload.last_error;
    delete payload.last_event_key;
    delete payload.last_checked_at;
    setSavingDiscord(true);
    try { loadSeqRef.current += 1; await api.put("/settings/discord", payload); discordDirtyRef.current = false; toast.success("Discord gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingDiscord(false); }
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
  const previewNewsletter = async () => {
    if (!newsletter.id) return toast.error("News oder Event auswählen.");
    setLoadingNewsletterPreview(true);
    try {
      const { data } = await api.post("/settings/newsletter/preview", newsletter);
      setNewsletterPreview(data);
      toast.success(`${data.recipients || 0} Empfänger gefunden.`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Newsletter-Vorschau fehlgeschlagen."); }
    finally { setLoadingNewsletterPreview(false); }
  };
  const sendNewsletter = async () => {
    if (!newsletter.id) return toast.error("News oder Event auswählen.");
    if (!await confirm({
      title: "Newsletter versenden?",
      description: newsletter.force
        ? "Der Newsletter wird erneut eingereiht, auch wenn er bereits versendet wurde."
        : "Der Newsletter wird an alle passenden Opt-in-Empfänger eingereiht. Bereits versendete Quellen werden geschützt.",
      confirmLabel: "Versand einreihen",
      tone: "info",
    })) return;
    setSendingNewsletter(true);
    try {
      const { data } = await api.post("/settings/newsletter/send", newsletter);
      setNewsletterPreview((prev) => ({ ...(prev || {}), ...data }));
      if (data.skipped) toast.error("Newsletter wurde bereits versendet. Für erneuten Versand 'erneut senden' aktivieren.");
      else toast.success(`${data.queued || 0} Newsletter-Mails eingereiht.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Newsletter-Versand fehlgeschlagen."); }
    finally { setSendingNewsletter(false); }
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
    if (!await confirm({
      title: "Discord Webhook entfernen?",
      description: "Automatische Discord-Meldungen werden danach nicht mehr versendet.",
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.put("/settings/discord", { clear_webhook: true });
      toast.success("Discord Webhook entfernt.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const changeDiscordCounter = async (user, delta) => {
    if (!user?.id || savingDiscordCounter) return;
    setSavingDiscordCounter(`${user.id}:delta`);
    try {
      await api.post(`/admin/discord/counter/${user.id}`, { delta });
      toast.success(delta > 0 ? `+${delta} Discord-Aktivität gezählt.` : `${delta} Discord-Aktivität abgezogen.`);
      loadDiscordCounters();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingDiscordCounter(""); }
  };
  const setDiscordCounter = async (user) => {
    const raw = discordCounterValues[user.id];
    if (raw === undefined || raw === "") return toast.error("Zählerwert eingeben.");
    const total = Number(raw);
    if (!Number.isFinite(total) || total < 0) return toast.error("Zähler muss 0 oder höher sein.");
    setSavingDiscordCounter(`${user.id}:set`);
    try {
      await api.put(`/admin/discord/counter/${user.id}`, { total: Math.round(total) });
      toast.success("Discord-Zähler gespeichert.");
      setDiscordCounterValues((prev) => ({ ...prev, [user.id]: "" }));
      loadDiscordCounters();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingDiscordCounter(""); }
  };

  const saveSmtp = async () => {
    if (savingSmtp) return;
    const payload = { ...smtp };
    if (payload.provider === "smtp" && payload.smtp_auth === "login") {
      if (!payload.smtp_user) return toast.error("SMTP User fehlt. Für einfachen Versand bitte office@... eintragen.");
      if (!payload.smtp_pass && !payload.smtp_pass_masked) return toast.error("SMTP Passwort fehlt.");
    }
    if (!payload.smtp_pass) delete payload.smtp_pass;
    setSavingSmtp(true);
    try { await api.put("/settings/smtp", payload); toast.success("SMTP-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingSmtp(false); }
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
    if (!smtpTestEmail) return toast.error("E-Mail-Adresse für Diagnose eingeben");
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
      if (data.ok) toast.success("Zustellbarkeit sieht grundsätzlich okay aus.");
      else toast.error("Zustellbarkeit hat offene Punkte.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const processQueueNow = async () => {
    try { const { data } = await api.post("/settings/mail-queue/process"); toast.success(`Queue verarbeitet: ${data.sent}/${data.processed} gesendet${data.recovered ? `, ${data.recovered} wiederhergestellt` : ""}`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const recoverQueue = async () => {
    try { const { data } = await api.post("/settings/mail-queue/recover"); toast.success(`${data.recovered || 0} hängende Jobs wiederhergestellt.`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const retryFailedQueue = async () => {
    if (!await confirm({
      title: "Fehlgeschlagene Mails neu einreihen?",
      description: "Alle fehlgeschlagenen Mail-Jobs werden auf pending gesetzt und beim nächsten Queue-Lauf erneut versucht.",
      confirmLabel: "Neu einreihen",
      tone: "info",
    })) return;
    try { const { data } = await api.post("/settings/mail-queue/retry-failed"); toast.success(`${data.queued || 0} Jobs neu eingereiht.`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const cleanupQueue = async () => {
    if (!await confirm({
      title: "Alte gesendete Mails aufräumen?",
      description: "Gesendete und übersprungene Queue-Einträge älter als 30 Tage werden gelöscht. Fehlgeschlagene Jobs bleiben erhalten.",
      confirmLabel: "Aufräumen",
      tone: "info",
    })) return;
    try { const { data } = await api.delete("/settings/mail-queue/cleanup?days=30"); toast.success(`${data.deleted || 0} alte Jobs gelöscht.`); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const retryJob = async (id) => {
    try { await api.post(`/settings/mail-queue/${id}/retry`); toast.success("Job neu eingereiht."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const deleteJob = async (id) => {
    if (!await confirm({
      title: "Mail-Job löschen?",
      description: "Der Queue-Eintrag wird entfernt und nicht mehr versendet.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/settings/mail-queue/${id}`); toast.success("Job gelöscht."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const emailNotConfigured = !email.resend_api_key_masked;
  const discordNotConfigured = !discord.configured && !discord.webhook_url_masked;
  const filteredQueue = queue.filter((j) => !queueFilter || j.status === queueFilter);
  const queueCounts = queueStats?.counts || {};
  const newsletterOptions = newsletter.kind === "event" ? newsletterSources.events : newsletterSources.news;
  const selectedNewsletterSource = newsletterOptions.find((item) => item.id === newsletter.id || item.slug === newsletter.id);

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Einstellungen</h1>

      <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
        {[["email", "Resend", Mail], ["smtp", "SMTP", Server], ["newsletter", "Newsletter", Mail], ["queue", "Mail-Queue", Inbox], ["discord", "Discord", MessageSquare], ["twitch", "Twitch", Radio], ["brand", "Branding", Palette], ["legal", "Rechtliches", FileText], ["system", "Status", Activity], ["logs", "Versandlogs", Send]].map(([k, l, Icn]) => (
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
              <p className="text-xs text-white/40 mt-1">Reply-To für Rückfragen. Leer = sichtbare Absender-E-Mail.</p>
            </div>
            <button onClick={saveEmail} disabled={savingEmail} data-testid="email-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingEmail ? "Speichere..." : "Speichern"}</button>
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
                <p className="mt-1 text-[11px] text-white/40">Für normalen Versand: Benutzer/Passwort auf Port 587.</p>
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
                <p className="mt-1 text-[11px] text-white/40">Reply-To für Rückfragen.</p>
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
                Hinweis: Diese Domain-Felder sind Mail-Identität, nicht Verbindung. Der SMTP Host darf weiterhin nur die IP sein.
              </div>
            </div>
            <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-xs text-white/60">
              <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-2">DNS Checkliste gegen Spam</div>
              <p>Gmail bewertet die öffentliche Ausgangs-IP deines Mailservers. Wichtig sind SPF, DKIM, DMARC, PTR/rDNS und die Mailserver-Logs. Der SMTP Host in dieser App darf trotzdem eine lokale IP sein.</p>
            </div>
            <button onClick={saveSmtp} disabled={savingSmtp} data-testid="smtp-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingSmtp ? "Speichere..." : "Speichern"}</button>
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
            <p className="text-xs text-white/50">Testet die SMTP-Verbindung direkt. Auto-TLS verhält sich wie beim OmniFM-Bot: Port 465 SSL/TLS, Port 25 plain, sonst STARTTLS.</p>
            <p className="text-xs text-white/50">Bei self-signed Zertifikat kann "TLS Zertifikat pruefen" deaktiviert werden; besser ist ein vertrauenswuerdiges Zertifikat am Mailserver.</p>
          </div>
        </div>
      )}

      {tab === "newsletter" && (
        <div className="max-w-4xl space-y-4">
          <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-sm text-white/70">
            <div className="font-heading font-bold uppercase text-[#29B6E8] mb-1">Newsletter & Event-Mail</div>
            <p>News und Events werden beim Veröffentlichen automatisch an Nutzer mit Opt-in eingereiht. Hier kannst du Empfänger prüfen und einen Versand manuell auslösen.</p>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Typ</div>
                <select
                  value={newsletter.kind}
                  onChange={(e) => {
                    const kind = e.target.value;
                    const options = kind === "event" ? newsletterSources.events : newsletterSources.news;
                    setNewsletter({ kind, id: options[0]?.id || "", force: false });
                    setNewsletterPreview(null);
                  }}
                  data-testid="newsletter-kind"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                >
                  <option value="news">News</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Quelle</div>
                <select
                  value={newsletter.id}
                  onChange={(e) => { setNewsletter((prev) => ({ ...prev, id: e.target.value })); setNewsletterPreview(null); }}
                  data-testid="newsletter-source"
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"
                >
                  {newsletterOptions.length === 0 && <option value="">Keine Quelle gefunden</option>}
                  {newsletterOptions.map((item) => (
                    <option key={item.id || item.slug} value={item.id || item.slug}>
                      {item.title || item.name || item.slug || item.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedNewsletterSource && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Status</div>
                  <div className="text-white/80">{selectedNewsletterSource.published === false ? "Nicht veröffentlicht" : selectedNewsletterSource.status || "veröffentlicht"}</div>
                </div>
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Sichtbarkeit</div>
                  <div className="text-white/80">{selectedNewsletterSource.visibility || "public"}</div>
                </div>
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Schon versendet</div>
                  <div className="text-white/80">{selectedNewsletterSource.newsletter_sent_at ? new Date(selectedNewsletterSource.newsletter_sent_at).toLocaleString("de-DE") : "nein"}</div>
                </div>
              </div>
            )}

            <label className="inline-flex items-center gap-2 text-sm text-white/75">
              <input
                type="checkbox"
                checked={newsletter.force}
                onChange={(e) => setNewsletter((prev) => ({ ...prev, force: e.target.checked }))}
                data-testid="newsletter-force"
                className="accent-[#FFD700]"
              />
              <span>Erneut senden, auch wenn bereits versendet</span>
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={previewNewsletter}
                disabled={loadingNewsletterPreview || !newsletter.id}
                data-testid="newsletter-preview"
                className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Eye className="w-3.5 h-3.5" /> {loadingNewsletterPreview ? "Prüfe..." : "Empfänger prüfen"}
              </button>
              <button
                onClick={sendNewsletter}
                disabled={sendingNewsletter || !newsletter.id}
                data-testid="newsletter-send"
                className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> {sendingNewsletter ? "Reihe ein..." : "Newsletter senden"}
              </button>
              <button
                onClick={loadNewsletterSources}
                type="button"
                className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Aktualisieren
              </button>
            </div>
          </div>

          {newsletterPreview && (
            <div data-testid="newsletter-preview-result" className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">{newsletterPreview.kind === "event" ? "Event-Newsletter" : "News-Newsletter"}</div>
                  <div className="font-heading text-xl font-black uppercase mt-1">{newsletterPreview.title || selectedNewsletterSource?.title || selectedNewsletterSource?.name || "Newsletter"}</div>
                </div>
                <div className="font-heading text-3xl font-black text-[#29B6E8] tabular-nums">{newsletterPreview.recipients ?? newsletterPreview.queued ?? 0}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Empfänger</div>
                  <div className="text-white/80">{newsletterPreview.recipients ?? newsletterPreview.queued ?? 0}</div>
                </div>
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Sichtbarkeit</div>
                  <div className="text-white/80">{newsletterPreview.visibility || selectedNewsletterSource?.visibility || "public"}</div>
                </div>
                <div className="border border-white/10 bg-black/20 rounded-sm p-3">
                  <div className="uppercase tracking-widest text-white/40 font-bold mb-1">Letzter Versand</div>
                  <div className="text-white/80">{newsletterPreview.already_sent_at || newsletterPreview.sent_at ? new Date(newsletterPreview.already_sent_at || newsletterPreview.sent_at).toLocaleString("de-DE") : "nein"}</div>
                </div>
              </div>
              {(newsletterPreview.sample || []).length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2">Empfänger-Auszug</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {newsletterPreview.sample.map((user) => (
                      <div key={user.id || user.email} className="border border-white/10 bg-black/20 rounded-sm p-3 text-xs">
                        <div className="font-bold text-white/80">{user.display_name || user.email}</div>
                        <div className="text-white/45 font-mono break-all">{user.email}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {newsletterPreview.reason && <div className="text-xs text-[#FFD700] uppercase tracking-widest">Hinweis: {newsletterPreview.reason}</div>}
            </div>
          )}
        </div>
      )}

      {tab === "queue" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["pending", "Wartet", "#FFD700"],
              ["sending", "Sending", "#29B6E8"],
              ["sent", "Gesendet", "#00FF88"],
              ["failed", "Fehler", "#FF3B30"],
              ["skipped", "Übersprungen", "#FFFFFF"],
            ].map(([key, label, color]) => (
              <button
                key={key}
                type="button"
                onClick={() => setQueueFilter(queueFilter === key ? "" : key)}
                data-testid={`queue-stat-${key}`}
                className={`border rounded-sm p-3 text-left transition ${queueFilter === key ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 bg-[#121212] hover:border-white/25"}`}
              >
                <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
                <div className="mt-1 font-heading text-2xl font-black tabular-nums" style={{ color }}>{queueCounts[key] || 0}</div>
              </button>
            ))}
          </div>
          {(queueStats?.stale_sending > 0 || queueStats?.latest_problem) && (
            <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4 text-sm text-white/70">
              <div className="font-bold uppercase tracking-widest text-[#FFD700] mb-1">Queue-Hinweis</div>
              {queueStats?.stale_sending > 0 && <div>{queueStats.stale_sending} Versand-Job hängt länger als {queueStats.stale_after_minutes} Minuten.</div>}
              {queueStats?.latest_problem && <div className="mt-1">Letztes Problem: {queueStats.latest_problem.template_key || "Mail"} · {queueStats.latest_problem.last_error || queueStats.latest_problem.status}</div>}
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={processQueueNow} data-testid="queue-process-now" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Jetzt verarbeiten</button>
            <button onClick={recoverQueue} data-testid="queue-recover" className="px-4 py-2 border border-[#FFD700]/60 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Hänger retten</button>
            <button onClick={retryFailedQueue} data-testid="queue-retry-failed" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Fehler retry</button>
            <button onClick={cleanupQueue} data-testid="queue-cleanup" className="px-4 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Aufräumen</button>
            <select value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)} data-testid="queue-filter" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              <option value="">Alle</option>
              <option value="pending">pending</option>
              <option value="sending">sending</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
              <option value="skipped">skipped</option>
            </select>
            <span className="text-xs text-white/50">
              {filteredQueue.length} / {queue.length} Jobs · {queueStats?.due_pending || 0} jetzt fällig · Worker läuft alle 30s automatisch
            </span>
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
                  {filteredQueue.map((j) => (
                    <tr key={j.id} data-testid={`queue-row-${j.id}`}>
                      <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{new Date(j.created_at).toLocaleString("de-DE")}</td>
                      <td className="px-4 py-3">{j.to}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-[#29B6E8] font-bold">{mailTemplateLabel(j)}</div>
                        <div className="text-white/45 truncate max-w-[240px]">{j.subject || j.template_key || "—"}</div>
                        {j.meta?.username && <div className="text-white/35 truncate max-w-[240px]">Benutzer: {j.meta.username}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {j.status === "sent" && <span className="text-[#00FF88] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> sent</span>}
                        {j.status === "failed" && <span className="text-[#FF3B30] inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> failed</span>}
                        {j.status === "pending" && <span className="text-[#FFD700]">{j.template_key === "user_invite" ? "Einladungsmail wartet auf Versand" : STATUS_LABELS.pending}</span>}
                        {j.status === "sending" && <span className="text-[#29B6E8]">{STATUS_LABELS.sending}</span>}
                        {j.status === "skipped" && <span className="text-white/50">{STATUS_LABELS.skipped}</span>}
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
                  {filteredQueue.length === 0 && <tr><td colSpan="8" className="text-center py-10 text-white/40">{queue.length === 0 ? "Mail-Queue ist leer." : "Keine Jobs für diesen Filter."}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "discord" && (
        <div className="max-w-4xl space-y-4">
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
                <input type="checkbox" checked={discord.enabled} onChange={(e) => setDiscordField("enabled", e.target.checked)} className="accent-[#29B6E8]" data-testid="discord-enabled" />
                <span>Versand aktiv</span>
              </label>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Webhook URL {discord.webhook_url_masked && <span className="text-white/40 normal-case">(aktuell: {discord.webhook_url_masked})</span>}</div>
              <input type="password" placeholder="https://discord.com/api/webhooks/…" value={discord.webhook_url} onChange={(e) => setDiscordField("webhook_url", e.target.value)} data-testid="discord-webhook" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
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
                <input value={discord.username || ""} onChange={(e) => setDiscordField("username", e.target.value)} data-testid="discord-username" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
              </div>
              <ImageUpload value={discord.avatar_url || ""} onChange={(v) => setDiscordField("avatar_url", v)} label="Avatar" testId="discord-avatar" variant="square" allowLibrary />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
            <button onClick={saveDiscord} disabled={imageUploadBusy || savingDiscord} data-testid="discord-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingDiscord ? "Speichere..." : "Speichern"}</button>
              <button onClick={sendDiscordTest} data-testid="discord-test" className="px-4 py-2 border border-[#5865F2] text-[#5865F2] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Test senden</button>
              {discord.configured && <button onClick={clearDiscordWebhook} data-testid="discord-clear" className="px-4 py-2 border border-[#FF3B30]/60 text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm">Webhook entfernen</button>}
            </div>
          </div>
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <div>
                <div className="font-heading font-bold uppercase">Discord-Aktivität</div>
                <p className="mt-1 text-xs text-white/45">Pflege Nachrichten-Zähler für `discord_active` Achievements. Später kann hier ein Bot/Import automatisch schreiben.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
                <input value={discordCounterQuery} onChange={(e) => setDiscordCounterQuery(e.target.value)} data-testid="discord-counter-search" placeholder="User, Name, Discord oder E-Mail" className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm" />
              </div>
            </div>
            <div className="border border-white/5 rounded-sm divide-y divide-white/5 overflow-hidden">
              {discordCounters.map((user) => {
                const total = user.discord_messages_count || 0;
                return (
                  <div key={user.id} className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-3 p-3 items-center">
                    <div className="flex items-center gap-3 min-w-0">
                      {user.avatar_url ? (
                        <img src={resolveMediaUrl(user.avatar_url)} alt="" className="w-10 h-10 rounded-sm object-cover border border-white/10" />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-xs font-black text-white/40">
                          {(user.display_name || user.username || "?").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold truncate">{user.display_name || user.username}</div>
                        <div className="text-xs text-white/40 truncate">@{user.username}{user.discord_name ? ` · ${user.discord_name}` : ""}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
                      <div className="px-3 py-2 border border-[#5865F2]/30 bg-[#5865F2]/10 text-[#b8c0ff] text-xs font-bold uppercase tracking-widest rounded-sm">
                        {total.toLocaleString("de-DE")} Nachrichten
                      </div>
                      <button type="button" onClick={() => changeDiscordCounter(user, 1)} disabled={!!savingDiscordCounter} className="px-3 py-2 border border-white/10 hover:border-[#5865F2]/60 text-xs font-bold uppercase tracking-wider rounded-sm">+1</button>
                      <button type="button" onClick={() => changeDiscordCounter(user, 10)} disabled={!!savingDiscordCounter} className="px-3 py-2 border border-white/10 hover:border-[#5865F2]/60 text-xs font-bold uppercase tracking-wider rounded-sm">+10</button>
                      <input type="number" min="0" value={discordCounterValues[user.id] ?? ""} onChange={(e) => setDiscordCounterValues((prev) => ({ ...prev, [user.id]: e.target.value }))} data-testid={`discord-counter-total-${user.id}`} placeholder="Wert" className="w-24 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs" />
                      <button type="button" onClick={() => setDiscordCounter(user)} disabled={!!savingDiscordCounter} data-testid={`discord-counter-save-${user.id}`} className="px-3 py-2 bg-[#5865F2] text-white text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">Setzen</button>
                    </div>
                  </div>
                );
              })}
              {!discordCounters.length && (
                <div className="px-4 py-10 text-center text-sm text-white/40">
                  Keine Discord-Zähler gefunden. Suche nach einem Benutzer, um den ersten Wert zu setzen.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "twitch" && (
        <div className="max-w-4xl space-y-4">
          {!twitchStatus?.configured && (
            <div className="flex items-start gap-3 border border-[#9146FF]/30 bg-[#9146FF]/10 rounded-sm p-4">
              <Radio className="w-5 h-5 text-[#9146FF] shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-bold text-[#b88cff] uppercase tracking-wider text-xs">Twitch Helix noch nicht aktiv</div>
                <p className="text-white/70 mt-1">Für Live-Erkennung, Streamer-Achievements und den Live-Slider brauchst du Client-ID und Client-Secret aus einer Twitch Developer App.</p>
              </div>
            </div>
          )}
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-heading font-bold uppercase">Live-Erkennung</div>
                  <p className="mt-1 text-xs text-white/45">Prüft verknüpfte Twitch-Kanäle, füllt /streams/live und wertet Streamer-Achievements aus.</p>
                </div>
                <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                  <input type="checkbox" checked={brand.twitch_live_detection !== false} onChange={(e) => setBrandField("twitch_live_detection", e.target.checked)} className="accent-[#9146FF]" data-testid="twitch-live-detection" />
                  <span>Aktiv</span>
                </label>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <BrandField label="TLS Twitch Channel" value={brand.twitch_channel} onChange={(v) => setBrandField("twitch_channel", v)} testId="twitch-channel" />
                <BrandField label="Twitch Client ID" value={brand.twitch_client_id} onChange={(v) => setBrandField("twitch_client_id", v)} testId="twitch-client-id" />
              </div>
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
                  Twitch Client Secret {brand.twitch_client_secret_masked && <span className="text-white/40 normal-case">(aktuell gespeichert)</span>}
                </div>
                <input type="password" value={brand.twitch_client_secret || ""} onChange={(e) => setBrandField("twitch_client_secret", e.target.value)} data-testid="twitch-client-secret" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={brand.twitch_client_secret_masked ? "Leer lassen, um Secret beizubehalten" : "Client Secret eintragen"} />
                <p className="mt-1 text-xs text-white/40">Das Secret wird beim Laden nicht mehr im Klartext zurückgegeben.</p>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={saveTwitch} disabled={savingTwitch} data-testid="twitch-save" className="px-5 py-2 bg-[#9146FF] text-white font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingTwitch ? "Speichere..." : "Speichern"}</button>
                <button onClick={refreshTwitch} disabled={refreshingTwitch || !twitchStatus?.configured || brand.twitch_live_detection === false} data-testid="twitch-refresh" className="px-4 py-2 border border-[#9146FF]/70 text-[#b88cff] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-40">
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingTwitch ? "animate-spin" : ""}`} /> Jetzt prüfen
                </button>
              </div>
            </div>
            <div className="grid gap-3">
              <SystemCard title="Twitch API" ok={twitchStatus?.configured && twitchStatus?.enabled} detail={twitchStatus?.configured ? "Credentials gespeichert" : "Client-ID oder Secret fehlt"} />
              <SystemCard title="Kanäle" ok={(twitchStatus?.checked_users || 0) > 0} detail={`${twitchStatus?.checked_users || 0} Accounts mit Twitch-Feld`} />
              <SystemCard title="Live" ok={(twitchStatus?.live_count || 0) > 0} detail={`${twitchStatus?.live_count || 0} Stream(s) aktuell live`} />
              <SystemCard title="Token" ok={!!twitchStatus?.token_expires_at} detail={twitchStatus?.token_expires_at ? `gültig bis ${new Date(twitchStatus.token_expires_at).toLocaleString("de-DE")}` : "wird beim nächsten Refresh erstellt"} />
            </div>
          </div>
          {twitchStatus?.live_streams?.length > 0 && (
            <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 font-heading font-bold uppercase">Aktuell live</div>
              <div className="divide-y divide-white/5">
                {twitchStatus.live_streams.map((stream) => (
                  <a key={stream.stream_id || stream.user_id} href={stream.stream_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                    <Radio className="w-4 h-4 text-[#FF3B30] animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{stream.display_name || stream.username || stream.twitch_login}</div>
                      <div className="text-xs text-white/45 truncate">{stream.title || "Stream läuft"}{stream.game_name ? ` · ${stream.game_name}` : ""}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-white/60"><Eye className="w-3.5 h-3.5" /> {stream.viewer_count || 0}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "brand" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <BrandField label="Vereinsname" value={brand.club_name} onChange={(v) => setBrandField("club_name", v)} testId="brand-club-name" />
            <BrandField label="Tagline" value={brand.tagline} onChange={(v) => setBrandField("tagline", v)} testId="brand-tagline" />
            <BrandField label="Website-/Browsertitel" value={brand.site_title} onChange={(v) => setBrandField("site_title", v)} testId="brand-site-title" placeholder="THE LION SQUAD - eSPORTS" />
            <BrandField label="SEO Beschreibung" value={brand.site_description} onChange={(v) => setBrandField("site_description", v)} testId="brand-site-description" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Akzentfarbe (HEX)" value={brand.primary_color} onChange={(v) => setBrandField("primary_color", v)} testId="brand-color" />
              <BrandField label="Domain" value={brand.domain} onChange={(v) => setBrandField("domain", v)} testId="brand-domain" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Zeitzone" value={brand.timezone} onChange={(v) => setBrandField("timezone", v)} testId="brand-tz" />
              <BrandField label="Kontakt E-Mail" value={brand.contact_email} onChange={(v) => setBrandField("contact_email", v)} testId="brand-contact-email" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Discord Einladung" value={brand.discord_invite_url} onChange={(v) => setBrandField("discord_invite_url", v)} testId="brand-discord-invite" />
              <BrandField label="Twitch Channel" value={brand.twitch_channel} onChange={(v) => setBrandField("twitch_channel", v)} testId="brand-twitch-channel" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ImageUpload value={brand.logo_url} onChange={(v) => setBrandField("logo_url", v)} label="Vereinslogo" testId="brand-logo" variant="square" allowLibrary />
              <ImageUpload value={brand.mascot_url} onChange={(v) => setBrandField("mascot_url", v)} label="Maskottchen" testId="brand-mascot" variant="square" allowLibrary />
              <ImageUpload value={brand.favicon_url} onChange={(v) => setBrandField("favicon_url", v)} label="Favicon / Browser Icon" testId="brand-favicon" variant="square" allowLibrary />
            </div>
            <p className="text-xs text-white/45">Impressum, Datenschutz und Vereinsdaten liegen im Tab Rechtliches.</p>
            <button onClick={saveBrand} disabled={imageUploadBusy || savingBrand} data-testid="brand-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingBrand ? "Speichere..." : "Speichern"}</button>
          </div>
        </div>
      )}

      {tab === "legal" && (
        <div className="max-w-4xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
            <div>
              <div className="font-heading font-bold uppercase">Vereinsdaten für Impressum und Datenschutz</div>
              <p className="text-xs text-white/50 mt-1">Diese Angaben werden dynamisch auf /imprint und /privacy ausgegeben. ZVR, Adresse und vertretungsbefugte Person bitte mit den echten Vereinsdaten eintragen.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Rechtlicher Vereinsname" value={brand.legal_name} onChange={(v) => setBrandField("legal_name", v)} testId="legal-name" />
              <BrandField label="ZVR-Zahl" value={brand.zvr_number} onChange={(v) => setBrandField("zvr_number", v)} testId="legal-zvr" />
              <BrandField label="Rechtsform" value={brand.legal_form} onChange={(v) => setBrandField("legal_form", v)} testId="legal-form" />
              <BrandField label="Vereinssitz" value={brand.registered_seat} onChange={(v) => setBrandField("registered_seat", v)} testId="legal-seat" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Strasse und Hausnummer" value={brand.street_address} onChange={(v) => setBrandField("street_address", v)} testId="legal-street" />
              <BrandField label="Adresszusatz" value={brand.address_extra} onChange={(v) => setBrandField("address_extra", v)} testId="legal-address-extra" />
              <BrandField label="PLZ" value={brand.postal_code} onChange={(v) => setBrandField("postal_code", v)} testId="legal-postal" />
              <BrandField label="Ort" value={brand.city} onChange={(v) => setBrandField("city", v)} testId="legal-city" />
              <BrandField label="Bundesland" value={brand.state} onChange={(v) => setBrandField("state", v)} testId="legal-state" />
              <BrandField label="Land" value={brand.country} onChange={(v) => setBrandField("country", v)} testId="legal-country" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Vereinsbehoerde" value={brand.register_authority} onChange={(v) => setBrandField("register_authority", v)} testId="legal-authority" />
              <BrandField label="Telefon" value={brand.phone} onChange={(v) => setBrandField("phone", v)} testId="legal-phone" />
              <BrandField label="Vertretungsbefugte Person" value={brand.representative_name} onChange={(v) => setBrandField("representative_name", v)} testId="legal-representative" />
              <BrandField label="Funktion" value={brand.representative_role} onChange={(v) => setBrandField("representative_role", v)} testId="legal-role" />
              <BrandField label="Inhaltlich verantwortlich" value={brand.content_responsible} onChange={(v) => setBrandField("content_responsible", v)} testId="legal-content-responsible" />
              <BrandField label="Datenschutz E-Mail" value={brand.privacy_contact_email} onChange={(v) => setBrandField("privacy_contact_email", v)} testId="legal-privacy-email" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BrandField label="Hosting / Betreiber" value={brand.hosting_provider} onChange={(v) => setBrandField("hosting_provider", v)} testId="legal-hosting" />
              <BrandField label="Hosting-Region" value={brand.hosting_country} onChange={(v) => setBrandField("hosting_country", v)} testId="legal-hosting-country" />
              <BrandField label="UID-Nummer falls vorhanden" value={brand.vat_number} onChange={(v) => setBrandField("vat_number", v)} testId="legal-vat" />
              <BrandField label="Turnierbedingungen URL" value={brand.tournament_terms_url} onChange={(v) => setBrandField("tournament_terms_url", v)} testId="legal-terms-url" />
            </div>
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={!!brand.paid_tournaments_enabled} onChange={(e) => setBrandField("paid_tournaments_enabled", e.target.checked)} data-testid="legal-paid-tournaments" className="accent-[#29B6E8] mt-1" />
              <span>Preisturniere oder Turniere mit Startgeld können stattfinden.</span>
            </label>
            <LegalTextArea label="Freitext Impressum" value={brand.imprint} onChange={(v) => setBrandField("imprint", v)} testId="brand-imprint" rows={4} />
            <LegalTextArea label="Zusätzliche rechtliche Hinweise" value={brand.legal_extra} onChange={(v) => setBrandField("legal_extra", v)} testId="legal-extra" rows={4} />
            <LegalTextArea label="Freitext Datenschutz" value={brand.privacy_policy} onChange={(v) => setBrandField("privacy_policy", v)} testId="brand-privacy" rows={5} />
            <LegalTextArea label="Zusätzliche Datenschutzhinweise" value={brand.privacy_extra} onChange={(v) => setBrandField("privacy_extra", v)} testId="privacy-extra" rows={5} />
            <button onClick={saveBrand} disabled={imageUploadBusy || savingBrand} data-testid="legal-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingBrand ? "Speichere..." : "Rechtliches speichern"}</button>
          </div>
        </div>
      )}

      {tab === "system" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={load} data-testid="system-refresh" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Aktualisieren</button>
            <span className="text-xs text-white/50">Live-Status für Versand, Uploads, Scheduler und Queue.</span>
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

function BrandField({ label, value, onChange, testId, placeholder = "" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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
