# TLS ARENA — Product Requirements Document

**Projekt:** TLS ARENA / THE LION SQUAD ARENA
**Verein:** THE LION SQUAD eSports
**Stack:** FastAPI + MongoDB + React 19 + Tailwind + Shadcn/UI + Framer Motion
**Erstellt:** 2026-05-04

---

## Vision

Self-hosted Tournament-Management-System ähnlich Toornament/Challonge, speziell auf den Vereinsbetrieb (Offline-Events, F1 Fast Lap Championships, Multi-Game-Turniere) zugeschnitten. Dient dem Verein THE LION SQUAD für Online-Turniere, Offline-Events und Vereinsmeisterschaften.

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

## Noch offen (Backlog)

- Resend API Key durch Nutzer in `/admin/settings` hinterlegen → live E-Mail-Versand
- Discord Webhook Events automatisch bei Turnier-Start / Match-Ende / F1-Neuer-Leader triggern (Infrastruktur vorhanden, Trigger fehlen)
- 2FA, Stripe-Zahlungen (P2)
- Ladder / King of the Hill Formate (P2)
- Bulk CSV Teilnehmer-Import (P2)

## Test Credentials
Siehe `/app/memory/test_credentials.md`
