# Changelog

## [1.35.0](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/compare/v1.34.1...v1.35.0) (2026-10-27)


### Neu

* freie Wunschnummern als Raster zum Antippen, Prüfung ohne Nummer in der Adresse ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Nummern der Mitglieder im Admin – Liste, Anträge, Neuwahl und Regeln ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Vorstand erfährt Anträge auf eine andere Nummer per Mail und Discord ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Wunschnummer in Dolibarr als ergänzendes Attribut, mit Nachtrag wenn das Feld fehlt oder Dolibarr nicht erreichbar ist ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Wunschnummer je Mitglied – einmal selbst wählen, eindeutig im Verein, danach nur per Antrag ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))


### Fehlerbehebungen

* „Feld neu aufbauen“ prüft die Läufe sofort - kein Stations-Konflikt beim ersten Aufruf ([#2044](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2044)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* abgebrochene Vorstandsentscheidungen geben den Antrag wieder frei; fremde Nummern in Dolibarr bleiben stehen ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Cup mit Loser Bracket: ein Loser-Lauf wartet auf seine Vorläufe statt abgesagt zu werden - die Verlierer des Sammellaufs fahren ihre zweite Chance ([#2044](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2044)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* Cup mit Loser Bracket: nach Austritten ausgeglichene Läufe nehmen das Ergebnis an, Verlierer-Wege folgen Belegung und Quote ([#2045](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2045)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* gleichzeitige Entscheidungen und Nachträge setzen nie einen veralteten Stand der Wunschnummer ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))
* Läufe bleiben immer in ihrer Laufgröße - auch bei mehreren gleichzeitig aufgerufenen Vorläufen; TV zeigt keine leeren Zusatzplätze ([#2044](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2044)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* Sofort zufällig in Läufen - beide Weiterkommer eines Laufs finden ihren Platz, auch nach einer Disqualifikation ([#2033](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2033)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* Wartende Verlierer bekommen den nächsten freien Platz, sonst eine Meldung „Kein Platz im Folgelauf“ an die Turnierleitung ([#2044](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2044)) ([66bcb99](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/66bcb99988e9b0107c25fde1b0a2a3439967e72d))
* Wunschnummer folgt dem Konto bei gelöster oder gewechselter Dolibarr-Zuordnung ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))


### Dokumentation

* Handbuch-Abschnitt zur Wunschnummer ([#2034](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/2034)) ([c4eca19](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/commit/c4eca1926ba284e5b3949270514076bc7a996bea))

## 1.34.1 (26.10.2026)

### Fehlerbehebungen

* FFA-Läufe – beim Verteilen auf weniger Läufe als nötig gehen keine Weiterleitungen mehr verloren (zwei Quellen auf einem Platz) (#2033)
* FFA-Läufe – nach Ausfällen und Zusammenlegen bekommt kein Lauf (auch das Finale nicht) mehr Fahrer als die Laufgröße; die Quoten-Kappung zählt, was im Ziel schon sitzt (#2033)
* Lauf-Umbau – aufgerufene und laufende Läufe bleiben bei der Quoten-Kappung unangetastet; droht dort ein Überlauf, wird der Umbau als Konflikt (409) abgelehnt statt still angewendet (#2033)
* Lauf-Umbau – wird der Aufruf zurückgenommen oder der Lauf entschieden, holt die Auswertung den Umbau nach (auch nach aufgegebener Warteschlange, reihum im Minuten-Job); Meldung „Lauf-Umbau wartet“ nennt den Lauf, „Lauf-Umbau nachgeholt“ bestätigt (#2033)

## 1.34.0 (26.10.2026)

### Neu

* „Läuft gerade“ zeigt Saisons mit offenen Terminen vor Saisons ohne kommenden Termin (#2024)
* Die Gesamtwertung einer Turnierserie spricht von Turniertagen („seit dem Turniertag davor“) (#2024)
* Die Vorlage „Formel 1“ gibt es nur noch für Rennligen (#2024)
* Ein Ergebnis für einen Termin ohne Datum fragt beim Veröffentlichen nach dem Tag (#2024)
* Ein Termin ohne Datum heißt öffentlich „Termin folgt“, ohne kommenden Termin steht „Noch kein Termin“ (#2024)
* Hochgeladenes SVG-Logo eines Sponsors oder Partners geht vor dem Logo aus Dolibarr (#1952)
* Kalender in der Verwaltung führt Schritt für Schritt: Anzahl eintragen, Termine anlegen, Datum nachtragen (#2024)
* Logo-Felder mit Hinweis „Am besten SVG“ und Vorschau auf hellem und dunklem Grund (#1952)
* Logos auch als SVG hochladen – sicher bereinigt und scharf im Web (#1952)
* Regeln und Ergebnisblatt einer Turnierserie ohne F1-Felder wie schnellste Runde, Pole, Startplatz oder Zeit (#2024)
* Serienseite, „Läuft gerade“ und Startseite sprechen bei Turnierserien von Turniertagen und Spielern (#2024)
* SVG-Logos automatisch als PNG für Mail, PDF, Teilen-Bild, Discord, Favicon und App (#1952)
* Teamlogo als SVG für die Leitung des Teams (#1952)
* Termine ohne Datum sind markiert, lassen sich filtern und bekommen ihr Datum alle auf einmal (#2024)
* Terminliste einfügen: Bei Turnierserien ist eine Zeile ohne Datum ein offener Termin (#2024)
* Turnierserien starten mit einer TFT-Vorlage – Turniertag mit 5 Runden, 8 bis 1 Punkte, Double Up als Schalter (#2024)
* Turnierserien zeigen keinen Ort, keine Strecke und keine Flagge mehr – beim Eintragen, auf der Serienseite und in „Läuft gerade“ (#2024)

### Fehlerbehebungen

* „Datum nachtragen“ gilt nur für offene Termine – abgesagte oder gewertete werden genannt, nichts ändert sich halb (#2024)
* Bildvorschau im Upload-Feld bleibt nicht bei „Lade Vorschau“ stehen (#1952)
* Eine neue Saison nimmt nur eine Punkteschema-Vorlage, die zur Art der Spur passt (#2024)
* Einfügen von Ergebnissen und Tabellen – ein „|“ im Teamnamen zerlegt keine Tabelle mehr (#2024)
* Ja/Nein-Felder im Formular behalten ihre Vorgabe auch mit neuem FastAPI – neue App-Version wird wieder aktuell, eingesandte Fotos behalten den Namen

## 1.33.0 (22.10.2026)

### Neu

* Betrieb warnt, wenn der zweite Leser der Bild-Erkennung fehlt (#2018)
* Bild-Erkennung – Strecke im Kopf wird mit dem Kalender der Saison abgeglichen (#2018)
* Bild-Erkennung mit zweitem Leser – was beide gleich lesen, ist auch ohne Kader grün (#2018)
* Bild-Erkennung nutzt den Kader der ganzen Spur und zeigt „wie in Saison …“ (#2012)
* Knopf „Alle Namen bestätigen“ für vorbelegte gelbe Namen und Teams aus dem Bild, mit Rückgängig (#2018)
* Korrekturen aus Ergebnis-Bildern als Schreibweise lernen, sichtbar und entfernbar bei Teilnehmer und Saison (#2012)

### Fehlerbehebungen

* Bild-Erkennung – ungelesene Startplätze sind gelb statt leer und grün (#2018)
* Bild-Erkennung liest dunkelgraue Startnummern und Teams (#2012)
* Bild-Erkennung rät Namen und Teams nie grün – nur eindeutige Treffer, typische Verwechslungen erkannt (#2012)
* Saison- und Teamtabelle per Bild raten Namen nie grün (#2012)
* Startplätze, Abstände und Kopf aus Ergebnis-Bildern seltener unnötig gelb (#2012)

## 1.32.0 (22.10.2026)

### Neu

* Bestehende Double-Up-Saisons behalten die Punkte nach Team-Platz (#2015)
* Double-Up-Punkte wie bei PineApps – Team-Platz k zählt wie Einzelplatz 2k−1, einstellbar je Saison (#2015)
* Kalender – „Fehlende Termine anlegen“ bis zur geplanten Zahl (#2015)
* Nachgetragenes Datum sortiert einen offenen Termin richtig ein (#2015)
* PineApps-Import teilt den Team-Platz bei gleicher Tagessumme im Double Up (#2015)
* Saison-Feld „geplante Termine“ – Fortschritt „3 von 9“ und Streichergebnisse mit der geplanten Zahl (#2015)
* Serienseite zeigt Double-Up-Regel und Team-Platz mit Punkten im Turniertag (#2015)
* Terminliste versteht „offen“, „?“ und „tbd“ als Termin ohne Datum (#2015)

### Fehlerbehebungen

* Kalender am Handy – Knöpfe unter dem Termin statt über dem Status (#2015)

## 1.31.0 (22.10.2026)

### Neu

* Mitgliederprofil – Logo der Liga bzw. Serie bei den Vereinsplatzierungen (#2014)
* Partnerseite – Logo bei „Ligen und Serien mit uns“ (#2014)
* Referenzen – Logo der Liga bzw. Serie im Kopf von Serienseite und Rundenseite (#2014)
* Referenzen – Logo der Liga bzw. Serie in Läuft gerade, Serien & Ligen und Chronik (#2014)
* Startseite – „Heute im Einsatz“ zeigt das Logo der Liga bzw. Serie (#2014)
* Teilen – Serie und Runde zeigen das Logo der Liga bzw. Serie als Bild (#2014)
* Verwaltung – Logo für Spur und Saison hochladen oder aus der Mediathek wählen, Vorschau hell und dunkel (#2014)

## 1.30.0 (22.10.2026)

### Neu

* Bündelung rückgängig machen – Zuordnung lösen, unveränderte leere Saisons und Spuren entfernen; strengere Sichtbarkeit bleibt mit Hinweis und Link zur Referenz (#1751)
* Hilfe der Terminliste zeigt den Ablauf der Saison (#2007)
* Liga-Weg zeigt ohne eingetragene Ergebnisse den Platz der Referenz (#1751)
* Referenzen bündeln – der Assistent schlägt aus alten Referenzen Spur und Saisons vor, mit Hinweisen aus den Altdaten (#1751)
* Saison- und Teamtabelle per Bild auslesen – das Bild hängt beim Übernehmen als Original „Tabelle“ am Termin (#1999)
* Saisontabelle des Veranstalters einlesen – vergangene Runden als Entwürfe nachtragen, Platz aus den Punkten, Abgleich mit „Gesamt“ (#1928)
* Teamwertung laut Veranstalter für eine gewählte Runde übernehmen, ergänzen oder ersetzen, auch per Bild im Ergebnisblatt (#1999)

### Fehlerbehebungen

* Terminliste nennt bei doppeltem Lauf Zeile und Grund (#2007)

### Dokumentation

* Druckfassung des Helfer-Spickzettels auf zwei A4-Seiten (#1686)
* Helfer-Spickzettel für den Event-Tag (#1686)

## 1.29.0 (22.10.2026)

### Neu

* Fahrer-Anpassung wahlweise auch in der Teamwertung gegenrechnen – je Rennen für das gefahrene Team, in der aktuellen Besetzung nie doppelt (#2000)
* Regeln der Saison – Vorgabe „Fahrer-Anpassungen zählen auch für die Teamwertung“ (#2000)
* Teamwertung zeigt „−5 (Fahrer)“ bei der Teamsumme, Fahrer-Detail „zählt auch fürs Team“ (#2000)
* Verwaltung – Haken „zählt auch für die Teamwertung“ an jeder Fahrer-Anpassung mit Hinweis, wenn sie für kein Team zählt (#2000)

## 1.28.0 (22.10.2026)

### Neu

* Ergebnisblatt – Original-Bilder hinzufügen, ziehen oder einfügen; gelesenes Bild wird beim Übernehmen angehängt (#1933)
* Mediathek und Upload-Inventar zählen die Original-Bilder der Serien (#1933)
* Referenzen – „Original ansehen“ im Vollbild auf Serien- und Rundenseite (#1933)
* Referenzen – Original-Bilder des Veranstalters je Termin mit Art, Quelle und „öffentlich / nur Verwaltung“ (#1933)

## 1.27.0 (22.10.2026)

### Neu

* Filter-Chips der Chronik geben beim Drücken leicht nach (#1969)
* Mikro-Animationen auf Referenzen, Serien, Turnieren, Profil und Startseite (#1969)
* Partner-Plattform – neue Termine bekommen ein Kürzel T1, T2 … (#1964)
* Pole- und Bestzeit-Farben als Rollen im Design-System (#1969)
* Puls in Gold, Cyan, Rot und Grün (#1969)
* Saison-Verwaltung – Vorschau „Jetzt holen“ mit Termin, Abweichungen und unbekannten Namen (#1964)
* Seite und Seiten-Scrollleiste im dunklen Stil (#1969)
* Serienseite – Hinweis „Daten von …“ mit Link zum Partner (#1964)
* Turnierserie – Partner-Plattform je Saison einstellen, Turniertage holen und als Entwurf übernehmen (#1964)
* Wischleisten im Vereinsstil in Web und Verwaltung, nie versteckt, mit Verlauf (#1969)
* Zahlen und Zeiten zählen überall gleich hoch, Listen erscheinen gestaffelt, neue Werte leuchten kurz auf (#1969)

### Fehlerbehebungen

* Ergebnisblatt zeigt das Team-Feld nur, wenn die Saison Teams führt (#1969)
* Fast Lap zeigt Zeiten und Abstände mit Komma (#1969)
* Rundentabelle: Pole und Bestzeit leuchten erst am Ende des Hochzählens auf (#1969)
* Screenreader-Text in Wischflächen macht die Seite nicht mehr breiter (#1969)
* Tailwind-Warnung beim Bau der Fast-Lap-Seite behoben (#1969)
* Termine ohne Kürzel brechen in Kalender und Ergebnissen nicht mehr um (#1969)

## 1.26.0 (21.10.2026)

### Neu

* Rennligen – Anpassungen ±Punkte je Saison mit Grund, öffentlich als „−5“ (#1960)
* Rennligen – Regeländerung ab Runde X mit Tag und Hinweis auf der Serienseite (#1960)
* Rennligen – Saison abgebrochen mit Grund und Nachfolger, im Liga-Weg und in der Chronik (#1960)
* Rennligen – Startaufstellung aus umgekehrtem Qualifying oder Lauf davor, nur die ersten N (#1960)
* Rennligen – Teamwertung laut Veranstalter im Ergebnisblatt eintragen oder einfügen (#1960)
* Rennligen – Teamwertung nach aktueller Besetzung, Quelle und Modus, „im Team seit“ (#1960)
* Rennligen – Termin ohne Wertung mit Grund, Mindestzahl am Start als Hinweis (#1960)
* Rundenseite und Statistik – umgekehrte Aufstellung ohne Pole, Termin ohne Wertung, abgebrochene Saison (#1960)

### Fehlerbehebungen

* Rennligen – Ersatzfahrer zählen nicht fürs Stammteam; Teamnamen ohne Teamwertung je Saison einstellbar (#1960)
* Rennligen – leeres Team heißt kein Team; neue Zeilen bekommen das Stammteam sichtbar vorbelegt (#1960)

## 1.25.0 (21.10.2026)

### Neu

* Rennzeiten überall mit Komma wie beim Veranstalter (#1981)
* Spiele – weitere Schreibweisen je Map (#1616)
* Team-Liga – Maps im Ergebnisblatt aus dem Map-Pool mit Bild, unbekannte Namen gelb markiert (#1616)
* Team-Liga – Statistik je Map: gespielt, Siege, Wahl und Bann (#1616)
* Team-Liga – Veto als Karten mit Bild, gewonnene Map markiert (#1616)

### Fehlerbehebungen

* Ergebnis-Bild – 3/5-Verwechsler werden gelb statt still falsch (#1981)
* Ergebnis-Bild – keine falschen Punkte aus dem Tabellenrand; Läufe ohne Punkte übernehmen keine (#1981)
* Ergebnis-Bild – Platz 1 im farbigen Kasten nicht mehr gelb, kein Abstand beim Ersten (#1981)
* Ergebnis-Bild – Zeiten mit verlesenem Trennzeichen richtig; Quali-Bilder nicht mehr als „keine Zeiten“ abgelehnt (#1981)

## 1.24.0 (21.10.2026)

### Neu

* Ergebnisliste einfügen erkennt Spalten „R 1 … R 5“, „GES P“ und Sonderboni (#1961)
* Serienseite – Turniertage mit R1…Rn und Summe, Platzfarben, Lobby-Ansicht und Spieler-Detail mit Tages- und Saisonpunkten (#1961)
* Serienseite und Verwaltung zeigen Runden je Turniertag, Sonderboni und „Top N“ in den Regeln, Gesamtwertung mit Spalte Boni (#1961)
* Spielkennung mit Tag („Name#TLS“) gilt als dieselbe Person, Serienseite wahlweise ohne Tag (#1961)
* Turnierserien – eigene Sonderboni je Saison (etwa Bingo +3), je Zeile abhakbar, getrennt ausgewiesen und nie gestrichen (#1961)
* Turnierserien – geteilte Plätze ohne Warnung: Gleichstand (4, 4, 6) und Double Up mit Partner (#1961)
* Turnierserien – Gleichstand-Regel „Mehr Plätze unter den besten N“ mit einstellbarem N (#1961)
* Turnierserien – Marke „Ausgestiegen“ im Ergebnisblatt (#1961)
* Turnierserien – Runden je Turniertag (R1…Rn), Tagessumme GES P und Tagesplatz daraus, Rundenpunkte wie beim Veranstalter gelesen (#1961)

## 1.23.0 (21.10.2026)

### Neu

* Mitgliederprofil – „Aufstellung · 5 von 7 Spielen“ aus der verknüpften Saison (#1931)
* Partnerseite – Ligen und Serien mit uns (#1934)
* Referenzen – Ergebnisseite je Runde mit Reitern je Lauf, Zusammenfassung und hochzählenden Zeiten (#1950)
* Referenzen – Kalender, Lauf-Chips und Rennraster führen zur Ergebnisseite der Runde (#1950)
* Referenzen – Map-Pool je Saison, Serienseite zeigt die Maps mit Bild (#1616)
* Referenzen – Reiter „Statistik“ auf der Seite einer Rennliga (#1950)
* Referenzen – Strafsekunden je Zeile im Ergebnisblatt (#1950)
* Referenzen – Teamfarben je Saison mit Vorschlag aus dem Ergebnis-Bild (#1950)
* Referenzen – Teilen-Karte der Runde mit Runde, Ort und Läufen (#1950)
* Referenzen-Übersicht – Partner-Abzeichen bei Chronik, Läuft gerade und Serien & Ligen (#1934)
* Referenzen-Übersicht und Startseite – nächster Spieltag mit Gegner (#1931)
* Saison abschließen übernimmt auch die Partner der Saison (#1934)
* Serienseite – Veranstaltet von mit Partner-Logo, Mitwirkende darunter (#1934)
* Spiele – Map-Bibliothek mit Bild, Modi, Reihenfolge und Archiv (#1616)
* Spiele – Modus ohne Dauer für Maps (#1616)
* Team-Liga – „Spieltag einfügen“ erkennt die eigenen Spiele und übernimmt die übrigen Spiele des Spieltags (#1931)
* Team-Liga – Kader je eigenem Team, Aufstellung als Ankreuzliste, je Map oder von der Match-Seite eingefügt (#1931)
* Team-Liga – Maps im Veto mit Wahl, Bann und Decider, die Spieltag-Karte zeigt das ganze Veto (#1931)
* Team-Liga – Serienseite mit Bilanz, Spieltagen als Karten und Kader mit Einsätzen (#1931)
* Team-Liga – Terminliste mit Gegner („vs“/„@“), Heim/Auswärts und Spieltag-Zeitraum (#1931)
* Turniere – Map-Pool je Turnier und Phase, Turnierseite zeigt die Maps (#1616)
* Verwaltung Serien – Partner mit Rolle (Veranstalter/Mitwirkender) an Spur und Saison wählen (#1934)

### Fehlerbehebungen

* Referenzen – Sichtbarkeit verknüpfter Referenzen folgt einer strengeren Saison (#1970)
* Team-Liga – Map ohne Ergebnis wird nicht mehr still 0:0 (#1931)
* Team-Liga – Tabelle laut Veranstalter bleibt maßgeblich, andere Schreibweisen nur über ganze Wörter (#1931)

## 1.22.0 (21.10.2026)

### Neu

* Referenzen – „Wie letztes Mal“ übernimmt Spiel, Veranstalter und Team (#1936)
* Referenzen – Fahrer-Detail mit Poles, Ø Start und Quali-Duell (#1930)
* Referenzen – Lauf-Chips in Kalender, Verwaltung, „Läuft gerade“ und „Heute im Einsatz“, Kopf je Runde im Rennraster (#1930)
* Referenzen – Punkte je Lauf mit Vorschau, Qualifying mit Punkten, Punkte trotz DNF und Bonus je Lauf (#1930)
* Referenzen – Runde mit Läufen: Qualifying, Shootout, Sprint und Rennen je Runde mit „Ablauf je Runde“, auch ab Runde X wechselnd (#1930)
* Referenzen – Schnell-Eintrag für Tagesturniere, Rest unter „Weitere Angaben“ (#1936)
* Referenzen – Startplatz und Pole aus dem Qualifying, Sprint aus dem Shootout, umgekehrte WM-Reihenfolge vor der Runde oder nach dem Lauf davor (#1930)
* Referenzen – Terminliste erkennt Lauf-Kürzel (R1S, R1 Sprint, R1 Q …) und legt je Zeile alle Läufe an (#1930)
* Referenzen – Wertung je Lauf: Gesamt · Rennen · Sprint · Quali (#1930)

### Fehlerbehebungen

* Referenz-Detailseite – nur ausgefüllte Angaben, ein Tag steht einmal (#1936)
* Referenzen – Fahrer-Detail schiebt die Seite am Handy nicht mehr seitlich hinaus (#1930)
* Referenzen – Streichergebnisse und Aktivitätspunkte zählen je Runde, Pole nur für den ersten gültigen Platz (#1930)

## 1.21.0 (21.10.2026)

### Neu

* Abzeichen „Podest extern“ und „Dauerbrenner“ für externe Wettbewerbe, ohne Jahreswertungs-Punkte (#1750)
* Referenz-Karten aus einer Saison führen zur Saison-Seite (#1750)
* Referenzen – Auswahl „Gehört zur Saison“, Abzeichen „aus Saison …“ und Hinweis auf Serien in der Verwaltung (#1750)
* Saison abschließen – aus dem Endstand einer Saison wird die Referenz mit Endplatz, Team und Einzelwertungen (#1750)
* Saison-Kopf zeigt „Referenz: Platz 6 von 8 · ansehen“ (#1750)

## 1.20.0 (21.10.2026)

### Neu

* Aus dem Bild auch Startplatz, Zeit, Abstand, Punkte, Pole, schnellste Runde und Fahrer des Tages übernehmen (#1756)
* Ergebnis-Screenshot einer Rennliga im Ergebnis-Blatt auslesen – Strg+V oder Bild wählen, unsichere Felder gelb (#1756)
* Termin zur Strecke im Bild vorschlagen, Saisontabellen und Kalender ablehnen (#1756)
* Vorlage für Ergebnis-Bilder je Spur und Saison wählen (#1756)

## 1.19.0 (21.10.2026)

### Neu

* Chronik – kurze Titel „Veranstalter · Liga · Saison“ wie im Mitgliederprofil (#1944)
* Mitgliederprofil – „Details“ zur Referenz in der aufgeklappten Zeile (#1944)
* Mitgliederprofil – Chronik je Jahr als kompakte, aufklappbare Liste mit kurzem Titel und Aufstellung (#1944)
* Mitgliederprofil – Liga-Weg der Person ab zwei Saisons einer Spur (#1944)
* Mitgliederprofil – Vereinsplatzierungen ohne Nullen: nur vorhandene Medaillen, sonst „Bestes Ergebnis“ (#1944)
* Turnier bearbeiten warnt bei widersprüchlichen Zeiten (#1938)

### Fehlerbehebungen

* „Dein Stand“ nennt die wirksamen Check-in-Zeiten (#1938)
* „Nicht erschienen“ nennt den Nachrücker von der Warteliste (#1941)
* Anmelde-Blatt nennt bei vollem Cup die Warteliste (#1941)
* Check-in von Hand setzt die wirksamen Zeiten (#1938)
* Fast Lap am Handy – Schnelleingabe ohne Trennstrich, Team-Tabelle ganz (#1941)
* Fast Lap sperrt „Eintragen“ nach dem letzten Versuch (#1941)
* FFA-Läufe mit Auslosung nach der Runde – Zusammenlegen lässt keine doppelte Quelle mehr (#1596)
* Gewinn-Meldung sagt „1. Platz bei …“ statt „1. Platz Platz bei …“ (#1941)
* Show-Auslosung und Fristen erreichen jedes laufende Turnier (#1940)
* Turnierbaum zeigt den lesbaren Stationsnamen statt des Gerätekürzels (#1941)
* Verborgenes oder falsches Turnier zeigt eine Meldung statt ewig „Lade Turnier“ (#1939)
* Zeitleiste der Turnierseite folgt Status und Phase (#1938)

## 1.18.0 (21.10.2026)

### Neu

* doppelte Teilnehmer zusammenführen und Teilnehmer ohne Ergebnis entfernen (#1929)
* Ergebnisblatt mit Startnummer, Startplatz, Zeit, Abstand, schnellster Runde und Fahrer des Tages (#1927)
* Flaggen bei Terminen und Rennen, automatisch aus Strecke oder Ort erkannt (#1925)
* Garage, Teamwertung, „Unser Platz“ und Liga-Weg zählen alle eigenen Teams (#1926)
* Land eines Termins wählbar, auch beim Einfügen der Terminliste (#1925)
* Liste einfügen erkennt Start-, Zeit-, Abstand- und Bestrunden-Spalten sowie „OUT“ als Ausfall (#1927)
* Mehrere eigene Teams je Saison mit Schreibweisen (#1926)
* Rennraster zeigt den Fahrer des Tages, Fahrer-Detail die gutgemachten Plätze (#1927)
* Teilnehmer einer Saison nachträglich bearbeiten – Name, Startnummer, Team und Zuordnung je Zeile (#1929)
* Teilnehmer filtern, suchen und mehrere auf einmal als Gast oder Extern markieren (#1929)

## 1.17.1 (21.10.2026)

### Fehlerbehebungen

* Sponsoren- und Partner-Logos wieder im Original statt weiß (#1321)

## 1.17.0 (21.10.2026)

### Neu

* Fast-Lap-Seite zeigt TV- und PDF-Knöpfe nur für die Leitung, für alle „Downloads“ mit eigener Urkunde (#1277)
* Fast-Lap-Urkunden gibt es nur für die Person selbst und die Leitung (#1277)
* Profile zeigen keine Nullen, keine leeren Reiter und keinen Biografie-Platzhalter (#1268)
* Seite „Neu auf der Website“ mit Link und Punkt in der Fußzeile (#1240)
* Sponsoren- und Partner-Logos einfarbig weiß, Farbe beim Drüberfahren (#1321)
* Verwaltung hat eine weiße Logo-Fassung und einen Hinweis bei Logos mit Kasten (#1321)

### Fehlerbehebungen

* Podium im Profil zählt Fast-Lap-Plätze 1 bis 3 mit (#1268)

## 1.16.0 (21.10.2026)

### Neu

* Angepinnte News als breiter Aufmacher auf News-Seite und Startseite (#1342)
* News führen direkt zur Anmeldung – Karte mit Datum, freien Plätzen und Stand nach dem ersten Absatz (#1266)
* News ohne Bild bekommen eine Text-Karte im Vereinsstil, Ergebnis-News zeigen den Sieger mit Pokal (#1343)
* News-Kategorien nur mit Artikeln und Anzahl, eine Wisch-Zeile mit Suche als Symbol (#1249)

### Fehlerbehebungen

* Dasselbe News-Bild steht nie zweimal nebeneinander (#1343)

## 1.15.0 (21.10.2026)

### Neu

* Liga-Weg der Team-Liga zeigt den Vermerk der Saison (#1898)
* Liga-Weg, Ehrentafel und Vitrine nutzen zuerst den Vermerk der Saison und die Reihenfolge der Stufen (#1898)
* Referenzen prüfen beim Speichern Datum und Platzierung, Hinweise am Feld und Liste der Auffälligkeiten (#1755)
* Saison mit Ergebnis-Vermerk (Aufstieg, Abstieg, Klassenerhalt, Meister) und Spur mit eigener Reihenfolge der Stufen (#1898)
* Saison-Deko-Schalter für Gäste am Handy unten im Menü (#1239)

### Fehlerbehebungen

* Kopfzeile zwischen 1024 und 1439 px mit Löwenkopf, Login-Symbol und „Beitreten“ – nichts bricht um (#1234)
* Saison-Mütze sitzt auch auf dem Löwenkopf der kompakten Kopfzeile (#1234)
* Untermenüs öffnen sich am Tablet per Antippen und mit der Tastatur (#1233)

## 1.14.0 (21.10.2026)

### Neu

* Referenzen – „Läuft gerade“ als Kartenreihe mit Chip „Heute“ und Fortschritt in Segmenten (#1878)
* Referenzen – Chronik je Jahr mit Spiel-Chips und „Nur Podest“ (#1878)
* Referenzen – Hauptkarte der Vitrine in der Verwaltung wählbar, Wechsel im Adminprotokoll (#1878)
* Referenzen – Serien & Ligen mit Liga-Weg auf der Übersicht (#1878)
* Referenzen – Übersicht neu gestaltet: Ehrentafel, Vitrine mit Hauptkarte, Mitmachen-Band (#1878)

## 1.13.0 (21.10.2026)

### Neu

* Admin-Menü zeigt „Zuletzt“ ganz oben (#1291)
* Anmelden mit kurzem Bestätigungs-Blatt für jede Turnier-Anmeldung (#1261)
* Countdown-Schwelle unter Branding einstellbar (#1264)
* Großer Countdown der Startseite nur bei Terminen in den nächsten 14 Tagen (#1264)
* Login hat oben den Link „Zurück zur Website“ (#1242)
* Startseite zeigt „Heute im Einsatz“ an Renn- und Spieltagen (#1753)
* Zeitleiste der Turnierseite nennt Termine nach derselben Regel (#1264)
* Zustands-Schild zählt nur, wenn es bald so weit ist (#1264)

### Fehlerbehebungen

* „Dein Stand“ zeigt die Warteschlange nur, solange das Turnier läuft (#1888)
* Auf der Anmeldeseite heißt es überall „Anmelden“ (#1242)
* Betriebsskripte media-report und uploads-inventory im Backend-Container aufrufbar (#1583)
* Bildfelder sagen, dass SVG nicht geht (#1419)
* Chat sortiert und zählt neue Nachrichten nach Zeitpunkt statt nach Text (#1049)
* Chat-Kopf zählt Nachrichten ohne Zeitzone nach Wiener Uhr (#1049)
* Content-Audit startet nur mit ausdrücklich gewählter Basis-URL und bricht bei Weiterleitung auf die echte Seite ab (#1007)
* Discord-Statistik zählt aktive Konten nur auf den Servern der Übersicht (#981)
* Dokument-Formular nennt die Sichtbarkeit wie die Plakette – Mitglieder, Vorstand (#1367)
* Dokumentenliste in Worten – Sichtbarkeit als Plakette, Zähler als Satz, nur ansehen (#1367)
* Eingeklapptes Admin-Menü ist nicht mehr per Tastatur erreichbar, Öffnen führt den Fokus hinein (#1289)
* gescheiterte Nebenwirkungen werden geloggt statt verschluckt (#934)
* Geteilter Platz 1 zählt in der Statistik nicht mehr als Sieg (#1806)
* Livestream-Karte der Turnierseite verschwindet nach dem Ende (#1888)
* Login zeigt keinen roten Fehler, wenn der stille Passkey-Vorschlag scheitert (#1242)
* Mitgliederprofile nur noch als Reiter „Öffentliche Profile“ unter Mitglieder (#1365)
* Siegesserie folgt dem Abschluss der Spiele, nicht späteren Korrekturen (#1806)
* Startseite der Verwaltung zählt Konten als Konten und neue Vereinsmitglieder extra (#1378)
* Statuspille der Event-TV-Tafel folgt der öffentlichen Phase (#1888)
* SVG-Upload zeigt eine klare Meldung statt „Ungültige Bilddatei“ (#1419)
* Verwaltung am Tablet hochkant mit einklappbarem Menü (#1289)
* Web-Kalender sortiert die Termine eines Tages nach Zeitpunkt statt nach Text (#1567)

### Dokumentation

* Platzhalter-Adressen in INSTALL.md nicht mehr als Link (#1789)

## 1.12.2 (20.10.2026)

### Schneller

* Abmelden baut den Vorschau-Baum erst nach der Turnier-Sperre (#1871)
* Abzeichen nach der Anmeldung nur für die Anmelde-Zähler auswerten (#1871)

## 1.12.1 (20.10.2026)

### Fehlerbehebungen

* Bereiter Lauf an freier Station hat die Prognose „jetzt“, auch wenn ein Spieler im Turnier daneben noch ein geplantes Spiel hat (#1872)
* Manuell auf „live“ gesetzte Fast Laps, Turniere und Events zeigen öffentlich „Läuft“ statt „Angekündigt“, auch ohne oder vor dem Startdatum (#1881)
* TV-Tagesplan und Dashboard zeigen ein Turnier nach seinem Ende nicht mehr als „live“, auch wenn der Status auf „live“ stehen geblieben ist (#1881)

### Dokumentation

* Handbuch nennt die Prognose „jetzt“ neben einem zweiten Turnier (#1872)

## 1.12.0 (20.10.2026)

### Neu

* Referenzen – Bereiche „Heute im Einsatz“ und „Läuft gerade“ auf der Übersicht (#1748)
* Referenzen – schlanker öffentlicher Endpunkt für laufende Serien-Saisons (#1748)

## 1.11.0 (20.10.2026)

### Neu

* Rennliga-Seite – Fahrerwertung als Rennraster mit Podium, schnellster Runde, Ausfall, Abstand und Abweichung zum offiziellen Wert (#1746)
* Rennliga-Seite – Rennkalender mit Sieger aus dem Verein, sonst bestem Vereinsfahrer mit Platz (#1746)
* Rennliga-Seite – Teamwertung mit Balken und Punkten je Rennen, Vereinsteams hervorgehoben, Gäste markiert (#1746)
* Rennliga-Seite – Umschalter zwischen den Saisons und Ligen einer Spur (#1746)
* Rennliga-Seite – Vereins-Garage mit Teamduell und Fahrer-Detail für öffentliche Vereinsfahrer (#1746)

## 1.10.0 (20.10.2026)

### Neu

* Referenzen – Seite Team-Liga mit Tabelle, Spielplan, Aufstellung und Liga-Weg (#1747)

### Fehlerbehebungen

* Bereite Läufe verteilen sich auf alle freien Stationen (#1858)
* Fall „Nicht erschienen?“ nennt Baumteil, Runde und Durchgang (#1860)
* Kasten „Auslosung“ im Reiter Spiele nennt Baumteil und Runde wie der Baum (#1860)
* Läufe, die auf Auslosung oder Vorspiele warten, nehmen bereiten keine Station mehr weg (#1858)
* Stationen sagen „wartet auf die Auslosung“ bei der Show-Auslosung (#1858)
* TV nennt als Nächstes einen bereiten Lauf statt eines wartenden (#1858)

### Schneller

* Vor-Ort-Anmeldungen im selben Moment sind in unter einer Sekunde bestätigt (#1859)

## 1.9.0 (20.10.2026)

### Neu

* Ergebnisliste aus der Zwischenablage lesen – Zeilen, Tab-, |- und ;-Tabellen (#1744)
* Ergebnisse je Termin in der Saison eintragen – dynamische Liste mit Vorschau (#1744)

### Fehlerbehebungen

* Referenzen zeigen bei Ausgaben ohne eigenes Logo oder Cover das des Hauptspiels (#1811)
* Spiel-Kacheln unter „Wo wir antreten“ brechen lange Spielnamen am Handy um statt sie abzuschneiden (#1812)

### Dokumentation

* Handbuch „Ergebnisse eintragen“ mit Liste, Einfügen, Vorschau und Freigabe (#1744)

## 1.8.0 (20.10.2026)

### Neu

* Ergebnisse externer Serien eintragen – Vorschau, Übernehmen mit Version und Freigabe (#1744)
* Ergebnisse externer Serien zuordnen und auf Plausibilität prüfen (#1744)

### Fehlerbehebungen

* Änderungen an einer Saison laufen nacheinander, nie rechnet ein älterer Stand über einen neueren (#1744)

## 1.7.1 (20.10.2026)

### Fehlerbehebungen

* Live-Meldungen nennen nur sichtbare Turniere (#1801)

### Schneller

* Live-Meldungen nennen Turnier und Event öffentlicher Turniere (#1801)
* Turnierseiten laden nur bei Änderungen ihres Turniers nach (#1801)

## 1.7.0 (20.10.2026)

### Neu

* Filter „Nur Vereinsspieler“ und Handy-Karten auf der Serienseite (#1745)
* Finale als eigene Runde mit Endplatzierung auf der Serienseite (#1745)
* Finalrechner „Was braucht es fürs Finale?“ als Richtwert (#1745)
* Seite Turnierserie mit Gesamtwertung, Streichergebnissen und Finalgrenze (#1745)
* Serienseite nicht indexiert, fremde Namen nur in Tabellen (#1745)

## 1.6.2 (20.10.2026)

### Fehlerbehebungen

* „Nicht erschienen“ im Lauf wertet nicht mehr den ganzen Lauf – der Lauf bleibt offen, die Person steht nach dem Eintragen hinten (#1823)
* Austritt bei Show-Auslosung je Weg rückt beide Wege nach einer Regel auf, Korrektur findet jeden Platz ([#1848](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/1848), [#1849](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/issues/1849))
* Baum und TV zeigen „nicht erschienen“ im offenen Lauf (#1823)
* Ergebnis-Fenster belegt „nicht erschienen“ im Lauf vor (#1823)
* Ist nur der Lauf des Ersten schon aufgerufen, behält der Zweite nach dessen Austritt seinen Platz (#1839)
* Lauf mit Loser Bracket nach Austritt wieder eintragbar (#1823)
* Nachrücker nach Austritt sitzt im Läufe-Cup mit Loser Bracket nur in einem Lauf (#1839)
* Show-Auslosung und „Neu auslosen“ lassen Ausgetretene aus dem Topf (#1839)
* Turnierleitung meldet „Lauf bleibt offen“ statt „kampflos“ (#1823)

## 1.6.1 (20.10.2026)

### Fehlerbehebungen

* Aufruf-Tafel trennt Stationsnamen nicht mehr mitten im Wort (#1822)
* Aufruf-Tafel und Hallen-Tafel ohne Anmeldung ohne Fehlerflut in der Konsole (#1822)
* Aufruf-Tafel und Hallen-Tafel zeigen mit Event-Schlüssel auch Turniere „Nur Mitglieder“ am TV ohne Anmeldung (#1822)
* Gast anlegen in „Am Start / Als Nächstes“ funktioniert (#1825)
* gleichzeitige Vor-Ort-Anmeldungen warten statt abzubrechen (#1826)
* Stationen liefern öffentlich nur Anzeige-Felder (#1822)
* Turnierbaum- und Stations-TV zeigen Stationen und Aufrufe auch bei Turnieren „Nur Mitglieder“ (#1822)
* Turnierbaum-TV zeigt den Anmelde-QR auch im Check-in-Zeitraum, solange Plätze frei sind (#1827)
* Turnierseiten „Nur Mitglieder“ zeigen die Streams ohne Fehler (#1831)
* TV & Beamer erstellt Links mit Event-Schlüssel für Hallen- und Aufruf-Tafel (#1822)

### Schneller

* Anmeldebestätigung erst nach der Turnier-Sperre (#1826)

## 1.6.0 (20.10.2026)

### Neu

* Jahreszeiten-Vorschau mit Link „Auf der Website ansehen“ im selben Tab (#1838)
* Kalender je Serie – Termine einzeln oder als Liste einfügen, verschieben, absagen, ordnen (#1742)
* Status je Termin im Wiener Tag mit Hinweis auf fehlende Ergebnisse (#1742)
* Termine der Saison auf der Serienseite (#1742)

### Fehlerbehebungen

* Jahreszeiten-Vorschau sagt, warum Feuerwerk fehlt (Bewegung reduzieren, dezent, Website aus) (#1838)
* Spielplan nach Stationen nennt bei „Jetzt“ und „Als Nächstes“ Runde und Durchgang (#1824)
* Stationen der Turnierleitung und Spielplan nennen bei Läufen Durchgang und Namen statt „4 Teilnehmer“ (#1824)
* TV-Fußzeile „Als Nächstes“ nennt nach einem Austritt dieselbe Station und Spielerzahl wie die Live-Warteschlange (#1828)

### Dokumentation

* Handbuch „Serien“ – Kalender der Saison (#1742)

## 1.5.0 (19.10.2026)

### Neu

* Captain nur für aktive Vereinsmitglieder (#1749)
* Captains in der Saison verwalten (#1749)
* Captains je Saison hinzufügen, ändern und entfernen mit Protokoll (#1749)
* Captains sehen ihre Serien unter „Mein Dienst“ und öffnen ihre Saison (#1749)
* Dialog „Unbekannte Namen“ und Teilnehmerliste in der Saison-Seite (#1743)
* Namen externer Serien vergleichbar machen und Vorschläge mit Begründung bilden (#1743)
* Teilnehmer einer Serie als Mitglied, Gast oder Extern zuordnen (#1743)

### Fehlerbehebungen

* Klick in die Fläche einer Mehrfachauswahl im Profil schaltet nicht mehr die erste Option um (#1835)
* Klick neben Avatar, Banner oder Logo öffnet nicht mehr die Dateiauswahl (Profil und Team) (#1835)
* Kontolöschung nimmt Teilnehmer externer Serien aus der Vereinsstatistik (#1743)

### Dokumentation

* Handbuch „Unbekannte Namen“ mit Bildern aus der Abnahme (#1743)

## 1.4.0 (19.10.2026)

### Neu

* Referenz kann zu einer Serie gehören (#1741)
* Regeln je Saison aus Punkteschema-Vorlagen, Regeländerung rechnet neu (#1741)
* Seite einer Saison in der Verwaltung (#1741)
* Verwaltung „Serien“ – Spuren und Saisons anlegen, bearbeiten, archivieren (#1741)

## 1.3.0 (19.10.2026)

### Neu

* Abo-Hinweis einmal nach der Anmeldung zu Event oder Turnier (#1788)
* Anmelde- und Registrierungsgrenze je Netz in der Verwaltung einstellbar, mit Event-Zeitraum (#1802)
* Anmeldeliste des Events druckt mit Begleitpersonen, Warteliste, Druckzeit und QR-Code (#1283)
* Ansicht „Mein Kalender“ mit den eigenen Terminen und ihrem Stand, auch ohne Abo (#1788)
* Druckansicht für Turnierbaum, Spielplan, Check-in-Liste und Tagesplan (#1283)
* Eintrag „Mein Kalender-Abo“ in den Einstellungen (#1788)
* Kasten „Automatisch in deinen Kalender“ mit Anleitung, Status und Rückfrage beim Abschalten (#1788)
* Knopf „Drucken“ auf Baum, Spielplan, Teilnehmern und Event (#1283)
* Referenzen „Jahr für Jahr“ nach Jahr statt Freitext-Saison gruppieren (#1748)
* Referenzen filtern nach Jahr statt nach Freitext-Saison (#1748)
* Referenzen zeigen Spiel-Logo, ohne Logo das Spiel-Kürzel in der Spiel-Kachel (#1748)
* verständliche Meldung „Zu viele Anmeldungen aus diesem Netz“ statt allgemeinem Hinweis (#1802)

### Dokumentation

* Betrieb und Handbuch – Grenze je Netz für Events einstellen (#1802)

## 1.2.4 (19.10.2026)

### Fehlerbehebungen

* Erfolge „Sieger“ und „Siegesserie“ werten Unentschieden und Freilos nicht mehr als Sieg (#1796)
* Sieg-Erfolge (z. B. „Zu Null“, Clutch, Favoritenschreck, Gruppensieg, Team-Siege) zählen jetzt auch eingetragene Ergebnisse (#1796)

## 1.2.3 (19.10.2026)

### Fehlerbehebungen

* „antreten bis“ und „nicht erschienen ab“ nennen beim Aufruf vor der Planzeit dieselbe Zeit (#1791)
* Ein bereites Spiel rückt an die freie Station statt hinter eine überzogene (#1791)
* Loser-Runden heißen am TV und in der Live-Warteschlange wie im Turnierbaum („Loser Runde 1“ statt „2“) (#1792)
* Umbauplan beim Austritt mit richtiger Einzahl und Mehrzahl („1 Spiel betroffen“) (#1793)

### Schneller

* Live-Ansichten laden nie doppelt zugleich nach (#1683)

### Dokumentation

* Lasttest vor einem Event starten (#1683)

## 1.2.2 (19.10.2026)

### Dokumentation

* App gegen den Abnahme-Server im Android-Emulator (#1686)
* App-Bilder in der Helfer-Anleitung, mit Hinweis wo die App etwas noch nicht kann (#1686)
* Drehbuch für den Probelauf des Event-Abends (#1635)
* Handbuch Turniere nennt den Knopf „Austritt eintragen“ (#1635)

## 1.2.1 (19.10.2026)

### Dokumentation

* Kurzanleitung für Helfer am Turniertag mit Bildern zu jedem Schritt, PC und Handy (#1686)

## 1.2.0 (19.10.2026)

### Neu

* **app:** Turnierbaum mit vier Weiterkommen-Modi, Auslosung als Moment und neuen Namen (#1633)

## 1.1.0 (19.10.2026)

### Neu

* TV-Warteschlange nennt im Lauf die Namen (#1634)

## 1.0.4 (18.10.2026)

### Fehlerbehebungen

* FFA-Läufe - Austritt ohne Nachrücker hinterlässt kein zweites Finale (#1596)

## 1.0.3 (18.10.2026)

### Fehlerbehebungen

* Abnahme-Stand mit ausgewählten Hintergrund-Jobs statt ganz ohne (#1609)

## 1.0.2 (18.10.2026)

### Fehlerbehebungen

* Planer löst alten Termin, wenn ein Spiel nach Austritt nur noch einen Spieler hat (#1608)

## 1.0.1 (18.10.2026)

### Fehlerbehebungen

* Regeln je Phase wieder in der Verwaltung einstellbar (#1636)

## 1.0.0 (16.10.2026)

### Dokumentation

* GitHub-Auftritt mit Status auf einen Blick, Website-Releases und Automatik (#1735)
