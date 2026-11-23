# Prüftor: Barrierefreiheit, Kontrast, Bundle, Ladezeit, Bewegung

Jeder PR mit sichtbaren Änderungen muss das Prüftor bestehen (#1660). **Rot heißt nicht mergen.** Eine Ausnahme
gibt es nur mit Begründung im PR-Text.

„Sichtbar“ heißt: Der PR berührt den Bereich `frontend` laut
[`scripts/ci-changed-areas.py`](../../scripts/ci-changed-areas.py) – also alles unter `frontend/` außer
Markdown, Compose- und Env-Vorlagen sowie Änderungen an `.github/`. Markdown zählt sonst nur zur Linkprüfung;
`frontend/PERFORMANCE_BUDGETS.md` ist die Ausnahme, weil das Tor seine Grenzen daraus liest
(`PRUEFTOR_MARKDOWN`) – wer nur eine Grenze anhebt, läuft trotzdem durchs Tor. Die übrigen Listen des Tors
(`motion-rules-allowlist.json`, `e2e/prueftor-bekannt.json`) liegen unter `frontend/` und zählen ohnehin dazu.

## Was geprüft wird

| Prüfung | Woraus | Rot, wenn |
| --- | --- | --- |
| Barrierefreiheit (`a11y`) | [`a11y-pages.spec.js`](../../frontend/e2e/a11y-pages.spec.js) (Turnier, Match, Event, Dashboard, Einstellungen, FAQ: axe, Tippflächen 44 px, 200 %), [`prueftor-a11y.spec.js`](../../frontend/e2e/prueftor-a11y.spec.js) (Startseite, Turniere, Events, News, Anmelden, Registrieren, Mitglied werden: axe und Tastatur) | ein schwerer axe-Fund (WCAG 2.1 A/AA), eine zu kleine Tippfläche, Querlauf bei 200 %; über Tastatur: erster Tab nicht „Zum Inhalt springen“, ein Ziel ohne sichtbaren Fokus oder ohne Namen, Fokus geht verloren oder hängt fest, Umschalt+Tab führt nicht zurück |
| Kontrast (`kontrast`) | [`check-contrast.js`](../../frontend/scripts/check-contrast.js) (Farbpalette) und die Tests mit „Kontrast“ im Titel (axe `color-contrast` auf allen Seiten oben) | eine Kombination unter WCAG AA (4,5 : 1, große Schrift 3 : 1) |
| Bundle (`bundle`) | [`check-bundle-budget.mjs`](../../frontend/scripts/check-bundle-budget.mjs), Grenzen in [`PERFORMANCE_BUDGETS.md`](../../frontend/PERFORMANCE_BUDGETS.md) | Start-JS oder Start-CSS über der Grenze, Editor/Diagramme/PDF/QR im Start, Video im Start |
| Ladezeit (`ladezeit`) | [`prueftor-ladezeit.spec.js`](../../frontend/e2e/prueftor-ladezeit.spec.js) (Startseite am Handy), [`no-layout-jump.spec.js`](../../frontend/e2e/no-layout-jump.spec.js) | LCP (Median aus drei kalten Läufen) oder CLS über der Grenze in `PERFORMANCE_BUDGETS.md`, ein Layout-Sprung |
| Bewegungsregeln (`bewegung`) | [`check-motion-rules.mjs`](../../frontend/scripts/check-motion-rules.mjs) (statisch), [`ui-motion.spec.js`](../../frontend/e2e/ui-motion.spec.js) | ein neuer Verstoß gegen die Regeln unten |

Gelockerte Regeln zählen wie rot, solange der PR-Text sie nicht begründet: eine höhere Grenze in
`PERFORMANCE_BUDGETS.md` (`<!-- budget:… -->`), mehr Ausnahmen in
[`motion-rules-allowlist.json`](../../frontend/motion-rules-allowlist.json) oder neue Einträge in
[`prueftor-bekannt.json`](../../frontend/e2e/prueftor-bekannt.json) als auf `main`.

### Bekannte Funde bei Barrierefreiheit und Kontrast

Funde aus der Zeit vor dem Tor stehen je Seite, Art (`a11y`, `tastatur`, `kontrast`) und Element mit Begründung in
`frontend/e2e/prueftor-bekannt.json`. Die Tests lassen genau diese durch, jeder andere Fund ist rot – auch derselbe
Fehler auf einer anderen Seite oder an einem anderen Element. Wer einen behebt, streicht ihn aus der Liste. Die Liste
soll schrumpfen; sie ist kein Ort für neue Funde.

Ein Ziel trägt seinen Bereich: `color-contrast: [Fuß] a[data-testid="footer-imprint"]`. Bereiche sind `Fuß`
(`<footer>`), `Navigation` (`<nav>`), `Kopf` (`<header>`) und `Inhalt`. Seite `"*"` (gilt auf jeder Seite) ist nur
für `[Fuß]` und `[Navigation]` erlaubt – ein allgemeiner Selektor im Inhalt würde sonst überall Funde verdecken.

### Bewegungsregeln

Entscheidung vom 15.10.2026: Bewegt wird über `transform` und `opacity`, „Bewegung reduzieren“ wird beachtet,
Dauern und Kurven kommen aus den Tokens (`--tls-motion-fast|mid|slow`, `--tls-motion-count|glow`,
`--tls-ease`, `--tls-ease-move` in `index.css`; `MOTION`, `EASE_MOVE`, `MICRO` in `lib/motion.js`;
Tailwind `duration-fast|mid|slow` und `ease-tls`). Die Prüfung liest alle CSS-, JS- und JSX-Dateien unter
`frontend/src` (ohne Tests) und kennt vier Regeln:

| Regel | Meldet | Erlaubt |
| --- | --- | --- |
| `layout-property` | Übergänge oder Keyframes auf Breite, Höhe, Lage (`top` …), Abstände, Schriftgröße, `gap`; `transition: all`, `transition-all`, Kurzform ohne Eigenschaft; framer-motion `animate={{ height }}` | `transform`, `opacity`, Farben, Schatten, Filter |
| `reduced-motion` | CSS-Animation mit fester Dauer ohne Gegenstück in einem `prefers-reduced-motion: reduce`-Block der Datei (oder global in `index.css`); Tailwind `animate-*` ohne `motion-safe:`/`motion-reduce:`; framer-motion `repeat: Infinity` und `element.animate()` in Dateien, die „Bewegung reduzieren“ nirgends abfragen | Animationen mit Token-Dauer (der zentrale Block in `index.css` stellt sie ab), `animate-spin` (Ladeanzeige) |
| `token-duration` | feste Dauern: `300ms` in CSS, `duration-300`, framer-motion `duration: 0.3` | Tokens, `0s` |
| `token-easing` | feste Kurven: `ease-in-out`, `cubic-bezier(…)`, Tailwind `ease-out`, framer-motion `ease: "easeOut"` oder `[0.4, 0, 0.2, 1]` | Tokens, `linear`, `steps()` |

Statisch heißt: Varianten-Objekte von framer-motion (`variants={…}`) und Werte, die erst zur Laufzeit entstehen,
sieht die Prüfung nicht. Die Laufzeit prüft `ui-motion.spec.js`.

**Bestand:** Alle Verstöße von vor dem Tor stehen je Datei und Regel mit Zahl und Begründung in
`motion-rules-allowlist.json` – der Code wurde dafür nicht umgebaut. Rot wird eine Datei erst, wenn sie **mehr**
Verstöße einer Regel hat als erlaubt. Rot ist auch **Luft**: Erlaubt die Liste mehr, als es gibt (jemand hat
aufgeräumt), muss sie im selben PR mitsinken – sonst kämen später unbemerkt neue Verstöße bis zur alten Zahl dazu.
Wer aufräumt, senkt die Liste:

```bash
cd frontend
node scripts/check-motion-rules.mjs            # prüfen
node scripts/check-motion-rules.mjs --diff-base origin/main   # neue Funde (geänderte Zeilen) zuerst nennen
node scripts/check-motion-rules.mjs --tighten  # Ausnahmeliste auf den Ist-Stand senken (erhöht nie)
```

Derselbe Wächter läuft als Vitest-Test ([`src/lib/motionRules.test.js`](../../frontend/src/lib/motionRules.test.js))
auch in den Frontend-Unit-Tests und lokal mit `yarn test`.

## Ausnahme begründen

Eine Zeile je Prüfung in den PR-Text, nicht in einen HTML-Kommentar (`<!-- … -->` zählt nicht), Begründung
mindestens 20 Zeichen. Die Prüfung heißt `a11y`, `kontrast`, `bundle`, `ladezeit` oder `bewegung`:

```text
Prüftor-Ausnahme bewegung: Der Fortschrittsbalken wächst in der Breite, weil sein Text mitläuft (#1234).
```

Danach im PR unter **Checks** den Job **Prüftor** neu starten („Re-run“) – er liest den PR-Text bei jedem Lauf
frisch. Die Prüfung steht dann im Kommentar als **Ausnahme** samt Begründung, das Tor ist offen. Bei einer neuen
Ausnahme für die Bewegungsregeln gehört der Eintrag zusätzlich mit Begründung in `motion-rules-allowlist.json`; bei
einer neuen Grenze die Zeile in `PERFORMANCE_BUDGETS.md`.

## Der Kommentar im PR

Das Tor schreibt **einen** Kommentar (erkennbar an `<!-- prueftor:1660 -->`) und aktualisiert ihn bei jedem
neuen Lauf. Er zeigt je Prüfung das Ergebnis, die Werte dieses PRs und die von `main`: Bundle in Bytes, LCP und CLS,
Zahl der Bewegungs-Verstöße. Die Werte von `main` stammen aus dem letzten Lauf des Tors auf `main` (Artefakt
`prueftor-main`, 90 Tage aufbewahrt). Dasselbe steht in der Zusammenfassung des Laufs.

## Aufbau in der CI

In [`ci.yml`](../../.github/workflows/ci.yml):

- **Prüftor** läuft neben „Frontend“, sobald der Bereich `frontend` berührt ist: Bewegungsregeln und Palette
  (statisch, Sekunden), Bau (wenige Sekunden – billiger als `dist` als Artefakt zu verschieben), Bundle-Messung,
  Browser-Tests gegen das gebaute `dist` ([`playwright.prueftor.config.js`](../../frontend/playwright.prueftor.config.js),
  Server [`serve-dist.mjs`](../../frontend/scripts/serve-dist.mjs) mit gzip wie nginx), danach die Ladezeit allein mit
  einem Worker. [`prueftor.mjs`](../../frontend/scripts/prueftor.mjs) fasst alles zusammen und entscheidet.
  Yarn- und Browser-Cache sind dieselben wie in den Browser-Teilen.
- Die Specs aus [`e2e/prueftor-specs.js`](../../frontend/e2e/prueftor-specs.js) laufen **nur** im Tor; die
  Browser-Teile lassen sie mit `E2E_OHNE_PRUEFTOR=1` aus. Nichts läuft doppelt. Lokal laufen sie mit
  `yarn test:e2e` wie bisher mit, außer der Ladezeit (die misst nur gegen `dist` sinnvoll).
- **Prüftor-Kommentar** schreibt den Kommentar. Erwartete Dauer des Tors: 4–6 Minuten (Einrichten gut
  1 Minute, Browser-Tests 2–3 Minuten, Ladezeit gut 1 Minute).
- „CI-Ergebnis“ wartet auf das Tor – rot blockiert den Merge.

**Sicherheit:** Das Tor läuft auf `pull_request`, nie auf `pull_request_target`. Der Job, der Code aus dem PR baut und
ausführt, hat nur Leserechte (`contents`, `pull-requests`, `actions`) und legt keine Zugangsdaten im Checkout ab
(`persist-credentials: false`). Schreibrecht (`pull-requests: write`) hat nur „Prüftor-Kommentar“: kein Checkout,
kein Code aus dem PR, er postet nur das Markdown aus dem Ergebnis-Artefakt; Text aus dem PR (Begründungen) wird
darin entschärft (keine Erwähnungen, kein HTML). Bei PRs aus Forks läuft der Kommentar-Job nicht (der Token hätte
dort ohnehin kein Schreibrecht); das Ergebnis steht dann in der Zusammenfassung des Laufs.

## Lokal

```bash
cd frontend
yarn check:motion                       # Bewegungsregeln
yarn check:contrast                     # Palette
yarn build && yarn check:bundle         # Bundle-Budget
yarn test:prueftor --project=chromium   # Barrierefreiheit, Kontrast, Bewegung gegen dist
yarn test:prueftor --project=ladezeit --workers=1   # Ladezeit (gebremst wie in der CI)
```

Die Ladezeit am eigenen Rechner ist schneller als auf dem CI-Rechner (vierfach gebremste CPU auf schnellerer
Hardware); maßgeblich ist der Wert im Kommentar. Ziel und Grenze stehen in `PERFORMANCE_BUDGETS.md`
(`home-mobile-lcp-ms`, `home-mobile-cls-milli`).
