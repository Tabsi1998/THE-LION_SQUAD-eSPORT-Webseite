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

`backend/routes/setup_routes.py` verwaltet die statische Sitemap-Liste und wendet Veroeffentlichungs-/Sichtbarkeitsfilter auf dynamische Datensaetze an. Die Slug-Historie leitet auf den aktuellen kanonischen Slug weiter.

Liga (docs/LIGA.md, #1622): Eine Staffel ist ein Turnier und folgt den Regeln von `/tournaments/<slug>` - in der Sitemap nur, solange sie oeffentlich und kein Entwurf ist (Season-Sichtbarkeit `public`). Die Liga selbst liest die Website ueber `GET /api/leagues` und `GET /api/leagues/<liga>/<season>`; beide liefern nur Seasons, die die Person nach `league_seasons.visibility` sehen darf (`off` antwortet 404), dazu `GET /api/leagues/<liga>/<season>/staffeln/<staffel>` (Tabelle, Spielwochen, Ergebnisse - nur sichtbare Staffeln). Die Ligaseite `/liga/<liga>/<season>` (P5, #1625) ist bei `members`/`admins` erreichbar, aber `noindex` mit neutraler Vorschau; bei `off` liefert die Vorschau 404 und die Seite sagt „Liga nicht gefunden“. Der Menüpunkt „Liga“ erscheint nur, wenn die Lese-API der Person eine Season zeigt.

## Oeffentlich, aber bewusst nicht indexiert

Diese Routen bleiben erreichbar, damit Menschen sie verwenden und Crawler `noindex, follow` lesen koennen. Sie stehen nicht in der Sitemap:

- `/privacy`, `/imprint` und `/terms`
- `/players` und `/u/<username>`
- `/membership/apply`
- `/matches/<id>`
- `/references/series/<spur>/<saison>` (Serienseite mit Tabellen, #1745: fremde Namen nur in Tabellen, nie in der Sitemap)
- `/references/series/<spur>/<saison>/runde/<nr>` (Ergebnistabelle je Runde einer Rennliga, #1950; Reiter je Lauf als `?lauf=…`)
- Login-, Registrierungs- und Passwort-Routen
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
