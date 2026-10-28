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
| **Liga N** | Liga 1 | Stufe der Liga; darf Best of, Teamgröße, Mindestkader, Staffelgröße, Punkte und Antwortfrist abweichend festlegen |
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
| 7–8 | 22.12.2026–4.1.2027 | **Weihnachtspause** – keine Spiele |
| 9 | 5.1.–11.1.2027 | Spieltag 7 |
| 10 | 12.1.–18.1.2027 | Reserve für Nachholspiele |

Gesperrt ist eine Woche, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt. Gesperrt sind damit alle Tage
der Sperrzeit **und** alle Tage einer gesperrten Woche: Am Montag 21.12. (letzter Tag von Woche 6) und am Montag 4.1.
(letzter Tag von Woche 8) lässt sich kein Termin vorschlagen – Vorschläge wieder ab Di 5.1.

In der Pause **ruhen Termin-, Bestätigungs- und Nachtragsfristen**: Die 48 Stunden zum Bestätigen und zum Nachtragen
der Aufstellung und die Antwortfrist auf einen Terminvorschlag laufen erst danach weiter. **Das Einspruchsfenster ruht
nicht** – es bleibt bei 30 Minuten nach dem Ergebnis (nach der 48-Stunden-Regel bis zum Ende der Spielwoche).

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
| | **Map-Wiederholung in einer Serie** | Gleiche Map nur in anderem Modus (Vorgabe); auch „Aus – jede Map nur einmal“ oder „Immer erlaubt“ |
| | **Punkte Sieg / Remis / Niederlage**, **Bei Punktgleichheit** | 3 / 1 / 0 · Differenz, Mehr gewonnene Maps |
| | **Ergebnis gilt nach (Stunden)** · **Aufstellung nachtragen bis (Stunden)** | 48 · 48 |
| | **Antwort auf Terminvorschlag (Stunden)** – so lange hat die Gegenseite Zeit; leer heißt bei älteren Seasons „je Staffel wie bisher“ | 72 |
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

Jeder im Kader braucht außerdem die **Spiel-ID** des Spiels im Profil (**Einstellungen → Gaming → Spiel-IDs**, bei CoD
die **Activision-ID** inklusive `#`). Die ID des Hauptspiels gilt für alle Versionen. Ohne ID kann jemand zugeteilt,
aber nicht aufgestellt werden (3.7).

### 2.5 Co-Teams zuteilen

1. Season-Seite → bei der Staffel **Turnierverwaltung · Co-Teams zuteilen** → Reiter **Teilnehmer**.
2. **Co-Team zuteilen** → Schritt 1: das **Hauptteam** wählen → Schritt 2: das **Co-Team** → **Zuteilen**.
3. Co-Teams, die nicht passen, stehen grau mit dem Grund da (Kader zu klein, Team schon in der Staffel, Staffel voll …).
4. Bei jedem Co-Team steht je Spieler die **Spiel-ID** (Haken) bzw. **keine ID** (gelb), darunter „Ohne gültige
   Activision-ID: …“ mit den Namen. Zuteilen geht trotzdem; diese Spieler können erst aufgestellt werden, wenn die ID
   im Profil steht. Sie und die Verantwortlichen des Co-Teams bekommen eine Nachricht.

Beim Zuteilen wird die ID jedes Spielers für die Season **festgehalten** (3.7). Die Captains und Vertreter bekommen
eine Benachrichtigung. **Entfernen** in der Teilnehmerliste geht nur bis zum
Start. Bis dahin ist der Spielplan eine Vorschau und wird bei jeder Änderung neu gemischt.

### 2.6 Spielplan und Start

Oben in der Turnierverwaltung der Staffel: **Liga starten**. Damit wird der Spielplan fest (Season 1 mit acht Teams:
sieben Spieltage zu je vier Spielen, Heimrecht ausgeglichen, Spieltag 7 nach der Weihnachtspause in Woche 9) und die
Staffel steht auf **Live**. Ab jetzt können die Captains Termine vorschlagen und melden.

- Kein **Check-in** und keine Anmeldung – die Co-Teams sind zugeteilt, niemand checkt ein. Die Status-Auswahl oben
  bietet für eine Staffel nur Entwurf, Live, Pausiert, Beendet, Ergebnisse veröffentlicht, Archiviert und Abgesagt.
- Den Spielplan vor dem Start ansehen: Reiter **Matchplan** (Vorschau mit Spielwochen) bzw. **Spiele**. Der Reiter
  **Tabelle** führt zur Tabelle und zum Spielplan auf der öffentlichen Seite. Neu mischen: **Werkzeuge → Vorschau neu
  mischen** – nur vor dem Start; danach steht der Spielplan.

Die Turnierverwaltung einer Staffel zeigt nur, was die Liga braucht. Oben steht, wohin sie gehört („Liga 1 · Staffel
A“) mit **Season öffnen** und **Ligaseite**. Im Reiter **Bearbeiten** stehen die Werte der Season (Spiel, Start und
Ende, Spielwoche, Standardtermin, Teamgröße, Staffelgröße, Best of, Bestätigungsfrist, Antwortfrist auf
Terminvorschläge, Sichtbarkeit, Regeltext) nur zum Lesen unter **Aus der Season** – ändern in der Season, dann
**Vorgaben übertragen** (2.7). Auch den Map-Pool pflegt die Season. Anmeldung, Check-in, Discord, Preise, Jahreswertung,
Seeding und Weiterkommen gibt es in der Staffel nicht. Änderbar bleiben Titel, Beschreibung, Banner, Partner und
Streaming. Die Antwortfrist ändert sich nur noch über die Season (oder Liga N) und **Vorgaben übertragen** – auch bei
älteren Seasons: dort ist das Feld leer und jede Staffel behält ihre bisherige Frist, bis du in der Season einen Wert
einträgst und überträgst.

Eine Staffel lässt sich nur **vor dem Start** löschen – in der Turnierliste oder auf der Season-Seite (2.9). Danach
bleibt sie: Status **Abgesagt** oder **Archiviert**. In der Turnierliste tragen Staffeln das Kennzeichen „Liga ·
Staffel A“; der Filter **Nur Liga-Staffeln** zeigt nur sie.

### 2.7 Vorgaben später ändern und übertragen

Eine Staffel trägt die Werte, die beim Anlegen galten. Ändert ihr danach etwas an der Season, steht oben „Die
bestehende Staffel trägt noch die alten Werte“ – **Jetzt übertragen** bzw. unten **Vorgaben übertragen**. Was nicht
mehr geht, steht je Staffel mit Grund da:

| Was | Wird übertragen |
| --- | --- |
| Regeltext, Map-Pool | immer (ein entfernter Pool verschwindet nur vor dem ersten Ergebnis; Spiele mit festgehaltenem Pool behalten ihn) |
| Antwortfrist auf Terminvorschläge | auch während der Season – gilt für neue Vorschläge; nicht bei gesperrten Staffeln. Ist das Feld der Season leer (ältere Seasons), behält jede Staffel ihre Frist |
| Termine und Kalender (Beginn, Wochen, Sperrzeiten, Standardtermin, Runden, Staffelgröße) | nur vor dem Start |
| Best of, Teamgröße, Mindestkader, Punkte, Modus je Map, Map-Wiederholung, Fristen | nur vor dem ersten Ergebnis |
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

### 2.9 Korrigieren, archivieren, löschen

Falsch angelegt? So kommst du zurück – Löschen geht nur, solange nichts gespielt oder zugeteilt ist; danach
**archivierst** du (ausgeblendet, aber alles bleibt erhalten).

**Liga bearbeiten:** **Admin → eSports → Liga** → Stift in der Zeile der Liga. Name, Beschreibung und **Stand**
(*Aktiv*/*Archiviert*) gehen immer. Das **Spiel** nur, solange keine Season eine Staffel hat (die Modus-Reihenfolge
der Seasons wird dabei geleert, den Map-Pool neu wählen). Die **Adresse** (`/liga/…`) nur, bis eine Season zum ersten
Mal sichtbar war – danach bleibt sie, damit geteilte Links weiter gehen.

**Season bearbeiten:** auf der Season-Seite wie in 2.2; archivieren über **Stand → Archiviert**.
**Liga N bearbeiten:** Stift bei der Liga → Beiname, Abweichungen und **Stand** (*Aktiv*/*Archiviert*). Eine
archivierte Liga N verschwindet von der Ligaseite, ihre Staffeln bleiben.

**Löschen:** Papierkorb bei der Liga (Übersicht), **Season löschen** (oben auf der Season-Seite) oder Papierkorb bei
der Liga N. Es öffnet sich ein Blatt:

| Was du siehst | Bedeutung |
| --- | --- |
| „Das wird endgültig gelöscht“ mit Liste (Seasons, Ligen, leere Staffeln) | Geht: darunter ist jede Staffel ein **Entwurf ohne Co-Teams und Spiele** – sie wird mitgelöscht. **Grund** eintragen (mindestens 5 Zeichen, steht im Protokoll) → **Endgültig löschen** |
| „Archivieren statt löschen“ mit Gründen | Geht nicht: eine Staffel hat schon Co-Teams, einen festen Spielplan oder Ergebnisse, oder die Season ist kein **Entwurf** mehr. **Archivieren** blendet aus, alles bleibt; zurück über **Stand → Aktiv** |

Eine Season lässt sich nur als **Entwurf** löschen. Eine Liga löschen heißt: mit allen Seasons, Ligen N und leeren
Staffeln darunter.

**Staffel löschen:** auf der Season-Seite der Papierkorb in der Zeile der Staffel – nur im **Entwurf** und vor dem
festen Spielplan, wie in der Turnierverwaltung. Zugeteilte Co-Teams werden dabei aus der Staffel genommen (das Blatt
sagt, wie viele); Grund eintragen → **Endgültig löschen**. Nach dem Start: Status **Abgesagt** oder **Archiviert** in
der Turnierverwaltung.

---

## 3. Während der Season

### 3.1 Termine

Captain oder Vertreter schlagen auf der Matchseite unter **Terminabstimmung** einen Termin vor, die Gegenseite nimmt
an (Haken), lehnt ab (X) oder macht einen **Gegenvorschlag**. Ohne Einigung gilt der Standardtermin der Spielwoche.
Ein Vorschlag in einer Sperrzeit wird abgelehnt („In dieser Zeit wird nicht gespielt (Weihnachtspause, …)“). Termin-,
Bestätigungs- und Nachtragsfristen ruhen in der Sperrzeit, das Einspruchsfenster nicht (siehe 1.).

- **Nachrichten:** Jeder Vorschlag, Gegenvorschlag, jedes Annehmen, Ablehnen und Zurückziehen geht sofort an Captain
  und Vertreter der anderen Seite (ohne beide an deren Teamleitung) – ins Postfach und per Push, Thema
  „Match-Erinnerungen“. Trägt die Turnierleitung selbst einen Termin vor, erfahren es beide Seiten. Erinnerungen vor
  Fristen kommen später (#1647).
- **Eigener Vorschlag:** steht bei der eigenen Seite als „wartet auf die Gegenseite“ mit **Zurückziehen**; annehmen
  kann ihn nur die Gegenseite. Zurückgezogen ist kein Vorschlag mehr offen – keine Antwortfrist, keine Eskalation.
- **Startseite:** Offene Vorschläge der Gegenseite stehen bei Captain und Vertreter unter **Offene Aktionen** als
  „Terminvorschlag beantworten“ – auf der Website und in der App.

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

Captain oder Vertreter tragen eine fehlende Aufstellung bis **48 Stunden nach dem Ergebnis** selbst nach (3.16);
bis dahin steht bei ihnen auf der Startseite die Aufgabe „Aufstellung nachtragen“. Danach nur noch die
Turnierleitung: am Spiel **Ergebnis korrigieren** mit Maps und Aufstellungen und einem Grund. Die Matchseite sagt der
Seite nach der Frist „die Frist zum Nachtragen ist vorbei“ und lässt den Matchchat für **@leitung** offen – so kommt
die Bitte zur Turnierleitung. Für die Tabelle spielt die Aufstellung keine Rolle; sie zählt für den Doppel-Einsatz
und spätere Statistiken.

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

Staffel- und Spielseite führen zurück zur Ligaseite: Brotkrumen **Liga · Season · Staffel** und auf der Staffel der
Reiter **Liga** (nur, wenn die Person die Season sehen darf – sonst „Liga · Staffel A“ ohne Link).

### 3.6 Captain und Vertreter während der Season

- **Rolle abgeben:** Captain oder Vertreter geben die eigene Rolle unter **Teams → Deine Teams** mit **Rolle
  abgeben** selbst ab. Leitung und Co-Leitung des Hauptteams bekommen eine Nachricht und vergeben neu (Squad
  bearbeiten). Bis dahin handelt die andere Rolle, ohne beide die Teamleitung.
- **Teamseite:** Mitglieder sehen dort die Co-Teams mit Captain und Vertreter; Teamleitung und Rollen-Inhaber kommen
  über **Co-Teams verwalten** zur Verwaltung.
- **App:** Captain und Vertreter lassen sich in der App noch nicht vergeben. Scheitert dort eine Kader-Änderung an
  einer Rolle, nennt die Meldung den Weg auf der Website.
- **Abmelden:** Ein zugeteiltes Co-Team meldet sich nicht selbst ab – auf der Staffel steht „Austritt nur über die
  Turnierleitung“. Herausnehmen kann es nur die Turnierleitung.

### 3.7 Spiel-IDs im Kader

Je Season und Spieler gilt **eine** Spiel-ID: die beim Zuteilen festgehaltene, bei späteren Spielern die bei der
Aufnahme ins Co-Team, und wer die ID erst später eingetragen hat, bekommt sie beim **ersten Aufstellen** festgehalten.
Sie gilt die ganze Season – auf der Matchseite (Aufstellung, **Activision-ID für die Lobby**) und im Ergebnis-Fenster.
Die IDs sehen nur die Beteiligten des Spiels und die Turnierleitung, nie Gäste.

- **Übersicht:** Season-Seite → **Kader und Spiel-IDs**: je Co-Team die Spieler mit Stand – *festgehalten*, *im Profil*
  (wird beim ersten Aufstellen festgehalten), *fehlt*, *wartet auf Freigabe*. Oben die Zahl ohne ID, wartend und mit
  neuer ID im Profil.
- **ID im Profil geändert:** In der Liga gilt weiter die festgehaltene; die Übersicht zeigt „Im Profil steht
  inzwischen …“. Der Spieler sieht im Profil „In der laufenden Liga gilt weiter …“. Passt die neue ID (etwa
  Kontowechsel): **Neue ID freigeben** → **Grund** (mindestens fünf Zeichen) → **Freigeben**. Ab dann gilt sie;
  unter **Protokoll** steht wann, von wem, alt → neu und der Grund.
- **Stichtag für neue Spieler:** in der Übersicht als Datum, Vorgabe **kein Stichtag**. Er gilt **je Co-Team**: Wer
  nach dem Stichtag in ein Co-Team kommt, in dem er in dieser Season noch nicht stand, steht dort als *wartet auf
  Freigabe* da und ist dort nicht aufstellbar, bis ihr ihn mit **ID freigeben** bestätigt. Das gilt auch für einen
  Wechsel aus einem anderen Co-Team – seine festgehaltene ID bleibt dieselbe, im bisherigen Co-Team spielt er weiter.
  Wer nur kurz aus dem Kader war und ins **selbe** Co-Team zurückkommt, ist nicht „spät“.
- **Aufstellung:** Spieler ohne gültige ID stehen beim Melden und Nachtragen grau mit Grund („Nicht aufstellbar: …“);
  der Server lehnt sie ab – auch im Ergebnis-Fenster der Turnierleitung.
- **Korrektur und Nachtrag durch die Leitung:** Wer auf einer Map schon in der gespeicherten Aufstellung steht,
  bleibt drin, auch ohne gültige ID – **Ergebnis korrigieren** und **Aufstellung nachtragen** gehen also mit dem
  Altbestand. Neu auf eine Map setzen lässt sich nur, wer eine gültige ID hat; sonst zuerst die ID eintragen lassen
  bzw. **ID freigeben**, dann korrigieren.
- **Alte Zuteilungen:** Co-Teams, die vor dieser Funktion zugeteilt wurden, bekommt das Update von selbst in den
  Kader (mit der ID aus dem Profil, wo sie steht).
- **Datenschutz:** Die Datenauskunft enthält die festgehaltene ID; löscht jemand sein Konto, verschwindet sie.

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
| „Eine Liga-Staffel hat keine Anmeldung und keinen Check-in …“ | Status mit Anmeldung oder Check-in gewählt | **Liga starten** (oben) |
| „Turnier kann ohne spielbares Match nicht gestartet werden.“ | Eine ältere Staffel steht noch im Check-in | Status oben auf **Entwurf**, dann **Liga starten** |
| „Best of: Kommt aus der Season – dort ändern und übertragen.“ (ebenso andere Felder, auch die Antwortfrist) | Wert gibt die Season vor | In der Season ändern, dann **Vorgaben übertragen** |
| „In einer Liga-Staffel spielen nur Co-Teams …“ | Teilnehmer ohne Co-Team eingetragen | **Co-Team zuteilen** |
| „Diese Staffel hat schon begonnen oder Spiele – Löschen geht nur vor dem Start …“ | Gestartete Staffel löschen | Status **Abgesagt** oder **Archiviert** |
| „Löschen geht nicht: … hat schon Co-Teams zugeteilt / hat schon begonnen oder Spiele / ist kein Entwurf mehr. Archivieren statt löschen …“ | Liga, Season oder Liga N hängt schon etwas an | Im Blatt **Archivieren** (2.9) |
| „Bitte einen Grund angeben (mindestens 5 Zeichen) …“ | Löschen ohne Grund | Grund eintragen |
| „Das Spiel bleibt, sobald eine Season eine Staffel hat …“ | Spiel einer Liga mit Staffel ändern | Neue Liga anlegen, die alte archivieren |
| „Die Adresse bleibt, seit eine Season der Liga sichtbar war …“ | Adresse nach der Veröffentlichung ändern | Adresse lassen; nur der Name ändert sich || „Ein zugeteiltes Co-Team nimmt nur die Turnierleitung wieder aus der Staffel …“ | Teamleitung will ihr Co-Team abmelden | Bei der Turnierleitung melden |
| Ligaseite zeigt „Liga nicht gefunden“ | Sichtbarkeit *Aus* oder *Nur Turnierleitung* | Sichtbarkeit der Season ändern und speichern |
| „Bitte im Web mit Maps und Aufstellung melden.“ | Erstmeldung oder abweichende Meldung aus der App | Im Web auf der Matchseite melden |
| „In dieser Zeit wird nicht gespielt (Weihnachtspause, 21.12.2026 bis 3.1.2027) …“ | Termin in einer Sperrzeit | Anderen Termin vorschlagen |
| „Deine Maps, Modi oder Sieger weichen von der Meldung der Gegenseite ab …“ | Bestätigung passt nicht | Einspruch über **Problem melden**; die Turnierleitung entscheidet |
| „Map 2: diese Map ist im Pool für Suchen & Zerstören nicht freigegeben.“ / „Map 2: gespielt wird hier Suchen & Zerstören.“ | Map oder Modus passt nicht zu Pool oder Reihenfolge | Richtige Map bzw. Modus wählen; fehlt eine Map im Pool, Pool der Season ändern und übertragen |
| „Map 3: Hafenkante (Stellung) lief schon als Map 1 – dieselbe Map im selben Modus nur einmal je Serie.“ | Map in derselben Serie schon gespielt | Andere Map wählen; die Regel stellt die Season unter **Map-Wiederholung in einer Serie** ein |
| „Nach Map 2 stand der Sieger schon fest – keine weitere Map.“ / „Best of 3: eine Seite braucht 2 gewonnene Maps …“ | Serie passt nicht zum Best of | Maps korrigieren |
| „… die Aufstellung von … braucht genau 4 Spieler.“ / „… nur Spieler aus dem Kader …“ | Aufstellung falsch | Genau die Teamgröße aus dem eigenen Kader wählen |
| „… steht an diesem Spieltag schon in der Aufstellung eines anderen Teams …“ | Doppel-Einsatz | Andere Person aufstellen |
| „Map 1: … kann nicht aufgestellt werden – Activision-ID fehlt im Profil.“ | Spieler ohne Spiel-ID | Spieler trägt die ID im Profil ein, danach geht es (3.7) |
| „… kann nicht aufgestellt werden – Nach dem Stichtag ins Co-Team gekommen …“ | Neuer Spieler nach dem Stichtag | Season → **Kader und Spiel-IDs** → **ID freigeben** mit Grund |
| „Im Profil fehlt noch: Activision-ID – erst eintragen, dann freigeben.“ | Freigabe ohne ID im Profil | Spieler trägt die ID zuerst ein |
| „Die Frist zum Nachtragen ist vorbei …“ | 48 Stunden nach dem Ergebnis vorbei | Turnierleitung trägt mit Grund nach |
| „Ein Dispute ist nur bis 30 Minuten nach dem Ergebnis möglich …“ | Einspruchsfrist vorbei | Matchchat mit **@leitung**; die Turnierleitung korrigiert |
| „Bitte kurz den Grund der Korrektur angeben (mindestens 5 Zeichen).“ (Ergebnis-Fenster) bzw. „Bitte einen Grund für die Korrektur angeben (mindestens 5 Zeichen).“ | Korrektur ohne Grund | Grund mit mindestens fünf Zeichen |
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

**Ein Spieler hat eine neue Activision-ID – darf er damit spielen?**
Erst nach eurer Freigabe (3.7). Bis dahin spielt er mit der gemeldeten ID; aufstellbar bleibt er.

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
- [ ] Jeder im Kader hat die **Activision-ID** im Profil; Season → **Kader und Spiel-IDs** zeigt niemanden „ohne ID“,
      Stichtag für neue Spieler entschieden – 3.7
- [ ] Je Co-Team **Captain** und **Vertreter** vergeben – 2.4
- [ ] Alle Co-Teams **zugeteilt** (Teilnehmer: 8 von 8) – 2.5
- [ ] Season gespeichert und, falls nach dem Anlegen der Staffel etwas geändert wurde, **Vorgaben übertragen** – 2.7
- [ ] Ligaseite mit *Nur Turnierleitung* geprüft: Teams, Wochen mit Weihnachtspause, Pool, Regeln – 2.8
- [ ] **Liga starten** (Spielplan fest, sieben Spieltage) – 2.6
- [ ] **Am 10.11.:** Sichtbarkeit auf **Öffentlich**, **Season speichern** – 2.8
- [ ] **Discord-Ankündigung von Hand** (die Liga meldet sich noch nicht selbst): Link zur Ligaseite, Start, Ablauf,
      [Spickzettel für Captains](liga-captains.md)
