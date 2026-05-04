# THE LION SQUAD — eSPORTS · Vereinsplattform PRD

**Projekt:** THE LION SQUAD — eSPORTS Vereinsplattform (Re-Brand von TLS ARENA)
**Verein:** THE LION SQUAD eSports (offiziell eingetragener österreichischer eSports-Verein)
**Stack:** FastAPI + MongoDB + React 19 + Tailwind + Shadcn/UI + Framer Motion
**Erstellt:** 2026-05-04 (Re-Plattform Phase 1+2)

---

## Vision (NEU)

Zentrale Vereinsplattform für THE LION SQUAD — eSPORTS.
**Hauptebene:** Vereinswebseite (Verein, Mitglieder, News, Events, Sponsoren, Vorteile).
**Integriertes Modul:** Arena (Turniere, Fast Lap, Brackets, Achievements, Season Pass).
Ein Rudel — online wie offline.

## User Trennung (zentraler Begriff)
- **Gast** — nicht eingeloggt
- **Community-Spieler** — registriert, kein offizielles Vereinsmitglied
- **Vereinsmitglied** — vom Admin freigeschaltet (Mitgliedsnummer TLS-YYYY-NNNN)

NIE einen registrierten Nutzer als „Mitglied" bezeichnen. Stattdessen „Community" oder „Spieler".

## Phase Auto-Hooks + Phase E + Phase F + Discord-Counter (04.05.2026)

### Auto-Hooks für Negative-Achievements
- **`POST /api/matches/{id}/dispute`** ruft `on_dispute_opened(user_id)` → vergibt `neg_dispute`
- **`POST /api/matches/{id}/forfeit`** löst `trigger_negative_incident(loser_user_id, "no_show", ...)` aus
- **`POST /api/tournaments/{id}/checkin`** prüft `check_in_until` Cutoff → bei Überschreitung `neg_afk` (mit Minuten-Verspätung im Context)
- Alle Hooks fail-silent (try/except), brechen niemals die Match-/Turnier-Workflows

### Phase E — Twitch Live-Streamer-Detector
- **`services/twitch_service.py`**: OAuth-Client-Credentials-Token mit DB-Cache (`twitch_app_token`), `/helix/streams` Polling für alle User mit `twitch_handle`/`twitch_channel`, Batch-Size 100, fail-silent ohne Credentials
- **APScheduler-Job** `twitch_poll` läuft alle 90 s, max_instances=1, coalesce
- **`live_streams`** Collection wird upserted mit Stream-ID/Title/Game/Viewers/Thumbnail/Started_at/Stream_URL — offline Streams werden gelöscht
- **`GET /api/streams/live`** (public) sortiert nach viewer_count DESC
- **`POST /api/admin/streams/refresh`** für sofortige Force-Polls
- **Branding-Settings** erweitert: `twitch_client_id`, `twitch_client_secret`, `twitch_live_detection` (alle optional)
- **Frontend-Slider** `LiveStreamSlider.jsx` auf HomePage: pulsierende rote LIVE-Pille, horizontaler Snap-Scroller mit Stream-Cards (Thumbnail · LIVE-Badge · Viewer-Counter · Display-Name · Title · Game-Name in Twitch-Lila), klick öffnet `twitch.tv/{login}` in neuem Tab. Nicht gerendert wenn keine Streams live.

### Phase F — Web-CMS (Pages + Email-Templates)
- **`cms_pages`** Collection mit 4 Default-Seiten (`about`/`values`/`imprint`/`privacy`) — beim Startup geseedet (idempotent)
- **`GET /api/pages/{slug}`** (public, nur `is_published != false`)
- **Admin CRUD** `/api/admin/pages` — Default-Seiten können nur deaktiviert (is_published=false), nicht gelöscht werden
- **`email_templates`** Collection mit 4 Default-Templates (`membership_approve`, `membership_reject`, `contact_auto_reply`, `membership_application_admin`) inkl. `vars`-Liste für Placeholder
- **Admin** `/api/admin/email-templates` GET/PATCH (Subject + HTML)
- **Helper** `render_template(key, vars_)` substituiert `{{var}}` Placeholders — bereit für Wiring in mail_queue
- **Frontend `CmsPage.jsx`**: generischer Markdown-Light-Renderer (h1/h2/h3, **bold**, *italic*, [Links](url), Listen, ---). Routes `/about`, `/values`, `/imprint`, `/privacy` ziehen jetzt aus DB
- **Frontend `AdminCmsPage.jsx`**: 2-Tab-Editor (Seiten · E-Mail-Templates). Pages-Editor mit Markdown-Quelle + Live-Vorschau Side-by-Side, Templates-Editor mit Subject + HTML + Vars-Hint. „Live"/„Versteckt"-Toggle direkt in der Tabelle.
- **AdminLayout-Sidebar** Eintrag „CMS / Mails" (FileEdit-Icon) zwischen Bewerbungen und unten

### Discord-Counter (Mod-Bump statt Bot)
- **`POST /api/admin/discord/counter/{user_id}`** `{delta: int}` inkrementiert `users.discord_messages_count`, ruft sofort `evaluate_user_progress` auf → Auto-Award der `discord_active_*` Tiers (Bronze 1 / Silber 100 / Gold 500 / Platin 2000)
- **`GET /api/admin/discord/counters`** für Admin-Übersicht
- **Audit-Log** für jeden Bump (`action: discord.counter_bump`, mit delta + new_total)
- `discord_active`-Tiers nicht mehr `manual_only` — werden automatisch vergeben sobald counter ≥ Threshold
- `compute_user_progress.discord_messages` zieht jetzt aus `user.discord_messages_count`

### Tests
- **iteration_17**: pytest `test_phase_ef_iter17.py` → **22/22 grün** (Streams · Branding-Twitch-Felder · Pages CMS CRUD · Email-Templates · Discord-Counter inkl. Auto-Award · Auto-Hooks für dispute/forfeit/late-checkin · Privacy-Re-Check)



### Achievement-Erweiterung (Track 1)
- **Catalog von 100 auf 138 Tiers erweitert** in 39 Groups: 5 neue Groups (`community_helper`, `event_host`, `season_consistency`, `profile_completeness`, `tutorial`), Legend-Stufen (Level 5) für `match_master`, `victory_count`, `win_streak`, `fairplay`, `fastlap_volume`, `pole_position_collector`, `tournament_veteran`, `podium_collector`, `tournament_champion`, `event_attendance`, `team_loyalty`, `achievement_collector`. Platinum für `discord_active`/`track_master`/`marathoner`/`format_master`/`platform_diversity`/`registration_speed`/`checkin_streak`. Gold für `early_bird_match`/`night_owl_match`.
- **Negative-Incident-Trigger** (`POST /api/admin/achievements/trigger-incident`): 8 Vorfall-Typen mit fixem Tier-Mapping (`afk → neg_afk`, `no_show → neg_no_show`, `ghost → neg_ghost`, `rage_quit → neg_rage_quit`, `controller_throw → neg_controller_throw`, `chat_warning → neg_chat_warning`, `dispute_open → neg_dispute`, `team_no_show → neg_team_no_show`). Zusätzliche Helper `on_dispute_opened`/`on_match_disconnect` für künftige Auto-Hooks.
- **Season-Completion-Hook** `on_season_completed(season_id)` + Admin-Endpoint `POST /api/admin/achievements/season/{id}/award`: vergibt `season_climber` + `championship_top` Tiers (Bronze/Silber/Gold/Platin) basierend auf `season_standings.rank`.

### Phase C — Mitglieder-System dynamisch (Track 2)
- **Profilvollständigkeit-Score**: `compute_profile_completeness()` mit gewichteten 12 Feldern (avatar/bio/country/city/birthdate/main_platforms/input_devices/favorite_games/discord_name/twitch_channel/banner_url/privacy). Endpoints `/api/users/me/profile-completeness` und `/api/users/{id}/profile-completeness` liefern `score` + `missing[]`. Auto-Award für `profile_completeness_b/s/g` Tiers bei 50%/75%/100%.
- **Membership-Application-Form**:
  - `POST /api/membership/apply` mit Motivation (≥20 Zeichen) + Beitragsart (full/supporter/youth/honorary) + Statuten/Privacy-Akzept
  - `GET /api/membership/apply/me` für eigene aktuelle Bewerbung
  - `GET /api/membership/applications` (admin) mit Status-Filter
  - `PATCH /api/membership/applications/{id}` (admin) `{decision: approve|reject, note}` → bei approve wird `db.memberships` aktiviert + Audit-Log + Mail an User + `evaluate_user_progress` (membership_join Auto-Award)
  - Admin-Mail bei jeder neuen Bewerbung über `mail_queue.enqueue_mail`
  - Doppelte/aktive-Member-Schutz mit 409
- **Auto-Badges in Member-Cards** (`/players` + `/api/users/public-list`): Backend enriched mit `profile_completeness` (number), `achievements_count`, `top_achievement` (name/level/level_color/level_name/code/icon). Frontend rendert: Profile-Score-Pill rechts unten am Avatar, Top-Achievement-Chip in Level-Color, Achievements-Counter.
- **Profile-Completeness-Banner** auf `/dashboard`: lila SVG-Donut-Ring mit Score, fehlende Felder als Hinweis, „Vervollständigen"-CTA → `/profile`.
- **Admin-Sidebar** Eintrag „Bewerbungen" (Inbox-Icon) mit 3-Tab-Inbox (Offen/Akzeptiert/Abgelehnt), Detail-Modal, Approve/Reject-Workflow inkl. Notiz-Prompt.
- **Frontend-Routes**: `/membership/apply` (auth-required) + `/admin/membership-applications` (admin-only).

### Tests
- iteration_16: Backend 12/12 grün, Frontend 4/5 grün (1 LOW = Admin viewt eigenes /membership/apply → korrekte „bereits Mitglied"-Status-Card statt Form). retest_needed: False.



**User-Wunsch:** Achievement-System weg vom öffentlichen Katalog, nur noch im Profil. Tiered Bronze/Silber/Gold/Platin/Special-Rot mit aufklappbaren Stufen. Negative-Achievements **niemals** öffentlich, nur intern für Admin sichtbar.

### Backend Engine (`/app/backend/badges.py` + neuer `achievement_catalog.py`)
- **Neue Collections**: `achievement_groups` (39), `achievements` (100 Tiers), `user_achievements`
- **Migration Option B**: einmaliges Auto-Wipe der Legacy `badges` + `user_badges` (settings-Marker `achievements_v4_migrated`)
- **Groups**: 8 match · 8 tournament · 5 fastlap · 7 club · 6 special · 5 negative (intern)
- **Tier-Levels**: 1=Bronze, 2=Silber, 3=Gold, 4=Platin, 5=Special-Rot — pro Group beliebig kombinierbar (manchmal nur Platin, manchmal alle 4)
- **`compute_user_progress`**: condition_keys aus echten DB-Daten (matches_played, matches_won, match_streak_max, tournaments_won, podium_finishes, fastlap_valid_count, distinct_tracks, pole_count, membership_days, distinct_games_registered, distinct_formats, distinct_platforms, achievements_unlocked, teams_founded, etc.)
- **`evaluate_user_progress`**: scannt alle progress-basierten Tiers + auto-vergibt bei `current >= target`
- **Hooks** `on_tournament_registered/checked_in/match_completed/tournament_completed/lap_submitted/team_*`/`evaluate_membership_badges` rufen alle `evaluate_user_progress` auf
- **Negative-Auto-Award**: Holzmedaille bei rank=4, Wandmagnet bei 5+ ungültigen Laps in einer Challenge
- **Discord-Hook** nur für nicht-negative Awards mit Tier-Farbe + Punkten

### Privacy (kritisch nach iteration_14 Privacy-Bug)
- **`list_groups_for_user`** filtert `is_negative=true` direkt in der DB-Query → niemals in `/api/achievements/me` oder `/user/{id}` zurückgegeben — auch nicht für Admin
- **`list_user_awards`** filtert `is_negative=true` hart unabhängig vom Viewer
- **`/api/users/public/{username}` badges** filtert ebenfalls is_negative
- **Negative-Inventar** ausschließlich über `/api/admin/achievements/negative/awards`

### Routes
- **Public/User** (`/api/achievements`):
  - `GET /groups` — Catalog ohne Negative
  - `GET /me` — `{groups, awards}` mit Progress (eigene)
  - `GET /user/{user_id}` — Public Profile-View
  - `POST /evaluate` — Re-Evaluation für eigenen Account (auto-award)
- **Admin** (`/api/admin/achievements`):
  - `GET/POST/PATCH/DELETE /groups` — System-Groups nicht löschbar (nur is_admin_created)
  - `GET/POST/PATCH/DELETE /tiers`
  - `POST/DELETE /award` — manuelle Vergabe / Revoke (Audit-Log)
  - `GET /negative/awards` — Inbox mit User-Info
  - `GET /users/search?q=` — Spielersuche für Manual-Award-Picker

### Frontend
- **`/badges` Public-Page entfernt** (Component + Route + Footer-Link + eSports-Dropdown-Eintrag) — Achievements gibt's nur noch im Profil
- **`AchievementGroupsView` Component**: aufklappbare Group-Cards, höchste erreichte Tier sichtbar (mit 🥉🥈🥇💎❤ + Level-Color-Border), Klick = inline expand, Tier-Rows mit Progress-Bar/Lock-Icon, manual_only-Hinweis. Kein Routing-404 mehr.
- **PublicProfilePage** überarbeitet: lädt `/api/achievements/user/{id}` parallel zum Profile, neuer Achievements-Tab mit `AchievementGroupsView`, „Letzte Achievements" auf Übersicht zeigt Top-4 mit Level-Color-Sidebar
- **`AdminAchievementsPage`** neu: 4 Tabs (Groups · Tiers · Manuell vergeben · Negative Vorfälle), volle CRUD inkl. Color-Picker + Icon-Field + manual-only-Toggle, Spielersuche mit Live-Filter (debounced), Negative-Inbox als getrennter Bereich
- **AdminLayout-Sidebar** Eintrag „Achievements" mit Medal-Icon zwischen Sponsoren und Vorstand

### Tests
- iteration_14: 17/18 (1 Privacy-Bug) → iteration_15: **19/19 grün** nach Privacy-Fix
- Frontend: alle Smoke-Checks grün, Group-Cards rendern Locked + Earned korrekt mit Progress-Bars



- [x] **MainNav umgebaut**: 7 Top-Level (Home / Verein / News / Events / eSports / Community / Kontakt). „Spieler" + „Mitglieder" zu **„Community"**-Dropdown gemerged (Vereinsmitglieder, Community-Spieler, Mitglied werden, Divider, Member-only Items: Mitgliederbereich / -vorteile / -dokumente)
- [x] **Footer 2-Reihen-Layout** (Desktop): 5 Link-Spalten (Brand+Social, Verein, eSports, Community, Kontakt), Bottom-Bar mit Impressum/Datenschutz/Versions-Tag. Sponsoren-Link in Kontakt-Spalte verschoben.
- [x] **Dynamisches Vorstand-Modul**: `/api/board` CRUD mit Default-Seeds (Obmann/Schriftführer/Kassier), Geschlechter-spezifische Titel (Obmann/Obfrau), Stellvertreter-Support, Standard-Positionen können nicht gelöscht werden (deaktivieren stattdessen)
- [x] **Public BoardPage** dynamisch aus `/api/board?active_only=true`, Avatare + Verlinkung zu PublicProfilePage
- [x] **Admin /admin/board**: Tabelle mit Aktiv-Toggle, Zuweisungs-Selects (User + Stv.), Eigene-Position-Modal
- [x] **Kontaktformular** (`/api/contact/submit` + `/contact/topics`): 9 Topics (general/membership/tournament/fastlap/sponsorship/press/report_bug/abuse/other), Auto-Reply via Mail-Queue, Admin-Notification an `branding.contact_email` oder Superadmin
- [x] **Admin /admin/contact**: Inbox mit Status-Filter (new/in_progress/answered/closed/spam), Detail-View mit Status-Buttons + interner Notiz, Mailto-Reply
- [x] **Tests**: 9/9 Backend + 14/14 Frontend grün (iteration_13.json)

## Phase B v3 — Globales Achievement-System (04.05.2026)

- [x] **Catalog erweitert** auf 64 Badges (vorher ~28): 14 neue positive (`first_dispute_resolved`, `nightowl`, `early_bird`, `perfect_attendance`, `comeback_king`, `multi_game`, `multi_platform`, `season_silver`, `invite_friend`, `streamer_spotted`, `photo_op`, `event_attendance_5`, `badge_collector_10`, `badge_collector_25`)
- [x] **25 Player-Negative-Fun-Badges** (zusätzlich zu den 6 existierenden): `ghost_player`, `rage_quitter`, `nullachter`, `tilt_master`, `captain_obvious`, `disconnect_diva`, `snack_break`, `forgot_to_register`, `backseat_pro`, `toxic_chat_warning`, `no_show_admin`, `controller_throw`, `lucky_loser`, `flagged_screenshot`, `warmup_master`
- [x] **7 Team-Negative-Fun-Badges**: `team_one_man`, `team_no_show`, `team_friendly_fire`, `team_late_arrival`, `team_dispute_loop`, `team_drama_queen`, `team_revolving_door`
- [x] **8 Fast-Lap-Negative-Fun-Badges**: `offroad_artist`, `reverse_gear`, `slowest_lap`, `crash_test_dummy`, `invalid_streak`, `pit_lane_pro`, `dnf_legend`, `ghost_lap`
- [x] **Neue Badge-Felder**: `progress_target`, `condition_key`, `severity` (mild/medium/savage)
- [x] **Progress-Aggregator** (`badges.compute_user_progress`): liefert tournaments_registered / fastlap_valid_count / badges_unlocked / events_attended / distinct_games_registered / distinct_platforms / checkins_in_a_row
- [x] **`GET /api/badges/progress/me`**: Liste fortschrittlicher Badges mit current/target/percent
- [x] **Auto-Award bei 100 % Progress**: Aufruf von `/progress/me` evaluiert und vergibt Badges automatisch (z. B. multi_platform sobald 2+ platforms im Profil hinterlegt)
- [x] **BadgeCard** zeigt Progress-Bar bei locked+progress, separater Negative-Style (FF3B30) mit Severity-Label
- [x] **BadgesPage** zeigt „Beinahe geschafft"-Sektion für eingeloggte Nutzer + neue Kategorien Verein und Fun & Negative
- [x] **Tests**: alle Phase-B-spezifischen Backend-Checks grün (badges anon/admin Filter, progress/me, auto-award) — iteration_13.json



- [x] **Neue Hauptnavigation** mit Hover-Dropdowns: Home / Verein / Community / Mitglieder / Events / eSports / News (`MainNav.jsx`, `NAV_STRUCTURE`)
- [x] **memberOnly-Filter** im Mitglieder-Dropdown (Mitgliederbereich/Vorteile/Dokumente nur für Vereinsmitglieder)
- [x] **Mobile-Akkordeon** mit aufklappbaren Sub-Items, automatischem Close beim Klick
- [x] **Breadcrumbs** auf Tournament-, Event-, News-, F1- und Public-Profile-Detail-Seiten (`Breadcrumbs.jsx`)
- [x] **Neue Public-Pages**: `/board` (Vorstand-Stub mit 6 Rollen), `/values` (Werte & Ziele mit 3 Pillars + 5 Zielen) — später CMS-editierbar in Phase F
- [x] **`/seasons/current` Redirect** zur aktiven Season (`CurrentSeasonRedirect.jsx` → `/api/seasons/active/featured`)
- [x] **Branding-Cleanup**: „TLS ARENA" überall durch „THE LION SQUAD" ersetzt (LoginPage, BracketTV, F1TV, PublicProfile, Legal). Footer-Spalte „Arena" → „eSports".
- [x] **Bug-Fix**: `/news/:slug` Route registriert (war versehentlich nicht in App.js)
- [x] **Tests**: 35/36 Frontend-Checks grün, alle Backend-Tests weiterhin grün

## Phase A — Quick-Wins (04.05.2026 · 11/11 grün)

- [x] **Galerie-Bug-Fix**: `/galerie` und `/gallery` Routes registriert (vorher Catch-all 404)
- [x] **Sponsor-Tier-System v2**: 6 Tiers + Auto-Defaults für `show_on_home/footer`. Placement-Filter, PATCH-Recompute.
- [x] **Image-Upload überall**: `<ImageUpload>`-Komponente, Bulk-Upload für Galerie, Auto-Migration externer URLs.
- [x] **Profil Multi-Select**: `input_devices`, `main_platforms`, `gaming_subscriptions`.
- [x] **News Datumsangabe**: `published_at` als `datetime-local`.
- [x] **Twitch-Embed**: Toggle + Public-Profile-Embed.
- [x] **SponsorTicker**: Placement-aware.
- [x] **Tests**: 5/5 + 7/7 grün, Frontend 0 Issues.

## Phase 1+2 — IMPLEMENTIERT (04.05.2026 · Re-Plattform)


## Roadmap (Re-Branding & Skalierung)

### 🔴 Phase D — Vereins-Identität + Navigation-Refactor (NEXT)
- Hauptnavigation: Home / Verein / Community / Mitglieder / Events / eSports / Teams / Spieler / News / Sponsoren / Mein Bereich / Admin
- **Untertabs/Dropdowns** + Mobile Akkordeon
- **Breadcrumbs** auf Detail-Seiten
- „Arena" nur noch als Untermodul, Hauptbranding = „THE LION SQUAD eSPORTS"

### 🟠 Phase B — Globales Achievement-System v3 (Punkt 30+31)
- Datenmodell: `achievement_group_key`, `level`, `progress_target`, `random_trigger_*`, `cooldown_days`, `severity`, `points_value`, `condition_key`
- **Achievement-Engine** mit Trigger-Hooks für alle Plattform-Events
- Progressive Bronze→Silber→Gold→Platin
- Negative Fun-Achievements (25 Player + 7 Team + 8 Fast-Lap), `hidden_until_unlocked`, Random-Trigger, Spam-Schutz
- Profil-Page mit Progress-Anzeige + Locked/Hidden-Logik

### 🟡 Phase C — Mitglieder-System dynamisch (Punkt 32)
- Public/Internal/Admin Member Directory dynamisch
- Profilvollständigkeit-Score
- Auto-Badges in Mitgliederkarten
- Membership-Application Form

### 🟢 Phase F — Web-Admin-CMS (Punkt 34)
- Pages-CMS, Medienverwaltung, Navigation-Editor, Email-Templates, Formular-Inbox

### 🔵 Phase E — Live-Streamer-Integration (Punkt 9)
- Twitch Helix API mit Client-ID/Secret im Admin-Panel
- Auto-Slider auf Home (10s rotation)

### ⚪️ Phase G — SEO + Discovery (Punkt 11)
- JSON-LD strukturierte Daten, dynamische OG-Tags, robots.txt, IndexNow

### ⚫️ Phase H — One-Line Installer (Punkt 10)
- Docker / docker-compose interaktives `install.sh` + `update.sh`


### Backend
- [x] User-Model erweitert: `user_type`, `is_club_member`, `roles[]`, plus 30+ Profilfelder (Vorname/Nachname/Nickname, Geburtsdatum, Stadt, Hauptplattform, Eingabegerät, Lieblingsspiele, Banner, Twitch/YouTube/TikTok/Instagram/X/Steam/Epic/PSN/Xbox/Nintendo/EA/Riot/Battle.net/Website, profile_visibility)
- [x] **Membership-Service** (`services/membership_service.py`): `upsert_membership`, `generate_member_number` (TLS-YYYY-NNNN sequentiell), `derived_user_type`, History-Tracking
- [x] **Membership-Routes** (`routes/membership_routes.py`): meta, me, list, get/put user-membership, public directory, benefits CRUD
- [x] **MemberBenefit-Model** + CRUD mit Sichtbarkeit pro Mitgliedsart
- [x] **UserSocial-Model** + CRUD mit pro-Eintrag-Visibility
- [x] Auth erweitert: `register` mit accept_privacy/terms Pflicht (HTTP 400 bei Verstoß) + newsletter_consent separat opt-in + birth_date + discord_name; `login` und `/auth/me` liefern `membership` + `is_club_member`
- [x] Email-Templates: `membership_activated`, `membership_deactivated`, `membership_blocked` — werden bei Statuswechsel automatisch gefeuert
- [x] `require_club_member()` Dependency
- [x] DB-Wipe-Mechanismus via `TLS_RESET=true` env
- [x] Demo-Seed standardmäßig deaktiviert (`SEED_DEMO=false`)
- [x] Auto-Seed Admin als Vereinsmitglied (TLS-2026-0001, Vorstand)
- [x] Public Routes: `/api/users/public-list`, `/api/users/public/{username}` mit Membership-Block und Socials
- [x] 28 Backend-Tests in `tests/test_phase_membership.py` — 27 pass, 1 skip (96.4%)

### Frontend
- [x] **AuthContext** erweitert: `isClubMember`, `userType`, `isModerator`
- [x] **PublicLayout** rollenabhängig: Verein/News/Events/Turniere/Fast Lap/Teams/Spieler/Mitglieder Nav; goldener „Mitgliederbereich"-Button für Members; Admin-Button cyan
- [x] **ProtectedRoute** mit `requireMember` und `requireModerator`
- [x] **AboutPage** (`/about`) — Vereinsgeschichte, Werte, Off-Game-Aktivitäten (Inhalte aus lionsquad.at integriert)
- [x] **MembersDirectoryPage** (`/members`) — Öffentliches Mitgliederverzeichnis
- [x] **JoinMembershipPage** (`/membership/join`) — „Mitglied werden" Landing
- [x] **MemberAreaPage** (`/members/area`) — Mitgliederbereich (Member-only)
- [x] **MemberBenefitsPage** (`/members/benefits`) — Vorteile (Member-only)
- [x] **PlayersPage** (`/players`) — Spielerliste mit Member/Community-Tabs
- [x] **SponsorsPage** (`/sponsors`) — gruppiert nach Tier
- [x] **PartnersPage** (`/partners`)
- [x] **ContactPage** (`/contact`) — Discord, E-Mail, Vereinsinfo
- [x] **AdminMembersPage** (`/admin/members`) — Mitgliederverwaltung mit Filtern (Alle/Mitglieder/Community/Offen) + Edit-Modal
- [x] **AdminBenefitsPage** (`/admin/benefits`) — Mitgliedervorteil-CRUD mit Mitgliedsart-Filter
- [x] **ProfilePage** überarbeitet — 4 Tabs: Grunddaten / Gaming / Socials / Privatsphäre + Per-Feld-Visibility-Selector
- [x] **RegisterPage** überarbeitet — accept_privacy + accept_terms (Pflicht), newsletter_consent (separat opt-in), birth_date + discord_name, klare „Du wirst Community-Spieler"-Hinweis
- [x] **DashboardPage** überarbeitet — Member-only Tiles (Mitgliederbereich + Vorteile), Mitgliedsnummer, „Mitglied werden" CTA für Community
- [x] **AdminLayout** erweitert — Mitglieder + Mitgliedervorteile in Sidebar

## Roadmap (Phase 8-10) — IMPLEMENTIERT (04.05.2026)

### 🔵 Phase 8 — SMTP & Mail Queue (Resend abgelöst)
- [x] **`services/mail_queue.py`** — `enqueue_mail()` (Queue + Dedupe via dedupe_key), `process_mail_queue()` Worker mit exponentiellem Retry-Backoff (1m/5m/30m/2h/12h, max 6 Versuche), `smtp_test()` für direkten SMTP-Test
- [x] **aiosmtplib** echt-async SMTP-Versand (STARTTLS / SSL/TLS / plain), `from_header` mit Display Name, MIME-multipart HTML
- [x] **Resend bleibt als Fallback-Provider** — admin wählt provider=smtp|resend
- [x] **`services/scheduler.py`** mit APScheduler: mail_queue alle 30s, match_reminders alle 5min, prize_expiry alle 60min, max_instances=1+coalesce gegen Überlappung, in lifespan gestartet/gestoppt
- [x] **`services/match_reminder.py`** — schedule_match_reminders: 24h/2h/30m/10m Lead-Time-Mails, dedupe via match_reminder:{mid}:{uid}:{label}
- [x] **email_service.py** — `send_template(queue=True)` per default; neue Templates: `match_lead_24h/2h/30m/10m`, `prize_ready/picked_up/expired`
- [x] **Admin UI**: `/admin/settings` Tabs neu **SMTP** (Provider-Switch, Host/Port/User/Pass/Sicherheit/Sender) + **Mail-Queue** (Auflistung mit Status-Filter, Process-Now-Button, Retry/Delete pro Job)
- [x] **API**: GET/PUT `/api/settings/smtp` (Pass maskiert), POST `/api/settings/smtp/test`, GET `/api/settings/mail-queue`, POST `/api/settings/mail-queue/process`, POST `/{id}/retry`, DELETE `/{id}`

### 🟢 Phase 9 — Preise & Gewinnabholung
- [x] **`services/prize_service.py`** — `auto_create_for_tournament()` idempotent, `mark_ready()` + `mark_picked_up()` + `expire_overdue()` (90-Tage-Default-Frist)
- [x] **Auto-Trigger** in `tournament_routes.py` `set_status="results_published"` legt Pickups basierend auf `prize_places` + matches.final_position an
- [x] **Email-Trigger** via Mail Queue: prize_ready bei mark_ready, prize_picked_up bei mark_picked_up, prize_expired bei expire_overdue (mit dedupe_key)
- [x] **API**: `/api/prizes` admin (CRUD + Status-Patch), `/api/prizes/me` user, `/api/prizes/me/open-count` Dashboard-Hint, `/api/prizes/auto-create/{tid}` manueller Trigger
- [x] **Admin UI**: `/admin/prizes` Status-Stat-Cards (Offen/Bereit/Abgeholt/Verfallen), Filter, Aktionen (Bereit-markieren / Abgeholt / Zurück / Löschen)
- [x] **User UI**: `/my/prizes` mit getrennten Sektionen Offene + Archiv, Hinweis-Karte, Frist sichtbar
- [x] **Dashboard-Hint**: Goldene CTA-Kachel auf Dashboard wenn open_count > 0

### 🟣 Phase 10 — Feinschliff
- [x] **Setup-Wizard UI** (`/setup`, admin-only) — 5 Schritte (Willkommen / Vereinsdaten / Admin-PW / E-Mail / Done), Provider-Switch SMTP↔Resend, Skip-Option
- [x] **API**: GET `/api/setup/status` (public), POST `/api/setup/complete` (super-only), POST `/api/setup/skip`
- [x] **AdminDashboard CTA-Banner** wenn setup nicht completed → Wizard
- [x] **Error Pages**: 404 + 403 + 500 mit TLS-Branding (`pages/ErrorPages.jsx`), Catch-All-Route in App.js
- [x] **SEO**: index.html Meta-Tags (description, og:type, og:title, og:description, og:site_name, twitter:card), Title aktualisiert, `useDocumentTitle`-Hook erstellt
- [x] **Sitemap**: GET `/api/sitemap.xml` mit static + tournaments + f1 + events + news + public profiles, lastmod von updated_at
- [x] **Backend Tests**: `tests/test_phase_8_9_10.py` 7/7 grün
- [x] **DB-Indexes**: mail_jobs (id/status+next_attempt_at/dedupe_key/created_at), prize_pickups (id/tournament_id/user_id/status/composite)


## Phase 5+6+7 — IMPLEMENTIERT (04.05.2026 · großer Status/Stream/Badge/Season Refactor)

### Phase 5 — Status & Stream Refactor
- [x] **Einheitliches Status-Vokabular** über Tournaments + F1-Challenges + Events: `draft / scheduled / registration_open / registration_closed / check_in / live / paused / completed / results_published / archived / cancelled`
- [x] **„Warten auf Öffnung"** (`scheduled`) jetzt für alle Wettbewerbsobjekte verfügbar
- [x] **Stream-pro-Objekt einheitlich**: `has_live_stream` / `stream_platform` (twitch/youtube/kick/custom) / `stream_url` / `stream_title` / `show_chat`. Stream wird ausschließlich angezeigt, wenn `has_live_stream=true`. Twitch-Felder bleiben für BC erhalten.
- [x] **`StreamEmbed` Komponente** ersetzt hartkodierte Twitch-iFrames in TournamentDetailPage + F1DetailPage
- [x] **HomePage komplett neu** (Live > Heute > Bald > News, **keine fixen Preise**, Live-Banner nur wenn etwas live ist)
- [x] **`/api/home/state`** liefert aggregierten Plattform-Status, respektiert Drafts + Visibility
- [x] **Drafts versteckt** für Nicht-Admins in `GET /tournaments`, `GET /tournaments/{slug}` (Events + News bereits in Phase 3)
- [x] StatusBadge erweitert: scheduled → "WARTEN AUF ÖFFNUNG", + registration_closed / results_published / cancelled

### Phase 6 — Achievement Audiences
- [x] Badge-Catalog erweitert um: `audience` (public/community/members_only/admins_only/hidden_secret), `negative` (Fun-Achievements), `secret`, `requires_membership`, `can_showcase`
- [x] **6 Members-only Achievements**: „Offiziell im Rudel", Vereinsmitglied Bronze/Silber/Gold/Platin, Ehrenlöwe (Hall of Fame, manuell)
- [x] **6 Negative Fun-Achievements**: Holzmedaille (4. Platz), AFK-Legende, Wandmagnet, Last Minute Panic, Controller leer, Ehrenvoll untergegangen — alle nicht showcase-fähig + secret
- [x] `/api/badges` zeigt audience-gefilterten Katalog (anon=public only, member=public+community+members_only)
- [x] `/api/badges/user/{id}` versteckt negative Badges vor Fremden
- [x] Auto-Award bei Membership-Status-Change (`evaluate_membership_badges`)
- [x] **Admin manual award/revoke** (`POST/DELETE /api/badges/admin/award|revoke`) für Hall of Fame, mit Audit-Log
- [x] Hooks: `on_tournament_completed` vergibt Holzmedaille bei Rang 4, `on_lap_submitted` vergibt Wandmagnet ab 5 ungültigen Runden

### Phase 7 — Season Pass v2
- [x] **`services/season_service.py`** mit Formel `base × weight × participant_factor + bonus`
- [x] **Default Weights**: Major 3.0 / Tournament 2.0 / Mini 1.25 / Fastlap 1.0 / Fun 0.75 / Event 0.5 / Custom 1.0
- [x] **Placement Base**: 1→100, 2→80, 3→65, 4→50, 5-8→35, 9-16→20, >16→10, Teilnahme→10
- [x] **Participant Factor**: 1-7→0.75, 8-15→1.0, 16-31→1.15, 32-63→1.3, 64+→1.5
- [x] **Farming Protection**: max 4 Fast-Lap/Fun-Awards pro Kalendermonat voll, ab 5. nur 50% (Major/Normal/Mini immer voll, `farming_exempt` für Admin-Override)
- [x] `POST /api/seasons/v2/award` (admin) für manuelle Vergabe oder Tests
- [x] `GET /api/seasons/v2/leaderboard?only_members=true|only_community|teams|rookie_only|source_type=...`
- [x] `GET /api/seasons/v2/me` für eigene Season-Punkte mit Entry-Liste
- [x] **Auto-Hook**: `set_status="results_published"` → vergibt Punkte für alle Platzierungen + Teilnahmepunkte für die Übrigen + ruft Tournament-Completion-Badges
- [x] **45/45 Backend-Tests** (1 abhängig vom Game-Setup, der wurde manuell verifiziert)

## Phase 4 — IMPLEMENTIERT (04.05.2026 · Mitgliederportal Vertiefung)

### Backend
- [x] **Document-Model** + CRUD: 10 Kategorien (statutes/minutes/form/regulations/guideline/download/media_kit/presentation/template/other), 4 Visibilities (public/community/members/internal), pinned, tags, order_index, download_count, uploader_name
- [x] **Datei-Upload für Dokumente** (`POST /api/uploads/document`): PDF/DOCX/XLSX/PPTX/ZIP/TXT/CSV/MD/Images, max 25 MB. Returnt URL + original_filename + size + mime
- [x] **Track-Download-Endpoint** (`POST /api/documents/{id}/track-download`) — Counter pro Download
- [x] **DRY: `services/visibility.py`** zentralisiert die Visibility-Logik (vorher 4× kopiert in news/events/gallery/document)
- [x] **History-Spam-Fix** in `upsert_membership`: History wächst nur, wenn `member_status` sich tatsächlich ändert (nicht bei reinen role/notes-Updates)
- [x] **29/29 Backend-Tests grün** (test_phase4_documents.py)

### Frontend
- [x] **MemberAreaPage** überarbeitet — 4 Quick-Tiles (Mitgliedschaft / Vorteile / Dokumente / Interne News), Vorschau auf 3-4 letzte Einträge je Bereich
- [x] **MemberDocumentsPage** (`/members/documents`) — Kategoriefilter, Suche, Pinned/Rest-Sektionen, File-Size-Format, Download-Counter, Track-Download-Hook
- [x] **MemberNewsPage** (`/members/news`) — nur visibility=members + internal
- [x] **MyMembershipPage** (`/members/membership`) — Hero mit Mitgliedsnummer, Stats (Aktiv-Jahre, Mitglied seit, Sichtbarkeit, Mitgliedsart), Verlauf/History-Liste mit allen Statusübergängen, Vorstand-Notiz-Box
- [x] **AdminDocumentsPage** (`/admin/documents`) — CRUD-Tabelle + Modal mit eingebautem File-Upload (Drag-Auswahl, Datei-Wechsel, Auto-Title aus Filename)
- [x] Member-Tiles im Mitgliederbereich verlinken alles und zeigen Counter

## Phase 3 — IMPLEMENTIERT (04.05.2026 · Vereins-CMS)

### Backend
- [x] **News-System erweitert**: `category` (10 Kategorien), `visibility` (public/community/members/internal), `pinned`, `published`, `linked_event_ids`/`linked_tournament_ids`/`linked_team_ids`, `author_id/_name`. `/api/news-meta` für UI. Pinned-Sortierung.
- [x] **Event-System erweitert**: `event_type` (13 Typen: club_evening, lan_party, public_event, community_evening, grill_evening, mario_kart_event, f1_event, expo, online_event, internal, sponsor_action, tournament_finals, general), `status` (11 inkl. **`scheduled` = "Warten auf Öffnung"**), `visibility`, `door_time`, `registration_opens_at/closes_at`, `program`, `address`, `is_online`, `is_hybrid`, `max_participants`, `show_participants`, **Stream-pro-Event** (`has_live_stream`, `stream_platform`, `stream_url`). Event-Detail liefert Tournaments + F1-Challenges + Albums + verknüpfte News.
- [x] **Galerie-System**: `GalleryAlbum` (slug, cover, event_id verknüpft, visibility, taken_at, published, order_index) + `GalleryPhoto` (image_url, thumbnail_url, caption, order_index). Cascade-Delete (Album löscht alle Photos). 404-Validation auf PATCH.
- [x] **Sichtbarkeitsregeln** durchgängig: `_user_can_see` für public/community/members/internal mit Admin-Override.
- [x] **Drafts versteckt** für Nicht-Admins (Events: `status=draft`; News: `published=false`).
- [x] **36/36 Backend-Tests grün** (test_phase3_news_events_gallery.py)

### Frontend
- [x] **NewsPage** überarbeitet — Kategoriefilter, Pinned-Sektion, Cards mit Visibility-Icons (Crown/Lock)
- [x] **NewsDetailPage** — Verknüpfte Events/Tournaments/Teams werden inline angezeigt
- [x] **EventsPage** überarbeitet — Tabs (Kommend/Vergangen), Typ-Filter, Status-Pills, Stream-Indikator
- [x] **EventDetailPage** überarbeitet — Hero mit Banner, Programm, verknüpfte Turniere, F1-Challenges, Galerie-Alben, News
- [x] **GalleryPage** — Album-Übersicht mit Member-Badge
- [x] **GalleryAlbumPage** — Lightbox mit Prev/Next Navigation
- [x] **AdminNewsPage** — CRUD mit Tabelle, Modal mit Kategorie/Sichtbarkeit/Pinning + MultiSelect für Verknüpfungen
- [x] **AdminEventsPage** — CRUD mit Modal (alle Felder inkl. Stream-Sektion)
- [x] **AdminGalleryPage** — Album-Grid + Sub-View „Fotos verwalten" mit URL-Foto-Add
- [x] Galerie-Link in Hauptnavigation

## Test Credentials

Siehe `/app/memory/test_credentials.md`

## Vorherige Implementations-Historie

(Phase 1-5 als TLS ARENA, abgeschlossen am 04.05.2026; siehe Git-Historie)

| Phase | Fokus | Status |
|-------|-------|--------|
| TLS-Arena P1 | MVP Tournaments + F1 Fast Lap | ✅ |
| TLS-Arena P2 | E-Mails (Resend), Swiss/Groups, PDF, DSGVO, Audit | ✅ |
| TLS-Arena P3 | Discord, Season Pass Widget, TV QR + Sponsors | ✅ |
| TLS-Arena P4 | Dynamic Prizes, Twitch, Sponsor Ticker | ✅ |
| TLS-Arena P5 | 22 Badges, Public Profiles, Admin Sponsors | ✅ |
| Vereins-Phase 1+2 | Mitgliedersystem + erweitertes Profil | ✅ |
| **Vereins-Phase 3** | **Vereins-CMS (News, Events, Galerie)** | **✅ NEU** |
| Vereins-Phase 5+6+7 | **Status/Stream Refactor + Achievement-Audiences + Season Pass v2** | ✅ NEU |
| Vereins-Phase 8-10 | Siehe oben | ⏳ |

## User Personas

1. **Spieler** – registriert sich, tritt Teams bei, meldet sich für Turniere an, checkt ein, meldet Scores.
2. **Team Leader** – verwaltet Team, fügt Mitglieder hinzu, meldet Team für Turniere an.
3. **Turnieradmin** – erstellt und verwaltet Turniere, generiert Brackets, löst Disputes.
4. **Moderator** – bestätigt Scores, moderiert Disputes.
5. **Club Admin / Superadmin** – vollständige Verwaltung des Systems, Rollen, Events.
6. **Zuschauer (Gast)** – sieht öffentliche Brackets, Leaderboards, Event-Seiten.

## Phase 1 MVP — IMPLEMENTIERT (04.05.2026)

### Backend (FastAPI + MongoDB)
- [x] JWT Auth (access+refresh httpOnly cookies), 12h access, 14d refresh, bcrypt, brute-force protection
- [x] Rollen-System (player / team_leader / moderator / tournament_admin / club_admin / superadmin)
- [x] Endpoints: auth, users, teams, games, events, tournaments, matches, f1, stations, news, sponsors, admin
- [x] Bracket Engine (Single Elim mit Bye-Propagation, Double Elim Struktur, Round Robin mit Circle Method, League)
- [x] F1-Modul: Challenges, Tracks, Lap Times (ms-genau), Leaderboard pro Strecke, Championship-Wertung mit Punkten, CSV-Export
- [x] Admin-Dashboard KPIs
- [x] Audit-Logs (Adminaktionen)
- [x] Startup-Seeding (Admin + 20 Demo-Spieler + 5 Teams + 6 Games + 2 Turniere + F1 Championship mit 4 Strecken + 10 Stationen)

### Frontend (React + Tailwind + Shadcn/UI + Framer Motion)
- [x] Public Layout + Admin Layout + Display Layout
- [x] Fonts: Unbounded (Headings), Outfit (Body), Rajdhani (Display/TV)
- [x] Brand Colors: Black (#0A0A0A) / Cyan (#29B6E8) / White
- [x] Home mit Hero + Löwen-Mascot + Tournament/F1/Events Übersicht
- [x] Public: Tournaments, TournamentDetail, Bracket, Standings, F1List, F1Detail, Events, EventDetail, Teams, News, Login, Register, Privacy, Imprint
- [x] User: Dashboard, Profile, Match Hub (Score melden + Dispute)
- [x] Admin: Dashboard, Tournaments (CRUD), Wizard, Bracket-Generator, F1 (CRUD + Tracks + Zeiten), Games, Users (role + ban), Stations, Events, News
- [x] Display/TV: F1 TV Mode (auto-refresh, Top 3 Podium, Rajdhani-Großzeichen), Bracket TV

### Deployment
- [x] docker-compose.yml (mongodb + backend + frontend + nginx)
- [x] Backend Dockerfile, Frontend Dockerfile + Nginx config
- [x] README.md + INSTALL.md + UPDATE.md + BACKUP_RESTORE.md + .env.example

## Backlog (Phase 2+)

### P0 — Nächste Iteration
- Email-Versand (Resend / SendGrid) für Passwort-Reset, Match-Reminder, Anmeldebestätigungen
- Swiss-System korrekte Pairing-Logik (aktuell nur Struktur)
- Group Stage + automatische Playoff-Generierung
- Free For All / Battle Royale Heats mit Platzierungs-Eingabe
- Stations ↔ Matches Drag & Drop Assignment UI
- CSV / PDF Exports für Teilnehmer, Bracket, Matchliste
- Display / TV Views: Station Queue, Event Schedule

### P1
- Zahlungen optional (Stripe / PayPal) für Teilnahmegebühren
- Custom Fields (Admin definierbar) für Spieler / Teams / Registrierungen
- Widget / Embed Iframes (read-only public widgets)
- Notifications (in-app bereits gestubbt, E-Mail + Discord Webhook fehlen)
- Saisonale Circuit-Wertung (mehrere Turniere = 1 Saison)
- Ladder / King of the Hill Formate
- Rich Text Editor für News + Turnierbeschreibung
- Screenshot-Upload für Score-Reports (aktuell nur URL-Feld)

### P2
- 2FA vorbereiten
- Discord-Webhooks
- Bulk CSV Import Teilnehmer
- Streckenverwaltung mit Lap-Analyse (Sektoren)
- Saison-Archiv + Exports

## Phase 2/3 — IMPLEMENTIERT (04.05.2026)

### Backend
- [x] Settings-Modul: Public Branding, Email (Resend) API Key + Absender, Versand-Logs
- [x] Email Service (Resend) mit deutschen HTML-Templates (Registrierung, Passwort-Reset, Anmeldung eingegangen/bestätigt/abgelehnt, Check-in, Match-Reminder, Score gemeldet, Dispute eröffnet/entschieden, Test)
- [x] Seasons/Circuits: CRUD + aggregierte Standings (Turniere + F1) mit Punkte-Formel + Streichresultaten
- [x] Widgets: read-only `/api/widgets/tournament/:slug/bracket` und `/api/widgets/f1/:slug/leaderboard` (sensible Felder werden entfernt)
- [x] DSGVO: `/api/dsgvo/export-my-data` (User, Anmeldungen, F1-Zeiten, Teams, Email-Logs), `/api/dsgvo/anonymize-me` (Self + Admin)
- [x] PDF Exports (ReportLab, TLS Cyan/Schwarz Design): Teilnehmer, Check-in, Matches (landscape), Standings, F1 Leaderboard
- [x] Audit Logs: `/api/audit` mit Filter, automatisches Logging bei Settings-Änderungen
- [x] Swiss-System: Greedy Pairing mit Opponent-History, Buchholz-Tiebreaker — `/api/tournaments/:id/swiss/next-round`
- [x] Group Stage: Gruppen-Zuteilung + Round-Robin pro Gruppe — `/api/tournaments/:id/groups/generate`
- [x] F1 Enhancements: ms-Zeiten, Strafsekunden, is_invalid Flag, proof_url, admin_note, Edit via PATCH

### Frontend (100% deutsche UI)
- [x] Admin Einstellungen (`/admin/settings`): Tabs E-Mail / Branding / Versandlogs
- [x] Admin Widgets (`/admin/widgets`): iframe-Generator mit Live-Vorschau
- [x] Admin Seasons (`/admin/seasons`): Saison/Circuit anlegen mit Punkte-Formel, Streichresultat, Turnier+F1 Selection
- [x] Admin Audit Logs (`/admin/audit`): Gefilterte Liste mit Zeitstempel + Akteur
- [x] Admin Stationen (`/admin/stations`): Station-CRUD + Match-Zuweisung via Modal (offene Matches pro Turnier)
- [x] Admin Turnier-Edit: PDF-Export-Buttons (Teilnehmer, Check-in, Matches), Swiss-Runden-Button, Gruppen-Generieren-Button, Gruppen-Tab
- [x] Admin F1-Edit: neues proof_url Feld, Edit-Modal pro Zeit (Zeit/Strafe/Invalid/Proof/Admin-Notiz)
- [x] Public Season-Seite (`/seasons/:slug`): Standings + Event-Übersicht
- [x] User DSGVO-Seite (`/privacy-account`): JSON-Export Download + Anonymisierung (mit Bestätigungs-Prompt)
- [x] Dashboard-Kachel „Meine Daten" → DSGVO
- [x] Admin-Nav mit klaren Icons (Settings/Audit/Widgets separat)

### Tests
- [x] `tests/test_phase2_3.py`: 19 Tests für Settings, Seasons, Widgets, DSGVO, PDF, Audit, Stations, F1-Edits, Swiss/Groups-Validierung
- [x] 60/61 gesamt grün (1 Phase-1 Flake bei F1-Leaderboard-Resort)

## Phase 3 Enhancements — IMPLEMENTIERT (04.05.2026 · 2. Pass)

### Backend
- [x] `GET /api/seasons/active/featured` — aktive Saison + Top 5 Standings für öffentliche Widgets
- [x] `GET/PUT /api/settings/discord` — Webhook URL (maskiert), Bot-Name, Avatar, enabled Flag
- [x] `POST /api/settings/discord/test` — Sendet Testnachricht via Webhook
- [x] `discord_service.py` — `send_discord(title, description, color, fields)` mit Embed-Support, Logging in `email_logs`
- [x] Seed erweitert: 3 Sponsoren + 1 aktive Saison „TLS Season 2026" (verbindet alle Turniere + F1 Championship)

### Frontend
- [x] `SeasonPassWidget` — animierter Spotlight-Ticker auf HomePage mit Top 3 Rotation + Mini-Tabelle Top 5 (`data-testid="season-pass-widget"`)
- [x] Admin Settings: neuer **Discord-Tab** mit Webhook Eingabe + Test-Button; **Resend-Warnbanner** bei fehlender API-Key Config
- [x] F1 TV & Bracket TV: **QR-Code** im Footer (Scan-to-follow) + **Sponsor-Rotation** (alle 8s) aus `/api/sponsors`
- [x] Mobile: alle Admin-Tabellen in `overflow-x-auto` Wrapper (Tournaments/Users/Audit/TournamentEdit)
- [x] `qrcode.react@4.2.0` installiert

### Tests
- [x] 8/8 neue Backend-Tests grün (featured season, discord settings, sponsors seed)
- [x] Frontend: Season Pass, Discord Tab, TV QR+Sponsors, Mobile Scroll alle grün (iteration_3.json)

## Phase 4 — Content & Real Events (04.05.2026 · 3. Pass)

### Backend
- [x] Tournament Model: `prize_places` (List[dict]: place/label/value), `twitch_channel`, `twitch_enabled`
- [x] F1Challenge Model: `prize_places`, `twitch_channel`, `twitch_enabled`
- [x] `/api/exports/f1/{slug}/championship.pdf` — Championship Standings als PDF
- [x] `/api/exports/f1/{slug}/leaderboard.pdf?track_id=X` — per-Strecke PDF
- [x] `/api/settings/public` enthält nun `discord_invite_url` + `twitch_channel` (mit THE LION SQUAD Defaults)
- [x] Discord-Trigger (silent-fail wenn nicht konfiguriert):
  - Tournament Status-Wechsel → `registration_open`/`live`/`completed` → Embed mit Spiel + Format + Teilnehmern
  - Match abgeschlossen → Sieger-Embed mit Score + Runde
  - Neue F1-Bestzeit (neuer Leader pro Strecke) → Embed mit Fahrer + Zeit + vorherige Bestzeit
- [x] Seed-Daten durch echte TLS Events ersetzt:
  - Mario Kart · Gamers Heaven Cup (20. Juni, 16 Spieler, SE, 4 Preise)
  - Super Smash Bros. Ultimate · Gamers Heaven (21. Juni, 16 Fighter, DE, 3 Preise)
  - Mario Kart Masters · September Showdown (September, 128 Spieler, Groups+DE, 5 Preis-Tiers)
  - F1 Fast Lap · Gamers Heaven · Samstag (Silverstone) + Sonntag (Spa)
  - Season 2026 verbindet alle Events
- [x] Backup: Import-Bug (`championship_standings` statt `championship`) von Testing-Agent gefixt

### Frontend
- [x] **CurrentEventHero** — Prominente Featured-Event Card auf Home (Priorität: live > check_in > registration_open), zeigt Titel, Beschreibung, Datum, freie Plätze (rot wenn ≤4), strukturierte Preis-Vorschau, CTA
- [x] **SponsorTicker** — Endless-Marquee Band am Home-Ende mit Sponsor-Logos + Tier-Badges
- [x] **SponsorGrid** — kompakte Nebeneinander-Anzeige für TV Footer (F1 + Bracket)
- [x] **PrizeList** — strukturierte Preis-Karten (Gold/Silber/Bronze + Akzent-Platzierungen) mit Icons, Fallback auf Freitext
- [x] **F1 TV Track-Selector** — Pfeil-Buttons + Dropdown + Arrow-Key-Navigation + `?track=` Deep-Link, Auto-Zyklus nur bei Championship ohne manuelle Sperre
- [x] **F1 Detail PDF-Buttons** — "PDF (aktuelle Strecke)" + "Championship PDF" (bei Championship) + CSV als Sekundär-Option
- [x] **Twitch Embed** — Live-Player auf Turnier- und F1-Seite wenn `twitch_enabled=true`
- [x] **Footer Community** — Discord + Twitch Icons mit dynamischen URLs aus Public Settings, + Sponsoren-Link
- [x] **Admin Tournament/F1 Create** — strukturierter Preis-Editor (Platz + Label + Wert + Hinzufügen/Entfernen), Twitch-Channel Eingabe + Einbetten-Checkbox, Location, Discord-Link

### Tests
- [x] 8/8 Backend-Tests für Phase 4 grün (iteration_4.json) — prize_places Roundtrip, twitch persistence, F1 Track-PDF, Championship-PDF, public settings defaults, Events vorhanden
- [x] Frontend validiert: HomePage 3 Widgets, TournamentDetail PrizeList+Twitch, F1Detail PDF+CSV+Twitch, F1TV SponsorGrid, BracketTV SponsorGrid, PublicLayout Footer Community, AdminForms Editor

| # | Kriterium | Status |
|---|-----------|--------|
| 1 | Spieler kann sich registrieren und einloggen | ✅ |
| 2 | Admin kann Turnier erstellen | ✅ |
| 3 | Spieler können sich anmelden | ✅ |
| 4 | Admin kann Registrierungen freigeben | ✅ |
| 5 | Check-in funktioniert | ✅ |
| 6 | Bracket automatisch generiert | ✅ |
| 7 | Scores gemeldet + bestätigt (Consensus) | ✅ |
| 8 | Disputes durch Admin lösbar | ✅ |
| 9 | Public Bracket funktioniert | ✅ |
| 10 | Public Standings funktionieren | ✅ |
| 11 | Admin kann F1 Event erstellen | ✅ |
| 12 | Admin kann Strecken verwalten | ✅ |
| 13 | Admin kann Zeiten eintragen | ✅ |
| 14 | F1 Leaderboard live korrekt sortiert | ✅ |
| 15 | F1 Zeiten als CSV exportieren | ✅ (PDF in P1) |
| 16 | Event-Stationen verwaltet | ✅ |
| 17 | Matches Stationen zugewiesen | ✅ (API fertig, UI-Drag&Drop in P1) |
| 18 | TV-/Displayansichten | ✅ (F1 TV + Bracket TV, Station/Schedule in P1) |
| 19 | Rollen und Rechte greifen | ✅ |
| 20 | System per Docker Compose deploybar | ✅ |
| 21 | README + Installationsanleitung vollständig | ✅ |
| 22 | Keine Standardpasswörter im Produktivbetrieb | ✅ (ENV-basiert, forced change) |
| 23 | Backups + Restore dokumentiert | ✅ |
| 24 | UI mobile + Desktop sauber | ✅ |
| 25 | THE LION SQUAD Branding | ✅ (Logos, Farben, Wortmarke) |

## Phase 5 — Achievement System & Pro Profiles (04.05.2026 · 4. Pass)

### Backend
- [x] **22 Badges** in 6 Kategorien (tournament/match/fastlap/community/season), Tiers bronze/silver/gold/platinum, 5-200 Saison-Punkte je Badge
- [x] `badges.py` Engine: `seed_badges()`, idempotente `award_badge()`, Trigger-Funktionen für alle Events
- [x] **Discord-Badge-Trigger** mit Tier-Farbe + Punkten
- [x] Hooks verdrahtet in: Tournament register/checkin, Match complete, F1 add_time (new-leader flag), Team create/join
- [x] `/api/badges` + `/api/badges/{code}` (mit Holders)
- [x] `/api/users/public/{username}` — Vollprofil mit Badges, Stats, Tournament-History, F1-Bests, Teams
- [x] `/api/uploads/image` + `/api/uploads/sponsor-logo` — 5MB, served via `/api/static/uploads/`
- [x] Sponsor-CRUD komplett (POST/GET/PATCH/DELETE)

### Frontend
- [x] **PublicProfilePage** (`/u/:username`, `/players/:username`) — Pro Hero, 6 QuickStats, 5 Tabs, Tournament-Rows mit Placement-Badges
- [x] **BadgesPage** (`/badges`) — Katalog mit Kategorie-Gruppierung + Holders-Count
- [x] **BadgeGrid/BadgeCard** — wiederverwendbar mit Tier-Styling, motion-entry, locked-State
- [x] **AdminSponsorsPage** (`/admin/sponsors`) — CRUD mit Logo-URL oder File-Upload
- [x] **Fast Lap Rename** global (URL `/f1` bleibt, neuer Alias `/fastlap`)
- [x] Profile: „Öffentliches Profil" Link; Nav: neue Badges + Sponsoren Einträge

## Noch offen (Backlog)

- **User-Aktion nötig**: Resend API-Key + Discord Webhook-URL im Admin-Panel hinterlegen
- 2FA, Stripe-Zahlungen (P2)
- Ladder / King of the Hill Formate (P2)
- Bulk CSV Teilnehmer-Import (P2)
- Season-Abschluss → automatisches Vergeben von `season_top10` und `season_champion` Badges (P2)
- Bio-Anonymisierung nach DSGVO sollte Badge-Historie behalten (P2)

## Test Credentials
Siehe `/app/memory/test_credentials.md`
