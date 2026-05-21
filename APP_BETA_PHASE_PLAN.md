# App- und Turnier-Beta-Phasenplan

Stand: 2026-05-21

Dieser Plan buendelt die naechsten sinnvollen Arbeiten fuer App, Website und Backend. Fokus ist, dass lokale Events, Online-Turniere, Fast-Lap-Inhalte, Profilbedienung und die Jahreswertung logisch sauber zusammenpassen.

## Aktuelle Befunde

- Seit der Planerstellung umgesetzt: mobile Content-Karten wurden fuer Dashboard, Turnier-Hub, Fast-Lap-Liste, News- und Event-Kontext vereinheitlicht.
- Seit der Planerstellung umgesetzt: mobile Statuslabels wurden erweitert, damit `approved`, `waiting_result`, Staff-only, Ergebnis-Konflikte und Rollen nicht mehr roh angezeigt werden.
- Seit der Planerstellung umgesetzt: Fast-Lap-Details nutzen vorhandene Streckenbilder (`track.image_url`) mit Challenge-Banner als Fallback.
- Seit der Planerstellung umgesetzt: Profil-Actions wurden kompakter gemacht, Logout ist eine separate Konto-Aktion, Tabs sind sichtbarer und die Mehr-Navigation resetet beim Tabwechsel.
- Seit der Planerstellung umgesetzt: Match-V2-Routen liefern Policy-Flags und blockieren Termin-Vorschlaege, wenn `schedule_mode=fixed_by_staff` gilt.
- Seit der Planerstellung umgesetzt: `0.12.0-beta.2` ist vorbereitet, inklusive Android `versionCode` 28, Changelog und Release-Historie.
- Ergebnislogik ist teilweise vorhanden: Bei klassischen Online-Matches koennen Teilnehmer Ergebnisse melden. Stimmen die letzten zwei Reports ueberein, wird das Match automatisch abgeschlossen. Weichen sie ab, geht das Match auf Klaerung.
- Staff-Erfassung ist vorhanden: Turnierleitung kann klassische Matches direkt aktualisieren und V2-Heats ueber `/api/matches/{id}/result` werten.
- Das Regelmodell fuer Vor-Ort-Staff-only, Online-Doppelmeldung und Hybrid ist im Backend begonnen, muss aber noch in Admin-UI, Turnier-Setup und Legacy/V1-Flows vollstaendig durchgezogen werden.
- Terminabstimmung wird im Match-Hub ueber Backend-Flags gesteuert. Offen bleibt die vollstaendige Admin-Konfiguration pro Turnier/Stage.
- Mobile Embeds sind teilweise als Karten modernisiert. Offen bleibt, dass RichText/News/Info-Center konsequent echte Embed-Daten erhalten statt nur Fallbacks.
- Das Profil ist deutlich kompakter, braucht aber noch Feinschliff bei Tab-Inhalten, Einstellungsgruppen und ggf. einem echten `ActionRow`/`SegmentedTabs`-Baustein.
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
- Tests decken lokale Staff-only-Matches, Online-Doppelmeldung, Konfliktfall und Staff-Override ab.

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

- Mobile API fuer News/Content muss die bereits vorhandenen `embeds` aus `content_embed_service.py` anliefern oder nachladen.
- Mobile `RichText` bekommt einen `embeds`-Prop und rendert `ContentEmbedCard`.
- Fast-Lap, Turnier und Event Karten nutzen `banner_url`; Fast-Lap-Strecken nutzen zusaetzlich `track.image_url`.

## Phase 4 - Fast-Lap-Streckenbilder

Ziel:

- In Fast-Lap-Details ist die aktuell gewaehlte Strecke visuell klar.
- Wenn `track.image_url` vorhanden ist, erscheint ein Streckenbild ueber Leaderboard/Bestzeit oder als kompakte Track-Karte.
- Falls kein Track-Bild vorhanden ist, bleibt das Challenge-Banner der Fallback.

Umsetzung:

- `FastLapDetailScreen` rendert `activeTrack.image_url`.
- Backend/Admin pruefen: Track-Bild muss im Admin sauber pflegbar sein.
- Embeds fuer Fast-Lap koennen optional das Track-Bild nutzen, wenn ein bestimmter Track verlinkt wird.

## Phase 5 - Profil und Mehr-Navigation

Profil:

- Bearbeiten, Datenschutz und Benachrichtigungen als kleinere Icon-Actions statt riesiger Primaerflaechen.
- Abmelden als kompakter Danger-Action im Profil-Menue oder am Ende eines Einstellungsbereichs.
- Tabs mit sichtbarem Hinweis: aktive Seite, kurze Tab-Leiste, ggf. "Mehr"-Sheet statt verstecktem horizontalem Scroll.
- Offene Achievement-Gruppen beim Tabwechsel oder Refresh optional schliessen.

Mehr-Navigation:

- Beim erneuten Tippen auf "Mehr" zurueck zum MoreHub navigieren.
- Alternativ Stack bei Tabwechsel resetten, damit eine zuvor geoeffnete Unterseite nicht ueberraschend wieder offen ist.

## Phase 6 - Mobile Design-System und Navigations-Rework

Ziel:

- Die App soll sich wie eine native Lions-App anfuehlen, aber die gute mobile Website-Optik uebernehmen: dunkle transparente Bottom-Bar, leichter Blur/Glas-Effekt, klare Icons, aktive Indikatoren und sichere Abstaende fuer iOS/Android.
- Website mobil, App und spaeter PWA sollen dieselbe visuelle Sprache sprechen, ohne doppelte Designentscheidungen.

App-Navigation:

- Bottom-Tabbar optisch an `frontend/src/components/tls/BottomNav.jsx` anlehnen: dunkles halbtransparentes Surface, feiner Border-Top, aktiver Cyan-Indikator, kompakte Labels.
- Blur/Transparenz in React Native pruefen: Expo `BlurView` nur falls performant und stabil, sonst Fallback mit `rgba(10,10,10,0.94)`.
- Aktiver Tab bekommt klaren oberen Strich oder kleine Glow-Linie, nicht nur andere Textfarbe.
- Benachrichtigungsglocke integrieren oder an die Tabbar anpassen, damit sie nicht wie ein Fremdkoerper ueber dem UI schwebt.
- Tab-Reihenfolge pruefen: Home, Turniere, Teams/Events, Jahreswertung/News, Profil/Mehr. Ziel ist weniger Springen zwischen "Mehr" und Haupttabs.

Gemeinsame UI-Muster:

- `StatusBadge` / `PhaseBadge` als App-Komponente nach Web-Vorbild nachziehen.
- `ActionRow` fuer kompakte Icon-Actions statt grosser Buttons, z.B. Profil bearbeiten, Aktualisieren, Datenschutz, Logout.
- `ContentCard` fuer Turnier/Event/Fast-Lap/News vereinheitlichen: Bild, Status, Datum, Primaraktion.
- `SegmentedTabs` fuer sichtbare Seitenwechsel statt versteckter horizontaler Scroll-Tabs.
- `EmptyState`, `SkeletonList`, Fehler- und Offline-Zustaende optisch angleichen.

Mobile Website:

- Pruefen, ob die BottomNav fuer eingeloggte User "Events" oder "Season/Jahreswertung" sinnvoller priorisiert, weil Events/Turniere/Jahreswertung fuer Vereinsbetrieb wichtiger sind.
- Mobile Header und BottomNav duerfen sich nicht doppelt anfuehlen: Burger-Menue bleibt fuer tiefe Navigation, BottomNav fuer Hauptwege.
- Scroll-Top-Button und Bottom-Banner muessen mit BottomNav/Safe-Area sauber zusammenspielen.
- Admin- und Profilseiten mobil weiter verdichten: Tabellenkarten, Sticky-Actions und weniger horizontales Scrollen.

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

- Startseite staerker nach aktuellen Prioritaeten steuern: naechstes Event, laufende Turniere, aktuelle News, Jahreswertung.
- Turnier-, Event- und Fast-Lap-Seiten angleichen: konsistente Hero-Infos, Status, Anmeldung, Zeitplan, Regeln, Preise, Galerie/Rueckblick.
- News-Seiten mit besseren Inhaltsbausteinen: Embed-Karten, Autoren-/Kategoriezeile, "Weiterlesen", verwandte Turniere/Events, Rueckblick-Galerien.
- Community-Bereich klarer strukturieren: Spieler, Teams, Server, Mitglieder, Achievements und Referenzen als zusammenhaengende Community-Welt.
- Sponsoren/Partner sichtbarer machen: Partnerkarten, Sponsoren-Tiers, Verknuepfung mit Events, Footer/SEO-Daten sauber halten.

Navigation und Informationsarchitektur:

- Hauptnavigation pruefen: Besucher brauchen andere Wege als eingeloggte Spieler oder Admins.
- "Mein Bereich" klarer als Spieler-Dashboard positionieren, getrennt von oeffentlichem Profil.
- Mobile BottomNav und Desktop-Nav inhaltlich aufeinander abstimmen.
- Breadcrumbs/Zurueck-Links auf tiefen Seiten wie Match, Bracket, Standings und Galerie konsequent einsetzen.
- Interne Suche oder Quick-Jump fuer Turniere, Events, News, Spieler und Teams pruefen.

Performance und technische Qualitaet:

- Bildstrategie haerten: responsive Bildgroessen, Lazy Loading, feste Aspect Ratios, saubere Fallbacks, WebP/AVIF wo sinnvoll.
- Bundle pruefen: Admin-Schwergewichte lazy laden, Display-Seiten separat halten, Editor/Charts nur bei Bedarf laden.
- Core-Web-Vitals-Ziele definieren: schnelle Startseite, stabile Layouts ohne Spruenge, schnelle Detailseiten.
- API-Responses fuer Listen vereinheitlichen: kompakte Karten-Daten statt komplette Detailobjekte, Pagination/Filter sauber.
- Fehlerseiten und Ladezustand modernisieren: 404/403/500 mit klarer Rueckfuehrung statt nur "nicht gefunden".

SEO, Sharing und Content-Betrieb:

- SEO-Vorschau im Admin: Titel, Beschreibung, Canonical, OG-Bild und Social Preview vor Veroeffentlichung ansehen.
- Sitemap und SEO-Preview regelmaessig gegen echte Routen pruefen, inklusive Turnier-Bracket, Standings, Fast-Lap, Galerie und Profilen.
- Redaktions-Checkliste fuer News/CMS: Titel, Teaser, Banner, Embeds, Sichtbarkeit, SEO, Newsletter, Discord.
- Strukturierte Daten erweitern: Event, SportsEvent/Competition, Organization, Breadcrumb, Article, ImageObject.
- IndexNow/Search-Console-Submit nach wichtigen Veroeffentlichungen automatisieren oder im Admin klarer anzeigen.

Admin und Redaktion:

- Admin-Dashboard als echte Tageszentrale: offene Aufgaben, kaputte Medien, ausstehende Anmeldungen, Ergebnis-Konflikte, Newsletter-Queue, Systemstatus.
- Admin-Listen vereinheitlichen: Filter, Suche, gespeicherte Ansichten, Bulk-Actions und Export pro Bereich.
- Turnier-Editor entlasten: Setup-Assistent fuer lokales/online/hybrid Turnier, Regeln, Stationen, Ergebnisfluss und Kommunikation.
- Medienbibliothek erweitern: fehlende Alt-Texte, doppelte Dateien, ungenutzte Dateien, kaputte Referenzen, Bildzuschnitt.
- Audit- und Rollenansicht besser erreichbar machen: wer darf was, wer hat was geaendert, welche Staff-Zuweisung gilt wo.

Live- und Event-Erlebnis:

- Display-Seiten als eigener Modus ausbauen: Bracket-TV, Fast-Lap-TV, Event-Ticker, Station-Status, Sponsorrotation.
- Oeffentliche Live-Seiten fuer lokale Events: Zeitplan, laufende Matches, naechste Station, Ergebnis-Ticker.
- Nach dem Event automatisch Rueckblick vorbereiten: Gewinner, Podium, Galerie, News-Entwurf, Social-Share.
- QR-Codes fuer Vor-Ort-Wege: Check-in, Match, Station, Galerie-Upload, Feedback.

Barrierefreiheit und Vertrauen:

- Tastaturbedienung und Fokus-Stile fuer Navigation, Modals, Editor, Tabellen und Formulare pruefen.
- Kontraste fuer Cyan/Gold auf dunklem Hintergrund systematisch testen.
- Formulare mit klaren Fehlermeldungen, Pflichtfeldhinweisen und sinnvoller Tab-Reihenfolge.
- Datenschutz/Cookie/Analytics sichtbar nachvollziehbar halten, besonders bei Embeds, Twitch und externen Medien.

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

- Bestehende `season_points`, `season_standings` und `SeasonPage` weiterverwenden.
- UI-Begriffe vereinheitlichen, damit "Season-Punkte", "Profilpunkte" und "Achievements" nicht vermischt werden.
- Mobile `SeasonPassScreen` in Richtung "Jahreswertung" umbauen.

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

## Phase 10 - Beta 0.12.0-beta.2

Fuer den naechsten APK-Build:

- [x] Version auf `0.12.0-beta.2` setzen.
- [x] Android `versionCode` auf `28` erhoehen.
- [x] Changelog mit Match-Regeln, Embed-Karten, Profilnavigation und App-Design-Rework aktualisieren.
- [x] Vor Release pruefen: `npm run typecheck`, `npm audit --audit-level=moderate`, mobile Preflight, Backend-Tests fuer Match-Regeln.
- [ ] APK-Build ueber GitHub Actions starten und Smoke-Test auf echtem Android-Geraet durchfuehren.
- [ ] Optional danach Release-Tag `mobile-v0.12.0-beta.2` setzen, wenn der APK-Smoke-Test passt.

## Prioritaet

1. Backend-Regelmodell fuer Ergebnis- und Terminrechte.
2. Mobile Match-Hub passend zu lokalen und Online-Turnieren.
3. Admin-UI/Turnier-Setup fuer `event_mode`, `result_entry_mode` und `schedule_mode` vollstaendig nachziehen.
4. Embed-Daten in RichText/News/Info-Center vollstaendig anliefern und Fallback-Balken weiter reduzieren.
5. Mobile Design-System mit Bottom-Bar/Blur, gemeinsamen Cards und Tabs modernisieren.
6. Website-Modernisierung: Public Experience, SEO, Performance, Admin-Workflows und Live-Seiten.
7. Profil und Mehr-Navigation modernisieren.
8. Jahreswertung benennen und in App/Web klar darstellen.
9. Staff-Dashboard, QR-Flows und Beta-Feedback als naechste Erweiterungen vorbereiten.
10. Beta.2 bauen und testen.
