# Discord-Meldungen

Was die Website in den Discord schickt, wohin, und was **nie** dorthin geht.
Einstellen unter Admin → Verbindungen → Discord. Seit Discord III (#566) schickt **der Bot**
alles – Webhook-Adressen gibt es nicht mehr.

## Die eine Regel

**Was nur Mitglieder oder der Vorstand sehen dürfen, geht nie in einen
öffentlichen Kanal – und ein privater Kanal fällt nie auf einen öffentlichen
zurück.** Das entscheidet eine Stelle im Code (`discord_service.send_event`),
egal welcher Schalter an ist. Discord ist ein fremder Dienst: Auch in den
privaten Vorstands-Kanal gehen keine Namen, Adressen oder Nachrichtentexte.

Und die zweite, seit #566: **Bot aus = keine Meldung.** Ist der Bot aus oder
nicht verbunden, wird nichts gesendet – kein Rückfall auf einen anderen Weg.
Der Versand-Log hält es mit Grund fest („Der Bot ist aus …“), Betrieb & Logs
zeigt es.

## Kanäle (Ziele)

| Ziel | Was | Ohne eigenen Kanal |
| --- | --- | --- |
| **Community** | Standard für alles Öffentliche | – (ohne ihn geht nichts Öffentliches hinaus) |
| **News** | veröffentlichte News | geht an Community |
| **Events und Turniere** | angekündigte Events, Turnier-Meldungen, Fast-Lap-Bestzeiten | geht an Community |
| **Vorstand** (privat) | neuer Mitgliedsantrag, neue Kontaktanfrage – nur der Hinweis | **es wird nichts gesendet** |
| **Betrieb** (privat) | rote Auto-Checks, neue Serverfehler | **es wird nichts gesendet** |

Je Ziel wählt man einen Kanal aus der Liste des Servers – die Liste zeigt die
Textkanäle mit dem, was der Bot dort darf; Kanäle ohne „Nachrichten senden“
sind ausgegraut. Ist der Bot gerade nicht verbunden, lässt sich stattdessen
die Kanal-ID eintragen (Discord → Einstellungen → Erweitert → Entwicklermodus,
Rechtsklick auf den Kanal → „Kanal-ID kopieren“). Je Ziel gibt es „Test“; der
Test sagt dazu, wenn er mangels eigenem Kanal in der Community gelandet ist.

Der Bot braucht im gewählten Kanal **„Kanal ansehen“, „Nachrichten senden“ und
„Links einbetten“** (Kanal → Bearbeiten → Berechtigungen → Bot-Rolle). Fehlt
ein Recht, steht das beim Ziel und in der Tageszentrale mit genau diesem
Klickweg.

Erfolge gehen seit #566 in keinen Kanal mehr; die Person selbst bekommt die
Gratulation (Discord III Teil 3, #568).

## Schalter je Ereignis

Neue Ereignisse sind **aus**, bis man sie einschaltet: *News veröffentlicht*,
*Event angekündigt*, *Neuer Mitgliedsantrag*, *Neue Kontaktanfrage*. Was es
schon gab, bleibt an: Turnier (Anmeldung offen, live, beendet, Ergebnisse),
Fast-Lap-Bestzeit.

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
  dasselbe Embed und sagt, ob und wohin es ginge – oder warum nicht (Bot aus,
  kein Kanal, privat, Schalter aus). Der Haken **„Ohne Discord
  veröffentlichen“** gilt für genau diesen Eintrag.
- Nie gemeldet: Entwürfe, Vergangenes, Inhalte für Mitglieder oder intern.

## Erfolge

- Erfolge werden vergeben, **sobald etwas passiert** (bestätigtes Ergebnis,
  Turnierabschluss, Bestzeit …) – nicht erst beim Profilbesuch. Dazu alle 15
  Minuten eine Runde über die zuletzt Aktiven und einmal am Tag über alle.
  Stand und „Alle jetzt auswerten“: Admin → Achievements.
- Die Person selbst erfährt es **gebündelt**: mehrere Erfolge innerhalb einer
  Minute ergeben eine Benachrichtigung („3 Erfolge freigeschaltet“) – in der
  App, per Push und, mit Discord als Kanal, als **Gratulation vom Bot** (#568):
  „Stark, Paula! 2 Erfolge freigeschaltet“ mit Erfolgsnamen, Gruppe, Punkten,
  Farbe der höchsten Stufe und dem Weg zum Profil-Reiter „Erfolge“. Das Thema
  „Erfolge“ in den Benachrichtigungen schaltet es je Kanal ab; eine E-Mail
  dafür gibt es nicht. Negative Auszeichnungen werden nie gemeldet. In einen
  Kanal geht nichts mehr.

## Wenn etwas nicht ankommt

- Darf der Bot in einem gewählten Kanal nicht schreiben oder gibt es den Kanal
  nicht mehr, steht das in der **Tageszentrale** und beim Ziel in den
  Einstellungen – mit dem Klickweg zu den Berechtigungen.
- Ist der Bot aus oder nicht verbunden, steht die Meldung als „nicht gesendet“
  mit Grund im Versand-Log (Betrieb & Logs → Ereignisse, Quelle E-Mail/Discord).
- Eine fehlgeschlagene Meldung lässt sich aus dem Versand-Log erneut senden –
  immer an dasselbe Ziel, nie an ein anderes. Kanal und Nachrichten-ID jeder
  gesendeten Meldung stehen im Log – die Grundlage, um Nachrichten später zu
  bearbeiten (Discord IV).

## Discord als persönlicher Benachrichtigungskanal (#567)

Wer sein Discord-Konto verknüpft hat, kann unter Profil → Benachrichtigungen den Kanal
**Discord** einschalten (Standard aus): dieselben Benachrichtigungen wie In-App und Push kommen
dann als **Direktnachricht vom Vereins-Bot** – Titel, Text, Link zur Website; die Themen-Schalter
gelten wie bei Push. Ohne Verknüpfung gibt es den Kanal nicht.

- Nie in einer Direktnachricht: Nachrichtentexte anderer Personen (nur „du hast eine Nachricht“
  mit Link), Moderation, Zahlungsdaten. Was nicht per Push geht, geht auch nicht per Discord.
- Discord stellt Direktnachrichten nur zu, wenn die Person mit dem Bot einen Server teilt und
  „Direktnachrichten von Servermitgliedern“ erlaubt. Lehnt Discord ab, bleibt es bei In-App und
  Push; die Website merkt sich das (`discord_dm_blocked_at`) und zeigt in den Einstellungen den
  Klickweg. Klappt es wieder, verschwindet der Hinweis.
- Bot aus oder nicht verbunden: keine Direktnachricht, Grund im Versand-Log (Ziel `dm`).
- Code: `services/discord_dm.py` (`send_discord_dm_for_notification`, `dm_content`, `dm_state`),
  `notification_preferences.discord_allowed`, `BotRunner.send_dm`; der Fan-out sitzt in
  `user_notifications.create_user_notification` neben Push.

## Konten verknüpfen (Discord, Twitch, Steam)

Mitglieder verknüpfen im Profil → Socials ihr Discord-, Twitch- oder Steam-Konto per Anmeldung
bei der Plattform; der Eintrag wird befüllt und trägt „verifiziert“. Was ihr dafür einrichtet:

1. **Discord-App:** discord.com/developers → New Application → OAuth2. Client-ID und Client
   Secret unter Admin → Verbindungen → Discord eintragen. Unter „Redirects“ die Adresse
   `https://lionsquad.at/api/platform-links/discord/callback` hinterlegen (steht dort zum
   Kopieren). Am einfachsten dieselbe App wie der Bot.
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
braucht, steht unter Admin → Verbindungen → Discord → „Discord-Bot“. Er tut vier Dinge:

- **Meldungen** (#566): News, Events, Turnier-Meldungen, Fast-Lap-Bestzeiten, Vorstands-Hinweise
  und Betriebsalarme in die gewählten Kanäle – Abschnitt oben. Ist er aus, gibt es keine Meldungen.
- **Zählen:** Jede Nachricht eines verknüpften Mitglieds zählt eins hoch (für die Erfolge
  „Discord-Aktiv“). Gezählt wird die Zahl, nie der Inhalt – der Bot hat kein Recht, Nachrichten
  zu lesen. Nicht verknüpfte Konten und andere Bots zählen nicht.
- **Rollen:** Aktives Mitglied ↔ Rolle „Mitglied“, Vorstand ↔ „Vorstand“, Turnierleitung ↔
  „Turnierleitung“. Der Abgleich läuft alle zehn Minuten und auf Knopfdruck („Rollen jetzt
  abgleichen“). Der Bot fasst **nur diese drei Rollen** an – andere Rollen bleiben, wie sie sind.
  Die Namen lassen sich in den Einstellungen ändern; fehlt eine Rolle im Discord, steht das dort.
- **Befehle:** `/naechstes-event`, `/turniere` (offene Anmeldungen), `/meine-erfolge` (nur
  verknüpft, Antwort nur für einen selbst), `/status` (nur Vorstand, Antwort nur für einen selbst).

Zählen, Rollen und Befehle gelten nur für Konten, die im Profil verknüpft sind (Abschnitt oben).

### Einrichten (einmalig, im Admin beschrieben)

1. discord.com/developers → dieselbe App wie fürs Konto-Verknüpfen → **Bot** → „Reset Token“ →
   Token unter „Bot-Token“ eintragen und speichern. Der Token wird verschlüsselt abgelegt und nie
   wieder angezeigt; leer lassen heißt behalten. Nur der Superadmin kann ihn entfernen.
2. Dort unter „Privileged Gateway Intents“ den **Server Members Intent** einschalten (für den
   Rollenabgleich). „Message Content“ bleibt aus – auch fürs Senden nicht nötig.
3. OAuth2 → URL Generator: Scopes `bot` + `applications.commands`, Rechte „View Channels“,
   „Send Messages“, „Embed Links“, „Read Message History“, „Manage Roles“ – mit der Adresse den
   Bot auf den Server holen. Im Discord die Bot-Rolle in der Rollenliste **über**
   Mitglied/Vorstand/Turnierleitung ziehen, sonst darf er sie nicht vergeben.
4. „Bot verbinden“ anhaken. Der Stand (online/aus, Servername, letzte Aktion, letzter Fehler)
   steht direkt darunter. Die Server-ID ist nur nötig, wenn der Bot auf mehreren Servern ist.
5. Unter „Kanäle je Zweck“ je Ziel den Kanal wählen und „Test“ klicken.

Jede Änderung an Token, Server-ID, Rollen oder Zählschalter startet den Bot neu; „Bot verbinden“
aus hält ihn an – und damit auch alle Meldungen. Lehnt Discord die Verbindung ab (Intent im
Portal aus, Token falsch), steht der Grund als Klickweg unter „Letzter Fehler“, und der Bot
versucht es alle fünf Minuten von selbst wieder – nichts muss dafür neu gespeichert werden. Die
Konto-Verknüpfung läuft unabhängig vom Bot weiter.

## Für die Entwicklung

- `backend/discord_service.py`: `TARGETS`, `EVENTS`, `REASON_TEXTS`, `resolve_target`,
  `send_event` (Schalter, Ziel, Grenze privat/öffentlich), `send_to` (Bot aus, Kanal fehlt,
  Versand über `discord_bot.bot.send_embed`), `build_embed`, `target_status`, `broken_targets`.
  Die alten `send_discord`, `send_public_discord`, `send_ops_discord` sind dünne Hüllen darum.
  Versand-Log: `email_logs` mit `channel: "discord"`, `target`, `status` (sent/failed/skipped),
  `reason`, `channel_id`, `message_id`, `payload`.
- `backend/services/discord_bot.py`: reine Logik oben (`bot_settings`, `desired_roles`,
  `role_diff`, `counted_user`, `channel_row`, `sorted_channels`, Befehlstexte), Daten
  (`linked_discord_ids`, `count_message`, `wanted_roles_by_user`, `record_state`/`read_state`),
  `BotRunner` (`start_if_enabled`, `stop`, `apply_settings`, `status`, `sync_roles`,
  `list_channels`, `send_embed`) um discord.py. Routen `routes/discord_bot_routes.py`
  (`/api/settings/discord/bot/status|sync|restart`) und `GET /api/settings/discord/channels`,
  Job `discord_bot_roles` alle zehn Minuten, Start im Lifespan.
- `backend/services/discord_announcements.py`: `announce_due` (Job, jede Minute),
  `news_message`, `event_message`, `preview`, `notify_board`.
- `backend/services/achievement_queue.py`: `request_evaluation`, `process_queue`, `sweep`,
  `note_award`, `flush_awards` (nur noch Benachrichtigung an die Person).
- Migration 3 (`services/migrations.py`) verwirft gespeicherte Webhook-Adressen, Absendername
  und Avatar.
- **Neues Ereignis:** in `EVENTS` eintragen (Ziel, Beschriftung, Standard **aus**), über
  `send_event` senden, und ein Test, dass es mit privater Sichtbarkeit nicht an ein
  öffentliches Ziel geht. Tests stellen den Bot mit `monkeypatch.setattr(discord_bot.bot,
  "send_embed", …)` nach.
