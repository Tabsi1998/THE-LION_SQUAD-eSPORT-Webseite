# CODEX IMPLEMENTATION BRIEF — THE LION SQUAD eSports
# Feier-Features (TEIL A) + Produktives Wettkampf-/Liga-System (TEIL B)
# Zielagent: Codex (ChatGPT). Sprache Antworten/Commits: Deutsch. Bezeichner: Englisch.

> WICHTIG FÜR CODEX: Dieser Brief beschreibt WAS und WIE nach Verantwortlichkeiten,
> nicht nach Zeilennummern. Der Repo-Stand kann abweichen — passe Pfade/Funktionsnamen
> an den tatsächlichen Code an. Ändere NUR das, was pro Aufgabe beschrieben ist.
> Breche keine bestehenden Flows. Arbeite Aufgabe für Aufgabe mit Tests (siehe „DoD").

---

## 0. KONTEXT & HARTE REGELN (immer einhalten)

**Stack**
- Frontend: React 19 + CRACO + TailwindCSS + Radix/shadcn (`frontend/src/components/ui/`) +
  framer-motion + lucide-react. Toasts via `sonner`.
- Backend: FastAPI + MongoDB (motor, async). Pydantic v2.
- Live/Echtzeit: SSE `GET /api/changes/stream` + `services/change_events.py`. Clients
  invalidieren via Hook `useApiInvalidation(loadFn, ["resourceKeys"])`. Mutationen an
  `/api/<resource>` erzeugen automatisch Change-Events → andere Clients laden neu.

**Nicht verhandelbare Konventionen**
1. Alle Backend-Routen mit Prefix `/api`. Frontend nutzt AUSSCHLIESSLICH
   `process.env.REACT_APP_BACKEND_URL` (kein Hardcoding). Backend nutzt `MONGO_URL`,
   `DB_NAME` aus env. `.env`-Dateien NICHT überschreiben; Keys nie aus dem Gedächtnis
   neu tippen.
2. MongoDB: niemals rohe `_id`/ObjectId in JSON zurückgeben (`{"_id": 0}` projizieren
   oder Modelle serialisieren). Zeit: `datetime.now(timezone.utc)`, als ISO-String
   speichern. Keine `datetime.utcnow()`.
3. Datei-Uploads/Bilder (Spiel-Cover, Map-Bilder, Team-Banner): **Emergent Object
   Storage**, NIEMALS Base64 in Mongo. (Falls Object Storage im neuen Stand fehlt: über
   Integrations-Playbook einrichten, kein Base64.)
4. Jedes interaktive/kritische UI-Element bekommt ein eindeutiges `data-testid`
   (kebab-case, funktionsbeschreibend).
5. Auth-Änderungen nur mit Bedacht (Cookie-JWT + CSRF Double-Submit existiert). Für neue
   geschützte Endpoints bestehende Dependencies nutzen: `get_current_user`,
   `get_optional_user`, `require_admin()`, Turnier-Staff-Permission-Helper.
6. Services über Supervisor (Ports 8001 Backend / 3000 Frontend). Hot-Reload aktiv;
   Restart nur bei `.env`/Dependency-Änderung. Nach mehreren FE-Edits ggf. `frontend`
   restarten (stale Bundle).
7. Neue Python-Deps: installieren + `pip freeze > backend/requirements.txt`. Neue JS-Deps:
   `yarn add ...` (kein npm).

**Wichtige bestehende Bausteine (Namen ggf. verifizieren)**
- `services/team_levels.py`: `team_level_curve`, `compute_all_team_levels`,
  `get_all_team_levels` (60s Cache), `top_team_id`; `routes/team_level_routes.py`
  (`GET /api/teams/levels`, `GET /api/teams/{id}/level`).
- `services/crown_events.py`: persistierter, versionierter `crown_state`,
  `schedule_crown_sync()` (2s Debounce), Notifications `crown_gained/lost/changed`.
- `services/user_notifications.py`: `create_user_notification(user_id, title, body, url,
  kind, meta)`; `meta.dedupe_key` verhindert Doppelversand.
- Frontend `components/tls/LevelAvatarFrame.jsx`: `LevelAvatarFrame`, `levelFrameConfig(n)`
  (→ `.name` Archetyp), `CrownIcon`, `useCrowns`, `useCrownFor`, `refreshCrowns`,
  `CROWN_LABELS`. 30 Archetypen (1..30).
- Frontend `components/tls/CrownCelebration.jsx` + `LevelUpCelebration.jsx` (Overlay-Muster
  mit Konfetti; `tls-crown-celebration*` CSS in `index.css`).
- Frontend `components/tls/NotificationBell.jsx`: pollt Notifications (30s), toastet neue,
  behandelt Crown-Notifications → dispatcht `window` CustomEvents für Overlays; dedupe via
  `localStorage tls-crowns-celebrated`.
- Frontend `components/tls/PublicLayout.jsx`: mountet Overlays (`CrownCelebration`,
  `LevelUpCelebration`).
- Frontend `lib/unlockSounds.js`: Web-Audio-Cues `playUnlockSound(level)`, `isSoundMuted`,
  `setSoundMuted`.
- Turnier-Engine: `bracket_engine.py` (`generate_bracket`, `generate_round_robin`,
  `compute_round_robin_standings`, `advance_match_winner`). Legacy-Matches in
  `db.matches`; V2 Heats in `db.matches_v2`. Standings: `services/competition_standings.py`
  (`round_robin_standings`, `standings_for_structure`) über Read-Model
  `services/competition_read.py` (liest `db.matches` als `source.engine="legacy"`).
- Match-Flow: `routes/match_routes.py` — `PATCH /api/matches/{id}` (kanonischer,
  engine-aware Write; Legacy: score_a/score_b/winner_id/status), `POST /{id}/result`
  (nur matches_v2), `POST /{id}/report` (Spieler-Report → 2 gleiche = auto-complete,
  sonst dispute), `POST /{id}/dispute`, `POST /{id}/forfeit`, `POST /{id}/schedule-proposals`
  + `/{proposal_id}/decision` (Terminvorschlag → Gegner accept/decline/counter).
- Spiele-Hierarchie existiert: `games.kind ∈ {standalone, series, edition}` +
  `parent_game_id`, plus `cover_url/logo_url/short_name`. CRUD: `routes/game_routes.py`.

**Test-Zugänge** (aus `memory/test_credentials.md`): Superadmin
`admin@lionsquad.at` / `LionSquad2026!Admin`; Demo-Spieler `{username}@demo.lionsquad.at`
/ `DemoLion2026!!`.

---

## 1. FIXIERTE PRODUKT-ENTSCHEIDUNGEN (vom Betreiber)
1. Reihenfolge: **erst TEIL A komplett, dann TEIL B**.
2. Tabellenwertung: **Serien-Siege zählen** (BO5 3:1 = 1 Sieg). Map-/Runden-Differenz nur
   als Tie-Break.
3. Trophäen: **rein digital** (Icon/Bild) in Team-Vitrine.
4. Meister-Banner: **automatisch** bei Titelgewinn freischalten.
5. Terminabstimmung: **freie Datum+Uhrzeit**. Season startet Montag → Spieltag N =
   Zeitfenster Mo–So (Datumsbereich). Innerhalb des Fensters votet man die Uhrzeit;
   bestätigter Termin wird gespeichert; Erinnerungen später per Mail + Push.
6. Punkte: **Sieg 3 / Remis 1 / Niederlage 0** (konfigurierbar). Remis nur bei BO1, wenn
   Modus `supports_draw`.

---

## TEIL A — FEIER-FEATURES (zuerst umsetzen, unabhängig)

### A1 — Archetypen-Galerie (Frontend only)
Ziel: Auf der Achievements-Seite (`pages/public/AchievementsShowcasePage.jsx`) eine Sektion
mit ALLEN 30 Rahmen-Archetypen als Vorschau.
- Neue Komponente `components/tls/ArchetypeGallery.jsx`. Rendert 1..30:
  `LevelAvatarFrame level={n} showBadge` (non-compact) + Archetyp-Name
  `levelFrameConfig(n).name` + „erreicht/gesperrt".
- „erreicht" = `n <= myLevel`. `myLevel` aus `GET /api/users/me/level` (nur wenn eingeloggt;
  sonst alles als Vorschau, nichts gesperrt-markiert). Alternativ aus vorhandenen
  Punktedaten via bestehender `levelFromPoints`-Logik.
- Einbau als eigene Section (`data-testid="archetype-gallery"`, Karten
  `data-testid="archetype-card-{n}"`), z. B. zwischen Bestenliste und „Alle Achievements".
- DoD: Screenshot zeigt 30 Karten mit Namen; gesperrte visuell abgesetzt; keine Konsolen-
  fehler; Seite lädt weiterhin für Gäste.

### A2 — Team-Podium (Silber/Bronze-Kronen für Team #2 & #3)
Backend `services/team_levels.py`: neue Funktion `top_team_crowns(data) -> dict[team_id, "gold"|"silver"|"bronze"]`.
- Nur Teams mit `points > 0`. Sortierung: points DESC → level DESC → name ASC. Top-3 =
  gold/silver/bronze.
`routes/team_level_routes.py`:
- `GET /api/teams/levels` → zusätzlich `"crowns": {team_id: variant}` (bis zu 3).
- `GET /api/teams/{id}/level` → Feld `"crown": variant|null`.
Frontend `pages/public/TeamsPage.jsx`:
- `crowns`-State laden; `TeamCard` erhält `crown`-Prop → an `LevelAvatarFrame crown={variant}`.
- Chip für alle 3 (nicht nur gold): Farben gold `#FFD700`, silver `#C0C0C0`, bronze
  `#CD7F32`; Label `#1/#2/#3`. Testids `team-crown-chip-{TAG}`.
- Detailseite: `LevelAvatarFrame crown={levelInfo.crown}`; Chip gold→„PUNKTEBESTES TEAM",
  silver→„VIZE-MEISTER", bronze→„PLATZ 3" (`team-detail-crown-chip`).
- DoD: `GET /api/teams/levels` liefert genau 3 Kronen (bei ≥3 Teams mit Punkten);
  Screenshot Teamliste zeigt 3 Kronen unterschiedlicher Farbe.

### A3 — Team-Aufstieg-Feier (für alle Team-Mitglieder)
Backend neue Datei `services/team_events.py` (kann A3+A4 zusammenfassen):
- Collection `team_level_state` {id=team_id, level, updated_at}.
- Funktion `sync_team_state()`: `compute_all_team_levels()` frisch; pro Team Level mit
  `team_level_state` vergleichen. Erst-Eintrag ohne Feier (nur speichern). Bei ANSTIEG →
  `create_user_notification` an ALLE `member_ids`, kind `team_level_up`,
  meta `{category:"team", team_id, team_tag, team_name, level, dedupe_key:f"teamlvl-{id}-{level}"}`,
  url `/teams/{id}`. State aktualisieren.
- Debounced `schedule_team_sync()` (2s, wie `schedule_crown_sync`).
Hooks: dort aufrufen, wo `schedule_crown_sync()` schon aufgerufen wird
(`badges.award_achievement` bei positivem Award; Admin-Revoke in `routes/badge_routes.py`).
Optional zusätzlich bei Turnierabschluss (siehe B, wenn vorhanden).
Frontend:
- `NotificationBell.jsx`: unread `team_level_up` (dedupe via `localStorage
  tls-team-celebrated`) → `window.dispatchEvent(new CustomEvent("tls-team-celebration",
  {detail:{type:"level", ...meta}}))`.
- Neue Overlay-Komponente `components/tls/TeamCelebration.jsx` (Muster wie
  `LevelUpCelebration`), gemountet in `PublicLayout`. Für `type:"level"`:
  `LevelAvatarFrame team level={meta.level}` (Team-Tag/Initialen innen) + Headline
  „TEAM-LEVEL {level} ERREICHT" + Teamname. Konfetti. Testids
  `team-celebration-overlay`, `team-celebration-title`.
- DoD: Skript erhöht Team-Punkte über eine Levelgrenze → alle Mitglieder erhalten
  `team_level_up`-Notification; beim Mitglied erscheint Overlay einmalig (nach Reload nicht
  erneut).

### A4 — Krone-erobert-Duell (Team-Goldkrone Wechsel)
Backend in `services/team_events.py` erweitern:
- Collection `team_crown_state` {id:"current", holders:{team_id:variant}, version, updated_at},
  race-safe per optimistischem `update_one({version:old},{...version:old+1})`.
- In `sync_team_state()` nach Level-Check: `top_team_crowns` berechnen, mit State
  vergleichen; nur bei Änderung Version erhöhen. Transitionen → Notifications an alle
  Mitglieder:
  - Neuer/verbesserter GOLD-Halter → kind `team_crown_gained`
    (meta variant gold, team_*, dedupe `teamcrown-v{version}-{team_id}`).
  - Neu in Top-3 (silver/bronze) oder Rangänderung → kind `team_crown_changed`.
  - Verlorene Krone (war Halter, jetzt raus) → kind `team_crown_lost`.
Frontend:
- `NotificationBell.jsx`: unread `team_crown_gained` → dispatch `tls-team-celebration`
  `{type:"crown", variant:"gold", ...meta}` (dedupe wie A3). `team_crown_lost`/`changed`
  brauchen KEIN Overlay (bestehender Toast reicht).
- `TeamCelebration.jsx`: für `type:"crown"` große `CrownIcon variant="gold"` + Strahlen
  (Reuse `tls-crown-celebration-*`) + Headline „TEAM-KRONE EROBERT!" + „[TAG] Name ist das
  punktbeste Team!".
- DoD: E2E hin+zurück (Team A überholt Team B in Punkten und zurück) erzeugt exakt die
  erwarteten Gained/Lost-Notifications (idempotent, keine Dubletten); Gold-Overlay beim
  neuen #1, nur Toast beim Verlierer.

### A5 — Level-Aufstieg Sound-Cue (Web Audio)
Frontend `lib/unlockSounds.js`: `export function playLevelUpCue(level){ playUnlockSound(
level>=20?5 : level>=12?4 : level>=5?3 : 2); }` (respektiert Mute automatisch).
`components/tls/LevelUpCelebration.jsx`: beim Setzen des Events `playLevelUpCue(event.level)`
aufrufen. (Optional auch in `TeamCelebration` einen Cue spielen.)
- DoD: Beim Aufstiegs-Overlay ertönt ein Cue; bei aktivem Mute (`tls_sound_muted`) still.

**TEIL-A-Abschluss:** Testing-Agent nur für Frontend-Flows (A1 Galerie, A2 Kronen sichtbar,
A3/A4 Overlays via getriggerten Notifications, A5 Sound optional manuell). Backend: gezielte
E2E-Skripte + `pytest`.

---

## TEIL B — PRODUKTIVES WETTKAMPF-/LIGA-SYSTEM (danach, phasenweise)

Leitprinzip: MODULAR PRO SPIEL. Turnier erbt Defaults vom Spiel/Edition, überschreibbar.
Kein spielabhängiger Sonderfall im Code — alles über Config-Daten.

### PHASE B0/B1 — Datenmodell + Admin-Verwaltung
Neue/erweiterte Collections (alle mit `id` (uuid str), ISO-Zeiten, `{"_id":0}`-Projektion):
- `games` erweitern: `cover_url`, `logo_url`, `short_name`, embedded `competition_defaults`
  {default_best_of, default_result_mode ("staff_only"|"both_confirm"|"hybrid"),
  scoring {win:3, draw:1, loss:0, tiebreakers:["head_to_head","map_diff","round_diff"]},
  supports_draw:bool, series_style ("map_series"|"single"|"points"|"aggregate"),
  has_map_veto:bool}. Franchise=„series", Editionen=„edition" mit eigenem Bild
  (z. B. Call of Duty → Black Ops 7 / Modern Warfare 4).
- `game_modes` (NEU): {id, game_id, key, name, scoring_type
  ("first_to"|"best_of_rounds"|"time"|"points"), win_target, sort_order, is_active}.
- `maps` (NEU): {id, game_id, name, image_url, modes:[mode_key], is_active}.
- `veto_templates` (NEU): {id, game_id, best_of, sequence:[{step, action:"ban"|"pick"|
  "decider", side:"a"|"b"|"auto"}], name}.
Endpoints (Admin, `require_admin()`/Staff): CRUD unter
`/api/games/{id}/modes`, `/api/games/{id}/maps`, `/api/games/{id}/veto-templates`;
`games`-CRUD um Bild/Defaults erweitern. Bilder via Object Storage
(`/api/uploads/...` bzw. bestehender Upload-Weg) — kein Base64.
Admin-Frontend: Spiel-Editor mit Tabs „Editionen", „Modi", „Maps (Bild)", „Veto-Vorlagen",
„Wettkampf-Defaults".
DoD: Franchise+Editionen+Modi+Maps anlegbar, im Turnier auswählbar; Bilder laden.

### PHASE B2 — Turnier-Konfiguration + Serien-Scoring
`TournamentCreate/Update` erweitern: `game_edition_id`, `series_best_of` (1/3/5),
`veto_template_id`, `result_mode`, `schedule_mode` ("fixed"|"vote"), `scoring` (override der
game-defaults), `mode_sequence` (Modi-Reihenfolge je Map der Serie), `trophies`
(siehe B8).
Match-Dokument (`db.matches`) erweitern für Serie: `series_best_of`,
`series:[{index, mode_key, map_id, score_a, score_b, winner_reg_id, status}]`,
`series_wins_a`, `series_wins_b`.
Sieglogik: Serie gewonnen bei `ceil(best_of/2)` Map-Siegen. Standings zählen **Serien-Siege**
(Entscheidung 2); Map-/Runden-Differenz nur Tie-Break. Remis nur bei BO1 + `supports_draw`.
Engine: `bracket_engine`/`competition_standings` um serien-basierte Wertung ergänzen, ohne
BO1-Verhalten zu brechen. Read-Model muss Serie in Standings korrekt spiegeln.
DoD: BO5 3:1 zählt als 1 Sieg; Tabelle mit Punkten 3/1/0 + Tie-Break korrekt; BO1 unverändert.

### PHASE B3 — Ergebnis-Flow „online" + Tickets
`POST /api/matches/{id}/report` erweitern: beide Teams melden Serie (Map-für-Map). Gleiche
Meldung → auto-complete (Sieger/Score/Advancement/Standings). Ungleich → Status „disputed"
und **automatisch Ticket** anlegen.
Neue Collection `tickets` {id, tournament_id, match_id, type
("result_dispute"|"no_show"|"other"), status ("open"|"in_review"|"resolved"), opened_by,
messages:[{user_id, text, at}], resolution, decided_by, created_at}. Endpoints:
`GET/POST /api/tickets`, `POST /api/tickets/{id}/messages`, `POST /api/tickets/{id}/resolve`
(Admin). Admin entscheidet final via bestehendem `PATCH /api/matches/{id}` (Staff-Override).
DoD: 2 gleiche Reports → completed; 2 verschiedene → Ticket „open" + Match „disputed";
Admin resolved → Match completed.

### PHASE B4 — Map-Veto (Pick/Ban) LIVE
Match-Feld `veto` {state, template_id, sequence-progress, remaining_maps,
current_turn_reg_id, picks:[{map_id, mode_key}], bans:[map_id]}.
Endpoint `POST /api/matches/{id}/veto/action` {action, map_id}: serverseitig Turn +
gültige Map + Template-Schritt prüfen; bei Abschluss `series` mit gepickten Maps/Modi füllen.
LIVE: Mutation erzeugt Change-Event → Gegnerclient re-fetcht automatisch (`useApiInvalidation`
auf `matches`); optional gezieltes SSE-Event. KEIN Aktualisieren-Button.
Frontend: Veto-Board (Map-Bild-Kacheln, „dein Zug/warten", gebannt=durchgestrichen,
gepickt=hervorgehoben), optional Zug-Countdown. Testids `veto-board`, `veto-map-{id}`,
`veto-turn-indicator`.
DoD: 2 Sessions; Bann/Pick bei Team A erscheint bei Team B sofort ohne Reload;
Reihenfolge/Turn serverseitig erzwungen.

### PHASE B5 — Terminabstimmung LIVE (Season→Spieltag-Fenster + Uhrzeit-Voting)
Season/Spieltag: Season startet Montag; Spieltag N = Datumsbereich Mo–So (Generator, der
Fenster erzeugt). `schedule-proposals` erweitern: beide Seiten schlagen mehrere
Datum+Uhrzeit-Slots im Fenster vor; Overlap → auto-confirm; sonst Gegner bestätigt einen.
Match-Felder `scheduled_at`, `schedule_status`. Erinnerungs-Hook vorbereiten
(Scheduler/Mail-Queue existiert; Push später).
LIVE wie B4 (Change-Events). Frontend: „Termine vorschlagen" (Datum+Uhrzeit, mehrere),
Gegner sieht/bestätigt live; bestätigter Termin am Match sichtbar. Testids
`schedule-propose`, `schedule-slot-{i}`, `schedule-confirm`.
DoD: A schlägt 3 Slots vor, B bestätigt einen → beide sehen `confirmed` live; Erinnerungs-
Job ist angelegt (auch wenn Versand später).

### PHASE B6 — Live-UI durchgängig
Sicherstellen: Veto, Termine, Reports, Ergebnisse, Tickets invalidieren korrekt über
`change_events`; Clients laden automatisch. Zwei-Client-E2E je Flow.

### PHASE B7/B8 — Liga-Trophäen (digital) + Meister-Banner
Turnier `trophies:[{place, label, icon, image_url}]`. Bei Abschluss → `team_trophies`
{team_id, tournament_id, trophy, awarded_at}. Team-Seite: Trophäen-Vitrine
(`data-testid="team-trophy-cabinet"`). Meister-Banner **automatisch** freischalten, wenn
Team einen Titel (Platz 1) gewinnt → Flag/Asset am Team; auf Teamseite anzeigen.
DoD: Turnier beenden → Meister-Team zeigt Trophäe + freigeschaltetes Banner.

### PHASE B9 — CoD-Referenzkonfiguration (echte Daten, kein Demo)
Anlegen (via Admin-UI/Seed, admin-pflegbar): Franchise „Call of Duty" (series) → Editionen
„Black Ops 7 (BO7)", „Modern Warfare 4 (MW4)" mit Cover. Modi: Search & Destroy
(first_to 6), Hardpoint/Stellung (points, win_target 250), Control/Kontrolle
(best_of_rounds, first_to 3). BO5-Serie „first to 3", CDL-Modus-Reihenfolge als
`mode_sequence` + `veto_template`. Map-Pool je Modus mit Bildern.

---

## 3. TEST- & ABNAHME-STRATEGIE (für jede Aufgabe)
- Backend: gezielte `pytest`-Tests + curl-E2E über `REACT_APP_BACKEND_URL` (nicht localhost)
  mit CSRF/Cookie. Nach Award-/Sync-Änderungen: PARALLEL-Test gegen `DuplicateKeyError`
  (bestehendes Muster) beibehalten.
- Frontend/Live: Zwei-Browser-Sessions für Veto/Termine/Reports (kein `networkidle` auf
  SSE-Seiten → `domcontentloaded`).
- Nach UI-Batches: `frontend` ggf. neu starten (stale Bundle), 1 Smoke-Screenshot, dann
  Testing-Agent.
- Nach jeder Phase: `pytest` grün + Testing-Agent-Bericht (Bugs zuerst fixen).

## 4. DEFINITION OF DONE (global)
- Keine `.env`-Keys verändert; alle URLs/Secrets aus env.
- Keine rohen ObjectIds in Responses; UTC-ISO-Zeiten.
- Bilder in Object Storage, nicht Base64.
- Alle interaktiven Elemente mit `data-testid`.
- Bestehende Flows (Auth, bestehende Turniere Single/Double/Round-Robin, Achievements,
  Kronen) funktionieren unverändert.
- `memory/PRD.md` + ggf. `memory/test_credentials.md` aktualisiert.

## 5. REIHENFOLGE FÜR CODEX
1) TEIL A: A5 → A1 → A2 → A3 → A4 (klein→groß), je mit DoD-Test.
2) TEIL B: B0/B1 → B2 → B6-Scoring → B3 → B4 → B5 → B7/B8 → B9. Jede Phase eigenständig
   testbar & gemergt, bevor die nächste startet.
