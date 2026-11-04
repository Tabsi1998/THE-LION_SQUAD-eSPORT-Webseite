# Liga leiten – Handbuch

Für die **Liga-Leitung** (und den Obmann der Liga): eine Liga über Wochen aufsetzen, starten und durch die Season
bringen – am Beispiel der CoD-Liga, Season 1 (Start Di 10.11.2026). Ohne Vorwissen lesbar; was technisch dahinter
steckt, steht in [LIGA.md](../LIGA.md). Für die Captains der Co-Teams gibt es einen eigenen
[Spickzettel](liga-captains.md), zum Abhaken vor dem Start die [Checkliste für den Obmann](#6-checkliste-für-den-obmann-bis-911).

**Wo im Admin:**

- **Admin → eSports → Spiele → Zahnrad** (`/admin/games/<Spiel>`) – die Spielseite: Reiter **Modi** (etwa Stellung, Suchen & Zerstören)
  und Reiter **Maps** (`#maps`) – Map-Bibliothek als Tabelle Map × Modus mit Bildern
- **Admin → eSports → Liga** (`/admin/leagues`) – Liga, Season, Liga 1, 2 …, Staffel A, B …
- **Turnierverwaltung der Staffel** (`/admin/tournaments/<Staffel>`, aus der Season über **Turnierverwaltung · Co-Teams
  zuteilen**) – Co-Teams zuteilen, starten, Spiele, Ergebnisse
- **Ligaseite** (`/liga/<liga>/<season>`, etwa `/liga/call-of-duty/season-1`) – was Mitglieder und Gäste sehen

Wer was darf: Liga, Season, Liga N, Staffel, Zuteilen, Start und Korrekturen macht nur die **Liga-Leitung mit
bestätigter Zwei-Faktor-Anmeldung**: wer den Bereich **Ligen** hat oder in dieser Liga **zuständig** ist, siehe
[2.11](#211-bereich-ligen-und-zuständige). Wo dieses Handbuch und die Oberfläche von „Turnierleitung“ schreiben, ist bei einer
Liga genau diese Liga-Leitung gemeint. Der Bereich **Turnierleitung allein gibt in der Liga nichts mehr**. Co-Teams, Captain und
Vertreter pflegt die **Teamleitung** (Leitung oder Co-Leitung des Hauptteams) im Profil. Termine, Melden, Bestätigen und Einspruch
machen **Captain und Vertreter** des Co-Teams – hat ein Co-Team keinen von beiden, die Teamleitung.

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
| **Liga** (je Spiel) | CoD-Liga | Name, Spiel, Adresse `/liga/call-of-duty`, Gestaltung (Emblem, Banner, Farbe – 2.10) |
| **Season** | Season 1 | alle Vorgaben: Kalender, Sperrzeiten, Best of, Teamgröße, Punkte, Fristen, Map-Pool, Regelwerk, Sichtbarkeit |
| **Liga N** | Liga 1 | Stufe der Liga; darf Best of, Teamgröße, Mindestkader, Staffelgröße, Punkte und Antwortfrist abweichend festlegen |
| **Staffel** | Staffel A | ein gewöhnliches Turnier im Format Liga mit den Werten der Season – Spiele, Termine, Ergebnisse, Tabelle |
| **Co-Team** | Nebelwölfe · Rudel | Teilnehmer der Staffel: ein Kader eines Hauptteams mit Captain und Vertreter |

So läuft eine Spielwoche: Die Woche geht von **Dienstag bis Montag**. Die Captains vereinbaren einen Termin – ohne
Einigung gilt der **Standardtermin** (Season 1: Sonntag 20:00). Nach dem Spiel meldet eine Seite das Ergebnis **im
Web** mit Maps und hakt einmal an, wer bei ihr gespielt hat (**Teilnehmerliste**, siehe 3.3), die andere bestätigt. Antwortet sie nicht, gilt die Meldung nach **48 Stunden**
(spätestens am Ende der Spielwoche, mindestens 24 Stunden Zeit). Die Tabelle rechnet in neuen Seasons **3 Punkte für
einen Sieg, 0 für eine Niederlage, ohne Remis**; bei Punktgleichheit entscheiden der **direkte Vergleich**, dann
Map-Differenz und gewonnene Maps, zuletzt die Liga-Leitung (siehe 3.5). Alles stellt die Season ein.

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
dafür gibt es die Ligaseite, den Menüpunkt **Liga** und die Kachel **Liga** auf der eSports-Übersicht (`/esports`, mit
„Start am …“ oder „Läuft“). Menüpunkt und Kachel erscheinen nur, solange eine Season sichtbar ist. Name, Stelle und
Ausblenden des Menüpunkts stellt die Redaktion unter **Admin → Content → Navigation** ein.

---

## 2. Einrichten Schritt für Schritt

### 2.1 Modi und Maps in der Bibliothek

1. **Admin → eSports → Spiele → Zahnrad**, Reiter **Modi**, **Modus hinzufügen**: je Modus eine Zeile,
   etwa **Stellung**, **Suchen & Zerstören**, **Kontrolle**. Minuten braucht ein Modus nur für Maps nicht. Aufgeklappt
   trägt jeder Modus auf Wunsch **Beschreibung**, **Spieler je Seite**, **Format** und eine **Ergebnisregel** (Punkte bis
   zum Ziel, Runden gewinnen oder höherer Endstand; Ziel, Rundenlimit, Zeitlimit, Remis, Verlängerung) – die Werte laut
   Regelwerk tragt ihr selbst ein. Details: [Turniere, 3.12](turniere.md#312-spieldauer-und-spiel-daten).
2. Reiter **Maps** → **Map hinzufügen**: Name, **Bild** im Format 16 : 9 (nur eigene Uploads),
   und die **Modi**, in denen die Map gespielt wird; später setzt ein Häkchen in der Tabelle sie frei. Mit **Aus Spiel übernehmen** kommen Maps einer anderen Spielversion
   samt Bild dazu; gibt es schon Maps ohne Modus, ordnet **Allen … Maps zuordnen** sie gesammelt zu. Details:
   [Turniere, 3.14](turniere.md#314-maps-und-map-pools).

Modi und Maps dürfen sich auch während einer laufenden Season ändern: Gemeldet wird immer aus dem gespeicherten Pool der
Staffel. Ein Modus, der in Pool, Reihenfolge oder Spielen steht, lässt sich nicht entfernen, nur auf **Inaktiv** oder
**Archiviert** stellen: Er kommt dann in keinen neuen Pool und keine neue Reihenfolge, Pool und Ergebnisse bleiben.
Nennt **Modus je Map** den Modus noch, ändert zuerst diese Reihenfolge: Einen Pool ohne ihn nimmt die Season sonst nicht an.
Nach dem ersten Ergebnis geht beim **Übertragen** nur noch der Pool an die Staffel, nicht die Reihenfolge. Fehlt ihrem Pool
dann ein Modus der Reihenfolge, sagt das Übertragen das, und die Teams wählen den Modus je Map frei. Spiele mit
festgehaltenem Pool behalten ihre Reihenfolge.

**Maps deaktivieren:** In der Map-Bibliothek hat jede Karte die Knöpfe **Deaktivieren** (Pause-Symbol) und **Archivieren**.
*Inaktiv* heißt: Die Map kommt in keinen neuen Pool, dort, wo sie schon steht, bleibt sie gültig und meldbar. *Archiviert*
blendet sie zusätzlich aus. Vor beidem fragt die Verwaltung nach und nennt die Seasons, in deren Map-Pool die Map gerade
steht – das ist nur ein Hinweis, gesperrt wird nichts. Soll eine kaputte Map wirklich aus einer laufenden Season raus, geht
das in der Season mit **Map aus dem Pool nehmen** (2.2, Reiter Spielbetrieb).

### 2.1a Ausrüstung und Sperrliste

Grundsatz: **Alles ist erlaubt außer dem, was auf der Sperrliste der Season steht.** Die Website prüft nicht, was im Spiel benutzt
wird – ein Verstoß läuft über Einspruch und Strafe.

1. **Bibliothek:** **Admin → eSports → Spiele → Zahnrad → Reiter Ausrüstung** (`/admin/games/<Spiel>#ausruestung`), auch aus der Season
   über **Sperrliste → Bibliothek pflegen**. Der Reiter speichert je Eintrag sofort – es gibt nichts „Ungespeichertes“. Zuerst **Kategorien**: Ohne Kategorien gibt es einen Vorschlag (Waffen, Aufsätze, Perks, Ausrüstung, Abschussserien), den
   du anpasst und speicherst. Die **Art** entscheidet: An einer *Waffe* lassen sich einzelne Aufsätze sperren, ein *Aufsatz* passt zu Waffen,
   alles andere ist *sonstige Ausrüstung*. Hat eine Kategorie Einträge, bleibt ihre Art und sie lässt sich nicht entfernen.
2. **Einträge:** **Eintrag hinzufügen** – Name, Bild 16 : 9 (nur Upload oder Mediathek; ohne Medienrechte nur eigene Bilder), bei Aufsätzen
   **Passt zu**: Ein Aufsatz passt nur zu den gewählten Waffen, **ohne Wahl zu keiner**. Aufsätze ohne Waffe nennt oben ein gelber Hinweis;
   dort Waffen anhaken und **Allen … Aufsätzen zuordnen** (wie „Maps ohne Modus“). Suche und Kategorie-Knöpfe helfen bei vielen Einträgen.
   **Aus Spiel übernehmen** holt Einträge einer anderen Spielversion, fehlende Kategorien kommen mit, Aufsätze finden ihre Waffen über den
   Namen (Waffen also mit übernehmen, sonst kommen sie ohne Waffe).
3. **Zustand:** *Deaktivieren* (Ein/Aus-Symbol): kommt auf keine neue Sperrliste, wo er steht, bleibt er. *Archivieren*: zusätzlich
   ausgeblendet. Was auf einer gespeicherten Sperrliste steht, lässt sich nicht löschen, nur archivieren.
4. **Sperrliste der Season:** auf der Season-Seite im Reiter **Regelwerk und Sperrliste** (`#sperrliste`). Haken bei **sperren**, darunter **Gilt in**: allen Modi oder
   einzelnen. Bei einer Waffe öffnet **Aufsätze einzeln sperren** die passenden Aufsätze – die Waffe bleibt erlaubt, nur diese Aufsätze nicht.
   Ein Aufsatz in seiner eigenen Kategorie gesperrt gilt an jeder Waffe. **Nur gesperrte** zeigt, was schon auf der Liste steht.
5. **Speichern** legt eine neue **Version** an. Bestehende Staffeln bekommen sie mit **Jetzt übertragen** (auch gesperrte und laufende),
   neue Staffeln gleich beim Anlegen. Ein Spiel hält die Version fest, die bei seinem Ergebnis galt. **Versionen vergleichen** zeigt neu
   gesperrt, geändert und wieder erlaubt.
6. **Regelwerk:** Steht der Baustein **Sperrliste** im Regelwerk, sagt der Abschnitt, ob die letzte Fassung noch den alten Stand zeigt.
   **Neue Version vorbereiten** führt ins Regelwerk; dort sind die Unterschiede markiert, du gibst frei und wählst, ob neu zugestimmt werden
   muss (2.11). Jede Fassung friert ihre Liste ein.

Öffentlich steht die Liste auf der Ligaseite unter dem Map-Pool, nur wenn die Season sichtbar ist. Rechte: Bibliothek wie Maps (Bereich
Turnierleitung), Sperrliste mit **Season konfigurieren** (lesen: jede Zuständigkeit der Liga).

<table>
<tr>
<td><img src="../assets/liga/ausruestung-bibliothek.png" alt="Bibliothek Ausrüstung: Kategorie-Knöpfe, Suche, je Kategorie Einträge mit Bild, Zustand und „auf N Sperrlisten“" width="560"></td>
<td><img src="../assets/liga/ausruestung-bibliothek-handy.png" alt="Dieselbe Bibliothek am Handy mit 390 px, lange Namen brechen um" width="220"></td>
</tr>
<tr>
<td><img src="../assets/liga/sperrliste-season.png" alt="Abschnitt Sperrliste der Season: Hinweis aufs Regelwerk, gesperrte Waffe mit Modus, Aufsätze an einer Waffe" width="560"></td>
<td><img src="../assets/liga/sperrliste-ligaseite-handy.png" alt="Ligaseite am Handy: Sperrliste nach Kategorien, Aufsätze an erlaubten Waffen" width="220"></td>
</tr>
</table>

### 2.2 Liga und Season anlegen

1. **Admin → eSports → Liga → Liga anlegen**: Name (etwa „CoD-Liga“) und Spiel.
2. In der Liga **Season anlegen**: nur der **Beginn der ersten Spielwoche** (00:00 Uhr Wiener Zeit, Season 1:
   10.11.2026). Die übrigen Vorgaben kommen als Startwerte mit.
3. Die Season öffnen. Die Season-Seite hat sieben **Reiter**; jede Angabe steht an genau einer Stelle. Am Handy wischst du die
   Reiterleiste seitlich. Jeder Reiter speichert für sich (**Termine speichern**, **Tabelle speichern** …) und schickt nur seine
   eigenen Felder. Was noch nicht gespeichert ist, trägt am Reiter einen **Punkt** und bleibt beim Wechsel erhalten; die Seite fragt
   dann einmal, ob du **jetzt speichern** willst. Verlässt du die Seite mit Ungespeichertem, fragt sie nach.

| Reiter | Was dort steht | Adresse |
| --- | --- | --- |
| **Überblick** | Ablauf der Season, **Was fehlt noch?**, Name, Sichtbarkeit, Stand, Gestaltung und Gewinne | `…/seasons/<id>` |
| **Spielbetrieb** | Modi der Season mit Maps, Mindestgröße, Ergebnisregeln, Serie (Best of, Teamgröße, Modus je Map, Map-Wiederholung), Fristen nach dem Spiel | `#spielbetrieb` |
| **Termine** | Kalender, Standardtermin, Sperrzeiten, Antwortfrist, Terminregeln (2.7a) | `#termine` |
| **Anmeldung und Kader** | Selbstanmeldung (2.5a), Kader und Spielberechtigung (3.9), Eingang der Anmeldungen, Kaderübersicht (3.7) | `#anmeldung`, `#anmeldungen`, `#kader` |
| **Tabelle** | Punkte, Gleichstand, Ausscheiden, Gleichstände der Staffeln (3.5) | `#tabelle` |
| **Regelwerk und Sperrliste** | Stand des Regelwerks mit Weg dorthin (2.11), Sperrliste (2.1a) | `#regelwerk`, `#sperrliste` |
| **Ligen und Staffeln** | Liga 1, 2 …, Staffeln, Staffelgröße, Vorgaben übertragen (2.3, 2.7) | `#ligen` |

<table>
<tr>
<td><img src="../assets/liga/liga-season-ueberblick-pc.png" alt="Reiter Überblick: Ablaufleiste mit „Anmeldung – jetzt“, Was fehlt noch? mit Sprung je Punkt, Sichtbarkeit und Stand mit Erklärung" width="560"></td>
<td><img src="../assets/liga/liga-season-ueberblick-handy.png" alt="Derselbe Überblick am Handy mit 390 px: Reiter zum Wischen, Ablauf untereinander" width="220"></td>
</tr>
</table>

**Überblick.** Oben die **Ablaufleiste**: Vorbereitung → Anmeldung (das Anmeldefenster; ohne Fenster „ohne Selbstanmeldung“) →
Einteilung → Spielbetrieb (mit der laufenden Spielwoche) → Abschluss. Sie folgt aus den Einstellungen und Staffeln, nichts davon
stellst du von Hand. Darunter **Was fehlt noch?** – die Prüfung vor der Veröffentlichung (2.8). Jeder Punkt hat einen Knopf
**Zu …**, der in den richtigen Reiter springt. Daneben **Name**, **Sichtbarkeit** und **Stand**, je mit einem Satz, was sie bewirken.
Der *Stand* ist deine bewusste Schaltung (Entwurf, Läuft, Beendet, Archiviert); mit dem Start der ersten Staffel springt er von selbst
auf *Läuft*. Muss das Regelwerk freigegeben werden (Entwurf liegt bereit oder Daten haben sich geändert), steht oben
**Regelwerk muss freigegeben werden** mit Weg dorthin. **Gestaltung und Gewinne** (2.10) klappt unten auf. Speichern: **Überblick
speichern**.

**Spielbetrieb – die Modi an einer Stelle.**

<table>
<tr>
<td><img src="../assets/liga/liga-season-spielbetrieb-pc.png" alt="Reiter Spielbetrieb: Modi der Season anhaken, je Modus die Maps mit „Braucht mindestens …“" width="560"></td>
<td><img src="../assets/liga/liga-season-spielbetrieb-handy.png" alt="Derselbe Reiter am Handy: Modi als Haken untereinander" width="220"></td>
</tr>
</table>

1. **Welche Modi spielt die Season?** Haken bei jedem Modus setzen. Darunter erscheint je angehaktem Modus die Liste seiner Maps:
   anhaken und mit den Pfeilen sortieren. Unter dem Namen steht, wie viele Maps der Modus **mindestens braucht** (aus Modus je Map,
   längster Serie und Map-Wiederholung). **Vorgabe des Spiels** lädt den Standard-Pool des Spiels (ohne ihn alle aktiven Maps) und hakt
   die Modi gleich an. Ein Modus ohne Haken kommt nicht in den Pool. **Modi und Maps speichern** legt eine neue Version an; ohne Pool
   kann niemand mit Maps melden, jede neue Staffel bekommt eine Kopie.
2. Darunter: **Map aus dem Pool nehmen** (Map, „aus allen Modi“ oder einer, **Grund** mit mindestens 5 Zeichen → **Sperren und
   übertragen**: neue Version ohne die Map, sofort an alle Staffeln; Spiele mit festgehaltenem Pool und fertige Spiele bleiben) und
   **Versionen vergleichen**.
3. **Mindestgröße anpassen** (zugeklappt): eine eigene Zahl je Modus überschreibt die Ableitung, leer heißt abgeleitet →
   **Mindestgröße speichern**.
4. **Ergebnisregeln** – nur für die angehakten Modi. Eine neue Season übernimmt beim Anlegen die Regel jedes Modus aus dem Spiel (2.1)
   als eigene Kopie, **Punkte je Map Pflicht** ist an. Je Modus stehen die Regel der Season und darunter „Spiel: …“. Abweichen geht je
   Modus: **Art** (Punkte bis zum Ziel, Runden gewinnen, Höherer Endstand gewinnt, Keine Regel), **Zielpunkte** bzw. **Rundensiege zum
   Sieg**, **Höchstens Runden**, **Zeitlimit**, **Remis möglich**, **Verlängerung** → **Ergebnisregeln speichern**. Ändert jemand später
   die Regel am Spiel, bleibt die Season, wie sie ist: Dann steht **weicht vom Spiel ab** am Modus, und **Vom Spiel übernehmen** holt die
   neue Regel – erst mit dem Speichern gilt sie.
5. **Serie:** **Best of**, **Teamgröße (je Map)**, **Map-Wiederholung in einer Serie** und **Modus je Map** (Map 1, 2, 3 – „frei“ heißt:
   die Teams wählen; so viele Felder wie die längste Serie, entweder alle frei oder jedes belegt). Steht in Modus je Map ein Modus ohne
   Maps im Pool, oder hat ein Modus Maps, kommt aber nie dran, sagt das ein Hinweis direkt darunter. Dazu **Nach dem Spiel**:
   **Ergebnis gilt nach** und **Teilnehmerliste nachtragen bis** (Stunden). Speichern: **Spielbetrieb speichern**.

| Art | Beispiel | Was die Meldung prüft |
| --- | --- | --- |
| Punkte bis zum Ziel | Ziel 250, Zeitlimit 10 Min. | Sieger hat mehr Punkte, höchstens 250; ohne Zeitlimit genau 250 |
| Runden gewinnen | 6 Rundensiege, höchstens 11 Runden | 6:5 geht, 7:5 nicht („höchstens 11 Runden – 7:5 sind 12“) |
| Höherer Endstand gewinnt | – | nur: der Sieger hat mehr |

Mit **Verlängerung** dürfen Ziel und Rundenlimit überschritten werden. Ein Gleichstand geht nur mit **Remis möglich**; die
Map braucht trotzdem einen Sieger. Ohne Regel prüft die Meldung den Endstand nicht. Seasons von vor dieser Funktion haben
keine Kopie und keine Punktepflicht – sie prüfen nichts Neues, bis du hier speicherst.

**Die Werte für Season 1** in den übrigen Reitern:

| Reiter | Feld | Season 1 |
| --- | --- | --- |
| Spielbetrieb | **Best of** · **Teamgröße (je Map)** | Best of 3 · 4 |
| | **Modus je Map** | nach Regelwerk |
| | **Map-Wiederholung in einer Serie** | Gleiche Map nur in anderem Modus (Vorgabe); auch „Aus – jede Map nur einmal“ oder „Immer erlaubt“ |
| | **Ergebnis gilt nach** · **Teilnehmerliste nachtragen bis** (Stunden) | 48 · 48 |
| Termine | **Wochen gesamt** (mit Sperrwochen) | 10 |
| | **Spielwoche (Tage)**, **Standardtag**, **Standardzeit** | 7 · Sonntag · 20:00 |
| | **Runden** | Nur Hinrunde |
| | **Sperrzeiten** (Von, Bis, Bezeichnung) | 21.12.2026–3.1.2027 „Weihnachtspause“ |
| | **Antwort auf Terminvorschlag (Stunden)** – leer heißt bei älteren Seasons „je Staffel wie bisher“ | 72 |
| Anmeldung und Kader | **Anmeldung ab / bis**, **Startplätze** … (2.5a) | nach Plan |
| | **Meldeschluss** (nur Anzeige) – nur ohne Anmeldefenster, sonst gilt „Anmeldung bis“ | – |
| | **Mindestkader** · **Höchstkader** · **Mindestalter (Jahre)** · **Wartezeit neuer Spieler (Tage)** | 3 · 50 · 18 · 7 |
| | **Wer gespielt hat**, **Mindestens auf der Liste** | Teilnehmerliste einmal je Spiel, 3 |
| | **Ein Team je Season**, **Jede Spiel-ID nur einmal** | an, an |
| | **Transferfenster** (Von, Bis, Name) | keines: ohne Fenster keine Transfers |
| Tabelle | **Punkte Sieg / Remis / Niederlage** | 3 / 0 / 0 (neue Seasons; ältere: 3 / 1 / 0) |
| | **Bei Punktgleichheit** (in der Reihenfolge des Anklickens) | Direkter Vergleich, Map-Differenz, Mehr gewonnene Maps, Entscheid der Leitung |
| | **Direkter Vergleich (Mini-Tabelle)** – erscheint mit dem direkten Vergleich | Punkte, Map-Differenz, Gewonnene Maps |
| | **Kampflos (Default-Win)** | Maps des Best of (BO3 2:0, BO5 3:0) |
| | **Austritt, Auflösung, Disqualifikation** | Alle Spiele zählen für die Gegner, Team ans Tabellenende |
| | **Remis erlaubt** | aus |
| Ligen und Staffeln | **Teams je Staffel höchstens** | 8 |
| Überblick | **Sichtbarkeit** | bis zum Start *Nur Liga-Leitung* (siehe 2.8) |

Im Reiter **Termine** steht unter den Sperrzeiten nach dem Speichern, welche Wochen gesperrt sind und **wie viele Teams eine Staffel
höchstens fassen kann** (Season 1: 8 Spielwochen – höchstens 8 Teams mit nur Hinrunde).

<table>
<tr>
<td><img src="../assets/liga/liga-season-termine-pc.png" alt="Reiter Termine: Kalender, Sperrzeiten, Spielwochen" width="380"></td>
<td><img src="../assets/liga/liga-season-anmeldung-pc.png" alt="Reiter Anmeldung und Kader: Sprünge zu Selbstanmeldung, Kader, Eingang und Kaderübersicht" width="380"></td>
</tr>
<tr>
<td><img src="../assets/liga/liga-season-tabelle-pc.png" alt="Reiter Tabelle: Punkte und Reihenfolge bei Punktgleichheit" width="380"></td>
<td><img src="../assets/liga/liga-season-regelwerk-pc.png" alt="Reiter Regelwerk und Sperrliste: Stand des Regelwerks und Weg dorthin" width="380"></td>
</tr>
</table>

**Regeltext:** Das alte Freitextfeld gibt es auf der Season-Seite nicht mehr. Regeln stehen im Regelwerk mit Versionen (2.11). Hat
eine ältere Season noch einen Regeltext und kein Regelwerk, steht er im Reiter **Regelwerk und Sperrliste** zum Nachlesen und gilt auf
der Ligaseite weiter, bis die erste Fassung veröffentlicht ist. Gelöscht wird nichts.

### 2.3 Liga 1 und Staffel anlegen

1. Auf der Season-Seite im Reiter **Ligen und Staffeln** → **Liga 1 anlegen**. Leere Felder heißen „wie die Season“.
   Der **Beiname** ist freiwillig: „Liga 1“ zählt die Seite von selbst, trag dort nur einen Zusatz wie „Elite“ ein (Anzeige
   „Liga 1 · Elite“). Wiederholt der Beiname die Stufe – etwa „Liga 1“, dann hieße es „Liga 1 · Liga 1“ –, sagt das ein Hinweis
   im Blatt und in der Liste. Liga 2, 3 … entstehen genauso und dürfen eigene Werte haben.
2. In der Zeile von Liga 1 → **Staffel anlegen** → bestätigen. Es entsteht das Turnier „CoD-Liga Season 1 · Liga 1 ·
   Staffel A“ als **Entwurf** – ohne offene Anmeldung, ohne Discord, ohne Jahreswertung. Mehr als acht Teams? Eine
   zweite Staffel (B) anlegen und die Teams verteilen; zwei Co-Teams desselben Hauptteams spielen nie in derselben
   Staffel.

<table>
<tr>
<td><img src="../assets/liga/liga-season-ligen-pc.png" alt="Reiter Ligen und Staffeln: Liga 1 mit Hinweis zum Beinamen, Staffelgröße und Vorgaben übertragen" width="560"></td>
<td><img src="../assets/liga/liga-season-beiname-handy.png" alt="Blatt Liga 1 bearbeiten am Handy: Beiname „Liga 1“ mit Hinweis, dass der Titel sonst „Liga 1 · Liga 1“ hieße" width="220"></td>
</tr>
</table>

### 2.4 Co-Teams vorbereiten (Teamleitung)

Das macht die Leitung des Hauptteams, nicht die Turnierleitung: **Teams → Deine Teams** → Team wählen → **Co-Team** →
Name, **Spiel** aus der Liste (eines mit anderem Spiel lässt sich nicht zuteilen; Hauptspiel und Versionen zählen zusammen, ohne Spiel passt es überall), **Kader**
(mindestens so viele wie der Mindestkader, höchstens der Höchstkader, Vorgabe 3 bis 50), **Captain** und **Vertreter**
(beide aus dem Kader, verschieden) → speichern. Captain und Vertreter vereinbaren Termine, melden und bestätigen
Ergebnisse. Alle im Kader brauchen ein Konto und müssen Mitglied des Hauptteams sein.

Jeder im Kader braucht außerdem die **Spiel-ID** des Spiels im Profil (**Einstellungen → Gaming → Spiel-IDs**, bei CoD
die **Activision-ID** inklusive `#`). Die ID des Hauptspiels gilt für alle Versionen. Ohne ID kann jemand zugeteilt,
aber nicht aufgestellt werden (3.7). Verlangt die Season ein Mindestalter, braucht jeder im Kader ein **Geburtsdatum im Profil**; sichtbar ist davon nur „erfüllt“ oder „Geburtsdatum fehlt“.
Unter jedem Co-Team, das in einer Staffel spielt, zeigt **Spielberechtigung** die Regeln der Season, wer spielen darf und was fehlt.

### 2.5 Co-Teams zuteilen

1. Season-Seite, Reiter **Ligen und Staffeln** → bei der Staffel **Turnierverwaltung · Co-Teams zuteilen** → Reiter **Teilnehmer**.
2. **Co-Team zuteilen** → Schritt 1: das **Hauptteam** wählen → Schritt 2: das **Co-Team** → **Zuteilen**.
3. Co-Teams, die nicht passen, stehen grau mit dem Grund da (Kader zu klein oder zu groß, Team schon in der Staffel, Staffel voll, Geburtsdatum fehlt, jemand steht schon in einem anderen Co-Team der Season …).
4. Bei jedem Co-Team steht je Spieler die **Spiel-ID** (Haken) bzw. **keine ID** (gelb), darunter „Ohne gültige
   Activision-ID: …“ mit den Namen. Zuteilen geht trotzdem; diese Spieler können erst aufgestellt werden, wenn die ID
   im Profil steht. Sie und die Verantwortlichen des Co-Teams bekommen eine Nachricht.

Beim Zuteilen wird die ID jedes Spielers für die Season **festgehalten** (3.7). Die Captains und Vertreter bekommen
eine Benachrichtigung. **Entfernen** in der Teilnehmerliste geht nur bis zum
Start. Bis dahin ist der Spielplan eine Vorschau und wird bei jeder Änderung neu gemischt.

### 2.5a Selbstanmeldung

Captains und Vertreter melden ihr Co-Team selbst auf der Ligaseite an, du entscheidest. Ohne Anmeldefenster gibt es das nicht, dann bleibt es beim Zuteilen aus 2.5. Das Zuteilen bleibt auch danach als Sonderweg.

**Einrichten** (Season-Seite, Reiter **Anmeldung und Kader** → **Selbstanmeldung**, Zuständigkeit „Season konfigurieren“):

1. **Anmeldung ab** und **Anmeldung bis** in Wiener Zeit eintragen. Beides oder nichts.
2. **Startplätze** eintragen. Leer heißt: keine Grenze außer der Staffelgröße.
3. **Warteliste** an- oder abschalten, auf Wunsch eine Höchstzahl und eine **Regel zur Warteliste**. Die Regel steht öffentlich auf der Ligaseite.
4. **Wer darf sich anmelden:** alle Konten (Vorgabe) oder nur Vereinsmitglieder. Bei Mitgliedern gilt das für den ganzen Kader.
5. **Zwei Co-Teams eines Hauptteams in derselben Staffel:** Vorgabe Nein.
6. **Hinweis zum Datenschutz:** Der Text steht bei der Anmeldung über dem Link zur Datenschutzerklärung und wird mit der Zustimmung gespeichert. Leer steht dort ein vorläufiger Platzhalter-Satz. Den Wortlaut gibt der Obmann frei.
7. **Regelwerk veröffentlichen** (2.11): Ohne gültige Version geht keine Anmeldung. Der alte Regeltext reicht dafür nicht, weil er keine Version hat und sich eine Zustimmung darauf nicht belegen lässt.

**Entscheiden** (Season-Seite, Reiter **Anmeldung und Kader** → **Anmeldungen**, Zuständigkeit „Teams freigeben“). Bei jeder neuen Anmeldung bekommst du eine Nachricht mit Link; er öffnet den Reiter gleich an dieser Stelle. Je Anmeldung steht da, wer eingereicht hat, welcher Regelversion und wann zugestimmt wurde und was der Kader gerade nicht erfüllt.

| Knopf | Was passiert |
| --- | --- |
| **In Prüfung nehmen** | Das Team sieht „In Prüfung“. Freiwillig |
| **Annehmen** | Belegt einen Startplatz. Mit gewählter Staffel ist das Co-Team gleich zugeteilt, sonst teilst du später zu |
| **Zuteilen** | Für Angenommene ohne Staffel. Erst jetzt steht das Team in der Staffel, und der Kader wird noch einmal geprüft |
| **Warteliste** | Kein Startplatz. Rückt nicht von selbst nach: Wird ein Platz frei, nimmst du von Hand an |
| **Ablehnen** | Nur mit Grund (mindestens fünf Zeichen). Captain und Vertreter lesen ihn. Das Team darf im offenen Fenster neu einreichen |

Hat sich der Kader seit dem Einreichen geändert, sagt das die Anmeldung, und Annehmen oder Zuteilen lehnen mit demselben Satz ab. Sind alle Plätze belegt, geht **Annehmen** nicht mehr. Mit Warteliste nimmt die Season weiter Anmeldungen an, ohne Warteliste endet die Anmeldung.

Teilst du ein Co-Team mit offener Anmeldung über 2.5 direkt zu, gilt die Anmeldung als angenommen. Nimmst du die Zuteilung zurück, bleibt sie angenommen und hält ihren Platz, bis du neu zuteilst oder ablehnst. Zugeteilte zieht niemand per Klick zurück: Den Austritt trägst du in der Teilnehmerliste ein.

**Eigenes Team:** Über die Anmeldung deines eigenen Teams entscheidet eine andere Person. Eigenes Team heißt: Du stehst im Kader des Co-Teams, bist Captain oder Vertreter, leitest das Hauptteam mit oder hast den Antrag eingereicht. Dann stehen bei dieser Anmeldung keine Knöpfe, sondern der Satz „Über dein eigenes Team entscheidet eine andere Person.“ Die Anmeldungen der anderen Teams entscheidest du wie gewohnt. Dasselbe gilt für **Co-Team zuteilen** (2.5), wenn das Co-Team eine offene Anmeldung hat. Nur der **Superadmin** darf als Notausnahme: Er trägt bei der Anmeldung einen **Grund für die Notausnahme** ein (mindestens fünf Zeichen), erst dann gehen die Knöpfe. Der Grund steht im Verlauf der Anmeldung und im Protokoll.

### 2.6 Spielplan und Start

Oben in der Turnierverwaltung der Staffel: **Liga starten**. Damit wird der Spielplan fest (Season 1 mit acht Teams:
sieben Spieltage zu je vier Spielen, Heimrecht ausgeglichen, Spieltag 7 nach der Weihnachtspause in Woche 9) und die
Staffel steht auf **Live**. Ab jetzt können die Captains Termine vorschlagen und melden. Mit der ersten Staffel springt
die Season von *Entwurf* auf *Läuft*, ein von Hand gesetzter Stand bleibt.

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
Setzliste und Weiterkommen gibt es in der Staffel nicht. Änderbar bleiben Titel, Beschreibung, Banner, Partner und
Streaming. Die Antwortfrist ändert sich nur noch über die Season (oder Liga N) und **Vorgaben übertragen** – auch bei
älteren Seasons: dort ist das Feld leer und jede Staffel behält ihre bisherige Frist, bis du in der Season einen Wert
einträgst und überträgst.

Eine Staffel lässt sich nur **vor dem Start** löschen – in der Turnierliste oder auf der Season-Seite (2.9). Danach
bleibt sie: Status **Abgesagt** oder **Archiviert**. In der Turnierliste tragen Staffeln das Kennzeichen „Liga ·
Staffel A“; der Filter **Nur Liga-Staffeln** zeigt nur sie.

### 2.7 Vorgaben später ändern und übertragen

Eine Staffel trägt die Werte, die beim Anlegen galten. Ändert ihr danach etwas an der Season, steht oben „Die
bestehende Staffel trägt noch die alten Werte“ – **Jetzt übertragen** bzw. im Reiter **Ligen und Staffeln** **Vorgaben übertragen**. Was nicht
mehr geht, steht je Staffel mit Grund da:

| Was | Wird übertragen |
| --- | --- |
| Regeltext, Map-Pool | immer (ein entfernter Pool verschwindet nur vor dem ersten Ergebnis; Spiele mit festgehaltenem Pool behalten ihn) |
| Antwortfrist auf Terminvorschläge | auch während der Season – gilt für neue Vorschläge; nicht bei gesperrten Staffeln. Ist das Feld der Season leer (ältere Seasons), behält jede Staffel ihre Frist |
| Ergebnisregeln und Punktepflicht | auch während der Season – gilt für neue Meldungen, fertige Ergebnisse bleiben; nicht bei gesperrten Staffeln |
| Termine und Kalender (Beginn, Wochen, Sperrzeiten, Standardtermin, Runden, Staffelgröße) | nur vor dem Start |
| Best of, Teamgröße, Mindestkader, Punkte, Modus je Map, Map-Wiederholung, Fristen | nur vor dem ersten Ergebnis |
| Sichtbarkeit | sofort beim Speichern, ohne Übertragen |
| Terminregeln (Kasten „Termine und Verschiebungen“) | sofort beim Speichern des Kastens; gesperrte Staffeln beim Übertragen |

### 2.7a Termine und Verschiebungen (Regelwerk § 7)

Im Reiter **Termine** der Season-Seite steht der Kasten **Termine und Verschiebungen** (Zuständigkeit „Season konfigurieren“). Er hat ein eigenes
**Terminregeln speichern** und gilt sofort für alle Staffeln der Season. Neue Seasons bekommen die Vorgaben; eine ältere Season
sagt „Diese Season ist älter als die Terminregeln“ – dort gilt ein Vorschlag der Heimseite sofort und es gibt keine
Verschiebung, bis ihr einmal speichert.

| Feld | Vorgabe | Wirkung |
| --- | --- | --- |
| **72-h-Regel** (an/aus) und **Frist (Stunden)** | an, 72 | Antwortet die Gastseite nicht auf einen Vorschlag der Heimseite, gilt er nach der Frist – nur in der Spielwoche, nicht in einer Sperrzeit, nur in der Zukunft. Sonst gilt der Standardtermin. Sperrzeiten zählen nicht mit |
| **Verschieben bis (Stunden vor dem Termin)** | 24 | später beantragen geht nicht mehr |
| **Verschiebungen je Spiel** | 2 | 0 heißt: nur die Leitung verschiebt |
| **Verschieben nur innerhalb der Spielwoche** | an | wochenübergreifend entscheidet die Leitung |
| **Erinnerung ohne Ergebnis** | 24 h nach dem Termin | Nachricht an Captain und Vertreter beider Seiten |
| **Überfällig nach** | 48 h nach dem Termin | das Spiel steht bei euch unter **Mein Dienst → Braucht deine Entscheidung** |

Alles, was über diese Grenzen geht (später, öfter, in eine andere Woche), legt die Liga-Leitung fest – siehe 3.1.

### 2.8 Sichtbarkeit

| Einstellung | Ligaseite und Menüpunkt „Liga“ | Staffel-Turnier |
| --- | --- | --- |
| **Aus** | niemand („Liga nicht gefunden“) | intern |
| **Nur Liga-Leitung** | Bereich Ligen und Zuständige dieser Liga – zum Prüfen vor dem Start | intern |
| **Nur Mitglieder** | angemeldete Mitglieder | Nur Mitglieder |
| **Öffentlich** | alle | öffentlich |

Die Sichtbarkeit steht im Reiter **Überblick** und gilt beim **Überblick speichern** sofort für alle Staffeln. Wer in einer Staffel spielt, sieht seine
Spiele, Termine und den Matchchat immer – auch bei *Aus*.

**Prüfung vor der Veröffentlichung:** **Was fehlt noch?** im Reiter **Überblick** listet **Probleme** (rot) und **Warnungen**; jeder Punkt führt mit **Zu …** in den Reiter, wo du ihn erledigst. Probleme
sind: kein oder ein fremder Map-Pool, zu wenige Maps für einen Modus, ein Modus aus **Modus je Map** fehlt im Pool, **Modus je Map**
passt nicht zur längsten Serie, kein veröffentlichtes **Regelwerk** (ein Regeltext allein reicht nicht), keine Liga N oder eine Liga
N ohne Staffel, ein Anmeldefenster, das erst nach dem Beginn der Season endet. Warnungen sind etwa ein abgelaufenes oder fehlendes
Anmeldefenster oder inaktive Modi und Maps im Pool. *Nur Liga-Leitung* ist eine **Vorschau** und geht immer, auch mit Problemen.
Solange es Probleme gibt, lässt sich die Sichtbarkeit aber nicht auf **Nur Mitglieder** oder **Öffentlich** stellen – weder von *Aus*
noch von der Vorschau aus; das Speichern sagt dann, was fehlt. **Neu prüfen** liest den Stand nach Änderungen neu. Nur der Superadmin
kann im Notfall trotzdem veröffentlichen: Er trägt im Abschnitt einen **Grund für die Notausnahme** ein (mindestens 5 Zeichen) und
tippt **Überblick speichern**; der Grund steht im Protokoll. Von *Nur Mitglieder* weiter auf *Öffentlich* prüft nichts mehr.

### 2.9 Korrigieren, archivieren, löschen

Falsch angelegt? So kommst du zurück – Löschen geht nur, solange nichts gespielt oder zugeteilt ist; danach
**archivierst** du (ausgeblendet, aber alles bleibt erhalten).

**Liga bearbeiten:** **Admin → eSports → Liga** → Stift in der Zeile der Liga. Name, Beschreibung und **Stand**
(*Aktiv*/*Archiviert*) gehen immer. Das **Spiel** nur, solange keine Season eine Staffel hat (die Modus-Reihenfolge
der Seasons wird dabei geleert, den Map-Pool neu wählen). Die **Adresse** (`/liga/…`) nur, bis eine Season zum ersten
Mal sichtbar war – danach bleibt sie, damit geteilte Links weiter gehen.

**Season bearbeiten:** auf der Season-Seite wie in 2.2; archivieren im Reiter **Überblick** über **Stand → Archiviert**.
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

**Staffel löschen:** auf der Season-Seite im Reiter **Ligen und Staffeln** der Papierkorb in der Zeile der Staffel – nur im **Entwurf** und vor dem
festen Spielplan, wie in der Turnierverwaltung. Zugeteilte Co-Teams werden dabei aus der Staffel genommen (das Blatt
sagt, wie viele); Grund eintragen → **Endgültig löschen**. Nach dem Start: Status **Abgesagt** oder **Archiviert** in
der Turnierverwaltung.

### 2.10 Gestaltung: Emblem, Banner, Farbe und Gewinne

Alles freiwillig – ohne Gestaltung sieht die Ligaseite aus wie bisher (Liga-Zeichen, kein Banner, Vereinsfarbe).
Gestaltung wirkt beim **Speichern sofort**, ohne „Vorgaben übertragen“.

| Was | Wo | Hinweise |
| --- | --- | --- |
| **Akzentfarbe** | Stift bei der Liga → *Gestaltung* | Farbe für Kopf, Zeichen und Abzeichen der Ligaseite. Zu dunkle Farben lehnt die Seite ab (sie wären auf dem dunklen Grund nicht lesbar, nötig ist ein Kontrast von 4,5 : 1). **Vereinsfarbe** setzt sie zurück |
| **Emblem** | Stift bei der Liga, auf der Season-Seite überschreibbar | Quadratisch, am besten SVG oder PNG mit durchsichtigem Hintergrund. Zuständige ohne Admin-Medien laden PNG, JPG oder WebP hoch, kein SVG. Über **Hochladen** oder die **Mediathek** – eine fremde Adresse geht nicht. Zu sehen auf Ligaseite, Ligaübersicht, Teamseite (Abschnitt *Liga*) und Spielseite einer Staffel |
| **Banner** | Stift bei der Liga, auf der Season-Seite überschreibbar | Breitformat (16 : 9 reicht). Am Desktop zeigt die Ligaseite einen breiten Streifen (3 : 1), am Handy einen höheren Ausschnitt (4 : 3). Unter dem Bild **Fokuspunkt für Desktop** bzw. **Handy** wählen und ins Bild klicken – dieser Punkt bleibt beim Zuschneiden sichtbar; die Vorschau zeigt beide Zuschnitte |
| **Gewinne** | Season-Seite, Reiter **Überblick** → *Gestaltung und Gewinne*; je Liga N über den Stift | Platz → Preis, optional mit Bild (etwa der Pokal). Die Ligaseite zeigt sie als **„Um was gespielt wird“**. Eine Liga N ohne eigene Gewinne spielt um die der Season |

**Rückfälle:** Season → Liga → Standard. Leert die Season ihr Emblem oder Banner, gilt wieder das der Liga; die
Season-Seite zeigt das geerbte zur Vorschau.

**Wo das Banner noch auftaucht:** in der **Link-Vorschau** (Teilen in WhatsApp, Discord …) einer öffentlichen Season
und bei den **Staffeln** – die App zeigt eine Staffel als Turnier mit ihrem Banner. Hat eine Staffel in der
Turnierverwaltung ein eigenes Banner bekommen, bleibt das stehen.

**Gewinne sind reine Anzeige:** Staffeln zählen weiter nicht für XP, Pokale oder die Jahreswertung.

### 2.11 Bereich Ligen und Zuständige

**Einmal nach dem Update (nur der Superadmin):** Die Rolle Turnierleitung und die Freigabe „Turnierleitung“ öffnen die Liga nicht
mehr. Superadmin und Club-Admin haben den Bereich **Ligen** von selbst, alle anderen bekommen ihn einzeln. Nichts geschieht
automatisch. Bis zu dieser Vergabe sehen bisherige Turnierleiter von der Liga nur noch, was alle sehen.

1. **Admin → Alle Benutzer** öffnen und die Person suchen.
2. **Bearbeiten** tippen.
3. Unter **Freigaben** den Haken bei **Ligen** setzen.
4. **Speichern** und die Rückfrage bestätigen. Die Person bekommt eine Meldung, die Vergabe steht im Protokoll.
5. Die Person braucht die Zwei-Faktor-Anmeldung. Hat sie noch keine, steht das in ihrer Meldung.

**Zuständige je Liga:** Wer nur einen Teil machen soll, bekommt den Bereich nicht, sondern eine Zuständigkeit in einer Liga.

1. **Admin → eSports → Liga** öffnen und bei der Liga **Zuständige** tippen.
2. Unter **Person hinzufügen** den Namen tippen und die Person wählen.
3. Anhaken, wofür sie zuständig ist, dann **Zuständig machen**.

| Zuständigkeit | Was die Person darf |
| --- | --- |
| **Liga verwalten** | Liga bearbeiten, Seasons anlegen und löschen, Staffel starten, pausieren, beenden und sperren, Helfer der Staffel. Sieht auch, wer zuständig ist |
| **Season konfigurieren** | Vorgaben, Map-Pool, Liga 1, 2 …, Staffeln anlegen und löschen, Übertragen, Spielplan |
| **Teams freigeben** | Co-Teams zuteilen und herausnehmen, Austritt |
| **Kader prüfen** | Kaderübersicht mit Spiel-IDs, neue ID freigeben, Stichtag |
| **Spiele betreuen** | Termine festlegen, Terminvorschläge entscheiden, Spielplan freigeben |
| **Ergebnisse korrigieren** | Ergebnis eintragen und korrigieren, Rückgängig, kampflos und „nicht erschienen“ werten, Aufstellung nachtragen |
| **Proteste** | Streitfälle entscheiden. Für „Ergebnis ändern“ im Streitfall braucht es zusätzlich **Ergebnisse korrigieren** |
| **Strafen** | Vorgesehen, kommt später |
| **Regeln veröffentlichen** | Regelwerk der Liga und der Season (2.11) |

- Zuständige brauchen keinen Bereich, aber die Zwei-Faktor-Anmeldung. Ohne sie gilt die Zuständigkeit nicht, das Blatt sagt es an der Zeile.
- Zuständige finden ihre Ligen unter **Admin → Mein Dienst → Meine Ligen** und im Menü unter **Liga**. Sie sehen nur ihre Ligen und nur die Knöpfe ihrer Zuständigkeiten. Das gilt auch für Turnierleitung und Helfer, die zugleich zuständig sind.
- **Bilder:** Zuständige ohne Admin-Medien laden Emblem, Banner und Gewinnbilder als eigene Bilder hoch (kein SVG), die Mediathek zeigt ihnen nur diese.
- Vergeben und entfernen darf nur der Bereich **Ligen**. Liga anlegen und löschen auch.
- **Co-Teams in einer laufenden Staffel:** Kader, Captain, Vertreter und Status ändern nur noch die eigene Teamleitung und die Liga-Leitung mit **Kader prüfen** (Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** → **Kader bearbeiten**). Die Turnierleitung nicht mehr. Nach dem Ende der Staffel gilt wieder alles wie vorher.
- **Helfer** am Turnier (Organisation, Schiedsrichter, Ergebnisdienst, Station) lesen in einer Staffel nur noch. Ergebnisse tragen dort nur Zuständige und der Bereich Ligen ein.

**Befangenheit:** Wer in einem Spiel selbst beteiligt ist (Kader einer Seite, Captain, Vertreter, Hauptteam-Leitung), korrigiert dort
keine Ergebnisse, entscheidet keine Proteste, verhängt keine Strafen und setzt keinen Termin direkt. Die Matchseite und der Matchplan sagen es, der
Knopf fehlt, und die Person meldet als eigene Seite wie alle anderen, den Termin über Vorschlag und Zustimmung. Es entscheidet eine zweite berechtigte Person. Nur der **Superadmin** darf als Notausnahme: Das Ergebnis-Fenster
oder der Matchplan fragt dann nach dem Grund, er steht im Protokoll (`league.conflict.override`).

**Ergebnis mit „Rückgängig“:** Verliert jemand in den 10 Sekunden die Zuständigkeit oder wird befangen, geht das Ergebnis nicht hinaus. Die Person bekommt eine
Nachricht, der Vorgang steht im Protokoll.

**Bekannte Grenze – Strafen-Eingang:** Admin → eSports → Strafen hängt bis #2208 am Bereich Turnierleitung. Kampflos-Wertungen einer Staffel siehst du dort nur mit
beiden Bereichen, Turnierleitung und Ligen. Mit nur einem von beiden fehlen sie. Am Spiel selbst bleibt die Wertung sichtbar.

---

### 2.11 Regelwerk: Versionen, PDF und Zustimmung

Das Regelwerk hat eine eigene Seite mit Inhaltsverzeichnis, Suche und festen Links auf jeden Paragrafen, dazu ein PDF je Version. Gepflegt
wird es an einer Stelle: **Season → Reiter Regelwerk und Sperrliste → Regelwerk mit Versionen pflegen** (nur diese Season; **zurück** führt wieder in den Reiter) oder **Liga → Regelwerk**
(für alle Seasons ohne eigenes). Fertige Dateien hochladen geht bewusst nicht, das PDF entsteht aus dem Text.
Das dürfen der Bereich **Ligen** und Zuständige mit **Regeln veröffentlichen** in dieser Liga, mit Zwei-Faktor-Anmeldung. Die Turnierleitung allein darf es nicht.

1. **Neuen Entwurf beginnen.** Titel und Text in Markdown. Jede Überschrift wird ein Abschnitt mit eigenem Link. Bleibt sie gleich, bleibt auch
   der Link über alle Versionen gleich.
2. **Anlagen** bekommen ihren Buchstaben aus der Reihenfolge (Anlage A, B, C …) und stehen eigens im Inhaltsverzeichnis.
3. **Bausteine:** Die Knöpfe setzen eine Marke in den Text, etwa `[[baustein:map_pool]]`, und werden in den **zuletzt benutzten Editor**
   eingefügt (Haupttext oder Anlage). Der Inhalt kommt aus den Einstellungen der Season - tippe Listen, Ziele oder Zeiten also nie ab.
   Im Web stehen sie schön mit Symbolen und Bildern, im PDF als schlichte Liste oder Tabelle. Alle Bausteine:

   | Baustein | Marke | Zeigt | Quelle in der Verwaltung |
   | --- | --- | --- | --- |
   | Map-Pool | `[[baustein:map_pool]]` | Tabelle Modus · Maps | Season → Spielbetrieb → Map-Pool |
   | Modusfolge | `[[baustein:mode_order]]` | Modus je Map | Season → Spielbetrieb → Serie |
   | Sperrliste | `[[baustein:loadout_bans]]` | gesperrte Waffen, Aufsätze, Ausrüstung mit Bild (gedacht für Anlage A, 2.1a) | Season → Regelwerk und Sperrliste |
   | Einstellungen je Modus | `[[baustein:mode_settings]]` | je Modus Zeitlimit, Zeit je Runde, Einstellungen (Tabelle), Regeltext | Spiel → Modi, Season → Ergebnisregeln |
   | Modi der Season | `[[baustein:modes]]` | Tabelle Modus (mit Symbol) · Ergebnisregel in Klartext (Ziel, Runden, Verlängerung, Remis) · Zeit · Spieler je Seite | Season → Spielbetrieb → Modi, Ergebnisregeln |
   | Spielformat | `[[baustein:format]]` | Best of, Teamgröße, Mindest- und Höchstkader, Map-Wiederholung, Teilnehmerliste; Abweichungen je Liga N | Season → Spielbetrieb → Serie, Anmeldung und Kader, Ligen |
   | Tabelle und Wertung | `[[baustein:table]]` | Punkte, Remis, Reihenfolge bei Punktgleichheit, kampflos, beide nicht erschienen, Ausscheiden | Season → Tabelle |
   | Termine | `[[baustein:schedule]]` | Spielwochen, Standardtermin, Sperrzeiten, Antwortfrist, 72-h-Regel, Verschiebungen, Erinnerung und überfällig | Season → Termine |
   | Spielberechtigung | `[[baustein:eligibility]]` | Zulassung, Mindestalter, Spiel-IDs, ein Co-Team je Season, Wartezeit, Stichtag, Transferfenster | Season → Anmeldung und Kader, Spiel → Spiel-IDs |

   Der Baustein **Check-in** kommt mit den Check-in-Regeln (D.2); bis dahin lehnt das Veröffentlichen ihn wie jede unbekannte Marke ab.
4. **Variablen** stehen mitten im Satz, etwa „Gespielt wird Best of `{{best_of}}`“, und werden beim Lesen durch den Wert der Season
   ersetzt. **Variable einfügen** zeigt die Liste mit dem Wert von heute (mit Suche); die **Hilfe** darunter nennt alle Bausteine und
   Variablen. Eine Variable **ohne Wert** in dieser Season (etwa ohne Höchstkader) steht als „(nicht festgelegt)“ im Text - nie still leer.
   Eine **unbekannte** Variable (Tippfehler) nennt die Vorschau, und das Veröffentlichen lehnt sie mit der ganzen Liste ab.

   | Variable | Wert |
   | --- | --- |
   | `{{league.name}}`, `{{game.name}}` | Name der Liga, des Spiels |
   | `{{season.name}}`, `{{season.number}}`, `{{season.start}}`, `{{season.end}}`, `{{season.weeks}}` | Season, Nummer, erster und letzter Tag, Spielwochen |
   | `{{best_of}}`, `{{maps_to_win}}`, `{{team_size}}`, `{{min_squad_size}}`, `{{max_squad_size}}`, `{{map_repeat}}` | Serie, Maps zum Sieg, Teamgröße, Kader, Map-Wiederholung in Worten |
   | `{{lineup_mode}}`, `{{lineup_min_players}}`, `{{result_confirm_hours}}`, `{{lineup_amend_hours}}` | Aufstellung, Mindestzahl, Bestätigungs- und Nachtragsfrist |
   | `{{schedule.matchday_days}}`, `{{schedule.default_weekday}}`, `{{schedule.default_time}}`, `{{schedule.default_slot}}`, `{{schedule.response_hours}}`, `{{schedule.blocked_periods}}` | Spielwoche, Standardtermin („Sonntag, 20:00 Uhr“), Antwortfrist, Sperrzeiten |
   | `{{schedule.home_rule_hours}}`, `{{schedule.reschedule_max}}`, `{{schedule.reschedule_notice_hours}}`, `{{schedule.result_reminder_hours}}`, `{{schedule.result_overdue_hours}}` | Terminregeln (2.7a) |
   | `{{table.points_win}}`, `{{table.points_draw}}`, `{{table.points_loss}}`, `{{table.draws}}`, `{{table.tiebreakers}}`, `{{table.head_to_head}}`, `{{table.forfeit_score}}`, `{{table.exit_rule}}` | Punkte, Remis, Reihenfolge bei Punktgleichheit, direkter Vergleich, kampflos, Ausscheiden |
   | `{{eligibility.min_age}}`, `{{eligibility.wait_days}}`, `{{eligibility.roster_deadline}}`, `{{eligibility.transfer_windows}}`, `{{eligibility.entry_policy}}`, `{{eligibility.id_fields}}` | Spielberechtigung (3.9) |
   | `{{application.opens}}`, `{{application.closes}}`, `{{application.slots}}` | Anmeldefenster und Startplätze (2.5a) |
   | `{{mode:<kennung>.name}}`, `.rule`, `.target`, `.round_limit`, `.time_limit`, `.round_time`, `.players`, `.overtime`, `.draw` | je Modus: Name, Regel in Klartext, Ziel, Rundenlimit, Zeitlimit, Zeit je Runde, Spieler je Seite, Verlängerung und Remis („ja“/„nein“). Die Kennung steht in der Liste. |

5. **Vorschau** zeigt die Seite mit den Werten von heute und den Änderungen zur letzten Version.
6. **Veröffentlichen:** **Gültig ab**, **Änderungsgrund** (steht öffentlich dabei) und die Wahl, ob **Captains neu zustimmen** müssen. Danach lässt sich
   die Version nicht mehr ändern. Bausteine und Variablen werden eingefroren: alte Versionen zeigen ihre Werte von damals, im Web und im PDF.

**Was die Seite selbst macht:** Sie vergleicht jede Version mit der vorigen. Geänderte Paragrafen tragen einen Strich am Rand und das Wort
„Geändert“, oben steht „Neu in Version X“ mit Links zu den Stellen. Leser können die Markierung ausblenden und Wort für Wort mit jeder alten Version
vergleichen, auch entfernter Text ist dann zu sehen.

**Regelwerk muss freigegeben werden.** Änderst du eine Einstellung, die im Regelwerk steht (Modus umbenannt, Ziel geändert, Best of, Map-Pool,
Sperrliste …), ändert sich die veröffentlichte Version **nie von selbst**. Die Verwaltung zeigt an drei Stellen **Regelwerk muss freigegeben
werden**: im Season-Überblick, in **Mein Dienst** (für wer „Regeln veröffentlichen“ darf) und auf der Regelwerk-Seite. Dort steht, welche
Bausteine und Variablen sich geändert haben (alt durchgestrichen, neu unterstrichen), und darunter der **Vorschlag**: die neue Fassung mit
den Werten von heute, geänderte Paragrafen markiert. Du prüfst, setzt **Gültig ab** und **Änderungsgrund** (vorbelegt mit den geänderten
Stellen), wählst, ob **die Teams neu zustimmen** müssen, und klickst **Freigeben und veröffentlichen**. Willst du den Text vorher anpassen:
**Text vorher anpassen** legt den Entwurf an. Bis zur Freigabe gilt und zeigt die alte Version.

**Zustimmung:** Verlangt eine Version Zustimmung, sehen Captain und Vertreter (ohne beide die Leitung des Hauptteams) **Neue Fassung, bitte
zustimmen** - als Aufgabe auf der Startseite, auf der Regelseite, auf der Ligaseite, auf der Team-Seite (Spielberechtigung des Co-Teams) und auf
jeder Matchseite der Staffel. Der Stand je Co-Team steht unter **Zustimmungen**. **Fehlt sie, läuft das Spiel trotzdem**, nichts wird blockiert.

**Auffindbar:** Das Regelwerk steht auf der Liga-Übersicht (`/liga`, Link **Regeln** je Season), auf der Ligaseite, auf der Team-Seite und auf
der Matchseite, je mit Version, Stand und PDF.

**Gut zu wissen:**

- Ohne Regelwerk zeigt die Ligaseite weiter den **Regeltext** der Season. Mit Regelwerk steht dort ein Link mit Version und Stand plus PDF.
- Die Staffel zeigt mit Regelwerk nur noch den Hinweis auf die Regelseite, auch in der App.
- Jedes festgeschriebene Ergebnis merkt sich die Version, die gerade galt. Eine spätere Korrektur ändert das nicht.
- Die Seite folgt der Sichtbarkeit der Season (2.8), alte Versionen auch.
- **Bilder** nur über **Hochladen** oder die Mediathek. Eine fremde Adresse lehnt das Speichern ab, sie geht nur als Link. Zuständige ohne Admin-Medien nehmen ihre eigenen Bilder; was eine andere Person schon in den Entwurf gestellt hat, darf stehen bleiben.
- **Im PDF** steht ein Bild auf eigener Zeile als Bild, sonst als `[Bild: …]`. Die PDF-Schrift kann nur Westeuropäisches: Zeichen wie → werden umschrieben, Emoji fallen weg.
- Eine **veröffentlichte Version** bleibt, wie sie ist: Ihre Bilder lassen sich in der Mediathek weder drehen noch löschen. Für ein neues Bild eine neue Version veröffentlichen.
- Eine Season oder Liga mit veröffentlichtem Regelwerk oder mit Zustimmungen lässt sich nicht mehr löschen, nur archivieren. Entwürfe gehen mit.
- Ein Regelwerk darf mit allen Anlagen höchstens 400 000 Zeichen und 400 Überschriften haben.

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
- **Termin oder Best of direkt am Spiel ändern:** steht mit altem und neuem Wert im Protokoll, und Captain und Vertreter
  beider Seiten bekommen eine Nachricht – je Änderung eine.
- **Eigener Vorschlag:** steht bei der eigenen Seite als „wartet auf die Gegenseite“ mit **Zurückziehen**; annehmen
  kann ihn nur die Gegenseite. Zurückgezogen ist kein Vorschlag mehr offen – keine Antwortfrist, keine Eskalation.
- **Antwortfrist:** Jeder neue Vorschlag und Gegenvorschlag bekommt eine neue Frist, Annehmen beendet sie. Läuft sie ab,
  steht das Spiel auf „Turnierleitung nötig“ und ihr bekommt eine Nachricht.
- **Ablehnen:** Gilt danach ein Termin (der vereinbarte oder der Standardtermin), bleibt es dabei: kein „abgelehnt“ am
  Spiel, keine Frist, keine Nachricht an euch. Nur wenn wirklich kein Termin gilt, läuft die Frist weiter.
- **Standardtermin in einer Sperrzeit:** Fällt der Standardtag hinein, gilt zur selben Uhrzeit der nächste freie Tag der
  Woche, sonst der letzte davor. Hat die Woche keinen freien Tag, steht im Matchplan unter **Spielwochen** ein Hinweis
  statt eines Termins – dann legt ihr ihn fest.
- **Startseite:** Offene Vorschläge der Gegenseite stehen bei Captain und Vertreter unter **Offene Aktionen** als
  „Terminvorschlag beantworten“ – auf der Website und in der App.

**Mit Terminregeln (2.7a):**

- **Fester Termin:** Haben sich beide Seiten geeinigt (oder galt die 72-h-Regel, oder habt ihr ihn gesetzt), steht der
  Termin fest. Neue Vorschläge gehen dann nicht mehr – nur noch die **Verschiebung**. Der Standardtermin allein ist kein
  fester Termin: Bis zu einer Einigung bleibt die Terminabstimmung offen.
- **72-h-Regel:** Läuft die Frist für einen Vorschlag der Heimseite ohne Antwort ab, gilt er; beide Seiten bekommen eine
  Nachricht, im Verlauf steht „72-h-Regel“. Die Matchseite sagt vorher, ab wann er gilt.
- **Verschiebung:** Auf der Matchseite unter **Termin und Verschiebung**: Eine Seite beantragt mit neuem Termin und
  **Grund**, die andere stimmt zu oder lehnt ab. Die Seite zeigt die Grenze im Klartext („Noch 1 Verschiebung möglich,
  beantragen bis Sa 14.11. 20:00“). Später, öfter oder in eine andere Woche geht nur über euch – die Captains sehen dann
  den Hinweis auf @leitung im Matchchat.
- **Termin festlegen:** Mit „Spiele betreuen“ steht auf der Matchseite **Termin festlegen (Liga-Leitung)** mit Pflichtgrund.
  Er gilt sofort, offene Anträge sind damit erledigt, beide Seiten bekommen eine Nachricht. Im eigenen Spiel legt ihn eine
  zweite Person fest (Befangenheit, 2.11); der Superadmin nur als Notausnahme mit Grund im Matchplan.
- **Verlauf:** Jede Änderung steht unter **Verlauf** – Einigung, 72-h-Regel, Standardtermin, Verschiebung, Liga-Leitung,
  mit Person und Grund. Sehen können ihn nur die beiden Seiten und die Leitung.
- **Überfällig:** Ist ein Spiel nach dem Termin nie gemeldet, erinnert die Seite beide Seiten (Vorgabe nach 24 Stunden);
  nach der zweiten Frist steht es unter **Mein Dienst → Braucht deine Entscheidung**, und ihr bekommt eine Nachricht.
  Entscheiden heißt: Ergebnis eintragen, kampflos werten oder einen neuen Termin festlegen. Ohne Entscheidung schließt
  die Season später nicht ab.

### 3.1a Turnier nach dem Ende noch „Live“

Gilt für alle Turniere: Steht ein Turnier nach seinem eingetragenen Ende noch auf **Live**, sagt es euch **Mein Dienst**
(und die Startseite der Verwaltung) unter **Braucht deine Entscheidung**: „Läuft laut Stand noch, Ende war am … – beenden?“.
Sind noch Spiele offen, zeigt die öffentliche Seite weiter **Läuft**; sind alle fertig, zeigt sie **Beendet**, und ihr stellt
auf „Beendet“ bzw. „Ergebnisse veröffentlichen“ – erst dann gelten Gewinne und Saisonpunkte. Umgestellt wird nie von
selbst. Die Turnierliste zeigt denselben Hinweis neben dem Stand.

### 3.2 Ergebnisse

Melden mit Maps und Teilnehmerliste (nur im Web), Bestätigen im Web oder in der App, die 48-Stunden-Regel und
was dabei geprüft wird, steht für die Captains in
[Turniere, 3.16](turniere.md#316-liga-ergebnis-je-map-melden-für-captains) – zum Weitergeben gibt es den
[Spickzettel](liga-captains.md). Für die Turnierleitung dazu:

- **Selbst eintragen**: Reiter **Spiele** → **Ergebnis eintragen** – Stand, auf Wunsch Maps und die Teilnehmerlisten
  beider Seiten; eine fehlende Seite trägt ihre Liste danach selbst nach. Siehe
  [Turniere, 3.6](turniere.md#36-ergebnisse-melden-eintragen-korrigieren).
- **Kampflos**: im Ergebnis-Fenster **Nicht erschienen** auf der fehlenden Seite. Schon eingetragene Maps fallen dabei
  weg, der alte Stand bleibt im Verlauf des Spiels. Die Wertung ist eine Teamstrafe: Captain, Vertreter und die Leitung
  des Hauptteams sehen sie unter **Meine Strafen**, in **Admin → Strafen** steht sie einmal unter dem Co-Team.
- **Beide nicht erschienen**: am Spiel **Beide nicht erschienen** (nur in einer Staffel, nur ohne Ergebnis, mit
  Begründung). Beide verlieren, keine Punkte, keine Maps, je Seite ein Eintrag „nicht erschienen“; im Spielplan steht
  „beide nicht erschienen“. Wollt ihr das Spiel doch nachholen: am selben Spiel **Neu ansetzen** mit Grund – das Spiel ist
  wieder offen, den Termin setzt ihr wie gewohnt. Recht: **Ergebnisse korrigieren**, nicht im eigenen Spiel.
- **Kein automatisches „Nicht erschienen?“**: Ohne Check-in sagt ein Termin nichts darüber, ob jemand da war. Deshalb gibt
  es in der Liga diesen Vorschlag nicht – fehlt ein Ergebnis, meldet sich **Ergebnis fehlt**. Klärt es mit beiden Seiten
  und wertet dann selbst. Das kommt mit dem Check-in (#1652) neu.

### 3.3 Teilnehmerliste nachtragen

**Am Schluss hakt jedes Team einmal an, wer gespielt hat**: alle, die mindestens eine Map gespielt haben. Mindestens drei, bei Wechseln auch sechs und mehr. Es gibt keine Eingabe vor oder je Map; Maps, Modi und Endstände bleiben je Map Pflicht. Jedes Team trägt nur seine eigene Seite ein.

Fehlt nach der Bestätigung eine Liste (etwa nach einer Bestätigung in der App oder nach den 48 Stunden), **bleibt das Ergebnis gültig**. Captain oder Vertreter dieser Seite tragen die Liste bis **48 Stunden ab der Bestätigung** im Web nach; bis dahin steht bei ihnen auf der Startseite die Aufgabe. Danach bekommt ihr den Fall als Nachricht **Teilnehmerliste fehlt nach der Frist**: am Spiel **Fehlende Teilnehmerliste nachtragen (Liga-Leitung)** mit einem Grund, oder ihr entscheidet anders. Eine fehlende Liste ist keine Wertung. **Wer nicht auf der Liste steht, zählt nicht als Einsatz.** Für die Tabelle spielt die Liste keine Rolle; sie zählt für den Doppel-Einsatz und für Auszeichnungen.

Staffeln, die noch **je Map** aufstellen (ältere Seasons oder **Wer gespielt hat → Aufstellung je Map**), laufen wie bisher: die eigene Aufstellung bis 48 Stunden nach dem Ergebnis, danach die Leitung mit **Ergebnis korrigieren**. Alte Spiele bleiben lesbar.

### 3.4 Einspruch und Korrektur

- **Einspruch**: Stimmen Maps oder Sieger nicht, tippt die Gegenseite **Stimmt nicht** bzw. **Problem melden** →
  **Falsches Ergebnis** mit kurzem Text. Möglich vor dem Ergebnis immer, danach 30 Minuten; hat die
  48-Stunden-Automatik entschieden, bis zum Ende der Spielwoche. Später nur über die Turnierleitung (Matchchat mit
  **@leitung**).
- **Entscheiden**: Turnierleitung am Handy → **Braucht Aufmerksamkeit**, oder auf der Matchseite **Streitfall
  entscheiden**: **Ergebnis bleibt** oder **Ergebnis ändern**. Wer am Spiel selbst beteiligt ist, entscheidet nicht
  ([2.11](#211-bereich-ligen-und-zuständige)).
- **Korrigieren**: am Spiel **Ergebnis korrigieren** – Stand, auf Wunsch Maps und Aufstellungen, Pflicht ist ein
  **Grund** (mindestens fünf Zeichen). Die Korrektur schließt einen offenen Einspruch, die Tabelle rechnet sofort neu.
  Ohne neue Maps bleiben die alten, solange sie zum Stand passen – sonst fallen sie weg. Ablauf wie in
  [Turniere, 3.7](turniere.md#37-dispute-streit-um-ein-ergebnis).
- **Ergebnisregeln gelten auch für die Leitung** (2.2, Schritt 5): Eintragen und Korrigieren prüfen dieselben Endstände
  wie die Meldung der Captains. Passt ein Endstand wirklich nicht zur Regel (etwa nach einem Absturz), darf die
  **Liga-Leitung mit der Zuständigkeit „Ergebnisse“** sie übergehen: im Ergebnis-Fenster **Ergebnisregel übergehen
  (Liga-Leitung, mit Grund)** einen Grund eintragen (mindestens fünf Zeichen). Best of, Map-Pool und Aufstellung gelten
  trotzdem; der Grund steht im Protokoll. Im eigenen Spiel entscheidet eine zweite Person (2.11), der Superadmin nur als
  Notausnahme mit Grund. Captains können eine Regel nie übergehen.
- **Wiederholte und zugesprochene Maps**: Über die Schnittstelle kann eine Map als **wiederholt** (mit Grund) markiert
  oder von der Leitung **zugesprochen** werden (ohne Punkte, ohne Regel). Die Matchseite zeigt beides an der Map; nach
  dem Serienende steht dort, welche Maps nicht gespielt wurden.

### 3.5 Tabelle und Ligaseite

Die Tabelle steht auf der Ligaseite je Staffel (und in der Turnierverwaltung): Punkte, Spiele, Differenz, Form der
letzten fünf Spiele, Bewegung seit dem letzten Spieltag. Darunter die Spielwochen mit Pause und Reserve, jedes Spiel
mit Termin, Ergebnis, Sieger und den Maps – ohne Aufstellungen. Website, App, TV, Druck und Ergebnis-PDF zeigen dieselbe
Reihenfolge.

<img src="../assets/liga/liga-tabelle-gleichstand-pc.png" alt="Staffel-Tabelle: unter den Namen klein Direkter Vergleich, kampflos gewonnen, Platz durch Entscheid der Leitung mit Grund und am Ende Ausgetreten; darunter die Reihenfolge bei Punktgleichheit" width="560">

**Punktgleichheit** (Reihenfolge stellt die Season ein, siehe 2.2):

1. **Direkter Vergleich**: nur die Spiele der gleichstehenden Teams untereinander (bei drei und mehr eine
   **Mini-Tabelle**) – Punkte, Map-Differenz, gewonnene Maps. Trennt sie nur einen Teil ab, wird für die übrigen die
   Mini-Tabelle **neu gerechnet**, nur mit ihren Spielen. Der direkte Vergleich zählt nur, wenn **alle Spiele** der
   gleichstehenden Teams untereinander gespielt sind – steht eines noch aus, entscheidet gleich der nächste Punkt.
2. Dann **Map-Differenz** und **gewonnene Maps** über alle Spiele.
3. Stehen Teams danach in allem gleich, **teilen sie sich den Platz** (1, 2, 2, 4) – bis die Leitung entscheidet.

Unter dem Namen steht klein, was den Platz entschied („Direkter Vergleich“, „Map-Differenz“ …), dazu
„kampflos gewonnen/verloren“ und am Ende der Tabelle **Ausgetreten** bzw. **Disqualifiziert**. Unter der Tabelle steht
die Reihenfolge der Kriterien.

**Entscheid der Leitung:** Admin → Liga → Season → Reiter **Tabelle** → **Tabelle und Gleichstand**. Je gestarteter Staffel stehen dort die
geteilten Plätze. **Reihenfolge festlegen** → mit den Pfeilen sortieren → **Grund** (mindestens fünf Zeichen, steht
öffentlich an der Tabelle: „Platz durch Entscheid der Leitung: …“) → **Festlegen**. Das geht nur bei echtem Gleichstand und
nur für alle Teams auf diesem Platz; über das eigene Team entscheidet eine andere Person. Recht: **Ergebnisse
korrigieren**. Ändert ein späteres Ergebnis den Gleichstand, gilt der Entscheid nicht mehr (Hinweis **Gilt nicht mehr**)
und bleibt zur Nachvollziehbarkeit stehen; **Zurücknehmen** löscht ihn mit Grund.

<img src="../assets/liga/liga-gleichstand-entscheid-handy.png" alt="Season-Verwaltung am Handy, Feld Tabelle und Gleichstand: Platz 4 geteilt mit Knopf Reihenfolge festlegen, darunter ein älterer Entscheid mit Gilt nicht mehr und Zurücknehmen" width="300">

**Austritt, Auflösung, Disqualifikation:** In der Teilnehmerliste der Staffel **Austritt eintragen** bzw.
**Disqualifizieren** (eine Auflösung tragt ihr als Austritt mit Grund „Team aufgelöst“ ein). Mit der Vorgabe neuer
Seasons zählen dann **alle** Spiele des Teams für die Gegner, auch schon gespielte – wie ein kampfloser Sieg (Maps des Best
of). Offene Spiele werden kampflos gewertet. Die echten Ergebnisse bleiben im Spielplan und auf der Matchseite sichtbar.
Das Team steht am Tabellenende: wer später ausschied, weiter oben; Disqualifizierte immer darunter. Ein Spiel zwischen
zwei ausgeschiedenen Teams zählt für keinen. Ältere Seasons rechnen weiter mit der 50-%-Regel, bis ihr die Einstellung
ändert und überträgt (nur vor dem ersten Ergebnis).

Staffel- und Spielseite führen zurück zur Ligaseite: Brotkrumen **Liga · Season · Staffel** und auf der Staffel der
Reiter **Liga** (nur, wenn die Person die Season sehen darf – sonst „Liga · Staffel A“ ohne Link).

### 3.6 Captain und Vertreter während der Season

- **Rolle abgeben:** Captain oder Vertreter geben die eigene Rolle unter **Teams → Deine Teams** mit **Rolle
  abgeben** selbst ab. Leitung und Co-Leitung des Hauptteams bekommen eine Nachricht und vergeben neu (Co-Team
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
  (wird beim ersten Aufstellen festgehalten), *fehlt*, *wartet auf Freigabe*, *gesperrt*. Oben die Zahl ohne ID, wartend,
  gesperrt und mit neuer ID im Profil.
- **Späterer Spieler:** Kommt jemand ohne ID oder nach dem Stichtag ins Co-Team, bekommen er und die Verantwortlichen des
  Co-Teams eine Nachricht – wie beim Zuteilen, je Person einmal.
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

### 3.8 Kader, Sperren und Aufstellung

- **Kader zu klein:** Abgänge bleiben möglich – Team verlassen, Mitglied entfernen, aus dem Kader nehmen. Die Rückfrage
  sagt vorher, was das bewirkt. Fällt der Kader einer laufenden Staffel unter den Mindestkader, bekommen Captain, Vertreter,
  Leitung und Co-Leitung des Hauptteams und ihr eine Warnung. Auf deren Startseite steht **Kader auffüllen**, bis er reicht;
  die Season zeigt unter **Kader und Spiel-IDs** oben alle zu kleinen Kader. Spiele und Tabelle ändert das nicht – was ihr
  daraus macht, entscheidet ihr.
- **Gesperrtes Konto:** nicht aufstellbar, auch nicht von euch, auch in Spielen ohne Pflicht-ID. Wer schon in der
  gespeicherten Aufstellung steht, bleibt bei Korrektur und Nachtrag drin (wie bei 3.7). Ein gesperrter Captain oder
  Vertreter zählt nicht: Es handelt der andere, ohne beide die Teamleitung. Die Gegenseite sieht in der Lobby-Liste
  niemanden mit gesperrtem Konto, aber keinen Grund.
- **Beide Seiten:** Dieselbe Person steht nie auf beiden Seiten eines Spiels, über alle Maps – beim Melden, Bestätigen,
  Nachtragen und in eurer Korrektur. Steht sie in einem alten Spiel schon auf beiden Seiten, geht die Korrektur trotzdem
  durch und steht im Protokoll; nehmt sie dabei auf der falschen Seite heraus.

### 3.9 Spielberechtigung: Regeln je Season

Alles sind Vorgaben, jede Season stellt sie selbst ein (2.2). Geprüft wird an einer Stelle: beim Zuteilen, bei der Aufnahme in den Kader, auf der Teilnehmerliste und später beim Check-in. Ältere Seasons tragen die Felder nicht und prüfen nichts Neues.

| Regel | Was passiert |
| --- | --- |
| **Mindest- und Höchstkader** | Über den Höchstkader lässt sich niemand aufnehmen. Unter den Mindestkader führt nur ein Abgang: Der bleibt möglich, es gibt Warnung und Aufgabe (3.8) |
| **Ein Team je Season** | Wer in der Season in einem anderen Co-Team steht oder stand, kommt nur per Transfer. In anderen Seasons und Ligen ist das frei |
| **Wartezeit** | Bis zum Ende von Spieltag 1 spielen Neue sofort. Danach warten sie ab der Aufnahme so viele Tage, auch wenn der Kader dadurch zu klein ist. Wer ins selbe Co-Team zurückkommt, startet keine neue Wartezeit. Das Zuteilen eines Co-Teams durch euch startet keine. **Ein Transfer wartet immer**, auch vor dem Ende von Spieltag 1 |
| **Stichtag** | Optional in der Kaderübersicht: Neue warten auf eure Freigabe, Abgänge bleiben frei (3.7) |
| **Transferfenster** | Die Teamleitung beantragt im Fenster, ihr entscheidet. Nach der Genehmigung wartet die Person ab der Kaderaufnahme die volle Wartezeit, immer und auch wenn sie das alte Co-Team schon verlassen hatte |
| **Mindestalter** | Prüfung über das Geburtsdatum im Profil als Selbstauskunft. Ohne Datum keine Anmeldung und keine Aufnahme. Ihr seht nur „Alter erfüllt“, „Geburtsdatum fehlt“ oder „Altersvorgabe nicht erfüllt“, die Liga nennt nie ein Datum oder Alter |
| **Spiel-ID** | Format und Auswahl stehen am Spiel unter **Admin → Spiele → Zahnrad → Spiel-IDs**: Format als regulärer Ausdruck, Beispiel für die Spieler, Auswahlwerte. So wird auch die **Plattform** zum Pflichtfeld, das einmal je Season festgehalten wird. Eine schon festgehaltene ID bleibt gültig. Eine doppelte ID wird abgelehnt, die Meldung nennt nie, wem sie gehört |

**Wartezeit aufheben:** Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** → beim Spieler **Wartezeit aufheben** → Grund (mindestens fünf Zeichen). Das geht mit der Zuständigkeit **Kader prüfen** und steht im Protokoll.

**Transfer:** Die Teamleitung tippt unter **Spielberechtigung** auf **Transfer beantragen**; die Person muss schon im Hauptteam stehen. Ihr seht den Antrag oben unter **Kader und Spiel-IDs**: **Genehmigen** nimmt die Person aus dem alten Co-Team und setzt sie ins neue, die Wartezeit beginnt, aufheben könnt nur ihr mit Grund; **Ablehnen** braucht einen Grund. Ist die Person im alten Co-Team Captain oder Vertreter, vergibt die Teamleitung die Rolle zuerst neu. Person und beide Teamleitungen bekommen eine Nachricht.

**Eingriff von außen:** Ändert ihr den Kader oder die Rollen eines Co-Teams, bekommen Leitung und Co-Leitung des Hauptteams eine Nachricht: wer, was, wann. Jede Kaderänderung in einer laufenden Staffel steht im Protokoll, auch wenn die Teamleitung sie macht oder jemand das Team verlässt.

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
| „… ist für ein anderes Spiel eingetragen als diese Staffel.“ / „… ist archiviert …“ | Falsches oder altes Co-Team | Co-Team unter **Teams → Deine Teams** prüfen |
| „… hat noch einen alten Spielnamen …“ | Das Spiel wurde früher frei eingetippt und passt zu keinem Spiel der Liste | Die Teamleitung wählt es unter **Teams → Deine Teams** aus der Liste |
| „Captain muss im Kader des Co-Teams stehen.“ / „Captain und Vertreter müssen verschiedene Personen sein.“ | Rollen falsch vergeben | Rollen im Profil neu wählen |
| Co-Team lässt sich nicht entfernen („… Spielplan …“) | Die Staffel ist gestartet | Mit dem Co-Team klären; Spiele notfalls kampflos werten |
| „Eine Liga-Staffel hat keine Anmeldung und keinen Check-in …“ | Status mit Anmeldung oder Check-in gewählt | **Liga starten** (oben) |
| „Turnier kann ohne spielbares Match nicht gestartet werden.“ | Eine ältere Staffel steht noch im Check-in | Status oben auf **Entwurf**, dann **Liga starten** |
| „Best of: Kommt aus der Season – dort ändern und übertragen.“ (ebenso andere Felder, auch die Antwortfrist) | Wert gibt die Season vor | In der Season ändern, dann **Vorgaben übertragen** |
| „In einer Liga-Staffel spielen nur Co-Teams …“ | Teilnehmer ohne Co-Team eingetragen | **Co-Team zuteilen** |
| „Für diese Season ist noch kein gültiges Regelwerk veröffentlicht.“ | Fenster offen, aber keine gültige Version | Regelwerk veröffentlichen (2.11), „Gültig ab“ darf nicht in der Zukunft liegen |
| „Alle Startplätze sind vergeben.“ beim Annehmen | Plätze voll, auch über 2.5 Zugeteilte zählen | Warteliste, oder **Startplätze** an der Season erhöhen |
| „Eine Liga-Staffel hat keine Anmeldung – Co-Teams teilt die Turnierleitung zu.“ | Zugangslink mit Anmelderecht für eine Staffel | Link nur zum Ansehen anlegen, Co-Team zuteilen |
| „Der Spielplan dieser Staffel steht – zurücksetzen oder neu aufbauen geht nur vor dem Start …“ | Spielplan oder Phase einer gestarteten Staffel neu aufbauen oder löschen | Einzelne Spiele im Reiter **Spiele** korrigieren |
| „Diese Staffel hat schon begonnen oder Spiele – Löschen geht nur vor dem Start …“ | Gestartete Staffel löschen | Status **Abgesagt** oder **Archiviert** |
| „Löschen geht nicht: … hat schon Co-Teams zugeteilt / hat schon begonnen oder Spiele / ist kein Entwurf mehr. Archivieren statt löschen …“ | Liga, Season oder Liga N hängt schon etwas an | Im Blatt **Archivieren** (2.9) |
| „Bitte einen Grund angeben (mindestens 5 Zeichen) …“ | Löschen ohne Grund | Grund eintragen |
| „Das Spiel bleibt, sobald eine Season eine Staffel hat …“ | Spiel einer Liga mit Staffel ändern | Neue Liga anlegen, die alte archivieren |
| „Die Adresse bleibt, seit eine Season der Liga sichtbar war …“ | Adresse nach der Veröffentlichung ändern | Adresse lassen; nur der Name ändert sich || „Ein zugeteiltes Co-Team nimmt nur die Turnierleitung wieder aus der Staffel …“ | Teamleitung will ihr Co-Team abmelden | Bei der Turnierleitung melden |
| Ligaseite zeigt „Liga nicht gefunden“ | Sichtbarkeit *Aus* oder *Nur Liga-Leitung* | Sichtbarkeit der Season ändern und speichern |
| „Dafür fehlt dir das Recht in dieser Liga …“ | Bereich Turnierleitung allein oder falsche Zuständigkeit | Superadmin vergibt den Bereich Ligen, der Bereich Ligen die Zuständigkeit – [2.11](#211-bereich-ligen-und-zuständige) |
| „Du bist an diesem Spiel selbst beteiligt …“ | Eigenes Spiel | Eine zweite berechtigte Person entscheidet; Superadmin nur mit Grund – [2.11](#211-bereich-ligen-und-zuständige) |
| „Bitte im Web mit Maps und Aufstellung melden.“ | Erstmeldung oder abweichende Meldung aus der App | Im Web auf der Matchseite melden |
| „In dieser Zeit wird nicht gespielt (Weihnachtspause, 21.12.2026 bis 3.1.2027) …“ | Termin in einer Sperrzeit | Anderen Termin vorschlagen |
| „Deine Maps, Modi oder Sieger weichen von der Meldung der Gegenseite ab …“ | Bestätigung passt nicht | Einspruch über **Problem melden**; die Turnierleitung entscheidet |
| „Map 2: diese Map ist im Pool für Suchen & Zerstören nicht freigegeben.“ / „Map 2: gespielt wird hier Suchen & Zerstören.“ | Map oder Modus passt nicht zu Pool oder Reihenfolge | Richtige Map bzw. Modus wählen; fehlt eine Map im Pool, Pool der Season ändern und übertragen |
| „Map 3: Hafenkante (Stellung) lief schon als Map 1 – dieselbe Map im selben Modus nur einmal je Serie.“ | Map in derselben Serie schon gespielt | Andere Map wählen; die Regel stellt die Season unter **Map-Wiederholung in einer Serie** ein |
| „Nach Map 2 stand der Sieger schon fest – keine weitere Map.“ / „Best of 3: eine Seite braucht 2 gewonnene Maps …“ | Serie passt nicht zum Best of | Maps korrigieren |
| „… die Aufstellung von … braucht genau 4 Spieler.“ / „… nur Spieler aus dem Kader …“ | Aufstellung falsch | Genau die Teamgröße aus dem eigenen Kader wählen |
| „… steht an diesem Spieltag schon in der Aufstellung eines anderen Teams …“ | Doppel-Einsatz | Andere Person aufstellen |
| „Map 1: … kann nicht aufgestellt werden – Activision-ID fehlt im Profil.“ | Spieler ohne Spiel-ID | Spieler trägt die ID im Profil ein, danach geht es (3.7) |
| „… kann nicht aufgestellt werden – Nach dem Stichtag ins Co-Team gekommen …“ | Neuer Spieler nach dem Stichtag | Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** → **ID freigeben** mit Grund |
| „… kann nicht aufgestellt werden – Das Konto ist gesperrt.“ | Gesperrtes Konto | Andere Person aufstellen (3.8) |
| „… steht schon in der Aufstellung der anderen Seite – dieselbe Person spielt nie auf beiden Seiten eines Spiels.“ | Person in den Kadern beider Seiten | Für eine Seite eine andere Person aufstellen (3.8) |
| „Kader zu klein: …“ (Nachricht), Aufgabe **Kader auffüllen** | Mindestkader der Staffel unterschritten | Teamleitung ergänzt den Kader; danach ist die Aufgabe weg (3.8) |
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
Die Turnierleitung wertet das Spiel kampflos (Ergebnis-Fenster → **Nicht erschienen** auf der fehlenden Seite). Von
selbst schlägt der Server das in der Liga nicht vor (3.2).

**Zählt die Aufstellung für die Tabelle?**
Nein, nur das Ergebnis. Die Aufstellung ist für Doppel-Einsatz und spätere Statistik da.

**Ein Spieler hat eine neue Activision-ID – darf er damit spielen?**
Erst nach eurer Freigabe (3.7). Bis dahin spielt er mit der gemeldeten ID; aufstellbar bleibt er.

**Wie sieht ein Captain, was zu tun ist?**
Über die Benachrichtigungen und den [Spickzettel für Captains](liga-captains.md).

---

## 6. Checkliste für den Obmann bis 9.11.

Zum Abhaken in dieser Reihenfolge – jeder Punkt mit dem Klickweg von oben.

- [ ] **Bereich Ligen** an alle vergeben, die die Liga leiten; Zuständige eingetragen – 2.11
- [ ] **Modi** des Spiels angelegt (Stellung, Suchen & Zerstören, Kontrolle) – 2.1
- [ ] **Maps** in der Bibliothek, je mit **Bild** und den richtigen **Modi** – 2.1
- [ ] **Season 1**: Beginn 10.11.2026, 10 Wochen, **Weihnachtspause** 21.12.–3.1., nur Hinrunde, Meldeschluss 6.11. – 2.2
- [ ] **Best of 3**, **Teamgröße 4**, Mindestkader, **Modus je Map** laut Regelwerk, Punkte 3/1/0 – 2.2
- [ ] **Regelwerk** veröffentlicht, Bausteine für Map-Pool und Modusfolge gesetzt – 2.11
- [ ] **Map-Pool der Season** gespeichert – 2.2
- [ ] **Ausrüstung** in der Bibliothek, **Sperrliste der Season** gespeichert und als Baustein im Regelwerk – 2.1a
- [ ] **Prüfung vor der Veröffentlichung** ohne Probleme – 2.8
- [ ] **Liga 1** und **Staffel A** angelegt (bei mehr als acht Teams auch Staffel B) – 2.3
- [ ] Alle **Co-Teams** angelegt, jeder im Kader hat ein **Konto** und ist im Hauptteam – 2.4
- [ ] Jeder im Kader hat die **Activision-ID** im Profil; Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** zeigt niemanden „ohne ID“,
      Stichtag für neue Spieler entschieden – 3.7
- [ ] Je Co-Team **Captain** und **Vertreter** vergeben – 2.4
- [ ] Alle Co-Teams **zugeteilt** (Teilnehmer: 8 von 8) – 2.5
- [ ] Season gespeichert und, falls nach dem Anlegen der Staffel etwas geändert wurde, **Vorgaben übertragen** – 2.7
- [ ] Ligaseite mit *Nur Liga-Leitung* geprüft: Teams, Wochen mit Weihnachtspause, Pool, Regeln – 2.8
- [ ] **Liga starten** (Spielplan fest, sieben Spieltage) – 2.6
- [ ] **Am 10.11.:** Sichtbarkeit auf **Öffentlich**, **Überblick speichern** – 2.8
- [ ] **Discord-Ankündigung von Hand** (die Liga meldet sich noch nicht selbst): Link zur Ligaseite, Start, Ablauf,
      [Spickzettel für Captains](liga-captains.md)
