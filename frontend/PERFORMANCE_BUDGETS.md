# Frontend Performance Budgets

Stand: 2026-06-01

Diese Budgets gelten fuer die oeffentliche Website und sollen bei groesseren UI-, SEO- oder Medien-Aenderungen geprueft werden.

## Core Web Vitals

- LCP: unter 2.5 s auf mobilen 4G-Verbindungen fuer Startseite, Turnierdetail, Newsdetail und Eventdetail.
- CLS: unter 0.10 auf allen Public-Seiten; Karten, Hero-Bilder, Tabellen und Banner brauchen feste Aspect-Ratios oder stabile Hoehen.
- INP: unter 200 ms fuer Navigation, Filter, Suche, Galerie-Lightbox und Formularaktionen.
- TTFB: unter 800 ms fuer gecachte Public-Routen; unter 1.2 s fuer dynamische Detailseiten.

## Bundle

- Public Main-JS: Ziel unter 300 kB gzip.
- Neue Admin-, Editor-, Chart-, TV- oder Display-Features werden lazy geladen.
- Tiptap, Charts, QR/Display und schwere Admin-Tabellen duerfen nicht unnoetig in den anonymen Public-Startpfad rutschen.

## Bilder

- Public-Karten nutzen feste Aspect-Ratios und `LazyImg`.
- Above-the-fold-Bilder bekommen nur gezielt `priority`; Listenbilder bleiben lazy.
- Uploads bleiben PNG/JPG/WebP-kompatibel und werden client- oder serverseitig optimiert.
- Alt-Texte sind fuer inhaltliche Bilder Pflicht; dekorative Bilder bleiben leer.

## API

- Listenendpunkte liefern moeglichst kompakte Kartendaten.
- Detaildaten, Chat, Reports, Editor-Metadaten und Admin-Hilfsdaten werden separat geladen.
- Listen sollten paginierbar oder limitiert bleiben, sobald sie potenziell stark wachsen.

## Pruefung

- `npm run build` zeigt die gzip-Groessen nach jedem relevanten Frontend-Block.
- Bei visuellen Layout-Aenderungen kleine und grosse Mobile-Viewports pruefen.
- Bei Performance-Arbeiten Startseite, Turnierdetail, Newsdetail und Eventdetail priorisieren.
