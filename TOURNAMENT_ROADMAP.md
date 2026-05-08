# Tournament Roadmap

Stand: 2026-05-08

## Umsetzung

### Step 1 erledigt: Phase-0-Stabilisierung

- Ergebnisvalidierung fuer bestehende 1v1-Matches verschaerft.
- Ungueltige Gewinner werden abgewiesen.
- Unentschieden in Elimination-Matches werden nicht mehr als kaputtes Completed-Match gespeichert, sondern als Dispute markiert.
- Draws bleiben fuer Round Robin, Swiss und Gruppen erlaubt.
- Match-Reminder nutzen jetzt die aktuellen Felder `participant_a_id` und `participant_b_id` plus Legacy-Fallbacks.
- Reminder-Link zeigt auf `/matches/{id}` statt `/match/{id}`.
- Staff-Check-in-Endpunkt fuer `checked_in`, `approved` und `no_show` ergaenzt.
- Admin-Turnieransicht hat operative Buttons fuer Check-in, Auschecken und No-Show.
- Bracket-Reset fuer `live`, `completed` und `results_published` braucht jetzt bewusst `force=true`.
- Audit-Logs fuer Bracket-Generierung, Bracket-Reset und Check-in-Aktionen ergaenzt.
- Lokale Unit-Tests fuer Match-Regeln ergaenzt.

### Step 2 erledigt: Phase-1-Zuweisungen

- Neue Collection/Indizes fuer `tournament_staff_assignments` ergaenzt.
- Rollenmodell fuer `organizer`, `referee`, `scorekeeper`, `station_manager` und `stream_operator` angelegt.
- Scopes fuer ganzes Turnier, Stage, Gruppe, Station und Match vorbereitet.
- Berechtigungsservice ergaenzt, der globale Admin-/Moderatorrollen von turnierspezifischen Zuweisungen trennt.
- Zugewiesene Personen koennen private/draft Turniere ihres Scopes sehen.
- Ergebnis-/Forfeit-Aktionen akzeptieren jetzt zugewiesene Organizer/Referees/Scorekeeper.
- Staff-Check-in akzeptiert Organizer/Referees/Scorekeeper/Station Manager.
- Station-Zuweisung/Freigabe akzeptiert Organizer/Referees/Station Manager.
- Admin-Turnieransicht hat den Tab "Team" fuer Zuweisungen, Aktiv/Pausiert und Entfernen.
- Cleanup beim Turnier- und User-Loeschen sowie TLS-Reset ergaenzt.
- Unit-Tests fuer die neue Berechtigungslogik ergaenzt.

### Step 3 erledigt: Event-Anmeldung und Orga-Basis

- Logout-Button in Public- und Admin-Layout wieder klar sichtbar gemacht.
- Interne Event-Anmeldung fuer angemeldete Nutzer ergaenzt.
- Vereinsinterne Events funktionieren damit fuer aktive Vereinsmitglieder ohne externen Formular-Link.
- Event-Kapazitaet zaehlt jetzt reservierte Plaetze statt nur Accounts.
- Begleitpersonen sind pro Event aktivierbar und pro Anmeldung begrenzbar.
- Warteliste wird automatisch genutzt, wenn die Kapazitaet ueberschritten wuerde.
- Admin-Eventliste zeigt reservierte Plaetze, Anmeldungen und Begleitpersonen.
- Admins koennen Event-Anmeldungen einsehen und Status auf angemeldet, Warteliste, eingecheckt, No-Show oder storniert setzen.
- Eventseiten zeigen freie/reservierte Plaetze und die eigene Anmeldung.

### Step 4 erledigt: Draft-Workflow und Phase-2-Basis

- Public- und Admin-Listen fuer Events, Turniere und F1 getrennt: Entwuerfe werden auf der normalen Webseite standardmaessig nicht mehr ausgeliefert, auch wenn ein Admin eingeloggt ist.
- Admin-Seiten laden Entwuerfe explizit mit `include_drafts=true` bzw. `include_draft=true`.
- Turnier-Bearbeitung erweitert: Slug, Spiel, Event-Zuordnung, Plattform, Status, Sichtbarkeit, Format, Modus, Seeding, Min/Max, Teamgroesse, Ersatzspieler, Streamdaten und Season-Gewicht sind nachtraeglich pflegbar.
- Backend-Update fuer Turniere akzeptiert jetzt `slug`, `game_id`, `platform`, `event_id` und `substitutes_allowed` mit Validierung fuer Slug-Duplikate und Spiel.
- Phase-2-Collections vorbereitet: `tournament_stages`, `matches_v2`, `match_reports_v2`.
- Stage-Endpoints angelegt: Stages listen, erstellen, bearbeiten und loeschen.
- `matches_v2` kann pro Turnier/Stage gelesen werden, noch ohne Generator.

Naechster Schritt: Schema-Parser fuer Custom-Brackets und erster v2-Generator, der aus einer Stage-Konfiguration `matches_v2` mit Slots und Advancement erzeugt.

## Was wirklich noch fehlt

- Neues Turniermodell: `tournament_stages`, `matches_v2`, Multi-Slot-Matches und Platzierungsresultate.
- Schema-Parser fuer Custom-Brackets wie `[WB] A=[1,2,3,4]` und Referenzen `W:A:1`, `L:A:3`.
- Echte FFA-Ergebnis-UI mit 3-8 Teilnehmern, Rangliste, Punkten, DNF/Forfeit und Proof.
- Korrekte Double-Elimination-Flows fuer 1v1 und FFA inklusive Loser-Bracket-Transfers.
- Operatives Turnierleitungs-Dashboard: Check-in, Warteliste, No-Show, Stationen, Next-up, offene Ergebnisse.
- TV-/Embed-Ansichten fuer Bracket, Stationen und Live-Eventbetrieb.
- Benachrichtigungen fuer Match bereit, Station zugewiesen, Check-in offen und Ergebnis bestaetigt.
- Audit/Undo fuer Ergebnis-Korrekturen, wenn Folgematches bereits gestartet oder gespielt wurden.
- QR-/Vor-Ort-Check-in fuer Events und Turniere.
- Feineres Rollenmodell fuer Event-Orga analog zu Turnier-Staff.

## Kurzfazit

Das bestehende Turniermodul ist ein guter MVP fuer klassische 1v1-/Team-vs-Team-Turniere, aber noch kein flexibles Turniersystem wie Toornament. Die groesste technische Grenze ist das aktuelle Match-Modell: ein Match hat fest `participant_a_id`, `participant_b_id`, `score_a`, `score_b`, `winner_id`, `loser_id`. Damit funktionieren Single Elimination, einfache Round Robin und ein Teil von Swiss, aber FFA-Matches mit 3-8 Spielern, mehrere Qualifizierte pro Match, Custom-Brackets und echtes Double Elimination sind strukturell nicht sauber abbildbar.

Fuer Mario Kart mit 4 Spielern pro Heat braucht es deshalb nicht nur einen neuen Generator, sondern eine Stage-/Match-Engine mit Platzierungs-Ergebnissen und Slot-Flows wie `W:A:1`, `W:A:2`, `L:A:3`, `L:A:4`.

## Ist-Stand im Code

- `backend/models.py`: `TournamentFormat` enthaelt viele Formatnamen (`single_elim`, `double_elim`, `round_robin`, `swiss`, `groups`, `ffa`, `battle_royale`, `league`, `time_trial`, `grand_prix`), aber das Datenmodell bleibt 2-Slot-orientiert.
- `backend/bracket_engine.py`: Single Elimination ist echt verdrahtet. Double Elimination erzeugt nur WB + LB-Platzhalter + Grand Final, aber keine korrekten Loser-Flows.
- `backend/bracket_extensions.py`: Swiss und Groups sind als separate Generatoren vorhanden, aber ebenfalls duel-/2-Spieler-orientiert.
- `backend/routes/tournament_routes.py`: Check-in, Registrierung, Bracket-Generierung, Swiss-Runden und Gruppen-Generierung sind vorhanden.
- `backend/routes/match_routes.py`: Score-Reporting, Dispute und Forfeit sind vorhanden, aber auf zwei Parteien optimiert.
- `frontend/src/components/tls/BracketTree.jsx`: Darstellung gruppiert nach `bracket` und `round`, rendert aber ebenfalls nur zwei Teilnehmer pro Match.
- `frontend/src/pages/admin/AdminTournamentEditPage.jsx`: Admins/Moderatoren koennen Ergebnisse eintragen, aber nur A/B-Score + Gewinner.
- `frontend/src/pages/admin/AdminStationsPage.jsx`: Stationen und Match-Zuweisung sind vorhanden, aber noch keine Turnierleitungs-Queue mit Check-in-Status, Next-up und Heat-Management.
- `backend/services/match_reminder.py`: nutzt aktuelle Match-Felder plus Legacy-Fallbacks.
- `backend/routes/event_routes.py`: Events haben jetzt interne Anmeldung, Kapazitaetszaehlung, Begleitpersonen und Admin-Statuspflege.

## Externer Abgleich

Toornament unterscheidet duel-basierte Stages und FFA-basierte Stages. Relevante Typen sind:

- Duel: Single Elimination, Double Elimination, Bracket Groups, Custom Bracket, Round-robin Groups, Gauntlet, League, Swiss.
- FFA: Simple, FFA Single Elimination, FFA Bracket Groups, FFA Custom Bracket, FFA League.
- Custom Brackets werden ueber ein Schema beschrieben. FFA-Syntax erlaubt mehrere Teilnehmer pro Match und Rang-Referenzen wie `W:A:1` oder `L:A:4`.

Quellen:

- https://developer.toornament.com/v2/core-concepts/structure/stage
- https://help.toornament.com/structures/custom-brackets
- https://developer.toornament.com/v2/guides/display-bracket
- https://help.toornament.com/structures/which-format-for-my-tournament

## Zielbild

Ein Turnier besteht kuenftig aus mehreren Stages. Eine Stage definiert Match-Typ, Struktur, Regeln, Resultat-Logik und Advancement. Ein Match ist nicht mehr hart A/B, sondern hat eine Liste von Slots/Teilnehmern. Ein Ergebnis ist eine Platzierungsliste mit Scores, Ranks, DNF/Forfeit und optionalem Proof. Advancement liest die Ergebnis-Ranks und fuellt Zielslots in Folgematches.

Beispiel fuer Mario Kart:

```text
[WB]
A=[1,2,3,4]
B=[5,6,7,8]
I=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
LA=[L:A:3,L:A:4,L:B:3,L:B:4]
```

Das bedeutet:

- Match A hat 4 Teilnehmer.
- Platz 1 und 2 aus A gehen ins Winner-Bracket weiter.
- Platz 3 und 4 aus A gehen ins Loser-Bracket.
- Ein Teilnehmer ist erst eliminiert, wenn er nach seinem ersten Drop im Loser-Bracket wieder ausscheidet.

## Phase 0: Stabilisieren

Ziel: bestehende Features bleiben nutzbar, bevor das Modell umgebaut wird.

- Double-Elim als "nicht vollstaendig" markieren oder echte 1v1-Loser-Flows implementieren.
- `match_reminder.py` auf aktuelle Match-Felder korrigieren.
- Ergebnis-Validierung haerter machen: Gewinner muss Match-Teilnehmer sein, Score-Gleichstand braucht explizite Draw-Regel oder Gewinnerwahl.
- Bracket-Reset schuetzen: keine stillen Resets bei laufenden/veroeffentlichten Turnieren.
- Check-in Admin-Aktion ergaenzen: Turnierleitung kann Teilnehmer vor Ort einchecken, auschecken, No-Show setzen.
- Audit-Logs fuer kritische Turnieraktionen: Bracket generiert/reset, Match-Ergebnis geaendert, Forfeit, Check-in durch Staff.

## Phase 1: Rollen und Zustaendigkeiten

Ziel: Ergebnisse werden nicht nur von globalen Admins gepflegt.

- Neue Entitaet `tournament_staff_assignments`:
  - `tournament_id`
  - `user_id` oder `team_id`/`group_id`
  - Rollen: `organizer`, `referee`, `scorekeeper`, `station_manager`, `stream_operator`
  - Scope: ganzes Turnier, Stage, Gruppe, Station oder einzelnes Match
- Rechtepruefung von globaler Rolle trennen:
  - Superadmin/Club Admin duerfen alles.
  - Tournament Admin darf Turniere verwalten.
  - Zugewiesene Referees/Scorekeeper duerfen nur ihren Scope bearbeiten.
  - Spieler duerfen eigene Ergebnisse melden, aber nicht final entscheiden.
- Admin UI: Tab "Team & Rechte" im Turnier.
- Match Hub: anzeigen, wer fuer dieses Match zustaendig ist.

## Phase 2: Neues Datenmodell parallel einfuehren

Ziel: neue Engine aufbauen, ohne alte Turniere sofort zu brechen.

Neue Collections/Felder:

- `tournament_stages`
  - `id`, `tournament_id`, `number`, `name`
  - `match_type`: `duel` oder `ffa`
  - `stage_type`: `single_elimination`, `double_elimination`, `custom_bracket`, `round_robin_groups`, `swiss`, `league`, `simple`, `ffa_single_elimination`, `ffa_custom_bracket`, `ffa_league`, ...
  - `settings`: `size`, `match_size`, `qualifiers_per_match`, `score_type`, `score_intent`, `grand_final`, `schema`, `arrival`, `departure`
  - `status`: `pending`, `ready`, `running`, `completed`
- `matches_v2`
  - `id`, `tournament_id`, `stage_id`, `group_id`, `round`, `round_name`, `match_key`
  - `slots`: Liste aus `{slot, source, registration_id, seed, status}`
  - `results`: Liste aus `{registration_id, rank, score, points, time_ms, dnf, forfeit}`
  - `advancement`: Liste aus `{from_rank, to_match_key, to_slot, flow}`
  - `status`, `station_id`, `scheduled_at`, `reports`, `disputes`
- `match_reports_v2`
  - getrennt von Match speichern, damit Korrekturen, Proofs und Consensus sauber auditierbar bleiben.

Kompatibilitaet:

- Alte `/matches` und `/tournaments/:id/bracket` bleiben fuer alte Turniere.
- Neue Endpoints koennen zuerst unter `/api/tournaments/:id/stages` und `/api/matches-v2` laufen.

## Phase 3: Schema-Parser und Engine

Ziel: Custom-Brackets wie im Beispiel eingeben, validieren und generieren.

Parser:

- Sections: `[WB]`, `[LB]`, `[GF]`, optional `[GROUP A]`.
- Match-Zeilen: `A=[1,2,3,4]`
- Quellen:
  - Seed: `1`
  - Gewinner-Rang: `W:A:1`
  - Verlierer-/Nichtqualifizierter Rang: `L:A:3`
  - Optional allgemein: `R:A:1` fuer direkten Rangbezug.
- Validierung:
  - keine doppelten Match-Keys
  - keine unbekannten Referenzen
  - keine zyklischen Abhaengigkeiten
  - Slotanzahl passt zu `match_size`
  - `W`/`L`-Ranks passen zu `qualifiers_per_match`
  - alle Seeds im Bereich

Engine:

- Beim Start Seeds anhand `seeding_mode` setzen: random, manual, ranking, snake, balanced.
- Nach Ergebnis-Speicherung:
  - Platzierungsliste validieren.
  - Alle Zielslots aus Advancement berechnen.
  - Folgematches auf `ready` setzen, wenn alle Pflichtslots gefuellt sind.
  - Eliminierungen und Finalplatzierungen berechnen.
- Undo/Korrektur:
  - Ergebniskorrektur muss downstream Matches sperren oder neu berechnen.
  - Admin bekommt Warnung, wenn Folge-Matches schon gespielt wurden.

## Phase 4: FFA- und Mario-Kart-Flows

Ziel: 4-Spieler-Heats voll produktiv nutzbar machen.

- Format-Presets:
  - Mario Kart FFA Single Elim: 4 Spieler, Top 2 weiter.
  - Mario Kart FFA Double Elim: WB/LB nach Custom-Schema.
  - FFA League: mehrere Heats, Punkte-Ranking.
  - Simple FFA: einzelne freie Heat-Runde, z.B. Fun-Event.
- Ergebnis-UI:
  - 4+ Teilnehmer als sortierbare Platzierungsliste.
  - Pro Teilnehmer Score/Punkte/Time/DNF/Forfeit.
  - Automatische Rank-Ermittlung nach Score oder manueller Rank.
  - Proof/Notiz pro Ergebnis.
- Public Standings:
  - Points, Wins/Top2, Avg Rank, Tiebreaker.
- Bracket-Darstellung:
  - FFA-Heat-Karten statt A/B-Knoten.
  - Rank-Badges und qualifizierte Spieler visuell markieren.

## Phase 5: Turnierleitung und Vor-Ort-Betrieb

Ziel: Ein Verein kann ein Event real betreiben.

- Check-in-Modi:
  - digital self check-in
  - Staff-Check-in vor Ort
  - QR-Code Check-in
  - Bulk-Check-in aus Teilnehmerliste
  - No-Show / Late / Ersatzspieler
- Operatives Dashboard:
  - Teilnehmer: angemeldet, approved, checked_in, no_show, waitlist.
  - Matches: ready, assigned, in_progress, waiting_result, disputed.
  - Stationen: frei, besetzt, defekt, reserviert.
  - Next-up Queue pro Station.
- Station-Flow:
  - Match auf Station ziehen/zuweisen.
  - Match starten, Ergebnis erfassen, Station freigeben.
  - TV zeigt aktuelle Station + naechste Matches.
- Benachrichtigungen:
  - Mail/Discord/In-App fuer Check-in offen, Match bereit, Station zugewiesen, Ergebnis bestaetigt.

## Phase 6: TV, Embed und Zuschaueransichten

Ziel: Public- und Event-Display werden eigenstaendige Produkte.

- Bracket TV:
  - Zoom/Pan oder stagebasierte Ansicht.
  - FFA-Karten, LB/WB/GF getrennt.
  - Auto-Fokus auf Live- und naechste Matches.
- Station TV:
  - Welche Station spielt welches Match.
  - Next-up pro Station.
  - QR-Code zur Public-Seite.
- Embed Widgets:
  - Bracket
  - Standings
  - Match Schedule
  - Station Queue
  - FFA Heat Results
- Read-only Widget-Endpoints ohne sensible Felder.

## Phase 7: Platzierungen, Season Points, Preise

Ziel: Ergebnisse fuehren automatisch zu sauberen Platzierungen.

- Einheitlicher Placement-Service:
  - aus Bracket/FFA/League/Swiss die finalen Ranks berechnen.
  - Tiebreaker pro Stage definieren.
  - manuelle Override-Platzierungen mit Audit.
- Season Points:
  - bestehende Punkte-Logik auf neue Placements umstellen.
  - FFA-Platzierungen und League-Punkte sauber einbeziehen.
- Preise:
  - Gewinner/Platzierte automatisch als Prize Pickups erzeugen.
  - Sonderpreise wie "Best Comeback", "Fastest Lap", "Last Place" manuell.

## Phase 8: Erweiterte Formate

Nach dem stabilen Stage-Kern koennen weitere Formate sauber ergaenzt werden:

- Gauntlet / King of the Hill.
- Ladder.
- Team-Ligen mit Spieltagen.
- Multi-Stage Turniere: Gruppenphase -> Playoffs, Swiss -> Top Cut, League -> Finals.
- CSV Import/Export fuer Teilnehmer und Seeding.
- Vorlagen-Bibliothek pro Spiel: Mario Kart, Smash, Rocket League, F1, Valorant, LoL.

## Empfohlene Reihenfolge

1. Phase 0 fixen, damit der aktuelle Betrieb nicht bricht.
2. Phase 1 Rechte/Zuweisungen, weil Ergebnisverwaltung im Verein sonst organisatorisch nicht passt.
3. Phase 2 und 3 als neue Engine parallel bauen.
4. Mario-Kart FFA Custom Double Elim als erstes grosses Referenzformat implementieren.
5. Danach TV/Station/Embed ausbauen.

Die wichtige Architekturentscheidung: nicht versuchen, FFA in das alte A/B-Matchmodell zu pressen. Das fuehrt zu Sonderfaellen in jeder Route und UI. Besser ist eine v2-Engine mit `slots[]`, `results[]` und einem expliziten Advancement-Graph.
