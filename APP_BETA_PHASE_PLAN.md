# App- und Turnier-Beta-Phasenplan

Stand: 2026-05-21

Dieser Plan buendelt die naechsten sinnvollen Arbeiten fuer App, Website und Backend. Fokus ist, dass lokale Events, Online-Turniere, Fast-Lap-Inhalte, Profilbedienung und die Jahreswertung logisch sauber zusammenpassen.

## Aktuelle Befunde

- Ergebnislogik ist teilweise vorhanden: Bei klassischen Online-Matches koennen Teilnehmer Ergebnisse melden. Stimmen die letzten zwei Reports ueberein, wird das Match automatisch abgeschlossen. Weichen sie ab, geht das Match auf Klaerung.
- Staff-Erfassung ist vorhanden: Turnierleitung kann klassische Matches direkt aktualisieren und V2-Heats ueber `/api/matches/{id}/result` werten.
- Es fehlt eine explizite Turnier-Regel, die unterscheidet zwischen Vor-Ort-Staff-only, Online-Doppelmeldung und Hybrid. Aktuell ergibt sich viel aus Berechtigungen, aber nicht aus einer klaren Event-/Turnierart.
- Terminabstimmung ist in der App fuer Teilnehmer sichtbar, sobald `can_act` gilt. Fuer lokale, vorgeplante Events wirkt "Termin vorschlagen" deshalb unpassend.
- Mobile Embeds sind nur kompakte blaue Hinweis-Balken. Website-Embeds rendern bereits als Bildkarte mit Status, Datum und Beschreibung.
- Fast-Lap-Strecken haben im mobilen Typ bereits `image_url`, werden im Detailscreen aber nicht sichtbar als Streckenbild verwendet.
- Mobile Statuslabels sind zu technisch. `formatStatus()` ersetzt aktuell nur Unterstriche, wodurch Werte wie `approved` oder `waiting_result` roh wirken.
- Das Profil ist funktional, aber schwerer zu bedienen als noetig: Tabs sind horizontal versteckt, Bearbeiten und Abmelden wirken zu gross, Gruppen bleiben offen, und die Mehr-Navigation merkt sich Unterseiten.
- Season-Punkte existieren bereits beim Status `results_published`. Teilnahme, Platzierung, Gewichtung und Jahreswertung sind also kein kompletter Neubau, brauchen aber bessere Benennung, Transparenz und App-Darstellung.
- Die mobile Website hat bereits eine app-artige Bottom-Navigation mit dunkler Transparenz, `backdrop-blur-xl`, Safe-Area-Padding, Icon-Fokus und aktivem Top-Indikator. Die native App-Tabbar ist dagegen noch einfacher und kann diese Designsprache aufnehmen.
- Web und App nutzen aehnliche Inhalte, aber noch nicht immer dieselben UX-Muster: Statusbadges, Embed-Karten, Listen, Tabs, Actions und leere Zustaende sollten staerker vereinheitlicht werden.

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

## Phase 7 - Jahreswertung statt unklarer Season-Pass

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

## Phase 8 - Weitere sinnvolle Erweiterungen

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

## Phase 9 - Beta 0.12.0-beta.2

Fuer den naechsten APK-Build:

- Version auf `0.12.0-beta.2` setzen.
- Android `versionCode` auf `28` erhoehen.
- Changelog mit Match-Regeln, Embed-Karten, Profilnavigation, App-Design-Rework und Jahreswertung aktualisieren.
- Vor Release pruefen: `npm run typecheck`, `npm audit --audit-level=moderate`, mobile Preflight, Backend-Tests fuer Match-Regeln.

## Prioritaet

1. Backend-Regelmodell fuer Ergebnis- und Terminrechte.
2. Mobile Match-Hub passend zu lokalen und Online-Turnieren.
3. Statuslabels zentral sauber machen.
4. Embed-Karten und Fast-Lap-Streckenbilder.
5. Mobile Design-System mit Bottom-Bar/Blur, gemeinsamen Cards und Tabs modernisieren.
6. Profil und Mehr-Navigation modernisieren.
7. Jahreswertung benennen und in App/Web klar darstellen.
8. Staff-Dashboard, QR-Flows und Beta-Feedback als naechste Erweiterungen vorbereiten.
9. Beta.2 bauen und testen.
