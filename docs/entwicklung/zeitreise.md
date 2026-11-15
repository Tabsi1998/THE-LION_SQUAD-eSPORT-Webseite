# Zeitreise-Probe: Tests mit verstellter Uhr

Feste Termine in Testdaten werden irgendwann vom echten Kalender überholt. Der Test wird dann „von selbst“ rot,
ohne dass jemand Code geändert hat – so geschehen in #774 und am 14.11.2026 (#2418). Die Zeitreise-Probe (#775)
findet solche Zeitbomben vorher: Sie lässt die Unit-Tests so laufen, als wäre heute **in einem Monat**, **in sechs
Monaten** und **in einem Jahr**. Dabei fallen auch echte Fehler auf, etwa Fristen, die mit dem Tag des Servers statt
mit dem Wiener Tag rechnen.

## Regel für neue Tests

Ein Test darf nicht vom Tag abhängen, an dem er läuft. Termine in Testdaten deshalb

- **relativ zu heute** setzen (`datetime.now(timezone.utc) + timedelta(days=3)`, `Date.now() + 3 * TAG`), oder
- **die Uhr im Test feststellen**: Backend über einen Zeitparameter (`now=`) oder `monkeypatch`, Web mit
  `vi.useFakeTimers()` + `vi.setSystemTime(...)`, App mit `jest.useFakeTimers({ now: ... })`, Playwright mit
  `page.clock.setFixedTime(...)`.

Ein fester Termin ohne feste Uhr ist nur dann in Ordnung, wenn er weit in der Vergangenheit liegt und der Test nichts
mit „heute“ vergleicht. Wer prüfen will, ob ein Test die Regel einhält: die Probe lokal laufen lassen (unten).

Tests, die eine **echte Uhr** brauchen, weil ein Unterprozess, ein Shell-Skript oder das Dateisystem die Zeit selbst
liest (Beispiel: `backend/tests/test_restore_drill_status.py`), tragen den Marker `real_clock`:

```python
pytestmark = pytest.mark.real_clock
```

Sie laufen in der Probe nicht mit. Der Marker ist kein Ausweg für Tests, die nur feste Termine haben – die bekommen
relative Termine oder eine feste Uhr.

## Wie die Probe funktioniert

Alles hängt an der Umgebungsvariable `TLS_TEST_NOW` (ISO-Datum). Ohne sie ändert sich nichts.

| Teil | Wo | Was mit `TLS_TEST_NOW` passiert |
| --- | --- | --- |
| Backend (pytest) | `backend/tests/zeitreise.py`, eingebunden in `conftest.py` | `freezegun` (nur in `requirements-dev.txt`) stellt die Uhr vor dem Sammeln der Tests um; sie läuft ab dort weiter, asyncio behält die echte Uhr. Tests mit `real_clock` werden abgewählt. |
| Web (Vitest) | `frontend/src/setupZeitreise.js` | `Date` springt auf den Tag und läuft weiter. Fake-Timer beginnen am verstellten Tag, ein im Test gesetzter Tag gilt wie immer. |
| App (Jest) | `mobile/jest.zeitreise-env.js`, gewählt in `jest.config.js` | wie im Web; `jest.useFakeTimers()` ohne eigenes `now` beginnt am verstellten Tag. |

Die Uhr steht dabei **nie still**: Eine stehende Uhr ließe Tests kippen, die auf vergangene Zeit warten (etwa die
Spam-Sperre in `useSpamGuard`), und das wäre ein falscher Alarm.

Playwright läuft in der Probe nicht mit – zu teuer. Browser-Specs mit festen Terminen stellen die Uhr mit
`page.clock` fest oder bekommen ihre Daten aus Mocks.

## Wöchentlich auf GitHub

[`zeitreise-woche.yml`](../../.github/workflows/zeitreise-woche.yml) läuft jeden Montag um 03:30 UTC und von Hand.
Neun Jobs: Backend, Web und App, je mit der Uhr in einem Monat, in sechs Monaten und in einem Jahr. Den Zeitpunkt
rechnet `scripts/zeitreise_report.py when +6m` aus dem heutigen Datum aus.

- Kein PR-Auslöser, kein Pflicht-Check: Die Probe hält nichts auf.
- Rot auf `main`: Issue **„Zeitreise: Test kippt ab …“** mit den Testnamen und dem frühesten Probe-Tag, an dem
  jeder rot ist (Labels `testing`, `bug`, `priority:P2`, Meilenstein „Qualität: Performance, Tests und CI“).
  Weitere rote Wochen ergänzen es mit höchstens einem Kommentar je Woche.
- Geschlossen wird es erst, wenn eine volle Woche – alle Teile, alle Zeitpunkte – auf `main` grün ist.
- Von Hand auf einem Zweig gestartet, meldet die Probe nichts; das Ergebnis steht im Job-Summary.

## Lokal auf Knopfdruck

```bash
python scripts/local_check.py --only zeitreise            # alle drei Zeitpunkte, Backend, Web und App
python scripts/local_check.py --only zeitreise --zeit +6m # nur ein Zeitpunkt (+2w, +10d, +1y oder ein Datum)
```

Die Gruppe läuft nie von selbst mit, auch nicht mit `--all`. Rote Tests stehen mit Namen im Ergebnis, die ganzen
Ausgaben unter `.local-testing/logs/zeitreise-*.log`.

Einzeln geht es auch direkt:

```bash
# Backend (aus dem Repo-Stamm, CI-Umgebung wie in CLAUDE.md)
TLS_TEST_NOW=2027-05-15 python -m pytest -q backend/tests/test_beispiel.py
# Web (aus frontend/)
TLS_TEST_NOW=2027-05-15 npx vitest run src/pfad/Datei.test.jsx
# App (aus mobile/)
TLS_TEST_NOW=2027-05-15 npx jest src/pfad/Datei.test.tsx
```
