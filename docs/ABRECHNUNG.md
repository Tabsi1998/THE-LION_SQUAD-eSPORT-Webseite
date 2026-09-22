# Abrechnung: Kosten an Events, Rechnungen aus Dolibarr

Für Vorstand und Kassier: Was die Website kann, was sie noch nicht kann, und was auf eurer
Seite eingerichtet sein muss. Fachlich ist das Epic #314 mit den Paketen #315–#322.

## Was heute geht (Abrechnung I, Teil 1)

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
| neu | gerade angelegt | nichts – der Job sortiert alle zwei Minuten ein |
| wartet auf Schreibzugriff | Dolibarr ist nicht angebunden oder darf nicht schreiben | Schreib-Schlüssel eintragen (siehe unten) |
| wartet auf Geschäftspartner | die Person hat in Dolibarr noch keinen Kunden/Geschäftspartner | kommt mit Teil 2 (automatische Anlage nach Freigabe) |
| bereit | alles da | Teil 2 legt die Rechnung an |
| wartet auf Freigabe | Rechnungszeitpunkt „erst nach Freigabe“ | in der Finanzübersicht „Freigeben“ |
| storniert | Anmeldung storniert, bevor eine Rechnung entstand | nichts |
| gescheitert | dauerhaft ein Fehler | Text lesen, ggf. melden |

Nichts davon geht verloren: Ein Auftrag bleibt stehen, bis die Voraussetzung da ist.

## Was noch nicht geht (Teil 2)

- **Rechnungen in Dolibarr anlegen** (#317): Aus „bereit“ wird ein Beleg in Dolibarr, Entwurf
  oder freigegeben je Einstellung, Nummer und Status kommen zurück, der Beleg erscheint unter
  „Meine Rechnungen“.
- **Geschäftspartner anlegen** (#316): Wer noch keinen Kunden in Dolibarr hat, bekommt einen –
  nur nach bestätigter Zuordnung, nie still aus einer E-Mail-Adresse.
- **Zahlungsabgleich, Storno mit Beleg, Erstattungen** (#321) und **Turnier-Startgelder** (#319).
- **Rechnungen für Nicht-Mitglieder im Konto** (#320).

## Was ihr in Dolibarr einrichtet, bevor Teil 2 kommt

1. **Ein zweiter Dolibarr-Benutzer nur fürs Schreiben**, z. B. `website-rechnungen`, kein
   Administrator. Rechte: Drittparteien lesen und anlegen/ändern; Rechnungen lesen,
   anlegen/ändern, freigeben. Kein Löschen, keine Zahlungen.
2. Bei diesem Benutzer einen **API-Schlüssel erzeugen** und ihn unter Admin → Dolibarr →
   „Schreibzugriff für Rechnungen“ eintragen. Der Lese-Schlüssel des Website-Benutzers bleibt,
   wie er ist – er wird nie zum Schreiben verwendet.
3. **Schreibzugriff einschalten** (Haken). Ohne Haken schreibt die Website nichts, auch mit
   Schlüssel nicht.
4. Steuer: Das Steuerprofil je Position („ohne Umsatzsteuer“, „Normalsatz“, „ermäßigt“) ist ein
   Buchhaltungsentscheid. Für einen gemeinnützigen Verein ohne Umsatzsteuerpflicht bleibt es bei
   „ohne Umsatzsteuer“ – im Zweifel den Steuerberater fragen.

## Wer darf was

- **Finanzen** (neuer Bereich): Kosten an Events pflegen, Finanzübersicht sehen, Aufträge
  freigeben. Club-Admin und Superadmin haben ihn; anderen gibt ihn der Superadmin unter
  Admin → Alle Benutzer als Freigabe. Wie jeder Adminbereich verlangt er Zwei-Faktor.
- **Turnierleitung** bearbeitet Events weiterhin – ohne den Bereich Finanzen sieht sie den
  Abschnitt „Kosten und Abrechnung“ nicht, und der Server lehnt Änderungen daran ab.
- Die Teilnehmerliste zeigt keine Beträge; der eigene Preis steht nur bei der eigenen Anmeldung.
