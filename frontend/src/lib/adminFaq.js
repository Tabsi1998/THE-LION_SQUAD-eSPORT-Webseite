// Einrichtung als FAQ (#511, Wunsch des Betreibers 25.09.): pro Frage eine Antwort in Alltagssprache, der
// Weg dorthin (`to`) und - wo es eine Schritt-für-Schritt-Anleitung gibt - der Schlüssel aus
// lib/setupGuides. Die Anleitungen bleiben dort die einzige Quelle; hier werden sie nur eingehängt.

export const FAQ_TOPICS = [
  {
    key: "verein",
    label: "Verein",
    questions: [
      { key: "vereinsdaten", q: "Wo trage ich Name, ZVR-Zahl, Anschrift und den Obmann ein?", a: "Unter Verein → Vereinsdaten. Impressum, Datenschutz und Kontakt auf der Website lesen von dort. Mit Dolibarr-Anbindung kann der Haken „Vereinsdaten aus Dolibarr übernehmen“ das Tippen sparen.", to: "/admin/settings?tab=legal", label: "Verein → Vereinsdaten" },
      { key: "vorstand", q: "Wie stelle ich den Vorstand auf der Website dar?", a: "Verein → Vorstand: Positionen aktivieren, ein Vereinsmitglied und optional eine Stellvertretung zuweisen, eigene Funktionen ergänzen. Obmann/Obfrau richtet sich nach dem Profil-Geschlecht.", to: "/admin/board", label: "Verein → Vorstand" },
      { key: "ueber_uns", q: "Wo ändere ich die Texte auf „Über uns“, Werte und Ziele?", a: "Verein → Über uns. Die Startseite und die Seite „Über uns“ nehmen die Texte von dort.", to: "/admin/about", label: "Verein → Über uns" },
      { key: "sponsoren", q: "Wie lege ich Sponsoren und Partner an?", a: "Verein → Sponsoren bzw. Partner: Logo, Link, Stufe und Laufzeit. Mit Dolibarr-Anbindung kommen Geschäftspartner der Kategorien Sponsor und Partner von selbst.", to: "/admin/sponsors", label: "Verein → Sponsoren" },
      { key: "kontakt", q: "Wo landen Nachrichten aus dem Kontaktformular?", a: "Verein → Kontakt-Inbox. Jede Nachricht löst eine Bestätigung an den Absender und eine Meldung an die Vereins-E-Mail aus (über die Mail-Queue).", to: "/admin/contact", label: "Verein → Kontakt-Inbox" },
      { key: "referenzen", q: "Wo pflege ich Erfolge und Referenzen des Vereins?", a: "Verein → Referenzen: Turniersiege, Platzierungen und Erwähnungen mit Bild, Datum und beteiligten Mitgliedern.", to: "/admin/references", label: "Verein → Referenzen" },
    ],
  },
  {
    key: "mitglieder",
    label: "Mitglieder",
    questions: [
      { key: "aufnahme", q: "Wie nehme ich ein neues Mitglied auf?", a: "Bewerbungen kommen unter Mitglieder → Bewerbungen an; dort annehmen oder ablehnen. Mit Dolibarr-Anbindung im Modus Live entscheidet der Verein im Vereinsmodul, die Website zeigt den Stand.", to: "/admin/membership-applications", label: "Mitglieder → Bewerbungen" },
      { key: "mitgliedschaft", q: "Wo sehe ich, wer aktives Mitglied ist, und ändere den Status?", a: "Mitglieder → Mitglieder: Status, Beitrag, Funktionen, Mitgliedskarte. Führt Dolibarr die Mitgliedschaft, ist der Stand dort gespiegelt und wird hier nur gelesen.", to: "/admin/members", label: "Mitglieder → Mitglieder" },
      { key: "verzeichnis", q: "Wie kommt ein Mitglied ins öffentliche Mitgliederverzeichnis?", a: "Mitglieder → Mitgliederprofile: Karte anlegen oder – mit Dolibarr – per Einwilligung von selbst. Foto, Kurztext, Spiele und Plattformen kommen aus der Mitgliedskarte im Vereinsmodul, wenn sie dort gepflegt sind.", to: "/admin/member-profiles", label: "Mitglieder → Mitgliederprofile" },
      { key: "profil_konto", q: "Wie verknüpfe ich ein Vereinsprofil mit einem Website-Konto?", a: "Mitglieder → Mitgliederprofile → Profil bearbeiten → Kasten „Konto“: Konto suchen (Name, E-Mail, Benutzername), verknüpfen oder lösen, auf Wunsch Bild, Spiele und Plattformen aus dem Konto übernehmen. Ein Profil ist kein Konto und keine Mitgliedschaft – „Profil erstellen“ legt nur das Vereinsprofil an. Ist das Mitglied unter Dolibarr → Zuordnungen seinem Konto zugeordnet, hängt der Abgleich das Konto von selbst ans Profil, und das Mitglied pflegt genau dieses Profil – außer der Vorstand hat das Konto dort gelöst.", to: "/admin/member-profiles", label: "Mitglieder → Mitgliederprofile" },
      { key: "vorteile", q: "Wie trage ich Mitgliedervorteile ein?", a: "Mitglieder → Mitgliedervorteile: Titel, Text, Link, Gültigkeit. Mitglieder sehen sie im Mitgliederbereich und in der App.", to: "/admin/benefits", label: "Mitglieder → Mitgliedervorteile" },
      { key: "dokumente", q: "Wo lade ich Vereinsdokumente für Mitglieder hoch?", a: "Mitglieder → Dokumente (Kategorie, Sichtbarkeit). Statuten und persönliche Belege kommen mit Dolibarr-Anbindung aus der Vereinsakte dazu.", to: "/admin/documents", label: "Mitglieder → Dokumente" },
      { key: "sperren", q: "Wie sperre ich ein Konto oder setze eine Verwarnung?", a: "Mitglieder → Alle Benutzer: Konto sperren oder Rolle ändern. Verwarnungen, Wortfilter und Meldungen stehen unter System → Moderation.", to: "/admin/users", label: "Mitglieder → Alle Benutzer" },
    ],
  },
  {
    key: "dolibarr",
    label: "Dolibarr",
    questions: [
      { key: "verbinden", q: "Wie verbinde ich die Website mit Dolibarr?", a: "Adresse, API-Schlüssel des Website-Benutzers und Umgebung eintragen, „Verbindung testen“, dann Modus Vorschau → Umstellung → Live.", to: "/admin/dolibarr?tab=connection", label: "Dolibarr → Verbindung", guide: "dolibarr" },
      { key: "zuordnung", q: "Wie ordne ich Website-Konten den Mitgliedern in Dolibarr zu?", a: "Dolibarr → Zuordnungen: Vorschläge über die bestätigte E-Mail bestätigen, offene Zuordnungen klären, oder das Mitglied verbindet sich selbst mit einem Einladungscode (Meine Mitgliedschaft).", to: "/admin/dolibarr?tab=links", label: "Dolibarr → Zuordnungen" },
      { key: "vereinsakte", q: "Warum sieht ein Mitglied seine Unterlagen aus der Vereinsakte nicht?", a: "Drei Dinge prüfen: Dolibarr → Zuordnungen – das Konto muss seinem Mitgliedseintrag zugeordnet sein (bestätigt). Dolibarr → Stand – „Vereinsakte ohne Einladungscode“ braucht das Vereinsmodul ab 1.4.0 und beim API-Benutzer der Website das Recht „Über die API im Namen jedes Mitglieds handeln“. Ist beides da, kommen Unterlagen, eigene Daten und Website-Profil von selbst; sonst bleibt der Einladungscode (in Dolibarr unter Einrichtung → Externe Identitäten) der Weg.", to: "/admin/dolibarr?tab=overview", label: "Dolibarr → Stand" },
      { key: "schalter", q: "Wo schalte ich eine Dolibarr-Funktion ein oder aus?", a: "Alle Schalter liegen an einer Stelle: Dolibarr → Funktionen. Je Funktion ein Haken (Vereinsdaten, Kanäle, Sponsoren und Partner, Beitrittsanträge, Rechnungen schreiben) plus die Auswahl dazu (Einwilligung fürs Verzeichnis, Feldzuordnung, Kategorien, Zuordnung per E-Mail). Die Seiten Vereinsdaten, Socials und Sponsoren zeigen nur noch, ob etwas aus Dolibarr kommt. Den Schreibzugriff für Rechnungen schaltet nur „System“; Modus und Verbindung stehen unter Verbindung.", to: "/admin/dolibarr?tab=features", label: "Dolibarr → Funktionen" },
      { key: "stand", q: "Welche Funktionen laufen gerade über Dolibarr?", a: "Dolibarr → Stand zeigt je Funktion (Vereinsdaten, Sponsoren, Beitrittsanträge, Verzeichnis, Rechnungen, Webhook), ob sie an ist und wo der Schalter liegt.", to: "/admin/dolibarr?tab=overview", label: "Dolibarr → Stand" },
      { key: "verzeichnis_einwilligung", q: "Warum erscheint ein Mitglied trotz Einwilligung nicht im Verzeichnis?", a: "Prüfen: Modus Live, unter Verbindung ist der Einwilligungstext gewählt (oder das Modul nennt einen), das Mitglied ist aktiv und hat genau diese Einwilligung erteilt. Dann „Jetzt abgleichen“.", to: "/admin/dolibarr?tab=connection", label: "Dolibarr → Verbindung → Mitgliederverzeichnis" },
      { key: "rechnungen", q: "Wie schreibt die Website Rechnungen nach Dolibarr?", a: "Dolibarr → Verbindung → Schreibzugriff einschalten, Steuersätze prüfen, Rechnungskonditionen (Zahlungsziel, Zahlungsart, Bankkonto) eintragen. Ohne Haken bleiben Aufträge in der Finanzübersicht stehen.", to: "/admin/dolibarr?tab=connection", label: "Dolibarr → Verbindung → Schreibzugriff" },
      { key: "webhook", q: "Wie meldet Dolibarr Änderungen sofort statt alle zehn Minuten?", a: "Dolibarr → Verbindung → Benachrichtigung aus Dolibarr: Adresse erzeugen und im Vereinsmodul als Webhook eintragen.", to: "/admin/dolibarr?tab=connection", label: "Dolibarr → Verbindung → Webhook" },
      { key: "modul_update", q: "Was mache ich nach einem Update des Vereinsmoduls?", a: "ZIP im Dolibarr einspielen, das Modul einmal aus- und wieder einschalten, dann auf der Website „Jetzt abgleichen“. Der Stand zeigt Modulversion und was die Version kann.", to: "/admin/dolibarr?tab=overview", label: "Dolibarr → Stand" },
    ],
  },
  {
    key: "esports",
    label: "Turniere und eSports",
    questions: [
      { key: "turnier", q: "Wie lege ich ein Turnier an?", a: "eSports → Turniere → „Neues Turnier“: Spiel, Format, Termin, Anmeldung, Check-in, Preise. Der Turnier-Leitfaden erklärt Ablauf und Formate.", to: "/admin/tournaments/new", label: "eSports → Turniere → Neu" },
      { key: "leitfaden", q: "Welches Turnierformat passt wofür?", a: "eSports → Turnier-Leitfaden: Ablauf unabhängig vom Spiel, nach Turnierform, welches Format wofür – mit Voreinstellungen zum Übernehmen.", to: "/admin/tournament-guide", label: "eSports → Turnier-Leitfaden" },
      { key: "stationen", q: "Wie verteile ich Spiele auf Stationen beim Event?", a: "eSports → Stationen: Stationen anlegen und Spiele zuweisen; die Turnierleitung sieht die Zuteilung live.", to: "/admin/stations", label: "eSports → Stationen" },
      { key: "fastlap", q: "Wie richte ich eine Fast-Lap-Challenge ein?", a: "eSports → Fast Lap → „Neue Challenge“: Strecken, Zeitraum, Wertung. Bestzeiten melden die Fahrer selbst, die Turnierleitung bestätigt.", to: "/admin/f1/new", label: "eSports → Fast Lap → Neu" },
      { key: "saison", q: "Wie funktioniert die Jahreswertung?", a: "eSports → Jahreswertung: Saison anlegen, Punkte je Turnier und Fast Lap, Podien. Die Startseite zeigt die aktive Saison.", to: "/admin/seasons", label: "eSports → Saisons / Circuit" },
      { key: "spiele", q: "Wo pflege ich die Spiele und ihre Spieler-IDs?", a: "eSports → Spiele: Name, Logo, ob Solo/Teams/FFA, welche Spieler-ID gefragt wird.", to: "/admin/games", label: "eSports → Spiele" },
      { key: "gewinne", q: "Wie gebe ich Gewinne aus und halte die Abholung fest?", a: "eSports → Gewinne: Gewinn je Turnier, Empfänger, Abholung mit Unterschrift oder Vermerk.", to: "/admin/prizes", label: "eSports → Gewinne" },
      { key: "strafen", q: "Wo sehe ich Strafzeiten, ungültige Runden und Forfeits?", a: "eSports → Strafen: alle Vorfälle nach Datum; Spieler sehen ihre eigenen unter „Meine Strafen“.", to: "/admin/penalties", label: "eSports → Strafen" },
      { key: "gameserver", q: "Wie trage ich unsere Game-Server ein?", a: "eSports → Game-Server: Adresse, Spiel, Beschreibung; die Community-Seite zeigt Stand und Spieleranzahl.", to: "/admin/game-servers", label: "eSports → Game-Server" },
    ],
  },
  {
    key: "discord",
    label: "Discord",
    questions: [
      { key: "discord_app", q: "Wie können Mitglieder ihr Discord-Konto verknüpfen?", a: "Die Website braucht Client ID und Secret einer Discord-App und die Rückrufadresse im Developer Portal.", to: "/admin/integrations/discord", label: "Verbindungen → Discord", guide: "discord_app" },
      { key: "discord_channels", q: "Wie kommen News, Events und Turniere automatisch nach Discord?", a: "Der Bot schickt sie: unter Verbindungen → Discord je Zweck einen Kanal wählen (der Bot muss dort schreiben dürfen). Ohne eigenen Kanal geht Öffentliches in den Community-Kanal; Privates (Vorstand, Betrieb) geht nie in einen öffentlichen Kanal. Bot aus heißt: keine Meldung.", to: "/admin/integrations/discord", label: "Verbindungen → Discord", guide: "discord_channels" },
      { key: "discord_bot", q: "Wozu ist der Discord-Bot da und wie schalte ich ihn ein?", a: "Der Bot zählt Aktivität, gleicht Rollen (Mitglied, Vorstand, Turnierleitung) ab und beantwortet Befehle. Er braucht Token, „Server Members Intent“ und die Einladung auf den Server.", to: "/admin/integrations/discord", label: "Verbindungen → Discord", guide: "discord_bot" },
      { key: "discord_no_guild", q: "Der Bot ist online, aber „auf keinem Server“ – was tun?", a: "Entweder ist der Bot noch nicht eingeladen (URL Generator im Developer Portal) oder die Server-ID im Bot-Kasten passt nicht. Feld leer lassen, wenn der Bot nur auf einem Server ist.", to: "/admin/integrations/discord", label: "Verbindungen → Discord" },
    ],
  },
  {
    key: "email",
    label: "E-Mail",
    questions: [
      { key: "resend", q: "Wie verschickt die Website E-Mails (Anmeldung, Passwort, Erinnerungen)?", a: "Über Resend: API-Schlüssel, bestätigte Absender-Domain, Testmail – dann „Versand aktiv“.", to: "/admin/settings/resend", label: "Verbindungen → Resend", guide: "resend" },
      { key: "smtp", q: "Kann ich mein eigenes Postfach statt Resend nehmen?", a: "Ja, über SMTP (Host, Port, Benutzer, Passwort). Es gilt immer nur ein Weg – der aktive steht unter Status.", to: "/admin/settings/smtp", label: "Verbindungen → SMTP", guide: "smtp" },
      { key: "newsletter", q: "Wie schicke ich einen Newsletter an die Mitglieder?", a: "E-Mail → Newsletter: Empfängerkreis, Betreff, Text; nur Konten mit Einwilligung bekommen ihn.", to: "/admin/settings/newsletter", label: "E-Mail → Newsletter" },
      { key: "mail_templates", q: "Kann ich die Texte der Mails ändern, die die Website verschickt?", a: "System → E-Mail-Vorlagen: jede Mail mit Zweck, Empfänger und Variablen; Betreff und Text ändern, Vorschau mit Beispieldaten, Testmail an dich, Zurücksetzen auf den Standard.", to: "/admin/email-templates", label: "System → E-Mail-Vorlagen" },
      { key: "mail_queue", q: "Eine Mail ist nicht angekommen – wo sehe ich, was passiert ist?", a: "E-Mail → Mail-Queue (wartend, fehlgeschlagen) und Betrieb & Logs → Ereignisse, Quelle „E-Mail“ (jede Mail mit Status). Fehlgeschlagene lassen sich neu einreihen.", to: "/admin/settings/mail-queue", label: "E-Mail → Mail-Queue" },
    ],
  },
  {
    key: "konten",
    label: "Login und Konten",
    questions: [
      { key: "verbindungen", q: "Wo sehe ich alle Verbindungen auf einen Blick – und was heißt „nicht lesbar“?", a: "Verbindungen → Alle Verbindungen: jede Anbindung mit Zustand (aktiv, aus, fehlt, Fehler). „Gespeichert, aber nicht lesbar“ heißt: die Zugangsdaten liegen in der Datenbank, passen aber nicht zum Schlüssel SETTINGS_ENCRYPTION_KEY in der .env am Server – meist nach einem Server-Update oder einer Neuinstallation. Alten Schlüssel wiederherstellen, dann sind sie sofort wieder da; sonst die Zugangsdaten auf den betroffenen Seiten neu eintragen.", to: "/admin/integrations", label: "Verbindungen → Alle Verbindungen" },
      { key: "google_login", q: "Wie schalte ich die Anmeldung mit Google ein?", a: "Web-Client-ID aus der Google Cloud Console eintragen, testen, dann die Schalter für Login, Registrierung und nachträgliches Verknüpfen setzen.", to: "/admin/settings/google", label: "Verbindungen → Google", guide: "google_login" },
      { key: "google_pruefung", q: "Google-Prüfung (OAuth-Zustimmungsbildschirm): was muss stimmen?", a: "In der Google Cloud Console: Anwendungsname genau wie der Vereinsname auf der Startseite („THE LION SQUAD“), Startseite https://<Domain>/, Datenschutz https://<Domain>/privacy, Nutzungsbedingungen https://<Domain>/terms. Die Website liefert Google von selbst die vollständige Datenschutzerklärung und eine Startseite mit Zweck und „ohne Anmeldung nutzbar“ – auch ohne JavaScript. Die Datenschutzerklärung nennt jede eingerichtete Verbindung (Google-Anmeldung, YouTube, Discord, Twitch …) automatisch, inklusive des von Google verlangten Hinweises zur API Services User Data Policy.", to: "/privacy", label: "Datenschutzerklärung ansehen" },
      { key: "registrierung", q: "Wie stoppe ich neue Registrierungen?", a: "System → Zugang → „Registrierung offen“ ausschalten. Bestehende Konten melden sich weiter an.", to: "/admin/settings/zugang", label: "System → Zugang" },
      { key: "plattformen", q: "Welche Plattformen können Mitglieder verknüpfen (Steam, Battle.net, Xbox, FACEIT, Roblox …)?", a: "Neunundzwanzig per Anmeldung: Discord, Twitch, Steam, Battle.net, X, YouTube, TikTok, Riot, Xbox, Epic, FACEIT, start.gg, Roblox, osu!, Lichess, GitHub, Kick, Reddit, Spotify, Threads, Facebook, LinkedIn, Snapchat, Pinterest, Telegram, Wargaming.net, Bungie.net, Mastodon, Bluesky. Je Plattform eine Seite unter Verbindungen mit Client ID, Secret, Rückrufadresse und Prüfung (Steam und Lichess brauchen keine App, Wargaming nur die Application ID, Bungie zusätzlich den API Key; Meta, LinkedIn, Snap und Pinterest verlangen ein App-Review, vorher dürfen nur Tester verknüpfen; Mastodon und Bluesky sind dezentral – das Mitglied nennt Instanz bzw. Handle, die Website registriert sich selbst). Eingerichtet heißt: der Knopf „Mit … verknüpfen“ erscheint im Profil. PlayStation, Nintendo, EA, Ubisoft, Rockstar und GOG bieten keine Anmeldung für Websites – die bleiben getippt. Unter Alle Verbindungen → Plattformen für Mitglieder lässt sich jede Plattform abhaken („Alle an“ / „Alle aus“): abgehakte erscheinen weder im Profil noch in der App noch in der Datenschutzerklärung; eingetragene Namen bleiben gespeichert.", to: "/admin/integrations/steam", label: "Verbindungen → Steam", guide: "steam" },
      { key: "twitch", q: "Wie erkennt die Website, dass der Vereinskanal live ist?", a: "Twitch-App (Client ID und Secret) und Vereinskanal unter Verbindungen → Twitch; die Live-Leiste erscheint dann von selbst.", to: "/admin/integrations/twitch", label: "Verbindungen → Twitch", guide: "twitch" },
    ],
  },
  {
    key: "content",
    label: "Inhalte und Auftritt",
    questions: [
      { key: "news", q: "Wie veröffentliche ich eine News?", a: "Content → News → „Neuer Beitrag“: Titel, Text, Bild, Sichtbarkeit (öffentlich oder nur Mitglieder). Mit Discord-Webhook geht sie auch in den Kanal.", to: "/admin/news/new", label: "Content → News → Neu" },
      { key: "events", q: "Wie lege ich ein Event mit Programm an?", a: "Content → Events → „Neues Event“: Ort, Zeit, Programmpunkte, Turniere und Fast-Lap-Challenges ins Programm nehmen.", to: "/admin/events/new", label: "Content → Events → Neu" },
      { key: "galerie", q: "Wie stelle ich Fotos in die Galerie?", a: "Content → Galerie: Album anlegen, Bilder hochladen, sichtbar schalten. Der Medien-Browser zeigt alle hochgeladenen Dateien.", to: "/admin/gallery", label: "Content → Galerie" },
      { key: "branding", q: "Wo ändere ich Logo, Farben, Favicon und die Hinweisleiste?", a: "Auftritt → Branding: Logos (hell/dunkel), Akzentfarbe, Favicon aus dem Logo erzeugen, Hinweisleisten.", to: "/admin/settings/branding", label: "Auftritt → Branding" },
      { key: "socials", q: "Wo trage ich die Social-Media-Kanäle des Vereins ein?", a: "Auftritt → Socials – oder mit Dolibarr der Haken „Kanäle aus Dolibarr übernehmen“.", to: "/admin/settings/socials", label: "Auftritt → Socials" },
      { key: "seo", q: "Wie richte ich Analytics und die Google Search Console ein?", a: "Auftritt → SEO & Analytics: Anbieter (Google Analytics 4 oder Plausible), Mess-ID, Bestätigungen für Google und Bing, IndexNow.", to: "/admin/settings/seo", label: "Auftritt → SEO & Analytics", guide: "analytics" },
      { key: "navigation", q: "Wie ändere ich die Menüpunkte der Website?", a: "Content → Navigation: Einträge, Reihenfolge, Sichtbarkeit. Die Seiten selbst (Über uns, Werte, Impressum, Datenschutz) pflegst du unter Verein → Über uns und Vereinsdaten.", to: "/admin/nav", label: "Content → Navigation" },
      { key: "downloads", q: "Wo bekomme ich QR-Codes und Downloads für Events?", a: "Content → Downloads & QR: QR-Code zur Anmeldung, zur App, zu Turnieren; Widgets für externe Seiten.", to: "/admin/downloads", label: "Content → Downloads & QR" },
    ],
  },
  {
    key: "app",
    label: "LionsAPP",
    questions: [
      { key: "play_store", q: "Wie kommt der Play-Store-Link auf die Website?", a: "Auftritt → Branding → Play-Store-Link. Bis zur Veröffentlichung steht „bald bei Google Play“.", to: "/admin/settings/branding", label: "Auftritt → Branding", guide: "play_store" },
      { key: "app_versionen", q: "Wie rolle ich eine neue App-Version aus?", a: "System → App-Versionen: Build hochladen oder Release eintragen, Mindestversion setzen; die App zeigt dann den Hinweis zum Update.", to: "/admin/app-releases", label: "System → App-Versionen" },
      { key: "push", q: "Wie prüfe ich, ob Push-Nachrichten ankommen?", a: "System → Push-Tests: Testnachricht an ein Konto schicken, Zustellung und Fehler je Gerät ansehen.", to: "/admin/mobile-push", label: "System → Push-Tests" },
      { key: "app_logs", q: "Wo sehe ich Abstürze und Fehler aus der App?", a: "System → Betrieb & Logs → App-Logs: Client-Logs mit Gerät, Version und Meldung, mit Status und Notiz je Eintrag.", to: "/admin/ops?tab=app", label: "System → Betrieb & Logs → App-Logs" },
    ],
  },
  {
    key: "betrieb",
    label: "Betrieb und Sicherheit",
    questions: [
      { key: "status", q: "Läuft alles? Wo sehe ich Datenbank, Mail, Scheduler und Uploads?", a: "System → Status: Ampeln für Datenbank, SMTP/Mail, Discord, Uploads, Scheduler, Mail-Queue und die Upload-Pfade.", to: "/admin/settings/status", label: "System → Status" },
      { key: "ereignisse", q: "Wo sehe ich alle Ereignisse an einem Ort – Fehler, Checks, Mails, Adminaktionen, App?", a: "System → Betrieb & Logs → Ereignisse: eine Liste über alle Quellen (Serverfehler, Auto-Checks, Alarme, App-Logs, E-Mail-Versand, Mail-Queue, Adminaktionen, Uploads, Dolibarr-Abgleich, Discord-Bot) mit Filter nach Quelle, Schwere, Zeitraum und Text; „Als CSV“ lädt die Auswahl herunter. Der Überblick zeigt je Quelle die Auffälligkeiten und die neuesten Probleme.", to: "/admin/ops?tab=events", label: "System → Betrieb & Logs → Ereignisse" },
      { key: "betrieb", q: "Wo stehen Serverfehler und Auto-Checks?", a: "System → Betrieb & Logs: rote Auto-Checks und neue Serverfehler; mit Betriebskanal (Discord-Bot) auch als Alarm in einen privaten Discord-Kanal.", to: "/admin/ops", label: "System → Betrieb & Logs" },
      { key: "audit", q: "Wer hat was im Admin geändert?", a: "System → Betrieb & Logs → Ereignisse, Quelle „Adminaktionen“: jede Adminaktion mit Konto, Zeit und Details – mit Filter nach Aktion, Zeitraum und Text, als CSV exportierbar.", to: "/admin/ops?tab=events&source=audit", label: "System → Betrieb & Logs → Ereignisse" },
      { key: "moderation", q: "Wie moderiere ich Meldungen, Wortfilter und hochgeladene Bilder?", a: "System → Moderation: Meldungen, Wortfilter-Funde, Personen, Verwarnungsstufen und die Bildprüfung (automatisch geprüfte Uploads freigeben oder entfernen).", to: "/admin/moderation", label: "System → Moderation" },
      { key: "zwei_faktor", q: "Warum verlangt der Adminbereich eine Zwei-Faktor-Anmeldung?", a: "Für Admin-, Vorstands- und Turnierleitungs-Konten ist die bestätigte Zwei-Faktor-Anmeldung Pflicht. Einrichten unter Mein Profil → Sicherheit.", to: "/profile", label: "Mein Profil → Sicherheit" },
    ],
  },
];

const norm = (text) => String(text || "").toLowerCase();

/** Alle Fragen flach - für Tests und Zähler. */
export function faqQuestions() {
  return FAQ_TOPICS.flatMap((topic) => topic.questions.map((question) => ({ ...question, topic: topic.key })));
}

/** Themen mit den Fragen, die zur Suche passen (Frage, Antwort, Weg, Thema); leere Suche = alles. */
export function filterFaq(query) {
  const needle = norm(query).trim();
  if (!needle) return FAQ_TOPICS;
  const words = needle.split(/\s+/).filter(Boolean);
  return FAQ_TOPICS.map((topic) => ({
    ...topic,
    questions: topic.questions.filter((question) => {
      const haystack = norm(`${topic.label} ${question.q} ${question.a} ${question.label} ${question.guide || ""}`);
      return words.every((word) => haystack.includes(word));
    }),
  })).filter((topic) => topic.questions.length > 0);
}
