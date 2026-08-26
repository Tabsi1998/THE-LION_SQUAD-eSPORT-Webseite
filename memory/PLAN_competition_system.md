# Umsetzungsplan — Vollständiges, produktives Wettkampf-/Liga-System + offene Feier-Features
Stand: Juni 2026 · Status: NUR PLAN (noch keine Implementierung)

Ziel: Kein Demo-Zeug, sondern ein echtes, individuell konfigurierbares System, das der
Betreiber dauerhaft nutzen kann — pro Spiel/Edition/Modus modular, mit Map-Veto,
Best-of-Serien, Terminabstimmung, Ergebnisbestätigung + Tickets, Live-Updates und
Liga-Trophäen. Zusätzlich: die 5 offenen „Feier"-Punkte fertigstellen.

---

## TEIL A — Offene Punkte fertigstellen (kleine, klar abgegrenzte Features)

### A1 — Archetypen-Galerie (Achievements-Seite)
- Ziel: Vorschau aller 30 Rahmen-Archetypen (Rookie…Apex) als Sammlung.
- Frontend: neue Sektion in `AchievementsShowcasePage.jsx` (bzw. eigene Komponente
  `ArchetypeGallery.jsx`). Grid mit `LevelAvatarFrame level={n}` (non-compact, showBadge)
  für 1..30, Archetyp-Name aus `levelFrameConfig(n).name`, „erreicht/gesperrt"-Markierung
  anhand des eigenen Levels (aus `/api/users/me/level`).
- Kein Backend nötig. Testid `archetype-gallery` + `archetype-card-{n}`.
- Test: Screenshot + DOM-Check (30 Karten, Namen sichtbar).

### A2 — Team-Podium (Silber/Bronze-Kronen für Team #2 & #3)
- Backend: `services/team_levels.top_team_id` → `top_team_crowns(data)` das
  gold/silver/bronze für die 3 punktbesten Teams (points>0, Tie-Break points→level→name)
  liefert. `/api/teams/levels` + `/{id}/level` geben `crowns`/`crown` mit 3 Varianten.
- Frontend: `TeamsPage` reicht die jeweilige Variante an `LevelAvatarFrame` weiter;
  Chips „#1/#2/#3" analog.
- Test: `/api/teams/levels` prüft 3 Kronen; Screenshot Teamliste.

### A3 — Team-Aufstieg-Feier (Team-Level-Up für alle Mitglieder)
- Backend: Team-Level ist berechnet (kein persistenter Zustand). Für Aufstiegserkennung
  neue Collection `team_level_state` (id=team_id, level, updated_at) + Vergleich in
  `get_all_team_levels` (nur beim force/recompute). Bei Anstieg → Notification
  `team_level_up` an alle `member_ids` (dedupe_key `teamlvl-{team_id}-{level}`),
  gehookt an dieselben Trigger wie Crown-Sync (award_achievement, Turnierergebnis).
- Frontend: Overlay-Komponente `TeamLevelUpCelebration.jsx` (wie LevelUpCelebration,
  aber Team-Rahmen + Teamname), getriggert über NotificationBell (unread `team_level_up`,
  einmalig via localStorage).
- Test: Punkte künstlich erhöhen (Script) → Notification + Overlay beim Mitglied.

### A4 — Krone-erobert-Duell (Team-Goldkrone Wechsel)
- Backend: analog `crown_events.py` ein `team_crown_events.py` mit persistiertem
  `team_crown_state` (holders gold/silver/bronze, version, race-safe). Transitionen →
  `team_crown_gained` (neuer #1) / `team_crown_lost` (alter #1) an alle Team-Mitglieder.
- Frontend: Gewinner-Overlay (Extra-Feier), Verlierer bekommt nur Notification/Toast.
- Test: E2E hin/zurück wie beim Spieler-Crown-Event (genau N Notifications, idempotent).

### A5 — Level-Aufstieg Sound-Cue (Web Audio)
- Frontend: `lib/unlockSounds.js` erweitern um `playLevelUpCue(level)` (eskalierend nach
  Tier, Legendär = Fanfare). In `LevelUpCelebration` beim Öffnen abspielen; Mute-Toggle
  respektieren (`tls_sound_muted`). Keine Dateien (synthetisch, wie bestehend).
- Test: manuell / Screenshot (Mute-Button vorhanden).

> A1–A5 sind unabhängig und schnell. Empfehlung: als „Quick-Win-Batch" zuerst,
> danach das große TEIL B.

---

## TEIL B — Produktives Wettkampf-System (der große Umbau)

Grundprinzip: **Modular pro Spiel.** Ein Turnier erbt Defaults vom Spiel/der Edition,
kann aber alles überschreiben. Unterschiedliche Spiele (CoD, Mario Kart, Rocket League…)
verhalten sich über eine **Config**, nicht über Sonderfälle im Code.

### B0 — Datenmodell-Fundament (neue Collections/Felder)

1) **games** (erweitern, Hierarchie existiert bereits: standalone/series/edition + parent_game_id)
   - Neu: `cover_url`/`logo_url` konsequent pflegen (Bild pro Edition, z. B. BO7, MW4).
   - Neu: `competition_defaults` (embedded): default_best_of, default_result_mode,
     default_scoring, supports_draw, series_style ("map_series" | "single" | "aggregate"),
     hat_map_veto (bool).
   - Franchise-Beispiel: „Call of Duty" (series) → „Black Ops 7" / „Modern Warfare 4"
     (edition, je eigenes Bild), darunter Modi.

2) **game_modes** (NEU, Collection)
   - Felder: id, game_id (edition oder series), key (z. B. `snd`, `hardpoint`, `control`),
     name (Search & Destroy / Stellung / Kontrolle …), scoring_type
     ("first_to" | "best_of_rounds" | "time" | "points"), win_target (z. B. S&D=6,
     Hardpoint=250, Control=3), sort_order, is_active.
   - Modular: pro Spiel/Edition beliebige Modi anlegen/aktivieren (Admin-UI).

3) **maps** (NEU, Collection)
   - Felder: id, game_id (edition), name, image_url, modes (welche game_mode-keys sie
     erlaubt), is_active. → Map-Pool pro Spiel/Modus.

4) **match_series** — echte Best-of-Serie
   - Variante gewählt: **Serie im Match-Dokument als `series` (Liste von „games/maps")**
     statt eigener Collection, damit Legacy-Standings kompatibel bleiben.
   - Legacy-Match (`db.matches`) bekommt Felder:
     `series_best_of` (1/3/5), `series` = [{index, mode_key, map_id, score_a, score_b,
     winner_reg_id, status}], `series_wins_a`, `series_wins_b`.
   - `score_a`/`score_b` = Map-Siege (für BO-Serie) ODER Rundenscore (BO1) — bleibt das,
     was die Tabelle summiert (konfigurierbar: „Serien-Siege zählen" vs „Runden zählen").
   - Sieglogik: „first to ceil(best_of/2)" (BO5 → 3, BO3 → 2, BO1 → 1). Unentschieden nur
     bei BO1 + supports_draw.

5) **map_veto** — Pick/Ban
   - Feld am Match: `veto` = {state, sequence:[{step, action:"ban"|"pick"|"decider",
     by_reg_id, map_id, mode_key, at}], remaining_maps, current_turn_reg_id, template}.
   - Veto-Template pro best_of konfigurierbar (z. B. BO3: Ban-Ban-Pick-Pick-Ban-Decider).

6) **match_schedule** (bestehende `match_schedule_proposals` erweitern)
   - Multi-Slot-Voting: beide Seiten schlagen mehrere Termine (Datum+Uhrzeit) vor;
     Überschneidung → automatisch bestätigt; sonst Gegner bestätigt einen Slot.
   - Feld am Match: `scheduled_at`, `schedule_status` (open/proposed/confirmed).

7) **tickets** (NEU, Collection) — Ergebnis-/Streitfälle
   - Felder: id, tournament_id, match_id, type ("result_dispute"|"no_show"|"other"),
     status (open/in_review/resolved), opened_by, messages[], resolution, decided_by.
   - Auto-Erstellung bei Ergebnis-Konflikt (siehe B3).

8) **league_trophies** (NEU) + Team-Vitrine
   - `league_trophies`: pro Turnier definierbare Trophäen {place/label/icon/image_url}.
   - Bei Turnierabschluss → Eintrag in `team_trophies` (team_id, tournament_id, trophy,
     awarded_at). Team-Seite zeigt Trophäen-Vitrine + optionales Team-Banner
     (`teams.banner_url` existiert; ggf. „Meister-Banner" freischaltbar).

### B1 — Spiele-/Modi-/Map-Verwaltung (Admin)
- Backend: CRUD `game_modes`, `maps` (unter `/api/games/{id}/modes`, `/maps`), Veto-Template
  CRUD. Games-CRUD existiert (game_routes.py) → um Bild/Defaults erweitern.
- Frontend Admin: Spiel-Editor mit Tabs „Editionen", „Modi", „Maps (Bilder)", „Veto-Vorlagen",
  „Wettkampf-Defaults". Bilder via **Object Storage** (Integration-Expert + Object-Storage-
  Playbook — KEIN Base64).
- Test: Modi/Maps anlegen, im Turnier auswählbar.

### B2 — Turnier-Konfiguration (erbt Spiel-Defaults, überschreibbar)
- TournamentCreate/Update erweitern: `game_edition_id`, `mode_config` (welche Modi je
  Map/Serie), `series_best_of`, `veto_template_id`, `scoring` (win/draw/loss Punkte,
  Tie-Break-Reihenfolge), `result_mode` (staff_only | both_confirm | hybrid),
  `schedule_mode` (fixed | vote), `trophies`.
- Sinnvolles Punktesystem: Standard Sieg 3 / Remis 1 / Niederlage 0; Tie-Break:
  Punkte → direkter Vergleich → Map-/Runden-Differenz → Runden+ (konfigurierbar).
- Test: Turnier mit BO3, Veto-Template, both_confirm, Punkte 3/1/0 anlegbar.

### B3 — Ergebnis-Flow „online" (beide tragen ein → Ticket bei Konflikt)
- Endpoints (erweitern match_routes `/report`):
  - Beide Teams melden Serie (Map-für-Map-Scores). Gleich → auto-confirm, Match completed,
    Serien-/Rundenscore + Sieger gesetzt, Advancement (bei K.-o.) + Standings (bei Liga).
  - Ungleich → Status „disputed", **automatisch Ticket** (type result_dispute) an Admin;
    Admin entscheidet final (`PATCH /matches/{id}` bleibt Staff-Override).
- Unentschieden: bei BO1 + supports_draw erlaubt (kein Sieger, beide +1 Punkt).
- Test: 2 gleiche Reports → completed; 2 verschiedene → Ticket offen; Admin entscheidet.

### B4 — Map-Veto (Pick/Ban) LIVE
- Endpoints: `POST /matches/{id}/veto/action` (ban/pick), serverseitige Turn-Validierung
  (nur „current_turn"-Team, gültige Map, Template-Schritt). Ergebnis füllt `series` mit
  gepickten Maps/Modi.
- Live ohne Reload: Aktion ist eine API-Mutation → `change_events` invalidiert `matches`
  → Gegnerclient re-fetcht automatisch (bestehendes `useApiInvalidation`). Optional
  gezieltes SSE-Event `match:{id}:veto`.
- Frontend: Veto-Board (Maps als Bild-Kacheln, „dein Zug/warten", gebannte durchgestrichen,
  gepickte hervorgehoben), Countdown je Zug optional.
- Test: 2 Browser-Sessions; Team A bannt → bei Team B sofort sichtbar (ohne Button).

### B5 — Terminabstimmung LIVE (Multi-Slot-Voting)
- `schedule-proposals` erweitern: mehrere Slots je Seite, Overlap-Auto-Confirm, sonst
  Gegner wählt. Live über change_events (wie B4).
- Frontend: „Termine vorschlagen" (2–3 Slots), Gegner sieht/bestätigt live; bestätigter
  Termin erscheint am Match + in Kalender/News optional.
- Test: A schlägt 3 Slots vor, B bestätigt einen → beide sehen `confirmed` live.

### B6 — Serien-Scoring & Standings (BO3/BO5, spielabhängig)
- `bracket_engine`/`competition_standings` erweitern: Serien-Sieg = ceil(bo/2) Map-Siege;
  Standings summieren je nach `scoring.count` (Serien-Siege ODER Map-/Runden-Differenz).
- Mario-Kart-Fall: kein Map-Veto, „points"-Scoring (Platzierungspunkte) — über game_mode
  scoring_type abgebildet, KEIN CoD-Sonderfall im Code.
- Test: BO5 3:1 → Serie gewertet; Tabelle korrekt; Mario-Kart-Punktemodus getrennt geprüft.

### B7 — Live-UI durchgängig (kein „Aktualisieren"-Zwang)
- Sicherstellen, dass Veto, Termine, Reports, Ergebnisse, Tickets alle über
  `change_events` invalidieren und Clients automatisch nachladen (SSE). Ggf.
  feingranulare Events pro Match ergänzen.
- Test: Zwei-Client-E2E für jeden Live-Flow.

### B8 — Liga-Trophäen & Team-Banner
- Turnierabschluss vergibt definierte Trophäen an Platzierungen → `team_trophies`.
- Team-Seite: Trophäen-Vitrine + optional „Meister-Banner" (freigeschaltet durch Titel).
- Test: Turnier beenden → Meister-Team hat Trophäe in Vitrine.

### B9 — CoD-Referenzkonfiguration als Beispiel (echt nutzbar, kein Demo)
- Franchise „Call of Duty" (series) → Editionen „Black Ops 7 (BO7)", „Modern Warfare 4
  (MW4)" mit Cover-Bild.
- Modi: Search & Destroy (first_to 6), Hardpoint/Stellung (points 250), Control/Kontrolle
  (best_of_rounds, first_to 3). CDL-Reihenfolge als Veto-/Serien-Template
  (Hardpoint→S&D→Control…), BO5 „first to 3".
- Map-Pool je Modus mit Bildern.
- Diese Config ist Daten (Admin-pflegbar), kein Code-Sonderfall.

---

## Reihenfolge / Phasen (Empfehlung)

- **Phase 0:** TEIL A (A1–A5) — schnelle, sichtbare Fertigstellungen.
- **Phase 1:** B0 Datenmodell + B1 Admin-Verwaltung (Spiele/Editionen/Modi/Maps/Bilder,
  Object Storage). Fundament, ohne das nichts anderes „echt" ist.
- **Phase 2:** B2 Turnier-Config + B6 Serien-Scoring/Standings (BO3/BO5, Punkte 3/1/0,
  Tie-Break, spielabhängig).
- **Phase 3:** B3 Ergebnis-Flow + Tickets (both_confirm → auto/Streit → Admin).
- **Phase 4:** B4 Map-Veto LIVE + B5 Terminabstimmung LIVE + B7 durchgängig live.
- **Phase 5:** B8 Trophäen/Banner + B9 CoD-Referenzkonfig als echtes, nutzbares Beispiel.

Jede Phase endet mit Backend-Tests + (ab UI) Testing-Agent (Zwei-Client für Live-Flows).

## Integrationen / Voraussetzungen
- **Object Storage** für Spiel-Cover, Map-Bilder, Team-Banner (Integration-Expert +
  Object-Storage-Playbook; NIE Base64 in Mongo).
- Sonst keine externen Keys nötig (SSE, Notifications, Auth existieren).

## Entscheidungen des Betreibers (fixiert)
1. Startreihenfolge: **Erst TEIL A komplett, dann TEIL B.**
2. Tabellenwertung: **Serien-Siege zählen** (BO5 3:1 = 1 Sieg), Map-/Runden-Differenz nur Tie-Break.
3. Trophäen: **rein digital** (Icon/Bild) in der Team-Vitrine.
4. Meister-Banner: **automatisch** freigeschaltet, wenn ein Team einen Titel gewinnt.
5. Terminabstimmung: **freie Datum + Uhrzeit-Eingabe.** Modell: Season startet Montag →
   Spieltag 1 = Zeitfenster Mo–So (als Datumsbereich). Innerhalb des Fensters votet man die
   Uhrzeit; bestätigter Termin wird gespeichert. Erinnerungen später per Mail + Push
   (wenn App fertig). Offen zu bauen: Season→Spieltag-Fenster-Generator + Uhrzeit-Voting.

## Fortschritt
- TEIL A/B: NICHT vom E1-Agenten umgesetzt. Umsetzung erfolgt durch Codex (ChatGPT)
  anhand des separaten Briefs: /app/memory/CODEX_IMPLEMENTATION_BRIEF.md
