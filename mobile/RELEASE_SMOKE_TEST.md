# LionsAPP Beta Smoke-Test

Version: `2.0.0-beta.1`
Android build: `55`
Channel: `beta`

## GitHub Actions Build

1. GitHub Repository öffnen.
2. `Actions` -> `Mobile APK Release` öffnen.
3. `Run workflow` starten.
4. `channel` auf `beta` setzen.
5. Nach erfolgreichem Lauf das APK-Artefakt herunterladen.

Der Workflow muss vor dem Build `Prepared mobile/google-services.json for Android Firebase/FCM push config.` ausgeben. Falls stattdessen `Missing GOOGLE_SERVICES_JSON_BASE64` erscheint, fehlt das Firebase-Secret für Android-Push.

Erwarteter APK-Name:

```text
LionsAPP-BETA-v2.0.0-build55-<commit>.apk
```

## Handy-Matrix

- Samsung Galaxy S26 Ultra, aktuelle One UI, Samsung Keyboard.
- Kompaktes Android-Gerät mit Gboard.
- Android 13 oder neuer mit frischer Installation: Benachrichtigungsberechtigung muss abgefragt und erlaubt werden.
- Ein Gerät mit älterem Android, falls verfügbar, für Sideload- und Layout-Prüfung.

## Installationscheck

- APK auf echtem Android-Gerät installieren.
- App startet ohne Crash.
- Login mit Testkonto funktioniert.
- Gastmodus funktioniert, falls kein Login genutzt wird.
- Keine unerwartete Play-Protect- oder Debug-Signatur-Warnung außer normale Sideload-Hinweise.

## Pflicht-Screens

- Home/Dashboard: Termine, Quick-Actions, Jahreswertung, Live-Streams und News sichtbar.
- Events-Tab: Events, Turniere und Fast-Laps laden.
- Direktnachricht: Eingabefeld bleibt sichtbar, während die Tastatur geöffnet ist.
- Teamchat: Verlauf ist scrollbar, Eingabefeld bleibt sichtbar.
- Match-Hub: lokales Staff-only Match zeigt keine Spieler-Ergebnis-/Terminbuttons.
- Match-Hub: Online-Match zeigt Spieler-Report und Konflikthinweise korrekt.
- Fast-Lap Detail: Streckenbild oder sauberer Fallback sichtbar.
- News Detail: eingebettete Turniere/Events/Fast-Laps erscheinen als Karten.
- Jahreswertung: echte Rangliste, Quellen und Profilpunkt-Trennung sichtbar.
- Profil: kompakte Actions, Tabs, Referenzen und Logout wirken sauber.
- Offline-Test: App kurz offline nehmen; Dashboard/Event-Hub/News zeigen gespeicherte Daten mit Offline-Hinweis.

## Push-Pflichttest

- App öffnen, anmelden und Android-Berechtigung für Benachrichtigungen erlauben.
- Website öffnen: `Admin` -> `Push-Monitoring`.
- Eigenen Benutzer auswählen und `Test senden`.
- Benachrichtigung muss im Android-Benachrichtigungsfeld erscheinen, inklusive App-Icon, Titel und Umlauten wie `Ä`, `Ö`, `Ü`.
- App in den Hintergrund legen und erneut testen.
- App komplett aus der Übersicht schließen und erneut testen.
- Danach in `Admin` -> `Push-Monitoring` `Receipts prüfen` ausführen: Ticket/Receipt dürfen keinen Fehler zeigen.

Hinweis: Wenn Android eine App per Systemeinstellung "Stopp erzwingen" beendet, blockiert Android Push-Zustellung bis zum nächsten manuellen Start. Das ist Betriebssystemverhalten und kein App-Fehler.

## Admin-Smoke

- `Admin` -> `Dashboard`: Push-Monitoring und Client-Logs zeigen sinnvolle Zahlen.
- `Admin` -> `Push-Monitoring`: Benutzerliste, Token-Karten auf Handybreite und Receipt-Prüfung funktionieren.
- `Admin` -> `Client-Logs`: Filter nach Status/Priorität funktionieren, gruppierte Wiederholungen werden als `xN` angezeigt.
- Mobile Browseransicht der Admin-Seiten prüfen: keine unlesbaren Tabellen ohne Karten-/Scroll-Fallback.

## Release-Entscheidung

Tag erst setzen, wenn:

- GitHub Actions Build erfolgreich ist.
- APK installiert und Smoke-Test bestanden ist.
- Push mit geschlossener App auf mindestens zwei echten Geräten geprüft wurde.
- Signatur- und SHA-256-Dateien im Artefakt vorhanden sind.

Danach optional:

```text
git tag mobile-v2.0.0-beta.1-build55
git push origin mobile-v2.0.0-beta.1-build55
```
