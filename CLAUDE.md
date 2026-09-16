# CLAUDE.md – Übergabe und Arbeitsregeln für THE LION SQUAD

Diese Datei ist das Wissen aus der Arbeit mit Claude Code an diesem Repository,
Stand **16. September 2026, früh (Umzug auf den Haupt-PC, Build 61)**. Sie wird
beim Start jeder Sitzung gelesen.
Wer sie liest, soll ohne Rückfragen dort weitermachen können, wo die letzte
Sitzung aufgehört hat. Alles hier ist bewusst frei von Geheimnissen.

Der Abschnitt „Aktueller Stand“ altert schnell. Wer einen PR abschließt oder
ein Release baut, zieht ihn nach – die Regeln davor bleiben.

---

## 1. Projekt in drei Sätzen

Selbst gehostete Vereins- und eSports-Plattform für THE LION SQUAD
(lionsquad.at): öffentliche Website, Mitgliederbereich, Teams, Turniere,
Fast Lap, Jahreswertung, Chat, Galerie, Administration – plus die
Android-App „LionsAPP“. Der Betreiber (Tabsi1998) schreibt selbst wenig Code,
treibt das Projekt aber eng über GitHub-Issues, PRs und Praxistests am Handy.
Claude liefert fertige, lokal geprüfte PRs; der Betreiber merged, deployt und
testet fachlich.

**Stack:** FastAPI + MongoDB (`backend/`, Python 3.11), React 19 + Vite +
Tailwind (`frontend/`, yarn 1.22), Expo SDK 57 / React Native 0.86
(`mobile/`, npm, Node 24), Docker Compose mit nginx im Frontend-Image
(Container `tls-mongodb`, `tls-backend`, `tls-frontend`).

**Fahrplan:** `UMBAUPLAN.md` (Blöcke, Meilenstein-Tabelle, „Was Block X
gefunden hat“). Online-Spiegel des Plans als Artifact:
https://claude.ai/code/artifact/a381e28b-f15f-4389-9c4a-96749f15b6df
(Version 25). `RESTPLAN.md` bleibt die übergeordnete Liste. Weitere Doku über
`DOCS.md`.

---

## 2. Umgang mit dem Betreiber

- **Auf Deutsch antworten.** Englische Fachbegriffe bleiben englisch
  (Winner Bracket, Check-in), der Resttext ist deutsch.
- **Ehrliche Einordnung** statt Beschönigung: grüne Tests sind keine
  Server-Abnahme; sagen, was nicht geprüft wurde.
- **Anleitungen als konkrete Klick-Schritte** (GitHub-Oberfläche, Handy).
- Feedback kommt als **Screenshot-Stapel**. Eigene Ideen **erst als
  Vorschlagsliste**, der Betreiber bestätigt, dann werden Issues angelegt.
  Er will lieber viele kleine Issues als wenige große.
- **Nach einem Abschluss-Stand anhalten** und auf das OK warten, bevor der
  nächste Block oder das nächste Issue-Paket beginnt („nicht so chaotisch“).
- Neue Wünsche während der Arbeit sofort als Issue festhalten (Label +
  Meilenstein) und dann am laufenden Issue weitermachen.

---

## 3. Sicherheitsregeln (wörtlich, nicht verhandelbar)

- **„Geheime Sachen NIE auf GitHub.“**
- Keystore, Passwörter, `signing.json`, `google-services.json`, `.env` mit
  echten Werten: **nie ins Repo, nie in einen Chat, nie in ein Log**.
  `signing.json` enthält das Passwort und wird **nie ausgegeben**
  (kein `cat`, kein Read).
- Lokale Arbeitsdateien sind **nicht für Git**: `.vscode/`,
  `.local-testing/`, `.codex-tools/`, `*.code-workspace`, SDKs, Zertifikate,
  Berichte. Sie stehen in `.gitignore`; das bleibt so.
- **Nie gegen Produktion testen.** Live-Produktionstests werden lokal nicht
  ausgeführt. Deployment ist bewusst manuell (siehe Abschnitt 8) – kein CD
  vorschlagen.
- Das Repo ist privat und GitHub Actions kosten Geld: **lokal zuerst,
  GitHub nur zur Bestätigung** (Abschnitt 6).

---

## 4. Arbeitsweise: nach Issues, nicht nach Blöcken

Seit dem 15. September gilt:

1. **Jede Arbeit hat ein Issue.** Labels: `bug` oder `enhancement` plus
   `app`, `web`, `admin` oder `backend`. Jedes Issue bekommt sofort einen
   Meilenstein. Kein Issue ohne Meilenstein.
2. **Ein Zweig je Issue-Paket** ab `main`, Name `feat/<nr>-<stichwort>`
   bzw. `feat/app-<version>` für ein App-Versionspaket, `docs/…` für reine
   Doku.
3. **App-Issues werden je Versions-Meilenstein gesammelt** (3–5 Issues, z. B.
   „App 0.5.0-beta“), in **einem** PR umgesetzt und danach als ein Build
   veröffentlicht. Zusammengehöriges kommt in einen PR; keine PRs stapeln.
4. **PR-Text schließt die Issues mit dem englischen Schlüsselwort
   `Closes #N`** (eine Zeile je Issue). Deutsches „Schließt #N“ schließt
   nichts – das ist schon passiert (#202, #210–#215 mussten von Hand zu).
5. PR **als Entwurf** öffnen (`gh pr create --draft`), lokal komplett prüfen,
   Ergebnis als Kommentar eintragen, dann `gh pr ready` → genau ein
   GitHub-Lauf. GitHub-CI läuft nur für Nicht-Entwürfe und nur betroffene
   Jobs (`scripts/ci-changed-areas.py`).
6. **Der Betreiber merged selbst**: „Squash and merge“; veraltete Zweige mit
   „Update with rebase“ – nie Merge-Commits. Wenn ein Zweig hinter `main`
   liegt, lokal `git rebase origin/main` und `git push --force-with-lease`.
7. Commit-Texte und PR-Texte auf Deutsch, mit dem Warum, nicht nur dem Was.
   Attribution laut Sitzungs-Hinweis (`Co-Authored-By: …` im Commit, das
   „Generated with Claude Code“-Zeichen im PR-Text).
8. Nach dem Merge: Meilenstein-Tabelle in `UMBAUPLAN.md` und das Artifact
   aktualisieren (Doku-Commit, gern gebündelt).

---

## 5. Wo was liegt (Kurzkarte)

**Backend**
- Turnierrouten seit Block 13: `routes/tournament_*_routes.py` +
  `tournament_common.py`, alle an `tournament_router.py`. Tests patchen am
  Modul, in dem die Funktion nachschlägt. FastAPI 0.141 verschachtelt
  `include_router` – `router.routes` ist nicht flach.
- Flow-Tests: `backend/tests/flow_harness.py` (`make_flow()`, mongomock,
  `flow.add_user(role=…)`, `flow.act_as(user)`); die `flow`-Fixture wird je
  Testdatei definiert. Für einen 500 statt einer Exception:
  `httpx.ASGITransport(app, raise_app_exceptions=False)`.
- Betrieb (#233 Teil 1, PR #266): `backend/services/ops_monitor.py`,
  Middleware `ops_monitoring` in `server.py`, Admin-Endpunkte
  `/api/admin/ops/*`, Sammlungen `ops_errors` / `ops_slow_requests` (TTL
  30 Tage), `SLOW_REQUEST_MS` (Standard 1000). Starlette packt Fehler in
  `ExceptionGroup` → `unwrap_exception`.
- Bild-Varianten beim Upload: `backend/services/image_variants.py`
  (`schedule_variants`).
- Deutsch-Prüfung `test_german_copy.py` schlägt bei „fuer/ueber/weiss“ an –
  immer die ganze Suite laufen lassen, nicht nur den Zieltest.

**Web**
- Live-Aktualisierung: `frontend/src/hooks/useLiveRefresh.js`,
  Stream-Zustand in `frontend/src/lib/apiInvalidation.js`, Brücke
  `ApiInvalidationBridge.jsx`. `apiInvalidation.test.js` scannt Seiten nach
  Ressourcen-Schlüsseln (keine Unterstriche erlaubt).
- Profil (seit #253 / PR #267): `pages/user/ProfilePage.jsx` ist nur noch
  Rahmen; je Reiter eine Datei unter `pages/user/profile/` (`BasicTab`,
  `GamingTab`, `SocialsTab`, `AchievementsTab`, `PrivacyTab`,
  `NotificationsTab`, `SecurityTab` mit `PasswordPanel` und `SessionsPanel`,
  `TeamsPanel`, `FriendsPanel`, `MessagesPanel`, `AchievementPanels`,
  `ProfileNav`, `fields.jsx`,
  `constants.js`, `form.js`). Reiter bleiben `?tab=…`, weil Mails und
  Benachrichtigungen aus dem Backend so verlinken (Benachrichtigungen seit
  #257: `?tab=notifications`; `?tab=inbox` leitet seit #254 auf `/messages`
  um, mit `&to=` direkt ins Gespräch).
- Nachrichten (#254, PR #278): eigene Seite `pages/user/MessagesPage.jsx`
  (`/messages`, `/messages/:userId`), Verlauf in
  `pages/user/messages/ConversationView.jsx` (scrollt in sich, lädt beim
  Hochscrollen nach, hält die Position, „N neue Nachrichten“), reine Logik
  in `messages/messageGroups.js` (Tages-Trenner, Kopf-Zusammenfassung,
  `mergeMessages`). Backend `GET /api/messages/direct/{id}?before=&limit=`
  mit `has_more`; gelesen markiert nur das Öffnen. Die Web-Benachrichtigung
  behält `/profile?tab=inbox&to=…`, weil die App diesen Pfad liest
  (`mobile/src/navigation/rootNavigation.ts`). Browser-Test
  `frontend/e2e/messages.spec.js` mit nachgestelltem Server.
- Benachrichtigungen (#255, PR #279): Ziel und Bündelung als reine Logik in
  `lib/notifications.js` (`notificationTarget` folgt der App,
  `bundleNotifications` mit Stunden-Fenster), Zeile
  `components/tls/NotificationRow.jsx`, Feed `hooks/useNotificationFeed.js`
  (Endpunkte `/api/admin/notifications…`), Seite `pages/user/NotificationsPage.jsx`
  unter `/notifications`. Das Dashboard zeigt fünf Bündel und verlinkt
  dorthin. Backend-Pfade `/me/prizes` und `/tournaments/<slug>/chat` gibt es
  im Web nicht – die Zielzuordnung schreibt sie um.
- Dashboard (#256, PR #280): `pages/user/DashboardPage.jsx` liest
  `/api/mobile/dashboard` (derselbe Endpunkt wie die App, nur Anmeldung
  nötig); Termin-, Aktions- und Saisonlogik in `lib/dashboard.js`
  (Übertragung von `mobile/src/lib/dashboard.ts`). Kacheln nur noch
  Mitgliedervorteile, Strafen, Daten. Browser-Test `frontend/e2e/dashboard.spec.js`.
- Freunde (#259, PR #281): `profile/FriendsPanel.jsx` sucht über
  `/api/messages/users?q=` und rechnet den Stand zu mir aus `/api/friends`;
  `ProfileNav` nimmt `badges` (Zähler und Punkt je Reiter), das Profil lädt
  dafür `/api/friends` und hört auf die Ressource `friends`.
- Privatsphäre und Benachrichtigungen (#257, PR #275) speichern von selbst:
  `profile/useAutosave.js` (0,7 s Entprellung, ein PATCH je Lauf, Änderungen
  während des Speicherns bleiben stehen), Schalter in `profile/SwitchRow.jsx`
  (eigener `role="switch"`-Knopf; die Radix-Switch braucht ResizeObserver),
  Sichtbarkeits-Gruppen und Schnellwahl als reine Logik in
  `profile/visibility.js`.
- Grunddaten und Sicherheit (#258, PR #276): Länder in `lib/countries.js`
  (nur ISO-Codes, Namen per `Intl.DisplayNames`), Social-Symbole und die
  Bereinigung eingefügter Adressen in `profile/socials.js`, `?tab=sessions`
  ist ein Alias auf `security` (`TAB_ALIASES` in `ProfilePage.jsx`). Reiter
  liegen im Profil-Formular, eigene Formulare darin (Passwort) nutzen Knöpfe
  mit `type="button"`. `ImageUpload` zeigt keine Dateinamen mehr und hat
  „Ansehen“/„Entfernen“ – überall, auch im Adminbereich.
- Admin-Seite Betrieb: `pages/admin/AdminOpsPage.jsx`, Route `/admin/ops`,
  Menüpunkt „Betrieb“ unter System.
- ESLint nutzt `frontend/eslint-suppressions.json` (Sammel-Unterdrückungen).
  Nach dem Auslagern von Code: `npx eslint --prune-suppressions src`.
- Web-Fehlersammlung ist standardmäßig **an** (`VITE_CLIENT_LOGGING` nur
  mit `"false"` aus; Compose `CLIENT_LOGGING_ENABLED` Standard `true`).

**nginx / Uploads (#232, PR #263)**
- Compose hängt `uploads_data:/srv/uploads:ro` ins Frontend; nginx liefert
  `/api/static/uploads/` direkt von der Platte, `expires 30d`, Header
  `X-TLS-Media: nginx|backend`, Fallback `@tls_upload_backend`.
- Die Härtungs-Tests im Backend **zählen nginx-Blöcke** (8× `X-Forwarded-Host`,
  9× CSP-`add_header`) – bei neuen Proxy-Blöcken Zähler anpassen.
- Smoke: `scripts/check-media-serving.py` (CI-Schritt „Verify uploads are
  served by nginx“).

**App**
- Logik ohne UI: `mobile/src/lib/dashboard.ts` (`splitHomeTimeline`,
  `splitOpenAndPast`, `seasonLine`), `lib/format.ts` (Begriffe statt
  Rohwerte), `lib/teams.ts`, `lib/sponsors.ts` (`SPONSOR_TIERS`).
- Bausteine: `components/ContentCard.tsx` (`secondaryLabel`, kein
  „Details“-Knopf mehr), `components/ChatAttachments.tsx` (`AttachmentTile`
  mit Lade-/Fehlerzustand – zeigt den Grund, wenn ein Bild nicht lädt).
- Bildschirm-Tests: `@testing-library/react-native` 14 macht `render` und
  `fireEvent` **asynchron** – immer `await render(…)`, `await
  fireEvent.press(…)`; sonst „render function has not been called“ (führt in
  die Irre). Vorlagen: `MoreScreen.test.tsx`, `TeamsScreen.test.tsx`,
  `InfoCenterScreen.test.tsx`.
- Der e2e-Test `frontend/e2e/admin-navigation.spec.js` zählt die
  Admin-Menüeinträge (**36** seit „Betrieb“) – jeder neue Menüpunkt braucht
  die neue Zahl.

---

## 6. Lokal prüfen (Pflicht vor jedem Push)

### 6.1 Der versionierte Check (jeder PC)

`scripts/local_check.py` liegt im Repo und läuft auf jedem PC mit den
Werkzeugen im PATH: Python 3.11, Node 24 (Web) und Node 20 (App, wie
`ci.yml`), Docker Desktop, Git for Windows und gitleaks. Er führt **alle**
Jobs aus `ci.yml` aus – ohne Bereichsfilter – und legt venvs unter
`~/.local-ci/` ab, nicht im Repo.

```bash
python scripts/local_check.py                          # alles außer extra
python scripts/local_check.py --all                    # plus Zusatzprüfungen
python scripts/local_check.py --only backend,frontend
python scripts/local_check.py --list                   # Schritte anzeigen
```

- Gruppen: `repository` (Secrets, Doku-Links, Shell-Skripte,
  Routen-Vertrag, Zeilenenden, Gitleaks über Historie und ungespeicherte
  Dateien), `backend`, `frontend` (inkl. Playwright), `mobile`, `container`.
- `extra` rechnet GitHub nicht: black/isort, flake8 komplett, mypy,
  Kontrast, ShellCheck, OSV über die Lockfiles. Diese Prüfungen arbeiten mit
  einer Ratsche: `scripts/ci-baseline.json` hält den bekannten Stand fest,
  nur **neue** Befunde schlagen fehl. Nach dem Abbau von Altlasten mit
  `--record` neu aufnehmen und die Baseline mitcommitten.
- Bericht: `.local-testing/local-check.json`, Logs unter
  `.local-testing/logs/`.
- Der Container-Smoke läuft als Compose-Projekt `tls-local-check`; ein
  lokaler Entwicklungs-Stack und seine Volumes bleiben unberührt. Sind die
  Ports 8001/3000 belegt, überspringt der Check den Smoke mit Hinweis.
- Die Git-Bash-Stolpersteine aus 6.4 (`MSYS_NO_PATHCONV`, TMPDIR) setzt der
  Check selbst.
- Neben anderen schweren Läufen können App-Tests an ihrem 5-s-Timeout
  scheitern – das ist Last, allein laufen sie grün.
- `.gitleaks.toml` erlaubt nur geprüfte Testwerte, jeweils an Datei und
  genauen Wert gebunden.
- Findet der Check `docker` oder `gitleaks` nicht, obwohl beide installiert
  sind: VS Code neu starten – der PATH wird beim Start gelesen.
- Vollständiger Lauf (`--all`) am 15.09. auf dem zweiten PC: 41 Schritte
  grün in rund 7 Minuten. Backend 919 bestanden / 20 übersprungen, Web 167
  Vitest- und 146 Browser-Tests, App 89 Tests. Ratsche: 468 Dateien mit
  Formatierungsdrift, 135 flake8-, 111 mypy-, 5 ShellCheck-Altlasten, 0 OSV.

**Erweitern.** `scripts/local_check.py` hat drei Teile: Kopf (Pfade,
Versionen, Ports, Umgebungen), gemeinsamer Kern (Runner, Ratsche, Gitleaks,
OSV, ShellCheck, Dienst-Helfer – dieselbe Kopie liegt in OmniFM,
IT-Tabelander und dolibarr-mahnwesen; ein Fix dort lohnt sich auch hier) und
die LION-Schritte mit `plan()`. Ein Schritt ist eine Funktion
`(context) -> str`: Rückgabe ist die Ergebniszeile, `StepFailed` nennt Grund
und Abhilfe, `StepSkipped` sagt, warum er hier nicht laufen kann.
Eingetragen wird er mit `Step(gruppe, name, beschreibung, aktion, needs)`;
`needs` nennt Schritte derselben Gruppe oder `gruppe/name`. Neue
Befund-Prüfungen laufen über `ratchet()`, CI-Gates nie.

**Maschinenlokal (nicht in Git)** auf dem Haupt-PC (`C:\Programmieren`, seit
16.09. der einzige Arbeitsplatz): Werkzeuge unter `~/.local-toolchain`
(Node 20/22, Go, llvm-mingw); `.ci-panel/test_checks.py` zeigt jeden Schritt
im VS-Code-Testing-Panel (über `.git/info/exclude` ausgeblendet);
`.vscode/tasks.json` ruft die Gruppen des Checks und das Release-Skript auf
(Terminal → Run Task); `C:\Programmieren\check-all.py --serve` ist das
Dashboard über alle Repos, `Programmieren.code-workspace` öffnet alle fünf.

### 6.2 Der alte CI-Spiegel (PC alt, abgelöst)

Bis 15.09. lief auf dem alten PC (`C:\GIT Privat\…`) ein CI-Spiegel
`.vscode/ci_mirror.py` mit Werkzeugen unter `.codex-tools`. Seit dem Umzug
(#273) ist `scripts/local_check.py` der eine Weg; der Spiegel und sein
Werkzeugverzeichnis wurden nicht übernommen. Was davon weiter gilt:

- Playwright: Der Check installiert nur Chromium (wie GitHub). Für
  Firefox/WebKit in `frontend/`: `npx playwright install firefox webkit`,
  dann `CI=true E2E_WORKERS=2 E2E_EXTRA_BROWSERS=1 yarn test:e2e`. Mit mehr
  als 2 Workern hängen Firefox-Admin-Seiten bei „Lade …“ – das ist Last,
  kein App-Fehler. WebKit unter Windows hat einzelne flaky Tests (bestehen
  bei Wiederholung).
- Kennzahlen des vollständigen Checks stehen in 6.1.

### 6.3 Einzelbefehle wie in ci.yml

```bash
# Backend (venv: backend/.venv, Python 3.11)
cd backend && .venv/Scripts/python.exe -m pytest -m "not live" -q
flake8 backend --select=E9,F63,F7,F82 --exclude=backend/tests
# Web
cd frontend && yarn lint && yarn build && yarn test
CI=true E2E_WORKERS=2 yarn test:e2e
# App
cd mobile && npm run typecheck && npm test && npm run test:security && npm run test:release
npx expo install --check
```

### 6.4 Bekannte Stolpersteine

- **Expo-Patch-Versionen:** „Validate Expo config“ (`npx expo install
  --check`) fällt durch, sobald Expo Patches veröffentlicht. Kein
  Code-Fehler. Beheben im nächsten App-PR mit
  `npx expo install expo expo-image-picker expo-notifications` (eigener
  Commit). Zuletzt am 15.09. mit #270 nachgezogen (expo 57.0.23,
  expo-image-picker 57.0.18, expo-notifications 57.0.19); `main` ist grün.
- **Git Bash + Docker:** `MSYS_NO_PATHCONV=1` setzen; Env-Dateien,
  `docker compose cp`-Quellen und curl `-K` brauchen Windows-Pfade
  (`cygpath -w`); `/dev/null` wird zu `C:\dev\null` (leere Datei nehmen);
  `bc` fehlt (awk nehmen); TMPDIR als Windows-Pfad, sonst kommen Volumes leer an.
  Container-Namen sind fest → nur ein Stack gleichzeitig.
- **Vitest:** bei mehreren Treffern `getAllByText` statt `getByText`.
- Heredoc-Skripte mit typografischen Anführungszeichen oder „…“ brechen die
  Shell – Issue-/PR-Texte mit dem Write-Werkzeug in eine Datei schreiben und
  `--body-file` nutzen.
- Nie Arbeit auf einem fremden Feature-Zweig beginnen; wenn doch passiert:
  `git rebase --onto main <alter-zweig> <neuer-zweig>`.

---

## 7. App-Release (lokal, nicht per Actions)

- Versionen `0.x.y-beta` bis 1.0; `versionCode` läuft durch (Build-Nummer).
  Tags `mobile-v<version>-build<N>`. Version steht in `mobile/package.json`,
  `package-lock.json`, `app.json` (`version` + `versionCode`), dazu
  `CHANGELOG.md` und `RELEASES.md` im App-PR.
- Geheimes liegt **nur** in `%USERPROFILE%\.lionsapp-release\`
  (`upload.jks`, `signing.json`, `google-services.json`). Neuer Schlüssel seit
  Build 57, Signer-SHA-256 beginnt mit `6f69a289…` und endet auf `…cb98`.
- Gebaut wird in einem **Git-Worktree ohne Leerzeichen im Pfad**, `C:\lsb`
  (Standard des Skripts; das Skript legt ihn selbst an und hält ihn aktuell).
  Ein Projektpfad mit Leerzeichen bricht den nativen reanimated-Build.
- Haupt-PC seit 16.09. (#273): JDK 21 unter `C:\Program Files\Java\jdk-21.0.10`
  (im PATH steht Java 25, das reicht dem Check), Android SDK unter
  `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools, platform-tools, build-tools
  36.0.0, platforms;android-36, ndk;27.1.12297006, cmake;3.22.1 – die
  Versionen aus React Native 0.86 `libs.versions.toml`, Lizenzen
  angenommen), `JAVA_HOME` und `ANDROID_HOME` als Benutzer-Variablen,
  `signing.json` zeigt mit `javaHome`/`androidHome` dorthin.
- `~/.gradle/gradle.properties` setzt `org.gradle.jvmargs=-Xmx6g
  -XX:MaxMetaspaceSize=1g`: Das Expo-Template gibt 2 GB vor, damit stürzt der
  Dex-Merge (`mergeDexRelease`) mit „OutOfMemoryError: Java heap space“ ab.
  Die Benutzerdatei übersteuert die Projektdatei.
- Claude führt das Release selbst aus; der Auto-Modus braucht dafür die
  Freigabe `Bash(npm run release:local*)` in `~/.claude/settings.json`
  (seit 16.09. eingetragen). Der Betreiber installiert danach nur die APK.

```bash
cd mobile
npm run release:local -- --check      # zeigt, was fehlt
npm run release:local -- --dry-run    # bauen und prüfen, nichts veröffentlichen
npm run release:local                 # bauen, prüfen, GitHub-Release und Tag anlegen
```

- Erster Build auf einem PC: rund 12 Minuten (npm ci, prebuild, 8 Minuten
  Gradle); danach rund 4 Minuten mit warmem Cache.

- Ändert sich `package-lock.json` (auch nur die Version), läuft `npm ci` neu
  und alles Native baut von vorn (~30 min).
- Der NDK-Linker stürzt beim frischen Build gelegentlich einmal ab („linker
  command failed due to signal“, `libworklets.so`) – einfach erneut starten.
- Eine `| tail`-Pipe verschluckt den Exit-Code: auf „Abgebrochen:“ achten.
- Jest im Worktree kann mit „EPERM: operation not permitted, rename“ im
  Transform-Cache unter `%TEMP%\jest` scheitern, obwohl alle Tests bestehen
  (Windows-Dateisperre). Abhilfe: `%TEMP%\jest` löschen und neu starten.
- `signing.json` ist strenges JSON: ein Komma nach dem letzten Eintrag macht
  sie ungültig; das Skript nennt Zeile und Spalte, nie den Inhalt.
- Nach jedem Build dem Betreiber Klick-Schritte geben (Release-Seite, APK,
  Installation; bei Schlüsselwechsel einmal deinstallieren).

---

## 8. Deployment (Server)

Der Betreiber deployt **von Hand** mit `update.sh` auf dem Produktivserver.
Backend- und Web-Änderungen greifen **erst danach**. Bei jedem App-Test
fragen, ob der Server aktualisiert ist – Build 59 zeigte alte Termine, weil
#237 noch nicht am Server war. Der Betreiber aktualisiert den Server nach
Meilensteinen, nicht nach jedem PR (16.09.): an `update.sh` nur erinnern, wenn
ein Meilenstein abgeschlossen ist oder ein App-Build Backend-Änderungen
braucht.

---

## 9. Aktueller Stand (15. September 2026, spät abends)

### Gemergt heute
#237 (App 14.4), #261 (#221 Live-Aktualisierung), #262 (App 0.3.1-beta),
#263 (#232 Uploads über nginx), #264 (App 0.4.0-beta, Build 61 vorbereitet),
#266 (#233 Teil 1, Betrieb), #267 (#253 Profil-Layout), #268 (diese Datei),
#270 (#269 lokaler Check). `main` steht auf `42b9d76`.

### Offene PRs
- Keine, sobald der Doku-PR zu #273 (Umzug) gemergt ist.

### App-Builds
- Veröffentlicht: Build 59 (`mobile-v0.3.0-beta-build59`), Build 60
  (`mobile-v0.3.1-beta-build60`), **Build 61** (`mobile-v0.4.0-beta-build61`,
  Commit ec89de6, am 16.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `46b6ce34`). Nächster Build ist 62 mit App 0.5.0-beta (#249–#251).

### Erledigungen beim Betreiber
- `update.sh` am Server, sobald #281 gemergt ist: damit sind Web: Profil I und
  Profil II komplett am Server (Stand des Servers: #275 vom 16.09.).
- Build 61 installieren (Release-Seite → APK → installieren; Build 60 muss
  nicht deinstalliert werden), ein Bild im Chat senden und den Text aus der
  Bildkachel in **#238** posten (dort steht der Fehlergrund).

### Meilensteine und offene Issues (26 offen)
| Meilenstein | Issues |
| --- | --- |
| Web: Tempo und Betrieb | #223 große Admin-Dateien, #231 klassischer Match-Leseweg, #265 Betrieb II |
| Web: Dynamik | #224 Startseite, #225 Turnierseiten, #226 Übergänge/Skelette |
| App 0.3.1-beta | #238 schwarze Chat-Kachel (wartet auf Text vom Betreiber) |
| App 0.5.0-beta | #249 Was ist neu, #250 Update aus der App, #251 In-App-Banner |
| App 0.6.0-beta | #218 Erfolge |
| App 0.7.0-beta | #216 Kalender, #236 Galerie |
| App 0.8.0-beta | #239 Sticker/GIFs, #240 Freundschaftsanfragen, #245 Laufbanner |
| App 1.0.0 | #217 Fingerabdruck/Passkey, #219 Store-Reife |
| Admin und Turniere | #203, #204, #227, #228, #235 |
| Auszeichnungen und Marke | #229, #230 |
| Spaeter | #260 Plattform-Konten verknüpfen |

### Reihenfolge danach (vom Betreiber freigegeben)
1. Profil I ist fertig (#253, #257, #258 mit #267, #275, #276); der Meilenstein
   „Web: Profil I – Aufbau“ ist abgeschlossen, Server-Update fällig.
2. Profil II ist fertig (#254, #255, #256, #259 mit #278, #279, #280, #281); der
   Meilenstein „Web: Profil II“ ist abgeschlossen, Server-Update fällig.
3. Betrieb II #265.
4. App 0.5.0-beta (#249–#251) → Build 62.
5. Danach Dynamik, 0.6.0, Admin und Turniere, … Abwechselnd App und Web.

Vor jedem neuen Paket: Stand melden und auf das OK warten.

### Noch offene Doku
- Das Online-Artifact des Umbauplans (Abschnitt 1) auf den Stand von
  `UMBAUPLAN.md` bringen. „Was 22.2 gefunden hat“ und die Zeilen für
  #261/#262/#263/#264/#266/#267 stehen seit #271 in der Datei.

### GitHub-Befunde vom 15.09. (zweiter PC, nichts davon geändert)
- **CodeQL** (`codeql.yml`, nur manuell) startet nicht: „recent account
  payments have failed or your spending limit needs to be increased“. Die
  drei offenen CodeQL-Warnungen sind alt: eine zeigt auf
  `tournament_routes.py:3149` aus der Zeit vor Block 13 (die Datei hat heute
  24 Zeilen), die zwei anderen (`pdf_service.py:891`, `user_routes.py:626`)
  sind Vorbelegungen, die im Normalfall überschrieben werden – kein Fehler.
- **`main` hat keinen Branch-Schutz und keine Rulesets.** „Nie direkt auf
  `main`“ ist nur Vereinbarung. Empfehlung: Settings → Branches → „Require a
  pull request before merging“.
- **Rund 60 Remote-Zweige gemergter PRs** liegen noch auf GitHub.
  Empfehlung: Settings → General → „Automatically delete head branches“; die
  alten einmal unter Branches löschen.
- Zwei PRs wurden mit rotem letzten Lauf gemergt: #263 (Job „Bereiche und
  Geheimnis-Scan“, Log nicht mehr abrufbar) und #264 (`InfoCenterScreen`-Test
  am 5-s-Timeout, Last auf dem Runner). Der Lauf zu #270 auf demselben Stand
  war komplett grün, lokal ebenso.
- Alter lokaler Zweig `*-changes-new` des früheren Anbieters (Remote gelöscht):
  alle Patches sind in `main`; der Betreiber löscht ihn selbst.

### Wichtige Funde dieses Tages (für Erklärungen an den Betreiber)
- Bilder trugen `Cache-Control: no-store` über den nginx-`/api/`-Block und
  wurden nie gecacht; seit #263 liefert nginx sie mit 30 Tagen Cache
  (400-px-Fassung von 0,086 s auf 0,003 s je Bild).
- Server-Fehler waren nur in Container-Logs sichtbar; seit #266 als Gruppen
  unter Admin → Betrieb, mit „erledigt“/„wieder offen“.
- Richtiger Discord-Link: `discord.com/invite/thelionsquadesports`.

---

## 10. Der Haupt-PC und was nicht über Git kommt

Seit 16.09. (#273) ist `C:\Programmieren\THE-LION_SQUAD-eSPORT-Webseite` auf
dem Haupt-PC der einzige Arbeitsplatz; der alte PC (`C:\GIT Privat\…`) ist
nur noch Sicherung. Was über Git kommt: der Code, diese Datei,
`UMBAUPLAN.md`, alle Zweige. Was **nicht** über Git kommt und auf einem
frischen Gerät neu entsteht oder von Hand mitmuss:

1. **`%USERPROFILE%\.lionsapp-release\`** (`upload.jks`, `signing.json`,
   `google-services.json`) – nur über USB oder einen anderen sicheren Weg,
   nie über Git, Chat oder einen Cloud-Link im Klartext. In `signing.json`
   die Pfade `javaHome` und `androidHome` auf das Gerät anpassen.
2. **Werkzeuge** (Abschnitt 6.1 und 7): Python 3.11, Node 24 und 20, Docker
   Desktop, Git for Windows, gitleaks, JDK 21, Android SDK per
   `sdkmanager` (Pakete in Abschnitt 7), `~/.gradle/gradle.properties` mit
   dem 6-GB-Heap, Benutzer-Variablen `JAVA_HOME` und `ANDROID_HOME`.
3. **Neu erzeugen statt kopieren:** der Check legt seine venvs unter
   `~/.local-ci/` an; `cd frontend && yarn install`, `cd mobile && npm ci`;
   den Build-Worktree `C:\lsb` legt das Release-Skript selbst an.
4. **`.vscode/`** des Repos (maschinenlokal, in `.gitignore`):
   `settings.json` (Testing-Panel), `tasks.json` (Check-Gruppen und
   Release), `extensions.json`. Kein Spiegel mehr, siehe 6.2.
5. **`.ci-panel/`** und `C:\Programmieren\check-all.py` (Testing-Panel und
   Dashboard über alle Repos), siehe 6.1.
6. Optional das Claude-Gedächtnis dieses Rechners:
   `C:\Users\<user>\.claude\projects\c--Programmieren\memory\` (Index
   `MEMORY.md`). Diese `CLAUDE.md` enthält alles Wesentliche daraus; das
   Gedächtnis ist nur Ergänzung.
