# Turnier-Strukturen und freie Turnierbaeume

Stand: 2026-05-08

Diese Datei beschreibt die flexible Turnierstruktur fuer THE LION SQUAD eSports.
Fuer neue Turniere soll die Struktur ueber den Admin-Tab `Struktur` gepflegt
werden. Die alte klassische Turnierbaum-Generierung bleibt nur als Fallback fuer
bestehende einfache 1v1-Turniere.

## Schnellstart im Admin

1. Turnier erstellen oder oeffnen.
2. Tab `Struktur` oeffnen.
3. Vorlage waehlen, z.B. `Mario Kart 8 Spieler` oder `Mario Kart 32 Spieler`.
4. Werte pruefen:
   - `Spieltyp`: `Mehrspieler` fuer 3+ Spieler pro Spiel, `Duell` fuer 1v1.
   - `Struktur-Typ`: `Einzelausscheidung` fuer normalen 1v1-Baum ohne Schema,
     fuer frei konfigurierbare Baeume meistens `Mehrspieler freier Turnierbaum`.
   - `Spielgroesse`: z.B. `4` fuer Mario Kart.
   - `Qualifizierte`: z.B. `2`, wenn Platz 1 und 2 weiterkommen.
   - `Spieldauer Min.`: Standarddauer je Spiel/Durchgang fuer Zeitplan und Erinnerung.
5. `Phase speichern`.
6. Optional `Vorschau` klicken. Dadurch wird der komplette Baum ohne Teilnehmer
   erzeugt, damit man Struktur, Runden und maximale Kapazitaet vorab zeigen kann.
7. Kurz vor Start oder nach Check-in `Mit Teilnehmern generieren` klicken. Eine
   reine Vorschau wird dabei automatisch ersetzt.
8. Im selben Tab Ergebnisse je Spiel eintragen: Platz, Punkte, nicht beendet oder Wertung.

Wenn ein Ergebnis Folgematches aendert, die bereits gefuellt sind, fragt die UI
bewusst nach einer Force-Korrektur. Das verhindert versehentliches Ueberschreiben.

## Vorschau vs. echter Turnierbaum

Die Vorschau ist fuer Planung und Vorstellung gedacht:

- Sie nutzt das Schema, aber keine echten Teilnehmer.
- Setzplaetze werden als Platzhalter angezeigt.
- Es werden keine Ergebnisse erfasst.
- Sie kann vor dem Turnier beliebig neu erzeugt werden.

Der echte Turnierbaum wird mit Teilnehmern erzeugt:

- Es nutzt approved/checked-in Anmeldungen.
- Setzplaetze werden mit echten Registrierungen belegt.
- Ergebnisse fuellen Folgematches automatisch.
- Wenn bereits echte Spiele oder Berichte existieren, ist zum Ersetzen bewusst
  `force=true` bzw. die Sicherheitsabfrage in der UI noetig.

Klassische 1v1-Turniere ohne Phase koennen im Turnierkopf ebenfalls per
`Vorschau` oder `Turnierbaum generieren` erzeugt werden. Beim Statuswechsel auf
`Live` wird ein noch fehlender klassischer Turnierbaum automatisch erzeugt; eine
reine Vorschau wird dabei ersetzt.

## Manuelle Teilnehmer und No-Show-Ersatz

Im Admin-Tab `Teilnehmer` kann Turnierleitung Teilnehmer manuell hinzufuegen:

- bevorzugt mit Konto-Auswahl, damit Check-in, Spiel-Hub und E-Mail-Erinnerungen
  funktionieren;
- als Gast/manuell nur fuer Sonderfaelle vor Ort;
- optional mit Setzplatz und Startstatus;
- optional als Ersatz fuer eine `Nicht erschienen`-Anmeldung.

Wenn beim Hinzufuegen `Ersetzt Nicht-Erschienen` gewaehlt wird, markiert das System die
alte Anmeldung als `no_show` und ersetzt offene Spielplaetze durch den neuen
Teilnehmer. Abgeschlossene Spiele werden nicht automatisch umgeschrieben.

## Spiel-Zeitplanung und Erinnerungen

Turniere und Phasen haben eine Standarddauer in Minuten. Einzelne Spiele oder
Durchgaenge koennen trotzdem separat geplant werden:

- `scheduled_at` legt fest, wann das Spiel starten soll.
- `duration_minutes` beschreibt die erwartete Dauer.
- Der Erinnerungsdienst beruecksichtigt klassische Spiele und flexible Durchgaenge.
- Erinnerungen werden nur an Teilnehmer mit Konto/E-Mail gesendet.
- Spiel-Erinnerungen laufen bei 24h, 2h, 30m, 10m und 5m vor Spielstart.
- Wenn eine Station zugewiesen ist, steht sie in der Spiel-Erinnerung.

## Check-in-Erinnerungen

Der Scheduler verschickt operative Check-in-Hinweise an angemeldete, noch nicht
eingecheckte Teilnehmer:

- 10 Minuten bevor der Check-in startet.
- Direkt wenn der Check-in offen ist.
- 10 Minuten bevor der Check-in endet.

Alle Check-in-Mails nutzen den Turnier-Link und respektieren die persoenlichen
E-Mail-Einstellungen fuer Turnier-Updates.

## Stationen

Stationen werden im Adminbereich angelegt und koennen klassischen Spielen sowie
flexiblen Durchgaengen zugewiesen werden. Eine Zuweisung setzt die Station auf `reserved`; das
Spiel bleibt geplant/bereit und kann dadurch schon vorab in Erinnerungen mit
Station erscheinen. Wird `start_now=true` ueber die API genutzt, wird das Spiel
direkt auf `in_progress` gesetzt.

## Schema-Grundidee

Ein Schema besteht aus Bereichen und Spiel-Zeilen.

```text
[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
```

Bedeutung:

- `[WB]`: Bereich, z.B. Siegerbaum.
- `[LB]`: Bereich, z.B. Hoffnungsbaum.
- `A=[1,2,3,4]`: Spiel A bekommt Setzplatz 1 bis 4.
- `W:A:1`: Platz 1 aus Spiel A kommt hier rein.
- `W:A:2`: Platz 2 aus Spiel A kommt hier rein.
- `L:A:3`: Platz 3 aus Spiel A kommt in den Hoffnungsbaum.
- `L:A:4`: Platz 4 aus Spiel A kommt in den Hoffnungsbaum.
- `R:A:1`: direkter Platz-Bezug, falls weder Sieger- noch Hoffnungsbaum semantisch passt.

Kommentare mit `#` sind erlaubt und werden als Rundennamen genutzt.

```text
# Runde 1 (32 -> 16)
A=[1,2,3,4]
```

## Slot-Quellen

| Ausdruck | Bedeutung |
| --- | --- |
| `1` | Setzplatz 1 aus der Teilnehmerliste |
| `2` | Setzplatz 2 |
| `W:A:1` | Platz 1 aus Spiel A |
| `W:A:2` | Platz 2 aus Spiel A |
| `L:A:3` | Platz 3 aus Spiel A |
| `L:A:4` | Platz 4 aus Spiel A |
| `R:A:1` | Platz 1 aus Spiel A ohne Sieger-/Hoffnungs-Wertung |
| `bye` | Freilos / leerer Slot |

## Validierung

Beim Generieren prueft das System:

- Schema ist nicht leer.
- Spiel-Keys sind eindeutig.
- Referenzen zeigen auf bekannte Spiele.
- Ein Spiel referenziert sich nicht selbst.
- Es gibt keine Zyklen.
- Setzplatz-Slots werden anhand der Anmeldungen belegt.

Beim Speichern eines Ergebnisses prueft das System:

- Alle belegten Slots haben genau ein Ergebnis.
- Teilnehmer gehoeren wirklich zu diesem Spiel.
- Plaetze sind eindeutig.
- Plaetze sind fortlaufend, z.B. 1 bis 4.
- Punkte und Zeiten sind nicht negativ.

## Mario Kart Beispiel mit 32 Spielern

```text
[WB]
# Runde 1 (32 -> 16)
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[17,18,19,20]
F=[21,22,23,24]
G=[25,26,27,28]
H=[29,30,31,32]

# Runde 2 (16 -> 8)
I=[W:A:1,W:A:2,W:B:1,W:B:2]
J=[W:C:1,W:C:2,W:D:1,W:D:2]
K=[W:E:1,W:E:2,W:F:1,W:F:2]
L=[W:G:1,W:G:2,W:H:1,W:H:2]

# Runde 3 (8 -> 4)
M=[W:I:1,W:I:2,W:J:1,W:J:2]
N=[W:K:1,W:K:2,W:L:1,W:L:2]

# Sieger-Finale
O=[W:M:1,W:M:2,W:N:1,W:N:2]

[LB]
# Runde 1 (16 -> 8)
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
LB=[L:C:3,L:C:4,L:D:3,L:D:4]
LC=[L:E:3,L:E:4,L:F:3,L:F:4]
LD=[L:G:3,L:G:4,L:H:3,L:H:4]

# Runde 2 (8 -> 4)
LE=[W:LA:1,W:LA:2,W:LB:1,W:LB:2]
LF=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]

# Hoffnungs-Finale
LG=[W:LE:1,W:LE:2,W:LF:1,W:LF:2]
```

## Setzplaetze

Die Setzplaetze kommen aus den Turnier-Anmeldungen:

- `random`: Teilnehmer werden gemischt.
- `manual`: Teilnehmer werden nach `seed` sortiert.
- `ranking`: nutzt ebenfalls gesetzte Setzplaetze als Ranking-Reihenfolge.

Wenn weniger Teilnehmer vorhanden sind als Setzplaetze im Schema, bleiben die fehlenden
Slots als `bye` leer.

## Betrieb am Eventtag

1. Teilnehmer pruefen und Check-ins setzen.
2. Struktur generieren.
3. Auf der oeffentlichen Turnierbaumseite oder TV-Ansicht die Durchgaenge anzeigen.
4. Nach jedem Spiel im Admin-Tab `Struktur` die Platzierungen erfassen.
5. Das System fuellt Folgematches automatisch.
6. Bei Korrekturen vorher pruefen, ob Folgematches schon gespielt wurden.

## Was noch bewusst getrennt bleibt

- Alte klassische Spiele existieren noch fuer vorhandene 1v1-Turniere.
- Neue flexible Turniere sollen ueber `Struktur` laufen.
- Vollstaendige Undo-Cascade fuer bereits gespielte Folgematches ist noch ein
  separater Sicherheitsausbau.
