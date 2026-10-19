# Die LionsAPP – Handbuch

Die App des Vereins fürs Handy: was Spieler und Mitglieder darin finden, wie sie auf die Geräte kommt und aktuell bleibt, wie
Benachrichtigungen (Push) ankommen, was die App-Sperre kann und was ihr als Betreiber im Admin dafür einstellt. Dazu ehrlich: was es nur auf der
Website gibt.

**Wo im Admin:**

- **Admin → System → App-Versionen** (`/admin/app-releases`) – welche Version „aktuell“ ist, ab wann ein Update Pflicht ist, APK-Ablage
- **Admin → System → Push-Tests** (`/admin/mobile-push`) – eine Testnachricht an ein Konto schicken, Tokens und Fehler ansehen
- **Admin → Auftritt → Branding** (`/admin/settings/branding`) – **Play-Store-Link (LionsAPP)** und **App-Store-Link (LionsAPP, iOS)**, damit Fußzeile und Startseite
  die Abzeichen zeigen; Hinweisleisten können für **Website und/oder App** laufen, siehe [Auftritt und Einstellungen](auftritt.md)
- **Admin → System → Betrieb & Logs → Reiter „App-Logs“** – Abstürze und Fehler aus der App, mit Gerät und Version
- **Admin** (Kommandozentrale) – Kachel **Push-Monitoring** mit aktiven Tokens und Fehlern

Wer das darf: der Bereich **System**.

Die technische Seite (Bauen, Signieren, Hochladen in die Play Console) steht in [`mobile/RELEASES.md`](../../mobile/RELEASES.md) und
[Play Store](../PLAY_STORE.md). Die Signatur der App liegt beim Betreiber und gehört nie ins Repository.

---

## Inhalt

1. [Überblick: was alles geht](#1-überblick-was-alles-geht)
2. [Einrichten Schritt für Schritt](#2-einrichten-schritt-für-schritt)
3. [Die Funktionen einzeln](#3-die-funktionen-einzeln)
4. [Wenn etwas nicht klappt](#4-wenn-etwas-nicht-klappt)
5. [Häufige Fragen](#5-häufige-fragen)

---

## 1. Überblick: was alles geht

| Funktion | Was passiert | Einstellen unter |
| --- | --- | --- |
| **Installation** | Android über Google Play (offener Test). Geräte ohne Google Play holen die APK vom GitHub-Release | Play Console, Admin → Auftritt → Branding (Link) |
| **Updates** | Die App merkt ein neueres Release und zeigt einen Banner; bei Pflicht-Update lässt er sich nicht wegdrücken | Admin → System → App-Versionen |
| **„Was ist neu“** | Nach jedem Update einmal eine Karte mit den Neuerungen | steckt in der App, kommt aus dem Changelog |
| **Anmelden** | Ohne Konto geht alles Öffentliche; mit Konto Passwort, Passkey und, wenn eingerichtet, Code der Authenticator-App | in der App |
| **App-Sperre** | Fingerabdruck, Gesicht oder Gerätesperre vor dem Öffnen, nur auf diesem Gerät | App → Profil → Zahnrad → Sicherheit |
| **Push** | Benachrichtigungen aufs Handy in fünf Kanälen | App-Einstellungen, Admin → System → Push-Tests |
| **Mitgliederbereich** | Mitgliedskarte, Versammlungen, Helfen, Dokumente, Rechnungen | Tab „Verein“ |
| **Turnierleitung am Handy** | Ergebnisse eintragen, Streitfälle entscheiden | im Turnier, „Turnierleitung“ |
| **Einlass** | Vorstand scannt die Mitgliedskarte bei der Versammlung | Tab Verein → Einlass |

---

## 2. Einrichten Schritt für Schritt

### 2.1 App auf die Geräte bringen

1. Die App ist im **Google Play Store** im **offenen Test** (interner und geschlossener Test sind abgeschaltet). Den Link aus der Play Console an
   Mitglieder geben oder auf der Website eintragen.
2. Trage den Link ein: **Admin → Auftritt → Branding → Play-Store-Link (LionsAPP)**, speichern. Erst dann zeigen Fußzeile und Startseite die
   Abzeichen (Näheres in [Auftritt und Einstellungen](auftritt.md)).
3. **Zugang für iOS gibt es noch nicht.** Das Feld **App-Store-Link (LionsAPP, iOS)** bleibt leer, bis eine iOS-Version öffentlich ist.
4. Wer kein Google Play hat, holt die APK vom **GitHub-Release** (das Repository ist öffentlich) im Browser und installiert sie von Hand.

### 2.2 Erstes Anmelden am Handy

1. App öffnen: Die App startet **ohne Konto** auf der Startseite mit allem Öffentlichen (Turniere, Events, News).
2. Beim ersten Start erscheint nach ein paar Sekunden einmal der Hinweis zum Anmelden. Sonst: Tab **Profil** → **Anmelden**.
3. Mit **E-Mail und Passwort** anmelden, oder **Mit Passkey anmelden** (Fingerabdruck oder Gesicht). Hat die Person Zwei-Faktor eingerichtet, fragt die App nach
   dem **MFA- oder Wiederherstellungscode**.
4. Nach der Anmeldung mit Passwort bietet die App einmal einen **Passkey** an. Er lässt sich später im Profil unter **Zahnrad → Sicherheit** anlegen und entfernen.
5. **Angemeldet bleiben** (Standard) hält die Sitzung; jedes Gerät hat seine eigene.
6. Push: Die App fragt einmal nach der Erlaubnis für Benachrichtigungen. Ohne Erlaubnis kommen keine Pushes (3.4).

### 2.3 Updates im Admin vorbereiten

Das macht ihr nur, wenn ihr Updates steuern wollt (3.2). Ohne Eingriff bekommen Play-Installationen ihre Updates von Google Play.

---

## 3. Die Funktionen einzeln

### 3.1 Was es in der App gibt – und was nicht

Fünf Tabs unten: **Home**, **Events**, **Community**, **Verein**, **Profil**. Oben in jeder Übersicht stehen Suche und Glocke; die Einstellungen öffnest du über das **Zahnrad im Profil**.

| In der App | Wo |
| --- | --- |
| Turniere, Events, Fast Lap, News, Galerie, Teams, Erfolge, Jahreswertung | Tabs Home, Events, Community |
| Chats (Direkt, Team, Turnier, Match) in einer Liste | Tab Community |
| Anmeldung zu Turnieren, Check-in, Ergebnis melden und bestätigen, Problem melden | im Turnier bzw. Match |
| „Du bist dran“-Aufruf und Spielstart-Zähler | Push, Match |
| Turnierbaum mit Weiterkommen-Modus (fester Baum, Auslosung nach der Runde, Show-Auslosung, sofort zufällig) und was gerade passiert („wartet auf Auslosung“, „Auslosung bereit · N Namen“, „das Los entscheidet“); Auslosung als Moment mit einer leichten Vibration, Namen wie im Web („Loser Runde 1“, „Grand Final“, „voraussichtlich“) | Turnier → Baum |
| Turnierleitung: Ergebnisse eintragen, „Braucht Aufmerksamkeit“ | Turnier → Turnierleitung (für Leitung und Helfer) |
| Mitgliedskarte (auch ohne Netz), Versammlungen und Abstimmung, Helfen, Vereinsdokumente, Vorteile, Meine Mitgliedschaft | Tab Verein |
| Einlass bei der Generalversammlung (Vorstand) | Tab Verein → Einlass |
| Profil, Rechnungen, Gewinne, „Deine Unterlagen“, Jahresrückblick | Tab Profil |
| App-Sperre, Passkeys, angemeldete Geräte, Benachrichtigungen, Konto löschen | Profil → Zahnrad |

**Nur auf der Website** (heute):

- **Die Verwaltung (Admin)** – es gibt keine Verwaltungsseiten in der App.
- **Zwei-Faktor einrichten und ausschalten** – das Anmelden mit Code geht in der App, die Einrichtung nur auf der Website
  (Benutzermenü → Einstellungen → Sicherheit).
- **Anmelden mit Google** und **Passwort vergessen** – gibt es im Anmeldebildschirm der App nicht, nur auf der Website.
- **Auskunft und Datenexport** („Meine Daten“) – die App öffnet dafür die Website.
- **Bezahlen** – Zahlungslinks öffnen im Browser, bezahlt wird nicht in der App.
- Lange Seiten wie Mitgliederverzeichnis, Server, Rechtliches und Kontaktformular bleiben auf der Website.

Alles andere gibt es in beiden. Die Rechte sind dieselben wie im Web: Was dein Konto nicht darf, sieht es auch in der App nicht.

### 3.2 Updates und die Version im Admin

**Admin → System → App-Versionen:**

- Die Liste der Builds mit **Version**, **Build**, **Kanal** (Beta oder Release), **Größe**, **Status**, **Veröffentlicht**.
- **Als aktuelles Release setzen** legt fest, welche Version die App als „neu“ meldet.
- **Pflicht ab Build** (leer oder 0 = keine Pflicht): Liegt eine App darunter, zeigt sie den Banner „Dieses Update ist Pflicht“ ohne „Später“. Den Wert setzt ihr
  nur bei einem Fehler, der ein altes Gerät gefährdet.
- **Was ist neu** (ein Punkt je Zeile) und **APK von Hand hochladen**: Wenn das Release-Skript die APK nicht selbst ablegen konnte.
- **GitHub-Abgleich:** Der Server holt sich neue Releases (Titel `mobile-v…`) selbst, wenn ein GitHub-Token mit nur Lesen eingetragen ist: **GitHub-Token (nur Lesen)**,
  **Repository**, **Jetzt abgleichen**; der Abgleich läuft alle zehn Minuten. **Betas (Pre-Releases) gleich ausrollen** steuert, ob Betas schon als „aktuell“ gelten
  oder nur in der Liste landen.

So merkt die App ein Update: Beim Start und beim Zurückkehren in den Vordergrund fragt sie höchstens einmal pro Stunde nach. Bei einem neueren Build kommt ein
Banner mit **Was ist neu** und **Später**.

- **Aus Google Play installiert:** Updates kommen **nur** über Google Play. „Update starten“ öffnet Googles Update-Dialog; die App zeigt keinen eigenen Hinweis, wenn Play das
  Update schon kennt.
- **Ohne Google Play:** Der Banner führt in den Store bzw. zur Release-Seite; die App installiert selbst nichts (Google erlaubt das nur App-Stores).
- Eine **Beta** fragt vor dem Installieren („Testversion installieren?“ – kann Fehler enthalten), ein Release nennt „Die neue Version ist geprüft und freigegeben“.
- „Was ist neu“ erscheint einmal nach dem Update und jederzeit in den Einstellungen unter **Über die App**.

Release-Ablauf (nur zur Orientierung): Version hochzählen, bauen, in den offenen Test laden, Changelog schreiben – das macht die Entwicklung. **Produktion
freigeben klickt der Betreiber selbst**, das Skript lädt nie nach Produktion.

### 3.3 App-Sperre und Datenschutz

**Profil → Zahnrad → Sicherheit → App-Sperre mit Fingerabdruck:**

- Einschalten fragt einmal den Fingerabdruck (oder Gesicht, Gerätesperre) ab. Ohne eingerichtete Gerätesperre bleibt der Schalter aus.
- Die Sperre gilt **nur auf diesem Gerät**; Fingerabdruck und Gesicht bleiben auf dem Gerät und gehen nie zum Server.
- Beim Öffnen steht „LionsAPP ist gesperrt“ mit Knopf zum Entsperren.

Was mit eingeschalteter Sperre zusätzlich gilt (Stand #1461, kommt mit dem nächsten App-Release; das letzte veröffentlichte ist 1.5.0):

- Gesperrt zeigt die Glocke **keinen Banner**, und ein angetippter Push öffnet sich erst **nach dem Entsperren**.
- Das Gerät meldet sich für Pushes **ohne Inhalt** an: Der Server schickt dann nur „Neue Benachrichtigung“, den Inhalt lädt die App nach dem Entsperren. Gesperrt oder solange
  der Sperrzustand unbekannt ist, zeigt die App Pushes im Vordergrund gar nicht an.
- Ein angemeldetes Konto zeigt sich erst, wenn feststeht, ob die Sperre greift.
- **Kontowechsel:** Wechselt jemand direkt von einem Konto zum anderen, räumt die App so gründlich auf wie beim Abmelden: Glocke, Banner, Zähler, Suchen und die
  gespeicherte Mitgliedskarte des vorigen Kontos verschwinden, und das Gerät meldet sich für Pushes mit dem neuen Konto an. Ohne Sperre und für ältere Apps bleibt alles
  wie bisher.
- **Abmelden** löscht ebenfalls die gespeicherte Karte. **Konto löschen** (Zahnrad → Konto) anonymisiert das Konto dauerhaft und wird zweimal bestätigt.

### 3.4 Push: Kanäle, Themen, Tests

Eine Benachrichtigung entsteht einmal und geht dann über die Kanäle, die die Person eingestellt hat (E-Mail, Push, In-App, Discord). Im Detail:

- **Themen und Kanäle einstellen:** in der App **Profil → Zahnrad → Benachrichtigungen** („Jede Benachrichtigung pro Kanal“), auf der Website
  **Benutzermenü → Einstellungen → Benachrichtigungen einstellen**. Die Einstellungen sind für Web und App dieselben. Themen: Spiel-Erinnerungen, Turnier-Updates,
  Gewinne & Abholung, Erfolge, Wochenrückblick, Rechnungen, Vereinsmitgliedschaft, Geburtstagsgruß, Nachrichten & Erwähnungen, News & Events (nur mit Newsletter-Zustimmung),
  Vereinsintern, Helferdienste. Account- und Sicherheitsmails bleiben immer aktiv.
- **Android-Kanäle** (in den Handy-Einstellungen einzeln stumm schaltbar):
  - **Aufrufe & Spielstart** – wichtig, mit Gong: „Du bist dran“, „Match startet jetzt“, Erinnerung vor dem Spiel; für die Turnierleitung „Braucht Aufmerksamkeit“.
  - **Turniere & Events** – Check-in, Ergebnisse, Anmeldungen, Gewinne, Event-Hinweise.
  - **Chats** – Direkt-, Team-, Turnier- und Match-Chat, Erwähnungen, Freundschafts- und Team-Einladungen.
  - **Verein** – Vereinsintern, News, Mitgliedschaft, Rechnungen.
  - **Erfolge** – Erfolge, Level, Kronen.
  Wer die Chats stumm stellt, verpasst den Spielaufruf nicht.
- **Push testen:** **Admin → System → Push-Tests**: Konto suchen, Titel und Text prüfen, senden. Die Seite zeigt Tokens und den letzten Versand. „In-App erstellt, aber kein aktiver
  Push-Token gefunden“ heißt: Das Konto hat kein Gerät mit Push-Erlaubnis.
- **Monitoring:** In der Kommandozentrale zeigt die Kachel **Push-Monitoring** aktive Tokens und Fehler. Pushes gehen nur an echte Geräte, nie an Emulatoren.
- Mehr zu Mails, Vorlagen und Discord-Nachrichten im Kapitel **Mails und Benachrichtigungen**.

### 3.5 Fehler und Abstürze sehen

**Admin → System → Betrieb & Logs → Reiter „App-Logs“**: Meldungen aus der App mit Gerät, Version und Text, mit Status und Notiz je Eintrag. Abstürze gehen anonym (ohne Nutzerkennung) zusätzlich an Firebase
Crashlytics. Die Datenschutzerklärung der Website bekommt den App-Abschnitt (Push, Absturzberichte, App-Sperre, Konto löschen) von selbst.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Kein Abzeichen „Google Play“ auf der Website | Der Play-Store-Link fehlt | Admin → Auftritt → Branding → **Play-Store-Link (LionsAPP)** eintragen |
| Update wird nicht angeboten | Aus Play installiert: Google rollt es noch aus. Sonst: das neue Release ist nicht „aktuell“ gesetzt | Play Console prüfen; Admin → System → App-Versionen → **Als aktuelles Release setzen** oder **Jetzt abgleichen** |
| Neues GitHub-Release fehlt in der Liste | Kein Token, Abgleich aus, oder Beta ohne den Haken | Token und Repository eintragen, **Betas gleich ausrollen** prüfen, **Jetzt abgleichen** |
| „Token gespeichert, aber mit dem aktuellen Schlüssel nicht lesbar“ | Der Schlüssel der Einstellungen hat sich geändert | Token neu eintragen |
| Der Banner „Dieses Update ist Pflicht“ lässt sich nicht schließen | **Pflicht ab Build** liegt über dem eigenen Build | Update einspielen, oder den Wert im Admin zurücknehmen |
| Kein Push | Keine Erlaubnis am Handy, Kanal am Handy stumm, Push im Profil aus, oder kein Konto angemeldet | Push-Tests ausführen; Handy-Einstellungen und Profil → Benachrichtigungen prüfen |
| Push zeigt nur „Neue Benachrichtigung“ | App-Sperre ist an: Der Inhalt wird erst nach dem Entsperren geladen | Gewollt |
| Beim Tippen auf einen Push passiert nichts | Die App ist noch gesperrt | Entsperren, dann öffnet sich der Inhalt |
| „Dieses Gerät kann keine Passkeys anlegen.“ | Keine Gerätesperre oder kein Passkey-Dienst | Displaysperre einrichten; Passwort-Anmeldung nutzen |
| Alter Passkey wird nicht erkannt | Der Server kennt ihn nicht mehr | Mit Passwort anmelden, die App bietet einen neuen an; den alten im Passwortmanager vergessen |
| Anmeldung fragt nach Code, Handy verloren | Zwei-Faktor ist an | Wiederherstellungscode eingeben |
| Zwei-Faktor einrichten geht in der App nicht | Gibt es dort nicht | Auf der Website: Einstellungen → Sicherheit |
| „Passwort vergessen“ fehlt | Gibt es nur im Web | Auf der Website zurücksetzen |
| Mitgliedskarte zeigt „Prüfcode braucht Netz“ | Ohne Netz zeigt die App die zuletzt geladene Karte | Gewollt, der Prüfcode braucht Verbindung |
| Auf manchen Geräten kein Update-Dialog | Gerät ohne Google Play | APK vom GitHub-Release holen |
| Nach Kontowechsel erscheint noch etwas vom alten Konto | Ältere App ohne den Aufräum-Pfad | Auf die neueste Version aktualisieren; sonst abmelden und neu anmelden |

---

## 5. Häufige Fragen

**Gibt es die App für iOS?**
Noch nicht. Veröffentlicht ist die App für Android. Das iOS-Projekt ist vorbereitet, eine Version im Store gibt es nicht; das Update-Fenster nennt schon „TestFlight“ als späteren Weg.

**Brauche ich ein Konto?**
Nein, Turniere, Events und News sind ohne Konto sichtbar. Anmelden, Chat und Mitgliederbereich brauchen eins.

**Wer entscheidet, wann die App für alle freigegeben wird?**
Der Betreiber, in der Play Console („Produktion“). Bis dahin läuft sie im offenen Test.

**Kann ich eine Version zurücknehmen?**
Im Admin unter App-Versionen setzt ihr ein anderes Release als aktuell, und die APK-Kopie lässt sich entfernen. Bei Play-Installationen entscheidet Google Play.

**Kann man in der App bezahlen?**
Nein, Rechnungen kommen aus der Mitgliederverwaltung; bezahlt wird im Browser.

**Können Mitglieder in der App abstimmen?**
Ja, bei Versammlungen, wenn sie Stimmrecht haben; geheime Wahlen auf Papier laufen im Saal.

**Wie viele Geräte kann ein Konto haben?**
Beliebig viele; unter Zahnrad → Sicherheit stehen die angemeldeten Geräte, einzelne lassen sich abmelden.

**Wie kommt der Verein an Rückmeldungen zu Abstürzen?**
Admin → System → Betrieb & Logs → App-Logs.
