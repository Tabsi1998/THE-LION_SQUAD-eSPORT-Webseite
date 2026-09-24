// Datenschutzerklärung aus den echten Schaltern (Rechtliches II) - reine Helfer ohne React:
// aus `privacy_facts` der öffentlichen Einstellungen wird, welche Abschnitte die Seite zeigt und
// mit welchen Worten. Kein Abschnitt in der Möglichkeitsform mehr.

export const DEFAULT_FACTS = Object.freeze({
  analytics: "", google_login: false, passkeys: true, discord: { webhooks: false, bot: false }, twitch_embed: false,
  email_provider: "none", dolibarr: false, dolibarr_billing: false, app: { push: true, crash_reports: true, app_lock: true },
  hosting: { provider: "", country: "" },
  media_scan: { enabled: false, provider: "off" },
});

export function normalizeFacts(raw) {
  const facts = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_FACTS,
    ...facts,
    discord: { ...DEFAULT_FACTS.discord, ...(facts.discord || {}) },
    app: { ...DEFAULT_FACTS.app, ...(facts.app || {}) },
    hosting: { ...DEFAULT_FACTS.hosting, ...(facts.hosting || {}) },
    media_scan: { ...DEFAULT_FACTS.media_scan, ...(facts.media_scan || {}) },
  };
}

// Welche Abschnitte erscheinen - in dieser Reihenfolge.
export function privacySections(raw) {
  const f = normalizeFacts(raw);
  const sections = ["account"];
  sections.push("email");
  if (f.discord.webhooks || f.discord.bot) sections.push("discord");
  sections.push("analytics");
  if (f.twitch_embed) sections.push("twitch");
  if (f.dolibarr) sections.push("dolibarr");
  if (f.media_scan.enabled) sections.push("media_scan");
  sections.push("app");
  return sections;
}

export function emailProviderText(provider) {
  if (provider === "resend") {
    return "Der Versand läuft über den E-Mail-Dienstleister Resend (Resend, Inc., USA). Übermittelt werden Empfängeradresse, Betreff und Inhalt der jeweiligen Nachricht; Resend ist Auftragsverarbeiter, Grundlage sind die EU-Standardvertragsklauseln (Art. 46 DSGVO).";
  }
  if (provider === "smtp") {
    return "Der Versand läuft über einen eigenen Mailserver des Vereins. Ein Dienstleister erhält dabei keine Daten.";
  }
  return "Derzeit ist kein E-Mail-Versand eingerichtet; Systemnachrichten werden nicht per E-Mail verschickt.";
}

export function analyticsText(provider) {
  if (provider === "google") {
    return "Wir setzen Google Analytics 4 (Google Ireland Ltd.) ein – erst nach deiner Zustimmung im Cookie-Dialog. Erhoben werden gekürzte IP-Adresse, Seitenaufrufe, Gerät und Browser; Google kann die Daten in den USA verarbeiten (EU-Standardvertragsklauseln). Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), widerrufbar über die Cookie-Einstellungen.";
  }
  if (provider === "plausible") {
    return "Wir setzen Plausible Analytics ein – ohne Cookies und ohne Wiedererkennung einzelner Personen; erhoben werden Seitenaufrufe, Herkunftsseite, Land und Gerätetyp in aggregierter Form. Rechtsgrundlage ist unser berechtigtes Interesse an Reichweitenmessung (Art. 6 Abs. 1 lit. f DSGVO).";
  }
  return "Wir setzen keinen Statistik- oder Tracking-Dienst ein. Es gibt keine Werbe-Cookies und kein Profiling.";
}

export function hostingText(hosting) {
  const provider = (hosting?.provider || "").trim();
  const country = (hosting?.country || "").trim();
  if (!provider && !country) return "";
  const where = country ? ` (${country})` : "";
  return provider.toLowerCase().startsWith("eigen")
    ? `Die Website läuft auf eigener Infrastruktur des Vereins${where}.`
    : `Die Website wird bei ${provider}${where} betrieben; der Anbieter ist Auftragsverarbeiter.`;
}

// Bildprüfung (#415): selbst gehostet bleibt alles im Haus; Google heißt, das Bild geht nach draußen.
export function mediaScanText(provider) {
  if (provider === "google_vision") {
    return "Dafür wird das Bild an Google Cloud Vision (Google Ireland Ltd.; EU-Standardvertragsklauseln) übermittelt und dort bewertet, aber nicht gespeichert.";
  }
  if (provider && provider !== "off") {
    return "Die Prüfung läuft mit einem Erkennungsmodell auf unserem eigenen Server; kein Bild wird dafür an Dritte übermittelt.";
  }
  return "";
}
