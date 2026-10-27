# GitHub-Automatik: Workflows, Releases, Vorlagen und Einstellungen

Was auf GitHub von selbst passiert, wie Website-Releases entstehen und welche Einstellungen dafür gesetzt sein
müssen (#1734). Die Prüfregeln selbst stehen in [`CLAUDE.md`](../../CLAUDE.md) und in den Workflows.

## Workflows auf einen Blick

| Workflow | Wann | Was |
| --- | --- | --- |
| [CI](../../.github/workflows/ci.yml) | PR (kein Entwurf), Merge auf `main`, von Hand | Geheimnis-Scan, dann nur die Jobs der berührten Bereiche; „CI-Ergebnis“ ist Pflicht für `main` |
| [CodeQL](../../.github/workflows/codeql.yml) | PR, Merge mit Code, montags, von Hand | Sicherheits-Analyse für JavaScript/TypeScript und Python |
| [PR-Titel](../../.github/workflows/pr-title.yml) | jeder PR, auch beim Umbenennen | Titel beginnt mit `feat:`, `fix:` … (siehe unten) |
| [PR-Labels](../../.github/workflows/labeler.yml) | jeder PR | Labels nach Ordner: `backend`, `web`, `app`, `documentation`, `github_actions`, `operations`, `dependencies` ([Regeln](../../.github/labeler.yml)) |
| [Dependabot Auto-Merge](../../.github/workflows/dependabot-auto-merge.yml) | PRs von Dependabot | Patch-Updates (x.y.Z) mergen sich nach grünen Pflicht-Prüfungen selbst |
| [Website-Release](../../.github/workflows/release-please.yml) | Merge auf `main`, von Hand | pflegt den Release-PR, nach dessen Merge Tag, Release, `CHANGELOG.md` |
| [README-Bilder](../../.github/workflows/readme-screenshots.yml) | am Monatsersten, von Hand | nimmt die README-Bilder im Abnahme-Stand auf und schlägt sie als PR vor |
| [Nächtliche Abnahme](../../.github/workflows/nightly-abnahme.yml) | jede Nacht, von Hand | spielt den Event-Abend im [Abnahme-Stand](abnahme-lokal.md) durch, rot → Issue „Nächtlicher Abnahme-Test rot“ |
| [Externe Links](../../.github/workflows/links.yml) | montags, von Hand | ruft alle http(s)-Links der Markdown-Dateien ab, tote Links landen in einem Issue |
| [Expo-Patches](../../.github/workflows/expo-updates.yml) | am 3. jedes Monats, von Hand | `npx expo install --fix` im installierten SDK, PR mit Auto-Merge nach grünen Pflicht-Prüfungen |
| [Größere Updates](../../.github/workflows/major-updates.yml) | am 5. jedes Monats, von Hand | Issue mit neuen Hauptversionen und neuem Expo-SDK – nichts wird eingespielt |
| [Mobile APK Release](../../.github/workflows/mobile-release.yml) | nur von Hand | Notweg für eine signierte APK, siehe [App-Releases](../../mobile/RELEASES.md) |

Von Hand starten: Reiter **Actions** → Workflow links wählen → **Run workflow**.

Das Repository ist öffentlich, Actions-Minuten auf den Standard-Runnern kosten deshalb nichts. Die CI läuft
trotzdem nur für die Bereiche, die eine Änderung berührt – das spart Wartezeit, nicht Geld.

Alle Workflows laufen fest auf `ubuntu-24.04`, nicht auf `ubuntu-latest` (#1739): GitHub stellt `ubuntu-latest`
am 19.10.2026 auf Ubuntu 26 um. Der Umstieg kommt bewusst in einem eigenen PR, wenn Browser-Installation,
Docker und Playwright dort geprüft sind.

## CI in Teilen: unter 15 Minuten

Die CI soll von Push bis „CI-Ergebnis“ höchstens 15 Minuten brauchen (#2054). Dafür laufen die langen Suiten in
Teilen auf mehreren Rechnern gleichzeitig – mit denselben Tests und denselben Schwellen wie in einem Job:

| Job | Was |
| --- | --- |
| Backend-Prüfungen | Kompilieren, Doku-Links, Shell-Skripte, flake8, pip-audit |
| Backend-Tests (1/3 … 3/3) | je ein Drittel der Testdateien, darin vier Prozesse (`pytest-xdist`, `--numprocesses=auto`) |
| Backend-Coverage | prüft, dass jede Testdatei in genau einem Teil lief, legt die Coverage aller Teile zusammen und verlangt wie bisher **35 % über das ganze Backend** |
| Frontend | Compose- und Nginx-Konfiguration, Routen-Vertrag, Audit, ESLint, Build |
| Frontend-Unit-Tests (1/2, 2/2) | je die Hälfte der Vitest-Dateien (`--shard`), mit Blob-Bericht samt Coverage |
| Frontend-Coverage | legt beide Berichte zum Gesamtbericht zusammen (`--merge-reports`), wie vorher aus einem Lauf |
| Browser-Tests (1/6 … 6/6) | je ein Sechstel der Browser-Tests (Desktop und Handy) |

Verteilt wird nach **gemessener Dauer**, nicht nach Zahl der Tests: die längsten Gruppen zuerst auf den Teil mit
der wenigsten Arbeit. Eine Gruppe ist im Backend eine Testdatei
([`shard_plan.py`](../../backend/tests/shard_plan.py), Variable `TEST_SHARD=n/gesamt`), bei den Browser-Tests eine
Testdatei je Projekt ([`e2e-shards.mjs`](../../frontend/scripts/e2e-shards.mjs)); eine Gruppe bleibt beisammen
und läuft wie bisher in ihrer Reihenfolge. Jeder Teil rechnet denselben Plan; die Browser-Teile prüfen ihre
Testliste vorab mit Playwright, der Coverage-Job die Backend-Teile hinterher. Neue Dateien ohne Messwert zählen
mit der mittleren Dauer je Test.

**Dauern auffrischen**, wenn ein Teil deutlich länger braucht als die anderen – aus den Artefakten eines
grünen CI-Laufs (sie bleiben sieben Tage):

```bash
gh run download <lauf-id> -p "backend-test-results-*" -D ci-zeiten/backend
gh run download <lauf-id> -p "frontend-e2e-timings-*" -D ci-zeiten/browser
python scripts/test-shards.py durations ci-zeiten/backend/*/backend-junit-*.xml > backend/tests/shard-durations.json
cd frontend && node scripts/e2e-shards.mjs durations ../ci-zeiten/browser/*/e2e-durations-*.json > e2e/shard-durations.json
```

Lokal ändert sich nichts: `python -m pytest -m "not live"` und `yarn test:e2e` laufen wie bisher ganz.
Schneller geht das Backend lokal mit `-n auto` (pytest-xdist); jeder Prozess bekommt dabei einen eigenen
Upload-Ordner unter `UPLOAD_DIR`, die Datenbank im Speicher (mongomock) hat ohnehin jeder für sich.

## PR-Titel und Commits

Gemergt wird mit „Squash and merge“: Der PR-Titel wird zur Commit-Nachricht auf `main`, und daraus schreibt
release-please Version und Changelog. Der Titel beginnt deshalb mit einem Typ, der Rest bleibt Deutsch. Die
Commits im Zweig dürfen frei benannt sein.

| Typ | Wofür | Version | Im Changelog |
| --- | --- | --- | --- |
| `feat:` | neue Funktion | 1.**2**.0 | Neu |
| `fix:` | Fehler behoben | 1.1.**1** | Fehlerbehebungen |
| `perf:` | schneller | 1.1.**1** | Schneller |
| `docs:` | nur Doku | – | Dokumentation |
| `revert:` | Rücknahme | 1.1.**1** | Zurückgenommen |
| `chore:`, `refactor:`, `test:`, `ci:`, `build:`, `style:`, `deps:` | Pflege ohne sichtbare Änderung | – | – |
| `feat!:` / `fix!:` | bricht etwas | **2**.0.0 | mit Hinweis |

Beispiele: `feat: Turnierbaum zeigt den Sieger-Moment`, `fix(app): Anmeldung vergisst die Begleitperson`.
Ein Bereich in Klammern ist erlaubt, aber nicht nötig. Änderungen nur unter `mobile/` (und im App-Handbuch
`docs/handbuch/app.md`) zählen nicht für die Website-Version. **App-PRs** tragen `(app)` im Titel und ändern nur
dort – die Prüfung „App-PR nur in mobile/“ meldet sonst die Website-Dateien; die gehören in einen eigenen PR
(z. B. `test: …`), damit eine App-Neuheit nicht im Changelog der Website landet.

## Releases der Website

1. Nach jedem Merge auf `main` öffnet oder aktualisiert release-please den PR
   **„chore: Website X.Y.Z veröffentlichen“** mit der nächsten Version und dem Changelog-Entwurf.
2. Wenn du veröffentlichen willst: diesen PR mergen. Daraus entstehen Tag `vX.Y.Z`, ein GitHub-Release und der
   Eintrag in [`CHANGELOG.md`](../../CHANGELOG.md); `frontend/package.json` bekommt dieselbe Version.
3. Den Server spielst du danach wie gewohnt ein ([UPDATE](../../UPDATE.md)) – es gibt kein automatisches
   Deployment.

**Wann veröffentlichen?** Nicht nach jedem Fix. Der Release-PR sammelt still; veröffentlicht wird bewusst – mal
ein größerer Meilenstein mit Neuem und Fixes, mal ein paar Fixes, mal ein einzelner wichtiger Fix.

**Mehrere Einträge je PR.** Beim „Squash and merge“ wird ein PR sonst zu genau einer Zeile (der Titel). Bringt
ein PR mehrere Neuerungen oder Fixes, steht im PR-Text ein Block – jede Zeile wird ein eigener Eintrag unter
„Neu“, „Fehlerbehebungen“ usw., und die Version richtet sich danach:

```
BEGIN_COMMIT_OVERRIDE
feat: TV zeigt „Auslosung bereit“ mit leuchtenden Zielspielen (#1634)
feat: Live-Warteschlange je Station am TV (#1634)
fix: Defekte Stationen erscheinen am TV mit „Bitte nicht benutzen“ (#1634)
END_COMMIT_OVERRIDE
```

Die Prüfung „Changelog-Block im PR-Text“ meldet Zeilen ohne Typ. Nur sichtbare Änderungen gehören hinein; Tests,
CI und Umbau bleiben draußen (oder als `test:`/`ci:` – die erscheinen nicht).

**Netto für Nutzer, nichts doppelt.** Ein Release beschreibt, was sich für Nutzer seit der letzten Version geändert
hat – kein Git-Log (Grundsatz nach „Keep a Changelog“):

| Fall | Im Release |
| --- | --- |
| neue Funktion | eine Zeile unter „Neu“, egal wie viele Commits |
| Nachbesserung im selben PR (Prüfungs-Befund, eigener Fehler) | keine eigene Zeile |
| Fix an Gemergtem, das noch **nicht** veröffentlicht ist | keine eigene Fehlerbehebung; bei Bedarf den Block des ursprünglichen PRs anpassen (release-please liest ihn auch nach dem Merge) |
| Fix an schon **Veröffentlichtem** | eigene Zeile unter „Fehlerbehebungen“ |

Vor jedem Release wird die fertige Liste im Release-PR durchgesehen (Doppeltes, Unverständliches) und erst dann
gemergt.

**Lesbares Changelog.** Nach jedem Lauf räumt [`scripts/tidy_changelog.py`](../../scripts/tidy_changelog.py) den
Release-PR auf und beim Veröffentlichen den Text des GitHub-Release: je Eintrag nur die Issue-Nummer („(#1634)“,
ohne PR-Link und Commit-Hash), Überschrift „1.2.0 (19.10.2026)“.

Die erste Version ist **1.0.0** und umfasst alles ab dem Stand vom 15.10.2026. Die App behält ihren eigenen
Ablauf mit Tags `mobile-v*` ([App-Releases](../../mobile/RELEASES.md)). Der Server holt App-Updates nur aus
Releases mit genau diesem Tag-Muster (`backend/services/github_releases.py`), Website-Releases stören ihn
nicht. Die Markierung „Latest“ auf GitHub trägt immer das zuletzt veröffentlichte Release, egal ob Website
oder App; die README-Badges filtern deshalb nach dem Release-Namen: „Website“ auf `v*`, „App“ auf `LionsAPP*`.

**Pflicht-Prüfungen im Release-PR.** PRs, die ein Workflow mit dem eingebauten `GITHUB_TOKEN` öffnet, starten
keine weiteren Workflows – CI und CodeQL laufen dort also nicht von selbst, und die Regel für `main` lässt den
Merge nicht zu. Zwei Wege:

- **Einmal einrichten (empfohlen):** fein granulierten Token anlegen und als Secret `RELEASE_PLEASE_TOKEN`
  speichern (Anleitung unten). Release-PR und Bilder-PR prüfen sich dann selbst.
- **Ohne Token:** den Release-PR einmal **schließen und wieder öffnen**. Dann starten CI und CodeQL wie bei jedem
  anderen PR.

Auto-Merges (Dependabot, Expo-Patches) schaltet der Workflow mit `RELEASE_PLEASE_TOKEN` ein; der Merge zählt dann
als Merge des Betreibers und löst auf `main` CI und release-please aus. Für Dependabot muss der Token zusätzlich
als **Dependabot-Secret** liegen (Tabelle unten), weil Workflows, die Dependabot startet, nur diese Secrets sehen.

## Updates: was automatisch kommt und was nicht

| Art | Weg | Automatisch gemergt? |
| --- | --- | --- |
| Patch (x.y.**Z**) von npm, pip, Actions | Dependabot, montags | ja, nach grünen Pflicht-Prüfungen |
| Minor (x.**Y**.0) | Dependabot, montags | nein – du prüfst und mergst |
| Expo-Patches im installierten SDK | Workflow „Expo-Patches“, monatlich | ja, nach grünen Pflicht-Prüfungen |
| Major (**X**.0.0), neues Expo-SDK | nur der Bericht „Größere Updates“ als Issue | nie |

## Größere Updates

Der Bericht ([`scripts/major-updates-report.py`](../../scripts/major-updates-report.py)) listet einmal im Monat in
einem Issue, wo es eine neue Hauptversion gibt. Unter 1.0 zählt schon eine neue Minor-Version, so wie SemVer es
vorsieht. Pakete, die das Expo-SDK vorgibt (`expo-*`, React, React Native …), stehen nicht einzeln darin;
stattdessen meldet er ein neues SDK.

So gehst du ein größeres Update an:

1. Ein Issue, ein Paket (oder ein Expo-SDK). Den Changelog des Pakets lesen, vor allem „Breaking Changes“.
2. Zweig `chore/<nr>-<paket>-<version>`, Update einspielen, lokal prüfen (`python scripts/local_check.py`).
3. Expo-SDK: `npx expo install expo@latest --fix` in `mobile/`, dann `npx expo-doctor` und die
   [Geräteabnahme](../../mobile/RELEASE_SMOKE_TEST.md), bevor eine App-Version veröffentlicht wird.
4. PR mit `chore:` (oder `feat!:`, wenn sich für Nutzer etwas sichtbar ändert), CI grün, mergen.

## README-Bilder

Die Bilder in [`docs/assets/readme/`](../assets/readme) zeigen nur Testdaten aus dem
[Abnahme-Stand](abnahme-lokal.md). Der Workflow „README-Bilder“ baut den Stand, befüllt ihn mit
`scripts/seed_abnahme.py` und nimmt mit
[`readme-screenshots.spec.js`](../../frontend/e2e/abnahme/readme-screenshots.spec.js) auf. Von Hand am eigenen
Rechner, wenn der Abnahme-Stand läuft und befüllt ist:

```bash
cd frontend
ABNAHME=1 E2E_BASE_URL=http://127.0.0.1:23000 README_SHOTS=../docs/assets/readme \
  npx playwright test e2e/abnahme/readme-screenshots.spec.js --project=chromium --workers=1
```

Das Banner (`banner-dark.png`, `banner-light.png`) ist aus den Brand-Bildern in
`frontend/public/assets/brand/` gebaut und ändert sich nur mit dem Logo.

## Einstellungen auf GitHub

Was nicht in Dateien steht, sondern in den Einstellungen des Repositorys gesetzt wird:

| Wo | Was | Wofür |
| --- | --- | --- |
| Settings → General → Pull Requests | „Allow squash merging“ → Standard-Nachricht **„Pull request title“** | Commit auf `main` = PR-Titel, auch bei PRs mit einem einzigen Commit |
| Settings → General → Pull Requests | „Allow auto-merge“ an (schon gesetzt) | Dependabot Auto-Merge |
| Settings → Actions → General → Workflow permissions | „Allow GitHub Actions to create and approve pull requests“ an | Release-PR und Bilder-PR |
| Settings → Advanced Security | „Private vulnerability reporting“ an | Meldeweg aus [SECURITY](../../SECURITY.md) und den Issue-Vorlagen |
| Settings → General → Social preview | Bild hochladen: `frontend/public/assets/brand/og-default.png` | Vorschau beim Teilen des Repo-Links |
| Startseite → Zahnrad bei „About“ | Beschreibung, Website `https://lionsquad.at`, Topics | Kurzprofil des Repos |
| Settings → Secrets and variables → Actions | Secret `RELEASE_PLEASE_TOKEN` (optional, siehe unten) | Pflicht-Prüfungen in Release- und Bilder-PRs |
| Settings → Secrets and variables → Dependabot | dasselbe Secret `RELEASE_PLEASE_TOKEN` | Dependabot-Auto-Merge löst CI und Release aus |
| Settings → Rules → „main schützen“ | „CI-Ergebnis“ und CodeQL als Pflicht (schon gesetzt), dazu „PR-Titel prüfen“ | Merge nur mit grünen Prüfungen und gültigem Titel, auch für Auto-Merge |

**Token für `RELEASE_PLEASE_TOKEN`:** GitHub → Profilbild → Settings → Developer settings → Personal access
tokens → Fine-grained tokens → Generate new token. Repository access: nur dieses Repository. Permissions:
Contents **Read and write**, Pull requests **Read and write**. Ablaufdatum setzen und rechtzeitig erneuern. Den
Wert nur im Secret speichern – nie in Dateien, Issues oder Chats.

## Vorlagen

- Issues: Formulare [Fehler melden](../../.github/ISSUE_TEMPLATE/fehler.yml) und
  [Idee vorschlagen](../../.github/ISSUE_TEMPLATE/idee.yml), dazu Verweise auf die private Sicherheitsmeldung und
  das Kontaktformular ([Auswahl](../../.github/ISSUE_TEMPLATE/config.yml)).
- Pull Requests: [Vorlage](../../.github/pull_request_template.md) mit Titel-Hilfe und Prüfliste.
- [CODEOWNERS](../../.github/CODEOWNERS): Der Betreiber wird bei jedem PR als Prüfer eingetragen.
