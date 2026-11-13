# Abrechnung: Kosten an Events, Startgelder, Rechnungen aus Dolibarr

Für Vorstand und Kassier: Was die Website kann, was sie noch nicht kann, und was auf eurer
Seite eingerichtet sein muss. Fachlich ist das Epic #314 mit den Paketen #315–#322.

## Was heute geht (Abrechnung I, Teil 1 und 2; Abrechnung II)

**Ein Event kann etwas kosten.** Unter Admin → Events → Event bearbeiten gibt es den Abschnitt
„Kosten und Abrechnung“ – nur für Personen mit dem Bereich **Finanzen**. Dort steht zum Beispiel:

| Bezeichnung | Betrag | Preisbasis | wählbar |
| --- | --- | --- | --- |
| Kostenbeitrag inkl. Essen und Getränke | 20,00 € | je Person | nein |
| Event-Shirt | 15,00 € | je Anmeldung | ja |

- **je Person** zählt die buchende Person plus Begleitpersonen (eine Begleitperson → 40 €).
- **je Anmeldung** zählt einmal, egal wie viele kommen.
- **wählbar** heißt: Die Person setzt beim Anmelden einen Haken, sonst zählt es nicht. Mindestens
  eine Position ist Pflicht.
- **Leistung aus Dolibarr:** Habt ihr die Leistung schon in Dolibarr (z. B. „Kostenbeitrag 20,00
  brutto“), wählt ihr sie je Position aus der Liste – Bezeichnung, Betrag, Steuer und Nummer sind
  dann vorbelegt, und die Rechnungszeile zeigt auf diese Leistung. Die Website legt in Dolibarr
  keine eigenen Leistungen an. Mehrere Positionen können auf verschiedene Leistungen zeigen.
- Beträge sind ganze Cent. Es gibt keine Formeln und kein Rechnen mit Freitext.
- Bestehende Events bleiben kostenlos, bis jemand den Haken „Teilnahme kostet etwas“ setzt.

**Wer sich anmeldet, sieht den Preis vorher.** Positionen, wählbare Zusätze und die Summe stehen
im Anmeldeformular; der Knopf heißt „Verbindlich anmelden · 40,00 €“. Nach der Anmeldung steht
der Betrag bei der eigenen Anmeldung. Andere Teilnehmer sehen kein Geld.

**Der Preis ist eingefroren.** Bei der verbindlichen Anmeldung merkt sich die Website Positionen,
Menge und Summe (der „Snapshot“). Ändert ihr die Positionen später, gilt das nur für neue
Anmeldungen. Wer auf der Warteliste steht, zahlt noch nichts – der Preis entsteht erst beim
Nachrücken, mit den dann gültigen Positionen. Ändert die Verwaltung die Begleitpersonen einer
Anmeldung, bevor eine Rechnung entstanden ist, wird neu gerechnet.

**Jede kostenpflichtige Anmeldung wird ein Rechnungsauftrag.** Die Aufträge stehen unter
Admin → Finanzen mit ihrem Status:

| Status | Bedeutung | Was zu tun ist |
| --- | --- | --- |
| neu | gerade angelegt | nichts – der Job läuft alle zwei Minuten |
| wartet auf Schreibzugriff | Dolibarr ist nicht angebunden oder der Haken „Schreibzugriff“ fehlt | Haken setzen (siehe unten) |
| Zuordnung prüfen | in Dolibarr gibt es schon einen Geschäftspartner mit derselben E-Mail (z. B. Familie) | in der Finanzübersicht die Nummer eintragen und „Zuordnen“ – oder „Trotzdem neu anlegen“ |
| wartet auf Freigabe | Rechnungszeitpunkt „erst nach Freigabe“ | in der Finanzübersicht „Freigeben“ |
| Rechnung angelegt | Beleg in Dolibarr da – Nummer und Stand stehen dabei | Entwürfe in Dolibarr prüfen und freigeben; Zahlungen dort buchen |
| storniert | Anmeldung storniert, bevor eine Rechnung entstand | nichts |
| gescheitert | Dolibarr hat fünfmal nicht geantwortet | Text lesen, „Erneut versuchen“ |

Nichts davon geht verloren: Ein Auftrag bleibt stehen, bis die Voraussetzung da ist. „Jetzt
prüfen“ in der Finanzübersicht läuft sofort statt in zwei Minuten.

Je eingefrorenem Preis gibt es höchstens einen Auftrag, auch wenn eine Anmeldung doppelt oder gleichzeitig ankommt
(#1184). Bricht der Auftrag einer Turnier-Anmeldung nach dem Speichern ab, legt die nächste Anmeldung derselben Person
ihn nach – genau einmal.

**Was beim Anlegen passiert (Teil 2):**

1. **Geschäftspartner.** Mitglieder mit bestätigter Zuordnung bekommen den Geschäftspartner, der
   in Dolibarr am Mitglied hängt; fehlt er, legt die Website einen an und merkt sich die Nummer.
   Nicht-Mitglieder bekommen einen eigenen Kunden. Gibt es in Dolibarr schon jemanden mit
   derselben E-Mail, entscheidet die Finanzverwaltung („Zuordnung prüfen“) – nie die Website.
2. **Rechnung.** Positionen wie eingefroren, Menge, Steuerprofil; die Auftragskennung steht als
   externe Referenz am Beleg – so entsteht auch nach einem Abbruch nie eine zweite Rechnung.
   Neue Belege sind **Entwürfe** zur Prüfung in Dolibarr; mit dem Haken „Rechnungen gleich
   freigeben“ (Admin → Dolibarr) sind sie sofort freigegeben.
3. **Stand.** Alle zehn Minuten liest die Website Nummer, Freigabe und Zahlung nach. Bezahlt wird
   in Dolibarr gebucht – die Website zeigt es der Person an der Anmeldung und dem Kassier in der
   Finanzübersicht.

**Konditionen und Text auf dem Beleg (#370).** Jeder Beleg bekommt beim Anlegen Zahlungsziel,
Zahlungsart und Bankkonto aus Admin → Finanzübersicht → Rechnungsangaben (seit #1358; pflegt der Kassier). Die
Listen kommen aus Dolibarr (Vorschlag: 30 Tage, Banküberweisung; das Konto, wenn es nur eines
gibt). Darf der Website-Benutzer die Konten nicht lesen, tragt ihr die Nummer aus Dolibarr ein
(Adresszeile des Kontos, „id=…“). **Ohne alle drei bleibt jeder Beleg Entwurf**, auch wenn „gleich
freigeben“ an ist – der Haken lässt sich erst setzen, wenn die drei da sind.

Jede Rechnungszeile nennt den Vorgang, nicht nur die Leistung:

```
Kostenbeitrag – Essen und Getränke
Weihnachtsfeier am 12.12.2026 – 2 Personen (Paula Beispiel + 1 Begleitperson)
```

Beim Turnier: „Herbst-Cup am 02.10.2026 – Team [TLS] Lions, 5 Spieler“. In der Finanzübersicht
steht der Text bei jedem offenen Auftrag („Rechnungstext“), und ihr könnt einen **Zusatz**
ergänzen (z. B. „Tisch 4 reserviert“, „Menü vegetarisch“) – er kommt unter die erste Zeile und
in die öffentliche Notiz des Belegs. Sobald der Beleg existiert, wird der Text in Dolibarr
geändert, nicht mehr hier.

**Ein Turnier kann Startgeld kosten (Abrechnung II).** Unter Admin → Turniere → Turnier →
Bearbeiten gibt es den Abschnitt „Startgeld“ – wieder nur für den Bereich **Finanzen**, mit
denselben Positionen und Leistungen aus Dolibarr wie beim Event. Zwei Dinge sind anders:

- **je Spieler** zählt die Spieler des Turnier-Rosters, nicht die Mitglieder des Community-Teams.
  Solo ist eine Person. Ersatzspieler zählen nur mit dem Haken „Ersatzspieler zählen mit“. Steht
  bei der Freigabe noch kein Roster, gilt die Teamgröße des Turniers. **je Team** ist ein Betrag
  je Anmeldung, egal wie groß das Team ist.
- **Wer anmeldet, zahlt.** Solo die Person selbst; bei Teams die Teamleitung, die beim Anmelden
  den Haken „Ich übernehme das Startgeld für das Team (Rechnung an mich)“ setzt – ohne den Haken
  nimmt die Website die Anmeldung nicht an. Teamname und Team stehen als Bezug auf der Rechnung.
  Einzelrechnungen je Spieler gibt es nicht (das wäre eine eigene Stufe).

**Bezahlt wird erst mit der verbindlichen Teilnahme.** Warteliste und offene Freigabe kosten
nichts; der Preis entsteht, wenn die Anmeldung auf „freigegeben“ geht – mit den dann gültigen
Positionen, und wird dann eingefroren. Ablehnung, „nicht erschienen“ oder Abmeldung vor dem
Beleg schließen den Auftrag. Die Aufträge stehen in derselben Finanzübersicht wie die der Events
(Quelle „Startgeld <Turnier>“), der Rechnungsweg nach Dolibarr ist derselbe.

**Zurück nach Storno, die Rechnung gibt es schon (#2368).** Wie bei Events (siehe Prüffälle): Meldet sich
jemand nach der Abmeldung wieder an, rückt nach der Abmeldung von der Warteliste nach oder bestätigt die
Turnierleitung eine abgelehnte, ausgetretene oder „nicht erschienene“ Anmeldung wieder (auch über den Check-in),
entsteht kein zweiter Auftrag. Die Anmeldung trägt wieder den Preis und Stand der Rechnung, es öffnet sich der
Prüffall „Buchung nach dem Beleg geändert“ mit altem und neuem Betrag (Grund „Nach Storno selbst neu angemeldet“ –
auch wenn die Leitung eine selbst neu angemeldete Person von der Warteliste holt –, „Nach Storno von der
Warteliste nachgerückt“ oder „Anmeldung wieder aktiviert“). Die Abmeldung löscht die Turnier-Anmeldung; als
dieselbe Anmeldung zählt eine neue, wenn Turnier, zahlende Person und Team (Solo: keins) gleich sind. Meldet
ein **anderes Mitglied** das Team neu an – auch nach einer weggenommenen Ablehnung –, übernimmt es die Kosten
selbst: eigener Auftrag, die alte Rechnung bleibt storniert (Gutschrift an die Person, die sie bekommen hat).
Ist die alte Rechnung voll gutgeschrieben oder aufgegeben, gilt der aktuelle Preis mit eigenem Auftrag.
„Nicht erschienen“ schließt den Auftrag auf jedem Weg: über den Status, über den Check-in und wenn die Leitung
einen Ersatz für die Person einträgt.

**Turnier im Event.** Hängt das Turnier an einem Event, dessen Kostenbeitrag das Startgeld schon
enthält, setzt ihr im Abschnitt „Startgeld“ den Haken „Im Eventbeitrag enthalten“ – dann zeigt
das Turnier kein Startgeld und es entsteht keine zweite Rechnung.

## Das PDF zum Beleg (#840)

**Jeder freigegebene Beleg hat sofort sein PDF.** Dolibarrs Oberfläche erzeugt das PDF beim
Freigeben selbst – die Schnittstelle, über die die Website arbeitet, tut das nicht. Deshalb lässt
die Website das PDF gleich nach dem Freigeben erzeugen (`PUT /documents/builddoc`, mit der
Vorlage des Belegs). Damit liegt es in Dolibarr am Beleg (mailen aus Dolibarr geht sofort), und
Mitglieder wie Gäste laden es auf der Website unter „Meine Rechnungen“.

- **Sprache:** Admin → Finanzübersicht → Rechnungsangaben → „Sprache der Rechnungs-PDFs“, Vorgabe
  Deutsch (Österreich). Ohne Angabe nähme Dolibarr die Sprache des Website-Benutzers – steht die
  auf „automatisch“, käme ein englisches PDF heraus.
- **Entwürfe** bekommen kein PDF; erst der freigegebene Beleg.
- **Scheitert das Erzeugen** (Recht fehlt, PDF-Vorlage kaputt, Dolibarr kurz weg), bleibt der
  Beleg gültig und die Anmeldung auch. Der Grund steht am Auftrag (Finanzen → Auftrag öffnen);
  der Abgleich versucht es stündlich wieder.
- **Von Hand freigegeben:** Gebt ihr einen Entwurf in Dolibarr frei, übernimmt der Abgleich das
  PDF aus Dolibarr; entstand dort keins (z. B. mit `MAIN_DISABLE_PDF_AUTOUPDATE`), baut er es.
- **Belege von vor dem Update:** Finanzen zeigt „N freigegebene Belege ohne bestätigtes PDF“ mit
  dem Knopf **Fehlende PDFs nachziehen** – einmal drücken, das Ergebnis steht in Worten da
  („3 PDFs erzeugt, 5 hatten schon eins“). Danach erledigt das der Abgleich.
- **Gäste:** Fehlt die Datei beim Herunterladen noch, erzeugt die Website sie in diesem Moment
  einmal – niemand muss auf den Abgleich warten.

## „Deine Rechnung ist da“ (#841)

**Wer sich anmeldet, erfährt, sobald die Rechnung freigegeben ist.** Die Meldung nennt den
Vorgang, den Betrag und das Zahlungsziel („Weihnachtsfeier: 40,00 €, zahlbar bis 17.10.2026.“) und
führt direkt zum Beleg im Konto – im Web öffnet sich das PDF, in der App der Beleg.

- **Wege:** Postfach in Web und App, Push und Mail. Die Mail hat einen **Link, keinen Anhang** –
  das PDF bleibt hinter der Anmeldung. **Discord ist kein Weg** dafür: Beträge gehören nicht in
  einen fremden Dienst, auch nicht als Direktnachricht.
- **Einstellungen:** Profil → Benachrichtigungen → „Rechnungen“ (Postfach, Push, E-Mail).
- **Einmal je Beleg**, ausgelöst von der Freigabe: gleich beim Anlegen („gleich freigeben“) oder,
  wenn ihr den Entwurf in Dolibarr von Hand freigebt, beim nächsten Abgleich.
- **Wartet auf das PDF** – höchstens zwei Stunden; danach kommt sie trotzdem, der Download im
  Konto baut ein fehlendes PDF selbst.
- **Nie** für Entwürfe, nie nach einer Abmeldung, nie für Gutschriften – und Belege, die schon vor
  dem Update freigegeben waren, bleiben still (kein Schwall alter Rechnungen).

## Nach dem Beleg: Zahlungsstand, Prüffälle, Erstattungen (#321)

**Dolibarr ist führend für den Beleg und das Geld, die Website für die Buchung.** Die Website
schreibt nach dem Anlegen nie mehr an einem Beleg – sie liest. Offene Belege alle zehn Minuten,
bezahlte, gutgeschriebene und aufgegebene einmal am Tag (damit eine späte Gutschrift oder eine
Löschung nicht unbemerkt bleibt); „Alles abgleichen“ in der Finanzübersicht liest sofort alles.

**Zahlungsstand** je Beleg, aus Summe, Rest, Zahlungsziel und Gutschriften in Dolibarr:

| Stand | Bedeutung |
| --- | --- |
| Entwurf | noch nicht freigegeben – in Dolibarr prüfen und freigeben |
| offen | freigegeben, nichts bezahlt, Zahlungsziel nicht erreicht |
| teilweise bezahlt | eine Zahlung ist da, ein Rest offen (steht dabei) |
| überfällig | Zahlungsziel vorbei, Rest offen |
| bezahlt | Rest null |
| bezahlt mit Abzug | in Dolibarr als „Bezahlt (mit Abzug)“ abgeschlossen: nichts mehr offen, der Rest steht als „erlassen“ dabei |
| Überzahlung | mehr Geld als der Beleg verlangt → Prüffall |
| gutgeschrieben | eine Gutschrift in Dolibarr deckt den Beleg |
| aufgegeben | in Dolibarr als uneinbringlich/aufgegeben markiert |

Bei jedem Beleg steht, wie frisch der Stand ist („Stand 23.09., 11:40“). Konnte Dolibarr nicht
lesen, steht der Grund dort – nichts wird still alt.

**Bezahlt mit Abzug (#2226).** Dolibarr rechnet den Rest als Summe minus Zahlungen und Gutschriften, bei einem Abschluss mit
Abzug bleibt er dort also stehen. Die Website zeigt ihn nicht als offen, sondern als „20,00 € erlassen“. Erlassen ist kein Geld:
Es zählt weder als bezahlt noch zur Erstattungsgrenze und steht in den Summen und im CSV für sich. Die Person sieht schlicht
„bezahlt“.

**Grund und Anmerkung**, die ihr beim Abschluss in Dolibarr eintragt, stehen in Liste und Detail, Änderungen im Verlauf; das gilt
auch für aufgegebene Belege. Die Anmerkung ist freier Text und bleibt in der Verwaltung: nicht in „Meine Rechnungen“, nicht in der
App, nicht in Mails, nicht im CSV (dort steht nur der Grund). In der Auskunft an die Person steht sie, bei einer Kontolöschung fällt
sie auf der Website weg. Liefert Dolibarr die beiden Felder nicht, steht „bezahlt mit Abzug“ ohne Grund da. Ältere Belege bekommen
den Stand beim nächsten Nachlesen, ohne dass ihr etwas tun müsst.

**Welcher Weg in der Kassa?** Ein Hinweis aus der Praxis, keine Steuerberatung. Im Zweifel Kassier, Rechnungsprüfung oder
Steuerberatung fragen.

| Was passiert ist | Weg in Dolibarr | Auf der Website |
| --- | --- | --- |
| Leistung fiel weg oder die Rechnung war zu hoch (Begleitperson kam nicht) | Teil-Gutschrift über den Betrag, auf die Rechnung anwenden | bezahlt, sobald der Rest gezahlt ist; die Gutschrift steht dabei |
| Verein übernimmt das Essen wegen eines Gewinns | Teil-Gutschrift mit dem Grund im Text, auf die Rechnung anwenden | wie oben |
| Festes Preisgeld wird verrechnet | Zahlung als Verrechnung, das Preisgeld als Ausgabe buchen | bezahlt; die Verrechnung zählt wie jede gebuchte Zahlung, auch für die Erstattungsgrenze |
| Echter Nachlass, Kleinbetrag bewusst erlassen | „Bezahlt (mit Abzug)“ mit Grund und Anmerkung | bezahlt mit Abzug, Betrag als erlassen |

Eine Gutschrift, die nicht auf die Rechnung angewendet ist, lässt den Rest offen. Freigegebene Rechnungen nicht löschen, nur
Entwürfe dürfen weg.

**Entwurf in Dolibarr gelöscht (#2226).** Antwortet Dolibarr bei einem Entwurf mit „nicht gefunden“ und findet ihn auch über die
Auftragskennung nicht, gilt der Beleg als entfernt: Er verschwindet aus „Angelegte Rechnungen“ und den Summen, ein Prüffall dazu
ist erledigt, das steht im Protokoll und im Verlauf. Die Anmeldung bleibt, nur ohne Beleg. Neu angelegt wird nichts von selbst:
Der Auftrag steht bei den offenen mit **Freigeben** (legt einen neuen Beleg an) und **Keine neue Rechnung** (beendet den Auftrag,
die Person sieht den Betrag als storniert). Bis dahin ändert die Begleitpersonen nur die Turnierleitung. War die Buchung schon storniert, ist er ohne weiteres Zutun zu Ende. Wurde die Buchung
nach dem Beleg geändert, bleibt dieser Prüffall offen: Vor dem Freigeben den Preis prüfen. Ein Verbindungsfehler oder die
Fehlerseite eines Webservers davor beweisen nichts, dann bleibt alles, wie es ist. Bei einem **freigegebenen** Beleg bleibt es beim
Prüffall unten.

**Prüffälle.** Wenn Buchung und Beleg auseinanderlaufen, ändert die Website nichts – weder in
Dolibarr noch am eingefrorenen Preis. Sie legt einen Prüffall an und sagt, was zu tun ist:

| Prüffall | Wann | Was ihr tut |
| --- | --- | --- |
| Storniert, Beleg existiert | jemand sagt ab, die Rechnung ist schon da | Entwurf in Dolibarr löschen oder Gutschrift mit Bezug anlegen; bezahltes Geld erstatten |
| Buchung nach dem Beleg geändert | Begleitpersonen ändern sich nach der Rechnung; eine stornierte Anmeldung kommt zurück („Anmeldung wieder aktiviert“ durch die Leitung, „Nach Storno selbst neu angemeldet“, beim Turnier auch „Nach Storno von der Warteliste nachgerückt“, #2368) | in Dolibarr korrigieren (Gutschrift + neuer Beleg oder Nachberechnung) oder den Beleg stehen lassen; der Fall nennt alt und neu. Ein zweiter Auftrag entsteht nicht; der Fall „Storniert, Beleg existiert“ dazu bleibt offen – gilt der Beleg weiter, mit Grund erledigen („wieder angemeldet“). Ist der Beleg schon voll gutgeschrieben oder aufgegeben, gilt er nicht mehr: kein Prüffall, die Rückkehr bekommt einen neuen Auftrag zum aktuellen Preis |
| Gutschrift-Entwurf trotz Rückkehr | die Person meldet sich wieder an, während oder nachdem die Website den vorgemerkten Gutschrift-Entwurf angelegt hat | der Beleg gilt weiter: den Gutschrift-Entwurf in Dolibarr löschen, dann Fall mit Grund erledigen. Ein offener Fall „Storniert, Beleg existiert“ zum selben Auftrag erledigt sich dabei von selbst |
| Überzahlung | mehr bezahlt als verlangt | Differenz erstatten oder als Spende vereinbaren |
| Zahlung auf stornierte Buchung | Geld kommt für eine abgesagte Anmeldung | nicht reaktivieren – erstatten oder klären |
| Betrag weicht ab | der Beleg in Dolibarr lautet auf einen anderen Betrag als der eingefrorene Preis | Beleg prüfen; wenn richtig, Fall mit Grund erledigen |
| Empfänger weicht ab | der Beleg hängt an einem anderen Geschäftspartner | Zuordnung prüfen |
| Beleg nicht mehr in Dolibarr | Dolibarr kennt die Nummer eines freigegebenen Belegs nicht mehr | nachsehen; die Website legt keinen zweiten an |

Ein Fall wird **mit Grund** erledigt („Gutschrift GA2026-0003 angelegt, 20 € am 24.09.
überwiesen“). Sieht der Abgleich, dass Dolibarr den Fall aufgelöst hat (Gutschrift über den
ganzen Betrag, Beleg aufgegeben, Betrag stimmt wieder), erledigt er ihn selbst und schreibt das
dazu. Offene Prüffälle stehen als Aufgabe auf der Admin-Startseite (nur für Finanzen). Der Umschalter
**Offen/Erledigt** in Finanzen zeigt die erledigten als Nachweis: wer, wann, mit welchem Grund. Zähler und
Liste folgen derselben Auswahl (Art, Veranstaltung, Person).

**Gutschrift-Entwurf bei Abmeldung (#843, Schalter in Finanzen, Vorgabe aus).** Mit dem Haken
„Gutschrift-Entwurf bei Abmeldung anlegen“ legt die Website nach einer Abmeldung mit freigegebenem
Beleg in Dolibarr **einen Entwurf** über den ganzen Betrag an – mit Bezug auf den Beleg und denselben
Zeilen. Der Prüffall nennt den Entwurf; ihr prüft (Teilbetrag?) und gebt ihn frei, danach erledigt
der Abgleich den Fall von selbst. Die Website gibt **nie** eine Gutschrift frei.

- Die Abmeldung merkt den Entwurf nur vor; angelegt wird er beim nächsten Abgleich.
- Ist der Beleg noch Entwurf, gibt es keine Gutschrift – der Fall sagt „in Dolibarr löschen“.
- Gibt es in Dolibarr schon eine Gutschrift zum Beleg, wird sie übernommen, keine zweite angelegt.
- Scheitert das Anlegen, steht der Grund am Fall; nach drei Versuchen legt ihr ihn von Hand an.
- Haken aus: wie bisher, vorgemerkte und noch nicht angelegte Entwürfe fallen weg.
- Kommt die Person zurück, bevor der Entwurf angelegt ist (#2184: selbst neu angemeldet oder von der Leitung wieder aktiviert),
  fällt die Vormerkung weg: Die Buchung gilt am Auftrag wieder als gebucht, eine Zahlung ist dann keine „Zahlung auf stornierte
  Buchung“, und die Summen zählen sie wieder. Wird der Beleg (noch Entwurf) danach in Dolibarr gelöscht, wartet der Auftrag auf
  **Freigeben** oder **Keine neue Rechnung**, statt mit dem Storno zu enden. Der Verlauf des Auftrags zeigt jeden Storno und jede
  Rückkehr („Buchung wieder aufgenommen“) mit Grund.
- Liegt der Gutschrift-Entwurf der Website schon in Dolibarr (oder entsteht er gerade, während die Person zurückkommt), bleibt er
  am Auftrag vermerkt, und es öffnet sich der Prüffall **Gutschrift-Entwurf trotz Rückkehr**: Der Beleg gilt weiter, löscht den
  Entwurf in Dolibarr.
- Weil der Auftrag diesen Entwurf weiter vermerkt, merkt die Website bei einem **erneuten Storno** keine neue Gutschrift vor. Habt
  ihr den Entwurf gelöscht, legt bei einem erneuten Storno die Gutschrift von Hand an (der Fall „Storniert, Beleg existiert“ sagt es).
- Ein Auftrag schreibt seinen Beleg nur an die Anmeldung, solange sie seinen eingefrorenen Preis trägt; nach einer Rückkehr mit neuem
  Auftrag bleibt ein alter, gutgeschriebener Beleg so beim alten Auftrag. Altaufträge ohne Preis-Kennung (von vor #1184) gleicht der
  Abgleich weiter nur über die Anmeldung ab.

**Gutschrift ≠ Erstattung.** Die Gutschrift gleicht den Beleg in Dolibarr aus. Erstattet ist erst,
was tatsächlich zurücküberwiesen (oder bar zurückgegeben) wurde – das haltet ihr im Detail des
Auftrags fest: Betrag, Tag, Referenz, Grund. Nie mehr als bezahlt abzüglich schon erstattet – das
gilt auch, wenn zwei Leute im selben Moment eintragen: zusammen kommen sie nie über den bezahlten
Betrag (#1034). Wird dieselbe Eingabe nochmals abgeschickt (Antwort ging verloren, erneut
geklickt), bleibt es bei einem Eintrag; jede geänderte Eingabe ist eine neue Erstattung. Die
Website löst keine Überweisung aus. Der Verlauf je Auftrag zeigt beides getrennt: Zahlungen,
Gutschriften, Erstattungen, Storno, Prüffälle, Freigaben.

**Summen je Veranstaltung** (Filter „Veranstaltung“ in der Finanzübersicht): gebucht, fakturiert,
bezahlt, offen, gutgeschrieben, erlassen (sobald es etwas gibt), erstattet – jede Belegrevision zählt einmal, stornierte
Aufträge ohne Beleg zählen nicht mit. **CSV** exportiert die angelegten Belege für den Kassier – nur
Nummer, Tag des Anlegens, Angebot, Person, Beträge, Grund des Abschlusses, Stand; keine Adressen, Bankdaten, Anmerkungen oder Dolibarr-Nummern.
Die Datei kommt vom Server (#2131) und ist **vollständig**: Die Liste auf der Seite zeigt höchstens 250
Rechnungen und 200 offene Aufträge und sagt „N von M“; der Export hat keine Grenze. **Export von/bis**
wählt einen Zeitraum nach dem Tag, an dem die Website den Beleg angelegt hat (Wiener Uhr). Das Rechnungsdatum in
Dolibarr kann davon abweichen, etwa bei einem Beleg zum Jahreswechsel: Maßgeblich für die Buchhaltung bleibt Dolibarr. Die
Beträge stehen wie auf der Seite; jeder Export steht mit Auswahl und Zeilenzahl im Protokoll.

**Steuersätze bestätigt.** Was je Steuerprofil auf den Beleg käme (ohne Umsatzsteuer 0 %,
Normalsatz 20 %, ermäßigt 10 %), steht unter Admin → Finanzübersicht → Rechnungsangaben. Der Haken
„Steuersätze geprüft“ (Kassier oder Steuerberatung, mit Name und Tag) ist – neben den
Konditionen – Voraussetzung für „Rechnungen gleich freigeben“. Ohne ihn bleibt jeder Beleg
Entwurf; wird er zurückgenommen, geht das automatische Freigeben mit aus.

## Was hängt: drei Blicke für den Kassier (#842)

In **Finanzen** stehen über den angelegten Rechnungen drei Knöpfe mit Zahl. Ein Klick zeigt nur
diese Belege, der **CSV-Export** folgt der Auswahl (Dateiname mit dem Blick), und jeder Beleg hat den
Link **„In Dolibarr“** zur Rechnungskarte. Ohne Treffer steht dort „Alles in Ordnung“.

- **PDF fehlt:** freigegeben, aber kein bestätigtes PDF (siehe oben, „Fehlende PDFs nachziehen“).
- **Entwurf seit mehr als 7 Tagen:** angelegt, aber noch nicht freigegeben.
- **Überfällig:** Zahlungsziel vor heute (Wiener Tag), Rest offen – auch teilweise bezahlte. Gerechnet
  wird mit dem Datum, nicht erst nach dem nächsten Abgleich. Bezahlt, bezahlt mit Abzug, gutgeschrieben
  oder aufgegeben ist nie überfällig.
- **Tageszentrale:** „Belege prüfen – 3 überfällig · 1 ohne PDF“ führt direkt zum dringendsten
  Blick. Die Zahlen bekommt nur, wer den Bereich Finanzen hat.

## Wenn etwas schiefgeht

- **Dolibarr antwortet nicht** (Ausfall, Netz): Aufträge bleiben „neu“ und werden weiter versucht,
  nach fünf Fehlversuchen „gescheitert“ – Text lesen, Ursache beheben, „Erneut versuchen“. Der
  Abgleich der Belege meldet den Fehler am Beleg und versucht es beim nächsten Lauf wieder.
- **Recht fehlt** (403): Text nennt das Recht; beim Website-Benutzer in Dolibarr setzen.
- **PDF fehlt** am Beleg: Grund am Auftrag lesen (meist das Recht „Rechnungen
  erstellen/bearbeiten“ oder die PDF-Vorlage für Rechnungen in Dolibarr), beheben, dann
  „Fehlende PDFs nachziehen“ – oder auf den Abgleich warten.
- **Antwort verloren** (Beleg angelegt, Website hat es nicht mehr gespeichert): Der nächste Lauf
  findet den Beleg über die Auftragskennung (`ref_ext`) wieder – es entsteht nie ein zweiter.
- **Falsche Zuordnung**: In Dolibarr richtigstellen; der Abgleich meldet „Empfänger weicht ab“,
  bis der Beleg am erwarteten Geschäftspartner hängt oder ihr den Fall mit Grund erledigt.
- **Notschalter**: Haken „Schreibzugriff einschalten“ (Admin → Dolibarr) aus → die Website legt
  nichts mehr an, liest aber weiter; nichts geht verloren, Aufträge warten. Modus „Vorschau“
  stoppt auch das Lesen der Belege.
- **Nach Restore oder Replay**: Vor dem Wiedereinschalten „Alles abgleichen“ laufen lassen –
  vorhandene Belege werden über die Auftragskennung erkannt, es entstehen keine Doppelbelege.

## Aufbewahrung und Kontolöschung

Belege und Zahlungen leben in Dolibarr (dort gilt die Aufbewahrung der BAO, sieben Jahre). Die
Website hält je Auftrag nur Betrag, Positionen, Belegnummer, Zahlungsstand, Grund und Anmerkung des
Abschlusses und Zeitpunkte. Löscht jemand sein Konto, bleibt der Auftrag mit Betrag, Belegnummer und Grund
(Nachweis gegenüber Dolibarr), verliert aber Name, E-Mail und die Anmerkung; die Zuordnung Konto ↔ Geschäftspartner fällt weg. Der Verlauf
enthält keine Bankdaten – sie stehen nie auf der Website.

## Was noch nicht geht

- **Mahnwesen-Stand aus Dolibarr** (Mahnstufe, Gebühren) auf der Website – wartet auf die API des
  Moduls dolibarr-mahnwesen; bis dahin: in Dolibarr nachsehen.
- **Einzelrechnungen je Spieler** bei Team-Startgeldern; Preisgelder (#323).
- **Online-Zahlung** (Zahlungsanbieter) – bewusst nicht; Überweisung mit Zahlungsziel.

## Was ihr in Dolibarr einrichtet

Entscheidung des Betreibers (22.09.): **ein** Website-Benutzer in Dolibarr macht alles – lesen
und schreiben. Der Haken „Schreibzugriff einschalten“ ist die Sicherung.

1. Beim Website-Benutzer (kein Administrator) diese Rechte setzen:
   - Geschäftspartner: einsehen, erstellen/bearbeiten, „Zugriff auf alle Geschäftspartner und
     deren Objekte erweitern“ – sonst darf er für niemanden eine Rechnung anlegen.
   - Rechnungen: einsehen, erstellen/bearbeiten – das braucht Dolibarr auch, um das PDF zu
     erzeugen. **Nicht:** Zahlungen erstellen, löschen.
   - Produkte und Leistungen: einsehen. Mitglieder: einsehen. Bank: einsehen (für die Kontenliste
     bei den Rechnungskonditionen – sonst Nummer eintippen).
   - Vereine (Österreich): die vier Rechte des Moduls, darunter „Mitglieder und Geschäftspartner
     verknüpfen und abgleichen“.
2. Admin → Dolibarr → Funktionen: Schalter **Rechnungen schreiben** an (nur System).
   Der Modus muss auf „Live“ stehen. Ohne Schalter schreibt die Website nichts.
3. Der Kassier trägt unter **Admin → Finanzübersicht → Rechnungsangaben** (#1358) ein:
   Zahlungsziel 30 Tage, Zahlungsart Banküberweisung, Bankkonto Girokonto („Vorschlag
   übernehmen“, Konto prüfen), die Sprache der PDFs und den Haken „Steuersätze geprüft“. Dafür
   reicht der Bereich Finanzen; Adresse, Schlüssel und Modus sieht er nicht. Fehlt die
   Kontenliste, dem Website-Benutzer das Recht „Bank: einsehen“ geben oder die Nummer eintippen.
4. Haken **Rechnungen gleich freigeben** (ebenfalls unter Rechnungsangaben) erst setzen, wenn ein
   paar Entwürfe in Dolibarr geprüft sind und die Zeilen stimmen (Steuer, Leistung, Text). Er
   geht erst mit vollständigen Angaben und geprüften Steuersätzen.
5. Steuer: Das Steuerprofil je Position („ohne Umsatzsteuer“, „Normalsatz“, „ermäßigt“) ist ein
   Buchhaltungsentscheid. Für einen gemeinnützigen Verein ohne Umsatzsteuerpflicht bleibt es bei
   „ohne Umsatzsteuer“ – im Zweifel den Steuerberater fragen. Mit Steuer rechnet die Website den
   Nettopreis aus dem Bruttobetrag; Dolibarr rundet selbst – deshalb erst Entwürfe prüfen.
6. Optional bleibt ein eigener Schlüssel eines zweiten Benutzers möglich (Admin → Dolibarr →
   „Optional: eigener Schlüssel“).

## Wer darf was

- **Finanzen** (Bereich): Kosten an Events und Startgelder an Turnieren pflegen,
  Finanzübersicht sehen, Aufträge freigeben, Prüffälle erledigen, Erstattungen festhalten,
  Belege nachlesen und exportieren. Club-Admin und Superadmin haben ihn; anderen gibt ihn der
  Superadmin unter Admin → Alle Benutzer als Freigabe. Wie jeder Adminbereich verlangt er
  Zwei-Faktor; jede dieser Aktionen steht mit Person und Grund im Audit-Log.
- **Steuersätze bestätigen** und die Dolibarr-Anbindung selbst (Adresse, Schlüssel, Schreibzugriff)
  gehören zum Bereich **System** – Finanzen sieht die Anbindung, ändert sie nicht.
- **Turnierleitung** bearbeitet Events und Turniere weiterhin – ohne den Bereich Finanzen sieht
  sie die Abschnitte „Kosten und Abrechnung“ und „Startgeld“ nicht, und der Server lehnt
  Änderungen daran ab.
- Die Teilnehmerliste zeigt keine Beträge; der eigene Preis steht nur bei der eigenen Anmeldung.
