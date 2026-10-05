# Discord-Meldungen

Was die Website in den Discord schickt, wohin, und was **nie** dorthin geht.
Einstellen unter Admin → Verbindungen → Discord. Seit Discord III (#566) schickt **der Bot**
alles – Webhook-Adressen gibt es nicht mehr.

## Die eine Regel

**Was nur Mitglieder oder der Vorstand sehen dürfen, geht nie in einen
öffentlichen Kanal – und ein privater Kanal fällt nie auf einen öffentlichen
zurück.** Internes geht auch nie in den Mitgliederkanal (#605). Das entscheidet
eine Stelle im Code (`discord_service.send_event` mit `allowed_in_target`),
egal welcher Schalter an ist. Discord ist ein fremder Dienst: Auch in den
privaten Vorstands-Kanal gehen keine Namen, Adressen oder Nachrichtentexte –
interne News und Events dort nur mit Titel, Zeit, Ort und Link.

Und die zweite, seit #566: **Bot aus = keine Meldung.** Ist der Bot aus oder
nicht verbunden, wird nichts gesendet – kein Rückfall auf einen anderen Weg.
Der Versand-Log hält es mit Grund fest („Der Bot ist aus …“), Betrieb & Logs
zeigt es.

## Kanäle (Ziele)

| Ziel | Was | Ohne eigenen Kanal |
| --- | --- | --- |
| **Community** | Standard für alles Öffentliche | – (ohne ihn geht nichts Öffentliches hinaus) |
| **News** | veröffentlichte News | geht an Community |
| **Events und Turniere** | angekündigte Events, Fast-Lap-Bestzeiten, Turnier-Meldungen – je Turnier eine im Kanal, alles Weitere im Thread darunter | geht an Community |
| **Mitglieder** (privat, #605) | News und Events nur für Mitglieder – der Kanal ist im Discord nur für die Rolle „Mitglied“ sichtbar | **es wird nichts gesendet** |
| **Vorstand** (privat) | neuer Mitgliedsantrag, neue Kontaktanfrage – nur der Hinweis; interne News und Events nur mit Titel, Zeit, Ort | **es wird nichts gesendet** |
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
Klickweg. Wo Turnier-Meldungen landen (Events und Turniere, ohne eigenen Kanal
die Community), zusätzlich **„Öffentliche Threads erstellen“ und „Nachrichten
in Threads senden“** – fehlt eins, sagt die Kanalliste „ohne Threads:
Turnier-Meldungen einzeln“.

Erfolge gehen seit #566 in keinen Kanal mehr; die Person selbst bekommt die
Gratulation (Discord III Teil 3, #568).

## Schalter je Ereignis

Neue Ereignisse sind **aus**, bis man sie einschaltet: *News veröffentlicht*,
*Event angekündigt*, *Neuer Mitgliedsantrag*, *Neue Kontaktanfrage* und die
Gegenstücke für Mitglieder und intern (#605, Abschnitt „News und Events“). An sind
die Turnier-Meldungen (Anmeldung offen, Check-in offen, live, Teilnehmer
streamt, beendet, Ergebnisse) – sie stehen im Thread des Turniers – und die
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
- **Wohin nach Sichtbarkeit (#605):** öffentlich (auch „Community“) in News bzw. Events und
  Turniere, „nur Mitglieder“ in den **Mitgliederkanal** (mit Text, Bild, Zeit und Ort – Discord-Termine
  sind serverweit sichtbar, darum steht beides in der Meldung), „intern“ an den **Vorstand** – dort
  nur Titel, Zeit, Ort und Link, nie der Text. Jede Art hat ihren eigenen Schalter (*News für
  Mitglieder*, *Event für Mitglieder*, *News intern (Vorstand)*, *Event intern (Vorstand)*, alle
  Standard aus). Im Discord den Mitgliederkanal so einstellen, dass nur die Rolle „Mitglied“ ihn
  sieht (Kanal → Bearbeiten → Berechtigungen: @everyone „Kanal ansehen“ aus, die Rolle an).
- Nie gemeldet: Entwürfe und Vergangenes.

## Turniere: ein Thread je Turnier (#572)

- Die erste Meldung eines Turniers – meist „Anmeldung offen“ – steht im Kanal mit Spiel,
  Format, Plätzen und Banner. Darunter öffnet der Bot einen Thread „🏆 Turniername“.
- Alles Weitere steht im Thread, kurz und ohne Wiederholung: Check-in offen (mit Frist), jetzt
  live, Streams von Teilnehmern, das Bracket (angepinnt, nach jedem Ergebnis bearbeitet),
  beendet, Ergebnisse veröffentlicht. Der Kanal zeigt je Turnier genau eine Meldung.
- Der **Endstand** ist die letzte Nachricht im Thread: Beim Ende setzt der Bot das Bracket mit
  Podium neu ans Ende, die alte Fassung verschwindet; kommt danach noch „Ergebnisse
  veröffentlicht“, wandert er wieder nach unten. Discord archiviert den Thread nach einer Woche
  Ruhe; eine neue Meldung öffnet ihn wieder.
- Gemeldet wird jeder Statuswechsel, egal woher: Knopf der Turnierleitung, Turnier-Formular,
  Anlegen mit Status, Zeitplan (Anmeldung öffnet, Check-in, Start, Ende), Start an einer
  Station, Gruppen- und Swiss-Runden. Vor #572 blieben die Wechsel aus dem Zeitplan stumm.
- **„Ohne Discord“** im Turnier-Formular hält das Turnier ganz heraus: keine Meldung, kein
  Thread, kein Bracket, kein Discord-Termin. Was nicht für alle sichtbar ist, geht nie in einen
  öffentlichen Kanal.
- **Turniere „nur Mitglieder“ (#910)** melden sich im Kanal „Mitglieder (privat)“ am Hauptserver:
  Ankündigung, eigener Thread (`discord_thread_members`), darin Check-in, live, Streams und das
  Bracket. Keine Routing-Regel, kein Spielserver, kein Querverweis; ohne Mitgliederkanal
  `members_channel_missing` im Log und keine Nachricht. War das Turnier vorher öffentlich, bearbeitet
  der Bot die öffentliche Bracket-Nachricht nicht weiter – das Bracket beginnt im Mitgliederkanal
  neu. `/bracket` bietet nur öffentliche Turniere an. „Intern“ und versteckte Turniere bleiben draußen.
  Code: `discord_threads.members_only` und der Parameter `members` in `_deliver_on`/`_send`,
  `discord_bracket.refresh`, `tournament_streams.discord_tournament`.
- Darf der Bot keine Threads öffnen, geht nichts verloren: Die Meldungen stehen wie früher
  einzeln im Kanal, der Grund beim Ziel, im Versand-Log und in der Tageszentrale. Ist das Recht
  nachgetragen, öffnet die nächste Meldung den Thread. Wird der Thread gelöscht oder ein anderer
  Kanal gewählt, beginnt die nächste Meldung einen neuen.
- Die Vorschau unter Verbindungen → Discord zeigt je Turnier-Meldung, wo sie landet („im Kanal ·
  öffnet den Turnier-Thread“ oder „im Turnier-Thread“), in der kurzen Fassung des Threads.

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

## Knöpfe unter den Meldungen (#573)

Unter jeder Meldung steht ein Link-Knopf zur passenden Seite – ein Klick statt Suchen:
„Zur Anmeldung“ (Anmeldung offen), „Zum Check-in“, „Bracket ansehen“ (live, beendet,
Ergebnisse und unter dem Bracket selbst), „Event ansehen“, „Weiterlesen“ (News),
„Bestenliste“ (Fast Lap), „Zuschauen“ und „Profil“ (Stream; das Profil nur, wenn es öffentlich
ist), „Im Admin öffnen“ (Vorstand). Direktnachrichten tragen ihren Knopf je Thema – die
Gratulation zu Erfolgen „Profil“. Link-Knöpfe melden nichts an den Bot zurück; „erneut senden“,
die Vorschau im Formular und die Beispiele unter Verbindungen → Discord zeigen dieselben Knöpfe.

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

## Discord auf der Website (#581)

Die Website zeigt, dass im Discord was los ist – aus dem **Server-Widget** von Discord, ohne
Bot-Recht und ohne die geschützten Presence-Intents:

- **Startseite:** unter den Vereinszahlen eine Leiste „Discord: 42 online · 5 im Voice“ mit
  „Beitreten“ (die Einladung aus den Einstellungen, sonst die des Widgets).
- **Mitgliederbereich (Web und App):** „Discord jetzt“ mit je belegtem Sprachkanal Name und Zahl
  („Turnier-Lobby: 4“).
- **Nie Namen von Personen:** das Widget liefert sie mit, der Server verwirft sie beim Abruf.
  Gezählt werden nur die Sprachkanäle, die das Widget selbst zeigt – private bleiben unsichtbar.

Einschalten im Discord: **Servereinstellungen → Widget → „Server-Widget aktivieren“**. Die
Server-ID kommt vom Bot (oder aus „Discord-Bot“ → Server-ID). Ein Job holt das Widget jede Minute;
ein Stand älter als fünf Minuten wird nicht gezeigt, niemand online heißt keine Leiste. Ist das
Widget aus oder der Server unbekannt, verschwindet die Anzeige, und der Bot-Kasten sagt unter
„Discord auf der Website“, wo man es einschaltet („Jetzt prüfen“ fragt sofort neu).
## Mehrere Server (Discord VI, #624)

Ein Bot-Token kann auf beliebig vielen Servern sein – es braucht keinen zweiten Bot. Unter
Verbindungen → Discord → Reiter **„Server“** stehen alle Server, auf denen der Bot ist:

- **Genau ein Hauptserver.** Nach dem Deploy ist es der heutige (die eingetragene Server-ID, sonst
  der erste); er bekommt alle Meldungen wie bisher und lässt sich nicht ausschalten. „Zum
  Hauptserver“ macht einen anderen zum Hauptserver, der bisherige wird Unterserver.
- **Neue Server** erscheinen von selbst (Bot beitreten, verlassen, umbenennen) – als
  **ausgeschalteter Unterserver**, bis du sie einschaltest. Verlassene bleiben mit Hinweis sichtbar.
- **„Bot auf einen weiteren Server holen“:** der Einladungslink mit denselben Rechten.
- **Prüfen** je Server: Bot anwesend, fehlende Rechte in Worten mit Klickweg, beim Hauptserver die
  Kanäle je Zweck mit dem letzten Versand. **Test:** am Hauptserver in den privaten Testkanal, am
  Unterserver in dessen Systemkanal – öffentlich, darum erst nach Bestätigung.
- **Einladungslink** je Server: eintragen oder vom Bot erzeugen lassen (unbegrenzt gültig); **Notiz**.
- Code: `services/discord_guilds.py` (`reconcile`, `update_guild` mit der Ein-Haupt-Regel, `health`,
  `send_test`), Sammlung `discord_guilds`, Routen `routes/discord_guild_routes.py`
  (`/api/settings/discord/guilds…`), Bot `_sync_guilds`/`create_invite`.

**Kanalziele je Server (#625).** Jeder Server hat seine Kanäle; wer was bekommt, regelt eine
Stelle (`discord_service.resolve_target` mit dem Server):

| Ziel | Hauptserver | Unterserver |
| --- | --- | --- |
| Community | „Kanäle je Zweck“ | eigener Kanal (Reiter „Server“); ohne ihn kommt dort nichts an |
| News, Events und Turniere | eigener Kanal, sonst Community | eigener Kanal, sonst Community **desselben** Servers |
| Vorstand, Betrieb, Test, Mitglieder | „Kanäle je Zweck“, nie ein Rückfall | **gibt es nicht** – Versuch = Fehler mit Protokoll, keine Nachricht |

Nie fällt etwas auf einen anderen Server zurück. Ein ausgeschalteter oder verlassener Server bekommt
nichts. Die „Kanäle je Zweck“ sind die des Hauptservers (sie werden in seinen Eintrag gespiegelt);
wird ein anderer Server Hauptserver, wandern seine öffentlichen Kanäle dorthin, die privaten sind neu
zu wählen. Die Vorschau unter „Meldungen“ zeigt je Server, wohin jede Meldung ginge. Jeder Aufrufer von
`send_to` sagt, welchen Server er meint (`guild_id`, sonst der Hauptserver) – ein Test zählt sie.

**Spiel → Server (#626).** Im Spielformular (Admin → Spiele) wählst du den Discord-Server eines
Spiels; leer heißt **erben**: eine Spielversion nimmt den Server ihres Hauptspiels, ohne alles gilt
der Hauptserver. Ein ausgeschalteter oder verlassener Server zählt nicht – dann gilt die nächste Stufe.
Der Reiter „Server“ zeigt umgekehrt je Server die **Spiele auf diesem Server** (eigene und geerbte).

- **Spielkarten unter „Über uns“** zeigen den eigenen Server eines Spiels mit „Beitreten“; der
  Hauptserver steht schon im Footer. **Turnierseite:** Kachel „Discord-Server für …“ mit dem Spielnamen (oder
  „Unser Discord-Server“) mit Name, Symbol, Mitgliederzahl und Einladung.
- **„Du bist dabei“** sieht nur die angemeldete Person selbst, und nur mit verknüpftem Discord – sonst
  steht nur die Einladung da. Der Bot prüft die Mitgliedschaft (Zwischenspeicher fünf Minuten, Beitritt
  und Austritt meldet er sofort); ist er offline, bleibt der Status offen statt „nein“.
- **Mitgliederbereich** (Web und App): alle eingeschalteten Server mit eigenem Status.
- **Nach dem Verknüpfen** schickt der Bot einmal je Discord-Konto eine Direktnachricht mit den Servern,
  die zu den eigenen Spielen passen (Lieblingsspiele und Turnier-Anmeldungen) – nur als DM, nie in einen
  Kanal; sie steht im Log und lässt sich nicht „erneut senden“.
- Ausgeschaltete Server erscheinen nirgends öffentlich. Footer und Kontaktseite behalten die Einladung
  des Hauptservers (`discord_invite_url`); ohne eigene Einladung nimmt der Hauptserver diese.
- Erfolge: der Zähler `discord_guilds_joined` (auf wie vielen eingeschalteten Servern jemand ist).
- Code: `services/discord_guilds.py` (`guild_for_game`, `public_server`, `own_status`, `member_servers`,
  `note_membership`, `greet_linked`), Sammlung `discord_memberships`, Routen `GET /api/games/{spiel}/discord`,
  `GET /api/games/discord-servers` (Auswahl im Formular), `GET /api/membership/discord-servers`, Bot
  `member_status`, `on_member_join`/`on_member_remove`.

**Einbettungen und Termine je Server (#628).** Ein eingeschalteter Unterserver zeigt nur seine Spiele
(eigene und geerbte, wie im Reiter „Server“):

- **Einbettungen** Rangliste und Nächste Termine je Unterserver (Reiter „Einbettungen & Termine“ →
  „Spielserver“, Kanal aus der Liste dieses Servers). Rangliste = Saisonpunkte aus Turnieren und
  Fast-Lap-Challenges dieser Spiele (`aggregate_leaderboard(source_ids=…)`), das Spiel hinter dem
  Saisonnamen; Termine = deren Turniere und Challenges (Events tragen kein Spiel). Der Erfolg der Woche
  bleibt am Hauptserver. Zustand am Server-Eintrag (`discord_guilds.embeds.<art>`), dieselbe Bremse
  (eine Bearbeitung je Minute und Nachricht), der Sammler alle zehn Minuten fasst alle Server an. Ohne
  zugeordnetes Spiel postet der Bot nichts und nennt den Grund.
- **Discord-Termine:** ein öffentliches Turnier, dessen Spiel einen eigenen Server hat, bekommt den Termin
  dort (`discord_scheduled_guilds.<server>`); am Hauptserver (`discord_scheduled_event`) zusätzlich,
  solange der Server „Auch am Hauptserver“ (`mirror_events`, Vorgabe an) hat. Änderung und Absage an beide;
  Spiegelung aus → Absage am Hauptserver; Server aus/verlassen → Termin zurück an den Hauptserver, der am
  Unterserver wird abgesagt. Nicht Öffentliches nie auf einen Unterserver. Darf der Bot auf einem Server
  nichts (fehlendes Recht, Server nicht gefunden), versucht der Lauf es dort einmal und überspringt ihn –
  so verbraucht ein falsch eingestellter Server nicht die Aufrufe der anderen.
- Code: `services/discord_embeds.py` (`refresh(…, guild_id=)`, `server_games`, `_targets`),
  `services/discord_scheduled.py` (`targets`, `sync`), `update_guild` nimmt `embeds` und `mirror_events`
  (nur Unterserver), Route `POST /api/settings/discord/guilds/{server}/embeds/{art}/refresh`.

Versand je Spiel (#627), Brackets, Rollen und Befehle je Server folgen in den weiteren Teilen.

## Gestaltung und Stream-Meldungen (#866)

**Gestaltung** (Verbindungen → Discord → Reiter „Gestaltung“): Jede Meldungsart ist eine Vorlage im Discord-Format –
Farbe, Text über dem Kasten, Autorzeile mit Bild, Titel mit Link, Text, Felder, Bild rechts, großes Bild, Fußzeile mit
Symbol, Zeitstempel. Platzhalter in geschweiften Klammern (`{streamer}`, `{title}` …) füllt die Website; was in `[[ … ]]`
steht, erscheint nur, wenn jeder Platzhalter darin einen Wert hat. Listen (Live jetzt, Nächste Events, Rangliste) zeigen
je Eintrag eine Zeile (`row` → `{rows}`) oder ein Feld (`row_field`). Bearbeiten als Formular oder JSON, Vorschau vom
Server mit Beispielwerten oder echten Daten, „Standard wiederherstellen“, Testnachricht in den Testkanal (erwähnt
niemanden). Gespeichert wird nur, was die Prüfung besteht (Platzhalter, Adressen, Farbe, Discord-Grenzen, nie
`@everyone`/`@here`). Werte aus der Website werden dort, wo Discord Markdown zeigt, entschärft.

Heute gestaltbar: Stream gestartet, Stream beendet und die vier angehefteten Einbettungen (Live jetzt, Nächste Events,
Rangliste, Erfolg der Woche). News-, Event- und Turnier-Meldungen folgen im zweiten Teil.

**Stream-Meldungen je Stream** (Reiter „Einbettungen & Termine“ → „Stream-Meldungen“): Sobald jemand aus dem Verein
live geht – dieselbe Regel wie die Startseite (aktive Mitgliedschaft, Mitgliederprofil) –, postet der Bot eine Meldung
in den gewählten Kanal, auf Wunsch mit Erwähnung **einer** Rolle (nur beim ersten Posten, `allowed_mentions` nur diese
Rolle). Alle zehn Minuten aktualisiert (Zuschauer, Titel, Spiel, neues Vorschaubild), am Ende zu „war live“ mit Dauer
und Höchstzahl – oder gelöscht. Höchstens fünf neue Meldungen je Lauf.

- Code: `services/discord_design.py` (`KINDS`, `render`, `validate`, `sample`, `template_for`; Einstellung
  `discord_design`), `services/discord_streams.py` (`sync` am Twitch-Abruf, `status`; Sammlung `discord_stream_posts`,
  Einstellung `settings.discord.streams`), `services/discord_embeds.py` liefert nur noch die Werte (`*_context`),
  Routen `routes/discord_design_routes.py` (`/api/settings/discord/design…`, `/api/settings/discord/streams`), Bot
  `send_embed(content=, mention_role_ids=)`, `edit_embed(content=)`, `list_roles`, `allowed_mentions`.

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
  verknüpft), `/status` (nur Vorstand) und seit #573 `/rangliste` (Top 10 der Saison),
  `/bracket` (Auswahl aus den laufenden öffentlichen Turnieren), `/wer-streamt`, `/mitglied`
  (eigener Stand mit Art und „seit“, nur verknüpft – nie Beitrag, Nummer oder Zahlungsdaten) und
  `/verknuepfen` (der Weg zum Verknüpfen). **Jede Antwort sieht nur die fragende Person**; was
  für alle gilt, steht in den angepinnten Einbettungen.
- **Befehle je Server (#630):** registriert als Server-Befehle auf dem Hauptserver und jedem
  eingeschalteten Unterserver (`BotRunner.sync_commands`, nie global; `command_targets` rechnet, wer
  sie bekommt). Beim Verbinden erst das Server-Verzeichnis, dann die Befehle; Ein/Aus oder Rollenwechsel
  im Admin registriert sofort nach, ein ausgeschalteter Server verliert sie (nur, wo sie standen:
  `discord_guilds.commands_at`; die Gesundheitsprüfung zeigt es). Ein Server ohne Recht hält die anderen
  nicht auf. Auf einem Spielserver filtern `/turniere`, `/naechstes-event` (Events mit einem Turnier
  dieser Spiele) und die Auswahl von `/bracket` auf dessen Spiele; `spiel:` (Autovervollständigung,
  mit Editionen) und `alle: True` überschreiben das. `/status` nennt Server, Spiele, Kanäle und die
  letzte Aktualisierung der Einbettungen. Code: `discord_commands.server_scope`, `answer_turniere`,
  `answer_naechstes_event`, `server_status_lines`, `game_choices`.

Zählen, Rollen und Befehle gelten nur für Konten, die im Profil verknüpft sind (Abschnitt oben).

**Willkommensnachricht (#574):** Wer neu auf den Server kommt, bekommt vom Bot eine
Direktnachricht – einmal je Person – mit den Knöpfen „Auf der Website anmelden“ und „Konto
verknüpfen“. Text unter Verbindungen → Discord → „Willkommensnachricht“ mit Vorschau und „An mich
senden“; `{name}` wird der Name im Discord, `{verein}` der Vereinsname. **Standard aus**, bis der
Text geprüft ist. Lässt jemand keine Direktnachrichten zu, passiert nichts – nur der Zähler steigt.
Gemerkt wird nur ein Hash der Discord-Kennung (`discord_welcomes`), nie Name oder Kennung; ein
vorübergehender Fehler darf beim nächsten Beitritt noch einmal. Braucht den Server Members Intent,
der für den Rollenabgleich ohnehin an ist.

### Einrichten (einmalig, im Admin beschrieben)

1. discord.com/developers → dieselbe App wie fürs Konto-Verknüpfen → **Bot** → „Reset Token“ →
   Token unter „Bot-Token“ eintragen und speichern. Der Token wird verschlüsselt abgelegt und nie
   wieder angezeigt; leer lassen heißt behalten. Nur der Superadmin kann ihn entfernen.
2. Dort unter „Privileged Gateway Intents“ den **Server Members Intent** einschalten (für den
   Rollenabgleich). „Message Content“ bleibt aus – auch fürs Senden nicht nötig.
3. OAuth2 → URL Generator: Scopes `bot` + `applications.commands`, Rechte „View Channels“,
   „Send Messages“, „Embed Links“, „Read Message History“, „Manage Roles“, für die
   Turnier-Threads „Create Public Threads“ und „Send Messages in Threads“ – mit der Adresse den
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
- `backend/services/discord_welcome.py` (#574): `greet` (Beitritt, `on_member_join`),
  `render` (Embed und Knöpfe für Vorschau, Test und Versand), `welcome_status`, `send_test`;
  Einstellung `settings.discord.welcome` {`enabled`, `text`} über `PUT /api/settings/discord`,
  dazu `POST /api/settings/discord/welcome/preview|test`.
- `backend/services/discord_commands.py` (#573): die Antworten der neuen Befehle als Rechnung
  (`answer_*`, `bracket_choices`, `membership_text`); `discord_bot.answer_kwargs` macht daraus die
  Antwort nur für die fragende Person. Link-Knöpfe: `buttons` an jeder Meldung
  (`discord_announcements`), `discord_service.resolve_buttons` macht volle Adressen,
  `discord_bot.clean_buttons`/`link_view` die Discord-Knöpfe (höchstens fünf).
- `backend/services/discord_announcements.py`: `announce_due` (Job, jede Minute),
  `news_message`, `event_message`, `preview`, `notify_board`.
- `backend/services/discord_threads.py` (#572): `status_changed` – die eine Stelle für jeden
  Statuswechsel eines Turniers (Route, Formular, Anlegen, Zeitplan, Station, Gruppen/Swiss über
  `status_written`) –, `deliver` (in den Thread, sonst in den Kanal und Thread öffnen),
  `note_message`. Am Turnier `discord_thread` {`channel_id`, `message_id`, `thread_id`,
  `last_message_id`, `error`}. `send_to`/`send_event` nehmen `thread_id`; im Log steht er mit.
  Bot: `create_thread`, `delete_message`, archivierte Threads öffnet er vor dem Schreiben wieder.
- `backend/services/achievement_queue.py`: `request_evaluation`, `process_queue`, `sweep`,
  `note_award`, `flush_awards` (nur noch Benachrichtigung an die Person).
- Migration 3 (`services/migrations.py`) verwirft gespeicherte Webhook-Adressen, Absendername
  und Avatar.
- **Neues Ereignis:** in `EVENTS` eintragen (Ziel, Beschriftung, Standard **aus**), über
  `send_event` senden, und ein Test, dass es mit privater Sichtbarkeit nicht an ein
  öffentliches Ziel geht. Tests stellen den Bot mit `monkeypatch.setattr(discord_bot.bot,
  "send_embed", …)` nach.
- `backend/services/discord_widget.py` (#581): `refresh` (Job `discord_widget`, jede Minute),
  `summarize` (nur Zahlen), `public_view` (in `/api/home/state` als `discord`), `member_view`
  (`GET /api/membership/discord-voice`), `admin_view` (`GET /api/settings/discord/bot/widget`,
  `POST …/widget/refresh`). Stand in `settings` mit `id: discord_widget`; die Server-ID merkt sich
  der Bot beim Verbinden (`discord_bot_state.guild_id`).
