# Erste Schritte im Admin – Handbuch

Wie ihr in den Admin-Bereich kommt, wer dort was sieht, wie ihr euch zurechtfindet und wie ihr Rechte vergebt. Das
Kapitel ist der Einstieg: Alle anderen Kapitel setzen voraus, dass ihr hier einmal durch seid.

**Wo im Admin:**

- **Admin** (`/admin`) – die Startseite, im Menü „Dashboard“, auf der Seite „Kommandozentrale“
- **Admin → Mitglieder → Alle Benutzer** (`/admin/users`) – Rollen und Freigaben vergeben (nur der Superadmin ändert sie)
- **Admin → System → Einrichtung & FAQ** (`/admin/setup`) – Antworten auf „Wo stelle ich was ein?“ (nur Bereich System)
- **Benutzermenü → Einstellungen → Sicherheit** (`/profile?tab=security`) – Zwei-Faktor-Anmeldung einrichten

---

## Inhalt

1. [Überblick: was alles geht](#1-überblick-was-alles-geht)
2. [Einrichten Schritt für Schritt](#2-einrichten-schritt-für-schritt)
3. [Die Funktionen einzeln](#3-die-funktionen-einzeln)
4. [Wenn etwas nicht klappt](#4-wenn-etwas-nicht-klappt)
5. [Häufige Fragen](#5-häufige-fragen)

---

## 1. Überblick: was alles geht

| Funktion | Was passiert | Wo |
| --- | --- | --- |
| **Bereiche** | Rechte hängen an Bereichen (Turnierleitung, Redaktion, Vereinsverwaltung, Finanzen, System, Moderation), nicht an einer Rangfolge | Admin → Mitglieder → Alle Benutzer |
| **Menü** | Zeigt nur die Seiten, für die du einen Bereich hast; Gruppen lassen sich zuklappen | linke Leiste im Admin |
| **Suche** | „Admin suchen …“ findet Seiten und Reiter, auch über Stichwörter | oben in der linken Leiste |
| **Kommandozentrale** | Offene Aufgaben, Termine heute, Zahlen, Schnellzugriff | Admin |
| **Zwei-Faktor** | Pflicht für jeden Bereich außer Moderation; ohne sie öffnet sich die Verwaltung nicht | Benutzermenü → Einstellungen → Sicherheit |
| **Freigaben** | Einzelne Bereiche an eine Person geben, ohne die Rolle zu ändern | Admin → Mitglieder → Alle Benutzer → Bearbeiten |
| **Helfer-Einsatz** | Eine Person hilft bei einem Turnier oder einer Fast Lap und sieht nur das | Turnier bzw. Fast Lap öffnen, Reiter „Team“ |
| **Einrichtung & FAQ** | Fragen und Antworten zur Einrichtung, mit Weg zur richtigen Seite | Admin → System → Einrichtung & FAQ |

---

## 2. Einrichten Schritt für Schritt

### 2.1 Zwei-Faktor einrichten (alle mit einem Adminbereich)

Ohne bestätigte Zwei-Faktor-Anmeldung zeigt das Benutzermenü statt „Admin“ den Eintrag **2FA einrichten**, und im
Admin-Menü steht oben ein gelber Kasten **2FA einrichten**. Beide führen an dieselbe Stelle.

1. Du brauchst eine **Authenticator-App** auf dem Handy (zum Beispiel Google Authenticator, Aegis oder 2FAS).
2. **Benutzermenü (dein Name oben rechts) → Einstellungen → Sicherheit**. Dort steht der Kasten
   **Zwei-Faktor-Anmeldung**. (Kommst du über den Hinweis „2FA einrichten“, bist du schon da.)
3. **Aktuelles Passwort** eintragen und **MFA einrichten** klicken.
4. Den **QR-Code** mit der App scannen (oder den **Manuellen Schlüssel** eintippen).
5. Den **sechsstelligen Code** aus der App eintragen und **MFA bestätigen**. Der Code muss innerhalb von zehn Minuten
   nach Schritt 3 kommen, sonst Schritt 3 wiederholen.
6. Es erscheinen **Wiederherstellungscodes**. Sie werden **nur einmal** angezeigt. Mit **Codes kopieren** sichern und
   offline aufbewahren (Passwort-Manager oder Ausdruck). Sie sind der Rückweg, wenn das Handy weg ist.
7. **Einmal ab- und wieder anmelden.** Erst die neue Anmeldung gilt als bestätigt, danach öffnet sich der Admin.

### 2.2 Erste Orientierung

1. Benutzermenü → **Admin**. Du landest auf der **Kommandozentrale**.
2. Schau links ins Menü: Du siehst nur Gruppen und Seiten, für die du einen Bereich hast (3.2).
3. Probier die Suche oben („Admin suchen …“) mit einem Stichwort aus, zum Beispiel „logo“ oder „check-in“ (3.3).
4. Mit **Public Seite** ganz unten im Menü kommst du zurück auf die normale Website.

### 2.3 Rechte an eine Person vergeben

Das kann nur der **Superadmin**. Siehe 3.6.

---

## 3. Die Funktionen einzeln

### 3.1 Bereiche und Rollen

Jede Person hat null, einen oder mehrere **Bereiche**. Sie kommen aus der **Rolle**, aus einer **Freigabe** oder aus
einem Vorstandsposten.

| Bereich | Gehört dazu |
| --- | --- |
| **Turnierleitung** | Turniere, Events, Stationen, Fast Lap, Jahreswertung, Spiele, TV & Beamer, Gewinne, Strafen |
| **Redaktion** | News, Galerie, Medien, Sponsoren, Partner, Referenzen, Navigation, Erfolge, Sticker, Adventkalender, Ostereiersuche |
| **Vereinsverwaltung** | Mitglieder, Bewerbungen, Dokumente, Vorteile, Vorstand, Kontakt-Inbox, Benutzer, Dolibarr |
| **Finanzen** | Finanzübersicht, Kosten und Startgelder |
| **System** | Verbindungen, E-Mail, Auftritt, Betrieb & Logs, Status, Zugang, App-Versionen, Game-Server |
| **Moderation** | Meldungen, Wortfilter, Sperren – siehe [Moderation](../MODERATION.md) |

Welche Rolle welche Bereiche mitbringt:

| Rolle | Bereiche | Zwei-Faktor |
| --- | --- | --- |
| Superadmin | alle; vergibt Rollen und Freigaben | Pflicht |
| Club-Admin | alle | Pflicht |
| Turnierleitung | Turnierleitung und Moderation | Pflicht |
| Moderator | Moderation | nicht nötig |
| Spieler | keiner | – |

Die Rolle „Turnierleitung“ heißt im Admin genauso wie der Bereich „Turnierleitung“. Den Bereich kann auch eine Person
mit anderer Rolle per Freigabe haben. **Vereinsverwaltung** bekommt außerdem, wer einen aktiven Vorstandsposten hält
(Details in [Rollen](../ROLLEN.md)).

### 3.2 Das Menü je Rolle

Die linke Leiste ist in Gruppen gegliedert. Ein Eintrag erscheint, wenn du einen der genannten Bereiche hast **und**
die Zwei-Faktor-Anmeldung bestätigt ist (Moderation ausgenommen).

| Gruppe | Einträge (Bereich) |
| --- | --- |
| **Übersicht** | Dashboard (Turnierleitung, Redaktion, Vereinsverwaltung, System) |
| **Verein** | Vereinsdaten (System) · Über uns, Sponsoren, Partner, Referenzen (Redaktion) · Vorstand, Kontakt-Inbox (Vereinsverwaltung) |
| **Mitglieder** | Mitglieder, Mitgliederprofile, Bewerbungen, Mitgliedervorteile, Dokumente, Einlass (Versammlung), Alle Benutzer (Vereinsverwaltung) · Dolibarr (Vereinsverwaltung, System) |
| **Finanzen** | Finanzübersicht (Finanzen) |
| **eSports** | Turniere, Fast Lap, Stationen (Turnierleitung und Helfer mit Einsatz) · Turnier-Leitfaden, Jahreswertung, Spiele, TV & Beamer, Gewinne, Strafen (Turnierleitung) · Game-Server (System) |
| **Content** | Events (Turnierleitung) · News, Medien, Navigation, Erfolge, Sticker (Redaktion) · Galerie, Adventkalender, Ostereiersuche (Redaktion, Vereinsverwaltung) · Downloads & QR (Turnierleitung, Redaktion, Vereinsverwaltung, System) |
| **Verbindungen** | Alle Verbindungen, dazu eine Seite je Dienst (System) |
| **E-Mail** | Newsletter, Mail-Queue, E-Mail-Vorlagen (System) |
| **Auftritt** | Branding, Socials, SEO & Analytics, Jahreszeiten (System) |
| **System** | Betrieb & Logs, Status, Push-Tests, App-Versionen, Zugang, Einrichtung & FAQ (System) · Moderation (Moderation) |

Gut zu wissen:

- Die **Gruppen** lassen sich mit einem Klick auf den Gruppennamen **zuklappen**. Das merkt sich der Browser. Beim
  Wechsel auf eine Seite geht ihre Gruppe von selbst wieder auf.
- Zugeklappt zeigt die Gruppe die Zahl ihrer Einträge, ein blauer Punkt markiert die Gruppe der aktuellen Seite.
- Wer **abgehakte Plattformen** unter „Alle Verbindungen“ hat, sieht diese nicht mehr als Menüpunkt.
- Wer **keinen** Bereich hat, sieht kein Menü.

### 3.3 Die Suche

Oben links im Menü: **Admin suchen …**.

- Sie findet **Seiten** nach Menüname, Gruppe und Stichwörtern. „Logo“ führt zu Branding, „Check-in“ zum Leitfaden.
- Sie findet auch **Reiter**, die nicht im Menü stehen: zum Beispiel die fünf Reiter der Seite Dolibarr („Dolibarr:
  Verbindung“, „… Funktionen (Schalter)“, „… Umstellung“, „… Zuordnungen“, „… Bereiche (Vorstand → Rechte)“). Diese
  Wegweiser erscheinen nur, solange du suchst.
- Während der Suche sind alle Treffer aufgeklappt.
- Sie zeigt nur Seiten, die du auch öffnen darfst.
- Texte mit `@` oder `http` werden sofort wieder gelöscht: Die Suche ist für Seiten da, nicht für Adressen.
- Findet sie nichts, steht dort „Keine Admin-Seite gefunden.“ mit dem Knopf **Suche leeren**.

### 3.4 Die Kommandozentrale

**Admin** (Menü: Dashboard). Alle mit einem Adminbereich sehen **dieselbe** Seite. Eine eigene Startseite je Rolle gibt
es noch nicht; manche Kacheln führen deshalb zu Seiten, die dir fehlen können (dann kommt „Kein Zugriff“, 4).

Von oben nach unten:

| Block | Was drinsteht |
| --- | --- |
| **Statusleiste** | Datenbank, Mail / SMTP, Discord, Scheduler, Mail-Queue, Push-Tokens mit grünem, gelbem oder rotem Punkt; ein Klick führt zur Seite dahinter |
| **Plattform-Setup** | Nur wenn die Grundeinrichtung noch nicht vollständig ist: Fortschritt in Prozent und was fehlt |
| **Tageszentrale – Offene Aufgaben** | Nur, wo wirklich etwas wartet (Ergebnis-Konflikte, gemeldete Ergebnisse, Terminvorschläge, Moderation, Kontaktanfragen, Mitgliedsanträge, Turnier-Anmeldungen, Gewinne und mehr). Steht nichts an, heißt es „Nichts offen.“ |
| **Termine heute** | Matches, Check-ins und Events des Tages |
| **Weitere Werkzeuge** | Aufklappbar: Links zu Seiten, bei denen gerade nichts ansteht |
| **Schnellzugriff** | **+ Turnier**, **+ Fast-Lap-Challenge**, **Events**, **Stationen** |
| **Zahlen im Überblick** | Spieler, Teams, Aktive Turniere, Anmeldung offen, Spiele heute, Fast Lap Live, Events Gesamt |
| **Wachstum** | Logins und neue Mitglieder der letzten 30 Tage |
| **Einstellungen-Zentrale** | Kacheln zu Login, Konten verknüpfen, Branding, E-Mail, Discord, Twitch, Socials und mehr |
| **Letzte Adminaktionen** | Die letzten acht Einträge; **Alle Logs** öffnet Betrieb & Logs |

Die Zahlen laden von selbst nach (regelmäßig von selbst) und mit dem Knopf oben rechts (zeigt die Uhrzeit der letzten
Aktualisierung).

### 3.5 Zwei-Faktor im Alltag

- **Pflicht** ist sie für jeden Bereich außer **Moderation**. Es zählt nicht, woher der Bereich kommt (Rolle, Freigabe,
  Vorstandsposten): Ohne bestätigte Zwei-Faktor-Anmeldung bleibt die Verwaltung zu und der Server lehnt Anfragen ab.
- Betroffen sind auch die **Turnierseiten**. Die **Turnierleitung** verwaltet Turniere, Fast Lap und Stationen nur mit
  bestätigter Zwei-Faktor-Anmeldung. Ohne sie erscheint **2FA einrichten**.
- **Helfer mit Einsatz** (3.7) brauchen sie für ihren Einsatz nicht. Auch eine Turnierleitung ohne 2FA, die als Helfer
  eingetragen ist, kommt in diesen Einsatz, sieht dort aber nur dessen Aktionen.
- **Anmelden:** Mit Passwort fragt die Seite danach den Code aus der App. Statt des Codes geht ein **Wiederherstellungscode**.
- **Passkey** (Fingerabdruck, Gesicht oder Geräte-PIN) zählt als zweiter Faktor: Nach einer Passkey-Anmeldung kommt
  kein Code mehr, die Sitzung gilt als bestätigt. Eingerichtet sein muss die Zwei-Faktor-Anmeldung trotzdem – sie ist
  der Rückweg, wenn das Gerät weg ist.
- **Ausschalten** geht an derselben Stelle mit Passwort und Code (**MFA deaktivieren**); danach meldest du dich neu
  an. Mit einem Adminbereich bleibt die Verwaltung dann zu, bis du sie wieder einrichtest.
- Läuft dein Konto **nur über Google**, richte zuerst ein eigenes Passwort ein („Passwort vergessen“), sonst lässt sich
  die Zwei-Faktor-Anmeldung nicht einrichten.

### 3.6 Freigaben vergeben

Nur der **Superadmin**. **Admin → Mitglieder → Alle Benutzer**:

1. Person in der Suche finden (Name, Benutzername oder E-Mail), **Bearbeiten** klicken. Es öffnet sich ein Blatt.
2. Im Abschnitt **Rolle und Freigaben** die **Rolle** wählen und unter **Freigaben** Haken setzen: **Turnierleitung**,
   **Redaktion**, **Vereinsverwaltung**, **Finanzen**. Was die Rolle schon mitbringt, ist grau mit „schon in der Rolle“.
3. Unter dem Auswahlfeld steht ein Satz, was die Person dadurch bekommt oder verliert. **Speichern** und die Rückfrage
   bestätigen. Erst dann gilt es.

Wichtig:

- **System** lässt sich nicht freigeben. Es gehört zu Club-Admin und Superadmin.
- Eine Freigabe gilt überall genauso wie die Rolle.
- Die Person braucht für die neuen Bereiche **Zwei-Faktor** (3.5).
- **Club-Admin und Vereinsverwaltung** sehen Rolle und Bereiche im Blatt nur als Text. Sie können Spieler-Konten
  **sperren** (mit Grund, mindestens fünf Zeichen; die Person bekommt den Grund per Mail), aber keine Rechte ändern.
- Konten mit Adminbereich sperrt und entsperrt nur der Superadmin. Superadmin-Konten lassen sich nicht sperren, das
  eigene Konto auch nicht.
- Weitere Rechte-Themen (Vorstand besetzen, Dolibarr-Funktionen als Rechtequelle) stehen in [Rollen](../ROLLEN.md).

### 3.7 Helfer, Moderation – und „Mein Dienst“

Es gibt zwei Wege zu einer Rolle ohne Verwaltungsbereich:

- **Helfer in einem Turnier oder einer Fast Lap:** Die Turnierleitung trägt die Person im Turnier unter **Admin →
  eSports → Turniere → Turnier öffnen → Reiter „Team“** ein (Rollen: Organisation, Schiedsrichter, Ergebnisdienst,
  Stationsleitung, Stream-Betreuung). Bei der Fast Lap geht das im Kasten „Fast-Lap-Team“, siehe
  [Fast Lap](fastlap.md). Helfer sehen in der Verwaltung **nur ihr Turnier** bzw. **ihre Fast Laps**; im Menü stehen
  ihnen **Turniere**, **Fast Lap** und **Stationen**. Sie brauchen dafür keinen Bereich und keine Zwei-Faktor-Anmeldung.
- **Moderator** (nur Bereich Moderation): sieht im Menü nur **System → Moderation**.

Ehrlich dazu: Einen Menüpunkt **„Mein Dienst“** gibt es noch nicht (er ist geplant). Für beide gilt deshalb heute:

- Im Benutzermenü steht **kein** Eintrag „Admin“ (er erscheint nur mit einem Verwaltungsbereich), und **Admin** selbst
  (die Kommandozentrale) ist für sie gesperrt.
- Helfer kommen über den Link **Turnierleitung** auf der öffentlichen Turnierseite zu ihrer Ansicht
  (`/tournaments/<Name>/leitung`, siehe [Turniere](turniere.md)) oder direkt per Adresse zu `/admin/tournaments`.
- Moderatoren erreichen ihre Seite über die Adresse `/admin/moderation`. Gebt ihnen die Adresse als Lesezeichen.

### 3.8 Einrichtung & FAQ

**Admin → System → Einrichtung & FAQ** (nur Bereich System, Seitenname „Einrichtung“). Fragen und Antworten in
Alltagssprache, nach Themen gegliedert (Verein, Mitglieder, Dolibarr, Turniere und eSports, Discord, E-Mail, Login und
Konten, Inhalte und Auftritt, LionsAPP, Betrieb und Sicherheit), mit Suchfeld und dem Weg zur passenden Seite. Bei
Diensten wie Discord, Twitch, Google oder Resend gibt es Schritt-für-Schritt-Anleitungen mit Links zu den
Entwickler-Konsolen.

Die Antworten sind kurz. Dieses Handbuch geht tiefer. Wo beide sich widersprechen, gilt das Handbuch; sagt es der
Oberfläche, gilt die Oberfläche.

### 3.9 Wo steht welches Thema?

Jedes Thema hat genau **einen** Ort:

| Ich will … | Dann hier | Kapitel |
| --- | --- | --- |
| Discord-Bot, Meldungen, Kanäle, Rollen | Admin → Verbindungen → Discord | [Discord](discord.md) |
| Turnier anlegen und leiten | Admin → eSports → Turniere | [Turniere](turniere.md) |
| Welches Turnierformat passt? | Admin → eSports → Turnier-Leitfaden | [Turniere](turniere.md) |
| Fernseher und Beamer | Admin → eSports → TV & Beamer | [TV und Beamer](tv.md) |
| Fast-Lap-Challenge | Admin → eSports → Fast Lap | [Fast Lap](fastlap.md) |
| Logo, Farbe, Hinweisleisten | Admin → Auftritt → Branding | [Auftritt](auftritt.md) |
| Impressum, Datenschutz, Vereinsdaten | Admin → Verein → Vereinsdaten | [Auftritt](auftritt.md) |
| Jahreszeiten, Adventkalender, Ostereiersuche | Auftritt → Jahreszeiten, Content → Adventkalender / Ostereiersuche | [Auftritt](auftritt.md) |
| Mitglieder, Dolibarr | Admin → Mitglieder | [Dolibarr](../DOLIBARR.md) |
| Rechnungen, Startgeld, Kosten | Admin → Finanzen → Finanzübersicht | [Abrechnung](../ABRECHNUNG.md) |
| Meldungen, Sperren, Wortfilter | Admin → System → Moderation | [Moderation](../MODERATION.md) |
| Rollen und Freigaben | Admin → Mitglieder → Alle Benutzer | dieses Kapitel, [Rollen](../ROLLEN.md) |
| Server, Updates, Sicherungen | Admin → System → Betrieb & Logs, Status | [Betrieb](../BETRIEB.md) |
| App-Versionen, Play Store | Admin → System → App-Versionen | [Play Store](../PLAY_STORE.md) |

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Im Benutzermenü steht „2FA einrichten“ statt „Admin“, im Admin-Menü ein gelber Kasten | Du hast einen Adminbereich, aber noch keine bestätigte Zwei-Faktor-Anmeldung | 2.1 durchgehen, danach neu anmelden |
| 2FA ist eingerichtet, das Menü zeigt trotzdem „2FA einrichten“ | Die laufende Sitzung ist noch nicht bestätigt | Ab- und neu anmelden |
| „Für den Adminbereich ist eine bestätigte Zwei-Faktor-Anmeldung erforderlich.“ | Dasselbe, die Meldung kommt vom Server | wie oben |
| „Bitte zuerst ein eigenes Passwort über Passwort vergessen setzen.“ | Das Konto läuft nur über Google, die Einrichtung braucht ein Passwort | „Passwort vergessen“ auf der Anmeldeseite nutzen, dann 2.1 |
| Das Einrichten klappt nicht, der Code wird nicht angenommen | Der Code ist älter als zehn Minuten, oder die Uhr am Handy geht falsch | MFA einrichten erneut anklicken und mit dem neuen QR-Code arbeiten; Uhrzeit am Handy automatisch einstellen |
| Handy verloren, kein Code | – | Mit einem Wiederherstellungscode anmelden (jeder gilt einmal) oder mit einem Passkey |
| „Kein Zugriff“ mit „Dafür fehlt dir der Bereich …“ | Die Seite verlangt einen Bereich, den du nicht hast | Beim Superadmin die Freigabe erfragen (3.6) |
| Du bist Moderator oder Helfer und findest „Admin“ nicht | Beide haben keinen Verwaltungsbereich, „Mein Dienst“ gibt es noch nicht | Wege in 3.7 |
| Ein Menüpunkt aus einer Anleitung fehlt | Er gehört zu einem Bereich, den du nicht hast, oder es ist nur ein Reiter | Suche nutzen (3.3) |
| Du kannst die Rolle einer Person nicht ändern | Nur der Superadmin darf das; du siehst nur Text | Superadmin fragen |
| Eine Person lässt sich nicht sperren | Superadmin-Konto, eigenes Konto, oder ein Konto mit Adminbereich (das sperrt nur der Superadmin) | Siehe 3.6 |
| Freigabe gespeichert, die Person sieht nichts | Sie hat noch keine bestätigte Zwei-Faktor-Anmeldung, oder sie muss sich neu anmelden | 3.5 |
| Eine Kachel der Kommandozentrale führt zu „Kein Zugriff“ | Alle sehen dieselbe Seite, die Zielseite braucht aber einen bestimmten Bereich | Gewollt, solange es keine Startseite je Rolle gibt |

---

## 5. Häufige Fragen

**Ist die Zwei-Faktor-Anmeldung wirklich für alle Pflicht?**
Für jeden Adminbereich außer Moderation: ja, egal ob er aus der Rolle, einer Freigabe oder einem Vorstandsposten kommt.
Für Helfer mit Einsatz in einem Turnier nein.

**Reicht ein Passkey statt der Authenticator-App?**
Für die Anmeldung ja. Die Zwei-Faktor-Anmeldung muss aber trotzdem eingerichtet sein, damit der Adminbereich aufgeht.
Der Hinweistext im Passkey-Kasten („Eine eingerichtete Admin-MFA wird weiterhin abgefragt“) ist hier ungenau.

**Warum sehe ich weniger im Menü als mein Vorstandskollege?**
Weil das Menü nach Bereichen filtert. Prüft unter Alle Benutzer, welche Bereiche ihr jeweils habt.

**Kann ich einem Spieler nur „Turnierleitung“ geben?**
Ja, per Freigabe. Er sieht dann alle Turniere, Fast Laps, Stationen, Events und das TV-Werkzeug, aber nichts aus
Redaktion oder Verein.

**Kann die Turnierleitung News schreiben?**
Nein. News, Galerie, Sponsoren und Partner gehören zur Redaktion.

**Wer sieht welche Turniere?**
Die Turnierleitung (mit bestätigter Zwei-Faktor-Anmeldung) alle. Helfer nur die Turniere, in denen sie eingetragen sind.

**Brauche ich als Moderator Zwei-Faktor?**
Nein, Moderation ist die Ausnahme. Hast du aber zusätzlich einen anderen Bereich, gilt er für diesen.

**Wo ist das Menü am Handy?**
Das Symbol oben links (drei Striche, „Admin-Menü öffnen“).

**Gibt es ein Hilfe-„?“ auf jeder Seite?**
Noch nicht. Hilfe gibt es unter Admin → System → Einrichtung & FAQ und in diesem Handbuch.

**Wo verbinde ich ein Turnier mit einem Event?**
Nur im Event: Admin → Content → Events → Event öffnen → **Programm** (**+ Turnier in diesem Event**, **+ Fast Lap**,
**Bestehendes hinzufügen**, **Lösen**). In der Eventliste erscheint **Rückblick schreiben** erst, wenn das Event vorbei ist.
