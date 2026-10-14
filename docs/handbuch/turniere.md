# Turniere – Handbuch

Der Weg eines Turniers aus Sicht der Turnierleitung: anlegen, Anmeldung, Check-in, Turnierbaum und Gruppen, Ergebnisse
(mit dem Ergebnis-Fenster am Handy), Stationen, TV und der Abschluss. Dazu: was ihr tut, wenn nur wenige Helfer da sind.

**Wo im Admin:**

- **Admin → eSports → Turniere** (`/admin/tournaments`) – Liste aller Turniere mit Suche, Status-Filter und CSV-Export
- **Admin → eSports → Turniere → Neues Turnier** (`/admin/tournaments/new`) – anlegen
- **Admin → eSports → Turniere → Turnier öffnen** (`/admin/tournaments/<Turnier>`) – Reiter **Teilnehmer**,
  **Turnierbaum**, **Matchplan**, **Gruppen** (nur beim Format Gruppenphase), **Team**, **Rückmeldungen** (erst nach
  dem Ende), **Bearbeiten**
- **Admin → eSports → Turnier-Leitfaden** (`/admin/tournament-guide`) – welches Format wofür, mit „Voreinstellung übernehmen“
- **Admin → eSports → Stationen** (`/admin/stations`) – Geräte und Plätze in der Halle, Spiele zuweisen
- **Admin → eSports → Gewinne**, **Strafen**, **Jahreswertung** – was nach dem Turnier daraus wird
- **Turnierleitung am Handy** (`/tournaments/<Name>/leitung`) – Ergebnisse eintragen und Streitfälle entscheiden, ohne die Verwaltung

Wer was darf: Die **Turnierleitung** (Bereich „Turnierleitung“, mit bestätigter Zwei-Faktor-Anmeldung) verwaltet alle
Turniere. **Ohne 2FA** erscheint stattdessen der Hinweis **2FA einrichten**, siehe [Erste Schritte im Admin](admin.md).
**Helfer mit Einsatz** sehen in der Verwaltung nur **ihr** Turnier und dürfen nur das Operative: Status zwischen
**Check-in offen**, **Live**, **Pausiert** und **Beendet**, Check-in, Ergebnisse (je nach Rolle).
**Moderation allein** hat keinen Zugang zu den Turnierseiten.

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
| **Turnier anlegen** | Titel und Spiel genügen, das Turnier startet als **Entwurf** und ist nicht öffentlich | Neues Turnier |
| **Formate** | Single und Double Elimination, Jeder gegen jeden, Schweizer System, Gruppenphase, Mehrspieler, Liga, freie Bäume und mehr | Neues Turnier / Reiter Bearbeiten, Abschnitt „Struktur“ |
| **Spielweise** | **Online**, **Vor Ort** oder **Hybrid**: wer Ergebnisse meldet, wer Termine macht, wer eincheckt | „Wie gespielt wird“ |
| **Anmeldung** | Selbstanmeldung, Warteliste, Einladung, Speziallinks, Startgeld | Reiter Bearbeiten, Reiter Teilnehmer |
| **Check-in** | Online selbst, vor Ort durch die Turnierleitung | Reiter Teilnehmer |
| **Aufstellung** | Bei Team-Turnieren wählt der Kapitän, wer spielt | Dein-Stand-Karte der Spieler, Anzeige im Reiter Teilnehmer |
| **Turnierbaum, Gruppen** | Vorschau wächst mit den Anmeldungen, fix wird sie mit dem Check-in | Reiter Turnierbaum, Matchplan, Gruppen |
| **Ergebnisse** | Spieler melden, oder die Turnierleitung trägt im **Ergebnis-Fenster** ein, danach 10 Sekunden **Rückgängig** | Matchplan, Stationen, Turnierleitung am Handy |
| **Dispute** | Streitfall entscheiden mit einem Tipp | Turnierleitung am Handy |
| **Stationen** | Spiele Geräten zuweisen, Aufruf auf dem TV | Admin → eSports → Stationen |
| **TV** | Turnierbaum, Aufrufe, Stationen auf Fernseher und Beamer | [TV und Beamer](tv.md) |
| **Abschluss** | Beendet, Ergebnisse veröffentlicht, Punkte, Erfolge, Gewinne | Statusauswahl im Turnier |

---

## 2. Einrichten Schritt für Schritt

### 2.1 Das Turnier anlegen

1. **Admin → eSports → Turniere → Neues Turnier**. Alternativ **Admin → Kommandozentrale → Schnellzugriff → + Turnier**.
2. **Tipp:** Erst **Admin → eSports → Turnier-Leitfaden** ansehen. In der Tabelle „Nach Turnierform“ setzt der Knopf
   **Voreinstellung übernehmen** Format, Teamgröße, Best of und Spielweise für typische Spiele vor. Alles bleibt änderbar.
3. Kasten **Das Turnier**: **Titel**, **Spiel**, **Format**, **Teilnahme** (Einzelspieler oder Team), bei Teams
   **Spieler pro Team**, dazu **Max Spieler** / **Min Spieler** (bei Teams „Max Teams“ / „Min Teams“).
4. Kasten **Wie gespielt wird**: **Online**, **Vor Ort** oder **Hybrid** wählen (3.2).
5. Rechts im Kasten **Wann**: **Veröffentlichung** (**Entwurf** oder **Angekündigt**), **Start Event/Turnier**,
   **Anmeldung endet**. Unter „Weitere Zeiten und Sonderfälle“: **Ende**, **Anmeldung öffnet**, **Check-in öffnet**,
   **Check-in endet**, **Nur Einladung**, **Anmeldung über Discord erlauben**, **Vereinsmitglieder von der Selbstanmeldung
   ausschließen** und, wenn das Turnier zu einem Event gehört, **Anmeldung nur mit Event-Anmeldung**. Unter dem Kasten warnt
   **Planung prüfen** bei widersprüchlichen Zeiten.
6. Weiter unten, aufklappbar: **Darstellung und Regeln** (Slug, Plattform, Beschreibung, Banner, **Regeln**,
   Partner), **Spieloptionen** (Best of, Seeding, Folgerunden mischen, Spiel um Platz 3), **Preise**, **Streaming und
   externe Links**. Schreibt die **Regeln** hinein, bevor die Anmeldung aufgeht – was ihr festlegt (Frist bis zum
   Forfeit, Streitfall-Ablauf, Beweise), steht dann für alle fest.
7. **Turnier erstellen**. Du landest im Turnier.

**Turnier für ein Event (seit #1371):** Ein Turnier gehört zu einem Event, wenn du es **im Event** anlegst oder dort
hinzufügst – nicht im Turnier. Event öffnen → Abschnitt **Programm** → **+ Turnier in diesem Event**. Das Formular kommt mit
Ort, Tag, Partnern und den Discord-Einstellungen des Events; der Tag muss im Zeitraum des Events liegen. Ein schon
angelegtes Turnier holst du dort über **Bestehendes hinzufügen**, **Lösen** nimmt es wieder heraus. Im Turnier steht nur
noch die Zeile „Gehört zu … – ändern im Event“, und der Ort kommt vom Event (ein eigener Ort nur ohne Event). Gibt es schon genug Teilnehmer, steht die Meldung „Vorschau mit n
   Spielen angelegt“ da.

### 2.2 Anmeldung öffnen

1. Im Turnier oben im **Status**-Feld **Anmeldung offen** wählen. In der Liste geht es für Entwürfe auch mit dem
   Play-Symbol **Anmeldung öffnen**.
2. Prüfen: **Öffentliche Seite** (Link oben im Turnier) zeigt Anmeldung, Regeln und Preise.

### 2.3 Am Turniertag

1. **Check-in starten** (Knopf oben im Turnier) – das macht den Baum fix (3.4).
2. Teilnehmer einchecken (3.3).
3. **Turnier starten**.
4. Ergebnisse eintragen oder melden lassen (3.6).
5. Im Status **Beendet**, danach **Ergebnisse veröffentlicht** (3.10).

---

## 3. Die Funktionen einzeln

### 3.1 Formate und Strukturen

Das **Format** steht beim Anlegen und später unter **Turnier öffnen → Bearbeiten → Abschnitt „Struktur“ →
Turnierstruktur**. Zwei Spielarten gibt es: **Duell** (zwei Seiten) und **Mehrspieler** (viele in einer Lobby, gewertet nach
Platzierung).

| Format | Wofür |
| --- | --- |
| **Single Elimination** | Ein Abend, ein Sieger; wer verliert, ist raus. Mit Haken „Spiel um Platz 3“ möglich |
| **Double Elimination** | Eine Niederlage ist nicht das Aus (Loser Bracket) |
| **Jeder gegen jeden** | Kleines Feld, alle spielen gegeneinander, die Tabelle entscheidet |
| **Schweizer System** | Viele Teilnehmer, kein fester Baum; die Runden entstehen einzeln aus den Ergebnissen |
| **Gruppenphase** | Teilnehmer in Gruppen, danach Turnierbaum |
| **Liga** | Eine Saison über Wochen mit Spieltagen |
| **Mehrspieler frei** | Alle gleichzeitig in einer Lobby |
| **Überlebensmodus** | Für Battle-Royale-artige Spiele, gewertet nach Platzierung |
| **Freier Turnierbaum** und **Mehrspieler freier Turnierbaum** | Ihr schreibt den Baum selbst (Schema) |
| **Zeitfahren**, **Rennserie** | Wertung über Rundenzeiten, **kein Turnierbaum**. Für reines Zeitfahren ist die [Fast-Lap-Challenge](fastlap.md) gedacht |

Zu den Besonderheiten:

- **Schweizer System:** Es gibt keine Vorschau. Teilnehmer bestätigen, dann oben im Turnier **Schweizer Runde**
  klicken – jede Runde einzeln.
- **Gruppenphase:** Oben **Gruppen generieren**, die Zahl der Gruppen eintippen (Vorschlag 4). Im Reiter **Gruppen**
  stehen sie.
- **Liga, Jeder gegen jeden und Gruppen:** Unter **Bearbeiten → Spielweise** erscheint der Kasten **Spielwochen**:
  **Spieltag dauert (Tage)**, **Standardtag**, **Standarduhrzeit**. Ein Spieltag ist ein Zeitraum. Beide Seiten dürfen
  Termine vorschlagen, was die Gegenseite annimmt, gilt, sonst greift die Standardzeit.
- **Freier Turnierbaum:** Unter **Bearbeiten → Struktur** erscheint das Feld **Schema** (beim Mehrspieler-Baum dazu
  **Spielgröße** und **Qualifizierte**). Ein Beispiel-Schema steht als Vorgabe darin. Anschließend unten
  **Speichern & Struktur anwenden**, dann im Reiter **Turnierbaum** prüfen.
- **Läufe umbauen (Mehrspieler-Baum):** Ist das Turnier nicht voll oder fallen Fahrer aus, werden unterbesetzte Läufe
  zusammengelegt (2 + 2 wird ein Lauf mit 4), ausgeglichen oder das Turnier wird abgekürzt (der Lauf mit allen Verbliebenen
  ist das Finale). Unter **Bearbeiten → Spieloptionen → Läufe umbauen** wählst du **Vorschlag** (Standard: der Vorschlag
  steht als Leiste oben in der Turnierverwaltung, du bestätigst oder lehnst ab) oder **Automatisch**. Auffüllen und
  Freilose laufen immer von selbst; laufende und aufgerufene Läufe werden nie umgebaut.
- **Sehr viele Begegnungen:** Bei Jeder gegen jeden und Liga mit sehr vielen Teilnehmern zeichnet das System keinen
  Entwurf. Dann Teilnehmerzahl senken oder Gruppen nutzen.
- **Seeding** (Zufall, Manuell, Ranking) und der **Setzplatz** pro Teilnehmer stehen unter Spieloptionen bzw. beim
  Hinzufügen eines Teilnehmers.

Ob der Baum Vorschau oder fix ist, siehst du im Reiter **Matchplan** (Hinweis „Vorschau / Draft“).

### 3.2 Online, Vor Ort, Hybrid

Im Kasten **Wie gespielt wird** (beim Anlegen) bzw. **Bearbeiten → Spielweise** stehen drei Voreinstellungen. Darunter
lassen sich die drei Werte einzeln ändern (**Austragung**, **Ergebniserfassung**, **Terminplanung**).

| Voreinstellung | Ergebnisse | Termine | Check-in |
| --- | --- | --- | --- |
| **Online** | Spieler melden, die Gegenseite bestätigt | Spieler schlagen vor | Spieler selbst |
| **Vor Ort** | Turnierleitung (und Station-Crew) tragen ein | fix durch die Turnierleitung | Turnierleitung |
| **Hybrid** | Staff kann eingreifen, Spieler können melden | gemischt | Spieler selbst |

Lasst ihr **Ergebniserfassung** und **Terminplanung** auf „Automatisch“, gilt die Regel der Zeile oben. Eine Angabe an
einem Spiel geht vor der einer Phase, die vor der des Turniers. Die Liste der Turniere zeigt die geltende Regel als
Schilder an. Eine Warnung erscheint, wenn die Mischung nicht passt (zum Beispiel „Vor-Ort-Turnier mit
Spieler-Ergebnismeldung“).

**Auto-Start:** Der Haken „Turnier anhand Start-/Endzeit automatisch live/beendet schalten“ ist nur für Online-Turniere
gedacht. Für Vor-Ort-Turniere ausgeschaltet lassen, dort startet ihr selbst.

### 3.3 Anmeldung, Startgeld und Teilnehmer

**So melden sich Spieler an:** Auf der öffentlichen Turnierseite mit **Anmelden**, nach Regeln und Datenschutz
bestätigen. Bei Team-Turnieren meldet der Kapitän oder Co-Kapitän das Team an. Fehlt dem Spiel eine Pflicht-ID
(zum Beispiel Spielername), verlangt die Anmeldung sie.

- Die Anmeldung gilt **sofort als Bestätigt**, solange Platz ist. Ist das Turnier voll, kommt die Person auf die
  **Warteliste**. Beides bekommt sie als Nachricht.
- Es geht nur im Status **Anmeldung offen** und im Zeitfenster **Anmeldung öffnet / endet**. Mit dem Haken
  **Nur Einladung** gibt es keine Selbstanmeldung.
- Selbst abmelden können sich Spieler nicht mehr, wenn sie eingecheckt sind oder das Turnier läuft; dann geht es nur
  über die Turnierleitung.

**Startgeld:** Kostet die Teilnahme etwas, steht es im Abschnitt **Startgeld** unter **Turnier öffnen → Bearbeiten**.
Den sieht und ändert nur der Bereich **Finanzen**. Wer anmeldet, übernimmt das Startgeld ausdrücklich (bei Teams der
Kapitän für das ganze Team); ohne diese Bestätigung nimmt die Seite die Anmeldung nicht an. Bezahlt wird mit der
verbindlichen Teilnahme: Warteliste kostet nichts. Alles Weitere steht in [Abrechnung](../ABRECHNUNG.md).

**Reiter Teilnehmer** (Standard beim Öffnen):

- **Teilnehmer hinzufügen** (bei Teams: **Team hinzufügen**): Konto in der Personensuche wählen, oder ohne Konto als
  manueller Gast mit **Anzeigename**; dazu **Status** und **Setzplatz**. Ein Hinweis erscheint, wenn die Person nicht
  beim Event angemeldet ist, obwohl das Turnier es verlangt – eintragen geht trotzdem.
- Suche („Name, Discord, E-Mail oder Team suchen“) und Filter nach Status, mit Zähler und den Zahlen je Status.
- Je Zeile: die **Status-Auswahl** (nur für die Turnierleitung): Ausstehend, Bestätigt, Abgelehnt, Warteliste,
  Eingecheckt, Nicht erschienen. Beim Ablehnen fragt die Seite nach einem freiwilligen Grund; die Person bekommt eine
  Nachricht. Ist jemand von der Warteliste nachgerückt, stellt ihr den Status auf **Bestätigt**.
- Die Knöpfe **Check-in**, **Auschecken**, **Nicht erschienen**, **Entfernen**.
- **Disqualifizieren** und **Austritt** (nur Strukturrollen, nur im laufenden Turnier): der erste Klick zeigt den
  Umbauplan in Worten („E: Lena kommt kampflos weiter.“), erst **Bestätigen** macht ihn wirksam; ein freiwilliger Grund
  geht in die Nachricht an die Person. Die Regeln: im K.-o. und Doppel-K.-o. kommt der Gegner kampflos weiter, ein
  Spiel, das schon läuft, wird gewertet – nie ein Eintrag ins Loser Bracket (anders als bei **Nicht erschienen** für
  ein einzelnes Spiel). In Liga und Gruppen gilt die 50-Prozent-Regel: weniger als die Hälfte der eigenen Spiele
  gespielt → alle Spiele annulliert und raus aus der Tabelle, sonst Rest kampflos verloren. Im Schweizer System
  bleiben die Ergebnisse, die Person wird nicht mehr gepaart. In Läufen rückt der Nächstplatzierte nach. Danach steht
  die Anmeldung auf **Ausgetreten** bzw. **Disqualifiziert**; die Statusauswahl kennt diese Werte nicht.
- Bei Team-Turnieren steht unter jedem Team die Aufstellung (3.5).
- Oben im Turnier: Downloads **PDF Teilnehmer**, **PDF Check-in**, **PDF Anmeldung QR** (zum Aufhängen), **PDF Spiele**
  und **CSV Matchplan**.
- Mit **Speziallinks** (Kasten oben, nur Turnierleitung) schickt ihr einzelnen Personen einen Link, der anmelden darf.

### 3.4 Check-in und der Wechsel zum festen Baum

- **Online/Hybrid:** Spieler checken auf der Turnierseite selbst ein (Knopf **Check-in**) – nur wenn ihre Anmeldung
  **Bestätigt** ist.
- **Vor Ort:** Der Knopf heißt für Spieler „Check-in vor Ort“ und ist gesperrt. Die Turnierleitung setzt den Haken:
  im Reiter **Teilnehmer** **Check-in** (das Gegenstück ist **Auschecken**). Wer nicht kommt: **Nicht erschienen**.
- **Check-in starten** (Hauptknopf oben im Turnier, solange noch kein Check-in läuft) setzt den Status **Check-in
  offen** und **baut den Turnierbaum fix** – aus allen **Bestätigten und Eingecheckten**, nicht nur aus denen, die schon
  da sind. Bis dahin wurde die Vorschau bei jeder Anmeldung neu gemischt.
- Danach bleibt der Baum fix: Teilnehmer lassen sich nicht mehr einfach entfernen. Stattdessen **Nicht erschienen**
  setzen und über **Teilnehmer hinzufügen** mit **Ersetzt Nicht-Erschienen** einen Ersatz einsetzen.
- Mit dem Haken **Folgerunden zufällig mischen** (Spieloptionen) bleibt Runde 1 nach dem Check-in fix, die Folgerunden
  werden zufällig besetzt.
- **Turnier starten** (Status **Live**) prüft vorher die Planung. Gibt es Konflikte oder Hinweise, fragt die Seite
  „Mit Hinweisen live schalten?“. Ohne ein spielbares Spiel lässt sich das Turnier nicht starten.

### 3.5 Aufstellung bei Team-Turnieren

Bei Team-Turnieren (Teilnahme „Team“) wählen Kapitän oder Co-Kapitän in **Dein Stand** auf der Turnierseite, wer
spielt: genau so viele wie **Spieler pro Team**, die übrigen sind Ersatz, wenn **Ersatzspieler erlauben** (Spieloptionen)
an ist. Das geht bis zum Ende des Check-ins. Am Turniertag tippt jedes Teammitglied **Ich bin da**.

Die Turnierleitung sieht es im Reiter **Teilnehmer** unter dem Teamnamen: „Spielt: …, Ersatz: …“ und „4 von 5 da“.
Ohne gewählte Aufstellung steht dort „Keine Aufstellung – ganzes Team“.

### 3.6 Ergebnisse: melden, eintragen, korrigieren

**Online/Hybrid – Spieler melden.** Auf der Matchseite öffnen die Spieler **Ergebnis melden**: Stand mit Plus und
Minus, bei Best-of den Sieger je Spiel antippen, bei Mehrspieler-Spielen die Zielreihenfolge, auf Wunsch ein Foto und
eine Notiz. Meldet die Gegenseite dasselbe, steht das Ergebnis fest. Hat eine Seite gemeldet, sieht die andere die
Meldung in Worten (mit Foto) und bestätigt mit **Stimmt** – oder **Stimmt nicht**. Bei Teams bestätigt die Teamleitung.

**Die Turnierleitung trägt ein.** Dasselbe **Ergebnis-Fenster** öffnet sich an vier Orten, mit denselben Feldern und
Wörtern:

| Ort | Weg |
| --- | --- |
| **Matchplan** | Turnier öffnen → Reiter **Matchplan** → am Spiel **Ergebnis eintragen** (nur, wenn das Turnier **Live** oder **Pausiert** ist und beide Seiten feststehen) |
| **Stationen** | Admin → eSports → Stationen → an der Station **Ergebnis eintragen** |
| **Turnierleitung am Handy** | `/tournaments/<Name>/leitung` → Reiter **Ergebnisse** → **Eintragen** |
| **Matchseite** | öffentliche Seite des Spiels |

Am Handy kommt das Fenster von unten, am PC steht es in der Mitte. Je nach Spiel gibt es:

- **Stand** mit großen Plus- und Minus-Knöpfen,
- **Best of**: je Spiel den Sieger antippen (nur, wo der höhere Stand gewinnt; wo der niedrigste gewinnt, gibt es den
  Stand),
- **Sieger** antippen (Spiele auf Zeit),
- bei Mehrspieler-Spielen **Reihenfolge antippen** (wer zuerst im Ziel war, zuerst; ein zweiter Tipp nimmt zurück)
  oder **Punkte eintragen**; die Wahl merkt sich der Browser,
- die Schalter **Nicht erschienen** und **Aufgegeben** je Seite (nur eine Seite kann sie haben).

Unten zeigt ein Satz in Worten, was gespeichert wird („… gewinnt …“). Dann **Ergebnis speichern**. Danach
läuft **10 Sekunden lang** unten die Leiste **Rückgängig**. Erst nach Ablauf rückt der Baum weiter, und die Spieler
bekommen Bescheid.

**Korrigieren:** Am Spiel steht dann **Ergebnis korrigieren**. Pflicht ist ein **Grund der Korrektur** (mindestens fünf
Zeichen), er steht im Protokoll. In der Ansicht der Turnierleitung steht unter **Zuletzt eingetragen** der Knopf
**Korrigieren**. Das gilt auch für ein Spiel in Klärung, das schon ein Ergebnis hat.

**Was der Server annimmt** (gleich für Ergebnis-Fenster, Meldung der Spieler und Wertung):

- Stand, Punkte und Zeit sind Zahlen ab 0 (Stand höchstens 1 000 000 000, Zeit höchstens 24 Stunden).
- Im K.-o. gibt es keinen Gleichstand – eine Seite muss gewinnen. In Gruppe, Liga und Swiss teilt Gleichstand den Platz.
- Best of 3 heißt: der Sieger hat genau 2 gewonnene Spiele, die Gegenseite weniger.
- Kommt ein anderer weiter, als zuerst eingetragen, setzt die Korrektur das Folgespiel zurück – auch wenn es schon
  gespielt ist. Das Protokoll hält fest, welches Spiel zurückgesetzt wurde und welches Ergebnis es hatte. Läuft im
  Folgespiel gerade das **Rückgängig**, wartet die Korrektur kurz.
- Ergebnis, Wertung und Klärung setzt nur das Ergebnis-Fenster bzw. die Entscheidung – nicht die Matchplanung.

**Wer darf eintragen?** Die Turnierleitung, und Helfer mit Ergebnis-Recht in ihrem Einsatz (Organisation,
Schiedsrichter, Ergebnisdienst; die Stationsleitung an ihrer Station). Die Ansicht am Handy zeigt nur Spiele, für die
du eingeteilt bist. Jede Eingabe steht im Protokoll.

### 3.7 Dispute: Streit um ein Ergebnis

Sagt ein Spieler, ein Ergebnis stimmt nicht, meldet er ein Problem (Grund, Text, auf Wunsch Foto). Das Spiel steht dann
auf **In Klärung**.

1. Die Turnierleitung sieht es in der Ansicht am Handy im ersten Reiter **Braucht Aufmerksamkeit (n)**: Meldung mit
   Grund, Foto und dem eingetragenen Ergebnis, dazu die Meldungen beider Seiten. Auf der Matchseite führt
   **Streitfall entscheiden** direkt dorthin. In der Kommandozentrale steht die Zahl unter **Ergebnis-Konflikte**.
2. Entscheiden: **Ergebnis bleibt** (ohne Ergebnis: **Weiter wie bisher**) oder **Ergebnis ändern** (ohne Ergebnis:
   **Ergebnis eintragen**), das öffnet das Ergebnis-Fenster.
3. Die **Begründung** ist freiwillig und geht an beide Seiten. Beide bekommen die Entscheidung als Benachrichtigung.

Der Reiter zeigt auch andere Fälle, zum Beispiel ein fehlendes Ergebnis oder eine **defekte Station**: Dort legt
**Umlegen** die wartenden Spiele auf eine freie Station. Erledigtes verschwindet von selbst.

### 3.8 Stationen

**Admin → eSports → Stationen** (Seite „Stationen & Spiel-Zuweisung“). Oben das **Aktive Turnier** wählen.

- **Einzelne Station** (Name, Gerätetyp, öffentlicher Hinweis) oder **Schnell-Setup** (Präfix und Anzahl, zum Beispiel
  „Switch“ mal 8) – nur für die Turnierleitung.
- **Spiel zuweisen** an einer Station: **Zuweisen** reserviert, **Direkt starten** startet gleich. **Starten** und
  **Freigeben** stehen an der belegten Station.
- **Zeitplan füllen** verteilt offene Spiele automatisch, **Freie Stationen starten** startet, was bereit ist. Im
  Turnier macht **Werkzeuge → Stationen automatisch** dasselbe.
- **PDF Hochformat / Querformat** liefert einen Aushang der Stationen.
- Der Status einer Station (frei, belegt, reserviert, defekt) lässt sich ändern.

Ein Spiel gilt auf dem Aufruf-TV als aufgerufen, sobald es einer Station zugewiesen und noch nicht gestartet ist. Mehr
in [TV und Beamer](tv.md).

### 3.9 TV

Den Turnierbaum für Fernseher oder Beamer erstellt ihr im Turnier mit dem Link **TV-Link** (oben neben „Öffentliche
Seite“), Einrichtung und Grundwerte stehen in [TV und Beamer](tv.md). Beim Status **Pausiert** gibt es **Pause bis**,
der TV zählt dann herunter. Im Reiter **Turnierbaum** setzt ihr „Runde präsentiert von“.

### 3.10 Abschluss

1. **Beendet** (Status-Auswahl im Turnier): Die Spiele sind durch. Alle Beteiligten bekommen einmal die Nachricht
   „Turnier beendet“; die Erfolge der Teilnehmer werden neu ausgewertet.
2. **Ergebnisse veröffentlicht** (nur Turnierleitung, nicht Helfer): Jetzt vergibt das System die **Punkte für die
   Jahreswertung** (Gewicht unter Spieloptionen: Major, Normal, Mini, Fun-Wertung … oder „Keine Jahreswertung“), die
   Auszeichnungen und legt die **Gewinn-Einträge** an (zu sehen unter **Admin → eSports → Gewinne**). Im Bearbeiten-
   Formular erzeugt **Gewinne erzeugen** (Abschnitt Preise) die Einträge bei Bedarf noch einmal.
3. **Archiviert** oder **Abgesagt**: ebenfalls nur Turnierleitung.
4. **Sperren** (Werkzeuge, ab dem Status Beendet): Danach sind Ergebnisse, Teilnehmer, Spielzeiten und Stationen nur
   noch lesbar. Mit **Entsperren** geht es wieder. Löschen bleibt möglich.
5. Der Reiter **Rückmeldungen** erscheint nach dem Ende und zeigt die Rückmeldungen ohne Namen.

Strafen stehen unter **Admin → eSports → Strafen**, die Jahreswertung unter **Admin → eSports → Jahreswertung**.

### 3.11 Turniertag mit wenig Helfern

- **Vor Ort** als Spielweise wählen: Ihr tragt Ergebnisse und Termine selbst ein, niemand muss Spieler hinterherrufen.
- **Helfer eintragen** unter **Turnier öffnen → Reiter „Team“ → Zuweisung hinzufügen**: Person, **Rolle**
  (Organisation, Schiedsrichter, Ergebnisdienst, Stationsleitung, Stream-Betreuung), **Bereich** (ganzes Turnier oder
  Phase, Gruppe, Station, Spiel) und eine **Notiz**, zum Beispiel „Samstag Vormittag“. Der Helfer sieht nur dieses
  Turnier. Zwei Helfer reichen oft: einer am Check-in, einer mit dem Handy bei den Spielen („Ergebnisdienst“).
- **Stationen automatisch füllen** statt jedes Spiel einzeln zuzuweisen.
- **Das Handy der Turnierleitung** (`/tournaments/<Name>/leitung`) trägt Ergebnisse ein, zeigt „Ergebnis fehlt“ und
  gibt Benachrichtigungen bei Problemen.
- **TV** aufstellen und aufrufen lassen, damit Spieler selbst sehen, wo sie hinmüssen.
- **Check-in** vorher: Online-Spieler checken selbst ein, vor Ort druckt **PDF Check-in** die Liste zum Abhaken.
- **Nicht erschienen** früh setzen, Ersatz einsetzen, und die Frist vorher in den Regeln nennen.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Statt der Verwaltung steht „2FA einrichten“, „Neues Turnier“ fehlt | Turnierleitung ohne bestätigte Zwei-Faktor-Anmeldung | Zwei-Faktor einrichten und neu anmelden ([Erste Schritte](admin.md)) |
| Im Admin sind nur dein Turnier und wenige Knöpfe da | Du bist Helfer mit Einsatz | Gewollt. Mehr Rechte gibt der Bereich Turnierleitung |
| „Anmeldung für dieses Turnier geschlossen“ | Der Status ist nicht **Anmeldung offen** | Status ändern |
| „Anmeldung ist noch nicht geöffnet“ / „bereits beendet“ | Außerhalb von **Anmeldung öffnet / endet** | Zeiten im Reiter Bearbeiten ändern |
| „Anmeldung für dieses Turnier ist deaktiviert“ | **Nur Einladung** oder „Öffentliche Anmeldung erlauben“ aus | Haken ändern oder Speziallink nutzen |
| „Bitte bestätige, dass du das Startgeld übernimmst“ | Das Turnier kostet Startgeld | Haken beim Anmelden setzen |
| „Dieses Turnier ist für externe Teilnehmer vorgesehen …“ | Haken „Vereinsmitglieder ausschließen“ | Ausschalten oder Teilnehmer von Hand eintragen |
| Spieler kommt nicht ins Turnier, steht auf Warteliste | Das Turnier ist voll | **Max Spieler** erhöhen oder die Person auf Bestätigt setzen |
| Check-in-Knopf der Spieler ist grau („Check-in vor Ort“) | Das Turnier ist **Vor Ort** | Die Turnierleitung checkt ein |
| „Bei Vor-Ort-Turnieren macht die Turnierleitung den Check-in.“ | Dasselbe | wie oben |
| Teilnehmer lässt sich nach Check-in-Start nicht entfernen | Der Baum ist fix | **Nicht erschienen** setzen und mit „Ersetzt Nicht-Erschienen“ einen Ersatz hinzufügen |
| „Turnier kann ohne spielbares Match nicht gestartet werden.“ | Es gibt keine Spiele | Struktur prüfen (Bearbeiten → Speichern & Struktur anwenden), Teilnehmer bestätigen |
| „Turnierplanung enthält Konflikte“ beim Starten | Doppelte Stationen, Zeiten, … | Konflikte beheben oder in der Rückfrage „Trotzdem live“ |
| Turnierbaum leer („Turnierbaum noch nicht erzeugt“) | Keine Struktur oder zu wenig Teilnehmer | Teilnehmer bestätigen, Struktur anwenden. Beim Schweizer System **Schweizer Runde** klicken |
| Zeitfahren hat keinen Baum | Gewollt, wertet über Rundenzeiten | [Fast Lap](fastlap.md) nutzen |
| Unter Matchplan fehlt **Ergebnis eintragen** | Das Turnier ist nicht **Live**/**Pausiert**, oder eine Seite steht noch nicht fest | Status prüfen, Vorrunde beenden |
| „Für dieses Spiel kannst du kein Ergebnis eintragen.“ | Dir fehlt das Ergebnis-Recht im Einsatz | Rolle im Reiter **Team** prüfen |
| „Bitte kurz den Grund der Korrektur angeben“ | Ein vorhandenes Ergebnis lässt sich nur mit Grund ändern | Grund eintragen (mindestens fünf Zeichen) |
| Ergebnis gespeichert, der Baum rückt nicht weiter | Noch die 10 Sekunden **Rückgängig** | Kurz warten |
| „Nur eine Seite kann ‚Nicht erschienen‘ oder ‚Aufgegeben‘ haben.“ | Beide Schalter gesetzt | Einen davon aus |
| Turnier ist gesperrt, nichts lässt sich ändern | **Sperren** nach dem Ende | **Entsperren** in den Werkzeugen |
| „Turnierleitung darf nur operative Status setzen“ | Ein Helfer wollte einen anderen Status | Statuswechsel macht die Turnierleitung |
| Dashboard zeigt „Turnier-Anmeldungen: warten auf Freigabe“ | Von Hand eingetragene Anmeldungen mit Status **Ausstehend** | Im Reiter Teilnehmer auf **Bestätigt** setzen |

---

## 5. Häufige Fragen

**Muss ich jede Anmeldung freigeben?**
Nein. Selbstanmeldungen sind sofort **Bestätigt**, solange Platz ist. Nur von Hand eingetragene mit Status **Ausstehend**
warten.

**Wann wird der Turnierbaum fix?**
Mit **Check-in starten**. Bis dahin ist er eine Vorschau, die bei jeder An- und Abmeldung neu gemischt wird.

**Der Leitfaden sagt, ich erzeuge den Baum „mit den Anwesenden“ – stimmt das?**
Nicht ganz: Der Baum entsteht beim Start des Check-ins aus allen Bestätigten und Eingecheckten. Wer nicht erscheint,
setzt ihr danach auf **Nicht erschienen** und ersetzt ihn, oder das Spiel geht mit **Nicht erschienen** im
Ergebnis-Fenster aus.

**Heißt es Walkover oder Nicht erschienen?**
In der Oberfläche „Nicht erschienen“ (im Ergebnis-Fenster). „Walkover“ steht nur noch im Leitfaden.

**Wie trage ich ein Ergebnis am Handy ein?**
Öffentliche Turnierseite → Link **Turnierleitung** (sichtbar, wenn du Ergebnisse eintragen darfst) → **Ergebnisse** →
**Eintragen**.

**Kann ich einen Fehler beim Ergebnis zurücknehmen?**
Sofort: ja, 10 Sekunden lang mit **Rückgängig**. Später: **Ergebnis korrigieren** mit Grund.

**Können Spieler ihr Ergebnis selbst melden, obwohl wir vor Ort spielen?**
Nur wenn ihr **Ergebniserfassung** auf „Beide Parteien melden“ oder „Hybrid“ stellt. Bei „Vor Ort“ trägt die
Turnierleitung ein.

**Wie bekomme ich einen Spieler nach der Anmeldefrist noch hinein?**
Reiter **Teilnehmer → Teilnehmer hinzufügen**, oder ein **Speziallink**.

**Wo stelle ich ein, wie viele Punkte das Turnier für die Jahreswertung gibt?**
Unter **Bearbeiten → Erweiterte Spieloptionen → Jahreswertung**. Gutgeschrieben werden sie bei **Ergebnisse
veröffentlicht**.

**Was passiert beim Löschen eines Turniers?**
In der Liste das Papierkorb-Symbol; die Rückfrage warnt, dass Teilnehmer, Turnierbaum und öffentliche Seite danach
weg sind. Gesperrte Turniere lassen sich trotzdem löschen.
