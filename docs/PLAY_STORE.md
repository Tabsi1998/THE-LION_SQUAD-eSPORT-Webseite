# LionsAPP im Google Play Store

Alles, was für den Store-Eintrag der LionsAPP gebraucht wird, an einer Stelle (#219): was schon
da ist, was der Betreiber in der Play Console klickt, und die Texte, Tabellen und Grafiken zum
Einfügen. Vorschläge lassen sich hier ändern; die Play Console zeigt nur, was dort eingetragen ist.

## Was schon da ist

| Baustein | Stand |
| --- | --- |
| App Bundle (AAB) | `npm run release:local -- --aab` baut es mit dem Upload-Schlüssel (Play App Signing), siehe `mobile/RELEASES.md` |
| Bundle in den Test-Track laden | `npm run release:local -- --play` (intern) bzw. `--play=closed`, sobald das Dienstkonto eingerichtet ist (#412, Abschnitt in `mobile/RELEASES.md`) |
| Absturzberichte | Firebase Crashlytics, ohne Nutzerkennung (#219 Teil 2) |
| Datenschutzerklärung | `https://lionsquad.at/privacy` hat den Abschnitt „LionsAPP“: Push, Absturzberichte, App-Sperre, Konto löschen – er entsteht aus den Einstellungen und braucht keinen Zusatztext |
| Konto löschen in der App | Profil → „Konto löschen“ (#390); Google verlangt das bei Registrierung in der App |
| Melden und Blockieren | in jedem Chat und im Profil (#414); Google verlangt das, sobald Nutzer miteinander schreiben |
| Update aus der App | Play-Installationen bekommen Googles Update-Dialog, Sideload-Installationen die APK vom Vereinsserver (#421) |
| Grafiken | `docs/store/icon-512.png` und `docs/store/feature-graphic-1024x500.png`, erzeugt mit `python scripts/store_graphics.py` aus den Markenbildern |

## Was der Betreiber klickt

1. **Entwicklerkonto** auf play.google.com/console anlegen (einmalig kostenpflichtig, Identitätsprüfung; als Organisation mit den Vereinsdaten). Bis Google das Konto freigibt, geht nichts weiter.
2. **App erstellen**: Name „LionsAPP“, Standardsprache Deutsch, „App“ (kein Spiel), kostenlos.
3. **Store-Eintrag** (Abschnitt unten), **Grafiken** hochladen, **Screenshots** (Abschnitt unten).
4. **Richtlinien** in der Console: Datenschutzerklärung `https://lionsquad.at/privacy`, App-Zugriff (Testkonto, Abschnitt unten), Werbung „nein“, Inhaltseinstufung (Fragebogen), Zielgruppe, Datensicherheit (Tabelle unten), Regierungs-App „nein“, Finanzfunktionen „keine“.
5. **Einrichtung → API-Zugriff**: Dienstkonto für `--play`, Klickweg in `mobile/RELEASES.md` („Play Console: Bundle automatisch laden“). Optional, spart das Hochladen von Hand.
6. **Interner Test**: Tester-Liste mit E-Mail-Adressen (Vorstand, zwei bis drei Freiwillige), Bundle hochladen oder `--play`, Link aus der Console an die Tester schicken. Google prüft interne Tests nicht.
7. **Geschlossener Test** für Mitglieder: eigene Tester-Liste (E-Mail-Adressen der Mitglieder, die mitmachen) oder eine Google-Gruppe; ab hier prüft Google die App einmal (Store-Eintrag, Richtlinien). Das Konto ist als **Organisation** (Verein) angelegt – die 12-Tester-Regel für Privatkonten gilt nicht.
8. **Produktion** erst mit 1.0.0 (Versionsschema in `mobile/RELEASES.md`); die Freigabe klickt der Betreiber selbst, das Skript lädt nie nach Produktion.

## Store-Eintrag (Vorschlag)

- **Name:** LionsAPP
- **Kurzbeschreibung** (höchstens 80 Zeichen): Die App von THE LION SQUAD – Turniere, Events, Team und Mitgliedschaft.
- **Vollständige Beschreibung:**

  > Die offizielle App des eSports-Vereins THE LION SQUAD aus Tirol.
  >
  > Turniere und Events sehen und dich anmelden, dein Team und deine Matches im Blick, Chat mit Team und Turnier, News und Galerie des Vereins. Vereinsmitglieder finden Mitgliedskarte, Beitragsstand, Belege und Dokumente im Mitgliederbereich – und stimmen bei Versammlungen direkt in der App ab.
  >
  > Anmeldung mit deinem Konto von lionsquad.at, auch per Passkey mit Fingerabdruck. Öffentliche Turniere, Events und News siehst du auch ohne Konto.

- **Kategorie:** Sport · **Tags** (aus Googles Liste): Sport, Events, Kommunikation
- **Länder:** Österreich, Deutschland, Schweiz, Italien (Entscheidung 25.09.); kostenlos
- **Kontakt:** die Vereins-Mailadresse; Website `https://lionsquad.at`
- **Zielgruppe:** ab 13 Jahren. Die App richtet sich nicht an Kinder; Vereinsmitglieder sind teils Jugendliche. Keine Werbung.
- **Inhaltseinstufung (IARC-Fragebogen):** Kategorie **„Alle anderen App-Typen“** (kein Spiel; Chat ist Funktion, nicht Hauptzweck). Freigaberelevante Inhalte im App-Paket: nein. Teilen von Benutzerinhalten: Kommunikation/Bilder teilen **ja**; Nutzerinhalt als primäre Quelle nein; Nacktheit/Gewalt teilen nein; Blockieren **ja**, Melden **ja**, Chatmoderation **ja** (Wortfilter, Meldungen, Bildprüfung, Verwarnungen); Interaktionen nur auf eingeladene Freunde beschränkbar nein (Team- und Turnier-Chats sind für Teilnehmer offen). Gewalt, Sex, Drogen, grobe Sprache, Glücksspiel, Werbung, In-App-Käufe, Standort teilen: nein. Erwartet: PEGI 3 / USK 0 mit „Nutzerinteraktion“.

## Grafiken

| Datei | Größe | Wofür |
| --- | --- | --- |
| `docs/store/icon-512.png` | 512 × 512, ohne Transparenz | App-Symbol im Store |
| `docs/store/feature-graphic-1024x500.png` | 1024 × 500 | Funktionsgrafik (Kopf der Store-Seite) |

Beide entstehen aus `mobile/assets/icon.png` und `mobile/assets/brand/` mit `python scripts/store_graphics.py`
(braucht Pillow, wie das Backend). Nach einer Änderung an den Markenbildern das Skript erneut laufen lassen und
die beiden Dateien einchecken.

## Screenshots

Mindestens zwei Handy-Screenshots (Hochformat, 16:9 oder 9:16, 320–3840 px je Seite; ein Emulator mit
1080 × 2400 passt). Vorschlag, in dieser Reihenfolge:

1. Startseite mit Live-Stream oder News
2. Turniere (Liste) oder ein Turnier mit Bracket
3. Chat mit Anhang und Sticker
4. Mitgliederbereich mit Mitgliedskarte

So entstehen sie: `cd mobile && npm run android` gegen den Testserver (nie gegen lionsquad.at mit echten
Konten), Emulator mit Testdaten aus dem Seed – **keine echten Namen, Nachrichten oder E-Mail-Adressen**.
Im Emulator die Kamerataste (Screenshot) nutzen; Dateien nach `docs/store/screenshots/` ablegen und einchecken.

## Datensicherheit (Formular in der Console)

| Datenart | Gesammelt? | Wofür | Geteilt mit Dritten? |
| --- | --- | --- | --- |
| Name, E-Mail, Benutzer-ID | ja | Konto und Anmeldung | nein |
| Nachrichten (Team-, Turnier-Chat, Direktnachrichten) | ja | App-Funktion | nein |
| Fotos und Videos (nur selbst hochgeladene) | ja | Chat, Galerie | nein |
| Geräte-Kennung für Push (Token) | ja | Benachrichtigungen | nur zur Zustellung an Google (Firebase Cloud Messaging) |
| Absturzberichte, Diagnose | ja | Stabilität | an Google (Firebase Crashlytics) |
| Standort, Kontakte, Werbe-ID, Finanzdaten, Gesundheitsdaten | **nein** | – | – |

Angaben dazu: Daten werden verschlüsselt übertragen (HTTPS). Nutzer können die Löschung verlangen und das
Konto in der App selbst löschen (Profil → „Konto löschen“); den Datenexport gibt es auf der Website
unter Profil → Datenschutz. Kalender: nur schreibend beim Antippen („In meinen Kalender“), nichts wird gelesen.
Fingerabdruck und Gesicht für die App-Sperre bleiben auf dem Gerät und gehen nie zum Server.

## App-Zugriff: Testkonto für Googles Prüfer

Google prüft die App mit einem echten Login. Dafür ein eigenes Konto anlegen (Admin → Benutzer), zum
Beispiel `play-review` mit der Rolle Spieler, **ohne** Vorstands- oder Admin-Rechte, in einem Test-Team und
mit Mitgliedschaft „aktiv“ in der Vereinsakte, damit der Mitgliederbereich sichtbar ist. In der Console unter
„App-Zugriff“ → „Alle oder einige Funktionen sind eingeschränkt“ → Anleitung:

> Anmelden mit Benutzername `play-review` und dem hinterlegten Passwort (Anmelden → E-Mail/Passwort; der
> Passkey-Weg ist optional). Danach sind Turniere, Events, Chat, Profil und Mitgliederbereich erreichbar.
> Zahlungen gibt es in der App nicht.

Das Passwort nur in die Console eintragen, nie ins Repo oder in einen Chat; nach der Prüfung ändern.

## Ablauf je Version

Seit 1.0.0 (#593) kommen Updates von Google Play; die App hat keinen eigenen Installer mehr (Google
erlaubt die Berechtigung dafür nur App-Stores). Die APK am GitHub-Release ist nur für Geräte ohne Google
Play – Download im Browser, der Vorstand schickt den Link.

1. PR mit Version, Build-Zähler und Changelog-Abschnitt mergen (siehe `mobile/RELEASES.md`).
2. `npm run release:local -- --play` (intern) oder `--play=closed`: GitHub-Release, APK an den Vereinsserver, Bundle in den Track. Ohne Dienstkonto: `--aab` und das Bundle aus `mobile/builds/` in der Console hochladen.
3. Versionshinweise stehen im Track (aus dem Changelog, bis 500 Zeichen); Tester bekommen das Update über den Play Store.
4. Für 1.0.0: Version ohne `-beta`, Produktion in der Console freigeben.

## Checkliste für den Betreiber

- [x] Entwicklerkonto freigegeben (Organisation, Vereinsdaten) – 25.09.
- [x] App „LionsAPP“ angelegt, Store-Eintrag mit Texten und Grafiken von oben – 25.09.
- [x] Screenshots aus dem Emulator, ohne echte Personen – 25.09. (`Desktop\PlayStore\screenshots`)
- [x] Datenschutz-Link, Datensicherheit, Inhaltseinstufung, Zielgruppe, App-Zugriff (Testkonto) ausgefüllt – 25.09.
- [x] Interner Test mit Tester-Liste, erstes Bundle drin – Build 78, dann Build 79
- [ ] Dienstkonto für `--play` (optional)
- [ ] Offener Test mit 1.0.0 (Build 79) – Entscheidung 25.09.: offener statt geschlossener Test; Länder AT/DE/CH/IT
- [ ] 1.0.0 in Produktion (aus dem offenen Test hochstufen)

**Falle (25.09.):** Meldet die Vorschau eines Releases „Berechtigung REQUEST_INSTALL_PACKAGES noch nicht
erklärt“, steckt ein altes Bundle (Build ≤ 78) noch in diesem Entwurf oder in einem aktiven Track – das
alte Bundle aus dem Entwurf entfernen bzw. Build 79 auch in den internen Test bringen. Die Erklärung
nie ausfüllen: Build 79 nutzt die Berechtigung nicht.
