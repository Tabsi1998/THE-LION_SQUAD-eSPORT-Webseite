# CLAUDE.md – Arbeitsregeln und Kurzkarte für THE LION SQUAD

Diese Datei lädt **jede** Sitzung und jeder Agent beim Start. Sie bleibt deshalb kurz – höchstens 60 KB,
das prüft `scripts/check-doc-links.py` – und enthält nur, was man immer braucht: Regeln, Kurzkarte,
Prüfen, Release und Deployment. Alles andere wird bei Bedarf **gesucht** (Abschnitt 0).
Die Datei ist frei von Geheimnissen.

Stand, Verlauf, Fallen, Pläne und die offenen Schritte des Betreibers stehen **nicht im Repo** (es ist
öffentlich), sondern in den privaten Projektnotizen des Betreibers (Obsidian-Vault, Projekt „Lionsquad Webseite“; Pfad in den globalen Anweisungen). Abschnitt 9 sagt, welche Notiz was enthält.

---

## 0. Sparsam lesen und suchen

Jedes gelesene Zeichen kostet. Große Dateien (`mobile/CHANGELOG.md`, die Historie im Vault) **nie ganz
lesen** – suchen und nur die Fundstelle lesen:

```bash
git log --oneline --grep "#915" | head                         # welcher PR, welcher Commit
gh pr view 915 --json body --jq .body | head -60                 # was er gebaut hat und warum
```

| Gesucht | Steht in |
| --- | --- |
| Was ein PR gebaut hat und warum | PR-Text (`gh pr view N`) und `git log`; bis 9.10.2026 die Notiz „LSW Historie“ im Vault |
| Stand, Stolpersteine, offene Schritte des Betreibers, Entscheidungen, Marke und Design | Projektnotizen im Vault (Abschnitt 9) |
| Ein Thema im Ganzen | `docs/DISCORD.md`, `docs/DOLIBARR.md`, `docs/ABRECHNUNG.md`, `docs/SEASONS.md`, `docs/MODERATION.md`, `docs/ROLLEN.md`, `docs/BETRIEB.md`, `docs/PLAY_STORE.md`, `docs/handbuch/` |
| App: Änderungen je Version, Hergang der Releases, Geräteabnahme | `mobile/CHANGELOG.md`, `mobile/RELEASES.md`, `mobile/RELEASE_SMOKE_TEST.md` |

- Im Repo mit `git grep` oder dem Grep-Werkzeug suchen (beide lassen aus, was `.gitignore` nennt) – nie
  mit `grep -r` über den Baum: `frontend/dist` und `node_modules` liefern Zeilen mit zehntausenden
  Zeichen. Ausgaben mit `cut -c1-200` und `head` begrenzen.
- Vom lokalen Check nur die Ergebniszeilen lesen (`grep -E "^(== |PASSED|FAILED|SKIPPED)"`), ein Log nur
  zum roten Schritt.
- `gh` mit `--json … --jq` und nur den Feldern, die gebraucht werden.
- Themen-Doku nur lesen, wenn die Aufgabe ihr Gebiet trifft – dann vor der ersten Änderung.

---

## 1. Projekt in drei Sätzen

Selbst gehostete Vereins- und eSports-Plattform für THE LION SQUAD (lionsquad.at): öffentliche Website,
Mitgliederbereich, Teams, Turniere, Fast Lap, Jahreswertung, Chat, Galerie, Administration – plus die
Android-App „LionsAPP“. Der Betreiber (Tabsi1998) schreibt selbst wenig Code, treibt das Projekt aber eng
über GitHub-Issues, PRs und Praxistests am Handy. Claude liefert fertige, lokal geprüfte PRs; der
Betreiber merged, deployt und testet fachlich.

**Stack:** FastAPI + MongoDB (`backend/`, Python 3.11), React 19 + Vite + Tailwind (`frontend/`, yarn 1.22,
Node 24), Expo SDK 57 / React Native 0.86 (`mobile/`, npm, Node 20), Docker Compose mit nginx im
Frontend-Image (Container `tls-mongodb`, `tls-backend`, `tls-frontend`).

**Planung:** GitHub-Meilensteine und -Issues sind der Fahrplan. Stand, Verlauf und Hintergrund stehen in
den privaten Projektnotizen des Betreibers (Obsidian-Vault, Projekt „Lionsquad Webseite“; Pfad in den globalen Anweisungen). Weitere Doku über `DOCS.md`.

---

## 2. Umgang mit dem Betreiber

- **Auf Deutsch antworten**, direkt und einfach. Englische Fachbegriffe bleiben englisch (Winner Bracket,
  Check-in), der Resttext ist deutsch.
- **Ehrliche Einordnung** statt Beschönigung: grüne Tests sind keine Server-Abnahme; sagen, was nicht
  geprüft wurde.
- **Anleitungen als konkrete Klick-Schritte** (GitHub-Oberfläche, Handy, Play Console). Recht und Steuern
  in Alltagssprache für Vereinsfunktionäre, Paragrafen nur als kleine Quelle.
- **Der Betreiber merged nur.** Issues, PRs, Doku, Checks und Releases macht Claude.
- Feedback kommt als **Screenshot-Stapel**; Personenbezogenes daraus wird nie abgeschrieben. Eigene Ideen
  **erst als Vorschlagsliste**, der Betreiber bestätigt, dann werden Issues angelegt. Er will lieber viele
  kleine Issues als wenige große.
- **Nach einem Abschluss-Stand anhalten** und auf das OK warten, bevor der nächste Block oder das nächste
  Issue-Paket beginnt („nicht so chaotisch“).
- Neue Wünsche während der Arbeit sofort als Issue festhalten (Label + Meilenstein) und dann am laufenden
  Issue weitermachen.

**Feste Wünsche des Betreibers** (gelten überall; Einzelheiten in der Themen-Doku):

- **Empfänger stimmen zu 100 %:** vor jedem neuen Versandweg (Mail, Push, Discord) die Zielgruppe prüfen;
  Privates fällt nie auf einen öffentlichen Kanal zurück.
- **Discord:** Antworten auf Slash-Befehle sieht nur die fragende Person; Kanalweites steht in gepinnten
  Einbettungen, die sich selbst aktualisieren.
- **Admin:** jedes Thema an genau einem Ort, keine Seiten nur aus Links, keine Planungskürzel in der
  Oberfläche, FAQ unter „Einrichtung“, Menüs je Rolle.
- **Mitgliederbereich = nur Vereinssachen;** Rechnungen und Persönliches liegen in Profil und Konto.
  Referenzen (Verein, Spieler) und Auszeichnungen (Banner, Trophäen) sind getrennte Reiter – nichts Neues
  in einen gepflegten Reiter falten.
- **Dolibarr sinnvoll, nicht erzwungen:** nur dort, wo es die bessere Quelle ist; Events führt die Website
  (#850 verworfen). Bordmittel von Dolibarr nutzen statt eigener Kopien. Das Vereinsmodul
  (`dolibarr-vereine`) bleibt neutral – keine LION-Felder dort, die Website kommt nur über API-Schlüssel
  hinein.
- **Jahreszeiten:** nichts gilt als fertig (#677, Messlatte #658); Effekte leben im Raum der Seite und
  scrollen mit; jeder Web-PR einer Saison nennt sein App-Gegenstück (#772).
- **Google Play:** jeder Build geht in den **offenen Test**, nie in den internen oder geschlossenen; die
  Produktion schaltet nur der Betreiber frei. Ein Fix nach einer hochgeladenen Version ist eine eigene
  Patch-Version (1.2.1, 1.2.2 …).

---

## 3. Sicherheitsregeln (wörtlich, nicht verhandelbar)

- **„Geheime Sachen NIE auf GitHub.“**
- Keystore, Passwörter, `signing.json`, `google-services.json`, `.env` mit echten Werten, das Dienstkonto
  für Google Play: **nie ins Repo, nie in einen Chat, nie in ein Log**. `signing.json` enthält das
  Passwort und wird **nie ausgegeben** (kein `cat`, kein Read).
- **Das Repository ist öffentlich** – so gewollt (Entscheidung des Betreibers, 5.10.2026: wegen der
  Updates). Code, Issues, PRs, Kommentare, diese Datei und die Releases kann jeder lesen. Also keine Daten von
  Mitgliedern, keine Screenshots mit Namen oder
  Adressen und keine internen Zugänge in Issues, PRs oder Doku; Sicherheitsbefunde knapp beschreiben und
  zügig beheben.
- Lokale Arbeitsdateien sind **nicht für Git**: `.vscode/`, `.local-testing/`, `.codex-tools/`,
  `*.code-workspace`, SDKs, Zertifikate, Berichte. Sie stehen in `.gitignore`; das bleibt so.
- **Nie gegen Produktion testen.** Erlaubt sind nur lesende, öffentliche Abrufe von lionsquad.at (mit
  Browser-Kennung). Deployment ist bewusst manuell (Abschnitt 8) – kein CD vorschlagen.
- **Lokal zuerst, GitHub nur zur Bestätigung** (Abschnitt 6).
- **Ein Repository je Sitzung:** in anderen Repos (etwa `dolibarr-vereine`) wird nur gelesen – kein Zweig,
  kein PR, kein Issue.

---

## 4. Arbeitsweise: nach Issues, nicht nach Blöcken

1. **Jede Arbeit hat ein Issue** – auch Doku. Labels: `bug` oder `enhancement` plus `app`, `web`, `admin`
   oder `backend`. Jedes Issue bekommt sofort einen Meilenstein.
2. **Ein Zweig je Issue-Paket** ab `main`: `feat/<nr>-<stichwort>`, `fix/<nr>-<stichwort>`,
   `release/<version>-build<N>` für ein App-Paket, `docs/…` für reine Doku. Gearbeitet wird in den **vier
   Arbeitsordnern** (Haupt-Checkout, `C:\lsb`, `C:\lsc`, `C:\lsd`; Details in der Vault-Notiz „LSW Stand“), je Ordner ein Zweig – keine
   weiteren Arbeitsbäume (außer kurz für einen Release-Bau, Abschnitt 7) und kein Zweigwechsel, solange
   `local_check.py` läuft.
3. **App-Issues werden je Version gesammelt**, in **einem** PR umgesetzt und danach als ein Build
   veröffentlicht. Zusammengehöriges kommt in einen PR.
4. **Der PR-Text schließt die Issues mit `Closes #N`** – ein Schlüsselwort je Issue (`Closes #a, closes
   #b`). Deutsches „Schließt #N“ schließt nichts. Nie fix, close oder resolve direkt vor die Nummer eines
   **anderen** PRs oder Issues schreiben, auch nicht in Commit-Texten: das schließt ihn beim Merge.
5. PR **als Entwurf** öffnen (`gh pr create --draft`), lokal prüfen, Ergebnis als Kommentar eintragen, dann
   `gh pr ready` → genau ein GitHub-Lauf. GitHub-CI läuft nur für Nicht-Entwürfe und nur für betroffene
   Jobs (`scripts/ci-changed-areas.py`). `git push` und `gh pr ready` nie im selben Aufruf – sonst wird
   alles übersprungen (Abhilfe: `gh pr ready --undo`, warten, `gh pr ready`).
6. **Der Betreiber merged selbst** mit „Squash and merge“; veraltete Zweige lokal mit
   `git rebase origin/main` und `git push --force-with-lease` nachziehen, nie Merge-Commits. **Nicht
   stapeln:** je Stapel ist nur **ein** PR bereit; PRs ohne gemeinsame Dateien setzen direkt auf `main`
   auf. Nach jedem Merge den nächsten mit `git rebase --onto origin/main <alte Basis>` umsetzen, Basis auf
   `main` stellen und prüfen, dass der Inhalt wirklich in `main` steht (dreimal landete ein PR in einem
   toten Basiszweig). Vor einem weiteren Push `gh pr view N --json mergedAt` in einem eigenen Aufruf lesen.
7. Commit- und PR-Texte auf Deutsch, mit dem Warum. Attribution laut Sitzungs-Hinweis (`Co-Authored-By: …`
   im Commit, das „Generated with Claude Code“-Zeichen im PR-Text). Texte mit „…“ über eine Datei und
   `--body-file`, nie als Heredoc.
8. **Feature-PRs fassen `CLAUDE.md` nicht an** – so kollidieren parallele PRs nicht; Änderungen daran
   kommen in einen eigenen Doku-PR. Themen-Doku (`docs/DISCORD.md`, `CONFIGURATION.md`,
   `mobile/CHANGELOG.md` …) gehört dagegen in den Feature-PR.
9. **Nach jedem Merge** pflegt Claude die Projektnotizen im Vault (kein Repo-Commit): „LSW Stand“
   ersetzen, neue Fallen in „LSW Entwicklung, Tests und Releases“, Klickschritte für den Betreiber in
   „LSW Offene Schritte für Fabian“, dauerhafte Entscheidungen in „LSW Entscheidungen“.
10. **Tempo:** erst committen, dann ein Check; lieber größere PRs; eine Gegenprobe nur bei Bugfixes;
    Hilfsskripte als Dateien im Scratchpad; den nächsten PR beginnen, während CI läuft. Eigene
    Hintergrundprozesse am Ende beenden – nur über den Port oder die genaue PID.

---

## 5. Kurzkarte: wo was liegt

Einzelheiten zu jedem Baustein: PR-Text und `git log` (nach Dateiname oder Issue-Nummer suchen).

**Backend** (`backend/`)
- `server.py` (App, Middleware, Router; Health unter `/api/health`, `/api/health/live`, `/api/health/ready`), `auth.py`
  (Sitzungen und Wächter), `database.py`, `models.py`, `storage.py`, `pdf_service.py`, `email_service.py`;
  `routes/` (eine Datei je Gebiet), `services/` (die Logik), `achievement_catalog/`.
- Gruppen in `services/`: `dolibarr_*` (Vereinsmodul: Rechnungen, Akte, Ehrungen, Teilnahmen, Einlass,
  Abstimmung), `discord_*` (Bot, Server-Verzeichnis, Versand je Spiel, Einbettungen, Termine, Rollen,
  Gestaltung), `competition_*`, `match_*`, `tournament_*`, `achievement_*` mit `xp.py` und `levels.py`,
  `ops_*` (Betrieb, Alarme, Vitals), `seasons.py`, `weather.py`, `billing_*`, `scheduler.py` (alle Jobs),
  `migrations.py`, `permissions.py`, `rate_limit.py`.
- Turnierrouten: `routes/tournament_*_routes.py` + `tournament_common.py`, alle an `tournament_router.py`.
  Tests patchen an dem Modul, in dem die Funktion nachschlägt.
- **Rechte nach Bereichen** (`services/permissions.py`: `tournaments`, `content`, `club`, `system`,
  `moderation`); Wächter in `auth.py`: `require_area(...)`, `require_any_admin()`, `require_admin()`
  (Turnierleitung), `require_club_admin()` (System). **Neue Admin-Route = Bereich wählen, nie nach Rang.**
  Matrix in `docs/ROLLEN.md`; Web: `lib/permissions.js`, `useAuth().can(...)`.
- Zeit: der Server läuft in UTC, Vereinstage sind Wiener Tage – nie `date.today()`, sondern
  `dolibarr_policy.club_today()` oder `LOCAL_TZ` (`mobile_routes`, `home_routes`).
- Tests: `backend/tests/flow_harness.py` (`make_flow()`, mongomock, `flow.add_user(role=…)`,
  `flow.act_as(user)` – Felder, die später nur in der Datenbank gesetzt werden, sieht der Wächter nicht:
  `user.update(...)`), `dolibarr_fake.py`, der Vertrag des Vereinsmoduls in `tests/contracts/`.
  `test_german_copy.py` schlägt bei „fuer/ueber/weiss“ an – immer die ganze Suite laufen lassen.
- Die Härtungs-Tests zählen Blöcke in `frontend/nginx.conf` (`X-Forwarded-Host`, CSP) – bei neuen
  Proxy-Blöcken die Zähler anpassen.

**Web** (`frontend/`)
- `src/App.jsx` (Routen), `pages/public|user|admin|display`, `components/tls` (eigene Bausteine),
  `components/ui` (shadcn), `components/achievements`, `lib/` (Logik ohne React, mit Tests), `hooks/`,
  `context/AuthContext.jsx`, `seasons/` und `advent/` (Jahreszeiten), `e2e/` (Playwright; die API wird mit
  `page.route` nachgestellt, kein Backend).
- Live-Aktualisierung: `hooks/useLiveRefresh.js`, `lib/apiInvalidation.js`,
  `components/tls/ApiInvalidationBridge.jsx` (Ressourcen-Schlüssel ohne Unterstriche).
- ESLint mit `eslint-suppressions.json`; ist ein unterdrückter Fund behoben, bricht `eslint .` mit Code 2 ab –
  dann `npm run lint:prune`.
- Bewegung (#1070): `--tls-motion-fast` 150 ms für Drücken und kleine Zustände, `--tls-motion-mid` 240 ms für Hover,
  Farben, Einblenden und Seitenwechsel, `--tls-motion-slow` 420 ms für Bühnen, Galerie und Füllbalken; Kurve
  `--tls-ease`. `--tls-motion-on` (0/1) schaltet mit „Bewegung reduzieren“ ab – Wege immer damit multiplizieren.
  JS `lib/motion.js` (`MOTION`, `motionAllowed`), App `theme.motion`; `lib/motion.test.js` hält alle drei gleich.
  Knöpfe nur über `tls-btn--primary|secondary|quiet|danger` (Wächter `lib/buttons.test.js` mit begründeten
  Ausnahmen), Karten über `tls-card` mit `tls-card__title`/`tls-card__arrow`.
- `e2e/admin-navigation.spec.js` **zählt die Einträge des Adminmenüs** (83 seit #900) – jeder neue
  Menüpunkt braucht die neue Zahl; zwei parallele PRs ergeben zusammen eine dritte.
- `public/.well-known/assetlinks.json` (Schlüssel der App für Passkeys), `nginx.conf` (liefert Uploads
  direkt von der Platte), `vite.config.mjs` (schreibt `version.json` für den Update-Hinweis).

**App** (`mobile/`)
- `App.tsx`; `src/navigation/` (`AppNavigator.tsx`: `RootStack` mit `Main` = Tabs, `Login`, `Register`;
  `rootNavigation.ts`: `navigateToUrl`, `targetFromUrl`, `openSignIn`), `auth/AuthContext.tsx` (startet
  als Gast), `lib/api.ts` (Client, erneuert die Sitzung bei 401), `lib/` (Logik ohne Oberfläche),
  `screens/`, `components/`, `seasons/`, `achievements/`, `update/` mit `lib/appUpdate.ts`,
  `notifications/`, `realtime/`, `lock/`, `modules/` (eigenes Expo-Modul), `plugins/` und `scripts/`
  (Release).
- Sprünge zwischen Tabs mit `navigate(tab, { screen, params, initial: false })`, damit der Hub des Tabs
  darunter liegt.
- Die App liest die Webadressen aus Benachrichtigungen (`rootNavigation.ts`) – Adressen im Web deshalb
  nie umbenennen, sondern weiterleiten.
- Tests: RNTL 14 – `render`, `fireEvent` und `screen.unmount()` sind **asynchron**, immer `await`;
  `toHaveTextContent` vergleicht den ganzen Text; native Animationen enden unter Jest sofort; dynamisches
  `import()` geht in Jest nicht (`require` in try/catch). Vorlagen: `MoreScreen.test.tsx`,
  `TeamsScreen.test.tsx`.
- Neues Abzeichen-Motiv im Web → `npm run sync:badge-art` in `mobile/`, sonst schlägt `badgeArt.test.ts`
  an.

---

## 6. Lokal prüfen (Pflicht vor jedem Push)

### 6.1 Der versionierte Check

`scripts/local_check.py` führt **alle** Jobs aus `ci.yml` aus – ohne Bereichsfilter – und legt seine venvs
unter `~/.local-ci/` ab. Werkzeuge im PATH: Python 3.11, Node 24 (Web), Docker Desktop (muss laufen), Git
for Windows, gitleaks; Node 20 für die App findet der Check unter `~/.local-toolchain` selbst.

```bash
python scripts/local_check.py                           # alles außer extra
python scripts/local_check.py --all                     # plus Zusatzprüfungen
python scripts/local_check.py --only repository,backend
python scripts/local_check.py --list                    # Schritte anzeigen
```

- Gruppen: `repository` (Secrets, Doku-Links und Größe dieser Datei, Shell-Skripte, Routen-Vertrag,
  Zeilenenden, Gitleaks über Historie und Ungespeichertes), `backend`, `frontend` (mit Playwright),
  `mobile`, `container`. **`repository` läuft immer mit** – Gitleaks gibt es nur lokal, `ci.yml` hat nur
  `check-secrets.py`.
- `extra` rechnet GitHub nicht: black/isort, flake8 komplett, mypy, Kontrast, ShellCheck, OSV über die
  Lockfiles. Diese Prüfungen sind eine Ratsche: `scripts/ci-baseline.json` hält den bekannten Stand, nur
  **neue** Befunde schlagen fehl. `--all` mindestens einmal die Woche; neue Funde stichprobenartig prüfen,
  dann mit `--record` aufnehmen und die Baseline mitcommitten.
- Bericht: `.local-testing/local-check.json`, Logs unter `.local-testing/logs/`.
- Der Container-Smoke läuft als Compose-Projekt `tls-local-check` auf den Ports 8001 und 3000. Sind sie
  belegt, **überspringt er sich**. Steht dort ein liegengebliebener Stack des Checks (`docker compose ls`):
  `docker compose -p tls-local-check down --volumes --remove-orphans`.
- Ist Port 3000 belegt, die Browser-Tests mit `E2E_PORT=3105` starten.
- Den Check nie in eine Pipe mit `&& git commit` hängen – die Pipe verschluckt den Exit-Code.
- Neben anderen schweren Läufen (Android-Emulator!) scheitern App-Tests an ihrem Zeitlimit; allein laufen
  sie grün. Vor einem Check den Emulator beenden (`adb emu kill`).
- Findet der Check `docker` oder `gitleaks` nicht: VS Code neu starten oder genau diese beiden Ordner vorn
  in den PATH setzen (kein Node 20 davor – sonst werden alle Web-Schritte übersprungen).
- Vollständiger Lauf (`--all`) am 5.10.2026 auf `main` nach #948: 41 Schritte in rund 18 Minuten, alle
  CI-Gruppen grün – Backend 1665 bestanden und 20 übersprungen, Web 1376 Vitest- und 352 Browser-Tests,
  App 766 Tests, Container mit Smoke.

**Erweitern.** `scripts/local_check.py` hat drei Teile: Kopf (Pfade, Versionen, Ports, Umgebungen),
gemeinsamer Kern (Runner, Ratsche, Gitleaks, OSV, ShellCheck, Dienst-Helfer – dieselbe Kopie liegt in
OmniFM, IT-Tabelander und dolibarr-mahnwesen; ein Fix dort lohnt sich auch hier) und die LION-Schritte mit
`plan()`. Ein Schritt ist eine Funktion `(context) -> str`: die Rückgabe ist die Ergebniszeile,
`StepFailed` nennt Grund und Abhilfe, `StepSkipped` sagt, warum er hier nicht laufen kann. Eingetragen
wird er mit `Step(gruppe, name, beschreibung, aktion, needs)`. Neue Befund-Prüfungen laufen über
`ratchet()`, CI-Gates nie.

### 6.2 Einzelbefehle

```bash
# Backend (aus dem Repo-Stamm, Umgebung wie im CI)
V="$HOME/.local-ci/THE-LION_SQUAD-eSPORT-Webseite/venv/Scripts/python.exe"
APP_ENV=test MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=tls_ci DISABLE_SCHEDULER=true CI=true \
  "$V" -m pytest -q -p no:cacheprovider backend/tests/test_beispiel.py
flake8 backend --select=E9,F63,F7,F82 --exclude=backend/tests
# Web (aus frontend/, Node 24)
node node_modules/vitest/vitest.mjs run --root . src/pfad/Datei.test.jsx
yarn lint && yarn build
CI=true E2E_WORKERS=2 yarn test:e2e
# App (aus mobile/, Node 20 vorn im PATH)
export PATH="$HOME/.local-toolchain/node-v20.20.2-win-x64:$PATH"
node node_modules/jest/bin/jest.js src/pfad/Datei.test.tsx
node node_modules/typescript/bin/tsc --noEmit
npm run test:security && npm run test:release && npx expo install --check
```

### 6.3 Die wichtigsten Stolpersteine

Alle Fallen mit Hergang und Abhilfe stehen nach Gebiet in der Vault-Notiz „LSW Entwicklung, Tests und
Releases“ – vor der Arbeit in einem Gebiet dessen Abschnitt lesen. Diese treffen fast jeden PR:

- **Gitleaks** schlägt bei erfundenen Testwerten ab etwa zehn Zeichen an: kurze Werte nehmen
  (`geheim-42`) oder einen Eintrag in `.gitleaks.toml`, an Datei und Wert gebunden. Der Schritt liest jeden
  erreichbaren Commit – Ungepushtes mit `--amend` berichtigen.
- **Tage und Uhrzeit:** GitHub-CI läuft in UTC, die Maschine hier in Wien. Tests, die einen Kalendertag
  erwarten, mit demselben Helfer rechnen wie der Code, Mittagszeiten in Testdaten, vor dem Push mit
  `TZ=UTC` laufen lassen. Tests, die „heute“ aus „jetzt minus ein paar Stunden“ bauen, kippen nach
  Mitternacht.
- **Zähler, die mitlaufen:** Adminmenü (`e2e/admin-navigation.spec.js`), nginx-Blöcke
  (Härtungs-Tests), Abzeichen-Kunst der App (`npm run sync:badge-art`).
- **Paralleles Einfügen:** zwei PRs, die an derselben Stelle eine Zeile einfügen oder am selben Dateiende
  Tests anhängen, kollidieren beim zweiten Merge – vorher mit `git merge-tree --write-tree a b` prüfen
  (ohne `| head`, das verdeckt Konflikte).
- **Expo-Patches:** `npx expo install --check` fällt durch, sobald Expo Patches veröffentlicht – kein
  Code-Fehler; im nächsten App-PR `npx expo install --fix` mit Node 20.
- **Sicherheitscheck der App** (`npm run audit:ci`): die Ausnahmen in
  `mobile/scripts/security-audit-allowlist.json` haben eine Frist – nach Ablauf wird der Check von selbst
  rot (nächste Frist: Vault-Notiz „LSW Stand“).
- **Metro und Gradle liefern alten Stand:** vor Sichtproben und vor jedem Release die Metro-Caches
  leeren und im Bundle ein Merkmal suchen, bevor man einem Bildschirmfoto traut.
- **Cloudflare vor lionsquad.at:** höchstens 100 MB je Anfrage – deshalb ist die Release-APK nur für ARM.

---

## 7. App-Release (lokal, nicht per Actions)

- Die Version steht in `mobile/package.json`, `package-lock.json` und `app.json` (`version` +
  `versionCode`), dazu `CHANGELOG.md`, `RELEASES.md` und `npm run whatsnew` (schreibt `src/whatsnew.json`,
  der Preflight prüft sie) – alles im Release-PR. `versionCode` läuft durch (Build-Nummer), Tags
  `mobile-v<version>-build<N>`. Das Datum im Changelog ist der Tag des Builds.
- Der Release-PR enthält den **Versionshinweis für Google Play** fertig zum Einfügen (Deutsch, höchstens
  500 Zeichen); bei der Übergabe des Bundles wird er wiederholt.
- Geheimes liegt **nur** in `%USERPROFILE%\.lionsapp-release\` (`upload.jks`, `signing.json`,
  `google-services.json`). Upload-Schlüssel seit Build 57: SHA-256 `6f69a289…cb98`. Die Fassung aus Google
  Play signiert Google mit einem eigenen Schlüssel; jeder Schlüssel der App steht in
  `passkey_routes.DEFAULT_APK_KEY_HASHES` und in `frontend/public/.well-known/assetlinks.json`, sonst gehen
  Passkeys in der App nicht.
- Gebaut wird im Git-Worktree `C:\lsb` (ohne Leerzeichen im Pfad; das Skript legt ihn an und hält ihn
  aktuell). Das Skript verlangt den Haupt-Checkout auf `main` = `origin/main` ohne Änderungen.
  Arbeitet in `C:\lsb` gerade ein Zweig, in einem anderen Ordner bauen: `LIONSAPP_BUILD_DIR=C:/lsbrel` (oder
  `buildDir` in `signing.json`), danach `git worktree remove --force C:/lsbrel`.
- Vor dem Build die Metro-Caches leeren (`%LOCALAPPDATA%\Temp\metro-cache` und
  `metro-file-map-expo-*`), danach in APK und AAB `assets/index.android.bundle` prüfen:
  `https://lionsquad.at` muss darin stehen, eine Probe-Adresse (`10.0.2.2`) nicht.
- Release-Builds laufen mit R8 (`plugins/withReleaseOptimization.js`); die Zuordnung steckt im Bundle und
  liegt zusätzlich als `<aab>.mapping.txt` daneben. Die Release-APK ist nur für ARM – im x86-Emulator
  startet sie nicht (Vault-Notiz „LSW Entwicklung, Tests und Releases“, Abschnitt 5).

```bash
cd mobile
npm run release:local -- --check           # zeigt, was fehlt
npm run release:local -- --dry-run --aab   # bauen und prüfen, nichts veröffentlichen
npm run release:local -- --aab             # bauen, GitHub-Release mit Tag, APK an den Vereinsserver
npm run release:local -- --upload-only     # nur die zuletzt gebaute APK an den Server schicken
```

- Ergebnis in `mobile/builds/`: APK, AAB, Prüfsummen, Versionshinweise. **Google Play:** das Dienstkonto
  für `--play` fehlt noch (#412) – der Betreiber lädt das AAB von Hand in den **offenen Test**
  (Dateiname und Klick-Schritte mitgeben). `--play` kennt nur den offenen Test (`beta`).
- Claude führt das Release selbst aus (Freigabe `Bash(npm run release:local*)` in
  `~/.claude/settings.json`): `cd mobile` in einem eigenen Aufruf, dann den Befehl für sich allein.
- Dauer: erster Build rund 12 Minuten, danach rund 4; ändert sich `package-lock.json`, baut alles Native
  neu (~30 min). Stürzt der NDK-Linker einmal ab („linker command failed due to signal“), erneut starten.
  Eine `| tail`-Pipe verschluckt den Exit-Code: auf „Abgebrochen:“ achten.
- `signing.json` ist strenges JSON; das Skript nennt Zeile und Spalte, nie den Inhalt. Der Upload an den
  Vereinsserver braucht dort `uploadUrl` und `uploadToken` (= `APP_RELEASE_UPLOAD_TOKEN` der
  Server-`.env`).
- Das Skript legt das GitHub-Release selbst an – Text danach mit `gh release edit` ändern.

---

## 8. Deployment (Server)

Der Betreiber deployt **von Hand** mit `update.sh` auf dem Produktivserver. Backend- und Web-Änderungen
greifen **erst danach**. Bei jedem App-Test fragen, ob der Server aktualisiert ist. Der Betreiber
aktualisiert nach Meilensteinen, nicht nach jedem PR: an `update.sh` nur erinnern, wenn ein Meilenstein
abgeschlossen ist oder ein App-Build Backend-Änderungen braucht.

Ob ein Stand am Server ist, lässt sich lesend prüfen: `https://lionsquad.at/version.json` (ändert sich
mit jedem Web-Build), `/.well-known/assetlinks.json`, `/api/health/ready` – und ein Merkmal der Änderung in
den ausgelieferten Skripten suchen.

---

## 9. Stand und Kontext (außerhalb des Repos)

Das Repository ist öffentlich. Alles, was altert oder intern ist, steht deshalb in den privaten Projektnotizen des Betreibers (Obsidian-Vault, Projekt „Lionsquad Webseite“; Pfad in den globalen Anweisungen):

| Notiz | Inhalt |
| --- | --- |
| „LSW Stand“ | aktueller Stand: was gemergt ist, was in Arbeit ist, was beim Betreiber offen ist (ersetzen, nicht anhängen) |
| „LSW Offene Schritte für Fabian“ | Klickschritte nach Updates und Merges |
| „LSW Entwicklung, Tests und Releases“ | Stolpersteine nach Gebiet |
| „LSW Entscheidungen“ | dauerhafte Grundsätze für Produkt, Datenschutz und Zusammenarbeit |
| „LSW Design und Aussehen“, „Lionsquad Marke und Tonfall“, „Lionsquad Verein und Community“ | Look, Ton, Verein |
| Ordner „Archiv aus dem Repo“ | frühere Historie, Umbauplan, Restplan und Roadmaps (Stand 9.10.2026) |

Ohne Zugriff auf den Vault: GitHub-Meilensteine, Issues und PR-Texte enthalten den Stand ebenfalls.

---

## 10. Der Haupt-PC und was nicht über Git kommt

`C:\Programmieren\THE-LION_SQUAD-eSPORT-Webseite` auf dem Haupt-PC ist der einzige Arbeitsplatz. Über Git
kommen der Code, die Doku und alle Zweige. **Nicht** über Git kommt und muss auf einem frischen Gerät neu
entstehen oder von Hand mit:

1. **`%USERPROFILE%\.lionsapp-release\`** (`upload.jks`, `signing.json`, `google-services.json`) – nur
   über USB oder einen anderen sicheren Weg, nie über Git, Chat oder einen Cloud-Link im Klartext. In
   `signing.json` die Pfade `javaHome` und `androidHome` auf das Gerät anpassen.
2. **Werkzeuge:** Python 3.11, Node 24 und 20 (`~/.local-toolchain`), Docker Desktop, Git for Windows,
   gitleaks; für die App JDK 21 (`C:\Program Files\Java\jdk-21.0.10`) und das Android SDK unter
   `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools, platform-tools, build-tools 36.0.0, platforms;android-36,
   ndk;27.1.12297006, cmake;3.22.1), `JAVA_HOME` und `ANDROID_HOME` als Benutzer-Variablen,
   `~/.gradle/gradle.properties` mit `org.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1g` (mit den 2 GB
   der Expo-Vorlage stürzt der Dex-Merge ab).
3. **Neu erzeugen statt kopieren:** der Check legt seine venvs unter `~/.local-ci/` an;
   `cd frontend && yarn install`, `cd mobile && npm ci`; den Build-Worktree `C:\lsb` legt das
   Release-Skript selbst an.
4. **Maschinenlokal und in `.gitignore`:** `.vscode/` (`tasks.json` ruft die Gruppen des Checks und das
   Release auf), `.ci-panel/` (Testing-Panel), `C:\Programmieren\check-all.py --serve` (Dashboard über alle
   Repos), `Programmieren.code-workspace`.
5. Optional das Claude-Gedächtnis dieses Rechners:
   `C:\Users\<user>\.claude\projects\c--Programmieren\memory\` (Index `MEMORY.md`). Diese Datei und die
   Doku enthalten alles Wesentliche daraus; das Gedächtnis ist nur Ergänzung.
