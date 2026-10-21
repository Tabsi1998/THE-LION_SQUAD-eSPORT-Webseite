# Flaggen (#1925)

Landesflaggen für Termine und Rennen externer Serien – je Land eine SVG-Datei `<iso-code>.svg` (klein geschrieben,
ISO 3166-1 alpha-2), mit dem echten Seitenverhältnis der Flagge.

- **Quelle:** [hampusborgos/country-flags](https://github.com/hampusborgos/country-flags), Ordner `svg/`, Stand
  Commit `c09927e63705529bbf59ca6684cd9b23225dddad` (10.03.2026). Die Zeichnungen stammen von Wikimedia Commons.
- **Rechte:** Laut README der Quelle sind Flaggen gemeinfrei (public domain); die Dateien sind unverändert übernommen.
- **Prüfung:** `backend/tests/test_flag_files_unit.py` – jede Datei ist reine Zeichnung (kein Skript, keine
  `on…`-Attribute, kein Link oder Verweis nach außen, kein `foreignObject`, keine Schriften oder Bilder von außen),
  höchstens 60 KB (Mexiko mit Wappen: 170 KB), und ihr Seitenverhältnis steht in `frontend/src/lib/flagRatios.json`.
- **Anzeige:** `CountryFlag` zeigt jede Flagge in einem festen Kasten – gleiche Höhe, Breite nach dem Seitenverhältnis
  bis höchstens 2:1, `object-fit: contain`.

## Weiteres Land ergänzen

1. Datei aus der Quelle holen (dieselbe Commit-Nummer oder eine neuere, dann oben eintragen):
   `gh api "repos/hampusborgos/country-flags/contents/svg/<code>.svg?ref=<commit>" -H "Accept: application/vnd.github.raw" > <code>.svg`
2. Land in `backend/services/round_countries.py` (`COUNTRIES`: deutscher Name, Schreibweisen; Städte und Wörter, die
   auch Namen sind, zusätzlich in `VENUE_ONLY`) und in `frontend/src/lib/countries.json` eintragen.
3. Seitenverhältnis (Breite / Höhe aus der `viewBox`, drei Nachkommastellen) in `frontend/src/lib/flagRatios.json`.
4. `python -m pytest backend/tests/test_flag_files_unit.py backend/tests/test_round_countries_unit.py` – die Tests
   prüfen Liste, Datei, Inhalt und Seitenverhältnis.
