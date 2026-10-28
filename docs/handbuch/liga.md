# Liga leiten – Handbuch

Für die **Turnierleitung** (und den Obmann der Liga): eine Liga über Wochen aufsetzen, starten und durch die Season
bringen – am Beispiel der CoD-Liga, Season 1 (Start Di 10.11.2026). Ohne Vorwissen lesbar; was technisch dahinter
steckt, steht in [LIGA.md](../LIGA.md). Für die Captains der Co-Teams gibt es einen eigenen
[Spickzettel](liga-captains.md), zum Abhaken vor dem Start die [Checkliste für den Obmann](#6-checkliste-für-den-obmann-bis-911).

**Wo im Admin:**

- **Admin → eSports → Spiele → Spiel bearbeiten** – die **Modi** des Spiels (etwa Stellung, Suchen & Zerstören)
- **Admin → eSports → Spiele → Maps** (Karten-Symbol in der Zeile des Spiels) – Map-Bibliothek mit Bildern und Modi
- **Admin → eSports → Liga** (`/admin/leagues`) – Liga, Season, Liga 1, 2 …, Staffel A, B …
- **Turnierverwaltung der Staffel** (`/admin/tournaments/<Staffel>`, aus der Season über **Turnierverwaltung · Co-Teams
  zuteilen**) – Co-Teams zuteilen, starten, Spiele, Ergebnisse
- **Ligaseite** (`/liga/<liga>/<season>`, etwa `/liga/call-of-duty/season-1`) – was Mitglieder und Gäste sehen

Wer was darf: Liga, Season, Liga N, Staffel, Zuteilen, Start und Korrekturen macht nur die **Turnierleitung mit
bestätigter Zwei-Faktor-Anmeldung**. Co-Teams, Captain und Vertreter pflegt die **Teamleitung** (Leitung oder
Co-Leitung des Hauptteams) im Profil. Termine, Melden, Bestätigen und Einspruch machen **Captain und Vertreter** des
Co-Teams – hat ein Co-Team keinen von beiden, die Teamleitung.

---

## Inhalt

1. [Überblick: wie eine Liga aufgebaut ist](#1-überblick-wie-eine-liga-aufgebaut-ist)
2. [Einrichten Schritt für Schritt](#2-einrichten-schritt-für-schritt)
3. [Während der Season](#3-während-der-season)
4. [Wenn etwas nicht klappt](#4-wenn-etwas-nicht-klappt)
5. [Häufige Fragen](#5-häufige-fragen)
6. [Checkliste für den Obmann bis 9.11.](#6-checkliste-für-den-obmann-bis-911)

---

## 1. Überblick: wie eine Liga aufgebaut ist

| Ebene | Beispiel | Was dort festgelegt wird |
| --- | --- | --- |
| **Liga** (je Spiel) | CoD-Liga | Name, Spiel, Adresse `/liga/call-of-duty` |
| **Season** | Season 1 | alle Vorgaben: Kalender, Sperrzeiten, Best of, Teamgröße, Punkte, Fristen, Map-Pool, Regeltext, Sichtbarkeit |
| **Liga N** | Liga 1 | Stufe der Liga; darf Best of, Teamgröße, Mindestkader, Staffelgröße und Punkte abweichend festlegen |
| **Staffel** | Staffel A | ein gewöhnliches Turnier im Format Liga mit den Werten der Season – Spiele, Termine, Ergebnisse, Tabelle |
| **Co-Team** | Nebelwölfe · Rudel | Teilnehmer der Staffel: ein Kader eines Hauptteams mit Captain und Vertreter |

So läuft eine Spielwoche: Die Woche geht von **Dienstag bis Montag**. Die Captains vereinbaren einen Termin – ohne
Einigung gilt der **Standardtermin** (Season 1: Sonntag 20:00). Nach dem Spiel meldet eine Seite das Ergebnis **im
Web** mit Maps und eigener Aufstellung, die andere bestätigt. Antwortet sie nicht, gilt die Meldung nach **48 Stunden**
(spätestens am Ende der Spielwoche, mindestens 24 Stunden Zeit). Die Tabelle rechnet **3 Punkte für einen Sieg,
1 für ein Remis, 0 für eine Niederlage**; bei Gleichstand entscheiden Differenz und mehr gewonnene Maps.

Season 1 im Kalender (10 Wochen, nur Hinrunde, acht Teams = sieben Spieltage):

| Woche | Tage | Spieltag |
| --- | --- | --- |
| 1–6 | 10.11.–21.12.2026 | Spieltag 1 bis 6 |
| 7–8 | 22.12.2026–4.1.2027 | **Weihnachtspause** – keine Spiele, keine Fristen |
| 9 | 5.1.–11.1.2027 | Spieltag 7 |
| 10 | 12.1.–18.1.2027 | Reserve für Nachholspiele |

Gesperrt ist eine Woche, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt. Die Sperrzeit selbst gilt
trotzdem tageweise: Am Montag 21.12. (letzter Tag von Woche 6) lässt sich kein Termin vorschlagen.

Staffeln zählen nicht für Jahreswertung, Turnier-Pokale, Löwen-Rang-XP für Teilnahme und Podest und die Team-Stufe;
gespielte und gewonnene Spiele zählen weiter. Startseite, öffentlicher Kalender und Turnierliste zeigen sie nicht –
dafür gibt es die Ligaseite und den Menüpunkt **Liga**.

---

## 2. Einrichten Schritt für Schritt

### 2.1 Modi und Maps in der Bibliothek

1. **Admin → eSports → Spiele → Spiel bearbeiten**, Abschnitt **Für Turniere → Modi und Dauer**: je Modus eine Zeile,
   etwa **Stellung**, **Suchen & Zerstören**, **Kontrolle**. Minuten braucht ein Modus nur für Maps nicht.
2. **Admin → eSports → Spiele → Maps** → **Map hinzufügen**: Name, **Bild** im Format 16 : 9 (nur eigene Uploads),
   und die **Modi**, in denen die Map gespielt wird. Details: [Turniere, 3.14](turniere.md#314-maps-und-map-pools).

### 2.2 Liga und Season anlegen

1. **Admin → eSports → Liga → Liga anlegen**: Name (etwa „CoD-Liga“) und Spiel.
2. In der Liga **Season anlegen**: nur der **Beginn der ersten Spielwoche** (00:00 Uhr Wiener Zeit, Season 1:
   10.11.2026). Die übrigen Vorgaben kommen als Startwerte mit.
3. Die Season öffnen und die Vorgaben prüfen, dann **Season speichern**:

| Abschnitt | Feld | Season 1 |
| --- | --- | --- |
| Kalender | **Wochen gesamt** (mit Sperrwochen) | 10 |
| | **Spielwoche (Tage)**, **Standardtag**, **Standardzeit** | 7 · Sonntag · 20:00 |
| | **Runden** | Nur Hinrunde |
| | **Meldeschluss** (nur zur Anzeige) | 6.11.2026 |
| | **Sperrzeiten** (Von, Bis, Bezeichnung) | 21.12.2026–3.1.2027 „Weihnachtspause“ |
| Spiel und Wertung | **Best of** | Best of 3 |
| | **Teamgröße (je Map)** · **Mindestkader** | 4 · 4 |
| | **Teams je Staffel höchstens** | 8 |
| | **Modus je Map** (Map 1, 2, 3 – „frei“ heißt: die Teams wählen) | nach Regelwerk |
| | **Punkte Sieg / Remis / Niederlage**, **Bei Punktgleichheit** | 3 / 1 / 0 · Differenz, Mehr gewonnene Maps |
| | **Ergebnis gilt nach (Stunden)** · **Aufstellung nachtragen bis (Stunden)** | 48 · 48 |
| Regeltext und Sichtbarkeit | **Regeltext** (Markdown) | Regelwerk der Liga |
| | **Sichtbarkeit** | bis zum Start *Nur Turnierleitung* (siehe 2.8) |

Unter dem Kalender steht nach dem Speichern, welche Wochen gesperrt sind und **wie viele Teams eine Staffel höchstens
fassen kann** (Season 1: 8 Spielwochen – höchstens 8 Teams mit nur Hinrunde).

4. **Map-Pool der Season**: je Modus die Maps anhaken und sortieren, **Speichern**. Ohne Pool kann niemand mit Maps
   melden. Jede neue Staffel bekommt eine Kopie.

### 2.3 Liga 1 und Staffel anlegen

1. Auf der Season-Seite unter **Ligen und Staffeln** → **Liga 1 anlegen**. Beiname freiwillig; leere Felder heißen
   „wie die Season“. Liga 2, 3 … entstehen genauso und dürfen eigene Werte haben.
2. In der Zeile von Liga 1 → **Staffel anlegen** → bestätigen. Es entsteht das Turnier „CoD-Liga Season 1 · Liga 1 ·
   Staffel A“ als **Entwurf** – ohne offene Anmeldung, ohne Discord, ohne Jahreswertung. Mehr als acht Teams? Eine
   zweite Staffel (B) anlegen und die Teams verteilen; zwei Co-Teams desselben Hauptteams spielen nie in derselben
   Staffel.

### 2.4 Co-Teams vorbereiten (Teamleitung)

Das macht die Leitung des Hauptteams, nicht die Turnierleitung: **Profil → Teams** → Team wählen → **Squad** →
Name, **Lineup / Mitspieler** (mindestens so viele wie der Mindestkader, Season 1: 4), **Captain** und **Vertreter**
(beide aus dem Kader, verschieden) → speichern. Captain und Vertreter vereinbaren Termine, melden und bestätigen
Ergebnisse. Alle im Kader brauchen ein Konto und müssen Mitglied des Hauptteams sein.

### 2.5 Co-Teams zuteilen

1. Season-Seite → bei der Staffel **Turnierverwaltung · Co-Teams zuteilen** → Reiter **Teilnehmer**.
2. **Co-Team zuteilen** → Schritt 1: das **Hauptteam** wählen → Schritt 2: das **Co-Team** → **Zuteilen**.
3. Co-Teams, die nicht passen, stehen grau mit dem Grund da (Kader zu klein, Team schon in der Staffel, Staffel voll …).

Die Captains und Vertreter bekommen eine Benachrichtigung. **Entfernen** in der Teilnehmerliste geht nur bis zum
Start. Bis dahin ist der Spielplan eine Vorschau und wird bei jeder Änderung neu gemischt.

### 2.6 Spielplan und Start

Oben in der Turnierverwaltung der Staffel: **Liga starten**. Damit wird der Spielplan fest (Season 1 mit acht Teams:
sieben Spieltage zu je vier Spielen, Heimrecht ausgeglichen, Spieltag 7 nach der Weihnachtspause in Woche 9) und die
Staffel steht auf **Live**. Ab jetzt können die Captains Termine vorschlagen und melden.

- Kein **Check-in** – die Co-Teams sind zugeteilt, niemand checkt ein. Wurde trotzdem ein Check-in gestartet, im
  Feld **Status** zurück auf **Entwurf** und dann **Liga starten**.
- Den Spielplan vor dem Start ansehen: Reiter **Turnierbaum** bzw. **Matchplan** (Vorschau).

### 2.7 Vorgaben später ändern und übertragen

Eine Staffel trägt die Werte, die beim Anlegen galten. Ändert ihr danach etwas an der Season, steht oben „Die
bestehende Staffel trägt noch die alten Werte“ – **Jetzt übertragen** bzw. unten **Vorgaben übertragen**. Was nicht
mehr geht, steht je Staffel mit Grund da:

| Was | Wird übertragen |
| --- | --- |
| Regeltext, Map-Pool | immer (ein entfernter Pool verschwindet nur vor dem ersten Ergebnis; Spiele mit festgehaltenem Pool behalten ihn) |
| Termine und Kalender (Beginn, Wochen, Sperrzeiten, Standardtermin, Runden, Staffelgröße) | nur vor dem Start |
| Best of, Teamgröße, Mindestkader, Punkte, Modus je Map, Fristen | nur vor dem ersten Ergebnis |
| Sichtbarkeit | sofort beim Speichern, ohne Übertragen |

### 2.8 Sichtbarkeit

| Einstellung | Ligaseite und Menüpunkt „Liga“ | Staffel-Turnier |
| --- | --- | --- |
| **Aus** | niemand („Liga nicht gefunden“) | intern |
| **Nur Turnierleitung** | nur ihr – zum Prüfen vor dem Start | intern |
| **Nur Mitglieder** | angemeldete Mitglieder | Nur Mitglieder |
| **Öffentlich** | alle | öffentlich |

Die Sichtbarkeit gilt beim **Season speichern** sofort für alle Staffeln. Wer in einer Staffel spielt, sieht seine
Spiele, Termine und den Matchchat immer – auch bei *Aus*.

---

## 3. Während der Season

### 3.1 Termine

Captain oder Vertreter schlagen auf der Matchseite unter **Terminabstimmung** einen Termin vor, die Gegenseite nimmt
an (Haken), lehnt ab (X) oder macht einen **Gegenvorschlag**. Ohne Einigung gilt der Standardtermin der Spielwoche.
Ein Vorschlag in einer Sperrzeit wird abgelehnt („In dieser Zeit wird nicht gespielt (Weihnachtspause, …)“); in einer
Sperrzeit läuft auch keine Antwortfrist weiter.

### 3.2 Ergebnisse

Melden mit Maps und eigener Aufstellung (nur im Web), Bestätigen im Web oder in der App, die 48-Stunden-Regel und
was dabei geprüft wird, steht für die Captains in
[Turniere, 3.16](turniere.md#316-liga-ergebnis-je-map-melden-für-captains) – zum Weitergeben gibt es den
[Spickzettel](liga-captains.md). Für die Turnierleitung dazu:

- **Selbst eintragen**: Reiter **Spiele** → **Ergebnis eintragen** – Stand, auf Wunsch Maps mit den Aufstellungen
  beider Seiten; eine fehlende Seite trägt ihre Aufstellung danach selbst nach. Siehe
  [Turniere, 3.6](turniere.md#36-ergebnisse-melden-eintragen-korrigieren).
- **Kampflos**: im Ergebnis-Fenster **Nicht erschienen** auf der fehlenden Seite.

### 3.3 Aufstellung nachtragen

Captain oder Vertreter tragen eine fehlende Aufstellung bis **48 Stunden nach dem Ergebnis** selbst nach (3.16).
Danach nur noch die Turnierleitung: am Spiel **Ergebnis korrigieren** mit Maps und Aufstellungen und einem Grund. Für
die Tabelle spielt die Aufstellung keine Rolle; sie zählt für den Doppel-Einsatz und spätere Statistiken.

### 3.4 Einspruch und Korrektur

- **Einspruch**: Stimmen Maps oder Sieger nicht, tippt die Gegenseite **Stimmt nicht** bzw. **Problem melden** →
  **Falsches Ergebnis** mit kurzem Text. Möglich vor dem Ergebnis immer, danach 30 Minuten; hat die
  48-Stunden-Automatik entschieden, bis zum Ende der Spielwoche. Später nur über die Turnierleitung (Matchchat mit
  **@leitung**).
- **Entscheiden**: Turnierleitung am Handy → **Braucht Aufmerksamkeit**, oder auf der Matchseite **Streitfall
  entscheiden**: **Ergebnis bleibt** oder **Ergebnis ändern**.
- **Korrigieren**: am Spiel **Ergebnis korrigieren** – Stand, auf Wunsch Maps und Aufstellungen, Pflicht ist ein
  **Grund** (mindestens fünf Zeichen). Die Korrektur schließt einen offenen Einspruch, die Tabelle rechnet sofort neu.
  Ohne neue Maps bleiben die alten, solange sie zum Stand passen – sonst fallen sie weg. Ablauf wie in
  [Turniere, 3.7](turniere.md#37-dispute-streit-um-ein-ergebnis).

### 3.5 Tabelle und Ligaseite

Die Tabelle steht auf der Ligaseite je Staffel (und in der Turnierverwaltung): Punkte, Spiele, Differenz, Form der
letzten fünf Spiele, Bewegung seit dem letzten Spieltag. Darunter die Spielwochen mit Pause und Reserve, jedes Spiel
mit Termin, Ergebnis, Sieger und den Maps – ohne Aufstellungen.

---

## 4. Wenn etwas nicht klappt

| Meldung / Fehlerbild | Bedeutung | Was tun |
| --- | --- | --- |
| „Mit bis zu 9 Teams (nur Hinrunde) braucht die Staffel 9 Spielwochen, die Season hat aber nur 8 aktive Wochen …“ | Die Staffel ist zu groß für die Spielwochen | **Teams je Staffel höchstens** senken und eine zweite Staffel anlegen – oder mehr Wochen |
| „Staffel A gibt es in dieser Liga schon.“ | Buchstabe vergeben | **Staffel anlegen** nimmt von selbst den nächsten freien |
| „… hat 3 Spieler im Kader – die Liga verlangt mindestens 4.“ | Kader zu klein | Teamleitung ergänzt den Kader im Profil |
| „… hat schon ein Co-Team in dieser Staffel – zwei Co-Teams desselben Teams spielen nie in derselben Staffel.“ | Gewollt | Zweites Co-Team in eine andere Staffel |
| „… spielt in dieser Season schon in einer anderen Staffel.“ | Ein Co-Team spielt je Season nur eine Staffel | Andere Staffel wählen oder dort entfernen |
| „Die Staffel ist voll (8 von 8 Plätzen).“ | Staffelgröße erreicht | Zweite Staffel |
| „1 Person im Kader von … ist nicht mehr im Team – bitte erst den Kader bereinigen.“ | Jemand hat das Hauptteam verlassen | Teamleitung passt den Kader an |
| „… ist für ein anderes Spiel eingetragen als diese Staffel.“ / „… ist archiviert …“ | Falsches oder altes Co-Team | Co-Team im Profil prüfen |
| „Captain muss im Kader des Co-Teams stehen.“ / „Captain und Vertreter müssen verschiedene Personen sein.“ | Rollen falsch vergeben | Rollen im Profil neu wählen |
| Co-Team lässt sich nicht entfernen („… Spielplan …“) | Die Staffel ist gestartet | Mit dem Co-Team klären; Spiele notfalls kampflos werten |
| „Turnier kann ohne spielbares Match nicht gestartet werden.“ | Check-in gestartet statt **Liga starten** | **Status** auf **Entwurf**, dann **Liga starten** |
| Ligaseite zeigt „Liga nicht gefunden“ | Sichtbarkeit *Aus* oder *Nur Turnierleitung* | Sichtbarkeit der Season ändern und speichern |
| „Bitte im Web mit Maps und Aufstellung melden.“ | Erstmeldung oder abweichende Meldung aus der App | Im Web auf der Matchseite melden |
| „In dieser Zeit wird nicht gespielt (Weihnachtspause, 21.12.2026 bis 3.1.2027) …“ | Termin in einer Sperrzeit | Anderen Termin vorschlagen |
| „Deine Maps, Modi oder Sieger weichen von der Meldung der Gegenseite ab …“ | Bestätigung passt nicht | Einspruch über **Problem melden**; die Turnierleitung entscheidet |
| „Map 2: diese Map ist im Pool nicht freigegeben.“ / „… gespielt wird hier Suchen & Zerstören.“ | Map oder Modus passt nicht zu Pool oder Reihenfolge | Richtige Map bzw. Modus wählen; fehlt eine Map im Pool, Pool der Season ändern und übertragen |
| „Nach Map 2 stand der Sieger schon fest – keine weitere Map.“ / „Best of 3: eine Seite braucht 2 gewonnene Maps …“ | Serie passt nicht zum Best of | Maps korrigieren |
| „… die Aufstellung von … braucht genau 4 Spieler.“ / „… nur Spieler aus dem Kader …“ | Aufstellung falsch | Genau die Teamgröße aus dem eigenen Kader wählen |
| „… steht an diesem Spieltag schon in der Aufstellung eines anderen Teams …“ | Doppel-Einsatz | Andere Person aufstellen |
| „Die Frist zum Nachtragen ist vorbei …“ | 48 Stunden nach dem Ergebnis vorbei | Turnierleitung trägt mit Grund nach |
| „Ein Dispute ist nur bis 30 Minuten nach dem Ergebnis möglich …“ | Einspruchsfrist vorbei | Matchchat mit **@leitung**; die Turnierleitung korrigiert |
| „Bitte kurz den Grund der Korrektur angeben“ | Korrektur ohne Grund | Grund mit mindestens fünf Zeichen |
| Season gespeichert, die Staffel zeigt noch alte Werte | Noch nicht übertragen | **Vorgaben übertragen** (Grenzen siehe 2.7) |

---

## 5. Häufige Fragen

**Muss die Staffel voll sein?**
Nein. Mit sechs Teams gibt es fünf Spieltage, die übrigen Wochen sind Reserve. Bei ungerader Zahl hat je Spieltag ein
Team spielfrei.

**Kann ein Spieler in zwei Co-Teams stehen?**
Im Kader ja, aber nicht am selben Spieltag in zwei Aufstellungen derselben Season.

**Was, wenn ein Team nicht antritt?**
Die Turnierleitung wertet das Spiel kampflos (Ergebnis-Fenster → **Nicht erschienen** auf der fehlenden Seite).

**Zählt die Aufstellung für die Tabelle?**
Nein, nur das Ergebnis. Die Aufstellung ist für Doppel-Einsatz und spätere Statistik da.

**Wie sieht ein Captain, was zu tun ist?**
Über die Benachrichtigungen und den [Spickzettel für Captains](liga-captains.md).

---

## 6. Checkliste für den Obmann bis 9.11.

Zum Abhaken in dieser Reihenfolge – jeder Punkt mit dem Klickweg von oben.

- [ ] **Modi** des Spiels angelegt (Stellung, Suchen & Zerstören, Kontrolle) – 2.1
- [ ] **Maps** in der Bibliothek, je mit **Bild** und den richtigen **Modi** – 2.1
- [ ] **Season 1**: Beginn 10.11.2026, 10 Wochen, **Weihnachtspause** 21.12.–3.1., nur Hinrunde, Meldeschluss 6.11. – 2.2
- [ ] **Best of 3**, **Teamgröße 4**, Mindestkader, **Modus je Map** laut Regelwerk, Punkte 3/1/0 – 2.2
- [ ] **Regeltext** eingetragen – 2.2
- [ ] **Map-Pool der Season** gespeichert – 2.2
- [ ] **Liga 1** und **Staffel A** angelegt (bei mehr als acht Teams auch Staffel B) – 2.3
- [ ] Alle **Co-Teams** angelegt, jeder im Kader hat ein **Konto** und ist im Hauptteam – 2.4
- [ ] Je Co-Team **Captain** und **Vertreter** vergeben – 2.4
- [ ] Alle Co-Teams **zugeteilt** (Teilnehmer: 8 von 8) – 2.5
- [ ] Season gespeichert und, falls nach dem Anlegen der Staffel etwas geändert wurde, **Vorgaben übertragen** – 2.7
- [ ] Ligaseite mit *Nur Turnierleitung* geprüft: Teams, Wochen mit Weihnachtspause, Pool, Regeln – 2.8
- [ ] **Liga starten** (Spielplan fest, sieben Spieltage) – 2.6
- [ ] **Am 10.11.:** Sichtbarkeit auf **Öffentlich**, **Season speichern** – 2.8
- [ ] **Discord-Ankündigung von Hand** (die Liga meldet sich noch nicht selbst): Link zur Ligaseite, Start, Ablauf,
      [Spickzettel für Captains](liga-captains.md)
