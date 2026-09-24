// Einrichtungsanleitungen für den Admin (Wunsch des Betreibers, 24.09.): je Dienst die Schritte in
// der Reihenfolge, in der man sie klickt, mit den Links zu den Entwickler-Konsolen und den Werten
// zum Kopieren. `{origin}` wird beim Anzeigen durch die Adresse der Website ersetzt. Die Anleitungen
// stehen auf der Seite „Einrichtung“ und aufklappbar direkt im jeweiligen Reiter.

export const SETUP_GUIDES = {
  discord_app: {
    key: "discord_app",
    title: "Discord: Konten verknüpfen (OAuth2-App)",
    where: { to: "/admin/integrations/discord", label: "Verbindungen → Discord" },
    summary: "Mitglieder melden sich im Profil einmal bei Discord an, der Name wird eingetragen und trägt „verifiziert“. Dafür braucht die Website Client ID und Client Secret einer Discord-App – am einfachsten dieselbe App wie der Bot.",
    steps: [
      { text: "Discord Developer Portal öffnen und die App des Bots anklicken (oder „New Application“).", link: { href: "https://discord.com/developers/applications", label: "Developer Portal" } },
      { text: "Links „OAuth2“ wählen. Unter „Client information“ die Client ID kopieren und hier bei „Discord Client ID“ eintragen." },
      { text: "Dort „Reset Secret“ klicken, das neue Secret kopieren und hier bei „Discord Client Secret“ eintragen – es wird nur einmal angezeigt." },
      { text: "Unter „Redirects“ auf „Add Redirect“ klicken und genau diese Adresse eintragen, dann „Save Changes“:", copy: "{origin}/api/platform-links/discord/callback" },
      { text: "Hier „Speichern“ und dann „Discord prüfen“ – die Prüfung sagt, ob Client ID, Secret und Rückrufadresse passen." },
      { text: "Test: im eigenen Profil → Socials → „Mit Discord verknüpfen“. Ein Fehler nennt dort den Grund." },
    ],
    notes: ["Der Bot-Token allein reicht nicht – die Verknüpfung braucht OAuth2 (Client ID + Secret).", "Ändert sich die Domain, muss die Rückrufadresse in Discord mit geändert werden."],
    checkPlatform: "discord",
  },
  discord_bot: {
    key: "discord_bot",
    title: "Discord-Bot (Aktivität, Rollen, Befehle)",
    where: { to: "/admin/integrations/discord", label: "Verbindungen → Discord" },
    summary: "Der Bot zählt Aktivität, gleicht Mitgliederrollen ab und beantwortet Befehle. Er braucht einen Bot-Token, den „Server Members Intent“ und eine Einladung auf den Server.",
    steps: [
      { text: "Developer Portal → deine App → links „Bot“.", link: { href: "https://discord.com/developers/applications", label: "Developer Portal" } },
      { text: "„Reset Token“ klicken, den Token kopieren und hier im Bot-Bereich eintragen (wird verschlüsselt gespeichert, nie wieder angezeigt)." },
      { text: "Auf derselben Seite unter „Privileged Gateway Intents“ den Schalter „Server Members Intent“ einschalten, dann „Save Changes“. „Message Content Intent“ bleibt aus – der Bot liest keine Inhalte. Ohne den Schalter lehnt Discord die Verbindung ab; der Bot versucht es dann alle fünf Minuten von selbst wieder." },
      { text: "Links „OAuth2“ → „URL Generator“: Scopes „bot“ und „applications.commands“ anhaken; Bot Permissions: „View Channels“, „Send Messages“, „Read Message History“, „Manage Roles“. Die erzeugte Adresse im Browser öffnen und den Bot auf den Vereinsserver einladen." },
      { text: "Server-ID: in Discord unter Einstellungen → Erweitert den „Entwicklermodus“ einschalten, dann Rechtsklick auf den Server → „Server-ID kopieren“ – hier eintragen (leer = der Server, auf dem der Bot ist)." },
      { text: "Rollen: die Rollennamen für Mitglieder und Vorstand hier eintragen; die Bot-Rolle muss in Discord über diesen Rollen stehen (Server-Einstellungen → Rollen → Reihenfolge), sonst darf er sie nicht vergeben." },
      { text: "„Bot einschalten“ und speichern. Der Stand (online, Server, letzter Rollenabgleich) steht direkt darunter." },
    ],
    notes: ["Rollen bekommen nur Konten mit bestätigter Discord-Verknüpfung (siehe Konten verknüpfen)."],
  },
  discord_webhooks: {
    key: "discord_webhooks",
    title: "Discord-Meldungen (Webhooks je Zweck)",
    where: { to: "/admin/integrations/discord", label: "Verbindungen → Discord" },
    summary: "News, Events und Turniere, Erfolge, Vorstand und Betriebsalarme gehen über Webhooks in je einen Kanal. Ein Webhook ist eine Adresse, die Discord für einen Kanal erzeugt.",
    steps: [
      { text: "In Discord: Server-Einstellungen → „Integrationen“ → „Webhooks“ → „Neuer Webhook“." },
      { text: "Name vergeben (z. B. „LION News“), den Zielkanal wählen, „Webhook-URL kopieren“." },
      { text: "Hier bei dem passenden Zweck einfügen (News, Events/Turniere, Erfolge, Vorstand, Betrieb) und speichern. Ein Webhook darf für mehrere Zwecke stehen." },
      { text: "Mit „Testnachricht“ prüfen; unter „Ereignisse“ je Ereignis ein- oder ausschalten." },
    ],
    notes: ["Erlaubt sind nur Adressen, die mit https://discord.com/api/webhooks/ beginnen.", "Der Betriebs-Webhook bekommt nur Alarme – am besten ein Kanal, den nur der Vorstand sieht."],
  },
  twitch: {
    key: "twitch",
    title: "Twitch: Live-Erkennung und Konten verknüpfen",
    where: { to: "/admin/integrations/twitch", label: "Verbindungen → Twitch" },
    summary: "Eine Twitch-App (Helix) erkennt, wer gerade live ist, und lässt Mitglieder ihr Twitch-Konto verknüpfen. Das Twitch-Konto, das die App anlegt, braucht Zwei-Faktor.",
    steps: [
      { text: "Twitch Developer Console öffnen (mit dem Vereinskonto anmelden) → „Register Your Application“.", link: { href: "https://dev.twitch.tv/console/apps", label: "Twitch Developer Console" } },
      { text: "Name z. B. „THE LION SQUAD Website“. Bei „OAuth Redirect URLs“ genau diese Adresse eintragen (ohne Schrägstrich am Ende):", copy: "{origin}/api/platform-links/twitch/callback" },
      { text: "Category „Website Integration“, Client Type „Confidential“ → „Create“." },
      { text: "Bei der App auf „Manage“: die Client ID kopieren → hier „Twitch Client ID“. „New Secret“ klicken, kopieren → hier „Twitch Client Secret“. Speichern." },
      { text: "„TLS Twitch Channel“ = der Kanalname des Vereins (nur der Name, keine Adresse) – so erscheint der Vereinsstream auf der Startseite." },
      { text: "„Twitch prüfen“ unter Login & Konten sagt, ob Client ID und Secret passen. Mitglieder tragen ihren Kanal im Profil → Socials ein oder verknüpfen ihn dort; der Schalter „Live-Embed“ zeigt den Stream im Profil." },
    ],
    notes: ["Die Live-Erkennung fragt Twitch regelmäßig ab (Stand unter „Live-Erkennung“).", "Die Rückrufadresse kann Twitch nicht per API bestätigen – bei „redirect_mismatch“ im Profil-Hinweis fehlt sie in der Console."],
    checkPlatform: "twitch",
  },
  google_login: {
    key: "google_login",
    title: "Google-Login",
    where: { to: "/admin/settings/google", label: "Verbindungen → Google" },
    summary: "Anmeldung mit dem Google-Konto über ein Google-Cloud-Projekt des Vereins. Es braucht nur eine Web-Client-ID, kein Secret.",
    steps: [
      { text: "Google Cloud Console → Projekt anlegen oder wählen (z. B. „THE LION SQUAD Website“).", link: { href: "https://console.cloud.google.com/apis/credentials", label: "Google Cloud Console – Anmeldedaten" } },
      { text: "„OAuth-Zustimmungsbildschirm“: Nutzertyp „Extern“, App-Name, Support-E-Mail, Logo optional, Bereiche „email“ und „profile“ – dann „Veröffentlichen“ (sonst können sich nur Testnutzer anmelden)." },
      { text: "„Anmeldedaten erstellen“ → „OAuth-Client-ID“ → Anwendungstyp „Webanwendung“." },
      { text: "Bei „Autorisierte JavaScript-Quellen“ die Adresse der Website eintragen:", copy: "{origin}" },
      { text: "Erstellen, die Client-ID (endet auf .apps.googleusercontent.com) kopieren und hier bei „Google Web Client ID“ speichern; „Konfiguration testen“." },
      { text: "Den Schalter „Google-Login“ einschalten. Bestehende Konten verknüpfen sich beim ersten Google-Login über die gleiche E-Mail-Adresse." },
    ],
    notes: ["Eine Weiterleitungs-URI ist nicht nötig – die Anmeldung läuft über Google Identity Services im Browser."],
  },
  steam: {
    key: "steam",
    title: "Steam (optional: Anzeigename statt ID)",
    where: { to: "/admin/integrations/steam", label: "Verbindungen → Steam" },
    summary: "Steam-Verknüpfung braucht keine App. Mit einem Web-API-Schlüssel zeigt die Website den Steam-Anzeigenamen statt der 17-stelligen ID.",
    steps: [
      { text: "Steam Web-API-Schlüssel anfordern (mit einem Steam-Konto, das nicht eingeschränkt ist); als Domain die Website eintragen.", link: { href: "https://steamcommunity.com/dev/apikey", label: "Steam Web API Key" } },
      { text: "Den Schlüssel hier bei „Steam Web-API-Schlüssel“ eintragen und speichern." },
      { text: "Steam fragt beim Verknüpfen nur diese Adresse zurück – nichts einzutragen:", copy: "{origin}/api/platform-links/steam/callback" },
    ],
    notes: [],
    checkPlatform: "steam",
  },
  battlenet: {
    key: "battlenet",
    title: "Battle.net (BattleTag verknüpfen)",
    where: { to: "/admin/integrations/battlenet", label: "Verbindungen → Battle.net" },
    summary: "Ein Battle.net-Client der Website – Mitglieder verknüpfen ihren BattleTag per Anmeldung bei Blizzard.",
    steps: [
      { text: "Battle.net Developer Portal öffnen (Battle.net-Konto des Vereins) → „Create Client“.", link: { href: "https://develop.battle.net/access/clients", label: "Battle.net – API Access" } },
      { text: "Client Name, Service URL = Adresse der Website, Intended Use kurz beschreiben. Bei „Redirect URLs“ eintragen:", copy: "{origin}/api/platform-links/battlenet/callback" },
      { text: "Client ID und Client Secret kopieren → hier bei Battle.net eintragen, speichern, „prüfen“." },
    ],
    notes: ["Blizzard liefert nur BattleTag und Konto-Kennung."],
    checkPlatform: "battlenet",
  },
  x: {
    key: "x",
    title: "X (Twitter) verknüpfen",
    where: { to: "/admin/integrations/x", label: "Verbindungen → X (Twitter)" },
    summary: "Eine X-App mit OAuth 2.0 (Free-Tarif reicht). Mitglieder verknüpfen ihren X-Nutzernamen per Anmeldung bei X.",
    steps: [
      { text: "X Developer Portal → Projekt und App anlegen (Free).", link: { href: "https://developer.x.com/en/portal/dashboard", label: "X Developer Portal" } },
      { text: "Bei der App „User authentication settings“ → „Set up“: App permissions „Read“, Type of App „Web App, Automated App or Bot“." },
      { text: "Callback URI / Redirect URL:", copy: "{origin}/api/platform-links/x/callback" },
      { text: "Website URL = Adresse der Website, speichern. Unter „Keys and tokens“ die OAuth 2.0 Client ID und das Client Secret kopieren → hier eintragen, speichern, „prüfen“." },
    ],
    notes: ["Die Website liest nur Kennung, Nutzername und Anzeigename (Scope users.read)."],
    checkPlatform: "x",
  },
  youtube: {
    key: "youtube",
    title: "YouTube-Kanal verknüpfen (Google)",
    where: { to: "/admin/integrations/youtube", label: "Verbindungen → YouTube" },
    summary: "Über das Google-Projekt des Vereins: Mitglieder melden sich bei Google an, die Website liest nur, welcher YouTube-Kanal dazugehört.",
    steps: [
      { text: "Google Cloud Console → dasselbe Projekt wie beim Google-Login → „APIs & Dienste“ → „YouTube Data API v3“ aktivieren.", link: { href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", label: "YouTube Data API v3 aktivieren" } },
      { text: "„Anmeldedaten“ → OAuth-Client vom Typ „Webanwendung“ (der Login-Client geht auch). Bei „Autorisierte Weiterleitungs-URIs“ eintragen:", copy: "{origin}/api/platform-links/youtube/callback", link: { href: "https://console.cloud.google.com/apis/credentials", label: "Anmeldedaten" } },
      { text: "Client-ID und Client-Secret kopieren → hier bei YouTube eintragen und speichern." },
      { text: "OAuth-Zustimmungsbildschirm: Bereich „…/auth/youtube.readonly“ hinzufügen. Solange die App nicht von Google geprüft ist, zeigt Google eine Warnung – das ist normal, die Verknüpfung geht trotzdem (bis 100 Nutzer)." },
    ],
    notes: ["Ohne YouTube-Kanal auf dem Google-Konto bricht die Verknüpfung mit einem Hinweis ab."],
    checkPlatform: "youtube",
  },
  tiktok: {
    key: "tiktok",
    title: "TikTok verknüpfen (Login Kit)",
    where: { to: "/admin/integrations/tiktok", label: "Verbindungen → TikTok" },
    summary: "Eine TikTok-App mit Login Kit. TikTok schaltet die Anmeldung erst nach Prüfung der App frei; vorher geht nur ein Sandbox-Test.",
    steps: [
      { text: "TikTok for Developers → „Manage apps“ → App anlegen (Name, Beschreibung, Website).", link: { href: "https://developers.tiktok.com/", label: "TikTok for Developers" } },
      { text: "Produkt „Login Kit“ hinzufügen; Redirect URI:", copy: "{origin}/api/platform-links/tiktok/callback" },
      { text: "Scopes „user.info.basic“ und „user.info.profile“ anhaken, App zur Prüfung einreichen." },
      { text: "Client Key und Client Secret kopieren → hier bei TikTok eintragen, speichern." },
    ],
    notes: ["Bis zur Freigabe durch TikTok funktioniert die Verknüpfung nur für in der Sandbox eingetragene Testkonten."],
    checkPlatform: "tiktok",
  },
  riot: {
    key: "riot",
    title: "Riot ID verknüpfen (Riot Sign On)",
    where: { to: "/admin/integrations/riot", label: "Verbindungen → Riot Games" },
    summary: "Riot Sign On (RSO) gibt es nur nach Antrag bei Riot. Danach verknüpfen Mitglieder ihre Riot ID (Name#TAG) per Anmeldung bei Riot.",
    steps: [
      { text: "Riot Developer Portal → mit dem Riot-Konto anmelden → „Register Product“ (Produkt: die Vereinswebsite) und dort RSO beantragen.", link: { href: "https://developer.riotgames.com/", label: "Riot Developer Portal" } },
      { text: "Nach Freigabe beim RSO-Client die Redirect URI eintragen:", copy: "{origin}/api/platform-links/riot/callback" },
      { text: "Client ID und Client Secret → hier bei Riot Games eintragen, speichern." },
    ],
    notes: ["Ohne Freigabe durch Riot bleibt das Feld getippt.", "Die Website liest nur PUUID und Riot ID (Name#TAG)."],
    checkPlatform: "riot",
  },
  xbox: {
    key: "xbox",
    title: "Xbox-Gamertag verknüpfen (Microsoft)",
    where: { to: "/admin/integrations/xbox", label: "Verbindungen → Xbox" },
    summary: "Eine App-Registrierung bei Microsoft (Azure). Mitglieder melden sich mit dem Microsoft-Konto an; die Website holt daraus den Gamertag.",
    steps: [
      { text: "Azure-Portal → „App-Registrierungen“ → „Neue Registrierung“.", link: { href: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade", label: "Azure – App-Registrierungen" } },
      { text: "Name z. B. „THE LION SQUAD Website“; unterstützte Kontotypen „Nur persönliche Microsoft-Konten“; Umleitungs-URI (Web):", copy: "{origin}/api/platform-links/xbox/callback" },
      { text: "Übersicht: „Anwendungs-ID (Client)“ kopieren → hier „Anwendungs-ID“. „Zertifikate & Geheimnisse“ → „Neuer geheimer Clientschlüssel“ → den Wert (nicht die ID) kopieren → hier „Geheimer Clientschlüssel“. Speichern, „prüfen“." },
    ],
    notes: ["Die Website fragt „XboxLive.signin“ ab und liest nur XUID und Gamertag.", "Microsoft-Konten ohne Xbox-Profil brechen mit einem Hinweis ab."],
    checkPlatform: "xbox",
  },
  epic: {
    key: "epic",
    title: "Epic-Games-Konto verknüpfen",
    where: { to: "/admin/integrations/epic", label: "Verbindungen → Epic Games" },
    summary: "Epic Account Services: Organisation und Produkt im Epic Developer Portal, eine Anwendung mit Markenprüfung, dann verknüpfen Mitglieder ihren Epic-Anzeigenamen.",
    steps: [
      { text: "Epic Developer Portal → Organisation anlegen → Produkt anlegen (die Vereinswebsite).", link: { href: "https://dev.epicgames.com/portal", label: "Epic Developer Portal" } },
      { text: "Produkt → „Product Settings“ → „Clients“ → Client anlegen; „Epic Account Services“ → Anwendung anlegen, Berechtigung „Basic Profile“, den Client verknüpfen, Markenprüfung (Brand Review) einreichen." },
      { text: "Bei der Anwendung die Redirect URL eintragen:", copy: "{origin}/api/platform-links/epic/callback" },
      { text: "Client ID und Client Secret → hier bei Epic Games eintragen, speichern, „prüfen“." },
    ],
    notes: ["Bis zur Markenprüfung funktioniert die Anmeldung nur für Testkonten der Organisation."],
    checkPlatform: "epic",
  },
  resend: {
    key: "resend",
    title: "E-Mail-Versand über Resend",
    where: { to: "/admin/settings/resend", label: "Verbindungen → Resend" },
    summary: "Resend verschickt die Mails der Website (Anmeldung, Mitgliedschaft, Newsletter). Es braucht einen API-Schlüssel und eine bestätigte Absender-Domain.",
    steps: [
      { text: "Bei Resend anmelden → „API Keys“ → „Create API Key“ (Berechtigung „Sending access“). Den Schlüssel kopieren und hier bei „Resend API“ eintragen.", link: { href: "https://resend.com/api-keys", label: "Resend – API Keys" } },
      { text: "„Domains“ → „Add Domain“ → die Vereinsdomain eintragen. Resend zeigt DNS-Einträge (TXT für SPF und DKIM, MX für Rückläufer) – diese beim Domain-Anbieter anlegen und in Resend „Verify“ klicken.", link: { href: "https://resend.com/domains", label: "Resend – Domains" } },
      { text: "Absendername und Absenderadresse hier eintragen (z. B. noreply@ deiner Domain), Antwortadresse = Vereinspostfach." },
      { text: "„Testmail senden“ – kommt sie an, „Versand aktiv“ einschalten." },
    ],
    notes: ["Ohne bestätigte Domain landen Mails im Spam oder werden abgelehnt.", "Alternativ geht ein eigener SMTP-Server (Reiter SMTP)."],
  },
  smtp: {
    key: "smtp",
    title: "Eigener SMTP-Server (statt Resend)",
    where: { to: "/admin/settings/smtp", label: "Verbindungen → SMTP" },
    summary: "Wer ein eigenes Postfach beim Hoster hat, kann darüber senden. Die Zugangsdaten kommen vom Mail-Anbieter.",
    steps: [
      { text: "Beim Mail-Anbieter die SMTP-Daten nachsehen: Server (Host), Port (587 mit STARTTLS oder 465 mit SSL), Benutzername (meist die volle Adresse), Passwort." },
      { text: "Hier eintragen, Absendername und Absenderadresse setzen, speichern." },
      { text: "„SMTP Testmail“ senden. Kommt sie im Spam an: SPF und DKIM beim Anbieter für die Domain aktivieren." },
    ],
    notes: ["Es gilt immer nur ein Weg: Resend oder SMTP – der aktive steht unter Systemstatus."],
  },
  analytics: {
    key: "analytics",
    title: "Analytics (Google Analytics 4 oder Plausible)",
    where: { to: "/admin/settings/seo", label: "Auftritt → SEO & Analytics" },
    summary: "Besucherzahlen. Google Analytics braucht eine Mess-ID (G-…), Plausible nur die Domain. Ohne Auswahl wird nichts gezählt.",
    steps: [
      { text: "Google Analytics: Verwaltung → Datenstreams → Web-Stream der Website → „Mess-ID“ (beginnt mit G-) kopieren.", link: { href: "https://analytics.google.com/", label: "Google Analytics" } },
      { text: "Hier „Analytics“ auf Google stellen, die Mess-ID bei „Google Measurement ID“ eintragen, speichern." },
      { text: "Plausible: Website hinzufügen, hier „Analytics“ auf Plausible stellen und die Domain eintragen.", link: { href: "https://plausible.io/sites", label: "Plausible" } },
      { text: "Steht Analytics auf Google ohne Mess-ID, zählt nichts – dann entweder die ID eintragen oder auf „Keine“ stellen." },
    ],
    notes: ["Der Cookie-Hinweis der Website fragt die Zustimmung ab, bevor gezählt wird."],
  },
  search_console: {
    key: "search_console",
    title: "Suchmaschinen: Google Search Console, Bing, IndexNow",
    where: { to: "/admin/settings/seo", label: "Auftritt → SEO & Analytics" },
    summary: "Damit Google und Bing die Website kennen und neue Seiten schnell aufnehmen.",
    steps: [
      { text: "Google Search Console → „Property hinzufügen“ → „URL-Präfix“ mit der Adresse der Website → Bestätigungsmethode „HTML-Tag“: den Wert aus content=\"…\" kopieren und hier bei „Google Site Verification“ eintragen, speichern, dann in der Console „Bestätigen“.", link: { href: "https://search.google.com/search-console", label: "Google Search Console" } },
      { text: "Bing Webmaster Tools → Website hinzufügen → Bestätigung „Meta-Tag“: den Wert von msvalidate.01 hier eintragen, speichern, dann bestätigen.", link: { href: "https://www.bing.com/webmasters", label: "Bing Webmaster Tools" } },
      { text: "IndexNow: einen Schlüssel erzeugen (32 Zeichen, Buchstaben und Ziffern), hier bei „IndexNow Key“ eintragen – neue Seiten meldet die Website damit selbst.", link: { href: "https://www.indexnow.org/", label: "IndexNow" } },
    ],
    notes: ["Die Sitemap liegt unter /sitemap.xml – in der Search Console unter „Sitemaps“ einreichen."],
  },
  play_store: {
    key: "play_store",
    title: "Google Play: Link zur LionsAPP",
    where: { to: "/admin/settings/branding", label: "Auftritt → Branding" },
    summary: "Der Play-Store-Knopf im Footer erscheint erst, wenn hier der Link steht – und der darf laut Google erst gesetzt werden, wenn der Store-Eintrag öffentlich ist.",
    steps: [
      { text: "Play Console → App → Store-Eintrag veröffentlicht? Dann „Im Google Play Store ansehen“ und die Adresse kopieren.", link: { href: "https://play.google.com/console", label: "Google Play Console" } },
      { text: "Hier bei „Play-Store-Link (LionsAPP)“ eintragen und speichern:", copy: "https://play.google.com/store/apps/details?id=at.lionsquad.app" },
    ],
    notes: ["Solange der Eintrag nur im internen oder geschlossenen Test ist, bleibt das Feld leer."],
  },
  dolibarr: {
    key: "dolibarr",
    title: "Dolibarr-Anbindung (Mitglieder, Beiträge, Rechnungen)",
    where: { to: "/admin/dolibarr?tab=connection", label: "Mitglieder → Dolibarr → Verbindung" },
    summary: "Dolibarr mit dem Vereinsmodul führt Mitgliedschaft, Beiträge und Funktionen. Die Website liest den Stand und schreibt Rechnungen – Schritt für Schritt auf der Dolibarr-Seite.",
    steps: [
      { text: "Auf der Dolibarr-Seite den Reiter „Verbindung“ öffnen: Adresse, API-Schlüssel des Website-Benutzers, Umgebung. Die Rechte des Benutzers stehen dort unter „So richtest du es in Dolibarr ein“." },
      { text: "„Verbindung testen“ → „Verbunden“. Dann Modus „Vorschau“, unter „Umstellung“ Mitgliedsarten zuordnen und Konten bestätigen, dann Modus „Live“." },
      { text: "Der Reiter „Stand“ zeigt je Funktion (Vereinsdaten, Sponsoren, Beitrittsanträge, Rechnungen …), ob sie an ist und wo der Schalter liegt." },
    ],
    notes: [],
  },
};

export const SETUP_GUIDE_ORDER = ["discord_app", "discord_bot", "discord_webhooks", "twitch", "google_login", "steam", "battlenet", "x", "youtube", "tiktok", "riot", "xbox", "epic", "resend", "smtp", "analytics", "search_console", "play_store", "dolibarr"];

export function resolveGuideValue(value, origin) {
  return String(value || "").replaceAll("{origin}", origin || "");
}

// Stand je Anleitung aus den vorhandenen Admin-Daten - „ok“, „missing“, „optional“ oder „unknown“.
export function guideStatus(key, data = {}) {
  const { branding = null, discord = null, auth = null, email = null, smtp = null, dolibarr = null, links = null } = data;
  const ok = (text) => ({ state: "ok", text });
  const missing = (text) => ({ state: "missing", text });
  const optional = (text) => ({ state: "optional", text });
  const unknown = { state: "unknown", text: "Stand nicht geladen" };
  switch (key) {
    case "discord_app":
      if (!links) return unknown;
      return links.discord ? ok("App eingetragen") : missing("Client ID oder Secret fehlt");
    case "discord_bot":
      if (!discord) return unknown;
      return discord.bot?.configured ? ok(discord.bot?.connected ? "Bot online" : "Token da, Bot aus oder offline") : missing("Bot-Token fehlt");
    case "discord_webhooks":
      if (!discord) return unknown;
      return discord.configured ? ok(discord.enabled ? "Webhook aktiv" : "Webhook da, Versand aus") : missing("Kein Webhook");
    case "twitch":
      if (!branding) return unknown;
      return branding.twitch_client_id && branding.twitch_client_secret_masked ? ok(branding.twitch_channel ? `App und Kanal ${branding.twitch_channel}` : "App da, Vereinskanal fehlt") : missing("Client ID oder Secret fehlt");
    case "google_login":
      if (!auth) return unknown;
      return auth.google_configured ? ok(auth.google_login_enabled ? "Client-ID da, Login an" : "Client-ID da, Login aus") : missing("Client-ID fehlt");
    case "steam":
      if (!branding) return unknown;
      return branding.steam_api_key_masked ? ok("Schlüssel da") : optional("Ohne Schlüssel bleibt die ID");
    case "battlenet": case "x": case "youtube": case "tiktok": case "riot": case "xbox": case "epic":
      if (!links) return unknown;
      return links[key] ? ok("App eingetragen") : optional("Noch nicht angebunden");
    case "resend":
      if (!email) return unknown;
      return email.resend_api_key_masked ? ok(email.enabled ? "Schlüssel da, Versand an" : "Schlüssel da, Versand aus") : missing("API-Schlüssel fehlt");
    case "smtp":
      if (!smtp) return unknown;
      return smtp.smtp_host ? ok(smtp.smtp_host) : optional("Kein eigener Server");
    case "analytics":
      if (!branding) return unknown;
      if (branding.analytics_provider === "google") return branding.google_analytics_id ? ok(`Google ${branding.google_analytics_id}`) : missing("Google ohne Mess-ID – zählt nichts");
      if (branding.analytics_provider === "plausible") return branding.plausible_domain ? ok(`Plausible ${branding.plausible_domain}`) : missing("Plausible ohne Domain");
      return optional("Kein Analytics");
    case "search_console":
      if (!branding) return unknown;
      return branding.google_site_verification || branding.msvalidate_01 || branding.indexnow_key ? ok([branding.google_site_verification && "Google", branding.msvalidate_01 && "Bing", branding.indexnow_key && "IndexNow"].filter(Boolean).join(", ")) : optional("Noch nichts eingetragen");
    case "play_store":
      if (!branding) return unknown;
      return branding.play_store_url ? ok("Link da") : optional("Erst mit öffentlichem Eintrag");
    case "dolibarr":
      if (!dolibarr) return unknown;
      return dolibarr.mode && dolibarr.mode !== "off" ? ok(dolibarr.mode === "live" ? "Modus Live" : "Modus Vorschau") : missing("Nicht angebunden");
    default:
      return unknown;
  }
}
