# Discord-Meldungen

Was die Website in den Discord schickt, wohin, und was **nie** dorthin geht.
Einstellen unter Admin → Einstellungen → Discord (Bereich „System“).

## Die eine Regel

**Was nur Mitglieder oder der Vorstand sehen dürfen, geht nie in einen
öffentlichen Kanal – und ein privater Kanal fällt nie auf einen öffentlichen
zurück.** Das entscheidet eine Stelle im Code (`discord_service.send_event`),
egal welcher Schalter an ist. Discord ist ein fremder Dienst: Auch in den
privaten Vorstands-Kanal gehen keine Namen, Adressen oder Nachrichtentexte.

## Kanäle (Ziele)

| Ziel | Was | Ohne eigenen Webhook |
| --- | --- | --- |
| **Community** | Standard für alles Öffentliche | – (ohne ihn geht nichts Öffentliches hinaus) |
| **News** | veröffentlichte News | geht an Community |
| **Events und Turniere** | angekündigte Events, Turnier-Meldungen, Fast-Lap-Bestzeiten | geht an Community |
| **Erfolge** | freigeschaltete Erfolge | geht an Community |
| **Vorstand** (privat) | neuer Mitgliedsantrag, neue Kontaktanfrage – nur der Hinweis | **es wird nichts gesendet** |
| **Betrieb** (privat) | rote Auto-Checks, neue Serverfehler | **es wird nichts gesendet** |

Einen Webhook legt man in Discord an: Kanal → Zahnrad → Integrationen →
Webhooks → Neuer Webhook → „Webhook-URL kopieren“. Die Adresse wird
verschlüsselt gespeichert und nie wieder angezeigt. Je Ziel gibt es „Test“; der
Test sagt dazu, wenn er mangels eigenem Webhook in der Community gelandet ist.

## Schalter je Ereignis

Neue Ereignisse sind **aus**, bis man sie einschaltet: *News veröffentlicht*,
*Event angekündigt*, *Neuer Mitgliedsantrag*, *Neue Kontaktanfrage*. Was es
schon gab, bleibt an: Turnier (Anmeldung offen, live, beendet, Ergebnisse),
Fast-Lap-Bestzeit, Erfolg freigeschaltet.

Wer einen Schalter einschaltet, bekommt **nicht das Archiv** in den Kanal:
Gemeldet wird nur, was ab dann veröffentlicht wird (und nichts, was älter als
24 Stunden ist).

## News und Events

- Ein Job sieht jede Minute nach. Damit gilt dasselbe für „sofort
  veröffentlicht“ und „geplant für 18 Uhr“, und jede News, jedes Event wird
  genau einmal geprüft.
- Die Meldung trägt Bild (Banner), Link, bei Events Zeit **in Wiener Zeit mit
  „Uhr“**, Ort, Anmeldeschluss und Plätze.
- Im Formular von News und Events: **„So sieht die Meldung aus“** zeigt
  dasselbe Embed und sagt, ob und wohin es ginge – oder warum nicht. Der Haken
  **„Ohne Discord veröffentlichen“** gilt für genau diesen Eintrag.
- Nie gemeldet: Entwürfe, Vergangenes, Inhalte für Mitglieder oder intern.

## Erfolge

- Erfolge werden vergeben, **sobald etwas passiert** (bestätigtes Ergebnis,
  Turnierabschluss, Bestzeit …) – nicht erst beim Profilbesuch. Dazu alle 15
  Minuten eine Runde über die zuletzt Aktiven und einmal am Tag über alle.
  Stand und „Alle jetzt auswerten“: Admin → Achievements.
- Gemeldet wird **gebündelt**: mehrere Erfolge derselben Person innerhalb einer
  Minute ergeben eine Meldung („3 Erfolge freigeschaltet“).
- Im Discord genannt wird nur, wer ein **öffentliches Profil** hat, und nur für
  **öffentliche** Erfolgsgruppen. Negative Auszeichnungen werden nie gemeldet.
  Die Benachrichtigung an die Person selbst kommt immer.

## Wenn etwas nicht ankommt

- Ist ein Webhook kaputt (Discord antwortet 401, 403 oder 404 – meist wurde
  der Webhook oder der Kanal gelöscht), steht das in der **Tageszentrale** und
  beim Ziel in den Einstellungen.
- Eine fehlgeschlagene Meldung lässt sich aus dem Versand-Log erneut senden –
  immer an dasselbe Ziel, nie an ein anderes.

## Konten verknüpfen (Discord, Twitch, Steam)

Mitglieder verknüpfen im Profil → Socials ihr Discord-, Twitch- oder Steam-Konto per Anmeldung
bei der Plattform; der Eintrag wird befüllt und trägt „verifiziert“. Was ihr dafür einrichtet:

1. **Discord-App:** discord.com/developers → New Application → OAuth2. Client-ID und Client
   Secret unter Admin → Einstellungen → Anmeldung → „Konten verknüpfen“ eintragen. Unter
   „Redirects“ die Adresse `https://lionsquad.at/api/platform-links/discord/callback` hinterlegen
   (steht dort zum Kopieren). Mehr braucht die App nicht – kein Bot, keine Rechte.
2. **Twitch:** die Helix-App aus dem Twitch-Reiter genügt; in der Twitch Developer Console
   zusätzlich `https://lionsquad.at/api/platform-links/twitch/callback` als OAuth Redirect URL
   eintragen.
3. **Steam:** nichts einzurichten. Optional ein Web-API-Schlüssel (steamcommunity.com/dev/apikey),
   dann steht der Anzeigename statt der SteamID an der Verknüpfung.

Was die Website erhält: Kennung und Nutzer-/Anzeigename des Kontos (Steam: SteamID64) und den
Zeitpunkt – keine Passwörter, keine Freundeslisten, keine Nachrichten. Trennen geht jederzeit im
Profil; der Text bleibt, das Häkchen nicht. Ein Konto kann nur an einem Profil hängen.

## Für die Entwicklung

- `backend/discord_service.py`: `TARGETS`, `EVENTS`, `resolve_target`,
  `send_event` (Schalter, Ziel, Grenze privat/öffentlich), `send_to`,
  `build_embed`, `target_status`, `broken_targets`. Die alten `send_discord`,
  `send_public_discord`, `send_ops_discord` sind dünne Hüllen darum.
- `backend/services/discord_announcements.py`: `announce_due` (Job, jede
  Minute), `news_message`, `event_message`, `preview`, `notify_board`.
- `backend/services/achievement_queue.py`: `request_evaluation`,
  `process_queue`, `sweep`, `note_award`, `flush_awards`.
- **Neues Ereignis:** in `EVENTS` eintragen (Ziel, Beschriftung, Standard
  **aus**), über `send_event` senden, und ein Test, dass es mit privater
  Sichtbarkeit nicht an ein öffentliches Ziel geht.
