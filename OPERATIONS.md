# Betriebs-Handbuch

Dieses Dokument beschreibt Betrieb, Updates, Checks und typische Fehler auf dem Ubuntu-Server.

## Standard-Update

Auf dem Server wird normalerweise nur das Update-Script verwendet:

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
./update.sh u
```

Der Parameter `u` ist fuer deinen Arbeitsablauf okay. Das Script arbeitet aus dem Repository-Verzeichnis heraus.

Das Script macht:

1. `git pull --ff-only`
2. Docker Images bauen
3. Frontend und Backend neu starten
4. Backend Healthcheck pruefen
5. Frontend Healthcheck pruefen
6. SPA-Routen wie `/community` und `/seasons/current` gegen alte Asset-Dateien pruefen
7. optional die public URL aus `FRONTEND_URL` pruefen

## Wichtige Checks nach Update

```bash
docker compose ps
docker compose logs --tail=100 backend
curl -fsS http://localhost:8001/api/health
curl -I https://lionsquad.at
```

Vor groesseren Updates lokal ausfuehren:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quick-check.ps1
```

Der Schnellcheck kompiliert kritische Backend-Dateien, fuehrt die Match-V2-Unit-Tests aus
und baut das Frontend. Bei reinen Backend-Aenderungen kann `-SkipFrontendBuild` genutzt
werden.

Im Admin:

- `Einstellungen -> Status`
- `Einstellungen -> Branding`
- `Einstellungen -> Rechtliches`
- `Einstellungen -> Discord`
- `Einstellungen -> Twitch`

## Wenn `/community` alte Assets referenziert

Symptom:

- einzelne Routen laden alte `main.*.js` oder `main.*.css`
- Browser zeigt kaputte Seite oder weisse Seite
- `update.sh` meldet stale assets

Ursachen:

- Reverse Proxy cachet HTML
- Nginx Proxy Manager liefert alte Route aus
- Browsercache

Vorgehen:

1. `./update.sh u` erneut laufen lassen.
2. Proxy Cache leeren oder Caching fuer HTML deaktivieren.
3. Sicherstellen, dass `/`, `/community`, `/seasons/current` alle dieselben aktuellen Main-Assets referenzieren.
4. Browser hart neu laden.

## Uploads

Uploads brauchen drei Dinge:

- Docker-Volume muss persistieren.
- Backend-Upload-Verzeichnis muss beschreibbar sein.
- Reverse Proxy Upload-Limit muss gross genug sein.

Empfohlene Werte:

```env
UPLOAD_DIR=/app/backend/uploads
MAX_IMAGE_UPLOAD_MB=50
MAX_DOCUMENT_UPLOAD_MB=50
PROXY_UPLOAD_LIMIT_MB=60
```

Reverse Proxy:

- Body size mindestens 60 MB
- keine aggressive Bild-/HTML-Cache-Regel auf `/api/uploads/*`

## SEO, Crawler und Search Console

Die Website trennt bewusst zwischen indexierbaren Vereins-/Content-Seiten und nicht wichtigen
Profil-/Systemseiten.

Indexierbar und in der Sitemap:

- Startseite, Verein, Vorstand, Werte, Kontakt, Sponsoren, Partner, Galerie, Referenzen
- News, Events, Turniere, Fast-Lap-Challenges, Seasons
- offizielle Vereinsmitglieder unter `/members/<slug>`
- oeffentliche Teams unter `/teams/<id>`

Nicht aktiv in der Sitemap:

- registrierte Community-Profile unter `/u/<username>`
- die Community-Spieler-Uebersicht `/players`
- rechtliche Pflichtseiten `/imprint` und `/privacy`
- interne Bereiche wie `/dashboard`, `/profile`, `/privacy-account`, `/members/area`, `/admin`

Community-Profile und rechtliche Pflichtseiten bleiben erreichbar, setzen aber `noindex, follow`
in der SEO-Preview und im Frontend-Meta. Die `robots.txt` sperrt nur interne/private Bereiche,
damit Suchmaschinen Noindex-Hinweise auf erreichbaren Seiten lesen koennen.

Nach SEO-Aenderungen:

```bash
curl -fsS https://lionsquad.at/sitemap.xml | head
curl -fsS https://lionsquad.at/robots.txt
curl -I -A "Googlebot" "https://lionsquad.at/u/beispiel"
```

Danach in der Google Search Console die betroffenen URLs pruefen und "Fehlerbehebung validieren".
Google kann Aenderungen innerhalb von Stunden sehen, sichtbare Suchergebnisse koennen aber Tage
bis Wochen nachziehen.

## Backup

Vor groesseren Aenderungen:

```bash
docker compose ps
BACKUP_DIR=/opt/tls-arena/backups bash scripts/backup.sh
```

Dann nach `BACKUP_RESTORE.md` arbeiten.

Optional kann das Update-Script direkt vorher ein Backup ausloesen:

```bash
PRE_UPDATE_BACKUP=true ./update.sh u
```

Backup-Dateien vor einem Restore immer strukturell pruefen:

```bash
bash scripts/restore-check.sh /opt/tls-arena/backups/tls_arena_YYYYMMDD_HHMMSS.archive.gz /opt/tls-arena/backups/tls_uploads_YYYYMMDD_HHMMSS.tar.gz
```

Niemals ohne Absicht:

```bash
docker compose down -v
```

Das wuerde Volumes loeschen und kann Daten entfernen.

## Logs

Backend:

```bash
docker compose logs -f backend
```

Frontend:

```bash
docker compose logs -f frontend
```

MongoDB:

```bash
docker compose logs -f mongodb
```

## SMTP und Mailqueue

Im Adminbereich:

- `Einstellungen -> SMTP`
- Testmail senden
- Diagnose ausfuehren
- Zustellbarkeit pruefen
- `Einstellungen -> Mail-Queue`

Wenn Mails nicht rausgehen:

1. SMTP Host/User/Passwort pruefen.
2. TLS-Modus pruefen.
3. Queue-Fehler lesen.
4. Backend-Logs pruefen.

## Discord

Webhook-Fehler sieht man unter:

- `Einstellungen -> Discord`
- `Einstellungen -> Status`
- Backend-Logs

Der Webhook muss eine gueltige Discord-Webhook-URL sein.
Wenn als Discord-Avatar ein Upload wie `/api/static/uploads/...` genutzt wird,
muss `FRONTEND_URL`, `PUBLIC_BASE_URL` oder die Branding-Domain auf die oeffentliche
HTTPS-Adresse zeigen. Discord akzeptiert keine rein lokalen Pfade.

## Twitch

Twitch braucht:

- Client ID
- Client Secret
- Live-Erkennung aktiv
- Nutzer mit gepflegtem Twitch Handle

Refresh:

- im Admin `Einstellungen -> Twitch -> Jetzt pruefen`
- oder Backend-Job/Scheduler abwarten

## Sicherheit

Produktiv wichtig:

- `JWT_SECRET` lang und zufaellig
- `ADMIN_PASSWORD` stark
- `SEED_DEMO=false`
- HTTPS aktiv
- Cookies passend zu Domain/WWW setzen
- keine echten Secrets in Git committen

## Rollback

Wenn ein Update kaputt ist:

```bash
git log --oneline -5
git checkout <alter-commit>
docker compose up -d --build
```

Danach Ursache klaeren und wieder auf `main` zurueckwechseln:

```bash
git checkout main
git pull --ff-only
```
