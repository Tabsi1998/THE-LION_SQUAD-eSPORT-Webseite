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
| [Externe Links](../../.github/workflows/links.yml) | montags, von Hand | ruft alle http(s)-Links der Markdown-Dateien ab, tote Links landen in einem Issue |
| [Mobile APK Release](../../.github/workflows/mobile-release.yml) | nur von Hand | Notweg für eine signierte APK, siehe [App-Releases](../../mobile/RELEASES.md) |

Von Hand starten: Reiter **Actions** → Workflow links wählen → **Run workflow**.

Das Repository ist öffentlich, Actions-Minuten auf den Standard-Runnern kosten deshalb nichts. Die CI läuft
trotzdem nur für die Bereiche, die eine Änderung berührt – das spart Wartezeit, nicht Geld.

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
Ein Bereich in Klammern ist erlaubt, aber nicht nötig. Änderungen nur unter `mobile/` zählen nicht für die
Website-Version.

## Releases der Website

1. Nach jedem Merge auf `main` öffnet oder aktualisiert release-please den PR
   **„chore: Website X.Y.Z veröffentlichen“** mit der nächsten Version und dem Changelog-Entwurf.
2. Wenn du veröffentlichen willst: diesen PR mergen. Daraus entstehen Tag `vX.Y.Z`, ein GitHub-Release und der
   Eintrag in [`CHANGELOG.md`](../../CHANGELOG.md); `frontend/package.json` bekommt dieselbe Version.
3. Den Server spielst du danach wie gewohnt ein ([UPDATE](../../UPDATE.md)) – es gibt kein automatisches
   Deployment.

Die erste Version ist **1.0.0** und umfasst alles ab dem Stand vom 15.10.2026. Die App behält ihren eigenen
Ablauf mit Tags `mobile-v*` ([App-Releases](../../mobile/RELEASES.md)). Der Server holt App-Updates nur aus
Releases mit genau diesem Tag-Muster (`backend/services/github_releases.py`), Website-Releases stören ihn
nicht. Die Markierung „Latest“ auf GitHub trägt immer das zuletzt veröffentlichte Release, egal ob Website
oder App; das README-Badge „App“ filtert deshalb auf `mobile-v*`.

**Pflicht-Prüfungen im Release-PR.** PRs, die ein Workflow mit dem eingebauten `GITHUB_TOKEN` öffnet, starten
keine weiteren Workflows – CI und CodeQL laufen dort also nicht von selbst, und die Regel für `main` lässt den
Merge nicht zu. Zwei Wege:

- **Einmal einrichten (empfohlen):** fein granulierten Token anlegen und als Secret `RELEASE_PLEASE_TOKEN`
  speichern (Anleitung unten). Release-PR und Bilder-PR prüfen sich dann selbst.
- **Ohne Token:** den Release-PR einmal **schließen und wieder öffnen**. Dann starten CI und CodeQL wie bei jedem
  anderen PR.

Dasselbe gilt für Merges durch Dependabot Auto-Merge: Sie lösen auf `main` keinen neuen CI- und Release-Lauf
aus. Das holt der nächste eigene Merge nach.

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
| Settings → Rules → „main schützen“ | „CI-Ergebnis“ und CodeQL als Pflicht (schon gesetzt) | Merge nur mit grünen Prüfungen, auch für Auto-Merge |

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
