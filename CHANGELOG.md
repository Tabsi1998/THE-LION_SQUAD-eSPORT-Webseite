# Changelog

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
