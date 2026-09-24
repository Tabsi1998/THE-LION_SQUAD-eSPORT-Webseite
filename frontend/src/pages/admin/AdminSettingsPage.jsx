import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { setCachedBranding } from "@/lib/brandingEvents";
import { isGoogleMeasurementId } from "@/lib/analyticsConfig";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useImageUploadBusy } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useAuth } from "@/context/AuthContext";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { SOCIAL_PLATFORM_OPTIONS, SocialsTab } from "./settings/SocialSettings";
import { PLATFORM_APP_FIELDS } from "@/lib/platformLinks";
import { toast } from "sonner";
import { SETTINGS_SECTIONS, LEGACY_TAB_REDIRECTS, INDEXNOW_DEFAULT_PATHS, BANNER_TEMPLATE_PRESETS, defaultSocialLinks, emptyBannerForm, emailPayload, smtpPayload, BRAND_SECRET_FIELDS, brandPayload } from "./settings/shared";
import { GoogleLoginSection } from "./settings/sections/GoogleLoginSection";
import { AccessSection } from "./settings/sections/AccessSection";
import { ResendSection } from "./settings/sections/ResendSection";
import { SmtpSection } from "./settings/sections/SmtpSection";
import { NewsletterSection } from "./settings/sections/NewsletterSection";
import { MailQueueSection } from "./settings/sections/MailQueueSection";
import { BrandSection } from "./settings/sections/BrandSection";
import { SeoSection } from "./settings/sections/SeoSection";
import { SystemSection } from "./settings/sections/SystemSection";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const [searchParams] = useSearchParams();
  const { section } = useParams();
  const sectionMeta = SETTINGS_SECTIONS[section] || null;
  const tab = sectionMeta?.tab || "";
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
    logo_url: "", logo_light_url: "", logo_dark_url: "", share_banner_url: "", mascot_url: "", qr_logo_url: "",
    favicon_url: "", favicon_light_url: "", favicon_dark_url: "", contact_email: "", domain: "", timezone: "Europe/Vienna",
    legal_name: "", legal_form: "eingetragener Verein nach österreichischem Vereinsrecht", zvr_number: "",
    street_address: "", address_extra: "", postal_code: "", city: "", state: "Tirol", country: "Österreich",
    registered_seat: "", register_authority: "", representative_name: "", representative_role: "",
    content_responsible: "", phone: "", privacy_contact_email: "", hosting_provider: "", hosting_country: "Österreich/EU",
    vat_number: "", tournament_terms_url: "", paid_tournaments_enabled: false,
    imprint: "", privacy_policy: "", legal_extra: "", privacy_extra: "", terms_of_use: "",
    discord_invite_url: "", play_store_url: "", twitch_channel: "", twitch_client_id: "", twitch_client_secret: "",
    discord_client_id: "", discord_client_secret: "", discord_client_secret_masked: "", steam_api_key: "", steam_api_key_masked: "",
    ...Object.fromEntries(PLATFORM_APP_FIELDS.flatMap((field) => (field.endsWith("_secret") || field === "steam_api_key" ? [[field, ""], [`${field}_masked`, ""]] : [[field, ""]]))),
    whatsapp_channel_url: "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I",
    social_links: defaultSocialLinks(),
    analytics_provider: "", google_analytics_id: "", plausible_domain: "",
    google_site_verification: "", msvalidate_01: "", indexnow_key: "",
    twitch_client_secret_masked: "", twitch_live_detection: true,
    site_banner_enabled: false, site_banner_text: "", site_banner_tone: "info", site_banner_mode: "ticker", site_banner_speed_seconds: 22,
    site_banner_style: "neon", site_banner_position: "below_nav", site_banner_scope: "all", site_banner_path: "",
    site_banner_audience: "all", site_banner_link_url: "", site_banner_link_label: "",
    site_banner_starts_at: "", site_banner_ends_at: "",
  });
  const [authConfig, setAuthConfig] = useState({
    password_login_enabled: true,
    registration_enabled: true,
    google_login_enabled: false,
    google_registration_enabled: false,
    google_linking_enabled: false,
    google_client_id: "",
    google_configured: false,
  });
  const [savingAuth, setSavingAuth] = useState(false);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [systemStatus, setSystemStatus] = useState(null);
  const [siteBanners, setSiteBanners] = useState([]);
  const [bannerForm, setBannerForm] = useState(emptyBannerForm());
  const [editingBannerId, setEditingBannerId] = useState("");
  const [savingBanner, setSavingBanner] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [generatingFavicon, setGeneratingFavicon] = useState(false);
  const [submittingIndexNow, setSubmittingIndexNow] = useState(false);
  const [indexNowResult, setIndexNowResult] = useState(null);
  const imageUploadBusy = useImageUploadBusy();
  const brandDirtyRef = useRef(false);
  const originalEmailRef = useRef({});
  const originalSmtpRef = useRef({});
  const originalBrandRef = useRef({});
  const loadSeqRef = useRef(0);
  const loadErrorKeyRef = useRef("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const requestDefs = [
      { key: "email", label: "E-Mail", critical: true, request: () => api.get("/settings/email") },
      { key: "branding", label: "Branding", critical: true, request: () => api.get("/settings/branding") },
      { key: "smtp", label: "SMTP", critical: true, request: () => api.get("/settings/smtp") },
      { key: "queue", label: "Mail-Queue", critical: false, request: () => api.get("/settings/mail-queue?limit=100") },
      { key: "queue_stats", label: "Mail-Queue-Statistik", critical: false, request: () => api.get("/settings/mail-queue/stats") },
      { key: "system", label: "Systemstatus", critical: false, request: () => api.get("/admin/system-status") },
      { key: "site_banners", label: "Hinweisleisten", critical: false, request: () => api.get("/settings/site-banners/admin") },
      ...(isSuperadmin ? [{ key: "auth", label: "Login & Google", critical: false, request: () => api.get("/settings/auth") }] : []),
    ];
    const requests = await Promise.allSettled(requestDefs.map((entry) => entry.request()));
    if (seq !== loadSeqRef.current) return;
    const value = (i) => requests[i].status === "fulfilled" ? requests[i].value.data : null;
    const e = value(0), b = value(1), sm = value(2), q = value(3), qs = value(4), st = value(5), sb = value(6), ac = isSuperadmin ? value(7) : null;
    if (e) setEmail((prev) => {
      const next = { ...prev, ...e, resend_api_key: "", resend_api_key_masked: e.resend_api_key_masked || "" };
      originalEmailRef.current = emailPayload(next);
      return next;
    });
    if (b && !brandDirtyRef.current) setBrand((prev) => {
      const next = { ...prev, ...b };
      for (const field of BRAND_SECRET_FIELDS) {
        next[field] = "";
        next[`${field}_masked`] = b[`${field}_masked`] || "";
      }
      originalBrandRef.current = brandPayload(next);
      return next;
    });
    // Listen nur übernehmen, wenn es welche sind: unten stehen .map und
    // .filter darauf, und ein unerwartet geformter Wert nähme die ganze Seite
    // mit in die Fehlergrenze statt nur diesen einen Bereich leer zu lassen.
    if (sm) setSmtp((prev) => {
      const next = { ...prev, ...sm, smtp_pass: "", smtp_pass_masked: sm.smtp_pass_masked || "" };
      originalSmtpRef.current = smtpPayload(next);
      return next;
    });
    if (Array.isArray(q)) setQueue(q);
    if (qs) setQueueStats(qs);
    if (st) setSystemStatus(st);
    if (sb) setSiteBanners(Array.isArray(sb) ? sb : []);
    if (ac) setAuthConfig((prev) => ({ ...prev, ...ac }));
    const failed = requests
      .map((result, index) => ({ result, def: requestDefs[index] }))
      .filter(({ result }) => result.status === "rejected");
    if (failed.length) {
      console.warn("Admin-Einstellungen teilweise nicht geladen:", failed.map(({ def, result }) => ({
        key: def.key,
        label: def.label,
        status: result.reason?.response?.status,
        detail: result.reason?.response?.data?.detail || result.reason?.message,
      })));
    }
    const criticalFailed = failed.filter(({ def }) => def.critical);
    const errorKey = criticalFailed.map(({ def }) => def.key).sort().join(",");
    if (criticalFailed.length && loadErrorKeyRef.current !== errorKey) {
      loadErrorKeyRef.current = errorKey;
      toast.error(`Einstellungen konnten nicht vollständig geladen werden: ${criticalFailed.map(({ def }) => def.label).join(", ")}.`);
    } else if (!criticalFailed.length) {
      loadErrorKeyRef.current = "";
    }
  }, [isSuperadmin]);

  useEffect(() => { load(); }, [load]);
  // Die Warteschlange ändert sich ohne Klick: auf diesem Reiter ohne Strom
  // alle 15 s nachfragen, sonst nur bei Änderung.
  const liveTab = tab === "queue";
  useLiveRefresh(load, ["settings", "users"], { fallbackMs: liveTab ? 15000 : 0 });

  const loadNewsletterSources = useCallback(async () => {
    const [newsRes, eventsRes] = await Promise.allSettled([
      api.get("/admin/news"),
      api.get("/events?include_drafts=true"),
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
    if (liveTab) load();
  }, [liveTab, load]);

  const setBrandField = (key, value) => {
    brandDirtyRef.current = true;
    setBrand((prev) => ({ ...prev, [key]: value }));
  };

  const setSocialLink = (index, key, value) => {
    brandDirtyRef.current = true;
    setBrand((prev) => ({
      ...prev,
      social_links: (prev.social_links || []).map((social, i) => {
        if (i !== index) return social;
        const next = { ...social, [key]: value };
        if (key === "platform" && (!next.label || SOCIAL_PLATFORM_OPTIONS.some(([, label]) => label === next.label))) {
          next.label = SOCIAL_PLATFORM_OPTIONS.find(([platform]) => platform === value)?.[1] || "Eigener Link";
        }
        return next;
      }),
    }));
  };

  const addSocialLink = () => {
    brandDirtyRef.current = true;
    setBrand((prev) => ({
      ...prev,
      social_links: [...(prev.social_links || []), { platform: "custom", label: "Link", url: "", enabled: true }],
    }));
  };

  const removeSocialLink = (index) => {
    brandDirtyRef.current = true;
    setBrand((prev) => ({ ...prev, social_links: (prev.social_links || []).filter((_, i) => i !== index) }));
  };

  const refreshPublicBranding = async () => {
    try {
      const { data } = await api.get("/settings/public", { params: { _: Date.now() } });
      setCachedBranding(data || {});
    } catch {}
  };

  const saveAuth = async (next) => {
    if (savingAuth) return;
    setSavingAuth(true);
    const previous = authConfig;
    setAuthConfig(next);
    try {
      const { data } = await api.put("/settings/auth", next);
      setAuthConfig((prev) => ({ ...prev, ...data }));
      toast.success("Login-Einstellungen gespeichert.");
    } catch (e) {
      setAuthConfig(previous);
      toast.error(formatApiError(e.response?.data?.detail) || "Login-Einstellungen konnten nicht gespeichert werden.");
    } finally {
      setSavingAuth(false);
    }
  };
  const toggleAuth = (key) => saveAuth({ ...authConfig, [key]: !authConfig[key] });
  const testGoogleConfig = async () => {
    if (testingGoogle) return;
    setTestingGoogle(true);
    try {
      const { data } = await api.post("/settings/auth/google/test");
      if (data?.ok) toast.success(data.message || "Google-Konfiguration ist erreichbar.");
      else toast.error(data?.message || "Google-Konfiguration konnte nicht bestätigt werden.");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Google-Konfiguration konnte nicht geprüft werden.");
    } finally {
      setTestingGoogle(false);
    }
  };

  const saveEmail = async () => {    if (savingEmail) return;
    const payload = buildDirtyPayload(emailPayload(email), originalEmailRef.current);
    if (!hasPayloadChanges(payload)) return toast.info("Keine Änderungen zum Speichern.");
    setSavingEmail(true);
    try { await api.put("/settings/email", payload); toast.success("E-Mail-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingEmail(false); }
  };
  const clearEmailSecret = async () => {
    if (!await confirm({ title: "Resend API-Key entfernen?", description: "Der Resend-Versand funktioniert danach erst wieder mit einem neuen eigenen Key.", confirmLabel: "Key entfernen" })) return;
    await api.put("/settings/email", { clear_resend_api_key: true });
    toast.success("Resend API-Key entfernt.");
    load();
  };
  const saveBrand = async () => {
    if (savingBrand) return;
    if (imageUploadBusy) return toast.error("Bild-Upload läuft noch. Bitte kurz warten und dann speichern.");
    setSavingBrand(true);
    try {
      loadSeqRef.current += 1;
      const payload = buildDirtyPayload(brandPayload(brand), originalBrandRef.current);
      if (!hasPayloadChanges(payload)) {
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      // Die Analytics-Prüfung greift nur, wenn Analytics selbst geändert wird: ein alter Stand „Google
      // ohne Measurement ID“ blockierte sonst jedes Speichern auf allen Reitern - auch „Rechtliches“,
      // wo der Betreiber nur sah, dass der Haken „Vereinsdaten aus Dolibarr“ nicht hält (#326).
      if (("analytics_provider" in payload || "google_analytics_id" in payload) && brand.analytics_provider === "google" && !isGoogleMeasurementId(brand.google_analytics_id)) {
        toast.error("SEO & Analytics: Bitte eine gültige Google Measurement ID eintragen, z.B. G-3X155KW480 – oder Analytics auf „Keine“ stellen.");
        return;
      }
      const { data } = await api.put("/settings/branding", payload);
      brandDirtyRef.current = false;
      if (data && !data.ok) setBrand((prev) => ({ ...prev, ...data }));
      await refreshPublicBranding();
      toast.success("Branding gespeichert.");
      load();
    }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingBrand(false); }
  };
  const submitIndexNow = async () => {
    setSubmittingIndexNow(true);
    setIndexNowResult(null);
    try {
      const { data } = await api.post("/settings/indexnow/submit", { urls: INDEXNOW_DEFAULT_PATHS });
      setIndexNowResult({ ok: true, ...data, submitted_at: new Date().toISOString() });
      toast.success(`IndexNow gesendet (${data.submitted || 0} URLs).`);
    } catch (e) {
      const message = formatApiError(e.response?.data?.detail) || "IndexNow konnte nicht gesendet werden.";
      setIndexNowResult({ ok: false, error: message, submitted_at: new Date().toISOString() });
      toast.error(message);
    } finally {
      setSubmittingIndexNow(false);
    }
  };
  const setBannerField = (key, value) => setBannerForm((prev) => ({ ...prev, [key]: value }));
  const applyBannerTemplate = (template) => {
    const preset = BANNER_TEMPLATE_PRESETS[template] || BANNER_TEMPLATE_PRESETS.custom;
    setBannerForm((prev) => ({ ...prev, ...preset, template }));
  };
  const editBanner = (banner) => {
    setEditingBannerId(banner.id);
    setBannerForm({
      ...emptyBannerForm(),
      ...banner,
      starts_at: banner.starts_at || "",
      ends_at: banner.ends_at || "",
    });
  };
  const resetBannerForm = () => {
    setEditingBannerId("");
    setBannerForm(emptyBannerForm());
  };
  const saveSiteBanner = async () => {
    if (savingBanner) return;
    if (!String(bannerForm.text || "").trim()) return toast.error("Banner-Text fehlt.");
    const payload = { ...bannerForm };
    setSavingBanner(true);
    try {
      if (editingBannerId) {
        await api.patch(`/settings/site-banners/admin/${editingBannerId}`, payload);
        toast.success("Hinweisleiste gespeichert.");
      } else {
        await api.post("/settings/site-banners/admin", payload);
        toast.success("Hinweisleiste erstellt.");
      }
      resetBannerForm();
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Hinweisleiste konnte nicht gespeichert werden.");
    } finally {
      setSavingBanner(false);
    }
  };
  const deleteSiteBanner = async (banner) => {
    if (!await confirm({
      title: "Hinweisleiste löschen?",
      description: banner.title || banner.text,
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/settings/site-banners/admin/${banner.id}`);
      toast.success("Hinweisleiste gelöscht.");
      if (editingBannerId === banner.id) resetBannerForm();
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Hinweisleiste konnte nicht gelöscht werden.");
    }
  };
  // #229: Browser ohne Hell/Dunkel-Erkennung und der Home-Bildschirm nehmen nur den Standard-Favicon.
  // Ist der die Fassung für dunkel (weiß), ist er auf hellen Tableisten unsichtbar - der Server baut
  // eine Fassung, die überall trägt: weißes Logo auf einem Kreis in der Akzentfarbe.
  const faviconDarkOnly = !!brand.favicon_url && [brand.favicon_dark_url, brand.mascot_url, brand.logo_dark_url].includes(brand.favicon_url);
  const generateUniversalFavicon = async () => {
    if (generatingFavicon) return;
    setGeneratingFavicon(true);
    try {
      const { data } = await api.post("/settings/branding/favicon/universal");
      setBrand((prev) => ({ ...prev, favicon_url: data.favicon_url }));
      originalBrandRef.current = { ...originalBrandRef.current, favicon_url: data.favicon_url };
      toast.success("Standard-Favicon erzeugt und gespeichert.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setGeneratingFavicon(false); }
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

  const saveSmtp = async () => {
    if (savingSmtp) return;
    const payload = smtpPayload(smtp);
    if (payload.provider === "smtp" && payload.smtp_auth === "login") {
      if (!payload.smtp_user) return toast.error("SMTP User fehlt. Für einfachen Versand bitte office@... eintragen.");
      if (!smtp.smtp_pass && !smtp.smtp_pass_masked) return toast.error("SMTP Passwort fehlt.");
    }
    const patch = buildDirtyPayload(payload, originalSmtpRef.current);
    if (!hasPayloadChanges(patch)) return toast.info("Keine Änderungen zum Speichern.");
    setSavingSmtp(true);
    try { await api.put("/settings/smtp", patch); toast.success("SMTP-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSavingSmtp(false); }
  };
  const clearSmtpSecret = async () => {
    if (!await confirm({ title: "SMTP-Passwort entfernen?", description: "SMTP-Login funktioniert danach erst wieder mit einem neuen Passwort.", confirmLabel: "Passwort entfernen" })) return;
    await api.put("/settings/smtp", { clear_smtp_pass: true });
    toast.success("SMTP-Passwort entfernt.");
    load();
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

  // Läuft der Versand über SMTP, ist ein fehlender Resend-Key kein Problem (#546).
  const mailViaSmtp = (smtp.provider || (smtp.smtp_host ? "smtp" : "resend")) === "smtp";
  const emailNotConfigured = !email.resend_api_key_masked && !mailViaSmtp;
  const filteredQueue = queue.filter((j) => !queueFilter || j.status === queueFilter);
  const queueCounts = queueStats?.counts || {};
  const newsletterOptions = newsletter.kind === "event" ? newsletterSources.events : newsletterSources.news;
  const selectedNewsletterSource = newsletterOptions.find((item) => item.id === newsletter.id || item.slug === newsletter.id);
  const publicDomain = (() => {
    const raw = String(brand.domain || "https://lionsquad.at").trim().replace(/\/+$/, "");
    if (!raw) return "https://lionsquad.at";
    return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  })();
  const indexNowKeyUrl = `${publicDomain}/indexnow-key.txt`;

  const legacyTarget = LEGACY_TAB_REDIRECTS[searchParams.get("tab")];
  if (legacyTarget) return <Navigate to={legacyTarget} replace />;
  // Versandlogs sind seit #517 Teil 2 die Ereignisse mit Quelle E-Mail unter Betrieb & Logs.
  if (section === "mail-logs") return <Navigate to="/admin/ops?tab=events&source=email" replace />;
  if (!sectionMeta) return <Navigate to="/admin/integrations" replace />;
  if (sectionMeta.superOnly && !isSuperadmin) return <Navigate to="/admin/integrations" replace />;

  const authSwitches = (rows) => (
    <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
      {rows.map(([key, label, hint]) => (
        <label key={key} className="flex items-start justify-between gap-4 p-5 cursor-pointer group" data-testid={`auth-toggle-${key}`}>
          <div>
            <div className="font-heading font-bold uppercase text-sm group-hover:text-[#29B6E8] transition">{label}</div>
            <p className="text-xs text-white/50 mt-1">{hint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!authConfig[key]}
            disabled={savingAuth || (key.startsWith("google_") && !authConfig.google_configured)}
            onClick={() => toggleAuth(key)}
            data-testid={`auth-switch-${key}`}
            className={`relative w-12 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${authConfig[key] ? "bg-[#29B6E8]" : "bg-white/15"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${authConfig[key] ? "translate-x-6" : ""}`} />
          </button>
        </label>
      ))}
    </div>
  );

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]" data-testid="settings-eyebrow">{sectionMeta.group}</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6" data-testid="settings-title">{sectionMeta.label}</h1>

      {tab === "auth" && section === "google" && <GoogleLoginSection authConfig={authConfig} setAuthConfig={setAuthConfig} savingAuth={savingAuth} testingGoogle={testingGoogle} saveAuth={saveAuth} testGoogleConfig={testGoogleConfig} authSwitches={authSwitches} />}

      {tab === "auth" && section === "zugang" && <AccessSection authSwitches={authSwitches} />}

      {tab === "email" && <ResendSection email={email} setEmail={setEmail} testEmail={testEmail} setTestEmail={setTestEmail} savingEmail={savingEmail} saveEmail={saveEmail} clearEmailSecret={clearEmailSecret} sendTest={sendTest} mailViaSmtp={mailViaSmtp} emailNotConfigured={emailNotConfigured} />}

      {tab === "smtp" && <SmtpSection user={user} smtp={smtp} setSmtp={setSmtp} smtpTestEmail={smtpTestEmail} setSmtpTestEmail={setSmtpTestEmail} smtpDiag={smtpDiag} smtpDeliverability={smtpDeliverability} savingSmtp={savingSmtp} saveSmtp={saveSmtp} clearSmtpSecret={clearSmtpSecret} applySubmissionPreset={applySubmissionPreset} applyLocalIpPreset={applyLocalIpPreset} sendSmtpTest={sendSmtpTest} diagnoseSmtp={diagnoseSmtp} checkDeliverability={checkDeliverability} />}

      {tab === "newsletter" && <NewsletterSection user={user} newsletterSources={newsletterSources} newsletter={newsletter} setNewsletter={setNewsletter} newsletterPreview={newsletterPreview} setNewsletterPreview={setNewsletterPreview} loadingNewsletterPreview={loadingNewsletterPreview} sendingNewsletter={sendingNewsletter} loadNewsletterSources={loadNewsletterSources} previewNewsletter={previewNewsletter} sendNewsletter={sendNewsletter} newsletterOptions={newsletterOptions} selectedNewsletterSource={selectedNewsletterSource} />}

      {tab === "queue" && <MailQueueSection queue={queue} queueStats={queueStats} queueFilter={queueFilter} setQueueFilter={setQueueFilter} processQueueNow={processQueueNow} recoverQueue={recoverQueue} retryFailedQueue={retryFailedQueue} cleanupQueue={cleanupQueue} retryJob={retryJob} deleteJob={deleteJob} filteredQueue={filteredQueue} queueCounts={queueCounts} />}

      {tab === "brand" && <BrandSection email={email} brand={brand} siteBanners={siteBanners} bannerForm={bannerForm} editingBannerId={editingBannerId} savingBanner={savingBanner} savingBrand={savingBrand} generatingFavicon={generatingFavicon} imageUploadBusy={imageUploadBusy} setBrandField={setBrandField} saveBrand={saveBrand} setBannerField={setBannerField} applyBannerTemplate={applyBannerTemplate} editBanner={editBanner} resetBannerForm={resetBannerForm} saveSiteBanner={saveSiteBanner} deleteSiteBanner={deleteSiteBanner} faviconDarkOnly={faviconDarkOnly} generateUniversalFavicon={generateUniversalFavicon} />}

      {tab === "socials" && <SocialsTab brand={brand} setBrandField={setBrandField} setSocialLink={setSocialLink} addSocialLink={addSocialLink} removeSocialLink={removeSocialLink} saveBrand={saveBrand} saving={imageUploadBusy || savingBrand} />}

      {tab === "seo" && <SeoSection brand={brand} savingBrand={savingBrand} submittingIndexNow={submittingIndexNow} indexNowResult={indexNowResult} imageUploadBusy={imageUploadBusy} setBrandField={setBrandField} saveBrand={saveBrand} submitIndexNow={submitIndexNow} indexNowKeyUrl={indexNowKeyUrl} />}


      {tab === "system" && <SystemSection systemStatus={systemStatus} load={load} />}

    </AdminLayout>
  );
}
