# Jahreszeiten: der gemeinsame Kern (Seasonal Core)

Stand: 29. September 2026 (Seasonal Core C1–C6, #721–#726). Gilt für Web (`frontend/src/seasons/`) und App
(`mobile/src/seasons/`). Halloween ist die erste Saison auf diesem Kern; Winter, Weihnachten, Silvester, Fasching,
Ostern und Geburtstage bringen nur noch ihre Figuren und ihren Plan mit, nicht ihre eigenen Regeln.

Der Anspruch bleibt der von #658: dezent, edel, detailreich, nichts abgeschnitten - und die Deko ist nie wichtiger
als die Bedienung.

## 1. Bühne und Module

| Teil | Web | App |
|---|---|---|
| Saisondaten (Server) | `SeasonContext.jsx` (`/api/seasonal/active`, `effective` je Saison) | `SeasonProvider.tsx` |
| Bühne | `SeasonStage.jsx` (setzt `data-season`, `data-season-intensity`, `data-season-page` auf `<html>`) | `SeasonStage.tsx` |
| Modulregister | `registry.js` (`SEASON_MODULES`, lazy) | `halloween.tsx` über `SEASON_MODULES` |
| Slots im Layout | `SeasonSlots.jsx` (Widget, Footer, Sound- und Schreck-Schalter) | Screens hängen `SeasonPerch`/`Card perch` ein |

Ein Web-Modul exportiert `season` mit optionalen Teilen: `Backdrop` (hinter dem Inhalt), `skyLayers` (Canvas über
dem Inhalt, nie klickbar), `Corners` (Ecken und Anker), `Widget` (klickbar im Kopfbereich), `Footer`, `Toast`,
`sounds`, `ScareToggle`, `accent`. Ein App-Modul liefert `Corners`, `Widget`, `Bats` (Flugebene) und Farben.

## 2. Anker: echte Kanten statt zufälliger Positionen (C1)

Deko sitzt nur an Kanten und Ecken echter Elemente. Der Kern misst, die Saison plant.

**Web** (`anchors.js`):

| Art | Selektor | Kante/Ecke | klebt am Fenster |
|---|---|---|---|
| `nav` | `header nav a` | Unterkante (hängend) | ja, wenn die Kopfzeile `sticky`/`fixed` ist |
| `header` | `header` | Unterkante, drei Stellen | ja, wenn `sticky`/`fixed` |
| `card` | `[data-season-anchor='card']`, `[data-season-perch='card']` | obere Ecken (sitzend), Unterkante (hängend), Innenecken (Kasten) | nein |
| `frame` | `[data-season-perch='frame']` | wie Karte | nein |
| `image` | `main img/picture/video` außerhalb von Karten | Unterkante | nein |
| `hero` | `[data-season-anchor='lion']`, `[data-season-anchor='hero']` | Punkt im Element (Mähne) | nein |
| `footer` | `footer` | Innenecken | nein |
| `footerLine` | `footer [data-season-line]` | Oberkante (sitzend) | nein |

- `measureAnchors(doc, win, { kinds, selectors, minSize, limits, inViewMargin })` liefert je Element Art,
  Rechtecke (Fenster und Seite), `fixed` und einen **je Element stabilen Schlüssel** (`art:id`).
- Plätze: `edgeSlot` (Kante, Bruchteil oder Einzug, `dy`), `pointSlot` (Punkt im Element), `cornerSlot` (Ecke mit
  Kasten, `tl/tr/bl/br`). Jeder Platz hat `x/y` (Fenster- oder Seitenkoordinaten je nach `fixed`), `px/py`
  (immer Seite), `size`, `measure()` zum Nachmessen (null, wenn das Element weg ist) und den Schlüssel
  `art:id:index` bzw. `art:id:ecke`.
- Sonde: `roomAt` für Kantenplätze (jeder Text-Behälter, jedes Bedienelement und jede fremde Karte sperrt),
  `areaFree` für Flächen (Bild, Grafik, Bedienelement sperren; Schrift nur mit ihren Zeichenkästen, `glyphs.js`).
  Ohne Sonde (Tests, alte Browser) entscheidet die Geometrie: `clearOf` gegen `neighbourRects`.
- `freeSlots` streicht Ruhezonen (Abschnitt 3) und belegte Schlüssel. `chooseSlots` wählt mit Mindestabstand,
  Gewicht je Art oder je Kandidat, höchstens eins je Element - und liefert **weniger**, wenn nichts mehr passt.
  `nearestFreeSlot` findet den nächsten freien Platz für eine Landung.
- Halloween-Adapter: `halloween/perches.js` (Fledermaus-Plan, Gewichte, Mindestabstand 140) und
  `halloween/webCorners.js` (Ecknetze, Mindestabstand 320, eins je Element, Fußzeile lieber).

**App** (`anchors.tsx`, `perches.ts`): Es gibt kein `elementFromPoint`, darum melden sich Anker selbst -
`<Card perch="id" perchKind="card|hero|tile|banner">` bzw. `<SeasonPerch id kind>` registriert Lage und Größe im
Store (`registerPerch`), `usePerchAssignments` wählt mit `choosePerches` (Gewichte je Art) und `placementFor`
(Ecke/Unterkante, Haltung, Größe) und weist zu; `perchPoint` rechnet die Stelle. Belegung und Freigabe laufen über
den Store, Flüge über `flights.ts`.

**Kennzeichnen statt raten**: Eine neue Kachel oder Karte bekommt `data-season-anchor="card"` (Web) oder
`perch` (App). Was nie Deko tragen darf, wird Ruhezone (Abschnitt 3).

## 3. Ruhezonen und Bedienung (C2)

Deko darf nie wichtiger sein als Bedienung. Zentral, nicht je Saison:

- **Web** (`quiet.js`): `QUIET_SELECTOR` = `[data-season-quiet]`, `form`, Dialoge, Menüs, Listboxen, Comboboxen,
  Radix-Popper, geöffnete Dropdowns, Tabellen. `measureQuietZones` liefert Rechtecke (Seite und Fenster, 12 px
  Rand), `pointInQuiet`/`rectInQuiet` prüfen, `overlayZones` sind geöffnete Dialoge und Menüs (dort weicht Deko
  sofort aus: `data-yield="1"`), `watchOverlays` beobachtet die Seite. Brackets (`BracketTree`) und Formulare sind
  damit automatisch tabu.
- **App** (`quiet.ts`): `setOverlay(id, open)` (Sheets, Modals, Sticker- und Anhangs-Auswahl, Registrierung),
  `setQuietZone(id, rect)` über `useSeasonQuietZone(ref)`; `pointInQuiet`/`rectInQuiet` (8 px Rand).
- **Zeiger**: Saisonebenen sind `pointer-events: none` bzw. `box-none`; nur ausdrücklich interaktive Figuren
  (Fledermaus, Spinne in der Nabe, Katze, Kürbis, Sammelobjekte) nehmen Klick oder Berührung.
- **Stapel**: Die Bühne liegt unter Dialogen und Dropdowns des Projekts (Z-Index-Stack respektieren), nie darüber.
- Tests: `quiet.test.js`, `perches.test.js`, `webCorners.test.js`, `anchors.test.js`; App `quiet.test.ts`,
  `anchors.test.tsx`, `acceptance.test.tsx`.

## 4. Bewegungsbudget (C3)

Eine Saison darf detailreich sein, aber nie wie ein Bildschirmschoner wirken. Ein Planer je Plattform
(`motion.js` / `motion.ts`, gleiche Regeln):

- **Plätze**: 2 gleichzeitig große Bewegungen (Seitenklasse kann auf 1 oder 0 senken). Jede Effektklasse hat
  Kosten in Plätzen, Abklingzeit, Priorität und Höchstdauer (`EFFECTS`).
- **Abstand**: mindestens 2,5 s zwischen zwei Starts; nach dem Laden 4 s Ruhe; nach dem Zurückkehren 1,5 s.
- **Versteckt**: `document.hidden` (Web) bzw. `AppState` (App) pausiert alles; beim Zurückkehren wird **nichts
  nachgeholt**.
- **Klick der Person** bekommt ihren Platz immer, belegt ihn aber (`user: true`).
- **Kleine Dauerbewegung** (Netz im Wind, Pupillen, Schwanz) zählt nicht.
- **Reduced Motion**: keine großen Bewegungen, statische Darstellung (Netz statisch, Nebel still, Figuren sitzen).
- Neue Saisons tragen ihre Effektklassen in `EFFECTS` ein (Schneegestöber, Feuerwerk, Konfetti) und fragen mit
  `requestMotion(kind)` / `releaseMotion(token)`. Deterministische Tests: `motion.test.js` / `motion.test.ts`.

## 5. Jahres-Seed (C4)

Die Mechanik bleibt, die Anordnung wechselt je Jahr - innerhalb des Jahres stabil, ein Neuladen ändert nichts.

- Saat: `saison:jahr:route[:salz]` (Web `rng.js`: `seasonSeed`, `seasonRng`, `seasonYear`; App `rng.ts`
  gleichnamig mit Screen statt Route).
- `seasonYear(season, now)`: aus `starts_at` des Servers, sonst aus der Uhr; Saisons über Silvester (`winter`,
  `new_year`) zählen zum Jahr ihres Beginns. **Kein fester Jahres-Check** in der Darstellung - die Engine kennt nur
  „dieses Saisonjahr“; Inhalte (Texte, Termine) dürfen jahresbezogen sein.
- Halloween: `YEAR_SALT` in `halloween/index.jsx` (Tests: `setYearSalt("...")`), `pageLayout(pathname,
  intensity, salt)`; die App zieht `screenRng(screen, salt)` mit dem Jahres-Salz.
- `salt` ist frei für Gerät oder Nutzer; ohne Salz sehen alle dasselbe - das hält Abnahmen reproduzierbar.
- Rückwärtskompatibel: `pageRng`/`screenRng` bleiben; der Saison-Strom ist ein Seiten-Strom mit der Saat als Adresse.

## 6. Effektklassen je Seite (C5)

Nicht jede Route bekommt dieselbe Deko. Eine Matrix statt if-Abfragen in Komponenten:

| Klasse | Web (Adresse) | App (Screen) |
|---|---|---|
| lebendig | Start, Events, News, Galerie | Dashboard, News, Galerie, Season Pass |
| mittel | Detailseiten, Community, Teams, Turnierliste | Event-Detail, Teams, Mehr |
| ruhig | Brackets, Fast Lap, Formulare, Login, Profil | Turnier-Detail, Formulare, Chat |
| still | Admin, Display, Setup, Einwilligung | Einwilligung, Zahlung, Einstellungen |

`effectClasses(cls, intensity)` (Web `intensity.js`, App `intensity.ts`) liefert saisonneutral: `perch` (Figuren an
Ankern), `corner` (Ecken), `ambient` (none/far/near), `watch` (Beobachter), `motion` (große Bewegungen) und
`slots`, `crawl`, `rare`, `scene` (none/small/full), `interact` (Erschrecken, Sammeln). `allows(caps, effect)` fragt ab.

- **Serverstärke bleibt übergeordnet**: `subtle` nimmt jede Bewegung und lässt eine Ecke und ferne Atmosphäre;
  `full` hebt an; `quiet` bleibt still.
- **Fensterbreite/Bildschirm**: `scaleForViewport` (Web: unter 900 px weniger, unter 640 px keine Ecken und keine
  Beobachter), `scaleForScreen` (App).
- **Saison-Übersetzung**: `SEASON_CAPABILITIES[saison]` übersetzt die Klassen in eigene Schlüssel (Halloween:
  `hangingBats`, `cornerWebs`, `fog`, `eyes`, `flock`, `rappel`, `crawler`, `scares`, `footerScene`). Eine neue Saison
  trägt sich dort ein; Komponenten fragen nur ihre Schlüssel.

## 7. Abnahme: „nichts wird schlechter“ (C6)

Verbindlich für jede Saison, Web und App:

**Checkliste**

1. Hauptseiten bzw. Screen-Klassen (lebendig, mittel, ruhig, still) mit der Saison und ohne.
2. Breakpoints Web: 375×812, 768×1024, 1366×768, 1440×900, 1920×1080. App: kleine, mittlere, große Android-Screens.
3. Saison aus = Produkt unverändert (keine Deko-Elemente, keine Bühne, `data-season` leer).
4. Saison an = keine blockierte Bedienung: Kopfzeile und Menü erreichbar, Dropdowns und Dialoge über der Deko,
   keine Deko über Text, Bild oder Bedienelement, Ruhezonen frei.
5. Reduced Motion: nichts bewegt sich, die Saison bleibt erkennbar.
6. Kein horizontaler Überlauf, kein Abschneiden, kein Layout-Springen (CLS) durch Deko.
7. Modals, Navigation, Dropdowns immer korrekt (Deko weicht aus).
8. Leistung und Lebenszyklus: Tab versteckt/App im Hintergrund pausiert, beim Zurückkehren keine Effektlawine;
   keine Leaks (Beobachter und Timer werden abgebaut).
9. Screenshots hängen am Bericht (Web: Playwright-Anhänge; App: Sichtlauf auf dem Gerät durch den Betreiber).

**Werkzeuge**

- Web: `frontend/e2e/seasonQa.js` - `defineSeasonQa({ title, seasonKey, season, now, pieces, layers, exempt,
  offPieces, yielding, countPieces, mobileLimits, reducedMotionState, reducedMotion })` erzeugt die vier Prüfungen
  (PC, Handy/Tablet, Reduced Motion, Saison aus). Beispiel: `e2e/halloween-regression.spec.js`. Lauf:
  `E2E_PORT=3017 E2E_ISOLATED=1 npx playwright test e2e/<saison>-regression.spec.js --project=chromium --project=mobile`.
- App: `mobile/src/seasons/acceptance.test.tsx` je Saison - je Screen-Klasse nur das Erlaubte, Bühne `box-none`,
  Reduced Motion, Hintergrund, Saison aus.
- Einheitstests des Kerns: `anchors.test.js`, `quiet.test.js`, `motion.test.js`, `intensity.test.js`, `rng.test.js`
  (Web) und die gleichnamigen `.ts`-Tests der App.

## 8. Eine neue Saison anlegen

1. Modul anlegen (`frontend/src/seasons/<saison>/index.jsx`, `mobile/src/seasons/<saison>.tsx`) und im Register
   eintragen; Serverdaten (`key`, `phase`, `intensity`, `starts_at`, `ends_at`, `texts`, `data`) kommen fertig.
2. Zufall nur über `seasonRng({ season, year, route }, use)` bzw. den Jahres-Salz - nie `Math.random()` für die Anordnung.
3. Figuren an Anker hängen: Plan über `measureAnchors` + `edgeSlot`/`cornerSlot`/`pointSlot` + `freeSlots` +
   `chooseSlots` (Web) bzw. `SeasonPerch`/`Card perch` + `choosePerches` (App). Nie eigene Positionsberechnung.
4. Ruhezonen respektieren (kommen aus dem Kern); Ebenen `pointer-events: none`, nur Figuren klickbar.
5. Große Bewegungen als `EFFECTS`-Klasse anmelden und über `requestMotion` starten; Reduced Motion still.
6. Effektklassen übersetzen: Eintrag in `SEASON_CAPABILITIES` (Web) und `intensity.ts` (App).
7. Abnahme: `defineSeasonQa` im Web, `acceptance.test.tsx` in der App; Screenshots an den PR.
8. Doku: dieser Stand wird im Doku-PR nach dem Merge fortgeschrieben (CLAUDE.md §5/§9).
