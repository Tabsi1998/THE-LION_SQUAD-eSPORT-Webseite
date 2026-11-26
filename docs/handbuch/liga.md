# Liga leiten – Handbuch

Für die **Liga-Leitung** (und den Obmann der Liga): eine Liga über Wochen aufsetzen, starten und durch die Season
bringen – am Beispiel einer CoD-Liga. Ohne Vorwissen lesbar; was technisch dahinter steckt, steht in [LIGA.md](../LIGA.md).
Zahlen in Beispielen sind Vorgaben einer neuen Season, keine festen Werte: Kalender, Best of, Punkte und Fristen stellt jede
Season selbst ein, den Starttermin legt der Obmann fest. Für die Captains der Co-Teams gibt es einen eigenen
[Spickzettel](liga-captains.md), zum Abhaken vor dem Start die [Checkliste vor dem Season-Start](#6-checkliste-vor-dem-season-start).

**Wo im Admin:**

- **Admin → eSports → Spiele → Zahnrad** (`/admin/games/<Spiel>`) – die Spielseite: Reiter **Modi** (etwa Stellung, Suchen & Zerstören)
  und Reiter **Maps** (`#maps`) – Map-Bibliothek als Tabelle Map × Modus mit Bildern
- **Admin → eSports → Liga** (`/admin/leagues`) – Liga, Season, Liga 1, 2 …, Staffel A, B …
- **Staffel-Seite** (`/admin/leagues/staffeln/<Staffel>`, aus der Season über **Ligen und Staffeln → Staffel öffnen**) – Co-Teams
  zuteilen, starten, Spielplan, Spiele und Ergebnisse, Tabelle, Protokoll, Einstellungen (2.5). Alte Adressen
  `/admin/tournaments/<Staffel>` leiten dorthin weiter; die Turnierliste zeigt keine Staffeln.
- **Ligaseite** (`/liga/<liga>/<season>`, etwa `/liga/call-of-duty/season-1`) – was Mitglieder und Gäste sehen, mit den Unterseiten
  **Spieltage** und **Teams** (siehe [2.12](#212-die-ligaseite-übersicht-spieltage-teams))

Wer was darf: Liga, Season, Liga N, Staffel, Zuteilen, Start und Korrekturen macht nur die **Liga-Leitung mit
bestätigter Zwei-Faktor-Anmeldung**: wer den Bereich **Ligen** hat oder in dieser Liga **zuständig** ist, siehe
[2.0](#20-bereich-ligen-und-zuständige). Wo dieses Handbuch und die Oberfläche von „Turnierleitung“ schreiben, ist bei einer
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
6. [Checkliste vor dem Season-Start](#6-checkliste-vor-dem-season-start)

---

## 1. Überblick: wie eine Liga aufgebaut ist

| Ebene | Beispiel | Was dort festgelegt wird |
| --- | --- | --- |
| **Liga** (je Spiel) | CoD-Liga | Name, Spiel, Adresse `/liga/call-of-duty`, Gestaltung (Emblem, Banner, Farbe – 2.10) |
| **Season** | Season 1 | alle Vorgaben: Kalender, Sperrzeiten, Best of, Teamgröße, Punkte, Fristen, Map-Pool, Regelwerk, Sichtbarkeit |
| **Liga N** | Liga 1 | Stufe der Liga; darf Best of, Teamgröße, Mindestkader, Staffelgröße, Punkte und Antwortfrist abweichend festlegen |
| **Staffel** | Staffel A | ein gewöhnliches Turnier im Format Liga mit den Werten der Season – Spiele, Termine, Ergebnisse, Tabelle |
| **Co-Team** | Nebelwölfe · Rudel | Teilnehmer der Staffel: ein Kader eines Hauptteams mit Captain und Vertreter |

So läuft eine Spielwoche: Eine **Spielwoche** beginnt am Wochentag des Season-Beginns und dauert so viele Tage, wie die Season
einstellt (Vorgabe 7, etwa Dienstag bis Montag); „Spielwoche 3“ ist dasselbe wie Spieltag 3. Die Captains vereinbaren einen
Termin – ohne Einigung gilt der **Standardtermin** (Vorgabe Sonntag 20:00). Kurz vor dem Termin checken beide ein (3.1b), hat die
Season ein Veto, folgt es gleich danach (3.1c). Nach dem Spiel meldet eine Seite das Ergebnis **im Web** mit Maps und hakt einmal
an, wer bei ihr gespielt hat (**Teilnehmerliste**, siehe 3.3), die andere bestätigt. Antwortet sie nicht, gilt die Meldung nach
**48 Stunden** (Vorgabe). Die Tabelle rechnet je Season entweder **Sieg, Remis, Niederlage** (Vorgabe 3/0/0, ohne Remis) oder
**Punkte nach gewonnenen Maps** (bei Best of 5 ergibt 3:2 3 und 2 Punkte, bei Best of 3 ergibt 2:1 2 und 1); bei Punktgleichheit entscheidet die eingestellte Reihenfolge,
etwa der **direkte Vergleich**, dann Map-Differenz und gewonnene Maps, zuletzt die Liga-Leitung (siehe 3.5).

Beispiel: Eine Season mit 10 Wochen, nur Hinrunde und acht Teams hat sieben Spieltage. Liegt eine Pause in Woche 7 und 8, spielen
die Wochen 1 bis 6 die Spieltage 1 bis 6, Woche 9 den Spieltag 7, und Woche 10 bleibt Reserve für Nachholspiele. Der Reiter
**Termine** zeigt nach dem Speichern, welche Wochen gesperrt sind und wie viele Teams eine Staffel höchstens fassen kann.

Gesperrt ist eine Woche, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt. Gesperrt sind damit alle Tage
der Sperrzeit **und** alle Tage einer gesperrten Woche: Auch am letzten Tag einer Woche, die mehrheitlich in der Pause liegt,
lässt sich kein Termin vorschlagen.

In Sperrzeiten **ruhen die Fristen** der Liga: Termin-Antwortfrist, Bestätigen und Nachtragen der Teilnehmerliste, dazu
**Protest** (Vorgabe 48 Stunden ab der Bestätigung), **Stellungnahme** und **Einspruch** (je Vorgabe 48 Stunden). Sie laufen
nach der Pause weiter. Die alte Turnier-Regel „Einspruch 30 Minuten nach dem Ergebnis“ gilt in der Liga nicht (3.4).

Staffeln zählen nicht für Jahreswertung, Turnier-Pokale, Löwen-Rang-XP für Teilnahme und Podest und die Team-Stufe;
gespielte und gewonnene Spiele zählen weiter. Startseite, öffentlicher Kalender und Turnierliste zeigen die Staffeln nicht –
die Startseite zeigt stattdessen die **Season** (2.8a). Dazu gibt es die Ligaseite, den Menüpunkt **Liga** und die Kachel **Liga** auf der eSports-Übersicht (`/esports`, mit
„Start am …“ oder „Läuft“). Menüpunkt und Kachel erscheinen nur, solange eine Season sichtbar ist. Name, Stelle und
Ausblenden des Menüpunkts stellt die Redaktion unter **Admin → Content → Navigation** ein.

---

## 2. Einrichten Schritt für Schritt

### 2.0 Bereich Ligen und Zuständige

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
| **Teams freigeben** | Co-Teams zuteilen und herausnehmen, Austritt und Disqualifizieren |
| **Kader prüfen** | Kaderübersicht mit Spiel-IDs, neue ID freigeben, Stichtag |
| **Spiele betreuen** | Termine festlegen, Terminvorschläge entscheiden, Spielplan freigeben, Check-in im Notfall für eine Seite eintragen und das Spiel starten (3.1b), ins Veto eingreifen (3.1c) |
| **Ergebnisse korrigieren** | Ergebnis eintragen und korrigieren, Rückgängig, kampflos und „nicht erschienen“ werten, Aufstellung nachtragen |
| **Proteste** | Streitfälle entscheiden. Für „Ergebnis ändern“ im Streitfall braucht es zusätzlich **Ergebnisse korrigieren** |
| **Strafen** | Strafen verhängen, vorläufige Sperren bestätigen, widerrufen und über Einsprüche gegen Strafen entscheiden ([3.4a](#34a-strafen-regelwerk--13-anlage-c)) |
| **Regeln veröffentlichen** | Regelwerk der Liga und der Season (2.11) |

- Zuständige brauchen keinen Bereich, aber die Zwei-Faktor-Anmeldung. Ohne sie gilt die Zuständigkeit nicht, das Blatt sagt es an der Zeile.
- Zuständige finden ihre Ligen unter **Admin → Mein Dienst → Meine Ligen** und im Menü unter **Liga**. Sie sehen nur ihre Ligen und nur die Knöpfe ihrer Zuständigkeiten. Das gilt auch für Turnierleitung und Helfer, die zugleich zuständig sind.
- **Turniere** sehen Zuständige und der Bereich **Ligen** im Menü nicht mehr: Die Turnierliste zeigt keine Staffeln, jede Staffel hat ihre Staffel-Seite unter **Liga** (2.5). Wer `/admin/tournaments` öffnet, landet bei **Liga**. Wer zusätzlich den Bereich Turniere oder einen Helfer-Einsatz hat, sieht **Turniere** wie bisher – dort stehen dann nur Turniere.

<img src="../assets/liga/menue-liga-leitung-390.png" alt="Admin-Menü am Handy für den Bereich Ligen: nur Dashboard und Liga, kein Eintrag Turniere" width="300">
- **Bilder:** Zuständige ohne Admin-Medien laden Emblem, Banner und Gewinnbilder als eigene Bilder hoch (kein SVG), die Mediathek zeigt ihnen nur diese.
- Vergeben und entfernen darf nur der Bereich **Ligen**. Liga anlegen und löschen auch.
- **Co-Teams in einer laufenden Staffel:** Kader, Captain, Vertreter und Status ändern nur noch die eigene Teamleitung und die Liga-Leitung mit **Kader prüfen** (Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** → **Kader bearbeiten**). Die Turnierleitung nicht mehr. Nach dem Ende der Staffel gilt wieder alles wie vorher.
- **Helfer** am Turnier (Organisation, Schiedsrichter, Ergebnisdienst, Station) lesen in einer Staffel nur noch. Ergebnisse tragen dort nur Zuständige und der Bereich Ligen ein. Alte Helfer-Einsätze in einer Staffel stehen in **Mein Dienst** nur bei Personen mit einem Recht in dieser Liga, sonst gar nicht, und sie zählen nicht als Turnier-Einsatz.

**Befangenheit:** Wer in einem Spiel selbst beteiligt ist (Kader einer Seite, Captain, Vertreter, Hauptteam-Leitung), korrigiert dort
keine Ergebnisse, entscheidet keine Proteste, verhängt keine Strafen und setzt keinen Termin direkt. Die Matchseite und der Matchplan sagen es, der
Knopf fehlt, und die Person meldet als eigene Seite wie alle anderen, den Termin über Vorschlag und Zustimmung. Es entscheidet eine zweite berechtigte Person. Nur der **Superadmin** darf als Notausnahme: Das Ergebnis-Fenster
oder der Matchplan fragt dann nach dem Grund, er steht im Protokoll (`league.conflict.override`).

**Ergebnis mit „Rückgängig“:** Verliert jemand in den 10 Sekunden die Zuständigkeit oder wird befangen, geht das Ergebnis nicht hinaus. Die Person bekommt eine
Nachricht, der Vorgang steht im Protokoll.

**Bekannte Grenze – Strafen-Eingang:** Admin → eSports → Strafen hängt bis #2208 am Bereich Turnierleitung. Kampflos-Wertungen einer Staffel und Strafen der Liga siehst du dort nur mit
beiden Bereichen, Turnierleitung und Ligen. Mit nur einem von beiden fehlen sie. Am Spiel selbst bleibt die Wertung sichtbar, Strafen der Liga stehen immer im Reiter **Strafen** der Season.

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
   Kategorien und Unterkategorien sind anfangs **zugeklappt**: Die Kopfzeile nennt Art und Anzahl, ein Klick (oder Enter) klappt auf,
   **Unterkategorien** und **Hinzufügen** daneben gehen auch zugeklappt. **Alle aufklappen** und **Alle zuklappen** stehen neben der
   Suche; die Suche klappt die Bereiche mit Treffern auf und zählt „1 von 30“. Ist nur eine Kategorie gewählt, ist sie gleich offen.
   **Aus Spiel übernehmen** holt Einträge einer anderen Spielversion, fehlende Kategorien kommen mit, Aufsätze finden ihre Waffen über den
   Namen (Waffen also mit übernehmen, sonst kommen sie ohne Waffe).
3. **Zustand:** *Deaktivieren* (Ein/Aus-Symbol): kommt auf keine neue Sperrliste, wo er steht, bleibt er. *Archivieren*: zusätzlich
   ausgeblendet. Was auf einer gespeicherten Sperrliste steht, lässt sich nicht löschen, nur archivieren.
4. **Unterkategorien (Klassen):** Je Kategorie über **Unterkategorien** neben dem Kategorie-Namen – etwa Waffen → Sturmgewehr,
   Schrotflinte, Pistole oder Aufsätze → Mündung, Optik, Magazin. Ohne Unterkategorien bietet das Blatt einen **Vorschlag** aus
   Gattungsbegriffen an, den du anpasst; gespeichert wird erst mit **Speichern**. Umbenennen und Umsortieren gehen jederzeit, entfernen nur
   ohne Einträge (erst verschieben) und nicht, solange eine gespeicherte Sperrliste die Klasse ganz sperrt. Optional ein **Symbol** (eigener
   Upload, quadratisch). In der Bibliothek stehen die Einträge dann je Unterkategorie in **einklappbaren Gruppen** mit Zähler, Einträge ohne
   zuerst unter **Ohne Unterkategorie**. Zuordnen: im Eintrag **Unterkategorie** wählen, oder **Auswählen** → Einträge anhaken →
   **Nach …** → **Verschieben** (nur innerhalb einer Kategorie). Ein **Aufsatz** passt zusätzlich zu ganzen **Waffenklassen**: Eine neue
   Waffe dieser Klasse passt dann sofort. Ohne Waffe und ohne Klasse passt ein Aufsatz weiter zu keiner. **Aus Spiel übernehmen** legt
   fehlende Unterkategorien an („neu“ in der Vorschau); ist kein Platz mehr, kommt der Eintrag ohne Unterkategorie und die Meldung sagt es.
5. **Sperrliste der Season:** auf der Season-Seite im Reiter **Regelwerk und Sperrliste** (`#sperrliste`). Haken bei **sperren**, darunter **Gilt in**: allen Modi oder
   einzelnen. Bei einer Waffe klappt der Knopf **„N Aufsätze · K gesperrt“** die **passenden** Aufsätze auf, je Slot (Unterkategorie, etwa
   Mündung, Optik). Haken heißt **gesperrt an dieser Waffe** – die Waffe bleibt erlaubt; darunter je Aufsatz **Gilt in** (alle Modi oder
   einzelne). **An allen Waffen sperren** setzt den Aufsatz selbst auf die Liste (gleich wie in seiner eigenen Kategorie), **Für alle
   Sturmgewehr übernehmen** gibt jeder anderen Waffe der Klasse dieselben Sperren mit denselben Modi, soweit die Aufsätze dort passen. Beides
   gilt erst mit **Speichern**. **Nur gesperrte** zeigt, was schon auf der Liste steht.
   **Einklappen:** Kategorien, Unterkategorien und die Slots im Kasten einer Waffe sind anfangs zu. Die Kopfzeile nennt die Anzahl und
   **„K gesperrt“**, ein Klick (oder Enter) klappt auf; **Ganze Klasse sperren** geht auch zugeklappt. Hat die Season noch keine Sperren,
   ist die erste Kategorie offen; hat eine Waffe nur einen Slot, ist er offen. **Alle aufklappen** und **Alle zuklappen** stehen neben
   der Suche (zuklappen schließt auch die Kästen der Waffen). Suche und **Nur gesperrte** klappen die Bereiche mit Treffern auf. Was du
   angehakt hast, bleibt beim Zuklappen stehen, bis du speicherst; die Seite merkt sich nicht, was offen war.
   Je Unterkategorie gibt es den Schalter **Ganze Klasse sperren**, auch nur für einzelne Modi. Er gilt für **alle Einträge der Klasse, auch
   für später angelegte** – eine neue Schrotflinte in einer gesperrten Klasse „Schrotflinte“ ist sofort mitgesperrt (Ligaseite, Matchseite) und
   das Regelwerk meldet **Regelwerk muss freigegeben werden** (2.11). In allen Modi gesperrt, sind die Einträge der Klasse mit „Mit der ganzen
   Klasse gesperrt“ markiert und einzeln nicht mehr wählbar; nur für einzelne Modi lassen sie sich zusätzlich einzeln sperren. Eine leere
   Klasse lässt sich schon sperren, sie gilt ab dem ersten Eintrag. Die Version hält Klasse und Einträge zum Zeitpunkt fest.
6. **Speichern** legt eine neue **Version** an. Bestehende Staffeln bekommen sie mit **Jetzt übertragen** (auch gesperrte und laufende),
   neue Staffeln gleich beim Anlegen. Ein Spiel hält die Version fest, die bei seinem Ergebnis galt. **Versionen vergleichen** zeigt neu
   gesperrt, geändert und wieder erlaubt.
7. **Regelwerk:** Der Baustein heißt **Erlaubte Ausrüstung** (`[[baustein:loadout_bans]]`). Er zeigt nicht die Sperren, sondern **was
   erlaubt ist**: alle **aktiven** Einträge der Bibliothek ohne die Sperrliste, je Kategorie und Unterkategorie mit Bild. Nur in einzelnen
   Modi gesperrt, steht ein Eintrag mit „nicht in …“ da – ist er in **mehr Modi der Season gesperrt als erlaubt**, mit „nur in …“ (etwa „nur
   in Suchen & Zerstören“; bei Gleichstand „nicht in …“). **Waffen stehen als Tabelle**, eine je Kategorie, im Web und im PDF gleich: je
   Unterkategorie eine Kopfzeile, je Waffe eine Zeile mit **kleinem Bild**, **Name** (mit Hinweis) und den **Ausnahmen nach Slot**, je
   Slot eine Zeile wie „Optik: Rotpunkt, Holo“. Ohne Ausnahme steht „alle passenden Aufsätze erlaubt“, sonst „**gesperrt:**“ mit den ganz
   gesperrten und „**eingeschränkt:**“ mit denen, die nur in einzelnen Modi gesperrt sind („Holo (nur in Suchen & Zerstören)“ – der
   Hinweis sagt, wo er erlaubt ist). Sind an einer Waffe **mehr passende Aufsätze gesperrt als erlaubt** (etwa bei Scharfschützengewehren),
   dreht sich die Zeile um: „**nur erlaubt:**“ mit den erlaubten je Slot – so bleibt sie kurz; bei Gleichstand bleibt es bei „gesperrt“.
   Ohne erlaubten Aufsatz steht „keine Aufsätze erlaubt“. Am Handy stapelt die Tabelle: Bild und Name nebeneinander, die Aufsätze darunter.
   Ist ein Aufsatz an **jeder** passenden Waffe gleich gesperrt (etwa über **An allen Waffen sperren**), steht er nur einmal unter den
   Waffen: „**An keiner Waffe erlaubt:** Kompensator“ (mit Hinweis, wenn nur in Modi); an der Waffe zählt er bei „K gesperrt“ weiter mit.
   Eine ganz gesperrte Klasse ist nur eine Zeile „Schrotflinte · nicht erlaubt“ (mit den Namen in Klammern), eine ohne jede Einschränkung
   sagt „alle erlaubt“. Inaktive und archivierte Einträge fehlen. Die übrige Ausrüstung (Perks und Co.) steht im Web als Karten, im
   **PDF** als Tabelle Kategorie · Unterkategorie · Erlaubt · Einschränkungen. Weil der
   Baustein die Bibliothek von heute liest, meldet **jeder neue aktive Eintrag** (auch einer in einer gesperrten Klasse) und jede neue
   Version der Sperrliste **Regelwerk muss freigegeben werden**. Steht der Baustein im Regelwerk, sagt der Abschnitt Sperrliste, ob die
   letzte Fassung noch den alten Stand zeigt; **Neue Version vorbereiten** führt ins Regelwerk, dort sind die Unterschiede markiert, du gibst
   frei und wählst, ob neu zugestimmt werden muss (2.11). Jede Fassung friert ihre Liste ein; ältere Fassungen mit der Sperrliste bleiben,
   wie sie veröffentlicht wurden – auch die mit der eigenen Aufsatz-Liste („nicht an …“) und die mit dem Satz „alle passenden Aufsätze
   erlaubt, außer: …“ je Waffe. Die Tabelle kommt einmal als Vorschlag **Regelwerk muss freigegeben werden**.

Öffentlich steht auf der Ligaseite unter dem Map-Pool **Erlaubte Ausrüstung** – genau die Sicht des Regelwerks, nur wenn die Season
sichtbar ist und das Spiel eine Bibliothek hat. Jede Waffe mit passenden Aufsätzen zeigt „N Aufsätze · K gesperrt“; ein Klick (oder Enter)
klappt darunter einen Kasten auf: **ganz oben „Gesperrt: …“**, darunter die **erlaubten Aufsätze je Slot mit Bild**. Auf der **Matchseite** eines Ligaspiels steht sie
unten aufklappbar, aus der Liste, die für dieses Spiel gilt (nach dem Ergebnis die festgehaltene, ältere Spiele so, wie sie damals
aussah). Rechte: Bibliothek wie Maps (Bereich
Turnierleitung), Sperrliste mit **Season konfigurieren** (lesen: jede Zuständigkeit der Liga).

<table>
<tr>
<td><img src="../assets/liga/ausruestung-bibliothek.png" alt="Bibliothek Ausrüstung zugeklappt: Suche, Alle aufklappen und Alle zuklappen, je Kategorie eine Kopfzeile mit Art und Anzahl, daneben Unterkategorien und Hinzufügen" width="560"></td>
<td><img src="../assets/liga/ausruestung-bibliothek-handy.png" alt="Dieselbe Bibliothek am Handy mit 390 px, zugeklappt" width="220"></td>
</tr>
<tr>
<td><img src="../assets/liga/sperrliste-season.png" alt="Abschnitt Sperrliste der Season zugeklappt: Hinweis aufs Regelwerk, Suche, Alle aufklappen und Alle zuklappen, je Kategorie Anzahl und K gesperrt" width="560"></td>
<td><img src="../assets/liga/sperrliste-season-handy.png" alt="Dieselbe Sperrliste am Handy mit 390 px, lange Kategorienamen brechen hinter dem Pfeil um" width="220"></td>
</tr>
<tr>
<td><img src="../assets/liga/sperrliste-suche.png" alt="Sperrliste mit der Suche rotpunkt: nur die Kategorie Aufsätze ist aufgeklappt, Kopfzeile 1 von 30, darunter der Treffer" width="560"></td>
<td><img src="../assets/liga/sperrliste-ligaseite-handy.png" alt="Ligaseite am Handy: Sperrliste nach Kategorien, Aufsätze an erlaubten Waffen" width="220"></td>
</tr>
<tr>
<td><img src="../assets/liga/ausruestung-unterkategorien.png" alt="Bibliothek mit Unterkategorien: Gruppen Sturmgewehr und Schrotflinte mit Zähler, Knöpfe Unterkategorien und Auswählen" width="560"></td>
<td><img src="../assets/liga/erlaubte-ausruestung-handy.png" alt="Ligaseite am Handy: Waffe Habicht 7 aufgeklappt, ganz oben Gesperrt mit den gesperrten Aufsätzen, darunter die erlaubten je Slot mit Bild" width="220"></td>
</tr>
<tr>
<td><img src="../assets/liga/sperrliste-klassen.png" alt="Sperrliste der Season aufgeklappt: je Unterkategorie eine Kopfzeile mit Anzahl, K gesperrt und dem Schalter Ganze Klasse sperren" width="560"></td>
<td><img src="../assets/liga/sperrliste-aufsaetze-je-waffe.png" alt="Sperrliste der Season: Waffe aufgeklappt, je Slot eine Kopfzeile mit Anzahl und K gesperrt, Aufsätze mit Häkchen gesperrt und Modi je Aufsatz, Knopf Für alle Sturmgewehr übernehmen" width="280"></td>
</tr>
<tr>
<td><img src="../assets/liga/regelwerk-erlaubte-ausruestung.png" alt="Regelwerk im Web: Tabelle Bild, Waffe, Aufsätze; je Klasse eine Kopfzeile, je Waffe die Ausnahmen nach Slot, beim Scharfschützengewehr nur erlaubt, Schrotflinte nicht erlaubt" width="560"></td>
<td><img src="../assets/liga/regelwerk-erlaubte-ausruestung-pdf.png" alt="PDF des Regelwerks: dieselbe Tabelle mit kleinem Bild je Waffe, gesperrt, eingeschränkt und nur erlaubt nach Slot" width="280"></td>
</tr>
<tr>
<td><img src="../assets/liga/regelwerk-erlaubte-ausruestung-handy.png" alt="Regelwerk am Handy mit 390 px: jede Waffe gestapelt, Bild und Name nebeneinander, die Aufsätze nach Slot darunter" width="220"></td>
<td></td>
</tr>
</table>

### 2.2 Liga und Season anlegen

1. **Admin → eSports → Liga → Liga anlegen**: Name (etwa „CoD-Liga“) und Spiel.
2. In der Liga **Season anlegen**: nur der **Beginn der ersten Spielwoche** (00:00 Uhr Wiener Zeit). Die übrigen Vorgaben
   kommen als Startwerte mit. Gibt es schon eine abgeschlossene Season, legst du die nächste besser aus ihr an (3.11).
3. Die Season öffnen. Die Season-Seite hat zwölf **Reiter**; jede Angabe steht an genau einer Stelle. Am Handy wischst du die
   Reiterleiste seitlich. Jeder Reiter speichert für sich (**Termine speichern**, **Tabelle speichern** …) und schickt nur seine
   eigenen Felder. Was noch nicht gespeichert ist, trägt am Reiter einen **Punkt** und bleibt beim Wechsel erhalten; die Seite fragt
   dann einmal, ob du **jetzt speichern** willst. Verlässt du die Seite mit Ungespeichertem, fragt sie nach.

| Reiter | Was dort steht | Adresse |
| --- | --- | --- |
| **Überblick** | Ablauf der Season, **Was fehlt noch?**, Name, Sichtbarkeit, Stand, Gestaltung und Gewinne | `…/seasons/<id>` |
| **Leitstand** | alles Offene der Season, Protokoll, Rundnachricht (3.0) | `#leitstand` |
| **Spielbetrieb** | Modi der Season mit Maps, Mindestgröße, Ergebnisregeln, Serie (Best of, Teamgröße, Modus je Map, Map-Wiederholung), Fristen nach dem Spiel, Check-in (2.7b), Veto (2.7d), Vorfälle (2.7e) | `#spielbetrieb` |
| **Termine** | Kalender, Standardtermin, Sperrzeiten, Antwortfrist, Terminregeln (2.7a), Erinnerungen (2.7f) | `#termine` |
| **Anmeldung und Kader** | Selbstanmeldung (2.5a), Kader und Spielberechtigung (3.9), Plattform und Eingabegerät (2.7c), Eingang der Anmeldungen, Startrechte (3.11a), Kaderübersicht (3.7) | `#anmeldung`, `#anmeldungen`, `#startrechte`, `#kader` |
| **Tabelle** | Punkte, Gleichstand, Ausscheiden; je Staffel **Tabelle öffnen** zur Staffel-Seite mit Tabelle und Gleichstand-Entscheid (3.5) | `#tabelle` |
| **Proteste** | Eingang der Verfahren und ihre Fristen (3.4) | `#proteste` |
| **Strafen** | verhängen, bestätigen, widerrufen, Einsprüche (3.4a) | `#strafen` |
| **Regelwerk und Sperrliste** | Stand des Regelwerks mit Weg dorthin (2.11), Sperrliste (2.1a) | `#regelwerk`, `#sperrliste` |
| **Ligen und Staffeln** | Liga 1, 2 …, Staffeln, Staffelgröße, Vorgaben übertragen, Auf- und Abstieg (2.3, 2.7, 3.11) | `#ligen` |
| **Belohnungen** | Banner, Emblem, Medaille, Titel je Platz (3.12) | `#belohnungen` |
| **Abschluss** | Checkliste je Staffel, Endstand, Wiederöffnen (3.10) | `#abschluss` |

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

**Vorgaben einer neuen Season** in den übrigen Reitern – was die Tiroler Liga tatsächlich spielt (etwa Best of 5, Punkte nach gewonnenen Maps), trägt der Obmann laut Regelwerk ein:

| Reiter | Feld | Vorgabe |
| --- | --- | --- |
| Spielbetrieb | **Best of** · **Teamgröße (je Map)** | Best of 3 · 4 |
| | **Modus je Map** | nach Regelwerk |
| | **Map-Wiederholung in einer Serie** | Gleiche Map nur in anderem Modus (Vorgabe); auch „Aus – jede Map nur einmal“ oder „Immer erlaubt“ |
| | **Ergebnis gilt nach** · **Teilnehmerliste nachtragen bis** (Stunden) | 48 · 48 |
| Termine | **Wochen gesamt** (mit Sperrwochen) | 10 |
| | **Spielwoche (Tage)**, **Standardtag**, **Standardzeit** | 7 · Sonntag · 20:00 |
| | **Runden** | Nur Hinrunde |
| | **Sperrzeiten** (Von, Bis, Bezeichnung) | keine; etwa „Weihnachtspause“ eintragen |
| | **Antwort auf Terminvorschlag (Stunden)** – leer heißt bei älteren Seasons „je Staffel wie bisher“ | 72 |
| Anmeldung und Kader | **Anmeldung ab / bis**, **Startplätze** … (2.5a) | leer (ohne Selbstanmeldung) |
| | **Meldeschluss** (nur Anzeige) – nur ohne Anmeldefenster, sonst gilt „Anmeldung bis“ | – |
| | **Mindestkader** · **Höchstkader** · **Mindestalter (Jahre)** · **Wartezeit neuer Spieler (Tage)** | 3 · 50 · 18 · 7 |
| | **Wer gespielt hat**, **Mindestens auf der Liste** | Teilnehmerliste einmal je Spiel, 3 |
| | **Ein Team je Season**, **Jede Spiel-ID nur einmal** | an, an |
| | **Transferfenster** (Von, Bis, Name) | keines: ohne Fenster keine Transfers |
| | **Plattform und Eingabegerät**: Feld, erlaubte Plattformen, Crossplay, Eingabegerät (2.7c) | keine Vorgabe |
| Tabelle | **Punkteart**: *Sieg, Remis, Niederlage* oder *Punkte nach gewonnenen Maps* (jede Seite bekommt so viele Punkte, wie sie Maps gewonnen hat; das Beispiel im Hinweis folgt dem Best of der Season) | Sieg, Remis, Niederlage |
| | **Punkte Sieg / Remis / Niederlage** – nur bei *Sieg, Remis, Niederlage* | 3 / 0 / 0 (neue Seasons; ältere: 3 / 1 / 0) |
| | **Bei Punktgleichheit** (in der Reihenfolge des Anklickens) | Direkter Vergleich, Map-Differenz, Mehr gewonnene Maps, Entscheid der Leitung |
| | **Direkter Vergleich (Mini-Tabelle)** – erscheint mit dem direkten Vergleich | Punkte, Map-Differenz, Gewonnene Maps |
| | **Kampflos (Default-Win)** | Maps des Best of (BO3 2:0, BO5 3:0) |
| | **Austritt, Auflösung, Disqualifikation** | Alle Spiele zählen für die Gegner, Team ans Tabellenende |
| | **Remis erlaubt** | aus |
| Ligen und Staffeln | **Teams je Staffel höchstens** | 8 |
| Überblick | **Sichtbarkeit** | bis zum Start *Nur Liga-Leitung* (siehe 2.8) |

**Punkte nach gewonnenen Maps:** Im Reiter **Tabelle** unter **Punkteart** *Punkte nach gewonnenen Maps* wählen. Jede Seite
bekommt so viele Punkte, wie sie Maps gewonnen hat – bei 3:2 der Sieger 3, der Verlierer 2. Kampflos zählt immer wie 3:0 (das Feld
**Kampflos** ist dann gesperrt), „beide nicht erschienen“ gibt beiden 0. Beim Wechsel setzt die Seite die Reihenfolge bei
Punktgleichheit auf **Mehr Siege → Direkter Vergleich → Map-Differenz → Entscheid der Leitung**; das ist ein Vorschlag, du kannst sie
danach ändern. Der direkte Vergleich rechnet dann auch mit den Maps der Spiele untereinander. Gespeichert wird die Umstellung im
Protokoll („Punkteart“ mit vorher und nachher). Eine **laufende** Season bekommt die neue Punkteart über **Vorgaben übertragen**
auch nach dem ersten Ergebnis (siehe Tabelle unten); beendete Staffeln sowie abgeschlossene oder archivierte Seasons bleiben, wie
sie sind. Danach schlägt das Regelwerk eine neue Freigabe vor, weil sich der Baustein „Tabelle und Wertung“ geändert hat.
Eine **Liga N** übernimmt die Punkteart immer von der Season. Mit Map-Punkten gibt es im Blatt der Liga N keine eigenen Punkte für
Sieg, Remis und Niederlage. Sonst legt sie nur ihre eigenen Punkte über die Season; direkter Vergleich, Remis-Regel, kampflos und
Ausscheiden gelten wie in der Season.

<img src="../assets/liga/liga-season-mappunkte-pc.png" alt="Reiter Tabelle mit Punkteart Punkte nach gewonnenen Maps, darunter die vorgeschlagene Reihenfolge Mehr Siege, Direkter Vergleich, Map-Differenz, Entscheid der Leitung und das gesperrte Feld Kampflos" width="560">

Im Reiter **Termine** steht unter den Sperrzeiten nach dem Speichern, welche Wochen gesperrt sind und **wie viele Teams eine Staffel
höchstens fassen kann** (etwa: 8 Spielwochen – höchstens 8 Teams mit nur Hinrunde).

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
   **Auf- und Abstieg je Staffel** stellt ihr im selben Blatt ein: Aufsteiger und Absteiger (Vorgabe je 1), dazu freiwillig
   Relegationsplätze. Die oberste Liga hat nie einen Aufstieg, die unterste nie einen Abstieg – das sagt der Satz unter der
   Liga („Auf- und Abstieg: oberste Liga: kein Aufstieg · 1 Absteiger“). Mehr Plätze als Teams in einer Staffel lehnt die Seite
   ab. Die Zonen stehen farbig in der Tabelle (siehe 3.11).
   **Dazu über alle Staffeln dieser Liga** (die Felder stehen nur bei Ligen mit mehreren Staffeln): Mit **Beste Nächstplatzierte
   steigen auf** steigen zusätzlich zu den Aufsteigern jeder Staffel die besten Teams auf dem Platz danach auf, etwa „Platz 1 jeder
   Staffel und die zwei besten Zweiten“. Gibt es Relegationsplätze, ist der Platz **nach** ihnen gemeint: bei einem Aufsteiger und
   einem Relegationsplatz also der Dritte – kein Team steht in zwei Zonen. **Schlechteste vor dem Abstieg steigen ab** ist das
   Gegenstück unten. In der obersten Liga gibt es das Feld nach oben nicht, in der untersten das nach unten nicht. Leer oder 0
   heißt: nur die Plätze je Staffel, wie bisher. Wer es wird, steht erst fest, wenn alle Staffeln der Liga abgeschlossen sind (3.10).
   **Gesperrt ab dem ersten Abschluss:** Sobald eine Staffel der Liga abgeschlossen ist, sind beide Felder ausgegraut, mit dem
   Hinweis „Gesperrt: In dieser Liga ist schon eine Staffel abgeschlossen.“ Ändern geht erst, wenn **alle abgeschlossenen
   Staffeln dieser Liga** im Reiter **Abschluss** wieder geöffnet sind. So ändert eine spätere Einstellung nie eine abgeschlossene Season.
   **Ligen stehen ab dem ersten Abschluss fest:** Sobald in der Season irgendeine Staffel abgeschlossen ist, lässt sich keine Liga
   mehr anlegen, archivieren oder löschen – der Knopf **Liga N anlegen**, der Papierkorb und das Feld **Stand** sind ausgegraut,
   darüber steht der Hinweis. Auf- und Abstieg rechnen mit den Ligen, die es beim Abschluss gab (welche die oberste und die unterste
   ist, wohin es geht). Erst wenn alle abgeschlossenen Staffeln der Season wieder geöffnet sind, geht es wieder. Beiname, Abweichungen
   und die Zonen je Staffel bleiben änderbar.
2. In der Zeile von Liga 1 → **Staffel anlegen** → bestätigen. Es entsteht das Turnier „CoD-Liga Season 1 · Liga 1 ·
   Staffel A“ als **Entwurf** – ohne offene Anmeldung, ohne Discord, ohne Jahreswertung. Mehr als acht Teams? Eine
   zweite Staffel (B) anlegen und die Teams verteilen; zwei Co-Teams desselben Hauptteams spielen nie in derselben
   Staffel.

**Stand einer Staffel:** Bis **Liga starten** (2.6) ist eine Staffel technisch ein Entwurf – das hält nichts auf, Anmeldung und
Zuteilen laufen trotzdem. Unter **Turniere**, im Kopf der Staffel und im Reiter **Ligen und Staffeln** steht darum der Stand der
Season, wie in der Ablaufleiste: **Vorbereitung**, **Anmeldung offen bis …** (mit Nachmeldefrist das wirksame Ende),
**Einteilung**, **Spielbetrieb**, **Abgeschlossen**. Läuft die Season schon, diese Staffel aber noch nicht, steht **Einteilung · Start
fehlt**; ist die Season noch nicht veröffentlicht, steht orange **… · Season verborgen**. Darunter steht in Orange, was der Staffel
noch fehlt, mit Link an die richtige Stelle: **Sichtbarkeit einschalten**, **Teams zuteilen · 1 von 8** (ab Beginn des
Anmeldefensters in den Eingang, ohne Fenster in die Teilnehmerliste) oder nach der Anmeldung **Spielplan noch nicht erzeugt – Liga
starten**. Stand und Hinweise sieht, wer das Liga-Recht für die Staffel hat. Der Status-Filter der Turnierliste hat eigene Einträge
unter **Liga-Staffeln** („Liga: Anmeldung offen“ …); „Entwurf“ meint dort nur gewöhnliche Turniere, laufende Staffeln stehen weiter
auch unter **Live**.

Am Handy (unter 768 px) steht jede Staffel und jedes Turnier als Karte: Titel, Kennzeichen, Spiel und Format, Teilnehmer, Stand
mit dem Hinweis, was fehlt, die Regeln in einer Zeile und unten die Knöpfe. Seitlich wischen muss man nicht mehr.

<img src="../assets/liga/turnierliste-karten-handy.png" alt="Turnierliste am Handy: Karten untereinander, Staffel A mit Kennzeichen Liga · Staffel A, Stand Anmeldung offen bis 21.11. und darunter Teams zuteilen 1 von 8, Teilnehmer 1/8, Regeln in einer Zeile und die Knöpfe Teilnehmer und Löschen" width="260">

<img src="../assets/liga/turnierliste-liga-stand-pc.png" alt="Turnierliste am PC: Staffel A mit Stand Anmeldung offen bis 21.11. und darunter Teams zuteilen 1 von 8, eine laufende Staffel mit Spielbetrieb, ein Turnier im Entwurf" width="720">

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

**Die Staffel-Seite.** Im Reiter **Ligen und Staffeln** führt bei jeder Staffel **Staffel öffnen** auf ihre Seite. Sie gehört zur
Liga-Verwaltung: Oben stehen die Brotkrumen **Liga › Probe-Liga › Season 1 › Liga 1 · Staffel A** (die Liga springt auf der
Liga-Übersicht an ihre Stelle) und der Stand. Im Reiter **Überblick** findest du den
Liga-Ablauf, was noch fehlt, **Liga starten** bzw. den Status (mit denselben Rückfragen wie bisher), die Zahlen und die Wege zu Leitstand,
Season und Ligaseite. Im Reiter **Teilnehmer** stehen die Co-Teams mit **Co-Team zuteilen**, **Entfernen**, **Austritt**,
**Disqualifizieren**, **Kader** (mit „1 gesperrt“, „1 wartet auf Freigabe“ oder „1 ohne gültige ID“), aktiven Strafen und „Nachgemeldet ab
Woche …“. Im Reiter **Spielplan** stehen die Spielwochen mit Frist und dem Termin je Partie samt Herkunft (vereinbart, Heimrecht,
Standardzeit, von der Liga-Leitung); **ändern** setzt einen Termin (**Spiele betreuen**). Vor dem Start gibt es dort **Vorschau neu
mischen** und **Spieltage neu auslosen** (**Season konfigurieren**), dazu immer **CSV Matchplan** und **PDF Spiele**. Im Reiter **Spiele und
Ergebnisse** steht je Spielwoche jedes Spiel mit Stand, Ergebnis und Hinweisen zu Check-in, Veto, Vorfall und Verfahren; bedient wird das
auf der Matchseite (**Zum Spiel**). Hier gibt es **Ergebnis eintragen** bzw. **korrigieren** und **Beide nicht erschienen** (**Ergebnisse
korrigieren**, im eigenen Spiel trägt eine zweite Person ein). Der Reiter **Tabelle** zeigt die Tabelle mit Zonen, **PDF Tabelle** und den
Gleichstand-Entscheid (3.5). Der Reiter **Protokoll** zeigt das Protokoll der Season nur für diese Staffel (3.0), lesen darf jede
Zuständigkeit. Der Reiter **Einstellungen** hat Unterreiter (am Handy seitlich wischen): **Auftritt** mit Titel, Beschreibung, Banner,
Partner und Stream (**Liga verwalten**; lädt die Staffel zwischendurch neu, bleiben deine Eingaben stehen und ein Hinweis bietet
**Neuen Stand laden** an), **Aus der Season** mit den Vorgaben und dem Map-Pool nur zum Ansehen (geändert wird in der Season),
**Links und Sponsor** mit Zugangslinks und Sponsor je Spielwoche (nur mit **Liga verwalten**), **TV und Helfer** mit **TV-Ansicht
öffnen** (Spieltage, Tabelle, Live-Spiele, am Ende der Meister) und den alten Helfer-Einsätzen nur zum Nachlesen (neue Helfer gibt es
in Staffeln nicht) sowie **Werkzeuge**: **Staffel sperren** bzw. **Entsperren** nach dem Ende (**Liga verwalten**), **Staffel löschen**
nur vor dem Start mit Grund (**Season konfigurieren**). Jeder Unterreiter hat eine eigene Adresse (`#darstellung`, `#vorgaben`,
`#links`, `#helfer`, `#werkzeuge`). Im **Überblick** steht bei **Offen in dieser Staffel** die Zahl
der Aufgaben aus dem Leitstand; der Link öffnet den Leitstand gleich gefiltert. Nach dem Ende zeigt der Überblick dort auch die
**Rückmeldungen der Teams** (Umfrage nach dem Ende, ohne Namen; **Liga verwalten**). Knöpfe gibt es nur mit der passenden
Zuständigkeit: Zuteilen, Entfernen, Austritt und Disqualifizieren mit **Teams freigeben**, Status und **Liga starten** mit **Liga
verwalten**.

**Alte Links:** Die Turnierverwaltung zeigt keine Staffeln mehr. Lesezeichen, Glocken-Einträge und Links auf
`/admin/tournaments/<Staffel>` leiten auf die Staffel-Seite weiter, ein alter Reiter landet an seiner Stelle (`?tab=participants` →
Teilnehmer, `?tab=matchplan` → Spielplan, `?tab=stages` → Spiele und Ergebnisse, `?tab=bracket` → Tabelle, `?tab=edit` →
Einstellungen, `?tab=maps` → Aus der Season, `?tab=staff` → TV und Helfer). Auch **Mein Dienst**, **Läuft noch nach dem Ende**,
**Admin → Strafen** und **Was fehlt** führen direkt auf die Staffel-Seite.

<img src="../assets/liga/staffel-weiterleitung-390.png" alt="Staffel-Seite am Handy nach einem alten Link mit ?tab=participants: Brotkrumen Liga, Probe-Liga, Season 1, darunter Liga 1 · Staffel A, der Reiter Teilnehmer ist offen" width="300">
<img src="../assets/liga/staffel-weiterleitung-1440.png" alt="Dieselbe Staffel-Seite am PC: Brotkrumen mit eigener Stufe für die Liga, Reiter Teilnehmer mit Co-Team zuteilen und der Liste der Co-Teams" width="720">

**TV-Ansicht einer Staffel** (**Einstellungen → TV und Helfer → TV-Ansicht öffnen**): Liga-Wörter auch am Bildschirm – eine
entschiedene Staffel heißt „Staffel entschieden“, die Folie mit den Zahlen „Zahlen zur Staffel“.

<img src="../assets/liga/tv-staffel-1440.png" alt="TV-Ansicht einer beendeten Staffel: Kopf Probe-Liga Season 3 Liga 1 Staffel A mit Staffel entschieden, Spieltage mit Ergebnissen, rechts der Champion" width="720">
<img src="../assets/liga/tv-staffel-390.png" alt="Dieselbe TV-Ansicht schmal: Kopf mit Staffel entschieden über den Spieltagen" width="300">

1. Season-Seite, Reiter **Ligen und Staffeln** → bei der Staffel **Staffel öffnen** → Reiter **Teilnehmer**.
2. **Co-Team zuteilen** → Schritt 1: das **Hauptteam** wählen → Schritt 2: das **Co-Team** → **Zuteilen**.
3. Co-Teams, die nicht passen, stehen grau mit dem Grund da (Kader zu klein oder zu groß, Team schon in der Staffel, Staffel voll, jemand steht schon in einem anderen Co-Team der Season …). Fehlende Geburtsdaten, ein zu junges Mitglied, eine andere Plattform oder zu wenige Spielberechtigte stehen nur als Hinweis da: Zuteilen geht, gesperrt wird beim Check-in (3.9).
4. Bei jedem Co-Team steht je Spieler die **Spiel-ID** (Haken) bzw. **keine ID** (gelb), darunter „Ohne gültige
   Activision-ID: …“ mit den Namen. Zuteilen geht trotzdem; diese Spieler können erst aufgestellt werden, wenn die ID
   im Profil steht. Sie und die Verantwortlichen des Co-Teams bekommen eine Nachricht.

Beim Zuteilen wird die ID jedes Spielers für die Season **festgehalten** (3.7). Die Captains und Vertreter bekommen
eine Benachrichtigung. **Entfernen** in der Teilnehmerliste geht nur bis zum
Start. Bis dahin ist der Spielplan eine Vorschau und wird bei jeder Änderung neu gemischt.

### 2.5a Selbstanmeldung

Captains und Vertreter melden ihr Co-Team selbst auf der Ligaseite an, du entscheidest. Ohne Anmeldefenster gibt es das nicht, dann bleibt es beim Zuteilen aus 2.5. Das Zuteilen bleibt auch danach als Sonderweg.

**Nachmeldung:** Das Fenster darf über den Beginn der Season hinausgehen. Dann steht unter „Anmeldung bis“ und auf der Ligaseite „Anmeldung läuft nach Season-Start weiter (bis …)“. Wie es weitergeht, steht unten unter „Nachmeldung nach dem Season-Start“.

**Einrichten** (Season-Seite, Reiter **Anmeldung und Kader** → **Selbstanmeldung**, Zuständigkeit „Season konfigurieren“):

1. **Anmeldung ab** und **Anmeldung bis** in Wiener Zeit eintragen. Beides oder nichts.
2. **Startplätze** eintragen. Leer heißt: keine Grenze außer der Staffelgröße.
3. **Warteliste** an- oder abschalten, auf Wunsch eine Höchstzahl und eine **Regel zur Warteliste**. Die Regel steht öffentlich auf der Ligaseite.
4. **Wer darf sich anmelden:** alle Konten (Vorgabe) oder nur Vereinsmitglieder. Bei Mitgliedern gilt das für den ganzen Kader.
5. **Zwei Co-Teams eines Hauptteams in derselben Staffel:** Vorgabe Nein.
5a. **Anmeldungen automatisch annehmen:** Vorgabe aus, dann prüfst du jede Anmeldung. Mehr dazu unten unter „Automatisch annehmen“.
6. **Hinweis zum Datenschutz:** Der Text steht bei der Anmeldung über dem Link zur Datenschutzerklärung und wird mit der Zustimmung gespeichert. Leer steht dort ein vorläufiger Platzhalter-Satz. Den Wortlaut gibt der Obmann frei.
7. **Regelwerk veröffentlichen** (2.11): Ohne gültige Version geht keine Anmeldung. Der alte Regeltext reicht dafür nicht, weil er keine Version hat und sich eine Zustimmung darauf nicht belegen lässt.

**Nachmeldung nach dem Season-Start** (#2422):

- **Frist:** Unter **Selbstanmeldung** steht **Nachmeldung bis (Tage nach dem Start)**. Leer heißt 14 Tage, `0` heißt nur bis zum Start.
  Danach schließt die Anmeldung, auch wenn **Anmeldung bis** später liegt. Der Satz darunter nennt das wirksame Ende. **Was fehlt
  noch?** meldet es als Hinweis.
- **Verlängern:** **Mit Grund verlängern** → neues Ende (höchstens bis **Anmeldung bis**) und Grund (mindestens 5 Zeichen) →
  **Verlängern**. Der Grund steht im Protokoll. **Verlängerung zurücknehmen** geht auch nur mit Grund.
- **Spiele nachtragen:** Teilst du ein Co-Team einer Staffel zu, deren Spielplan schon fest ist, legt das Zuteilen noch keine Spiele an.
  Das Team steht im Reiter **Anmeldung und Kader** unter **Nachmeldungen** (auch nach dem Sonderweg **Co-Team zuteilen**).
  **Spiele nachtragen** zeigt die Vorschau: je Paarung Woche, Heim und Gast, warum die Woche frei ist und den Standardtermin. Darunter
  steht, was entfällt („Gegen X kein Spiel mehr möglich.“). **… Spiele anlegen** legt sie an, beide Seiten bekommen eine Nachricht.
- **Regeln dahinter:** Das Team spielt nur in Wochen, die noch nicht begonnen haben. Nachholspiele für vergangene Wochen gibt es nicht.
  Eine Paarung braucht eine Woche, in der beide frei sind: Der Gegner hat spielfrei (ungerade Teamzahl), es ist eine Reservewoche nach
  dem letzten Spieltag, oder das Spiel des Gegners ist abgesagt. Bei gerader Teamzahl ohne Reservewoche passt kein Spiel. Dann
  bestätigst du **ohne Spiele**, das Team zählt ab jetzt. Gespielte Wochen, Ergebnisse und Termine bleiben unverändert. Hat sich der
  Spielplan seit der Vorschau geändert, sagt es die Meldung, und die Vorschau lädt neu. Ein verschobenes Spiel belegt auch die Woche
  seines Termins. Eine Disqualifikation, gegen die noch Einspruch oder Widerruf möglich ist, gibt die Woche des abgesagten Spiels nicht
  frei. Beides steht als Hinweis in der Vorschau.
- **Eigenes Team:** Spielst du selbst im Co-Team, bestätigt eine andere Person. Als Superadmin geht es nur mit einem Grund für die
  Notausnahme.
- **Abschluss:** Eine noch offene Nachmeldung steht im Reiter **Abschluss** als Hinweis „Nachmeldung nicht entschieden“ mit Link. Sie hält
  den Abschluss nicht auf.
- **Strafe zurücknehmen:** Liegt ein Spiel, das durch den Widerruf einer Disqualifikation zurückkäme, in einer Woche mit einem
  Nachmeldespiel einer der beiden Seiten, bricht der Widerruf mit einer Meldung ab. Sag zuerst das Nachmeldespiel ab oder verlege es.
- **Tabelle:** Das Team steht mit „Nachgemeldet ab Woche X“ in Tabelle, Ligaseite, TV und PDF. Es hat weniger Spiele. Gewertet wird
  wie immer nach Punkten, es gibt keine Wertung nach Punkten je Spiel. Abschluss, Folge-Season und Gesamtwertung zählen das Team normal.

<img src="../assets/liga/nachmeldung-vorschau-1440.png" alt="Vorschau „Spiele nachtragen“: zwei Paarungen in Woche 3 (Freilos des Gegners) und Woche 4 (Reservewoche) mit Standardtermin, darunter „Gegen … kein Spiel mehr möglich.“" width="720">

**Entscheiden** (Season-Seite, Reiter **Anmeldung und Kader** → **Anmeldungen**, Zuständigkeit „Teams freigeben“). Bei jeder neuen Anmeldung bekommst du eine Nachricht mit Link; er öffnet den Reiter gleich an dieser Stelle. Je Anmeldung steht da, wer eingereicht hat, welcher Regelversion und wann zugestimmt wurde und was der Kader gerade nicht erfüllt.

**Offene Punkte** (#2313): Fehlen im Kader Angaben (Geburtsdatum, Spiel-ID, Plattform, Alter) oder sind zu wenige spielberechtigt, steht das im Kasten **Offene Punkte** – mit Zahl und Namen. Das hält nichts auf, du darfst trotzdem annehmen und zuteilen. Gesperrt wird erst beim Check-in und bei der Aufstellung (3.9), das Team wird erinnert.

<img src="../assets/liga/liga-eingang-offene-punkte-1440.png" alt="Eingang der Anmeldungen mit dem Kasten Offene Punkte und freien Knöpfen zum Annehmen" width="640">

| Knopf | Was passiert |
| --- | --- |
| **In Prüfung nehmen** | Das Team sieht „In Prüfung“. Freiwillig |
| **Annehmen** | Belegt einen Startplatz. Mit gewählter Staffel ist das Co-Team gleich zugeteilt, sonst teilst du später zu |
| **Zuteilen** | Für Angenommene ohne Staffel. Erst jetzt steht das Team in der Staffel, und der Kader wird noch einmal geprüft. Bei mehreren Staffeln einer Liga geht es für alle auf einmal mit dem Los (2.5b) |
| **Warteliste** | Kein Startplatz. Rückt nicht von selbst nach: Wird ein Platz frei, nimmst du von Hand an. Eine schon angenommene Anmeldung setzt du nur mit Grund zurück, das Team liest ihn |
| **Ablehnen** | Nur mit Grund (mindestens fünf Zeichen). Captain und Vertreter lesen ihn. Das Team darf im offenen Fenster neu einreichen |

**Neue Co-Teams starten in der untersten Liga** (Schalter unter **Selbstanmeldung**, bei neuen Seasons an): Gibt es mehrere Ligen, stehen in der Auswahl **Staffel** zuerst die Staffeln der untersten Liga. Die anderen tragen den Zusatz „höhere Liga, nur mit Grund“: Wählst du eine davon, erscheint das Feld **Grund für die andere Liga** (mindestens fünf Zeichen), sonst geht Annehmen bzw. Zuteilen nicht. Der Grund steht im Verlauf der Anmeldung und im Protokoll. Co-Teams aus der Vorgänger-Season behalten ihre Liga aus Auf- und Abstieg (3.11). Schalter aus: Du teilst frei zu. Seasons, die es schon vor dieser Einstellung gab, haben ihn aus.

Hat sich der Kader seit dem Einreichen geändert, sagt das die Anmeldung, und Annehmen oder Zuteilen lehnen mit demselben Satz ab. Sind alle Plätze belegt, geht **Annehmen** nicht mehr. Mit Warteliste nimmt die Season weiter Anmeldungen an, ohne Warteliste endet die Anmeldung.

**Automatisch annehmen** (Schalter unter **Selbstanmeldung**): Ist er an, ist eine gültige Anmeldung beim Einreichen sofort angenommen und belegt einen Startplatz. Anmeldungen, die noch auf deine Prüfung warten, halten dabei ihren Platz: Eine neue wird nur angenommen, wenn nach ihnen noch ein Platz frei ist. Es gelten dieselben Regeln wie sonst (Fenster, Regelwerk, wer sich anmelden darf, ein Co-Team je Season); fehlende Angaben halten auch hier nicht auf. Sind alle Plätze vergeben oder wartet schon jemand auf der Warteliste, kommt die Anmeldung auf die Warteliste – einen frei gewordenen Platz vergibst du wie bisher. Gibt es nur eine Staffel, steht das Co-Team gleich darin; bei mehreren teilst du zu, das Team sieht so lange „Angemeldet – Zuteilung folgt“. Geht die einzige Staffel nicht (voll, gesperrt, schon begonnen), ist das Co-Team ohne Staffel angenommen, und im Eingang steht „Nicht automatisch zugeteilt: …“ mit dem Grund. Steht schon ein anderes Co-Team desselben Hauptteams in der einzigen Staffel, nimmt die Season nicht an: Die Anmeldung bleibt bei dir, mit „Nicht automatisch angenommen: …“. Den Grund liest du auch in deiner Nachricht. Du bekommst zu jeder automatischen Annahme eine Nachricht, im Eingang steht „Automatisch angenommen“ und im Verlauf „Angenommen, automatisch“. Das gilt auch für dein eigenes Team, weil niemand entschieden hat; die anderen Zuständigen sehen dann im Eingang „Team der Leitung – automatisch angenommen“. Das Umschalten steht mit dem Wert vorher und nachher im Protokoll.

<img src="../assets/liga/liga-verwaltung-auto-annehmen-1440.png" alt="Selbstanmeldung mit eingeschaltetem Schalter Anmeldungen automatisch annehmen und dem Hinweis auf zwei offene Anmeldungen" width="640">

Passt eine automatisch angenommene Anmeldung nicht, **lehnst du sie ab** oder setzt sie auf die **Warteliste** – beides nur mit Grund, das Team liest ihn. Hat die Season das Co-Team automatisch in die einzige Staffel gesetzt, nimmt Ablehnen oder Warteliste es dort wieder heraus, solange der Spielplan noch nicht steht; danach geht es nur über **Austritt eintragen** in der Teilnehmerliste. Über das eigene Team entscheidet auch hier eine andere Person. Schaltest du die Einstellung später ein, bleiben offene Anmeldungen von vorher bei dir: Sie halten ihren Platz – wer zuerst kommt, wird zuerst bedient. Die Ligaseite zählt sie darum bei den freien Startplätzen schon mit, und wartet jemand auf der Warteliste, steht dort kein freier Platz. Unter dem Schalter steht dann „X Anmeldungen warten auf Prüfung und halten ihren Platz frei. Entscheide sie im Eingang.“

Teilst du ein Co-Team mit offener Anmeldung über 2.5 direkt zu, gilt die Anmeldung als angenommen. Nimmst du die Zuteilung zurück, bleibt sie angenommen und hält ihren Platz, bis du neu zuteilst oder ablehnst. Zugeteilte zieht niemand per Klick zurück: Den Austritt trägst du in der Teilnehmerliste ein. Ausnahme: Hat die Season das Co-Team automatisch zugeteilt, zieht das Team selbst zurück, solange der Spielplan nicht steht und der Check-in noch nicht begonnen hat. Die Warteliste bleibt dabei, wie sie ist; über den freien Platz entscheidest du.

**Eigenes Team:** Über die Anmeldung deines eigenen Teams entscheidet eine andere Person. Eigenes Team heißt: Du stehst im Kader des Co-Teams, bist Captain oder Vertreter, leitest das Hauptteam mit oder hast den Antrag eingereicht. Dann stehen bei dieser Anmeldung keine Knöpfe, sondern der Satz „Über dein eigenes Team entscheidet eine andere Person.“ Die Anmeldungen der anderen Teams entscheidest du wie gewohnt. Dasselbe gilt für **Co-Team zuteilen** (2.5), wenn das Co-Team eine offene Anmeldung hat. Nur der **Superadmin** darf als Notausnahme: Er trägt bei der Anmeldung einen **Grund für die Notausnahme** ein (mindestens fünf Zeichen), erst dann gehen die Knöpfe. Der Grund steht im Verlauf der Anmeldung und im Protokoll.

### 2.5b Staffeln auslosen

Hat eine Liga mehrere Staffeln, verteilt das Los die angenommenen Co-Teams. Mit nur einer Staffel brauchst du es nicht, dann teilst
du im Eingang zu (2.5a).

**Wo:** Season-Seite, Reiter **Anmeldung und Kader** → **Staffeln auslosen** (unter dem Eingang). Recht: „Teams freigeben“. Der
Abschnitt erscheint, sobald eine Liga mehrere Staffeln und wartende Co-Teams hat oder die Teams nicht in die Staffeln passen.

**1. Platzprüfung lesen.** Je Liga steht, wie viele Co-Teams auf eine Staffel warten und ob sie hineinpassen, etwa „9 Co-Teams,
höchstens 8 je Staffel: 2 Staffeln mit 5 und 4 Teams. Es gibt 1 Staffel – es fehlt 1.“ Gerechnet wird mit „Teams je Staffel
höchstens“ und den aktiven Wochen der Season. Fehlt eine Staffel: im Reiter **Ligen und Staffeln** anlegen (2.3).

**2. Auslosen.** Der Knopf **Auslosen** öffnet die Vorschau. Noch ist nichts zugeteilt, und kein Team bekommt eine Nachricht.

<img src="../assets/liga/los-vorschau-1440.png" alt="Vorschau des Loses für Liga 1 am PC: Los Nr. 1 mit Seed, darunter Staffel A und Staffel B mit ihren Teams und einem Tausch-Knopf je Team, darunter Neu auslosen, Verwerfen und das Protokoll, unten der Knopf 6 Co-Teams zuteilen" width="720">

- **Gleich große Staffeln:** Der Unterschied ist höchstens ein Team. Wer schon in einer Staffel steht, bleibt dort („schon
  zugeteilt“), das Los füllt darum herum auf.
- **Co-Teams eines Hauptteams** stehen nie in derselben Staffel, außer die Season erlaubt es (2.5a). Hat ein Hauptteam mehr Co-Teams
  als Staffeln, sagt das Los es und verteilt nichts.
- **Seed:** Die Zeichenfolge unter dem Titel. Dieselben Co-Teams und Staffeln mit demselben Seed ergeben immer dieselbe Verteilung.
  Neu laden oder ein zweiter Klick auf **Auslosen** würfelt nicht neu.
- **Wer gelost wird:** Co-Teams aus der Vorgänger-Season in ihrer neuen Liga (3.11), neue Co-Teams in der untersten Liga. Soll ein
  neues Co-Team höher starten, teilst du es vorher im Eingang von Hand zu, mit Grund (2.5a).

**3. Tauschen (freiwillig).** Der Pfeil neben einem Team öffnet den Tausch: Partner aus einer anderen Staffel wählen, **Grund**
eintragen (mindestens fünf Zeichen), **Tauschen**. Die Größen bleiben, die Regel für Co-Teams eines Hauptteams wird neu geprüft.
Getauschte Teams tragen den Vermerk „getauscht“, der Grund steht mit deinem Namen im Protokoll.

**4. Zuteilen.** Der Knopf unten rechts („6 Co-Teams zuteilen“) schreibt die Staffeln fest: Jedes Co-Team steht in seiner Staffel,
der Kader wird noch einmal geprüft, Captains und Vertreter bekommen die Nachricht wie nach jedem Zuteilen. Passt ein Kader nicht
mehr, nennt die Meldung Team und Grund, und niemand wird zugeteilt.

| Knopf | Was passiert |
| --- | --- |
| **Neu auslosen** | Neuer Seed, neues Los („Los Nr. 2“). Nur mit Grund, er steht im Protokoll |
| **Verwerfen** | Das Los ist weg, zugeteilt wird von Hand oder mit einem neuen Los. Nur mit Grund |
| **Schließen** | Die Vorschau bleibt gespeichert, du kannst später weitermachen |

**Veraltet:** Kommt nach dem Auslosen eine Anmeldung dazu, zieht jemand zurück oder ändert sich eine Staffel, steht „veraltet“ am Los.
Es lässt sich dann nicht mehr zuteilen. **Neu auslosen** geht in diesem Fall ohne Grund.

**Danach** bleibt das Los zum Nachlesen stehen (**Los ansehen**): Seed, Verteilung, Tausche und wer wann was getan hat. Lost du
später noch einmal, etwa für Nachzügler, bleibt der Verlauf des ersten Loses im Protokoll stehen. Ändern geht
dann nur noch über die Teilnehmerliste der Staffel. Nicht gelost wird, sobald eine Staffel der Liga begonnen hat oder ihr Spielplan
steht: Dann teilst du von Hand zu (Nachmeldung, siehe 2.5a).

**Eigenes Team:** Steht dein eigenes Team im Los, lost, tauscht und teilt eine andere Person zu (wie in 2.5a).

### 2.6 Spielplan und Start

Auf der Staffel-Seite im Reiter **Überblick**: **Liga starten**. Damit wird der Spielplan fest (etwa acht Teams: sieben Spieltage
zu je vier Spielen, Heimrecht ausgeglichen, gesperrte Wochen werden übersprungen) und die Staffel steht auf **Live**. Ab jetzt können die Captains Termine vorschlagen und melden. Mit der ersten Staffel springt
die Season von *Entwurf* auf *Läuft*, ein von Hand gesetzter Stand bleibt.

- Kein **Turnier-Check-in** und keine Turnier-Anmeldung – die Co-Teams sind zugeteilt. Eingecheckt wird je Spiel auf der
  Matchseite (2.7b, 3.1b), angemeldet über die Season (2.5a). Vor dem Start gibt es nur **Liga starten** und **Staffel
  absagen**, danach bietet die Auswahl Spielbetrieb, Pausiert, Beendet und Abgesagt.
- Den Spielplan vor dem Start ansehen: Reiter **Spielplan** (Vorschau mit Spielwochen) bzw. **Spiele und Ergebnisse**. Neu
  mischen: Reiter **Spielplan** → **Vorschau neu mischen** – nur vor dem Start; danach steht der Spielplan.

Die Staffel-Seite zeigt nur, was die Liga braucht. Oben stehen die Brotkrumen, im **Überblick** die Wege zu Season und
Ligaseite. Unter **Einstellungen → Aus der Season** stehen die Werte der Season (Spiel, Start und
Ende, Spielwoche, Standardtermin, Teamgröße, Staffelgröße, Best of, Bestätigungsfrist, Antwortfrist auf
Terminvorschläge, Sichtbarkeit, Regeltext) nur zum Lesen unter **Aus der Season** – ändern in der Season, dann
**Vorgaben übertragen** (2.7). Auch den Map-Pool pflegt die Season. Anmeldung, Check-in, Discord, Preise, Jahreswertung,
Setzliste und Weiterkommen gibt es in der Staffel nicht. Änderbar bleiben unter **Einstellungen → Auftritt** Titel,
Beschreibung, Banner, Partner und Streaming. Die Antwortfrist ändert sich nur noch über die Season (oder Liga N) und **Vorgaben übertragen** – auch bei
älteren Seasons: dort ist das Feld leer und jede Staffel behält ihre bisherige Frist, bis du in der Season einen Wert
einträgst und überträgst.

Eine Staffel lässt sich nur **vor dem Start** löschen – auf der Staffel-Seite unter **Einstellungen → Werkzeuge** oder auf der
Season-Seite (2.9). Danach bleibt sie: Status **Abgesagt** oder **Archiviert**. In der Turnierliste stehen keine Staffeln.

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
| Punkteart (Sieg/Remis/Niederlage oder gewonnene Maps) mit Reihenfolge bei Punktgleichheit und Kampflos | auch während der Season, wenn sich die Punkteart ändert; nicht bei gesperrten oder beendeten Staffeln |
| Sichtbarkeit | sofort beim Speichern, ohne Übertragen |
| Terminregeln (Kasten „Termine und Verschiebungen“) | sofort beim Speichern des Kastens; gesperrte Staffeln beim Übertragen |
| Check-in (Kasten „Check-in vor dem Spiel“) | sofort beim Speichern des Kastens; gesperrte Staffeln beim Übertragen |
| Veto (Kasten „Veto“, 2.7d) | sofort beim Speichern des Kastens; gesperrte Staffeln beim Übertragen; ein laufendes Veto behält seinen Stand |
| Vorgabe der Woche (im Kasten „Veto“, 2.7d) | sofort mit **Vorgaben speichern**, für alle Staffeln und ohne Übertragen; gilt für Spiele, deren Veto noch nicht begonnen hat |
| Vorfälle und Pausen (Abschnitt im Reiter Spielbetrieb, 2.7e) | beim Übertragen, auch während der Season; nicht bei gesperrten Staffeln. Ein schon gemeldeter Vorfall behält seine Antwortzeit |

### 2.7a Termine und Verschiebungen (Regelwerk § 7)

Im Reiter **Termine** der Season-Seite steht der Kasten **Termine und Verschiebungen** (Zuständigkeit „Season konfigurieren“). Er hat ein eigenes
**Terminregeln speichern** und gilt sofort für alle Staffeln der Season. Neue Seasons bekommen die Vorgaben; eine ältere Season
sagt „Diese Season ist älter als die Terminregeln“ – dort gilt ein Vorschlag der Heimseite sofort und es gibt keine
Verschiebung, bis ihr einmal speichert.

| Feld | Vorgabe | Wirkung |
| --- | --- | --- |
| **72-h-Regel** (an/aus) und **Frist (Stunden)** | an, 72 | Antwortet die Gastseite nicht auf einen Vorschlag der Heimseite, gilt er nach der Frist – nur in der Spielwoche, nicht in einer Sperrzeit, nur in der Zukunft. Sonst gilt der Standardtermin. Sperrzeiten zählen nicht mit. Das Regelwerk nennt die Regel nach der eingestellten Frist, bei 48 Stunden also „48-h-Regel“ |
| **Verschieben bis (Stunden vor dem Termin)** | 24 | später beantragen geht nicht mehr |
| **Verschiebungen je Spiel** | 2 | 0 heißt: nur die Leitung verschiebt |
| **Verschieben nur innerhalb der Spielwoche** | an | wochenübergreifend entscheidet die Leitung |
| **Erinnerung ohne Ergebnis** | 24 h nach dem Termin | Nachricht an Captain und Vertreter beider Seiten; abschalten unter **Erinnerungen** (2.7f) |
| **Überfällig nach** | 48 h nach dem Termin | das Spiel steht bei euch unter **Mein Dienst → Braucht deine Entscheidung** |

Alles, was über diese Grenzen geht (später, öfter, in eine andere Woche), legt die Liga-Leitung fest – siehe 3.1.

### 2.7b Check-in vor dem Spiel (Regelwerk § 8)

Auf der Season-Seite im Reiter **Termine** steht unter den Terminregeln der Kasten **Check-in vor dem Spiel** (Zuständigkeit „Season
konfigurieren“), mit eigenem **Check-in speichern**; er gilt sofort für alle Staffeln der Season. Neue Seasons bekommen die Vorgaben; eine ältere Season sagt
„Diese Season ist älter als der Check-in“ – dort gibt es keinen Check-in und keinen Vorschlag „nicht erschienen“, bis ihr einmal
speichert.

| Feld | Vorgabe | Wirkung |
| --- | --- | --- |
| **Öffnet (Minuten vor dem Termin)** | 15 | Nr. 19: ab dann checken Captain oder Vertreter ihre Seite ein |
| **Schließt (Minuten nach dem Termin)** | 15 | danach kein Check-in mehr durch die Seiten – ihr könnt nachtragen oder verlängern |
| **Mindestens Anwesende je Seite** | 3 (aus Teilnehmerliste oder Teamgröße − 1) | Nr. 46: nur Spieler aus dem Kader, nur wer spielen darf (3.9); bis zum Schluss lässt sich ergänzen |
| **Erinnerung vor Schluss (Minuten)** | 5 | zweite Nachricht an Seiten ohne Check-in; 0 = keine |
| **Erinnerung an fehlende Angaben (Stunden vor dem ersten Spiel)** | 48 | einmal je Team vor dem ersten Spiel: an jeden, dem Geburtsdatum, Spiel-ID oder Plattform fehlt, und an Captain und Vertreter (3.9); 0 = keine. Steht nicht im Regelwerk |

Wie es dann läuft, steht in 3.1b. Im Regelwerk nennt der Baustein `[[baustein:checkin]]` diese Werte (2.11).

### 2.7c Plattform und Eingabegerät

Eine Season kann nur für PC, nur für PlayStation, für mehrere oder alle Plattformen sein. Im Reiter **Anmeldung und Kader** steht dafür
der Kasten **Plattform und Eingabegerät** (Zuständigkeit „Season konfigurieren“, Adresse `#plattform`) mit eigenem **Plattform
speichern**. Er gilt sofort, ohne Übertragen, auch in laufenden Staffeln.

<img src="../assets/liga/liga-season-plattform-pc.png" alt="Kasten Plattform und Eingabegerät: Feld Plattform gewählt, nur PC angehakt, Crossplay aus, darunter was je Liga gilt" width="560">

1. **In welchem Feld steht die Plattform?** Wählt das Spiel-ID-Feld mit Auswahl, etwa „Plattform“. Fehlt es, legt es zuerst unter
   **Admin → Spiele → Spiel → Spiel-IDs** an: Feld mit den Auswahlwerten (PC, PlayStation …) und dem Haken **Plattform**. Ein so
   gekennzeichnetes Feld schlägt der Kasten vor („Vorschlag: „Plattform“ – am Spiel als Plattform gekennzeichnet“, **Übernehmen**);
   in der Auswahl steht es mit „(am Spiel als Plattform gekennzeichnet)“. Den Haken gibt es höchstens einmal je Spiel, eine
   Spielversion erbt ihn über die ID-Quelle. **Damit die Plattform je Season festgehalten wird, das Plattform-Feld am Spiel als
   Pflicht führen.** Dann gilt sie wie die Spiel-ID die ganze Season; ein freiwilliges Feld liest immer den aktuellen Wert im
   Profil – die Karte des Felds sagt das, und im Profil steht beim Feld „Deine Plattform“.
2. **Erlaubte Plattformen** anhaken. Nichts angehakt: alle erlaubt, keine Prüfung. Alle angehakt: jede erlaubt, die Angabe ist aber Pflicht.
3. **Crossplay** (an, aus) und **Eingabegerät** (Controller, Maus und Tastatur, beides) sind nur Angaben für Regelwerk und
   Ligaseite. Geprüft werden sie nicht.

Darunter steht **So gilt es je Liga**. Eine Liga N weicht im Liga-N-Blatt ab (Reiter **Ligen und Staffeln**, Stift bei der Liga, Abschnitt
**Plattform**): **Eigene Plattformen für diese Liga** anhaken und wählen. Mit Haken und ohne Auswahl sind in dieser Liga alle Plattformen
erlaubt. Crossplay und Eingabegerät stehen dort auf „wie Season“, bis ihr etwas anderes wählt.

Wer auf einer anderen Plattform spielt, ist nicht spielberechtigt und sieht den Grund, etwa „Diese Season ist nur für PC – angegeben
ist PlayStation.“ Wer keine Plattform angibt, bekommt „Plattform fehlt im Profil“. Wo das wirkt, steht in 3.9.

### 2.7d Veto: Maps vor dem Spiel sperren und wählen (Regelwerk § 6, Anlage B)

Auf der Season-Seite im Reiter **Spielbetrieb** steht direkt unter **Serie** der Kasten **Veto** (Zuständigkeit „Season konfigurieren“),
mit eigenem **Veto speichern**; er gilt sofort für alle Staffeln der Season, zu denen er passt, ein gerade laufendes Veto behält seinen
Stand. Neue Seasons
beginnen mit **Veto an**: Die Vorlage folgt automatisch dem Map-Pool, **Modus je Map** und dem **Best of** der Season (wie **Vorschlag
aus Modusfolge und Pools**) – bei jedem Speichern oder Entfernen des Pools, bei „Map aus dem Pool nehmen“ und beim Speichern einer neuen Modusfolge
oder eines neuen Best of unter **Serie** –, bis ihr den Kasten das erste Mal speichert; der Kasten sagt das, solange es gilt. Danach
bleibt die Vorlage, wie ihr sie gespeichert habt, und **Was fehlt noch?** im Überblick nennt, was mit Pool, Modusfolge oder Best of
nicht mehr aufgeht. Spielt eine Liga N ein eigenes Best of, behält sie eine Vorlage, die zu ihr passt – dort läuft das Veto weiter, auch
wenn die Season ein anderes Best of bekommt. Hat sie keine passende (ihr Best of wich schon immer ab), läuft dort kein Veto: Nach dem
Speichern eines neuen Best of sagt eine Warnung, welche Liga betroffen ist, **Was fehlt noch?** ebenso. Ein Veto, das an einem Spiel schon
läuft, behält seinen Stand.
**Eine Staffel bekommt die Vorlage nur, wenn sie zu ihr passt** – zu ihrem Best of, ihrer Modusfolge und ihrem Pool. Die kommen erst mit
**Vorgaben auf Staffeln übertragen** an die Staffel, nach dem ersten Ergebnis gar nicht mehr. Bis dahin behält die Staffel ihre bisherige
Vorlage, und eine Warnung sagt es – zusammengefasst, ein Satz je Fall mit höchstens drei Staffeln und „und 2 weitere“:
- „In 8 Staffeln gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“.“ – nach dem Übertragen passt sie (bei einer
  Staffel steht ihr Name da). Der Map-Pool geht dabei immer mit, auch nach dem ersten Ergebnis.
- „Liga 1 · Staffel A und Liga 1 · Staffel B spielen weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage.“ – sie passt dort auch
  nach dem Übertragen nicht (nach dem ersten Ergebnis bleiben Best of und Modusfolge). So läuft dort das Veto weiter wie bisher.
- „Die Veto-Vorlage passt noch nicht zur Season (siehe Kasten Veto) – die Staffeln behalten ihre bisherige.“ – dann zuerst die Vorlage
  im Kasten **Veto** in Ordnung bringen.

Konnte die Vorlage gerade nicht nachgezogen werden (jemand anderes ändert sie im selben Moment), sagt eine Warnung, Pool oder Serie gleich
noch einmal zu speichern.
Drückt ihr **Vorschlag** oder ändert Schritte, stehen Meldungen zur alten, gespeicherten Vorlage nur noch klein darunter als
**Gespeicherter Stand** – bis ihr **Veto speichern** drückt. Ältere
Seasons ohne Kasten bleiben aus – dort tragen die Teams die Maps wie bisher beim Ergebnis ein. Das Veto braucht den **Check-in** (2.7b):
Es beginnt, sobald beide Seiten eingecheckt sind, Map 1 folgt direkt danach.

| Feld | Vorgabe | Wirkung |
| --- | --- | --- |
| **Veto in dieser Season** | an (neue Seasons) | an: nach dem Check-in sperren und wählen die Teams nach der Schrittfolge; aus: Maps beim Ergebnis |
| **Team A** | Heimteam laut Spielplan | Nr. 22: Team A beginnt laut Vorlage, Team B ist die andere Seite. „Los je Spiel“: der Server lost je Spiel einmal, nie neu beim Neuladen |
| **Zeit je Schritt (Sekunden)** | 60 | Nr. 23: läuft die Zeit ab, wählt das System zufällig aus den noch zulässigen Maps – das Veto bleibt nie stehen |
| **Schrittfolge** | leer | je Schritt: **Sperren** oder **Wählen** durch Team A oder B in einem Modus, **Decider** (die übrige Map des Modus, setzt das System) oder **Vorgabe** (die Map legt ihr je Spielwoche fest, siehe unten); Wahl, Decider und Vorgabe bekommen ihre **Position** in der Serie (Map 1 bis Best of). Die Reihenfolge der Schritte ist die des Vetos, nicht die Spielreihenfolge |

So geht es am schnellsten: **Vorschlag aus Modusfolge und Pools** baut eine Folge nach Anlage B aus „Modus je Map“, den Poolgrößen und
dem Best of – je Modus beginnt abwechselnd Team A und B; ein Modus mit einer Position sperrt bis eine Map bleibt und endet mit dem Decider,
ein Modus mit mehreren sperrt bis so viele Maps bleiben wie Positionen und wählt dann abwechselnd. Danach anpassen (Schritte ordnen,
löschen, hinzufügen) und speichern. Die Prüfung läuft live und sagt in Sätzen, was nicht aufgeht: jede Position genau einmal, der Modus
der Position wie in „Modus je Map“, genug Maps je Modus für Sperren und Wahlen, vor einem Decider genau eine übrige Map. Mit Veto an
lässt sich nur eine Vorlage speichern, die aufgeht; mit Veto aus bleibt ein Entwurf speicherbar. **Was fehlt noch?** im Überblick nennt
eine Vorlage, die nach einer Pool-Änderung nicht mehr passt, und eine Season ohne Check-in. Spielt eine Liga N ein anderes Best of als
die Season, läuft dort kein Veto (Warnung) – die Maps kommen dann beim Ergebnis. Wie es dann läuft, steht in 3.1c. Im Regelwerk nennt
der Baustein `[[baustein:veto]]` die Vorlage, `{{veto.step_seconds}}` die Zeit je Schritt (2.11).

**Vorgabe der Woche** (Entscheidung Nr. 122): Soll in einem Modus nicht gesperrt und gewählt werden, sondern die Leitung die Map
festlegen, nehmt in der Schrittfolge die Art **Vorgabe** – mit Modus und Position, ohne Team, höchstens eine je Modus. Die Prüfung
rechnet sie ein: Die vorgegebene Map braucht einen Platz im Pool des Modus und fehlt den Teams beim Sperren und Wählen. Nach **Veto
speichern** steht im selben Kasten der Block **Vorgabe der Woche**:

1. Je **Spielwoche** eine Zeile mit den Tagen der Woche. Wählt je Modus die Map aus dem Pool. Oben steht, welche Wochen noch fehlen;
   diese Zeilen sind markiert.
2. **Rotiert automatisch durch den Pool** füllt die **leeren** Wochen als Vorschlag: Woche für Woche die nächste Map in der
   Reihenfolge des Pools, danach wieder die erste. Was ihr schon gewählt habt, bleibt. Jede Woche lässt sich danach einzeln ändern.
3. **Alle neu verteilen** ersetzt auch gewählte Wochen. Vorher fragt die Seite nach und nennt, wie viele gewählte Wochen das
   überschreibt.
4. **Vergangene Wochen und Wochen, in denen schon ein Veto begonnen hat**, fasst keiner der beiden Knöpfe an. An der Zeile steht
   „vorbei“ bzw. „Veto begonnen“. Von Hand könnt ihr sie weiter ändern.
5. Was ihr geändert habt, bleibt bis zum Speichern als **geändert** markiert. **Vorgaben speichern**. Lücken dürfen bleiben, ihr
   könnt also Woche für Woche eintragen. Darunter zeigt **Verlauf**, wer wann welche Woche geändert hat.

<img src="../assets/liga/veto-vorgabe-der-woche-verwaltung.png" alt="Kasten Veto, Block Vorgabe der Woche: oben die Knöpfe Rotiert automatisch durch den Pool und Alle neu verteilen und der Hinweis, welche Spielwochen noch fehlen, darunter je Spielwoche eine Zeile mit den Tagen und der Auswahl der Map; fehlende Wochen sind markiert, die vergangene Woche trägt den Vermerk vorbei" width="640">

Was gilt:

- **Spielwoche heißt Spieltag.** Der Block schreibt „Spielwoche 3“ mit den Tagen dieser Woche. Gemeint ist der dritte Spieltag, also
  die dritte Woche, in der gespielt wird (Sperrwochen zählen nicht mit). Die Vorgabe gilt für alle Spiele dieser Spielwoche.
- **Ein verschobenes Spiel bleibt in seiner Spielwoche.** Es spielt die Vorgabe seines Spieltags, auch wenn es erst in einer späteren
  Woche stattfindet – nicht die Vorgabe der Woche, in die der neue Termin fällt.
- **Ohne Vorgabe beginnt das Veto nicht.** Sind beide Seiten eingecheckt und für die Woche fehlt die Map, sagt die Matchseite das, und
  ihr bekommt einen Hinweis (einmal je Spielwoche, mit Link zum Kasten). Gewertet wird nichts von selbst.
- **Nachtragen startet das Veto nicht.** Speichert ihr die fehlende Vorgabe, bekommen die Captains (bzw. Vertreter) beider Seiten die
  Nachricht „Vorgabe da – Veto kann starten“. Das Veto beginnt erst, wenn **beide Seiten** auf der Matchseite **Bereit zum Veto**
  getippt haben – so läuft keine Zeit ab, während jemand fehlt. Bis dahin gibt es keine Frist. Die Meldung nach dem Speichern sagt, wie
  viele Spiele gewartet haben. Das gilt auch, wenn ihr den Schritt **Vorgabe** aus der Schrittfolge nehmt, während ein Spiel wartet.
- **Ändern wirkt nur nach vorn.** Eine geänderte Vorgabe gilt für Spiele, deren Veto noch nicht begonnen hat. Ein laufendes oder
  fertiges Veto behält seine Map, auch nach **Neu starten**. Jede Änderung steht im Protokoll und im Verlauf.
- **Pool geändert?** Steht eine vorgegebene Map nicht mehr im Pool des Modus, beginnt das Veto in dieser Woche nicht. Die Zeile sagt
  **nicht mehr im Pool**, in der Auswahl steht „Map nicht mehr im Pool – bitte neu wählen“, und oben steht, welche Wochen es betrifft
  (auch **Was fehlt noch?** im Überblick nennt sie). Die alte Auswahl bleibt gespeichert, bis ihr sie ändert – speichert ihr eine andere
  Woche, geht dabei nichts verloren. „Rotiert automatisch durch den Pool“ fasst solche Wochen nicht an, „Alle neu verteilen“ schon.
- Im Regelwerk beschreibt der Baustein `[[baustein:veto]]` die Regel; `{{veto.presets}}` nennt die Maps je Woche (2.11).

### 2.7e Vorfälle und Pausen (Regelwerk § 9, Anlage C)

Auf der Season-Seite im Reiter **Spielbetrieb** steht zwischen „Veto“ und „Nach dem Spiel“ der Abschnitt **Vorfälle und Pausen**
(Zuständigkeit „Season konfigurieren“). Er gehört zum Formular des Reiters: **Spielbetrieb speichern**, danach **Vorgaben
übertragen** (2.7) – die Werte gehen auch in eine laufende Staffel, nur nicht in eine gesperrte. Eine Season, die die Felder noch
nicht trägt, zeigt die Vorgaben und spielt mit ihnen.

| Feld | Vorgabe | Wirkung |
| --- | --- | --- |
| **Antwortzeit der Gegenseite (Minuten)** | 10 | So lange hat die Gegenseite, um einem gemeldeten Vorfall zuzustimmen oder abzulehnen. Danach ist die Map **in Klärung** und ihr entscheidet. Jeder Vorfall behält die Zeit, mit der er gemeldet wurde |
| **Rehosts und Pausen je Team und Map** | 1 | § 9.6: Die Seite zählt Rehosts und technische Pausen je Team und Map und zeigt „1 von 1 genutzt“. **Nichts wird verweigert:** Ein weiterer Vorfall bleibt meldbar, braucht aber die Zustimmung der Gegenseite, sonst entscheidet ihr. Ein MOSS-Absturz zählt nie, die Pause zwischen den Maps auch nicht |
| **Serie bei einer Map in Klärung** | Weiterspielen unter Vorbehalt | „Weiterspielen unter Vorbehalt“: Die Teams spielen und melden die übrigen Maps, die Map in Klärung zählt erst nach eurer Entscheidung. „Serie pausiert, bis entschieden ist“: Eine Meldung mit einer späteren Map lehnt die Seite ab, bis ihr entschieden habt |
| **Standardpause nach Map** und **Länge der Standardpause (Minuten)** | nach Map 2, 5 Minuten | Steht so im Regelwerk (`{{match.break_after_map}}`, `{{match.break_minutes}}`). Eine andere Pause halten die Teams am Spiel fest – nur dokumentiert, ohne Antwort |

<img src="../assets/liga/season-vorfaelle-1440.png" alt="Abschnitt Vorfälle und Pausen im Reiter Spielbetrieb: Antwortzeit der Gegenseite, Rehosts und Pausen je Team und Map, Serie bei einer Map in Klärung, Standardpause nach Map und ihre Länge" width="820">

In beiden Fällen gilt: Solange ein Vorfall offen ist, wird **kein Ergebnis des Spiels gültig** – weder durch Bestätigen noch nach
der 48-Stunden-Regel, und das Spiel steht nicht in der Tabelle. Wie ihr entscheidet, steht in 3.1d. Im Regeltext nennt
`{{incident.answer_minutes}}` die Antwortzeit (2.11).

### 2.7f Erinnerungen

Im Reiter **Termine** steht unter dem Check-in der Kasten **Erinnerungen** (Zuständigkeit „Season konfigurieren“) mit eigenem
**Erinnerungen speichern**; er gilt sofort für alle Staffeln der Season. Je Art gibt es einen Schalter, die Zeiten haben Vorgaben. Ist für
eine Season noch nichts gespeichert, steht „es gelten die Vorgaben unten“ – sie erinnert trotzdem schon.

| Art | Vorgabe | Wer bekommt sie |
| --- | --- | --- |
| **Spiel steht an** | 24 Stunden und 60 Minuten vor dem Termin | die Aufgestellten (ohne Aufstellung der Kader) und die Captains beider Seiten, mit Gegner und Uhrzeit. Nicht bei abgesagten, verschobenen (zum alten Termin) oder schon gestarteten Spielen und nicht, wenn das Spiel in einer Sperrzeit liegt. Vor dem ersten Spiel nach einer Pause kommt sie auch, wenn die Pause noch läuft |
| **Termin noch offen** | bei 50 % der Spielwoche (Wochenmitte), spätestens 24 Stunden vor dem Standardtermin | Captain und Vertreter beider Seiten, solange kein Termin vereinbart ist – einmal je Spielwoche. Ohne Einigung gilt der Standardtermin; wird er nicht gemeldet, steht das Spiel bei euch als überfällig (2.7a) |
| **Ergebnis fehlt** | Zeitpunkt aus „Termine und Verschiebungen“ (24 h nach dem Termin) | Captain und Vertreter beider Seiten. Kommt nicht, solange ein Vorfall oder ein Verfahren am Spiel offen ist |
| **Map-Veto wartet** | nach 20 Sekunden ohne Zug, nie in den letzten 5 Sekunden | Captain und Vertreter der Seite am Zug, wenn sie die Matchseite nicht offen haben (3.1c) |
| **Zusätzlich per Discord** | aus | Direktnachricht vom Vereins-Bot an alle, die Discord in ihren Einstellungen eingeschaltet haben (Entscheidung Nr. 148). Gilt für alle Arten: Ist der Schalter aus, kommen auch „Ergebnis fehlt“ und „Map-Veto wartet“ nicht mehr per Discord – früher kamen sie bei eingeschaltetem Discord immer. Keine Funktion hängt an Discord |

Jede Erinnerung kommt höchstens einmal, auch wenn der Job doppelt läuft. Spieler und Captains schalten „Match-Erinnerungen“ in ihren
Benachrichtigungs-Einstellungen ab (Web und App). Die Nachricht „Spiel startet in 10 Minuten“ kommt in allen Turnieren und ist hier nicht
einstellbar.

<img src="../assets/liga/liga-season-erinnerungen-pc.png" alt="Kasten Erinnerungen im Reiter Termine: Schalter für Spiel steht an mit 24 Stunden und 60 Minuten, Termin noch offen bei 50 Prozent der Spielwoche und spätestens 24 Stunden vor dem Standardtermin, Ergebnis fehlt, Map-Veto wartet mit 20 und 5 Sekunden, darunter Zusätzlich per Discord" width="820">

### 2.7g Discord-Meldungen

Unter den Erinnerungen steht im Reiter **Termine** der Kasten **Discord** (Zuständigkeit „Season konfigurieren“) mit eigenem
**Discord speichern**. Er schickt Meldungen in einen Kanal des Vereins-Discords. **Ohne Einstellung ist alles aus.**

| Meldung | Wann | Inhalt |
| --- | --- | --- |
| **Spieltag-Zusammenfassung** | je Staffel, sobald alle Spiele des Spieltags gewertet oder abgesagt sind. Fehlen Ergebnisse, wartet sie bis **Warten auf Ergebnisse (Stunden nach Ende der Spielwoche)** (Vorgabe 48 Stunden) nach dem Ende der Spielwoche und kommt dann mit „x Spiele offen“ – außer **Nach der Wartezeit trotzdem melden** ist aus | Liga, Season, Liga N (bei mehreren Staffeln mit Staffel), jedes Spiel mit Ergebnis, kampflos, abgesagt oder offen, darunter der **Tabellenausschnitt** (Vorgabe 5 Plätze, 0 = ohne Tabelle) und der Knopf **Zur Ligaseite** |
| **Saisonende-Meldung** | einmal, sobald alle Staffeln abgeschlossen sind (3.10) | Meister, je Liga N die Auf- und Absteiger mit Ziel-Liga (auch über Staffeln hinweg, etwa der beste Zweite), Knopf **Zur Season**. Sehr viele Ligen: Was nicht mehr in die Meldung passt, steht als „… und N weitere Liga N auf der Season-Seite“ |

**Kennzeichnung je Stufe** (#2561): Discord zeigt kein Wappen (dafür bräuchte es einen Bilder-Host). Vor „Liga N“ steht deshalb
ein festes Zeichen, das zur Form des Abzeichens passt – **👑** Liga 1, **🔷** Liga 2, **🔹** ab Liga 3. Es steht im Titel der
Spieltag-Zusammenfassung, vor jeder Liga N der Saisonende-Meldung und vor der Ziel-Liga („▲ Team → 👑 Liga 1 · Elite“).

- **Kanal nur aus der freigegebenen Liste:** einer für beide Meldungen. Zur Wahl stehen nur die öffentlichen Kanäle, die unter
  **Verbindungen → Discord → Reiter „Meldungen“ → Kanäle je Zweck** eingetragen sind (Community, News, Events und Turniere), je mit
  ihrem Zweck – nie ein privater Kanal (Vorstand, Betrieb, Test, Mitglieder) und keine frei eingetippte Kanal-ID. Ist noch keiner
  freigegeben, zeigt der Kasten den Weg dorthin. Ohne Kanal lässt sich nichts einschalten; einen anderen Kanal als Ersatz gibt es
  nicht. Fällt der gespeicherte Kanal später aus der Liste, geht nichts mehr hinaus und der Kasten sagt es.
- **Nur öffentliche Seasons:** Steht die Sichtbarkeit (2.8) nicht auf **Öffentlich**, geht nichts hinaus – der Kasten sagt das.
  Gezeigt wird nur, was Gäste auf der Ligaseite sehen.
- **Ab dem laufenden Spieltag:** Wer die Zusammenfassung später einschaltet, bekommt keine alten Spieltage auf einmal – auch
  dann nicht, wenn eine Staffel keine Spielwoche hat (dann zählt das letzte Ergebnis des Spieltags).
- **Nie doppelt:** Jede Meldung geht genau einmal hinaus, auch wenn der Job doppelt läuft. Ging sicher nichts hinaus (Bot offline,
  Kanal unbekannt, keine Rechte), versucht er es nach 30 Minuten noch zweimal. Meldet Discord erst nach dem Senden einen Fehler
  (Zeitüberschreitung, Störung bei Discord), kann die Nachricht schon im Kanal stehen: Dann versucht er es **nicht** noch einmal.
  Solche Meldungen und aufgegebene stehen im Kasten unter **Meldungen, die du prüfen solltest** – ebenso eine, die länger als 30
  Minuten „unterwegs“ hängt (etwa nach einem Neustart des Servers), und eine, die sich nicht aufbauen ließ. Ein Wiederöffnen und
  neues Abschließen schickt keine zweite Saisonende-Meldung.
- **Noch einmal senden** (Nr. 239): Sieh zuerst im Kanal nach. Fehlt die Meldung dort, drückst du beim Hinweis **Noch einmal
  senden**, setzt das Häkchen **Ich habe im Kanal nachgesehen, die Meldung fehlt** und drückst **Freigeben**. Der nächste Lauf
  (spätestens nach 15 Minuten) schickt sie genau einmal – auch wenn zwei von euch gleichzeitig freigeben. Recht: „Season
  konfigurieren“; im Protokoll steht, wer wann freigegeben hat. Die Hinweise laden von selbst nach.
- **Nach einem Ausfall** (Nr. 240): War der Bot länger aus oder der Kanal nicht freigegeben, kommt danach je Staffel nur der
  **neueste** fertige Spieltag. Ältere, liegen gebliebene Spieltage werden verworfen und gehen nicht von selbst hinaus. Sie stehen
  leise unter **Verworfene Spieltage** im Kasten; willst du einen doch melden, holst du ihn mit **Noch einmal senden** nach – genau
  einmal (Nr. 243).
- **Freigabe geht vor** (Nr. 242): Einen Spieltag, den du freigegeben hast, verwirft der Job nie – auch wenn im selben Lauf ein
  neuerer Spieltag fertig wird. Beide gehen dann genau einmal hinaus.

<img src="../assets/liga/liga-season-discord-verworfen-pc.png" alt="Kasten Discord: oben Meldungen, die du prüfen solltest, mit dem unklaren Saisonende; darunter leiser der Abschnitt Verworfene Spieltage mit drei Spieltagen, jeweils mit Noch einmal senden" width="820">
- Die neue Season aus dem Vorgänger (3.11) übernimmt die Einstellung samt „an“ und Kanal (Nr. 236). Ist der Kanal dann nicht mehr
  freigegeben, geht nichts hinaus, bis du einen freigegebenen wählst.

<img src="../assets/liga/liga-season-discord-pc.png" alt="Kasten Discord im Reiter Termine: Kanal Events und Turniere · Liga › #liga-ergebnisse, darunter Meldungen, die du prüfen solltest; beim Saisonende ist das Häkchen Ich habe im Kanal nachgesehen, die Meldung fehlt gesetzt, daneben Freigeben und Abbrechen, beim Spieltag 9 der Knopf Noch einmal senden" width="820">

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
N ohne Staffel. Warnungen sind etwa ein abgelaufenes oder fehlendes Anmeldefenster, ein Anmeldefenster, das erst nach dem Beginn
der Season endet (**Nachmeldung**, erlaubt – etwa für nachrückende Teams), ein Fenster, das über die Nachmeldefrist hinausreicht
(die Anmeldung schließt dann früher), oder inaktive Modi und Maps im Pool. *Nur Liga-Leitung* ist eine **Vorschau** und geht immer, auch mit Problemen.
Solange es Probleme gibt, lässt sich die Sichtbarkeit aber nicht auf **Nur Mitglieder** oder **Öffentlich** stellen – weder von *Aus*
noch von der Vorschau aus; das Speichern sagt dann, was fehlt. **Neu prüfen** liest den Stand nach Änderungen neu. Nur der Superadmin
kann im Notfall trotzdem veröffentlichen: Er trägt im Abschnitt einen **Grund für die Notausnahme** ein (mindestens 5 Zeichen) und
tippt **Überblick speichern**; der Grund steht im Protokoll. Von *Nur Mitglieder* weiter auf *Öffentlich* prüft nichts mehr.

### 2.8a Startseite und Teilen-Vorschau

Eine sichtbare Season steht auf der Startseite, ohne dass du etwas tun musst (#2324). Wer sie dort sieht, richtet sich nach der
**Sichtbarkeit** (2.8), nicht nach dem Stand: Eine *öffentliche* Season im Stand *Entwurf* steht drin, *Aus* und *Nur Liga-Leitung*
nie, *Nur Mitglieder* nur für angemeldete Mitglieder.

- **Hinweis unter dem Kopf**, solange das Anmeldefenster offen ist: Emblem, Banner, Anmeldeschluss, freie Startplätze und die
  Knöpfe **Mit Co-Team anmelden** und **Zur Ligaseite**. Nach dem Anmeldeschluss verschwindet er von selbst. Mehrere offene Seasons
  stehen kompakt nebeneinander. Sind alle Plätze weg und gibt es keine Warteliste, bleibt nur **Zur Ligaseite**.
- **Nächste Termine:** die Season wie ein Event mit Zeitraum, freien Plätzen und Plakette – „Anmeldung öffnet“, „Anmeldung offen ·
  endet am …“, „Anmeldung geschlossen“ bzw. „Angekündigt · startet …“, während der Season „Spielwoche 3 von 10“ oder „Spielpause“.
  Einsortiert nach dem nächsten Datum, das zählt. Nach dem Ende der Season fällt sie heraus.
- **Abschalten:** Reiter **Überblick** → **Auf der Startseite bewerben** (Vorgabe an) → **Überblick speichern**. Die Ligaseite
  bleibt davon unberührt.
- **Teilen-Vorschau** (Discord, WhatsApp): Bei offenem Fenster heißt die Karte „… · Anmeldung offen“ und nennt Anmeldeschluss und
  freie Plätze. Als Bild nimmt sie das Banner der Season bzw. Liga, sonst das Emblem.

<img src="../assets/liga/startseite-liga-hinweis-1440.png" alt="Startseite: Hinweis „Liga · Anmeldung offen“ mit Emblem, Banner, Anmeldeschluss, freien Startplätzen und den Knöpfen Mit Co-Team anmelden und Zur Ligaseite" width="640">

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
festen Spielplan, wie auf der Staffel-Seite. Zugeteilte Co-Teams werden dabei aus der Staffel genommen (das Blatt
sagt, wie viele); Grund eintragen → **Endgültig löschen**. Nach dem Start: Status **Abgesagt** im **Überblick** der Staffel-Seite;
archiviert wird über den Abschluss der Season.

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
und bei den **Staffeln** – die App zeigt eine Staffel als Turnier mit ihrem Banner. Hat eine Staffel auf ihrer
Staffel-Seite (**Einstellungen → Auftritt**) ein eigenes Banner bekommen, bleibt das stehen.

**Gewinne sind reine Anzeige:** Staffeln zählen weiter nicht für XP, Pokale oder die Jahreswertung.

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
   | Check-in | `[[baustein:checkin]]` | Fenster (öffnet und schließt, Minuten um den Termin), Mindestens Anwesende je Seite, Start sobald beide eingecheckt, Entscheidung der Leitung bei Fehlen (2.7b); ohne Check-in ein Satz | Season → Termine → Check-in vor dem Spiel |
   | Veto (Anlage B) | `[[baustein:veto]]` | Die Anlage B aus der Veto-Vorlage (2.7d): Team A und B (Heim oder Los), Start nach dem Check-in, Zeit je Schritt, Zeitüberschreitung (Zufallswahl unter den zulässigen Maps), keine Seitenwahl, Eingriffe der Leitung; mit einer Vorgabe der Woche dazu die Regel (gilt für alle Spiele der Spielwoche, nicht sperrbar, nicht wählbar) und der Bereit-Start. Darunter die Schrittfolge als Tabelle: Schritt · Modus · Aktion (Ban, Pick, Decider, Vorgabe der Woche) · Am Zug (Team A, Team B, System, Liga-Leitung) · Wirkung · Zeit. Spielt eine Liga N ein anderes Best of, steht dort „kein Veto“. Ohne Veto ein Satz; steht der Baustein allein in einer Anlage, **entfällt die Anlage** ohne Vorlage (auf der Seite, im PDF und im Vergleich); **Vorschau** und Vorschlag sagen das („Anlage B (Veto) entfällt …“) | Season → Spielbetrieb → Veto |
   | Erlaubte Ausrüstung | `[[baustein:loadout_bans]]` | was erlaubt ist: aktive Bibliothek ohne die Sperrliste, je Kategorie und Unterkategorie mit Bild, Hinweise „nicht in …“ bzw. „nur in …“, Waffen als Tabelle je Kategorie mit Bild und den Ausnahmen nach Slot („gesperrt: …“, „nur erlaubt: …“, wenn das kürzer ist), ganz gesperrte Klasse als Zeile „nicht erlaubt“ (im PDF genauso, übrige Ausrüstung als Tabelle; gedacht für Anlage A, 2.1a) | Spiel → Ausrüstung, Season → Regelwerk und Sperrliste |
   | Einstellungen je Modus | `[[baustein:mode_settings]]` | je Modus Zeitlimit, Zeit je Runde, Einstellungen (Tabelle), Regeltext | Spiel → Modi, Season → Ergebnisregeln |
   | Modi der Season | `[[baustein:modes]]` | Tabelle Modus (mit Symbol) · Ergebnisregel in Klartext (Ziel, Runden, Verlängerung, Remis) · Zeit · Spieler je Seite | Season → Spielbetrieb → Modi, Ergebnisregeln |
   | Spielformat | `[[baustein:format]]` | Best of, Teamgröße, Mindest- und Höchstkader, Map-Wiederholung, Teilnehmerliste; Abweichungen je Liga N | Season → Spielbetrieb → Serie, Anmeldung und Kader, Ligen |
   | Tabelle und Wertung | `[[baustein:table]]` | Punkte, Remis, Reihenfolge bei Punktgleichheit, kampflos, beide nicht erschienen, Ausscheiden | Season → Tabelle |
   | Termine | `[[baustein:schedule]]` | Spielwochen, Standardtermin, Sperrzeiten, Antwortfrist, 72-h-Regel, Verschiebungen, Erinnerung und überfällig | Season → Termine |
   | Wertung durch die Leitung | `[[baustein:lead_rulings]]` | Zwei Sätze, gedacht für Anlage C und § 9a: Ob ein Abbruch noch in der frühen Phase lag, prüft das System nicht – die Teams einigen sich über den Vorfall, sonst wertet die Liga-Leitung von Hand (mit der Antwortzeit der Season). Fehlt eine angeforderte MOSS-Datei nach der Frist, bekommt nur die Leitung einen Hinweis; gewertet wird von Hand | Season → Spielbetrieb → Vorfälle und Pausen, Season → Proteste |
   | Spielberechtigung | `[[baustein:eligibility]]` | Zulassung, Annahme der Anmeldung („automatisch angenommen“ oder „die Liga-Leitung prüft“, nur mit Anmeldefenster, 2.5a), Nachmeldung (Frist und „nur die offenen Spielwochen“, nur wenn das Fenster über den Start geht), Mindestalter, Spiel-IDs, Plattform (erlaubte Plattformen, Crossplay, Eingabegerät, Abweichungen je Liga N, 2.7c), ein Co-Team je Season, Wartezeit, Stichtag, Transferfenster | Season → Anmeldung und Kader, Spiel → Spiel-IDs |

4. **Variablen** stehen mitten im Satz, etwa „Gespielt wird Best of `{{best_of}}`“, und werden beim Lesen durch den Wert der Season
   ersetzt. **Variable einfügen** zeigt die Liste mit dem Wert von heute (mit Suche); die **Hilfe** darunter nennt alle Bausteine und
   Variablen. Eine Variable **ohne Wert** in dieser Season (etwa ohne Höchstkader) steht als „(nicht festgelegt)“ im Text - nie still leer.
   Bei einem Regelwerk der Liga zählt jede Season, für die es eingefroren wird - auch wenn die Seite der Liga „(je Season)“ zeigt.
   Vorschau und Vorschlag nennen solche Variablen; veröffentlichen (auch über die Freigabe) geht erst mit dem Haken **Trotzdem
   veröffentlichen - im Text steht dann „(nicht festgelegt)“**, der nur dann erscheint. Eine **unbekannte** Variable (Tippfehler) nennt die Vorschau, und das
   Veröffentlichen lehnt sie mit der ganzen Liste ab.

   | Variable | Wert |
   | --- | --- |
   | `{{league.name}}`, `{{game.name}}` | Name der Liga, des Spiels |
   | `{{season.name}}`, `{{season.number}}`, `{{season.start}}`, `{{season.end}}`, `{{season.weeks}}` | Season, Nummer, erster und letzter Tag, Spielwochen |
   | `{{best_of}}`, `{{maps_to_win}}`, `{{team_size}}`, `{{min_squad_size}}`, `{{max_squad_size}}`, `{{map_repeat}}` | Serie, Maps zum Sieg, Teamgröße, Kader, Map-Wiederholung in Worten |
   | `{{lineup_mode}}`, `{{lineup_min_players}}`, `{{result_confirm_hours}}`, `{{lineup_amend_hours}}` | Aufstellung, Mindestzahl, Bestätigungs- und Nachtragsfrist |
   | `{{veto.step_seconds}}`, `{{veto.team_a}}` | Veto (2.7d): „60 Sekunden“ je Schritt, „das Heimteam laut Spielplan“ oder „per Los je Spiel“; ohne Veto „(nicht festgelegt)“ |
   | `{{veto.presets}}` | Vorgabe der Woche (2.7d): „Spielwoche 1: Hafen (Kontrolle); Spielwoche 2: Kai (Kontrolle)“; ohne Einträge „noch keine eingetragen“. Steht die Variable im Regelwerk, schlägt jede neue Vorgabe eine Freigabe vor – wer das nicht will, lässt sie weg (die Matchseite nennt die Map ohnehin) |
   | `{{schedule.matchday_days}}`, `{{schedule.default_weekday}}`, `{{schedule.default_time}}`, `{{schedule.default_slot}}`, `{{schedule.response_hours}}`, `{{schedule.blocked_periods}}` | Spielwoche, Standardtermin („Sonntag, 20:00 Uhr“), Antwortfrist, Sperrzeiten |
   | `{{schedule.home_rule_hours}}`, `{{schedule.reschedule_max}}`, `{{schedule.reschedule_notice_hours}}`, `{{schedule.result_reminder_hours}}`, `{{schedule.result_overdue_hours}}` | Terminregeln (2.7a) |
   | `{{table.points}}` | Punktevergabe in Worten: „Sieg 3, Niederlage 0 Punkte“ oder „je gewonnene Map ein Punkt (3:2 ergibt 3 und 2 Punkte, 3:0 ergibt 3 und 0)“ – das Beispiel folgt dem Best of (Best of 3: „2:1 ergibt 2 und 1 Punkte, 2:0 ergibt 2 und 0“) |
   | `{{table.points_win}}`, `{{table.points_draw}}`, `{{table.points_loss}}`, `{{table.draws}}`, `{{table.tiebreakers}}`, `{{table.head_to_head}}`, `{{table.forfeit_score}}`, `{{table.exit_rule}}` | Punkte, Remis, Reihenfolge bei Punktgleichheit, direkter Vergleich, kampflos, Ausscheiden |
   | `{{eligibility.min_age}}`, `{{eligibility.wait_days}}`, `{{eligibility.roster_deadline}}`, `{{eligibility.transfer_windows}}`, `{{eligibility.entry_policy}}`, `{{eligibility.id_fields}}` | Spielberechtigung (3.9) |
   | `{{eligibility.platform}}`, `{{eligibility.crossplay}}`, `{{eligibility.input_device}}` | Plattform je Season (2.7c): „PC und PlayStation“ oder „alle Plattformen“, Crossplay „an“/„aus“, Eingabegerät; ohne Plattform-Feld „(nicht festgelegt)“ |
   | `{{application.opens}}`, `{{application.closes}}`, `{{application.slots}}` | Anmeldefenster und Startplätze (2.5a) |
   | `{{application.late_days}}` | Nachmeldefrist in Tagen nach dem Start; `{{application.closes}}` ist das wirksame Ende mit dieser Frist (2.5a) |
   | `{{application.acceptance}}` | Ein ganzer Satz ohne Punkt (2.5a): „Anmeldungen werden automatisch angenommen, solange ein Startplatz frei ist; sind alle vergeben oder wartet schon jemand, kommen sie auf die Warteliste; die Liga-Leitung kann nachträglich mit Grund ablehnen oder auf die Warteliste zurückstufen“ oder „Die Liga-Leitung prüft jede Anmeldung“; ohne Anmeldefenster „(nicht festgelegt)“ |
   | `{{protest.hours}}`, `{{appeal.hours}}`, `{{evidence.keep_days}}` | Protestfrist, Einspruchsfrist, Aufbewahrung der Beweise. Heute gelten die Vorgaben 48 Stunden, 48 Stunden, 30 Tage; einstellbar werden sie mit den Paketen Proteste und Strafen |
   | `{{match.break_after_map}}`, `{{match.break_minutes}}` | Standardpause zwischen den Maps (Vorgabe nach Map 2, 5 Min.); einstellbar im Abschnitt „Vorfälle und Pausen“ (2.7e) |
   | `{{incident.answer_minutes}}` | Antwortzeit der Gegenseite auf einen gemeldeten Vorfall (Vorgabe 10 Min., 2.7e) |
   | `{{mode:<kennung>.name}}`, `.rule`, `.target`, `.round_limit`, `.time_limit`, `.round_time`, `.players`, `.overtime`, `.draw` | je Modus: Name, Regel in Klartext, Ziel, Rundenlimit, Zeitlimit, Zeit je Runde, Spieler je Seite, Verlängerung und Remis („ja“/„nein“). Die Kennung steht in der Liste. |

5. **Vorschau** zeigt die Seite mit den Werten von heute und den Änderungen zur letzten Version.
6. **Veröffentlichen:** **Gültig ab**, **Änderungsgrund** (steht öffentlich dabei) und die Wahl, ob **Captains neu zustimmen** müssen. Danach lässt sich
   die Version nicht mehr ändern. Bausteine und Variablen werden eingefroren: alte Versionen zeigen ihre Werte von damals, im Web und im PDF. Die Sätze eines Bausteins entstehen aber erst beim Anzeigen aus diesen Werten – wird ein Satz verbessert (etwa die Anlage B als Tabelle), zeigen auch schon veröffentlichte Versionen die neue Formulierung mit den alten Werten.

**Was die Seite selbst macht:** Sie vergleicht jede Version mit der vorigen. Geänderte Paragrafen tragen einen Strich am Rand und das Wort
„Geändert“, oben steht „Neu in Version X“ mit Links zu den Stellen. Leser können die Markierung ausblenden und Wort für Wort mit jeder alten Version
vergleichen, auch entfernter Text ist dann zu sehen.

**Regelwerk muss freigegeben werden.** Änderst du eine Einstellung, die im Regelwerk steht (Modus umbenannt, Ziel geändert, Best of, Map-Pool,
Sperrliste …), ändert sich die veröffentlichte Version **nie von selbst**. Die Verwaltung zeigt an drei Stellen **Regelwerk muss freigegeben
werden**: im Season-Überblick, in **Mein Dienst** (für wer „Regeln veröffentlichen“ darf) und auf der Regelwerk-Seite. Dort steht, welche
Bausteine und Variablen sich geändert haben (alt durchgestrichen, neu unterstrichen), und darunter der **Vorschlag**: die neue Fassung mit
den Werten von heute, geänderte Paragrafen markiert. Du prüfst, setzt **Gültig ab** und **Änderungsgrund** (vorbelegt mit den geänderten
Stellen), wählst, ob **die Teams neu zustimmen** müssen, und klickst **Freigeben und veröffentlichen**. Willst du den Text vorher anpassen:
**Text vorher anpassen** legt den Entwurf an. Bis zur Freigabe gilt und zeigt die alte Version. Auch eine neue **Darstellung** eines
Bausteins kommt so: Seit die erlaubte Ausrüstung die Waffen als Tabelle je Kategorie zeigt, mit den Ausnahmen nach Slot und „nur erlaubt“
(2.1a), schlägt die Verwaltung für jede Season mit diesem Baustein einmal eine neue Fassung vor; die veröffentlichte bleibt bis dahin Wort
für Wort, wie sie war.

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

### 2.12 Die Ligaseite: Übersicht, Spieltage, Teams

Die Ligaseite zeigt nur, was die Season veröffentlicht – du pflegst nichts extra. Oben steht eine Leiste **Übersicht ·
Spieltage · Teams · Regelwerk** (Regelwerk nur, wenn es eines gibt); dieselbe Leiste steht auf der Regelseite.

**Übersicht** (`/liga/<liga>/<season>`):

| Block | Woher es kommt |
| --- | --- |
| **Was gespielt wird**: Spiel, Teamgröße, Best of, Runden, Map-Wiederholung, je Modus Symbol und Regel („bis 250 Punkte · 10 Min.“), Reihenfolge Map 1 bis N, Plattform | Reiter **Spielbetrieb** und **Ergebnisregeln** der Season, Modus-Symbole am Spiel (2.1), Plattform (2.7c) |
| **Map-Pool** mit großen Bildern, am Handy je Modus zum Wischen | Map-Pool der Season |
| **Sperrliste** mit Bildern, aufklappbar, darunter die **erlaubte Ausrüstung** | Sperrliste der Season (2.1a) |
| **Ablauf**: Standardtermin, 72-h-Regel, Verschieben, Frist zum Bestätigen, Punkte und Gleichstand | Reiter **Termine** und **Tabelle** der Season |
| **Regelwerk** mit Version und PDF | 2.11 |
| **Ligen und Staffeln**: je Staffel die Tabelle und der aktuelle Spieltag, Wege zu Spieltagen und Teams | Staffeln; läuft die Season, stehen die Tabellen gleich unter „Was gespielt wird“ |

Im Kopf stehen nur Zeitraum, Spielwochen und Pausen – Best of, Teamgröße, Standardtermin und Punkte stehen genau einmal, in
„Was gespielt wird“ bzw. „Ablauf“. Ist die Seite gerade nicht erreichbar, steht dort „Nochmal laden“ statt „nicht gefunden“.

Vor der Einteilung (noch keine Staffel für Gäste sichtbar) steht statt der Tabellen **„Die Ligen werden eingeteilt“** mit den
nächsten Schritten: Anmeldung, Einteilung, Start. **Gold** hat in der Tabelle nur der **Meister**: Platz 1 allein, in der
obersten Liga, sobald die Staffel beendet ist. Auf- und Abstiegszonen kommen mit dem Saisonabschluss (#1627).

**Spieltage** (`…/spieltage`): oben die Staffel (bei mehreren), darunter eine Leiste aller Wochen – Punkt in Akzentfarbe =
gespielt bzw. läuft, schraffiert = Pause. Die gewählte Woche zeigt alle Spiele mit Ergebnis, Maps mit Bild und Modus-Symbol,
**kampflos**, **Map wiederholt** und **in Klärung**; offene Wochen zeigen einmal den **Modus je Map**. Den **Grund** einer
Wiederholung sehen nur die beiden Teams und die Liga-Leitung auf der Matchseite, öffentlich steht nur „wiederholt“. Staffel und Woche stehen
in der Adresse (`?staffel=…&woche=3`) – so lässt sich ein Spieltag in Discord verlinken.

**Teams** (`…/teams`): je Liga und Staffel die Teams mit Logo (aus der Teamseite, sonst zwei Buchstaben), Platz und Punkten.
In einer **öffentlichen** Season steht unter jeder Karte **Rankingbanner kopieren**: ein fester Link auf ein Bild mit Platz,
Bilanz und Punkten des Teams (1200 × 300, ohne Spielernamen), das sich mit jedem Ergebnis selbst erneuert – höchstens fünf
Minuten alt. Teams binden es in Discord oder im Stream ein; dieselben Links stehen an der Teamseite. Ist die Season nicht
öffentlich, gibt es kein Bild (der Link antwortet „nicht gefunden“).

Interne Dinge der Leitung – Grund eines Punktabzugs, Verfahren, Vorfälle – stehen nirgends auf diesen Seiten. Die Teilen-Vorschau
der Season sagt, was gespielt wird; Spieltage und Teams haben eine eigene Vorschau.

<table>
<tr>
<td><img src="../assets/liga/season-seite-handy.png" alt="Ligaseite am Handy: Kopf mit Banner und Emblem, Leiste Übersicht, Spieltage, Teams, Regelwerk, darunter Was gespielt wird mit Format, drei Modi mit Symbol und Regel und der Reihenfolge Map 1 bis 3, dann die Tabelle der Liga 1" width="260"></td>
<td><img src="../assets/liga/season-spieltage-1440.png" alt="Spieltage am PC: Auswahl Liga 1 oder Liga 2, Leiste der Wochen mit Reserve und Weihnachtspause, Spieltag 1 mit einem Ergebnis 2:1 samt drei Maps mit Bild und dem Hinweis Map wiederholt sowie einem kampflosen Spiel" width="520"></td>
</tr>
</table>

---

## 3. Während der Season

### 3.0 Leitstand: alles Offene der Season an einem Ort

Der Reiter **Leitstand** (gleich nach dem Überblick, Admin → Liga → Season, `#leitstand`) sammelt alles, was in dieser Season noch
auf die Liga-Leitung wartet – gruppiert nach Art, jede Gruppe mit Zähler:

| Gruppe | Wer sie sieht | Wo ihr es erledigt |
| --- | --- | --- |
| Vorfälle (Map in Klärung, Serie feststellen) | „Ergebnisse korrigieren“ oder „Proteste“ | Matchseite, Abschnitt Vorfälle |
| Check-in abgelaufen | „Spiele betreuen“ oder „Ergebnisse korrigieren“ | Turnierleitung des Spiels |
| Überfällige Spiele (nie gemeldet) | „Spiele betreuen“ oder „Ergebnisse korrigieren“ | Matchseite |
| Fehlende Teilnehmerlisten (Frist zum Nachtragen vorbei) | „Spiele betreuen“ oder „Ergebnisse korrigieren“ | Matchseite |
| Verfahren (Beanstandung, Protest, Einspruch) | „Proteste“ | Matchseite, Karte des Verfahrens |
| Strafen und Einsprüche (vorläufige Sperren, offene Einsprüche) | „Strafen“ | Reiter Strafen |
| Anmeldungen (offen oder angenommen, aber nicht zugeteilt) | „Teams freigeben“ | Reiter Anmeldung und Kader |
| Kaderanträge (Transfers, Spiel-IDs nach dem Stichtag) | „Kader prüfen“ | Reiter Anmeldung und Kader, Kader |
| Verschiebungen (die Gegenseite muss antworten) | „Spiele betreuen“ | Matchseite |
| Regelwerk-Freigabe | „Regeln veröffentlichen“ | Regelwerk der Season |

Jede Aufgabe nennt ihre **Frist** (oder seit wann sie offen ist), **wer zuständig ist** (bei einem übernommenen Verfahren die Person)
und hat einen Knopf direkt an die Stelle, an der ihr sie erledigt. Erledigt ist sie, sobald dort entschieden ist – dann verschwindet
sie von selbst. **Alle** zeigt alles, **Nur meine** nur, was du selbst erledigen kannst. Bei einem Spiel deines eigenen Co-Teams steht
der Fall trotzdem da, mit dem Hinweis „Das entscheidet eine zweite berechtigte Person“ (bei Strafen: wer verhängt hat, entscheidet
nie über den Einspruch). Ist nichts offen, steht **Alles erledigt**.

<table><tr>
<td><img src="../assets/liga/liga-leitstand-pc.png" alt="Leitstand am PC: 6 offene Aufgaben, Filter Alle und Nur meine, Knopf Rundnachricht, darunter Gruppen Vorfälle, Überfällige Spiele mit Hinweis auf Befangenheit, Verfahren mit Frist und Zuständigem, Strafen, Anmeldungen, dann das Protokoll der Season" width="560"></td>
<td><img src="../assets/liga/liga-leitstand-handy.png" alt="Derselbe Leitstand am Handy mit 390 px" width="220"></td>
</tr></table>

**Protokoll der Season:** unter den Aufgaben, neueste zuerst, 25 Einträge je Seite (**Neuer** / **Älter**). Es nennt, was wer wann
getan hat – nie Begründungen, Nachrichtentexte oder Namen aus den Fällen. Lesen darf jede Zuständigkeit der Liga. Dazu gehören auch
die Schritte an den Staffeln: **Staffel · Liga gestartet**, pausiert, fortgesetzt, beendet, abgesagt, **Darstellung geändert**,
**gesperrt**/**entsperrt**, **Co-Team · ausgetreten**/**disqualifiziert**, **Vorschau neu gemischt** und **Spieltage neu ausgelost**.
Eine Wiederaufnahme nach einer Strafe sieht nur, wer „Strafen“ hat.

**Staffel-Filter:** Über **Offen in dieser Staffel** auf der Staffel-Seite (2.5) öffnet der Leitstand nur die Aufgaben und das
Protokoll dieser Staffel. Oben steht dann **Nur Liga 1 · Staffel A**, dazu wie viele Aufgaben der ganzen Season (Anmeldungen,
Transfers, Regelwerk) ausgeblendet sind; **Alle Staffeln** hebt den Filter auf.

**Rundnachricht** (Knopf oben, mit „Liga verwalten“ oder „Season konfigurieren“): Empfänger sind **Captains und Vertreter** (Vorgabe;
ohne beide die Leitung des Hauptteams) oder **alle Spieler**, wahlweise der ganzen Season, einer Liga N oder einer Staffel. Bevor du
schickst, steht da, wie viele Personen sie bekommen; beim Schicken fragt die Seite noch einmal nach. Sie kommt in die Glocke und als
Push, **Auch per Mail** schickt sie zusätzlich per Mail – alles nach der Einstellung **Turnier-Updates** der jeweiligen Person. Betreff bis 80, Text bis 1000 Zeichen.
Ein Doppelklick schickt nichts zweimal. Im Protokoll steht sie mit Absender, Kreis und Zahl der Empfänger.

<img src="../assets/liga/liga-rundnachricht-handy.png" alt="Rundnachricht am Handy: Empfänger Captains und Vertreter gewählt, Kreis Ganze Season, Geht an 14 Personen, Betreff und Nachricht, unten der Knopf An 14 Personen schicken" width="260">

**Mein Dienst** bleibt deine persönliche Liste. Unter **Leitstand der Seasons** steht je laufender Season, wie viele Aufgaben auf dich
warten, mit dem Weg in den Leitstand.

### 3.1 Termine

Captain oder Vertreter schlagen auf der Matchseite unter **Terminabstimmung** einen Termin vor, die Gegenseite nimmt
an (Haken), lehnt ab (X) oder macht einen **Gegenvorschlag**. Ohne Einigung gilt der Standardtermin der Spielwoche.
Im Web gehen **bis zu 3 Termine auf einmal** (**+ weiteren Termin**, eine Notiz, ein Knopf): Jeder wird einzeln geprüft,
gespeichert werden alle oder keiner, die Gegenseite bekommt **eine** Nachricht und nimmt einen davon an – die übrigen
schließen als „erledigt – anderer Termin steht“, in jeder Staffel und in jedem Turnier. **Alle ablehnen**, **Zurückziehen**
und ein **Gegenvorschlag** (bis zu 3 Termine) gelten für alle Termine zusammen. Die 72-h-Regel nimmt wie bisher den
frühesten gültigen Vorschlag der Heimseite.
Ein Vorschlag in einer Sperrzeit wird abgelehnt („In dieser Zeit wird nicht gespielt (Weihnachtspause, …)“). Termin-,
Bestätigungs- und Nachtragsfristen ruhen in der Sperrzeit, das Einspruchsfenster nicht (siehe 1.).

- **Nachrichten:** Jeder Vorschlag, Gegenvorschlag, jedes Annehmen, Ablehnen und Zurückziehen geht sofort an Captain
  und Vertreter der anderen Seite (ohne beide an deren Teamleitung) – ins Postfach und per Push, Thema
  „Match-Erinnerungen“. Trägt die Turnierleitung selbst einen Termin vor, erfahren es beide Seiten. Steht zur Wochenmitte
  noch kein Termin, erinnert die Seite beide Captains; 24 Stunden und 1 Stunde vor dem Spiel erinnert sie die Aufgestellten
  und die Captains (einstellbar, 2.7f).
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
  zweite Person fest (Befangenheit, 2.0); der Superadmin nur als Notausnahme mit Grund im Matchplan.
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
selbst. Die Turnierliste zeigt denselben Hinweis neben dem Stand; bei einer Staffel führt der Hinweis in **Mein Dienst** auf die
Staffel-Seite.

### 3.1b Check-in und Start (Regelwerk § 8)

Mit dem Kasten aus 2.7b läuft jedes Spiel so, alles auf der **Matchseite** im Block **Check-in**:

- **Fenster:** öffnet 15 Minuten vor dem Termin, schließt 15 Minuten danach (Vorgaben). Die Seite zählt herunter und sagt in einem
  Satz, was zu tun ist. Beide Seiten bekommen bei der Öffnung eine Nachricht („Check-in offen“, Push wie „Du bist dran“), Seiten
  ohne Check-in kurz vor Schluss noch eine.
- **Einchecken:** Captain oder Vertreter haken an, wer da ist – mindestens die Mindestzahl, nur Spieler aus dem Kader, nur wer
  spielen darf (gesperrt, Wartezeit, fehlende ID stehen grau mit Grund). Bis zum Schluss lassen sich Anwesende ergänzen. Die
  Gegenseite sieht, dass und mit wie vielen eingecheckt wurde.
- **Fehlende Angaben** (3.9): Hier greift die Sperre. Wer selbst nicht spielen darf, sieht oben im Block „Du kannst so nicht
  einchecken“ mit dem Grund und dem Knopf **Im Profil nachtragen**. Reichen die Spielberechtigten nicht für die Mindestzahl, sagt
  die Seite das schon vor dem Fenster, und Einchecken geht nicht. Ist die Angabe nachgetragen, geht der Check-in sofort, ohne euch.

  <img src="../assets/liga/liga-checkin-gesperrt-390.png" alt="Check-in mit dem eigenen Grund, dem Knopf Im Profil nachtragen und dem Satz zu wenigen Spielberechtigten am Handy" width="300">
- **Regelwerks-Sperre:** Hat das Co-Team einer neuen Regelversion mit Zustimmungspflicht nicht zugestimmt, geht für dieses Team kein
  Check-in und kein Start – die Seite sagt „Das Regelwerk hat sich geändert – bitte erst zustimmen“ mit Weg zur Fassung. Das gilt
  auch, wenn ihr für die Seite eintragen wollt, und auch, wenn die neue Fassung erst zwischen Check-in und Start kommt.
- **Start:** Sind beide Seiten eingecheckt, steht **Spiel starten – Map 1 läuft**; eine Seite tippt, auch vor dem Termin. Ab dann
  gilt das Spiel als begonnen (Spielzeit, kein Verschieben, kein „nicht erschienen“ mehr). Ihr könnt mit „Spiele betreuen“ ebenfalls
  starten. Mit Veto (2.7d) läuft zwischen Check-in und Start erst das Veto (3.1c); der Start-Knopf kommt danach.
- **Erst einchecken, dann melden:** Die Captains können das Ergebnis erst melden, wenn beide Seiten eingecheckt sind – die Matchseite
  sagt sonst, wer fehlt (in der App kommt der Satz als Antwort auf die Meldung). Hat niemand auf **Spiel starten** getippt, gilt das Spiel
  mit der ersten Meldung als begonnen. Ihr selbst tragt über **Ergebnis eintragen** weiter ohne Check-in ein.
- **Fehlt eine Seite nach dem Fenster:** Der Server wertet **nie** von selbst. Es entsteht ein Vorschlag „Nicht erschienen?“ – als
  Nachricht an euch, unter **Mein Dienst → Braucht deine Entscheidung** („Check-in abgelaufen“) und als Karte in der
  Leitungsansicht der Staffel. Dort entscheidet ihr: **<Team> nicht erschienen** (kampflos über den bekannten Weg, Teamstrafe wie in
  3.2), **+5 Min. verlängern** (das Fenster geht wieder auf) – oder ihr tragt die Seite auf der Matchseite unter **Für eine Seite
  eintragen (Liga-Leitung)** mit Grund nach, etwa wenn der Captain ohne Netz anruft; dann ist der Vorschlag erledigt. Im eigenen
  Spiel macht das eine zweite Person (Befangenheit, 2.0).
- **Ohne Check-in** (ältere Season oder Kasten nie gespeichert) bleibt alles wie vorher: kein Vorschlag, „Ergebnis fehlt“ meldet
  sich, ihr wertet von Hand.

### 3.1c Veto durchführen (Regelwerk § 6)

Mit dem Kasten aus 2.7d läuft nach dem Check-in das Map-Veto – auf der **Matchseite** im Block **Check-in**, Abschnitt **Map-Veto**:

- **Start:** Sobald beide Seiten eingecheckt sind, beginnt das Veto von selbst; beide Seiten bekommen eine Nachricht („Veto läuft“),
  Team A (Heimteam, oder gelost) ist zuerst dran. Die Seite zeigt den laufenden Schritt („Schritt 3 von 11 · Stellung · Loewen wählt
  Map 1“), einen Countdown, den **Ablauf** als Leiste (jeder Schritt mit Sperre/Wahl/Decider, Team A oder B und Modus; fertige Schritte
  mit der Map, der laufende markiert) und je Modus alle Maps als **Karten mit Bild** (offen, gesperrt mit Bann-Zeichen und wer, gewählt
  mit „Map 1“ in der Farbe der Seite, Decider, Vorgabe der Woche). Team A ist blau, Team B orange.
- **Ziehen:** Captain oder Vertreter der Seite am Zug tippen im markierten Modus eine Karte an – **Sperren** oder **Wählen**, je nach
  Schritt. Ausgegraute Maps sind gesperrt, schon gewählt oder würden die Serie nicht mehr aufgehen lassen (die Seite sagt es beim
  Antippen). Die übrige Map eines Decider-Schritts setzt das System sofort. Ein Doppelklick oder ein zweites Gerät zählt nicht doppelt;
  war die Gegenseite schneller oder die Zeit um, sagt die Seite „bitte neu laden“ und zeigt den neuen Stand.
- **Live:** Die Seite aktualisiert sich von selbst – alle 2 Sekunden, solange das Veto läuft (im Hintergrund-Tab nicht, beim Zurückkommen
  sofort). Ein Zug der Gegenseite leuchtet auf ihrer Karte kurz auf, der Ablauf rückt weiter. Der Countdown richtet sich nach der Uhr des
  Servers, nicht nach der des Handys; die letzten 10 Sekunden sind rot und mit Sanduhr und „gleich vorbei“ markiert. Mit „Bewegung
  reduzieren“ im Gerät steht alles sofort da.
- **Erinnerung:** Ist eine Seite am Zug, hat 20 Sekunden lang nicht gezogen und die Matchseite nicht offen, bekommen Captain und Vertreter
  einmal die Nachricht **„Map-Veto wartet – ihr seid am Zug“** (je Schritt höchstens einmal). Schalter und Sekunden stellt ihr je Season
  unter **Erinnerungen** ein (2.7f).
- **Zuschauer und TV:** Wer nicht beteiligt ist, sieht das laufende Veto auf der Matchseite nur lesend (wenn die Staffel sichtbar ist).
  Über **TV-Ansicht** im Veto-Block öffnet sich die Ansicht für den Bildschirm (`/display/veto/<Spiel>`): großer Countdown, wer am Zug
  ist, Karten und Ablauf, danach die Spielreihenfolge. Für Staffeln „Nur Mitglieder“ hängt ihr den Anzeige-Schlüssel des Turniers an
  (`?key=…`, aus eSports → TV & Beamer). Für eine Season „aus“ oder „nur Verwaltung“ und im Entwurf zeigt der TV auch mit Schlüssel
  nichts.
- **Zeit:** Läuft die Zeit je Schritt ab, wählt das System zufällig aus den zulässigen Maps und schreibt es in den Verlauf („Zeit
  abgelaufen, das System hat gewählt“). Die nächste Seite hat wieder ihre volle Zeit.
- **Ende:** Nach dem letzten Schritt steht die **Spielreihenfolge** (Map 1 bis Best of mit Modus und Map) – beide Seiten bekommen eine
  Nachricht, dann erscheint **Spiel starten – Map 1 läuft**. Das Meldeformular zeigt je Map die festgelegte Map und den Modus fest; die
  Captains tragen nur Sieger, Punkte und Aufstellung ein. Meldet jemand eine andere Map, lehnt der Server ab („Map 2: laut Veto wird
  hier … gespielt“). Ihr selbst tragt über **Ergebnis eintragen** frei ein, etwa nach einem Map-Fehler.
- **Eingriff der Leitung** (Zuständigkeit „Spiele betreuen“, nur mit Grund, alles im Protokoll und für beide Seiten sichtbar):
  **Pausieren** (die Restzeit bleibt stehen), **Fortsetzen**, **Letzten Schritt zurück** (ein automatischer Decider geht mit dem Zug davor),
  **Neu starten** (Team A bleibt, ein Los wird nicht neu gezogen). Nach dem Start von Map 1 ändert sich am Veto nichts mehr. Im eigenen
  Spiel macht das eine zweite Person (Befangenheit, 2.0).
- **Neuer Termin:** Jeder neue Termin (auch zurück auf den alten, auch „Neu ansetzen“) setzt Check-in und Veto zurück – nach erneutem
  Check-in beider Seiten beginnt das Veto von vorn.
- **Gesperrte Staffel:** Solange die Staffel gesperrt ist, läuft nichts weiter – kein Start, keine Zufallswahl, kein Zug; nach dem
  Entsperren geht es beim nächsten Aufruf weiter.
- **Ohne Veto** (Kasten aus, ältere Season, Liga N mit anderem Best of): Die Seite sagt es, nach dem Check-in kommt gleich der Start, die
  Maps werden beim Ergebnis eingetragen.
- **Vorgabe der Woche** (2.7d): Der Veto-Block nennt sie schon vor dem Check-in („Vorgabe der Woche · Spielwoche 2“). Im Veto steht
  die Map im Brett als **Vorgabe der Woche** fest, bei der Auswahl ist sie ausgegraut („… ist die Vorgabe der Woche – weder sperrbar
  noch wählbar“). Ist ihr Schritt an der Reihe, setzt ihn das System sofort; in der Spielreihenfolge steht sie an ihrer Position
  („Map 3 · Vorgabe der Woche“). **Letzten Schritt zurück** nimmt nur Züge der Seiten zurück, die Vorgabe bleibt.
- **Vorgabe fehlt:** Statt „Veto läuft“ steht **Veto wartet auf die Vorgabe der Woche** mit der Woche und dem Modus. Niemand kann
  ziehen oder starten, gewertet wird nichts. Tragt die Map in der Season nach (2.7d).
- **Vorgabe steht – bereit zum Veto?** Nach dem Nachtragen bekommen beide Seiten die Nachricht „Vorgabe da – Veto kann starten“. Auf
  der Matchseite tippt je Seite Captain oder Vertreter **Bereit zum Veto**:
  1. Die Seite zeigt beiden, wer schon bereit ist („Ihr seid bereit – wartet auf die Gegenseite“). Die Gegenseite bekommt einmal eine
     Nachricht.
  2. Wer als Erster bereit war, kann mit **Doch nicht bereit** zurücknehmen, solange die Gegenseite noch fehlt.
  3. Sind beide bereit, beginnt das Veto sofort. Erst ab da läuft die Zeit je Schritt, vorher gibt es keine Frist. Tippen beide
     gleichzeitig oder doppelt, beginnt trotzdem nur ein Veto.
  4. Ein neuer Termin setzt „Bereit“ zurück – nach dem neuen Check-in beginnt das Veto wieder von selbst, wenn die Vorgabe steht.
  5. Nehmt ihr die Vorgabe der Woche wieder heraus, während die Seiten schon „Bereit“ tippen, wartet das Veto wieder auf die Vorgabe.
     Die Seiten können **Doch nicht bereit** tippen. Sind beide bereit und ihr tragt die Vorgabe wieder ein, beginnt das Veto mit
     eurem Speichern von selbst.
- **Notfall: Veto starten (Liga-Leitung).** Kann eine Seite nicht selbst tippen (etwa Captain ohne Netz), startet ihr das wartende
  Veto im Kasten darunter: **Grund** eintragen (Pflicht), **Veto jetzt starten**. Das braucht „Spiele betreuen“, steht mit Grund im
  Protokoll, und im eigenen Spiel macht es eine zweite Person (Befangenheit, 2.0).

<img src="../assets/liga/veto-mit-vorgabe-390.png" alt="Matchseite am Handy im Veto: über dem Brett der Block Vorgabe der Woche mit der Map Kaimauer für Kontrolle als Map 3, im Brett steht sie als Vorgabe der Woche, bei der Auswahl zum Sperren ist sie ausgegraut" width="300"> <img src="../assets/liga/veto-vorgabe-fehlt-390.png" alt="Matchseite am Handy: Veto wartet auf die Vorgabe der Woche, darunter der Satz für welche Spielwoche und welchen Modus sie fehlt und der Hinweis, dass nichts von selbst gewertet wird" width="300"> <img src="../assets/liga/veto-bereit-wartet-390.png" alt="Matchseite am Handy nach dem Nachtragen: Vorgabe steht – bereit zum Veto?, die eigene Seite ist bereit und wartet auf die Gegenseite, darunter der Knopf Doch nicht bereit und der Hinweis, dass erst ab dem Start die Zeit läuft" width="300">

<img src="../assets/liga/veto-bereit-leitung.png" alt="Matchseite der Liga-Leitung am PC: eine Seite ist bereit, die andere noch nicht; darunter der Kasten Notfall: Veto starten mit dem Pflichtfeld Grund und dem Knopf Veto jetzt starten" width="640">

<img src="../assets/liga/veto-live-390.png" alt="Matchseite am Handy im laufenden Veto: Countdown in Orange für Team B, darunter die Ablauf-Leiste mit dem laufenden Schritt, die Frage Welche Map sperrt ihr und das Brett mit Map-Karten - die gesperrte Hafenkante gedimmt mit Bann-Zeichen" width="300"> <img src="../assets/liga/veto-live-1440.png" alt="Matchseite am PC im laufenden Veto: Ablauf-Leiste mit elf Schritten, darunter je Modus die Map-Karten mit Bild; gesperrte Karten gedimmt, Nebelwerk als Map 1 von Team A in Blau gewählt, der Modus des laufenden Zugs gerahmt" width="640">

<img src="../assets/liga/veto-live-tv-1920.png" alt="TV-Ansicht des Vetos: links großer Countdown und das Team am Zug, rechts je Modus die Map-Karten, unten der ganze Ablauf mit den fertigen Schritten und ihren Maps" width="640">

### 3.1d Vorfälle im Spiel (Regelwerk § 9, Anlage C)

Fliegt jemand aus der Lobby, braucht es einen Rehost oder eine Pause, melden die Teams das auf der **Matchseite** in der Fläche
**Vorfälle im Spiel** (was sie dort tun, steht im [Spickzettel](liga-captains.md)). Für euch heißt das:

- **Einigen sich die Seiten**, habt ihr nichts zu tun. Der Vorfall steht mit Stand, Vorschlag und Nachweisen am Spiel. Wird eine Map
  neu gestartet oder wiederholt, zählt sie trotzdem nur einmal: Beim gültigen Ergebnis trägt die Map „Wiederholt“, die erste
  Austragung steht nur im Vorfall. **Meldungen von vor dem Neustart oder der Wiederholung zählen nicht mehr** – sie beschreiben die
  ungültige Austragung. Beide Seiten und ihr lest über den Vorfällen „Map 2 wird wiederholt – danach meldet ihr die Serie neu“,
  bis neu gemeldet ist. Das gilt genauso, wenn ihr selbst auf Neustart oder Wiederholung entscheidet.
- **Lehnt die Gegenseite ab oder antwortet sie nicht in der Antwortzeit** (2.7e), ist die Map **in Klärung**. Ihr bekommt eine
  Nachricht, der Fall steht unter **Mein Dienst → Braucht deine Entscheidung** („Map in Klärung“). Bis ihr entscheidet, gilt
  kein Ergebnis: Melden bleibt möglich, Bestätigen und die 48-Stunden-Regel ruhen, das Spiel steht nicht in der Tabelle.
  Öffentlich steht am Spiel nur „in Klärung“, nie der Vorfall selbst.
- **Entscheiden** (Zuständigkeit „Ergebnisse“ oder „Proteste“): auf der Matchseite am Vorfall unter **Entscheidung der
  Liga-Leitung**. Seht euch zuerst die **Nachweise** beider Seiten an (aufklappen; ihr könnt selbst welche anhängen). Dann wählt ihr:
  *Beim Stand fortsetzen*, *Rehost beim Stand*, *Neustart (frühe Phase)*, *Map wiederholen*, *Map zugesprochen* (mit der Seite)
  oder *Keine Maßnahme*. Die **Begründung** ist Pflicht, beide Seiten lesen sie.
- **Serie feststellen** – der zweite Schritt, erst danach kann ein Ergebnis gültig werden:
  - Ist nichts mehr zu spielen (etwa bei „Keine Maßnahme“ oder „Map zugesprochen“), hakt ihr gleich bei der Entscheidung
    **Serie gleich feststellen** an.
  - Nach „Neustart“ oder „Map wiederholen“ wird die Map erst gespielt und die Serie **neu gemeldet**. Vorher gibt es „Serie
    feststellen“ nicht, und „Mein Dienst“ nennt das Spiel solange nicht. Sobald eine Seite neu gemeldet hat, steht am Vorfall das
    Formular **Serie feststellen**: **Fehlt noch eine Map?** (dann setzt ihr sie an und stellt später noch einmal fest) und **Welche Maps
    zählen nicht?** – Maps, die unter Vorbehalt gespielt wurden, obwohl die Serie mit eurer Entscheidung schon entschieden war. Sie
    stehen in keiner Wertung, die Matchseite zeigt „zählt nicht (Entscheidung der Liga-Leitung)“.
  - Haben beide Seiten schon dasselbe gemeldet, gilt das Ergebnis mit der Feststellung sofort. Hat nur eine Seite gemeldet, läuft
    die Bestätigungsfrist ab der Feststellung neu. Passen die Meldungen nicht zu eurer Entscheidung, tragt ihr das Ergebnis über
    **Ergebnis eintragen** ein (3.2).
- **Selbst einen Vorfall aufnehmen:** **Vorfall aufnehmen** in derselben Fläche. Die Map ist dann sofort in Klärung, ohne Antwort der
  Seiten – so setzt ihr eine Serie aus (Anlage C.2.6).
- **Ohne Entscheidung schließen:** Gibt es über die Map nichts mehr zu entscheiden (etwa weil ein Team gar nicht mehr antritt),
  schließt ihr den offenen Vorfall am Vorfall mit **Ohne Entscheidung schließen** und einer Begründung. Beide Seiten bekommen
  „Vorfall geschlossen“, die Begründung steht am Vorfall. Haben beide Seiten schon dasselbe Ergebnis gemeldet, gilt es mit dem
  Schließen – das Formular sagt das.
- **Kampflos und „nicht erschienen“ erst nach dem Vorfall:** Solange ein Vorfall offen ist, lehnt die Seite „Kampflos“, „Nicht
  erschienen“ und „Beide nicht erschienen“ ab und sagt, zu welcher Map der Vorfall offen ist. Entscheidet zuerst oder schließt
  ihn. Endet ein Spiel auf anderem Weg (abgesagt, archiviert), schließt die Seite offene Vorfälle von selbst und ohne Nachricht;
  „in Klärung“ verschwindet dann überall.
- **Im eigenen Spiel** entscheidet eine zweite berechtigte Person (Befangenheit, 2.0); die Seite sagt das. Der Superadmin kann nur
  als Notausnahme mit Grund.
- **Ergebnis eintragen** geht, sobald kein Vorfall mehr offen ist (weder „wartet auf Antwort“ noch „in Klärung“) – die Seite nennt
  sonst den Grund. Ist entschieden, aber die Serie noch nicht festgestellt, stellt euer eingetragenes Ergebnis sie fest: Am
  Vorfall steht dann „Serie festgestellt: Die Liga-Leitung hat das Ergebnis eingetragen.“ Nehmt ihr das Ergebnis mit
  **Rückgängig** zurück, ist auch die Serie wieder offen.
- **Zurückziehen** kann die meldende Seite nur, solange die Antwortzeit läuft. Danach liegt der Vorfall bei euch.

<img src="../assets/liga/vorfall-entscheiden-1440.png" alt="Fläche Vorfälle im Spiel für die Liga-Leitung: der Vorfall in Klärung mit Stand und Vorschlag, darunter die Entscheidung mit sechs Möglichkeiten, der Seite für die zugesprochene Map, der Begründung und dem Haken Serie gleich feststellen" width="820">

### 3.2 Ergebnisse

Melden mit Maps und Teilnehmerliste (nur im Web), Bestätigen im Web oder in der App, die 48-Stunden-Regel und
was dabei geprüft wird, steht für die Captains in
[Turniere, 3.16](turniere.md#316-liga-ergebnis-je-map-melden-für-captains) – zum Weitergeben gibt es den
[Spickzettel](liga-captains.md). Für die Turnierleitung dazu:

- **Selbst eintragen**: Reiter **Spiele** → **Ergebnis eintragen** – Stand, auf Wunsch Maps und die Teilnehmerlisten
  beider Seiten; eine fehlende Seite trägt ihre Liste danach selbst nach. Je Map wählen die Punkte den Sieger vor; die
  Sieger-Knöpfe bleiben für euch trotzdem da (etwa beim Übergehen einer Regel mit Grund). Passen Sieger und Punkte nicht
  zusammen, steht das an der Map, mit **Sieger aus den Punkten übernehmen**. Siehe
  [Turniere, 3.6](turniere.md#36-ergebnisse-melden-eintragen-korrigieren).
- **Kampflos**: im Ergebnis-Fenster **Nicht erschienen** auf der fehlenden Seite. Schon eingetragene Maps fallen dabei
  weg, der alte Stand bleibt im Verlauf des Spiels. Die Wertung ist eine Teamstrafe: Captain, Vertreter und die Leitung
  des Hauptteams sehen sie unter **Meine Strafen**, in **Admin → Strafen** steht sie einmal unter dem Co-Team.
- **Beide nicht erschienen**: am Spiel **Beide nicht erschienen** (nur in einer Staffel, nur ohne Ergebnis, mit
  Begründung). Beide verlieren, keine Punkte, keine Maps, je Seite ein Eintrag „nicht erschienen“; im Spielplan steht
  „beide nicht erschienen“. Wollt ihr das Spiel doch nachholen: am selben Spiel **Neu ansetzen** mit Grund – das Spiel ist
  wieder offen, den Termin setzt ihr wie gewohnt. Recht: **Ergebnisse korrigieren**, nicht im eigenen Spiel.
- **„Nicht erschienen?“ nur als Vorschlag**: Mit Check-in (2.7b, 3.1b) schlägt der Server nach dem Fenster vor, wenn eine Seite
  fehlt – gewertet wird nie von selbst, ihr entscheidet (kampflos, nachtragen, verlängern; fehlen beide: **Beide nicht
  erschienen**). Ohne Check-in sagt ein Termin nichts darüber, ob jemand da war: Dann gibt es keinen Vorschlag, **Ergebnis
  fehlt** meldet sich, klärt es mit beiden Seiten und wertet selbst.

### 3.3 Teilnehmerliste nachtragen

**Am Schluss hakt jedes Team einmal an, wer gespielt hat**: alle, die mindestens eine Map gespielt haben. Mindestens drei, bei Wechseln auch sechs und mehr. Es gibt keine Eingabe vor oder je Map; Maps, Modi und Endstände bleiben je Map Pflicht. Jedes Team trägt nur seine eigene Seite ein.

Fehlt nach der Bestätigung eine Liste (etwa nach einer Bestätigung in der App oder nach den 48 Stunden), **bleibt das Ergebnis gültig**. Captain oder Vertreter dieser Seite tragen die Liste bis **48 Stunden ab der Bestätigung** im Web nach; bis dahin steht bei ihnen auf der Startseite die Aufgabe. Danach bekommt ihr den Fall als Nachricht **Teilnehmerliste fehlt nach der Frist**: am Spiel **Fehlende Teilnehmerliste nachtragen (Liga-Leitung)** mit einem Grund, oder ihr entscheidet anders. Eine fehlende Liste ist keine Wertung. **Wer nicht auf der Liste steht, zählt nicht als Einsatz.** Für die Tabelle spielt die Liste keine Rolle; sie zählt für den Doppel-Einsatz und für Auszeichnungen.

Staffeln, die noch **je Map** aufstellen (ältere Seasons oder **Wer gespielt hat → Aufstellung je Map**), laufen wie bisher: die eigene Aufstellung bis 48 Stunden nach dem Ergebnis, danach die Leitung mit **Ergebnis korrigieren**. Alte Spiele bleiben lesbar.

### 3.4 Einspruch und Korrektur

- **Beanstandung und Protest** (Regelwerk § 11, § 12): Stimmt etwas nicht, tippt eine Seite **Stimmt nicht** bzw.
  **Problem melden**. Vor der Bestätigung ist das eine **Beanstandung** – das Spiel ruht („In Klärung“), die
  48-Stunden-Automatik auch. Nach der Bestätigung ist es ein **Protest**, möglich innerhalb der **Protestfrist** der
  Season (Vorgabe 48 Stunden ab der Bestätigung, ruht in Sperrzeiten). Das Formular führt: Grund aus eurer Liste,
  Begründung, bei „Falsches Ergebnis“ das abweichende Ergebnis, bei Ausrüstung, Lobby und Spielberechtigung die
  Pflichtfrage „sofort hingewiesen?“, dann Nachweise. Je Seite läuft ein Verfahren; ergänzen geht bis zum Ende der Frist,
  zurückziehen bis zur Entscheidung (danach kein neues mit demselben Grund).
- **Eingang**: Season → Reiter **Proteste** zeigt alle Verfahren der Season, offene zuerst, mit Zuständiger und
  Restzeit. **Zum Spiel** öffnet die Matchseite mit der Karte des Verfahrens. Dafür braucht es die Zuständigkeit
  **Proteste**; wer am Spiel beteiligt ist, sieht im Eingang nur, dass etwas läuft
  ([2.0](#20-bereich-ligen-und-zuständige)).

  <img src="../assets/liga/protest-eingang-1440.png" alt="Reiter Proteste der Season am PC: Eingang der Verfahren mit Protest, Beanstandung und entschiedenem Einspruch, je mit Stand, Zuständiger und dem Link Zum Spiel; darunter die Einstellungen" width="760">

- **Bearbeiten** auf der Karte des Verfahrens: **Übernehmen** (beide Seiten sehen, wer zuständig ist; ab dann läuft die
  Zielfrist, Vorgabe 72 Stunden), **Stellungnahme +24 Std.**, **MOSS-Datei anfordern** (ein Spieler, Frist 24 Stunden;
  fehlt die Datei danach, bekommt ihr einen Hinweis – gewertet wird nichts von selbst, **Entschuldigen** geht mit Grund).
  Läuft die Zielfrist ab, erinnert die Seite die zuständige Person und meldet den Fall nach der eingestellten Frist (Vorgabe 24 Stunden)
  an die Leitung mit **Liga verwalten**. Entschieden wird nie automatisch.
- **Entscheiden**: immer mit **Begründung** (mindestens zehn Zeichen, geht an beide Seiten). **Ergebnis bleibt** schließt
  das Verfahren; **Ergebnis ändern** öffnet das Ergebnis-Fenster, die Begründung steht dort als Grund der Korrektur.
  Auch eine Wertung **kampflos** oder **nicht erschienen** entscheidet ein offenes Verfahren mit: Sie geht dann nur mit dem
  Recht **Proteste** und einer Begründung von mindestens zehn Zeichen.
  Wer am Spiel selbst beteiligt ist, entscheidet nicht.
- **Einspruch**: Gegen die Entscheidung, eine Wertung kampflos oder eine Korrektur kann eine Seite innerhalb der
  Einspruchsfrist (Vorgabe 48 Stunden) einmal Einspruch einlegen. Darüber entscheidet **eine andere Person** als bei der
  ersten Entscheidung – auch der Superadmin nicht über die eigene. Bis dahin gilt die erste Entscheidung weiter.
- **Tabelle und TV**: Mit **Zählt vorläufig** (Vorgabe) bleibt ein Ergebnis mit laufendem Protest in der Tabelle; Spiel
  und Tabellenzeile tragen „in Klärung“ – auf der Ligaseite, im TV, in der Tabelle als PDF, auf dem Teilen-Bild eines
  Ergebnisses und im Turnierweg im Profil. Nach der Entscheidung zeigen alle wieder das gültige
  Ergebnis ohne Hinweis. Unter **Braucht
  Aufmerksamkeit** steht der Fall mit **Zum Spiel**. Mit **Zählt bis zur Entscheidung nicht** fällt das Spiel so lange heraus.
- **Einstellen**: Season → **Proteste** → **Fristen, Gründe und Tabelle**. Speichern gilt sofort in allen nicht
  gesperrten Staffeln; laufende Verfahren behalten ihre Fristen. Die vier Grundgründe bleiben in der Liste, damit auch
  die App melden kann.
- **Wer sieht was**: die eigene Seite alles; die Gegenseite Grund, Begründung, das abweichende Ergebnis, Bilder,
  Links, Stand und Entscheidung, aber keine MOSS-Datei; ihr als nicht beteiligte Leitung alles; alle anderen nur
  „In Klärung“. MOSS-Dateien sehen nur die hochladende Person, Captain und Vertreter ihrer Seite und ihr.
- **Korrigieren**: am Spiel **Ergebnis korrigieren** – Stand, auf Wunsch Maps und Aufstellungen, Pflicht ist ein
  **Grund** (mindestens fünf Zeichen). Die Korrektur schließt einen offenen Einspruch, die Tabelle rechnet sofort neu.
  Ohne neue Maps bleiben die alten, solange sie zum Stand passen – sonst fallen sie weg. Ablauf wie in
  [Turniere, 3.7](turniere.md#37-dispute-streit-um-ein-ergebnis).
- **Ergebnisregeln gelten auch für die Leitung** (2.2, Schritt 5): Eintragen und Korrigieren prüfen dieselben Endstände
  wie die Meldung der Captains. Passt ein Endstand wirklich nicht zur Regel (etwa nach einem Absturz), darf die
  **Liga-Leitung mit der Zuständigkeit „Ergebnisse“** sie übergehen: im Ergebnis-Fenster **Ergebnisregel übergehen
  (Liga-Leitung, mit Grund)** einen Grund eintragen (mindestens fünf Zeichen). Best of, Map-Pool und Aufstellung gelten
  trotzdem; der Grund steht im Protokoll. Im eigenen Spiel entscheidet eine zweite Person (2.0), der Superadmin nur als
  Notausnahme mit Grund. Captains können eine Regel nie übergehen.
- **Wiederholte und zugesprochene Maps**: Über die Schnittstelle kann eine Map als **wiederholt** (mit Grund) markiert
  oder von der Leitung **zugesprochen** werden (ohne Punkte, ohne Regel). Die Matchseite zeigt beides an der Map; nach
  dem Serienende steht dort, welche Maps nicht gespielt wurden.

### 3.4a Strafen (Regelwerk § 13, Anlage C)

Wettbewerbsstrafen stehen im Reiter **Strafen** der Season (Admin → Liga → Season). Dafür braucht es die Zuständigkeit
**Strafen** ([2.0](#20-bereich-ligen-und-zuständige)). Nichts davon passiert von selbst: Jede Strafe wählt und
begründet ihr von Hand. Verwarnungen der Community-Moderation (Chat, Verhalten) sind etwas anderes und stehen nicht hier.

<img src="../assets/liga/strafen-reiter-1440.png" alt="Reiter Strafen der Season am PC: oben die Zahl der laufenden Strafen und der Knopf Strafe verhängen, darunter eine Spielsperre mit Stand Gilt, Regelverstoß, Begründung, Zeitraum 1 Liga-Spiel und dem Knopf Widerrufen sowie ein Punktabzug mit laufender Einspruchsfrist" width="760">

**Strafe verhängen** führt euch in dieser Reihenfolge:

1. **Aus dem Strafkatalog** wählen (Anlage C) – das füllt Art und Regelverstoß vor. Oder **Frei eintragen**.
2. **Art der Strafe**, dann **Staffel**, **Co-Team** und bei einer Strafe gegen eine Person die **Person**.
3. **Spiel**, wenn die Strafe eines betrifft (Pflicht bei Map- und Spielverlust). Dann könnt ihr **Nachweise aus dem
   Spiel** ankreuzen – Bilder, Video-Links und MOSS-Dateien, die ihr am Spiel sehen dürft. Angehängte Nachweise bleiben
   aufbewahrt, solange die Strafe läuft oder ein Einspruch offen ist.
4. **Regelverstoß** (Paragraf oder Katalogeintrag) und **Begründung** – beides Pflicht. Die Betroffenen lesen beides.
5. Je nach Art die **Höhe** oder die **Dauer**. Der Knopf geht erst, wenn nichts mehr fehlt; daneben steht, was fehlt.

<img src="../assets/liga/strafe-verhaengen-390.png" alt="Formular Strafe verhängen am Handy: Katalog, Art Punktabzug, Staffel, Co-Team, Spiel, Regelverstoß, Begründung, Punktabzug 2 und der Knopf Strafe verhängen" width="300">

| Art | Für wen | Was sie bewirkt |
| --- | --- | --- |
| **Verwarnung, Gelbe Karte, Rote Karte** | Person oder Co-Team | Steht bei den Betroffenen, sonst nichts. Die Rote Karte braucht die sportliche Maßnahme als eigene Strafe |
| **Punktabzug** | Co-Team | Die Tabelle zieht die Punkte sofort ab – Website, App, TV und Druck zeigen „−2 Punkte Abzug“, nie den Grund |
| **Mapverlust, Spielverlust** | Co-Team, mit Spiel | Steht bei den Betroffenen. Das Ergebnis ändert ihr danach selbst über **Ergebnis korrigieren** am Spiel (3.4) |
| **Spielsperre** | Person | Nicht spielberechtigt: kein Check-in, keine Aufstellung. Dauer: **Anzahl Liga-Spiele** (mindestens eines) oder **bis zu einem Zeitpunkt**, höchstens bis zum Ende der Season |
| **Teamsperre** | Co-Team | Alle Spieler des Co-Teams sind gesperrt, das Co-Team kann sich nicht anmelden. Mit Ende, auch über die Season hinaus |
| **Disqualifikation** | Co-Team | Das Co-Team scheidet aus: alle Spiele zählen nach der Regel der Season für die Gegner, offene werden kampflos gewertet, das Team steht am Tabellenende (3.5) |
| **Ligaausschluss** | Person oder Co-Team | Gesperrt in jeder Season dieser Liga, ohne Ende |
| **Externe Sperre** | Person | Sperre des Herstellers oder einer Plattform wegen Cheating, Manipulation oder Betrug: für ihre Dauer nicht spielberechtigt. Reine Chat-Sperren tragt ihr nicht ein |

- **Vorläufig** (nur Spielsperre und Teamsperre, etwa bei Cheating-Verdacht): Die Sperre wirkt sofort und braucht noch
  keine Dauer. Nach der Prüfung **Sperre bestätigen** (mit Dauer) oder **Widerrufen**.
- **Sperre nach Spielen:** Gezählt werden die nächsten entschiedenen Liga-Spiele des Co-Teams. In diesen Spielen bleibt
  die Person auch beim Nachtragen der Teilnehmerliste gesperrt. Spätestens mit dem Ende der Season ist die Sperre vorbei,
  auch wenn Spiele fehlen (Team ausgeschieden, Person gewechselt) – die Liste zeigt dann „mit dem Ende der Season beendet“.
- **Wer es erfährt:** die Person bzw. Captain, Vertreter und Leitung des Hauptteams – mit Regelverstoß und Begründung unter
  **Meine Strafen**. Dort steht „durch die Liga-Leitung“, nicht euer Name. Bei einer Sperre erfahren Captain und Vertreter zusätzlich nur „… ist gesperrt“, damit sie aufstellen
  können. Mitspieler und Gegner sehen beim Aufstellen „Sperre der Liga“ ohne Grund. Öffentlich steht nur, was in der
  Tabelle steht: Punktabzug und Disqualifikation.
- **Widerrufen** geht nur mit Grund (mindestens fünf Zeichen) und nimmt jede Wirkung zurück: Die Person ist wieder
  spielberechtigt, die Tabelle rechnet neu, ein disqualifiziertes Co-Team ist wieder dabei und seine dadurch kampflos
  gewerteten oder abgesagten Spiele stehen wieder da wie davor (ein offenes behält den Termin, der Check-in beginnt neu;
  ein laufendes läuft weiter, gespielte Maps bleiben). Ein dabei geschlossener Startgeld-Auftrag bleibt geschlossen – das
  klärt ihr mit dem Kassier. Ein noch offener Einspruch ist mit dem Widerruf erledigt. Die Strafe bleibt mit dem Grund in der Liste.
- **Einspruch:** Betroffene können innerhalb der Einspruchsfrist (Reiter **Proteste**, Vorgabe 48 Stunden ab der
  endgültigen Entscheidung) einmal Einspruch einlegen. Die Strafe gilt bis zur Entscheidung weiter. Der Reiter zeigt
  „Einspruch wartet“. Es entscheidet eine **andere Person** mit der Zuständigkeit Strafen als die, die verhängt oder
  bestätigt hat – auch der Superadmin nicht über die eigene Strafe: **Strafe bleibt** oder **Strafe aufheben**, mit
  Begründung, endgültig.
- **Eigenes Team:** Wer zur betroffenen Seite gehört (Kader, Captain, Vertreter, Hauptteam-Leitung), verhängt, bestätigt und
  widerruft dort nichts; an der Strafe steht „Über dein eigenes Team entscheidet eine andere Person“. Nennt die Strafe
  ein Spiel, gilt das auch für alle, die an dem Spiel beteiligt sind. Der Superadmin bekommt in beiden Fällen das Feld
  **Grund für die Notausnahme**.
- **Gesperrte Staffel:** Punktabzug und Disqualifikation ändern die Staffel. Ist sie gesperrt, erst entsperren. „Strafe
  bleibt“ bei einem Einspruch geht auch in einer gesperrten Staffel.
- **Eingang:** Unter **Admin → eSports → Strafen** stehen die Strafen der Ligen, in denen ihr die Zuständigkeit **Strafen** habt, neben Strafzeiten und kampflosen
  Wertungen; **Öffnen** führt in den Reiter.

### 3.5 Tabelle und Ligaseite

Die Tabelle steht auf der Ligaseite je Staffel (und auf der Staffel-Seite im Reiter **Tabelle**): Punkte, Spiele, Differenz, Form der
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

**Punkte nach gewonnenen Maps:** Rechnet die Season so (2.2), steht unter der Tabelle „Punkte = gewonnene Maps (3:2 ergibt 3 und 2,
kampflos 3:0)“ – das Beispiel folgt dem Best of der Staffel, bei Best of 3 also „2:1 ergibt 2 und 1, kampflos 2:0“, und die Spalte **S** (Siege) bleibt auch am Handy sichtbar, weil mehr Siege bei Punktgleichheit zuerst zählen. Die
Spalte **Maps** (gewonnen:verloren) gibt es am PC. App und TV zeigen dieselben Punkte, weil sie vom Server kommen.

<table>
<tr>
<td><img src="../assets/liga/liga-tabelle-mappunkte-pc.png" alt="Staffel-Tabelle mit Punkten nach gewonnenen Maps am PC: Spalten Sp, S, N, Maps, Diff, Form, Pkt, darunter Punkte = gewonnene Maps und die Reihenfolge" width="420"></td>
<td><img src="../assets/liga/liga-tabelle-mappunkte-handy.png" alt="Dieselbe Tabelle am Handy mit Spalte S" width="200"></td>
</tr>
</table>

**Entscheid der Leitung:** Admin → Liga → Season → Reiter **Tabelle** → bei der Staffel **Tabelle öffnen** (oder auf der Staffel-Seite der
Reiter **Tabelle**). Unter der Tabelle mit Zonen und **PDF Tabelle** stehen im Feld **Gleichstand** die geteilten Plätze. Die Season selbst
hält nur die Regeln (Punkte, Gleichstand, Ausscheiden). **Reihenfolge festlegen** → mit den Pfeilen sortieren → **Grund** (mindestens fünf Zeichen, steht
öffentlich an der Tabelle: „Platz durch Entscheid der Leitung: …“) → **Festlegen**. Das geht nur bei echtem Gleichstand und
nur für alle Teams auf diesem Platz; über das eigene Team entscheidet eine andere Person. Recht: **Ergebnisse
korrigieren**. Ändert ein späteres Ergebnis den Gleichstand, gilt der Entscheid nicht mehr (Hinweis **Gilt nicht mehr**)
und bleibt zur Nachvollziehbarkeit stehen; **Zurücknehmen** löscht ihn mit Grund.

Gleichstände entscheidet die Leitung auf der Staffel-Seite. Ein geteilter Meisterplatz (oberste Liga) trägt dort das Kennzeichen
**Meisterplatz**, ein geteilter Platz an der Grenze zu Auf- oder Abstieg **Grenze zu Auf- oder Abstieg**. Beim Meisterplatz ist **Wie wurde
entschieden?** Pflicht. Was beim Abschluss noch blockiert (Meister, Zonengrenze), zeigt der Reiter **Abschluss** der Season mit derselben
Pflicht zur Art (3.10). Ist die Staffel abgeschlossen, steht statt der Knöpfe der Hinweis, sie erst im Reiter **Abschluss** wieder zu öffnen.

<img src="../assets/liga/liga-gleichstand-entscheid-handy.png" alt="Staffel-Seite am Handy, Reiter Tabelle, Feld Gleichstand: Platz 4 geteilt mit dem Knopf Reihenfolge festlegen, darunter ein älterer Entscheid mit Gilt nicht mehr und Zurücknehmen" width="300">

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
  Liga-Leitung“. Herausnehmen kann es nur die Liga-Leitung.

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

Alles sind Vorgaben, jede Season stellt sie selbst ein (2.2). Geprüft wird an einer Stelle: beim Zuteilen, bei der Aufnahme in den Kader, auf der Teilnehmerliste und beim Check-in. Ältere Seasons tragen die Felder nicht und prüfen nichts Neues.

**Fehlende Angaben sperren erst beim Spielen** (#2313): Fehlen Geburtsdatum, Spiel-ID oder Plattform, ist jemand zu jung oder sind zu wenige spielberechtigt, geht die Anmeldung trotzdem, und ihr dürft trotzdem annehmen und zuteilen. Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden; ein Team mit zu wenigen Spielberechtigten kann nicht einchecken. Danach gibt es wie immer nur den Vorschlag „nicht erschienen“, gewertet wird nie von selbst. Die Betroffenen sowie Captain und Vertreter bekommen beim Einreichen und vor dem ersten Spiel eine Nachricht (Vorlauf in 2.7b).

| Regel | Was passiert |
| --- | --- |
| **Mindest- und Höchstkader** | Über den Höchstkader lässt sich niemand aufnehmen. Unter den Mindestkader führt nur ein Abgang: Der bleibt möglich, es gibt Warnung und Aufgabe (3.8) |
| **Ein Team je Season** | Wer in der Season in einem anderen Co-Team steht oder stand, kommt nur per Transfer. In anderen Seasons und Ligen ist das frei |
| **Wartezeit** | Bis zum Ende von Spielwoche 1 spielen Neue sofort. Danach warten sie ab der Aufnahme so viele Tage, auch wenn der Kader dadurch zu klein ist. Wer ins selbe Co-Team zurückkommt, startet keine neue Wartezeit. Das Zuteilen eines Co-Teams durch euch startet keine. **Ein Transfer wartet immer**, auch vor dem Ende von Spielwoche 1 |
| **Stichtag** | Optional in der Kaderübersicht: Neue warten auf eure Freigabe, Abgänge bleiben frei (3.7) |
| **Transferfenster** | Die Teamleitung beantragt im Fenster, ihr entscheidet. Nach der Genehmigung wartet die Person ab der Kaderaufnahme die volle Wartezeit, immer und auch wenn sie das alte Co-Team schon verlassen hatte |
| **Mindestalter** | Prüfung über das Geburtsdatum im Profil als Selbstauskunft. Ohne Datum oder zu jung: Anmeldung, Zuteilen, Aufnahme in den Kader und Transfer gehen, aber kein Check-in und keine Aufstellung. Auf der Team-Seite steht so jemand unter „Aufnehmbar, spielen erst mit der fehlenden Angabe“. Ihr seht nur „Alter erfüllt“, „Geburtsdatum fehlt“ oder „Altersvorgabe nicht erfüllt“, die Liga nennt nie ein Datum oder Alter |
| **Spiel-ID** | Format und Auswahl stehen am Spiel unter **Admin → Spiele → Zahnrad → Spiel-IDs**: Format als regulärer Ausdruck, Beispiel für die Spieler, Auswahlwerte. So wird auch die **Plattform** zum Pflichtfeld, das einmal je Season festgehalten wird. Eine schon festgehaltene ID bleibt gültig. Eine doppelte ID wird abgelehnt, die Meldung nennt nie, wem sie gehört |
| **Plattform** (2.7c) | Bei der Anmeldung zählt nicht als spielberechtigt, wer eine andere oder keine Plattform angibt: Er steht als Hinweis da, auch unter dem Mindestkader geht die Anmeldung. Weil die Liga dort noch nicht feststeht, gilt die weiteste Regel aller Liga N. Beim Zuteilen gilt die Liga N der Staffel; wer nicht passt und ob zu wenige übrig bleiben, steht als Hinweis im Dialog. Auf die Teilnehmerliste kommt niemand mit anderer Plattform. Die Aufnahme in den Kader prüft die Plattform nicht |

**Wartezeit aufheben:** Season → Reiter **Anmeldung und Kader** → **Kader und Spiel-IDs** → beim Spieler **Wartezeit aufheben** → Grund (mindestens fünf Zeichen). Das geht mit der Zuständigkeit **Kader prüfen** und steht im Protokoll.

**Transfer:** Die Teamleitung tippt unter **Spielberechtigung** auf **Transfer beantragen**; die Person muss schon im Hauptteam stehen. Ihr seht den Antrag oben unter **Kader und Spiel-IDs**: **Genehmigen** nimmt die Person aus dem alten Co-Team und setzt sie ins neue, die Wartezeit beginnt, aufheben könnt nur ihr mit Grund; **Ablehnen** braucht einen Grund. Ist die Person im alten Co-Team Captain oder Vertreter, vergibt die Teamleitung die Rolle zuerst neu. Person und beide Teamleitungen bekommen eine Nachricht.

**Eingriff von außen:** Ändert ihr den Kader oder die Rollen eines Co-Teams, bekommen Leitung und Co-Leitung des Hauptteams eine Nachricht: wer, was, wann. Jede Kaderänderung in einer laufenden Staffel steht im Protokoll, auch wenn die Teamleitung sie macht oder jemand das Team verlässt.

### 3.10 Saisonabschluss

**Wo:** **Admin → Ligen → Season → Reiter Abschluss**. Abgeschlossen wird **je Staffel**. Die Season ist beendet, wenn alle
Staffeln abgeschlossen sind – der Stand springt dann von selbst auf „Beendet“. Recht: **Season konfigurieren**; lesen darf
jede Zuständigkeit der Liga.

<img src="../assets/liga/abschluss-cockpit-pc.png" alt="Reiter Abschluss am PC: Staffel A mit vier offenen Punkten samt Links und dem Knopf Meister entscheiden, Staffel B bereit zum Abschluss mit Vorschau des Endstands, Staffel C abgeschlossen mit Meister, Endstand, Wieder öffnen und Verlauf der Fassungen" width="720">

**1. Checkliste abarbeiten.** Jede Staffel zeigt, was dem Abschluss noch entgegensteht – mit Link zur Stelle:

| Punkt | Was tun |
| --- | --- |
| Offene Spiele | Ergebnis eintragen, kampflos werten oder absagen. Ohne Entscheidung gibt es keinen Abschluss. |
| Ergebnis wartet auf Veröffentlichung | ein paar Sekunden warten (das Ergebnis liegt noch für „Rückgängig“ bereit) oder „Rückgängig“ wählen |
| Offene Vorfälle | auf der Matchseite entscheiden und die Serie feststellen |
| Offene Verfahren | Beanstandung, Protest oder Einspruch entscheiden (Reiter **Proteste**) |
| Strafen und Einsprüche | vorläufige Sperren bestätigen oder widerrufen, Einsprüche entscheiden (Reiter **Strafen**) |
| Laufende Fristen | abwarten – daneben steht, bis wann die Protest- oder Einspruchsfrist läuft |
| Gleichstand auf Platz 1 | **Meister entscheiden** (nur in der obersten Liga) |
| Gleichstand an der Grenze zu Auf- oder Abstieg | **Platz entscheiden** – zwei Teams stehen gleich, aber nur eines käme in die Zone (3.11) |
| Gleichstand zwischen den Staffeln | weiter unten unter **Plätze über Staffeln hinweg** → **Gleichstand entscheiden** (siehe unten). Kommt nur bei der letzten offenen Staffel einer Liga |
| Kein Meister | in der obersten Liga steht kein Team mehr in der Wertung – Anmeldungen prüfen |

**Plätze über Staffeln hinweg:** Vergibt eine Liga mit mehreren Staffeln zusätzliche Auf- oder Abstiegsplätze über alle Staffeln
(2.3), steht unter den Staffeln ein eigener Kasten je Liga. Er zeigt die Kandidaten – je Staffel das Team auf dem ersten Platz
nach Aufsteigern und Relegation bzw. auf dem letzten davor unten – mit **Punkten je Spiel** und **Map-Differenz je Spiel**. Danach wird verglichen, in dieser
Reihenfolge; so zählen auch verschieden große Staffeln gleich. Am Team steht „steigt auf“ bzw. „steigt ab“. Solange noch eine
Staffel der Liga offen ist, ist das der **Stand von jetzt**: Keine Tabelle zeigt die Zone, bevor alle Staffeln abgeschlossen sind.
Danach steht sie in der Tabelle, am TV, im PDF, in der App und in der Season-Historie.

Stehen Teams an der Grenze nach beidem gleich, meldet der Kasten **Gleichstand**, und die letzte Staffel der Liga lässt sich nicht
abschließen. **Gleichstand entscheiden** (Recht „Ergebnisse korrigieren“): die Teams anhaken, die den Platz bekommen, die Art
wählen – **Entscheidungsspiel** oder **Entscheid der Leitung**, ein Los gibt es beim Auf- und Abstieg nicht – und den Grund
eintragen. Über das eigene Team entscheidet eine andere Person. Nach dem Entscheid steht am gewählten Team „steigt auf“ bzw.
„steigt ab“, am unterlegenen „bleibt“. **Zurücknehmen** geht mit Grund; dann ist der Gleichstand wieder offen. Auch das macht beim
eigenen Team eine andere Person – der Knopf fehlt dann. Ein Entscheid gilt für genau diesen Gleichstand: dieselben Teams mit
denselben Punkten und derselben Map-Differenz je Spiel. Ändert sich nach einem Wiederöffnen eines davon, gilt er nicht mehr, und
du entscheidest neu. Du darfst schon entscheiden, bevor die letzte Staffel abgeschlossen ist.

**Einer nach dem anderen:** Schließen zwei Personen im selben Moment zwei Staffeln derselben Season ab oder ändert jemand gerade
eine Liga, bekommt die zweite den Satz „In dieser Season wird gerade eine andere Staffel abgeschlossen oder eine Liga geändert.
Bitte erneut versuchen.“ Einfach noch einmal abschließen – der zweite Abschluss sieht dann den ersten.

Der Chip an der Staffel zählt die offenen Punkte („4 offen“), **Bereit zum Abschluss** heißt: nichts hält mehr auf. Steht
**Unvollständig** am Chip, ist ein Abschluss mittendrin abgebrochen: Die Staffel ist gesperrt, einen Endstand gibt es
nicht. **Wieder öffnen** mit Grund gibt sie frei (ohne zweite Person, die Captains bekommen keine Nachricht), danach neu
abschließen.

**2. Gleichstand auf Platz 1.** Stehen in der obersten Liga zwei Teams nach allen Kriterien gleich, gibt es keinen Meister
ohne Entscheid. **Meister entscheiden** → Reihenfolge mit den Pfeilen → **Wie wurde entschieden?** (Entscheidungsspiel, Los
oder Entscheid der Leitung) → **Grund** → **Festlegen**. Art und Grund stehen im Endstand und öffentlich an der Tabelle.
Recht: **Ergebnisse korrigieren**, nie über das eigene Team. In unteren Ligen bleibt ein geteilter Platz geteilt.
Meister wird das beste Team, das noch in der Wertung steht: Ein ausgetretenes oder disqualifiziertes Team wird es nie, auch
wenn es nach Punkten vorn steht. Wer den Meisterplatz im Reiter **Tabelle** entscheidet, muss die Art dort ebenfalls angeben.

**3. Staffel abschließen.** Der Knopf geht auf, sobald die Checkliste leer ist. Das Fenster nennt den Meister und fragt
nach: **Jetzt abschließen**. Danach gilt:

- Der **Endstand** steht fest: Plätze, Punkte, Maps, Entscheide und der Regelstand von jetzt. Website, TV und PDF zeigen ihn,
  auf der Ligaseite steht „Endstand · abgeschlossen am …“.
- Ergebnisse, „Rückgängig“, Kampflos-Wertungen, Vorfälle, Einsprüche und Verfahren, Tabellen-Entscheide, Austritt und
  Disqualifikation, Punktabzüge und der Stand der Staffel sind gesperrt. Jeder Versuch antwortet „Die Staffel ist abgeschlossen. Erst im Reiter ‚Abschluss‘
  wieder öffnen, dann korrigieren.“ Verwarnungen und Sperren bleiben möglich. Ändert ihr später Punkte oder Regeln der Season,
  bleibt der Endstand, wie er war. Auch neue Protest-Einstellungen und **Vorgaben auf Staffeln übertragen** lassen eine
  abgeschlossene Staffel unverändert.
- Der Meister bekommt einen Eintrag „Meister“ an Team und eingesetzten Spielern (Profil → Auszeichnungen).
- Captains und Vertreter bekommen eine Nachricht.
- Wer selbst in einem Team der Staffel spielt, schließt nicht ab – das macht eine andere Person.

**4. Korrigieren: Wieder öffnen.** Stimmt nach dem Abschluss etwas nicht, öffnet eine **zweite Person** die Staffel wieder –
nicht die, die abgeschlossen hat – mit einem **Grund** (Pflicht, steht im Verlauf und im Protokoll, nicht in der Nachricht an
die Captains). Danach korrigiert ihr das Ergebnis und schließt neu ab. Die alte Fassung bleibt im **Verlauf** sichtbar
(**Tabelle ansehen**), die neue bekommt die nächste Nummer. Der Meister-Eintrag ruht, solange die Staffel offen ist, und
wechselt beim neuen Abschluss mit, falls ein anderes Team Meister wird. Als Superadmin geht das Wiederöffnen der eigenen
Fassung nur als Notausnahme mit eigenem Grund.

**Auf- und Abstieg** ergeben sich aus dem Endstand nach den Zonen der Liga (3.11). Die abgeschlossene Season bleibt auf
der Ligaseite sichtbar; erst der Stand **Archiviert** blendet sie aus.

**5. Saisonfinale am TV.** Unter den Staffeln steht der Kasten **Saisonfinale am TV**. Nach dem Sieger-Moment zeigt
**Weiter** am Turnierbaum-TV jeder abgeschlossenen Staffel der Season die **Auf- und Absteiger je Liga N** – erst Liga 1, mit
jedem weiteren **Weiter** die nächste. **Ende** bringt das gewohnte Bild zurück (Tabelle bzw. Sieger). Der Kasten sagt, was der TV
gerade zeigt („Der TV zeigt Liga 2 (2 von 3)“). Recht: **Spiele betreuen** (Weiter und Ende bleiben hier, Nr. 233). Nur bei
öffentlichen Seasons; steigt niemand auf oder ab, gibt es nichts zu zeigen. Mehr in [TV & Beamer](tv.md). Die Saisonende-Meldung
im Discord steht unter 2.7g.

- **Zwei Fenster:** Hat sich der Stand inzwischen geändert (ein anderes Fenster hat geschaltet, jemand hat **Ende** gedrückt oder eine
  Staffel ist abgeschlossen), springt **Weiter** nicht eine Liga N weiter: Der Kasten lädt den aktuellen Stand und sagt „Der Stand
  hat sich geändert – neu geladen.“ Erst das nächste **Weiter** schaltet. Der Kasten lädt auch von selbst nach.
- **Ende gewinnt** (Nr. 244): Drücken zwei gleichzeitig **Ende** und **Weiter**, ist das Finale danach immer beendet.
- **Wieder öffnen:** Öffnest du eine Staffel wieder, verschwindet der Schritt von allen TVs der Season. Nach dem erneuten Abschluss
  kommt er erst mit dem nächsten **Weiter** – nie ein alter Stand.
- **Über Staffeln hinweg:** Steigt etwa der beste Zweite aus mehreren Staffeln auf (3.11), steht er am TV und im Discord mit.
- **Liga-Abzeichen** (#2561): Am TV steht das Wappen der Liga N im Titel vor „Liga N“ und in jeder Zeile vor der Ziel-Liga – Liga 1
  mit Krone, Liga 2 mit doppeltem Rand, ab Liga 3 schlicht, wie auf Profil und Teamseite. Im Discord steht stattdessen ein
  Zeichen je Stufe (siehe 2.7g).
- **Staffel schließt während des Finales ab** (Nr. 241): Ihr TV zeigt sofort dieselbe Liga N wie die anderen TVs, und die neue
  Liga N kommt in die Reihenfolge. Kein TV springt dabei auf eine andere Liga N.

<img src="../assets/liga/liga-season-tv-finale-pc.png" alt="Kasten Saisonfinale am TV im Reiter Abschluss: Der TV zeigt Liga 1 (1 von 3), Hinweis, dass ein anderes Fenster schon weitergeschaltet hat, Knöpfe Weiter und Ende" width="820">

### 3.10a Playoffs und Relegation

**Wo:** **Admin → Ligen → Season → Reiter Abschluss**, Abschnitt **Playoffs und Relegation**. Recht: **Season konfigurieren**;
lesen darf jede Zuständigkeit der Liga. Ohne Einstellung gibt es beides nicht: Meister wird der Erste der Tabelle, Relegationsplätze
sind nur farbig, alles ist wie bisher.

Playoffs und Relegation sind **eigene Staffeln** der Liga: ein K.-o.-Baum statt einer Tabelle. Sie entstehen aus dem **Endstand**
der regulären Staffeln und ändern ihn nie.

**1. Einstellen – vor dem Season-Start.** Knopf **Einstellen** öffnet die Vorlage der Season. Jede Liga kann abweichen
(**Abweichen** an der Liga) – ohne Haken gilt, was die Season vorgibt.

<img src="../assets/liga/playoffs-einstellungen-pc.png" alt="Fenster Playoffs und Relegation: Playoffs spielen mit vier Plätzen je Staffel, Best of 3, Heimrecht für den besser Gesetzten, Best of 5 für Runde 3, Relegation spielen, Meister aus den Playoffs" width="720">

| Einstellung | Was sie bewirkt | Vorgabe |
| --- | --- | --- |
| Playoffs spielen | die besten Teams jeder Staffel spielen nach der regulären Season einen K.-o.-Baum | aus |
| Plätze je Staffel | so viele Teams **jeder** Staffel kommen hinein (1 bis 16). Ausgeschiedene nie – der Nächste rückt nach | – |
| Best of | für alle Runden | wie in der Season |
| Best of je Runde | nur für Runden, die abweichen (Runde 1 ist die erste Runde des Baums). Das Spiel um Platz 3 folgt dem Finale | keine |
| Heimrecht und Team A im Veto | der besser Gesetzte in jeder Runde – oder Los je Spiel | besser Gesetzter |
| Spiel um Platz 3 | ohne das Spiel teilen sich beide Halbfinal-Verlierer Platz 3 | aus |
| Start der Playoffs | leer: die erste freie Woche nach der letzten regulären Spielwoche | automatisch |
| Relegation spielen | die Relegationsplätze unten gegen die Relegationsplätze oben der Liga darunter, je Paarung ein Spiel | aus |
| Start der Relegation | leer: automatisch. Sie liegt **immer hinter** den Playoffs beider Ligen – der eigenen und der Liga darunter. So hat kein Team zwei Spiele in einer Woche. Ein früheres Datum rückt von selbst dahinter | automatisch |
| Meister aus | Tabelle (Platz 1 jeder Staffel der obersten Liga) oder Playoffs (Sieger des Finales, Platz 1 heißt dann Staffelsieger) | Tabelle |
| Wiederöffnen nach dem Start der Playoffs | erlaubt mit Hinweis – oder gesperrt, sobald ein Playoff- oder Relegationsspiel gespielt ist | erlaubt |

- **Relegationsplätze** stellst du wie bisher bei den Zonen ein (Reiter **Ligen und Staffeln**: „Relegation unten“ in der oberen Liga,
  „Relegation oben“ in der Liga darunter). Die Zahl muss **aufgehen** – sonst sagt das Speichern, was nicht passt.
- **Fest ab dem Season-Start:** Best of (auch je Runde), Spiel um Platz 3 und Heimrecht der Playoffs stehen fest, sobald die
  Season wirklich läuft – der Beginn der ersten Spielwoche ist erreicht und eine Staffel ist live oder ein Spiel gewertet. Das
  Datum allein sperrt noch nichts. Die Felder sind dann ausgegraut, das Fenster sagt es. Wiederöffnen einer Staffel ändert daran nichts,
  Aus- und Wiedereinschalten auch nicht. Schaltest du die Playoffs erst nach dem Start ein, gelten die Werte vom Start – gab es
  keine, die Vorgaben (Best of der Season, kein Spiel um Platz 3, Heimrecht für den besser Gesetzten). Stell sie also **vor dem
  Start** ein.
- **Best of der Relegation:** Auch das steht ab dem Season-Start fest – das Feld ist dann ausgegraut.
- **Best of der Season nach dem Start ändern:** Steht bei Playoffs oder Relegation „Wie in der Season“ und änderst du nach dem
  Start das Best of der Season (oder das eigene Best of einer Liga), behalten beide den Wert vom Start – auch wenn sie gerade
  ausgeschaltet sind. In den Einstellungen heißt die Auswahl dann **Wie zum Season-Start (Best of 3)**. Beim Speichern sagt dir
  ein Hinweis, welche Liga welches Best of behält. Für die reguläre Season gilt der neue Wert, an den übrigen Einstellungen ändert
  sich nichts. Die nächste Season beginnt wieder mit „Wie in der Season“.
- **Einmal gestartet bleibt gestartet:** Die Season merkt sich ihren Start, sobald sie wirklich läuft – der Beginn ist erreicht
  und eine Staffel ist live oder ein Spiel gewertet. Verschiebst du den Beginn der ersten Spielwoche danach noch – auch in die
  Zukunft –, bleibt alles gesperrt, was ab dem Start gesperrt ist; auch Nachmeldefrist und die Abmeldefrist übernommener Teams
  zählen weiter vom ursprünglichen Start. Ein vertipptes Datum, solange noch nichts läuft, kannst du einfach korrigieren.
  Läuft die Season schon und du korrigierst den Beginn auf ein Datum, das bereits erreicht ist, gilt das korrigierte Datum als
  Start – auch für die Fristen.

  <img src="../assets/liga/playoffs-gesperrt-pc.png" alt="Fenster Playoffs und Relegation nach dem Season-Start: Hinweis Seit dem Season-Start stehen Best of, Spiel um Platz 3 und Heimrecht fest, die Felder Best of, Heimrecht, Spiel um Platz 3 und Best of je Runde sind ausgegraut" width="720">

- **Fest ab dem ersten Abschluss:** Sobald eine Staffel einer Liga abgeschlossen ist, lassen sich dort an/aus, die Plätze je Staffel
  und „Meister aus“ nicht mehr ändern. Spielt die Liga Playoffs oder Relegation, lässt sich dort dann auch keine weitere Staffel
  mehr anlegen – der Knopf **Staffel anlegen** im Reiter **Ligen und Staffeln** ist ausgegraut, darunter steht der Grund. Bei
  einer Relegation gilt das für beide Ligen des Paares, sobald eine von ihnen abgeschlossen hat. Zum
  Ändern erst alle Staffeln dieser Liga wieder öffnen. Termine bleiben bis zum Anlegen änderbar.
- **Zu wenige Teams:** Für Playoffs braucht es zwei Teams. Kommen in einer Liga mit den Plätzen je Staffel und ihren Staffeln weniger
  zusammen (ein Platz bei nur einer Staffel), sagt das Speichern das und an der Liga steht **Keine Playoffs**. Diese Liga spielt dann
  keine: Ihr Meister kommt aus der Tabelle, die Season wartet nicht darauf.

  <img src="../assets/liga/playoffs-zu-wenige-pc.png" alt="Karte Liga 1 mit dem Stand Keine Playoffs und dem Hinweis: Mit 1 Platz je Staffel und 1 Staffel kommen weniger als zwei Teams zusammen, der Meister kommt aus der Tabelle, die Season wartet nicht darauf" width="900">
- **Tabelle:** Während der Season tragen die Playoff-Plätze ein Zeichen am Teamnamen, die Legende darunter nennt es „Playoff-Platz“.
  Steht an der Grenze ein Gleichstand, braucht es vor dem Abschluss einen Entscheid – wie an einer Zonengrenze (Knopf
  **Playoff-Platz entscheiden**).

**2. Vorschau ansehen und anlegen.** Sind alle regulären Staffeln einer Liga abgeschlossen, zeigt die Karte die **Setzliste**, die
erste Runde als Paarungen (je Karte beide Teams mit ihrem Setzplatz), die Freilose und die Wochen. Vorher steht dort, was noch fehlt.

<img src="../assets/liga/playoffs-vorschau-pc.png" alt="Abschnitt Playoffs und Relegation am PC: Liga 1 bereit zum Anlegen mit Setzliste aus acht Teams, Paarungen der ersten Runde, Hinweis auf das Los, Wochen je Runde und darunter die Relegation gegen Liga 2 mit zwei Paarungen" width="900">

<img src="../assets/liga/playoffs-vorschau-handy.png" alt="Derselbe Abschnitt am Handy: Setzliste, erste Runde, Wochen und Relegation untereinander" width="300">

- **Gesetzt wird über Kreuz:** erst alle Ersten, dann alle Zweiten. Bei zwei Staffeln spielt A1 gegen B2 und B1 gegen A2. Welche
  Staffel vorn steht, entscheiden die Staffelsieger: mehr Punkte je Spiel, dann die bessere Map-Differenz je Spiel, zuletzt das Los.
  Ab drei Staffeln tauscht das System, bis in der ersten Runde niemand auf ein Team der eigenen Staffel trifft.
- **Das Los fällt erst beim Anlegen** – einmal, mit Protokoll. Die Vorschau lost nicht, sie nennt die gleich stehenden Teams.
- **Freilose** bekommen die Bestgesetzten, wenn die Zahl der Teams keine Zweierpotenz ist (6 Teams: Platz 1 und 2).
- **Playoffs anlegen** bzw. **Relegation anlegen** fragt einmal nach. Danach läuft die Staffel sofort, die Spiele stehen in ihren
  Wochen. Ein zweiter Klick legt nichts doppelt an.
- **Eigenes Team:** Wer zu einem Team der Liga gehört, legt nicht an – das macht eine andere Person. Der Superadmin kann es als
  Notausnahme mit Grund.
- **Die Relegation** lässt sich anlegen, sobald die regulären Staffeln **beider** Ligen abgeschlossen sind. Das Team der oberen Liga
  hat Heimrecht. Die Karte nennt die Woche und hinter wessen Playoffs sie liegt.

**3. Spielen.** Check-in, Veto, Melden, Proteste, Strafen und Fristen gelten wie in der Season. Je Runde eine Spielwoche; Sperrzeiten
zählen nicht mit.

<img src="../assets/liga/playoffs-stand-pc.png" alt="Abschnitt Playoffs und Relegation nach dem Anlegen: Playoffs angelegt mit sechs von sieben entschiedenen Spielen, Links Staffel verwalten und Baum ansehen, Setzliste und Wochen, Relegation angelegt" width="900">

- **Staffel verwalten** führt auf die Staffel-Seite. Der Reiter „Tabelle“ heißt dort **Baum**.
- **Veto:** In Playoffs gibt es keine „Vorgabe der Woche“. Für jedes vorkommende Best of schlägt das System eine eigene Vorlage vor.
  Passt eine nicht zum Map-Pool, steht der Hinweis schon in der Vorschau – also bevor du anlegst.
- **Kampflos:** Tritt ein Team nicht an, kommt der Gegner weiter – wie gewohnt über „kampflos werten“.
- **Beide nicht erschienen:** Beim ersten Mal wird **einmal neu angesetzt** – das Spiel wird nicht gewertet, du setzt den neuen
  Termin. Für beide Teams zählt es aber schon als **„nicht erschienen“** (Strafenkatalog, wie in der Season). War es ein Irrtum:
  **Neuansetzung zurücknehmen** am Spiel, mit Grund – dann fallen auch die beiden Einträge weg; ein schon gesetzter neuer Termin
  bleibt stehen. Kommt wieder niemand, scheiden
  **beide aus**: Der nächste Gegner kommt kampflos weiter, im Finale bleibt der Titel unvergeben, in der Relegation bleibt alles, wie
  es ist. Das Ausscheiden lässt sich nicht zurücknehmen.
- **Team zieht sich zurück:** Austritt wie gewohnt auf der Staffel-Seite (Teilnehmer). Der Gegner kommt kampflos weiter.
  Ist noch **kein Playoff-Spiel gespielt**, kannst du stattdessen **Setzliste neu berechnen** (mit Grund): Der Nächste derselben
  Staffel rückt nach und übernimmt den Platz, alle anderen Setzplätze bleiben. Wer einmal herausgefallen ist, bleibt draußen – auch
  wenn du später noch einmal neu berechnest.
- **Sperren für N Spiele** zählen jedes gewertete Pflichtspiel: Tabelle, Playoff und Relegation.
- **Zuteilen von Hand** gibt es hier nicht – die Teams kommen aus dem Endstand.

**4. Abschließen.** Die Playoff- und die Relegations-Staffel stehen im Reiter **Abschluss** neben den anderen Staffeln und werden
genauso abgeschlossen (Checkliste, Bestätigung, zweite Person beim Wiederöffnen). Statt einer Tabelle steht dort:

- **Playoffs:** die Plätze aus dem Baum – 1 Sieger, 2 Finalist, 3 geteilt für beide Halbfinal-Verlierer (mit Spiel um Platz 3: Platz 3
  und 4), dann je Runde geteilt (Platz 5 für die Viertelfinal-Verlierer). Sind in einem Spiel beide zweimal nicht erschienen und
  ausgeschieden, stehen sie **einen Platz hinter den Verlierern dieser Runde**, die gespielt haben: im Halbfinale auf Platz 4, im
  Viertelfinale auf Platz 6. Sie bleiben Teilnehmer der Playoffs.
- **Relegation:** je Team das Ergebnis und was daraus folgt – „steigt auf“, „steigt ab“ oder „bleibt“.
- **Meister:** Bei „Meister aus Playoffs“ entsteht der Meister-Eintrag beim Abschluss der Playoffs der obersten Liga. Es gibt nie
  zwei Meister. In unteren Ligen heißt der Sieger Playoff-Sieger.
- **Meister ohne Playoffs:** Spielt die oberste Liga keine Playoffs – weil von vornherein zu wenige Teams hineinkämen oder weil
  sich Teams zurückgezogen haben –, ist Meister das **beste verbliebene Team der Tabelle**. Der Eintrag entsteht, sobald die
  Season beendet ist. Ist kein Team mehr übrig, bleibt der Titel unvergeben. Unvergeben bleibt er sonst nur, wenn im Finale beide
  zweimal nicht erscheinen.
- **Die Season ist erst beendet**, wenn auch Playoffs und Relegation abgeschlossen sind. Solange etwas Eingestelltes noch nicht
  angelegt ist, steht es oben im Reiter und die Season läuft weiter. Auf eine Liga, in der keine zwei Playoff-Teams zusammenkommen,
  wartet sie nicht.

**5. Neue Season.** Playoffs ändern keine Liga – wer auf- und absteigt, sagen Tabelle und Relegation. Aus der abgeschlossenen
Relegation gilt automatisch: Gewinnt das Team der unteren Liga, steigt es auf und das der oberen ab; sonst bleiben beide. „Neue
Season aus …“ (3.11) geht erst, wenn die Relegation abgeschlossen ist. Korrigierst du sie später, hilft dort **Übernahme neu
berechnen**.

**Wiederöffnen einer regulären Staffel:** geht weiter nach den Regeln aus 3.10 (Grund, zweite Person). Laufen die Playoffs schon,
spielen sie mit ihrer Setzliste weiter; weicht die neue Setzliste ab, sagt die Karte das. **Setzliste neu berechnen** geht nur vor
dem ersten gespielten Spiel.

**Auf der Ligaseite** stehen Playoffs und Relegation unter den Tabellen ihrer Liga – nur bei einer sichtbaren Season. Die
**Playoffs** als Baum, die **Relegation** als Paarungen: je Karte das Team der oberen Liga (Heim) und das der unteren, mit Ergebnis.
Solange die Relegation läuft, steht dort, wer gewonnen hat. Was daraus folgt („steigt auf“, „steigt ab“, „bleibt“), steht erst
nach ihrem Abschluss da.

<img src="../assets/liga/playoffs-ligaseite-pc.png" alt="Ligaseite am PC: Abschnitt Playoffs mit K.-o.-Baum aus Viertelfinale, Halbfinale und Finale, daneben der Link Alle Spiele" width="900">

<img src="../assets/liga/playoffs-relegation-pc.png" alt="Ligaseite am PC: Abschnitt Relegation nach dem Abschluss mit zwei Paarungen, je Karte das Team aus Liga 1 mit Heimrecht und das Team aus Liga 2 mit Ergebnis; links steigt das Team aus Liga 2 auf und das aus Liga 1 ab, rechts bleiben beide in ihrer Liga" width="900">

**Noch nicht dabei:** eigene Belohnungen für die Playoffs, Zusatzpunkte in der Gesamtwertung, die Anlage im Regelwerk, Nachrichten
„für die Playoffs qualifiziert“, Doppel-K.-o. und Wildcards. Belohnungen und Gesamtwertung zählen weiter den Tabellenplatz.

### 3.11 Neue Season aus der Vorgänger-Season

**Wo:** Season-Seite oben → **Neue Season aus Season 1** (neben „Season löschen“). Recht: **Liga verwalten**. Geht erst, wenn
alle Staffeln abgeschlossen sind (3.10) – sonst sagt die Vorschau, was fehlt.

<img src="../assets/liga/f2-neue-season-1440.png" alt="Blatt Neue Season aus Season 1 am PC: Beginn und Name, Liste Übernommen als Entwurf mit Map-Pool, Sperrliste und Regelwerk, darunter je Liga die Teams mit Pfeil für Aufstieg, Abstieg oder bleibt und unten wer nicht dabei ist" width="720">

**1. Vorschau lesen.** Das Blatt zeigt, was übernommen wird, und je Liga die Teams der neuen Season:

- **Übernommen als Entwurf:** alle Einstellungen der Season (Spielbetrieb, Tabelle, Anmeldung und Kader, Termin-, Check-in- und
  Erinnerungsregeln, Fristen, Gestaltung und Gewinne, Belohnungen), die Ligen mit Beinamen, Abweichungen und Zonen, der Map-Pool und die
  Sperrliste in ihrer geltenden Version.
- **Regelwerk:** Hatte die Season ein eigenes, liegt es in der neuen Season als **Entwurf** einer neuen Fassung bereit – im
  Regelwerk freigeben, der Haken „Captains müssen dieser Fassung neu zustimmen“ ist vorbelegt. Gilt das der Liga, gilt es weiter.
- **Neu setzen:** Beginn, Sperrzeiten, Anmeldefenster und Meldeschluss, Transferfenster, Stichtag des Kaders.
- **Teams:** Pfeil hinauf = Aufstieg, hinunter = Abstieg, Strich = bleibt. Das ergibt sich ohne Bestätigung aus dem Endstand:
  oben die Aufsteiger, unten die Absteiger je Staffel. Ausgetretene und Disqualifizierte stehen hinten, belegen zuerst die
  Abstiegsplätze und sind **nicht dabei** (Liste unten). Ein Co-Team, das es nicht mehr gibt, fällt ebenfalls heraus.
- **Über den Vergleich der Staffeln:** Wer als bester Nächstplatzierter aufsteigt (2.3, 3.10), steht mit „Aufstieg als bester
  Nächstplatzierter“ da. Ist dort noch ein Gleichstand offen, nennt die Vorschau ihn, und Anlegen geht erst nach dem Entscheid.
- **Platzprüfung:** Unter jeder Liga steht, ob ihre Teams in die Staffeln passen, die es bisher gab. Auf- und Abstieg zählen je
  Staffel: Zwei Staffeln in Liga 2 mit je einem Aufsteiger schicken zwei Teams nach oben, aus der einen Staffel in Liga 1 kommt nur
  eines herunter. Passt es nicht, steht dort zum Beispiel „5 Co-Teams, höchstens 4 je Staffel: 2 Staffeln mit 3 und 2 Teams. Bisher
  gab es 1 Staffel – es fehlt 1.“, und über den Ligen der Hinweis **Platzprüfung**. Anlegen geht trotzdem: In der neuen Season
  legst du die fehlende Staffel an oder erhöhst „Teams je Staffel höchstens“, bevor du zuteilst oder auslost (2.5b).
- **Relegation** ist vorbereitet: Die Plätze stehen farbig in der Tabelle, die Teams bleiben vorerst in ihrer Liga.
- **Abweichen** geht nur über **Wieder öffnen** (3.10): Endstand korrigieren, neu abschließen. Gibt es die neue Season schon,
  sagt das Blatt „Wieder öffnen“ es deutlich – danach in der neuen Season oben **Übernahme neu berechnen** (siehe unten).

**2. Anlegen.** **Beginn der ersten Spielwoche** wählen, Name freiwillig (leer: „Season 2“) → **Season anlegen**. Die neue
Season ist ein **Entwurf** mit Sichtbarkeit **Aus**, bis ihr sie veröffentlicht. Ein zweiter Klick legt nichts doppelt an.
Sollen die Teams erst zusagen, setzt ihr hier den Haken **Startrechte mit Zusage** (3.11a) – ohne ihn sind sie automatisch dabei.

**3. Danach.** Die Teams stehen im Reiter **Anmeldung und Kader** im Eingang als **angenommen**, mit „Übernommen aus Season 1:
Liga 1 (Aufstieg aus Liga 2)“. Staffeln anlegen und zuteilen wie immer (2.3, 2.5) – die Auswahl zeigt nur die Staffeln der
neuen Liga des Teams. Captains und Vertreter bekommen eine Nachricht: „Ihr seid in Liga N der neuen Season, abmelden bis …“.
Wer sich bis zum Start abmeldet, gibt seinen Platz frei; über Warteliste und neue Anmeldungen entscheidet ihr wie in 2.5a.
Eine Staffel einer anderen Liga geht nur mit Grund – die Auswahl sagt „andere Liga, nur mit Grund“ und fragt danach.
Hat eine Liga mehrere Staffeln, verteilst du ihre Teams mit dem Los (2.5b).

<img src="../assets/liga/platzpruefung-1440.png" alt="Blatt Neue Season aus Season 1 am PC mit dem Hinweis Platzprüfung: Liga 1 bekommt fünf Teams für eine Staffel mit vier Plätzen und trägt eine Warnung, Liga 2 passt und trägt einen Haken" width="720">

**4. Korrektur nach dem Anlegen: Übernahme neu berechnen.** In der neuen Season oben (Recht **Liga verwalten**, nur vor dem Start):
Die Vorschau zeigt, welche Teams eine neue Liga bekommen, dazukommen oder zurückgenommen werden. Teams ohne Staffel folgen dem
korrigierten Endstand; schon zugeteilte oder abgemeldete bleiben und stehen unter **Bitte von Hand prüfen**. Gelöscht wird nichts,
Captains mit neuer Liga bekommen eine Nachricht. Ein zweiter Lauf ändert nichts mehr.
Der Vorgänger bleibt unverändert: Endstand, Spiele und Regeln der alten Season ändert nichts davon.

<img src="../assets/liga/f2-zonen-tabelle-390.png" alt="Staffel-Tabelle am Handy: Platz 1 mit grünem Strich, der Letzte mit orangem Strich, darunter die Legende Aufstieg und Abstieg" width="300">

**Zonen in der Tabelle:** Ein Strich links am Platz – grün für Aufstieg, orange für Abstieg, heller für Relegation – und
daneben ein Pfeil, damit die Zone auch ohne Farbe lesbar ist (#1648): ↑ Aufstieg, ↓ Abstieg, schräg für die Relegation. Darunter
die Legende mit denselben Pfeilen. Dasselbe am TV; im Ergebnis-PDF steht die Zone als Wort hinter dem Namen („Relegation um den
Aufstieg“ bzw. „gegen den Abstieg“). Vor dem ersten Ergebnis
gibt es keine Zonen. Stehen zwei Teams an einer Zonengrenze in allem gleich, verlangt der Abschluss **Platz entscheiden** (3.10).

**Season-Historie:** Team- und Spielerprofil zeigen unter **Seasons** je abgeschlossene Staffel Liga, Platz, Meister und Auf-
oder Abstieg – aus dem Endstand, nur für Seasons, die die Person sehen darf. Im **Spielerprofil** gilt dieselbe Regel wie für
vereinsinterne Turniere (#2521, [Turniere](turniere.md) 3.10): Eine Season „Nur Mitglieder“ sehen dort die Person selbst und
angemeldete Vereinsmitglieder, solange die Person „Vereinsinterne Erfolge zeigen“ anlässt, mit dem Etikett **Vereinsintern**;
eine Season „Nur Liga-Leitung“ oder „Aus“ nur die Person selbst – Liga-Rechte zählen im Profil nicht, auch Liga-Leitung und
Admins sehen sie dort nicht (in der Liga-Verwaltung weiter alles). Gäste und Nicht-Mitglieder sehen nur öffentliche Seasons. Für
die Gesamtwertung im Spielerprofil gilt das ebenso; zählt eine solche Season mit, trägt der Platz das Etikett. Eine eigene Season,
deren Seite die Person nicht öffnen darf, steht ohne Link da.

**Liga-Abzeichen (#1638):** Überall, wo eine Liga N steht, zeigt ein Wappen mit ihrer Zahl die Stufe: **Liga 1** trägt eine Krone,
einen doppelten Rand und einen zarten Glanz, **Liga 2** den doppelten Rand, ab **Liga 3** nur die Kontur. Die Farbe ist Cyan; **Gold**
tragen nur Wappen und das Wort „Meister“ beim Co-Team, das die Season gewonnen hat (Season-Historie); der Beiname bleibt Cyan. Der Beiname der Liga N (2.3, z. B. „Elite“)
steht als Text daneben: „Liga 1 · Elite“. Zu sehen im Kopf jeder Liga N auf der Ligaseite, in **Aktuelle Ligen**, auf der Teamseite
(Abschnitt *Liga*), in der Season-Historie und in der Gesamtwertung. Beim ersten Erscheinen setzt sich die Krone einmal auf und der
Glanz läuft einmal darüber; mit „Bewegung reduzieren“ steht alles still.

<img src="../assets/liga/liga-abzeichen-stufen.png" alt="Liga-Abzeichen in drei Größen: Liga 1 mit Krone, Liga 2 mit doppeltem Rand, Liga 3 schlicht, dazu zwei goldene Meister-Abzeichen und ein langer Beiname" width="720">

**Aktuelle Ligen (#1630):** Das Spielerprofil zeigt je Co-Team, in dessen Kader die Person steht oder das sie als Captain bzw.
Vertreter führt, die laufende Staffel (wer ein Co-Team nur angemeldet hat, sieht es dort nicht): Liga N mit
Abzeichen, Staffel, **Platz von N**, Zone (Auf- oder Abstieg, Relegation) und das **nächste Spiel** mit Gegner und Termin (ohne
Termin der Spieltag). Plätze gibt es ab dem ersten gewerteten Spiel der Staffel – vorher steht „Noch ohne Ergebnis“, auf der
Warteliste bzw. vor der Zulassung „Warteliste“ bzw. „Anmeldung offen“. Verbirgt die Staffel ihre Teilnehmerliste, gibt es eine solche
Anmeldung für Außenstehende gar nicht – wie in der Teilnehmerliste; sehen können sie nur die Person selbst bzw. auf der Teamseite das
Team und der Staff. Ein Co-Team, das sich zurückgezogen hat, steht hier nicht. Lange
Namen brechen um und werden nie mit „…“ gekürzt. Die beste Liga N steht oben. Sichtbar nach derselben Regel wie die Season-Historie: Gäste und Nicht-Mitglieder nur öffentliche Seasons, Mitglieder
bei eingeschaltetem „Vereinsinterne Erfolge zeigen“ auch Seasons „Nur Mitglieder“ mit dem Etikett **Vereinsintern**, die Person
selbst alles. Ein **privates Team** und seine Co-Teams stehen in „Aktuelle Ligen“ und in der Season-Historie nur für die Person
selbst; die Teamseite eines privaten Teams öffnen das Team und der Staff des Vereins (dort gelten die Rechte des Teams). Die Teamseite zeigt im Abschnitt *Liga* dieselben Karten für alle Co-Teams des Teams, beste Liga N oben.

<img src="../assets/liga/profil-aktuelle-ligen-390.png" alt="Spielerprofil am Handy: Aktuelle Ligen mit drei Co-Teams in Liga 1, 2 und 3, Platz, Aufstieg und nächstem Spiel, darunter der Saisonverlauf als Linie mit einem grauen Punkt „ausgetreten“ in Season 4" width="300">

**Saisonverlauf:** Ab zwei abgeschlossenen Seasons zeigen Spielerprofil und Teamseite eine Linie: je Season ein Punkt, Liga N als
Band, der Platz am Punkt, der Meister in Gold. Ein Aufstieg hebt die Linie, auch wenn der Platz in der höheren Liga N schlechter ist.
Auf der Teamseite hat jedes Co-Team eine eigene Linie mit Legende – höchstens vier, die besten zuerst: Co-Teams, die gerade in einer
laufenden Staffel spielen, vor den übrigen, dann nach der Liga N und dem Platz der letzten Season; gibt es mehr, steht darunter
„und N weitere Co-Teams“. Hat sich ein Co-Team in einer Season **zurückgezogen**, steht die Season trotzdem auf der Achse: ein grauer
Punkt „ausgetreten“ (bzw. „disqualifiziert“) ohne Platz, mit dem Rand in der Farbe seiner Linie, die Linie ist dort unterbrochen; ziehen
sich zwei Co-Teams in derselben Season zurück, stehen ihre Punkte nebeneinander. Platz-Zahlen stehen nie auf dem Punkt einer anderen
Linie – ist kein Platz frei, fehlt die Zahl im Bild, Screenreader lesen sie trotzdem vor. Season-Namen werden nie gekürzt – ein
langer Name steht in zwei Zeilen („Herbst“ / „2026/27“), die Seasons rücken so weit auseinander, wie der längste Name braucht; den
vollen Namen zeigt auch der Hinweis beim Darüberfahren. Reicht die Breite nicht (viele Seasons, Handy), wischt man die Linie seitlich.

<img src="../assets/liga/teamseite-liga-1440.png" alt="Teamseite am PC: Abschnitt Liga mit drei Co-Teams nach Liga N sortiert, darunter der Saisonverlauf mit einer Linie je Co-Team" width="720">

### 3.11a Startrechte: Zusage, Frist und Nachrücker

Ohne weitere Einstellung sind die Teams der alten Season in der neuen **automatisch dabei** (3.11). Wollt ihr vorher wissen, wer
wirklich mitspielt, schaltet ihr **Startrechte** ein: Dann bekommt jedes Co-Team ein Startrecht für seine Liga und **sagt innerhalb
einer Frist zu**. Wer nicht zusagt, gibt den Platz frei – und nach eurer Regel rückt jemand nach.

**Was ein Startrecht ist – und was nicht.** Es hält dem Co-Team einen Platz in seiner Liga frei. Es ist **keine Zuteilung** zu einer
Staffel, **keine Zustimmung zum Regelwerk** (die holt das Regelwerk vor dem ersten Spiel nach, 2.11), keine Rechnung und keine
Pflicht mitzuspielen.

**Die Zustände – jeder heißt anders, damit nichts verwechselt wird:**

| Zustand | Bedeutung | Wer sieht es |
| --- | --- | --- |
| **Prognose** | Stand der laufenden Tabelle („Aufstiegsplatz“). Nur Anzeige, nichts ist fest | wie bisher an jeder Tabelle; das eigene Team unter Teams mit dem Wort „Prognose“ |
| **Startrecht bestätigt** | Der Endstand der ganzen Season steht – samt Playoffs und Relegation (3.10, 3.10a) | Leitung, eigenes Team, dazu die Nachricht unten |
| **Zusage offen** | Die neue Season ist angelegt, die Frist läuft | Leitung, eigenes Team |
| **Zugesagt** | Das Team hat zugesagt (oder ihr habt die Zusage eingetragen) | Leitung, eigenes Team |
| **Abgemeldet**, **Verfallen**, **Zurückgenommen** | abgesagt, Frist ohne Zusage vorbei, nach korrigiertem Endstand nicht mehr dabei | Leitung, eigenes Team |
| **Spielt mit** | einer Staffel zugeteilt – erst das ist die Teilnahme | wie jede Teilnahme |

Öffentlich ändert sich nichts: Wer auf- und absteigt, steht wie bisher im Endstand. Wer zugesagt hat, sehen nur ihr und das eigene Team.

**1. Einschalten.** Am einfachsten im Blatt **Neue Season aus …** (3.11): Haken **Startrechte mit Zusage**, dazu die **Frist in
Tagen** und was geschieht, **wenn ein Platz frei wird**. Oder vorher und nachher in der Season: Reiter **Anmeldung und Kader** →
**Startrechte** (`#startrechte`), Recht **Season konfigurieren**. Die nächste Season übernimmt die Einstellung als Vorgabe.

| Einstellung | Vorgabe | Bedeutung |
| --- | --- | --- |
| **So bekommen die Teams ihren Platz** | mit Zusage innerhalb der Frist | „Automatisch dabei“ ist das Verhalten aus 3.11 |
| **Frist für die Zusage (Tage)** | 14 | zählt ab dem Anlegen der Season, für Nachrücker ab dem Nachrücken – und endet spätestens mit dem Startdatum der Season. Eine geänderte Zahl gilt sofort für alle offenen Startrechte |
| **Wird ein Platz frei** | automatisch nach der Regel | oder: „Die Leitung löst es aus“ – dann seht ihr den Vorschlag und drückt selbst |
| **Erinnerung vor Fristende (Stunden)** | 48 | einmal an Captain und Vertreter; 0 = keine. Nie in der ersten Hälfte der Frist: Bei einem Tag Frist kommt sie zwölf Stunden vorher, nicht sofort. Fällt ein Nachrücker zurück, kommt sie nicht zusammen mit der Nachricht dazu – die nennt den Tag schon |
| **Restfrist nach einem Nachrück-Angebot (Tage)** | 3 | siehe „Nachrücken“: so viele Tage hat ein Team mindestens für seine eigene Zusage, wenn es ein Nachrück-Angebot verstreichen lässt |
| **Nachricht „Aufstieg bestätigt“** | an | siehe unten |

<img src="../assets/liga/startrechte-verwaltung-1440.png" alt="Abschnitt Startrechte am PC: oben die Einstellung mit Frist in Tagen, Nachrückerregel und Erinnerung, darunter die Übersicht Startrechte aus Season 1 mit der Zeile 3 Zusage offen, 2 zugesagt, 1 spielen mit, 1 verfallen, einem frei gewordenen Platz mit Vorschlag und Knopf Nachrücken lassen und je Liga die Co-Teams mit Stand, Frist und Knopf Zusage eintragen" width="720">

**2. Die Übersicht lesen.** In der neuen Season zeigt derselbe Abschnitt **Startrechte aus Season 1**: je Liga jedes Co-Team mit
Stand und **Zusage bis …**. Die Zeile darüber zählt („3 Zusage offen · 2 zugesagt · 1 verfallen“). Im **Eingang** steht derselbe
Stand am Antrag.

**3. Zuteilen und Los warten auf die Zusage.** Ein Co-Team mit offener Zusage lässt sich nicht zuteilen („… hat das Startrecht noch
nicht angenommen …“), und im Los (2.5b) steht es als Hinweis daneben. Hat euch das Team auf anderem Weg zugesagt, drückt ihr
**Zusage eintragen** und gebt einen **Grund** an (mindestens fünf Zeichen, etwa „Zusage per Nachricht am 03.12.“) – er steht im
Verlauf, das Team bekommt eine Nachricht. Für das **eigene Team** entscheidet eine andere Person. Der Sonderweg „Co-Team zuteilen“
auf der Staffel-Seite gilt ebenfalls als Zusage durch die Leitung.

**4. Frist vorbei.** Alle 15 Minuten prüft die Website die Fristen: Ohne Zusage ist das Startrecht **verfallen**, der Platz frei,
Captain und Vertreter bekommen eine Nachricht. Mitspielen geht dann nur noch über eine **neue Anmeldung** im Anmeldefenster (2.5a) –
wie für jedes neue Co-Team. Zusagen nach Fristende lehnt die Seite sofort ab, auch wenn der Prüflauf noch nicht dran war. Sagt
niemand zu, verfallen alle Startrechte – dann rückt auch niemand nach.

**Ab dem Startdatum entscheidet ihr.** Ist das Startdatum der neuen Season erreicht – auch wenn sie noch Entwurf ist –, verfällt
nichts mehr von selbst, und niemand rückt mehr automatisch nach. Offene Startrechte stehen mit „Frist vorbei – jetzt entscheidest
du“ da: **Zusage eintragen** (geht dann auch nach Fristende) oder im Eingang ablehnen. Das Team selbst kann nicht mehr zusagen.

**Warteliste.** Setzt ihr ein Co-Team mit offener Zusage im Eingang auf die Warteliste, verfällt dort nichts. Nehmt ihr es wieder
an, beginnt die Frist neu; gleich mit Staffel annehmen geht erst nach der Zusage.

**5. Nachrücken.** Wird ein Platz frei (abgemeldet, verfallen, von euch abgelehnt), gilt diese Regel – nur, solange das Startdatum der Season nicht erreicht ist:

- War es ein **Aufsteiger**, rückt **der beste Nicht-Aufsteiger** der Liga darunter nach. Gibt es dort niemanden, bleibt der beste
  Absteiger.
- Sonst (das Team wäre geblieben oder kam von oben) bleibt **der beste Absteiger** dieser Liga. Gibt es keinen, rückt der beste
  Nicht-Aufsteiger von unten nach.
- Bei mehreren Staffeln zählt je Staffel das bestplatzierte Co-Team, dazwischen **Punkte je Spiel**, dann **Map-Differenz je Spiel**
  (wie beim „besten Zweiten“, 2.3). Stehen sie gleich, rückt niemand von selbst nach: **Ein Los gibt es nicht**, ihr wählt mit Grund.
- Dasselbe gilt **in einer Staffel**: Teilen sich mehrere den Platz (punkt- und differenzgleich, etwa dreimal Platz 2), wählt ihr.
- **Nur wer rechtzeitig ist:** Nachrücken kann nur ein Co-Team, das zugesagt hat oder dessen eigene Frist noch läuft. Wer seine
  Frist verpasst hat, rückt nie nach. Nimmt ein Team den Nachrückplatz an, gilt das zugleich als seine Zusage.
- **Keine Kette:** Der Platz, den der Nachrücker verlässt, wird nicht automatisch weitergegeben – er ist frei für Warteliste und
  neue Anmeldungen.

Der Nachrücker bekommt eine Nachricht und – im Modus „mit Zusage“ – eine **eigene Frist** für das Angebot. Solange das Angebot offen
ist, **ruht seine Frist für die eigene Liga**. Er hat drei Möglichkeiten:

- **Zusagen:** Er spielt in der höheren Liga – das ist zugleich seine Zusage.
- **Nachrücken ablehnen:** Er bleibt in seiner Liga, und das **gilt als Zusage** für sie. Der Nächste ist dran.
- **Nicht antworten:** Er bleibt in seiner Liga. Hatte er dort schon zugesagt, gilt das weiter. War seine Zusage noch offen, hat er
  dafür die restliche Frist, **mindestens 3 Tage** (einstellbar), aber nie über das Startdatum hinaus – die Nachricht nennt den Tag.

Niemand verliert also sein eigenes Startrecht, nur weil er ein Angebot für die höhere Liga bekommen hat. Mit „Die Leitung löst es
aus“ steht der freie Platz orange über der Übersicht: **Nachrücken lassen** → Team wählen, Grund angeben. Meldet sich ein
Nachrücker ab, lehnt ihr ihn im Eingang ab oder nimmt „Übernahme neu berechnen“ ihn zurück (etwa nach einer Disqualifikation), ist
der Platz, auf den er nachgerückt war, wieder frei – dann gilt wieder diese Regel.

**Einen Platz gibt es nur, solange der Endstand ihn kennt.** Korrigiert ihr den Endstand so, dass das abgemeldete Team gar nicht mehr
aufgestiegen wäre (ein anderes steigt jetzt aus eigenem Recht auf), **entfällt dieser Aufstiegsplatz**: Niemand rückt dafür nach, und ein
Nachrücker, der schon darauf stand, geht mit „Übernahme neu berechnen“ zurück in seine Liga. Seine frühere Zusage gilt dann wieder;
war sie noch offen, hat er dafür die restliche Frist, mindestens 3 Tage (einstellbar). Die Nachricht an ihn nennt den Grund. So
steigen nie zwei Teams für einen Platz auf.

Umgekehrt bleibt ein Platz, solange er im Endstand steht: **Löscht ein abgemeldetes Team sein Co-Team**, ist sein Platz trotzdem frei
für den Nachrücker.

**Ein Team, das nicht mitspielt, folgt seiner neuen Platzierung.** Sieht der korrigierte Endstand ein abgemeldetes, verfallenes
oder von euch abgelehntes Team in einer anderen Liga (es wäre aufgestiegen, geblieben oder abgestiegen), zeigt „Übernahme neu
berechnen“ es als **Platz frei**: Das Team bleibt, was es ist – es bekommt kein neues Angebot und keine Nachricht –, und sein Platz
in der neuen Liga geht nach eurer Regel an den Nächsten. Drückt ihr vor dem Neuberechnen **Nachrücken lassen**, sagt die Seite,
dass erst neu berechnet werden muss.

**6. Nachricht „Aufstieg bestätigt“.** Sobald der Endstand der **ganzen** Season feststeht, bekommen Captain und Vertreter jedes
auf- oder absteigenden Co-Teams genau eine Nachricht (Glocke, App, Mail). Nie vorher, nie aus einer laufenden Tabelle, und nicht
für Teams, die bleiben. Öffnet ihr eine Staffel wieder und schließt sie mit demselben Ergebnis ab, kommt nichts noch einmal; ändert
sich das Ergebnis, kommt einmal „Endstand korrigiert“. Die Nachricht „Staffel abgeschlossen“ und die Saisonende-Meldung im Discord
(2.7g) bleiben, wie sie sind.

**7. Endstand nachträglich korrigiert.** Ist die alte Season wieder geöffnet (oder ein Entscheid zum „besten Zweiten“
zurückgenommen), sagt die Übersicht das. Solange **stehen die Fristen still**: Nichts verfällt, niemand rückt nach, niemand wird
erinnert – zusagen können die Teams trotzdem. Nach dem neuen Abschluss laufen die Fristen weiter und sind **um die Dauer der Pause
länger** – auch die Restfrist eines Nachrückers, der gerade zurückgefallen ist. Dann oben **Übernahme neu berechnen** (3.11): Wer dadurch die Liga wechselt, sagt neu zu (neue Frist); wer bleibt, behält
seine Zusage. Ändert ihr nach dem letzten Abschluss den Entscheid zum „besten Zweiten“, bekommt das bisher gewählte Team „Endstand
korrigiert“ und das neue „Aufstieg bestätigt“.

**Umschalten.** Stellt ihr später auf „automatisch dabei“ oder schaltet die Startrechte aus, gelten alle offenen Startrechte als
zugesagt – niemand verliert seinen Platz durch das Umschalten. Vorher fragt die Seite nach und nennt die Zahl („3 offene
Startrechte gelten dann als zugesagt …“); ohne euer **Ja** ändert sich nichts.

### 3.12 Belohnungen

**Wo:** **Admin → Ligen → Season → Reiter Belohnungen**. Ändern darf, wer **Season konfigurieren** hat; alle anderen
Zuständigen sehen den Reiter nur zum Lesen.

<img src="../assets/liga/f4-belohnungen-verwaltung-1440.png" alt="Reiter Belohnungen am PC: Spieler-Belohnungen an Spieler mit Einsatz, fünf Belohnungen mit Vorschau der Grafik (Gold-, Silber-, Bronzemedaille, Season-Banner für alle, Titel für Platz 4 bis 6), darunter Liga 1 wie die Season mit dem Stand der Vergabe je Staffel und Liga 2 mit eigenem Emblem" width="720">

**1. Zusammenstellen.** **Belohnung hinzufügen** legt eine Zeile an:

| Feld | Bedeutung |
| --- | --- |
| Art | **Medaille**, **Banner**, **Emblem** oder **Titel**. Links steht die Vorschau der Lionsquad-Vorlage – Gold, Silber und Bronze für Platz 1 bis 3, sonst Lionsquad-Blau. Beschriftet wird sie beim Vergeben mit Season, Liga und Platz. |
| Für wen | ein **Platz**, ein **Platzbereich** (etwa 4–6) oder **Alle Teilnehmer**. Ausgetretene und disqualifizierte Teams bekommen nichts. |
| Bekommt | **Team** (steht an der Teamseite) und/oder **Spieler** (steht in deren Profil). |
| Echter Gewinn | freiwillig, etwa „Gutschein“. Er landet beim Abschluss unter **Gewinne** zur Abholung, wie bei Turnieren. |
| Eigenes Bild | freiwillig über **Bild hochladen** oder die Mediathek; sonst gilt die Vorlage. |

**Spieler-Belohnungen gehen an** gilt für die ganze Season: **Spieler mit Einsatz** (Vorgabe – wer in der Staffel mindestens
ein gespieltes Spiel in der Aufstellung stand; kampflose Spiele zählen nicht) oder **Ganzer Kader zum Abschluss**. Hat ein Team
in keinem gespielten Spiel eine Aufstellung gemeldet (oder nur kampflose Spiele), bekommt sein **Kader zum Abschluss** die
Spieler-Belohnung – wie beim Meister-Eintrag. Die Reiter **Belohnungen** und **Abschluss** nennen diese Teams: „Kader statt
Einsatz, weil keine Aufstellungen gemeldet“. In einer Einzel-Liga bekommt die Person eine Spieler-Belohnung nur, wenn sie
gespielt hat (mit „Ganzer Kader“ immer); eine Team-Belohnung bekommt sie als Teilnehmerin auch ohne Spiel.

**2. Liga N.** Jede Liga übernimmt die Belohnungen der Season. **Eigene Zusammenstellung** kopiert sie für diese Liga zum
Anpassen (auch „keine“ ist möglich), **Wie die Season** nimmt die Abweichung zurück. Unter jeder Liga steht je Staffel, was
vergeben ist.

**3. Vergabe.** Vergeben wird beim **Abschluss** einer Staffel (3.10) aus dem Endstand – sofort. Wer etwas bekommt, sieht es
im Profil bzw. an der Teamseite, bekommt eine Nachricht und beim nächsten Besuch eine kurze Zeremonie mit **Bild
herunterladen** zum Teilen. Die Ligaseite zeigt das Podest mit den Belohnungen je Platz, das Ergebnis-PDF einen Abschnitt
**Belohnungen**, der Turnierbaum-TV beim Sieger-Moment das Podest mit der Hauptbelohnung je Platz ([TV & Beamer](tv.md)). Eine Änderung im Reiter wirkt erst beim nächsten Abschluss.

**4. Wieder öffnen.** Solange eine Staffel wieder offen ist, ruhen ihre Belohnungen (unsichtbar). Beim neuen Abschluss wird
neu zugeteilt – nie doppelt. Wer dabei etwas verliert oder neu bekommt, erhält eine Nachricht; Captain und Vertreter bekommen
für Team-Belohnungen eine eigene Nachricht („Belohnung für euer Team“). Ein echter Gewinn wird nie entzogen: Fällt er weg,
bekommt er unter **Gewinne** „nach Korrektur prüfen“; landet dieselbe Belohnung auf einem anderen Platz, zieht der Platz mit,
solange der Gewinn nicht abgeholt ist.

**Sichtbarkeit:** Öffentlich steht eine Belohnung nur, wenn Gäste die Season und die Staffel sehen dürfen.

### 3.13 Gesamtwertung über Seasons

**Wo:** **Admin → Ligen → Gesamtwertung** (Knopf an der Liga). Lesen darf jede Zuständigkeit, ändern, abschließen und wieder
öffnen, wer **Season konfigurieren** hat. Vier Reiter:

<img src="../assets/liga/f5-verwaltung-1440.png" alt="Gesamtwertung verwalten am PC: Reiter Einstellungen mit Punkten nach Teamzahl, Zusatzpunkten für Platz 1, nur die besten zwei Seasons und der Reihenfolge bei Gleichstand" width="720">

**1. Einstellungen.** **Punkte je Season-Platz**: **Nach Teamzahl** (Vorgabe – Platz 1 bekommt so viele Punkte, wie seine Staffel
Teams in der Wertung hat, der Letzte 1; hat eine Liga mehrere Staffeln, zählt jede für sich) oder **Eigene Punkte je Platz**.
**Zusatzpunkte für Platz 1 der Staffel** (Vorgabe 2): in der obersten Liga der Meister, sonst der Staffelsieger. Ausgetretene und
Disqualifizierte bekommen 0, ein geteilter Platz dieselben Punkte. **Welche Seasons zählen**: alle oder **nur die besten X** – die
übrigen stehen durchgestrichen als Streichergebnis da. **Gleichstand**: Reihenfolge aus Staffelsiegen, bester Platzierung und
jüngster Season; steht Platz 1 danach noch gleich, entscheidest du im Reiter **Abschluss**.

**2. Zeiträume.** Ein Zeitraum (etwa „2027“ oder „Seasons 1–4“) fasst Seasons zu einer Gesamtwertung zusammen. Eine Season gehört zu
höchstens einem Zeitraum. Ohne Zeitraum zeigt die Ligaseite keine Gesamtwertung.

**3. Abschluss.** Je Liga eine Karte mit der Vorschau (Co-Teams und Spieler), dem, was noch fehlt (eine Staffel einer Season ist nicht
abgeschlossen, Gleichstand auf Platz 1), und dem Verlauf. **Entscheiden** legt bei Gleichstand die Reihenfolge fest – mit Art
(Entscheidungsspiel, Los, Leitung) und Grund. **Gesamtwertung abschließen** hält den Stand fest und vergibt die Belohnungen.
**Wieder öffnen** macht eine zweite Person, mit Grund; die Belohnungen ruhen bis zum neuen Abschluss. Wer zu einem Co-Team der
Wertung gehört, schließt nicht ab.

**4. Belohnungen.** Wie bei der Season (3.12): Medaille, Banner, Emblem oder Titel je Platz, Bereich oder für alle – etwa
„Gesamtsieger 2027“ für Platz 1. Spieler-Belohnungen gehen an die Spieler, die für das Co-Team Punkte geholt haben (oder an den
ganzen Kader).

**Was zählt:** nur der feste Endstand jeder Season (3.10). Öffnest du eine Staffel wieder, fehlt sie in der laufenden Wertung,
bis sie neu abgeschlossen ist. Steigt ein Team auf oder ab, zählen seine Punkte in der Liga, in der es die Season gespielt hat.
**Spielerwertung:** Ein Spieler bekommt je Season die Punkte seines Co-Teams, wenn er mindestens ein gespieltes Spiel in der
Aufstellung stand (ohne gemeldete Aufstellung zählt der Kader); wechselt er das Team, zählt je Season das jeweilige.
**Sichtbarkeit:** Seasons mit Sichtbarkeit „Aus“ zählen auf der Ligaseite nicht mit – in der Verwaltung schon. Die Ligaseite zeigt
die Wertung unter **Gesamtwertung** (mit PDF), Profil und Teamseite den Platz.

<img src="../assets/liga/f5-gesamtwertung-390.png" alt="Gesamtwertung auf der Ligaseite am Handy: Liga 1 mit Co-Teams, Platz und Summe, Aufklappen je Zeile für die Punkte je Season" width="320">

---

## 4. Wenn etwas nicht klappt

| Meldung / Fehlerbild | Bedeutung | Was tun |
| --- | --- | --- |
| „Mit bis zu 9 Teams (nur Hinrunde) braucht die Staffel 9 Spielwochen, die Season hat aber nur 8 aktive Wochen …“ | Die Staffel ist zu groß für die Spielwochen | **Teams je Staffel höchstens** senken und eine zweite Staffel anlegen – oder mehr Wochen |
| „Staffel A gibt es in dieser Liga schon.“ | Buchstabe vergeben | **Staffel anlegen** nimmt von selbst den nächsten freien |
| „In dieser Liga ist schon eine Staffel abgeschlossen. Eine weitere Staffel anlegen geht dann nicht mehr …“ | Die Liga spielt Playoffs oder Relegation – beides rechnet mit den Staffeln, die es beim Abschluss gab | Erst alle abgeschlossenen Staffeln dieser Liga im Reiter **Abschluss** wieder öffnen (3.10) |
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
| „Diese Season ist nur für PC – angegeben ist PlayStation.“ (oder „Liga 2 ist nur für …“) | Spieler auf einer nicht erlaubten Plattform | Andere Spieler aufstellen; stimmt die Angabe nicht, ändert sie die Person im Profil (festgehalten: Freigabe wie bei der Spiel-ID, 3.7) |
| „… Nur 2 Spieler sind auf einer erlaubten Plattform …“ beim Zuteilen | Ohne Spieler anderer Plattformen fehlt der Mindestkader | Kader ergänzen oder Co-Team in eine Liga mit passender Plattform |
| „Bitte zuerst das Feld wählen, in dem die Plattform steht …“ / „Eigene Plattformen einer Liga N brauchen bei der Season das Feld …“ | Plattformen ohne Feld eingegrenzt | Im Kasten **Plattform und Eingabegerät** das Feld wählen (2.7c) |
| „Dieses Feld gibt es am Spiel nicht, oder es hat keine Auswahl.“ | Feld ohne Auswahlwerte | Am Spiel unter **Spiel-IDs** Auswahlwerte eintragen |
| „Alle Startplätze sind vergeben.“ beim Annehmen | Plätze voll, auch über 2.5 Zugeteilte zählen | Warteliste, oder **Startplätze** an der Season erhöhen |
| „Eine Liga-Staffel hat keine Anmeldung – Co-Teams teilt die Turnierleitung zu.“ | Zugangslink mit Anmelderecht für eine Staffel | Link nur zum Ansehen anlegen, Co-Team zuteilen |
| „Der Spielplan dieser Staffel steht – zurücksetzen oder neu aufbauen geht nur vor dem Start …“ | Spielplan oder Phase einer gestarteten Staffel neu aufbauen oder löschen | Einzelne Spiele im Reiter **Spiele** korrigieren |
| „Diese Staffel hat schon begonnen oder Spiele – Löschen geht nur vor dem Start …“ | Gestartete Staffel löschen | Status **Abgesagt** oder **Archiviert** |
| „Löschen geht nicht: … hat schon Co-Teams zugeteilt / hat schon begonnen oder Spiele / ist kein Entwurf mehr. Archivieren statt löschen …“ | Liga, Season oder Liga N hängt schon etwas an | Im Blatt **Archivieren** (2.9) |
| „Bitte einen Grund angeben (mindestens 5 Zeichen) …“ | Löschen ohne Grund | Grund eintragen |
| „Das Spiel bleibt, sobald eine Season eine Staffel hat …“ | Spiel einer Liga mit Staffel ändern | Neue Liga anlegen, die alte archivieren |
| „Die Adresse bleibt, seit eine Season der Liga sichtbar war …“ | Adresse nach der Veröffentlichung ändern | Adresse lassen; nur der Name ändert sich || „Ein zugeteiltes Co-Team nimmt nur die Turnierleitung wieder aus der Staffel …“ | Teamleitung will ihr Co-Team abmelden | Bei der Turnierleitung melden |
| Ligaseite zeigt „Liga nicht gefunden“ | Sichtbarkeit *Aus* oder *Nur Liga-Leitung* | Sichtbarkeit der Season ändern und speichern |
| „Dafür fehlt dir das Recht in dieser Liga …“ | Bereich Turnierleitung allein oder falsche Zuständigkeit | Superadmin vergibt den Bereich Ligen, der Bereich Ligen die Zuständigkeit – [2.0](#20-bereich-ligen-und-zuständige) |
| „Du bist an diesem Spiel selbst beteiligt …“ | Eigenes Spiel | Eine zweite berechtigte Person entscheidet; Superadmin nur mit Grund – [2.0](#20-bereich-ligen-und-zuständige) |
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
| „Map 2 ist in Klärung – die Liga-Leitung entscheidet. Bis dahin gilt kein Ergebnis.“ (auch beim Ergebnis eintragen, dort mit „Bitte zuerst über den Vorfall entscheiden.“) | Zu dem Spiel ist ein Vorfall offen | Auf der Matchseite unter **Vorfälle im Spiel** entscheiden und die Serie feststellen (3.1d) |
| „Zu Map 2 ist ein Vorfall offen. Bitte zuerst über den Vorfall entscheiden oder ihn schließen – erst dann lässt sich das Spiel kampflos werten.“ | Kampflos, „Nicht erschienen“ oder „Beide nicht erschienen“ bei offenem Vorfall | Am Vorfall entscheiden oder **Ohne Entscheidung schließen** (3.1d), dann werten |
| „Map 2 wird erst neu gespielt. Die Serie stellst du fest, sobald das Ergebnis danach neu gemeldet ist – oder du trägst es selbst ein.“ | „Serie feststellen“ nach Neustart oder Wiederholung, bevor neu gemeldet ist | Auf die neue Meldung warten oder **Ergebnis eintragen** (3.2) |
| „Map 2 wird wiederholt – danach meldet ihr die Serie neu. Frühere Meldungen zählen nicht mehr.“ | Einigung oder Entscheidung auf Neustart bzw. Wiederholung | Die Teams spielen die Map und melden die ganze Serie neu |
| „Map 1 ist in Klärung und die Serie pausiert – Map 2 lässt sich erst melden, wenn die Liga-Leitung entschieden hat.“ | Die Season spielt mit „Serie pausiert, bis entschieden ist“ (2.7e) | Entscheiden; danach geht die Meldung |
| „Die Meldungen passen nicht zur Entscheidung der Liga-Leitung über den Vorfall – das Ergebnis trägt die Liga-Leitung ein.“ | Nach „Map zugesprochen“ oder nicht zählenden Maps ergibt die Meldung der Teams keine entschiedene Serie | **Ergebnis eintragen** mit den geltenden Maps (3.2) |

---

## 5. Häufige Fragen

**Muss die Staffel voll sein?**
Nein. Mit sechs Teams gibt es fünf Spieltage, die übrigen Wochen sind Reserve. Bei ungerader Zahl hat je Spieltag ein
Team spielfrei.

**Kann ein Spieler in zwei Co-Teams stehen?**
In derselben Season nur, wenn **Ein Team je Season** aus ist (Vorgabe an, 3.9): Dann geht ein Wechsel nur als Transfer mit
Wartezeit. In verschiedenen Ligen darf jemand für verschiedene Teams spielen. Am selben Spieltag spielt niemand für zwei Teams.

**Was, wenn ein Team nicht antritt?**
Mit Check-in (3.1b) kommt nach dem Fenster der Vorschlag „Nicht erschienen?“ an euch – ihr wertet kampflos, tragt die Seite
nach oder verlängert; von selbst wertet der Server nie. Ohne Check-in wertet ihr im Ergebnis-Fenster (**Nicht erschienen** auf
der fehlenden Seite), ein Vorschlag entsteht dann nicht (3.2).

**Zählt die Aufstellung für die Tabelle?**
Nein, nur das Ergebnis. Die Teilnehmerliste zählt für den Doppel-Einsatz, die Spieler-Belohnungen (3.12) und die
Spielerwertung der Gesamtwertung (3.13): Wer nicht darauf steht, hatte keinen Einsatz.

**Ein Spieler hat eine neue Activision-ID – darf er damit spielen?**
Erst nach eurer Freigabe (3.7). Bis dahin spielt er mit der gemeldeten ID; aufstellbar bleibt er.

**Wie sieht ein Captain, was zu tun ist?**
Über die Benachrichtigungen und den [Spickzettel für Captains](liga-captains.md).

---

## 6. Checkliste vor dem Season-Start

Zum Abhaken in dieser Reihenfolge – jeder Punkt mit dem Abschnitt von oben. Die Werte stehen im Regelwerk; die Season prüft
vor der Veröffentlichung selbst, was fehlt (**Was fehlt noch?**, 2.8).

- [ ] **Bereich Ligen** an alle vergeben, die die Liga leiten; Zuständige je Liga eingetragen – 2.0
- [ ] **Modi** des Spiels mit Ergebnisregel und Symbol, **Maps** mit Bild und Modi in der Bibliothek – 2.1
- [ ] **Ausrüstung** in der Bibliothek, **Sperrliste der Season** gespeichert – 2.1a
- [ ] **Season** angelegt (aus der Vorgängerin, falls es eine gibt – 3.11): Beginn, Wochen, Sperrzeiten, Runden – 2.2
- [ ] **Spielbetrieb:** Best of, Teamgröße, **Modus je Map**, Map-Pool, Ergebnisregeln, Punkte je Map Pflicht – 2.2
- [ ] **Check-in** (Fenster, Mindestzahl), **Veto-Vorlage** und, falls die Vorlage es verlangt, die **Vorgabe der Woche** – 2.7b, 2.7d
- [ ] **Vorfälle und Pausen**, **Termine und Verschiebungen**, **Erinnerungen** (Discord-Direktnachricht an oder aus) – 2.7e, 2.7a, 2.7f
- [ ] **Anmeldung und Kader:** Kadergrenzen, Mindestalter, Wartezeit, Plattform, Transferfenster – 3.9, 2.7c
- [ ] **Tabelle:** Punkteart, Reihenfolge bei Punktgleichheit, Kampflos, Ausscheiden – 2.2, 3.5
- [ ] **Proteste:** Fristen, Gründe, Zielfrist der Leitung; Strafkatalog im Regelwerk – 3.4, 3.4a
- [ ] **Belohnungen** festgelegt, falls es welche gibt – 3.12
- [ ] **Selbstanmeldung:** Fenster, Startplätze, Warteliste, automatisch annehmen ja oder nein, **Hinweis zum Datenschutz** mit dem
      freigegebenen Wortlaut für externe Teilnehmer – 2.5a
- [ ] **Regelwerk** mit allen Bausteinen veröffentlicht, Zustimmung verlangt – 2.11
- [ ] **Liga 1** (und weitere) mit **Staffeln** angelegt – 2.3
- [ ] **Prüfung vor der Veröffentlichung** ohne Probleme, Ligaseite mit *Nur Liga-Leitung* angesehen – 2.8
- [ ] Sichtbarkeit auf **Öffentlich** oder **Nur Mitglieder**, damit die Anmeldung erreichbar ist – 2.8
- [ ] Anmeldungen entschieden und **zugeteilt**; jeder im Kader hat Konto, Spiel-ID und Plattform (Kasten **Offene Punkte**) – 2.5a, 3.7
- [ ] **Liga starten** je Staffel (Spielplan fest) – 2.6
- [ ] **Ankündigung von Hand** auf Discord (die Liga postet nicht selbst in einen Kanal): Link zur Ligaseite, Start, Ablauf,
      [Spickzettel für Captains](liga-captains.md)
