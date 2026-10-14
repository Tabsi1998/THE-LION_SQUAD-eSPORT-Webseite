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

Der Ordner für `ABNAHME_SOURCE` sollte kein `frontend/node_modules` haben (frisch mit `git worktree add` angelegt):
Docker nimmt sonst den ganzen Ordner mit ins Bild.

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
Liga mit veröffentlichten Ergebnissen und geteiltem Platz 1 (Podest, Sieger-Moment), eine Fast Lap mit Zeiten und je ein
Vor-Ort-Turnier (live, zwei Stationen, geplant, Turnierleitung eingeteilt) für die vier Modi des Weiterkommens
(#1590): fester Baum und Auslosung nach der Runde (K.-o. 8), Show-Auslosung (FFA 16, drei von vier Läufen fertig,
Erinnerung nach 3 Min.) und sofort zufällig (K.-o. 8, noch ohne Ergebnis).
Dazu ein Mitglieder-Turnier vor Ort mit offener Anmeldung für den Vor-Ort-Zugang (#1592) und ein Gast-Konto ohne
Mitgliedschaft (`vor-ort-abnahme.spec.js`).
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
`ABNAHME_SHOTS` legt Bilder ab (optional). Anmeldungen: Die Tests merken sich die Sitzung je Konto
(`.local-testing/abnahme/sessions-…/`) und melden sich nur neu an, wenn sie nicht mehr gilt - nie zweimal mit einem
Zwei-Faktor-Code aus demselben 30-Sekunden-Fenster. So läuft auch ein großer Lauf nicht in die Sperre gegen
Rateversuche.

## Zwei Stände nebeneinander

> **Regel: Jeder PR bekommt seinen eigenen Stand – eigener Projektname (`ABNAHME_PROJECT`), eigene Ports, eigene
> Stand-Datei (`ABNAHME_STATE`). Den gemeinsamen Stand `lsw-abnahme` nie für einen anderen Zweig umbauen, solange
> jemand anderes darauf prüft:** Wer ihn neu baut, tauscht dem anderen den Code unter den Füßen aus, und dessen
> Ergebnis gilt nicht mehr (ist am 14.10. passiert). Im Zweifel: `docker ps --filter name=lsw-abnahme` zeigt, was läuft.

Prüfen zwei Leute (oder zwei Agenten) gleichzeitig, bekommt jeder seinen eigenen Stand - sonst baut einer dem anderen den
Server unter den Füßen um. Eigener Projektname, eigene Ports und Adressen, eigene Stand-Datei:

```bash
export ABNAHME_PROJECT=lsw-abnahme-2 FRONTEND_PORT=24000 BACKEND_PORT=29001   FRONTEND_URL=http://127.0.0.1:24000 PUBLIC_BACKEND_URL=http://127.0.0.1:24000 CORS_ORIGINS=http://127.0.0.1:24000   ABNAHME_STATE=$PWD/.local-testing/abnahme/state-2.json
docker compose -p $ABNAHME_PROJECT --env-file .env.abnahme.example -f docker-compose.yml -f docker-compose.abnahme.yml up -d --build
python scripts/seed_abnahme.py
cd frontend && ABNAHME=1 E2E_BASE_URL=http://127.0.0.1:24000 npx playwright test e2e/abnahme --project=chromium --workers=1
```

## 4. Stoppen

```bash
# anhalten, Daten bleiben
docker compose -p lsw-abnahme --env-file .env.abnahme.example -f docker-compose.yml -f docker-compose.abnahme.yml stop

# ganz weg, samt Testdatenbank (nur Projekt lsw-abnahme)
docker compose -p lsw-abnahme --env-file .env.abnahme.example -f docker-compose.yml -f docker-compose.abnahme.yml down --volumes
```

`down --volumes` löscht nur die Volumes des Projekts `lsw-abnahme`, nie die eines anderen Stacks.
