# Fast Lap – Handbuch

Eine Fast-Lap-Challenge ist eine Zeitenjagd: Alle fahren dieselbe Strecke (oder mehrere), die schnellste Runde zählt.
Dieses Kapitel zeigt, wie ihr eine Challenge anlegt, Strecken und Wertung einstellt, Zeiten eintragt und prüft, ein
Team von Helfern einsetzt und wie die Bestenliste und der Bestzeit-Moment entstehen.

**Wo im Admin:**

- **Admin → eSports → Fast Lap** (`/admin/f1`) – die Liste aller Challenges, mit Suche, Status-Filter und CSV-Export
- **Admin → eSports → Fast Lap → Neue Challenge** (`/admin/f1/new`) – eine Challenge anlegen
- **Admin → eSports → Fast Lap → Challenge öffnen** (`/admin/f1/<Challenge>`) – Einstellungen, Fast-Lap-Team,
  Strecken, Zeiten eintragen
- **Admin → eSports → TV & Beamer** – die Rangliste auf den Fernseher, siehe [TV und Beamer](tv.md)
- **Admin → Verbindungen → Discord → Reiter „Meldungen“** – die Bestzeit-Meldung, siehe [Discord](discord.md)

Öffentlich ist die Challenge unter **/fastlap** (Liste) und **/fastlap/<Name der Challenge>**.

Wer was darf: Die **Turnierleitung** (Bereich „Turnierleitung“) darf alles. Wen ihr zum **Fast-Lap-Team** einer
Challenge macht, darf dort **Zeiten eintragen und ändern**, aber keine Challenge, Strecken oder das Team bearbeiten.

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
| **Challenge** | Titel, Beschreibung, Banner, Fahrzeug, Wetter, Fahrhilfen, Controller, Plattform, Sichtbarkeit (das Event: im Event unter „Programm“) | Challenge öffnen, Formular oben |
| **Strecken** | Eine oder mehrere Strecken mit Bild, Land, Zielzeit und Reihenfolge | Challenge öffnen, Kasten „Strecken“ |
| **Championship** | Mehrere Strecken, Punkte nach Platz je Strecke, dazu eine Gesamtwertung | Haken „Championship“ beim Anlegen |
| **Zeiten** | Zeit, Strafsekunden, Beleg, ungültig markieren | Challenge öffnen, Kasten „Zeiten eintragen“ |
| **Vereins-Referenzzeiten** | Zeiten von Vereinsmitgliedern außer Wertung als „Zielzeit zum Schlagen“ | Formular, Kasten „Teilnahme und Vereins-Referenzzeiten“ |
| **Fast-Lap-Team** | Helfer, die Zeiten eintragen dürfen | Challenge öffnen, Kasten „Fast-Lap-Team“ |
| **Preise** | Preise je Platz, daraus entstehen Gewinn-Einträge | Formular, Kasten „Preise“ |
| **Jahreswertung** | Punkte für die Jahreswertung, mit einstellbarem Gewicht | Formular, Kasten „Jahreswertung“ |
| **Bestenliste** | Strecken-Rangliste und Gesamtwertung auf der Website, PDF und Urkunden | öffentliche Seite der Challenge |
| **Bestzeit-Moment** | Auf dem TV ein Moment „Neue Bestzeit!“, in Discord eine Meldung | TV: Ansicht „Fast Lap“, Discord: Reiter „Meldungen“ |

---

## 2. Einrichten Schritt für Schritt

### 2.1 Die Challenge anlegen

1. **Admin → eSports → Fast Lap → Neue Challenge**.
2. Im Kasten **Die Challenge** einen **Titel** eintragen. Der **Slug (URL)** füllt sich von selbst und ist der Name in
   der Adresse (`/fastlap/…`). Titel und Slug genügen zum Anlegen.
3. Im Kasten **Strecke und Regeln** tragt ihr ein, was die Fahrer wissen müssen: **Fahrzeug**, **Wetter**,
   **Fahrhilfen**, **Controller-Typ**, **Plattform**. Wer alle gleich fahren lässt, bekommt vergleichbare Zeiten.
4. Soll es **mehrere Strecken** mit Punkten geben, setzt jetzt den Haken **Championship (mehrere Strecken + Punkte
   pro Platz)**. Ihn gibt es nur beim Anlegen. Im Formular zum Bearbeiten ist er nicht mehr da.
5. **Unbegrenzte Versuche** ist an. Schaltet ihn aus, erscheint **Max Versuche**.
6. Rechts unter **Veröffentlichung und Zeitplan**: **Sichtbarkeit** (Öffentlich / Nur registrierte Community / Nur
   Vereinsmitglieder / Nur intern), **Veröffentlichung** (Entwurf oder Angekündigt), **Start** und **Ende**.
7. Auf **Challenge erstellen** klicken. Die Challenge startet als **Entwurf**, niemand sieht sie, solange ihr sie nicht
   freigebt.

### 2.2 Strecken hinzufügen

Auf der Seite der Challenge (**Admin → eSports → Fast Lap → Challenge öffnen**) im Kasten **Strecken**:

1. Unter **Neue Strecke** den **Namen** eintragen.
2. Optional **Streckenbild**, **Land** und **Zielzeit** (Format `m:ss.mmm`, zum Beispiel `1:32.450`), dazu
   **Plausibel ab** und **Plausibel bis**: Zeiten außerhalb dieser Grenzen fragen beim Eintragen nach („Trotzdem
   speichern?“). Leer heißt Standard – 20 Sekunden bis 10 Minuten.
3. Auf **Hinzufügen** klicken. Mit dem Stift-Symbol neben einer Strecke ändert ihr sie (dort gibt es zusätzlich die
   **Reihenfolge**), mit dem Mülleimer löscht ihr sie – dabei werden **alle Zeiten dieser Strecke mit gelöscht**. Nach
   „Ergebnisse veröffentlicht“ lässt sich eine Strecke mit Zeiten nicht mehr löschen.

Die **Zielzeit** ist eine Marke zum Knacken: Wer sie unterbietet, sammelt den Erfolg „Zielzeit geknackt“.

### 2.3 Das Fast-Lap-Team einsetzen

Wer Zeiten eintragen soll, ohne sonst etwas verwalten zu dürfen:

1. Challenge öffnen, Kasten **Fast-Lap-Team**.
2. Bei **Person** den Namen suchen und wählen.
3. **Rolle** wählen: **Ergebnisdienst**, **Schiedsrichter** oder **Organisation**. Alle drei dürfen Zeiten eintragen.
4. Optional eine **Notiz** (zum Beispiel „Station am Samstag“), dann **Hinzufügen**.
5. In der Tabelle könnt ihr jemanden **Pausieren** (und wieder **Aktivieren**) oder **Entfernen**. Ohne Zuweisung darf die
   Person keine Zeiten mehr eintragen.

### 2.4 Freigeben

Setzt den **Status** der Challenge (Auswahl rechts oben auf der Challenge-Seite) auf **Angekündigt**, sobald sie sichtbar sein
soll. **Live** schaltet sich mit dem **Start** von selbst. **Beendet** setzt die Turnierleitung von Hand, wenn die Zeiten
geprüft sind: Erst dann entstehen die Gewinn-Einträge, mit **Ergebnisse veröffentlicht** auch die Jahreswertungs-Punkte.
Öffentlich steht nach dem **Ende** trotzdem schon „Beendet“, und auf der Challenge-Seite im Admin erinnert ein Hinweis
daran, den Status zu setzen.

---

## 3. Die Funktionen einzeln

### 3.1 Sichtbarkeit und Status

| Status | Bedeutung |
| --- | --- |
| **Entwurf** | nur im Admin |
| **Angekündigt** | sichtbar, noch nicht gestartet |
| **Einreichung offen** / **Einreichung geschlossen** | die Anzeige „Online-Einreichung“ auf der öffentlichen Seite (siehe 3.3) |
| **Live** | läuft |
| **Pausiert** | angehalten |
| **Beendet** | vorbei, die Ergebnisse sind sichtbar, die Gewinn-Einträge entstehen (setzt die Turnierleitung) |
| **Ergebnisse veröffentlicht** | offiziell, löst die Jahreswertungs-Punkte aus, die Zeiten sind gesperrt (siehe 3.11) |
| **Archiviert** / **Abgesagt** | abgelegt |

**Sichtbarkeit** (Öffentlich, Nur registrierte Community, Nur Vereinsmitglieder, Nur intern) bestimmt, wer die
Challenge sehen darf, unabhängig vom Status. Zu einem Event gehört die Challenge, wenn sie **im Event** angelegt oder
hinzugefügt wird (Event → **Programm** → **+ Fast Lap** oder **Bestehendes hinzufügen**, seit #1371); im Formular steht nur
„Gehört zu … – ändern im Event“. Das braucht auch die Hallen-Tafel am TV.

### 3.2 Wertung: Strecken und Championship

- **Eine Strecke:** Die Rangliste ist die beste Zeit je Fahrer. Die **wirksame Zeit** ist Rundenzeit **plus
  Strafsekunden** (auf Tausendstel gerundet). Ungültig markierte Zeiten und Vereins-Referenzzeiten zählen nicht.
- **Gleichstand:** Haben zwei dieselbe wirksame Zeit, liegt **die früher gefahrene** (früher eingetragene) vorn. Diese
  eine Regel gilt überall: Rangliste, TV, Gewinne, Jahreswertung, Event-Rückblick, Widget und Profil.
- **Versuche:** Die Zahl „Versuche“ zählt alle Zeiten einer Person in der Wertung, **auch ungültige** – genau wie die
  Grenze **Max Versuche**.
- **Championship:** Auf jeder Strecke gibt es nach Platz Punkte: Platz 1 bekommt 25, dann 18, 15, 12, 10, 8, 6, 4, 2
  und Platz 10 einen Punkt. Alles darunter keinen. Die Punkte werden über alle Strecken addiert. Bei Gleichstand
  entscheiden die Siege. Das ist die **Gesamtwertung**, die auf der öffentlichen Seite als „Championship
  Gesamtwertung“ steht. Die Punktetabelle lässt sich im Admin nicht ändern.
- **Jahreswertung:** Im Kasten **Jahreswertung** wählt ihr, wie stark die Challenge in die Jahreswertung eingeht:
  Fast Lap Standard (x1.00), Fun-Challenge (x0.75), Event/Check-in Wertung (x0.50), Mini-Wertung (x1.25),
  Normal-Turnier nah (x2.00), Keine Jahreswertung (x0.00) oder ein **eigener Faktor**. Die Punkte werden vergeben,
  sobald der Status auf **Ergebnisse veröffentlicht** gesetzt wird. Mehr zur Jahreswertung steht unter
  **Admin → eSports → Jahreswertung**.

### 3.3 Online-Einreichung

Im Kasten **Veröffentlichung und Zeitplan** gibt es den Haken **Online-Einreichung öffentlich anzeigen** mit
**öffnet** und **endet**. Er steuert, ob auf der öffentlichen Seite ein Hinweis mit den Einreichungs-Zeiten steht. Zeiten
selbst tragen weiterhin Turnierleitung und Fast-Lap-Team ein (3.4). Ein Fahrer kann in der Oberfläche keine
Zeit selbst anlegen. Ist der Haken aus, steht auf der Seite „Zeiten werden durch Admins oder Moderatoren
eingetragen.“

### 3.4 Zeiten eintragen

Auf der Seite der Challenge, Kasten **Zeiten eintragen**. Zuerst links bei **Strecken** die Strecke anklicken, dann:

1. **Fahrer** suchen und wählen.
2. **Zeit (m:ss.SSS)**, zum Beispiel `1:24.587` – mit Punkt oder Komma (`1:24,587`), auch ohne Minuten (`84.587`).
   Eine Zahl ohne Komma sind Sekunden (`90` = 1:30.000). Liegt die Zeit außerhalb der plausiblen Grenzen der Strecke
   (Standard 20 Sekunden bis 10 Minuten), fragt die Seite nach; gespeichert wird erst mit **Trotzdem speichern**.
3. **Wertung**: **Offizielle Wertung** oder **Vereins-Referenz**.
4. Optional **Strafe (s)** und **Proof URL** (Link auf Screenshot oder Video).
5. Mit **Strafe** gibt es ein Pflichtfeld **Begründung für Strafe** (mindestens 5 Zeichen). Ohne Begründung wird nicht
   gespeichert.
6. **Eintragen**.

Darunter steht die Liste der Zeiten dieser Strecke. Ohne Strecke steht dort „Bitte erst eine Strecke anlegen.“

Die Zeitnehmer können dasselbe Formular auch auf der öffentlichen Seite der Challenge nutzen („Direkt für
Zeitnehmer, Schiedsrichter und Organisation“).

Ist die **Maximale Anzahl Versuche** erreicht (nur bei begrenzten Versuchen), lehnt der Server die Zeit ab. Versuche
zählen getrennt für offizielle Zeiten und Referenzzeiten.

### 3.5 Zeiten prüfen und ändern

Bei jeder Zeit in der Liste gibt es ein Stift-Symbol. Im Fenster **Zeit bearbeiten** ändert ihr:

- **Zeit (m:ss.SSS)** und **Strafsekunden**,
- **Wertung** (offiziell oder Vereins-Referenz),
- **Proof URL**,
- eine **Notiz**: Mit Strafe oder ungültig ist es die **Begründung** (Pflicht, mindestens 5 Zeichen), **die der Fahrer
  sieht**. Sonst ist es eine **interne Admin-Notiz**,
- **Als ungültig markieren (zählt nicht für Rangliste)**. Die Zeit bleibt in der Liste stehen, durchgestrichen,
  mit dem Vermerk „INVALID“, und zählt nicht für die Rangliste.

Mit dem Mülleimer löscht ihr eine Zeit ganz (mit Rückfrage, im Admin und auf der öffentlichen Seite). Besser als
Löschen ist **ungültig markieren**, denn dann ist nachvollziehbar, was passiert ist. Eintragen, Ändern, Löschen und
Strafen stehen im **Protokoll** (**Admin → System → Betrieb & Logs → Ereignisse**, Adminaktionen), mit Person und Zeitpunkt; die Strafen-Liste nennt als
Aussteller, wer die Strafe gesetzt hat.

### 3.6 Vereins-Referenzzeiten

Für Challenges, die ihr für **externe Teilnehmer** veranstaltet. Im Kasten **Teilnahme und Vereins-Referenzzeiten**:

| Haken | Wirkung |
| --- | --- |
| **Vereinsmitglieder aus offizieller Wertung ausschließen** | Mitglieder können nicht offiziell mitfahren. Bestehende Zeiten von Mitgliedern werden zu Referenzzeiten |
| **Vereins-Referenzzeiten erlauben** | Mitglieder fahren in einem getrennten Bereich außer Wertung: ohne Punkte, ohne Jahreswertung, ohne Erfolge |
| **Referenzzeiten öffentlich anzeigen** | Die Top 3 stehen öffentlich als „Zielzeit zum Schlagen“. Aus heißt: nur im Admin sichtbar |

Trägt ihr für ein Mitglied eine Zeit ein, schlägt die Maske bei gesperrter offizieller Wertung automatisch
**Vereins-Referenz** vor.

### 3.7 Preise und Gewinne

Im Kasten **Preise**: **+ Platz hinzufügen**, dann Platz, **Label** und **Preis** eintragen. Zeilen ohne Preis werden
beim Speichern ignoriert. Sobald die Challenge **Beendet** oder **Ergebnisse veröffentlicht** ist, legt die Website
daraus die **Gewinn-Einträge** an (siehe **Admin → eSports → Gewinne**). Steht die Challenge auf **Ergebnisse
veröffentlicht** und fehlen Einträge, gibt es den Knopf **Gewinne erzeugen**.

### 3.8 Bestenliste und Auswertung

Auf der öffentlichen Seite der Challenge: eine **Strecken-Rangliste** je Strecke und, bei Championship, die
**Gesamtwertung** mit Punkten. Bei einer Championship gibt es, sobald die Challenge **Beendet**, **Ergebnisse veröffentlicht** oder **Archiviert** ist,
**Gesamtwertung-PDF** und **Gesamtwertungs-Urkunden**. Im Admin stehen oben auf der Challenge-Seite **CSV** (die Bestzeit je Fahrer und Strecke) und **PDF**
(Rangliste, für die gewählte Strecke). Die Liste aller Challenges exportiert ihr mit **CSV**.

### 3.9 Bestzeit-Moment

- **Auf dem TV:** Ansicht **Fast Lap** im Baukasten unter **Admin → eSports → TV & Beamer**, oder in der Challenge der Knopf
  **TV Modus**. Kommt eine neue Bestzeit, liegt etwa drei Sekunden ein Moment „Neue Bestzeit!“ über der Liste mit Bild,
  Name, Zeit, Abstand und dem bisherigen Halter. Danach rutscht die Zeile an ihren Platz. Ein Sponsor-Moment läuft
  dazwischen mit, wenn er eingeschaltet ist.
- **In Discord:** Wer mit einer **offiziellen** gültigen Zeit die Strecke anführt, löst die Meldung „Neue Bestzeit“ aus
  (nicht bei Referenzzeiten und ungültigen Zeiten). Wohin sie geht, stellt ihr unter **Admin → Verbindungen → Discord →
  Reiter „Meldungen“** ein.

### 3.10 Erfolge

Eingetragene offizielle Zeiten zählen für Erfolge der Fahrer (zum Beispiel „Zielzeit geknackt“). Referenzzeiten zählen dafür nicht.

### 3.11 Nach „Ergebnisse veröffentlicht“

Mit **Ergebnisse veröffentlicht** stehen Gewinne und Jahreswertungs-Punkte fest – die Zeiten sind dann gesperrt
(ebenso im Status **Archiviert**). Das Fast-Lap-Team kann nichts mehr eintragen, ändern oder löschen; die App zeigt statt
des Formulars einen Hinweis. Die **Turnierleitung** kann noch korrigieren, aber nur mit **Begründung** (mindestens
10 Zeichen), die im **Protokoll** steht. Vor dem Veröffentlichen fragt die Seite nach. Wer den Status wieder
zurücksetzt, öffnet die Zeiten – auch das steht im Protokoll. Schon vergebene Gewinne und Jahreswertungs-Punkte
ändern sich dadurch nicht von selbst.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| „Zeit bitte als m:ss.mmm angeben …“ / „Ungültiges Zeitformat“ | Die Zeit hat ein anderes Format | So schreiben: `1:24.587` oder `1:24,587` (Minuten, Doppelpunkt, Sekunden, Punkt oder Komma, Tausendstel); mit Minuten höchstens 59 Sekunden |
| „Zeit prüfen … Trotzdem speichern?“ / „wirkt unplausibel“ | Die Zeit liegt außerhalb der plausiblen Grenzen der Strecke | Zeit prüfen; stimmt sie, **Trotzdem speichern**. Grenzen bei der Strecke unter **Plausibel ab / bis** |
| „Die Ergebnisse sind veröffentlicht …“ | Die Challenge steht auf **Ergebnisse veröffentlicht** oder **Archiviert** | Nur die Turnierleitung ändert noch, mit Begründung (mind. 10 Zeichen) |
| „Zielzeit bitte als m:ss.mmm angeben“ | Dasselbe bei der Zielzeit einer Strecke | Zum Beispiel `1:32.450` |
| „Bei Strafzeit ist eine Begründung (mind. 5 Zeichen) Pflicht.“ | Strafe oder ungültig ohne Begründung | Im Feld **Begründung** mindestens fünf Zeichen eintragen |
| „Bitte zuerst den Fahrer suchen und wählen.“ | Der Fahrer wurde nur getippt, nicht aus der Liste gewählt | Namen tippen und in der Trefferliste anklicken |
| „Maximale Anzahl Versuche erreicht …“ | Die Challenge hat begrenzte Versuche | Bei den Einstellungen **Max Versuche** erhöhen oder **Unbegrenzte Versuche** einschalten |
| „Vereinsmitglieder dürfen bei dieser Challenge nur als Vereins-Referenz eingetragen werden.“ | Der Haken **Vereinsmitglieder aus offizieller Wertung ausschließen** ist an | Als **Vereins-Referenz** eintragen, oder den Haken ausschalten |
| „Vereins-Referenzzeiten sind bei dieser Challenge deaktiviert.“ | **Vereins-Referenzzeiten erlauben** ist aus | Haken einschalten |
| „Keine Fast-Lap-Berechtigung für diese Aktion“ | Die Person ist weder Turnierleitung noch im Fast-Lap-Team (oder pausiert) | Im Kasten **Fast-Lap-Team** hinzufügen oder **Aktivieren** |
| Der Menüpunkt „Fast Lap“ fehlt | Die Person hat keinen Zugang zur Turnierleitung und keinen Einsatz | Zum Fast-Lap-Team machen lassen (siehe 2.3) |
| Die Challenge ist öffentlich nicht zu sehen | Status **Entwurf** oder Sichtbarkeit zu eng | Status auf **Angekündigt** stellen, **Sichtbarkeit** prüfen |
| Der Haken **Championship** fehlt beim Bearbeiten | Er ist nur beim Anlegen da | Neue Challenge mit dem Haken anlegen |
| Keine Jahreswertungs-Punkte | Der Status steht noch nicht auf **Ergebnisse veröffentlicht**, oder der Faktor ist 0 | Status setzen, Faktor im Kasten **Jahreswertung** prüfen |
| Keine Gewinn-Einträge | Der Status ist vor **Beendet**, oder es sind keine Preise eingetragen | Status prüfen, im Kasten **Preise** Preise eintragen |
| Keine Discord-Meldung | Die Zeit war keine neue offizielle Bestzeit, oder die Fast-Lap-Meldungen sind nicht eingerichtet | Unter **Admin → Verbindungen → Discord → Reiter „Meldungen“** prüfen |
| Nach Löschen einer Strecke fehlen Zeiten | Mit der Strecke werden alle ihre Zeiten gelöscht | Gibt es nicht zurück. Vorher exportieren (**CSV**) |

---

## 5. Häufige Fragen

**Können Fahrer ihre Zeit selbst eintragen?**
Nein. Zeiten tragen die Turnierleitung und das Fast-Lap-Team ein. Der Beleg (Screenshot oder Video) kommt als Link in
die **Proof URL**.

**Was ist der Unterschied zwischen ungültig, Strafe und Löschen?**
Eine **Strafe** addiert Sekunden zur Zeit. **Ungültig** nimmt die Zeit aus der Rangliste, sie bleibt in der Liste
sichtbar. **Löschen** entfernt sie ganz. Bei Strafe und ungültig steht die Begründung für den Fahrer da.

**Ändert sich die Rangliste, wenn jemand eine bessere Zeit fährt?**
Ja, es zählt die beste wirksame Zeit je Fahrer.

**Kann ich eine Challenge ohne Strecke freigeben?**
Technisch ja, aber es gibt dann nichts zu fahren. Legt zuerst mindestens eine Strecke an.

**Wie lade ich die Ergebnisse herunter?**
Auf der Challenge-Seite oben **CSV** (alle Zeiten) oder **PDF** (Rangliste). Die Liste aller Challenges exportiert ihr mit **CSV**.

**Wie kommt die Rangliste auf den Fernseher?**
[TV und Beamer](tv.md), Abschnitt „Fast Lap am TV“.
