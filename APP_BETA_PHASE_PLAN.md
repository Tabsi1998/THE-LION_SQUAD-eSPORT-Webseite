# App- und Turnier-Beta-Phasenplan

Stand: 2026-05-21

Dieser Plan buendelt die naechsten sinnvollen Arbeiten fuer App, Website und Backend. Fokus ist, dass lokale Events, Online-Turniere, Fast-Lap-Inhalte, Profilbedienung und die Jahreswertung logisch sauber zusammenpassen.

## Aktuelle Befunde

- Seit der Planerstellung umgesetzt: mobile Content-Karten wurden fuer Dashboard, Turnier-Hub, Fast-Lap-Liste, News- und Event-Kontext vereinheitlicht.
- Seit der Planerstellung umgesetzt: mobile Statuslabels wurden erweitert, damit `approved`, `waiting_result`, Staff-only, Ergebnis-Konflikte und Rollen nicht mehr roh angezeigt werden.
- Seit der Planerstellung umgesetzt: Fast-Lap-Details nutzen vorhandene Streckenbilder (`track.image_url`) mit Challenge-Banner als Fallback.
- Seit der Planerstellung umgesetzt: Profil-Actions wurden auf gemeinsame `ActionTile`/`ActionRow`-Bausteine umgestellt, Logout ist eine separate Konto-Aktion, Tabs sind sichtbarer und die Mehr-Navigation resetet beim Tabwechsel.
- Seit der Planerstellung umgesetzt: Match-V2-Routen liefern Policy-Flags und blockieren Termin-Vorschlaege, wenn `schedule_mode=fixed_by_staff` gilt.
- Seit der Planerstellung umgesetzt: Admin kann Turnier-Regeln auf Turnier- und Stage-Ebene konfigurieren; die Turnierliste zeigt Regelmodi kompakt an.
- Seit der Planerstellung umgesetzt: mobile `StatusBadge` rendert Phase-Countdowns, Live-Indikator und dieselben Statusfarben konsistenter wie die Web-PhaseBadge.
- Seit der Planerstellung umgesetzt: mobile `SegmentedTabs` ist als gemeinsamer Baustein eingefuehrt und in Event-Hub, Info-Center, Turnierdetail sowie oeffentlichem Profil genutzt.
- Seit der Planerstellung umgesetzt: mobile Jahreswertung nutzt echte Season-Standings, zeigt Quellen/Statistiken und trennt Jahreswertungs- von Profilpunkten.
- Seit der Planerstellung umgesetzt: mobile `EmptyState` unterstuetzt Icons/Tones und ersetzt mehrere manuelle Leerzustaende.
- Seit der Planerstellung umgesetzt: mobile `SkeletonList` nutzt dieselben Surface-/Border-Tokens wie Karten und wirkt beim Laden ruhiger.
- Seit der Planerstellung umgesetzt: mobile `ErrorState` trennt Fehler-/Nicht-gefunden-Zustaende optisch von leeren Listen.
- Seit der Planerstellung umgesetzt: Offline-Fallbacks markieren Cache-Daten sichtbar und persistieren wichtige Listen wie News, Events, Turniere und Fast-Laps.
- Seit der Planerstellung umgesetzt: App-Hauptnavigation benennt den Turnier-Tab als Event-Hub und Dashboard-Schnellzugriff priorisiert Jahreswertung und News.
- Seit der Planerstellung umgesetzt: mobile Bottom-Tabbar nutzt einen Website-nahen Glas-Surface-Layer, versteckt sich bei Tastatur und die Glocke wurde visuell angeglichen.
- Seit der Planerstellung umgesetzt: Website-Fehlerseiten fuehren mit Quick-Links zu Start, Events, Turnieren, News und Jahreswertung zurueck.
- Seit der Planerstellung umgesetzt: Profil-/Erfolge-Texte sind geglaettet, Rollen werden lesbar angezeigt und leere Profilbereiche nutzen passende Icon-States.
- Seit der Planerstellung umgesetzt: `mobile/RELEASE_SMOKE_TEST.md` beschreibt den Beta-APK-Build und den Android-Smoke-Test.
- Seit der Planerstellung umgesetzt: Admin-Dashboard hat eine Tageszentrale fuer Setup, Ergebnis-Konflikte, Medien-Check und Systemstatus.
- Seit der Planerstellung umgesetzt: Web-Navigation, Jahreswertungsseite, Widget und Admin-Hinweise nutzen sichtbare Begriffe wie Jahreswertung/Jahrespunkte statt unklarem Season-Pass.
- Seit der Planerstellung umgesetzt: Backend-Defaulttexte, Achievements, Seed-Daten und SEO-Breadcrumbs verwenden ebenfalls Jahreswertung/Jahrespunkte.
- Seit der Planerstellung umgesetzt: `0.12.0-beta.3` ist vorbereitet, inklusive Android `versionCode` 29, Changelog, Release-Historie und Hotfixes fuer Jahreswertung, Fast-Lap-Layout, Schnellzugriff und Tab-Reset.
- Seit der Planerstellung umgesetzt: `1.0.0-beta.1` ist als Final-Beta-Schnitt vorbereitet, inklusive Android `versionCode` 31, nativer Profilnavigation aus News-Links und sauber formatierten Event-/Content-Statuslabels.
- Seit der Planerstellung umgesetzt: Turnier-Regelpresets fuer Online, Vor-Ort und Hybrid sind im Admin verfuegbar; der Planungscheck warnt bei widerspruechlichen Ergebnis- oder Terminregeln.
- Seit der Planerstellung umgesetzt: Legacy- und V2-Match-Policy-Tests decken lokale Staff-only-Matches, Online-Spielerflows, Stage-Overrides und V2-Staff-Erfassung ab.
- Seit der Planerstellung umgesetzt: Ergebnisreport-Konsens zwischen unterschiedlichen Teilnehmern, abweichende Reports und Knockout-Unentschieden sind als eigene Match-Resolution-Logik unit-getestet.
- Seit der Planerstellung umgesetzt: Legacy-Match-Reports, automatische Ergebnisaufloesung, Staff-Ergebnisupdates, Disputes und Forfeits schreiben Audit-Logs mit Match-Kontext.
- Seit der Planerstellung umgesetzt: Die App blendet eigene Terminentscheidung-Aktionen aus und zeigt bei eigenen Vorschlaegen einen wartenden Hinweis statt eines blockierten Buttons.
- Seit der Planerstellung umgesetzt: `1.0.0-beta.10` ist als frischer Android-Build `41` fuer einen neuen APK-Tag vorbereitet.
- Seit der Planerstellung umgesetzt: Admin-Jahreswertung erklaert die echte V2-Punkteformel, Gewichtungen, Teilnehmerfaktoren, Streichresultate und Auto-/Manuell-Quellenwahl sichtbar im Editor.
- Ergebnislogik ist teilweise vorhanden: Bei klassischen Online-Matches koennen Teilnehmer Ergebnisse melden. Stimmen die letzten zwei Reports ueberein, wird das Match automatisch abgeschlossen. Weichen sie ab, geht das Match auf Klaerung.
- Staff-Erfassung ist vorhanden: Turnierleitung kann klassische Matches direkt aktualisieren und V2-Heats ueber `/api/matches/{id}/result` werten.
- Das Regelmodell fuer Vor-Ort-Staff-only, Online-Doppelmeldung und Hybrid ist im Backend und Admin begonnen. Offen bleibt die vollstaendige Durchsetzung/Pruefung in Legacy/V1-Flows und die bessere Erklaerung im Setup-Assistenten.
- Terminabstimmung wird im Match-Hub ueber Backend-Flags gesteuert. Admin-Konfiguration ist auf Turnier- und Stage-Ebene moeglich; Presets und Planungswarnungen sind fuer Turnierregeln nachgezogen.
- Mobile und Web-RichText nutzen robuste Embed-Aufloesung und gemeinsame Kartenlogik; offen bleibt nur noch, neue Embed-Typen und Track-spezifische Fast-Lap-Bilder backendseitig auszubauen.
- Das Profil ist deutlich kompakter: Actions, Logout, Tabs, leere Zustaende, Rollenlabels und Erfolgstexte sind fuer die Beta geglaettet.
- Season-Punkte existieren bereits beim Status `results_published`. Teilnahme, Platzierung, Gewichtung und Jahreswertung sind also kein kompletter Neubau, brauchen aber bessere Benennung, Transparenz und App-Darstellung.
- Die mobile Website hat bereits eine app-artige Bottom-Navigation mit dunkler Transparenz, `backdrop-blur-xl`, Safe-Area-Padding, Icon-Fokus und aktivem Top-Indikator. Die native App-Tabbar ist dagegen noch einfacher und kann diese Designsprache aufnehmen.
- Web und App nutzen aehnliche Inhalte, aber noch nicht immer dieselben UX-Muster: Statusbadges, Embed-Karten, Listen, Tabs, Actions und leere Zustaende sollten staerker vereinheitlicht werden.
- Die Website selbst ist bereits breit aufgestellt: Public Pages, CMS, SEO/OG, Sitemap, Admin, Media, Galerie, Display-Seiten, Mitgliedsbereich, Turniere, Events und Fast-Lap sind vorhanden. Der naechste Hebel ist weniger "noch mehr Seiten", sondern bessere Informationsarchitektur, Performance, Redaktionskomfort, Admin-Effizienz und Live-Erlebnis.

## Zielbild

Ein Turnier oder Event bestimmt eindeutig, welche Aktionen erlaubt sind:

- Vor-Ort / lokal: Ergebnisse werden nur durch eingetragene Turnierleitung, Station-Crew oder Result-Recorder erfasst. Spieler sehen Ergebnisse, Chat und Infos, aber keine Ergebnis- oder Terminvorschlagsformulare.
- Online: Beide Parteien koennen ein Ergebnis melden. Gleiche Meldungen bestaetigen automatisch. Konflikte gehen an Admin oder Turnierleitung.
- Hybrid: Staff kann immer eingreifen. Pro Stage oder Match kann entschieden werden, ob Spieler-Reports und Terminabstimmung erlaubt sind.
- Jahreswertung: Unter einem besseren Namen als "Season Pass" werden Teilnahme, Platzierungen, Fast-Lap-Erfolge und definierte Sonderwertungen nachvollziehbar gesammelt. Am Jahresende gibt es einen Jahres-Champion.

## Phase 1 - Regelmodell und Backend-Haertung

Neue oder konsolidierte Felder auf Turnier/Event/Stage:

- `event_mode`: `local`, `online`, `hybrid`
- `result_entry_mode`: `staff_only`, `player_confirmed`, `hybrid`
- `schedule_mode`: `fixed_by_staff`, `player_proposal`, `hybrid`
- optional pro Stage/Match ueberschreibbar, falls Gruppenphase und Finale unterschiedliche Regeln brauchen.

Backend-Akzeptanzkriterien:

- `/api/matches/{id}/page` liefert klare Flags, z.B. `can_player_report_result`, `can_staff_submit_result`, `can_propose_schedule`, `result_entry_mode`, `schedule_mode`.
- `/api/matches/{id}/report` blockiert Spielerreports, wenn `result_entry_mode=staff_only`.
- `/api/matches/{id}/schedule-proposals` blockiert Vorschlaege, wenn `schedule_mode=fixed_by_staff`.
- Tests decken lokale Staff-only-Matches, Online-Spielerflows, Stage-Overrides, V2-Staff-Erfassung sowie Ergebnisreport-Konsens/Konflikte ab; ein kompletter API-E2E-Smoke fuer reale Match-Reports bleibt optional offen.

## Phase 2 - Mobile Match-Hub Rework

App-Verhalten:

- Lokales Match: zeigt Termin, Station, Teilnehmer, Status, ggf. Staff-Hinweis. Kein "Termin vorschlagen", kein "Ergebnis melden".
- Online-Match: zeigt Ergebnis melden, Nachweis, Status der eigenen Meldung und Konfliktstatus.
- Staff-Ansicht: zeigt Ergebnis speichern, Forfeit, Dispute-Klaerung und ggf. Station.
- Rohstatus wird ueber zentrale Labels gerendert: "Angemeldet", "Bestaetigt", "Wartet auf Ergebnis", "Klaerung noetig".

Umsetzung:

- `mobile/src/lib/format.ts` um Status- und Rollenlabels erweitern.
- `mobile/src/screens/main/MatchDetailScreen.tsx` nach neuen Backend-Flags rendern.
- Kleine Status-Komponente fuer Match- und Registration-Status einziehen.

## Phase 3 - Embeds und Medienkarten

Ziel:

- News, Info-Center und Detailtexte zeigen verlinkte Turniere, Events und Fast-Laps als Karten mit Bild, Titel, Datum, Status und Zielnavigation.
- Der bisherige blaue Embed-Balken wird nur noch Fallback, wenn keine Daten geladen werden koennen.

Umsetzung:

- [x] Mobile API fuer News/Events liefert die bereits vorhandenen `content_embeds` aus `content_embed_service.py`.
- [x] Mobile `RichText` nutzt `embeds` und rendert verlinkte Inhalte ueber die gemeinsame `ContentCard`.
- [x] Web `RichContent` und mobile `RichText` finden Embeds robust ueber Token, Ref, Slug und Alias-Schreibweisen.
- [x] Fast-Lap, Turnier und Event Karten nutzen `banner_url`; Fast-Lap-Embeds bevorzugen zusaetzlich das erste vorhandene `track.image_url`.

## Phase 4 - Fast-Lap-Streckenbilder

Ziel:

- In Fast-Lap-Details ist die aktuell gewaehlte Strecke visuell klar.
- Wenn `track.image_url` vorhanden ist, erscheint ein Streckenbild ueber Leaderboard/Bestzeit oder als kompakte Track-Karte.
- Falls kein Track-Bild vorhanden ist, bleibt das Challenge-Banner der Fallback.

Umsetzung:

- [x] `FastLapDetailScreen` rendert `activeTrack.image_url` im Hero und in der Track-Karte, mit Challenge-Banner als Fallback.
- [x] Backend/Admin geprueft: Track-Bild ist ueber `f1_tracks.image_url` und den Admin-Upload pflegbar.
- [x] Fast-Lap-Embeds nutzen automatisch das erste vorhandene Track-Bild; optional kann spaeter ein spezifisches Track-Token wie `[[fastlap:challenge#track]]` folgen.

## Phase 5 - Profil und Mehr-Navigation

Profil:

- [x] Bearbeiten, Datenschutz und Benachrichtigungen als kleinere Icon-Actions statt riesiger Primaerflaechen.
- [x] Abmelden als kompakter Danger-Action im Profil-Menue oder am Ende eines Einstellungsbereichs.
- [x] Tabs mit sichtbarem Hinweis: aktive Seite, kurze Tab-Leiste, ggf. "Mehr"-Sheet statt verstecktem horizontalem Scroll.
- [x] Offene Achievement-Gruppen beim Tabwechsel oder Refresh optional schliessen.
- [x] Profil-/Erfolge-Texte, Rollenlabels und leere Profilbereiche fuer Beta glaetten.

Mehr-Navigation:

- [x] Beim erneuten Tippen auf "Mehr" zurueck zum MoreHub navigieren.
- [x] Stack bei Tabwechsel resetten, damit eine zuvor geoeffnete Unterseite nicht ueberraschend wieder offen ist.

## Phase 6 - Mobile Design-System und Navigations-Rework

Ziel:

- Die App soll sich wie eine native Lions-App anfuehlen, aber die gute mobile Website-Optik uebernehmen: dunkle transparente Bottom-Bar, leichter Blur/Glas-Effekt, klare Icons, aktive Indikatoren und sichere Abstaende fuer iOS/Android.
- Website mobil, App und spaeter PWA sollen dieselbe visuelle Sprache sprechen, ohne doppelte Designentscheidungen.

App-Navigation:

- [x] Bottom-Tabbar optisch an `frontend/src/components/tls/BottomNav.jsx` anlehnen: dunkles halbtransparentes Surface, feiner Border-Top, aktiver Cyan-Indikator, kompakte Labels.
- [x] Blur/Transparenz in React Native pruefen: `expo-blur` ist aktuell nicht installiert, daher bleibt der stabile Fallback mit `rgba(10,10,10,0.96)`.
- [x] Aktiver Tab bekommt klaren oberen Strich oder kleine Glow-Linie, nicht nur andere Textfarbe.
- [x] Benachrichtigungsglocke integrieren oder an die Tabbar anpassen, damit sie nicht wie ein Fremdkoerper ueber dem UI schwebt.
- [x] Tab-Reihenfolge pruefen: Event-Hub bleibt Haupttab, Jahreswertung/News werden im Dashboard-Schnellzugriff priorisiert, ohne Teams oder Profil aus der Tabbar zu verdraengen.

Gemeinsame UI-Muster:

- [x] `StatusBadge` / `PhaseBadge` als App-Komponente nach Web-Vorbild nachziehen: Countdown, Live-Punkt, Statusfarben.
- [x] `ActionRow`/`ActionTile` fuer kompakte Icon-Actions statt grosser Buttons, z.B. Profil bearbeiten, Aktualisieren, Datenschutz, Logout.
- [x] `ContentCard` fuer Turnier/Event/Fast-Lap/News vereinheitlichen: Bild, Status, Datum, Primaraktion.
- [x] `SegmentedTabs` fuer sichtbare Seitenwechsel statt versteckter horizontaler Scroll-Tabs als gemeinsamer Baustein einfuehren.
- [x] `EmptyState` optisch angleichen: Icons, Akzentfarben und weniger manuelle Sonderlayouts.
- [x] `SkeletonList` optisch an Karten/Surfaces angleichen.
- [x] Fehlerzustaende optisch angleichen: `ErrorState` fuer nicht gefundene oder nicht verfuegbare Details.
- [x] Offline-Zustaende optisch angleichen: Cache-Fallbacks zeigen einen sichtbaren Offline-Hinweis in Dashboard, Event-Hub und News.

Mobile Website:

- [x] BottomNav fuer eingeloggte User priorisiert Dashboard, Events/Turniere, Jahreswertung und Profil; News/Home bleiben ueber Hauptnavigation erreichbar.
- [x] Mobile Header und BottomNav duerfen sich nicht doppelt anfuehlen: Burger-Menue bleibt fuer tiefe Navigation, BottomNav fuer Hauptwege.
- [x] Scroll-Top-Button und Bottom-Banner spielen mit BottomNav/Safe-Area sauber zusammen.
- [x] Admin- und Profilseiten mobil weiter verdichten: Gewinnabholung nutzt mobile Karten, Profil-Tabs umbrechen ohne horizontales Scrollen.

Design-Checks:

- Screenshots fuer kleine Smartphones, grosse Smartphones und Tablet-Breite.
- Keine ueberlappenden Texte mit BottomNav, Bannern, Scroll-Top und Cookie-Dialog.
- Farben bleiben TLS-typisch, aber nicht nur Cyan/Gold: Danger, Success, Neutral und Statusfarben klar getrennt.
- Motion sparsam: kurze Press-States, keine dauerhaften Effekte, die Akku oder Lesbarkeit stoeren.

## Phase 7 - Website-Modernisierung und Public Experience

Ziel:

- Die Website soll fuer Besucher, Mitglieder, Spieler, Sponsoren und Turnierleitung schneller zum richtigen Ziel fuehren.
- Oeffentliche Seiten sollen weniger wie einzelne Inseln wirken und mehr wie ein zusammenhaengendes Vereinsportal.
- SEO, Sharing, Performance und Barrierefreiheit sollen nicht nur technisch vorhanden sein, sondern regelmaessig pruefbar sein.

Public Website:

- [x] Startseite staerker nach aktuellen Prioritaeten steuern: naechstes Event, laufende Turniere, aktuelle News, Jahreswertung.
- [x] Turnier-, Event- und Fast-Lap-Listen/Karten angleichen: konsistente Status-, Meta- und CTA-Signale auf Public-Karten.
- [x] News-Seiten mit besseren Inhaltsbausteinen: Embed-Karten, Autoren-/Kategoriezeile, "Weiterlesen", verwandte Turniere/Events.
- [x] Community-Bereich klarer strukturieren: Spieler, Teams, Server, Mitglieder, Achievements und Referenzen als zusammenhaengende Community-Welt.
- [x] Sponsoren/Partner sichtbarer machen: Partnerkarten, Sponsoren-Tiers, Verknuepfung mit Events und gegenseitige Einstiege.

Navigation und Informationsarchitektur:

- Hauptnavigation pruefen: Besucher brauchen andere Wege als eingeloggte Spieler oder Admins.
- [x] "Mein Bereich" klarer als Spieler-Dashboard positionieren, getrennt von oeffentlichem Profil.
- [x] Mobile BottomNav und Desktop-Nav inhaltlich aufeinander abstimmen.
- [x] Breadcrumbs/Zurueck-Links auf tiefen Seiten wie Match, Bracket, Standings und Galerie konsequent einsetzen.
- [x] Interne Suche oder Quick-Jump fuer Turniere, Events, News, Spieler und Teams pruefen.

Performance und technische Qualitaet:

- [x] Bildstrategie haerten: responsive Bildgroessen, Lazy Loading, feste Aspect Ratios, saubere Fallbacks, WebP/AVIF wo sinnvoll.
- [x] Bundle pruefen: Admin-Schwergewichte lazy laden, Display-Seiten separat halten, Editor/Charts nur bei Bedarf laden.
- [x] Core-Web-Vitals-Ziele definieren: schnelle Startseite, stabile Layouts ohne Spruenge, schnelle Detailseiten.
- [x] API-Responses fuer Listen vereinheitlichen: kompakte Karten-Daten statt komplette Detailobjekte, Pagination/Filter sauber.
- [x] Fehlerseiten modernisieren: 404/403/500 mit klarer Rueckfuehrung zu Start, Events, Turnieren, News und Jahreswertung.
- [x] Ladezustaende modernisieren und vereinheitlichen.

SEO, Sharing und Content-Betrieb:

- [x] SEO-Vorschau im Admin: Titel, Beschreibung, Canonical, OG-Bild und Social Preview vor Veroeffentlichung ansehen.
- [x] Sitemap und SEO-Preview regelmaessig gegen echte Routen pruefen, inklusive Turnier-Bracket, Standings, Fast-Lap, Galerie und Profilen.
- [x] Redaktions-Checkliste fuer News/CMS: Titel, Teaser, Banner, Embeds, Sichtbarkeit, SEO, Newsletter, Discord.
- [x] Strukturierte Daten erweitern: Event, SportsEvent/Competition, Organization, Breadcrumb, Article, ImageObject.
- [x] IndexNow/Search-Console-Submit nach wichtigen Veroeffentlichungen automatisieren oder im Admin klarer anzeigen.

Admin und Redaktion:

- [x] Admin-Dashboard als Beta-Tageszentrale: Setup, Ergebnis-Konflikte, Medien-Check und Systemstatus direkt erreichbar.
- Admin-Listen vereinheitlichen: Filter, Suche, gespeicherte Ansichten, Bulk-Actions und Export pro Bereich.
- Turnier-Editor entlasten: Setup-Assistent fuer lokales/online/hybrid Turnier, Regeln, Stationen, Ergebnisfluss und Kommunikation.
- Medienbibliothek erweitern: fehlende Alt-Texte, doppelte Dateien, ungenutzte Dateien, kaputte Referenzen, Bildzuschnitt.
- Audit- und Rollenansicht besser erreichbar machen: wer darf was, wer hat was geaendert, welche Staff-Zuweisung gilt wo.

Live- und Event-Erlebnis:

- [x] Display-Seiten als eigener Modus ausbauen: Bracket-TV, Fast-Lap-TV, Event-Ticker, Station-Status, Sponsorrotation.
- [x] Oeffentliche Live-Seiten fuer lokale Events: Zeitplan, laufende Matches, naechste Station, Ergebnis-Ticker.
- [x] Nach dem Event automatisch Rueckblick vorbereiten: Gewinner, Podium, Galerie, News-Entwurf, Social-Share.
- [x] QR-Codes fuer Vor-Ort-Wege: Check-in, Match, Station, Galerie-Upload, Feedback.

Barrierefreiheit und Vertrauen:

- [x] Tastaturbedienung und Fokus-Stile fuer Navigation, Modals, Editor, Tabellen und Formulare pruefen.
- [x] Kontraste fuer Cyan/Gold auf dunklem Hintergrund systematisch testen.
- [x] Formulare mit klaren Fehlermeldungen, Pflichtfeldhinweisen und sinnvoller Tab-Reihenfolge.
- [x] Datenschutz/Cookie/Analytics sichtbar nachvollziehbar halten, besonders bei Embeds, Twitch und externen Medien.

## Phase 8 - Jahreswertung statt unklarer Season-Pass

Namensoptionen:

- TLS Jahreswertung
- Club Championship
- Lions Circuit
- Vereinsrangliste

Regellogik:

- Turniere geben Punkte fuer Teilnahme und Platzierung.
- Groessere Turniere und Major-Events haben hoehere Gewichtung.
- Fast-Lap-Challenges geben Punkte fuer gueltige Zeiten, Streckenwertung und ggf. Pole/Top-Platzierung.
- Events koennen Check-in-Punkte geben, wenn das ausdruecklich gewollt ist.
- Profil-Achievements bleiben sichtbar getrennt von Jahreswertungspunkten.
- Am Jahresende wird ein Jahres-Champion gekuert, inklusive Archivseite und Badge/Achievement.

Umsetzung:

- [x] Bestehende `season_points`, `season_standings` und `SeasonPage` weiterverwenden.
- [x] UI-Begriffe vereinheitlichen, damit "Season-Punkte", "Profilpunkte" und "Achievements" nicht vermischt werden.
- [x] Mobile `SeasonPassScreen` in Richtung "Jahreswertung" umbauen.
- [x] Web-Begriffe fuer Navigation, Widget, Jahreswertungsseite und Admin-Hinweise auf Jahreswertung/Jahrespunkte angleichen.
- [x] Admin-Editor fuer Jahreswertungen transparenter machen: Punkteformel, Teilnahme, Gewichtung, Teilnehmerfaktor und Quellen sind direkt sichtbar.

## Phase 9 - Weitere sinnvolle Erweiterungen

Turnierbetrieb:

- Staff-Dashboard fuer lokale Events: offene Matches, Stationen, fehlende Ergebnisse, letzte Aenderungen, Schnellwertung.
- QR-Modus fuer Vor-Ort-Events: Teilnehmer, Staff oder Stationen koennen direkt zum richtigen Match/Check-in springen.
- Audit-Ansicht fuer Ergebnis-Aenderungen: wer hat wann welches Ergebnis eingetragen oder bestaetigt.
- Rollen feiner benennen: Turnierleitung, Station-Crew, Ergebnis-Erfasser, Admin.

Kommunikation:

- Match- und Turnierchat mit Kontext-Chips: Termin, Ergebnis offen, Klaerung noetig, Staff-Antwort.
- Push-Benachrichtigungen fuer Ergebnis bestaetigt, Ergebnis-Konflikt, Match startet bald, Check-in offen.
- News-Editor mit Embed-Vorschau fuer mobile Darstellung, damit der blaue Balken-Fall gar nicht erst ueberrascht.

Inhalte und Medien:

- Media-Qualitaetscheck im Admin: fehlende Banner, fehlende Track-Bilder, zu kleine Bilder, kaputte Links.
- Automatische Social/OpenGraph-Vorschau fuer Turniere, Events, Fast-Laps und Jahreswertung.
- Galerie/Album-Verknuepfung mit Events und Turnieren, damit Rueckblicke direkt sichtbar sind.

Qualitaet und Betrieb:

- E2E-Smoke fuer wichtigste mobile Web-Wege: Home, Turniere, Match, Profil, Jahreswertung.
- Native App-Screenshot-Check fuer Dashboard, Match-Hub, Profil, Fast-Lap und News.
- Monitoring fuer Push-Token, API-Fehler und langsame mobile Endpunkte.
- Beta-Feedback-Kanal in App/Web: kurzer Report mit Screen, Version, User-Agent und Route.

## Phase 10 - Beta 0.12.0-beta.3

Fuer den naechsten APK-Build:

- [x] Version auf `0.12.0-beta.3` setzen.
- [x] Android `versionCode` auf `29` erhoehen.
- [x] Changelog mit Match-Regeln, Embed-Karten, Profilnavigation und App-Design-Rework aktualisieren.
- [x] Vor Release pruefen: `npm run typecheck`, `npm audit --audit-level=moderate`, mobile Preflight, Backend-Tests fuer Match-Regeln.
- [x] Smoke-Test-Checkliste fuer echten Android-Test dokumentieren: `mobile/RELEASE_SMOKE_TEST.md`.
- [ ] APK-Build ueber GitHub Actions starten und Smoke-Test auf echtem Android-Geraet durchfuehren.
- [x] Release-Tag `mobile-v0.12.0-beta.3` gesetzt und gepusht.

## Phase 11 - Final Beta 1.0.0-beta.1

Fuer den finalen Beta-Schnitt:

- [x] Version auf `1.0.0-beta.1` setzen.
- [x] Android `versionCode` auf `31` erhoehen.
- [x] App-Statuslabels fuer Event-/Content-Phasen erneut durch den deutschen Formatter fuehren.
- [x] News-Profilverlinkungen fuer `/u`, `/players`, `/users` und markierte Personen nativ in der App oeffnen; `/members/...` bleibt als Vereinsprofil auf der Website.
- [x] Changelog, Release-Historie und Smoke-Test-Checkliste aktualisieren.
- [ ] APK-Build ueber GitHub Actions starten und Smoke-Test auf echtem Android-Geraet durchfuehren.
- [ ] Release-Tag `mobile-v1.0.0-beta.1-build31` setzen und pushen.

## Prioritaet

1. Backend-Regelmodell fuer Ergebnis- und Terminrechte.
2. Mobile Match-Hub passend zu lokalen und Online-Turnieren.
3. Legacy/V1-Flow und Admin-Validierung fuer `event_mode`, `result_entry_mode` und `schedule_mode` vollstaendig nachziehen.
4. Embed-Daten in RichText/News/Info-Center vollstaendig anliefern und Fallback-Balken weiter reduzieren.
5. Mobile Design-System mit Bottom-Bar/Blur, gemeinsamen Cards und Tabs modernisieren.
6. Website-Modernisierung: Public Experience, SEO, Performance, Admin-Workflows und Live-Seiten.
7. Profil und Mehr-Navigation modernisieren.
8. Jahreswertung benennen und in App/Web klar darstellen.
9. Staff-Dashboard, QR-Flows und Beta-Feedback als naechste Erweiterungen vorbereiten.
10. Final Beta 1.0.0 bauen und testen.
