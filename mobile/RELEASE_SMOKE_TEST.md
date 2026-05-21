# LionsAPP Beta Smoke-Test

Version: `1.0.0-beta.1`
Android build: `31`
Channel: `beta`

## GitHub Actions Build

1. GitHub Repository oeffnen.
2. `Actions` -> `Mobile APK Release` oeffnen.
3. `Run workflow` starten.
4. `channel` auf `beta` setzen.
5. Nach erfolgreichem Lauf das APK-Artefakt herunterladen.

Der Workflow muss vor dem Build `Prepared mobile/google-services.json for Android Firebase/FCM push config.` ausgeben. Falls stattdessen `Missing GOOGLE_SERVICES_JSON_BASE64` erscheint, fehlt das Firebase-Secret fuer Android-Push.

Erwarteter APK-Name:

```text
LionsAPP-BETA-v1.0.0-build31-<commit>.apk
```

## Installationscheck

- APK auf echtem Android-Geraet installieren.
- App startet ohne Crash.
- Login mit Testkonto funktioniert.
- Gastmodus funktioniert, falls kein Login genutzt wird.
- Keine unerwartete Play-Protect- oder Debug-Signatur-Warnung ausser normale Sideload-Hinweise.

## Pflicht-Screens

- Home/Dashboard: Termine, Quick-Actions, Jahreswertung und News sichtbar.
- Events-Tab: Events, Turniere und Fast-Laps laden.
- Match-Hub: lokales Staff-only Match zeigt keine Spieler-Ergebnis-/Terminbuttons.
- Match-Hub: Online-Match zeigt Spieler-Report und Konflikthinweise korrekt.
- Fast-Lap Detail: Streckenbild oder sauberer Fallback sichtbar.
- News Detail: eingebettete Turniere/Events/Fast-Laps erscheinen als Karten.
- Jahreswertung: echte Rangliste, Quellen und Profilpunkt-Trennung sichtbar.
- Profil: kompakte Actions, Tabs, Referenzen und Logout wirken sauber.
- Offline-Test: App kurz offline nehmen; Dashboard/Event-Hub/News zeigen gespeicherte Daten mit Offline-Hinweis.
- Benachrichtigungen: In der App `Mehr` -> `Benachrichtigungen` oeffnen, Push-Status aktualisieren, Test senden und pruefen, dass ein Token registriert ist.

## Release-Entscheidung

Tag erst setzen, wenn:

- GitHub Actions Build erfolgreich ist.
- APK installiert und Smoke-Test bestanden ist.
- Signatur- und SHA-256-Dateien im Artefakt vorhanden sind.

Danach optional:

```text
git tag mobile-v1.0.0-beta.1-build31
git push origin mobile-v1.0.0-beta.1-build31
```
