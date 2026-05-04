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

## Akzeptanzkriterien – Phase 1 Status

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

## Test Credentials
Siehe `/app/memory/test_credentials.md`
