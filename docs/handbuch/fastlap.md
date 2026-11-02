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
| **Meisterschaft** | Mehrere Strecken, Punkte nach Platz je Strecke (einstellbar), dazu eine Gesamtwertung | Haken „Meisterschaft“ beim Anlegen oder im Formular |
| **Bedingungen** | Fahrzeug, Wetter, Fahrhilfen, Controller und Plattform öffentlich im Kasten „Bedingungen“ | Formular, Kasten „Strecke und Regeln“ |
| **Stream** | Stream auf der Seite der Challenge | Formular, Kasten „Stream“ |
| **Zeiten** | Zeit, Strafsekunden, Beleg, ungültig markieren | Challenge öffnen, Kasten „Zeiten eintragen“ |
| **Vor Ort** | Schnelleingabe mit Ziffernblock, Gäste ohne Konto, Liste „Am Start / Als Nächstes“ | Challenge öffnen, ganz oben (siehe 3.12) |
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
   **Fahrhilfen**, **Controller-Typ**, **Plattform**. Wer alle gleich fahren lässt, bekommt vergleichbare Zeiten. Was
   ausgefüllt ist, steht öffentlich im Kasten **Bedingungen**.
4. Soll es **mehrere Strecken** mit Punkten geben, setzt den Haken **Meisterschaft**. Darunter erscheint **Punkte je
   Platz** (Vorgabe 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; Platz 1 zuerst, durch Komma getrennt). Beides geht auch später noch im
   Formular der Challenge. Im Kasten **Stream** wählt ihr Plattform und Kanal oder Adresse; mit dem Haken erscheint der
   Stream auf der Seite der Challenge.
5. **Versuche je Person und Strecke** steht auf **3**. Tragt eine andere Zahl ein (zum Beispiel 10) oder lasst das Feld
   leer – dann sind die Versuche unbegrenzt. Ungültige Runden zählen mit.
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
soll. **Live** schaltet sich mit dem **Start** von selbst. **Beendet** und **Ergebnisse veröffentlicht** setzt die
Turnierleitung von Hand, wenn die Zeiten geprüft sind: **Beendet** legt die Gewinn-Einträge an, erst **Ergebnisse
veröffentlicht** vergibt auch die Jahreswertungs-Punkte. Öffentlich steht nach dem **Ende** trotzdem schon „Beendet“, und auf
der Challenge-Seite im Admin erinnert ein Hinweis daran, die Ergebnisse zu veröffentlichen.

**Archivieren** geht mit gewerteten Zeiten erst nach **Ergebnisse veröffentlicht** (oder wenn die Challenge **Abgesagt** ist) –
sonst gäbe es nie Jahreswertungs-Punkte. In der Auswahl steht **Archiviert** bis dahin grau mit „erst nach dem
Veröffentlichen“. Was schon archiviert ist, bleibt, wie es ist: Punkte kommen dort nur, wenn ihr bewusst wieder
**Ergebnisse veröffentlicht** wählt, und zwar in die dann aktive Saison.

**Entwurf löschen:** Solange die Challenge ein **Entwurf** ohne Zeiten ist, steht oben **Entwurf löschen** (mit
Rückfrage, im Protokoll). Strecken, Gäste und Team-Einteilung gehen mit. Eine Challenge, die schon angekündigt war oder
Zeiten hat, wird nicht gelöscht – sagt sie ab oder veröffentlicht die Ergebnisse und archiviert sie danach.

---

## 3. Die Funktionen einzeln

### 3.1 Sichtbarkeit und Status

| Status | Bedeutung |
| --- | --- |
| **Entwurf** | nur im Admin |
| **Angekündigt** | sichtbar, noch nicht gestartet |
| **Einreichung offen** / **Einreichung geschlossen** | nur noch bei alten Challenges, die diesen Status schon tragen (siehe 3.3) |
| **Live** | läuft |
| **Pausiert** | angehalten |
| **Beendet** | vorbei, die Ergebnisse sind sichtbar, die Gewinn-Einträge entstehen (setzt die Turnierleitung) |
| **Ergebnisse veröffentlicht** | offiziell, löst die Jahreswertungs-Punkte aus, die Zeiten sind gesperrt (siehe 3.11) |
| **Archiviert** | abgelegt, geht mit gewerteten Zeiten erst nach dem Veröffentlichen |
| **Abgesagt** | findet nicht statt |

**Sichtbarkeit** (Öffentlich, Nur registrierte Community, Nur Vereinsmitglieder, Nur intern) bestimmt, wer die
Challenge sehen darf, unabhängig vom Status. Zu einem Event gehört die Challenge, wenn sie **im Event** angelegt oder
hinzugefügt wird (Event → **Programm** → **+ Fast Lap** oder **Bestehendes hinzufügen**, seit #1371); im Formular steht nur
„Gehört zu … – ändern im Event“. Das braucht auch die Hallen-Tafel am TV.

### 3.2 Wertung: Strecken und Meisterschaft

- **Eine Strecke:** Die Rangliste ist die beste Zeit je Fahrer. Die **wirksame Zeit** ist Rundenzeit **plus
  Strafsekunden** (auf Tausendstel gerundet). Ungültig markierte Zeiten und Vereins-Referenzzeiten zählen nicht.
- **Gleichstand:** Haben zwei dieselbe wirksame Zeit, liegt **die früher gefahrene** (früher eingetragene) vorn. Diese
  eine Regel gilt überall: Rangliste, TV, Gewinne, Jahreswertung, Event-Rückblick, Widget und Profil.
- **Versuche:** Die Zahl „Versuche“ zählt alle Zeiten einer Person in der Wertung, **auch ungültige** – genau wie die
  Grenze **Versuche je Person und Strecke**. Tabelle, TV und App zeigen die eingestellte Zahl („2 / 3“, „Versuch 2 von
  3“); ohne Grenze steht nur die Zahl.
- **Gäste ohne Konto** (siehe 3.12) stehen in der Rangliste wie alle anderen, auch auf dem TV und der Urkunde. In
  **Gewinnen, Jahreswertung und Erfolgen** zählen sie nicht – dort reihen sich nur Konten. Fährt ein Gast die beste Zeit,
  bekommt den Preis für Platz 1 die schnellste Person mit Konto (Entscheidung des Vereins, 14.10.2026). Wird der Gast
  später mit einem Konto verknüpft (3.12), zählt er ab dann voll.
- **Meisterschaft:** Auf jeder Strecke gibt es nach Platz Punkte. Die Vorgabe: Platz 1 bekommt 25, dann 18, 15, 12, 10, 8, 6,
  4, 2 und Platz 10 einen Punkt, alles darunter keinen. Unter **Punkte je Platz** stellt ihr das je Challenge ein. Die
  Punkte werden über alle Strecken addiert, bei Gleichstand entscheiden die Siege. Das ist die **Gesamtwertung** auf der
  öffentlichen Seite. Die Jahreswertung rechnet davon unabhängig nach dem Platz.
- **Jahreswertung:** Im Kasten **Jahreswertung** wählt ihr, wie stark die Challenge in die Jahreswertung eingeht:
  Fast Lap Standard (x1.00), Fun-Challenge (x0.75), Event/Check-in Wertung (x0.50), Mini-Wertung (x1.25),
  Normal-Turnier nah (x2.00), Keine Jahreswertung (x0.00) oder ein **eigener Faktor**. Die Punkte werden vergeben,
  sobald der Status auf **Ergebnisse veröffentlicht** gesetzt wird. Mehr zur Jahreswertung steht unter
  **Admin → eSports → Jahreswertung**.

### 3.3 Online-Einreichung

Online einreichen können Fahrer noch nicht (kommt mit #1278). Bis dahin gibt es dafür keinen Haken, und die Website
verspricht auch kein Formular. Zeiten tragen Turnierleitung und Fast-Lap-Team ein (3.4). Bei alten Challenges bleibt, was
gespeichert ist; die App zeigt dort noch den alten Hinweis, bis sie nachgezogen ist.

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

Ist die **Maximale Anzahl Versuche** erreicht (nur bei begrenzten Versuchen), lehnt der Server die Zeit ab – auch bei
Gästen, jeder Gast hat seine eigenen Versuche. Versuche zählen getrennt für offizielle Zeiten und Referenzzeiten.

Am Simulator geht es schneller mit der **Schnelleingabe** (3.12).

### 3.5 Zeiten prüfen und ändern

Bei jeder Zeit in der Liste gibt es ein Stift-Symbol. Im Fenster **Zeit bearbeiten** ändert ihr:

- **Zeit (m:ss.SSS)** und **Strafsekunden**,
- **Wertung** (offiziell oder Vereins-Referenz),
- **Nachweis-Link**,
- eine **Notiz**: Mit Strafe oder ungültig ist es die **Begründung** (Pflicht, mindestens 5 Zeichen), **die der Fahrer
  sieht**. Sonst ist es eine **interne Admin-Notiz**,
- **Als ungültig markieren (zählt nicht für Rangliste)**. Die Zeit bleibt in der Liste stehen, durchgestrichen,
  mit dem Vermerk „Ungültig“, und zählt nicht für die Rangliste.

Mit dem Mülleimer löscht ihr eine Zeit ganz (mit Rückfrage, im Admin und auf der öffentlichen Seite). Besser als
Löschen ist **ungültig markieren**, denn dann ist nachvollziehbar, was passiert ist. Eintragen, Ändern, Löschen und
Strafen stehen im **Protokoll** (**Admin → System → Betrieb & Logs → Ereignisse**, Adminaktionen), mit Person und Zeitpunkt; die Strafen-Liste nennt als
Aussteller, wer die Strafe gesetzt hat.

**Strafen im Überblick:** Unter **Admin → eSports → Strafen** führt **Öffnen** zur Challenge, gleich auf die richtige Strecke.
**Zurücknehmen** nimmt Strafzeit und „ungültig“ weg, die Zeit zählt wieder normal; nach der Veröffentlichung geht das nur mit
Begründung (3.11). Einen eigenen Einspruch gibt es nicht: Fahrer stellen unter **Meine Strafen** mit **Rückfrage stellen**
eine Frage über das Kontaktformular, die Antwort kommt von euch. Ändert ihr danach etwas, ist das eine normale Korrektur.

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

Im Kasten **Preise**: **+ Platz hinzufügen**, dann Platz, **Bezeichnung** und **Preis** eintragen. Zeilen ohne Preis werden
beim Speichern ignoriert. Sobald die Challenge **Beendet** oder **Ergebnisse veröffentlicht** ist, legt die Website
daraus die **Gewinn-Einträge** an (siehe **Admin → eSports → Gewinne**). Hat sich zwischen **Beendet** und dem Veröffentlichen die
Rangfolge geändert, bekommt der neue Platz seinen Gewinn; wer nicht mehr dort steht, behält seinen und steht mit **„Nach Korrektur
prüfen“** in der Liste. Steht die Challenge auf **Ergebnisse
veröffentlicht** und fehlen Einträge, gibt es den Knopf **Gewinne erzeugen**.

### 3.8 Bestenliste und Auswertung

Auf der öffentlichen Seite der Challenge: eine **Strecken-Rangliste** je Strecke und, bei einer Meisterschaft, die
**Gesamtwertung** mit Punkten. Sobald die Challenge **Beendet**, **Ergebnisse veröffentlicht** oder **Archiviert** ist,
steht unter der Tabelle **Downloads** (am Handy eine aufklappbare Zeile): **Ergebnis-PDF**, bei einer Meisterschaft
**Gesamtwertung-PDF**, und wer angemeldet unter den ersten vier steht, **Meine Urkunde**. **TV / Beamer**, alle
**Urkunden** und die Spalte **Urkunde** in der Tabelle sehen nur die Leitung der Challenge und Konten mit dem Bereich
Turniere. Die **Turnierleitung** sieht **Urkunden jetzt drucken** und in der Tabelle **Drucken** für die ersten vier
schon, während die Challenge läuft – für Gäste genauso. Im Admin stehen oben auf der Challenge-Seite **CSV** (die Bestzeit je Fahrer und Strecke, nur für die Turnierleitung) und **PDF**
(Rangliste, für die gewählte Strecke). Die Liste aller Challenges exportiert ihr mit **CSV**.

### 3.9 Bestzeit-Moment

- **Auf dem TV:** Ansicht **Fast Lap** im Baukasten unter **Admin → eSports → TV & Beamer**, oder für die Leitung in der Challenge der Knopf
  **TV / Beamer**. Kommt eine neue Bestzeit, liegt etwa drei Sekunden ein Moment „Neue Bestzeit!“ über der Liste mit Bild,
  Name, Zeit, Abstand und dem bisherigen Halter, ein Glanz läuft einmal darüber. Danach rutscht die Zeile an ihren
  Platz. Ein Sponsor-Moment läuft dazwischen mit, wenn er eingeschaltet ist. Steht jemand in der Liste „Am Start / Als
  Nächstes“ (3.12), zeigt das TV über der Rangliste, wer gerade fährt (mit Station und „Versuch 2 von 3“) und wer als
  Nächstes dran ist.
- **Auf der Website:** Kommt eine neue Zeit, gleitet die Zeile an ihren neuen Platz, die Zeit läuft kurz von der alten
  zur neuen und an der Zeile steht „−0.412 s · persönliche Bestzeit“. Bei einer neuen Bestzeit leuchtet Platz 1 ruhig
  auf, darüber steht kurz „Neue Bestzeit!“. Der Abstand zur Spitze steht zusätzlich als schmaler Balken da. Mit
  „Bewegung reduzieren“ im Betriebssystem bewegt sich nichts, die Hinweise stehen einfach da.
- **In Discord:** Wer mit einer **offiziellen** gültigen Zeit die Strecke anführt, löst die Meldung „Neue Bestzeit“ aus
  (nicht bei Referenzzeiten, ungültigen Zeiten und Gästen – ihr Name geht nicht an Discord). Wohin sie geht, stellt ihr unter **Admin → Verbindungen → Discord →
  Reiter „Meldungen“** ein.

### 3.10 Erfolge

Eingetragene offizielle Zeiten zählen für Erfolge der Fahrer (zum Beispiel „Zielzeit geknackt“). Referenzzeiten und
Zeiten von Gästen zählen dafür nicht.

### 3.11 Nach „Ergebnisse veröffentlicht“

Mit **Ergebnisse veröffentlicht** stehen Gewinne und Jahreswertungs-Punkte fest – die Zeiten sind dann gesperrt
(ebenso im Status **Archiviert**). Das Fast-Lap-Team kann nichts mehr eintragen, ändern oder löschen; die App zeigt statt
des Formulars einen Hinweis. Die **Turnierleitung** kann noch korrigieren, aber nur mit **Begründung** (mindestens
10 Zeichen), die im **Protokoll** steht. Nach jeder solchen Korrektur gleicht die Website Gewinne und
Jahreswertungs-Punkte an die neue Rangfolge an: Wer neu auf einem Preisplatz steht, bekommt seinen Gewinn; ein Gewinn,
der nicht mehr passt, wird **nicht entzogen**, sondern steht unter **Admin → eSports → Gewinne** mit dem Vermerk
**„Nach Korrektur prüfen“**. Die Punkte bleiben in der Saison, in der sie vergeben wurden. Dasselbe gilt, wenn ihr
nach der Veröffentlichung eine Wertungsregel ändert – **Vereinsmitglieder aus offizieller Wertung ausschließen**,
**Meisterschaft**, **Punkte je Platz**, **Preise** oder das Gewicht der **Jahreswertung** (auch nur mit Begründung).
Schaltet ihr „Vereinsmitglieder ausschließen“ wieder ab, kommen genau die Zeiten zurück in die offizielle Wertung, die
die Regel verschoben hat. Lässt sich der Abgleich einmal nicht durchführen, bleibt die Korrektur gespeichert, die Seite
meldet „Gewinne und Saisonpunkte … bitte prüfen“, und das Protokoll hält es fest. Eine veröffentlichte Challenge mit Zeiten lässt sich nicht löschen – archiviert sie; die Punkte bleiben. Vor dem
Veröffentlichen fragt die Seite nach. Wer den Status wieder zurücksetzt, öffnet die Zeiten – auch das steht im
Protokoll.

### 3.12 Vor Ort: Schnelleingabe, Gäste, Am Start / Als Nächstes

Auf der Seite der Challenge stehen ganz oben (solange die Ergebnisse nicht veröffentlicht sind) zwei Kästen. Von der
öffentlichen Seite führt **Schnelleingabe** dorthin. Gedacht für Handy und Tablet am Simulator.

**Schnelleingabe**

1. **Fahrer** wählen: **Konto** (Personensuche) oder **Gast**. Steht genau eine Person **Am Start**, ist sie schon gewählt.
2. Rechts oben (am Handy unter der Überschrift) steht **Versuch 2 von 3** (die eingestellte Zahl). Sind alle Versuche
   gefahren, steht dort „Alle 3 Versuche gefahren“; **Eintragen**, **Eintragen & nächster Fahrer** und **Ungültig** sind
   dann gesperrt, **Letzte korrigieren** geht weiter.
3. Zeit am großen **Ziffernblock** tippen (`1`, `:`, `2`, `4`, `,`, `5`, `8`, `7`) oder mit der Tastatur. Unter dem Feld
   steht, was die Seite liest („= 1:24.587“) oder „nicht lesbar“. Unplausible Zeiten fragen wie immer nach.
4. **Eintragen** – oder **Eintragen & nächster Fahrer**: dann verlässt die Person die Liste „Am Start“, und die
   nächste Person aus „Als Nächstes“ kommt an dieselbe Station.
5. **Ungültig** öffnet die Gründe (**Strecke verlassen**, **Abkürzung**, **Kollision**, **Runde nicht beendet**); ein Tipp
   speichert. Ist keine Zeit getippt, zählt die Runde als „ohne Zeit“ – als Versuch zählt sie immer.
6. **Letzte korrigieren** holt die zuletzt gespeicherte Zeit ins Feld; **Korrektur speichern** ändert sie.

Tastatur mit Ziffernblock: **Enter** trägt ein, **+** trägt ein und holt den nächsten Fahrer, **/** setzt den Doppelpunkt
(der Ziffernblock hat keinen). Ohne Minuten geht es auch ohne Doppelpunkt: `84,587`.

**Gäste ohne Konto**

Im Reiter **Gast** einen Namen eintragen und **Anlegen** – fertig. Den Namen vorher fragen; wer nicht mit Namen
auftauchen möchte, bekommt einen Spitznamen oder Initialen. Zwei Gäste mit demselben Namen gehen nicht (z. B. „Max B.“
und „Max K.“). Gäste stehen in Rangliste, TV und Urkunde, aber nicht in Gewinnen, Jahreswertung und Erfolgen (3.2).
Nach **90 Tagen** wird der Name von selbst zu „Gast 3“ (Datenschutz, siehe `DATA_PROTECTION.md`); die Zeit bleibt.
Unten auf der Challenge-Seite steht die Liste **Gäste**: mit dem Stift **umbenennen** (etwa, wenn jemand nicht mehr
mit Namen auftauchen will – dann z. B. „Gast 3“), mit dem Mülleimer einen Gast **löschen**, der noch **keine Zeiten**
hat (doppelt angelegt, nie gefahren). Ein gelöschter Gast verschwindet auch aus „Am Start / Als Nächstes“. Gäste mit
Zeiten lassen sich nur umbenennen. Nach **Ergebnisse veröffentlicht** benennt und löscht nur die Turnierleitung,
mit Begründung; Umbenennen und Löschen stehen im Protokoll. Die öffentliche Liste „Am Start / Als Nächstes“ zeigt nur
Name, Station, Versuch und Platz.

**Gast mit Konto verknüpfen:** Legt ein Gast später ein Konto an, klickt die **Turnierleitung** in der Liste der Zeiten
beim Gast auf das Ketten-Symbol (**Mit Konto verknüpfen**), sucht das Konto und sieht vorher, was passiert („3 Zeiten von
Gast ‚Anna‘ gehen an Konto ‚…‘“). Mit **Verknüpfen** gehören alle Zeiten des Gastes dem Konto – ab dann zählt es voll:
Rangliste, Gewinne, Jahreswertung, Erfolge. Hat das Konto hier schon Zeiten, werden beide zusammengeführt (es zählt die
beste; bei gleicher Zeit die früher gefahrene). Die Versuchsgrenze darf dabei überschritten werden, die Vorschau sagt es.
Der Gast bleibt als „verknüpft“ stehen und ist zum Eintragen nicht mehr wählbar; steht er in „Am Start / Als Nächstes“,
steht dort jetzt das Konto. Ist das Konto Vereinsmitglied und die Challenge schließt Mitglieder aus, werden die Zeiten zu
Referenzzeiten. Nach **Ergebnisse veröffentlicht** geht das nur mit Begründung; danach gleicht die Website Gewinne und
Jahreswertung an – ein schon vergebener Gewinn wird nicht entzogen, sondern steht unter **Gewinne** mit „Nach Korrektur
prüfen“. Ein zweites Verknüpfen mit demselben Konto ändert nichts, ein anderes Konto geht nicht mehr.

**Am Start / Als Nächstes**

- **In die Liste:** Fahrer (Konto oder Gast) wählen, optional die **Station** („Simulator 1“ – Auswahl aus den Stationen
  des Events oder freier Text), **In die Liste**. Jede Person steht je Strecke einmal in der Liste.
- **Als Nächstes:** Pfeil hoch schiebt nach vorn, ▶ startet sofort, ✕ nimmt aus der Liste.
- **Am Start:** **Nächster** – die Person ist fertig, die nächste kommt an dieselbe Station. ✓ – fertig ohne Nachfolger.
- **Ersten starten** holt die erste wartende Person an den Start.
- Das TV zeigt die Liste mit Station und Versuch. Ändern dürfen Turnierleitung und Fast-Lap-Team.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| „Zeit bitte als m:ss.mmm angeben …“ / „Ungültiges Zeitformat“ | Die Zeit hat ein anderes Format | So schreiben: `1:24.587` oder `1:24,587` (Minuten, Doppelpunkt, Sekunden, Punkt oder Komma, Tausendstel); mit Minuten höchstens 59 Sekunden |
| „Zeit prüfen … Trotzdem speichern?“ / „wirkt unplausibel“ | Die Zeit liegt außerhalb der plausiblen Grenzen der Strecke | Zeit prüfen; stimmt sie, **Trotzdem speichern**. Grenzen bei der Strecke unter **Plausibel ab / bis** |
| „Die Ergebnisse sind veröffentlicht …“ | Die Challenge steht auf **Ergebnisse veröffentlicht** oder **Archiviert** | Nur die Turnierleitung ändert noch, mit Begründung (mind. 10 Zeichen) |
| „Zielzeit bitte als m:ss.mmm angeben“ | Dasselbe bei der Zielzeit einer Strecke | Zum Beispiel `1:32.450` |
| „Bitte zuerst „Ergebnisse veröffentlicht“ wählen …“ | Archivieren vor dem Veröffentlichen, obwohl es gewertete Zeiten gibt | Erst **Ergebnisse veröffentlicht** wählen, dann **Archiviert**; oder **Abgesagt**, wenn es keine Wertung geben soll |
| „Bei Strafzeit ist eine Begründung (mind. 5 Zeichen) Pflicht.“ | Strafe oder ungültig ohne Begründung | Im Feld **Begründung** mindestens fünf Zeichen eintragen |
| „Bitte zuerst den Fahrer suchen und wählen.“ | Der Fahrer wurde nur getippt, nicht aus der Liste gewählt | Namen tippen und in der Trefferliste anklicken |
| „Maximale Anzahl Versuche erreicht …“ / „Alle 3 Versuche gefahren“ | Die Challenge hat begrenzte Versuche | Bei den Einstellungen **Versuche je Person und Strecke** erhöhen oder leeren (unbegrenzt) |
| „Diesen Namen gibt es schon …“ | Ein Gast mit demselben Namen ist schon angelegt | Den vorhandenen Gast wählen oder den Namen unterscheidbar machen |
| „Steht schon in der Liste.“ | Die Person steht auf dieser Strecke schon in „Am Start / Als Nächstes“ | Den vorhandenen Eintrag nutzen |
| „Gäste fahren nur in der offiziellen Wertung.“ | Für einen Gast wurde **Vereins-Referenz** gewählt | **Offizielle Wertung** wählen |
| „Der Gast ist mit einem Konto verknüpft …“ | Der Gast gehört inzwischen zu einem Konto | Das Konto als Fahrer wählen |
| „Der Gast ist schon mit einem anderen Konto verknüpft.“ | Verknüpfen geht nur einmal | Bei einem Irrtum die Zeiten von Hand korrigieren |
| „Vereinsmitglieder dürfen bei dieser Challenge nur als Vereins-Referenz eingetragen werden.“ | Der Haken **Vereinsmitglieder aus offizieller Wertung ausschließen** ist an | Als **Vereins-Referenz** eintragen, oder den Haken ausschalten |
| „Vereins-Referenzzeiten sind bei dieser Challenge deaktiviert.“ | **Vereins-Referenzzeiten erlauben** ist aus | Haken einschalten |
| „Keine Fast-Lap-Berechtigung für diese Aktion“ | Die Person ist weder Turnierleitung noch im Fast-Lap-Team (oder pausiert) | Im Kasten **Fast-Lap-Team** hinzufügen oder **Aktivieren** |
| Der Menüpunkt „Fast Lap“ fehlt | Die Person hat keinen Zugang zur Turnierleitung und keinen Einsatz | Zum Fast-Lap-Team machen lassen (siehe 2.3) |
| Die Challenge ist öffentlich nicht zu sehen | Status **Entwurf** oder Sichtbarkeit zu eng | Status auf **Angekündigt** stellen, **Sichtbarkeit** prüfen |
| Keine Jahreswertungs-Punkte | Der Status steht noch nicht auf **Ergebnisse veröffentlicht**, oder der Faktor ist 0. Alte Challenges, die von **Beendet** direkt ins Archiv gingen, haben auch keine | Status setzen, Faktor im Kasten **Jahreswertung** prüfen. Bei alten Archiv-Einträgen landen die Punkte in der gerade aktiven Saison, also nur bewusst nachholen |
| Keine Gewinn-Einträge | Der Status ist vor **Beendet**, oder es sind keine Preise eingetragen | Status prüfen, im Kasten **Preise** Preise eintragen |
| Keine Discord-Meldung | Die Zeit war keine neue offizielle Bestzeit, oder die Fast-Lap-Meldungen sind nicht eingerichtet | Unter **Admin → Verbindungen → Discord → Reiter „Meldungen“** prüfen |
| Nach Löschen einer Strecke fehlen Zeiten | Mit der Strecke werden alle ihre Zeiten gelöscht | Gibt es nicht zurück. Vorher exportieren (**CSV**) |

---

## 5. Häufige Fragen

**Können Fahrer ihre Zeit selbst eintragen?**
Nein. Zeiten tragen die Turnierleitung und das Fast-Lap-Team ein. Der Beleg (Bild oder Video) kommt als Link in
den **Nachweis-Link**.

**Was ist der Unterschied zwischen ungültig, Strafe und Löschen?**
Eine **Strafe** addiert Sekunden zur Zeit. **Ungültig** nimmt die Zeit aus der Rangliste, sie bleibt in der Liste
sichtbar. **Löschen** entfernt sie ganz. Bei Strafe und ungültig steht die Begründung für den Fahrer da.

**Ändert sich die Rangliste, wenn jemand eine bessere Zeit fährt?**
Ja, es zählt die beste wirksame Zeit je Fahrer.

**Kann ich eine Challenge ohne Strecke freigeben?**
Technisch ja, aber es gibt dann nichts zu fahren. Legt zuerst mindestens eine Strecke an.

**Wie lade ich die Ergebnisse herunter?**
Auf der Challenge-Seite oben **CSV** (alle Zeiten) oder **PDF** (Rangliste). Die Liste aller Challenges exportiert ihr mit **CSV**.

**Kann jemand ohne Konto mitfahren?**
Ja, als **Gast** (3.12). Gäste stehen in der Rangliste, bekommen aber keine Gewinne, keine Jahreswertungs-Punkte und
keine Erfolge – bis die Turnierleitung sie mit einem Konto verknüpft.

**Wie kommt die Rangliste auf den Fernseher?**
[TV und Beamer](tv.md), Abschnitt „Fast Lap am TV“.
