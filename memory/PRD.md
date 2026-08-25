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

## ACHIEVEMENT-REWORK + LIVE-BRACKET — 2026-08 (Session 3)
- Live-Bracket: TV-Board (BracketTVPage) mit framer-motion animiert (staggered entrance, layout,
  Winner-Glow + Trophy, LIVE-Puls, useMatchFlash Flash bei Finish/Score über SSE-Reload). Public
  BracketTree: LIVE-Puls-Dot bei laufenden Matches. TV-Spalten-Clipping gefixt (overflow-y-auto).
- Achievements-Showcase: /achievements (Hero-Stats, Bestenliste mit Podium + neuer Backend-Endpoint
  GET /api/achievements/leaderboard, Trophäenwand). Unlock-Overlay (AchievementUnlockOverlay) mit
  Konfetti bei neuen Awards, integriert in ProfilePage. Nav-Link in DEFAULT_NAV ergänzt.
- Achievement-REWORK (User-Feedback): Emoji-Icons entfernt → animierte TierMedal (pro Level 1-5
  eskalierende Optik/Animation: Gold-Glow, Platin-Puls, Legendär conic-sheen+shine). Kategorien
  entwirrt: neue Kategorien TEAM + COMMUNITY, Team-Gründer/Clan-Loyalität/Community-Präsenz raus aus
  "Verein" (via CATEGORY_OVERRIDES, display-only, re-seed). Profil-Level (AccountLevelProgress) mit
  animiertem Ring + Shimmer-Fill neu.
- Fixes iteration_3: Nav-Link, TV-Clipping, anonym /achievements/me nicht mehr aufgerufen (kein 401-
  Rauschen), Podium-Kontrast.

## SESSION 4 — 2026-08 (Google-Auth, Galerie-Audit, Achievement-Feinschliff)
- Google-Login/Signup (Emergent OAuth): POST /api/auth/google/session legt echten User an / verknüpft
  per E-Mail und gibt die normale Cookie-Session aus (auth_provider=google). Frontend: AuthContext
  verarbeitet #session_id-Callback, GoogleAuthButton auf /login + /register. Non-JSON-Guard (400).
- Galerie-Audit + Fixes: itemRatio nutzt gemessene naturalWidth/Height statt falscher Metadaten →
  keine brutalen Portrait-Crops. 2 Alben je 6 distinkte Fotos, kein Overflow (Desktop+Handy), Lightbox ok.
- Achievement-Feinschliff: Tier-Kontrast erhöht, Locked-Rows nicht mehr ausgegraut. TV-Bracket 6→4
  (kein abgeschnittenes Match bei 1080p). Tier L4 "Legendär"→"Sturmreihe".
- Tests: 429 passed / 0 failed. iteration_7: alle 4 Fixes bestätigt, 0 Console-Fehler.
- OFFEN: Mobile-App (/app/mobile, Expo ~56) = eigener Store-Release nötig (EAS+Gerät, nicht im Preview).
  Weg-B Engine-Migration weiter offen. LOW: 3:2-Kachel etwas breit, 1 Grid-Loch Desktop, natives Datumsfeld.
- P1 (Weg B, später): Formate schrittweise auf graph-Engine migrieren, classic/bracket_engine
  einfrieren — erst wenn Parität pro Format bewiesen ist (competition_formats.canonical_write_ready).
- P2 (Wow): Live-Bracket-Animationen, Twitch-Live-Hero, Achievements-Showcase, animierte Landing.
- P3: AdminTournamentEditPage (2260 Zeilen) in Module splitten; data-testids für Match-Controls.
- P3: Doku-Aufräumen (.md-Reports im Root → /docs).
