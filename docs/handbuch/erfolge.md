# Erfolge, Level und Jahreswertung – Handbuch

Was Spielerinnen und Spieler für ihr Mitmachen bekommen und wie ihr das steuert: **Erfolge** (Abzeichen mit Stufen), **Level und
Löwen-Rang** (Erfahrung, Rahmen, Prestige), die **Jahreswertung** (Saison mit Rangliste) und der Jahresrückblick **„Dein Jahr bei
LION“**. Die Werte hinter Turnieren und Fast Laps stellt ihr bei [Turnieren](turniere.md) und [Fast Lap](fastlap.md) ein; hier
steht, was daraus wird.

**Wo im Admin:**

- **Admin → Content → Erfolge** (`/admin/achievements`) – neun Reiter: **Übersicht**, **Katalog**, **Vergeben**, **Saison**, **Jahresrückblick**, **XP**, **Vorschau**, **Negativ & Vorfälle**, **Statistik**
- **Admin → eSports → Jahreswertung** (`/admin/seasons`) – Saisons anlegen, Streichresultate, Status, Korrekturen, Abschließen

Wer das sieht: **Erfolge** der Bereich **Redaktion**, **Jahreswertung** der Bereich **Turnierleitung**. Massenvergabe, Katalog-Import,
XP-Korrekturen und das Zurücksetzen von Prestige dürfen nur der **Vorstand** (wer einen Posten hält) und die **Systemverwaltung**;
für alle anderen steht dort der Satz „… dürfen nur der Vorstand oder die Systemverwaltung“.

Öffentlich: **/achievements** (alle Abzeichen und Bestenliste), **/u/me?tab=achievements** (die eigenen Erfolge im Profil, Reiter
**Erfolge**), **/seasons/<name>** und **/seasons/current** (Jahreswertung), **/dein-jahr** (Jahresrückblick, nur mit Konto).

Nicht zu verwechseln: Die **Jahreszeiten** (Weihnachten, Ostern, Deko) stehen im Kapitel [Auftritt und Einstellungen](auftritt.md).
Mit „Saison“ ist hier die **Jahreswertung** gemeint.

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
| **Erfolge (automatisch)** | Abzeichen mit Stufen werden vergeben, sobald etwas passiert (Ergebnis, Turnierabschluss, Bestzeit …) | von selbst; Überblick unter Erfolge → Übersicht |
| **Katalog** | Gruppen und Stufen mit Material, Punkten und Bedingung; eigene Erfolge anlegen | Erfolge → Katalog |
| **Von Hand vergeben** | Einzelne Person, mit Grund und Datum; zurücknehmen; Massenvergabe mit Vorschau | Erfolge → Vergeben |
| **Level und Löwen-Rang** | XP für Tun, Level 1 bis 60, zwölf Ränge mit eigenem Rahmen, Prestige-Sterne | von selbst; Eingriffe unter Erfolge → XP |
| **Jahreswertung** | Punkte aus Turnieren, Fast Laps und Event-Teilnahme, Rangliste je Saison | Admin → eSports → Jahreswertung |
| **Saisonabschluss** | Rangliste festschreiben, Saison-Erfolge und XP vergeben, Saison-MVP | Jahreswertung (**Abschließen**) und Erfolge → Saison |
| **Jahresrückblick „Dein Jahr“** | Durchtipp-Rückblick mit Zahlen und Teilen-Bild, zu eurem Zeitraum | Erfolge → Jahresrückblick |
| **Negativ und Vorfälle** | Fun-Erfolge für kleine Missgeschicke, bis zur Freischaltung geheim | Erfolge → Negativ & Vorfälle |
| **Vorschau** | Jede Zeremonie und jedes Abzeichen in jedem Material ansehen | Erfolge → Vorschau |
| **Statistik** | Freischaltungen je Woche, die Besten, Seltenheit je Stufe | Erfolge → Statistik |
| **Neuberechnung** | Nach Korrekturen an den Erfolgen Ansprüche still nachvergeben, zum Schluss eine Sammel-Nachricht je Person | Erfolge → Übersicht (nur Superadmin) |

---

## 2. Einrichten Schritt für Schritt

Die meisten Erfolge laufen ohne Zutun. Ihr braucht:

1. **Erfolge ansehen:** Admin → Content → Erfolge → **Übersicht**. Steht dort „Der Abgleich ist noch nicht gelaufen“, ist das bei
   einer frischen Seite normal; er läuft nachts (3.1).
2. **Katalog prüfen:** Reiter **Katalog** → **Katalog prüfen**. „Keine Fehler“ heißt: alles stimmig (3.2).
3. **Jahreswertung anlegen:** Admin → eSports → Jahreswertung → **Neue Jahreswertung** mit Name, Zeitraum und Streichresultaten.
   Eine neue Saison startet als **Entwurf**; **setzt sie auf Aktiv**, sonst bekommt niemand Punkte (3.5).
4. **Gewicht prüfen:** Bei Turnieren und Fast-Lap-Challenges das Gewicht für die Jahreswertung wählen (3.6).
5. **Zeitraum des Jahresrückblicks** merken oder ändern: Reiter **Jahresrückblick** (3.9). Ab Werk 15.12. bis 31.1.
6. **Testen:** Mit einem Test-Konto in den Reiter **Vorschau** gehen und eine Zeremonie abspielen (3.8).

---

## 3. Die Funktionen einzeln

### 3.1 Wie Erfolge entstehen und was die Übersicht zeigt

Erfolge werden vergeben, **sobald etwas passiert**: ein Ergebnis wird gemeldet, ein Turnier endet, eine Bestzeit wird eingetragen, ein
Level wird erreicht. Eine Warteschlange arbeitet die betroffenen Personen **alle 30 Sekunden** ab. Zusätzlich rechnet ein **nächtlicher
Abgleich** alle zuletzt Aktiven komplett neu; **Abweichungen** dort heißen, dass ein Ereignis unterwegs verloren ging (der Abgleich holt
es nach).

Reiter **Übersicht** (Admin → Content → Erfolge):

- Kennzahlen: **Freischaltungen 7 Tage** und **30 Tage**, **Ohne Erfolg**, **Seltenste Stufe**, **Aktivste Kategorie**.
- **Level-Verteilung** in Stufen von 1–9 bis Level 60, dazu die Zahl der Personen mit Prestige-Stern.
- **Freischaltungen je Kategorie (30 Tage).**
- **Auswertung** mit „Warten gerade“, „Noch zu melden“, „Letzter Lauf“ und dem Knopf **Alle jetzt auswerten**. Der Knopf merkt alle
  Konten vor; abgearbeitet wird im Hintergrund. Nützlich nach einer Katalog-Änderung.
- **Nächtlicher Abgleich** mit „Zuletzt“, „Geprüft“, „Abweichungen“, „Dabei vergeben“.
- **Turnier-Pokale nachtragen** (nur Bereich **System**): Der Knopf **Pokale nachtragen** leitet Pokale und Banner aller
  Turniere mit veröffentlichten Ergebnissen neu ab – etwa nach einer Korrektur alter Ergebnisse. Doppelt entsteht nichts;
  der Lauf meldet, wie viele Turniere und Pokale es sind, und steht im Protokoll.
- **Neuberechnung** (nur **Superadmin**): Stand des stillen Modus, **Probelauf** und **Neuberechnung abschließen** (3.10).

**So zählen die Turnier- und Spiel-Erfolge.** Der Text „So schaffst du es“ steht an jedem Erfolg; die Regeln dahinter sind für alle gleich:

- **Wer gespielt hat, bekommt den Erfolg.** Im Team zählt ein Spiel für alle, die laut **Aufstellung** oder
  **Teilnehmerliste** dabei waren. Gibt es keine, zählt es für alle, die zu dem Zeitpunkt im Team waren – nicht nur für
  die Person, die das Team angemeldet hat. Wer das Team später wechselt, behält, was er mit ihm gespielt hat.
- **Ein Freilos ist kein Spiel:** Es zählt nicht als gespielt oder gewonnen und unterbricht keine Serie.
- **Kampflos gewertet** zählt für den Sieger als Spiel und Sieg. Wer nicht erschienen ist, bekommt nichts.
- **Siegesserie:** Siege in Folge. Ein Unentschieden oder eine Niederlage beendet sie.
- **Zwei Dinge heißen „Liga“:** die **Vereinsliga** (Season und Staffeln, Admin → Liga) und das Turnierformat
  **Jeder gegen jeden – Hin- und Rückrunde**. Spiele der Vereinsliga zählen für die Spiel-Erfolge (Spielmacher, Sieger,
  Teamsieger …), ihre Staffeln aber nicht als Turnier. Ein Turnier im Format Hin- und Rückrunde ist ein normales Turnier.
- **Plätze gibt es erst nach dem Abschluss.** Champion, Podest, Top 8, Finalist und die anderen Platz-Erfolge zählen nur
  aus Turnieren mit dem Status **Beendet**, **Ergebnisse veröffentlicht** oder **Archiviert**, nie aus einer
  Staffel der Vereinsliga. Grundlage ist der gespeicherte Platz (derselbe wie auf dem Pokal). **Top 8** zählt erst ab mehr als
  acht Teilnehmern.
- **Finalist** ist, wer im Finale stand: im Endspiel, im Grand Final oder im Finallauf (dort alle). Kein Finale haben
  Jeder gegen jeden (einfach und Hin- und Rückrunde), Schweizer System, reine Gruppenphase, die Vereinsliga, Zeitfahren
  und Rennserie – außerdem ein K.-o. mit nur zwei Teilnehmern und ein einzelner Mehrspieler-Lauf: Ein einziges Spiel ist
  kein Finale. Ein kampfloses Finale zählt auch nicht.
- **Teilnahme statt Anmeldung:** Turnierveteran, Multitalent, Formatvielfalt und Teamturniere zählen, wenn die
  Anmeldung angenommen oder eingecheckt war und die Person mindestens ein echtes Spiel gespielt hat – auch wenn sie
  danach austritt oder disqualifiziert wird. Abgesagte Turniere zählen nicht, Staffeln der Vereinsliga auch nicht (nur
  bei der Formatvielfalt zählt die Vereinsliga als „Hin- und Rückrunde“).
- **Durchzieher** verlangt mehr: ein abgeschlossenes Turnier, gespielt, ohne kampflos zu verlieren, auszutreten oder
  disqualifiziert zu werden.
- **Topgesetzt und Riesentöter** gelten nur bei fester Setzliste (Setzliste **Manuell**, siehe
  [Turniere](turniere.md)), nicht bei **Zufall**. Es zählt die Setznummer der Anmeldung.
- **Preisträger** zählt Preise aus Turnieren, die vorgemerkt, abholbereit oder abgeholt sind – keine verfallenen und
  keine aus Fast Lap oder Verlosungen.

Ein einmal freigeschalteter Erfolg bleibt, auch wenn ein Ergebnis später korrigiert wird.

Was die Person erlebt: Beim Freischalten feiert eine **Zeremonie** das Abzeichen (Look und Klang nach Material, Bewegung nach
Kategorie); jede Person stellt unter **Einstellungen → Benachrichtigungen**, Kasten **Zeremonien**, ein, ob sie mit Klang und voller Bewegung gefeiert wird oder dezent (siehe
[Mails und Benachrichtigungen](mails.md)). Dazu kommt eine Meldung im Thema **Erfolge** (In-App, Push, Discord; **nie** per Mail).
Montags gibt es auf Wunsch den **Wochenrückblick** per Mail. Jeder Erfolg lässt sich teilen: Er hat eine eigene Seite
(`/achievements/a/<id>`).

**Was genau zählt (Chat, Discord, Verein, Profil):**

- **Chat** (Plauderer, Teamgeist, Turnier-Plauderer, Briefeschreiber): Zurückgehaltene, abgelehnte und gelöschte Nachrichten
  zählen nie. Je Erfolg zählen höchstens **50 Nachrichten an einem Tag** (Wiener Zeit); schreiben lässt sich weiter unbegrenzt.
  „Plauderer“ sind Turnier- und Match-Chat zusammen. Eine Nachricht wird über die Warteschlange ausgewertet, eine später
  freigegebene ebenso. **Sticker-Sammler** zählt verschiedene Sticker, ebenfalls nur aus sichtbaren Nachrichten – ohne
  Tageslimit.
- **Discord:** Gezählt wird nur mit verknüpftem Discord-Konto und nur auf **eingeschalteten** Servern – das gilt für
  „Discord-Stimme“ und „Überall dabei“. Auf welchen Servern jemand ist, gleicht der Bot beim Verknüpfen und **jede Nacht um 03:50**
  ab; nach dem Trennen zählt nichts mehr. „Überall dabei“: Stufe I ein Server, Stufe II die Hälfte der eingeschalteten Server
  (mindestens zwei), Stufe III alle – nie mehr, als es Server gibt.
- **Events:** „Eventgänger“ und „Vereinsleben“ zählen, wer unter **Anmeldungen & Einlass** eingecheckt ist (**Da**), je Event einmal;
  **abgesagte Events** zählen nicht. Vereinsintern sind Events mit der Sichtbarkeit **Mitglieder** oder **intern** und Events der Art
  **Vereinsabend** oder **intern**. Einen Kartenscan am Event-Einlass gibt es nicht.
- **Datenbewusst:** erst, wenn die Person unter Einstellungen → Privatsphäre selbst etwas einstellt oder ihren Datenexport holt –
  die Voreinstellung bei der Registrierung zählt nicht.
- **Twitch** (Streamer, Sendezeit, Clip-Macher): nur mit **per Anmeldung verknüpftem** Twitch-Kanal; ein getippter Name zeigt den
  Stream auf der Seite, zählt aber nicht. **Verifizierter Streamer** kommt von selbst, wenn Twitch so verknüpft ist und der Verein
  die Person als Streamer oder Creator führt (Häkchen im Vereinsprofil, [Verein](verein.md) 3.10); von Hand vergeben geht weiter.
- **Team:** „Teamauftritt“ braucht Logo, Banner und Teambeschreibung und zählt für Teamleitung und Co-Leitung – ausgewertet gleich
  nach dem Speichern. „Kapitän“ zählt die Tage seit der Übernahme der Leitung (bei älteren Teams ohne diese Angabe ab der Gründung).
- **Gruselnacht:** Der Kürbis zählt nur am **31.10. ab 18 Uhr** (Wiener Zeit) – das prüft der Server.

### 3.2 Der Katalog: Gruppen, Stufen, Materialien

Reiter **Katalog**. Eine **Gruppe** ist ein Erfolg („Turniersieger“), eine **Stufe** ist seine Ausbaustufe. Gruppen stehen nach
**Kategorie** geordnet: **Spielen**, **Turnier**, **Fast Lap**, **Saison**, **Team**, **Community**, **Streaming & Creator**,
**Profil & Konto**, **Verein (nur Mitglieder)**, **Besonders**, **Geheim**, **Negativ**.

Das **Material** der Stufe steht für die Wertigkeit: **Holz, Eisen, Bronze, Silber, Gold, Platin, Diamant** (die Leiter), dazu
**Legendär** und **Geheim**. Jede Stufe bringt **Punkte** (nach Material voreingestellt, änderbar).

Je Gruppe sind sichtbar: Zahl der Stufen, **versteckt** (Name und Stufen erscheinen erst nach der Freischaltung; vorher steht nur ein
Fragezeichen), **Sonder**, **Negativ**, **Eigen** (von euch angelegt), und der Schalter **Öffentlich** / **Intern**. In der Tabelle der Stufen
steht die **Bedingung**: **Automatik · Ziel n** (ein Zähler prüft das Ziel) oder **von Hand**; dazu ein Status: **live**, **Zähler**, **geplant**
(die Automatik ist noch nicht angeschlossen) und **nur Mitglieder**.

**Bearbeiten:** An jeder Gruppe und Stufe: Name, Beschreibung, **So schaffst du es**, Motiv und Symbol, Farbe, Material und Punkte.
Stufen dürfen nur Materialien bekommen, die zwischen ihren Nachbarstufen Platz haben.

**Eigene Erfolge anlegen:**

1. **Neue Gruppe** – Name, Kategorie, Beschreibung, Motiv, **Öffentlich sichtbar**, **Versteckt bis zur Freischaltung**,
   **Sonderauszeichnung (von Hand kuratiert)**, **Negativ/Fun**. Die **Kennung** entsteht aus dem Namen und lässt sich später nicht ändern.
2. In der Gruppe **Neue Stufe** – Name, Material, Punkte. **Von Hand vergeben (keine Automatik)** ist die übliche Wahl für eigene
   Erfolge. Für Vereins-Abzeichen gibt es **Nur für Vereinsmitglieder**.
3. Löschen geht nur bei Gruppen, die ihr selbst angelegt habt, und löscht **alle Vergaben** mit (Rückfrage).

**Katalog prüfen** läuft dieselben Regeln wie der automatische Test und listet **Fehler** und **Hinweise** mit Sprung zur Gruppe.
**Export** speichert den Katalog als Datei; **Katalog einspielen** (nur Vorstand und Systemverwaltung) prüft eine solche Datei erst, schreibt
bei Fehlern **nichts** und löscht nie etwas.

### 3.3 Von Hand vergeben, zurücknehmen, Massenvergabe

Reiter **Vergeben**.

**Einzelvergabe** (alle mit dem Bereich **Redaktion**): Person suchen, Stufe wählen (nach Kategorie sortiert, nur Namen), dann
die Optionen. Die Texte der Hand-Erfolge sagen, wie es läuft: bei Ehrungen wie Ehrenlöwe, Hall of Fame, Saison-MVP oder
Ehrenamt „Der Vorstand entscheidet, die Redaktion trägt ein“; bei Teilnahmen wie Gamers Heaven, LAN-Gründer oder Beta-Tester
trägt die Redaktion alle ein, die dabei waren:

- **Grund** (steht im Protokoll),
- **Datum** – leer heißt jetzt, sonst rückwirkend,
- **Ohne Zeremonie – zählt, wird aber nicht gefeiert,**
- **Benachrichtigung schicken** (Postfach, Push, Discord).

Stufen **nur für Mitglieder** gehen nur an aktive Mitglieder oder Ehrenmitglieder. Hat die Person die Stufe schon, steht „hat diese Stufe schon“.

**Rücknahme:** Rechts stehen die Erfolge der gewählten Person. **Zurücknehmen** verlangt einen Grund (mindestens drei Zeichen).

**Massenvergabe** (nur Vorstand und Systemverwaltung): bis zu **500** Personen auf einmal – aus einer **Liste** (Benutzername,
E-Mail oder Konto je Zeile, auch als CSV) oder nach **Turnier** (angenommen oder eingecheckt), **Event** (angemeldet oder eingecheckt),
**Team**, **Rolle** oder **allen aktiven Mitgliedern**. Zuerst **Vorschau**: wer bekommt es, wer hat es schon, wer darf nicht, wer wurde nicht
gefunden. Erst dann **An n Personen vergeben** (mit Rückfrage).

**Protokoll:** Darunter steht jede Aktion im Erfolge-Admin – wer, für wen, warum – mit Filter nach Art (Vergabe, Rücknahme,
Massenvergabe, XP-Korrektur, Prestige zurückgesetzt, Saisonabschluss, Katalog-Import, Gruppe/Stufe angelegt/geändert/gelöscht, Vorfall,
Alle ausgewertet).

Tipp: Wer Teilnehmende eines Events auszeichnen will, nimmt die Massenvergabe mit der Quelle **Event**.

### 3.4 Level, XP und der Löwen-Rang

Alles, was man tut, bringt **XP** (Erfahrung). XP sind von den Erfolgspunkten getrennt. Daraus wird das **Level 1 bis 60**; je fünf Level
ein **Rang**, der zugleich der **Titel** ist und überall gleich heißt (Abzeichen, XP-Balken, Profil, App, Mails):

| Rang | Name | Level |
| --- | --- | --- |
| 1 | Jungtier | 1–4 |
| 2 | Fährte | 5–9 |
| 3 | Rudel | 10–14 |
| 4 | Jäger | 15–19 |
| 5 | Silbermähne | 20–24 |
| 6 | Goldmähne | 25–29 |
| 7 | Löwenhaupt | 30–34 |
| 8 | Brüller | 35–39 |
| 9 | Schwingen | 40–44 |
| 10 | Obsidian | 45–49 |
| 11 | Sonnenlöwe | 50–54 |
| 12 | Löwenkönig | 55–60 |

Jeder der zwölf Ränge hat einen **eigenen gezeichneten Rahmen** um das Profilbild (Web und App); im Profilkopf kommt je Rang eine
Signatur dazu, auf Wunsch ruhig und ohne Bewegung (Einstellung „weniger Bewegung“ des Geräts). Die **Kronen** (Gold, Silber, Bronze)
tragen die drei Personen mit den meisten Erfolgspunkten – nur Konten mit **öffentlichem Profil** und eingeschaltetem „Erfolge
öffentlich“ –; wer eine erobert oder verliert, bekommt eine Meldung, höchstens eine je Art in sechs Stunden. Wer „Erfolge
öffentlich“ selbst ausschaltet, bekommt keine.

**Was XP bringt** (Auszug; Quelle: Programmwerte, „Deckel“ = höchstens so oft pro Tag):

| Tun | XP |
| --- | --- |
| Match gespielt / gewonnen | 20 / 40 |
| Turnieranmeldung, Check-in, Turnier beendet | 30, 10, 50 |
| Platz 1 / 2 / 3 | 150 / 100 / 60 |
| Gültige Fast-Lap-Runde (Deckel 100), persönliche Bestzeit, Pole | 5, 15, 50 |
| Event besucht (eingecheckt) | 60 |
| Täglicher Besuch (Deckel 1), Freundschaft, Team beigetreten | 10, 10, 30 |
| Discord-Nachricht (Deckel 50), Community- und Team-Chat (je Deckel 30) | je 1 |
| Saison abgeschlossen | 100 |
| Versammlung, Helferstunde, Abstimmung | 100, 50, 20 |
| Erfolg | Punkte × 10 |

**Vereinsbonus:** Aktive Mitglieder bekommen **10 Prozent** mehr XP. Dieselbe Gutschrift zählt nie doppelt (zum Beispiel dasselbe Match
zweimal gemeldet). Als Richtwert braucht Level 30 rund 123.000 XP und Level 60 rund 683.000 XP.

**Prestige:** Ab Level 60 ist Prestige **freiwillig**: Level zurück auf 1, ein **Stern** (höchstens fünf), Erfolge und Punkte bleiben,
und jeder Stern macht den Weg zu Level 60 um ein Viertel länger. Die Person entscheidet im Profil (Reiter **Erfolge**) mit Rückfrage, und
**24 Stunden lang** lässt sich Prestige zurücknehmen.

**Level-Aufstieg:** Er wird mit einer Zeremonie gefeiert (bei Titelwechsel mit Banner). Ein ausgebauter Aufstiegs-Moment ist **geplant**
(#1502) und noch nicht da.

**Eingriffe (Reiter XP):** Person wählen, dann Level, XP, Prestige, Login-Serie und die **Tagesdeckel heute** (je Quelle, voll heißt bis
Mitternacht nichts mehr). **XP korrigieren** (Plus oder Minus, immer mit Grund, im Protokoll) und **Prestige zurücksetzen** (alle Sterne
weg, XP bleiben, mit Rückfrage) gehen nur für Vorstand und Systemverwaltung.

### 3.5 Die Jahreswertung: Saison anlegen

**Admin → eSports → Jahreswertung → Neue Jahreswertung.** Das Fenster hat diese Abschnitte:

- **Jahreswertung:** **Name**, **Slug** (Adresse), **Typ**, bei bestehenden Saisons der **Status**, **Banner**, **Start**, **Ende**,
  **Beschreibung**. Typ **Turnierserie (Circuit)** rechnet genauso, heißt öffentlich „Lions Circuit“ und erscheint nicht im
  Jahresrückblick „Dein Jahr“ – aktiv ist aber auch dann nur eine Wertung.
- **Punkte:** **Streichresultate** (die schwächsten Wertungen je Person fallen aus der Gesamtwertung). Rechts erklärt die
  Regelübersicht „So wird gewertet“.
- **Punkte korrigieren** (bei Entwurf und Aktiv): Person wählen, Punkte (minus für einen Abzug) und **Grund** – etwa ein
  Fair-Play-Bonus oder ein Regelverstoß. Die Korrektur steht als eigene Wertung „Korrekturen“ in der Rangliste und im Protokoll;
  ein erneutes Veröffentlichen eines Turniers ändert sie nicht. Sie zählt immer (auch bei Streichresultaten wird sie nie
  gestrichen) und gilt nicht als Wertung bzw. Teilnahme. Über den Papierkorb fällt sie wieder weg.
- **Volle Saison (Pflichttermine):** Turniere und Fast-Lap-Challenges, bei denen man Punkte geholt haben muss, um beim Abschluss den
  Erfolg **Volle Saison** zu bekommen. Für die Punkte selbst spielt die Liste keine Rolle.

**Was zählt:** jedes Turnier und jede Fast-Lap-Challenge mit einem Gewicht über 0 und jede bestätigte Event-Teilnahme – immer in
der aktiven Jahreswertung. Ausschließen heißt beim Turnier bzw. der Challenge „Keine Jahreswertung“.

**Status:** **Entwurf** (so startet jede neue Saison), **Aktiv**, **Abgeschlossen**, **Archiv**. **Punkte werden immer in die Saison mit
dem Status Aktiv geschrieben.** Aktiv kann nur eine sein – wer eine zweite aktiviert, bekommt den Hinweis, welche schon läuft. Ist keine
Saison aktiv, bekommen Ergebnisse keine Jahrespunkte, und die Startseite zeigt keine Jahreswertung. Ein Zeitraum am Ende (Ende-Datum)
schaltet den Status nicht um. Stehen aus der Zeit davor noch mehrere auf **Aktiv**, warnt die Seite rot („Mehrere aktive Wertungen“);
die Punkte gehen weiter dorthin, wo sie bisher hingingen – schließt alle bis auf eine ab. Abgeschlossene und archivierte Wertungen
ändert nichts mehr: weder ein erneutes Veröffentlichen noch die Bereinigung doppelter Einträge (die meldet solche Fälle nur).

Die Karte jeder Saison hat **Bearbeiten**, **Öffentliche Seite**, bei der aktiven **Abschließen** (3.7) und beim Entwurf **Löschen**
(Rückfrage). Gelöscht werden kann nur ein Entwurf ohne Punkte; eine laufende oder abgeschlossene Saison setzt ihr auf **Archiv**. Die
öffentliche Seite (`/seasons/<slug>`) zeigt **Rangliste**, **Top Teilnehmer**, „So funktioniert diese Jahreswertung“ und erklärt
Platzierung, Teilnehmerfeld, Boni und Schutz.

### 3.6 Wie Punkte entstehen

Für die Jahreswertung gilt: **Basispunkte × Gewicht × Teilnehmerfaktor + Bonus**.

| Platz | Basispunkte |
| --- | --- |
| 1 | 100 |
| 2 | 80 |
| 3 | 65 |
| 4 | 50 |
| 5–8 | 35 |
| 9–16 | 20 |
| Teilnahme | 10 |

| Teilnehmerfeld | Faktor |
| --- | --- |
| 1–7 | ×0,75 |
| 8–15 | ×1,00 |
| 16–31 | ×1,15 |
| 32–63 | ×1,30 |
| 64 und mehr | ×1,50 |

**Gewicht** stellt ihr beim Turnier bzw. bei der Fast-Lap-Challenge im Kasten **Jahreswertung** ein (nicht in der Saison):
**Major** ×3,00, **Normal** ×2,00, **Mini** ×1,25, kleine Challenge ×1,00, **Fun-Wertung** ×0,75, **Event/Check-in** ×0,50, **Keine
Jahreswertung** ×0,00 oder ein **eigener Faktor**. Die Punkte werden gutgeschrieben, wenn die Ergebnisse **veröffentlicht** sind
([Turniere](turniere.md), [Fast Lap](fastlap.md)).

Der **Teilnehmerfaktor** richtet sich nach den tatsächlich bestätigten bzw. eingecheckten Teilnehmern beim Veröffentlichen, nicht nach
den Plätzen. Wird ein Ergebnis nach dem Veröffentlichen korrigiert und das Turnier wieder veröffentlicht, ziehen die Punkte nach
([Turniere](turniere.md), 3.10).

**Boni:** derzeit 5 Bonuspunkte für die bestätigte Event-Teilnahme; alles andere läuft über **Punkte korrigieren** (3.5). **Schutz vor Punktesammeln:** Bei Fast Laps und Fun-Wertungen zählen
je Person und Kalendermonat die ersten **vier** Einträge voll, danach nur noch zur Hälfte. Turniere (Major, Normal, Mini) zählen immer voll.

**Event-Teilnahme:** Checkt die Turnierleitung eine Person unter **Anmeldungen & Einlass** ein (**Da**), bekommt sie einen Jahreswertungs-Eintrag
(Gewicht ×0,50 plus 5 Bonuspunkte), 60 XP und eine Erfolgs-Auswertung. Wird der Check-in zurückgenommen, gehen Eintrag und XP wieder weg,
auch bei mehrfachem Hin und Her nie doppelt; eine abgeschlossene Jahreswertung bleibt, schon freigeschaltete Erfolge ebenfalls. Siehe
[Events](events.md).

**Erfolge** sind Profilpunkte und fließen nicht still in die Jahreswertung. Reine Community-Aktivität zählt nicht – nur Turniere,
Fast Laps, bestätigte Event-Teilnahmen und Korrekturen mit Grund.

**Externe Wettbewerbe** (Referenzen und Serien, [Inhalte](inhalte.md) 3.8 und 3.9) bringen **keine Jahreswertungs-Punkte**, nur
Abzeichen in der Kategorie **Verein (nur Mitglieder)**: **Podest extern** (Platz 1 bis 3 in einer Referenz, Team oder Einzel – jeder
Eintrag zählt einmal) und **Dauerbrenner** (externe Saisons mit Endplatz, die man für den Verein zu Ende gespielt hat). Gezählt wird
aus den Referenzen, in denen die Person über ihr Vereinsprofil steht; nach „Saison abschließen“ werden die Spieler gleich neu
ausgewertet, sonst spätestens in der nächtlichen Auswertung.

### 3.7 Saisonabschluss und Saison-MVP

Ist die Saison vorbei, klickt ihr auf der Karte der aktiven Saison **Abschließen** (Jahreswertung). Ein Fenster zeigt vorab die Rangliste und
je Platz die Erfolge, die vergeben werden; erst **Endgültig abschließen** führt es aus (im Protokoll). Über den Status im Bearbeiten-Fenster
geht das nicht. Dabei geschieht einmalig:

- die **Rangliste wird festgeschrieben**,
- jede platzierte Person bekommt XP („Saison abgeschlossen“),
- die Saison-Erfolge werden vergeben (zum Beispiel **Saisonspitze**, **Saisonmeister**, **Volle Saison**, **Aufsteiger**; ein täglicher Schnappschuss
  hält den Verlauf fest).

Im Reiter **Saison** (Erfolge) wählt ihr die Saison und seht vorab eine **Vorschau**: je Platz, was die Person beim Abschluss bekommt. Läuft die Saison noch,
steht dort „wenn die Saison jetzt endet“ und der Knopf **Zur Jahreswertung**. Ist sie abgeschlossen, kann **Abschluss vergeben** den
Abschluss **nachholen**: Die Rangliste wird neu geschrieben und es wird vergeben, was fehlt – doppelt wird nichts.

**Saison-MVP:** In der Tabelle eine Person wählen und **Als Saison-MVP auszeichnen**. Das ist ein Erfolg von Hand; wer ihn schon hat, trägt eine Krone
in der Zeile.

### 3.8 Negativ, Vorschau, Statistik

**Negativ & Vorfälle:** Fun-Erfolge für kleine Missgeschicke, bis zur Freischaltung geheim, danach im Profil sichtbar. Von Hand eingetragene stehen außerdem unter **Strafen** bzw. **Meine Strafen**; dort liest die Person die Notiz, die du beim Eintragen schreibst. Notizen aus der Einzel- und Massenvergabe bleiben intern; was von selbst kommt (Dispute geöffnet, spät eingecheckt), ist keine Strafe. **Vorfall
eintragen**: Person, Vorfall aus der Liste, optional eine Notiz. Darunter steht, wer welchen Fun-Erfolg hat; **Entfernen** verlangt einen Grund.

**Vorschau:** Jede **Zeremonie** aus Material, Kategorie (Bewegung) und Sonderablauf (einzelner Erfolg, mehrere, Diamant, Legendär, Level-Aufstieg …)
abspielen, mit Klang an/aus und „Weniger Bewegung“; dazu die **Galerie** aller Motive in jedem Material, Größen, Rang-Kerben und Silhouette.
Es wird nichts vergeben.

**Statistik:** **Freischaltungen je Woche** (letzte zwölf Wochen, ohne Fun-Erfolge), **Die Besten** (Erfolgspunkte, nur öffentliche Profile)
und **Seltenheit je Stufe** (Anteil an allen Personen, bei Vereinsstufen an den Mitgliedern).

### 3.9 Jahresrückblick „Dein Jahr bei LION“

Zum Jahresende können alle, die im Jahr aktiv waren, einen **Rückblick zum Durchtippen** ansehen (Website unter `/dein-jahr`, und in der App):
gespielte Turniere, Siege und Podestplätze, Spiele, besuchte Events, die beste Fast-Lap-Zeit, das Lieblingsspiel, neue Erfolge und der Platz
in der Jahreswertung; am Ende ein **Bild zum Teilen**. Wer im Jahr weder gespielt noch ein Event besucht noch eine Fast Lap gefahren hat,
bekommt weder einen Rückblick noch eine Meldung. Den Rückblick sieht **nur die Person selbst**.

**Zeitraum einstellen:** Admin → Content → Erfolge → Reiter **Jahresrückblick**. Ihr tragt **Start (Tag.Monat)** und **Ende (Tag.Monat)** ein und
klickt **Speichern**. Ab Werk **15.12.** bis **31.1.**. Der Start liegt zwischen **Oktober und Dezember**, das Ende zwischen **Jänner und März**;
sonst kommt eine Fehlermeldung. Bis zum Ende zeigt der Rückblick das Jahr, in dem er gestartet ist.

Oben im Reiter steht der Stand: „Läuft gerade“ oder „Nächster Rückblick“ mit dem Zeitraum und, wie viele Personen die Meldung **„Dein Jahr ist da“** schon
bekommen haben. Die Meldung geht **am Starttag einmal** an alle mit Aktivität (Thema **Erfolge**, nicht per Mail).

**Vorschau mit deinen Zahlen** zeigt euch euren eigenen Rückblick schon vor dem Start.

### 3.10 Neuberechnung

Wenn Erfolge korrigiert werden (etwa wie Turnier-, Spiel- oder Chat-Erfolge gezählt werden), stehen vielen Personen auf einen
Schlag Erfolge zu, die sie längst verdient haben – zum Beispiel **Finalist** für ein Turnier aus dem Vorjahr. Damit dann nicht für
jede Stufe eine eigene Meldung kommt, gibt es den **stillen Modus**. Er schaltet sich mit dem Update von selbst ein.

**Solange der stille Modus an ist:**

- Was die regelmäßigen Läufe nachvergeben (alle 15 Minuten, nachts, **Alle jetzt auswerten**), wird ganz normal gespeichert –
  Stufe, Punkte, XP, Level. Es gibt aber **keine** Meldung im Postfach, keine Push, keine Discord-Nachricht, kein „Level erreicht“.
  Diese Stufen erscheinen auch nicht im Laufband, nicht als Erfolg der Woche und nicht im Wochenrückblick.
- Gleich nach dem Update werden **alle Konten** einmal still komplett ausgewertet (über die Warteschlange, je nach Größe in
  einer Viertel- bis halben Stunde). Was ihnen schon zustand, haben sie danach – still.
- Was jemand danach **gerade selbst** erreicht (Ergebnis gemeldet, eingecheckt, Chat-Nachricht, Konto verknüpft …), wird wie
  immer gemeldet. Schaltet so ein Ereignis nebenbei etwas aus einem anderen Bereich frei, kommt das still dazu.
- Ist eine Person noch nicht still ausgewertet, bleibt auch ihr eigenes Ereignis still – sonst könnte ein Check-in die alte
  Finalist-Stufe laut melden. Diese Stufe zählt dann in der Sammel-Nachricht am Ende mit.
- **Kronenwechsel werden erst beim Abschluss gemeldet.** Bis dahin bleibt der gespeicherte Stand der Kronen, wie er war; der
  Abschluss rechnet sie einmal neu, und nur wer danach wirklich eine Krone gewonnen, gewechselt oder verloren hat, erfährt es.

**So schließt du die Neuberechnung ab** (Admin → Content → Erfolge → **Übersicht**, Tafel **Neuberechnung**, nur Superadmin mit
Zwei-Faktor-Anmeldung):

1. Warten, bis **alle** Korrekturen an den Erfolgen veröffentlicht sind. Was danach erst korrigiert wird, käme wieder einzeln.
2. Den Umfang ansehen: **Schon still vergeben** zeigt, wie viele Stufen an wie viele Personen bisher still nachgekommen sind,
   mit einer Tabelle je Stufe. **Probelauf** rechnet dazu aus, was **noch fehlt** – also was der Abschluss noch nachvergeben würde –
   und vergibt dabei nichts. Nach ein paar Minuten steht da „… Personen bekämen … Stufen neu dazu“ mit einer Tabelle **Stufe**,
   **Gruppe**, **Personen**. Kurz nach dem Update ist das noch viel; ist die stille Auswertung aller Konten durch, meist wenig.
   Stufen wie **Sammler**, die erst durch andere Erfolge entstehen, zählt der Probelauf nicht mit – es werden eher mehr.
3. **Neuberechnung abschließen** klicken und die Rückfrage mit **Abschließen** bestätigen. Der Lauf ergänzt zuerst an alten Pokalen
   nur, wer im Finale stand – Platz, Saison und alles andere daran bleibt, wie es ist, gelöscht wird nichts (anders als
   **Pokale nachtragen**). Dann wertet er alle Konten still aus, beendet den stillen Modus und schickt danach jeder Person mit nachgerechneten Erfolgen **eine** Nachricht: „Wir haben die Erfolge
   neu berechnet – du hast X neue.“ Sie kommt ins Postfach und als Push, nicht über Discord, und führt zu den eigenen Erfolgen.
4. Die Tafel zeigt den Fortschritt. Am Ende steht „Abgeschlossen am … · N Sammel-Nachrichten“ und „Stiller Modus: Aus“. Ab jetzt
   wird jeder Erfolg wieder einzeln gemeldet.

**Was die Person sieht:** Beim nächsten Besuch der Webseite nach dem Abschluss kommt **eine** Zeremonie „Du hast X Erfolge
nachträglich bekommen“ mit allen nachgerechneten Abzeichen (bis zu zwölf, der Rest als „+ n“) und dem Knopf **Alle ansehen**.
Einzeln gefeiert werden nachgerechnete Erfolge nicht, auch nicht während des stillen Modus. Danach gelten sie als gesehen; die
Zeremonie kommt je Gerät einmal. Ansehen könnt ihr sie vorher unter Reiter **Vorschau** → Sonderablauf **Nachträglich bekommen**.

Der Abschluss ist **gefahrlos wiederholbar**: Ein zweiter Klick nach dem Ende tut nichts, und niemand bekommt die Nachricht zweimal.
Bricht der Lauf ab (etwa durch ein Update), steht bei **Abschluss** „Unterbrochen“ – ein neuer Klick macht dort weiter. Probelauf und
Abschluss stehen im Protokoll unter **Vergeben**. Am Server geht beides auch per Kommando:
`python -m scripts.achievements_recount --probelauf` bzw. `--abschliessen` (im Backend-Container, ohne Schalter zeigt es den Stand).

**Nach einer Katalog-Änderung während des stillen Modus aufrufen:** `python -m scripts.achievements_recount --neu-pruefen`. Dann
gelten alle Konten wieder als nicht nachgerechnet und werden still neu ausgewertet; bis dahin meldet auch ein eigenes Ereignis
nichts laut – sonst kämen neue Stufen für alte Ansprüche einzeln.

---

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| Ein Erfolg kommt nicht | Die Warteschlange läuft alle 30 Sekunden; die Stufe ist **von Hand** oder **nur Mitglieder**; die Person ist kein aktives Mitglied | Übersicht → **Alle jetzt auswerten**; Bedingung im Katalog prüfen |
| „Champion“ oder „Podest“ kommt nicht, obwohl das Finale gespielt ist | Plätze zählen erst, wenn das Turnier beendet ist | Turnier auf **Beendet** setzen bzw. Ergebnisse veröffentlichen ([Turniere](turniere.md)) |
| Ein Teammitglied bekommt einen Team-Erfolg nicht | Es steht nicht in der Aufstellung bzw. Teilnehmerliste des Spiels | Aufstellung prüfen; ohne Aufstellung zählen alle, die damals im Team waren (3.1) |
| Katalog zeigt „geplant“ bei einer Stufe | Die Automatik für diesen Zähler ist noch nicht angeschlossen | Stufe von Hand vergeben |
| „… dürfen nur der Vorstand oder die Systemverwaltung“ | Massenvergabe, Import, XP-Korrektur und Prestige-Reset sind dafür vorbehalten | Vorstand oder System fragen |
| Vergabe: „Diese Stufe ist nur für aktive Vereinsmitglieder“ | Die Person ist kein aktives Mitglied oder Ehrenmitglied | Mitgliedschaft klären ([Verein](verein.md)) |
| Massenvergabe: „nicht gefunden“ | Benutzername oder E-Mail stimmen nicht | Schreibweise prüfen, Liste anpassen |
| Rücknahme geht nicht | Es fehlt der Grund (mindestens drei Zeichen) | Grund eintragen |
| Katalog-Import schreibt nichts | Die Prüfung meldet Fehler | Fehlerliste lesen, Datei korrigieren |
| Gruppe lässt sich nicht löschen | Nur eigene Gruppen („Eigen“) können gelöscht werden | Stattdessen **Intern** schalten |
| Keine Jahrespunkte für ein Turnier | Es gibt keine Saison mit Status **Aktiv**; das Gewicht steht auf ×0,00; Ergebnisse noch nicht veröffentlicht | Saison auf **Aktiv** setzen, Gewicht prüfen, Ergebnisse veröffentlichen |
| Neue Saison hat keine Punkte | Sie steht noch auf **Entwurf** | Status in **Bearbeiten** auf **Aktiv** stellen |
| Rangliste der Saison bleibt leer | Noch keine Punkte-Einträge, die Ersatz-Rangliste nutzt nur die Quellen | Quellen prüfen oder abwarten, bis Ergebnisse veröffentlicht sind |
| Saison-Erfolge fehlen nach dem Abschluss | Die Saison war nicht „Abgeschlossen“, oder die Erfolge sind schon vergeben | Reiter **Saison** → **Abschluss vergeben** (holt Fehlendes nach) |
| Jahresrückblick: „Der Start liegt zwischen Oktober und Dezember …“ | Datum außerhalb des erlaubten Zeitraums | Start in Okt–Dez, Ende in Jän–Mär, als Tag.Monat |
| Jemand sieht keinen Jahresrückblick | Die Person war im Jahr nicht aktiv, oder der Zeitraum läuft nicht | Zeitraum prüfen; **Vorschau** zeigt den eigenen |
| Das Abzeichen zeigt nur ein Fragezeichen | Die Gruppe ist **versteckt** oder Fun-Erfolg | Gewollt bis zur Freischaltung |
| Level springt nach einer Korrektur | XP-Korrektur oder Prestige-Reset | Protokoll unter **Vergeben** ansehen |
| Jemand hat neue Erfolge, aber keine Meldung bekommen | Der stille Modus der **Neuberechnung** ist an (3.10) | Gewollt; die Sammel-Nachricht kommt mit **Neuberechnung abschließen** |
| Keine Tafel **Neuberechnung** in der Übersicht | Nur der Superadmin sieht sie | Superadmin fragen |

---

## 5. Häufige Fragen

**Wie lege ich einen eigenen Erfolg an, den ich nur von Hand vergebe?**
Katalog → **Neue Gruppe** → in der Gruppe **Neue Stufe** mit **Von Hand vergeben**. Dann unter **Vergeben** an die Person.

**Wie viele Personen kann ich auf einmal auszeichnen?**
Bis zu 500, nur Vorstand und Systemverwaltung, nach Vorschau.

**Kann ich eine Vergabe still machen?**
Ja: **Ohne Zeremonie** und auf Wunsch ohne Benachrichtigung.

**Kann ich rückwirkend vergeben?**
Ja, mit dem Datumsfeld bei der Vergabe.

**Werden Erfolge per Mail gemeldet?**
Nein, nur In-App, Push und Discord. Eine Mail gibt es nur im Wochenrückblick.

**Warum kam für nachgerechnete Erfolge keine Meldung?**
Während der Neuberechnung kommen sie still; zum Schluss gibt es eine Sammel-Nachricht je Person (3.10).

**Wie viel XP braucht Level 60?**
Rund 683.000 XP; Prestige macht den Weg danach je Stern um ein Viertel länger.

**Können Mitglieder mehr XP bekommen?**
Ja, aktive Mitglieder bekommen 10 Prozent Bonus.

**Zählen Achievements für die Jahreswertung?**
Nein. Sie sind eigene Profilpunkte. Die Jahreswertung kommt aus Turnier-, Fast-Lap- und Event-Ergebnissen.

**Kann ich eine Saison löschen?**
Ja, mit Rückfrage; besser ist **Archiv**.

**Wie ändere ich, wie viele Punkte ein Turnier bringt?**
Beim Turnier im Kasten **Jahreswertung** das Gewicht; siehe [Turniere](turniere.md).

**Kann ich den Rückblick auf einen anderen Zeitraum legen?**
Ja, im Reiter **Jahresrückblick**: Start zwischen Oktober und Dezember, Ende zwischen Jänner und März.

**Was ist noch nicht da?**
Der ausgebaute Aufstiegs-Moment beim Level-Aufstieg ist geplant (#1502).
