# Design-System: Bewegung, Wischleisten, Puls, Zustands-Schilder

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
`styles/colors.test.js` zählt die Rohwerte Gold, Rot und Neon-Grün samt Nebentönen (#FF6B6B, #FF9500, #00D26A, #10B981,
#FFD95A, #FFD21A …), rgba() und Tailwind-Farbstufen (`text-red-300`, `border-amber-400/50` …) **je Datei**; erlaubt ist nur, was in `styles/colors.baseline.json` mit Grund steht (Ratschen-Prinzip).

Weiße Schrift auf vollen Flächen braucht 4,5 : 1 – auf Cyan, Orange, Gold und Grün steht deshalb dunkle Schrift.

## Deckkraft (#2598)

Tailwind baut nur Deckkraft-Werte aus seiner Skala: 0, 5, 10 … 95, 100. `border-white/8` oder `bg-ok/12` wirken nicht –
die Klasse fehlt im CSS. Gemeinte Zwischenwerte stehen als `/[0.12]` da. Wächter: `styles/opacity.test.js`.

## Farben für Rennserien

Pole (`--tls-pole`, Pink) und schnellste Runde (`--tls-fastest`, Violett) stehen als Rollen in `styles/system.css` –
nur für diese beiden Auszeichnungen.

## Zustands-Schilder (#1306)

Ein Baustein für jeden Zustand: `components/tls/StatusChip.jsx`. `StatusBadge` (Rohstatus) und `PhaseBadge`
(öffentliche Phase mit Countdown) sind dünne Hüllen darum; neue Stellen nehmen eine der drei, nie ein eigenes Schild.

- **Zehn Arten** (Fabians Variante C – gefüllt fürs Wichtige, „Frei“ seit 27.11.): `soon` Bald, `registration`
  Anmeldung offen, `checkin` Check-in offen, `free` Frei (Station), `live` Läuft, `joined` Du bist dabei, `waiting`
  Wartet, `problem` Problem, `done` Beendet, `cancelled` Abgesagt. Jede hat ein Symbol (Lucide) und ein Wort; die
  Farbe ist nie die einzige Information.
- **Gefüllt** sind nur Anmeldung offen und Check-in offen (Grün `ok`, Schrift `--tls-on-ok`); „Frei“ hat einen grünen
  Rahmen ohne Füllung. **Rot** (`live`) ist nur „Läuft“ – der Punkt (`.tls-live-dot`) pulsiert leise, bei „Bewegung
  reduzieren“ steht er still mit ruhigem Hof. Eine laufende Saison (`active`) steht immer still: `STILL_STATES` in
  `lib/statusKinds.js` („still“ in der JSON-Datei), von Hand `pulse={false}`.
- **Zuordnung** in `lib/statusKinds.js`: jeder bekannte Zustand → `[Art, Wort]` oder `[Art, Wort, Spielart]`, dazu die
  Du-Form der eigenen Anmeldung (`own`: „Du bist dabei“, „Wartet auf Freigabe“). Unbekanntes zeigt das Wort der Stelle
  oder „Unbekannt“, nie den Rohwert. Ein neuer Zustand bekommt hier eine Zeile – und in `docs/status-kinds.json`, die
  die App liest.
- **Cyan heißt „du“** (Fabian Nr. 303): fremde Anmeldungen (`approved`, `registered`, `checked_in` ohne `own`) nehmen
  die ruhige Spielart `quiet` von `joined` – Haken in Grau (`data-variant="quiet"`, `STATUS_VARIANTS`, „variants“ in
  der JSON-Datei). Nur die eigene Anmeldung ist Cyan. Eine Station, an der ein anderes Turnier spielt, ist `waiting`
  („Anderes Turnier“, ohne Puls, Fabian Nr. 304).
- **Eigener Stand** mit Wort vom Server („Mein Kalender“, Eventliste, Event-Programm): `ownBadgeKind(state)` gibt die
  Art (Warteliste wartet, Gefahrenes ist vorbei, sonst „Du bist dabei“), das Team steht als `meta` daneben.
- **Eigene Status-Listen** anderer Bereiche bilden ihre Werte auf die Arten ab, statt eigene Farben zu setzen: Runden
  der Rennserien `ROUND_STATE_KINDS` (lib/referenceCalendar.js), Liga-Anmeldung `APPLICATION_KINDS`
  (LeagueApplicationPanel), Stationen der Hallen-Tafel `STATION_STATES` (lib/tvStationGrid.js).
- **Aussehen** in `styles/system.css` (`.tls-status-chip[data-kind]`): Outfit 600, 12,5 px (`--tls-chip-size`),
  groß 14 px (`size="lg"`), Symbol 13 px, normal geschrieben, bricht nie um. Auf Bildern `onMedia`: Unterlage
  `--tls-chip-underlay` (94 % des Grunds, „media“ in der JSON-Datei) unter Schild und Countdown – auch auf einem weißen
  Bild über 4,5 : 1.
- **Countdown** nie im Schild: `meta` setzt ihn als `tls-type-small` daneben (`.tls-status`, bricht am Handy darunter
  um). `PhaseBadge` macht das selbst, mit `lib/countdownRule.js` (#1264) und der Tagesangabe mehrtägiger Events;
  `phaseDayInfo(phase)` gibt „Tag 2/3“ auch Stellen ohne Countdown (Kalender).
- **Keine zweite Zustandszeile:** Was das Schild sagt, steht nicht noch einmal darunter. Die Turnierkarte zeigt zur
  Anmeldung nur ruhigen Text mit Zusatz (Frist, „öffnet am …“), siehe `registrationLine` in TournamentCard.jsx.
- **Andere Modi** (TV-Station „Aufgerufen“, Tage eines Events) nehmen eine Art direkt: `<StatusChip kind="soon"
  label="Aufgerufen" />`.
- **TV:** `TvPill kind=…` bzw. `TvStatusPill status=…` (components/tv/TvParts.jsx) – dieselben Arten in Beamer-Größe
  (`tv.css`, `.tv-pill--status`), mit Kontrast-Modus.

Wächter: `lib/statusKinds.test.js` hält JS, JSON und CSS gleich und prüft, dass jeder Zustand aus StatusBadge,
PhaseBadge, Server (`models.py`, `public_phase.py`) und Aufrufern eine Art und ein Wort hat. `scripts/check-contrast.js`
rechnet jede Art und Spielart auf Grund und Fläche 1 bis 3 und auf einem weißen Bild nach (mindestens 4,5 : 1).
Playwright: `e2e/zustands-schilder.spec.js` (alle zehn Arten auf Startseite, Dashboard, den Stationen der Turnierleitung
und der öffentlichen Turnierseite).

## Datum (#1307)

Ein Datum steht überall in einer Form: **„Sa 23. Mai · 18:00“** – Wochentag kurz, Monat ausgeschrieben („Jänner“), das
Jahr nur bei einem anderen Jahr, Nahes als „heute 18:00“ / „morgen 18:00“. Gerechnet wird in Wiener Zeit.

- **Website** (`frontend/src/lib/datetime.js`): `formatWhen` (mit `time: false` nur der Tag, mit `relative: false` ohne
  heute/morgen), `formatRange` für Zeiträume („Fr 19. – Sa 20. Juni“, „Mo 30. November – Mi 2. Dezember“), `formatAgo`
  für Vergangenes in Listen („vor 12 Min.“), `formatClock` („18:00“), `formatMonth` („Februar 2026“), `formatWeekday`
  („Sa“), `formatOfficialDate` („23.05.2026“). `formatDateTime`/`formatDate` rufen `formatWhen`.
- **Server** (`backend/services/date_text.py`): dieselben Hilfen; Mails, Discord, Teilen-Bilder, Kalender-Abo und
  gespeicherte Meldungen nehmen `format_moment` – die feste Form ohne heute/morgen, weil man sie später liest.
- **Ohne heute/morgen** (`relative: false`): Sätze mit „am“/„vom“, Gedrucktes, Geteiltes. „· 18:00 Uhr“ gibt es nicht;
  nach der Uhrzeit allein bleibt „Uhr“ („Antreten bis 18:00 Uhr“).
- **Amtlich „23.05.2026“** bleibt für Rechnungen, Urkunden, PDF-Listen, Mitgliedsausweis, Rechtstexte, Statuten und das
  Regelwerk. CSV-Ausfuhren schreiben „14.03.2026“ bzw. „14.03.2026 18:05“ (`formatAdminDate`/`formatOfficialDate`, Server
  `format_official_moment`) – sortierbar, mit Jahr, nie „morgen“. Eine neue Server-Ausfuhr kommt mit ihrer Funktion in
  `CSV_OFFICIAL` (Wächter: ruft nie die Anzeigeform) und bekommt einen Verhaltenstest in `test_csv_dates_unit.py`.
- **Countdown** (`lib/countdownRule.js`, #1264): eigene Sätze („in 3 Tagen“, „im März“), das Datum dazwischen aus
  `formatWhen`/`formatRange` – im Dezember also „Sa 9. Jänner 2027“.
- **Barrierefreiheit:** `components/tls/When.jsx` schreibt einen Termin als `<time dateTime>`; der Mittelpunkt steht
  `aria-hidden` da und wird nicht vorgelesen. Im Einsatz auf Turnierkarten, Startseite (News), News-Liste, Glocke und
  Benachrichtigungen, Match-, Event-, Turnier- und Live-Seite, Spielplan, Event-Leitung, Team-Chat und Dashboard.
  Übrige Texte aus `formatWhen` (Sätze, Tabellen in der Verwaltung, Attribute) sind reiner Text; dort liest eine
  Vorlesehilfe mit hoher Satzzeichen-Stufe den Mittelpunkt mit. Neue sichtbare Termine nehmen `<When>`.
- **Eingabefelder** (`GermanDateField`, `datetime-local`) bleiben, wie sie sind.

Dieselben Fälle für Web, Server und App: `docs/date-cases.json` (Sommerzeit, Mitternacht in Wien, Jahreswechsel,
Zeiträume über Monats- und Jahresgrenzen). Wächter: `lib/dateForms.test.js` (keine eigenen Datumsformen in `src/`,
Ausnahmen mit Grund, die noch abweichen müssen; `Intl.DateTimeFormat` mit Tag oder Monat in jedem Gebietsschema außer
den ISO-Schlüsseln `en-CA`/`sv-SE`) und `backend/tests/test_date_text_inventory_unit.py` (kein `%d.%m`, `%-d.%-m`,
`%d. %B`, `{tag}.{monat}`, `"{}.{}.".format(...)` außerhalb der amtlichen Stellen). Advent-Sonderformen folgen in #2619. Tests mit Datums-Texten laufen mit fester Uhr: `runAtTestClock()` aus `src/testClock.js`, in Playwright
`page.clock.install`.
