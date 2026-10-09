# CLAUDE.md – THE LION SQUAD

Kurzanleitung für alle, die an diesem Repository arbeiten (Menschen und KI-Agenten): Aufbau, Code-Regeln,
Prüfen und der Weg zum PR. Sie bleibt kurz – `scripts/check-doc-links.py` hält höchstens 60 KB.
Projektwissen des Betreibers (Stand, Verlauf, Entscheidungen) liegt nicht im Repository; wer Zugriff hat,
findet den Verweis in der lokalen, nicht versionierten `CLAUDE.local.md`.

## Projekt

Selbst gehostete Vereins- und eSports-Plattform für THE LION SQUAD (lionsquad.at): öffentliche Website,
Mitgliederbereich, Turniere, Events, Fast Lap, Community, Verwaltung – plus die Android-App „LionsAPP“.
Weitere Doku: [`DOCS.md`](DOCS.md).

| Teil | Ordner | Werkzeuge |
| --- | --- | --- |
| Backend | `backend/` | Python 3.11, FastAPI, MongoDB |
| Web | `frontend/` | React 19, Vite, Tailwind, yarn 1.22, Node 24, Playwright |
| App | `mobile/` | Expo SDK 57, React Native 0.86, npm, Node 20, Jest |
| Container | `docker-compose.yml` | `tls-mongodb`, `tls-backend`, `tls-frontend` (nginx im Frontend-Image) |

## Sicherheit

- **Keine Geheimnisse ins Repository**: keine echten `.env`-Werte, Schlüssel, Keystores, `signing.json`,
  `google-services.json` – auch nicht in Issues, PRs, Logs oder Testdaten. Nur `.env.example`.
- **Das Repository ist öffentlich.** Keine Daten von Mitgliedern, keine Screenshots mit Namen, keine
  internen Zugänge in Code, Tests, Issues oder PRs. Sicherheitsbefunde knapp und ohne Anleitung zum
  Ausnutzen beschreiben.
- **Nie gegen Produktion testen.** Erlaubt sind nur lesende, öffentliche Abrufe von lionsquad.at.

## Code-Regeln

**Backend**
- `server.py` (App, Middleware, Router; Health unter `/api/health/live` und `/ready`), `auth.py`
  (Sitzungen, Wächter), `routes/` (eine Datei je Gebiet), `services/` (Logik).
- **Rechte nach Bereichen** (`services/permissions.py`: `tournaments`, `content`, `club`, `system`,
  `moderation`), Wächter `require_area(...)` in `auth.py`. Neue Admin-Route = Bereich wählen, nie nach
  Rang. Matrix in `docs/ROLLEN.md`.
- **Zeit:** der Server läuft in UTC, Vereinstage sind Wiener Tage – nie `date.today()`, sondern
  `dolibarr_policy.club_today()` oder `LOCAL_TZ`.
- Werte aus Anfragen kommen nur über `services/log_safe.py` ins Protokoll.
- Tests: `backend/tests/flow_harness.py` (`make_flow()`, `flow.add_user(role=…)`, `flow.act_as(user)`),
  `dolibarr_fake.py`, der Vertrag des Vereinsmoduls in `tests/contracts/`. `test_german_copy.py` schlägt bei
  „fuer/ueber/weiss“ an. In `assert` nie etwas aufrufen, das etwas verändert – erst aufrufen, dann prüfen.

**Web**
- `src/App.jsx` (Routen), `pages/public|user|admin|display`, `components/tls` (eigene Bausteine),
  `components/ui` (shadcn), `lib/` (Logik mit Tests), `hooks/`, `seasons/`, `e2e/` (Playwright, API über
  `page.route` nachgestellt).
- Wächter-Tests: Knöpfe nur über `tls-btn--…` (`lib/buttons.test.js`), jedes Bild sagt seine Breite
  (`lib/imageSizes.test.jsx`), Daten nur über die Wien-Helfer (`lib/vienna.test.js`), Bewegung über
  `--tls-motion-*` (`lib/motion.test.js`).
- `e2e/admin-navigation.spec.js` zählt die Einträge des Adminmenüs; die Härtungs-Tests zählen Blöcke in
  `frontend/nginx.conf` – bei neuen Einträgen die Zahl anpassen.
- Webadressen nie umbenennen, sondern weiterleiten – die App öffnet Links aus Benachrichtigungen.

**App**
- `App.tsx`, `src/navigation/` (Tabs, `rootNavigation.ts`), `auth/`, `lib/api.ts`, `screens/`,
  `components/`, `notifications/`, `seasons/`.
- Tests mit RNTL 14: `render`, `fireEvent` und `unmount` sind asynchron (`await`); dynamisches `import()`
  geht in Jest nicht.
- Neues Abzeichen-Motiv im Web → `npm run sync:badge-art` in `mobile/`.

## Prüfen (vor jedem Push)

`scripts/local_check.py` führt alle Jobs der CI lokal aus; GitHub Actions ist die zweite Kontrolle.
Voraussetzungen: Python 3.11, Node 24 (und Node 20 für die App), Docker Desktop, Git, gitleaks.

```bash
python scripts/local_check.py                           # alles außer den Zusatzprüfungen
python scripts/local_check.py --only repository,backend # einzelne Gruppen
python scripts/local_check.py --all                     # plus Ratsche (black, flake8, mypy, ShellCheck, OSV)
```

Einzelbefehle:

```bash
# Backend (aus dem Repo-Stamm)
APP_ENV=test MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=tls_ci DISABLE_SCHEDULER=true CI=true \
  python -m pytest -q backend/tests/test_beispiel.py
# Web (aus frontend/)
yarn lint && yarn build && yarn test
CI=true yarn test:e2e
# App (aus mobile/, Node 20)
npx jest src/pfad/Datei.test.tsx && npx tsc --noEmit
```

- Die Gruppe `repository` prüft Geheimnisse, Doku-Links, Shell-Skripte, den Routen-Vertrag, Zeilenenden,
  Gitleaks und Code-Muster (`scripts/check-code-patterns.py`).
- Bekannte Altbefunde stehen in `scripts/ci-baseline.json`; nur neue Befunde schlagen fehl.
- Tests, die einen Kalendertag erwarten, mit `TZ=UTC` gegenprüfen – die CI läuft in UTC.

## Pull Requests

- Jede Arbeit hat ein Issue mit Meilenstein. Zweige ab `main`: `feat/<nr>-<stichwort>`,
  `fix/<nr>-<stichwort>`, `docs/…`.
- Commit- und PR-Texte auf Deutsch, mit dem Warum. Im PR-Text je Issue `Closes #N` (englisch – deutsches
  „Schließt“ schließt nichts).
- PR als Entwurf öffnen, lokal prüfen, dann bereit melden. Gemergt wird mit „Squash and merge“.
- `CLAUDE.md` nur in eigenen Doku-PRs ändern; Themen-Doku (`docs/…`, `mobile/CHANGELOG.md`) gehört in den
  Feature-PR.

## Release und Deployment

- **App:** lokal gebaut und veröffentlicht, Ablauf in [`mobile/RELEASES.md`](mobile/RELEASES.md),
  Geräteabnahme in [`mobile/RELEASE_SMOKE_TEST.md`](mobile/RELEASE_SMOKE_TEST.md). Signierschlüssel liegen
  nur auf dem Rechner des Betreibers.
- **Server:** der Betreiber spielt Updates von Hand mit `update.sh` ein – kein automatisches Deployment.
  Anleitung: [`UPDATE.md`](UPDATE.md), Betrieb: [`docs/BETRIEB.md`](docs/BETRIEB.md).
