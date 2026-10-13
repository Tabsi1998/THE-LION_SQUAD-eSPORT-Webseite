# Events – Handbuch

Alles rund um Vereinsabende, LAN-Partys, Messen und Co.: wie ihr ein Event anlegt (auch über mehrere Tage und Orte), Turniere
und Fast Laps darunter hängt, die Anmeldung steuert, den Kalender füllt und nach dem Event Rückblick, Fotos und Newsletter
bedient. Turniere und Fast Laps selbst stehen in ihren eigenen Kapiteln ([Turniere](turniere.md), [Fast Lap](fastlap.md)); hier
steht, was das **Event** darum herum tut.

**Wo im Admin:**

- **Admin → Content → Events** (`/admin/events`) – die Liste mit Suche und Filtern, **Neues Event**, je Zeile **Anm.**, **Rückblick**, **Bearbeiten**
- **Anmeldungen & Einlass** (`/events/<name>/leitung`) – die Arbeitsseite für die Anmeldungen eines Events: Suche, „noch nicht da“,
  Einchecken, Nachrücken, Nachricht an alle, Drucken. Erreichbar über **Anm.** in der Liste und auf der Event-Seite.
- **Admin → Content → Events → Neues Event** bzw. **Bearbeiten** (`/admin/events/new`, `/admin/events/<id>`) – das Formular mit allem unten
- **Admin → Content → Galerie** – Alben und eingesandte Fotos, siehe [Inhalte](inhalte.md)

Wer das sieht: der Bereich **Turnierleitung**. Den Newsletter zu einem Event verschickt, wer das Event bearbeiten darf; ein zweites
Mal senden nur Redaktion und System.

Öffentlich: **/events** (Liste), **/events/<name>** (das einzelne Event), **/calendar** (Kalender mit Abo).

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
| **Event anlegen** | Name, Typ, Zeiten, Ort, Bild, Beschreibung; startet als Entwurf | Events → Neues Event |
| **Mehrere Tage** | Jeder Tag mit eigenem Beginn, Ende, Einlass, Titel und Ort | Formular, Kasten „Zeiten und Plätze“ |
| **Mehrere Standorte** | Treffpunkt, Halle, Lokal – je mit Adresse, Zeiten und Karte | Formular, Kasten „Ort und Veranstalter“ |
| **Event als Klammer** | Turniere und Fast Laps gehören zum Event und stehen in seiner Karte | Formular, Kasten „Programm und eSports-Inhalte“ |
| **Anmeldung** | Plätze, Begleitpersonen, Warteliste, Frist, optional Kosten | Formular, Kasten „Anmeldung“ |
| **Spielst du auch mit?** | Nach der Event-Anmeldung gleich für die Turniere des Events anmelden | von selbst, sobald das Event Turniere hat |
| **Kosten** | Kostenbeitrag je Person oder Anmeldung, Rechnung über Dolibarr | Formular, Kasten „Anmeldung“ (Bereich Finanzen) |
| **Kalender und Abo** | Monatsansicht, „In den Kalender“, Abo-Link für alle Termine, persönlicher Link | `/calendar`, Knopf am Event |
| **Nur meine** | Filter auf Events, Turniere und Fast Laps, bei denen jemand selbst dabei ist | Events-Liste und Kalender |
| **Rückblick** | Nach dem Event: Sieger, Zahlen, Bericht, „Du warst dabei“ | von selbst; Bericht über „Rückblick“ in der Liste |
| **Freunde beim Event** | Wer von den eigenen Freunden angemeldet ist | von selbst, jede Person steuert es im Profil |
| **Fotos** | Album am Event, Hinweis „Die Fotos sind da“, Einsendungen von Mitgliedern | Galerie, siehe [Inhalte](inhalte.md) |
| **Verteilen** | Newsletter, Meldung an Mitglieder oder Vorstand, Discord-Vorschau | Formular, rechts der Kasten „Verteilen“ |
| **Speziallinks** | Gezielt Zugang zu einem gesperrten oder internen Event geben | Formular, rechts, nur bei einem gespeicherten Event |
| **Rückmeldungen** | Was die Teilnehmenden nach dem Event sagen – ohne Namen | Formular, ganz unten |

---

## 2. Einrichten Schritt für Schritt

1. **Event anlegen:** Admin → Content → Events → **Neues Event**. **Name** eintragen, der **Slug** (die Adresse) entsteht daraus.
   Das genügt zum Speichern; das Event startet als **Entwurf** und ist nicht öffentlich (3.1).
2. **Zeiten und Ort:** Start, Ende und Einlass setzen, den Ort eintragen. Geht das Event über mehrere Tage oder Orte, die
   Schalter dafür nutzen (3.2, 3.3).
3. **Bild und Text:** Kopfbild, Beschreibung, bis zu sechs Highlights und die Liste „Mitbringen“ (3.1).
4. **Turniere dazuhängen:** Im Kasten **Programm und eSports-Inhalte** die Turniere und Fast Laps haken, die zum Event gehören (3.4).
5. **Anmeldung festlegen:** Haken **Registrierung/Anmeldung für dieses Event anzeigen**, Frist, Plätze, Begleitpersonen (3.5).
6. **Sichtbarkeit und Status:** rechts **Sichtbarkeit** wählen und den Status von **Entwurf** auf **Angekündigt** stellen (3.1).
7. **Speichern** und die öffentliche Seite ansehen: **/events/<name>**. Beim Veröffentlichen geht der Newsletter von selbst hinaus
   (3.9).
8. **Testen:** Mit einem Test-Konto anmelden, stornieren, den Kalender-Knopf ausprobieren.

---

## 3. Die Funktionen einzeln

### 3.1 Event anlegen und veröffentlichen

**Admin → Content → Events → Neues Event.** Die Seite hat links die Kästen, rechts „Veröffentlichung“, „Zeiten und Plätze“ und
„Verteilen“.

- **Das Event:** **Name**, **Slug**, **Beschreibung** (Markdown; HTML wird nicht roh gezeigt), **Kopfbild (Banner)**.
  Beginnt die Beschreibung mit dem Titel, warnt das Formular, denn der Titel steht auf der Seite schon groß im Kopf – am besten
  die erste Zeile löschen. Gespeichert wird trotzdem.
- **Kopfbild zeigen als:** **Automatisch erkennen**, **Foto – füllt das Banner** oder **Logo – klein auf einer Fläche**. Bei Fotos
  klickt ihr ins Bild und setzt damit den **Fokuspunkt**, der beim Zuschneiden sichtbar bleibt. Dasselbe Bild steht auf der Karte
  in der Liste.
- **Fakten-Kasten und Highlights:** **Mitbringen** (eine Zeile je Punkt, höchstens acht) und bis zu **sechs Highlights** mit Symbol
  und kurzem Text (höchstens 60 Zeichen). Wann, Wo und Eintritt kommen aus den Feldern des Formulars. Der Kasten steht oben
  auf der Event-Seite.
- **Typ:** Allgemein, Öffentliches Event, Vereinsabend, LAN-Party, Online Event, Messe / Expo stehen in der Auswahl; dazu gibt es
  noch Community-Abend, Grillabend, Mario Kart Event, F1 Event, Interner Termin, Sponsorenaktion und Turnier-Finals für schon
  bestehende Events.
- **Sichtbarkeit:** **Öffentlich**, **Nur registrierte Community**, **Nur Vereinsmitglieder** oder **Nur intern**. Wer das Event
  nicht sehen darf, bekommt „Dieses Event ist nicht öffentlich zugänglich“.
- **Status:** **Entwurf**, **Angekündigt**, **Anmeldung offen**, **Anmeldung geschlossen**, **Check-in offen**, **Läuft**,
  **Pausiert**, **Beendet**, **Ergebnisse veröffentlicht**, **Archiviert**, **Abgesagt**. Für neue Events reichen **Entwurf** und
  **Angekündigt**: Anmeldung offen, Läuft und Beendet rechnet die Seite aus den Datumsfeldern selbst. Von Hand wirken sofort
  Entwurf, Pausiert, Beendet, Ergebnisse veröffentlicht, Archiviert und Abgesagt; **Check-in offen** gilt bis zum Beginn.
- **Darstellung und Sponsoren:** **Nur Online**, **Hybrid**, **Teilnehmer öffentlich anzeigen**, **Event von uns** (nur dann zeigt
  das Event Sponsoren), **Sponsoren beim Event anzeigen** und die Auswahl der Event-Sponsoren (es erscheinen nur Sponsoren mit
  Haken „Events“; leer heißt: alle Event-Sponsoren). Dazu die Partner, die auf der Partnerseite unter „Gemeinsam“ stehen.
- **Vorschau beim Teilen:** Bei „Nur registrierte Community“ und „Nur Vereinsmitglieder“ erlaubt der Haken **Beim Teilen Titel und
  Bild zeigen**, dass WhatsApp & Co. mehr als eine neutrale Karte zeigen. Bei „Nur intern“ gibt es immer nur die neutrale Karte.
- **Live-Stream (optional):** Plattform und Adresse.
- **Löschen:** in der Liste das Papierkorb-Symbol, mit Rückfrage. Das Event verschwindet aus der öffentlichen Liste.

Die **Liste** hat Suche, Filter für Status, Typ und Sichtbarkeit, die Zahl der Plätze und einen **CSV**-Export der gefilterten Zeilen.

### 3.2 Mehrtägige Events

Im Kasten **Zeiten und Plätze** der Schalter **Mehrere Tage mit eigenen Zeiten**. Er ersetzt die Felder Start, Ende und Einlass:
Beginn und Ende des Events ergeben sich aus dem ersten und letzten Tag.

- Je Tag: **Datum**, **Beginn**, **Ende**, **Einlass**, **Titel (optional)** und, wenn es Standorte gibt, der **Standort**
  (sonst gilt der Hauptort). Tage lassen sich verschieben und entfernen; **+ Tag** legt den nächsten an.
- Mindestens **zwei** Tage, jeder Tag nur einmal, Beginn und Ende nicht gleich, der Einlass nicht nach dem Beginn. Sonst steht der
  Fehler direkt unter den Tagen.
- Zeiten sind Wiener Uhrzeiten. Endet ein Tag nach Mitternacht, tragt ihr die Endzeit einfach ein (zum Beispiel 02:00); sie zählt
  zum nächsten Morgen.
- Folge: Das Event gilt nur **innerhalb der Tageszeiten** als „Läuft“, dazwischen steht der nächste Tag mit seinem Beginn da.
  Kalender und Discord bekommen je Tag einen Termin.
- Ausschalten: Der Schalter geht wieder aus, Start, Ende und Einlass kommen aus dem ersten und letzten Tag zurück ins Formular.

### 3.3 Mehrere Standorte

Im Kasten **Ort und Veranstalter** der Knopf **+ Standort**. Mit einem Ort reichen die Felder darüber (Veranstaltungsort, Adresse,
PLZ, Stadt, Land).

- Je Standort: **Veranstaltungsort (Name, optional)**, **Adresse**, **PLZ**, **Stadt**, **Land**, **Plätze (Hinweis)**, **Start**,
  **Ende**, **Einlass** und ein **Hinweis**. Ohne eigene Zeit gilt die des Events.
- Der **erste Standort** ist der Hauptort und steht in Listen und in der App.
- Die **Anmeldung gilt für das ganze Event**. „Plätze“ je Standort ist nur ein Hinweis, kein Limit.
- Die Event-Seite zeigt „n Standorte“ und je Standort eine Karte mit Zeiten und Landkarte.
- Weiter: **Veranstalter**, **Veranstalter-Link**, **Kontakt** und der Haken **Karte anzeigen**.

### 3.4 Event als Klammer: Turniere und Fast Laps

Ein Event ist die Klammer um seine Turniere und Fast Laps. Zugeordnet wird an zwei Stellen, beide führen zum selben Ergebnis:

- im Event: Kasten **Programm und eSports-Inhalte** → **Verknüpfte eSports-Inhalte**, Haken bei **Turniere** und **Fast-Lap
  Challenges**. **Ins Programm** setzt dazu eine Karte in den Text des Programms.
- im Turnier bzw. in der Fast-Lap-Challenge im Feld **Event** (siehe [Turniere](turniere.md), [Fast Lap](fastlap.md)).

Was die Besucher davon sehen:

- **Events-Liste (`/events`):** Eine Karte für das Event; darin aufklappbar jedes Turnier und jede Fast Lap mit Tag, Uhrzeit und
  Spielart. Turniere und Fast Laps ohne Event stehen einzeln daneben.
- **Filterzeile:** **Alle**, **Events**, **Turniere**, **Fast Laps**. Dazu **Kommende** und **Vergangene**, der Typ und der Link
  zum Kalender.
- **Turniere im Event** oder **Zusätzlich einzeln:** Bei „Zusätzlich einzeln“ steht jedes Turnier auch als eigene Karte da.
  Die Wahl merkt sich das Gerät.
- **Event-Seite:** Abschnitt **Was läuft beim Event** mit allen Turnieren und Fast Laps; der Reiter **Live** zeigt den laufenden Stand (solange das Event nicht vorbei ist).
  Für die Turnierleitung gibt es dazu **Display** (die Hallen-Tafel, siehe [TV und Beamer](tv.md)).
- **Anmeldung nur mit Event-Anmeldung:** Ein Turnier kann verlangen, dass die Person zuerst beim Event angemeldet ist (Turnierformular,
  siehe [Turniere](turniere.md)).

### 3.5 Anmeldung, Warteliste und Stornieren

Im Kasten **Anmeldung** den Haken **Registrierung/Anmeldung für dieses Event anzeigen** setzen. Dann stehen da:

- **Anmeldung öffnet** und **Anmeldung schließt** (beide leer: sofort offen). Dazu **Max. Teilnehmer** unter „Zeiten und Plätze“.
- **Externer Anmeldelink:** Wer die Anmeldung woanders führt, trägt die Adresse ein; dann zeigt die Seite nur einen Knopf
  **Anmelden** dorthin, und Kosten, Warteliste und Discord entfallen.
- **Begleitpersonen erlauben** und **Max. Begleitpersonen pro Anmeldung** (bis 20). Jede Begleitperson braucht einen Platz.
- **Anmeldung über Discord erlauben:** an ab Werk. Mit externem Link oder Begleitpersonen gilt sie nur auf der Website.
  Einrichtung im [Discord-Kapitel](discord.md).

**Was die Besucher erleben:**

1. Auf der Event-Seite zeigt der Fakten-Kasten **Anmelden** (ohne Konto: **Einloggen zum Anmelden**). Das Formular steht unter
   **Dein Event** mit Begleitpersonen, einem optionalen Hinweis und, bei Kosten, der Summe vor dem Absenden.
2. Ist das Event **voll**, landet die Person auf der **Warteliste**. Die Warteliste rückt **nicht von selbst** nach.
3. Danach steht da **Du bist dabei** (oder **Warteliste**) mit der Zahl der Plätze.
4. **Stornieren** (leiser Link, mit Rückfrage) geht **bis zum Beginn** des Events und **nicht nach dem Check-in**. Danach bittet die
   Seite, sich an die Turnierleitung zu wenden. Die Regel gilt gleich auf Website, App und Discord.

**Anmeldungen verwalten – Anmeldungen & Einlass:** In der Events-Liste führt der Knopf **Anm.** (nur bei Events mit Anmeldung) auf die
Seite **Anmeldungen & Einlass** (`/events/<name>/leitung`); auf der Event-Seite steht für die Turnierleitung derselbe Link. Es gibt nur
diese eine Liste der Anmeldungen.

- **Oben, fest beim Scrollen:** der Zähler **„84 von 120 da“** (Personen; darunter die Plätze mit Begleitpersonen), das Suchfeld und
  die Filter **Noch nicht da** (Start), **Da**, **Warteliste**, **Alle** – jeweils mit Anzahl.
- **An der Tür (Handy):** Namen tippen (Groß/klein und Umlaute egal, „zoe“ findet „Zoë“), dann **Da**. Der Zähler stimmt sofort, das
  Suchfeld ist wieder leer für den nächsten Namen. Unten und in der Zeile steht 10 Sekunden lang **Rückgängig**; danach ändert ihr den **Status** in den
  Details der Person.
- **Nachrücken:** Unter **Warteliste** der Knopf **Nachrücken**. Ist kein Platz frei, kommt „Kapazität wäre überschritten“.
- **Details:** Ein Tipp auf den Namen zeigt Plätze, **Begleitpersonen** (mit − und +), die Notiz der Person, die Mail-Adresse **gekürzt**
  (`p***@…`) und den **Status** zum Ändern: **Angemeldet**, **Da**, **Warteliste**, **Nicht erschienen**, **Storniert**. Am Handy
  klappen die Details unter der Zeile auf, auf Tablet quer und PC stehen sie rechts neben der Liste.
- **Da** (eingecheckt) heißt: die Person war da. Das bringt ihr einen Eintrag in der Jahreswertung, XP und kann Erfolge
  freischalten (siehe [Erfolge, Level und Jahreswertung](erfolge.md)).
- **Storniert** oder **Nicht erschienen** beendet auch offene Rechnungsaufträge.
- **Drucken:** eine schlichte Liste der Angemeldeten mit Kästchen zum Abhaken.

**Nachricht an alle Angemeldeten:** Knopf **Nachricht an alle**. Text schreiben oder eine Vorlage antippen („Der Parkplatz ist
gesperrt – bitte den Hintereingang nehmen.“), höchstens 1000 Zeichen. Darunter steht, an wie viele Personen sie geht. **Weiter**
zeigt die Nachricht noch einmal mit der Zahl; erst **An … senden** schickt sie.

- Empfänger sind alle mit **Angemeldet** oder **Da** – je Person einmal. Warteliste, Stornierte, Nicht erschienene sowie gesperrte,
  deaktivierte und gelöschte Konten bekommen nichts.
- Sie kommt als Benachrichtigung (Glocke, App, Push, Discord-Direktnachricht nach Einstellung) und als Mail, wenn die Person Mails zu
  **Turnier-Updates** zulässt. Die Mail-Vorlage heißt **Event: Nachricht an alle** (System → E-Mail-Vorlagen).
- Hat sich die Zahl der Angemeldeten zwischen Vorschau und Senden geändert, geht nichts hinaus – die Seite zeigt die neue Zahl, ihr
  bestätigt noch einmal. Gleich nach einer Nachricht (1 Minute) geht keine zweite – weder beim selben Event noch von derselben
  Person bei einem anderen Event.
- Jede Nachricht steht unter der Liste bei **Nachrichten an alle** (wann, wer, an wie viele) und im Protokoll.

### 3.6 Kosten und Rechnung

Mit der Anmeldung sind **Kosten und Abrechnung** (Haken **Teilnahme kostet etwas**) möglich. Ihr seht diesen Abschnitt nur ohne
externen Anmeldelink; bearbeiten darf ihn der Bereich **Finanzen**. Kurz:

- Positionen wie „Kostenbeitrag 20 € je Person inkl. Essen“ mit **Bezeichnung**, **Betrag**, **Preisbasis**, **Steuer**, einer
  **Beschreibung (auf der Rechnung)** und, mit Dolibarr, einer **Leistung aus Dolibarr**. Positionen können **optional** sein; dann
  haken die Teilnehmenden sie selbst an.
- **Rechnung anlegen:** **gleich nach der verbindlichen Anmeldung** oder **erst nach Freigabe in der Finanzübersicht**.
- Der Preis wird bei der **verbindlichen** Anmeldung eingefroren; spätere Änderungen betreffen nur neue Anmeldungen. Die
  **Warteliste** bezahlt erst beim Nachrücken.
- Die Rechnung entsteht in Dolibarr, sobald der Schreibzugriff eingerichtet ist (Einstellungen → Dolibarr). Teilnehmende finden sie unter **Meine
  Rechnungen**. Alles Weitere: [Abrechnung](../ABRECHNUNG.md), [Dolibarr](../DOLIBARR.md).

### 3.7 „Spielst du auch mit?“

Hat ein Event Turniere, bietet die Seite direkt **nach der Event-Anmeldung** ein Fenster **Spielst du auch mit?**: Die Turniere des
Events in einem Schritt anmelden.

- Jedes Einzel-Turnier hat einen Haken mit Tag, Uhrzeit, Spielart, Startgeld und freien Plätzen.
- **Team-Turniere** haben keinen Haken; dort steht, dass der Kapitän das Team anmeldet, der Kapitän bekommt den Knopf **Team
  anmelden**. **Fast Laps** brauchen keine Anmeldung: Man fährt einfach die Zeit.
- Geschlossene oder deaktivierte Turniere stehen ohne Haken mit dem Grund da. Vorbeigegangene, abgesagte und Entwurfs-Turniere fehlen.
- **Anmelden** meldet je Haken ganz normal an, mit **allen Regeln der Turnierseite**: Sperren, Fristen, Event-Pflicht, Startgeld, voll
  heißt Warteliste. Danach steht je Turnier, was passiert ist: angemeldet, Warteliste, wartet auf Freigabe, schon angemeldet oder der Grund
  für den Fehler. Regeln und Kosten bestätigt die Person mit Haken.
- **Nein danke** beendet das Fenster ohne Rückfrage. Gab es kein passendes Turnier, erscheint es gar nicht.
- Kam jemand von einem Turnier mit Event-Pflicht, geht es danach zurück zu diesem Turnier.
- Dasselbe Fenster gibt es in der App.

### 3.8 Kalender, Abo und „Nur meine“

**Kalender (`/calendar`):** Liste oder Monatsansicht (die letzte Wahl merkt sich das Gerät), filterbar nach **Event**, **Turnier**,
**Fast Lap** und **Verein**. Angemeldete Termine tragen eine goldene Markierung. Für Mitglieder stehen Versammlungen und die eigenen
Helferschichten dabei.

- **Kalender abonnieren:** Eine Adresse für **alle öffentlichen Termine**, ohne Personendaten – die dürft ihr weitergeben.
  **Im Kalender öffnen** oder die Adresse einfügen (Google Kalender: „Weitere Kalender“ → „Per URL“; Apple, Outlook, Thunderbird:
  „Kalender abonnieren“). Änderungen kommen von selbst nach.
- **Mein persönlicher Link** (nur mit Konto): Ein Abo nur mit den **eigenen** Terminen – Anmeldungen (auch mit dem Team), gefahrene
  Fast Laps, zugesagte Versammlungen und Schichten. **Link erzeugen**; die Adresse erscheint **nur dieses eine Mal**, also gleich
  kopieren. **Neu erzeugen** macht die alte ungültig, **Abschalten** beendet den Link. Die Adresse ist privat. Ihn erzeugt man
  auf der Website, nicht in der App.
- **In den Kalender** am einzelnen Event (im Fakten-Kasten): ein einzelner Termin, bei mehrtägigen Events auch je Tag. Nach dem Ende
  des Events fällt der Knopf weg.
- **Nur meine:** Mit Konto gibt es in der Events-Liste und im Kalender den Knopf **Nur meine**. Er zeigt, wofür man selbst oder das
  eigene Team angemeldet ist, bei Fast Laps, wo man eine Zeit gefahren ist. In einer Event-Karte bleiben dann nur die eigenen
  Turniere. Leer heißt „Hier bist du nirgends dabei“. Auf Karten steht ein goldenes Kennzeichen **Dabei**, mit Teamname.

### 3.9 Verteilen: Newsletter, Meldung, Discord

Rechts im Formular der Kasten **Verteilen** (am Handy zugeklappt):

- **Newsletter:** Er zeigt, an wie viele Personen er geht („mit Newsletter-Zustimmung“) – nie Namen oder Adressen. Ein Event im
  Status Entwurf schickt ihn **beim Veröffentlichen von selbst**. Danach steht **Gesendet am … an …**. Steht der Kasten bei **Noch
  nicht verschickt**, gibt es **Jetzt senden** (mit Rückfrage). **Nochmal senden …** gibt es nur für Redaktion und System. **Nur
  intern** geht nie per Mail hinaus. Mehr dazu: [Mails und Benachrichtigungen](mails.md).
- **Meldung:** Der Kasten sagt, wohin die Meldung geht (Mitglieder, Vorstand …) und wann sie ging.
- **Discord-Vorschau** („So sieht die Meldung aus“) mit dem Haken **Ohne Discord veröffentlichen**. Wohin die Meldung geht, entscheidet
  die Sichtbarkeit; Einzelheiten im [Discord-Kapitel](discord.md).

### 3.10 Speziallinks

Bei einem gespeicherten Event steht rechts **Speziallinks**: Damit gebt ihr einzelnen Personen Zugriff auf ein **gesperrtes oder
internes** Event. Anlegen mit einer **Notiz** (zum Beispiel „Presse“), **Gültig Tage**, **Max.** Nutzungen, auf Wunsch für eine Person
(Konto oder E-Mail, mit **Person benachrichtigen**); bei Events mit Anmeldung erlaubt **Anmeldung freigeben** auch das Anmelden.
Der Link wird gleich kopiert. Aktive Links lassen sich einzeln deaktivieren oder mit **Alte deaktivieren** aufräumen. Ein Link steht mit Zustand da: **Aktiv**, **Deaktiviert**,
**Abgelaufen**, **Limit erreicht**.

### 3.11 Nach dem Event: Rückblick, Fotos, Rückmeldungen

**Rückblick auf der Event-Seite:** Ab dem Tag **nach dem letzten Event-Tag** (oder wenn das Event beendet oder archiviert ist; nie bei einer
Absage) ersetzt der Rückblick oben den Satz „Das Event ist vorbei“. Er besteht aus:

- **Du warst dabei** mit dem eigenen Platz je Turnier und der besten Runde je Fast Lap. Das sieht nur die Person selbst, und nur bei
  echter Teilnahme (Event-Anmeldung angemeldet oder eingecheckt, Turnier-Anmeldung oder gefahrene Zeit; die Warteliste zählt nicht).
- **Zahlen** als Kacheln: Teilnehmer, Spiele, Turniere, Fast Laps, Fotos – nur Summen.
- **Sieger** je Turnier und Fast Lap als kleines Treppchen. Es zählen nur **veröffentlichte** Ergebnisse (Turnier beendet bzw. Ergebnisse
  veröffentlicht; Fast Laps nur gültige Zeiten einer vorbeigegangenen Challenge, keine Referenzzeiten). Sichtbar ist nur, was die Person
  auch sonst auf dem Event sehen darf. Konten, die gesperrt oder gelöscht sind, stehen als „Teilnehmer“ da.
- **Bericht:** ein verlinkter Beitrag zum Event.
- Fehlen die Daten, steht der Satz mit den Links zu den Turnieren.

**Rückblick-Beitrag vorbereiten:** In der Events-Liste der Knopf **Rückblick**. Er legt einen **Entwurf** in den News an (Kategorie
Rückblick, verknüpft mit dem Event, mit den Ergebnissen als Text) und öffnet ihn. Ein zweiter Klick öffnet denselben Entwurf. Ihr
überarbeitet und veröffentlicht ihn wie jede News ([Inhalte](inhalte.md)).

**Fotos:** Hängt ein Album am Event (Admin → Content → Galerie, Feld **Event**), zeigt die Event-Seite den Abschnitt **Fotos**.
Leere Alben sehen Besucher nicht; ist eines angelegt, aber noch leer, steht bis 14 Tage nach dem Event **Fotos folgen in den nächsten
Tagen**. Dazu gehören:

- der Hinweis **„Die Fotos sind da“** an alle Angemeldeten, einmal je Person, sobald zehn Minuten lang kein Bild mehr dazukommt;
- **Fotos einsenden** durch Mitglieder bis sieben Tage nach dem letzten Event-Tag, mit Freigabe durch Redaktion oder Vereinsverwaltung.

Beides steht ausführlich in [Inhalte](inhalte.md) (3.3 und 3.4) und [Mails und Benachrichtigungen](mails.md).

**Rückmeldungen:** Am Tag nach dem Event werden alle, die dabei waren, zwei Wochen lang nach ihrer Meinung gefragt („Wie war …?“).
Im Formular des Events steht ganz unten der Abschnitt **Rückmeldungen**: Schnitt, Verteilung, gelobte und kritisierte Stichworte und
die Sätze – **ohne Namen**. Unter drei Rückmeldungen steht nur die Zahl, damit niemand erkennbar ist.

### 3.12 Freunde beim Event

Auf der Event-Seite steht für angemeldete Personen **Von deinen Freunden dabei** (nach dem Event **Deine Freunde waren dabei**) mit
Name, Bild und dem Ort: Event und Turniere, bei Teams mit Teamname. Wichtig für euch als Betreiber:

- Es zählen nur **bestätigte Freundschaften**. Blockierte, gesperrte und gelöschte Konten fehlen.
- Jede Person steuert selbst, ob ihre Freunde sehen, wo sie angemeldet ist (Profil → Privatsphäre). Ab Werk ist es an; bei Personen
  unter 14 Jahren (mit hinterlegtem Geburtsdatum) ist es aus, bis sie es selbst einschalten.
- Beim ersten Mal erscheint ein Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ mit **Verstanden** und **Ausschalten**.
- Warteliste, Storno und „nicht erschienen“ zählen nicht. Nur Turniere, die die fragende Person selbst sehen darf, erscheinen.
- In der App gibt es dieselbe Karte. Freunde auf den **Turnier- und Fast-Lap-Seiten** sind noch nicht da (geplant, #1500).

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Das Event ist nicht zu sehen | Es steht noch auf **Entwurf**, oder die **Sichtbarkeit** schließt die Person aus | Status auf **Angekündigt**, Sichtbarkeit prüfen; für Einzelne einen Speziallink geben |
| „Dieses Event ist nicht öffentlich zugänglich“ | Die Person darf das Event nicht sehen (Community, Mitglieder, intern) | Sichtbarkeit ändern oder Speziallink |
| Kein Anmelden-Knopf | Haken Anmeldung aus, Frist noch nicht offen oder schon vorbei, Entwurf, oder es gibt einen externen Anmeldelink | Haken, **Anmeldung öffnet** und **schließt** prüfen |
| „Die Anmeldung ist aktuell nicht offen“ | Außerhalb der Frist | Fristen im Kasten Anmeldung ändern |
| Person landet auf der Warteliste | Alle Plätze (mit Begleitpersonen) sind vergeben | **Max. Teilnehmer** erhöhen oder die Person unter **Anmeldungen & Einlass** nachrücken lassen |
| „Kapazität wäre überschritten“ beim Nachrücken | Nicht genug freie Plätze | Plätze erhöhen oder erst eine andere Anmeldung stornieren |
| Person kann nicht mehr stornieren | Das Event hat begonnen oder sie ist schon eingecheckt | Unter **Anmeldungen & Einlass** in den Details den Status auf **Storniert** setzen |
| „Die Zahl der Empfänger hat sich geändert“ | Zwischen Vorschau und Senden hat sich jemand an- oder abgemeldet | Neue Zahl prüfen und noch einmal senden |
| „Gerade ist schon eine Nachricht an alle hinausgegangen“ | Innerhalb einer Minute wurde schon eine Nachricht geschickt | Kurz warten; doppelt antippen schickt nicht zweimal |
| Mehrere Tage speichern nicht | Weniger als zwei Tage, doppeltes Datum, Beginn gleich Ende, Einlass nach dem Beginn | Die Meldung unter den Tagen lesen und korrigieren |
| Event gilt nachts als „nicht laufend“ | Bei mehreren Tagen zählen nur die Tageszeiten | Gewollt; Zeiten je Tag prüfen |
| Titel steht auf der Seite doppelt | Die Beschreibung beginnt mit dem Titel | Erste Zeile der Beschreibung löschen |
| Kein Rückblick nach dem Event | Das Event ist abgesagt, noch nicht vorbei, oder die Ergebnisse sind nicht veröffentlicht | Status und Turniere prüfen: Turnier auf **Beendet** bzw. **Ergebnisse veröffentlicht** |
| Foto-Abschnitt fehlt | Das Album ist leer oder nicht am Event verknüpft | Album mit dem Event verknüpfen und Bilder hochladen |
| Newsletter geht nicht hinaus | Event ist **Nur intern**, noch Entwurf, oder schon verschickt | Kasten **Verteilen** lesen |
| „Nochmal senden“ fehlt | Nur Redaktion und System dürfen ein zweites Mal senden | Redaktion fragen |
| Abschnitt Kosten fehlt | Es gibt einen externen Anmeldelink, oder die Anmeldung ist aus | Link entfernen bzw. Anmeldung einschalten |
| Kosten lassen sich nicht ändern | Dafür ist der Bereich **Finanzen** nötig | Rechte klären ([Rollen](../ROLLEN.md)) |
| Personal-Kalender zeigt nichts | Die Adresse ist abgelaufen oder wurde neu erzeugt | Auf `/calendar` **Neu erzeugen** und im Kalender die neue Adresse eintragen |
| Freunde-Abschnitt fehlt | Keine bestätigten Freunde angemeldet, oder sie teilen ihre Anmeldungen nicht | Gewollt; jede Person steuert es selbst |

---

## 5. Häufige Fragen

**Wie lege ich ein Event an, das nur Mitglieder sehen?**
Sichtbarkeit **Nur Vereinsmitglieder**. Der Haken **Beim Teilen Titel und Bild zeigen** entscheidet, was WhatsApp & Co. zeigen.

**Muss ich Status „Anmeldung offen“ von Hand setzen?**
Nein. Mit dem Haken Anmeldung und den Fristen rechnet die Seite aus, ob die Anmeldung offen ist. **Angekündigt** reicht.

**Kann ein Turnier ohne Event leben?**
Ja. Es steht dann einzeln in der Liste.

**Kann ein Turnier in mehreren Events stehen?**
Nein, ein Turnier hat ein Event.

**Rückt die Warteliste von selbst nach?**
Nein. Ihr tippt unter **Anmeldungen & Einlass** bei der Person auf **Nachrücken**; der Preis wird dabei eingefroren.

**Sehen Teilnehmende, wer sonst angemeldet ist?**
Die Event-Seite zeigt eine Liste der Angemeldeten, wenn **Teilnehmer öffentlich anzeigen** an ist. Freunde sehen sich nur, wenn beide
das erlauben (3.12).

**Wie viele Fotos kann ein Mitglied einsenden?**
Bis zu 20 je Album, bis sieben Tage nach dem Event; Einzelheiten in [Inhalte](inhalte.md).

**Warum wird der Kalender-Link nur einmal gezeigt?**
Die Website speichert nur einen Fingerabdruck. Braucht jemand die Adresse noch einmal, erzeugt er eine neue; die alte gilt dann nicht mehr.

**Gibt es das Event auch auf dem Fernseher?**
Ja, als Hallen-Tafel und Aufruf-Tafel, siehe [TV und Beamer](tv.md).

**Was ist noch nicht da?**
Freunde auf Turnier- und Fast-Lap-Seiten (#1500) sind noch in Arbeit.
