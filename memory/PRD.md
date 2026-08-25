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

## Backlog / Vorschläge
- P1: Prod-Härtung vor Go-Live (echtes JWT_SECRET, TRUSTED_HOSTS statt *, AUTH_COOKIE_DOMAIN, Resend)
- P2 (Wow): Live-Bracket-Animationen, Twitch-Live-Hero, Achievements-Showcase, animierte Landing-Hero
- P2: data-testid Abdeckung; Login-„Pflichtfeld"-Hinweis dezenter
- P3: Doku-Aufräumen (.md-Reports im Root → /docs)
