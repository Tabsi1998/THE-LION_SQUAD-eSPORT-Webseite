# Turnier-Strukturen und Custom-Brackets

Stand: 2026-05-08

Diese Datei beschreibt die flexible Turnierstruktur fuer THE LION SQUAD eSports.
Fuer neue Turniere soll die Struktur ueber den Admin-Tab `Struktur` gepflegt
werden. Die alte klassische Bracket-Generierung bleibt nur als Fallback fuer
bestehende einfache 1v1-Turniere.

## Schnellstart im Admin

1. Turnier erstellen oder oeffnen.
2. Tab `Struktur` oeffnen.
3. Vorlage waehlen, z.B. `Mario Kart 8 Spieler` oder `Mario Kart 32 Spieler`.
4. Werte pruefen:
   - `Match-Typ`: `FFA` fuer 3+ Spieler pro Match, `Duel` fuer 1v1.
   - `Stage-Typ`: `Single Elimination` fuer normalen 1v1-Baum ohne Schema,
     fuer frei konfigurierbare Baeume meistens `FFA Custom Bracket`.
   - `Matchgroesse`: z.B. `4` fuer Mario Kart.
   - `Qualifizierte`: z.B. `2`, wenn Platz 1 und 2 weiterkommen.
   - `Matchdauer Min.`: Standarddauer je Match/Heat fuer Zeitplan und Reminder.
5. `Stage speichern`.
6. Optional `Vorschau` klicken. Dadurch wird der komplette Baum ohne Teilnehmer
   erzeugt, damit man Struktur, Runden und maximale Kapazitaet vorab zeigen kann.
7. Kurz vor Start oder nach Check-in `Mit Teilnehmern generieren` klicken. Eine
   reine Vorschau wird dabei automatisch ersetzt.
8. Im selben Tab Ergebnisse je Match eintragen: Rank, Score, DNF, Forfeit.

Wenn ein Ergebnis Folgematches aendert, die bereits gefuellt sind, fragt die UI
bewusst nach einer Force-Korrektur. Das verhindert versehentliches Ueberschreiben.

## Vorschau vs. echtes Bracket

Die Vorschau ist fuer Planung und Vorstellung gedacht:

- Sie nutzt das Schema, aber keine echten Teilnehmer.
- Seeds werden als Platzhalter angezeigt.
- Es werden keine Ergebnisse erfasst.
- Sie kann vor dem Turnier beliebig neu erzeugt werden.

Das echte Bracket wird mit Teilnehmern erzeugt:

- Es nutzt approved/checked-in Anmeldungen.
- Seeds werden mit echten Registrierungen belegt.
- Ergebnisse fuellen Folgematches automatisch.
- Wenn bereits echte Matches oder Reports existieren, ist zum Ersetzen bewusst
  `force=true` bzw. die Sicherheitsabfrage in der UI noetig.

Klassische 1v1-Turniere ohne Stage koennen im Turnierkopf ebenfalls per
`Vorschau` oder `Bracket generieren` erzeugt werden. Beim Statuswechsel auf
`Live` wird ein noch fehlendes klassisches Bracket automatisch erzeugt; eine
reine Vorschau wird dabei ersetzt.

## Manuelle Teilnehmer und No-Show-Ersatz

Im Admin-Tab `Teilnehmer` kann Turnierleitung Teilnehmer manuell hinzufuegen:

- bevorzugt mit Account-Auswahl, damit Check-in, Match-Hub und E-Mail-Reminder
  funktionieren;
- als Gast/manuell nur fuer Sonderfaelle vor Ort;
- optional mit Seed und Startstatus;
- optional als Ersatz fuer eine `No-Show`-Anmeldung.

Wenn beim Hinzufuegen `Ersetzt No-Show` gewaehlt wird, markiert das System die
alte Anmeldung als `no_show` und ersetzt offene Match-Slots durch den neuen
Teilnehmer. Abgeschlossene Matches werden nicht automatisch umgeschrieben.

## Match-Zeitplanung und Reminder

Turniere und Stages haben eine Standarddauer in Minuten. Einzelne Matches oder
Heats koennen trotzdem separat geplant werden:

- `scheduled_at` legt fest, wann das Match starten soll.
- `duration_minutes` beschreibt die erwartete Dauer.
- Der Reminder-Scheduler beruecksichtigt klassische Matches und v2-Heats.
- Reminder werden nur an Teilnehmer mit Account/E-Mail gesendet.

## Schema-Grundidee

Ein Schema besteht aus Sections und Match-Zeilen.

```text
[WB]
A=[1,2,3,4]
B=[5,6,7,8]
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
```

Bedeutung:

- `[WB]`: Section, z.B. Winner Bracket.
- `[LB]`: Section, z.B. Loser Bracket.
- `A=[1,2,3,4]`: Match A bekommt Seed 1 bis 4.
- `W:A:1`: Platz 1 aus Match A kommt hier rein.
- `W:A:2`: Platz 2 aus Match A kommt hier rein.
- `L:A:3`: Platz 3 aus Match A kommt ins Loser Bracket.
- `L:A:4`: Platz 4 aus Match A kommt ins Loser Bracket.
- `R:A:1`: direkter Rank-Bezug, falls weder Winner noch Loser semantisch passt.

Kommentare mit `#` sind erlaubt und werden als Rundennamen genutzt.

```text
# Round 1 (32 -> 16)
A=[1,2,3,4]
```

## Slot-Quellen

| Ausdruck | Bedeutung |
| --- | --- |
| `1` | Seed 1 aus der Teilnehmerliste |
| `2` | Seed 2 |
| `W:A:1` | Rank 1 aus Match A |
| `W:A:2` | Rank 2 aus Match A |
| `L:A:3` | Rank 3 aus Match A |
| `L:A:4` | Rank 4 aus Match A |
| `R:A:1` | Rank 1 aus Match A ohne Winner/Loser-Wertung |
| `bye` | Freilos / leerer Slot |

## Validierung

Beim Generieren prueft das System:

- Schema ist nicht leer.
- Match-Keys sind eindeutig.
- Referenzen zeigen auf bekannte Matches.
- Ein Match referenziert sich nicht selbst.
- Es gibt keine Zyklen.
- Seed-Slots werden anhand der Anmeldungen belegt.

Beim Speichern eines Ergebnisses prueft das System:

- Alle belegten Slots haben genau ein Ergebnis.
- Teilnehmer gehoeren wirklich zu diesem Match.
- Ranks sind eindeutig.
- Ranks sind fortlaufend, z.B. 1 bis 4.
- Scores/Punkte und Zeiten sind nicht negativ.

## Mario Kart Beispiel mit 32 Spielern

```text
[WB]
# Round 1 (32 -> 16)
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
E=[17,18,19,20]
F=[21,22,23,24]
G=[25,26,27,28]
H=[29,30,31,32]

# Round 2 (16 -> 8)
I=[W:A:1,W:A:2,W:B:1,W:B:2]
J=[W:C:1,W:C:2,W:D:1,W:D:2]
K=[W:E:1,W:E:2,W:F:1,W:F:2]
L=[W:G:1,W:G:2,W:H:1,W:H:2]

# Round 3 (8 -> 4)
M=[W:I:1,W:I:2,W:J:1,W:J:2]
N=[W:K:1,W:K:2,W:L:1,W:L:2]

# Winner Final
O=[W:M:1,W:M:2,W:N:1,W:N:2]

[LB]
# Round 1 (16 -> 8)
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
LB=[L:C:3,L:C:4,L:D:3,L:D:4]
LC=[L:E:3,L:E:4,L:F:3,L:F:4]
LD=[L:G:3,L:G:4,L:H:3,L:H:4]

# Round 2 (8 -> 4)
LE=[W:LA:1,W:LA:2,W:LB:1,W:LB:2]
LF=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]

# Loser Final
LG=[W:LE:1,W:LE:2,W:LF:1,W:LF:2]
```

## Seeding

Die Seeds kommen aus den Turnier-Anmeldungen:

- `random`: Teilnehmer werden gemischt.
- `manual`: Teilnehmer werden nach `seed` sortiert.
- `ranking`: nutzt ebenfalls gesetzte Seeds als Ranking-Reihenfolge.

Wenn weniger Teilnehmer vorhanden sind als Seeds im Schema, bleiben die fehlenden
Slots als `bye` leer.

## Betrieb am Eventtag

1. Teilnehmer pruefen und Check-ins setzen.
2. Struktur generieren.
3. Auf der Public-Bracketseite oder TV-Ansicht die Heats anzeigen.
4. Nach jedem Match im Admin-Tab `Struktur` die Platzierungen erfassen.
5. Das System fuellt Folgematches automatisch.
6. Bei Korrekturen vorher pruefen, ob Folgematches schon gespielt wurden.

## Was noch bewusst getrennt bleibt

- Alte klassische Matches existieren noch fuer vorhandene 1v1-Turniere.
- Neue flexible Turniere sollen ueber `Struktur` laufen.
- Vollstaendige Undo-Cascade fuer bereits gespielte Folgematches ist noch ein
  separater Sicherheitsausbau.
