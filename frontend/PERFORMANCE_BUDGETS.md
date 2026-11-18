# Frontend Performance Budgets

Stand: 2026-11-15 (Bundle-Abschnitt, #936); übrige Abschnitte 2026-06-01

Diese Budgets gelten fuer die oeffentliche Website und sollen bei groesseren UI-, SEO- oder Medien-Aenderungen geprueft werden.

## Core Web Vitals

- LCP: unter 2.5 s auf mobilen 4G-Verbindungen fuer Startseite, Turnierdetail, Newsdetail und Eventdetail.
- CLS: unter 0.10 auf allen Public-Seiten; Karten, Hero-Bilder, Tabellen und Banner brauchen feste Aspect-Ratios oder stabile Hoehen.
- INP: unter 200 ms fuer Navigation, Filter, Suche, Galerie-Lightbox und Formularaktionen.
- TTFB: unter 800 ms fuer gecachte Public-Routen; unter 1.2 s fuer dynamische Detailseiten.

## Bundle

Gemessen wird der **anonyme öffentliche Start**: der Einstieg aus `index.html` und alles, was er statisch (transitiv)
importiert – genau die Dateien, die `dist/index.html` als `<script>` bzw. `<link rel="modulepreload">` lädt. Nachgeladene
Routen-, Saison-, Editor-, Diagramm-, PDF- und QR-Teile zählen nicht mit. Gezählt wird gzip mit fester Stufe 9 aus dem
Vite-Manifest (`dist/.vite/manifest.json`), damit die Zahl auf jedem Rechner gleich ist.

Das Budget-Gate `yarn check:bundle` (`scripts/check-bundle-budget.mjs`) liest Ziel und Grenze aus den Zeilen unten. Es
warnt über dem Ziel und schlägt über der Grenze fehl, ebenso wenn Editor (`editor`), Diagramme (`charts`), PDF (`pdf`) oder QR (`jsQR`)
vorab geladen werden. Es läuft in der CI im Job „Frontend“ direkt nach `yarn build` und in `scripts/local_check.py`.
Außerdem darf keine öffentliche Seite (alle unter `src/pages/public/` sowie die Pflicht-Seiten Registrierung, Mitglied
werden, Profil, Events und Turniere) diese Chunks statisch erreichen. Kleine Bibliotheken, die Editor bzw. Diagramme und
anderer Code gemeinsam nutzen (clsx, use-sync-external-store), sammelt dafür die Gruppe `vendor-shared` in
`vite.config.mjs` ein.
Seiten-CSS, das nur nachgeladene Seiten brauchen, steht ebenfalls nicht im Start-CSS (`PAGE_ONLY_CSS`, #2511): Es liegt
in einer eigenen Datei, die jede Datei mit diesen Klassen selbst importiert, und kommt so mit dem Chunk der Seite, bevor
sie zeichnet. Bisher gilt das für den Matchplan der Verwaltung (`.mp-…`, `pages/admin/tournament/matchplan/matchplan.css`).

**Ziel und Grenze:** Das *Ziel* ist der Wert, auf den wir hinarbeiten; liegt der Start darüber, meldet das Gate nur eine
Warnung (in GitHub Actions als `::warning::`). Die *Grenze* ist hart: darüber schlägt der Build fehl. Der kleine Abstand
dazwischen fängt gewöhnliches Wachstum ab, ohne dass jede Kleinigkeit die CI rot macht – lässt aber keinen schweren
Baustein unbemerkt durch. Nach jedem Abspeck-Schritt werden Ist-Wert, Ziel und Grenze hier nachgezogen (die Grenze
etwa 2–3 % über dem neuen Ist-Wert), damit Gewonnenes nicht still wieder verloren geht.

| | Ist (18.11.2026, #2511) | Ziel (Warnung) | Grenze (Fehler) |
| --- | --- | --- | --- |
| Start-JS gzip | 287.442 Bytes | 300.000 Bytes | 305.000 Bytes |
| Start-CSS gzip | 58.805 Bytes | – (siehe nächste Schritte) | 63.000 Bytes |

<!-- goal:startup-js-gzip 300000 -->
<!-- budget:startup-js-gzip 305000 -->
<!-- budget:startup-css-gzip 63000 -->

- Neue Admin-, Editor-, Chart-, TV- oder Display-Features werden lazy geladen.
- Tiptap, Charts, QR/Display und schwere Admin-Tabellen duerfen nicht unnoetig in den anonymen Public-Startpfad rutschen.
- Teile, die nur angemeldet oder nur bei einem Ereignis gebraucht werden (Glocke, Zeremonien, Kronen-Feier, Abstimmung),
  laden erst dann (`lazyPage` aus `lib/chunkReload`). Ein Hörer für Ereignisse bleibt dabei im Start, nur die Anzeige lädt nach.
  Bausteine im Hintergrund (Zeremonie, Glocke, Kronen-Feier, „Heute im Einsatz“) laden mit `{ optional: true }` und in
  einer stillen `OptionalBoundary`: fehlt die Datei nach einem Deploy, fallen sie weg, statt die Seite neu zu laden.

### Messung 15.11.2026 (#936)

| | vorher (main 100264a9f) | nachher |
| --- | --- | --- |
| Start-JS gzip (Stufe 9) | 624.378 Bytes in 105 Dateien | 297.177 Bytes in 46 Dateien (nach main 66bae9f7d: 297.364 in 45) |
| Start-CSS gzip (Stufe 9) | 64.122 Bytes | 60.590 Bytes |
| LCP Startseite / Album (Labor, Median aus 5) | 7,06 s / 7,26 s | 4,06 s / 4,58 s |
| CLS Startseite / Album | 0,002 / 0,002 | 0,002 / 0,002 |
| INP Menü auf / zu, Startseite / Album | 80 ms / 72 ms | 80 ms / 104 ms (Streuung je Lauf 56–184 ms) |

Labor: gebautes `dist` hinter einem gzip-Server wie nginx, Chromium headless mit Playwright, je Lauf neuer Kontext
(kalter Cache, Service Worker gesperrt), Netz wie Lighthouse „Slow 4G“ (150 ms RTT, 1,6 Mbit/s), CPU 4-fach gebremst,
Handy 390 × 844 mit DPR 2, API mit 200 ms Antwortzeit und Inhalten wie in `e2e/home-motion.spec.js`, Album mit 24 Fotos.
Echte Geräte und echte Daten liefern andere absolute Werte; der Vergleich vorher/nachher ist unter gleichen Bedingungen.

Treiber vorher: `manualChunks` ordnete React dem Chunk `charts` und `jsx-runtime` dem Chunk `editor` zu (eine Gruppe zieht
ihre Abhängigkeiten mit), darum lud jeder Start Editor (141 KB gzip) und Diagramme (109 KB gzip) vorab. Seit #936 stehen
in `vite.config.mjs` feste Gruppen mit Vorrang (`codeSplitting.groups`, React zuerst). Danach: Zeremonie-Host mit
Abzeichen und Motiven, Glocke, Kronen-Feier, Abstimmungs-Popup und die Karten „Heute im Einsatz“ laden bei Bedarf.

Schon vorher bei Bedarf und unverändert: PDF-Betrachter (`pdfjs-dist`, `lib/pdfViewer.js`), QR-Leser (`jsqr`,
`QrScanner.jsx`), alle Saison-Inhalte (Advent, Halloween, Weihnachten … über `seasons/registry.js`) samt ihrem CSS.

### Messung 18.11.2026 (#2511)

| | vorher (main 3946d18df) | nachher (nach main 5897fceee) |
| --- | --- | --- |
| Start-JS gzip (Stufe 9) | 300.025 Bytes in 48 Dateien | 287.442 Bytes in 48 Dateien |
| Start-CSS gzip (Stufe 9) | 61.928 Bytes in 2 Dateien | 58.805 Bytes in 2 Dateien |

Treiber: `PublicLayout` zog mit `motion` den vollen Satz von framer-motion in den Start, obwohl nur das Handy-Menü ein-
und ausblendet (jetzt `m` mit `LazyMotion` und `domAnimation`, −12,6 KB). Das CSS des Matchplans der Verwaltung
(Turnier, Stationen, Spielwochen der Staffel-Seite) stand in `index.css` und liegt jetzt in `matchplan.css` (−3,1 KB).

### Bewusste Ausnahmen im Start

Diese Teile stehen absichtlich im Start (gzip, gerundet):

- `react-dom`/`react` (rund 67 KB): ohne geht nichts.
- `framer-motion` (rund 27 KB, seit #2511 nur der kleine Satz `domAnimation`): Das Handy-Menü nutzt `m` mit `LazyMotion`.
  Ziehen und Layout-Bewegung (Projection, rund 12 KB) laden erst mit Seiten, die `motion` selbst importieren. Im Start
  bitte kein volles `motion` - sonst kommen sie zurück.
- `axios` samt `lib/api.js` (rund 24 KB): jede Seite lädt Daten darüber.
- `react-router` (rund 14 KB) und `sonner` (rund 9 KB, Hinweise).
- Startseite (`HomePage` mit ihren Abschnitten) und `PublicLayout`: bleiben im Start, damit `/` ohne zusätzliche Runde
  zum Server zeichnet.
- Saison-Rahmen (`SeasonStage`, `SeasonContext`, `sky`, `audio`, rund 10 KB): entscheidet, ob eine Saison läuft; die
  Inhalte selbst laden nach.

### Mögliche nächste Schritte

- Die Suche (`GlobalSearch`) erst beim Öffnen laden (rund 2,5 KB); dabei darf kein erster Tastendruck verloren gehen.
- CSS: `src/index.css` enthält weiter Regeln einzelner Seiten (Map-Veto live, Podium, Platzierung, Mitgliedskarte,
  Kronen, Seltenheits-Rahmen …). Sie in die CSS-Dateien der Seiten zu verschieben, verkleinert den Start, ändert aber die
  Reihenfolge der Regeln und braucht darum einen Vergleich der Optik je Seite. Vorsicht beim Map-Veto: `.tls-veto-card--live`
  ergänzt Regeln aus dem nachgeladenen `maps.css` mit gleicher Gewichtung - nach dem Umzug hinge das Ergebnis von der
  Ladereihenfolge ab. Tailwind liest Testdateien seit #936 nicht mehr mit.
- Gleiche CSS-Blöcke zusammenzufassen spart gzip kaum etwas: gzip packt Wiederholungen ohnehin klein (#2511: die
  Winkel-Blöcke in `styles/system.css` zusammengelegt, +14 Bytes).

## Bilder

- Public-Karten nutzen feste Aspect-Ratios und `LazyImg`.
- Above-the-fold-Bilder bekommen nur gezielt `priority`; Listenbilder bleiben lazy.
- `sizes` folgt der echten Spaltenbreite (Galerie: `lib/gallerySizes.js`, nachgerechnet bei 390, 640, 768 und 1280 px).
- Uploads bleiben PNG/JPG/WebP-kompatibel und werden client- oder serverseitig optimiert.
- Alt-Texte sind fuer inhaltliche Bilder Pflicht; dekorative Bilder bleiben leer.

## API

- Listenendpunkte liefern moeglichst kompakte Kartendaten.
- Detaildaten, Chat, Reports, Editor-Metadaten und Admin-Hilfsdaten werden separat geladen.
- Listen sollten paginierbar oder limitiert bleiben, sobald sie potenziell stark wachsen.

## Pruefung

- `yarn build` und danach `yarn check:bundle`: Start-JS und Start-CSS gegen Ziel und Grenze oben, mit den größten Dateien.
- Bei visuellen Layout-Aenderungen kleine und grosse Mobile-Viewports pruefen.
- Bei Performance-Arbeiten Startseite, Turnierdetail, Newsdetail und Eventdetail priorisieren.
