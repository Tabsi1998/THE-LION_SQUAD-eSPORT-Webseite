# Design-System: Bewegung, Wischleisten, Puls

Kurz für spätere Arbeiten an der Website (#1969). Farben stehen als Rollen in `frontend/src/styles/system.css`
(Wächter: `lib/categoryColors.test.js`), Bewegung in `frontend/src/lib/motion.js` und `frontend/src/index.css`
(Wächter: `lib/motion.test.js`).

## Bewegung

### Werte (Tokens)

Eine Stelle für alles – JS und CSS werden vom Test gleich gehalten:

| Wert | JS (`lib/motion.js`) | CSS (`index.css`) | Wofür |
|---|---|---|---|
| 150 / 240 / 420 ms | `MOTION.fast/mid/slow` | `--tls-motion-fast/-mid/-slow` | Rückmeldung, Zustandswechsel, größere Wege |
| Kurve | `MOTION.ease` | `--tls-ease` | Ein- und Ausblenden |
| 900 ms | `MICRO.count` | `--tls-motion-count` | Hochzählen (ease-out) |
| 25 ms | `MICRO.countStagger` | – | Versatz je Zeile beim Hochzählen in Tabellen |
| 50 ms, 12 Einträge | `MICRO.stagger`, `MICRO.staggerMax` | `--tls-stagger-step` | Gestaffeltes Erscheinen |
| 840 ms | `MICRO.glow` | `--tls-motion-glow` | Kurzes Aufleuchten |

„Bewegung reduzieren“ stellt im CSS alle Dauern auf 0 und `--tls-motion-on` auf 0; die Bausteine fragen zusätzlich
`motionAllowed()` und zeigen sofort den Endwert.

### Bausteine (`components/tls/motion/`)

- **`CountUp`** – der eine Baustein zum Hochzählen (Zahlen, Zeiten „1:28,783“, Abstände „+0,359“). Zählt beim ersten
  Sichtbarwerden von null oder vom alten Wert (`from`), feste Ziffernbreite, Screenreader hören nur den Endwert.
  Eine Zahl als Wert nimmt `format` (etwa `formatCount` aus `lib/countUp.js` für „1.234“). Neuer `playKey` spielt neu
  ab (Reiterwechsel). Beim Live-Nachladen zählt nichts neu, der geänderte Wert leuchtet einmal auf (`flash`, abschaltbar,
  wenn die Zeile schon hervorgehoben wird). Ohne `matchMedia` (Tests) steht der Wert sofort. `LapTime` (Fast Lap) ist
  nur eine dünne Hülle darum – es gibt keine zweite Zähl-Schleife (Wächter in `motionBlocks.test.jsx`).
- **`StaggerIn`** – Liste oder Tabelle (`as="ul"`, `"tbody"` …) steigt beim ersten Sichtbarwerden gestaffelt auf, nur
  die ersten zwölf Einträge; danach ist Ruhe, neue Einträge stehen ohne Bewegung da.
- **`Glow`** – einmal aufleuchten: `active` beim ersten Zeichnen (mit `delay`), `trigger` bei jeder Änderung danach.
  Farben über `tone`: brand, honor, ok, pole, fastest. Bewegt wird nur die Deckkraft eines Scheins.
- **`Press`** – Karten heben sich unter der Maus um 2 px und geben beim Drücken nach (97 %); `lift={false}` für Chips.
  Knöpfe (`tls-btn`) haben das schon.

### Wann einsetzen

- Zahlen, die etwas erzählen (Punkte, Plätze, Zeiten, Kennzahlen) – nicht in Formularen und kaum in der Verwaltung.
- Listen beim ersten Auftritt, nicht bei jedem Filtern.
- Live-Daten: nie neu zählen, höchstens die Änderung kurz hervorheben.
- Nur `transform`, `opacity` und Text bewegen. 60 Zeilen bleiben flüssig: `CountUp` schreibt die Zwischenstände
  direkt in den Text, ohne React-Durchlauf je Bild.

## Wischleisten (`tls-swipe`)

Jede waagrechte Wischfläche trägt `tls-swipe` statt `overflow-x-auto` (Wächter: `styles/swipe.test.js`):

- Dünne Cyan-Leiste auf dunkler Spur, nie versteckt; der Rand läuft weich aus, wo es weitergeht (in Browsern mit
  Scroll-Animationen; sonst bleibt nur die Leiste).
- `position: relative`, damit Screenreader-Text in der Fläche die Seite nicht verbreitert.
- Abstand zur Leiste (8 px), Lage und Scrollen stehen in `:where()` – `pb-0` (Tabellen, Reiter mit Linie) und
  `sm:overflow-visible` (am PC umbrechen) gewinnen immer.
- Eigene Animation am selben Element? Eine Hülle drumherum legen (Beispiel: Sprungmarken in `HonorHeader.jsx`).

Die Seite trägt `color-scheme: dark` und eine dunkle Seiten-Scrollleiste; das Papier der Druckansicht bleibt hell.

## Puls

`.tls-run-pulse` nimmt die Farbe aus `--tls-pulse-rgb` (Vorgabe Gold). Varianten: `tls-run-pulse--brand` (Cyan),
`--live` (Rot, „läuft gerade“), `--ok` (Grün).

## Farben für Rennserien

Pole (`--tls-pole`, Pink) und schnellste Runde (`--tls-fastest`, Violett) stehen als Rollen in `styles/system.css` –
nur für diese beiden Auszeichnungen.
