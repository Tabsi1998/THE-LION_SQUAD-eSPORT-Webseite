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
  für alle Ränge: Profil 260 px (auf dem Handy 200), Karte 150, Liste 92, klein (Podest) 64. In Listen und klein nur
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

Wie groß das Foto in der festen Fläche wird, rechnet `frameFit` aus `box` und Ring: so groß, dass die ganze Grafik
samt Schwingen und Krone hineinpasst, mittig. Rang 1 bekommt so 76 % der Fläche als Foto, die Ränge mit Schwingen und
Strahlen (9, 11, 12) knapp 50 %. Der Kopf ist bei jedem Rang gleich groß, nichts springt beim Rangwechsel, und kein
Rahmen überdeckt etwas daneben. In Listen trägt der Rahmen „Level n, Rang Name“ als zugänglichen Namen.
