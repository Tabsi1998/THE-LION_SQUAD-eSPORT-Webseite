# Live-Test-Anleitung

Dieses Dokument beschreibt, wie Live-Checks gegen `https://lionsquad.at` ausgefuehrt werden.

## Zweck

Live-Tests pruefen Dinge, die lokal ohne Server, MongoDB, Upload-Volume oder echte Cookies nicht voll beweisbar sind.

Aktuell abgedeckt:

- Admin-Login
- Markdown/WYSIWYG/Preview/HTML Editor-Modi
- Bild-Upload API
- User-Medienbereich vs. Admin-Medienbereich
- Bildauslieferung
- Loeschen von Testbildern
- Vorstand-Auswahlliste nur aus Vereinsmitgliederprofilen

## Voraussetzungen

Im Frontend-Verzeichnis muessen ENV-Werte gesetzt sein:

```bash
RUN_ADMIN_E2E=true
TLS_LIVE_EMAIL="admin@example.com"
TLS_LIVE_PASSWORD="..."
PLAYWRIGHT_BASE_URL="https://lionsquad.at"
```

Auf Windows PowerShell:

```powershell
$env:RUN_ADMIN_E2E="true"
$env:TLS_LIVE_EMAIL="admin@example.com"
$env:TLS_LIVE_PASSWORD="..."
$env:PLAYWRIGHT_BASE_URL="https://lionsquad.at"
cd C:\Privat\Programmierung\bracket-system\frontend
npx playwright test e2e/admin-live.spec.js --project=chromium
```

Auf Ubuntu:

```bash
cd /root/THE-LION_SQUAD-eSPORT-Webseite/frontend
RUN_ADMIN_E2E=true \
TLS_LIVE_EMAIL="admin@example.com" \
TLS_LIVE_PASSWORD="..." \
PLAYWRIGHT_BASE_URL="https://lionsquad.at" \
npx playwright test e2e/admin-live.spec.js --project=chromium
```

## Oeffentliche Smoke-Tests

Public Tests laufen ohne echte Zugangsdaten:

```bash
cd frontend
npx playwright test e2e/public.spec.js --project=chromium
```

Diese pruefen:

- `/community`
- Navigation Verein vs. Community
- Vereinsmitglieder-Karten mit Gamertag zuerst

## Backend-Katalogtests

Diese Tests brauchen keine Live-DB:

```bash
python -m pytest backend/tests/test_public_phase.py
python -m pytest backend/tests/test_achievement_catalog_audit.py backend/tests/test_twitch_streamer_catalog.py
```

Sie pruefen:

- Fast-Lap-Anzeige ohne Online-Anmeldung
- Achievement-Katalog-Konsistenz
- Twitch-Streamer-Achievement-Katalog

## Wann Live-Tests laufen sollten

Sinnvoll nach Aenderungen an:

- Uploads und Medienbibliothek
- Admin-Editor
- Mitglieder/Vorstand
- Auth/Cookies/CSRF
- Proxy/Deployment
- Twitch/Discord Adminbereiche

## Umgang mit Testdaten

Der Upload-Test erstellt kleine Smoke-PNGs und loescht sie danach wieder.

Wenn ein Test abbricht:

1. `Admin -> Medien` oeffnen.
2. Nach `tls-e2e-smoke.png` oder `tls-e2e-admin-smoke.png` suchen.
3. Testreste loeschen.

## Was noch als Live-Test ergaenzt werden sollte

- Vereinsmitglied erstellen und Plattformkonto verknuepfen.
- Vorstand setzen und oeffentliche Vorstand-/Mitgliederseite pruefen.
- Discord-Counter erhoehen und Achievement-Auswertung pruefen.
- Twitch-Settings speichern und Status-Endpunkt pruefen.
- Profil-Sichtbarkeit fuer Social-/Gaming-Felder pruefen.
- Event mit Bild erstellen und oeffentliche Kartenansicht pruefen.
