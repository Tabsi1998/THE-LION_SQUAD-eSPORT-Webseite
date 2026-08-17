# Competition Engine: Konsolidierung von Legacy und Stage

Stand: 17. August 2026

Tracking: GitHub Issue #120, Teil von #95; Live-/UX-Projektionen wirken spaeter in #96.

## Entscheidung

Die Plattform erhaelt genau einen kanonischen Competition-Kern und langfristig
einen Schreibpfad. `legacy` und `v2` sind nur Migrationsbegriffe und duerfen
nicht als drittes oeffentliches API- oder Produktkonzept fortgeschrieben werden.

Der Kern ist kein einzelner Universal-Bracket-Algorithmus. Bracket, Liga,
Round Robin, Swiss, Ladder, FFA und Zeitserien verwenden dasselbe Domainmodell,
aber versionierte Strategien fuer Topologie/Pairing, Matchformat, Ranking,
Seeding, Zeitplanung, Veto und Advancement.

Mehrere normalisierte Collections bleiben moeglich. "Ein System" bedeutet:

- eine fachliche Source of Truth je Wettbewerb;
- einen kanonischen Read- und Write-Vertrag;
- gemeinsame Status-, Ergebnis-, Berechtigungs-, Audit- und Korrekturregeln;
- keine Businesslogik-Duplikate in Web, Mobile, TV oder Admin.

## Verifizierter Bestand

### Aktive Implementierungen

| Bereich | Legacy | Stage (`tournament_stages` / `matches_v2`) |
| --- | --- | --- |
| Matchform | feste A/B-Slots und Score A/B | variable Slots, Rang-/Score-Resultate |
| Automatische Formate | Single, vereinfachtes Double, Round Robin, League | Single, Double, FFA/Simple, Custom Duel/FFA |
| Dynamische Formate | separate Swiss-/Groups-Routen | Stage-Typen vorhanden, Generatoren fehlen |
| Advancement | Winner/Loser-Felder am Match | explizite Rank-Quellen und Zielslots |
| Ergebnisbetrieb | Spieler-Reports, Consensus, Dispute und Forfeit vollstaendiger | generische Rangresultate und Korrekturkaskade, aber Funktionsluecken |
| Nutzung | weiterhin aktiver Schreibpfad | ebenfalls aktiver Schreibpfad |

Neue Single-, Double-, Round-Robin- und Liga-Turniere starten derzeit im
Legacy-Pfad. FFA, Battle Royale und freie Duel-/FFA-Baeume starten als Stage.
Ein Single-/Double-Turnier kann beim spaeteren Struktur-Rebuild bereits von
Legacy nach Stage wechseln. Diese uneinheitliche Lebensdauer ist der zentrale
Grund fuer die Konsolidierung.

### Oeffentlicher Live-Bestand (read-only geprueft)

Drei sichtbare Turniere verwenden bereits die Stage-Engine: zwei freie
FFA-Baeume und ein Single-Elimination-Turnier. Bei der Stichprobe gab es keine
gebrochenen Advancement-Referenzen, doppelten Stage-/Match-Keys, terminalen
Matches ohne Resultate oder Stage-Nummernabweichungen. Diese Dokumente werden
nicht neu generiert; sie sind spaetere Golden-/Shadow-Parity-Faelle.

### Noch nicht paritaetische Verbraucher

Vor einem Cutover muessen mindestens folgende Pfade ueber den kanonischen
Adapter laufen oder nachweislich beide Modelle korrekt behandeln:

- Match-Reporting, Consensus, Dispute, Forfeit und Korrektur;
- Badges, Penalties, Admin-Zaehler und Benutzerstatistiken;
- Profilreferenzen, Datenexport und DSGVO-Loeschung;
- Preise, Abschlussplatzierungen und Jahreswertung;
- Reminder, Notifications, Deep Links und semantische Live-Events;
- Stationen, Widgets, PDFs, TV/Embed und Match-Overview;
- Match- und Turnierchat, Terminproposals und Audit-Kontext.

## Kanonisches Zielmodell

```text
Competition
|- Entry / unveraenderlicher Roster-Snapshot
|- versionierter RuleSet-Snapshot
|- Stage[]
|  |- Group[]
|  |- Round[]
|  |- Match[]
|  |  |- Slot[]             Seed, Winner, Loser, Tabellenrang, manuell
|  |  `- Game/Map/Leg[]
|  |- RankingPolicy
|  |- Pairing/TopologyPolicy
|  |- SchedulingPolicy
|  `- AdvancementRule[]
`- veroeffentlichter FinalStanding-Snapshot
```

Ein Match-Slot referenziert eine deklarative Quelle wie `seed:1`,
`winner:M12`, `loser:M8`, `group:A:rank:2` oder `stage:1:top:8`.
Standardgeneratoren und freie Strukturen erzeugen dieselben Knoten und Kanten.
Ein Grand-Final-Reset ist ein vorab definierter bedingter Folgeknoten, keine
Sondermutation ausserhalb des Graphen.

## Unveraenderliche Regeln

1. Ein Wettbewerb schreibt zu jedem Zeitpunkt in genau eine Source of Truth;
   kein langfristiges Dual-Write.
2. Gestartete Wettbewerbe werden nicht zur Migration neu generiert.
3. Match-IDs, Ergebnisse, Beweise, Disputes, Chat, Termine und Audit-Historie
   bleiben erhalten oder erhalten ein explizites, reversibles ID-Mapping.
4. Teilnehmer und Rulesets werden fuer laufende/historische Wettbewerbe
   versioniert bzw. gesnapshottet.
5. Resultate werden serverseitig genau einmal finalisiert. Exakte Replays sind
   idempotent, widerspruechliche Replays liefern einen Konflikt.
6. Eine Korrektur liefert vor dem Anwenden eine Impact-Vorschau. Bereits
   gestartete Folgematches werden nie still ueberschrieben.
7. Pairing- und Zufallsentscheidungen speichern Algorithmusversion, Inputs und
   Zufalls-Seed, damit sie reproduzierbar bleiben.
8. Custom-Regeln sind deklarativ, versioniert und validiert; kein ausfuehrbarer
   Benutzer-Code.
9. Legacy-Collections werden erst nach gemessener Nullnutzung und einem
   separaten Restore-Test entfernt.

## Strategiegrenzen

- `Topology/Pairing`: Single, Double, Round Robin, Swiss, Gauntlet, Ladder,
  FFA und Custom.
- `MatchFormat`: BoN, feste Games, Home/Away, kumulative Scores, Rang,
  Placement oder niedrigste Zeit.
- `Ranking`: Punkte-Calculatoren und geordnete Tiebreaker.
- `Seeding`: manuell, Zufall, Rating/Punkte, Snake, High-vs-Low und Constraints.
- `VetoWorkflow`: Pick, Ban, Map, Modus, Side, Host, Timer, Auto-Pick und Penalty.
- `Schedule`: feste Zeit, Zeitfenster, Teamverhandlung, Vorgaengermatch oder
  Adminentscheidung.
- `Advancement`: Winner/Loser, Top-N, Rangbereich, Schwelle, Bedingung oder
  manuelle Adminauswahl.

Damit lassen sich DeSBL-/CoD-Regeln als Ruleset-Preset abbilden, ohne CoD-Felder
in den Kern einzubauen. Benoetigt werden unter anderem Maps mit wechselnden
Modi, Bo3/Bo5, Pick/Ban, Heim-/Gastrollen, Terminfenster, No-show/Forfeit,
Beweise/Disputes und konfigurierbare Punkte/Tiebreaker.

## Migrationsfolge

1. Zentraler Format-/Capability-Katalog und dieser Architekturvertrag.
2. Reine Adapter `Legacy -> Canonical` und `Stage -> Canonical`.
3. Golden Fixtures, Differentialtests und Shadow-Read-Metriken.
4. Alle Nebenverbraucher auf kanonische Repository-/Service-Projektionen.
5. Versionierter Schreibkern mit Graphvalidator und Preview/Validate/Apply.
6. Standardformate einzeln portieren; neue Wettbewerbe zuerst per Feature Flag.
7. Read-only Dry Run je Bestandswettbewerb mit Counts, Graph, Hash und Diff.
8. Migration in der Reihenfolge Draft/Test, Archive, aktive Turniere zuletzt.
9. Legacy-Schreibwege read-only schalten, Nutzung messen und spaeter separat
   entfernen.

## Kanonischer Read-Vertrag v1

`backend/services/competition_snapshot.py` projiziert beide aktiven
Matchspeicher rein lesend auf `competition.structure.v1`. Der Vertrag enthaelt
stabile Match-IDs, variable Slots, normalisierte Resultate und explizite
Advancement-Kanten sowie Scheduling-/Stationsfelder und die Herkunft des
Dokuments. Er schreibt weder in MongoDB noch veraendert er Quelldokumente.

Der Match-Overview-Service ist der erste produktive Leser dieses Vertrags. Die
bestehende Bracket-API liefert die Projektion zusaetzlich als `structure`, ohne
`matches`, `matches_v2`, `stages` oder `engine` zu entfernen. `collection`
bleibt fuer bestehende Deep Links erhalten, waehrend Legacy-A/B und Stage-Slots
intern denselben Pfad verwenden. Golden-/Differentialtests vergleichen
engine-unabhaengige Semantik; eine read-only Integritaetspruefung meldet
doppelte IDs, fehlende Ziele/Slots, doppelte Slotquellen und Advancement-Zyklen.

`backend/services/competition_read.py` ist die Datenbankgrenze fuer Struktur
und Match-Detail. `backend/services/competition_standings.py` berechnet Stage-,
Elimination-, Round-Robin-, Liga-, Swiss- und Gruppenstaende ausschliesslich
aus der kanonischen Projektion. Jeder produktive Struktur-Read erzeugt
niedrig-kardinale Counts fuer Quellen, Status, Resultate, Advancement und
Integritaetsfehler; `compare_structure_snapshots` liefert begrenzte
Shadow-Diffs fuer eine spaetere Bestandsmigration. Dabei wird nichts doppelt
geschrieben.

### Read-Consumer-Status

| Consumer | Status | Naechster Schritt |
| --- | --- | --- |
| Bracket-API / Display | kanonische `structure` zusaetzlich aktiv | Frontend schrittweise auf `structure` umstellen |
| Match-Overview | kanonisch aktiv | keine Legacy-Sonderlogik mehr hinzufuegen |
| Match-Detail | `canonical_match` zusaetzlich aktiv | UI nach Paritaet umstellen |
| Turnier-Standings | kanonisch aktiv | konfigurierbare RankingPolicy folgt im Schreibkern |
| Profile / DSGVO | beide Stores, aber eigene Projektionen | auf Read-Service umstellen |
| Preise / Saisonwertung | beide Stores, aber eigene Projektionen | kanonische Standings konsumieren |
| Widget / Match-PDF | weiterhin Legacy-only | priorisierter naechster Read-Consumer |
| Badges / Admin-Zaehler / Penalties | weiterhin Legacy-lastig | vor Engine-Cutover migrieren |
| Reminder / Notifications / Stationen | beide Formen mit Sonderzweigen | gemeinsame Match-Projektion verwenden |

Jede Datenmigration benoetigt Backup-/Restore-Nachweis, Migration-Ledger,
Zielversion, ID-Mapping, Hash/Diff und Rollback-ID. Ein Fehler darf nie durch
erneute Bracket-Generierung "repariert" werden.

## Abnahmematrix

- Teilnehmerzahlen 0/1 sowie 3/5/63/64/65 und grosse Strukturen;
- Byes, Draw, DNF, No-show, Walkover, Forfeit, Disqualifikation und Replay;
- parallele Requests, Crash-Wiederaufnahme und Korrektur nach Advancement;
- Single/Double/RR/League/Groups/Swiss/FFA/Custom und Multi-Stage;
- Grand Final `none`, `single` und bedingter Reset;
- Bo1/3/5/7, kumulative Maps/Runden, Home/Away, Zeit und Placement-Punkte;
- Zeitzonen, Sommer-/Winterzeit, Zeitfenster und abhaengige Startzeiten;
- Desktop, 360-px-Mobile, barrierefreie Liste, TV/Embed und Mobile-App;
- Paritaet von Stats, Preisen, Notifications, Audit und historischen Deep Links.

## Externe fachliche Referenzen

- Toornament Structure/Stages/Matches: https://developer.toornament.com/v2/core-concepts/structure/
- DeSBL Call of Duty Allmode: https://desbl.de/rule/1648
- Call of Duty Challengers 2026 Rules:
  https://www.callofduty.com/content/dam/atvi/callofduty/esports-new/2026-cdl-programs/CDL_Challengers_2026_Season_Official_Rules.pdf
- FIDE Swiss General Handling Rules 2026:
  https://handbook.fide.com/chapter/GeneralHandlingRulesForSwissTournaments202602

Diese Quellen sind Anforderungsreferenzen. Die konkrete modulare Architektur ist
eine Ableitung fuer diese Plattform und keine Kopie eines Fremdsystems.
