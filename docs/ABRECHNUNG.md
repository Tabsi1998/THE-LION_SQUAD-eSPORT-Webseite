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
Zahlungsart und Bankkonto aus Admin → Dolibarr → „Schreibzugriff“ → Rechnungskonditionen. Die
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

**Turnier im Event.** Hängt das Turnier an einem Event, dessen Kostenbeitrag das Startgeld schon
enthält, setzt ihr im Abschnitt „Startgeld“ den Haken „Im Eventbeitrag enthalten“ – dann zeigt
das Turnier kein Startgeld und es entsteht keine zweite Rechnung.

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
| Überzahlung | mehr Geld als der Beleg verlangt → Prüffall |
| gutgeschrieben | eine Gutschrift in Dolibarr deckt den Beleg |
| aufgegeben | in Dolibarr als uneinbringlich/aufgegeben markiert |

Bei jedem Beleg steht, wie frisch der Stand ist („Stand 23.09., 11:40“). Konnte Dolibarr nicht
lesen, steht der Grund dort – nichts wird still alt.

**Prüffälle.** Wenn Buchung und Beleg auseinanderlaufen, ändert die Website nichts – weder in
Dolibarr noch am eingefrorenen Preis. Sie legt einen Prüffall an und sagt, was zu tun ist:

| Prüffall | Wann | Was ihr tut |
| --- | --- | --- |
| Storniert, Beleg existiert | jemand sagt ab, die Rechnung ist schon da | Entwurf in Dolibarr löschen oder Gutschrift mit Bezug anlegen; bezahltes Geld erstatten |
| Buchung nach dem Beleg geändert | Begleitpersonen ändern sich nach der Rechnung | in Dolibarr korrigieren (Gutschrift + neuer Beleg oder Nachberechnung); der Fall nennt alt und neu |
| Überzahlung | mehr bezahlt als verlangt | Differenz erstatten oder als Spende vereinbaren |
| Zahlung auf stornierte Buchung | Geld kommt für eine abgesagte Anmeldung | nicht reaktivieren – erstatten oder klären |
| Betrag weicht ab | der Beleg in Dolibarr lautet auf einen anderen Betrag als der eingefrorene Preis | Beleg prüfen; wenn richtig, Fall mit Grund erledigen |
| Empfänger weicht ab | der Beleg hängt an einem anderen Geschäftspartner | Zuordnung prüfen |
| Beleg nicht mehr in Dolibarr | Dolibarr kennt die Nummer nicht mehr | nachsehen; die Website legt keinen zweiten an |

Ein Fall wird **mit Grund** erledigt („Gutschrift GA2026-0003 angelegt, 20 € am 24.09.
überwiesen“). Sieht der Abgleich, dass Dolibarr den Fall aufgelöst hat (Gutschrift über den
ganzen Betrag, Beleg aufgegeben, Betrag stimmt wieder), erledigt er ihn selbst und schreibt das
dazu. Offene Prüffälle stehen als Aufgabe auf der Admin-Startseite (nur für Finanzen).

**Gutschrift ≠ Erstattung.** Die Gutschrift gleicht den Beleg in Dolibarr aus. Erstattet ist erst,
was tatsächlich zurücküberwiesen (oder bar zurückgegeben) wurde – das haltet ihr im Detail des
Auftrags fest: Betrag, Tag, Referenz, Grund. Nie mehr als bezahlt abzüglich schon erstattet; die
Website löst keine Überweisung aus. Der Verlauf je Auftrag zeigt beides getrennt: Zahlungen,
Gutschriften, Erstattungen, Storno, Prüffälle, Freigaben.

**Summen je Veranstaltung** (Filter „Veranstaltung“ in der Finanzübersicht): gebucht, fakturiert,
bezahlt, offen, gutgeschrieben, erstattet – jede Belegrevision zählt einmal, stornierte Aufträge
ohne Beleg zählen nicht mit. **CSV** exportiert die angelegten Belege für den Kassier – nur
Nummer, Angebot, Person, Beträge, Stand; keine Adressen, Bankdaten oder Dolibarr-Nummern.

**Steuersätze bestätigt.** Was je Steuerprofil auf den Beleg käme (ohne Umsatzsteuer 0 %,
Normalsatz 20 %, ermäßigt 10 %), steht unter Admin → Dolibarr → Schreibzugriff. Der Haken
„Steuersätze geprüft“ (Kassier oder Steuerberatung, mit Name und Tag) ist – neben den
Konditionen – Voraussetzung für „Rechnungen gleich freigeben“. Ohne ihn bleibt jeder Beleg
Entwurf; wird er zurückgenommen, geht das automatische Freigeben mit aus.

## Wenn etwas schiefgeht

- **Dolibarr antwortet nicht** (Ausfall, Netz): Aufträge bleiben „neu“ und werden weiter versucht,
  nach fünf Fehlversuchen „gescheitert“ – Text lesen, Ursache beheben, „Erneut versuchen“. Der
  Abgleich der Belege meldet den Fehler am Beleg und versucht es beim nächsten Lauf wieder.
- **Recht fehlt** (403): Text nennt das Recht; beim Website-Benutzer in Dolibarr setzen.
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
Website hält je Auftrag nur Betrag, Positionen, Belegnummer, Zahlungsstand und Zeitpunkte. Löscht
jemand sein Konto, bleibt der Auftrag mit Betrag und Belegnummer (Nachweis gegenüber Dolibarr),
verliert aber Name und E-Mail; die Zuordnung Konto ↔ Geschäftspartner fällt weg. Der Verlauf
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
   - Rechnungen: einsehen, erstellen/bearbeiten. **Nicht:** Zahlungen erstellen, löschen.
   - Produkte und Leistungen: einsehen. Mitglieder: einsehen. Bank: einsehen (für die Kontenliste
     bei den Rechnungskonditionen – sonst Nummer eintippen).
   - Vereine (Österreich): die vier Rechte des Moduls, darunter „Mitglieder und Geschäftspartner
     verknüpfen und abgleichen“.
2. Admin → Dolibarr → „Schreibzugriff für Rechnungen“: Haken **Schreibzugriff einschalten**.
   Der Modus muss auf „Live“ stehen. Ohne Haken schreibt die Website nichts.
3. Dort **Rechnungskonditionen** eintragen: Zahlungsziel 30 Tage, Zahlungsart Banküberweisung,
   Bankkonto Girokonto („Vorschlag übernehmen“, Konto prüfen). Fehlt die Kontenliste, dem
   Website-Benutzer das Recht „Bank: einsehen“ geben oder die Nummer eintippen.
4. Haken **Rechnungen gleich freigeben** erst setzen, wenn ein paar Entwürfe in Dolibarr geprüft
   sind und die Zeilen stimmen (Steuer, Leistung, Text). Er geht erst mit vollständigen
   Konditionen.
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
