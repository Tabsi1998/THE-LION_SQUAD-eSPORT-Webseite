# Mails und Benachrichtigungen – Handbuch

Wie Mitteilungen der Website zu den Leuten kommen: Mail-Versand einrichten, die Texte der Mails ändern, die
Warteschlange im Blick behalten, Push in der App, Discord-Direktnachrichten – und was Mitglieder selbst an- und
abschalten können.

**Wo im Admin:**

- **Admin → Verbindungen → Resend** (`/admin/settings/resend`) – Mail-Versand über Resend: Schlüssel, Absender, Testmail
- **Admin → Verbindungen → SMTP** (`/admin/settings/smtp`) – Mail-Versand über einen eigenen Mailserver, mit Diagnose
- **Admin → E-Mail → E-Mail-Vorlagen** (`/admin/email-templates`) – alle Mails mit Text und Vorschau
- **Admin → E-Mail → Mail-Queue** (`/admin/settings/mail-queue`) – die Warteschlange
- **Admin → E-Mail → Newsletter** (`/admin/settings/newsletter`) – der Verlauf der verschickten Newsletter
- **Admin → System → Push-Tests** (`/admin/mobile-push`) – Push an ein Konto testen
- **Admin → System → Betrieb & Logs → Ereignisse** – jede Mail und jede Discord-Meldung mit Stand
- **Admin → System → Status** – Ampeln für Mail und Scheduler
- **Benutzermenü → Einstellungen → Benachrichtigungen** (`/profile?tab=notifications`) – was Mitglieder selbst einstellen
- **Glocke** im Kopf und **/notifications** – die Liste der Benachrichtigungen

Wer das darf: Alles unter Verbindungen, E-Mail und System der Bereich **System**. Den Newsletter zu News und Events schickt man im
Kasten **Verteilen** am Beitrag ([Inhalte](inhalte.md)).

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
| **Mail-Versand** | Alle Mails der Website gehen über einen Weg: Resend **oder** eigenen SMTP-Server | Verbindungen → Resend / SMTP |
| **Mail-Vorlagen** | Betreff und Text jeder Mail, mit Vorschau und Testmail | E-Mail → E-Mail-Vorlagen |
| **Mail-Queue** | Jede Mail wartet erst, wird dann gesendet; Fehler lassen sich wiederholen | E-Mail → Mail-Queue |
| **Newsletter** | Beim Veröffentlichen von News und Events an alle mit Zustimmung | Kasten „Verteilen“, Verlauf unter E-Mail → Newsletter |
| **Benachrichtigungen** | Eine Meldung, vier mögliche Kanäle: E-Mail, Push, In-App, Discord | Einstellungen → Benachrichtigungen (Mitglied) |
| **Push in der App** | Mitteilungen aufs Handy, in fünf Kanälen mit eigener Lautstärke | App-Einstellungen am Handy; Test unter Push-Tests |
| **Discord-Direktnachricht** | Dieselbe Meldung als Nachricht vom Vereins-Bot | Mitglied schaltet den Kanal ein |

---

## 2. Einrichten Schritt für Schritt

### 2.1 Mail-Versand über Resend (der einfache Weg)

1. **Admin → Verbindungen → Resend.** Bei Resend (resend.com) ein Konto anlegen, unter „API Keys“ einen Schlüssel mit der
   Berechtigung „Sending access“ erzeugen und im Feld **Resend API** eintragen. Der Schlüssel wird danach nur maskiert angezeigt;
   leer lassen behält den gespeicherten.
2. Bei Resend unter „Domains“ die Vereinsdomain hinzufügen, die DNS-Einträge (SPF, DKIM) beim Domain-Anbieter anlegen und in
   Resend bestätigen. Ohne bestätigte Domain landen Mails im Spam oder werden abgelehnt.
3. Hier **Absendername**, **Absender-E-Mail** (zum Beispiel `noreply@`, gefolgt von eurer Domain) und **Antworten an** (Vereinspostfach) eintragen.
4. **Testmail senden**. Kommt sie an, **Versand aktiv** einschalten und speichern.

### 2.2 Oder: eigener Mailserver (SMTP)

1. **Admin → Verbindungen → SMTP.** Bei **Provider** **SMTP (eigener Server)** wählen. Es gilt immer **nur ein Weg**; welcher gerade aktiv ist,
   steht auch unter System → Status.
2. **SMTP Host**, **Port** (587 = STARTTLS, 465 = SSL/TLS, 25 = ohne), **User** und Passwort, **Sicherheit** (Auto nach Port). Empfohlen ist
   **Mit Benutzer/Passwort**.
3. **Absender E-Mail**, **Absendername**, **Antworten an**. Unter den technischen Feldern (Technischer SMTP-Absender, Message-ID Domain, HELO/EHLO)
   reichen meist die Vorgaben.
4. **Port-Check** und **TLS Zertifikat** prüfen die Verbindung; **SMTP Testmail** schickt eine echte Mail. Die **DNS Checkliste gegen Spam**
   erinnert an SPF, DKIM, DMARC und rDNS – ohne sie landen Mails beim Empfänger leicht im Spam.
5. **Versand aktiv** einschalten, speichern.

### 2.3 Prüfen

- **Admin → System → Status** und die Kommandozentrale (Chips „Mail / SMTP“ und „Mail-Queue“) zeigen grün.
- Eine Registrierung mit einer Test-Adresse durchspielen: Die Bestätigungsmail muss ankommen.

---

## 3. Die Funktionen einzeln

### 3.1 Welche Mails es gibt

Account- und Sicherheitsmails (Bestätigung, Passwort zurücksetzen, Anmeldung) sind **immer aktiv** und lassen sich nicht abbestellen.
Alle anderen sind **Themen**, die jede Person selbst an- und abschalten kann (3.6). Die wichtigsten Themen:

| Thema | Wofür |
| --- | --- |
| **Spiel-Erinnerungen** | Startzeiten, Spiel-Hub, Check-in-nahe Hinweise, Aufruf, Ergebnis-Meldungen, Disputes |
| **Turnier-Updates** | Anmeldung (eingegangen, bestätigt, abgelehnt, Warteliste), Check-in, Ergebnisse, „Turnier beendet“, „Wie war …?“ am Tag danach, Fotos vom Event („Die Fotos sind da“) |
| **Gewinne & Abholung** | Gewinn bereit, übergeben, Frist abgelaufen |
| **Erfolge** | Freigeschaltete Erfolge – nur In-App, Push, Discord, keine Mail |
| **Wochenrückblick** | Montags eine Mail mit XP und neuen Erfolgen, nur bei Aktivität, nur per Mail |
| **Rechnungen** | „Deine Rechnung ist da“ – nur In-App, Push, Mail; Beträge gehen nie über Discord |
| **Vereinsmitgliedschaft** | Bewerbung, Mitgliedsstatus, Vorteile |
| **Geburtstagsgruß** | Einmal im Jahr eine Mail vom Verein |
| **Nachrichten & Erwähnungen** | Direktnachrichten, Team-Chat-Erwähnungen, Freundschafts- und Team-Einladungen |
| **News & Events** | Neue News, Events, Ankündigungen – nur mit Newsletter-Zustimmung, Standard aus |
| **Vereinsintern** | Interne Events und News, die nur Mitglieder sehen (Mitglieder-Fotoalben melden hier) |
| **Helferdienste** | Nur für Mitglieder: Aufrufe für offene Schichten, Erinnerung am Vortag – keine Mail |

Nachrichtentexte anderer Personen stehen nie in Mails oder Discord-Nachrichten, nur „Du hast eine Nachricht“ mit Link.

### 3.2 Mail-Vorlagen

**Admin → E-Mail → E-Mail-Vorlagen.** Eine Liste aller Mails, die die Website verschickt, nach Thema. Je Vorlage stehen Zweck, Empfänger
und die Variablen, die ihr einsetzen dürft. Unter **Bearbeiten** ändert ihr **Betreff** und **Text (HTML)**; die **Vorschau mit
Beispieldaten** zeigt das Ergebnis, eine **Testmail** geht an euch selbst. Gespeichert gilt der Text sofort („ab jetzt geht dieser Text raus“).
**Auf Standard zurücksetzen** verwirft eure Fassung und stellt den mitgelieferten Text wieder her.

Einige Mails sind feste Vorlagen: Dort ist der gerenderte Standard der Ausgangspunkt.

### 3.3 Die Mail-Queue

**Admin → E-Mail → Mail-Queue.** Jede Mail wird zuerst eingereiht und dann versendet. Stände: **Wartet**, **Sendet**, **Gesendet**,
**Fehlgeschlagen**, **Übersprungen**. Oben ein Filter **Nach Stand filtern**, darunter die Liste mit Mail, Stand und Zeitpunkt.

- Empfänger stehen **gekürzt** da: erster Buchstabe und Domain, zum Beispiel `m***@gmail.com` – auch in der Meldung des
  Mailservers. **Adresse zeigen** in der Zeile zeigt die ganze Adresse dieser einen Mail, **Verbergen** kürzt wieder. Jedes
  Aufdecken steht im Protokoll (**Betrieb & Logs → Ereignisse**, Adminaktionen: wer, wann, welche Mail – ohne die Adresse).
- **Adresse suchen** findet Mails an eine bestimmte Adresse (auch nur ein Teil davon); die Treffer stehen ebenfalls gekürzt da.
  **Suche leeren** zeigt wieder alle.
- Bei **Fehlgeschlagen** erscheint **Nochmal versuchen**; eine gesendete Mail geht nie ein zweites Mal hinaus. **Löschen** steht unter „Mehr“.
- Oben: **Jetzt verarbeiten** (Warteschlange sofort abarbeiten), **Hängende Mails neu anstoßen** (stellt Mails zurück, die lange beim Senden
  hängen), **Alle fehlgeschlagenen nochmal versuchen** und **Aufräumen** (löscht Einträge älter als 30 Tage).
- Ein Hinweisfeld nennt, wie viele Mails hängen und das letzte Problem mit Grund.
- **Übersprungen** heißt: Es wurde nicht versendet, zum Beispiel weil kein Versandweg aktiv ist. Der Grund steht
  in der Zeile.
- Für einzelne Mails mit Stand: **Admin → System → Betrieb & Logs → Ereignisse**, Quelle **E-Mail**.

### 3.4 Newsletter

News und Events gehen **beim Veröffentlichen von selbst** an alle mit Newsletter-Zustimmung. Gesendet wird im Kasten **Verteilen** am Beitrag
(Empfängerzahl, **Jetzt senden**, ein zweites Mal nur Redaktion und System). Unter **Admin → E-Mail → Newsletter** steht für System der
**Verlauf**: welche News und Events wann an wie viele Personen gingen – ohne Namen und Adressen. Entwürfe und „Nur intern“ gehen nicht hinaus.
Die Einwilligung gibt jede Person getrennt im Profil (3.6); sie ist jederzeit widerrufbar.

### 3.5 Push, In-App und Discord

Eine Benachrichtigung entsteht einmal und geht dann, je nach Einstellung der Person, über die Kanäle:

- **In-App:** die **Glocke** im Kopf und **/notifications**. Gleichartige Meldungen innerhalb einer Stunde (Chat-Nachrichten desselben
  Absenders, desselben Team-, Turnier- oder Match-Chats) werden zu einer Zeile gebündelt („3 neue Nachrichten von …“). Ein Tipp führt zur
  passenden Seite.
- **Push:** auf registrierten Handys mit der LionsAPP. Android kennt fünf **Kanäle**, die jede Person in den Handy-Einstellungen einzeln stumm
  schalten kann: **Aufrufe & Spielstart** (wichtig, mit Gong: Du bist dran, Match startet jetzt, Erinnerung vor dem Spiel; für die Turnierleitung
  „Braucht Aufmerksamkeit“), **Turniere & Events**, **Chats**, **Verein** (Vereinsintern, News, Mitgliedschaft, Rechnungen) und **Erfolge**.
  Wer die Chats leise stellt, verpasst den Spielaufruf nicht.
- **Discord-Direktnachricht:** Nur mit verknüpftem Discord-Konto und nur auf Wunsch (Standard **aus**). Es kommt dieselbe Meldung als
  Nachricht vom Vereins-Bot (Titel, Text, Link). Nie darin: Chat-Texte anderer, Moderation, Zahlungsdaten. Discord stellt Direktnachrichten
  nur zu, wenn die Person mit dem Bot einen Server teilt und „Direktnachrichten von Servermitgliedern“ erlaubt. Lehnt Discord ab, bleibt es
  bei In-App und Push, und die Einstellungen zeigen den Klickweg. Bot aus: keine Nachricht, der Grund steht im Versand-Log.
- **Push testen:** **Admin → System → Push-Tests**: Benutzer suchen, Testnachricht senden. Die Seite zeigt die Tokens des Kontos, den letzten Versand
  und Fehler. „In-App erstellt, aber kein aktiver Push-Token gefunden“ heißt: Die Person hat die App nicht oder keine Push-Erlaubnis.
  In der Kommandozentrale steht die Zahl der aktiven Tokens und Fehler unter **Push-Monitoring**.

### 3.6 Was Mitglieder selbst abschalten können

**Benutzermenü → Einstellungen → Benachrichtigungen** (Seite „Benachrichtigungen einstellen“):

- Oben die **Kanäle**: **E-Mail**, **Push**, **In-App**, **Discord** (nur mit verknüpftem Konto). Ein ausgeschalteter Kanal blendet seine Spalte aus,
  die Einstellungen darin bleiben erhalten.
- Darunter die Tabelle **Jede Benachrichtigung pro Kanal**: je Thema ein Schalter je Kanal. Ein Strich heißt: Dieses Thema gibt es auf dem Kanal nicht.
- **News & Events** per E-Mail geht nur mit der Einwilligung unten: „Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu
  erhalten. Jederzeit widerrufbar.“
- Account- und Sicherheitsmails bleiben immer aktiv.
- Dieselbe Seite regelt, wie Erfolge gefeiert werden (mit Klang oder dezent).

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Mails kommen gar nicht an, Mail-Queue zeigt **Übersprungen** | Kein Versandweg aktiv oder kein Resend-Schlüssel („Kein Resend API Key hinterlegt“) | Resend oder SMTP einrichten, **Versand aktiv** einschalten |
| Testmail kommt nicht an | Falsche Absenderdomain, SPF/DKIM fehlen, Postfach prüft streng | Domain bei Resend bestätigen, SMTP: DNS Checkliste, Spam-Ordner |
| Der Schlüssel „wirkt nicht“, obwohl er eingetragen ist | Der aktive Weg ist SMTP | Auf der Seite SMTP bei **Provider** den gewünschten Weg wählen |
| Mail-Queue: **Fehlgeschlagen** | Server nicht erreichbar, falsche Zugangsdaten, Empfänger abgelehnt | Grund in der Zeile lesen, beheben, **Nochmal versuchen** |
| Hinweis „Mails hängen“ | Der Versand blieb stecken | **Hängende Mails neu anstoßen**, dann **Jetzt verarbeiten** |
| Newsletter ging nicht hinaus | Entwurf, „Nur intern“ oder keine Zustimmungen | Kasten **Verteilen** ansehen ([Inhalte](inhalte.md)) |
| Ein Mitglied bekommt keine Turnier-Mails | Thema oder Kanal E-Mail ist bei ihm aus | In Einstellungen → Benachrichtigungen prüfen |
| Mitglied bekommt keine Push-Meldung | Keine App, keine Erlaubnis, Kanal am Handy stumm, oder Push in den Einstellungen aus | Push-Tests ausführen; Handy-Einstellungen prüfen |
| „In-App erstellt, aber kein aktiver Push-Token gefunden“ | Das Konto hat kein registriertes Gerät | App öffnen, Push erlauben |
| Discord-Kanal lässt sich nicht einschalten | Kein Discord-Konto verknüpft | Profil → Socials → Mit Discord verknüpfen |
| Discord-Direktnachricht kommt nicht | Discord lehnt ab (kein gemeinsamer Server oder Nachrichten gesperrt), oder Bot aus | Hinweis in den Einstellungen folgen; Verbindungen → Discord prüfen |
| Rechnung per Discord erwartet | Beträge gehen nie über Discord | Rechnungen kommen In-App, Push, Mail |
| Eine Vorlage zeigt „Vorschau hat nicht geklappt“ | Variable falsch gesetzt | Auf Standard zurücksetzen und neu anfangen |

---

## 5. Häufige Fragen

**Kann ich Mails über Resend und SMTP gleichzeitig laufen lassen?**
Nein, es gilt immer nur ein Weg.

**Kann jemand Sicherheitsmails abbestellen?**
Nein. Account- und Sicherheitsmails sind immer aktiv.

**Wer bekommt den Newsletter?**
Alle, die separat zugestimmt haben. Er geht beim Veröffentlichen von News und Events von selbst hinaus.

**Wie sehe ich, an wie viele ein Newsletter ging?**
Im Kasten **Verteilen** am Beitrag, und im Verlauf unter **E-Mail → Newsletter**.

**Wie kann ich einen Mailtext ändern?**
**E-Mail → E-Mail-Vorlagen**, Vorlage öffnen, **Bearbeiten**.

**Wie sehe ich, ob eine bestimmte Mail rausgegangen ist?**
Mail-Queue, oder Betrieb & Logs → Ereignisse mit Quelle E-Mail.

**Sehen Mitglieder die Chat-Texte in Discord oder Push?**
Nein, nur „Du hast eine Nachricht“.

**Warum gibt es für Erfolge keine Mail?**
Gewollt: Erfolge kommen In-App, per Push und auf Wunsch per Discord. Eine Mail gibt es nur im Wochenrückblick.

**Gibt es Ruhezeiten für Push?**
Eine Einstellung dafür gibt es in den Benachrichtigungen nicht. Jeder Push-Kanal lässt sich aber am Handy stumm schalten.
