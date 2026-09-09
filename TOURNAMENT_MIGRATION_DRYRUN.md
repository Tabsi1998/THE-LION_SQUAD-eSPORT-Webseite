# Turnier-Migration: Trockenlauf

Bevor die gespeicherten Turniere auf eine Engine zusammengeführt werden, wird
gemessen statt vermutet. Dieses Werkzeug liest den Bestand, beschreibt ihn und
legt eine Vergleichsbasis an — es schreibt nichts.

## Warum das vor der Migration kommt

Eine Migration schreibt neue Match-Dokumente. Die IDs ändern sich dabei, also
kann man nicht über IDs vergleichen. Verglichen wird deshalb der **Inhalt**: wer
hat in welcher Runde gegen wen gespielt, wer hat gewonnen, was sagt die Tabelle,
wer steht auf welchem Platz. Das ist zugleich genau das, was ein Mitglied sehen
würde — wenn das gleich bleibt, hat sich für niemanden etwas geändert.

## Ausführen

Im Verzeichnis der `docker-compose.yml` auf dem Server:

```bash
bash scripts/tournament-dryrun.sh                # Bericht in die Konsole
bash scripts/tournament-dryrun.sh vorher.json    # zusätzlich als JSON ablegen
```

Der zweite Aufruf legt die **Vergleichsbasis** an. Ohne ihn gibt es später
nichts zu vergleichen — der Bericht in der Konsole allein wird nicht
gespeichert.

**Warum ein Wrapper und nicht direkt `python3`:** MongoDB hat bewusst keinen
veröffentlichten Port und ist nur im Docker-Netz erreichbar. Auf dem Host gibt es
also weder eine Verbindung noch die Python-Abhängigkeiten des Backends. Der
Wrapper startet den Lauf deshalb im Backend-Container, der beides schon hat.

Das Skript kann nicht schreiben. Die Datenbankhülle lässt Schreibmethoden gar
nicht erst durch — ein Schreibversuch bricht mit einem Fehler ab, statt
ausgeführt zu werden. Das ist eine Eigenschaft des Codes, nicht ein Versprechen
im Kommentar, und wird mitgetestet.

### Direkter Aufruf

Wer das Skript selbst startet (etwa lokal gegen eine Kopie), braucht `MONGO_URL`
und `DB_NAME` in der Umgebung:

```bash
python3 scripts/tournament-migration-dryrun.py --out vorher.json
```

| Schalter | Wofür |
| --- | --- |
| `--tournament <id\|slug>` | Nur ein einzelnes Turnier ansehen |
| `--limit N` | Nur die ersten N Turniere (für einen schnellen Blick) |
| `--out datei.json` | Bericht als JSON ablegen |
| `--json` | JSON nach stdout, Bericht nach stderr — für Umleitung in eine Datei |
| `--compare vorher.json` | Gegen eine frühere Aufnahme vergleichen |

## Was im Bericht steht

**Mängel** sind Defekte in einzelnen Turnieren, die jemand vor der Migration
anfassen muss:

| Code | Bedeutung |
| --- | --- |
| `mixed_source` | Echte Spiele liegen in beiden Speichern |
| `open_matches` | Spiele sind offen oder angefochten |
| `decided_without_winner` | K.-o.-Spiel abgeschlossen, aber ohne eindeutigen Sieger |
| `result_without_participants` | Entschiedenes Spiel ohne Teilnehmer (Altlast) |
| `graph_issues` | Die Strukturprüfung meldet einen kaputten Turnierbaum |
| `external_format` | Format läuft nicht über die Turnier-Engines (Zeitfahren, Grand Prix) |

**Hinweise** sind getrennt aufgeführt, weil sie fast jedes klassische Turnier
betreffen und **eine** Entscheidung brauchen statt fünfzig Einzelkorrekturen:

| Code | Bedeutung |
| --- | --- |
| `explicit_placements_would_be_replaced` | Das Turnier hat feste Platzierungen (`final_position`), die nach der Migration aus der Tabelle abgeleitet würden |
| `placements_would_appear` | Das Turnier hat heute keine Platzierungen und bekäme nach der Migration welche |

### Zum Platzierungs-Hinweis

Das ist der wichtigste Fund des Trockenlaufs, und er ist beim Bauen des
Werkzeugs aufgefallen: Die beiden Engines beantworten die Frage „wer ist Erster"
unterschiedlich.

- **Klassisch:** aus dem historischen Feld `final_position` — und gar nicht, wenn
  das Feld leer ist. Geschrieben wird es nirgends mehr, nur noch gelesen.
- **Graph:** immer aus der Tabelle abgeleitet.

Platzierungen hängen an **Preisen, der Turnier-Historie im Mitgliederprofil, den
Sieger- und Podest-Abzeichen und den Saisonpunkten**. Eine Migration, die die
Quelle stillschweigend umstellt, würde alle vier für längst beendete Turniere neu
beantworten. Deshalb steht die Entscheidung darüber vor der Migration und nicht
danach.

## Speicher insgesamt

Am Ende zählt der Bericht beide Speicher komplett durch — Entwürfe und
verwaiste Spiele eingeschlossen. Die Turnierliste beantwortet „muss etwas
umziehen"; diese Zählung beantwortet die andere Frage: **liegt im klassischen
Speicher überhaupt noch etwas**, das seiner Stilllegung im Weg steht.

| Zustand | Bedeutung |
| --- | --- |
| `empty` | Der klassische Speicher ist leer |
| `drafts_only` | Nur Entwürfe, keine gespielten Partien — die halten niemanden auf |
| `in_use` | Es liegen echte Partien darin |

Verwaiste Spiele — solche, deren Turnier es nicht mehr gibt — verhindern die
Stilllegung ebenfalls, auch wenn sonst nichts gespielt wurde. Ungeklärtes
schaltet man nicht einfach ab.

## Nach der Migration

Denselben Lauf noch einmal, gegen die Vorher-Aufnahme:

```bash
bash scripts/tournament-dryrun.sh nachher.json vorher.json
```

Der Exit-Code ist `0`, wenn jedes Turnier denselben Fingerabdruck hat, und `1`,
wenn eines abweicht — dann wird pro Turnier aufgeführt, was sich unterscheidet.

## Datenschutz

Der Bericht enthält Turniertitel, Slugs und Anmelde-IDs. **Keine Mitgliedsnamen,
keine E-Mail-Adressen** — das wird mitgetestet. Er ist damit teilbar, ohne
Mitgliederdaten weiterzugeben.
