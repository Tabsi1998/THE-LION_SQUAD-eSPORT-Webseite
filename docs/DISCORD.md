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

## Der Bot

Der Bot läuft **im Backend** mit – kein eigener Container, nichts in der `.env`. Alles, was er
braucht, steht unter Admin → Einstellungen → Discord → „Discord-Bot“. Er tut drei Dinge, und
jedes nur für Konten, die im Profil verknüpft sind (Abschnitt oben):

- **Zählen:** Jede Nachricht eines verknüpften Mitglieds zählt eins hoch (für die Erfolge
  „Discord-Aktiv“). Gezählt wird die Zahl, nie der Inhalt – der Bot hat kein Recht, Nachrichten
  zu lesen. Nicht verknüpfte Konten und andere Bots zählen nicht.
- **Rollen:** Aktives Mitglied ↔ Rolle „Mitglied“, Vorstand ↔ „Vorstand“, Turnierleitung ↔
  „Turnierleitung“. Der Abgleich läuft alle zehn Minuten und auf Knopfdruck („Rollen jetzt
  abgleichen“). Der Bot fasst **nur diese drei Rollen** an – andere Rollen bleiben, wie sie sind.
  Die Namen lassen sich in den Einstellungen ändern; fehlt eine Rolle im Discord, steht das dort.
- **Befehle:** `/naechstes-event`, `/turniere` (offene Anmeldungen), `/meine-erfolge` (nur
  verknüpft, Antwort nur für einen selbst), `/status` (nur Vorstand, Antwort nur für einen selbst).

### Einrichten (einmalig, im Admin beschrieben)

1. discord.com/developers → dieselbe App wie fürs Konto-Verknüpfen → **Bot** → „Reset Token“ →
   Token unter „Bot-Token“ eintragen und speichern. Der Token wird verschlüsselt abgelegt und nie
   wieder angezeigt; leer lassen heißt behalten. Nur der Superadmin kann ihn entfernen.
2. Dort unter „Privileged Gateway Intents“ den **Server Members Intent** einschalten (für den
   Rollenabgleich). „Message Content“ bleibt aus.
3. OAuth2 → URL Generator: Scopes `bot` + `applications.commands`, Recht „Manage Roles“ – mit
   der Adresse den Bot auf den Server holen. Im Discord die Bot-Rolle in der Rollenliste **über**
   Mitglied/Vorstand/Turnierleitung ziehen, sonst darf er sie nicht vergeben.
4. „Bot verbinden“ anhaken. Der Stand (online/aus, Servername, letzte Aktion, letzter Fehler)
   steht direkt darunter. Die Server-ID ist nur nötig, wenn der Bot auf mehreren Servern ist.

Jede Änderung an Token, Server-ID, Rollen oder Zählschalter startet den Bot neu; „Bot verbinden“
aus hält ihn an. Lehnt Discord die Verbindung ab (Intent im Portal aus, Token falsch), steht der
Grund als Klickweg unter „Letzter Fehler“, und der Bot versucht es alle fünf Minuten von selbst
wieder – nichts muss dafür neu gespeichert werden. Ist der Bot aus, laufen Webhooks, Meldungen und Konto-Verknüpfung unverändert
weiter – er ist eine Ergänzung, keine Voraussetzung.

## Für die Entwicklung

- `backend/discord_service.py`: `TARGETS`, `EVENTS`, `resolve_target`,
  `send_event` (Schalter, Ziel, Grenze privat/öffentlich), `send_to`,
  `build_embed`, `target_status`, `broken_targets`. Die alten `send_discord`,
  `send_public_discord`, `send_ops_discord` sind dünne Hüllen darum.
- `backend/services/discord_announcements.py`: `announce_due` (Job, jede
  Minute), `news_message`, `event_message`, `preview`, `notify_board`.
- `backend/services/achievement_queue.py`: `request_evaluation`,
  `process_queue`, `sweep`, `note_award`, `flush_awards`.
- `backend/services/discord_bot.py`: reine Logik oben (`bot_settings`,
  `desired_roles`, `role_diff`, `counted_user`, Befehlstexte), Daten
  (`linked_discord_ids`, `count_message`, `wanted_roles_by_user`,
  `record_state`/`read_state`), `BotRunner` (`start_if_enabled`, `stop`,
  `apply_settings`, `status`, `sync_roles`) um discord.py. Routen
  `routes/discord_bot_routes.py` (`/api/settings/discord/bot/status|sync|restart`),
  Job `discord_bot_roles` alle zehn Minuten, Start im Lifespan.
- **Neues Ereignis:** in `EVENTS` eintragen (Ziel, Beschriftung, Standard
  **aus**), über `send_event` senden, und ein Test, dass es mit privater
  Sichtbarkeit nicht an ein öffentliches Ziel geht.
