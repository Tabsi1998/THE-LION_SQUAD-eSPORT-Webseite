# Hilfe-Bereich: Bilder und Videos erzeugen

Der Hilfe-Bereich (`/hilfe`, #2295) zeigt je Schritt ein markiertes Bildschirmfoto für Handy (390 px) und PC
(1440 px), zu drei Abläufen ein kurzes Video. Nichts davon wird von Hand gemacht: `frontend/e2e/hilfe-bilder.spec.js`
spielt jeden Ablauf mit nachgestellter API und erfundenen Namen durch und fotografiert dabei.

## Wo was liegt

| Was | Wo |
| --- | --- |
| Texte, eine Datei je Thema | `frontend/src/hilfe/themen/<thema>.json` (Abschnitte → Schritte: `titel`, `text`, optional `hinweis`, `link`, `bild`) |
| Bilder | `frontend/src/hilfe/bilder/<thema>/<schritt>-handy.webp` und `-pc.webp`, Größen in `bilder/masse.json` |
| Videos | `frontend/src/hilfe/videos/<id>.webm`, am Thema unter `videos` einem Abschnitt zugeordnet |
| Abläufe und Markierungen | `frontend/e2e/hilfe-bilder.spec.js`, Kamera in `e2e/hilfe/kamera.js`, Testdaten in `e2e/hilfe/daten.js` |
| Teilen-Karte (Discord, WhatsApp) | `backend/services/help_topics.py` – Titel und Kurztext müssen wie im JSON lauten (`tests/test_help_topics.py`) |

Die Dateien laufen durch Vite und bekommen einen Hash im Namen. Neue Bilder sind deshalb sofort sichtbar, auch hinter
dem Cloudflare-Cache.

## Neu erzeugen

Im Ordner `frontend`, ohne laufendes Backend (die API ist nachgestellt). Ein eigener Port vermeidet Streit mit einem
anderen Vite-Server. Läuft `cod.exe`, nur so (headless) – es öffnet sich kein Fenster.

```powershell
$env:E2E_PORT='3295'; $env:E2E_ISOLATED='1'
# Bilder (rund 1 Minute, alle Themen, Handy und PC)
$env:HILFE_BILDER='1'; npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1
# Videos (rund 2 Minuten)
$env:HILFE_BILDER=''; $env:HILFE_VIDEOS='1'; npx playwright test e2e/hilfe-bilder.spec.js --project=chromium --workers=1 -g Video
```

`--workers=1` ist Pflicht: Die Größen in `masse.json` schreibt der Lauf am Ende einmal zusammen.

Danach `npx vitest run src/hilfe` – der Test prüft, dass jeder Schritt mit `"bild": true` beide Bilder samt Größe hat
und kein Bild übrig ist. Gesamtgröße im Blick behalten (Stand #2295: 88 Bilder rund 1,4 MB, 3 Videos rund 7 MB).

## Wenn ein Ablauf bricht

Ohne `HILFE_BILDER` läuft dieselbe Spec in der CI als normaler Test: Jeder Ablauf bei 390 und 1440 px, kein seitliches
Scrollen, und jeder Schritt mit Bild muss erreicht werden. Wird sie rot, hat sich die Oberfläche geändert (Knopf weg,
Kennung umbenannt). Dann Ablauf in der Spec anpassen, Text im JSON prüfen und die Bilder neu erzeugen.

## Neues Thema oder neuer Schritt

1. Schritt im JSON ergänzen (kurze Sätze, du-Form, nur was es wirklich gibt). Die `id` ist der Anker (`/hilfe/<thema>#<id>`),
   sie darf im Thema nur einmal vorkommen – auch nicht als Abschnitt.
2. In der Spec an der passenden Stelle `cam.shot("<id>", markierung, { area })` aufrufen. `markierung` bekommt den gelben
   Rahmen, `area` (optional) ist der Bildausschnitt.
3. Neues Thema: Datei in `themen/`, in `src/hilfe/index.js` und `backend/services/help_topics.py` eintragen, Ablauf in
   `FLOWS` der Spec.
4. Bilder erzeugen, `npx vitest run src/hilfe src/components/tls/HelpLink.test.jsx`.

„?“-Links an der Oberfläche: `<HelpLink thema="…" schritt="…" />` (`components/tls/HelpLink.jsx`). Der Test
`HelpLink.test.jsx` sucht alle Ziele im Code und prüft sie gegen die JSON-Dateien.
