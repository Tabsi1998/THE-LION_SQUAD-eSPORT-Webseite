# Inventar der oeffentlichen Routen

Dieses Dokument ist der Deployment-Vertrag fuer oeffentliche, private, kanonische und alte Website-URLs. Die Anwendung laeuft hinter einem aeusseren Reverse Proxy, der HTTPS terminiert. Dieser Proxy muss den oeffentlichen `Host` bewahren, einen vertrauenswuerdigen `X-Forwarded-Proto`-Wert setzen und Pfade unveraendert an den Frontend-Container weiterreichen. Redirects bleiben in `frontend/nginx.conf`, damit dieselben Regeln unabhaengig vom eingesetzten Proxy-Produkt gelten.

## Kanonische indexierbare Routen

Statische Routen in der XML-Sitemap:

| Zweck | Kanonische Route |
| --- | --- |
| Start und Verein | `/`, `/about`, `/board`, `/contact` |
| Inhalte | `/news`, `/events`, `/galerie`, `/references` |
| eSports | `/esports`, `/tournaments`, `/fastlap` |
| Community und Verein | `/teams`, `/servers`, `/members`, `/membership/join` |
| Unterstuetzung | `/sponsors`, `/partners` |

Dynamische Sitemap-Routen sind auf veroeffentlichte/oeffentliche Datensaetze begrenzt:

- `/news/<slug>`
- `/events/<slug>`
- `/tournaments/<slug>` sowie `/bracket`, `/matches` und `/standings`
- `/fastlap/<slug>`
- `/seasons/<slug>`
- `/members/<slug>` fuer offizielle Vereinsprofile
- `/teams/<id>`
- `/references/<id>`
- `/galerie/<slug>`
- `/liga` und `/liga/<liga>/<season>` - nur Seasons mit Sichtbarkeit `public`; `/liga` nur, wenn es mindestens eine gibt
- `/liga/<liga>/<season>/regeln` (#1646) - nur Seasons mit Sichtbarkeit `public`, die ein Regelwerk haben (eigenes oder das der Liga)
- `/liga/<liga>/<season>/spieltage` und `/liga/<liga>/<season>/teams` (#2268) - nur Seasons mit Sichtbarkeit `public`, sobald eine Staffel über den Entwurf hinaus ist

`backend/routes/setup_routes.py` verwaltet die statische Sitemap-Liste und wendet Veroeffentlichungs-/Sichtbarkeitsfilter auf dynamische Datensaetze an. Die Slug-Historie leitet auf den aktuellen kanonischen Slug weiter.

Liga (docs/LIGA.md, #1622): Eine Staffel ist ein Turnier und folgt den Regeln von `/tournaments/<slug>` - in der Sitemap nur, solange sie oeffentlich und kein Entwurf ist (Season-Sichtbarkeit `public`). Die Liga selbst liest die Website ueber `GET /api/leagues` und `GET /api/leagues/<liga>/<season>`; beide liefern nur Seasons, die die Person nach `league_seasons.visibility` sehen darf (`off` antwortet 404), dazu `GET /api/leagues/<liga>/<season>/staffeln/<staffel>` (Tabelle, Spielwochen, Ergebnisse - nur sichtbare Staffeln). Die Ligaseite `/liga/<liga>/<season>` (P5, #1625) ist bei `members` erreichbar, aber `noindex` mit neutraler Vorschau; bei `admins` und `off` liefert die Vorschau 404 und die Seite sagt „Liga nicht gefunden“. Der Menüpunkt „Liga“ erscheint nur, wenn die Lese-API der Person eine Season zeigt.

Season-Seite mit Unterseiten (#2268): `/liga/<liga>/<season>/spieltage` (Spielplan je Staffel, Woche in `?staffel=…&woche=…`) und `/liga/<liga>/<season>/teams` lesen dieselben Routen und folgen derselben Sichtbarkeit; die Vorschau hat eigene Adresse und eigenen Titel (`noindex` bei `members`, 404 bei `admins`/`off`). Neue öffentliche Felder, alle additiv: `GET /api/leagues/<liga>/<season>` trägt in `season` `result_rules` (je Modus nur die Regel: Art, Ziel, Grenze, Zeit, Verlängerung, Remis - keine Einstellungen der Verwaltung) und `schedule_rules` (72-h-Regel und Verschiebung; Erinnerung und „überfällig“ bleiben intern); `GET …/staffeln/<staffel>` trägt je Team `logo_url` (das Logo der Teamseite, nur bei Teams mit `is_public` nicht `false`, sonst `null`). Grund eines Punktabzugs, Verfahren und Vorfälle stehen in keiner dieser Antworten. Auch der Grund einer Map-Wiederholung (`games[].replay_reason`) steht in keiner öffentlichen Antwort (Ligaseite, Staffel, `GET /api/matches/<id>`, Matchseite für Fremde) - nur im Block `league` der Matchseite für die beiden Teams und die Leitung.

Saisonabschluss (docs/LIGA.md, F.1 #1645): keine neue öffentliche Route. `GET /api/leagues/<liga>/<season>/staffeln/<staffel>` trägt zusätzlich `staffel.final` (`null`, solange gespielt wird): Fassung, Zeitpunkt des Abschlusses, Meister (Anzeigename des Teams), die Entscheide der Leitung mit Art und Grund und die Bezeichnung der Regelfassung - nie, wer abgeschlossen oder wieder geöffnet hat, und nie den Grund des Wiederöffnens. Tabelle (`standings`, auch `GET /api/tournaments/<id>/standings`, TV und PDF) ist bei einer abgeschlossenen Staffel der gespeicherte Endstand. Cockpit, Abschließen und Wiederöffnen liegen unter `/api/admin/leagues/…` (robots gesperrt).

Regelwerk der Liga (docs/LIGA.md, #1646): `/liga/<liga>/regeln` und `/liga/<liga>/<season>/regeln` lesen `GET /api/league-rules/leagues/<liga>` bzw.
`GET /api/league-rules/seasons/<liga>/<season>`, dazu `/compare` und `/versions/<id>/pdf` unter denselben Adressen - alles nach `league_seasons.visibility`, unsichtbar antwortet 404 (die Seite der Liga, sobald
eine ihrer Seasons sichtbar ist). `members`: erreichbar, aber `noindex` mit neutraler Vorschaukarte, das PDF mit `X-Robots-Tag: noindex`. Alte Fassungen (`?version=`) und der Vergleich (`?vergleich=`) sind nie indexiert.
`POST /api/league-rules/consents` verlangt eine Anmeldung und Verantwortung für das Co-Team. `/compare` und `/versions/<id>/pdf` haben eine Bremse je Besucher (nginx-Zone `tls_rules_heavy`, im Server 60 je Minute) und bleiben `no-store`.

Selbstanmeldung der Liga (docs/LIGA.md, #2205): `GET /api/leagues/<liga>/<season>` trägt für alle nur Fenster-Stand und freie Plätze, keine Personen und keine Anträge. `/liga/<liga>/<season>/anmelden` verlangt eine Anmeldung und ist nicht in der Sitemap;
`GET …/application`, `POST …/applications` und `POST …/applications/<id>/withdraw` verlangen eine Anmeldung und folgen `league_seasons.visibility` (unsichtbar 404), Schreiben dürfen nur Captain und Vertreter. `GET /api/me/league-applications` zeigt nur die eigenen Co-Teams.

Sperrliste der Season (docs/LIGA.md, C.4 #2218): keine eigene öffentliche Route. `GET /api/leagues/<liga>/<season>` trägt `loadout_bans` (Schnappschuss der geltenden Version ohne Notiz und Autor, `null` ohne Liste) nach derselben Sichtbarkeit; im Regelwerk steht sie als Baustein. Die Matchseite eines Staffel-Spiels (`GET /api/matches/<id>/page`) trägt im Block `league` dieselbe Form als `loadout_bans` (die für dieses Spiel geltende Liste, #2287); eine ganz gesperrte Klasse nennt ihre Einträge (`items`, Name und Bild). Die Bibliothek (`/api/games/<id>/equipment…`) und die Verwaltung der Liste (`/api/admin/leagues/seasons/<id>/loadout-bans…`) sind nie öffentlich.

Check-in der Liga (docs/LIGA.md, D.2, #1652): `POST /api/matches/<id>/checkin` und `POST /api/matches/<id>/checkin/start` verlangen eine Anmeldung und die Verantwortung für eine Seite des Spiels (Captain, Vertreter) oder das Liga-Recht „Spiele betreuen“; Unbeteiligte bekommen 403, Spiele ohne Check-in 409. `GET /api/matches/<id>/page` trägt den Block `checkin` nur für Beteiligte und Leitung; `matches_v2.flow` (Konto-Kennungen) steht in keiner öffentlichen Antwort. `GET|PUT /api/admin/leagues/seasons/<id>/checkin-rules` ist Verwaltung (`/api/admin/`, robots gesperrt).

Veto der Liga (docs/LIGA.md, D.3, #1618): `POST /api/matches/<id>/veto/pick` verlangt eine Anmeldung und die Verantwortung für die Seite am Zug (Captain, Vertreter), `POST /api/matches/<id>/veto/lead` das Liga-Recht „Spiele betreuen“; Unbeteiligte bekommen 403, Spiele ohne Veto 409. `GET /api/matches/<id>/page` trägt den Block `checkin.veto` nur für Beteiligte und Leitung; `matches_v2.flow.veto` (Konto-Kennungen) steht in keiner öffentlichen Antwort, `planned_games` (die Spielreihenfolge, keine Personen) schon. `GET|PUT /api/admin/leagues/seasons/<id>/veto-rules` und `…/veto-rules/proposal` sind Verwaltung (`/api/admin/`, robots gesperrt). Vorgabe der Woche (#2326): `GET|PUT /api/admin/leagues/seasons/<id>/veto-presets` sind ebenfalls Verwaltung (lesen jede Zuständigkeit der Liga, speichern „Season konfigurieren“); `league_seasons.veto_presets` (Spielwoche, Modus, Map) trägt keine Personen, die Historie nennt die Leitung nur in dieser Verwaltungsantwort. Die vorgegebene Map steht mit der Rolle `preset` in `planned_games` (öffentlich, keine Personen), der Merker `matches_v2.flow.veto_wait` bleibt wie `flow.veto` intern. `POST /api/matches/<id>/veto/ready` („Bereit zum Veto“ nach einer nachgetragenen Vorgabe, Nr. 127) verlangt wie ein Zug eine Anmeldung und die Verantwortung für die eigene Seite; Leitung und Unbeteiligte bekommen 403. `POST /api/matches/<id>/veto/start` (Notfall-Start) verlangt das Liga-Recht „Spiele betreuen“ und einen Grund, mit der Befangenheitsprüfung wie jeder Eingriff. Die Bereit-Markierungen (`flow.veto_wait.ready`) tragen keine Personen und bleiben intern.

## Oeffentlich, aber bewusst nicht indexiert

Diese Routen bleiben erreichbar, damit Menschen sie verwenden und Crawler `noindex, follow` lesen koennen. Sie stehen nicht in der Sitemap:

- `/privacy`, `/imprint` und `/terms`
- `/players` und `/u/<username>`
- `/membership/apply`
- `/matches/<id>`
- `/references/series/<spur>/<saison>` (Serienseite mit Tabellen, #1745: fremde Namen nur in Tabellen, nie in der Sitemap)
- `/references/series/<spur>/<saison>/runde/<nr>` (Ergebnistabelle je Runde einer Rennliga, #1950; Reiter je Lauf als `?lauf=…`)
- Login-, Registrierungs- und Passwort-Routen
- `/newsletter/abbestellen?token=…` (Abmeldelink aus dem Newsletter, #2119; `noindex, nofollow`, abgemeldet wird erst per Knopf - `POST /api/settings/newsletter/unsubscribe`, auch als One-Click aus `List-Unsubscribe`)
- Fehleransichten `/403`, `/500` und der SPA-404-Fallback; sie setzen `noindex, nofollow`

## Private und betriebliche Routen

`robots.txt` sperrt `/admin/`, `/dashboard`, `/profile`, `/privacy-account`, `/members/area`, die weiteren Mitglieder-Routen, `/my/`, `/setup`, `/display/` und `/api/`. Die Autorisierung bleibt die Sicherheitsgrenze; Robots-Regeln sind nur Hinweise fuer Crawler.

## Permanente Weiterleitungen

| Alter oder doppelter Pfad | Kanonisches Ziel |
| --- | --- |
| `/der-verein`, `/ueber-uns` | `/about` |
| `/values` (früher „Werte & Ziele“, seit #1253 ein Abschnitt von „Über uns“) | `/about#werte` |
| `/datenschutzerklaerung`, `/datenschutz` | `/privacy` |
| `/impressum` | `/imprint` |
| `/nutzungsbedingungen` | `/terms` |
| `/kontakt` | `/contact` |
| `/sponsoren` | `/sponsors` |
| `/partner` | `/partners` |
| `/mitglieder` | `/members` |
| `/mitglied-werden`, `/mitgliedschaft` | `/membership/join` |
| `/turniere` | `/tournaments` |
| `/gallerie`, `/galerie-2`, `/gallery` und deren Album-Pfade | `/galerie` und der passende Album-Pfad |
| `/server` | `/servers` |
| `/spielerprofil/<username>`, `/players/<username>` | `/u/<username>` |
| `/lan-party-2024` | `/events` |
| `/f1` und `/f1/<slug>` | `/fastlap` und `/fastlap/<slug>` |
| `www.lionsquad.at/<path>` | `lionsquad.at/<path>` |

Die SPA besitzt passende clientseitige Fallbacks fuer Aliase, die in der lokalen Entwicklung ohne Nginx geoeffnet werden.

## Entfernte Inhalte

WordPress-/Demo-Familien unter `/elements`, `/product`, `/portfolio`, `/tag`, `/category` und `/author` liefern `410 Gone` mit `X-Robots-Tag: noindex, nofollow`. Sie duerfen nie auf die SPA-Shell zurueckfallen.

## Automatische und manuelle Pruefung

Die CI startet das produktive Nginx-Image und fuehrt `scripts/check-public-routes.sh` aus. Geprueft werden repraesentative kanonische `200`, alte `301`, entfernte `410`, der kanonische Host und der Crawler-Header. Backend-Tests stellen zusaetzlich sicher, dass die Sitemap kanonische Pfade enthaelt und bekannte Aliase ausschliesst.

Nach dem Deployment werden die oeffentliche Proxy-Grenze und Suchmaschinen wie in `docs/BETRIEB.md` beschrieben geprueft. Aktionen in Google Search Console und Bing Webmaster Tools bleiben bewusst manuell, weil die Repository-CI keinen Zugriff auf diese Konten hat.
