# Stolpersteine nach Gebiet

Fallen, in die wir schon getreten sind – mit der Abhilfe. Bis 5. Oktober 2026 stand das als Abschnitt 6.4
in `CLAUDE.md` (#929). Die wichtigsten stehen dort weiter in Abschnitt 6.3 als Einzeiler; hier steht alles,
nach Gebiet. **Vor der Arbeit in einem Gebiet dessen Abschnitt lesen**, nicht die ganze Datei:

```bash
git grep -n "^## " -- docs/STOLPERSTEINE.md        # die Gebiete mit Zeilennummer
git grep -n -i "metro" -- docs/STOLPERSTEINE.md    # oder nach Stichwort
```

Neue Fallen trägt der Doku-Stand-PR im passenden Gebiet ein: fett das Stichwort, dann was passiert ist und
was hilft.

## 1. Lokaler Check und Werkzeuge

- **Git Bash + Docker:** `MSYS_NO_PATHCONV=1` setzen; Env-Dateien,
  `docker compose cp`-Quellen und curl `-K` brauchen Windows-Pfade
  (`cygpath -w`); `/dev/null` wird zu `C:\dev\null` (leere Datei nehmen);
  `bc` fehlt (awk nehmen); TMPDIR als Windows-Pfad, sonst kommen Volumes leer an.
  Container-Namen sind fest → nur ein Stack gleichzeitig.
- **Gitleaks läuft nur lokal:** `ci.yml` hat nur `check-secrets.py`, kein Gitleaks – das macht allein
  `local_check.py` (Gruppe `repository`). Wer nur `--only backend,frontend` laufen lässt, übersieht
  Testwerte, die wie Schlüssel aussehen; so kamen fünf erfundene Tokens in `main` (Vollcheck 3.10.).
  Erfundene Testwerte bekommen in `.gitleaks.toml` einen Eintrag, der an Datei **und** genauen Wert
  gebunden ist.
- **Zusatzprüfungen regelmäßig:** `--all` mindestens einmal die Woche (mit #775). Laufen die Ratschen
  black/isort, flake8 und mypy lange nicht, wächst die Abweichung unbemerkt (3.10.: 326, 140 und 144 neue
  Klassen seit 15.09.) – dann neue Funde stichprobenartig prüfen und erst danach `--record`.
- **Android-Emulator neben dem lokalen Check:** der Emulator (qemu mit
  Software-GPU) belegt die Kerne. Am 02.10. riss der Netzbau-Test der App
  (sonst knapp 4 s) so sein Zeitlimit von 15 s. Vor einem Check den
  Emulator beenden (`adb emu kill`).
- **Gegenprobe mit verstellter Uhr** (#774): Backend in einem Wegwerf-venv mit
  `freezegun` und einem pytest-Plugin, das jede Prüfung bei
  `freeze_time(zeitpunkt, tick=True, real_asyncio=True)` laufen lässt; die
  Anwendung vorher über `flow_harness.load_application()` laden. Web: eigene
  vitest-Konfiguration mit `vi.useFakeTimers({ now, toFake: ["Date"],
  shouldAdvanceTime: true })`; App: jest mit `jest.useFakeTimers({ now,
  advanceTimers: true })`. Ein Kanarien-Test beweist, dass die Uhr ankommt.
- **Sicherheitscheck der App** (`npm run audit:ci`, `mobile/scripts/audit-ci.cjs`):
  sperrt ab „moderate“; Ausnahmen stehen mit Begründung und Frist in
  `mobile/scripts/security-audit-allowlist.json` – nach Ablauf wird der
  Check von selbst rot. Seit #786 hebt `overrides` `@grpc/grpc-js` auf
  1.14.5 (kommt mit dem Firebase-JS-Paket, in der Android-App nie geladen)
  und `brace-expansion` auf 5.0.12; einzige Ausnahme ist
  `GHSA-86W9-CPQP-85RV` (node-forge, keine reparierte Version, nur im
  Expo-Werkzeug zum Signieren von Over-the-air-Updates) bis **02.11.2026** –
  dann neu prüfen.
- **Expo-Patch-Versionen:** „Validate Expo config“ (`npx expo install
  --check`) fällt durch, sobald Expo Patches veröffentlicht. Kein
  Code-Fehler. Beheben im nächsten App-PR mit
  `npx expo install expo expo-image-picker expo-notifications` (eigener
  Commit) oder gleich `npx expo install --fix` – mit dem Node 20 aus
  `~/.local-toolchain`, damit `package-lock.json` zum CI passt. Zuletzt am
  21.09. mit #335 nachgezogen (expo 57.0.24, expo-constants 57.0.19,
  expo-image-picker 57.0.19, expo-notifications 57.0.20).
- **Dependabot-PRs prüfen:** im Hauptordner einen Prüfzweig anlegen
  (`git checkout -b chore/dependabot-pruefung origin/main`, dann
  `git merge origin/dependabot/…` je Zweig), den lokalen Check einmal
  laufen lassen, danach zurück auf `main` und den Prüfzweig löschen –
  kein eigener Arbeitsordner (siehe unten). Ein CI-Job, der nach 2 s „fehlschlägt“ und alle anderen
  überspringt, ist kein Code: die Meldung steht in den Annotations des
  Check-Runs (am 21.09.: GitHub-Abrechnung).
- **Nur der Haupt-Checkout (Wunsch des Betreibers, 3.10.):** keine Arbeitsbäume neben
  `C:\Programmieren\THE-LION_SQUAD-eSPORT-Webseite`. Am 3.10. lagen dort 55 `tls-*`-Ordner, dazu 82
  venvs unter `~/.local-ci` (rund 43 GB) – alle entfernt. Gearbeitet wird ein Zweig nach dem anderen im
  Hauptordner; solange `local_check.py` läuft, kein Zweigwechsel. Einzige Ausnahme bleibt der
  Build-Worktree `C:\lsb` des Release-Skripts (Abschnitt 7). Eigene Hintergrundprozesse (vite preview,
  Log-Beobachter, Prozess-Pools, der adb-Server) am Ende beenden: ein verwaister Prozess hält sein
  Arbeitsverzeichnis fest, der Ordner lässt sich dann nicht löschen.
- **Liegengebliebener Stack des Checks:** bricht ein Vollcheck nach „The stack answers live, ready and
  health“ ab oder lief er mit `--keep-services`, bleibt das Compose-Projekt `tls-local-check` stehen
  (`tls-frontend` auf 3000, `tls-backend` auf 8001) und startet mit Docker Desktop jedes Mal wieder. Solange
  die Ports belegt sind, **überspringt sich der Container-Smoke**, und die Browser-Tests (der Check setzt
  `CI=true`) brauchen `E2E_PORT=3105`. Am 5.10. stand so ein Stack seit dem Vollcheck vom 3.10. Prüfen mit
  `docker compose ls`, beenden mit `docker compose -p tls-local-check down --volumes --remove-orphans` –
  das Projekt gehört allein dem Check, ein eigener Entwicklungs-Stack hieße anders.
- **Docker Desktop muss laufen** – auch für den Routen-Vertrag in der Gruppe `repository`, nicht nur für
  `container`, OSV und ShellCheck. Starten: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`.
- **PATH für den Check:** nur die Ordner von Docker und gitleaks voranstellen. Ein Node 20 vorn im PATH
  macht jeden Web-Schritt „SKIPPED: Node 24 is not installed“; die App-Schritte finden ihr Node 20 unter
  `~/.local-toolchain` selbst.
- **Gitleaks und erfundene Testwerte:** die Regel `generic-api-key` schlägt bei ausgedachten Passwörtern
  ab etwa zehn Zeichen an und bei einer ausgeschriebenen `android:apk-key-hash:…`-Herkunft. Kurze Werte
  nehmen (`geheim-42`) oder den Wert im Test aus dem Fingerabdruck ausrechnen; sonst ein Eintrag in
  `.gitleaks.toml`, an Datei **und** Wert gebunden. Der Schritt liest jeden erreichbaren Commit – einen
  noch nicht gepushten Commit deshalb mit `--amend` berichtigen statt mit einem zweiten.
- **Den Check nie in eine Pipe mit `&& git commit` hängen:** `local_check.py … | grep … && git commit`
  verliert den Exit-Code, ein roter Schritt wird committet (16.09. bei #276). Allein laufen lassen,
  Ergebnis lesen, dann committen.
- **Jest: „EPERM: operation not permitted, rename“** im Cache unter `%TEMP%\jest` lässt Testdateien als
  gescheitert erscheinen, obwohl alle Tests bestehen (Windows-Dateisperre). `%TEMP%\jest` löschen, neu
  starten.
- **Werkzeug-Eigenheiten der Sitzung:** das Bash-Werkzeug verstümmelt „…“ und Rückstriche in Heredocs und
  in regulären Ausdrücken – längere Skripte und Texte als Datei schreiben und dann ausführen. Pythons
  `write_text` schreibt unter Windows CRLF; Dateien als Bytes lesen und schreiben und die Zeilenenden der
  Datei beibehalten. `git merge-tree … | head` verdeckt Konflikte – die Ausgabe ohne Pipe prüfen.
- **Ein Backend-Test scheitert nur im vollen Lauf unter Windows:**
  `test_media_scan_flow.py::test_blocked_public_upload_clears_avatar_and_settings_are_checked` endete am 5.10.
  einmal mit `PermissionError: [WinError 32]` – der Bau der kleineren Bildfassungen hält die Datei noch offen,
  während die Quarantäne sie verschiebt (unter Linux geht das Umbenennen trotzdem). Allein läuft der Test
  grün; kein Befund des PRs.
- **Unit-Tests mit nachgebauter Datenbank** (`FakeDb` in `test_dsgvo_competition_unit.py`): liest eine Route
  eine neue Sammlung, braucht die Attrappe sie auch – sonst `AttributeError: 'FakeDb' object has no attribute …`.
- **Firefox und WebKit:** der Check installiert nur Chromium (wie GitHub). Für die anderen in `frontend/`:
  `npx playwright install firefox webkit`, dann `CI=true E2E_WORKERS=2 E2E_EXTRA_BROWSERS=1 yarn test:e2e`.
  Mit mehr als zwei Workern hängen Firefox-Admin-Seiten bei „Lade …“ – das ist Last, kein Fehler; WebKit
  hat unter Windows einzelne wacklige Tests, die bei Wiederholung bestehen.

## 2. Git und GitHub

- **Schließwörter in Commit-Nachrichten:** ein „Fix“ direkt vor der Nummer
  eines anderen PRs schließt ihn beim Merge – so wurde PR #781 am 30.09.
  durch eine Commit-Nachricht von #773 geschlossen (wieder geöffnet, neu
  aufgesetzt). Vor fremden Nummern nie fix/fixes/fixed, close/closes/closed
  oder resolve/resolves/resolved schreiben; das deutsche „Schließt“ schließt
  nichts, jede Nummer braucht ihr eigenes `closes`.
- Heredoc-Skripte mit typografischen Anführungszeichen oder „…“ brechen die
  Shell – Issue-/PR-Texte mit dem Write-Werkzeug in eine Datei schreiben und
  `--body-file` nutzen.
- Nie Arbeit auf einem fremden Feature-Zweig beginnen; wenn doch passiert:
  `git rebase --onto main <alter-zweig> <neuer-zweig>`.
- **CI läuft nicht für Entwürfe** (`ci.yml`: `github.event.pull_request.draft == false`, Typen
  opened/synchronize/reopened/ready_for_review): gestapelte Entwurfs-PRs hatten deshalb nie CI. Erst
  der Sammel-PR #839 fand den F821 in `easter_routes.py`, die veraltete Abzeichen-Kunst und die
  Zählung im Adminmenü. Vor jedem Push `flake8 --select=E9,F63,F7,F82` wie im Backend-Job.
- **Squash-Merges und Stapel:** nach dem Squash der Basis kollidiert ein gestapelter PR überall, wo er
  Zeilen der Basis weiter ändert (Drei-Wege-Merge gegen den alten `main`). Will der Betreiber alles
  auf einmal mergen: die Squash-Merges paarweise simulieren (Konfliktbild), konfliktfreie PRs sofort,
  die Stapel samt kollidierender PRs als **einen** Sammel-PR (`git merge --no-ff` je Stapelspitze,
  `git rerere` an, damit spätere `main`-Merges die Lösungen wiederholen); ist die Basis schon
  gesquasht, die Konfliktdateien mit dem alten Basis-Stand als Bezug neu mergen (`git merge-file`).
- **Paralleles Einfügen an derselben Stelle:** zwei PRs, die je eine Zeile an dieselbe Stelle einfügen
  (etwa einen Import unter denselben Nachbarn), kollidieren beim zweiten Merge. Vor dem Push mit
  `git merge-tree --write-tree a b` gegen die offenen PRs prüfen und im zweiten PR eine andere Stelle
  nehmen (#870/#871). Dasselbe am Dateiende: hängen zwei PRs ihre Tests unten an dieselbe Datei an,
  kollidiert der zweite (#876/#878).
- **Frontend-Job: 40 Minuten** (seit #839): die Browser-Tests für Desktop und Handy laufen über
  21 Minuten; mit 25 Minuten brach GitHub den Job als „cancelled“ ab – das sieht aus wie ein fremder
  Abbruch. `concurrency: ci-${{ github.ref }}` bricht dagegen wirklich ab, sobald ein neuer Push kommt.
- **GitHub-CI läuft in UTC**, die Maschine hier in Wien: ein Test, der um
  Mitternacht einen Kalendertag erwartet, war lokal grün und in CI rot
  (#803). Erwartung mit demselben Helfer rechnen (`localDay`) statt mit
  festem Datum; vor dem Push `TZ=UTC node node_modules/jest/bin/jest.js …`
  (Node nimmt `TZ` auch unter Windows).
- **Schließwörter in deutschem Fließtext:** „Fix #N“ mitten in einem deutschen Satz schließt #N trotzdem.
  Texte mit „…“ an `gh` aus Python (`subprocess`) oder mit `--body-file` übergeben.
- **`git push` und `gh pr ready` nie im selben Aufruf** – auch nicht mit `sleep 12` dazwischen: der
  Workflow wertet den PR noch als Entwurf und überspringt jeden Job (21.09. #354, 23.09. #423 und #429).
  Erst pushen, in einem **späteren** Aufruf freigeben; zeigen die Jobs „skipping“, `gh pr ready --undo`,
  warten, `gh pr ready`.
- **Nach dem Merge weitergepusht:** ein Push auf einen Zweig, dessen PR schon gemergt ist, landet auf
  einem toten Zweig. `gh pr view N --json mergedAt` in einem **eigenen** Aufruf lesen (eine `&&`-Kette
  stoppt nicht); ist er gemergt, neuer Zweig ab `main` und `git cherry-pick`.
- **GitHub meldet „conflicting“ oder „dirty“, obwohl der Baum sauber ist** (nach Force-Push oder
  `git rebase --onto`): erst `git fetch` und `git merge-base --is-ancestor origin/main HEAD` prüfen; sitzt
  der Zweig sauber auf `main`, erzwingt ein leerer Commit die Neuberechnung.
- **Ein Job „scheitert“ nach 2 Sekunden und alle anderen werden übersprungen:** kein Code – der Grund
  steht in den Annotations des Check-Runs (`gh api repos/:owner/:repo/check-runs/<id>/annotations`; am
  21.09. war es die Abrechnung von GitHub).
- **PR-Nummern:** ein Issue des Betreibers kann die nächste Nummer wegschnappen. PR-Nummern erst in Doku
  schreiben, wenn `gh pr create` sie ausgegeben hat.
- **Meilenstein mit Datum:** `due_on` auf 12:00 UTC setzen, sonst zeigt GitHub den Vortag.
- **`jq` gibt es in dieser Git Bash nicht:** `gh … --json … --jq '…'` nehmen, keine `| jq`-Pipe.

- **Harter Absturz des PCs hinterlässt Null-Dateien (6.10.2026):** was in der letzten Minute vor dem Absturz geschrieben wurde,
  bestand danach nur aus Nullbytes – `.git/HEAD`, ein frischer Branch-Ref samt Reflog, ein geholter Remote-Ref und
  `mobile/src/whatsnew.json`; Git meldete „not a git repository“. Reparatur: `.git` (ohne `objects`) und frisch
  geschriebene Dateien auf reine Nullen prüfen, `.git/HEAD` als `ref: refs/heads/main` neu schreiben, genullte Refs und
  Logs löschen, `git fetch`, `git checkout -- <Datei>`, `git fsck`. Alles vor dem Absturz Gepushte war unversehrt – vor
  langen Builds oder Checks immer pushen.

## 3. Web

- **Vitest:** bei mehreren Treffern `getAllByText` statt `getByText`.
- **Tailwind und Saison-SVGs:** die Vorgabe `svg { max-width: 100% }` lässt
  ein SVG in einem 0 px breiten Halter (`.tls-hbats`, `.tls-ghosts`,
  `.tls-moon-sky` …) auf 0 zusammenfallen – Geister, Fledermäuse und der
  Mond waren so unsichtbar (28./29.09.). Für solche Halter `svg {
  max-width: none }` setzen und in der Browser-Probe die Breite messen.
- **Dateinamen nur in der Groß-/Kleinschreibung verschieden** (`scare.js`
  neben `Scare.jsx`) brechen Importe auf Windows: `./Scare` löst auf die
  Kleinschreibung auf, die Komponente ist `undefined` („Element type is
  invalid“). Deshalb `scareRules.js`.
- **Browser-Proben eines Zweigs:** der lokale Check lässt `frontend/dist`
  liegen – `npx vite preview --port 3011` in `frontend/`, Playwright mit
  `context.route("**/api/**")` und nachgestellten Antworten
  (`/seasonal/active` wie in `SeasonContext.test.jsx`, `/auth/me`,
  `/seasonal/me`), Skript aus dem Scratchpad mit
  `NODE_PATH=<repo>/frontend/node_modules`. Canvas-Ebenen über
  `getImageData` zählen. `page.clock.install()` fälscht auch
  `requestAnimationFrame`: nie `runFor(Stunden)` (spielt jeden Frame nach),
  sondern `setSystemTime` und dann `runFor(61000)` für einen Minutentakt.
  Der Consent-Klick ist die erste Geste – vorher messen, was „vor der
  Geste“ gelten soll, und die Klang-Engine erst laden lassen.
- **Saison-Hintergründe im Web:** `.tls-season-backdrop` (fixed, z-index 0)
  liegt ÜBER nicht positioniertem Inhalt, nur sehr durchsichtig. Wirklich
  dahinter liegt nur, was z-index −1 hat UND vor dem kein Hintergrund malt –
  deshalb malt seit #804 nur `<html>` das Schwarz. Eine spätere Regel
  `body { background }` in `index.css` hebt das wieder auf.
- **Animation auf `filter: blur()`:** ohne Grafikkarte (CI) rechnet der Browser die Unschärfe bei jeder
  Änderung der Deckkraft neu – das Atmen des Lichts hinter dem Löwen drückte den
  Schnee-Leistungstest von 60 auf 30 Bilder je Sekunde. Bewegte Leuchten als `radial-gradient` bauen;
  lokal ist das selbst mit `--disable-gpu` nicht nachzustellen.
- **Neuer Eintrag im Adminmenü:** `e2e/admin-navigation.spec.js` zählt mit (82 seit „Ostereiersuche“).
- **Paritäts-Seeds:** im Web heißt der Ort im `seasonSeed` `route`, in der
  App `screen`. Für gleiche Zufallsströme beide mit demselben Wert füllen
  (Winterhimmel: `route: "sky"` / `screen: "sky"`).
- **Vitest nur aus `frontend/`** (`node node_modules/vitest/vitest.mjs run --root .`): aus dem Repo-Stamm
  startet ein globales Vitest ohne jsdom.
- **Schein an SVG-Gruppen:** `filter: drop-shadow` auf einer inneren SVG-Gruppe ergibt einen rechteckigen
  Kasten – Schein nur über Verläufe oder auf dem ganzen SVG.
- **Browser-Probe einer WebAuthn-Seite:** der virtuelle Authenticator von Chromium beantwortet eine
  bedingte Anfrage sofort – in e2e-Tests `PublicKeyCredential.isConditionalMediationAvailable` auf `false`
  stellen (`frontend/e2e/passkeys.spec.js`).
- **Bildschirmfotos zum Ansehen:** höchstens 2000 px je Seite (keine `fullPage`-Aufnahmen langer Seiten);
  nach mehreren sehr großen Bildern nahm die Sitzung am 28.09. gar keine Bilder mehr an. Lieber messen
  (Kastenmaße, Überlappung, Pixelvergleich) und wenige Ausschnitte zeigen.
- **`vite preview` beenden:** unter Windows bleiben die node-Kinder am Port hängen und sperren den Ordner.
  Über den genauen Port finden (`Get-NetTCPConnection -LocalPort <port>`) und nur diese PID beenden – nie
  alle `node.exe`.

## 4. App

- **Worklets:** eine Funktion im Worklet kann keine Variable draußen setzen –
  sie bekommt eine Kopie (Wert außerhalb rechnen, wie `windX` im
  `RainField`). Funktionen, die je Bild laufen, tragen `"worklet"`; was sie
  aufrufen, auch.
- **Animated in der App:** `setValue()` stoppt die laufende Animation eines
  Werts – und `Animated.parallel` stoppt dann alle anderen. Ein
  Aufräum-Effekt beim Phasenwechsel brach so das Öffnen des Nikolausstiefels
  ab (#798): getrennte Werte für Dauer- und Klick-Bewegung, mit
  `Animated.add` verbinden.
- **Bewegung in der App auf Android:** bewegte Drehung und Skalierung an
  `react-native-svg`-Gruppen landen auf der Matrix der Android-Ansicht, deren
  Drehpunkt die Ecke der Zeichnung ist – `origin` geht verloren (Flammen
  flogen von links oben ein, der Schwanz der Katze wanderte, ihre Augen
  sprangen über den Kopf; so ausgeliefert in Build 82). Auch
  `transformOrigin` in Prozent war unzuverlässig (ein fest gedrehter Schwanz
  verschwand). Regel: jedes bewegte Teil als eigene `Animated.View`, deren
  Kasten **mittig auf dem Drehpunkt** sitzt (Android dreht und skaliert um
  die Mitte), darin ein kleines Svg mit `viewBox` um den Drehpunkt, nativer
  Treiber. Prüfen mit Signalfarben: fester Teil bei 0° rot, bei −12° grün,
  der bewegte gelb dazwischen.
- **Versteckte Elemente in App-Tests:** was unter
  `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"`
  liegt (Lämpchen, Lichterfolge), findet `getByTestId` nur mit
  `{ includeHiddenElements: true }`; `toHaveTextContent("…")` vergleicht den
  ganzen Text – für Teile einen regulären Ausdruck nehmen.
- **Zeitlimit in App-Tests auf GitHub:** der 2-Kern-Rechner ist langsam; der
  Netzbau-Test brauchte bis über 15 s, sobald mehr Testdateien parallel
  liefen (#795) – er hat jetzt 60 s. Tests nie in vielen kleinen
  `act()`-Schritten vorspulen, sondern Zeitpunkte aus dem festen Seed
  vorher ausrechnen und springen.
- **Mocks in App-Tests:** liefert ein `jest.mock` bei jedem Aufruf ein neues Nutzerobjekt, laufen Effekte
  mit dem Nutzer als Abhängigkeit endlos, bis Jest ohne Speicher abbricht – das Objekt einmal außerhalb
  anlegen (`mockAuth`, #877).
- **Jest und `import()`:** dynamisches `await import("…")` scheitert in Jest
  („dynamic import callback … --experimental-vm-modules“). Native Module
  lazy mit `require` in try/catch laden wie `src/lib/installSource.ts`.
- **expo-audio:** jeder Spieler legt eine Media3-Media-Session an
  („Media button session is changed to at.lionsquad.app“). `remove()` nimmt
  ihn nur aus der Liste des Moduls – Spieler und Session leben bis zur
  nächsten Speicherbereinigung weiter (6–8 s, so lange gehen die Tasten am
  Kopfhörer an die App). Nach dem Laut `remove()` und `release()`. Ohne
  Plugin-Optionen trägt das Paket Mikrofon und einen Dienst für Wiedergabe
  im Hintergrund ein – beides will Google erklärt haben.
- **Widgets im Dashboard-Kopf der App** müssen schmal bleiben (zwei Zeilen,
  Knöpfe als Symbol): ein breites Widget drückt den Namen in der
  Begrüßungskarte auf null Breite – die Karte wird riesig und leer (#803).
- **Neues Motiv im Web → App-Kunst nachziehen:** `npm run sync:badge-art` in `mobile/`, sonst schlägt
  `badgeArt.test.ts` an.
- **RNTL 14 ist asynchron:** `render`, `fireEvent` **und** `screen.unmount()` brauchen `await`, auch
  `act(async () => …)`. Ein vergessenes `await` meldet „render function has not been called“ oder
  „overlapping act() calls“ und kippt alle späteren Tests mit falscher Uhr. Unter jest-expo endet eine
  native `Animated.timing` sofort – Sichtbarkeit nie vom Ende einer Animation ableiten.
- **`Alert` nur mit Titel bleibt auf Android leer** – immer Titel und Text übergeben.
- **Tagesgrenzen in Tests:** eine Zeit um Mitternacht mit `+02:00` ist im UTC-Rechner von GitHub der
  Vortag. In Testdaten Mittagszeiten nehmen und vor dem Push `TZ=UTC node node_modules/jest/bin/jest.js
  <Datei>` laufen lassen.
- **Passkeys in der App:** der Server vergleicht die Herkunft aus `clientDataJSON` wörtlich; bei Android
  ist sie `android:apk-key-hash:<SHA-256 des Signaturzertifikats, base64url>`. Die Fassung aus Google Play
  trägt den Schlüssel von **Google** (Play App Signing), nicht den Upload-Schlüssel – beide müssen in
  `passkey_routes.DEFAULT_APK_KEY_HASHES` und in `assetlinks.json` stehen (#945). Den wahren Wert nennt das
  Server-Log (`[passkeys] … abgelehnt: Unexpected client data origin …`). Android 15 zeigt für
  `Passkey.get` ohne gespeicherten Passkey eine eigene Leiste – für stille Abfragen
  `Passkey.getImmediate`. Scheitert das Anlegen erst am Server, bleibt der Passkey trotzdem im
  Passwortmanager des Handys liegen (verwaist) und wird beim nächsten Anmelden angeboten.
- **Sprünge zwischen Tabs:** `navigate(tab, { screen, params })` ohne `initial: false` legt den Zielschirm
  als einzigen in den Tab – „zurück“ und der Tab-Knopf führen dann nirgends hin.
- **Module, die die Navigation einbinden:** importiert eine Saison-Komponente `rootNavigation`, kippen
  fremde Test-Suiten (so bei `HuntEgg`); dort `navigation.navigate("Login" as never)` nehmen.

## 5. Emulator und Sichtproben der App

- **Sichtprobe der App im Emulator** (AVD `tls`, ohne Fenster): Uhr über
  `adb root`, `settings put global auto_time 0`,
  `setprop persist.sys.timezone Europe/Vienna`, `adb shell date
  MMDDhhmmYYYY.ss`; Backend als Probe-Server (echte App, mongomock,
  freezegun auf dem Zeitpunkt, Port 8010) und Metro mit
  `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8010`, `adb reverse tcp:8081
  tcp:8081`. Für neue native Module einen Debug-Build in `mobile/`
  (`android/` und `google-services.json` stehen in `mobile/.gitignore`):
  `google-services.json` aus `%USERPROFILE%\.lionsapp-release` kurz
  hineinkopieren, `expo prebuild --platform android --no-install`,
  `gradlew assembleDebug` (etwa 5 min), die Datei danach wieder löschen;
  am Ende `adb kill-server`, sonst hält der adb-Server seinen Startordner
  fest. Aufnahmen mit `adb shell
  screenrecord`, Bilder mit ffmpeg; Git Bash braucht `MSYS_NO_PATHCONV=1`
  für `/sdcard/…` und Windows-Pfade für das Ziel von `adb pull`.
- **Metro im CI-Modus** (`CI=1` in den Probe-Skripten) beobachtet keine
  Dateien: nach jeder Änderung während einer Sichtprobe Metro über den Port
  neu starten, sonst lädt die App den alten Stand. Ein eigener Abruf des
  Bundles mit anderen Parametern baut neu und täuscht frischen Code vor
  (#797).
- **Metro liefert alten Stand:** nach Zweigwechseln oder Änderungen an
  Modulen ohne Komponente lieferte Metro (Expo CLI, CI=1) auch mit `--clear`
  alte Dateien. Abhilfe: Metro über den Port 8081 beenden
  (`Get-NetTCPConnection -LocalPort 8081`), `%TEMP%\metro-cache` und
  `%TEMP%\metro-file-map-expo-*` löschen, neu starten, ein frisches Bundle
  holen (alte Datei vorher löschen, HTTP-Code prüfen) und ein Merkmal darin
  suchen, bevor man einem Bildschirmfoto traut.
- **Uhr im Emulator zurückstellen:** Android hält API-Antworten nach
  `Cache-Control` (Saisons 60 s) in `cache/http-cache`. Steht die Uhr danach
  vor dem `Date` der Antwort, gilt sie als frisch – die App zeigt die
  Saisonen eines anderen Tages. Vor dem Neustart `adb shell run-as
  at.lionsquad.app rm -rf cache/http-cache`. Kein Fehler der App.
- **Sichtprobe im Emulator:** `uiautomator dump` scheitert, solange etwas
  dauernd animiert („could not get idle state“) – Koordinaten aus dem
  Bildschirmfoto nehmen.
- **Die Release-APK startet im Emulator nicht:** sie ist nur für ARM gebaut, der Emulator ist x86_64 –
  Absturz mit „couldn't find DSO to load: libreactnative.so“. Kein Fehler der App. Für eine Probe des
  Release-Builds (R8, ohne Metro) eine eigene Fassung im Build-Worktree bauen: in `C:\lsb\mobile\android`
  `gradlew assembleRelease --no-daemon -PreactNativeArchitectures=x86_64`, signiert mit dem
  Debug-Schlüssel (`ORG_GRADLE_PROJECT_TLS_UPLOAD_*`), `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8010`,
  Klartext-Verkehr erlaubt, `google-services.json` nur während des Builds im Ordner. Vorher
  `app/build/generated/{assets,res,sourcemaps}/react` löschen – Gradle nimmt sonst das alte JS-Bundle und
  die App spricht weiter mit der Produktion. Gegenstelle ist der Probe-Server (echte Anwendung, mongomock,
  Port 8010, Passkeys über `FRONTEND_URL`). AVDs: `tls` (Handy) und `tls-tablet`.
- **Nach einer Probe vor dem echten Release** die Metro-Caches leeren (`%LOCALAPPDATA%\Temp\metro-cache`,
  `metro-file-map-expo-*`): die Probe-Builds haben `10.0.2.2` ins Bundle geschrieben. Im fertigen APK und
  AAB `assets/index.android.bundle` nach `https://lionsquad.at` durchsuchen.
- **Zugangsdaten des Probe-Servers** (`login.json` im Scratchpad) nach der Probe löschen.

## 6. Dienste: Cloudflare, Dolibarr, Discord, Google Play

- **Cloudflare vor lionsquad.at:** höchstens 100 MB je Anfrage – größere
  Uploads enden mit HTTP 413, auch von Hand im Admin. Die Release-APK bleibt
  deshalb ohne x86/x86_64 (#793).
- **Dolibarr-Dokumente über REST (#840):** die Freigabe (`validate`) baut kein PDF – erst
  `PUT /documents/builddoc` (`modulepart`, `original_file` = `REF/REF.pdf`, `doctemplate`, `langcode`;
  braucht das Recht `facture->creer`). `GET /documents` ist die **Liste** (braucht `id` oder `ref`), die
  Datei kommt über `GET /documents/download`. Ohne `langcode` baut Dolibarr in `MAIN_LANG_DEFAULT` – steht
  das auf „auto“, wird es über die Schnittstelle `en_US`.
- **Discord-Rollen erwähnen:** `allowed_mentions` lässt nur die gewählte Rolle zu, und Discord pingt eine
  Rolle nur, wenn sie in den Servereinstellungen „erwähnbar“ ist (sonst steht der Name ohne Ping da).
- **Google Play, Fehler „Berechtigung REQUEST_INSTALL_PACKAGES noch nicht erklärt“:** kommt von einem alten
  Build (78), der noch in einem aktiven Release oder Track liegt, nicht vom neuen Bundle. Den alten Build
  aus dem Entwurf nehmen; die Erklärung nie ausfüllen.
- **Google Play und die Zuordnung (mapping):** sie steckt im App-Bundle (`BUNDLE-METADATA/…/proguard.map`) –
  ein eigener Upload der `mapping.txt` ist beim Hochladen eines AAB nicht nötig.
- **Server hinter zwei Proxys** (Nginx Proxy Manager und Cloudflare): ohne `TRUSTED_PROXY_CIDRS` und
  `real_ip_header CF-Connecting-IP` tragen alle Sitzungen dieselbe Adresse, und jede Bremse je Adresse gilt
  für alle gemeinsam (#941).

## 6./7. Oktober 2026 – Oberflächen-Pakete

- **Unschärfe am Kopf sperrt feste Fenster ein.** `backdrop-filter` (wie `transform`) macht ein Element zum
  Bezugsrahmen für `position: fixed`-Nachfahren. Die Suche im Kopf öffnete ihr Vollbild-Fenster, das aber nur die
  80 px der Kopfleiste abdeckte. Seit #1086 liegt die Unschärfe auf einer eigenen Fläche im Kopf; die Zeile rückt beim
  Kompaktwerden über `top`, nicht über `transform`.
- **Handy-Menü als Block im Fluss.** Es vergrößerte den Kopf um die Menühöhe; Saison-Deko, die an der Kopfzeile hängt,
  wanderte mit und lag neben dem Menü frei (Oster-Test). Jetzt eine `absolute`-Auflage unter der Leiste.
- **Playwright-Projekt „mobile“ hat `hover: none`.** Hover-Regeln in `@media (hover: hover)` gelten dort nicht;
  Browser-Tests, die Hover prüfen, verzweigen über `matchMedia("(hover: hover)")`.
- **Windows-Checkout ist CRLF.** Ein Test, der `index.css` liest und `"}\n}"` sucht, fiel nach dem Checkout von `main`
  um – Dateien in Tests mit `.replace(/\r\n/g, "\n")` normalisieren.
- **Gestapelte PRs nach Squash-Merge.** `git rebase` des nächsten Zweigs auf `origin/main` kollidiert mit dem Squash
  (dieselben Änderungen, andere Commits). Stattdessen den Baum des Zweigs auf `main` setzen:
  `git commit-tree <zweig>^{tree} -p origin/main -F msg.txt`, dann `git branch -f <zweig> <neu>`, Force-Push mit
  `--force-with-lease`, `gh pr edit --base main`. Vorher prüfen: `origin/main^{tree}` muss gleich dem Baum des alten
  Basis-Commits sein. Mit Prozess-Substitution (`-F <(…)`) scheitert Git Bash – Nachricht in eine Datei schreiben.
- **Heredocs im Bash-Werkzeug.** Mehrzeilige Dateien mit Backticks und Anführungszeichen (JS-Templates) brachen
  beim Schreiben per Heredoc ab („unexpected EOF“). Dateien mit dem Write-Werkzeug anlegen und per `cp`/Python
  einspielen.
- **Zwei lokale Checks gleichzeitig.** Ein versehentlich zweites `local_check.py` (gestartet, während das erste lief)
  teilt sich Port 3105 und die Logs – nur über die Prozess-ID beenden (`Stop-Process -Id`), nie über den Namen.

## 7. Oktober 2026 – Discord-Anmeldung, Saison-Reaktionen, Werkzeuge

- **Vitest, ESLint, Playwright von Hand mit Node 22** (`~/.local-toolchain/node-v22.23.2-win-x64`; `frontend/package.json`
  verlangt ≥ 22.22.2). Mit Node 20 stirbt der Vitest-Fork-Worker mit „webidl.util.markAsUncloneable is not a function“
  und meldet „no tests“.
- **Vitest-Worker startet einmal nicht** („Failed to start forks worker … SyntaxError: Invalid or unexpected token“ beim
  Laden von jsdom): ein Zufall beim Prozessstart, die Datei ist heil. Der zweite Lauf ist grün – nicht am Code suchen.
- **CodeQL `py/cyclic-import` zählt auch Importe in Funktionen.** Ein Zyklus über verzögerte Importe (Anmeldung ↔ Bot ↔
  Befehle ↔ Ankündigungen) erscheint als Hinweis am PR. Auflösen mit Blättern ohne Rückimporte
  (`discord_texts.py`, `discord_registration_rules.py`); die verknüpfte Person direkt aus `platform_links` lesen statt
  über den Bot.
- **Discord-Knöpfe mit Kennung** (`custom_id`) als `discord.ui.DynamicItem` mit `client.add_dynamic_items(...)`:
  Discord schickt die Kennung mit jedem Klick, die Knöpfe funktionieren so auch nach einem Neustart des Bots. Die
  Vorlage (`template`) muss die ganze Kennung treffen (`fullmatch`).
- **Gehobene Karten messen** (`seasons/anchors.rectOf`): `getBoundingClientRect` enthält das Anheben (`translateY(-5px)`).
  Wer während des Anhebens misst, setzt Deko doppelt hoch – `rectOf` rechnet die Verschiebung von `.tls-card` heraus,
  die Deko fährt per CSS mit (`data-season-lifted`, Eigenschaft `translate`, damit `transform` frei bleibt).
- **Zeitmess-Test Schnee auf GitHub:** `snow-regression.spec.js` (Bildabstand unter 25 ms) reißt auf einem langsamen
  GitHub-Rechner (Lauf über 20 Minuten); lokal grün. Den Job neu starten (`gh run rerun <id> --failed`), nicht die Grenze
  senken.
- **Git Bash: `a && b && (c) &`** schickt die ganze Kette in den Hintergrund, nicht nur `(c)` – die Ausgaben von `a` und
  `b` gehen verloren. Hintergrund-Starts in einen eigenen Aufruf.
- **Objekt-Ref an spät erscheinenden Elementen:** Ein Effekt mit `ref.current` läuft beim ersten Aufbau – zeigt die
  Seite da noch „Lade …“, ist die Ref leer und der Effekt hängt nie an (so die Profil-Neigung bis #1078). Für
  Verhalten an einem Element, das erst nach dem Laden erscheint, eine Callback-Ref (`useState`-Setter) nehmen.
- **Klassen zusammenkleben:** `` `${base}tls-btn tls-btn--primary` `` ohne Leerzeichen macht aus dem letzten Wort von
  `base` und `tls-btn` ein Wort – die Grundklasse fehlt, nur die Variante greift. Prüfen mit
  `grep -rno '[}a-zA-Z0-9]tls-btn' frontend/src`.
- **ESLint-Unterdrückungen:** Wird ein unterdrückter Fund behoben, bricht `eslint .` mit Code 2 ab („suppressions
  left that do not occur anymore“). `npm run lint:prune` (`eslint . --prune-suppressions`) nimmt die alten Einträge
  heraus.
- **`role="dialog"` mit `onClick`** meldet jsx-a11y (`no-noninteractive-element-interactions`). Klick daneben über eine
  eigene, unsichtbare Ebene hinter dem Inhalt (`aria-hidden`), die Bühne davor mit `relative`.
- **View Transitions mit `BrowserRouter`:** Der Router startet selbst keine. `UNSAFE_NavigationContext` liefert die
  History; nur `navigator.push` in `document.startViewTransition` legen (Links mit `state`/`replace` navigieren weiter
  selbst) und das neue Bild erst freigeben, wenn die Seite steht (Layout-Effekt nach `ScrollManager`). Die
  Login-Seiten haben kein `main#main-content`.
- **Patch-Skripte, die mittendrin abbrechen,** haben die Dateien davor schon geschrieben – Umwandlungen deshalb so
  bauen, dass ein zweiter Lauf schon Umgestelltes überspringt.
- **Python 3.11:** In f-Strings darf im Ausdruck kein Backslash stehen (`re.sub(r'\s+', …)` erst vorher berechnen).

## 7. Oktober 2026 (Abend) – TV, GitHub-Prüfung, gestapelte Zweige

- **Push und „Ready“ in derselben Sekunde:** GitHub startet für den Push keinen Lauf (CI „skipped“, CodeQL
  abgebrochen). Nach dem Push warten, bis der Lauf da ist, dann `gh pr ready`. Nachstarten mit einem leeren Commit
  (`git commit-tree <zweig>^{tree} -p <zweig> -m …`, Zweig darauf setzen, pushen).
- **Gestapelter Zweig, wenn `main` inzwischen weitere Merges hat:** Das `commit-tree`-Rezept auf `origin/main` würde
  die anderen Merges zurückdrehen. Dann `git rebase --onto origin/main <alte-basis> <zweig>` – nur die eigenen Commits
  wandern mit.
- **Linux-Schriften sind breiter:** Auf GitHub fehlt Inter; die Ersatzschrift braucht mehr Platz, Layout-Tests mit
  knappen Maßen kippen nur dort. Lokal nachstellen mit einer eingeschobenen Regel
  `* { font-family: Verdana, 'DejaVu Sans', sans-serif !important; }`. Tests, die „liegt im sicheren Bereich“ prüfen,
  messen nur, was der sichtbare Rahmen zeigt (`.tv-viewport` schneidet im Kamera-Modus bewusst ab).
- **Zeit-Tests auf GitHub:** Feste Millisekunden-Grenzen hängen am Rechner des Tages (gleiche Seite 16,7 ms oder
  26,8 ms je Bild). Auf GitHub im selben Lauf eine Vergleichsmessung ohne den geprüften Teil machen und das
  Verhältnis prüfen (`e2e/snow-regression.spec.js`); feste Grenzen nur am PC.
- **Browser-Tests in Teilen:** `yarn test:e2e --shard=N/4` verteilt nach Dateien. Ein Teil, der allein rot wird, lässt
  sich lokal mit demselben `--shard` nachstellen. `fail-fast: false`, damit ein roter Teil die anderen nicht abbricht.
- **„Update branch“ und Push mit „Internal Server Error“:** Am 7.10. lehnte GitHub eine Viertelstunde lang jede
  Änderung am Repo ab (Statusseite grün, Lesen ging). Nicht umbauen – später erneut pushen. Laufende Prüfungen vorher
  fertig laufen lassen: Ein Push bricht den alten Lauf ab (`concurrency` mit `cancel-in-progress`).

## 7. Oktober 2026 (Nacht) – vier Ordner, Release-Ordner, Uhrzeit

- **Vier Arbeitsordner gleichzeitig:** Haupt-Checkout, `C:\lsb`, `C:\lsc` und `C:\lsd` sind Worktrees desselben
  Repos. Seit #1301 hat jeder Ordner eine eigene Test-Datenbank und ein eigenes Compose-Projekt; höchstens zwei
  lokale Checks gleichzeitig (Rechenzeit), die Container-Gruppe nur in einem Ordner (feste Ports). Vor dem Start
  zählen: `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like
  '*local_check.py*' }`. Ein neuer Ordner braucht echte `node_modules` (kopieren, keine Verknüpfung) und eine venv
  unter `~/.local-ci/<Ordnername>/venv`.
- **Release, während `C:\lsb` arbeitet:** `LIONSAPP_BUILD_DIR=C:/lsbrel npm run release:local -- --aab` baut in einem
  anderen Worktree; danach `git worktree remove --force C:/lsbrel` (es blockiert nur die Bau-Marke
  `.lionsapp-build`). Der Haupt-Checkout muss trotzdem sauber auf `main` = `origin/main` stehen.
- **Tests mit Uhrzeit:** Ein Test, der „jetzt“ aus der echten Uhr nimmt, wird zu bestimmten Tageszeiten rot
  (`EventTVPage.test.jsx`). Uhr einfrieren: `vi.useFakeTimers({ toFake: ["Date"] })` und `vi.setSystemTime(…)`,
  im `afterEach` `vi.useRealTimers()`.
- **`apt-get update` hängt auf GitHub:** Ein schweigender Ubuntu-Spiegel hielt `npx playwright install --with-deps`
  25 Minuten fest, bis der Teil abbrach. Seit #1299: kurze apt-Zeitlimits, drei Versuche mit `timeout`, hängende
  apt-Prozesse beenden.
- **Uhrzeit in Git Bash:** `TZ=Europe/Vienna date` zeigt UTC (MSYS kennt die Zonen nicht). Die Uhr des Betreibers
  liefert PowerShell `Get-Date`.
