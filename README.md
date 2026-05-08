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
- Adminbereich fuer Benutzer, Mitglieder, Mitgliedsantraege, Turniere, Fast Lap, Events, News, Sponsoren, Galerie, Dokumente, Board, Navigation, CMS und Systemeinstellungen.
- Turnier- und Matchverwaltung mit Registrierungen, Check-in, Brackets, Ergebnissen und TV-Anzeigen.
- Flexible Turnierstrukturen fuer Duel und FFA, Custom-Brackets, automatische Slot-Weiterleitung und Heat-Ergebnisse.
- F1/Fast-Lap-Challenges mit Strecken, Zeiten, Strafen, Ranglisten und Display-Modus.
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
