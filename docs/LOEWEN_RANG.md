# Löwen-Rang

Level 1–60 sind in 12 Ränge zu je fünf Level geteilt (Rang 12 = 55–60). Der Rang-Name ist zugleich der Titel:
Abzeichen, XP-Balken, Profil, App und Mails zeigen überall denselben Namen. Nach Level 60 zählt Prestige (bis zu fünf
Sterne am Level-Schild), der Rahmen bleibt der Löwenkönig.

| Rang | Level | Name | Rahmen |
| --- | --- | --- | --- |
| 1 | 1–4 | Jungtier | Stahlring, Pfote |
| 2 | 5–9 | Fährte | Stahl, Krallenspuren |
| 3 | 10–14 | Rudel | Eisen, Löwenwappen |
| 4 | 15–19 | Jäger | Bronze, zwei Löwenköpfe |
| 5 | 20–24 | Silbermähne | Silber, Mähnenzacken |
| 6 | 25–29 | Goldmähne | Gold-Mähne |
| 7 | 30–34 | Löwenhaupt | großer Löwenkopf |
| 8 | 35–39 | Brüller | Löwe mit offenem Maul |
| 9 | 40–44 | Schwingen | Löwenschwingen |
| 10 | 45–49 | Obsidian | Schwarz-Gold, Lava-Risse |
| 11 | 50–54 | Sonnenlöwe | Sonnenmähne |
| 12 | 55–60 | Löwenkönig | Krone, Schwingen, Cyan-Flammen |

## Wo es steht

- Backend: `backend/services/levels.py` (`RANK_NAMES`, `rank_for_level`, `rank_view`). Der Level-Payload trägt
  `rank`, `rank_name`, `rank_from`, `rank_to` und `step` (Level innerhalb des Rangs).
- Web: `frontend/src/lib/loewenRang.js` (dieselben Namen, ein Test vergleicht sie mit dem Backend) und der Profilrahmen
  `frontend/src/components/tls/LevelAvatarFrame.jsx`. Jede Größe hat eine feste Fläche für Rahmen und Foto, gleich
  für alle Ränge: Profil 285 px (auf dem Handy 220), Karte 150, Liste 92, klein (Podest) 64. In Listen und klein nur
  die Grafik, ohne Glanz und Schild; mit „Bewegung reduzieren“ blendet der Glanz nur ein und aus.

## Rahmen-Grafiken

Herkunft: Die 12 Rahmen hat der Verein THE LION SQUAD für sich erzeugt (KI-Bildwerkzeug nach eigenen Vorgaben, Farben
Schwarz, Gold, Cyan). Sie gehören zum Auftritt des Vereins und stehen nicht unter der Lizenz des Codes. Die Originale
(1024 × 1024 PNG mit Transparenz) liegen beim Betreiber, im Repository nur die verkleinerten WebP-Fassungen:

- `frontend/public/assets/loewen-rang/` und `mobile/assets/loewen-rang/`: `rang-NN-160|320|640.webp` und
  `geometry.json` (Mitte `cx`/`cy` und Radius `r` des Lochs als Anteil der Kantenlänge, `box`: wie weit die
  Grafik reicht, rund 400 Punkte der Außenkante für Effekte, Prüfsumme `v`).
- `frontend/src/lib/loewenRangRing.json`: Mitte, Radius, `box` und Prüfsumme für den Rahmen im Web.

Neu erzeugen (Pillow mit WebP):

```bash
python scripts/loewen_rang_assets.py --src <Ordner mit rang-01.png … rang-12.png>
```

Die Grafiken sind nicht genau mittig gezeichnet (bis 5 % Versatz, der Löwenkopf ragt oben ins Loch). Der Rahmen wird
deshalb so skaliert und verschoben, dass der gemessene Ring auf dem runden Foto liegt: Kantenlänge `F = P / r`,
Versatz `((0,5 − cx) · F, (0,5 − cy) · F)` bei Foto-Radius `P`. Die Prüfsumme hängt als `?v=` an der Bildadresse,
damit nach einem Austausch kein alter Rahmen aus dem 30-Tage-Cache kommt.

Wie groß das Foto in der festen Fläche wird, rechnet `frameFit` aus `box` und Ring: so groß, dass die Grafik seitlich
und unten hineinpasst; oben dürfen Krone und Schwingen bis 15 % der Fläche hinausragen (in Banner oder Hintergrund,
der Rahmen nimmt keine Klicks an). Rang 1 bekommt so 81 % der Fläche als Foto, die Ränge mit Schwingen und Strahlen bis
an beide Bildränder (9, 11, 12) knapp 50 %. Der Kopf ist bei jedem Rang gleich groß, nichts springt beim Rangwechsel,
und seitlich überdeckt kein Rahmen etwas daneben. In Listen trägt der Rahmen „Level n, Rang Name“ als zugänglichen Namen.

## Signatur je Rang (#1455)

Jeder Rang hat ein eigenes Element, das mit jedem Level im Rang mehr wird - nur im Profilkopf, nicht in Karten und
Listen. Stärke `k = (Level − erstes Level) / (letztes Level − erstes Level)`: Beim ersten Level eines Rangs glänzt nur
der Rahmen, danach kommen die Ebenen der Signatur nacheinander dazu (`SIGNATURE_LAYERS` in
`frontend/src/lib/loewenSignatur.js`). Beispiel Löwenkönig: 55 Glanz, 56 kleine Cyan-Flammen, 57 Knistern,
58 Gewitterwolken, 59 Blitze, 60 volles Sturmfeuer.

| Rang | Signatur |
| --- | --- |
| 1 Jungtier | Staub, Funkenschlag aus der Pfote |
| 2 Fährte | Pfotenspuren, ab Level 8 in Cyan |
| 3 Rudel | Glut aus dem Wappen |
| 4 Jäger | Bronzefunken, Krallenhiebe |
| 5 Silbermähne | Mondlicht, Frost, Schnee |
| 6 Goldmähne | Goldstaub-Wirbel, Goldströme |
| 7 Löwenhaupt | Feuer Orange/Gold |
| 8 Brüller | Schallwellen aus dem Maul |
| 9 Schwingen | fallende Lichtfedern |
| 10 Obsidian | Rauch, glühende Risse, Glutregen |
| 11 Sonnenlöwe | Sonnenstrahlen, Lichtblitze |
| 12 Löwenkönig | Sturmfeuer: Cyan-Flammen, Gewitter, Blitze |

Umsetzung: `LevelAvatarFrame` lädt `LoewenRangSignature.jsx` erst bei Bedarf (dynamischer Import). Zwei Leinwände um die
Fläche: hinten Licht, Nebel, Wolken und Strahlen (hinter Foto und Rahmen), vorne Funken, Flammen und Blitze - dort
bleibt der Fotokreis ausgespart, kein Effekt liegt über dem Gesicht. Partikel starten an den Außenkanten-Punkten aus
`geometry.json` (einmal je Sitzung geladen). Höchstens 240 Partikel, Pixeldichte höchstens 1,5, keine Klicks; die
Schleife läuft nur, solange die Seite sichtbar und der Kopf im Bild ist. Mit „Bewegung reduzieren“ gibt es keinen
Effekt. Farben: Schwarz, Gold, Cyan und die Materialfarben der Ränge (Stahl, Bronze, Frost hellblau, Feuer orange).

## Kronen der Punktewertung (#1458)

Platz 1–3 (Gold, Silber, Bronze) und die Onyx-Krone ab Level 30 sitzen klein über der Oberkante der Grafik, ohne
Dauer-Leuchten: 11,5 % der Fläche, mindestens 14 px (Profil 33 px). Die Level-30-Krone hieß früher „Obsidian“; der Name
gehört jetzt Rang 10. Die API liefert `onyx`, das Web versteht ältere Antworten mit `obsidian` weiter.
