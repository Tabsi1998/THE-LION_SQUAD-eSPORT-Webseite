# Update-Anleitung

Der normale Server-Ablauf ist:

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
./update.sh u
```

Das Script zieht den neuesten Code, baut Frontend/Backend neu, startet die Container und prueft Backend, Frontend und wichtige SPA-Routen.

## Einstellungen nur für diesen Server: `docker-compose.override.yml`

`docker-compose.yml` wird auf dem Server nie von Hand geändert – sonst bricht
`update.sh` mit „Tracked local changes detected“ ab. Was nur für diesen Server
gilt (etwa ein zusätzlicher Host-Eintrag), gehört in `docker-compose.override.yml`.
Docker Compose lädt diese Datei bei jedem `docker compose`-Aufruf automatisch
mit, Git ignoriert sie, und sie bleibt bei jedem Update erhalten.

Beispiel: Das Backend erreicht `erp.lionsquad.at` nur über die Adresse im
Heimnetz, weil der Router die öffentliche Adresse nicht ins eigene Netz
zurückleitet.

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite
git restore docker-compose.yml          # eine frühere Handänderung zurücknehmen
cp docker-compose.override.example.yml docker-compose.override.yml
nano docker-compose.override.yml        # Adresse anpassen
./update.sh u
```

`update.sh` meldet dann „Using this server's settings from docker-compose.override.yml“.
Prüfen, was Compose tatsächlich verwendet: `docker compose config | grep -A3 extra_hosts`.

## Abbruch: `Command createUser requires authentication`

Der bisherige Vorbereitungscheck fragte MongoDB ohne Anmeldung nach dem Admin-Benutzer.
Eine bereits geschützte Datenbank verweigerte das; das Skript versuchte daraufhin
fälschlich erneut die Ersteinrichtung. Dieser Fehler tritt vor Build und Neustart auf.
Der Checkout ist dann schon aktualisiert, die laufenden Container aber noch nicht.

Die korrigierte Vorbereitung meldet sich zuerst mit den bestehenden `.env`-Werten an.
Nur ein nachweislich ungeschütztes, benutzerloses System erhält seinen ersten Benutzer.
Ein falsches Passwort oder ein nicht erreichbarer Server bricht vor Änderungen an
der `.env` ab. Nach Integration dieses Fixes erneut `./update.sh u` ausführen.
Bei weiterem Anmeldefehler die bisherigen Zugangsdaten lokal prüfen; weder MongoDB-
Volumes löschen noch Passwörter oder den Verschlüsselungsschlüssel neu erzeugen.

## Updates, Browser und Proxy-Cache

- HTML, `service-worker.js` und `version.json` werden mit `Cache-Control: no-store`
  ausgeliefert. Der Service Worker bekommt bei jedem veränderten Frontend-Build eine
  Versionskennung und prüft Updates auch nach Rückkehr zum Browser-Tab.
- Die Aktualisierungsmeldung bleibt sichtbar. Erst Eingaben speichern, dann
  **Aktualisieren** wählen. Bei fehlenden nachgeladenen Dateien bietet die Seite
  ebenfalls einen sichtbaren Neuladeweg an.
- API-Antworten und Seiten mit Bestätigungs-/Reset-Tokens werden nicht vom Service
  Worker gespeichert. Offline erscheint ein Verbindungshinweis.
- Hash-Dateien unter `/assets/` bleiben lang cachebar. Der äußere Proxy muss die
  Cache-Header respektieren. Keine „Cache Everything“-Regel für HTML, `/api/`,
  `/service-worker.js` oder `/version.json` verwenden. Einen bereits vorhandenen
  Proxy-Cache bei diesem Übergang einmal für diese Routen leeren.

Auf `lionsquad.at` wurde am 8. September 2026 der alte Worker öffentlich mit
`CF-Cache-Status: HIT`, `public, immutable` und einem Jahr Gültigkeit bestätigt.
In Cloudflare unter **Caching → Configuration → Purge Cache → Custom Purge** nach
dem Deployment mindestens `https://lionsquad.at/service-worker.js` leeren; anschließend
den Versionscheck erneut ausführen. Die Registrierung verwendet zusätzlich eine
Buildversion im Worker-Link. Bei einem bereits offenen alten Browser-Tab einmal
die Aktualisierung bestätigen bzw. neu laden. Wiederkehrendes Strg+F5 ist kein
normaler Bestandteil des künftigen Update-Ablaufs.

Rein lesend prüfen, optional lokale und öffentliche Version vergleichen:

```bash
python3 scripts/check-web-update.py http://localhost:3000 https://lionsquad.at
```

Port bei Bedarf an `FRONTEND_PORT` anpassen. Der Check verlangt passende Buildversionen,
Cache-Header und erreichbare Dateien für Start, Login, Bestätigung und Dashboard.
Er läuft auch im Update und in der Container-CI. Ein öffentliches Prüfproblem nach
dem Neustart meldet das Update ausdrücklich als noch nicht abgenommen.

Quellen: [Vite – fehlende Dateien nach Updates](https://vite.dev/guide/build#load-error-handling),
[Service-Worker-Updatecache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache).

## Danach pruefen

### Bestehendes Konto: „E-Mail-Adresse noch nicht bestätigt“

Vor der verpflichtenden E-Mail-Bestätigung wurden auch Passwort-Konten mit
`email_verified=false` angelegt und konnten sich anmelden. Seit der Härtung
werden diese Konten beim **Passwort-Login vor der MFA-Abfrage** gesperrt, bis
die Adresse bestätigt ist. Ein erneuter Login verschickt keine Mail.
Das Konto muss nicht neu angelegt und das Passwort nicht geändert werden.

1. `https://lionsquad.at/verify-email` öffnen, bisherige E-Mail eintragen und
   den Bestätigungslink einmal anfordern. Einige Minuten warten und Spam prüfen.
2. Link öffnen; danach mit bisherigem Passwort und MFA-/Wiederherstellungscode
   anmelden. MFA stammt aus der Authenticator-App, nicht aus einer Login-E-Mail.
   Die MFA-Zwischenkennung bleibt nur im Arbeitsspeicher. Ein vollständiges Neuladen
   während dieses Schritts startet die Anmeldung neu; sie wird nicht im Browserspeicher abgelegt.
3. Kommt keine Mail: Der Betreiber führt im Server-Checkout folgenden
   **rein lesenden** Bericht aus (Adresse durch die betroffene Adresse ersetzen):

   ```bash
   docker compose exec -T backend python - person@example.test < backend/login_diagnostics.py
   ```

   Der Bericht lässt E-Mail-Adresse, Benutzer-ID, Passwörter, Tokens, Mailtexte
   und rohe Providerfehler weg. Er verändert keine Daten und versendet nichts.
   Nach Aktualisierung des Checkouts ist dafür kein Backend-Neubau nötig.

   - `recent_auth_mail` leer: kein neuer Bestätigungsversand erfasst.
   - `pending`/`sending`: Warteschlange; `scheduler_disabled=true` verhindert
     den automatischen Versand. Status allein beweist keinen laufenden Worker.
   - `skipped`: Versand deaktiviert.
   - `failed` oder `attempts > 0` mit Fehlerkategorie: SMTP/Resend-Konfiguration
     unter **Admin → E-Mail** prüfen. Bei `configuration_readable=false` auch
     den unverändert erforderlichen `SETTINGS_ENCRYPTION_KEY` lokal prüfen;
     Schlüssel niemals hier veröffentlichen oder durch einen neuen ersetzen.
   - `sent`: Mailserver hat angenommen, keine Garantie für Postfachzustellung.
     Spam, Mailserver-Zustellung und Absender-Domain prüfen.

Wenn kein Admin mehr ins Menü kommt, zunächst diesen Bericht auswerten.
Keine pauschale Datenbankänderung aller Konten auf `email_verified=true`, keine
MFA-Deaktivierung und kein Löschen/Neuanlegen des bestehenden Kontos.
Der öffentliche Resend-Endpunkt bestätigt aus Datenschutzgründen weder die
Existenz eines Kontos noch eine erfolgreiche Zustellung.

Referenz: [OWASP – sichere Wiederherstellungsantworten](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

```bash
docker compose ps
docker compose logs --tail=100 backend
curl -fsS http://localhost:8001/api/health/live
curl -fsS http://localhost:8001/api/health/ready
```

Oeffentlich pruefen:

- `https://lionsquad.at`
- `https://lionsquad.at/community`
- `https://lionsquad.at/events`
- `https://lionsquad.at/members`

Im Admin:

- `Einstellungen -> Status`
- `Einstellungen -> Discord`
- `Einstellungen -> Twitch`
- ein kleiner Upload-Test

## Daten behalten

MongoDB und Uploads liegen in Docker-Volumes bzw. persistenten Upload-Pfaden.

Nicht ausfuehren, ausser du willst Daten bewusst loeschen:

```bash
docker compose down -v
```

## Wenn public routes alte Assets liefern

`update.sh` prueft unter anderem `/community` und `/seasons/current`. Wenn dort alte Vite-Dateien aus `/assets/` auftauchen:

1. Reverse-Proxy-Cache leeren.
2. HTML-Caching fuer SPA-Routen deaktivieren.
3. `./update.sh u` nochmal laufen lassen.

Mehr Details: [OPERATIONS.md](OPERATIONS.md).

## Rollback

Releases bevorzugt per Tag mit `scripts/deploy-release.sh` ausrollen. Der bestätigte Rollback
steht in [RELEASE.md](RELEASE.md); dadurch bleiben vorheriger Commit, Backup und Prüfablauf
nachvollziehbar.
