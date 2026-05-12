# THE LION SQUAD eSPORT Webseite

Offizielle Vereins- und eSports-Plattform fuer **THE LION SQUAD**.

Die Anwendung ist eine selbst gehostete Full-Stack-Webseite mit oeffentlicher Vereinsseite,
Mitgliederbereich, Adminbereich, Turnieren, Fast-Lap-Challenges, News, Events, Galerie,
Dokumenten, Achievements, Kontaktformular, Mailversand und Discord-Integrationen.

## Aktueller Stand

- Frontend: React, Tailwind, Nginx
- Backend: FastAPI, MongoDB
- Betrieb: Docker Compose
- Domain: `https://lionsquad.at`
- API: `/api`
- Uploads: persistentes Docker-Volume
- Auth: JWT ueber httpOnly Cookies mit CSRF-Schutz
- Admin-Setup: per `.env` und Admin-Oberflaeche

## Hauptfunktionen

- Oeffentliche Webseite mit Home, Verein, Vorstand, Werte, News, Events, Galerie, Sponsoren, Kontakt, Impressum und Datenschutz.
- Mitgliederbereich mit Dashboard, Mitgliedsdaten, Vorteilen, Dokumenten, News und geschuetzten Inhalten.
- Profile mit Avatar, Banner, Bio, Social/Gaming-Daten, Sichtbarkeit und Achievements.
- Freundschaftssystem mit Anfragen, Annahme/Ablehnung, Freundesliste und Direktnachrichten aus oeffentlichen Profilen.
- Teamverwaltung mit Leader, Co-Leader, Mitgliedern, Einladungen, Team-Chat und Squads/Subteams.
- Community-Serverbereich mit Zugriffsstufen fuer oeffentliche Server, eingeloggte Community und Vereinsmitglieder.
- Adminbereich fuer Benutzer, Mitglieder, Mitgliedsantraege, Turniere, Fast Lap, Events, News, Sponsoren, Galerie, Dokumente, Board, Navigation, CMS und Systemeinstellungen.
- Turnier- und Matchverwaltung mit Registrierungen, Check-in, Brackets, Ergebnissen und TV-Anzeigen.
- Flexible Turnierstrukturen fuer Duel und FFA, Custom-Brackets, automatische Slot-Weiterleitung und Heat-Ergebnisse.
- In-App-Benachrichtigungen fuer Station-Zuweisungen und bestaetigte bzw. korrigierte Match-Ergebnisse.
- F1/Fast-Lap-Challenges mit Strecken, Zeiten, Strafen, Ranglisten, Display-Modus
  und getrennten Vereins-Referenzzeiten ausser Wertung.
- Zeitplanung fuer Turniere und Fast-Lap-Challenges: Registrierung/Einreichung oeffnet,
  Registrierung/Einreichung endet, Start/Ende, Status `scheduled`, `registration_open`,
  `registration_closed` und `live`.
- Scheduler wechselt geplante Turniere/Challenges automatisch anhand der eingetragenen Zeiten
  von `scheduled` zu `registration_open`, danach zu `registration_closed` und ab Start zu `live`.
- Mail-Queue mit SMTP oder Resend, Testmail, Diagnose und Versandlogs.
- Discord Webhook fuer automatische Benachrichtigungen.
- Branding-Hauptsettings fuer Vereinsname, Logo, Maskottchen, Favicon, Farben, Domain und Kontaktmail.
- Rechtliche Vereinsdaten fuer Tirol/Oesterreich: Adresse, ZVR-Zahl, Vertretung, Vereinsbehoerde, Impressum, Datenschutz und optionale Preisturnier-Hinweise.
- Systemstatus fuer SMTP, Discord, Uploads, Scheduler, Mailqueue und letzte Fehler.

## Repository-Struktur

```text
backend/      FastAPI API, Datenmodelle, Routen, Services
frontend/     React App, Admin UI, Public UI, Nginx Build
tests/        vorhandene Test- und Pruefdateien
memory/       lokale Projekt-/Agentennotizen
docker-compose.yml
.env.example
INSTALL.md
UPDATE.md
ADMIN_GUIDE.md
OPERATIONS.md
LIVE_TESTS.md
BACKUP_RESTORE.md
ROLE_AUDIT.md
TOURNAMENT_CUSTOM_BRACKETS.md
```

## Schnellstart Produktion

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
cp .env.example .env
nano .env
docker compose up -d --build
```

Danach:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

Die Webseite ist standardmaessig am Host-Port `3000`, die API am Host-Port `8001`.
Hinter einem Reverse Proxy sollte die Webseite ueber `https://lionsquad.at` laufen.

## Wichtige `.env` Werte

```env
APP_ENV=production
FRONTEND_URL=https://lionsquad.at
PUBLIC_BACKEND_URL=https://lionsquad.at
CORS_ORIGINS=https://lionsquad.at,https://www.lionsquad.at

DB_NAME=tls_arena
JWT_SECRET=sehr-langer-zufaelliger-secret
ADMIN_EMAIL=admin@lionsquad.at
ADMIN_PASSWORD=sehr-langes-admin-passwort

SEED_DEMO=false
DISABLE_SCHEDULER=false
UPLOAD_DIR=/app/backend/uploads
MAX_IMAGE_UPLOAD_MB=50
MAX_DOCUMENT_UPLOAD_MB=50
PROXY_UPLOAD_LIMIT_MB=60
AUTH_COOKIE_DOMAIN=.lionsquad.at
```

Wenn die Seite sowohl unter `lionsquad.at` als auch unter `www.lionsquad.at` erreichbar ist,
setze `AUTH_COOKIE_DOMAIN=.lionsquad.at` und nimm beide Origins in `CORS_ORIGINS` auf. Sonst
kann ein Login auf einer Host-Variante fuer die andere Host-Variante unsichtbar sein.

`JWT_SECRET` und `ADMIN_PASSWORD` muessen in Produktion gesetzt sein. Docker Compose bricht
sonst bewusst ab.

## Deployment und Updates

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
./update.sh u
```

Nach jedem Update pruefen:

```bash
curl -I https://lionsquad.at
curl https://lionsquad.at/api/health
docker compose ps
```

Lokaler Schnellcheck vor Commit oder groesseren Deployments:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quick-check.ps1
```

Fuer reine Backend-Aenderungen kann der Frontend-Build uebersprungen werden:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quick-check.ps1 -SkipFrontendBuild
```

Weitere Details:

- [UPDATE.md](UPDATE.md) fuer den normalen Update-Ablauf.
- [OPERATIONS.md](OPERATIONS.md) fuer Betrieb, Proxy, Uploads, Logs und Rollback.
- [ADMIN_GUIDE.md](ADMIN_GUIDE.md) fuer Admin-Pflege von Medien, Mitgliedern, Vorstand, Achievements, Discord, Twitch, Events und Sponsoren.
- [LIVE_TESTS.md](LIVE_TESTS.md) fuer Live-Tests gegen `lionsquad.at`.

## Deployment-Checkliste

Vor Livegang oder nach groesseren Updates:

- `.env` pruefen: `APP_ENV=production`, `FRONTEND_URL`, `PUBLIC_BACKEND_URL`, `CORS_ORIGINS`, `JWT_SECRET`, `ADMIN_PASSWORD`, `AUTH_COOKIE_DOMAIN`.
- `docker compose ps` muss `backend`, `frontend` und `mongodb` als laufend zeigen.
- `docker compose logs --tail=100 backend` auf Fehler pruefen.
- `curl https://lionsquad.at/api/health` muss `{"status":"ok"}` liefern.
- Adminbereich oeffnen und `Einstellungen -> Status` pruefen.
- SMTP Diagnose, SMTP Testmail und Zustellbarkeit pruefen.
- Discord Test senden, falls Webhook genutzt wird.
- Upload-Test im Branding oder Medienbereich durchfuehren.
- `/imprint` und `/privacy` mit echten Vereinsdaten kontrollieren.
- Backup ausloesen und mindestens Archivtests aus `BACKUP_RESTORE.md` ausfuehren.
- Rollen-/Rechte-Audit in `ROLE_AUDIT.md` gegen neue Features pruefen.

## Reverse Proxy

Empfohlene Variante:

- `https://lionsquad.at` zeigt auf den Frontend-Container.
- `/api/*` wird an den Backend-Container weitergeleitet.
- Websocket-Sonderregeln sind aktuell nicht erforderlich.
- HTTPS per Let's Encrypt aktivieren.
- HTTP auf HTTPS weiterleiten.

Wenn Nginx Proxy Manager auf dem Docker-Host laeuft:

```text
Frontend Ziel: 127.0.0.1:3000
Backend/API:   127.0.0.1:8001
```

## Admin Erststart

1. Webseite oeffnen.
2. Login mit `ADMIN_EMAIL` und `ADMIN_PASSWORD` aus `.env`.
3. Admin-Passwort direkt aendern.
4. Unter `Admin -> Einstellungen` Branding, SMTP, Discord, Rechtliches und Systemstatus pruefen.
5. Unter `Admin -> Navigation` nicht benoetigte Menuepunkte deaktivieren.

## Branding, Favicon und Hauptsettings

Im Adminbereich unter `Einstellungen -> Branding` pflegen:

- Vereinsname
- Tagline
- SEO-Beschreibung
- Akzentfarbe
- Domain
- Zeitzone
- Kontakt-E-Mail
- Discord Einladung
- Twitch Channel
- Vereinslogo
- Maskottchen
- Favicon / Browser Icon

Diese Werte werden oeffentlich genutzt, unter anderem fuer Header/Footer, Kontaktseite,
Browser-Favicon, Apple Icon, Manifest, Theme-Color und SEO-Meta.

## Twitch und Live-Streams

- Twitch wird pro Account erkannt, wenn ein Twitch-Name im Profil hinterlegt ist.
- Der Twitch-Embed auf einer oeffentlichen Profilseite bleibt eine Profil-Einstellung.
- Der Live-Bereich auf der Startseite zeigt nur aktive bzw. Ehren-Vereinsmitglieder mit aktivem Vereinsprofil.
- Normale Community-Profile koennen ihren Twitch-Embed im Profil anzeigen, erscheinen aber nicht im Startseiten-Live-Slider.

## Community-Server

Der Tab `Community -> Server` zeigt Gameserver aus `/api/game-servers`. Admins pflegen
sie unter `Admin -> Game-Server`.

Produktive Installationen starten ohne automatisch angelegte Server. Die fruehere
Demo-Startliste wird nur noch importiert, wenn `SEED_GAME_SERVERS=true` oder
`SEED_DEMO=true` gesetzt ist. Falls aus einer alten Version bereits Startserver in
der Datenbank liegen, kann sie ein Admin unter `Admin -> Game-Server` mit
`Demo-Startliste entfernen` bereinigen. Selbst angelegte Server werden dabei nicht
geloescht.

Sichtbarkeiten:

- `Oeffentlich`: fuer jeden Besucher sichtbar.
- `Community`: nur nach Login sichtbar.
- `Vereinsmitglieder`: nur fuer aktive Vereinsmitglieder und Admins sichtbar.
- `Intern`: nicht oeffentlich sichtbar.

Spielerzahlen, Max-Slots, Map, Version, Adresse und Connect-Link koennen manuell
gepflegt oder ueber eine Sync-Quelle aktualisiert werden:

- `Manuell`: Werte werden im Adminbereich gepflegt.
- `Minecraft Query`: nutzt den Minecraft Server List Ping.
- `Steam/A2S Query`: nutzt die Valve/Steam Server Query fuer Spiele mit A2S-Unterstuetzung.
- `RCON erreichbar`: prueft zunaechst nur TCP-Erreichbarkeit am RCON-Port.
- `AMP API`: nutzt die AMP-API der jeweiligen Installation.

AMP stellt seine API pro Installation unter `/API` bereit; vor API-Aufrufen muss
eine Session ueber `API/Core/Login` geholt werden. Zugangsdaten werden nicht an
die oeffentliche API ausgeliefert.

Empfohlene Sync-Auswahl:

- `Minecraft`: `Automatisch oeffentlich` oder `Minecraft Query`, Port normalerweise `25565`.
- `Rust`, `ARK`, `Assetto Corsa Competizione`, `Satisfactory`, viele SteamCMD-Server:
  `Automatisch oeffentlich` oder `Steam/A2S Query`, falls der Query-Port erreichbar ist.
- `Palworld`, `Core Keeper`, `7 Days To Die`: je nach Server-Konfiguration `Steam/A2S Query`
  oder als Mindeststatus `RCON erreichbar`/TCP-Port.
- Wenn ein Spiel keine oeffentliche Query sauber beantwortet: `Manuell` oder `AMP API`.

Fuer die Darstellung koennen pro Server ein Icon/Logo, Karten-Link, externe Statusseite,
Regel-Link, Connect-Link und Wartungsnotiz gepflegt werden. Logos werden nicht automatisch
aus fremden Quellen gezogen, damit keine fremden Marken- oder Hotlink-Abhaengigkeiten
entstehen; bevorzugt wird ein gepflegtes Spiel-Logo aus `Admin -> Spiele` oder ein
servereigenes Icon.

Zugangsdaten werden getrennt von der Serveradresse gepflegt:

- `Passwort`: fuer Spiele mit klassischem Serverpasswort.
- `Invite-Code`: fuer Spiele wie Windrose oder Systeme mit Einladungs-Code.
- `Whitelist / Freischaltung`: zeigt nur den Hinweis, dass eine Freischaltung noetig ist.
- `Im Discord`: zeigt nur den Hinweis, dass der Zugang im Discord steht.

Passwort und Invite-Code werden in der Serverkarte maskiert angezeigt und koennen nur
von Personen abgerufen und kopiert werden, die den Server wegen seiner Sichtbarkeit
sehen duerfen. Die Serverliste liefert Secrets nicht gesammelt aus; der echte Wert
wird erst beim Klick auf `Kopieren` geladen.
Im Adminbereich bleiben gespeicherte Secrets beim Bearbeiten erhalten, wenn das Feld
leer gelassen wird.

## SEO, Google und Link-Vorschauen

Oeffentliche Detailseiten fuer News, Events, Turniere, Fast-Lap-Challenges,
Saisons, Galerie-Alben sowie Profile liefern dynamische Meta-Daten aus:

- `title`, `description` und Canonical-URL
- Open-Graph-Tags fuer WhatsApp, Discord, Facebook, LinkedIn und aehnliche Dienste
- Twitter/X Summary Card
- JSON-LD fuer Google und andere Suchmaschinen

Normale Besucher bekommen weiterhin die React-App. Bekannte Crawler/Bots werden
ueber Nginx auf `/api/seo/preview?path=/...` geleitet und erhalten eine kleine
HTML-Seite mit passenden Meta-Tags. Dadurch koennen geteilte Links auch dann
korrekt erkannt werden, wenn der Dienst kein JavaScript ausfuehrt.

Wichtig fuer saubere Share-Bilder:

- Branding-Domain muss auf die oeffentliche HTTPS-Adresse zeigen.
- News/Event/Turnier/Galerie-Bilder sollten oeffentlich erreichbar sein.
- Wenn WhatsApp oder Discord ein altes Bild zeigt, ist meist deren Cache aktiv.
  Dann den Link spaeter erneut testen oder bei hartnaeckigen Faellen das Bild
  neu hochladen, damit sich die Bild-URL aendert.

## Impressum und Datenschutz

Im Adminbereich unter `Einstellungen -> Rechtliches` pflegen:

- rechtlicher Vereinsname
- ZVR-Zahl
- Vereinsadresse
- Vereinssitz in Tirol
- Vereinsbehoerde
- vertretungsbefugte Person und Funktion
- inhaltlich verantwortliche Person
- Datenschutzkontakt
- Hosting-/Betreiberhinweis
- UID, falls vorhanden
- Turnierbedingungen-URL, falls vorhanden
- Kennzeichnung, ob Preisturniere oder Turniere mit Startgeld moeglich sind
- Freitexte fuer Impressum und Datenschutz

Die Seiten `/imprint` und `/privacy` ziehen diese Werte dynamisch. Wenn einzelne Angaben
noch fehlen, zeigt die Seite bewusst einen Hinweis an, damit fehlende Pflichtdaten auffallen.
Die Texte sind fuer einen nicht gewinnorientierten Verein mit Standort Tirol vorbereitet.
Bei Startgeld, Zahlungsabwicklung, Sponsoring, Webshop oder regelmaessiger wirtschaftlicher
Taetigkeit sollten die Angaben rechtlich final gegengeprueft werden.

## Systemstatus

Unter `Admin -> Einstellungen -> Status` prueft die App:

- MongoDB Ping
- SMTP/Mail-Konfiguration und letzter Versandfehler
- Discord Webhook und letzter Discord-Status
- Upload-Verzeichnisse und Schreibrechte
- Scheduler-Jobs
- Mailqueue-Zahlen

Das ersetzt keine Serverlogs, gibt aber direkt im Adminbereich eine schnelle Ampel.

## SMTP richtig konfigurieren

Die App kann E-Mails ueber Resend oder ueber einen eigenen SMTP-Server senden.
Fuer deinen lokalen Mailserver ist die IP als Host erlaubt.

Empfohlene Einstellung fuer lokalen Mailserver per IP:

```text
Provider: SMTP
Host: 192.168.2.106
Port: 587
Sicherheit: Auto nach Port
TLS Zertifikat pruefen: aus, wenn self-signed oder Zertifikat passt nicht zur IP
SMTP Anmeldung: Mit Benutzer/Passwort
User: office@lionsquad.at
Passwort: Mailbox-Passwort
Absendername: THE LION SQUAD
Absender E-Mail: office@lionsquad.at
Antworten an: office@lionsquad.at
Message-ID Domain: lionsquad.at
HELO/EHLO Name: leer lassen oder optional den Mailhost-Namen
```

Wichtig:

- Der SMTP Host darf direkt die lokale IP sein. Dafuer ist keine Host-Domain noetig.
- `Auto nach Port` funktioniert wie beim OmniFM-Bot: `465 = SSL/TLS`, `25 = ohne TLS`, alles andere = `STARTTLS`.
- `Message-ID Domain` und `HELO/EHLO Name` sind Mail-/Header-Identitaet, nicht der SMTP Host.
- `Message-ID Domain` darf leer bleiben; dann nutzt die App die Domain der Absender-E-Mail.
- `HELO/EHLO Name` darf leer bleiben; dann nutzt die SMTP-Bibliothek ihren Standardnamen.
- `192.168.2.106:25` ist klassischer Server-zu-Server-SMTP.
- Wenn Port 25 kein AUTH anbietet, ist das kein normaler Client-Versand.
- Ohne AUTH auf Port 25 waere externer Versand ein Relay-Betrieb.
- Wenn kein Relay gewuenscht ist, muss am Mailserver auf derselben IP ein Submission-Port laufen: meistens `587 STARTTLS` oder `465 SSL/TLS`.
- Bei lokaler IP und Zertifikatsfehler: `TLS Zertifikat pruefen` deaktivieren oder ein Zertifikat verwenden, dessen Name zum SMTP Host passt.

Im Admin gibt es:

- `Standard 587 Login`
- `Lokale IP vorbereiten`
- `Diagnose`
- `Zustellbarkeit`
- `Testmail`

Die Diagnose prueft Verbindung, STARTTLS, AUTH, Login, MAIL FROM und RCPT TO.
Wenn der eingestellte Port kein AUTH anbietet oder Relay verweigert, prueft die Diagnose
zusaetzlich typische Ports auf demselben Host: `587 STARTTLS`, `465 SSL/TLS`, `25 STARTTLS`
und `25 ohne TLS`.

`Zustellbarkeit` prueft DNS- und Header-Grundlagen fuer Gmail: SPF, DMARC, MX,
Domain-Alignment, HELO/EHLO und Hinweise zu DKIM. Wichtig: Eine erfolgreiche SMTP-Testmail
bedeutet nur, dass dein lokaler Mailserver die Mail angenommen hat. Ob Gmail sie annimmt,
steht im Mailserver-Log bzw. in der Mailserver-Queue.

## Mail-Zustellbarkeit

Damit Mails nicht im Spam landen:

- SPF fuer die sendende IP erlauben.
- DKIM fuer `lionsquad.at` signieren.
- DMARC setzen.
- PTR/rDNS der sendenden IP passend konfigurieren.
- HELO/EHLO Name passend setzen.
- Absender, Envelope-Sender und Message-ID Domain konsistent halten.
- Keine fremde From-Adresse verwenden, die der SMTP-User nicht senden darf.

## Uploads und Medien

Uploads werden im Docker-Volume `uploads_data` gespeichert und ueber
`/api/static/uploads/...` ausgeliefert.

Bild-Uploads erlauben PNG/JPG/WebP standardmaessig bis 50 MB. Der Frontend-Nginx im Container erlaubt
Requests bis 60 MB. Wenn vor Docker noch ein externer Reverse Proxy wie Nginx Proxy Manager,
Apache, Cloudflare oder ein Hosting-Panel sitzt, muss dort ebenfalls ein Body-Limit von
mindestens 60 MB gesetzt werden, sonst kommt weiterhin `413 Request Entity Too Large`, bevor
die App den Upload ueberhaupt sieht.

Die Limits koennen in `.env` angepasst werden:

```env
MAX_IMAGE_UPLOAD_MB=50
MAX_DOCUMENT_UPLOAD_MB=50
PROXY_UPLOAD_LIMIT_MB=60
```

Bilduploads gibt es fuer Profile, Branding, News, Events, Galerie, Sponsoren, Turniere,
Fast-Lap-Challenges und Fast-Lap-Strecken.

## Moderatoren und Ergebnisverwaltung

Moderatoren haben keinen vollen Adminbereich. Sie duerfen aber operative Ergebnisse pflegen:

- Turnierliste und Turnierdetail im Adminbereich oeffnen.
- Matchscores im Turnierdetail direkt eintragen.
- Fast-Lap-Challenges oeffnen.
- Fast-Lap-Zeiten eintragen, bearbeiten und loeschen.

System-, Branding-, Benutzer-, Rollen-, Mail- und Rechtseinstellungen bleiben Adminrollen
vorbehalten.

## Fast-Lap Vereins-Referenzzeiten

Fast-Lap-Challenges haben drei getrennte Einstellungen:

- `Vereinsmitglieder aus offizieller Wertung ausschliessen`: fuer externe Challenges, bei
  denen Vereinsmitglieder nicht offiziell teilnehmen sollen.
- `Vereins-Referenzzeiten erlauben`: Zeiten ausser Wertung. Diese Zeiten zaehlen nicht fuer
  Rangliste, Season-Punkte oder Achievements.
- `Referenzzeiten oeffentlich anzeigen`: zeigt die Top-3-Referenzzeiten auf der Challenge-
  und TV-Ansicht. Wenn deaktiviert, bleiben sie nur im Admin sichtbar.

Wenn `Unbegrenzte Versuche` deaktiviert ist, erzwingt die API das eingestellte
Versuchslimit getrennt fuer offizielle Zeiten und Referenzzeiten.

Unterstuetzt fuer Bilder:

- PNG
- JPG/JPEG
- WebP

Typische Bereiche:

- Branding Logo
- Maskottchen
- Favicon
- Sponsorenlogos
- Galerie
- Profilbilder und Banner

## Discord

Discord-Benachrichtigungen werden ueber Webhooks angebunden.

Im Adminbereich:

- Webhook URL eintragen
- Bot-Name setzen
- Avatar URL optional setzen
- Testnachricht senden

Erlaubt sind Discord Webhook URLs im Format:

```text
https://discord.com/api/webhooks/...
```

Wichtig: Webhooks senden nur Nachrichten in Discord. Fuer automatische
Discord-Aktivitaet/Achievements braucht es spaeter einen echten Discord-Bot
mit Gateway-Events, der `discord_messages_count` pro verknuepftem Konto aktualisiert.

## Rechtliches

`/imprint` und `/privacy` sind vorhanden und nutzen die Branding-Hauptsettings.
Die rechtlichen Inhalte muessen im Adminbereich mit den echten Vereinsdaten gepflegt werden:

- vollstaendiger Vereinsname
- Rechtsform
- Zustelladresse
- ZVR-Zahl
- vertretungsbefugte Personen
- Kontaktadresse
- Datenschutzkontakt
- verwendete Dienstleister

## Backup und Restore

Siehe:

- [BACKUP_RESTORE.md](BACKUP_RESTORE.md)

Kurzform Backup:

```bash
docker exec tls-mongodb mongodump --archive=/tmp/tls.archive --gzip --db tls_arena
docker cp tls-mongodb:/tmp/tls.archive ./tls.archive
```

Uploads separat sichern:

```bash
docker run --rm -v the-lion_squad-esport-webseite_uploads_data:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tar.gz -C /data .
```

## Troubleshooting

### Docker Compose warnt wegen fehlender Variablen

`.env` fehlt oder Werte sind leer. `.env.example` kopieren und Werte setzen.

### Backend startet in Produktion nicht

Pruefen:

```bash
docker compose logs backend
```

Haeufige Ursachen:

- `JWT_SECRET` zu kurz oder leer
- `ADMIN_PASSWORD` leer
- `FRONTEND_URL` fehlt
- MongoDB nicht gesund

### SMTP: AUTH extension is not supported

Der Port bietet keinen Login an. Fuer normalen Versand:

```text
Port 587 + STARTTLS + SMTP Anmeldung
```

Wenn nur Port 25 offen ist, muss am Mailserver Submission aktiviert werden.

### SMTP: Relay access denied

Der Mailserver akzeptiert die Verbindung, erlaubt aber externe Empfaenger nicht.
Ohne Relay muss stattdessen SMTP AUTH auf Port 587 oder 465 genutzt werden.

### SMTP: CERTIFICATE_VERIFY_FAILED

Bei lokaler IP passt das Zertifikat oft nicht zum Hostnamen.
Entweder `TLS Zertifikat pruefen` deaktivieren oder den Zertifikatsnamen als SMTP Host nutzen.

### Upload: Ein Fehler ist aufgetreten

Pruefen:

```bash
docker compose logs backend
docker volume ls
```

Nur PNG/JPG/WebP verwenden und Dateigroesse beachten. Bei `413` muss neben der App auch jeder
externe Reverse Proxy groesser als das App-Limit eingestellt sein, z.B. Nginx Proxy Manager:

```nginx
client_max_body_size 60m;
```

## Entwicklung lokal

Frontend:

```bash
cd frontend
corepack yarn install
corepack yarn start
```

Backend benoetigt Python 3.11 und MongoDB. Fuer die Produktion ist Docker Compose der
empfohlene Weg.

Build pruefen:

```bash
cd frontend
corepack yarn build
```

## Offene sinnvolle Verbesserungen

- Impressum und Datenschutz mit echten finalen Vereinsdaten befuellen.
- Admin-Dashboard fuer Systemstatus erweitern: SMTP, Discord, Uploads, Scheduler, Health.
- E-Mail-Templates weiter vereinheitlichen und rechtlich pruefen.
- Achievements/Profilbereich weiter visuell polieren.
- Backups automatisieren und Restore-Test dokumentieren.
- Monitoring und Logrotation fuer den Server einrichten.

## Lizenz

Proprietaer. Nutzung und Weitergabe nur fuer THE LION SQUAD bzw. nach Freigabe.
