# Abnahme lokal: echter Server mit Testdaten

Ein eigener Stand auf dem eigenen Rechner, damit man eine Änderung **im echten Browser gegen den echten Server**
durchklicken kann, bevor sie auf lionsquad.at kommt. Er läuft in Docker neben allem anderen: eigener Projektname
`lsw-abnahme`, eigene Container, eigene Datenbank, eigene Ports (Web `23000`, Backend `28001`). Er enthält nur
Testkonten und Testwerte (`.env.abnahme.example`) – keine echten Geheimnisse, keine echten Mitglieder, nie
Produktion.

Voraussetzungen: Docker Desktop läuft (`docker info`), Python 3.11, Node 24 mit den Paketen in `frontend/`.

## 1. Starten

Aus dem Repo-Ordner. Ohne `ABNAHME_SOURCE` wird der Stand dieses Ordners gebaut; mit `ABNAHME_SOURCE` jeder andere
Ordner – etwa ein zweiter Worktree mit dem Zweig eines PRs, ohne den eigenen umzuschalten:

```bash
# Stand dieses Ordners
docker compose -p lsw-abnahme --env-file .env.abnahme.example \
  -f docker-compose.yml -f docker-compose.abnahme.yml up -d --build

# Stand eines PR-Zweigs, z. B. in einem eigenen Ordner ausgecheckt
git worktree add --detach ../lsw-pr origin/<zweig>
ABNAHME_SOURCE=../lsw-pr docker compose -p lsw-abnahme --env-file .env.abnahme.example \
  -f docker-compose.yml -f docker-compose.abnahme.yml up -d --build
```

Fertig, wenn `http://127.0.0.1:23000/health` antwortet. Zeitgesteuerte Läufe (Mails, Erinnerungen, Statuswechsel)
sind aus; was die Testdaten brauchen, stößt der Seed selbst an.

## 2. Befüllen

```bash
python scripts/seed_abnahme.py
```

Das Skript läuft im Backend-Container und legt über die echten Routen an: Admin, Turnierleitung, Helfer, 16 Spieler,
ein Spiel (Mario Kart 8, Grand Prix 12 Min.), den Vor-Ort-Cup (FFA 16, Winner und Loser Bracket, Gegner gemischt,
4 Stationen) einmal mit Vorschau-Baum und einmal nach dem Check-in-Ende (Plan übernommen, live, zwei Läufe gewertet,
einer läuft), ein Online-Turnier, eine Liga (erster Spieltag gespielt), ein Gruppen-Turnier (2 Gruppen), eine beendete
Liga mit veröffentlichten Ergebnissen und geteiltem Platz 1 (Podest, Sieger-Moment) und eine Fast Lap mit Zeiten.
Spieler 1 spielt überall mit und ist der Spieler-Zugang der Tests. Es lässt sich mehrfach aufrufen: Konten
bleiben, Turniere kommen dazu.

Die Testzugänge stehen nur im Skript. Für die Browser-Tests schreibt es Kennungen und Zugänge nach
`.local-testing/abnahme/state.json` (nicht im Repo). Zum Anmelden von Hand: E-Mail und Passwort aus dem Skript,
den Zwei-Faktor-Code erzeugt jede Authenticator-App aus dem Test-Geheimnis im Skript.

## 3. Durchklicken lassen

```bash
cd frontend
ABNAHME=1 E2E_BASE_URL=http://127.0.0.1:23000 ABNAHME_SHOTS=../../lsw-art/screens/abnahme \
  npx playwright test e2e/abnahme --project=chromium --workers=1
```

`e2e/abnahme/` spricht mit dem echten Server – keine nachgestellte API. `matchplan-abnahme.spec.js`: je Rolle (Admin,
Turnierleitung) und Turnier (vor Ort mit Vorschau-Baum, vor Ort live, online, Liga): Matchplan öffnen, dreimal
zwischen „Matchplan“ und „Spiele“ wechseln, die Ansicht bleibt stehen; „Spiele“ ohne die alte Planung; keine
Konsolenfehler und keine Antwort 4xx/5xx. `tables-schedule-abnahme.spec.js`: Rangliste (Liga, Gruppen), Spielplan
(nach Runden, nach Stationen, „Nur meine Spiele“), Podest und Sieger-Moment – nicht angemeldet, als Spieler und als
Admin, bei 1440 und 375 px. Ohne `ABNAHME=1` überspringt der normale Testlauf diese Tests.
`ABNAHME_SHOTS` legt Bilder ab (optional).

## 4. Stoppen

```bash
# anhalten, Daten bleiben
docker compose -p lsw-abnahme --env-file .env.abnahme.example -f docker-compose.yml -f docker-compose.abnahme.yml stop

# ganz weg, samt Testdatenbank (nur Projekt lsw-abnahme)
docker compose -p lsw-abnahme --env-file .env.abnahme.example -f docker-compose.yml -f docker-compose.abnahme.yml down --volumes
```

`down --volumes` löscht nur die Volumes des Projekts `lsw-abnahme`, nie die eines anderen Stacks.
