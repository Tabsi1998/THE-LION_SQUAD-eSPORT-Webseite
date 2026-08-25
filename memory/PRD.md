# THE LION SQUAD eSports — PRD / Arbeitsstand

## Ursprüngliche Aufgabe
GitHub-Projekt (Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite) komplett zum Laufen bringen,
Gesamtzustand analysieren, aufräumen, verbessern und "Wow"-Features ergänzen.

## Architektur
- Frontend: React 19 + CRA/craco + TailwindCSS + Radix UI + framer-motion + tiptap + recharts
- Backend: FastAPI (Cookie-JWT + CSRF Double-Submit), MongoDB (motor)
- Zusätzlich: React-Native Mobile-App (/mobile), Docker-Deployment (docker-compose, nginx, install.sh)
- Scheduler (APScheduler): Mail-Queue, Reminder, Prize-Expiry, Twitch-Poll, Game-Server-Sync, Push
- 34 Backend-Routen, 52 Services, 37 Admin-Seiten, 39 Public-Seiten, 11 User-Seiten, 3 TV-Displays

## Kernfunktionen (vorhanden)
- Auth/Rollen, Vereinsmitgliedschaft, Freunde/DMs
- Turnier-Engine (Single/Double Elim, Gruppen, Custom Brackets, Stages, Seeding, Standings, Penalties)
- F1 Fast-Lap, Stationen/TV, Events, News/CMS, Galerie, Sponsoren/Partner, Achievements v4,
  Season-Points, Prize-Pickups, Dokumente, Kontakt/Vorstand, SEO, DSGVO
- Integrationen: Resend, Discord, Twitch, Expo Push

## Umgebungs-Setup (Emergent Preview) — erledigt 2026-08
- backend/.env & frontend/.env erstellt (APP_ENV=development, MONGO_URL=localhost, DB_NAME=tls_arena)
- WICHTIG: Ingress schreibt Origin/Host auf *.emergentcf.cloud um → CORS_ORIGINS enthält beide
  Domains + TRUSTED_HOSTS=* (nur Preview!), damit CSRF/Host-Check greift.
- Superadmin gebootstrappt, Demo-Daten geseedet (6 Games, 20 Player, 5 Teams, 2 Turniere, F1, 10 Stationen)

## Zustand / Tests
- Backend Pytest: 355 passed, 327 skipped (live-only), 0 failures
- E2E (Testing-Agent): 100% der Kern-Flows

## Behobene Bugs
- 2026-08: `GET /api/notifications/me` fehlte → Dashboard-404 alle 10s. Neuer Router
  routes/notification_routes.py (me/unread-count/read/read-all/delete) ergänzt.
- 2026-08: KRITISCH — Preview-Domain korrigiert. Plattform setzt REACT_APP_BACKEND_URL auf
  esports-hub-rebuild.preview.emergentagent.com; backend .env (FRONTEND_URL/CORS_ORIGINS) zeigte
  auf stale e18adb59-Domain → echte Browser-Nutzer hätten CORS/CSRF-Fehler bekommen. Gefixt inkl.
  ingress-rewrite Origin esports-hub-rebuild.cluster-5.preview.emergentcf.cloud.

## PHASE 1 — Turnier-Vereinheitlichung (Weg A) — ABGESCHLOSSEN 2026-08
- Backend: `/api/matches/{id}` ist jetzt die EINE kanonische Match-Schreib-Schnittstelle.
  PATCH ist engine-aware (v2-Matches → matches_v2-Zweig oben in update_match via getattr;
  Legacy unverändert). `/result` dispatcht bereits an submit_v2_result. Beide Engines bleiben
  intern stabil. 100% getestet (Legacy: Ergebnis+Advancement; v2: PATCH/scheduled/idempotent).
- Frontend: AdminTournamentEditPage nutzt nur noch `/matches/{id}` (+ `/result`) — keine
  `/matches-v2`-Schreibaufrufe mehr. Ein Client-Pfad.
- Neu: TournamentFlowStepper (components/tls/) — 6-Phasen Ablauf-UI (Anmeldung→Check-in→Seeding→
  Bracket→Ergebnisse→Standings) über den Tabs, mit Live-Metriken + Klick-Navigation.
- Fixes nach QA: Zwei-Klick-Tab-Bug (URL-abgeleiteter Tab-Sync) + „Ergebnisse"-Step öffnet jetzt
  den Matchplan-Tab (dort werden Ergebnisse eingetragen).
- Tests: 375 passed / 0 failed. Testing-Agent: Backend 100%, Frontend 90%→ (Issues gefixt).

## Backlog / Vorschläge
- P1 (Weg B, später): Formate schrittweise auf graph-Engine migrieren, classic/bracket_engine
  einfrieren — erst wenn Parität pro Format bewiesen ist (competition_formats.canonical_write_ready).
- P2 (Wow): Live-Bracket-Animationen, Twitch-Live-Hero, Achievements-Showcase, animierte Landing.
- P3: AdminTournamentEditPage (2260 Zeilen) in Module splitten; data-testids für Match-Controls.
- P3: Doku-Aufräumen (.md-Reports im Root → /docs).
