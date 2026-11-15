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

Das Budget-Gate `yarn check:bundle` (`scripts/check-bundle-budget.mjs`) liest die Grenzwerte aus den Zeilen unten und
schlägt fehl, wenn der Start darüber liegt oder Editor (`editor`), Diagramme (`charts`), PDF (`pdf`) oder QR (`jsQR`)
vorab geladen werden. Es läuft in der CI im Job „Frontend“ direkt nach `yarn build` und in `scripts/local_check.py`.

- Start-JS: höchstens **300.000 Bytes** gzip (Ziel aus #936 erreicht).
  <!-- budget:startup-js-gzip 300000 -->
- Start-CSS: höchstens **62.000 Bytes** gzip (Ist-Wert plus rund 2 % Puffer; ein Ziel gibt es noch nicht, siehe unten).
  <!-- budget:startup-css-gzip 62000 -->
- Neue Admin-, Editor-, Chart-, TV- oder Display-Features werden lazy geladen.
- Tiptap, Charts, QR/Display und schwere Admin-Tabellen duerfen nicht unnoetig in den anonymen Public-Startpfad rutschen.
- Teile, die nur angemeldet oder nur bei einem Ereignis gebraucht werden (Glocke, Zeremonien, Kronen-Feier, Abstimmung),
  laden erst dann (`lazyPage` aus `lib/chunkReload`). Ein Hörer für Ereignisse bleibt dabei im Start, nur die Anzeige lädt nach.

### Messung 15.11.2026 (#936)

| | vorher (main 100264a9f) | nachher |
| --- | --- | --- |
| Start-JS gzip (Stufe 9) | 624.378 Bytes in 105 Dateien | 297.177 Bytes in 46 Dateien |
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

### Bewusste Ausnahmen im Start

Diese Teile stehen absichtlich im Start (gzip, gerundet):

- `react-dom`/`react` (rund 67 KB): ohne geht nichts.
- `framer-motion` (rund 40 KB in `proxy` und `single-value`): Kopfzeile, Menü und Seitenwechsel nutzen es.
- `axios` samt `lib/api.js` (rund 24 KB): jede Seite lädt Daten darüber.
- `react-router` (rund 14 KB) und `sonner` (rund 9 KB, Hinweise).
- Startseite (`HomePage` mit ihren Abschnitten) und `PublicLayout`: bleiben im Start, damit `/` ohne zusätzliche Runde
  zum Server zeichnet.
- Saison-Rahmen (`SeasonStage`, `SeasonContext`, `sky`, `audio`, rund 10 KB): entscheidet, ob eine Saison läuft; die
  Inhalte selbst laden nach.

### Mögliche nächste Schritte

- `framer-motion` über `LazyMotion` und `m` statt `motion` (spart geschätzt 20–25 KB), Umbau vieler Komponenten.
- Die Suche (`GlobalSearch`) erst beim Öffnen laden (rund 2,5 KB); dabei darf kein erster Tastendruck verloren gehen.
- CSS: `src/index.css` (187 KB Quelle, rund 43 KB gzip) enthält viele Regeln einzelner Seiten (Liga, Podium, Platzierung,
  Kronen …). Sie in die CSS-Dateien der Seiten zu verschieben, verkleinert den Start, ändert aber die Reihenfolge der
  Regeln und braucht darum einen Vergleich der Optik je Seite. Tailwind liest Testdateien seit #936 nicht mehr mit.

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

- `yarn build` und danach `yarn check:bundle`: Start-JS und Start-CSS gegen die Budgets oben, mit den größten Dateien.
- Bei visuellen Layout-Aenderungen kleine und grosse Mobile-Viewports pruefen.
- Bei Performance-Arbeiten Startseite, Turnierdetail, Newsdetail und Eventdetail priorisieren.
