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

`.tls-run-pulse` nimmt die Farbe aus `--tls-pulse-rgb` (Vorgabe Cyan, #1305). Varianten: `tls-run-pulse--brand` (Cyan),
`--live` (Rot, „läuft gerade“), `--ok` (Grün).

## Farb-Rollen (#1305)

Jede Farbe hat genau eine Aufgabe. Neue Stellen nehmen die Rolle, nie den Hexwert: als Tailwind-Farbe (`text-warn`,
`bg-ok/10`, `border-live/40`), in CSS als Variable (`var(--tls-honor)`, `rgb(var(--tls-brand-rgb) / 0.3)`), in JS über
`ROLE_COLORS` aus `lib/categoryColors.js`.

| Rolle | Farbe | Wofür | Nicht für |
|---|---|---|---|
| `brand` | Cyan #29B6E8 | Knöpfe, Links, aktiv, „du“, Aufgaben für dich, Hinweise | Zustände |
| `live` | Rot #FF3B30 | nur „läuft gerade“ – und Löschen/Entfernen (`tls-btn--danger`) | Fehler, Abgelehnt, Zähler |
| `warn` | Orange #FF9F43 | Achtung: Problem, Klärung, defekt, Fehler im Formular, fehlt noch, nicht gespeichert, Einspruch, Strafe, Hinweis der Turnierleitung | Wartet |
| `ok` | Grün #1FD08E | offen und frei: Anmeldung/Check-in offen, frei, bereit, erledigt | – |
| `honor` | Gold #FFD700 | Platz 1, Pokal, Preise, Auszeichnung, Mitgliedschaft und Verein | Knöpfe, Warnungen, Turniere |
| `event` | Violett #9F7AEA | die Art „Event“ | – |
| `quiet` | Grau #8E8E99 | vorbei, wartet, Warteliste, abgesagt, abgelehnt, nicht erschienen, Gast, aus | – |

Farben je Art (Kalender, Karten, Datums-Kachel) stehen in `KIND_COLORS`: Event Violett, Turnier Cyan, Fast Lap Türkis,
Verein Gold. Die Werte hält `docs/category-colors.json` für Web und App gleich.

Bewusst ausgenommen (Sammel-Optik oder fremde Marken): Level-Rahmen und Erfolgs-Stufen samt Zeremonie, Saison-Deko,
YouTube-Rot, die Ampel im Betrieb (grün/gelb/rot, Fabians Entscheidung 27.11.2026), Medaillen- und Sponsor-Stufe „Gold“. Der Wächter
`styles/colors.test.js` zählt die Rohwerte Gold, Rot und Neon-Grün samt Nebentönen (#FF6B6B, #FF9500, #00D26A, #FFD95A …)
und rgba() **je Datei**; erlaubt ist nur, was in `styles/colors.baseline.json` mit Grund steht (Ratschen-Prinzip).

Weiße Schrift auf vollen Flächen braucht 4,5 : 1 – auf Cyan, Orange, Gold und Grün steht deshalb dunkle Schrift.

## Deckkraft (#2598)

Tailwind baut nur Deckkraft-Werte aus seiner Skala: 0, 5, 10 … 95, 100. `border-white/8` oder `bg-ok/12` wirken nicht –
die Klasse fehlt im CSS. Gemeinte Zwischenwerte stehen als `/[0.12]` da. Wächter: `styles/opacity.test.js`.

## Farben für Rennserien

Pole (`--tls-pole`, Pink) und schnellste Runde (`--tls-fastest`, Violett) stehen als Rollen in `styles/system.css` –
nur für diese beiden Auszeichnungen.
