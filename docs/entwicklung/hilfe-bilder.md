# FAQ: Inhalte, Sichtbarkeit, Bilder und Animationen

Die FAQ (`/faq`, #2448, vorher Hilfe unter `/hilfe`, #2295) zeigt je Schritt ein markiertes Bildschirmfoto für Handy (390 px) und PC
(1440 px). Wo eine Bewegung hilft, läuft statt des Bildes eine kurze, stumme Schleife wie ein GIF (#2448); das Bild ist
dann ihr Poster. Nichts davon wird von Hand gemacht: `frontend/e2e/hilfe-bilder.spec.js` spielt jeden Ablauf mit
nachgestellter API und erfundenen Namen durch, fotografiert und nimmt dabei auf.

## Wo was liegt

| Was | Wo |
| --- | --- |
| Texte, eine Datei je Thema | `frontend/src/hilfe/themen/<thema>.json` (Abschnitte → Schritte: `titel`, `text`, optional `hinweis`, `link`, `bild`, `clip`) |
| Bilder (auch Poster der Schleifen) | `frontend/src/hilfe/bilder/<thema>/<schritt>-handy.webp` und `-pc.webp`, Größen in `bilder/masse.json` |
| Schleifen (`"clip": true`) | `frontend/src/hilfe/clips/<thema>/<schritt>-handy.webm` und `.mp4`, ebenso `-pc` |
| Anzeige | `frontend/src/hilfe/FaqClip.jsx` (Gerätewahl, Laden im Bild, Anhalten, „Bewegung reduzieren“) |
| Abläufe und Markierungen | `frontend/e2e/hilfe-bilder.spec.js`, Kamera in `e2e/hilfe/kamera.js`, Aufnahme in `e2e/hilfe/clips.js`, Testdaten in `e2e/hilfe/daten.js` |
| Öffentliche Fragen | `frontend/src/hilfe/fragen.json` (`frage`, `antwort`, `bereich`, `rollen`, `sichtbar_fuer: "alle"`, optional `haeufig`, `link`) |
| Bereiche der FAQ | `frontend/src/hilfe/bereiche.json` (`titel`, `kurz`, `icon`, `rollen`, `sichtbar_fuer`) |
| Geschützte Fragen (Mitglieder, Turnierleitung) | `backend/services/faq_protected.py`, ausgeliefert von `GET /api/faq` erst nach Rechteprüfung |
| Adressen und Weiterleitung | `frontend/src/hilfe/pfade.js` (`/hilfe` → `/faq`), dieselbe Regel als 301 in `frontend/nginx.conf` |
| Teilen-Karte (Discord, WhatsApp) | `backend/services/help_topics.py` – Titel und Kurztext müssen wie im JSON lauten (`tests/test_help_topics.py`) |

Die Dateien laufen durch Vite und bekommen einen Hash im Namen. Neue Bilder sind deshalb sofort sichtbar, auch hinter
dem Cloudflare-Cache.

## Inhaltsmodell und Sichtbarkeit (#2448)

Jede Frage und jede Anleitung trägt einen `bereich` (aus `bereiche.json`), `rollen` für den Filter (`spieler`,
`captain`, `mitglied`, `turnierleitung`) und `sichtbar_fuer` (`alle`, `angemeldet`, `mitglied`, `turnierleitung`,
`turnierleitung_verwaltung`). Ein Abschnitt einer Anleitung kann mit eigenem `bereich` zusätzlich in einem zweiten
Bereich stehen (Benachrichtigungen, Turniertag vor Ort). Die `rollen` eines Bereichs entsprechen denen seines Inhalts
(Test in `index.test.js` und `test_faq_visibility_flow.py`).

- **Öffentlich (`alle`)** steht im Frontend-Bundle. Ein Test (`src/hilfe/index.test.js`) lässt dort nichts anderes zu.
- **Alles andere** steht nur in `backend/services/faq_protected.py`. `GET /api/faq` gibt Mitglieder-Fragen nur an
  Vereinsmitglieder (`sees_member_content`). `turnierleitung` sieht, wer die Leitungsansicht eines Turniers öffnen darf:
  Bereich Turnierleitung samt Zwei-Faktor (`can_use_area(…, "tournaments")`), ein aktiver Helfer-Einsatz
  (`tournament_staff_assignments`) oder die Liga-Leitung (Bereich Ligen oder eine Zuständigkeit, mit Zwei-Faktor).
  `turnierleitung_verwaltung` – Fragen mit Weg über die Verwaltung – nur der Bereich Turnierleitung. Gäste bekommen eine
  leere Liste. Tests: `backend/tests/test_faq_visibility_flow.py`.
- **Das Repository ist öffentlich.** Auch `faq_protected.py` liest jeder auf GitHub. Dort gehört nur Bedienung hinein,
  nichts Vertrauliches (keine Zugänge, keine internen Abläufe, keine Namen). Die Prüfung am Server regelt nur, wem die
  Seite eine Frage zeigt.
- Bereiche ohne Inhalt stehen als „Kommt bald“ in der Liste; mit Rollen-Filter fallen leere Bereiche weg. Geschützte
  Bereiche sieht nur, wer sie sehen darf.
- „Häufige Fragen“ sind Fragen mit `"haeufig": true` – öffentlich höchstens zehn, dazu je eine für Mitglieder und Leitung.

## Neu erzeugen

Im Ordner `frontend`, ohne laufendes Backend (die API ist nachgestellt). Ein eigener Port vermeidet Streit mit einem
anderen Vite-Server. Läuft `cod.exe`, nur so (headless) – es öffnet sich kein Fenster.

```powershell
$env:E2E_PORT='3295'; $env:E2E_ISOLATED='1'
# Bilder der Schritte ohne Schleife (rund 1 Minute, alle Themen, Handy und PC)
$env:HILFE_BILDER='1'; npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
# Schleifen samt ihrem Poster (rund 7 Minuten; braucht ffmpeg im PATH oder FFMPEG=<pfad>)
$env:HILFE_BILDER=''; $env:HILFE_CLIPS='1'; npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
# nur ein Thema: zusätzlich -g "turniere:"
```

`--workers=1` ist Pflicht: Die Größen in `masse.json` schreibt der Lauf am Ende einmal zusammen. Am Ende listet der
Lauf jede Schleife mit Länge, Ausschnitt und Dateigröße.

Danach `npx vitest run src/hilfe` – der Test prüft, dass jeder Schritt mit `"bild": true` beide Bilder samt Größe hat,
jeder mit `"clip": true` Handy und PC als WebM und MP4, keine Datei übrig ist und keine Schleife die Grenze
überschreitet. Gesamtgröße im Blick behalten (Stand #2448: 88 Bilder rund 1,4 MB, 24 Schleifen in 96 Dateien rund
4,3 MB; die drei langen Videos aus #2295 mit rund 7 MB sind dafür weggefallen).

## Schleifen wie ein GIF (#2448)

- **Welche Schritte:** Nur wo eine Bewegung etwas zeigt: ankreuzen, eintippen, ein Fenster oder Menü öffnen, Plus
  drücken, einen Weg aufleuchten lassen. Reine Zustände (ein Knopf, eine Karte, ein Stand) bleiben Bild. Im JSON
  `"clip": true` setzen und in der Spec `cam.clip` statt `cam.shot` aufrufen, etwa
  `await cam.clip("<id>", markierung, async (act) => { await act.click(knopf); await act.type(feld, "Text"); }, { area, start, block })`.
  Ohne `HILFE_CLIPS` sind die Handgriffe schlichte Klicks und Eingaben, der Ablauf bleibt ein normaler Test.
- **Aufnahme:** Die Seite läuft in derselben Größe wie die Bilder (Handy 390 × 844 mit Pixeldichte 2, PC 1440 × 900).
  `e2e/hilfe/clips.js` holt nebenher Bild um Bild über `Page.captureScreenshot` und merkt sich die Zeit (die
  Bildschirm-Übertragung von Chromium liefert ohne Fenster nur Pixeldichte 1). Ablauf: `start` an die Stelle `block`
  scrollen, Kopfzeile und Leisten unsichtbar machen (`keepBars` lässt sie, etwa für das Menü), 0,6 s Ruhe, Handgriffe
  mit Tipp-Punkt (am PC gleitet er, am Handy erscheint er wie ein Finger), Punkt ausblenden, Ausschnitt des Endstands
  vermessen, gelben Rahmen einblenden, 1,5 s halten. Das Poster ist genau dieser Haltezustand im selben Ausschnitt.
- **Scrollt die Seite während der Aufnahme**, bricht sie ab, sonst wäre der Anfang der Schleife verrutscht. Dann
  `start` und `block` (`"start"`, `"center"`) so wählen, dass Anfang und Ende ins Bild passen. Scroll-Verankerung des
  Browsers (oben wächst etwas, der Start bleibt im Fenster stehen) ist erlaubt.
- **Größen:** 2 bis 6 Sekunden (längere Abläufe werden schneller abgespielt), 15 Bilder je Sekunde, kein Ton, Größe
  des Posters (ungerade Pixel werden mit der Seitenfarbe auf gerade aufgefüllt). Grenze **300 KB je Datei**
  (`MAX_BYTES` in `e2e/hilfe/clips.js`, `CLIP_MAX_BYTES` im Test `src/hilfe/index.test.js`) und **8 MB für alle
  zusammen** (`CLIPS_TOTAL_MAX_BYTES`). MP4 mit H.264 High, Level 4.0, höchstens 4 Referenzbilder. Ist eine Datei zu groß, komprimiert die Aufnahme stärker;
  bleibt sie zu groß, schlägt sie fehl. Dann den Ausschnitt verkleinern oder die Handgriffe kürzen.
- **ffmpeg:** Je Schleife ein Aufruf je Format. Die Bilder kommen als Concat-Liste mit Dauer je Bild, der Ausschnitt
  wird auf die Pixeldichte umgerechnet, am Ende blendet die Schleife 0,4 s ins erste Bild über (läuft ohne Sprung):

  ```bash
  ffmpeg -f concat -safe 0 -i liste.txt -loop 1 -framerate 15 -t 0.6 -i f00000.jpg \
    -filter_complex "[0:v]crop=W:H:X:Y,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:0x0F0F10,fps=15,format=yuv420p,setsar=1,settb=AVTB[a];[1:v]crop=W:H:X:Y,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:0x0F0F10,fps=15,format=yuv420p,setsar=1,settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.4:offset=LAENGE-0.4,format=yuv420p[v]" \
    -map "[v]" -an -pix_fmt yuv420p -t LAENGE \
    -c:v libvpx-vp9 -b:v 0 -crf 42 -row-mt 1 -deadline good -cpu-used 2 schritt-handy.webm
  # MP4 statt der letzten Zeile: -c:v libx264 -preset veryslow -crf 30 -profile:v high -level:v 4.0 -refs 4 -movflags +faststart schritt-handy.mp4
  ```

- **Anzeige (`FaqClip`):** `<video muted loop playsinline preload="none">` mit dem Bild als Poster; WebM (VP9), wenn
  der Browser es kann, sonst MP4 (H.264). Die Handy-Fassung gilt bei `(max-width: 767px), (pointer: coarse) and
  (max-width: 1023px)` (`HANDY_QUERY` in `src/hilfe/index.js`), ohne User-Agent; ändert sich die Breite, wechselt die
  Fassung. Bis der Schritt zu einem Viertel im Bild ist, steht nur das Bild da (`loading="lazy"`), erst dann entsteht
  das Video. Außerhalb des Bildes hält es an. Unten rechts ein Knopf zum Anhalten und Abspielen; lehnt der Browser das
  automatische Abspielen ab (Stromsparen), zeigt er **Abspielen** und startet direkt im Klick. Bei „Bewegung
  reduzieren“ nur das Bild mit **Abspielen**. Bricht WebM ab, kommt MP4; geht keins, bleibt das Bild. Ohne
  IntersectionObserver startet nichts von selbst, **Abspielen** geht trotzdem. `muted` steht für iOS auch als Attribut.
  Der Schritttext beschreibt den Inhalt, das Video trägt nur ein kurzes Label (`Animation: <Titel>`).
- **Nicht im Start:** Die Adressen holt `import.meta.glob(…, { query: "?url" })` nur in `src/hilfe/index.js`, das allein
  die nachgeladenen FAQ-Seiten einbinden. `npm run check:bundle` schlägt fehl, wenn eine Datei des Starts auf ein Video
  verweist oder `index.html` eins vorab lädt.

## Wenn ein Ablauf bricht

Ohne `HILFE_BILDER` läuft dieselbe Spec in der CI als normaler Test: Jeder Ablauf bei 390 und 1440 px, kein seitliches
Scrollen, und jeder Schritt mit Bild muss erreicht werden. Wird sie rot, hat sich die Oberfläche geändert (Knopf weg,
Kennung umbenannt). Dann Ablauf in der Spec anpassen, Text im JSON prüfen und Bilder bzw. Schleifen neu erzeugen.

## Neues Thema oder neuer Schritt

1. Schritt im JSON ergänzen (kurze Sätze, du-Form, nur was es wirklich gibt). Die `id` ist der Anker (`/faq/<thema>#<id>`),
   sie darf im Thema nur einmal vorkommen – auch nicht als Abschnitt.
2. In der Spec an der passenden Stelle `cam.shot("<id>", markierung, { area })` aufrufen. `markierung` bekommt den gelben
   Rahmen, `area` (optional) ist der Bildausschnitt.
3. Neues Thema: Datei in `themen/`, in `src/hilfe/index.js` und `backend/services/help_topics.py` eintragen, Ablauf in
   `FLOWS` der Spec.
4. `node scripts/hilfe-anker.mjs` (schlanker Index `src/hilfe/anker.json` für die „?“-Links), Bilder erzeugen,
   `npx vitest run src/hilfe src/components/tls/HelpLink.test.jsx`.

„?“-Links an der Oberfläche: `<HelpLink thema="…" schritt="…" />` (`components/tls/HelpLink.jsx`). Der Test
`HelpLink.test.jsx` sucht alle Ziele im Code und prüft sie gegen die JSON-Dateien.

Alte Links `/hilfe/<thema>#<schritt>` bleiben gültig: Der Wächtertest in `src/hilfe/umleitung.test.jsx` schickt jeden
Eintrag aus `anker.json` durch die Weiterleitung und prüft, dass der Schritt auf der neuen Seite steht.
