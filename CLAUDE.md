# CLAUDE.md – Übergabe und Arbeitsregeln für THE LION SQUAD

Diese Datei ist das Wissen aus der Arbeit mit Claude Code an diesem Repository,
Stand **16. September 2026, früh (Umzug auf den Haupt-PC, Build 61)**. Sie wird
beim Start jeder Sitzung gelesen.
Wer sie liest, soll ohne Rückfragen dort weitermachen können, wo die letzte
Sitzung aufgehört hat. Alles hier ist bewusst frei von Geheimnissen.

Der Abschnitt „Aktueller Stand“ altert schnell. Wer einen PR abschließt oder
ein Release baut, zieht ihn nach – die Regeln davor bleiben.

---

## 1. Projekt in drei Sätzen

Selbst gehostete Vereins- und eSports-Plattform für THE LION SQUAD
(lionsquad.at): öffentliche Website, Mitgliederbereich, Teams, Turniere,
Fast Lap, Jahreswertung, Chat, Galerie, Administration – plus die
Android-App „LionsAPP“. Der Betreiber (Tabsi1998) schreibt selbst wenig Code,
treibt das Projekt aber eng über GitHub-Issues, PRs und Praxistests am Handy.
Claude liefert fertige, lokal geprüfte PRs; der Betreiber merged, deployt und
testet fachlich.

**Stack:** FastAPI + MongoDB (`backend/`, Python 3.11), React 19 + Vite +
Tailwind (`frontend/`, yarn 1.22), Expo SDK 57 / React Native 0.86
(`mobile/`, npm, Node 24), Docker Compose mit nginx im Frontend-Image
(Container `tls-mongodb`, `tls-backend`, `tls-frontend`).

**Fahrplan:** `UMBAUPLAN.md` (Blöcke, Meilenstein-Tabelle, „Was Block X
gefunden hat“). Online-Spiegel des Plans als Artifact:
https://claude.ai/code/artifact/a381e28b-f15f-4389-9c4a-96749f15b6df
(Version 25). `RESTPLAN.md` bleibt die übergeordnete Liste. Weitere Doku über
`DOCS.md`.

---

## 2. Umgang mit dem Betreiber

- **Auf Deutsch antworten.** Englische Fachbegriffe bleiben englisch
  (Winner Bracket, Check-in), der Resttext ist deutsch.
- **Ehrliche Einordnung** statt Beschönigung: grüne Tests sind keine
  Server-Abnahme; sagen, was nicht geprüft wurde.
- **Anleitungen als konkrete Klick-Schritte** (GitHub-Oberfläche, Handy).
- Feedback kommt als **Screenshot-Stapel**. Eigene Ideen **erst als
  Vorschlagsliste**, der Betreiber bestätigt, dann werden Issues angelegt.
  Er will lieber viele kleine Issues als wenige große.
- **Nach einem Abschluss-Stand anhalten** und auf das OK warten, bevor der
  nächste Block oder das nächste Issue-Paket beginnt („nicht so chaotisch“).
- Neue Wünsche während der Arbeit sofort als Issue festhalten (Label +
  Meilenstein) und dann am laufenden Issue weitermachen.

---

## 3. Sicherheitsregeln (wörtlich, nicht verhandelbar)

- **„Geheime Sachen NIE auf GitHub.“**
- Keystore, Passwörter, `signing.json`, `google-services.json`, `.env` mit
  echten Werten: **nie ins Repo, nie in einen Chat, nie in ein Log**.
  `signing.json` enthält das Passwort und wird **nie ausgegeben**
  (kein `cat`, kein Read).
- Lokale Arbeitsdateien sind **nicht für Git**: `.vscode/`,
  `.local-testing/`, `.codex-tools/`, `*.code-workspace`, SDKs, Zertifikate,
  Berichte. Sie stehen in `.gitignore`; das bleibt so.
- **Nie gegen Produktion testen.** Live-Produktionstests werden lokal nicht
  ausgeführt. Deployment ist bewusst manuell (siehe Abschnitt 8) – kein CD
  vorschlagen.
- Das Repo ist privat und GitHub Actions kosten Geld: **lokal zuerst,
  GitHub nur zur Bestätigung** (Abschnitt 6).

---

## 4. Arbeitsweise: nach Issues, nicht nach Blöcken

Seit dem 15. September gilt:

1. **Jede Arbeit hat ein Issue.** Labels: `bug` oder `enhancement` plus
   `app`, `web`, `admin` oder `backend`. Jedes Issue bekommt sofort einen
   Meilenstein. Kein Issue ohne Meilenstein.
2. **Ein Zweig je Issue-Paket** ab `main`, Name `feat/<nr>-<stichwort>`
   bzw. `feat/app-<version>` für ein App-Versionspaket, `docs/…` für reine
   Doku.
3. **App-Issues werden je Versions-Meilenstein gesammelt** (3–5 Issues, z. B.
   „App 0.5.0-beta“), in **einem** PR umgesetzt und danach als ein Build
   veröffentlicht. Zusammengehöriges kommt in einen PR; keine PRs stapeln.
4. **PR-Text schließt die Issues mit dem englischen Schlüsselwort
   `Closes #N`** (eine Zeile je Issue). Deutsches „Schließt #N“ schließt
   nichts – das ist schon passiert (#202, #210–#215 mussten von Hand zu).
5. PR **als Entwurf** öffnen (`gh pr create --draft`), lokal komplett prüfen,
   Ergebnis als Kommentar eintragen, dann `gh pr ready` → genau ein
   GitHub-Lauf. GitHub-CI läuft nur für Nicht-Entwürfe und nur betroffene
   Jobs (`scripts/ci-changed-areas.py`).
6. **Der Betreiber merged selbst**: „Squash and merge“; veraltete Zweige mit
   „Update with rebase“ – nie Merge-Commits. Wenn ein Zweig hinter `main`
   liegt, lokal `git rebase origin/main` und `git push --force-with-lease`.
7. Commit-Texte und PR-Texte auf Deutsch, mit dem Warum, nicht nur dem Was.
   Attribution laut Sitzungs-Hinweis (`Co-Authored-By: …` im Commit, das
   „Generated with Claude Code“-Zeichen im PR-Text).
8. Nach dem Merge: Meilenstein-Tabelle in `UMBAUPLAN.md` und das Artifact
   aktualisieren (Doku-Commit, gern gebündelt).

---

## 5. Wo was liegt (Kurzkarte)

**Backend**
- Turnierrouten seit Block 13: `routes/tournament_*_routes.py` +
  `tournament_common.py`, alle an `tournament_router.py`. Tests patchen am
  Modul, in dem die Funktion nachschlägt. FastAPI 0.141 verschachtelt
  `include_router` – `router.routes` ist nicht flach.
- Flow-Tests: `backend/tests/flow_harness.py` (`make_flow()`, mongomock,
  `flow.add_user(role=…)`, `flow.act_as(user)`); die `flow`-Fixture wird je
  Testdatei definiert. Für einen 500 statt einer Exception:
  `httpx.ASGITransport(app, raise_app_exceptions=False)`.
- Betrieb (#233 Teil 1, PR #266): `backend/services/ops_monitor.py`,
  Middleware `ops_monitoring` in `server.py`, Admin-Endpunkte
  `/api/admin/ops/*`, Sammlungen `ops_errors` / `ops_slow_requests` (TTL
  30 Tage), `SLOW_REQUEST_MS` (Standard 1000). Starlette packt Fehler in
  `ExceptionGroup` → `unwrap_exception`.
- Betrieb II (#265, PR #299): `services/ops_checks.py` – acht Prüfungen
  (Datenbank, Speicher, Upload-Volume, Mail-Queue, Änderungsstrom,
  Bildvarianten, Fehlergruppen, Scheduler), Bewertung in `rate_*`, Lauf
  alle 5 min über den Scheduler-Job `ops_checks`, Sammlung
  `ops_check_runs` (TTL 7 Tage). `services/ops_alerts.py` – eigener
  Betriebs-Webhook (`settings.discord.ops_webhook_url`, `send_ops_discord`;
  nie der Community-Webhook) für rote Prüfungen und neue 5xx-Gruppen (Hook in
  `ops_monitor._upsert_error`), eine Meldung je Schlüssel und Stunde
  (`ops_alert_state`). `services/ops_vitals.py` + `routes/ops_routes.py`:
  `POST /api/ops/vitals` (anonym, 30 Sendungen je Adresse und Minute,
  Sammlung `ops_vitals` TTL 30 Tage), Auswertung p50/p75 je Route.
  Admin-Endpunkte `/api/admin/ops/vitals`, `/checks`, `POST /checks/run`;
  `ops_summary` trägt `checks` für die Tageszentrale.
- Dolibarr II (#296, #325; PR #356). `services/dolibarr_invoices.py`:
  `list_invoices` (alle Seiten über `client.member_invoices`, Sicht ohne
  `payment_url`; Ausfall → letzter Stand aus `dolibarr_invoice_cache`, TTL 14 d,
  `can_pay` dann false), `invoice_pdf` (Bytes unverändert, `%PDF`-Prüfung,
  SHA-256, nie gespeichert), `payment_target` (frisch gelesen, `can_pay`,
  `payment_url_allowed` = https + Host der eigenen Installation),
  `forget_cache`. Zugriff nur über `verified_link` des angemeldeten Kontos –
  Status egal, Mitglieds-ID nie aus der Anfrage. Routen `routes/invoice_routes.py`:
  `GET /api/account/invoices`, `GET …/{key}/pdf[?download=1]` (`Cache-Control:
  no-store`, `X-Content-SHA256`), `POST …/{key}/pay` → `{url}` (kein 303: der
  API-Client würde die Weiterleitung als fremden Aufruf verfolgen). Schlüssel
  `d-<id>`. Anonymisierung und Lösen der Zuordnung leeren den Cache. Web:
  `pages/user/MyInvoicesPage.jsx`, `lib/invoices.js`, PDF-Betrachter
  `components/tls/DocumentViewer.jsx` + `lib/pdfViewer.js` (pdf.js `pdfjs-dist`
  lokal, Worker per `?url`, nachgeladen beim Öffnen; `open`-Prop für Tests);
  `MemberDocumentsPage` öffnet PDFs darin. **Neues Dokument in der Website =
  DocumentViewer mit API-Pfad, nie ein fremder Betrachter, nie eine freie URL.**
- App 0.9.0-beta (#240 Freunde, #245 Laufbanner; Build 67; PR #377). **#240**
  Backend `friend_routes`: jede Änderung ruft `publish_user_change([beide],
  "friends")` (der Änderungsstrom kennt „friends“ nur je Nutzer), Meta
  `requester_username`/`username` an den Benachrichtigungen. App
  `lib/friends.ts` (`friendButton` Zustand → Knopf/Aktion, `friendRequest`
  Aktion → Pfad, `normalizeFriends`), `components/FriendButton.tsx` (im
  öffentlichen Profil, Startzustand aus `profile.relationship`, live über
  „friends“/„notifications“), `components/FriendsCard.tsx` (Profil-Übersicht:
  offene Anfragen oben mit Annehmen/Ablehnen, gesendete zurückziehbar, Liste
  mit Zähler, Entfernen mit Rückfrage). **#245** Backend `settings_routes`:
  `BannerChannel`, `SiteBannerPayload.channels` (Standard `["web"]`),
  `SiteBannerPatch.channels`, `banner_channels(doc)` (ohne Feld Website,
  `source == "auto"` beides), `GET /api/settings/site-banners?channel=app`
  filtert, `_public_banner_doc.channels`. Admin: Häkchen „Läuft auf:
  Webseite/App“ (`site-banner-channel-<k>`, nie beide aus). App
  `lib/banners.ts` (`visibleBanners`, `dismissKey` = id+Text,
  `tickerDurationMs`, `toneColor`, Wegwischen in SecureStore, max. 40),
  `components/SiteBannerTicker.tsx` (über `MainTabs` in `AppNavigator`,
  Ticker per `Animated.loop`, Tipp → `navigateToNotification` bei In-App-Ziel
  sonst Browser, X blendet aus bis der Text sich ändert, live über
  „settings“). **#239** (Tastatur-Sticker) bleibt offen: braucht ein
  natives Modul um Reacts `TextInput` (`onCommitContent`), eigener Schritt.
  Tests `test_site_banner_channels_flow.py` (3), `test_friends_changes_flow.py`
  (2), App `friends.test.ts`, `banners.test.ts`, `FriendsCard.test.tsx`,
  `SiteBannerTicker.test.tsx` (10), Admin-Settings-Test unverändert grün.
- Abrechnung fertig (#321, #322; PR #388, baut auf #387 auf; kein Build).
  `services/dolibarr_billing`: `payment_state_for(status, total, remaining, due_on,
  credited_cents=, today=)` (draft/open/partial/paid/overdue/overpaid/credited/
  abandoned), `_invoice_state` liefert `remote_total_cents` (nie in `total_cents`
  des Auftrags – der eingefrorene Preis geht nie mit), `remaining_cents`, `due_on`,
  `credit_notes`, `payment_state`, `remote_socid`; `payment_view`; `sync_one`
  (Beleg + `client.credit_notes_of` + `client.invoice_payments`; 403 auf Zahlungen
  → `payments=None`, dann gilt Summe minus Rest; 404 → `sync_error: not_found` +
  Prüffall `invoice_gone`; nie still), `_review_cases` (amount_mismatch,
  recipient_mismatch, overpaid, paid_after_cancel; Auto-Erledigung, wenn Dolibarr
  aufgelöst hat), `sync_invoiced(full=, order_ids=)` mit `_due_query` (unbezahlt
  immer, `SETTLED_STATES` nur nach `RESYNC_SETTLED_HOURS` 24 h), `tax_confirmed`,
  `may_auto_validate` (auto_validate ∧ terms_complete ∧ tax_confirmed).
  `services/billing_cases.py` (NEU): `KINDS` (label + todo), `open_case` (einer je
  Auftrag+Art, idempotent), `resolve_case(auto=)`, `auto_resolve`, `cases_for_order`,
  `list_cases`, `open_count`. `services/billing_orders`: `PAYMENT_STATE_LABELS`,
  `SETTLED_STATES`, `paid_cents(order, payments=)` (**Summe der Zahlungen**; Gutschrift
  ist kein Geld; ohne Zahlungsliste Summe minus Rest), `refunded_cents`,
  `credited_cents`, `cancel_orders_for` (invoiced → `booking_state: cancelled`,
  `paid_cents_at_cancel`, Prüffall), `note_change_after_invoice`, `add_refund`
  (`RefundError`; ≤ bezahlt − erstattet; Audit `billing.refund.record`),
  `sync_due(full=, order_ids=)`, `reconcile_due` (Job `billing_reconcile` täglich,
  Lease 600), `overview(kind=, source_id=, user_ids=)` (+`cases`, `cases_open`,
  `payment_labels`), `source_summary`, `anonymize_user` (aus `dsgvo_routes`).
  `dolibarr_client`: `invoice_payments`, `credit_notes_of` (`fk_facture_source`,
  Art 2). Routen `finance_routes`: `GET /overview?kind&source&q`,
  `GET /sources/{kind}/{id}`, `GET /orders/{id}` (Positionen, `sums`, `timeline`,
  `cases`), `POST /orders/{id}/resync` (409 außer live), `POST /orders/{id}/refunds`
  (`case_id` optional), `GET /cases?status`, `POST /cases/{id}/resolve` (Grund
  Pflicht, 409 wenn erledigt), `POST /reconcile`. `dolibarr_routes`: Settings-PUT
  `tax_confirmed` (setzt `tax_confirmed_at/by/by_name`; false schaltet
  `invoice_auto_validate` aus), auto_validate 400 ohne Bestätigung; Status
  `tax_rates`, `tax_confirmed`. `event_routes`: Begleitpersonen-Änderung nach dem
  Beleg → `note_change_after_invoice` (Snapshot bleibt); `payment_state` im
  eigenen Preis (Event + Turnier). `daily_center.task_counts.billing_cases`.
  Fake: `pay(id, amount=, on=)`, `credit(id, amount)`, `abandon`, `remove`,
  `/invoices/{id}/payments`, `fk_facture_source`-Filter, `date_lim_reglement`.
  Web: `lib/billing.js` (`formatCents`, `parseEuro`, `sourcesFrom`, `summaryLines`,
  `csvCell` (Formel-Injektion), `toCsv`, `syncLine`), `AdminFinancePage` (Filter,
  Summen `finance-sum-*`, Prüffälle `finance-case-*`, Detail `finance-detail`
  mit Zeitleiste, Erstattungsformular `finance-refund-save`, `finance-resync`,
  `finance-reconcile`, `finance-csv`), `AdminDolibarrPage` Block `dolibarr-tax`
  (`dolibarr-tax-confirmed`), Dashboard-Aufgabe `billing-cases` nur mit
  `can("finance")`. Tests `test_billing_cases_flow.py` (8), `billing.test.js` (4),
  `AdminFinancePage.test.jsx` (5). Doku `docs/ABRECHNUNG.md`.
- Galerie, Fast Lap und Medien in Dateien je Bereich (#223 Teil 2; PR #555; nur Web).
  `pages/admin/gallery/{shared.js, AlbumModal, AlbumPhotos (+GalleryAdminThumb, MediaBadge,
  VideoLinkModal), SectionModal}`, `f1/{F1StaffPanel, ChallengeSettingsForm (+FastLapPrizeEditor,
  FastLapSeasonWeightField)}`, `media/{shared.js, parts.jsx, MediaDetailSheet}` – mechanisch per
  Skript, kein Verhalten geändert; Importe je Datei aus der Verwendung berechnet, ESLint-Sammel-
  Unterdrückungen mit dem Code gewandert (`npx eslint . --suppress-rule <regel>` +
  `--prune-suppressions`, Summen je Regel unverändert).
- Turnierbearbeitung in Dateien je Bereich (#223 Teil 1; PR #554; nur Web).
  `pages/admin/tournament/{shared.js, TournamentEditForm, StagesPanel, StaffPanel,
  ParticipantAddForm, PrizeEditor}`; die Seite hat noch 765 Zeilen. Rest von #223:
  `AdminSettingsPage` (ein großer State – nicht mechanisch zerlegbar).
- Upload-Inventar (#537; PR #553; Backend, nur Skript). `services/uploads_inventory.py`
  (Zustände referenced/registered/variant/orphan/stray_variant; `list_files`, `collect_references`
  als String-Suche über alle Sammlungen inkl. Markdown/HTML mit `URL_IN_TEXT_RE`,
  `inventory(db, upload_dir, sample=)`, `render_markdown`), `scripts/uploads-inventory.py`
  (`--dir/--sample/--json`, nur lesend, `ReadOnlyDb`). Test `test_uploads_inventory_unit.py`.
  Löschen bleibt Handarbeit nach dem Bericht.
- Konten verknüpfen III, Welle 1 (#547; PR #552; Backend + Web + App; `update.sh`, App-Build).
  FACEIT, start.gg, Roblox, osu!, Lichess (keine App: öffentlicher Client mit PKCE,
  `LICHESS_CLIENT_ID`), GitHub, Kick, Reddit, Spotify. Nutzerfelder `<key>_handle` (Modelle,
  erlaubte Felder, `_visibility_aliases` ×2, öffentliche Projektion, Anonymisieren, Defaults);
  `PLATFORMS[*]["operator"]` für den Datenschutztext; `_client()` schickt `USER_AGENT` (Reddit
  lehnt Standard-Kennungen ab); `CLIENT_CREDENTIALS` osu/kick/reddit/spotify; Übersicht und
  `appReady`: ohne `id_field` „keine App nötig“ (Lichess zählt in Tests als eingerichtet). Web
  `lib/platformLinks` (PLATFORM_BY_FIELD, PLATFORM_APPS), `platformBrand.jsx`,
  `profile/socials.js` (hosts/skip/url je Plattform), `visibility.js`, `PublicProfilePage`,
  `setupGuides`; App `LinkedAccounts.tsx`, `ProfileScreen`. e2e-Navigationszahl 69.
- Betrieb & Logs (#517 Teil 2; PR #550; Backend + Web; `update.sh`). `admin_routes`:
  `GET /api/admin/ops/events?source&severity&hours&q&limit&format=csv` (Union über ops_errors,
  check_runs, alert_log, Web-/App-Logs, email_logs, mail_jobs, audit, uploads, sync, bot;
  `_log_sources(db, limit, since_iso=)`, `HREFS`, `SEVERITY_FILTERS`), `admin_logs_overview`.
  Web `AdminOpsPage` „Betrieb & Logs“ mit Reitern in `?tab=` (overview/events/errors/perf/vitals/
  checks/app/alerts), `pages/admin/ops/{OpsOverview, OpsEventsTab, AppLogsTab}`;
  `AdminLogsPage`/`AdminAuditPage`/`AdminMobileLogsPage` weg (Routen leiten um).
  `ops_alerts.recent_alerts` sortiert `[at, _id]` (war flaky). Tests `test_ops_events_flow.py`,
  `OpsEventsTab.test.jsx`. Doku `docs/BETRIEB.md`.
- Einstellungen in die Menüleiste, „Alle Verbindungen“ (#546; PR #549; Backend + Web;
  `update.sh`). `AdminSettingsPage` liest `useParams().section` (`/admin/settings/<section>`,
  `SETTINGS_SECTIONS`, `LEGACY_TAB_REDIRECTS` für `?tab=`), keine Seite „Einstellungen“ mehr;
  `AdminLayout` Gruppen Verbindungen (oben „Alle Verbindungen“ `/admin/integrations`, dann
  `MENU_INTEGRATIONS`), E-Mail, Auftritt, System (Status, Zugang); Login und Konten liegen bei
  Verbindungen (`authSwitches`, `GOOGLE_SWITCHES`, `ACCESS_SWITCHES`). `settings_routes`:
  `GET /api/settings/integrations/overview` (Gruppen Login/E-Mail, Plattformen, Discord,
  Sonstiges; Zustand active/off/missing/**unreadable**/error – `_secret_state` entschlüsselt
  probeweise, `UNREADABLE_TEXT`); Resend warnt nur, wenn Resend der Anbieter ist
  (`email-via-smtp`). Web `AdminIntegrationsOverviewPage` (`STATE_META`,
  `integrations-unreadable-hint`). Tests `test_integrations_overview_flow.py`,
  `AdminIntegrationsOverviewPage.test.jsx`, `AdminSettingsPage.test.jsx`. Doku `docs/ROLLEN.md`.
- Google-Prüfung: Rechtstexte im Backend (#545; PR #548; Backend + Web; `update.sh`).
  `services/site_texts.py` (Blöcke `p/lst/info/textbox/section`; `privacy_page(legal, facts)`,
  `imprint_page`, `terms_page`, `home_page`; `legal_context(db)`, `page_html`),
  `privacy_facts.platform_facts(branding)` nennt jede eingerichtete Plattform mit `operator`;
  Abschnitt „Google-Nutzerdaten“ mit Limited-Use-Satz (`privacy-google-limited-use`), sobald
  Google-Login oder YouTube eingerichtet ist. `GET /api/settings/public/legal/{page}`;
  `seo_render_routes` liefert Crawlern den ganzen Text (`body_html`), Startseite „ohne
  Anmeldung“; `frontend/index.html` noscript-Block, `nginx.conf` weitere Google-UAs. Web
  `LegalPages.jsx` rendert nur noch (`lib/privacyFacts.js` weg). Tests `test_site_texts_flow.py`,
  `LegalPages.test.jsx`, e2e `public.spec.js` (`mockLegalPages` nach `**/api/settings/public**`).
  FAQ `google_pruefung`.
- Discord VI D3: Spiel → Server (#626; PR #838 im Sammel-PR #839; Backend + Web + App; `update.sh`).
  Das Spiel trägt `discord_guild_id` (leer = erben); `discord_guilds.guild_for_game` löst auf: eigenes
  Feld → Hauptspiel (`parent_game_id`) → Hauptserver und überspringt ausgeschaltete oder verlassene
  Server (`inherited_from`: None, Hauptspiel-ID oder „main“). Öffentlich nur `public_server` (Name,
  Symbol, Mitglieder, Einladung; der Hauptserver nimmt sonst `branding.discord_invite_url`). „Du bist
  dabei“ nur für die eigene Person: `own_status` fragt `bot.member_status` (Zwischenspeicher
  `discord_memberships`, 5 min; Bot offline = None, nichts gemerkt), `note_membership` aus
  `on_member_join`/`on_member_remove` (Zähler `discord_guilds_joined`, Neuberechnung über die
  Warteschlange). `greet_linked`: nach dem Verknüpfen eine DM mit den Servern zu Lieblingsspielen und
  Turnier-Anmeldungen, einmal je Discord-ID (`users.discord_servers_greeted_for`); das Log hat kein
  `payload`, „erneut senden“ geht also nie in einen Kanal. Routen `GET /api/games/{spiel}/discord`
  (optional angemeldet), `GET /api/games/discord-servers` (Formular, Bereich Turniere – vor
  `/{slug_or_id}` registriert), `GET /api/membership/discord-servers` (angemeldet). Das Formular prüft
  nur eine Änderung; ein später verlassener Server blockiert kein Speichern. Web
  `components/tls/DiscordServerTile.jsx` (Kachel Turnierseite, Zeile unter der Spielkarte „Über uns“ –
  kein Link im Link, Liste im Mitgliederbereich), App `MemberAreaScreen`. Tests
  `test_discord_game_servers_flow.py` (5).
- Discord VI D2: Kanalziele je Server (#625; PR #837 im #839). Jeder Server-Eintrag trägt `channels`;
  Unterserver kennen nur Community, News, Events, Privates gibt es nur am Hauptserver
  (`resolve_target(cfg, target, guild)` → `private_on_sub`), ein Rückfall nie über Servergrenzen.
  `settings.discord.channels` spiegelt den Hauptserver (`mirror_main_channels`); `_switch_main` nimmt
  beim Wechsel die öffentlichen Kanäle mit, private sind neu zu wählen. `send_to(…, guild_id=)`
  überspringt unknown_guild, guild_left, guild_disabled, private_on_sub mit Log;
  `test_every_send_to_caller_names_its_server_or_means_the_main_server` zählt jeden Aufrufer.
  Kanalwahl je Unterserver im Reiter „Server“, Vorschau je Server (`?guild=`).
- Discord VI D1: Server-Verzeichnis (#624; PR #836 im #839). `services/discord_guilds.py`: `reconcile`
  bei ready/join/remove/update (neue Server als ausgeschalteter Unterserver, verlassene mit `left_at`,
  genau ein Hauptserver – eingetragen oder der erste, nie ausschaltbar), `update_guild`, `health` in
  Worten mit Klickweg, `bot_invite_url`, `send_test` (am Unterserver öffentlich, nur mit
  Bestätigung); Sammlung `discord_guilds`, Routen `/api/settings/discord/guilds…`
  (`routes/discord_guild_routes.py`). Die Discord-Seite im Admin hat Reiter: Meldungen · Einbettungen
  & Termine · Willkommen · Bot & Aktivität · Server.
- Discord V Teil 5: Kanal „Mitglieder (privat)“ (#605; PR #831 im #839). Privates Ziel `members` ohne
  Rückfall; `allowed_in_target(item, target)` in `send_event`: news.members/event.members → members,
  news.internal/event.internal → board nur mit Titel, Zeit, Ort.
- Discord V Teil 4: Online-Zahl und Voice (#581; PR #830 im #839; der Betreiber schaltet in Discord
  das Server-Widget ein). `services/discord_widget.py` liest das Widget (ohne Bot-Recht und
  Presence-Intent) und verwirft Namen; Startseite „Discord: 42 online · 5 im Voice“
  (`components/tls/DiscordNow.jsx`), Mitgliederbereich „Discord jetzt“
  (`/api/membership/discord-voice`, nur Mitglieder, je Sprachkanal die Zahl), Admin
  `DiscordWidgetStatus`. Der Bot merkt sich die Server-ID (`record_state(guild_id=…)`) vor dem Abgleich
  des Verzeichnisses.
- Discord V Teil 3: Willkommensnachricht (#574; PR #829 im #839). `services/discord_welcome.py`
  (`greet` bei `on_member_join`, einmal je Person – gespeichert nur ein sha256 der Discord-ID,
  Vorgabe aus), Admin `DiscordWelcomePanel` mit Vorschau und „an mich senden“.
- Discord V Teil 2: Link-Knöpfe und Befehle (#573; PR #828 im #839). Knöpfe unter allen Meldungen
  (`resolve_buttons`: Website-Pfade werden volle Adressen), `services/discord_commands.py` mit
  /rangliste, /bracket, /wer-streamt, /mitglied, /verknuepfen – alle `ephemeral`.
- Discord V Teil 1: ein Thread je Turnier (#572; PR #827 im #839; die Bot-Rolle braucht im Kanal
  „Events und Turniere“ „Öffentliche Threads erstellen“ und „Nachrichten in Threads senden“).
  `services/discord_threads.py`: `deliver` (die erste Meldung im Kanal öffnet den Thread, alles Weitere
  geht hinein; Thread gelöscht → neu; im Thread verboten → einzeln im Kanal mit Log), Zustand
  `discord_thread` am Turnier, `status_changed`/`status_written` aus allen Statuswegen (Knopf,
  Formular, Anlegen, Zeitplan, Station, Gruppen/Swiss); „Ohne Discord“ (`discord_skip`). Bracket (#571)
  und Endstand stehen im Thread (`note_message` hält den Endstand unten). Logs sortieren nach
  `[("created_at", -1), ("_id", -1)]` – unter Windows haben Versand und Thread oft dieselbe Mikrosekunde.
- Discord IV Teil 3: Turnier-Bracket als Einbettung, Slash-Antworten nur für die fragende Person
  (#571; PR #603; Backend; `update.sh`). `services/discord_bracket.py`: `bracket_embed`/`bracket_fields`/
  `match_line` aus demselben Graph-Speicher wie das Web-Bracket (`load_competition_read_model` +
  `adapt_stage_matches`; Runden als Felder, Sieger fett, kampflos, offen mit Termin oder „live“,
  Tabellenphasen Top 8 über `competition_standings`), nur aktuelle und nächste Runde vollständig,
  Grenzen `MAX_FIELDS` 12 / 1000 je Feld / 5500 gesamt; Zustand am Turnier `discord_bracket_embed`
  (`channel_id`, `message_id`, `hash`, `final`), `refresh` (Kanal „events“ mit Rückfall Community,
  Bremse 60 s – das Ende überstimmt sie, gelöscht = neu + pinnen, nach `final` Ruhe), `sweep` hängt an
  den Jobs der Einbettungen (#569). Auslöser `v2_result_submission._finish_result_side_effects` und
  Statuswechsel live/beendet in `tournament_lifecycle_routes`. **Slash-Befehle antworten `ephemeral`**
  (Wunsch des Betreibers, 25.09.; Regel für alle künftigen Befehle) – Kanalweites gehört in gepinnte
  Einbettungen. Tests `test_discord_bracket_flow.py` (3).
- Discord IV Teil 2: Turniere und Vereins-Events als Discord-Termine (#570; PR #602; Backend + Web;
  `update.sh`; Bot-Rolle braucht „Events verwalten“). `services/discord_scheduled.py`:
  `scheduled_payload` (extern: Ort oder Link; ohne Ende Events 2 h, Turniere 4 h), `payload_hash`,
  `wants_event` (Gründe disabled/author_opt_out/status/hidden/not_public/no_date/past), `sync` alle 5 min
  (Job `discord_scheduled_events`, höchstens 20 Aufrufe je Lauf: anlegen, bearbeiten, absagen, neu nach
  manueller Löschung; Zustand am Dokument `discord_scheduled_event`), `preview_for`, `scheduled_status`;
  Bot `create_scheduled_event`/`edit_scheduled_event`/`cancel_scheduled_event` (discord.py 2.7,
  `EntityType.external`, `PrivacyLevel.guild_only`); Einstellungen `discord.scheduled_events {enabled,
  internal}` (Pydantic lehnt Nicht-Wahrheitswerte mit 422 ab); `POST /settings/discord/preview` liefert für
  Events `scheduled_event`. Web `DiscordScheduledPanel`, `DiscordPreview.scheduledEventText`. Tests
  `test_discord_scheduled_flow.py` (3), `DiscordScheduledPanel.test.jsx`, `DiscordPreview.test.jsx` (+1).
- Discord IV Teil 1: Rangliste, nächste Events und „Live jetzt“ als Nachricht, die der Bot aktuell hält
  (#569; PR #601; Backend + Web; `update.sh`). `services/discord_embeds.py`: `KINDS` ranking/events/live,
  reine `ranking_embed`/`events_embed`/`live_embed` (Fußzeile „Stand: …“), `content_hash` ohne Fußzeile,
  `request_refresh` (Merkliste im Prozess), `refresh` (posten + pinnen, dann bearbeiten; Bremse 60 s;
  `unknown_message` = neu posten), `sweep` (Job `discord_embeds` 60 s für Vorgemerktes,
  `discord_embeds_full` 10 min für alle mit neuem Stand), `embeds_status`; Bot `edit_embed`/`pin_message`/
  `_channel`; Einstellungen `discord.embeds[kind] {enabled, channel_id}` (Kanalwechsel = neue Nachricht),
  `POST /settings/discord/embeds/{kind}/refresh`. Auslöser: Middleware in `server.py` nach schreibenden
  Aufrufen (Events/Turniere/Saisons/Matches), `season_service.award_points`, Twitch-Abfrage bei geänderter
  Live-Menge. Web `DiscordEmbedsPanel` (zwischen Kanalwahl und Vorschau). Tests `test_discord_embeds_flow.py`
  (4), `DiscordEmbedsPanel.test.jsx`. **Falle:** #599 und #601 ergänzten beide die Job-Liste und die
  Twitch-Abfrage – beim Neuaufsetzen beide Seiten behalten (mehrzeilige `add_job(`-Aufrufe!).
- Twitch: Clips des Vereinskanals auf der Startseite und „Turnier live“ (#579; PR #599; Backend + Web;
  `update.sh`). `services/twitch_clips.py` (Job `twitch_clips` stündlich: Helix `users` einmal für die
  Kanal-ID, `clips` der letzten 30 Tage, `pick_clips` Top 6 nach Aufrufen, Zustand `twitch_clips_state`,
  Fehler im Klartext, alte Clips bleiben bei Störung; `twitch_clips_enabled` am Branding, Standard aus;
  `GET /api/streams/clips`, `POST /api/admin/streams/clips/refresh`, Admin-Stand `clips`).
  `services/tournament_streams.py` (`live_streams_for_tournament`: Teilnehmer inkl. Teammitglieder, nur
  öffentliches Profil und Twitch nicht privat; `sync` am Ende von `twitch_service.fetch_live_streams`:
  je laufendem öffentlichen Turnier und Stream-ID genau eine Meldung, Sammlung
  `tournament_stream_announcements`), Ereignis `tournament.stream_live` (Standard an),
  `discord_announcements.stream_live_message` (auch in der Vorschau), `GET /api/tournaments/{slug|id}/streams`
  (im Fähigkeiten-Inventar als öffentliche Ansicht eingeordnet). Web `TwitchClips` (Startseite,
  Clip-Player erst nach Zustimmung), `TournamentLiveStreams` (Turnierseite bei Status live, Player erst
  nach Zustimmung), Schalter und Karte im Twitch-Reiter. Tests `test_twitch_clips_flow.py` (3),
  `test_tournament_streams_flow.py` (3), `TwitchClips.test.jsx`, `TournamentLiveStreams.test.jsx`.
- „Gerade in Steam“ im Mitgliederbereich (#584; PR #598; Backend + Web + App; `update.sh`, die
  App-Karte kommt mit der nächsten App-Version). `services/steam_presence.py`: `poll` alle 2 min
  (Job `steam_presence`, `GetPlayerSummaries` gebündelt zu 100, nur Konten mit Opt-in), Zustand
  `settings.steam_presence_state` ohne Verlauf (nach 10 min ohne Abruf leer), `presence_for` prüft
  Opt-in und Verknüpfung noch einmal (gelöst oder Schalter aus = sofort draußen; nie eine SteamID
  in der Antwort), Feld `users.show_steam_status` (Standard aus, nur mit verknüpftem Konto), Route
  `GET /api/membership/steam-presence` (nur Mitglieder). Web `SteamPresence` (Karte
  `member-area-steam`, Hinweis „Auch dabei sein“), Schalter in `SocialsTab` (`profile-steam-status`,
  nur bei `steam_id`-Verknüpfung); App `MemberAreaScreen` Karte + `steamSummary`. Datenschutz: Fakt
  `steam_status` und Zeile in `site_texts` (**Schlüsselnamen ohne „enc“ – `test_club_facts` sucht so
  nach Geheimnissen**). Tests `test_steam_presence_flow.py` (4), `SteamPresence.test.jsx`,
  `SocialsTab.test.jsx` (+1), `MemberAreaScreen.test.tsx`. **Falle:** `flow.act_as(user)` liest die
  Person nicht neu aus der Datenbank – `is_club_member` & Co. auch im Dict setzen.
- YouTube-Videos des Vereinskanals als News (#578; PR #597; Backend + Web (+ App-Label);
  `update.sh`). `services/youtube_feed.py`: Atom-Feed `feeds/videos.xml?channel_id=` (kein
  Schlüssel), `resolve_channel_id` (Handle einmal über die Kanalseite, gemerkt in
  `settings.youtube.channel_id`/`channel_id_for`, bei neuer Adresse neu), `parse_feed` (älteste
  zuerst), `is_short` (`/shorts/<id>` 200 = Short), `video_news` (Kategorie `video`, `video_url`,
  `source: youtube`, Autor „YouTube“), `sync` (erster Abruf = Baseline ohne News, danach je Video
  genau einmal; Sammlung `youtube_videos`), `status`; Job `youtube_feed` alle 15 min; Routen
  `GET|PUT /api/settings/youtube`, `POST /api/settings/youtube/fetch`; `NewsCategory` + `video`,
  `NewsCreate/NewsUpdate.video_url`. Web `YoutubeSettings` (Verbindungen → YouTube: Schalter
  abrufen / gleich veröffentlichen (Standard Entwurf) / Shorts, eigene Kanal-Adresse, „Jetzt
  abrufen“, Stand), `VideoEmbed` (News-Seite, `youtube-nocookie`, erst nach Zustimmung; Banner
  entfällt bei Video), Feld „Video (YouTube-Link)“ im News-Formular, Label „Video“ (auch App
  `format.ts`). Discord über den bestehenden News-Job. Tests `test_youtube_feed_flow.py` (4),
  `VideoEmbed.test.jsx`, `YoutubeSettings.test.jsx`.
- Zum Kalender hinzufügen: Google, Outlook, ICS vom Server (#580; PR #596; Backend + Web;
  `update.sh`). `calendar_items`: `_vevent`/`_calendar` (Feed und Einzeltermin aus einem VEVENT),
  `ics_single` (VALARM `-PT60M`), `ics_filename`, `event_item`/`tournament_item`, `check_in_note`
  (Wiener Zeit), `vienna`; Routen `GET /api/calendar/events/{slug|id}.ics` und
  `…/tournaments/{slug|id}.ics` (nur Öffentliches, sonst 404; unter `/api/calendar`, weil
  `/api/events/{id}` sonst `x.ics` als Kennung fängt). Web `calendarLinks.outlookCalendarUrl`/
  `serverIcsPath`, `AddToCalendar` mit drei Wegen (`add-to-calendar-google|outlook|ics`), die Seiten
  geben `slug` mit. App unverändert (Gerätekalender). Tests `test_calendar_flow.py` (+2),
  `calendarLinks.test.js` (+1), `AddToCalendar.test.jsx`.
- Discord III Teil 4: Vorschau jeder Meldungsart, Testkanal, „an mich“ (#583; PR #595; Backend +
  Web; `update.sh`). `services/discord_samples.py` (`sample_catalog`: News, Event, Turnier×4, Fast
  Lap, Vorstand×2, Betrieb×2, Direktnachrichten×7 – aus denselben Funktionen wie die echte Meldung,
  letzte echte Daten sonst Beispiele mit „Paula“; `send_sample(key, via=test|dm)`, `TEST_FOOTER`),
  privates Ziel `test` (`PRIVATE_TARGETS`, `TARGET_LABELS`, `REASON_TEXTS` test_channel_missing /
  not_linked), `build_embed(footer=)`, `send_to(footer=, test=)` → Log `test: True` (zählt nicht als
  letzte Meldung). Eine Quelle: `discord_announcements.tournament_message`/`fast_lap_message`/
  `board_message` (+ `notify_board(event_key, description)`), `ops_alerts.check_red_message`/
  `error_group_message`. Routen `GET /api/settings/discord/samples`, `POST …/samples/{key}/send?via=`,
  `/discord/test` kennt `test`. Web `DiscordMessagePreview` (Nachbildung; auch in `DiscordPreview`),
  `DiscordSamplesPanel` (unter `DiscordTargets`), Ziel „Test“ in der Kanalwahl; e2e
  `admin-settings.spec.js`. Tests `test_discord_samples_flow.py` (4), `DiscordMessagePreview.test.jsx`,
  `DiscordSamplesPanel.test.jsx`.
- App 1.0.0: Play-Fassung ohne Installer, Profilstatus in Klartext (#593, #592; PR #594; App 1.0.0 /
  Build 79 + Web; `update.sh`, Build 79 am 25.09. gebaut). `mobile/app.json` ohne
  `REQUEST_INSTALL_PACKAGES`, Config-Plugin `mobile/plugins/withReleaseManifest.js`
  (`withDangerousMod` → `android/app/src/release/AndroidManifest.xml` mit `tools:node="remove"` für
  SYSTEM_ALERT_WINDOW und REQUEST_INSTALL_PACKAGES; aapt2 und das Bundle von Build 79 bestätigen es),
  `lib/appUpdate.ts` ohne Download/`updatePath`, `AppUpdateBanner` nur Play (Rückfrage je Art bleibt,
  `onStartPlayUpdate` nur bei Play-Installation), Admin ohne Server-Updater-Schalter (Backend-Setting
  bleibt); `lib/profileCompleteness.ts` + Web `lib/profileCompleteness.js` (`missingLabels`);
  `docs/PLAY_STORE.md` (Organisationskonto, AT/DE/CH/IT, Tags), `mobile/RELEASES.md`. Tests
  `AppUpdateBanner.test.tsx` (4), `appUpdate.test.ts` (5), `profileCompleteness.test.*`.
- Discord III Teil 3: Erfolge als Gratulation per Direktnachricht (#568; PR #590; Backend + Web +
  App; `update.sh`). Thema `achievements` (`channels: [in_app, push, discord]`, Web und App zeigen
  für andere Kanäle einen Strich), `NOTIFICATION_KIND_CATEGORY["achievement"]`, `_notify_user` Meta
  `awards/points/level`, `discord_dm.achievement_content` („🏆 Stark, Paula! 2 Erfolge
  freigeschaltet“, `LEVEL_COLORS`), `send_discord_dm_for_notification` holt den Anzeigenamen. Tests
  `test_discord_dm_flow.py` (+1).
- Discord III Teil 2: Discord als persönlicher Benachrichtigungskanal (#567; PR #589; Backend + Web +
  App; `update.sh`). `services/discord_dm.py` (`send_discord_dm_for_notification`, `dm_content` –
  Nachrichtentexte anderer durch `PRIVATE_BODY_TEXT` ersetzt, `EXCLUDED_KINDS` moderation,
  `dm_state` mit `blocked_at` und Klickweg; Forbidden merkt `users.discord_dm_blocked_at`),
  `discord_bot.BotRunner.send_dm`, `REASON_TEXTS` dm_forbidden/unknown_user,
  `DELIVERY_CHANNEL_PREFERENCES["discord"]` (Standard aus, `discord_allowed`),
  `/users/me/notification-preferences` liefert `discord: {linked, blocked_at, hint}`. Web
  `NotificationsTab` (Spalte nur verknüpft), App `ProfileScreen` `visibleChannels`/`discordDm`.
  Tests `test_discord_dm_flow.py`, `NotificationsTab.test.jsx`, `ProfileScreen.test.tsx`. **Falle:**
  `create_user_notification` hat Abklingzeiten je Art (tournament_checkin 15 min) – im Test
  verschiedene Arten nehmen.
- Discord III Teil 1: der Bot schickt alle Meldungen, Webhooks weg (#566; PR #588; Backend + Web;
  `update.sh` – danach Bot verbinden und je Zweck einen Kanal wählen, bis dahin geht nichts raus).
  `discord_service.py` nur noch Bot: `TARGETS` community/news/events/board/ops,
  `settings.discord.channels[ziel]` = Kanal-ID, `REASON_TEXTS` (disabled, bot_off, bot_offline,
  channel_missing, forbidden, unknown_channel – in Worten mit Klickweg), `resolve_target` →
  `channel_id` (öffentlich fällt auf Community, privat nie), `send_to` → `discord_bot.bot.send_embed`,
  Log in `email_logs` (channel discord: `channel_id`, `message_id`, `reason`, `payload`),
  `broken_targets` bei forbidden/unknown_channel (Tageszentrale mit `text`); `channel_id_valid`.
  `discord_bot.BotRunner.send_embed` (Forbidden → forbidden, NotFound → unknown_channel),
  `list_channels` (Textkanäle mit `can_send`/`can_embed`, Cache in `discord_bot_state.channels`,
  offline die letzte Liste + Hinweis), `channel_row`/`sorted_channels`, `_guild`. Routen `GET
  /api/settings/discord/channels`, `PUT /api/settings/discord {enabled, channels, events, bot_*}`
  (alte Felder werden ignoriert), `/test` kennt nur die fünf Ziele. Migration 3
  `discord_webhooks_to_bot` verwirft `webhook_url`, `ops_webhook_url`, `username`, `avatar_url`,
  `targets`. `achievement.awarded` und Ziel „Erfolge“ weg; `achievement_queue.flush_awards` →
  `{users, notified}`. Web `DiscordTargets` (Select aus der Kanalliste oder Kanal-ID-Feld,
  `discord-target-<ziel>-channel|id|save|test|clear|last`, `discord-targets-bot-off`,
  `discord-channels-offline`), `DiscordSettings` nur Schalter „Versand aktiv“ + letzter Stand
  (`discord-not-configured`); Übersicht-Zeile `discord_channels`; Dashboard „Kanal ohne Recht“;
  FAQ/Anleitung `discord_channels` (**Falle:** `SETUP_GUIDE_ORDER` muss neue Schlüssel kennen,
  `SetupGuide.test`); `privacy-discord-channels`, `discord_facts` → `channels`/`bot`;
  `docs/DISCORD.md`, `docs/BETRIEB.md`. Tests `test_discord_targets_flow.py` (Seam:
  `monkeypatch.setattr(discord_bot.bot, "send_embed", …)` + `apply_settings`),
  `test_ops_betrieb2_flow`, `test_discord_bot_unit` (+1), `DiscordTargets.test.jsx`,
  `DiscordSettings.test.jsx`; Live-Tests `test_phase3` auf Kanäle umgestellt.
- Play-Store-Paket (#219 Teil 3; PR #587; nur Doku). `docs/PLAY_STORE.md` (Klickweg Play Console,
  Store-Texte, Datensicherheits-Tabelle, Inhaltseinstufung, Testkonto für Googles Prüfer,
  Screenshot-Regeln, Ablauf je Version, Checkliste), `docs/store/icon-512.png` und
  `feature-graphic-1024x500.png` aus `scripts/store_graphics.py` (Pillow, Segoe UI; nach Änderung
  der Markenbilder neu laufen lassen).
- Play-Upload per API (#412; PR #586; nur App-Skripte). `mobile/scripts/play-publish.cjs`: JWT
  RS256 mit Node-Crypto (keine neue Abhängigkeit), Android Publisher v3 Edit → Bundle (Rohdaten)
  → Track (`versionCodes`, `completed`, Hinweise aus dem Changelog ≤ 500 Zeichen) → Commit; Fehler
  verwirft den Edit; `resolveTrack` (closed → alpha, Produktion abgelehnt), `checkAccess` (nur
  lesend), `loadServiceAccount`. `release-local.cjs`: `--play[=closed|<track>]` (schließt `--aab`
  ein, Datei wird vor dem Bauen gelesen), `--check` sagt, ob das Dienstkonto die App sieht;
  Dienstkonto `%USERPROFILE%\.lionsapp-release\play-service-account.json`
  (`playServiceAccountFile` in `signing.json` / `LIONSAPP_PLAY_SERVICE_ACCOUNT`); Fehlschlag nach
  dem Release = Warnung + Code 1. Tests `play-publish.test.mjs` (21, in `test:release`). Doku
  `mobile/RELEASES.md` (Punkt 7, „Play Console: Bundle automatisch laden“).
- Sticker und GIFs der Tastatur im Chat (#239; PR #585; Backend + Web + App 0.18.0-beta / Build 78;
  `update.sh`, App-Build). Lokales Expo-Modul `mobile/modules/keyboard-image-input` (Kotlin
  `KeyboardImageInputModule`: `ViewCompat.setOnReceiveContentListener` auf dem `ReactEditText`
  (`appContext.findView(viewTag)`) – `AppCompatEditText` trägt die MIME-Typen in die `EditorInfo`
  und reicht `commitContent`-Bilder durch; Kopie nach `cache/keyboard-images`, Ereignis
  `onKeyboardImage`; `expo prebuild` verlinkt `modules/` von selbst, `package.json` +
  `expo-module.config.json` im Modulordner), JS `acceptKeyboardImages(findNodeHandle(ref), cb)`
  (nur Android, sonst No-op), `ChatThreadView` → `attachments.addAssets`. GIF im Chat erlaubt (App
  `attachmentKindForAsset`, Web `chatAttachmentKind`/`CHAT_ATTACHMENT_ACCEPT`); Server
  `chat_attachments._keep_animated_image` (GIF und animiertes WebP unverändert, Pixel/Größe
  geprüft; `_upload_kind` nimmt gif), `image_variants.build_variant` überspringt animierte
  (`?w=` liefert das Original), `media_scan._still_frame` (PNG-Standbild für NudeNet/OpenCV).
  Kotlin geprüft mit `expo prebuild --no-install` (Dummy `google-services.json`, gitignored) und
  `gradlew :keyboard-image-input:compileReleaseKotlin`; `CHANGELOG` 0.18.0-beta fasst alles seit
  Build 77 zusammen. Tests `test_chat_attachments_flow.py` (+3), `ChatThreadView.test.tsx`
  (FormData-Ersatz im Test), `chatAttachments.test.ts/js`, ganze App-Suite 257. **Falle:**
  Bash-Heredocs über ~100 Zeilen scheitern im Werkzeug – große Dateien mit Write schreiben.
- Helferdienste aus der Vereinsakte (#331; PR #582; Backend + Web + App; `update.sh`, App-Build).
  `services/dolibarr_helper_shifts.py` (`overview`, `request_shift`, `withdraw_shift`,
  `event_view`/`shift_view` mit `can_request`/`can_withdraw`, `SHIFT_CONFLICTS` voll/vorbei/
  abgesagt/überschneidung/bestätigt), Routen `GET /api/membership/me/helper-shifts`, `PUT|DELETE
  /api/membership/me/events/{e}/shifts/{s}`; Fake `add_event`/`set_event_status`/`request_shift`/
  `confirm_shift`; Web `/members/helfen` (`MemberHelperShiftsPage`, `shiftWhen`), Karte
  `member-area-helping`, Link „Helfen“; App `MemberHelperShifts` (`confirmShift`), Kachel „Helfen“;
  `tests/flow_harness.py` kann `delete()`. Tests `test_member_helper_shifts_flow.py`,
  `MemberHelperShiftsPage.test.jsx`, `MemberHelperShiftsScreen.test.tsx`.
- Generalversammlung und Abstimmungen aus der Vereinsakte (#327; PR #565; Backend + Web + App;
  `update.sh`, App-Build; Recht „… im Namen jedes Mitglieds abstimmen“ beim API-Benutzer nötig).
  `services/dolibarr_meetings.py` (`overview`, `respond`, `submit_motion`, `cast_vote` –
  `external_id` = Person+Abstimmung+Recht, **welche Antwort jemand gab, steht nie im Log**;
  `MeetingsError`, `REASON_TEXTS`, `VOTE_CONFLICTS`, `_conflict_text` liest
  `exc.detail["message"]`), Routen `GET /api/membership/me/meetings`, `PUT …/meetings/{id}/response`,
  `POST …/meetings/{id}/motions`, `POST /api/membership/me/ballots/{id}/votes`; Fake Meetings/
  Ballots; Vertrag Vereine 1.4.0 (51 Pfade, identisch mit `docs/openapi.json` des Moduls). Web
  `/members/meetings` (`MemberMeetingsPage`), Karte „Versammlungen“; App `MemberMeetings`
  (`confirmVote`). Tests `test_member_meetings_flow.py`, `MemberMeetingsPage.test.jsx`,
  `MemberMeetingsScreen.test.tsx`.
- GitHub-Releases der App von selbst, Beta/Release-Kennzeichnung (#309; PR #563; Backend + Web +
  App; `update.sh`, App-Build). `services/github_releases.py`: `sync(db, force=, limit=)` holt alle
  10 min (Scheduler-Job `github_releases`, ein Replikat) `GET /repos/<repo>/releases` mit einem
  feinkörnigen Token (nur Lesen von Contents; verschlüsselt in `settings.app_releases.github_token`,
  nie in einer Antwort), `parse_tag` (`mobile-v<version>-build<N>`; Entwürfe und fremde Tags
  übersprungen), Asset laden → `app_releases.store_release(set_current=False, source="github")`,
  Prüfsumme gegen die `.sha256`-Datei, erst dann `update_release(is_current=True)` – nur beim
  höchsten Build und bei einer Beta nur mit `github_rollout_betas` (Standard an, solange die App Beta
  ist); falsche Prüfsumme → Datei weg, Grund in `github_last_error`. `public_settings`,
  `save_settings` (Token, `clear_github_token`, Repo `owner/name`, Schalter). Routen
  `GET/PATCH /api/admin/app-releases/github`, `POST …/github/sync` (auch bei Job aus; Audit
  `app_release.github_settings|github_sync`). `app_releases.channel_of(version, prerelease)` →
  `channel` beta|release an jedem Release (`public_release`, also auch `/api/mobile/app-version`),
  Upload von Hand nach `-beta`. Web `AdminAppReleasesPage`: Kasten `app-release-github` (Stand,
  Token nur hin, Repo, `…-enabled`, `…-betas`, `…-sync`, `…-clear`), Spalte Kanal (`ChannelBadge`),
  „von GitHub“. App `lib/appUpdate.ts` `releaseChannel`, `channelLabel`, `installPrompt(channel,
  mandatory)`; `AppUpdateBanner` Plakette `app-update-channel` (BETA · Testversion gelb / RELEASE
  grün) und Rückfrage `confirmInstall` (Standard `defaultConfirmInstall` = Alert; Tests geben eine
  Funktion mit) vor dem Download, Pflicht ohne „Später“ mit demselben Hinweis. Tests
  `test_github_releases_flow.py` (3, nachgestelltes GitHub), `AdminAppReleasesPage.test.jsx` (+2),
  `AppUpdateBanner.test.tsx` (+1), `appUpdate.test.ts` (+1).
- Einstellungen-Seite in Dateien je Abschnitt (#223 Rest; PR #562; nur Web). `AdminSettingsPage`
  (1692 → 618 Zeilen) behält Zustand, Laden und Handler; je Abschnitt eine reine Darstellungs-
  Komponente mit genau den Props, die ihr JSX braucht: `pages/admin/settings/sections/
  {GoogleLoginSection, AccessSection, ResendSection, SmtpSection, NewsletterSection,
  MailQueueSection, BrandSection, SeoSection, SystemSection}.jsx`, Bausteine `sections/parts.jsx`
  (BannerPreview, BannerScopePicker, BrandNumberField, BrandDateTimeField, SeoStatusCard),
  Konstanten/Helfer `settings/shared.js` (SETTINGS_SECTIONS, LEGACY_TAB_REDIRECTS, Presets,
  Payload-Helfer). Mechanisch per Skript (Props = Namen aus dem Komponenten-Scope, die im Block
  vorkommen; ESLint no-undef/no-unused-vars als Nachweis). Damit ist #223 durch.
- Konten verknüpfen III, Welle 3: Mastodon und Bluesky (#547; PR #561; Backend + Web + App;
  `update.sh`, App-Build). Dezentral, keine App im Admin. `PLATFORMS[*]["input"]` (Label,
  Platzhalter, Pflicht) – was die Person vor dem Start eintippt; `/me/platform-links` liefert es,
  `POST …/start` nimmt `{input}` (`LinkStart`), Web `LinkRow` zeigt das Feld vor dem Knopf
  (`profile-<key>-input`, Pflicht sperrt den Knopf), `?link=mastodon` startet nicht von selbst.
  `begin_link(db, platform, branding, state, input)` statt `authorize_url` im Start; Sitzungen zum
  state in `platform_link_sessions` (`_remember_session`/`_take_session`, einmal lesbar, 10 min);
  `fetch_identity(..., db=)`. Mastodon: `mastodon_instance()` (Host aus „name@instanz“/Adresse,
  `HOST_RE`), `_resolves_public` (nur öffentlich auflösende Hosts – Tests patchen es), `_mastodon_app`
  registriert die Website je Instanz (`POST /api/v1/apps`, Scope read:accounts, verschlüsselt in
  `db.mastodon_apps`), `/oauth/token`, `verify_credentials`; Handle `name@instanz`, `official_url`
  → `https://instanz/@name`. Bluesky: `GET /api/platform-links/bluesky/client-metadata.json`
  (`bluesky_client_metadata`, client_id = diese Adresse, `token_endpoint_auth_method: none`,
  DPoP), `bluesky_handle()`, `_bluesky_issuer` (resolveHandle → DID-Dokument (`plc.directory` /
  did:web) → PDS → `oauth-protected-resource` → Authorization Server; ohne Handle `bsky.social`),
  `_dpop_key` (ES256 je Start), `_dpop_proof` (jti/htm/htu/iat/nonce/ath), `_dpop_post` (Nonce-Tanz
  `use_dpop_nonce`), PAR → `authorization_endpoint?client_id&request_uri`, Token mit DPoP + PKCE,
  `iss`-Prüfung, Identität = `sub` (DID) + `app.bsky.actor.getProfile`. `check_provider`: beide
  „keine App nötig“. Felder `mastodon_handle`, `bluesky_handle`; FAQ 29 Plattformen;
  e2e-Navigationszahl 79. Tests `test_platform_links_flow.py` (+1 mit Fake-Instanz und
  Fake-Authorization-Server, DPoP-JWT wird verifiziert), `SocialsTab.test.jsx` (+1),
  `PlatformLinkSettings.test` (5 bereit), `test_site_texts_flow`/`test_club_facts_flow` (Mastodon,
  Bluesky immer in der Liste). Aus den Spezifikationen gebaut, nicht gegen die echten Server
  geprüft – der erste echte Durchlauf ist der Nachweis.
- Bildprüfung: Prüffälle bei Avatar, Banner, Teamlogo verbergen (#415 Rest; PR #560; Backend;
  `update.sh`). `media_scan._finish`: `review` bei `kind="upload"` geht wie `blocked` in die
  Quarantäne (`hide`), die Verweise bleiben; `placeholder_png(state)` (Pillow, PNG – die App kann
  kein SVG; `PLACEHOLDER_TEXT` „Bild wird geprüft“ / „Bild entfernt - Moderation“, im Speicher),
  `placeholder_for(db, url)`; `server.public_upload` liefert ihn statt 404 mit `Cache-Control:
  no-store` und `X-TLS-Placeholder: 1`; nginx `map $upstream_http_x_tls_placeholder
  $tls_upload_expires` (`expires` im Fallback `@tls_upload_backend` nur ohne Platzhalter).
  `purge_quarantine` nur `state: blocked` (ein Prüffall wartet auf einen Menschen). Freigabe
  `_restore`, Entfernen aus der Prüfung heraus wie bisher. Test `test_media_scan_flow.py` (+1;
  **Falle:** `import server` nie am Modulanfang eines Flow-Tests – das Harness importiert die App
  mit geliehener Umgebung, sonst „Invalid host header“). Doku `docs/MODERATION.md`. Damit ist
  Moderation II durch (AWS Rekognition bleibt „bei Bedarf“).
- Plattformen an- und abschalten (#558; PR #559; Backend + Web + App; `update.sh`, App-Build).
  Branding `disabled_platforms` (Liste; unbekannte → 400); `platform_links.MANUAL_PLATFORMS`
  (instagram, psn, nintendo, ea), `GAME_PLATFORM_KEYS`, `disabled_platforms(branding)`,
  `platform_catalog(branding)` (key, label, field, group social|game, linkable, enabled);
  `providers_configured` meldet abgehakte als nicht verfügbar, `authorize_url` wirft `disabled`
  (Start → 409 „bietet der Verein nicht an“), `links_for(db, user, branding)` lässt sie aus,
  `user_routes._field_visible` prüft `ctx["off"]` (öffentliches Profil: Feld, Häkchen, verknüpfte
  Konten), `privacy_facts` folgt. `/me/platform-links` → `disabled`; `/settings/public` →
  `disabled_platforms`; Übersicht → `platforms` (Katalog) und Zustand „off – vom Verein
  abgeschaltet“. Web `AdminIntegrationsOverviewPage.PlatformSwitches` (`platforms-section`,
  `platform-toggle-<key>`, `platforms-enable-all|disable-all|save|off-count`), `SocialsTab`
  (`platformsOff`, `MANUAL_PLATFORM_OF`), `PrivacyTab` → `visibilityGroupsFor(disabled)`,
  `AdminLayout.navGroupsFor(user, query, disabled)` (Menüeintrag `platform`), Hinweis
  `integration-disabled-hint`, `guideStatus` „Vom Verein abgeschaltet“. App `PlatformLinkRows
  disabled`, `ProfileScreen` filtert Zeilen und Textfelder. Tests `test_platform_links_flow.py`
  (+1), `AdminIntegrationsOverviewPage.test.jsx` (+1), `SocialsTab.test.jsx` (+1),
  `visibility.test.js` (+1), `AdminLayout.test.jsx` (+1), `LinkedAccounts.test.tsx` (+1).
- Konten verknüpfen III, Welle 2 (#547; PR #556; Backend + Web + App; `update.sh`, App-Build).
  Threads, Facebook, LinkedIn (OIDC), Snapchat, Pinterest, Telegram (OIDC: kein userinfo – ID-Token
  gegen `TELEGRAM_JWKS` mit PyJWT `PyJWK`, PKCE), Wargaming (OpenID-artig: `WARGAMING_LOGIN` mit
  `application_id`, Rückruf bringt `access_token`/`account_id`, Bestätigung über `account/info`),
  Bungie (`X-API-Key` zusätzlich). `PLATFORMS[*]` kennt `secret_field: None` (nur Kennung) und
  `extra_field` (zweites Geheimnis); `providers_configured`, `_credentials`, `check_provider`
  („Application ID fehlt“ / „API Key fehlt“), Übersicht und `PlatformAppCard` (`extraField`,
  `appReady`) folgen. `privacy_facts` liest auch `extra_field` (sonst zählte Bungie nie als
  eingerichtet). Felder `<key>_handle`, Sichtbarkeit (Wargaming/Bungie bei Gaming-IDs), FAQ 27
  Plattformen, e2e-Navigationszahl 77. Tests `test_platform_links_flow.py` (Telegram mit echter
  RSA-Signatur gegen JWKS), `visibility.test.js` (37), Web/App-Registrierungen.
- Vereinsprofil ↔ Konto (#506; PR #544; Backend + Web; `update.sh`). `membership_routes`:
  Profil anlegen/verknüpfen legt **keine** Mitgliedschaft mehr an (`_activate_linked_membership`
  weg); löst der Vorstand ein Konto → `account_unlinked_user_id/_at` (der Abgleich hängt es nicht
  wieder an: `dolibarr_sync` prüft den Merker); `PUT /me/directory` übernimmt über
  `_board_profile_for` (bestätigte Dolibarr-Zuordnung → `dolibarr_member_id`) das Vorstandsprofil
  statt ein zweites anzulegen, 409 nach ausdrücklichem Lösen. Web `pages/admin/members/AccountBox.jsx`
  (Suche `club-member-account-search` über `GET /users?q=`, `…-link-<user>`, `…-unlink`,
  `…-takeover` holt Bild/Spiele/Plattformen/Gamertag aus `GET /users/{id}` nur in leere Felder,
  fremd verknüpftes Konto gesperrt). Tests `test_club_member_profiles_flow.py` (2),
  `AdminClubMemberProfilesPage.test.jsx` (2). FAQ `profil_konto`.
- Adminmenü aufgeräumt (#512; PR #543; nur Web; `update.sh`). `AdminLayout` Gruppe Mitglieder mit
  Dolibarr (+ `searchOnly`-Wegweiser `?tab=features` „Funktionen (Schalter)“, `?tab=policy`
  „Bereiche“), Finanzen nur Finanzübersicht, „Jahreswertung“; Seitentitel = Menüname (`AdminF1Page`
  „Fast Lap“, `AdminMobileLogsPage` „App-Logs“, `AdminMobilePushPage` „Push-Tests“, `AdminPrizesPage`
  „Gewinne“, Kopfzeile = Gruppe); `/admin/widgets` → `/admin/downloads`; `setupGuides`, `adminFaq`,
  `docs/ROLLEN.md` (Tabelle je Gruppe/Rolle). Test `AdminLayout.test.jsx`.
- Vereins-Kanäle: vollständige Plattform-Liste (#541; PR #542; Backend + Web + App; `update.sh`,
  App-Build). `lib/socialIcons.js` ist die eine Liste (`SOCIAL_PLATFORMS` 24 Plattformen inkl. X,
  Threads, Bluesky, Mastodon, Telegram, Kick, LinkedIn, Reddit, Steam, GitHub, Snapchat, Pinterest,
  Vimeo, Spotify, Website, E-Mail; `socialPlatformLabel`, `socialIconFor`, lucide-`Icon` oder Pfad),
  `ChannelIcon.jsx`, Footer, `SocialSettings` Optionen, Admin-Suche, App `MoreScreen` `SOCIAL_ICONS`;
  Backend `club_facts.CHANNEL_PLATFORMS`. Test `socialIcons.test.js`.
- Nutzermenü (#516; PR #540; Web + App; `update.sh`, App-Build). `profile/constants.js`
  `userMenuEntries({username, isClubMember, badges})` (ein Ziel je Eintrag, Reihenfolge nach
  Häufigkeit, Strafen/Gewinne nur mit Zähler), `userMenuTestId`; `hooks/useAccountBadges.js`
  (`countOpenPrizes` pending/ready, `countPenalties`, 60 s Cache, `resetAccountBadges`); `UserMenu`,
  `PublicLayout` (Handy-Menü `mobileBadges`), `ProfileNav` ohne „Mein Konto“, Reiter
  „Benachrichtigungen einstellen“; App `MoreScreen` `kontoEntries(isClubMember)`. E2E
  `header-user-menu.spec.js`; Doku `docs/ROLLEN.md` „Benutzermenü und Konto-Seiten“.
- Dolibarr-Schalter an einem Ort (#510; PR #539; Backend + Web; `update.sh`). `dolibarr_routes`:
  `_features`-Zeilen tragen `switch` (`on`, `kind: select`, `system_only`), Zeile `channels`,
  `where: /admin/dolibarr?tab=features`; `PUT /admin/dolibarr/features` (`FeatureUpdate{key,on,
  options}` → `update_branding`/`_set_sponsor_source`/`update_dolibarr_settings`; `write_enabled`
  nur mit Bereich System). Web `pages/admin/dolibarr/FeaturesTab.jsx` (`dolibarr-switch-<key>`,
  `dolibarr-auto-link`, Sponsor-Kategorien, Verzeichnis-Einwilligung und Feldzuordnung),
  `parts.jsx`; Reiter Stand/Funktionen/Zuordnungen/Umstellung/Bereiche/Verbindung;
  `DolibarrSourceBlock`, `LegalSettings`, `SocialSettings` nur noch Hinweis + Link
  (`*-dolibarr-features`). FAQ `schalter`. Tests `test_dolibarr_flow.py`,
  `test_member_directory_consent_flow.py`, `AdminDolibarrPage.test.jsx`.
- Vertrag auf Vereine 1.4.0, eigene Rechnungen über die Bindung (#324 Rest; PR #538; Backend;
  `update.sh`; Modul 1.4.0). `tests/contracts/vereine-openapi.json` + `manifest.json`
  (`module_version` 1.4.0, Commit a249918, 33 Pfade); `dolibarr_client.my_invoices(who, page)`,
  `my_invoice_pdf(who, invoice_id)` (`x-content-sha256` geprüft); `dolibarr_invoices._access` →
  `(settings, member_id, who)` über `binding_for(capability="invoices")`, `_fetch_all(client,
  member_id, who)`; Fake `me/invoices` + `_invoice_pdf`. Altlast Uploads → Issue #537. Tests
  `test_dolibarr_invoices_flow.py` (+1), `test_member_self_service_flow.py`.
- Profil → Socials: offizielle Knöpfe (#521; PR #536; Web + App; `update.sh`, App-Build).
  `lib/platformBrand.jsx` (`platformMeta`, `PlatformIcon`, `BRAND_BUTTONS`, `brandButtonStyle`,
  `linkButtonLabel` „Mit Steam anmelden“), `SocialsTab` neu (`LinkRow` je verknüpfbarer Plattform,
  `ManualField`, `profile-<key>-link|-unlink|-verified|-linked-since|-official|-not-available|
  -not-linkable`, `profile-links-privacy`), `ProfilePage` startet `?link=<platform>` von selbst;
  App `PlatformLinkRows`, `LINKABLE_PLATFORMS`, `ProfileScreen` (`startPlatformLink` öffnet
  `${WEB_BASE_URL}/profile?tab=socials&link=…`, `unlinkPlatform` mit Rückfrage).
- Öffentliches Profil: Konten einmal (#527; PR #535; Web + App; `update.sh`, App-Build).
  `PublicProfilePage.accountGroups(profile)` (`SOCIAL_PLATFORMS`/`GAME_PLATFORMS`/`MANUAL_FIELDS`,
  `linkedEntry`, `manualEntry` mit `handleFromValue` – getippte Adresse zeigt den Namen,
  `verifiedCount`), `AccountsCard` (`#konten`, `public-profile-accounts|-socials|-gaming-ids`,
  Zeilen `profile-account-<key>[-verified]`), Kopf-Zähler `profile-accounts-count`; App
  `components/LinkedAccounts.tsx` (`accountGroups`, `AccountsCard`, `AccountRow`),
  `PublicProfileScreen`. Tests `PublicProfilePage.linked.test.jsx`, E2E `public.spec.js`.
- Klassischer Match-Leseweg entfernt (#231; PR #534; Backend; `update.sh`; vorher
  `bash scripts/tournament-dryrun.sh` = 0 Altlasten). `competition_read` ohne `legacy_matches`
  (`find_match_source` nur v2), `competition_privacy` → `{"stage_matches": n}`,
  `competition_structure_apply` verlangt Engine `graph`, `match_planning`, `match_overview`,
  `match_notifications`, `daily_center`, `profile_references` (Rang aus Graph-Ergebnissen),
  `database.py` ohne `matches`-Indizes; Routen `tournament_common._collect_match_plan(v2_matches)`,
  `tournament_view_routes` (`matches: []`, Engine `stage`), `match_routes._match_policy(match,
  tournament, stage)` (Standard `staff_only`), `_can_forfeit_match`; Trockenlauf-Skript liest die
  Altlast weiter über `build_structure_snapshot`. Routeninventar unverändert (680). Tests
  `test_match_policy_unit.py` neu, elf Suiten angepasst.
- Vereinsakte ohne Einladungscode (#531; PR #533; Backend + Web + App; `update.sh`, App-Build;
  Vereine ≥ 1.4.0). `services/dolibarr_identity`: `MEMBER_MODE_MIN_VERSION (1,4,0)`,
  `MEMBER_MODE_CAPABILITIES`, `parse_version`, `module_supports_member_id(state)`,
  `note_member_access`, `access_for(db, settings, user_id)` → `{"mode": member|subject, "params"}`
  (bestätigte Zuordnung + Modul ≥ 1.4.0 → `?member_id=`, sonst Bindung/Einladung), `forbidden`,
  `public_state` (`via`, `linked`, `member_ref`, `right_missing` = dem API-Benutzer fehlt „Über
  die API im Namen jedes Mitglieds handeln“, `module_too_old`); Client `my_*` mit `who`;
  `dolibarr_self_service._access` → `(settings, access, client, reason)`,
  `REASON_TEXTS.right_missing`; `dolibarr_routes._features` Zeile `member_access`;
  `test_dolibarr_connection` speichert `module_version`. Web/App Vereinsakte-Karten, FAQ
  `vereinsakte`, `docs/DOLIBARR.md`. Tests `test_dolibarr_member_access_flow.py`.
- Turnierseite (#401; PR #532; Backend + Web; `update.sh`). `components/tls/tournament/
  {TournamentTabs,TournamentTimeline,MyStandCard}.jsx`; `TournamentDetailPage` (`subPage()`,
  `primaryKey` = eine Hauptaktion je Phase, `sortedRegs`, `calendarItem`, `InfoTile`), Reiter auf
  Bracket/Spielplan/Tabellen; `tournament_registration_routes` Team `member_count`. Test
  `tournament.test.js`.
- Web-CMS weg, E-Mail-Vorlagen (#437 Variante A; PR #530; Backend + Web; `update.sh`). Der nie
  angebundene Seiten-Reiter und `cms_pages` sind entfernt; `services/mail_catalog.py` (jede Mail
  mit Zweck, Empfänger, Variablen; Betreff/Text überschreibbar, Vorschau, Testmail, Zurücksetzen),
  `AdminEmailTemplatesPage` unter System → E-Mail-Vorlagen. FAQ `mail_templates`.
- Website-Profil aus den Feldern des Moduls (Vereine 1.2.0; PR #528, Ersatz für #501; Backend +
  Web + App; `update.sh`). Zusatzfelder `{code,label,type,editable,value,max_length?,options?}`,
  `PUT {fields:{code:value}}`, `error.field` bei 400; 1.1.0-Antworten werden auf der Website in
  Felder übersetzt. Vertrag auf 1.2.0 (7687873), seit #538 auf 1.4.0.
- Mitgliedsantrag für ein bestehendes Konto (#507; PR #526; Backend + Web; `update.sh`).
  `services/membership_invitations.py` (Einladung mit Hinweis, Antrag direkt daraus, Audit
  `_audit`), Admin → Mitglieder „Einladen“. Tests `test_membership_invitations_flow.py`.
- Betrieb → Alarme (#517 Teil 1; PR #525; Backend + Web; `update.sh`). `services/ops_alerts`:
  `ALERT_KINDS`, `DEFAULT_RULES` (Discord an, E-Mail aus), `DEFAULT_RETENTION` (`email_logs` 90 d,
  `audit_logs` 730 d), `alert_due`/`claim_alert` (`ops_alert_state`, Sperrfrist
  `ALERT_WINDOW_SECONDS`), `load_alert_settings`/`save_alert_settings` (`settings/ops_alerts`),
  `notify`/`schedule_notify` (Discord über den Betriebs-Webhook, E-Mail über die Queue mit Vorlage
  `ops_alert`, Verlauf `ops_alert_log`), `send_test_alert`, `alert_red_checks`,
  `alert_error_group`, `purge_old_logs` (Job `ops_retention` täglich). Neue Anlässe: Mail endgültig
  nicht zustellbar, Hintergrundjob abgebrochen, Dolibarr-Abgleich rot, Bot offline, kritischer
  App-Fehler. Web `pages/admin/ops/OpsAlertsPanel.jsx`. Tests `test_ops_alerts_flow.py` (5),
  `OpsAlertsPanel.test.jsx` (2). Doku `docs/BETRIEB.md`.
- Einrichtung als FAQ (#511; PR #524; nur Web; `update.sh`). `lib/adminFaq.js`: 50 Fragen
  in zehn Themen (`FAQ_TOPICS`, `faqQuestions`, `filterFaq`), je Frage Antwort, Ziel im
  Admin (`to`) und ggf. `guide` aus `lib/setupGuides.js`; `AdminSetupPage` mit Suche
  (`setup-faq-search`), Themen (`setup-topic-<key>`), Fragen (`setup-faq-<key>`, offen bei
  Suche oder fehlender Anleitung), „Weitere Anleitungen“ für nicht eingehängte Guides;
  Verbindungs-Seiten zeigen Anleitungen nur aufklappbar; Menü „Einrichtung & FAQ“. Tests
  `adminFaq.test.js` (2), `AdminSetupPage.test.jsx` (+1).
- Verbindungen ohne Verlink-Seiten (#508 verkleinert; PR #523; nur Web; `update.sh`).
  Dienste mit `tab` in `lib/integrations.js` (E-Mail, Google-Login, Analytics, Google Play,
  Dolibarr) führen im Menü direkt auf ihren Reiter, `/admin/integrations/<key>` leitet dorthin
  um (`Navigate`); die doppelten `searchOnly`-Wegweiser auf dieselben Reiter sind weg (jeder
  Weg genau einmal). Offen bleibt das Zusammenlegen der E-Mail-Reiter und das Herauslösen der
  Google-/SEO-Felder aus `AdminSettingsPage.jsx` (#223).
- Vereinsdaten als eigene Seite (#509; PR #522; Backend + Web; `update.sh`).
  `/admin/club` (`AdminClubDataPage.jsx`, `LEGAL_DEFAULTS`, `legalPayload`, speichert nur
  die Felder der Seite ins Branding) mit `LegalTab`; Einstellungen ohne Reiter „Rechtliches“,
  `LEGACY_TAB_REDIRECTS.legal` → `/admin/club`; Menü, Dashboard-Kachel, Vorstandsseite,
  Dolibarr-Stand (`where` „Verein → Vereinsdaten“) und Einrichtung zeigen dorthin; Vorgaben
  „Österreich“. Tests `AdminClubDataPage.test.jsx` (3), Umleitung in
  `AdminSettingsPage.test.jsx`, `AdminLayout.test.jsx`, `test_dolibarr_flow.py`.
- Discord: `no_guild` in Klartext (#515; PR #520; Backend + Web; `update.sh`).
  `discord_bot.no_guild_text(view, client)` (Server-ID passt zu keinem Server – nennt die
  Server des Bots – oder Bot auf keinem Server → URL Generator), `SYNC_TEXTS`, Rollenabgleich
  liefert `text` je Grund, nach dem Verbinden steht der Satz als `last_error`; Stand „online ·
  auf keinem Server“; Kasten Discord-Aktivität beschreibt den Bot. Tests
  `test_discord_bot_unit.py` (+1), `test_discord_bot_settings_flow.py`, `DiscordBotPanel.test.jsx` (+1).
- Rundgang-Kleinkram + öffentliches Profil (#513, #514; PR #519; Web + App; `update.sh`,
  App-Build). Kopfzeilen der Adminseiten = Gruppenname statt „Phase D“/„P0“; Kontakt-Inbox;
  Fähigkeitsliste ohne Issue-Nummern; `MarkdownEditor` StarterKit ohne `link`/`underline`
  (keine doppelten Erweiterungen); Erfolge-Fenster nicht unter `/admin`, Ton nur nach
  Nutzergeste (`userHasInteracted`); Startseite Einzahl; `MeRedirect` wartet auf die
  Sitzung (`user === undefined`), Nutzermenü „Öffentliches Profil“ (`nav-public-profile`),
  Mein Profil verlinkt `@name` (`profile-public-link`, `profile-public-button`); App:
  Teilen-Link mit `WEB_BASE_URL`. Test `UserMenu.test.jsx` (+1).
- Mitgliederverzeichnis: keine Doppelten, Karte ohne Konto (#504, #505; PR #518; Backend +
  Web; `update.sh`). `dolibarr_sync._find_directory_profile` (Mitgliedsnummer
  `dolibarr_member_id` → Konto → Gamertag/Slug → Klarname, gepflegte Karte führt, `fuzzy` nur
  mit Einwilligung), `_merge_duplicate_profile` (automatische Doppelte gehen in der gepflegten
  Karte auf: Einwilligung, Nummer, Dolibarr-Stand, Foto/Bio nur wenn leer; `board_positions`
  und `references` hängen um; nie von Hand bearbeitet → entfernt, sonst `deactivated_reason
  duplicate`), `DIRECTORY_CHANGES` + `merged`; `sync_directory_entry(link=None)` legt Karten
  aus der Vereinsakte allein an, `run_sync` und `process_pending` gehen über alle Mitglieder;
  `_member_website_profile`/`_apply_dolibarr_profile(data=…)`. Admin: `dolibarr_member_id`
  am Profil („Mitglied Nr. … · ohne Konto“), Stand-Zeile nennt Einträge ohne Konto. Tests
  `test_member_directory_consent_flow.py` (+3). Doku `docs/DOLIBARR.md`.
- Testvertrag auf Vereine 1.1.0 gepinnt (PR #500; nur Tests). `contracts/manifest.json`
  `module_version` 1.1.0, `commit` d447963 (Release v1.1.0 = Modul-PR #256); OpenAPI
  unverändert. Nächster Stand: eigenes Website-Profil (dolibarr-vereine#260, Vereine 1.2)
  – Website-Seite als Entwurf in PR #501; wartet auf das endgültige Modul-Format
  (Entscheidung 25.09.: das Modul bleibt neutral, das Profil besteht aus vom Verein
  frei gewählten Zusatzfeldern, Gamertag/Spiele/Plattformen nur noch als solche Felder).
- Admin → Mitgliederprofile: Hinweis, welche Felder aus Dolibarr kommen (#410
  Nachtrag; PR #499; Backend + Web; `update.sh`). `_admin_profile` liefert
  `dolibarr_profile_at`; `AdminClubMemberProfilesPage` Kasten
  `club-member-dolibarr-hint` (nur mit Profilstand aus Dolibarr: Gamertag,
  Biografie, Games, Plattformen und Foto kommen von der Mitgliedskarte, leere
  Felder dort lassen Eingaben stehen, Namen bleiben Sache des Vorstands). Test
  `test_member_directory_consent_flow.py`.
- Dolibarr-Stand: Zeile „Mitgliederverzeichnis und Profile aus Dolibarr“ in der
  Übersicht (#410 Nachtrag; PR #498; nur Backend; `update.sh`).
  `dolibarr_routes._features` Zeile `directory`: Einwilligungscode (eigener
  `directory_consent_code` oder der des Moduls, Zusatz „aus dem Modul“), Zahl
  der Einträge mit `source dolibarr`, `where_label` Verbindung →
  Mitgliederverzeichnis; ohne Code „aus (keine Einwilligung gewählt)“. Tests
  `test_dolibarr_flow.py`, `test_member_directory_consent_flow.py`.
- Mitgliederprofil aus Dolibarr (#410 Nachtrag, dolibarr-vereine#255; PR #496;
  nur Backend; `update.sh`; braucht Vereine ≥ 1.1). `dolibarr_client.
  member_profile|member_photo` (`/vereine/members/{id}/profile|photo`);
  `dolibarr_sync._apply_dolibarr_profile` (nur bei `given`: Gamertag, Kurztext,
  Spiele, Plattformen – gefüllt in Dolibarr führt, leer lässt die Website stehen;
  Foto bei neuer `sha256` über `_store_member_photo` als
  `UPLOAD_DIR/member-photo-<profil>-<sha12>.<ext>`, `photo_url`,
  `dolibarr_photo_sha`; `dolibarr_profile_at`), Ergebnis `updated` zählt im
  `directory`-Zähler (`DIRECTORY_CHANGES`); Einwilligungscode fürs Verzeichnis
  fällt auf `website_profile_consent` aus `GET /vereine/status` zurück
  (im Abgleichstand gespeichert, vor der Schleife). Vertrag
  `contracts/vereine-openapi.json` vom Modul-Branch (Vereine 1.0 + #255,
  **API-Version 2**: Status/Organisation ohne `country_profile`, `register` ohne
  `court`), Manifest `api_version` 2 + neue Pfade; Fake `member_profiles`,
  `website_profile_consent`, Foto. Doku `docs/DOLIBARR.md`. Tests
  `test_member_directory_consent_flow.py` (+1), `test_dolibarr_client_unit.py`.
- Mitgliederverzeichnis: ein vom Vorstand gesetzter Klarname bleibt beim Abgleich
  stehen (#410 Nachtrag, Wunsch vom 25.09.; PR #495; nur Backend; `update.sh`).
  `sync_directory_entry` merkt sich `dolibarr_name` (zuletzt aus Dolibarr);
  `real_name` folgt Dolibarr nur, wenn er leer ist oder dem letzten Dolibarr-Namen
  entspricht – hat der Vorstand ihn selbst gesetzt (z. B. nur Vorname), bleibt er;
  leer holt ihn wieder. Test `test_member_directory_consent_flow.py` erweitert.
- Mitgliederverzeichnis aus der Dolibarr-Einwilligung (#410 Nachtrag, Wunsch
  vom 25.09.; PR #493; Backend + Web; `update.sh`).
  `dolibarr_sync.sync_directory_entry(db, settings, client, link, summary)` aus
  `run_sync` (beide Schleifen) und `process_pending`, Zähler `directory`:
  Einwilligung `directory_consent_code` aus `client.member_consents` → `given`
  legt ein Profil an (`source dolibarr`, `display_name`/`real_name` aus
  `_full_name`, Gamertag/Foto/Spiele vom Konto, `consent {code,state,version,
  moment}`, `_unique_directory_slug`) oder schaltet frei (Grund
  `consent_withdrawn` oder automatischer Eintrag, nie gesperrte); Pflege des
  Vorstands bleibt, nur `real_name` folgt Dolibarr; `withdrawn` nimmt jeden
  Eintrag offline (`deactivated_reason consent_withdrawn`), `none` nur
  automatische. `dolibarr_routes`: Einstellung `directory_consent_code`
  (Prüfung Buchstaben/Ziffern/`_-`), Status-Feld, `GET /api/admin/dolibarr/
  consent-texts` (System). `_admin_profile` + `consent`, `deactivated_reason`.
  Web `AdminDolibarrPage` Reiter Verbindung: Auswahl `dolibarr-directory-
  consent` (Kasten `dolibarr-directory`, Texte aus `/admin/dolibarr/
  consent-texts`), `AdminClubMemberProfilesPage` Hinweise `club-member-dolibarr-
  <id>`, `club-member-withdrawn-<id>`. Doku `docs/DOLIBARR.md`
  „Mitgliederverzeichnis aus der Einwilligung“. Tests
  `test_member_directory_consent_flow.py` (2), `AdminDolibarrPage.test.jsx`
  (+1). Offen: Mitgliedsfoto aus Dolibarr – dolibarr-vereine#255.
- Kanäle des Vereins aus Dolibarr, Statuten-Archiv für Mitglieder, Reiter Social
  Links herausgelöst (#326 Teil 4, #324 Rest, #223; PR #492; Backend + Web;
  `update.sh`). `club_facts.channels_public(organization)` (nur mit Adresse,
  Reihenfolge des Vereins, `CHANNEL_PLATFORMS` Netzwerk → Plattform, `twitter`
  → `x`), `organization_public.channels`, `admin_view.channels`; Branding-
  Schalter `channels_from_dolibarr`, `settings_routes._public_social_links`
  (Dolibarr, wenn Schalter an und Kanäle da; sonst die Liste von Hand),
  `/api/settings/public` + `channels_from_dolibarr`. Statuten:
  `dolibarr_client.my_statutes|my_statute_pdf`;
  `dolibarr_identity.statute_view` (`dolibarr-statute-<id>`, Kategorie
  `statutes`, geltende Fassung `pinned`, `statute_state`),
  `_statutes_rows` (mit Bindung `me/statutes`, sonst `statutes`; `not_published`
  → nichts), `parse_statute_id`, `statute_pdf`; `GET /api/documents/
  dolibarr-statute-<id>/view|download` über `_dolibarr_file(statute=True)`.
  Fake `statutes_members`, `_statutes_payload`, `_statute_pdf` (Prüfsumme der
  Akte), Organisation mit drei Kanälen (einer ohne Adresse). Web
  `settings/SocialSettings.jsx` (`SocialsTab` mit Props `brand|setBrandField|
  setSocialLink|addSocialLink|removeSocialLink|saveBrand|saving`,
  `SOCIAL_PLATFORM_OPTIONS`, Haken `channels-from-dolibarr` im Kasten
  `socials-dolibarr`), `BrandSelect` nach `settings/fields.jsx`;
  `AdminSettingsPage.jsx` 1825 → 1771 Zeilen. Doku `docs/DOLIBARR.md`. Tests
  `test_club_facts_flow.py` (+1), `test_dolibarr_identity_flow.py` (+1),
  `AdminSettingsPage.test.jsx` (+1).
- App: Vereinsakte, eigene Daten und Austritt in „Meine Mitgliedschaft“ (#324/
  #329 App-Teil; PR #490; nur App; App-Build). `lib/selfService.ts`
  (`IdentityState`, `SelfProfile`, `SelfRequest`, `SelfService`,
  `SELF_FIELD_LABELS`, `fieldLabel`, `changedFields`, `selfRequestLine`,
  `exitLine`, `validWishedDay`); `MyMembershipScreen` lädt
  `/membership/me/identity` und `/membership/me/self-service` mit (fehlen sie,
  bleiben die Karten weg): Karte `membership-identity` (Code
  `membership-identity-code|claim`, Stand `membership-identity-bound`), Karte
  `membership-self` (`membership-self-identity|field-<key>|save|requests|
  request-<external_id>|exit|exit-date|exit-button|exit-planned`; Rückfrage
  vor dem Austritt per `Alert`). Tests `selfService.test.ts` (3),
  `MyMembershipScreen.test.tsx` (+3).
- App: Expo-Pakete auf die vom SDK erwarteten Patch-Versionen (PR #489; nur
  App; App-Build). Expo veröffentlichte am 24.09. Patch-Versionen; `expo
  install --check` (harter Schritt im Check und in der CI) verlangte sie:
  `expo` 57.0.25, `expo-calendar` 57.0.5, `expo-image-picker` 57.0.20,
  `expo-notifications` 57.0.21, `expo-sharing` 57.0.22, `expo-video` 57.0.5
  (`npx expo install --fix` in `mobile/`).
- Meine Daten und Austritt (#329 Teil 2; PR #488; Backend + Web; `update.sh`).
  `services/dolibarr_self_service.py`: `_access` (live, Bindung `bound`,
  Fähigkeit `profile`; sonst `not_connected|not_bound|no_capability` mit
  `REASON_TEXTS`), `overview` (Profil `PROFILE_FIELDS` aus `me/profile` +
  Einreichungen aus `me/profile/changes`, `changeable`, `status_labels`),
  `request_change(db, user, version, changes)` (nur `CHANGEABLE`, `version`
  Pflicht, `external_id` aus Konto + Inhalt = derselbe Auftrag; 409 „inzwischen
  geändert“, 403 → `mark_revoked`), `request_exit(db, user, wished_last_day)`
  (Datum JJJJ-MM-TT, `external_id` je Tag und Wunsch; 409 „schon geplant“);
  `_request_view` (+`status_label`). `dolibarr_client`: `my_profile|
  my_profile_requests|request_profile_change|request_exit`;
  `dolibarr_identity.claim` fragt bei bestehender Bindung erst `identity()`
  (widerrufen → neuer Code gilt). Routen `GET /api/membership/me/self-service`,
  `POST …/self-service/changes` (`SelfServiceChangeBody`, 20/h), `POST
  …/self-service/exit` (`SelfServiceExitBody`, 5/h). Fake `profiles`/
  `profile_for`, `profile_requests`, `direct_fields`, `exit_rule_last_day`.
  Web `MyMembershipPage` `SelfServiceCard` (`membership-self-card|identity|
  form|field-<key>|save|requests|request-<external_id>|exit|exit-date|
  exit-button|exit-planned`, `selfRequestLine`, `SELF_FIELD_LABELS`). Doku
  `docs/DOLIBARR.md`. Tests `test_member_self_service_flow.py` (2),
  `MyMembershipPage.test.jsx` (+3). Nicht dabei: SEPA-Mandat.
- Vereinsakte verbinden (#324 Teil 1; PR #486; Backend + Web + App; `update.sh`,
  App-Build). `services/dolibarr_identity.py`: Bindung je Konto und
  Installation in `dolibarr_identities` (`subject` = Konto-ID, `member_id`,
  `capabilities`, `proof`, `linked_at`, `status bound|revoked`); `claim(db,
  user, code)` → `client.claim_identity` (`POST /vereine/identities/claim`,
  Schreib-Schlüssel, ohne Wiederholung; `ClaimError` 400/403/409/503 mit
  Klickweg – auch „darf noch nicht für Personen handeln“), `state`,
  `public_state` (+`capability_labels`), `documents_for` (mit Bindung
  `me/documents`, sonst `documents`; Kurzspeicher 60 s je `me:<subject>`/
  `public`; 403 → `mark_revoked` und sofort nur Öffentliches),
  `document_view` (`id dolibarr-<document_id>`, `source dolibarr`,
  `personal`, `category` aus `KIND_CATEGORY`, Beschreibung aus `WHAT_LABELS`/
  `AUDIENCE_LABELS`, `view_url|download_url` wie eigene Dateien),
  `parse_doc_id`, `document_pdf` (je Abruf aus Dolibarr, Bytes gegen `sha256`
  geprüft, kein Speicher – das Modul prüft je Abruf, wer darf).
  `dolibarr_client`: `claim_identity|identity|my_documents|my_document_pdf|
  public_documents|public_document_pdf`; `CAPABILITIES_V1`
  `verified_identities`/`documents` True. Routen `GET/POST
  /api/membership/me/identity` (`IdentityClaimBody`, Rate-Limit
  `dolibarr:identity:claim` 10/15 min); `GET /api/documents` hängt die
  Akten-Dokumente für Mitglieder an (Kategorie-Filter gilt mit), `GET
  /api/documents/dolibarr-<id>/view|download` → `_dolibarr_file` (403 kein
  Mitglied, 404 fremd/unbekannt, 502 Prüfsumme, 503 weg). Vertrag: Manifest
  ohne `verified_identities|documents` in `waiting_for`, Pfade ergänzt; Fake
  `invite|publish|revoke_identity|identity_right|tampered_document_ids`,
  `document_pdf_bytes`, `published_document`. Web `MyMembershipPage`
  `IdentityCard` (`membership-identity-card|hint|form|code|claim|bound|
  documents`), `MemberDocumentsPage` (`docs-identity-hint`, `doc-source-<id>`,
  Dokumentarten `resolution|audit_report|account|payout|letter|ballot`),
  `lib/dolibarr.js` Fähigkeitsnamen. App `memberDocuments.ts` (`source`,
  `personal`, Dokumentarten), `MemberDocumentsScreen` `document-source-<id>`.
  Doku `docs/DOLIBARR.md` „Vereinsakte verbinden“. Tests
  `test_dolibarr_identity_flow.py` (3), `MyMembershipPage.test.jsx` (+2),
  `MemberDocumentsPage.test.jsx` (3, neu), `memberDocuments.test.ts` (+1).
- Statuten aus Dolibarr (#326 Teil 3; PR #485; Backend + Web; `update.sh`).
  `dolibarr_client.statutes()`/`statute_pdf(id)` (`/vereine/statutes`,
  `/vereine/statutes/{id}/pdf`); `club_facts.refresh` liest sie mit
  (`statutes`, `statutes_fetched_at` bzw. `statutes_error` – ein Modul ohne
  Statuten-API sperrt Vereinsdaten/Vorstand nicht); `statutes_public(state,
  switch_on)` (`available` + `reason switch_off|not_published|not_fetched|
  unavailable` oder `state|current|versions|fetched_at`, Felder
  `STATUTE_FIELDS` ohne Prüfsumme), `statutes_admin` (in
  `admin_view.statutes`), `statutes_pdf` (nur eine Fassung aus dem Stand,
  `sha256` gegen die Vereinsakte, `_PDF_CACHE` je Prüfsumme). Routen `GET
  /api/board/statutes`, `GET /api/board/statutes/{id}/pdf` (404 unbekannt oder
  nicht freigegeben, 502 Prüfsumme, 503 Dolibarr weg; `inline;
  filename="Statuten-Fassung-n.pdf"`). Vertrag `tests/contracts/
  vereine-openapi.json` + `manifest.json` auf 0.11.0-beta (`bd3dabb`):
  Statuten-Pfade, `channels` am Verein, `accounts` und Feld-`type` am
  Antragsformular; Fake `statutes`/`statutes_public`/`tampered_pdf_ids`,
  `statute_pdf_bytes`. Web `ClubPages.jsx` `StatutesBox` (`board-statutes|
  board-statutes-current|board-statutes-none|board-statutes-archive|
  board-statutes-pdf-<id>`, `statuteLine`, `formatDay`), `AdminSettingsPage`
  `statutesSummary` (`legal-dolibarr-statutes`). Doku `docs/DOLIBARR.md`.
  Tests `test_club_facts_flow.py` (+1), `ClubPages.test.jsx` (4, neu),
  `AdminSettingsPage.test.jsx` (+1). Nicht dabei: Mitglieder-Archiv
  (`/vereine/me/statutes`, #324), App. Hinweis: Modul-`main` hat schon
  API-Version 2 (#252: ohne `country_profile`, `country_profile_complete`,
  `register.court`) – beim nächsten Vertrags-Update den Fake anpassen.
  Nebenbei (#223): Reiter Rechtliches nach `settings/LegalSettings.jsx`
  (`LegalTab` mit Props `brand|setBrandField|setCanonicalLegalText|saveBrand|
  saving`, lädt `/admin/dolibarr/public` selbst; `mergedLegacyText`,
  `statutesSummary`), `LegalTextArea` nach `settings/fields.jsx`;
  `AdminSettingsPage.jsx` 1926 → 1825 Zeilen.
- Discord-Bot: Fehler als Klickweg, Neustart von selbst (#302 Nachtrag; PR
  #484; Backend + Web; `update.sh`). `discord_bot.friendly_bot_error(exc)`
  (`PrivilegedIntentsRequired` → „Server Members Intent“ im Developer Portal;
  `LoginFailure` → „Reset Token“; sonst Text gekürzt) in `_run`;
  `BotRunner.restart_if_down()` (nur, wenn die Aufgabe beendet ist) über den
  Scheduler-Job `discord_bot_watch` (5 min, je Prozess, bewusst nicht
  `_single_replica`). Web `setupGuides.discord_bot` verlangt nur den „Server
  Members Intent“ (Message Content bleibt aus), `DiscordBotPanel` Hinweis
  `discord-bot-retry` bei „eingeschaltet, nicht verbunden“. Doku
  `docs/DISCORD.md`. Tests `test_discord_bot_unit.py` (+1),
  `test_discord_bot_settings_flow.py` (+1), `DiscordBotPanel.test.jsx` (+1).
- Partnerseiten in Sitemap und App (#469 Nachtrag; PR #483; Backend + App;
  `update.sh`, App-Build). Sitemap (`setup_routes.sitemap`) führt aktive
  Partner als `/partners/<slug>` (`lastmod` aus `updated_at`, monthly 0.5).
  App `InfoCenterScreen.Partners`: Kanäle als Chips
  (`partner-channel-<id>-<key>`, Symbol/Farbe über `platformIcon`/
  `platformColor` aus `components/LinkedAccounts`, Website `globe-outline`) und
  „Partnerseite öffnen“ (`partner-page-<id>` → `${WEB_BASE_URL}/partners/
  <slug>`, `WEB_BASE_URL` = `API_BASE_URL` ohne `/api`). Tests
  `test_partner_pages_flow.py` (+1), `InfoCenterScreen.test.tsx` (+1).
- Partner II Teil 3 (#469; PR #482; Backend + Web; `update.sh`). `partner_ids`
  an `ReferenceCreate/Update` (`partner_pages.clean_partner_ids`);
  `_enrich_references` hängt `partners` an (`attach_partners_many`);
  `shared_for_partner` liefert `references` (Haken oder Veranstalter-Name,
  `_reference_summary_for_partner` mit `matched_by partner|organizer`, Platz,
  Medaille, Spiel; nur sichtbare, nach Datum). Web `AdminReferencesPage`
  (`PartnerPicker` `reference-partner-<id>`), `ReferencesPage` (Chip
  `reference-partner-<slug>`, Zeile `reference-detail-partner-<slug>`),
  `PartnerDetailPage` (`partner-reference-<id>`, Kicker „Teilnahme · Platz n ·
  Spiel“, Titel „Events, Turniere & Teilnahmen“). Tests
  `test_partner_pages_flow.py` (+1), `AdminReferencesPage.test.jsx` (+1),
  `ReferencesPage.test.jsx` (+1), `PartnerDetailPage.test.jsx`.
- App: verknüpfte Konten wie im Web (#459; PR #480; nur App; App-Build).
  `components/LinkedAccounts.tsx` (`LinkedAccountsCard` mit `linked-accounts`/
  `linked-account-<platform>`, `platformColor`, `platformIcon`, `isVerified`,
  `accountTitle` (Steam-ID → „Steam-Profil“), `accountDetail`);
  `PublicProfileScreen` (Typ `verified_platforms`/`linked_accounts`, Karte über
  „Socials & IDs“, Häkchen `profile-social-verified-<platform>`/
  `profile-gaming-verified-<platform>` und Plattformfarbe, `platform`-Schlüssel
  in `publicSocialLinks`/`publicGamingIds`); `ProfileScreen` (`links` aus
  `/me/platform-links`, Karte `profile-linked-accounts`, `profile-links-web` →
  `${WEB_BASE_URL}/profile?tab=socials`). Test `LinkedAccounts.test.tsx` (2).
  Hinweis: `@testing-library/react-native` hier verlangt `await render(...)`.
- Partner II Teil 2 (#469; PR #479; Backend + Web; `update.sh`). `partner_ids`
  an `EventCreate/Update` und `TournamentCreate/Update`;
  `partner_pages.clean_partner_ids` (nur echte, aktive Partner, ohne
  Doppelte), `attach_partners` (`partners` Kurzform id|slug|name|logo_url|kind
  in `_decorate_event(include_sponsors=True)` und `_enrich_tournament`),
  `shared_for_partner(db, partner_id, user)` (Events ohne Entwurf, Turniere
  ohne Entwurf/`is_public False`, je `user_can_see`, `game` am Turnier) →
  Partnerseite `shared`. Web `components/tls/PartnerPicker.jsx` (`<prefix>-
  picker`, `<prefix>-<id>`) in `AdminEventEditPage` (Prop `partners` an
  `EventForm`, `event-partner-*`), `AdminTournamentNewPage` (`new-tr-partner-*`),
  `AdminTournamentEditPage` (Darstellung, `tr-edit-partner-*`);
  `EventDetailPage` `event-partners`/`event-partner-<slug>`,
  `TournamentDetailPage` `tournament-partner-<slug>`, `PartnerDetailPage`
  `partner-shared`/`partner-event-<slug>`/`partner-tournament-<slug>`
  (`SharedCard`). Nicht dabei: „Spieler bei beiden Vereinen“ (braucht Daten des
  Partners). Tests `test_partner_pages_flow.py` (+1),
  `PartnerDetailPage.test.jsx`, `EventDetailPage.test.jsx` (+1),
  `TournamentDetailPage.test.jsx` (+1), `AdminEventEditPage.test.jsx` (+1).
- Bildprüfung (#415; PR #478; Backend + Web + App; `update.sh` – Backend-Image
  mit NudeNet/ONNX –, App-Build). `services/media_scan.py`: Einstellungen
  `settings id media_scan` (`provider off|local|google_vision` (+`fake` im Test),
  `review_threshold` 0,6, `block_threshold` 0,85, `strike_on_block`,
  `retention_days` 90, Google-Schlüssel verschlüsselt; `normalize_settings`,
  `load_settings`, `save_settings`); Warteschlange `media_scans` (`enqueue(db,
  kind chat|upload, ref_id, owner_id, path, url, context)` setzt `scan_state`
  am Anhang bzw. `media_uploads`; im Betrieb `schedule_scan` sofort, Job
  `media_scan` alle 20 s; `process_pending` sperrt per `update_one`
  (mongomock-tauglich), `process_one` → `run_provider` (`local` NudeNet in
  `asyncio.to_thread`, Klassen `NUDITY_LABELS`/`RACY_LABELS`; `google_vision`
  SafeSearch über `LIKELIHOOD`; `off`; `fake` aus `fake_results`), `decide`
  (höherer Wert aus nudity/violence), `_finish` → `_quarantine`
  (`storage.QUARANTINE_DIR`, Varianten weg), `_mark_ref`, `_on_blocked`
  (`_clear_references` users avatar/banner + teams logo/banner, Treffer
  `moderation_standing.add_strike(source="image_scan")`, Nachricht an die
  Person, `_notify_moderators`), nach `MAX_ATTEMPTS` 3 `failed` = fail-open;
  `approve` (Rückholen aus der Quarantäne, `revoke_strike`), `remove`,
  `queue` (Owner, `context_label` aus dem Anhang, `preview_url`), `status`
  (`provider_health`, Zähler 30 Tage), `purge_quarantine` (Job
  `media_scan_purge` 24 h). Chat: `public_attachment.scan_state`, `can_access`
  (pending/review nur Absender + `SCAN_STAFF_ROLES`, blocked niemand);
  Upload: `_upload_image_impl` reiht ein (`upload_id`). Routen
  `/api/moderation/media-scan/settings|status|queue|{id}/preview|{id}/approve|
  {id}/remove` (Bereich moderation, Audit `media_scan.settings|approved|
  removed`). `privacy_facts.media_scan` (`media_scan_facts`). Web
  `moderation/ImageScanTab.jsx` (Reiter `images`: `image-scan-status|provider|
  review-open|settings|provider-select|google-key|review|block|retention|strike|
  save|filter-<state>|queue|row-<id>|preview-<id>|state-<id>|note-<id>|
  approve-<id>|remove-<id>|empty`, `settingsPayload` Prozent → Bruch),
  `ChatAttachments` `ScanAwareImage`/`ScanPlaceholder`
  (`chat-attachment-<state>-<id>`), `privacyFacts.mediaScanText`, Abschnitt
  `privacy-media-scan`; App `ChatAttachment.scan_state`, Kachel
  `chat-attachment-removed-<id>`, „Bild wird geprüft“. Abhängigkeiten
  `nudenet 3.4.2`, `onnxruntime 1.30.0`, `opencv-python-headless 5.0.0.93`,
  Dockerfile `libglib2.0-0`. Doku `docs/MODERATION.md`. Tests
  `test_media_scan_flow.py` (4), `ImageScanTab.test.jsx` (3),
  `ChatAttachments.test.jsx` (1), `privacyFacts.test.js` (+1), App
  `ChatAttachments.test.tsx` (+1). Offen in #415: AWS Rekognition; `review`
  bei öffentlichen Uploads bleibt sichtbar.
- Partnerseiten (#469 Teil 1; PR #476; Backend + Web; `update.sh`).
  `services/partner_pages.py`: `clean_url|clean_discord_invite|clean_guild_id|
  clean_twitch_channel|clean_tools`, `normalize_partner_fields` (nur die
  mitgeschickten Felder), `channels_for`, `twitch_status(login)` (Helix über
  `twitch_service._get_credentials/_get_app_token`; `configured|live|title|
  viewer_count|game_name|thumbnail_url`), `discord_widget(guild_id)`
  (`guilds/{id}/widget.json` → `enabled|name|online|invite`), Kurzspeicher
  (`TWITCH_TTL` 120 s, `DISCORD_TTL` 300 s, `reset_cache`), `_transport` für
  Tests. `models`: `PartnerTool`, `PartnerCreate/Update` + `slug|about|since|
  discord_invite|discord_guild_id|twitch_channel|youtube_url|x_url|instagram_url|
  tiktok_url|tools`. `news_routes`: `_ensure_partner_slug` (alte und Dolibarr-
  Partner beim ersten Lesen), `_public_partner` (+`channels`), `_partner_news`
  (Name in Titel/Excerpt/Content, veröffentlicht und sichtbar, 6), `GET
  /api/partners/{slug}` (nach `/partners/admin`; `find_by_slug_or_history`,
  `redirected`, inaktiv 404); Anlegen/Ändern mit `unique_slug`,
  `slug_source_for_update`, `apply_slug_history`; `dolibarr_sponsors.
  apply_partners` setzt den Slug. Web `PartnerDetailPage` (`/partners/:slug`;
  `partner-page|hero|live-pill|channel-icons|icon-<key>|twitch-live|
  twitch-consent-notice|about|tools|tool-<id>|tool-embed-<id>|tool-open-<id>|
  tool-embed|tool-consent-notice|news|news-<slug>|empty|sidebar|channels|
  channel-<key>|cooperation|missing`; `channelDetail`), `PartnersPage` (Karten →
  Seite, `partner-card-<slug>`, `partner-open-<slug>`, `partner-icon-<key>`),
  `AdminPartnersPage` (`formFromPartner`, `partnerPayload`, Abschnitte
  `partner-page-section|channels-section|tools-section`, Felder `partner-slug|
  since|about|discord-invite|discord-guild|twitch-channel|youtube|x|instagram|
  tiktok`, `ToolsEditor` `partner-tool-add|tool-<i>|tool-title-<i>|tool-url-<i>|
  tool-description-<i>|tool-image-<i>|tool-embed-<i>|tool-remove-<i>`,
  `partner-page-<id>`), `lib/socialIcons.js` (`SOCIAL_ICONS` aus PublicLayout
  herausgelöst, + `color`, + `x`), `components/tls/ChannelIcon.jsx`
  (`ChannelIcon`, `channelColor`). Tests `test_partner_pages_flow.py` (4),
  `PartnerDetailPage.test.jsx` (3), `PartnersPage.test.jsx` (1),
  `AdminPartnersPage.test.jsx` (4).
- Verbindungen ohne Doppeltes (PR #475; nur Web; `update.sh`).
  `settings/DiscordSettings.jsx` (Webhook, Betriebs-Webhook, `DiscordTargets`,
  `DiscordBotPanel`, Aktivitätszähler; eigenes Laden und Speichern,
  `discordPayload`, `discord-settings`, `discord-load-error`) und
  `settings/TwitchSettings.jsx` (`twitchPayload`; lädt `/settings/branding` +
  `/admin/streams/status`, ohne Strom alle 15 s; `twitch-settings`) stehen auf
  `AdminIntegrationPage` (`integration-settings`); die Twitch-App-Karte dort
  ohne Felder (`PlatformAppCard showFields={false}`,
  `platform-app-twitch-elsewhere`). `AdminSettingsPage`: Gruppe „Verbindungen“
  (Reiter discord/twitch) weg, `LEGACY_TAB_REDIRECTS` → `<Navigate>` auf
  `/admin/integrations/<key>`; Login & Konten zeigt `PlatformLinkOverview`
  (`platform-link-overview`, `platform-link-open-<key>`,
  `platform-link-<key>-state`) statt aller App-Karten. `INTEGRATIONS`
  discord/twitch ohne `tab`, mit `searchTerms` (AdminLayout nimmt sie in die
  Suche); Anleitungen `where` → Verbindungen; Dashboard-Kacheln Discord/Twitch →
  Verbindungen, „Konten verknüpfen“ → `/admin/setup`. Tests
  `DiscordSettings.test.jsx` (2), `TwitchSettings.test.jsx` (2),
  `PlatformLinkSettings.test.jsx` (3), `AdminIntegrationPage.test.jsx` (+2).
- Profilseite neu (PR #474; nur Web; `update.sh`). `PublicProfilePage`: Banner
  als Banner (`profile-banner`, `object-[50%_30%]`) mit überlappendem Avatar,
  Kopf `profile-identity` (Level-, Rollen-, Live-Pille `profile-live-pill`, Land,
  „Dabei seit“), Aktionen `profile-actions` + `highlight-card-open`, Bio
  `profile-bio`, Level-Fortschritt + `VerifiedChips` (`profile-verified-chips`,
  `profile-verified-<platform>`), Zahlenleiste `profile-stats` (`profile-stat-
  points|badges|wins|top3|tournaments|fastlaps|streams`). Fünf Reiter
  (`profile-tab-overview|badges|awards|references|teams`): Turniere und Fast Lap
  stecken im Referenzen-Reiter (`profile-reference-stats`, Filter
  `profile-reference-filter-<all|tournament|fastlap|season>`,
  `public-profile-references`, „Weitere Teilnahmen“ `public-profile-tournaments`
  nur für Turniere ohne Referenz, `public-profile-fastlaps`; Status als
  `StatusBadge`). Übersicht: `podiumHighlights` → `profile-highlights`/
  `profile-highlight-<id>`, `profile-awards-preview`, `profile-recent-awards`,
  `profile-references-preview`, `profile-overview-empty`; Seitenleiste
  `profile-sidebar`: `TwitchChannelCard` (`profile-twitch-offline`) oder links
  `TwitchLiveCard` (`public-profile-twitch-embed`, nur live), `AccountsCard`
  (`public-profile-accounts` mit `LinkedAccountsCard embedded` =
  `public-profile-linked`, `SocialsRow` = `public-profile-socials`,
  `GamingIdsList` = `public-profile-gaming-ids`), `AboutCard`
  (`public-profile-info`, ohne Name/Username/Rolle), `SetupCard`
  (`public-profile-setup`), `TeamsCard` (`public-profile-teams`). Test
  `PublicProfilePage.test.jsx` (4).
- News-Detail am PC breit (PR #472; nur Web; `update.sh`). `NewsDetailPage`
  neu: Raster `lg:grid-cols-[minmax(0,1fr)_20rem]`/`xl:…_24rem]` – Artikel
  (`news-article`) in Lesebreite mit großem Bild links, Seitenleiste rechts
  (`news-sidebar`: `news-meta` mit Autor, Datum, Kategorie und Lesezeit
  `readingMinutes`; Teilen `news-share-copy|whatsapp`; Verknüpftes
  `news-linked`; erwähnte Personen `news-mentions`; weitere News `news-more`
  / `news-more-<slug>` aus `/news?limit=6` ohne den eigenen Beitrag).
  `stripLeadingTitle(text, title)` nimmt eine erste Überschrift (`#` oder
  `<h1>`), die den Titel wiederholt, aus dem Text. Test
  `NewsDetailPage.test.jsx` (2).
- Menügruppe „Verbindungen“: je Dienst eine eigene Seite (PR #470; nur Web;
  `update.sh`). `lib/integrations.js`: `INTEGRATIONS` (key, label, app =
  Schlüssel aus `PLATFORM_APPS`, guides, tab, tabLabel; 15 Dienste),
  `integrationByKey`, `integrationApp`, `integrationForGuide`,
  `integrationStatus` (schlechtester Stand der Anleitungen).
  `AdminIntegrationPage` (`/admin/integrations/:key`, Bereich system;
  `integration-title` mit `StatusChip`, `integration-app` mit
  `PlatformAppCard` inkl. eigenem Speichern `platform-app-save-<key>`
  (nur die eigenen Felder, Secret nur wenn gesetzt) und `clear_<secret>`,
  `integration-guides` offen, `integration-tab-link`, `integration-prev|next`,
  `integration-missing`). `PlatformLinkSettings` exportiert `PlatformAppCard`
  (eigener Prüf-Zustand, optional `onSave`, `showGuide`) und `appReady`.
  `AdminLayout`: Gruppe „Verbindungen“ zwischen Content und System aus
  `INTEGRATIONS`, Suchbegriffe je Verbindung; Nav-Zähler 58. `AdminSetupPage`
  verlinkt je Anleitung „Eigene Seite“ (`setup-page-<guide>`). Tests
  `AdminIntegrationPage.test.jsx` (3), `AdminLayout.test.jsx` (Gruppe).
- Vorstand aus Dolibarr (#326 Teil 2; PR #468; Backend + Web; `update.sh`).
  Ein Schalter genügt: `legal_from_dolibarr`. `club_facts.board_positions(db,
  branding)` → None (Schalter aus oder kein Vorstand geliefert) oder Posten in
  der Form der Website (`id dolibarr-<code>-<n>`, `slug` über `board_slug`
  mit `BOARD_CORE` obmann|kassier|schriftfuehrer und `DEPUTY_MARKERS` →
  `<core>-stv`, `display_title`, `source "dolibarr"`, `represents`, `since`,
  `vacant`, `name_withheld`, `user`); Name nur mit Einwilligung (sonst
  `user None` + `name_withheld`), Foto/Profil nur über ein Konto mit derselben
  Funktion (`memberships.dolibarr.functions.code`, Status active|honorary)
  und Verzeichnis-Eintrag (`club_member_profiles` aktiv, nicht
  `directory_blocked`; Namensabgleich `_normalized_name`, sonst einziger
  Kandidat); `board_source` (dolibarr, switch_on, has_board, fetched_at,
  error, names_withheld, functions). `contact_board_routes`: `GET /api/board`
  liefert die Dolibarr-Posten, `?manual=true` die von Hand, `GET
  /api/board/source`. Web `ClubPages`: `boardPersonTarget` (Link nur mit
  Ziel), `BoardEmpty` („Name nicht freigegeben“ / „Unbesetzt“ / „Position
  offen“, `board-empty-<slug>`), `board-person-<slug>`, „seit Monat Jahr“,
  Quelle „laut Vereinsregister“; `AdminBoardPage` lädt `?manual=true` +
  `/board/source`, Kasten `board-dolibarr` (Regeln, Zeilen
  `board-dolibarr-<slug>`), `board-dolibarr-missing`. Dolibarr-Übersicht:
  Eintrag club_facts nennt den Vorstand mit. Test `test_club_facts_flow.py`
  (+1). Statuten folgen mit dolibarr-vereine#158.
- Konten verknüpfen II: Battle.net, X, YouTube, TikTok, Riot, Xbox, Epic
  (#260 II; PR #467; Backend + Web; `update.sh`). `services/platform_links.py`
  als Registrierung `PLATFORMS` (label, field, visibility, delivers,
  id_field, secret_field, official mit `{external_id}`/`{handle}`);
  `providers_configured`/`authorize_url`/`fetch_identity(platform, branding,
  query, state_payload)`/`official_url` folgen ihr. Neu: Battle.net (OAuth,
  `/userinfo` battletag), X (OAuth 2.0 mit PKCE: `_pkce_verifier` =
  HMAC(JWT-Secret, Nonce des state), `code_challenge` S256, `/2/users/me`),
  YouTube (Google-Code-Flow, Scope youtube.readonly, `/youtube/v3/channels?
  mine=true` → customUrl-Handle), TikTok (Login Kit v2, `client_key`),
  Riot (RSO, `/riot/account/v1/accounts/me` → Name#TAG), Xbox (Microsoft
  consumers → `user.auth.xboxlive.com` (`RpsTicket d=`) → XSTS → gtg), Epic
  (Account Services, `/userInfo` preferred_username). `read_state_payload`;
  Rückruf gibt die Nutzlast an `fetch_identity`. `check_provider` generisch:
  `CLIENT_CREDENTIALS` (discord|twitch|battlenet|x|tiktok|epic|xbox),
  `REDIRECT_HINTS`, Riot/YouTube nur Hinweis. Branding-Felder
  `<plattform>_client_id|_secret` (+ `clear_`), `BRANDING_SECRET_FIELDS` und
  `SETTING_AUDIT_SECRET_FIELDS` erweitert; `user_routes` filtert
  `verified_platforms` über `PLATFORMS[p]["visibility"]`. Web
  `lib/platformLinks.js`: `PLATFORM_BY_FIELD` (10), `PLATFORM_LABELS`,
  `NOT_LINKABLE` (psn, nintendo, ea, instagram - Hinweis am Feld
  `${testId}-not-linkable`), `PLATFORM_APPS` (idField, secretField, tab,
  optional, note, guideKey), `PLATFORM_APP_FIELDS`, `PLATFORM_SECRET_FIELDS`;
  `PlatformLinkSettings` je App Karte (`platform-app-<key>`,
  `platform-link-<key>-state`, `platform-check-<key>`); `AdminSettingsPage`
  `BRAND_SECRET_FIELDS` aus `PLATFORM_SECRET_FIELDS`, `savePlatformApps`
  über `PLATFORM_APP_FIELDS`; sieben Anleitungen (battlenet, x, youtube,
  tiktok, riot, xbox, epic) in `setupGuides.js`; `PublicProfilePage`
  Häkchen auch für youtube|tiktok|x|epic|xbox|riot|battlenet, `socialMeta`
  Farben, Xbox-Link. Tests `test_platform_links_flow.py` (+1, Fake je
  Plattform), `platformLinks.test.js`, `SocialsTab.test.jsx`.
- Mein Konto (PR #466; nur Web). `profile/constants.js`: `ACCOUNT_LINKS`
  (Rechnungen → `/profile?tab=invoices`, Meine Mitgliedschaft
  `/members/membership` nur Mitglieder, Strafen & Moderation `/my/penalties`,
  Gewinne `/my/prizes`, Benachrichtigungen, Hilfe & Kontakt `/contact`),
  `accountLinksFor(isClubMember)`; Block „Mein Konto“ im `UserMenu`
  (`nav-account-<key>`), im Handy-Menü (`PublicLayout`, `…-mobile`) und in
  `ProfileNav` (`profile-link-<key>`, Prop `isClubMember`). Tests
  `UserMenu.test.jsx`, `ProfileNav.test.jsx` (+1).
- Einrichtung im Admin: Anleitungen, Seite „Einrichtung“, Prüfung für
  Discord/Twitch/Steam (PR #465; Backend + Web; `update.sh`).
  `lib/setupGuides.js`: `SETUP_GUIDES` (je title, where, summary, steps
  [{text, link, copy mit `{origin}`}], notes, checkPlatform),
  `SETUP_GUIDE_ORDER`, `resolveGuideValue`, `guideStatus(key, data)`
  (ok|missing|optional|unknown aus branding/discord/auth/email/smtp/
  dolibarr/links). `components/tls/SetupGuide` (`setup-guide-<key>`,
  `setup-link-<key>-<i>`, `setup-value-…`, `setup-copy-…`,
  `setup-where-…`; `StatusChip` `setup-status`). `AdminSetupPage`
  (`/admin/setup`, Bereich system, Menü System → Einrichtung; lädt
  `/settings/branding|discord|auth|email|smtp`, `/admin/dolibarr/status`,
  `/me/platform-links`; `setup-summary`; fehlende Anleitungen offen).
  Anleitungen inline in `AdminSettingsPage` (auth: google_login; email:
  resend; smtp; discord: discord_webhooks + discord_bot; twitch; brand:
  play_store; seo: analytics + search_console). Prüfung
  `platform_links.check_provider` → {platform, ok, redirect_uri, checks
  [{key, state ok|fail|warn, text}]} (Discord client_credentials + mit
  Bot-Token `DISCORD_APP_ME` → App-ID = Client ID?, Rückrufadresse in
  `redirect_uris`?; Twitch client_credentials; Steam-Schlüssel); Route
  `POST /api/settings/platform-links/{platform}/check`
  (`require_club_admin`, Bot-Token aus `settings id discord`), Audit
  `platform_link.checked`. Profil: `socialProfileUrl` normalisiert
  gespeicherte ganze Adressen; `LinkedAccountsCard` eine Spalte, Steam mit
  Farbe, „Steam-Profil“ + ID ohne API-Schlüssel. Tests
  `test_platform_links_flow.py` (+1), `SetupGuide.test.jsx` (2),
  `AdminSetupPage.test.jsx` (1), `PlatformLinkSettings.test.jsx` (1),
  `socials.test.js` (+1).
- Verwarnungen mit Stufen (#416; PR #463; Backend + Web + App; `update.sh`,
  App-Build). `services/moderation_standing.py`: Einstellungen `settings id
  moderation_levels` (`levels` [{strikes, action notice|warning|suspension,
  chat_hours}], `strike_ttl_months`; `normalize_settings` → 400,
  `load_settings`, `save_settings`, `level_for`); Treffer `moderation_strikes`
  (`add_strike(db, user_id, source word_filter|report|manual|image_scan, kind,
  ref_id, item_id, report_id, moderator_id, note)` → `apply_levels`,
  `active_strikes` mit Verfall, `revoke_strike`); Sanktionen
  `moderation_sanctions` (`apply_levels`: neue nur, wenn höher als die
  laufende; `set_sanction` von Hand ersetzt; status active|superseded|lifted|
  expired, `chat_blocked_until` bei warning, `open_until_decision` bei
  suspension; `lift_sanction`; `active_sanction` markiert Abgelaufene);
  Chat-Sperre `chat_block`/`block_text`/`require_chat_allowed(db, me)` (403)
  in `message_routes.send_direct_message`, `team_routes.post_team_chat`,
  `tournament_chat_routes.post_tournament_chat`,
  `match_routes.post_match_chat`, `chat_attachment_routes.
  upload_chat_attachment`; Sichten `standing_for` (Person: ohne
  Moderator-IDs, `next_level`, `can_appeal`), `submit_appeal` (einmal,
  benachrichtigt den Bereich Moderation), `decide_appeal` (lift →
  `lift_sanction`), `person_history`, `people_overview`, `export_csv`
  (Semikolon, BOM). Benachrichtigung kind `moderation` + Mail je Stufe
  (Vorlagen `moderation_notice|warning|suspension|lifted` in
  `DEFAULT_EMAIL_TEMPLATES`); Audit `moderation.sanction|sanction_lifted|
  strike|strike_revoked|appeal|appeal_decided|levels|people_export|
  report_justified`. `moderation_routes`: `ReportStatus` + `justified`
  (`review_report` legt genau einmal einen Treffer an), `GET/PUT
  /api/moderation/levels`, `GET /people`, `GET /people/export.csv`, `GET
  /people/{user_id}`, `POST /people/{user_id}/strikes|sanctions`, `POST
  /sanctions/{id}/lift|appeal-decision`, `POST /strikes/{id}/revoke`, `GET
  /me/standing`, `POST /me/appeal` (5/Tag). `word_filter.review` nutzt
  `add_strike`. Web `ModerationStandingCard` (`moderation-standing`,
  `standing-active|clear|strikes|strike-list|appeal-form|appeal-message|
  appeal-send|appeal-state|more`; `compact` fürs Dashboard) auf
  `MyPenaltiesPage` (`/my/penalties`) und `DashboardPage`;
  `AdminModerationPage` Reiter Personen (`people-row-<username>`,
  `people-detail`, `people-active`, `people-appeal`, `appeal-lift|keep-<id>`,
  `people-strike-note|add`, `people-sanction-action|hours|reason|set`,
  `people-note`, `strike-revoke-<id>`, `sanction-lift-<id>`, `people-export`)
  und Stufen (`levels-row|strikes|action|hours|remove-<i>`, `levels-add`,
  `levels-ttl`, `levels-save`), `?tab=`, Meldungsstatus „Berechtigt (zählt
  als Treffer)“. App `ProfileScreen`: Karte „Moderation“ (nur lesen,
  `profile-moderation-web`). Tests `test_moderation_levels_flow.py` (2),
  `ModerationStandingCard.test.jsx` (2), `AdminModerationPage.test.jsx` (+2).
  Bewusst: Wettkampfstrafen (`penalty_routes`) unverändert; Stufe 3 hebt nur
  ein Mensch auf; nach außen nichts sichtbar.
- Verknüpfte Konten sichtbar, Grund der Plattform bei Rückruf-Fehlern (#260
  Nachtrag; PR #458; Backend + Web; `update.sh`). `services/platform_links`:
  `official_url(platform, external_id, handle)` (Discord `discord.com/users/
  <id>`, Twitch-Kanal, Steam-Profil), `links_for` liefert `url`,
  `linked_accounts(db, user_id, platforms)` fürs öffentliche Profil
  (`user_routes.get_public_profile` → `linked_accounts`, nur sichtbare
  Plattformen, nie `external_id`); `fetch_identity`: Plattform-Fehler außer
  `access_denied` → `LinkError("platform_error", "<error>: <description>")`,
  Netzfehler nur als Fehlerart; `callback_target(..., detail=)` hängt
  `link_detail` an (bereinigt, ≤ 160 Zeichen); die Rückruf-Route loggt jeden
  Fehlschlag. Web `lib/platformLinks` `linkErrorText(code, detail)`,
  `formatLinkedAt`; `ProfilePage` liest `link_detail`; `SocialsTab` „verknüpft
  als … seit …“ + `${testId}-official`; `PublicProfilePage.LinkedAccountsCard`
  (`public-profile-linked`, `linked-account-<platform>[-verified]`, Rahmen in
  Plattformfarbe über `--social-color`), verifizierte Socials-Symbole mit
  farbigem Rahmen; `PlatformLinkSettings` Schritte je Plattform
  (`platform-link-howto`). Tests `test_platform_links_flow.py` (erweitert),
  `PublicProfilePage.linked.test.jsx`, `SocialsTab.test.jsx`. App: #459.
- Dolibarr-Übersicht „was läuft, was fehlt, wo es steht“, Dashboard-Kachel
  „Konten verknüpfen“ (PR #461; Backend + Web; `update.sh`).
  `dolibarr_routes._features(db, settings)` → `GET /api/admin/dolibarr/status`
  liefert `features` (key members|club_facts|sponsors|applications|consents|
  invoices|webhook; label, enabled, state, hint, where, where_label);
  `AdminDolibarrPage` Reiter Stand: Panel `dolibarr-features`,
  `dolibarr-feature-<key>[-where]`. `AdminDashboardPage.settingsHub` „Konten
  verknüpfen“ aus `/me/platform-links.available`. Tests
  `test_dolibarr_flow.py` (Status erweitert), `AdminDolibarrPage.test.jsx` (+1).
- Profil-Sichtbarkeit je Betrachter (#257 Nachtrag; PR #462; Backend;
  `update.sh`). `user_routes._viewer_context(db, viewer, target_id)` → {self,
  logged_in, member, admin} (Mitglied über `membership_service.get_membership`
  / `is_active_member`, Admin-Team über `visibility.ADMIN_ROLES` oder
  `permissions.areas_for`); `_field_visible(user, key, public, ctx)`: public →
  alle, community → eingeloggt, members → Mitglied oder Admin-Team, admins →
  Admin-Team, private → nur selbst; alle Feldaufrufe in `get_public_profile`
  geben `ctx` mit (auch `verified_platforms` → `linked_accounts`). Vorher galt
  alles außer „public“ als versteckt - das Steam-Häkchen des Betreibers
  fehlte. Test `test_profile_visibility_levels_flow.py`.
- Rechtliches speichern, Wegweiser in der Admin-Suche, Dolibarr-Reiter
  verlinkbar (#326 Nachtrag, #260 Auffindbarkeit; PR #456; nur Web;
  `update.sh`). Ursache „Haken Vereinsdaten aus Dolibarr geht nicht“: live
  steht Analytics auf Google ohne Measurement-ID, und `saveBrand` prüfte das
  vor jedem Speichern der Markendaten (alle Reiter) – jetzt nur, wenn
  `analytics_provider`/`google_analytics_id` im Dirty-Payload stehen, mit
  Reiternamen in der Meldung. `AdminLayout`: `navGroupsFor(user, query)`
  (exportiert), Einträge mit `searchOnly: true` erscheinen nur bei Treffern
  – je Einstellungs-Reiter `/admin/settings?tab=auth|email|smtp|newsletter|
  queue|logs|brand|socials|seo|discord|twitch|system` und je Dolibarr-Reiter
  `/admin/dolibarr?tab=connection|preview|links|policy`;
  `ADMIN_SEARCH_TERMS` mit Umlauten schreiben (die Suche streicht Akzente
  auf beiden Seiten; `germanCopy.test` verbietet ae/ue-Wörter).
  `AdminDolibarrPage` liest `?tab=` (`useSearchParams`, Rückfall „Stand“).
  Reiter „Login & Google“ heißt „Login & Konten“ (dort liegt
  `PlatformLinkSettings` aus #260). Tests `AdminSettingsPage.test.jsx` (+2:
  Haken setzen + speichern; Google ohne ID blockiert Rechtliches nicht
  mehr), `AdminLayout.test.jsx` (+3).
- Referenzen als Erfolgswand (#409 Design; PR #457; nur Web). `ReferencesPage`
  neu: Hero mit Medaillenbilanz (`MedalStat` mit `useCountUp`,
  `references-stat-gold|silver|bronze|total|podiums|games|seasons`),
  Trophäenwand (`trophyItems`: Podest nach Medaille, dann neueste zuerst;
  `TrophyCard` mit `game.cover_url`, `PlacementBadge`, `AvatarStack`;
  `references-trophies`, `reference-trophy-*`), Bilanz je Spiel als Filter
  (`groupReferences` → `GameTile`, `references-game-all|<gameId>`),
  Zeitleiste nach Saison (`timelineGroups`: Saisons numerisch absteigend,
  ohne Saison unter „Weitere Turniere“; `references-timeline-<season>`),
  Chips Podest/Saison/Plattform (`references-filters`, `references-reset`),
  `ReferenceCard`/`EntryRow` in Medaillenfarben (`MEDAL` Ring/Text/Soft/Glow).
  Detail: Cover-Hero, `PlacementBadge xl`, `MetaList`
  (`reference-detail-meta`), Links als Seitenleiste. Alte Testkennungen
  bleiben. Test `ReferencesPage.test.jsx` (3; `useCountUp` gemockt).
- Wortfilter für Chats und Profile (#417; PR #453; Backend + Web + App;
  `update.sh`, App-Änderung mit dem nächsten Build). `services/word_filter.py`:
  `settings.word_filter` (`enabled`, `entries` [{id, term, action hold|flag,
  note}]), `normalize`/`compact` (Kleinschreibung, Umlaute → ae/oe/ue/ss,
  NFKD, Leetspeak `_LEET`), `find_matches` (≥ `COMPACT_MIN` 5 Zeichen auch am
  Stück ohne Trennzeichen, Mehrwort nur am Stück, kurze nur als ganzes Wort),
  `verdict_for`, `check_text`, `screen_message(db, doc, kind, context)` (setzt
  `doc.moderation.state` held|flagged, legt `moderation_items` an: kind,
  collection, ref_id, user_id, excerpt, matched, action, state pending|flagged,
  context), `screen_field` (hold → 400 + Item rejected, flag → Item flagged),
  `visible_to(message, viewer_id)` (held/rejected nur Autor),
  `public_moderation` (nur state nach außen), `review(db, item, decision
  release|reject|noted)` (schreibt moderation.state in die Chat-Collection;
  reject → `moderation_strikes` {user_id, source word_filter, kind, ref_id,
  item_id, moderator_id, note} als Grundlage für #416), `export_entries`/
  `import_entries`. `moderation_routes`: `GET/PUT /api/moderation/word-filter`,
  `POST/PATCH/DELETE …/word-filter/entries[/{id}]`, `GET …/word-filter/export`,
  `POST …/word-filter/import` ({entries, replace}), `GET /api/moderation/items?
  state=`, `PATCH /api/moderation/items/{id}` ({decision, note};
  `_after_message_decision`: release → publish_user_change + DM-Benachrichtigung,
  reject → Benachrichtigung kind `moderation` an den Absender); Audit
  `word_filter.*`, `moderation_item.*`. Prüfung in `message_routes`
  (`send_direct_message`; `list_conversations`/`get_direct_thread` filtern mit
  `visible_to`; `_public_message` → `public_moderation`), `team_routes`
  (`post_team_chat`, `list_team_chat`, `create_team`/`update_team` Name+Tag),
  `tournament_chat_routes`, `match_routes` (`post_match_chat`,
  `list_match_chat`), `user_routes.update_me` (bio, display_name),
  `auth_routes.register` (username). Web `AdminModerationPage` (Reiter
  `moderation-tab-reports|items|filter`; `ItemsTab` `moderation-item-*`,
  `item-release-*`/`item-reject-*`/`item-noted-*`; `WordFilterTab`
  `word-filter-enabled`, `word-filter-form`/`-term`/`-action`/`-note`/`-add`,
  `word-filter-entry-*`, `word-filter-export`/`-import`/`-import-replace`),
  `ModerationStateBadge` (`moderation-state`, `MODERATION_STATE_TEXT`) in
  `ConversationView`, `TeamsPage`, `TournamentDetailPage`, `MatchPage`. App:
  `ChatMessage.moderation`, `ChatThreadView` Blase `chat-moderation-{id}`.
  Tests `test_word_filter_flow.py` (3), `AdminModerationPage.test.jsx` (3),
  `ModerationStateBadge.test.jsx` (1), `ChatThreadView.test.tsx` (+1).
- Meine Einwilligungen aus Dolibarr (#329 Teil 1; PR #452; Backend + Web;
  `update.sh`). Manifest `used_paths` + `/vereine/members/{id}/consents`.
  Client `member_consents(member_id)`, `decide_consent(member_id, payload)`
  (`_send`, keine Wiederholung). `membership_routes`: `CONSENT_FORM_NAME`,
  `ConsentDecisionBody` (code, decision given|withdrawn, version),
  `_consent_context` (mode live + `verified_link` → sonst reason
  not_connected/not_linked/<kind>), `_consent_view` (+ `text` nur bei
  `can_give`, `text_changed`), `_consent_list` (Stand + Texte aus
  `consent_texts`), `GET /api/membership/me/consents` ({available, as_of,
  consents} bzw. {available False, reason}), `POST /api/membership/me/consents`
  (409 ohne Kontext, 400 ohne Fassung beim Zustimmen, Auftrag in
  `consent_decisions` mit `reference web-c-<id>` und status sent/recorded/
  duplicate/failed, Dolibarr 400 → 400 „Text geändert“, 409 → 409 „späterer
  Widerruf“, sonst 503 „nichts geändert“; Audit `consent.given|withdrawn` nur
  mit code/version/reference; Antwort mit frischer Liste). Fake:
  `member_consents`, `consent_references`, `_consent_rows`,
  `_consent_decision` (Fassung, reference einmal, Widerruf neuer als
  Zustimmung → 409). Web `MyMembershipPage.ConsentsCard` (nur
  `led_by_dolibarr`; testids `membership-consents-card`, `consent-{code}`,
  `consent-state-*`, `consent-changed-*`, `consent-open-*`, `consent-text-*`,
  `consent-give-*`, `consent-withdraw-*`; `CONSENT_STATE`). Tests
  `test_member_consents_flow.py` (2), `MyMembershipPage.test.jsx` (+1). Teil 2
  (Kontaktänderung, Austritt, Mandat) wartet auf dolibarr-vereine#164/#125.
- Beitrittsantrag über Dolibarr (#328; PR #450; Backend + Web; `update.sh`).
  Vertrag `tests/contracts/vereine-openapi.json` auf Modul 0.8.0-beta
  (`c6a5b28`), Manifest `used_paths` + applicationform/membershipfees/
  consents/applications(+state, withdraw). Client `application_form()`,
  `membership_fees()`, `consent_texts()`, `submit_application()` (`_send`,
  keine Wiederholung), `application_state()`, `withdraw_application()`.
  `services/dolibarr_applications.py`: `coupled(settings)` (mode live +
  `applications_enabled`), `external_id_for` (`web-<id>`), `form_bundle`
  (fees nur natural/both, `public_fee` mit `period_label`),
  `validate_submission` (dieselbe Liste wie Dolibarr, in Worten),
  `build_payload` (consents mit granted_at/form/reference, nie IP), `submit`
  (bad_request/conflict/forbidden → `failed`; sonst `submitting` mit
  `next_try_at` aus `RETRY_DELAYS`, `RETRY_MAX` 24), `refresh` (gedrosselt
  `CHECK_INTERVAL_SECONDS` 120; accepted → `verify_link(source=
  "application")` + `queue_member`; Mail `membership_approve`/`_reject` genau
  einmal, `notified_at`), `withdraw`, `refresh_due` (Job im
  `dolibarr_sync`-Wrapper, alle 10 min), `own_view`, `admin_view`
  (`member_url` = base_url + `/adherents/card.php?rowid=`). `phase_c_routes`:
  `ApplyBody` (Motivation optional, aber wenn gesetzt ≥ 20 Zeichen;
  `type_id`, Person, `fields`, `consents`; die freie Nachricht des
  Dolibarr-Wegs kommt als `notes`), `GET /membership/apply/form`, `POST
  /membership/apply` (coupled `_apply_via_dolibarr`: Konto frisch lesen
  `_account`, 422 mit Problemen, Doc erst lokal `status submitting`, dann
  senden; 502 bei `failed`), `POST /membership/apply/withdraw`, `GET
  /membership/apply/me` (submitting → senden, pending → nachlesen),
  Verwaltung: `admin_view`, `person` gestrichen, PATCH 409 bei `external_id`.
  `dolibarr_routes`: `applications_enabled` + `applications_coupled`. Fake:
  `application_form`, `membership_fees`, `consent_texts`, `applications`
  (POST mit Prüfung wie das Modul, duplicate, 409 bei anderem Inhalt),
  `decide(external_id, status, reason)`, `request_schema`, `_json_post`. Web
  `MembershipApplyPage` neu (`apply-fees`/`apply-fee-*`, `apply-<feld>`,
  `apply-field-*`, `apply-consent-*`, `apply-submitting`/`-pending`/
  `-approved`/`-rejected`/`-failed`/`-withdrawn`/`-unavailable`,
  `apply-withdraw`, `apply-renew`; Exporte `feeLine`, `formatMoney`,
  `splitDisplayName`; ohne Antwort von `/apply/form` bleibt der
  Website-Antrag), `AdminMembershipApplicationsPage` (Reiter withdrawn/
  submitting, `app-dolibarr-*`, Sheet-Hinweis), `AdminDolibarrPage`
  (`dolibarr-applications-enabled`). Tests
  `test_dolibarr_applications_flow.py` (3), `MembershipApplyPage.test.jsx`
  (4). Nicht drin: Unterschrift, juristische Personen, Antrags-PDF (#324/#325).
- Mitgliederverzeichnis per Opt-in (#410; PR #449; Backend + Web; `update.sh`).
  `membership_routes`: `GET/PUT /api/membership/me/directory`
  (`DirectoryEntryUpdate` listed/gamertag/bio/games/platforms; Konto wird
  frisch gelesen `_account_for_directory`; Eintrag = `club_member_profiles`
  mit `source: "member"`, `real_name` None, Slug aus Gamertag; 403 ohne
  aktive Mitgliedschaft oder bei `directory_blocked`; 400 ohne Eintrag ohne
  `listed: true`), `_own_directory_view` (eligible/listed/blocked/editorial/
  slug/entry), `GET /api/membership/count` (members aus `memberships`,
  listed aus aktiven Profilen), `ClubMemberProfileUpdate.directory_blocked`
  (setzt `is_active` False), `_public_profile` ohne `age`/`level` (das Alter
  stand als „Level“ öffentlich), mit `source`; `_admin_profile` mit `age`,
  `directory_blocked`. `membership_service.end_self_directory_entry(user_id,
  is_member)` aus `update_user_membership`, `dolibarr_sync.apply_summary` und
  `end_membership_of_gone_member`. Web: `MembersDirectoryPage`
  (`memberInitials`, Porträt-Rahmen `object-cover`, `member-card-initials-*`,
  `members-own-entry`), `MyMembershipPage.DirectoryCard`
  (`membership-directory-*`, `SwitchRow`), `CommunityPage`
  (`community-explainer`, Zähler aus `/membership/count`),
  `AdminClubMemberProfilesPage` (`club-member-self-*`, `club-member-blocked`),
  `MemberProfilePage` ohne Level-Zeile. Tests `test_member_directory_flow.py`
  (2), `MembersDirectoryPage.test.jsx` (3), `MyMembershipPage.test.jsx` (+2).
  Offen: Rolle aus Dolibarr = #326 Teil 2 (Vorschlag im Issue).
- „Über den Verein“ mit echten Daten (#406; PR #448; Backend + Web;
  `update.sh`). `home_routes`: `_club_numbers(db)` (+ `achievements` aus
  `user_achievements`; Startseite nutzt denselben Helfer), `_about_texts`
  (`settings.about_page` über `ABOUT_DEFAULTS`), `_about_organization`
  (Branding + Legal-Overlay; bei `legal_from_dolibarr` Gründung/Zweck/
  gemeinnützig aus `dolibarr_public.state.organization`, `source`
  dolibarr|manual), `_about_games` (Editionen zählen zum Hauptspiel;
  Turniere `PUBLIC_TOURNAMENT_QUERY`, Referenzen aktiv), `_about_offline_events`
  (`OFFLINE_EVENT_TYPES`, vergangen, öffentlich, mit Bild, 6). Routen
  `GET /api/home/about`, `GET/PUT /api/home/about/admin` (content;
  `AboutTexts`, Listen `_clean_lines`). Web `AboutPage` (Fakten
  `about-fact-*`, `about-numbers`/`about-number-*`, `about-games`/
  `about-game-*`, `about-board-*`, `about-offline-events`/`about-offline-event-*`,
  `about-offline-items`, `about-pillars`, `about-purpose`; Exporte
  `organizationFacts`, `gameLine`, `Paragraphs` mit `**fett**` und
  Leerzeilen), `AdminAboutPage` (`/admin/about`, Verein → „Über uns“,
  AdminFormPage mit Aside Vereinsdaten + „Was die Seite sonst zeigt“; Exporte
  `textsToForm`, `formToPayload`), Adminmenü-Suchwort mit Umlaut. Tests
  `test_about_page_flow.py` (2), `AboutPage.test.jsx` (3),
  `AdminAboutPage.test.jsx` (3), `AdminLayout.test.jsx` und
  `admin-navigation.spec.js` (42 Einträge) angepasst.
- Sponsoren und Partner aus Dolibarr als Schalter (#405; PR #447; Backend +
  Web; `update.sh`). `services/dolibarr_sponsors.py`: Einstellungen
  `settings.sponsor_source` (`from_dolibarr`, `sponsor_category`,
  `partner_category`), Stand `dolibarr_public/sponsors`; `plan()` aus
  Kategorien (Typ Kunde, Unterkategorien = Stufe `TIER_BY_LABEL` bzw. Art)
  und Geschäftspartnern (`company_from_row`: Laufzeit aus
  `options_sponsor_start/_end`, `closed` bei Status 0), `apply_sponsors` /
  `apply_partners` (Eintrag je `dolibarr_id`, Handeintrag gleichen Namens wird
  übernommen, Link nur füllen, Gone → `contract_end` heute bzw. `is_active`
  False + `dolibarr_gone_at`), `refresh` / `refresh_due` (im Job
  `dolibarr_public`), `locked_fields` (`SPONSOR_LOCKED_FIELDS` name/tier/
  Laufzeit/E-Mail/Telefon, `PARTNER_LOCKED_FIELDS` name/kind – `update_sponsor`
  / `update_partner` streichen sie), `admin_view`. Client `categories(kind)`,
  `thirdparties_in_category(id)` (Seiten, 404 = leer, None = forbidden →
  Fehler). Routen `GET/PATCH /api/admin/dolibarr/sponsors`,
  `POST …/refresh` (content/system; Einschalten liest sofort, 409 ohne
  Anbindung). `GET /sponsors/former` (abgelaufen mit Logo).
  `sponsor_utils.public_sponsor_view` streicht Kontakt/Notizen/Dolibarr/
  Laufzeit (`PRIVATE_SPONSOR_FIELDS`) und liefert `since_year`/`until_year` –
  `dedupe_public_sponsors` wendet es an (Sponsoren, Events, Partner).
  `daily_center.sponsors_expiring` (30 Tage). Fake: `add_category`,
  `categorize`, `GET /categories`, `GET /thirdparties?category=`. Web:
  `DolibarrSourceBlock` (+ `useDolibarrSource`, `dolibarrLocked`; Kategorien
  als Entwurf über dem Server-Stand, kein Effekt) auf
  `AdminSponsorsPage`/`AdminPartnersPage` (testids `dolibarr-source-*`),
  gesperrte Felder mit Hint, Chip `sponsor-dolibarr-{id}`;
  `GermanDateField` `disabled`/`hint`; `SponsorsPage` „Seit … dabei“
  (`sponsor-since-*`) und „Ehemalige Unterstützer“ (`sponsors-former`,
  `sponsor-former-*`); Dashboard-Aufgabe `sponsors-expiring` (content).
  Tests `test_dolibarr_sponsors_flow.py` (3), `test_sponsor_dedupe.py` (3),
  `AdminSponsorsPage.test.jsx` (3), `SponsorsPage.test.jsx` (2).
- Referenzen als Turnierteilnahme mit Einträgen (#409; PR #445; Backend +
  Web; `update.sh`). `models.ReferenceEntry` (`kind` team/solo, `team_name`,
  `member_profile_ids`, `lineup`, `lineup_members` eingefroren, `placement`,
  `placement_label`, `participant_count`, `team_count`); Referenz-Felder
  `platforms`, `format`, `league`, `season`, `entries`. `news_routes`:
  `_reference_entries` (alte Referenz ohne `entries` = ein Eintrag),
  `_derive_title_fields` (Plattform/Format/Liga/Saison/`display_title` aus
  `[PS] HC | Liga X | Cup`, nur solange die Felder leer sind),
  `_mirror_entries` (beste Platzierung, erstes Team, alle Spieler in die
  alten Felder – Startseite `club_numbers`, SEO, Sitemap und
  `membership_routes._attach_reference_stats` lesen weiter dort),
  `_freeze_reference_members` je Eintrag (auch für alte Clients mit einer
  Platzierung), `_reference_summary` zählt Podest/Gold je Eintrag (+
  `entries`, `seasons`), Helfer `formats`/`leagues`/`seasons`.
  Mitgliederprofil: `member_entry` (bester eigener Eintrag), Bilanz über alle
  eigenen Einträge. Web `AdminReferencesPage` (Seitenblatt: Turnier /
  Einträge mit `EntryEditor` + `MemberPicker single` / Rahmen / Texte;
  `referenceToForm` nimmt `display_title`; mindestens ein Eintrag),
  `ReferencesPage` (drei Zahlen `references-stat-*`, Filter
  Status/Spiel/Plattform/Saison `references-season-*`, `reference-card-*`,
  `reference-chips-*`, `reference-entry-*` mit Podest-Optik, Detail
  `reference-detail-entries`), `MemberProfilePage.MemberReferenceCard` zeigt
  `member_entry`. Tests `test_references_entries_flow.py` (4),
  `ReferencesPage.test.jsx` (2), `AdminReferencesPage.test.jsx` (3).
- Admin-Formulare und Seitenblatt (#434, #435; PRs #438, #440, #441, #442, #454
  – Medien-Detail als `AdminSheet` xl mit Aktionen in `footer`, `media-sheet*`;
  nur Web). Ein Rahmen für Anlegen und Bearbeiten:
  `components/tls/AdminForm.jsx` (`AdminFormPage` = Kopf mit Zurück-Link,
  `FormColumns` = Inhalt links und Seitenleiste 20–24 rem rechts ab 1280 px,
  darunter eine Spalte; `FormSection` auch `collapsible` oder `plain`;
  `FormGrid` 2/3/4 Spalten; `FormActions` = feststehende Speichern-Leiste,
  `onSubmitClick` für Seiten ohne eigenes `<form>`), `FormFields.jsx`
  (`TextField` mit `suggestions`/`maxLength`, `SelectField` nimmt
  `[wert, text]` und `{k, l}`, `CheckField` mit `hint`/`accent`,
  `TextAreaField`, `FieldLabel`, `INPUT_CLASS`), `AdminSheet.jsx`
  (Seitenblatt von rechts, `size` md/lg/xl = 36/44/56 rem, am Handy
  Vollbild, Esc und Klick daneben schließen, `footer` für eigene Knöpfe,
  ohne `onSubmit` ein `<div>`). Editor-Seiten: Turnier neu, Fast Lap neu,
  Turnier bearbeiten (Reiter „Bearbeiten“), Fast Lap bearbeiten
  (Einstellungen), Event `/admin/events/new|:id` (`AdminEventEditPage`),
  News `/admin/news/new|:id` (`AdminNewsEditPage`; alte `?edit=` leiten
  weiter; Daten aus derselben Liste wie die Übersicht). Seitenblätter:
  Sponsoren, Partner, Vorstand, Referenzen (#441); Spiele, Auszeichnungen,
  Jahreswertung, Sticker, Stationen-Zuweisen, Dokumente, Galerie (Album,
  Abschnitt, Video-Link), Vorteile, Mitgliedschaft, Mitgliederprofile,
  Bewerbung, Benutzer anlegen (#442). Jeder PR, der Lint-Verstöße
  entfernt, muss `yarn lint:prune` laufen lassen (`eslint-suppressions.json`,
  sonst „suppressions left“ = Fehler) – die Datei kollidiert zwischen
  parallelen PRs, deshalb stapeln. Tests `AdminForm.test.jsx` (4),
  `AdminSheet.test.jsx` (3), `AdminEventEditPage.test.jsx` (3),
  `AdminNewsEditPage.test.jsx` (3), `AdminF1EditPage.test.jsx` (2),
  `AdminPartnersPage.test.jsx` (2), `AdminGamesPage.test.jsx` (1); E2E
  `admin-tournament-new.spec.js` +1 (1920 px), `admin-forms.spec.js`
  (#436, PR #443: 1920/1024/390 px mit Screenshots).
- Startseite III (#431; PR #433; nur Web). `PublicLayout`: Streifen
  `footer-cta` ganz oben im Footer über den Sponsoren mit `footer-buttons`
  (Discord-Knopf, Play-Badge bzw. „bald bei Google Play“), Kontaktspalte
  ohne Knöpfe; `HomePage` ohne `AppStrip`, `BoardTeaser` als eigener
  Abschnitt unter „Aktuelle News“ (Bild `w-16/20`, Name in `font-heading`,
  bis `lg:grid-cols-4`), `hero-join` nur für Gäste; `UserMenu` Grundklasse
  ohne Textfarbe (Mitgliederbereich Gold mit Goldgrund, Admin Blau, Abmelden
  Rot – `text-white/80` hatte die Akzente überstimmt). Tests
  `HomePage.test.jsx` (DOM-Reihenfolge, +1), `UserMenu.test.jsx`
  (Farbklassen).
- Turnierbaum neu (#399; PR #430; nur Web). `components/tls/BracketTree.jsx`
  komplett neu: `connectorTargets(countFrom, countTo)`,
  `nextMatchFor(matches, mineId)`, `KnockoutTree` mit per ResizeObserver
  gemessenen SVG-Verbindungslinien (Spalten 272 px, kompakt 228 px),
  `RoundSteps` am Handy (Runde für Runde,
  `bracket-step-prev/next/label`), `NextMatchBanner` (`bracket-next-match`),
  leere Setzplätze „—“, `HeatNode`-Karten („Durchgang A · N Spieler · M
  kommen weiter“), eigene Knoten `data-mine` mit Goldring;
  `TournamentBracketPage` gibt `mineId` (`t.my_registration.id`) mit;
  TV-Ansicht behält ihr Raster. Tests `BracketTree.test.jsx` (10).
- Adminmenü umgruppiert (#408; PR #429; nur Web). `AdminLayout.ADMIN_GROUPS`
  (jetzt exportiert): Übersicht / Verein (Vereinsdaten →
  `/admin/settings?tab=legal`, Vorstand, Sponsoren, Partner, Referenzen,
  Kontakt-Inbox) / Mitglieder / Finanzen (Finanzübersicht, Dolibarr-Anbindung)
  / eSports / Content (+ Downloads & QR) / System. `ADMIN_SEARCH_TERMS` +3
  Wege. Rechte je Eintrag unverändert. Tests `AdminLayout.test.jsx` (3); E2E
  `admin-navigation.spec.js` zählt 41 Einträge in 7 Gruppen.
- Layout am PC (#426; PR #428; nur Web). Befund des Betreibers: jede Seite ein
  1280-px-Streifen auf dem Monitor. `tailwind.config.js`
  `theme.extend.maxWidth['7xl'] = '112rem'` (1792 px) – ein Hebel für alle 49
  `max-w-7xl`-Container; `2xl:grid-cols-4` (Events, News, Turniere, Teams,
  Mitglieder), `2xl:grid-cols-5` (Galerie, Spieler, Sponsoren Silber),
  `2xl:grid-cols-6` (Sponsoren Bronze); `AdminLayout` main `max-w-[1800px]`.
  E2E `layout-widths.spec.js` (nur Desktop-Projekt; 1366/1920/2560: Kopfzeile
  ≥ min(Breite − 80, 1792), kein horizontales Scrollen auf /, /events,
  /tournaments, /news; Screenshots als Anhang).
- Startseite II (#425; PR #427; Backend + Web). Rückmeldung des Betreibers:
  `club_numbers.participations` = `db.references.count_documents({})` statt
  `awards`; Branding `play_store_url` (Settings-Modell, `/settings/public`,
  Admin → Branding `brand-play-store-url`, leer bis der Eintrag öffentlich
  ist). Web `hooks/useCountUp.js` (`easeOutExpo`, `canAnimateNumbers`:
  matchMedia + rAF, nicht bei „Bewegung reduzieren“; IntersectionObserver
  startet beim Sichtbarwerden), `HomePage` `NumberTile` (Mitglieder /
  Veranstaltete Turniere / Veranstaltete Events / Turnierteilnahmen), Hero
  ohne Knöpfe (`hero-join` bleibt), `AppStrip` `home-play-badge` /
  `home-play-soon`; `lib/siteFooter.footerButtons(settings)` (Discord nur mit
  https-Link, Badge nur mit `play.google.com`-Link, `PLAY_BADGE_SRC`
  `/assets/brand/google-play-badge-de.png` = Googles offizielle Datei),
  `PublicLayout` `footer-buttons` (`footer-discord-button` Blurple mit
  `SOCIAL_ICONS.discord`, `footer-play-badge` / `footer-play-soon`). Tests
  `useCountUp.test.js` (2), `siteFooter.test.js` +1, `HomePage.test.jsx`,
  `test_home_numbers_flow.py` (participations).
- QR-Code mit Löwe (#400; PR #424; kein Build). Antwort des Betreibers: das
  bestehende Logo als PNG unter Branding → „QR-Logo“ (`qr_logo_url`, gab es
  schon; Uploader nimmt kein SVG), eine Komponente für alle Stellen,
  Druckversion. Web: neue Abhängigkeit `qrcode` (node-qrcode, liefert die
  Modulmatrix; `qrcode.react` bleibt für die Zwei-Faktor-Einrichtung).
  `lib/qrDesign.js` (`qrMatrix` Stufe H, `isFinderCell`, `qrModel({value,
  size, logoRatio ≤ MAX_LOGO_RATIO 0.24, quietZone, fgColor, bgColor, accent,
  withLogo})` → Module ohne Suchmuster und ohne Fläche unter der Platte,
  drei Suchmuster, Platte + Logo-Rechteck; `finderParts` (Rahmen/Ring/Kern in
  der Akzentfarbe), `qrSvgMarkup(model, {logoHref, title})` für die Datei,
  `qrFileName`), `components/tls/BrandedQRCode.jsx` (jetzt eigenes SVG:
  abgerundete Module, Suchmuster in `primary_color`, Platte mit Ruhezone,
  `<image>` `branded-qr-logo`; `qrLogoHref(branding)`; Props wie vorher +
  `accent`, `withLogo`; testid `branded-qr-code` bleibt), `lib/qrExport.js`
  (`inlineImage` → Daten-URL, `buildQrSvg` 1024 px, `downloadQrSvg`,
  `downloadQrPng` über Canvas im Browser), `AdminWidgetsPage` QrCard: Knöpfe
  PNG/SVG (`qr-png-{kind}-{id}`, `qr-svg-…`) neben dem PDF-Schild, feste
  Ziele „Website“ und „Kalender“ oben in der Liste. Tests `qrDesign.test.js`
  (3), `qrExport.test.js` (2), `BrandedQRCode.test.jsx` (2).
- App-Update je Installationsquelle (#421; PR #423; Build 77). Play
  signiert mit eigenem Schlüssel – die Server-APK lässt sich über eine
  Play-Installation nicht installieren. App: `expo-in-app-updates` (0.12,
  Play Core), `lib/installSource.ts` (`detectInstallSource()` → `source`
  play/sideload/unknown aus `checkForUpdate()`: Antwort = play, Fehler =
  sideload, kein Android/kein Modul = unknown; `startPlayUpdate(immediate)`;
  `require` statt `import()`, weil Jest dynamische Importe nicht lädt),
  `lib/appUpdate.ts` (`updatePath(source, info)`: play bleibt play, sonst
  server – außer `server_updater_enabled === false`; `PLAY_STORE_URL`
  market://, `PLAY_STORE_WEB_URL`), `AppUpdateBanner` `path="play"`
  (`app-update-play`: „Update starten“ → `onStartPlayUpdate(mandatory)`,
  Rückfall `openPlayStore()`; kein Download), `AppUpdateProvider`: Quelle
  einmal je Sitzung (nicht in `__DEV__`), Googles Dialog von selbst, wenn Play
  ein Update kennt (sofort bei Pflicht + `immediateAllowed`). Backend
  `app_releases.updater_settings/set_updater_settings` (`settings` id
  `app_releases`, `server_updater_enabled` Standard true),
  `/mobile/app-version` + `server_updater_enabled`, `play_store_url`;
  Admin `GET/PATCH /api/admin/app-releases/settings` (vor `{build}`),
  `AdminAppReleasesPage` Schalter `app-release-server-updater-toggle`. Tests
  `test_app_releases_flow.py` +1, `installSource.test.ts` (3),
  `appUpdate.test.ts` +1, `AppUpdateBanner.test.tsx` +1,
  `AdminAppReleasesPage.test.jsx` +1. Version 0.17.0-beta.
- Footer und Startseite (#403, #407; PR #422; kein Build). Antwort des
  Betreibers: „Mitglied werden“ nicht groß vermarkten, Community zuerst.
  Web `lib/siteFooter.js` (`footerColumns(settings, {isMember})` – Verein /
  eSports / Mitmachen, Discord nur mit `discord_invite_url`, Mitglieder sehen
  `/members/area` statt „Mitglied werden“; `contactLines(settings)` – Name,
  Adresse, E-Mail, `ZVR …`, `any`), `PublicLayout` Footer: Sponsoren-Streifen,
  `footer-columns`/`footer-column-{key}`, `footer-contact` (Logo, `<address>`,
  `footer-socials`, `footer-app`), Bottom-Bar ohne Versionsnummer.
  `HomePage`: Hero `hero-text`, `hero-cta-community` (`/community`),
  `hero-cta-tournaments`, `hero-cta-discord` (aus `getCachedBranding()`, kein
  Hook – `usePublicSiteSettings` würde im Test den `useApiInvalidation`-Fang
  überschreiben), `hero-join` (Mitglied: Link Mitgliederbereich),
  `ClubNumbers` `home-numbers`/`home-number-{key}` (nur Zähler > 0),
  `BoardTeaser` `home-board`/`home-board-{id}` (`/board?active_only=true` →
  `boardContacts`), `AppStrip` `home-app-strip` (kein Store-Knopf),
  `home-calendar-link`. Backend `home_routes.home_state` `club_numbers`
  (members active/honorary, tournaments nicht draft/cancelled + `is_public` ≠
  False, events nicht draft/cancelled + visibility public, tournament_awards).
  E2E `public.spec.js`: Locators auf `#main-content` eingeschränkt, weil der
  Footer jetzt „Turniere“ und die Kontaktadresse ebenfalls zeigt. Tests
  `test_home_numbers_flow.py` (1), `siteFooter.test.js` (2),
  `HomePage.test.jsx` +2 (zählt nur `/home/state`-Aufrufe).
- Melden und Blockieren in der App (#414; PR #418, baut auf #411 auf; Build
  76). Beim IARC-Fragebogen der Play Console (23.09.) aufgefallen: Google
  verlangt beides in der App. Nur App, dieselben Aufrufe wie das Web
  (`/api/moderation/reports`, `/api/moderation/blocks/{id}`).
  `lib/moderation.ts` (`REPORT_CATEGORIES`, `reportPayload` – im Gruppenchat
  Text in `details`, `message_id` nur bei Direktnachrichten, `sendReport`,
  `blockUser`, `unblockUser`, `listBlocked`, `senderOf`),
  `components/ReportSheet.tsx` (Modal, `report-category-{key}`,
  `report-details`, `report-submit`), `components/BlockedUsersCard.tsx`
  (`blocked-users`, `blocked-user-release-{id}`). `ChatThreadView` neu:
  `onReportMessage` (langer Druck auf fremde Bubbles, `chat-message-{id}`),
  `onData`, `refreshToken`. `DirectThreadScreen`: `headerRight`-Menü
  `direct-thread-menu` (melden / blockieren / aufheben, `blocked_by_me` aus der
  Thread-Antwort), `TeamChatScreen`/`TournamentChatScreen`: langer Druck →
  `ReportSheet`, `PublicProfileScreen`: Knopf `profile-more` (Stand aus
  `listBlocked`), `ProfileScreen`: `BlockedUsersCard` unter Privatsphäre. Tests
  `moderation.test.ts` (3), `ReportSheet.test.tsx` (3),
  `BlockedUsersCard.test.tsx` (2), `ChatThreadView.test.tsx` +1. Danach beim
  Betreiber: Inhaltseinstufung „Blockieren/Melden“ auf Ja.
- Kalender auf der Website (#402; PR #413, baut auf #411 auf; kein Build).
  `services/calendar_items.py` (NEU): `collect(db, user)` – Events, Turniere
  (`is_public` ≠ False; Anmeldeschluss als eigener Eintrag `marker:
  registration_close`, id `{id}-anmeldeschluss`) und Fast-Lap-Challenges ohne
  Entwürfe, je Eintrag `id/kind/slug/title/start/end/status/phase/location/
  path/visibility/mine`; Sichtbarkeit über `user_can_see`, `mine` aus
  `event_registrations` (registered/checked_in/waitlist) und
  `tournament_registrations` (`user_id`, nicht cancelled/rejected/withdrawn/
  no_show); `ics_feed(items, origin=)` (RFC-5545-Faltung bei 75 Byte, ohne
  Ende zwei Stunden, `STATUS:CANCELLED`, `X-WR-CALNAME`). Routen
  `routes/calendar_routes.py`: `GET /api/calendar` (`items`, `signed_in`,
  `feed_path`), `GET /api/calendar/feed.ics` (immer anonyme Sicht, `text/
  calendar`, Cache 10 min, Origin via `seo_render_routes.public_origin`).
  Sitemap `+/calendar`. Web: `lib/calendar.js` (Port von
  `mobile/src/lib/calendar.ts` + `upcomingItems`, `filterKinds`, `feedUrls`
  https/webcal, `KIND_COLORS` event #9F7AEA / tournament #FFD700 / fastlap
  #29B6E8), `pages/public/CalendarPage.jsx` (`/calendar`: Raster
  `calendar-grid`, `calendar-prev/next/title`, `calendar-day-{key}`,
  `calendar-dot-{key}-{kind}`, Art-Filter `calendar-kind-{kind}` (letzte
  bleibt), Tagesliste `calendar-day-items`/`calendar-day-empty`,
  `calendar-item-{kind}-{id}`, „Als Nächstes“ `calendar-upcoming`, Abo
  `calendar-subscribe` mit `calendar-feed-url`/`-copy`/`calendar-webcal`,
  Login-Hinweis `calendar-login-hint` nur ohne `signed_in`), Menü „Kalender“
  nach Events (`MainNav`), Events-Seite Knopf `events-tab-calendar`. Tests
  `test_calendar_flow.py` (4), `calendar.test.js` (4),
  `CalendarPage.test.jsx` (2). Startseite „Diesen Monat“ kommt mit #407.
- Events in der App: Kosten und Teilnehmer (#396, #397; PR #411; Build 76).
  Backend `event_routes._attach_event_registration_view`: `manages` = Staff-Rolle
  oder Bereich `tournaments`/`club` (Vorstand) – sieht alle Anmeldungen mit
  Status, Begleitpersonen, Notiz, E-Mail; Geld (`price`) nur Staff-Rolle oder
  Bereich `finance` (`_public_event_registration(…, with_price=)`); neue
  Felder `participant_view` (`staff`/`public`/`none`) und `can_check_in`
  (Bereich `tournaments` – dieselbe Bedingung wie `PATCH …/registrations/{id}`).
  `areas_for` einmal je Anfrage. App `lib/eventPrice.ts` (`eventOfferSummary`,
  `eventBasisLabel`, `ownEventPriceLine`, `companionChangeHint`; `quoteTotal`/
  `formatCents` aus `startFee.ts`), `types.ts` `EventRegistration`,
  `ClubEvent.offer/registrations/participant_view/can_check_in`,
  `EventDetailScreen`: Kostenblock `event-offer`, wählbare Positionen
  `event-offer-option-{key}`, Summe `event-quote`, Pflichthaken
  `event-accept-costs` (nur im Client – der Server prüft bei Events kein
  `accept_costs`, das Web auch nicht), `POST …/registrations` mit
  `selected_positions`, eigener Preis `event-own-price`, Teilnehmer-Karte
  `event-participants` (Staff: ausklappbar `event-participants-toggle`,
  `event-checkin-{id}` → `PATCH {status: checked_in}`; öffentlich: Namen wie im
  Web), Kennzeichen „Vereinsintern“/„Vorstand“ im Kopf. Tests
  `test_event_participants_flow.py` (2), `eventPrice.test.ts` (3),
  `EventDetailScreen.test.tsx` (3). Turniere: die App zeigt im Reiter „Spieler“
  bereits den Status aus `GET /tournaments/{id}/registrations` (Staff-Sicht
  vom Server) – kein Umbau nötig. Version 0.16.0-beta.
- Rechtliches II (#326 Teil 1; PR #398, baut auf #395 auf; kein Build).
  `services/club_facts.py` (NEU): `refresh(db, settings, client)` liest
  `client.organization()` + `client.board()` in `dolibarr_public` (`id:
  state`, `fetched_at`; Fehler nur als `error/error_text/error_at` daneben,
  Daten bleiben), `refresh_due` (Job `dolibarr_public` stündlich, Lease 300),
  `legal_overlay(org, board, fetched_at=)` (OVERLAY_FIELDS: legal_name,
  zvr_number, register_authority, street_address, postal_code, city, country,
  phone, representative_name/role – Obmann/Obfrau = Vorstandsfunktion mit
  `represents`, bevorzugt `REPRESENTATIVE_CODES`; `null`-Name → kein Overlay;
  `names_withheld` ab `NAME_MAX_AGE_HOURS` 48), `board_public`,
  `organization_public`, `public_legal_source(db, branding)` (leer ohne
  `legal_from_dolibarr`), `admin_view`. `public_site_settings.build_public_legal_settings(branding,
  overlay=)` – Overlay gewinnt, Leerwerte nie. `services/privacy_facts.py`
  (NEU): `facts_from(branding, auth, discord, email, dolibarr)` → analytics,
  google_login, passkeys, discord{webhooks,bot}, twitch_embed, email_provider
  (smtp/resend/none), dolibarr, dolibarr_billing, app{push,crash_reports,
  app_lock}, hosting – nie Geheimnisse. `/settings/public` liefert
  `legal_source` + `privacy_facts`; `BrandingSettings.legal_from_dolibarr`.
  Routen `GET/POST /api/admin/dolibarr/public[/refresh]` (club/system).
  Client `organization()`, `board()`; Fähigkeit `organization`; Fake
  `organization`/`board` (Vertrag), Manifest `used_paths` +2. Web:
  `lib/privacyFacts.js` (`normalizeFacts`, `privacySections`,
  `emailProviderText`, `analyticsText`, `hostingText`), `LegalPages`
  PrivacyPage-Abschnitte aus den Fakten (`privacy-*` testids), `Section` mit
  `id`; `AdminSettingsPage` Reiter Rechtliches: Block `legal-dolibarr`
  (Haken `legal-from-dolibarr`, Stand, `legal-dolibarr-refresh`), Felder aus
  Dolibarr `disabled` + Hint (`BrandField` kann `disabled`/`hint`). Tests
  `test_club_facts_flow.py` (5), `privacyFacts.test.js` (3),
  `LegalPages.test.jsx` (3). Statuten (#326 Rest) warten auf
  dolibarr-vereine#158.
- Play-Signaturschlüssel als zweite App-Herkunft (#219; PR #394, baut auf #392
  auf; kein Build). Google Play signiert die App seit dem ersten Upload am
  23.09. mit eigenem Schlüssel (Play App Signing, SHA-256 `1D:10:7A:DD…BA:26`,
  öffentlich). `frontend/public/.well-known/assetlinks.json` führt beide
  Fingerabdrücke; `passkey_routes.DEFAULT_APK_KEY_HASHES` ist jetzt
  kommagetrennt (Upload-Schlüssel seit Build 57 + Play-Schlüssel),
  `mobile_origins()` liefert beide `android:apk-key-hash:`-Herkünfte
  (`b2mi…` und `HRB6…`). `release-version.cjs` prüft weiterhin nur den
  Upload-Schlüssel (unsere APKs). Test `test_passkeys_mobile_unit.py`.
- Konto löschen in der App (#390; PR #391, baut auf #389 auf; Build 75).
  Google-Play-Pflicht (Registrierung in der App → Löschung in der App + öffentlicher
  Web-Link). App `ProfileScreen`: `deleteAccount` (zwei `Alert.alert`, dann
  `POST /dsgvo/anonymize-me` + `logout`), `ActionRow` „Konto löschen“ unter
  „Abmelden“ in der Einstellungen-Ansicht. Web `LegalPages`: `Section` mit
  `id`, Abschnitt „Konto löschen“ (`/privacy#account-deletion` – der Anker
  bleibt ASCII, weil der Umlaut-Test Transliterationen im Quelltext meldet) vor
  „Betroffenenrechte“ – der Link fürs Datensicherheits-Formular. Version
  0.15.0-beta, Build 75 = Bundle für den geschlossenen Test.
- Auszeichnungen im eigenen Reiter (#230 Nachtrag; PR #389, baut auf #388 auf;
  Build 74). Einwand des Betreibers: Referenzen (Turnier-Historie) ≠
  Auszeichnungen (Banner/Trophäen). Web `PublicProfilePage` Reiter
  `profile-tab-awards` mit Block `public-profile-awards` und Leerzustand
  (Referenzen-Reiter ohne Auszeichnungen); App `ProfileScreen` `TabKey` `awards`,
  Reiter „Auszeichnungen“ (medal-outline) zwischen Referenzen und Gewinnen,
  `profile-awards` dort. Version 0.14.1-beta, Build 74 – der erste Build auch
  als App-Bundle (`npm run release:local -- --aab`, `AAB:`/`AAB SHA-256:` im
  Log) für den internen Test in der Play Console.
- Auszeichnungen (#230; PR #386, baut auf #385 auf; Build 73).
  Entscheidungen des Betreibers vom 23.09. („passt“): Vergabe speichert
  Daten, Bilder entstehen beim Ansehen; Platz 1–3 mit hochgeladenem Bild je
  Turnier; Korrektur = erneut veröffentlichen. `services/awards.py`:
  `record_tournament_awards(db, tid)` (beim `results_published`-Hook in
  `tournament_lifecycle_routes`; je Anmeldung approved/checked_in ein
  Eintrag in `tournament_awards` mit `rank` aus Anmeldung
  (`final_position`/`rank`/`placement`) sonst `placements_for_structure`,
  sonst Tabellenstand; `matches` {played, won} aus
  `registration_match_summary`; `tournament`, `game`, `season` (aktive),
  `team`; Upsert je (tournament_id, registration_id), Kennung bleibt bei
  Korrektur, Abgemeldete fliegen raus), `rebuild_all_awards` (Nachtragen für
  alte Turniere), `needs_backfill`/`backfill_awards` (Scheduler-Job
  `awards_backfill` alle 5 min: einmalig, solange keine Auszeichnung da ist –
  kein Handgriff für den Betreiber), `awards_for_user` (eigene + Team-Turniere; `public_only`
  filtert draft/nicht öffentlich/Sichtbarkeit), `awards_for_team`,
  `feature_award_for_user` (nur eigene; `users.featured_award_id`),
  `award_view` (ohne Anmelde-/Nutzer-IDs; `image_url` aus
  `tournaments.award_images[str(rank)]` nur für Platz 1–3), reine Helfer
  `award_kind` (trophy/banner), `rank_label`, `record_line`,
  `clean_award_images` (nur Slots „1“–„3“). Routen
  `routes/award_routes.py`: `GET /api/me/awards`, `POST /api/me/awards/{id}/
  feature`, `DELETE /api/me/awards/feature`, `POST /api/admin/awards/rebuild`
  (Bereich tournaments). Öffentliches Profil liefert `awards` (nur
  öffentliche) und `featured_award`. Turnier-Modelle mit `award_images`
  (Update bereinigt über `clean_award_images`). Web
  `components/tls/AwardBanner.jsx` (aus Daten: Platz, Gold/Silber/Bronze,
  Turnier, Spiel, Tag, Teilnehmer, Saison, Bilanz; Bild dahinter; `awardDay`,
  `awardLines`, `awardTone`), `PublicProfilePage`: gewähltes Banner im Kopf
  (`profile-featured-award`), Abschnitt „Auszeichnungen“ im Reiter Referenzen
  (`public-profile-awards`, eigenes Profil: `award-feature-<id>`), Admin →
  Turnier → Darstellung: „Gewinnerbanner Platz 1–3“ (`tr-edit-award-<n>`).
  Teams: `GET /api/teams/{id}` mit `awards` (Außenstehende nur öffentliche
  Turniere, Mitglieder/Leitung alle) und `featured_award`;
  `POST /api/teams/{id}/awards/{award_id}/feature` und `DELETE
  …/awards/feature` (`_can_manage`); `feature_award_for_team`
  (`teams.featured_award_id`). `TeamsPage`: Teambanner im Kopf
  (`team-featured-award`), Abschnitt „Auszeichnungen“ (`team-awards`,
  Teamleitung: `team-award-feature-<id>`). App: `lib/awards.ts` (`Award`,
  `awardTone`, `awardDay`, `awardLines`, `sortAwards` – Trophäen zuerst),
  `components/AwardCard.tsx` (Bild dahinter, Aktion daneben, `featured`),
  `PublicProfileScreen` (gewähltes Banner über dem Kopf, „Auszeichnungen“ in
  der Übersicht, Tippen → Turnier), `ProfileScreen` Reiter Referenzen
  (`/me/awards`, „Als Profilbanner“ = `award-feature-<id>`). Tests
  `test_awards_flow.py` (5), `AwardBanner.test.jsx` (2), App
  `awards.test.ts` (3), `AwardCard.test.tsx` (2).
- Absturzberichte (#219 Teil 2; PR #385; Build 72). Entscheidung des
  Betreibers vom 23.09.: Firebase Crashlytics (Firebase war für Push schon
  drin). `@react-native-firebase/app` + `/crashlytics` 26.4.0 mit ihren
  Expo-Plugins in `app.json` (Google-Services- und Crashlytics-Gradle-Plugin;
  `google-services.json` legt das Release-Skript vor `prebuild` ab).
  `lib/crashReports.ts`: `installCrashReporting(isDev)` (Sammeln nur im
  Release, `__DEV__` aus), `recordError(error, source, context)` (vom Kontext
  nur die Schlüssel, nie Werte; Fehler in Crashlytics selbst bleiben stumm),
  `crashReportsEnabled`. Eingehängt in `logMobileError` (Fehlergrenze und
  abgefangene Fehler) – unabhängig vom Client-Log-Schalter; native und
  unbehandelte JS-Abstürze fängt Crashlytics selbst. Keine Nutzerkennung, keine
  Namen. Der Absatz für die Datenschutzerklärung steht als Vorschlag am Issue
  (Admin → Branding → Datenschutzerklärung). Jest-Mock in `jest.setup.js`,
  Tests `crashReports.test.ts` (3). Play-Bundle (`--aab`) und Store-Eintrag
  folgen, sobald das Play-Konto da ist (Texte und Datensicherheits-Formular
  als Vorschlag an #219).
- Passkey-Login in der App (#217 Stufe 2; PR #384; Build 71).
  Derselbe Passkey wie auf der Website; Android nennt als Herkunft nicht die
  Adresse, sondern den SHA-256 des Signaturschlüssels. Backend
  `passkey_routes.py`: `DEFAULT_APK_KEY_HASHES` (Upload-Schlüssel seit Build 57
  und seit #394 auch Googles Play-Signaturschlüssel),
  `mobile_origins()` (auch `PASSKEY_APK_KEY_HASHES`, kommagetrennt, mit oder
  ohne Doppelpunkte → `android:apk-key-hash:<base64url>`),
  `_verified_login_user` (gemeinsame Prüfung für Web und App),
  `POST /api/auth/passkeys/mobile/login/options` (Ticket statt Cookie, `kind:
  mobile-login`) und `…/mobile/login/verify` (`MobileCredentialResponse` mit
  `ticket`; erwartete Herkunft = App-Schlüssel; Antwort App-Sitzung über
  `_issue_mobile_session(mfa_verified=True)` – Gerätesperre zählt wie im Web
  als zweiter Faktor, #358); `status` liefert `app`. Website:
  `frontend/public/.well-known/assetlinks.json` (Paket `at.lionsquad.app`,
  Fingerabdruck des Upload-Schlüssels, `get_login_creds`) – kommt mit dem
  Web-Image, kein Handgriff; `scripts/check-web-update.py` prüft, dass nginx
  sie als JSON liefert. App: `react-native-passkey` 3.6.2 (Android Credential
  Manager, API 28+; darunter `isSupported` false und kein Knopf),
  `lib/passkeys.ts` (`signInWithPasskey`, `credentialPayload`,
  `passkeyError`), `AuthContext.loginWithPasskey`, LoginScreen „Mit Passkey
  anmelden“; `ios.associatedDomains` `webcredentials:lionsquad.at`
  vorbereitet. Registrieren geht weiter nur auf der Website (Profil →
  Sicherheit). Tests `test_passkeys_mobile_unit.py` (10), App
  `passkeys.test.ts` (3), `LoginScreen.test.tsx` (2).
- Eigene Rechnungen für alle (#320; PR #381, baut auf #380 auf; Build 70).
  `services/dolibarr_invoices.py`: `_access` (Einstellungen + Mitglieds-ID
  oder None), `_order_context(db, user_id)` (eigene `billing_orders` mit
  Beleg → Quelle event/tournament, `source_label` über
  `dolibarr_billing.booking_facts`/`source_label`, `booking` {name, date,
  seats, companions, team, players}, `registration_id`),
  `view_core_invoice(raw, settings, today)` (Kern-API-Form: statut/paye/
  remaintopay/total_ttc/type, Zeitstempel → Vereinstage, Entwurf → None, nie
  `can_pay`), `_with_context` (ohne Vorgang: `club`, „Mitgliedsbeitrag“ bei
  `is_fee`, sonst „Verein“), `_sources`, `_sorted`, `_pdf_payload`.
  `list_invoices`: Mitglied → Liste des Vereinsmoduls; dazu die Einzelbelege
  eigener Vorgänge über `client.invoice(id)` (gelöscht oder Entwurf → weg);
  ohne beides `connected: False`; Antwort neu mit `member` und `sources`.
  `invoice_pdf`: erst Vereinsmodul, sonst eigener Vorgang → `client.invoice`
  + `client.invoice_document(ref)` (`GET /documents?modulepart=facture&
  original_file=<ref>/<ref>.pdf`, Nummer bereinigt). `payment_target`: für
  Kern-Belege 409 „bitte überweisen“. **Nie den Geschäftspartner im Ganzen
  lesen** – eine Familie kann einen teilen. Fake: `/documents` im Kern-Teil.
  Web `lib/invoices.js`: `sourceFilters`, `STATE_FILTERS`, `filterInvoices`,
  `sourceLine` (nur mit Vorgang), `summaryText` ohne Zuordnung neu;
  `MyInvoicesPage`: Filterknöpfe (`invoices-source-<k>`, `invoices-state-<k>`,
  erst ab zwei Quellen bzw. zwei Belegen), Vorgangszeile
  (`invoice-source-<key>`), Rückweg „Mein Profil“ für Nicht-Mitglieder;
  MainNav „Meine Rechnungen“ für alle. App `lib/invoices.ts` (Filter,
  `sourceLine`, `emptyText`, `payHint`), `components/InvoiceList.tsx` (eine
  Zeile für Mitgliedschaft und Rechnungen), `screens/main/MyInvoicesScreen.tsx`
  (Mehr → Konto → „Meine Rechnungen“, SegmentedTabs Quelle/Stand, live über
  „account/invoices“/„membership“). **Entscheidung des Betreibers vom 23.09.:
  Rechnungen gehören zum Konto, der Mitgliederbereich bleibt Verein.** Web:
  Profil-Reiter „Rechnungen“ (`profile/InvoicesPanel.jsx`, `?tab=invoices`;
  `/account/invoices` zeigt dieselbe Tafel und führt zurück ins Profil),
  `MEMBER_AREA_LINKS` ohne „Rechnungen“, MainNav und „Meine Mitgliedschaft“
  verweisen auf den Reiter. App: „Meine Mitgliedschaft“ zeigt nur den Stand
  der Belege und den Knopf „Meine Rechnungen“ (`membership-invoices-link`),
  Profil-Kachel „Rechnungen“ → More/MyInvoices. Tests `test_invoices_sources_flow.py` (4),
  `invoices.test.js` (+1), `MyInvoicesPage.test.jsx` (+1), App
  `invoices.test.ts` (4), `MyInvoicesScreen.test.tsx` (3).
- App 1.0.0 Teil 1 (#217 Stufe 1, #219 Teil 1; PR #380, baut auf #379 auf; Build 69).
  **App-Sperre (#217):**
  `lib/appLock.ts`: `shouldRelock(hiddenAt, now)` (≥ 60 s im Hintergrund),
  `lockAvailability` über `getEnrolledLevelAsync` (NONE → nicht einschaltbar,
  SECRET → „Gerätesperre“, sonst `methodLabel` aus den Typen), `authenticate`
  (`authenticateAsync`, Gerätesperre als Rückfall erlaubt), Schalter in
  SecureStore `tls.mobile.appLock` – nichts davon geht zum Server.
  `lock/AppLockProvider.tsx` (`useAppLock`: `ready`, `enabled`, `locked`,
  `availability`, `setEnabled` verlangt beim Einschalten einmal den
  Fingerabdruck, `unlock`; AppState background/active mit einspeisbarer Uhr
  `now`; ohne Provider keine Sperre; eine gespeicherte Sperre ohne
  Gerätesperre gilt nicht). `screens/LockScreen.tsx` (fragt beim Erscheinen
  selbst, Knopf „Entsperren“, „Abmelden“ geht immer). `AppNavigator`:
  `signedIn && locked` → LockScreen statt Tabs (Gäste nie). Profil → Zahnrad →
  Karte „Sicherheit“ mit dem Schalter und dem Text, was das Gerät kann.
  `expo-local-authentication` ~57.0.3 (Plugin in app.json; neues natives Modul
  → neue APK). **Stufe 2** (Passkey-Login in der App) bleibt offen: braucht
  ein natives Credential-Manager-Modul, die App-Herkunft
  `android:apk-key-hash:` im Backend und `/.well-known/assetlinks.json` auf
  der Website – Server-Teil mit dem Betreiber. Tests `appLock.test.ts` (4),
  `AppLockProvider.test.tsx` (4). **Bilder in passender Breite (#219):**
  `components/MediaImage.tsx` misst sich per `onLayout` und lädt über
  `sizedUpload` die kleinste Fassung (400/800/1600), die die Fläche in
  Gerätepixeln füllt (`widthForLayout(layoutWidth, pixelRatio)`); `width`-Prop
  erzwingt eine Fassung; die erste Breite zählt (kein Neuladen beim
  Umbrechen); fremde Adressen und solche mit `w=` bleiben (`sizedUpload`
  hängt keine zweite Breite an). Gilt damit für alle Karten, Kacheln, Avatare
  und Kopfbilder ohne Änderung an den Aufrufern. **Release-Skript `--aab`
  (#219):** baut zusätzlich `bundleRelease`, legt `LionsAPP-v…-build…-sha.aab`
  + `.sha256` in `mobile/builds` ab und hängt beide ans GitHub-Release
  (`release.aabName`); die Play Console bekommt das Bundle von Hand. Tests
  `MediaImage.test.tsx` (4), `gallery.test.ts` (+1), `release-version.test.mjs`
  (+1).
- Marke (#229; PR #379, baut auf #378 auf; Build 68). **Standard-Favicon für
  hell und dunkel:** Browser ohne `prefers-color-scheme` und der Home-
  Bildschirm nehmen nur `favicon_url`; beim Verein war das die weiße
  Fassung. `services/brand_favicon.py`: `pick_source` (favicon_dark →
  mascot → logo_dark → eingebautes Maskottchen), `dark_only_default` (der
  Hinweis im Admin), `asset_path` (nur `/assets/brand/` und Upload-Ordner,
  kein Pfad-Ausbruch), `compose`/`universal_favicon_png` (weißes Logo auf
  Kreis in `primary_color`, 512², vierfach gezeichnet), `store_png`. Route
  `POST /api/settings/branding/favicon/universal` (Club-Admin): legt die
  Datei wie einen Upload ab (`media_uploads`, Scope `branding`, Varianten),
  setzt `favicon_url`, Audit. Admin: Kasten unter den Favicons mit Hinweis
  (`brand-favicon-dark-only`) und Knopf `brand-favicon-generate`. **App liest
  die Markenbilder:** `lib/branding.ts` (`brandingFromSettings`: dunkle
  Fassung zuerst wie `Logo.jsx`, `DEFAULT_BRANDING`),
  `branding/BrandingProvider.tsx` (`/settings/public` beim Start, live über
  „settings/branding“; ohne Provider oder ohne Netz die eingebauten Werte),
  `components/BrandLogo.tsx` (Bild des Vereins, bei Fehler das eingebaute).
  Login zeigt `BrandLogo`, Kopfzeilen von Start, News und „Mehr“ den
  `clubName`. Boot-Screen bleibt eingebaut (vor dem ersten Laden). Tests
  `test_brand_favicon_unit.py` (4), `test_brand_favicon_flow.py` (3),
  Admin-Settings-Test (+1), App `branding.test.ts`, `BrandLogo.test.tsx`,
  `BrandingProvider.test.tsx` (7).
- Discord-Bot (#302, Discord II Teil 2; PR #378). Läuft
  **im Backend** als Task (Entscheidung des Betreibers vom 22.09.: Token im
  Admin, kein Container, nichts in der `.env`). `services/discord_bot.py`:
  reine Logik (`bot_settings` mit Vorgaben Mitglied/Vorstand/Turnierleitung,
  `desired_roles(areas, is_member)`, `role_diff` nur über `ROLE_KEYS`,
  `counted_user` (kein Bot, nur verknüpft), `next_event_text`,
  `open_tournaments_text`, `achievements_text`, `status_text`), Daten
  (`linked_discord_ids` aus `platform_links`, `count_message` =
  `discord_messages_count` +1, Tageszähler `discord_activity` (nie Inhalt) und
  `request_evaluation` für „Discord-Aktiv“, `wanted_roles_by_user` über
  `areas_for` + `is_active_member`, Stand in `settings.discord_bot_state`),
  `BotRunner` (`bot`): `start_if_enabled` (Fingerabdruck aus Token/Server/
  Schalter, sonst kein Neustart), `stop`, `apply_settings`, `status`, `_run`
  (discord.py, Intents members an, message_content aus; Slash-Befehle
  `/naechstes-event`, `/turniere`, `/meine-erfolge` ephemeral,
  `/status` nur Bereich club/system), `sync_roles` (idempotent, nur die drei
  Rollen, `missing_roles` in den Stand). Einstellungen in `settings.discord`:
  `bot_token` (verschlüsselt, ≥ 40 Zeichen, nie in GET; `clear_bot_token`
  nur System), `bot_enabled`, `bot_guild_id` (Ziffern), `bot_roles`
  (Teilmenge member/board/tournament), `bot_count_messages`; GET liefert
  `bot` = Einstellungen + Stand + Laufzeit; jede `bot_*`-Änderung ruft
  `bot.apply_settings()`. Routen `routes/discord_bot_routes.py`
  (`GET /api/settings/discord/bot/status` club/system, `POST …/sync`,
  `POST …/restart` System). Lifespan startet den Bot mit dem Scheduler; Job
  `discord_bot_roles` alle 10 min (nur wenn verbunden). Admin
  `settings/DiscordBotPanel.jsx` (Anleitung solange kein Token, Speichern
  schickt nur Getipptes, „Bot verbinden“ eigener Schalter, „Rollen jetzt
  abgleichen“ nur online, Stand-Kasten). Abhängigkeiten `discord.py==2.7.1`,
  `aiohttp==3.14.3`. Tests `test_discord_bot_unit.py` (4),
  `test_discord_bot_settings_flow.py` (3), `DiscordBotPanel.test.jsx` (2).
- Plattform-Konten verknüpfen (#260, Discord II Teil 1; PR #376).
  `services/platform_links.py`: `PLATFORMS` (discord → `discord_name` +
  `discord_id`, twitch → `twitch_handle`, steam → `steam_id`; `delivers` =
  Datenschutztext), `providers_configured(branding)` (Discord/Twitch brauchen
  Client-ID + Secret aus den Branding-Einstellungen, Steam nichts),
  `make_state`/`read_state` (JWT mit `type: platform_link`, 10 min, über
  `auth.get_jwt_secret`), `redirect_uri` = `<PUBLIC_BACKEND_URL|FRONTEND_URL>
  /api/platform-links/<p>/callback`, `authorize_url` (Discord `identify`,
  Twitch leerer Scope + `force_verify`, Steam OpenID `checkid_setup` mit
  state in `return_to`), `fetch_identity` (Token-Tausch + `users/@me` bzw.
  Helix `users`; Steam `check_authentication` gegen Steam + optional
  `GetPlayerSummaries` mit `steam_api_key`), `link_account` (ein Konto → ein
  Nutzer, sonst `taken`; setzt Feld + `platform_verified.<p>`), `unlink`
  (Häkchen weg, Text bleibt), `changed_verified_platforms` (Handänderung
  nimmt das Häkchen – `update_me` vergleicht mit dem gespeicherten Stand),
  `verified_platforms`, `callback_target` (`/profile?tab=socials&linked=`
  bzw. `&link_error=denied|taken|exchange_failed|invalid|not_configured`);
  `_transport` für Tests. Routen `routes/platform_link_routes.py`: `GET
  /api/me/platform-links` (links, available, platforms), `POST
  /api/me/platform-links/{p}/start` (409 ohne App, 503 ohne öffentliche
  Adresse), `GET /api/platform-links/{p}/callback` (immer Redirect),
  `DELETE /api/me/platform-links/{p}`; Audit `platform_link.linked/unlinked`.
  Öffentliches Profil `verified_platforms` (nur sichtbare Felder); DSGVO
  Export `platform_links`, Anonymisieren löscht sie und `platform_verified`.
  Branding-Einstellungen: `discord_client_id/secret`, `steam_api_key`
  (`BRANDING_SECRET_FIELDS`: maskiert, leer = behalten, `clear_<feld>`).
  Web: `lib/platformLinks.js`, `SocialsTab` (Verknüpfen/Trennen, gesperrtes
  Feld mit „verifiziert“, Hinweis mit `delivers`), `ProfilePage` lädt
  `/me/platform-links` im Reiter Socials und meldet `?linked`/`?link_error`
  einmal; `PublicProfilePage` Häkchen an Discord/Twitch/Steam;
  `pages/admin/settings/PlatformLinkSettings.jsx` im Reiter Anmeldung
  (Discord-App, Steam-Schlüssel, Rückrufadressen zum Kopieren);
  Datenschutzseite Absatz. Tests `test_platform_links_flow.py` (5),
  `SocialsTab.test.jsx` (2), `platformLinks.test.js`.
- App 0.8.0-beta (#216 Kalender, #236 Galerie; Build 66; PR #374). **#216**
  `mobile/src/lib/calendar.ts` (reine Rechnung: `monthMatrix` ab Montag,
  `itemsByDay` – mehrtägig an jedem Tag, Kappung 31 Tage –, `initialMonth`
  = nächster Termin, `icsFor`, `googleCalendarUrl`, ohne Ende zwei Stunden),
  `components/MonthCalendar.tsx` (Punkte je Art: Event cyan, Turnier gold,
  Fast Lap rot; goldener Rahmen = eigene Anmeldung; `calendar-day-<key>`),
  `TournamentsScreen` Umschalter Liste/Kalender (dieselben Termine, Filter
  gelten mit; Vergangenes = Vormonat), `lib/deviceCalendar.ts` +
  `components/AddToCalendarButton.tsx` (expo-calendar: Berechtigung erst
  beim Antippen, Standardkalender oder erster beschreibbarer; sonst Google
  Kalender per Link) an Event, Turnier, Fast Lap. Web:
  `lib/calendarLinks.js` (gleiche Rechnung), `components/tls/AddToCalendar.jsx`
  (.ics per Blob-Download + Google-Link) auf Event- und Turnierseite.
  **#236** `lib/gallery.ts` (`mediaType`, `mediaUrl`, `posterUrl`,
  `sizedUpload` nur für eigene Uploads 400/800/1600, `groupBySection`),
  `GalleryScreen` (`GET /gallery?compact=true`), `GalleryAlbumScreen`
  (Raster 3 je Zeile, Abschnitte, Index in Albumreihenfolge),
  `GalleryViewerScreen` (FlatList mit Paging, Bilder 1600 px in ScrollView mit
  `maximumZoomScale`, Videos `expo-video`, Einbettungen draußen, Teilen =
  Download in den Cache + `expo-sharing`); Einträge „Galerie“ unter Mehr →
  Verein und als Kachel im Mitgliederbereich. Neue native Module
  `expo-calendar` (Plugin mit Berechtigungstext) und `expo-sharing` →
  neue APK; Jest-Mocks in `jest.setup.js`. Tests `calendar.test.ts` (4),
  `gallery.test.ts` (3), `GalleryScreen.test.tsx` (2), Web
  `calendarLinks.test.js` (2).
- Rechnungskonditionen und lesbare Belege (#370; PR #372; Nachtrag #373:
  deutsche Texte für die Wörterbuch-Codes (`PAYMENT_TERM_LABELS`,
  `PAYMENT_MODE_LABELS` in `dolibarr_routes`), `accounts_reason`, Anleitung
  im Panel, wenn die Kontenliste fehlt). `dolibarr_billing`:
  `TERM_FIELDS` (`invoice_payment_term_id`, `invoice_payment_mode_id`,
  `invoice_bank_account_id` in den Dolibarr-Einstellungen), `invoice_terms(settings)`
  → `cond_reglement_id`/`mode_reglement_id`/`fk_account` am Beleg,
  `terms_complete` (alle drei; sonst **kein** `validate`, auch mit
  `invoice_auto_validate`), `booking_facts(db, order)` (Event/Turnier mit Name,
  Wiener Datum, Person, Begleitpersonen, Team, Spieler), `line_context`
  („Weihnachtsfeier am 12.12.2026 – 2 Personen (Paula + 1 Begleitperson)“ /
  „Herbst-Cup am … – Team [TLS] Lions, 5 Spieler“), `invoice_lines(snapshot,
  settings, facts, extra_text)` (Kontext als zweite Zeile, Zusatz unter der
  ersten Position, `MAX_DESC` 1000), `invoice_text_preview`, `source_label`;
  `note_public` = „Anmeldung: <Quelle> – <Person>“ + Zusatz. Client:
  `payment_terms()`, `payment_types()`, `bank_accounts()` (None bei 403 →
  Nummer tippen). Routen: `GET /api/admin/dolibarr/invoice-options` (Listen +
  `suggested` 30D/VIR/einziges Konto), Settings-PUT nimmt die drei Nummern
  (0 löscht) und lehnt `invoice_auto_validate` ohne vollständige Konditionen
  mit 400 ab; Status liefert `invoice_terms{…, complete}`; Finanzübersicht
  liefert je offenem Auftrag `invoice_text` + `extra_text` und
  `dolibarr.terms_complete`; `PUT /api/admin/finance/orders/{id}/text`
  (`invoice_extra_text`, 409 sobald ein Beleg existiert). Web:
  `components/tls/InvoiceTermsPanel.jsx` (Select aus Liste oder Nummernfeld,
  „Vorschlag übernehmen“), Freigeben-Haken gesperrt bis vollständig;
  `AdminFinancePage` „Rechnungstext“ je Auftrag mit Zusatz, Hinweis bei
  fehlenden Konditionen. Fake: Wörterbücher, `/bankaccounts`
  (`bank_readable`), Konditionen am Beleg. Tests
  `test_billing_invoice_terms_flow.py` (6), `AdminFinancePage.test.jsx`,
  Dolibarr-Seite +1.
- Abrechnung II (#319 Startgelder für Turniere; schließt Epic #314; PR #371).
  `services/tournament_fees.py`: `BILLABLE_STATUSES` (approved, checked_in),
  `billing_updates(raw, existing, me)` (403 ohne Bereich Finanzen, dazu
  `count_substitutes`, `included_in_event`), `roster_size(reg, tournament,
  offer)` (Solo 1; Team = Roster/Lineup ohne Ersatzspieler außer
  `count_substitutes`, ohne Roster die `team_size` – **nie** die
  Mitgliederzahl des Community-Teams), `charges(tournament, offer)` (bezahlt
  und nicht `included_in_event` mit `event_id`), `freeze_price(db, reg,
  tournament, payer=)` (nur in `BILLABLE_STATUSES`, einmal; Snapshot +
  `billing_orders.create_order(kind="tournament")`, Quelle mit `team_id`,
  `display_name`), `close_price(db, reg, reason)` (Aufträge stornieren,
  `billing_status: cancelled`), `public_price(reg)` (ohne Dolibarr-Nummern,
  mit `payer_user_id`). Modelle: `BillingConfig.count_substitutes/
  included_in_event`, `RegistrationCreate.accept_costs/selected_positions`,
  `TournamentCreate/Update.billing`. Routen: Anlegen/Ändern über
  `billing_updates`, Liste/Detail/Anlegen/Ändern `_expose_offer(t, finance)`
  (`offer` öffentlich, `billing` nur Finanzen); Anmeldung 400 ohne
  `accept_costs` bei Kosten, Snapshot nach approved/checked_in, Admin-PUT
  approved → `freeze_price` (Zahler = Anmelder), rejected/no_show →
  `close_price`, DELETE → `close_price` vor dem Löschen;
  `_public_registration` gibt `price` nur der eigenen Anmeldung.
  `dolibarr_billing._mark_invoiced` je Art (`event_registrations` /
  `tournament_registrations`), Rechnungstext „Startgeld <Titel> – <Team>“;
  Finanzübersicht Quelle `{"name": "Startgeld <Titel>", "kind": "tournament"}`.
  Web: `lib/pricing.js` `TOURNAMENT_PRICE_BASES`, `startFeeSummary`,
  `tournamentBillingToForm`, `formToBilling` schickt die Turnier-Schalter nur
  mit, wenn das Formular sie führt; `EventBillingSection kind="tournament"
  hasEvent` (Titel „Startgeld“, Vorschau Team mit fünf, zwei Schalter);
  `AdminTournamentEditPage` Abschnitt nur mit `can("finance")`, `billing`
  im PATCH nur bei Änderung; `TournamentDetailPage` Kasten „Startgeld“,
  Modal immer bei `offer` (Summe, wählbare Positionen, Pflichthaken
  `accept_costs`), „Dein Startgeld“ nur an der eigenen Anmeldung. Tests
  `test_tournament_fees_flow.py` (5), `TournamentDetailPage.test.jsx`,
  Erweiterungen in `pricing.test.js`, `EventBillingSection.test.jsx`,
  `AdminTournamentEditPage.test.jsx`.
- Admin und Turniere (#203, #204, #227, #228, #235; PR #369).
  **#235** `services/matchday_schedule.py`: `schedule_writes(tournament,
  matches, proposals)` (reine Rechnung: was je Partie zu schreiben ist –
  `scheduled_at`, `schedule_source` accepted/home/default,
  `schedule_written_at`, Status pending/ready → scheduled; nie bei
  `schedule_source == "manual"` oder `FROZEN_MATCH_STATUSES`),
  `persist_matchday_schedule(db, tournament)`,
  `persist_all_matchday_schedules(db)` (Job `matchday_schedule` alle 15 min,
  nur Liga/Round Robin/Gruppen, laufende Status). `match_routes`: Annahme
  schreibt `schedule_source: accepted`; Ablehnung ruft
  `_rewrite_matchday_schedule`; Admin-`PUT /matches/{id}` mit `scheduled_at`
  setzt `schedule_source: manual` (leer → Regel gilt wieder). Erinnerungen,
  Stationen, TV lesen `scheduled_at` – kennen jetzt den geltenden Termin.
  Web `TournamentSchedulePage` zeigt die Quelle auch aus der Partie („von der
  Turnierleitung“). **#203/#204** `services/event_locations.py`:
  `normalize_locations` (Name oder Adresse Pflicht, ≤12, Schlüssel eindeutig),
  `event_locations(event)` (Liste; ohne `locations` genau einer aus den alten
  Feldern – **keine Migration**), `mirror_primary` (erster Standort → alte
  Felder, damit Listen/App weiterlesen), `map_query` (**nur Adresse**, Name
  als Rückfall), `with_map`. Modell `EventLocation`, `EventCreate/Update
  .locations`; Detailsicht `event.locations` (+`address_line`, `map_query`)
  und `event.map_query`; SEO `_event_places` (Liste bei mehreren). Web:
  `components/tls/EventLocationsSection.jsx` (hinzufügen/sortieren/entfernen,
  `locationsToForm`/`formToLocations`/`locationsFormError`), Admin-Formular
  blendet die Ortsfelder bei ≥1 Standort aus, „Ort“ heißt „Veranstaltungsort
  (Name, optional)“; `EventDetailPage` zeigt bei >1 Standort Karten je
  Standort mit eigener Karte, sonst wie bisher; Karte aus `map_query`. App
  `EventDetailScreen` Karte „Standorte“ (Typ `EventLocation`). **#227**
  `services/daily_center.py`: `task_counts` (reported_results =
  `waiting_result` beider Match-Sammlungen, moderation_reports `user_reports`
  open, contact_messages new, schedule_deadlines proposed ≤24 h),
  `today_items` (Matches/Check-ins (`check_in_from`)/Events des **Wiener**
  Tags, `club_day_window`); Dashboard liefert `daily_tasks` + `today`, die
  Startseite zeigt vier neue Aufgaben-Karten und die Liste „Termine heute“.
  **#228** `lib/tournamentGuide.js` (`GUIDE_STEPS` mit `fields`,
  `GUIDE_GAME_TYPES` mit `format`, `GUIDE_FORMATS`) + `AdminTournamentGuidePage`
  (`/admin/tournament-guide`, Bereich tournaments, Adminmenü-Eintrag 40);
  Schritt 2 „Voreinstellung übernehmen“ (#368, PR #375): `GUIDE_GAME_TYPES[].preset`
  (Format, `team_mode`/`team_size`, `best_of` + Spielregel-Werte wie
  `RULE_PRESETS` online/vor Ort), `PRESET_FIELDS` (nur diese sieben Felder),
  `presetFor(key)`, `presetLink(key)` → `/admin/tournaments/new?preset=<key>`;
  Leitfaden-Spalte „Anlegen“ (`guide-preset-<key>`), `AdminTournamentNewPage`
  liest `?preset=`, mischt die Werte in den Startzustand und zeigt den Hinweis
  `new-tr-preset-hint`; unbekannter Schlüssel ändert nichts. Tests: Leitfaden
  (+1: jede Turnierform hat den Knopf, setzt nur bekannte Felder, Spielregel =
  RulePresetPicker), `AdminTournamentNewPage.test.jsx` (3, neu).
- Abrechnung I, Teil 1 (#315, #318, Grundlagen für #316/#317/#322; PR #363).
  `services/pricing.py`: Cent-Beträge (`cents_from_amount`, nie float),
  `normalize_offer` (typisierte Positionen: `basis` per_registration/
  per_person/per_team, `tax_profile` none/standard/reduced, EUR, optional,
  `dolibarr_product_id`; Fehler als `PricingError` mit Menschentext),
  `bump_version` (Version steigt nur bei Preisrelevantem), `quote(offer,
  seats=, selected=)`, `snapshot(quote, recipient=, source=)` mit SHA-256,
  `public_offer` (ohne Dolibarr-Nummern), `describe`. Event: `billing` am
  Dokument, Pflege nur mit Bereich **finance** (`_billing_updates`, 403
  sonst); Sicht: `offer` für alle, `billing` nur für Finanzen (Detail und
  Liste). Anmeldung (`POST /events/{id}/registrations`): `selected_positions`,
  bei `registered` Preis-Snapshot `price_snapshot` + `billing_status`
  pending; Warteliste ohne Snapshot, Preis beim Nachrücken (Admin-Update);
  Begleitpersonen-Änderung vor Beleg → neuer Snapshot, alter Auftrag zu.
  `_public_event_registration` zeigt `price` nur bei `is_staff` (eigene
  Anmeldung und Verwaltung) – die Teilnehmerliste zeigt kein Geld.
  `services/billing_orders.py`: Postfach `billing_orders` (`create_order`,
  `cancel_orders_for`, `release_order`, Job `classify_due` alle 120 s:
  pending → waiting_write_access / waiting_link / ready, **legt keine
  Belege an**; `overview`). Rechte: Bereich `finance` („Finanzen“,
  grantable, MFA; Club-Admin/Superadmin haben ihn). Routen
  `routes/finance_routes.py`: `GET /api/admin/finance/overview`, `POST
  …/orders/{id}/release`, `POST …/orders/run`. Dolibarr: `write_api_key`
  (verschlüsselt) + `write_enabled` in den Einstellungen,
  `dolibarr_client.write_capable(settings)` – der Lese-Schlüssel schreibt nie.
  Web: `lib/pricing.js` (Vorschau, Formular↔Server, `billingFormError`),
  `components/tls/EventBillingSection.jsx` (nur `can("finance")`),
  `EventDetailPage` Anmeldung mit Kosten/Wahlpositionen/Summe,
  `AdminFinancePage` (`/admin/finance`), Schreibzugriff-Panel in
  `AdminDolibarrPage`; `lib/permissions.js` kennt `finance`. Doku
  `docs/ABRECHNUNG.md`.
- Abrechnung I, Teil 2 (#316, #317, #321 Anfang; PR #365).
  `services/dolibarr_billing.py`: `ensure_thirdparty` (Reihenfolge:
  `thirdparty_id` an der bestätigten Zuordnung → `billing_customers`
  (Nicht-Mitglieder je Installation) → `fk_soc` des Kern-Mitglieds
  (`client.core_member`) → E-Mail-Dublette in Dolibarr → **`Waiting(
  waiting_review)`**, nie still übernehmen → sonst `create_thirdparty`),
  `assign_thirdparty` (Finanzen nennt die Nummer, geprüft per GET),
  `invoice_lines` (Brutto→Netto je `tax_rates`, `none` immer 0,
  `fk_product`), `invoice_payload` (`ref_ext` = `tls-<order.id>`),
  `create_invoice_for` (erst `invoices_by_ref_ext` – **nie eine zweite
  Rechnung nach Abbruch**; `invoice_id` sofort speichern; Entwurf, außer
  `invoice_auto_validate`), `process_order` (Waiting → Status; DolibarrError
  → `attempts`, nach 5 `failed`), `sync_invoiced` (Status/`paye`/
  `remaintopay` → Auftrag + Anmeldung `billing_status` invoiced/paid).
  `dolibarr_client`: `_request(method, …, key=, retries=)`, `_send`
  (**ohne Wiederholung**, Schreib-Schlüssel = `write_api_key` oder der des
  Website-Benutzers), Kern-Wege `thirdparty`, `thirdparties_by_email`,
  `create_thirdparty`, `core_member`, `product`, `invoice`,
  `invoices_by_ref_ext`, `create_invoice`, `validate_invoice`; 404 auf
  Listen = leer. `write_capable` = live + `write_enabled` + irgendein
  Schlüssel (Entscheidung des Betreibers vom 22.09.: **ein** Dolibarr-
  Benutzer, der Schalter ist die Sicherung). `billing_orders.classify_due`
  führt mit Schreibzugriff aus; `sync_due` (Job `billing_sync` alle 10 min),
  `retry_order`; Status `waiting_review`. Routen: `POST
  /api/admin/finance/orders/{id}/retry`, `…/thirdparty {thirdparty_id}`,
  `…/new-thirdparty`; `orders/run` führt aus und liest nach. Einstellung
  `invoice_auto_validate`. Test-Dolibarr `tests/dolibarr_fake.py` kennt die
  Kern-Wege (`_core`, `add_thirdparty`, `core_members`, `core_invoices`,
  `pay`, `posts`) – Formen wie Dolibarrs REST-API 22–24, kein Modulvertrag.
  Web: Finanzübersicht mit Zuordnen/Trotzdem neu anlegen/Erneut versuchen und
  Tabelle „Angelegte Rechnungen“; Dolibarr-Panel mit den beiden Haken;
  Anmeldung zeigt Rechnungsnummer und „bezahlt“. Nachtrag (PR #367, Wunsch
  vom 22.09.): Leistungen aus Dolibarr auswählen statt Nummer tippen –
  `client.services()` (`GET /products?mode=2`), `dolibarr_billing.service_view`
  (Bruttopreis in Cent, Steuerprofil aus `tva_tx`, unverkäufliche raus),
  `GET /api/admin/finance/dolibarr-services` (Finanzen; ohne Anbindung
  `available: false`), `pricing.applyDolibarrService` + Auswahlliste je
  Position in `EventBillingSection` (Rückfall: Nummernfeld).
- Web: Dynamik (#224, #225, #226; PR #360). `lib/liveChanges.js` (ohne React):
  `changedKeys`/`movedKeys` (Vergleich zweier Stände nach Schlüssel und
  Signatur), `timelineSignature`/`liveCountLine` (Startseite),
  `formatCountdown` („in 3 Tagen, 14 Stunden“, tickt jede Minute, unter einer
  Stunde alle 15 s), `nextCountdownTarget`, `standingSignature`,
  `matchResultSignature`, `describeResult` („Ergebnis eingetragen: A 2:1 B“),
  `freshResults`. `hooks/useLiveChanges.js`: `useReducedMotion`/
  `prefersReducedMotion`, `useChangedKeys(items, keyOf, signatureOf, {holdMs})`
  (Menge der seit dem letzten Stand geänderten Schlüssel, 6 s; der erste Stand
  zählt nie), `useFlipRows(items, keyOf)` (FLIP über `element.animate`, nichts
  mit Bewegung reduzieren), `useCountdown(targetMs)`. Server:
  `home_routes._attach_live_counts` hängt je Karte `live_counts` an
  (Turnier: `registered`/`capacity`/`running_matches` aus
  `tournament_registrations` approved+checked_in und `matches_v2`
  running/in_progress; Event mit Anmeldung: `registered`/`capacity`; Fast Lap:
  `participants` = Fahrer mit gültiger Zeit ohne Vereinsreferenz) – ein
  Aggregat je Sammlung, dieselbe Karte in „heute“ und „bald“ bekommt beide.
  Web: `HomePage` NextUp mit Countdown (`home-countdown`), Zahlenzeile
  (`home-live-counts`), `tls-changed` + Chip „Neu“ (`data-changed`);
  `TournamentStandingsPage` Zeilen mit `useFlipRows` + `tls-changed-row`;
  `BracketTree` Prop `changedMatchIds` (Set) → Kontext → `tls-changed-frame`
  am Knoten; `TournamentSchedulePage` Chip „gerade eingetragen“ + `toast` je
  frischem Ergebnis (höchstens drei je Stand). `components/tls/Skeleton.jsx`:
  `SkeletonLines/Cards/List/Table/DetailHeader/Page` (role=status, aria-busy,
  Label) – **neuer Ladezustand = Skelett in der Form des Inhalts, kein
  „Lade …“**; `PublicLoadingState` bleibt für die Seiten, die es schon hatten.
  `components/tls/PageTransition.jsx` um die Routen: blendet beim Pfadwechsel
  `#main-content` über `element.animate` ein (nur Opazität), ohne Neuaufbau
  und **ohne eigenes DOM-Element** – ein Rahmen-`div` verschob die
  Nachrichten-Seite um einen Pixel (e2e messages.spec). CSS in
  `index.css` unter „Dynamik-Block“; `prefers-reduced-motion` schaltet alle
  Animationen ab, Hervorhebungen bleiben.
- App 0.7.0-beta: Mitgliederbereich (#340, #339, #341, #342, #346; Build 65).
  Server: `services/member_announcements.py` – Job `notify_due` (jede Minute)
  meldet veröffentlichte interne News und Events **genau einmal**
  (`members_notified_at`): `members` → aktive Mitglieder, `internal` → wer die
  Vereinsverwaltung hat (`club_area_user_ids`: Rolle, Freigabe `areas`,
  Vorstandsposten, Dolibarr-Funktion über `areas_for`), sonst niemand – keine
  leere Liste fällt auf „alle“ zurück; Älteres als 24 h wird nur markiert.
  Benachrichtigungs-Thema `club_internal` (`notification_preferences.py`,
  Standard an, ohne Newsletter-Bindung; Web `profile/constants.js`, App
  `ProfileScreen`). `services/member_card.py` + `routes/member_card_routes.py`:
  `GET /api/account/member-card` (Karte mit frischem Prüfcode, 5 min,
  `member_card_tokens` mit TTL-Index) und `GET /api/card/verify/{token}`
  (öffentlich, 30/10 min je IP; gültig → Vorname + Nachnamen-Initial,
  Mitgliedsart, gültig bis; sonst nur `valid: false`, ohne Grund);
  `card_status`: aktiv/Ehrenmitglied gilt, Rückstand ist kein Austritt,
  `membership_ends` aus Dolibarr beendet; `wallet_model` beschreibt die Karte
  neutral für Apple/Google Wallet (Anbindung offen: Zertifikat/Issuer nötig).
  Web: `components/tls/MemberCardPanel.jsx` (auf „Meine Mitgliedschaft“,
  BrandedQRCode, erneuert vor Ablauf), `pages/public/MemberCardVerifyPage.jsx`
  (`/karte/pruefen/:token`, noindex), `lib/memberCard.js`. App:
  `lib/memberArea.ts` (Port von `frontend/src/lib/memberArea.js` +
  `feeCard`/`linkPrompt` aus `lib/dolibarr.js`, `applyScope` Alle/Verein),
  `lib/memberDocuments.ts` (`fetchAndOpen`: Datei mit Bearer in
  `cacheDirectory/member-documents/`, Android-VIEW-Intent, Fehlertext je
  Status; `registerCacheClearer` löscht den Ordner beim Abmelden; `openInvoice`
  für Belege), `lib/memberCard.ts` (`refreshDelayMs`, 1 min vor Ablauf),
  `lib/qr.ts` + `components/QrCode.tsx` (Matrix aus `qrcode/lib/core/qrcode`,
  reines JS, als Strich-Views – keine SVG-Bibliothek), Screens `MemberArea`,
  `MyMembership` (Beitrag, Zuordnung anfragen, Belege als PDF – **kein
  Bezahlen in der App**), `MemberDocuments`, `MemberCard` im MoreStack;
  `MoreScreen` goldene Karte für Mitglieder / „Mitglied werden“ (Web-Link)
  sonst, Mitgliedervorteile liegen im Bereich. `ContentCard` `visibility` →
  „Intern“/„Vorstand“ in Gold; Events-Tab und News haben den Filter „Alle /
  Verein“ (nur wenn es Internes gibt). `Card` hat `testID`.
- App 0.6.0-beta (#218, PR #354, Build 64): `mobile/src/lib/achievements.ts` –
  `achievementIcon` (Lucide-Name des Katalogs → Ionicon, sonst nach Kategorie,
  sonst Pokal; der Typ `IoniconName` prüft jeden Namen), `groupProgress` („3 von
  10“ zur nächsten Stufe), `freshTiers`, `announceAchievementUnlocked` /
  `onAchievementUnlocked`. `components/AchievementGroupCard.tsx` (aus dem Profil
  herausgelöst), `components/FadeIn.tsx` (`FadeIn`, `staggerDelay`,
  `useReduceMotion` – „Bewegung reduzieren“ schaltet Übergänge und Konfetti ab).
  `NotificationContext` zeigt für `kind: "achievement"` keinen Banner, sondern
  meldet es dem `AchievementCatchUpOverlay`, das den Freischalt-Moment sofort
  zeigt; `rootNavigation.targetFromUrl` führt `/profile?tab=achievements` zum
  Reiter Erfolge. Neues Symbol im Katalog → in `ICONS` eintragen, sonst greift
  der Ersatz nach Kategorie (Test hält den Katalogstand fest).
  `@testing-library/react-native` 14: `await render(…)`, `await fireEvent…`.
- Anmeldung und Teilen (#348, #347; PR #353). `auth.py`: `REMEMBER_DAYS` (90,
  gleitend) und `SESSION_ONLY_HOURS` (24); der Refresh-Token trägt `rem`,
  `token_remembers` liest ihn (ohne Kennzeichen = bleiben), `set_auth_cookies(…,
  remember=)` setzt ohne Haken Cookies ohne Ablaufdatum. `remember` läuft durch
  `UserLogin`, Passkey-Login, Google, die Zwei-Faktor-Challenge und die Rotation.
  `_requires_admin_mfa` heißt weiter so, fragt aber **jedes** Konto mit
  eingerichtetem Zwei-Faktor; `POST /auth/mfa/setup` steht allen offen,
  `GET /auth/mfa/status.required_for_admin` kommt aus den Bereichen
  (`MFA_AREAS & areas_for`), nicht aus der Rolle. Grenze, die bleibt: mit
  Zwei-Faktor auch nach dem Passkey-Login der Code
  (`test_passkey_login_security_boundaries`). Web: `lib/loginComfort.js`,
  `lib/passkeys.js` (`startPasskeyAutofill`, erneuert sich alle 4 min, vor dem
  Knopf „Mit Passkey anmelden“ beenden), `LoginPage.jsx` (Haken, Angebot),
  `MfaSetupPanel.jsx` (für alle), `ProtectedRoute` leitet nach
  `/profile?tab=security&mfa=required`. Link-Vorschau:
  `routes/seo_render_routes.py` `restricted_meta` – neutrale Karte für
  Nicht-Öffentliches (noindex, keine strukturierten Daten zum Inhalt), Titel/Bild
  nur mit `share_preview` und nie für `internal`; Entwürfe und Geplantes bleiben
  404. Web: `components/tls/SharePreviewToggle.jsx` in News- und Event-Formular.
- Discord I (#300, #301, #303; PR #350), Anleitung in `docs/DISCORD.md`.
  `discord_service.py`: `TARGETS` (öffentlich: community, news, events,
  achievements; privat: board, ops), `EVENTS` (Ereignis → Ziel, Beschriftung,
  Standard), `send_event` – **die eine Stelle** für Schalter, Ziel und die
  Grenze „privat nie öffentlich“; `resolve_target` (öffentlich fällt auf
  Community zurück, privat nie), `send_to`, `build_embed` (auch für die
  Vorschau), `target_status`, `broken_targets`. Einstellungen in `settings`
  unter `discord`: `targets.<ziel>.webhook_url` (verschlüsselt) und
  `events.<schlüssel mit __ statt Punkt>` (`event_field`; ein Punkt im
  Feldnamen wäre für MongoDB ein Unterordner). Routen in `settings_routes.py`:
  `PUT /settings/discord` (targets, events), `POST /discord/test?target=`,
  `POST /discord/preview`, `POST /discord/resend/{log_id}`.
  `services/discord_announcements.py`: Job `discord_announcements` (60 s) meldet
  News und Events genau einmal (`discord_checked_at`, `discord_outcome`), nie
  Privates, nie Altes (> 24 h), nie mit `discord_skip`; `notify_board` schickt
  nur Hinweise ohne Namen. `services/achievement_queue.py` (#301):
  `request_evaluation` (Sammlung `achievement_eval_queue`, eine Person höchstens
  einmal), Job `achievement_queue` (30 s: `process_queue` + `flush_awards`),
  Job `achievement_sweep` (15 min, einmal täglich alle); `badges.award_achievement`
  merkt die Meldung nur noch vor (`achievement_outbox`), gesendet wird je Person
  gebündelt und nur mit öffentlichem Profil und öffentlicher Gruppe. Auslöser:
  `match_notifications.notify_match_result_confirmed`, Turnierstatus
  `completed`/`results_published`. Web: `settings/DiscordTargets.jsx`,
  `components/tls/DiscordPreview.jsx` (News- und Event-Formular),
  `admin/achievements/EvaluationPanel.jsx`, Tageszentrale `discord_broken`.
  **Neues Discord-Ereignis = Eintrag in `EVENTS` (Standard aus) + `send_event`
  + Test, dass Privates nicht an ein öffentliches Ziel geht.**
- Dolibarr I (#295, #297, #316 Teil 1, #330 Teil 1; PR #338), Anleitung in
  `docs/DOLIBARR.md`. **Ein** Weg zu Dolibarr: `services/dolibarr_client.py`
  (Einstellungen in `settings` unter `dolibarr`, Schlüssel verschlüsselt; feste
  Lesewege, nur https, maskierte `DolibarrError`, Wiederholen nur beim Lesen,
  `capabilities_for`). Zuordnung Konto ↔ Mitglied in
  `services/dolibarr_links.py` (Sammlung `dolibarr_links`, ein Dokument je
  Konto und Installation; `member_key` nur bei bestätigter Zuordnung,
  eindeutig → ein Mitglied, ein Konto; `thirdparty_id` bleibt leer bis zur
  Abrechnung). Übernahme in `services/dolibarr_sync.py`: `project_summary`,
  `apply_summary` (schreibt `memberships` mit `source: "dolibarr"` und dem
  Unterdokument `dolibarr`; nie Mails, nie Discord), `run_sync` (alle 10 min
  `changed_since`, täglich alles; Merker in `dolibarr_sync_state` rückt nur nach
  einem vollständigen Lauf vor), `process_pending` (Webhook → Sammlung
  `dolibarr_pending`, Nachlesen nach 5 s), `try_auto_link`,
  `migration_preview` (Trockenlauf, schreibt nichts). Rechte in
  `services/dolibarr_policy.py`: Freigabe „Funktionscode → Bereich“
  (`function_policy`, versioniert, nur Superadmin, ableitbar nur `club`);
  `permissions.areas_from_dolibarr` ersetzt bei aktiver Freigabe den lokalen
  Vorstandsposten; älter als 48 h → abgeleitete Rechte ruhen. Routen
  `routes/dolibarr_routes.py`: `/api/admin/dolibarr/status|sync|preview|links`
  (Bereich `club`), `/settings|test|webhook-token` (Bereich `system`),
  `/function-policy` (Superadmin), `POST
  /api/integrations/dolibarr/webhook/{token}`, `POST
  /api/membership/dolibarr/link-request`; `/api/membership/me` trägt `dolibarr`
  (geprüfte Sicht, ohne Rohstand). Modi `off → preview → live`, Live erst nach
  sauberem Vorschau-Lauf. Geführte Mitglieder: `PUT /membership/user/{id}`
  lehnt Status/Art/Nummer/Beginn mit 409 ab, `_activate_linked_membership`
  tut nichts. Zehnte Auto-Prüfung `dolibarr_sync`. Vertragstests:
  `tests/contracts/vereine-openapi.json` + `manifest.json` (Modul
  0.5.12-beta), `tests/dolibarr_fake.py` prüft jede Testantwort dagegen. Web:
  `pages/admin/AdminDolibarrPage.jsx`, `lib/dolibarr.js`, Beitragskarte in
  `pages/user/MyMembershipPage.jsx`. **Neue Dolibarr-Funktion = über den
  Adapter, nie ein zweiter HTTP-Client; neue Fähigkeit des Moduls erst nutzen,
  wenn sie im Manifest steht.**
- Livestreams auf der Startseite (#310, PR #337): Die Regel „nur aktive
  Mitglieder mit verknüpftem Mitgliederprofil“ steht einmal in
  `services/stream_visibility.py` (`homepage_visibility`) – für
  `/api/streams/live` und für die Erklärung je Kanal in
  `/api/admin/streams/status` (`channels`). Den genauen Grund (Mitgliedschaft,
  Kontostatus) sieht nur der Bereich `club`; die Redaktion bekommt
  „nicht freigeschaltet“. `services/twitch_service.py` hält jeden Lauf in
  `settings` unter `twitch_poll_state` fest (`record_poll`: Grund, HTTP-Status,
  Zahlen) statt still zu überspringen; antwortet Twitch nicht, wird nichts
  geschlossen. Neunte Auto-Prüfung `twitch_poll` („Twitch-Abfrage“, gelb, kein
  Alarm; aus oder nie eingerichtet ist grün). Web: Twitch-Reiter in
  `pages/admin/settings/TwitchTab.jsx`, gemeinsame Bausteine in
  `settings/fields.jsx` (erster Schnitt für #223).
- Rechte nach Bereichen (#287–#292): `services/permissions.py` (Bereiche
  `tournaments`, `content`, `club`, `system`, `moderation`; Rolle → Bereiche,
  Freigaben `user.areas`, Vorstandsposten → `club`), Wächter `require_area(...)`
  und `require_any_admin()` in `auth.py`; `require_admin()` = Turnierleitung,
  `require_club_admin()` = System – beide mit Zwei-Faktor. Redaktions-Routen
  (News, Galerie, Sponsoren, Sticker, Achievements, CMS) verlangen `content`,
  Vereins-Routen (Mitglieder, Dokumente, Vorstand, Kontakt, Benutzer) `club`.
  Gewinne: Turnierleitung oder `organizer` des Turniers (`prize_routes.py`).
  `/api/auth/me` liefert `areas`; `PUT /api/users/{id}/areas` (Superadmin,
  Audit). Migration 2 setzt `team_leader` auf `player`. Matrix: `docs/ROLLEN.md`.
  Web: `lib/permissions.js`, `useAuth().can(...)`, `ProtectedRoute requireArea`,
  Adminmenü nach Bereich, 403 nennt den fehlenden Bereich, Freigaben unter
  Admin → Alle Benutzer. **Neue Admin-Route = Bereich wählen, nie nach Rang.**
- App-Releases (#250, PR #304): `services/app_releases.py`, Ablage
  `uploads/app-releases` (`storage.APP_RELEASE_DIR`), Sammlung `app_releases`
  (ein Eintrag je Build, `is_current`, `min_build`). `GET /api/mobile/app-version`
  und `GET /api/mobile/app-download/{build}` (angemeldet); Admin
  `/api/admin/app-releases` (Liste, Upload, PATCH, DELETE). Upload auch per
  `X-Release-Token` = `APP_RELEASE_UPLOAD_TOKEN` aus der Server-`.env` (nie im
  Repo). Web-Seite `pages/admin/AdminAppReleasesPage.jsx` unter System →
  App-Versionen.
- Bild-Varianten beim Upload: `backend/services/image_variants.py`
  (`schedule_variants`).
- Deutsch-Prüfung `test_german_copy.py` schlägt bei „fuer/ueber/weiss“ an –
  immer die ganze Suite laufen lassen, nicht nur den Zieltest.

- Jahreszeiten (#632, #633; PRs #648, #653): `services/seasons.py` –
  elf Saisonen mit Zeitfenstern (Gauß-Ostern, Adventsonntage, Halloween
  25.10.–1.11., Advent, Schnee, Nikolaus, Adventkalender, Weihnachten,
  Silvester mit Phasen ramp_29/ramp_30/evening_31/pre_countdown/countdown/
  show/fade/greeting und stundenweise gesäten Salven, Fasching,
  Vereinsgeburtstag aus `founded_on` in `about_page`, Ostern, Eiersuche),
  `merge_settings` (je Saison enabled/mode auto|force_on|force_off/until/
  intensity subtle|normal|full/channels web|app/texts), `active()`,
  `calendar()`, `admin_view()`, Vorschau-Token (HMAC, 60 s). Sammlung
  `settings` mit `id: seasons`. `routes/seasons_routes.py`: `GET
  /api/seasonal/active` (ETag, `max-age=60`; `/api/seasons` gehört den
  Wettkampf-Saisonen), `GET /api/seasonal/calendar`; mit Vorschau-Token
  `no-store`. Admin in `routes/settings_routes.py`: `GET/PUT
  /api/settings/seasons`, `POST /api/settings/seasons/{key}/preview`.
  `UserUpdate.seasonal_decorations` on|subtle|off. Die
  Sicherheits-Middleware erzwingt `no-store` auf `/api/` außer
  `/api/stickers/files/` und `/api/seasonal/`. Halloween-Signal
  `halloween_pumpkin` (31.10. ab 18 Uhr) läuft über die Erfolge-Signale.
- Erfolge II, E1 Datenmodell v2 (#611, PR #652): Paket
  `backend/achievement_catalog/` (`legacy.py` alter Katalog, `materials.py`
  MATERIALS Holz→Diamant plus Legendär und Geheim mit rank/points/color/
  legacy_level, LADDERS 7/5/3/1, CATEGORIES v2, `tier()`, `annotate_tier()`,
  `annotate_group()`, `ladder_targets()`, `category_v2()`; `__init__.py`
  annotiert alte Stufen, `migration_map.GROUP_MAPPING`),
  `services/achievement_migration.py` (`annotate_awards`,
  `apply_group_mapping` mit Trockenlauf/Marker/Rückfall `legacy_*`, CLI
  `python -m services.achievement_migration --dry-run`), `badges.material_fields()`;
  geheime Gruppen erscheinen erst nach dem Freischalten (Admins sehen
  alles); Admin-CRUD nimmt `material`/`hidden`/`how_to`/`art`, `level`
  bleibt 1–5 für alte Clients.
- Erfolge II, E7 XP und Level (#617, PR #654): `services/levels.py`
  (`xp_step = round(60·n^1.5/10)·10`, L60 = 683.150 XP, TITLES alle fünf
  Level, Prestige ×1,25 je Stern, `level_view`, `legacy_square_curve` für
  Team-Level), `services/xp.py` (SOURCES mit Tagesdeckeln, `grant()`
  idempotent je `ref`, Mitgliederbonus 10 %, Benachrichtigung `kind:
  level`, `daily_login_once`/`grant_daily_login` mit Serie und
  Geburtstags-Logins, `prestige`/`undo_prestige` 24 h, `rebuild`/
  `rebuild_missing`, `leaderboard`), Haken in badges/event/friend/auth
  `/me`/discord/chat, Routen `GET /api/users/me/level`, `POST
  /api/users/me/prestige[/undo]`, `GET /api/achievements/leaderboard?by=level`,
  `POST /api/admin/achievements/xp`, Job `xp_baseline` (60 s).
- Erfolge II, E6 Zähler (#616, PR #656): `services/achievement_counters.py`
  (Registry `@counter(key, *sources)`, `Context`-Lader, rund 60 Zähler für
  Signale/Profil/XP/Erfolge/Turniere/Matches – Zeitstempel und Seeds aus
  den rohen `matches_v2` –/Teams/Events/Saison/Community, `compute`,
  `refresh(user_id, sources)`, `stats()` mit Cache `user_achievement_stats`
  10 min, `reconcile()`, `SIGNAL_RULES`, `record_signal`, `season_allows`),
  `routes/achievement_signal_routes.py` (`POST /api/achievements/signal`,
  `GET/POST /api/matches/{id}/commend`, `POST /api/news/{slug}/read`, `POST
  /api/streams/watch`), `badges.evaluate_user_progress(user_id, sources)`,
  `achievement_queue.request_evaluation(..., sources=)`, Cron
  `achievements_reconcile` 04:10 Europe/Vienna, `COUNTER_KEYS_V2` im
  Katalog. Test-Fakes der Auswertung müssen `sources` entgegennehmen.
- Erfolge II, E2–E4 Kataloge A–C (#612 PR #675, #613 PR #682, #614 PR #683):
  `achievement_catalog/catalog_a.py` (Helfer `_group(code, name, category,
  description, how_to, icon, art, key, targets, step, *, sort_order, unit,
  staff_only, catalog, steps, materials, manual)` – Stufen `code_1..n`, Name
  „Gruppe I…VII“, Leiter aus `LADDERS[len(targets)]` oder `materials`,
  `manual` ohne Schlüssel; `REPLACED` alt→neu, `REDEFINED` gleicher Code mit
  neuer Leiter), `catalog_b.py` (Fast Lap/Saison/Team, 26/136),
  `catalog_c.py` (Community/Creator/Profil, 42 – vier Gruppen aus #614
  bewusst offen: Discord-Server, Abstimmungen, Mitgestalter, Botschafter,
  siehe #615), `__init__.py` (hängt A–C an, nimmt Abgelöste heraus,
  `GROUP_MAPPING.update`, `REDEFINED_OLD_TIERS`). Zähler dazu in
  `achievement_counters.py` (Kartenstände, Pünktlichkeit, Dispute-Serie,
  Fast-Lap-Bestzeiten/Zielzeit `f1_tracks.target_time_ms`/Rekorde/Konstanz/
  Championship über `services/fastlap_standings.py` – dieselbe Rechnung wie
  die Route –, Grand Prix, Saison-Aufsteiger aus `season_rank_snapshots`
  (Job 03:35), volle Saison, Saisonstart, Team-Siege nach Beitritt,
  Einladungen, Discord-Nachrichten, offene Chats, Fotos, Sticker, App-Stufe,
  Turnier-Streams, Clips). `services/season_ranks.py`: `write_standings`
  beim Saisonabschluss (`PUT /api/seasons/{id}` auf `completed` und
  `badges.on_season_completed`) – vorher schrieb niemand
  `season_standings`. Migration: `apply_redefined` räumt alte Stufen-Codes
  neu definierter Gruppen und hebt Vergaben (Zähler oder, bei Hand-Gruppen,
  alte Höhe – `_carry_over`); `level_milestones` bleibt wie
  `level_progression` aus den Erfolgspunkten ausgenommen. Frontend:
  Zielzeit m:ss.mmm in `AdminF1EditPage.jsx` über `lib/laptime.js`.
- Über-uns-Zahlen (#621, PR #651): `club_numbers` zeigt Preise vergeben,
  Turniere gespielt, Mitglieder, Jahre aktiv.

**Web**
- Live-Aktualisierung: `frontend/src/hooks/useLiveRefresh.js`,
  Stream-Zustand in `frontend/src/lib/apiInvalidation.js`, Brücke
  `ApiInvalidationBridge.jsx`. `apiInvalidation.test.js` scannt Seiten nach
  Ressourcen-Schlüsseln (keine Unterstriche erlaubt).
- Profil (seit #253 / PR #267): `pages/user/ProfilePage.jsx` ist nur noch
  Rahmen; je Reiter eine Datei unter `pages/user/profile/` (`BasicTab`,
  `GamingTab`, `SocialsTab`, `AchievementsTab`, `PrivacyTab`,
  `NotificationsTab`, `SecurityTab` mit `PasswordPanel` und `SessionsPanel`,
  `TeamsPanel`, `FriendsPanel`, `MessagesPanel`, `AchievementPanels`,
  `ProfileNav`, `fields.jsx`,
  `constants.js`, `form.js`). Reiter bleiben `?tab=…`, weil Mails und
  Benachrichtigungen aus dem Backend so verlinken (Benachrichtigungen seit
  #257: `?tab=notifications`; `?tab=inbox` leitet seit #254 auf `/messages`
  um, mit `&to=` direkt ins Gespräch).
- Nachrichten (#254, PR #278): eigene Seite `pages/user/MessagesPage.jsx`
  (`/messages`, `/messages/:userId`), Verlauf in
  `pages/user/messages/ConversationView.jsx` (scrollt in sich, lädt beim
  Hochscrollen nach, hält die Position, „N neue Nachrichten“), reine Logik
  in `messages/messageGroups.js` (Tages-Trenner, Kopf-Zusammenfassung,
  `mergeMessages`). Backend `GET /api/messages/direct/{id}?before=&limit=`
  mit `has_more`; gelesen markiert nur das Öffnen. Die Web-Benachrichtigung
  behält `/profile?tab=inbox&to=…`, weil die App diesen Pfad liest
  (`mobile/src/navigation/rootNavigation.ts`). Browser-Test
  `frontend/e2e/messages.spec.js` mit nachgestelltem Server.
- Benachrichtigungen (#255, PR #279): Ziel und Bündelung als reine Logik in
  `lib/notifications.js` (`notificationTarget` folgt der App,
  `bundleNotifications` mit Stunden-Fenster), Zeile
  `components/tls/NotificationRow.jsx`, Feed `hooks/useNotificationFeed.js`
  (Endpunkte `/api/admin/notifications…`), Seite `pages/user/NotificationsPage.jsx`
  unter `/notifications`. Das Dashboard zeigt fünf Bündel und verlinkt
  dorthin. Backend-Pfade `/me/prizes` und `/tournaments/<slug>/chat` gibt es
  im Web nicht – die Zielzuordnung schreibt sie um.
- Dashboard (#256, PR #280): `pages/user/DashboardPage.jsx` liest
  `/api/mobile/dashboard` (derselbe Endpunkt wie die App, nur Anmeldung
  nötig); Termin-, Aktions- und Saisonlogik in `lib/dashboard.js`
  (Übertragung von `mobile/src/lib/dashboard.ts`). Kacheln nur noch
  Mitgliedervorteile, Strafen, Daten. Browser-Test `frontend/e2e/dashboard.spec.js`.
- Freunde (#259, PR #281): `profile/FriendsPanel.jsx` sucht über
  `/api/messages/users?q=` und rechnet den Stand zu mir aus `/api/friends`;
  `ProfileNav` nimmt `badges` (Zähler und Punkt je Reiter), das Profil lädt
  dafür `/api/friends` und hört auf die Ressource `friends`.
- Benutzermenü im Kopf (#282, PR #285): `components/tls/UserMenu.jsx`
  (Avatar und Name, dahinter Dashboard, Mein Profil, Nachrichten,
  Mitgliederbereich nur für Mitglieder, Admin nur für Admins, Abmelden;
  eigener Knopf ohne Radix wie die Glocke). In `PublicLayout.jsx` bleiben
  Suche, Glocke, Nachrichten und das Handy-Klappmenü; der blaue Admin-Knopf
  ist auf Wunsch des Betreibers weg (Admin nur noch im Menü). Das
  Dashboard verlinkt oben rechts „Profil bearbeiten“. Browser-Test
  `frontend/e2e/header-user-menu.spec.js`; der Abmelde-Test in
  `e2e/public.spec.js` öffnet zuerst das Menü (`nav-user`, am Handy
  `nav-logout-mobile`).
- Mitgliederbereich (#283 PR #285, #284 PR #298): `pages/user/MemberAreaPage.jsx`
  – Kopf mit Mitgliedschaft, eine Zeile Verweise (inkl. Discord aus
  `/api/settings/public`), darunter nur Karten mit Inhalt: interne Events
  (`/api/events?upcoming=true`), Dokumente, Vorteile, interne News,
  Ansprechpartner aus `/api/board?active_only=true`. Auswahl in
  `lib/memberArea.js` (`memberEvents`, `memberNews`, `boardContacts`).
  Leer-Satz statt leerer Karten. Browser-Test `frontend/e2e/member-area.spec.js`.
  Dolibarr (Beitrag, Rechnungen, Vorstand) steht in den Meilensteinen
  „Dolibarr I“ (#316, #295, #297, #330) und „Dolibarr II“ (#296, #325).
- Privatsphäre und Benachrichtigungen (#257, PR #275) speichern von selbst:
  `profile/useAutosave.js` (0,7 s Entprellung, ein PATCH je Lauf, Änderungen
  während des Speicherns bleiben stehen), Schalter in `profile/SwitchRow.jsx`
  (eigener `role="switch"`-Knopf; die Radix-Switch braucht ResizeObserver),
  Sichtbarkeits-Gruppen und Schnellwahl als reine Logik in
  `profile/visibility.js`.
- Grunddaten und Sicherheit (#258, PR #276): Länder in `lib/countries.js`
  (nur ISO-Codes, Namen per `Intl.DisplayNames`), Social-Symbole und die
  Bereinigung eingefügter Adressen in `profile/socials.js`, `?tab=sessions`
  ist ein Alias auf `security` (`TAB_ALIASES` in `ProfilePage.jsx`). Reiter
  liegen im Profil-Formular, eigene Formulare darin (Passwort) nutzen Knöpfe
  mit `type="button"`. `ImageUpload` zeigt keine Dateinamen mehr und hat
  „Ansehen“/„Entfernen“ – überall, auch im Adminbereich.
- Admin-Seite Betrieb: `pages/admin/AdminOpsPage.jsx`, Route `/admin/ops`,
  Menüpunkt „Betrieb“ unter System; Reiter Fehler, Tempo, Vitals, Checks
  (#265). `lib/vitals.js` sammelt LCP/FCP/TTFB/CLS/INP (`web-vitals`
  nachgeladen, Start in `index.jsx`, `sendBeacon` beim Verbergen der
  Seite, nichts bei Do Not Track); `lib/ops.js` liefert Ampel-Sätze und
  -Farben, die Tageszentrale führt „Betrieb“ als Aufgabe, sobald ein Check
  gelb oder rot ist. Browser-Test `frontend/e2e/admin-ops.spec.js`.
- ESLint nutzt `frontend/eslint-suppressions.json` (Sammel-Unterdrückungen).
  Nach dem Auslagern von Code: `npx eslint --prune-suppressions src`.
- Web-Fehlersammlung ist standardmäßig **an** (`VITE_CLIENT_LOGGING` nur
  mit `"false"` aus; Compose `CLIENT_LOGGING_ENABLED` Standard `true`).

- Jahreszeiten-Bühne (#634, PR #649; Vorschau #653): `frontend/src/seasons/` –
  `SeasonContext.jsx` (`SeasonProvider` in `App.jsx`: Abfrage, alle 10 min
  neu, 30 s um Mitternacht am 31.12., Vorschau-Token aus `sessionStorage`
  `tls-season-preview` mit Ereignis `tls:season-preview`, Neuladen beim
  Seitenwechsel, Wahl aus dem Konto oder `localStorage`
  `tls-season-preference`), `SeasonStage.jsx` (Portale Backdrop/Sky-Canvas/
  Corners/Toast; still auf /admin /display /setup /consent außer bei
  Vorschau; Module lazy über `registry.js` mit Cache; setzt `data-season`
  und `--season-accent` am `<html>`), `sky.js` (ein rAF-Loop, Partikelbudget
  40/120/240, Pause bei verstecktem Tab), `SeasonSlots.jsx` (Widget neben
  dem Logo, Footer-Platz), `DecoSwitch.jsx` (Footer „Deko: an · dezent ·
  aus“), `signals.js`, `rng.js` (`pageRng`, `between`, `pick`). Modulvertrag
  `{ key, accent, Corners, Backdrop, Footer, Widget, Toast, skyLayers({season,
  budget, reducedMotion}) → [{ key, draw(ctx, dt, size, now), dispose }] }`.
  Admin `pages/admin/settings/SeasonsSettings.jsx` (Schalter je Saison,
  Vorschau-Knopf, Jahreskalender).
- Halloween Web (#635, #655, #658, #660–#664, #679–#681; PRs #649, #657,
  #659, #668, #670, #674, #676, #684, #685, #686): `seasons/halloween/` –
  `index.jsx` (`pageLayout(pathname, intensity, salt = LOAD_SALT)` aus
  Adresse plus Salz je Ladung gesät, alle Zufallszahlen unabhängig von der
  Stärke; `Corners`, `Backdrop` (Mond am echten Himmel), `Footer` (Katze
  läuft beim Klick, `catTarget`; Kürbisse grüßen wie die Laterne),
  `Widget`, `skyLayers`, `sounds` (Palette), `ScareToggle`;
  `useScrollEffects` setzt `--season-scroll` und schickt `tls:season-page`),
  `web.js` (rundes Radnetz: `buildPlan` mit Speichen/Windungen/Drehsinn aus
  dem Seed in echter Reihenfolge Anker→Rahmen→Speichen→Nabe→Spirale von
  außen, `plan.exits`; Verlet-Physik `stepPhysics` mit Zeiger-Schub,
  Stößen alle 150 ms, `MAX_STEP`/`REST_PULL`/`MAX_DRIFT`, Bau straff bis
  fertig; die Spinne geht nach 50–110 s über den Ankerfaden weg
  (`sendSpiderAway`) und kommt zurück; Greifen mit der Maus `grabNodes`/
  `startGrab`/`tearByPull` – Anker reißen bei 0,35/0,7/1,05 R Zugweg, Falten
  über schrumpfende Ruhelängen, frei = Wind + Auftrieb + Verblassen, danach
  Neubau mit neuem Plan; Klasse `tls-web-grabbing` gegen Textmarkieren;
  `createWebLayer` für den Canvas, `staticLines` für das SVG bei „dezent“/
  „Bewegung reduzieren“), `HangingBats.jsx` (seit Halloween IV H7–H9 nur noch
  DOM, Zeit und Anzeige – Plätze und Leben siehe den Eintrag Halloween IV
  unten; Menü-Fledermäuse hängen am Fenster, alle anderen scrollen mit ihrem
  Platz; Klick scheucht; Testschalter `timeScale`, `temperament`,
  `reactionRng`), `graveyard.jsx` (Gräber auf `footer [data-season-line]`,
  Geister per Klick, Sperre je Grab 60 s), `rappel.js` (Zustandsfolge der
  Abseil-Spinne; die Läuferin steht in `.tls-rappel-runner` neben dem
  schwingenden Faden), `wisps.js`, `bats.js` (Bahnen in Seitenkoordinaten:
  quer, Sturzflug, Aufstieg), `moon.js` (Phase, `litPath`), `sounds.js`
  (Instrumente aus Oszillatoren und gefiltertem Rauschen, Musik-Sequenzer mit
  Drone, Wind, D-Moll-Glocken, Herzschlag – nur nachts), `scareRules.js`
  (Regeln `shouldScare` mit Gründen, 128 kuratierte Varianten Figur ×
  Auftritt × Klang × Rahmen, Speicher `tls-scare-*`), `Scare.jsx`
  (`Scares` Wächter alle 5 s, Portal über allem, Hinweis „Nie wieder“,
  `ScareToggle`; Guard-Element `halloween-scare-guard` mit `data-reason`),
  `art.jsx` (Spinne, Kürbis, Laterne, Mond, Katze sitzend und `CatWalking`
  mit Knie/Pfote/Saum, kleine Grabsteine, Geist, Fledermäuse),
  `halloween.css`. Layout-Marker: `data-season-line="footer"` an der
  Fußleiste in `PublicLayout.jsx`, `data-season-anchor="lion"` am
  Hero-Löwen und `data-season-anchor="card"` an News-/Vorstandskarten
  (HomePage, NewsPage, AboutPage, ClubPages). Nie `filter` auf inneren
  SVG-Gruppen; Saison-SVGs in nullbreiten Haltern brauchen `max-width: none`
  (Tailwind-Vorgabe `svg { max-width: 100% }` – Geister, Fledermäuse, Mond
  waren sonst 0 px breit).
- Erfolge II, E5 Katalog D (#615, PR #688): `achievement_catalog/catalog_d.py`
  – 33 Gruppen Verein, Besonders und Geheim (Katalog gesamt 148 Gruppen,
  615 Stufen), elf neue Zähler in `achievement_counters.py`, negative Stufen
  (`neg_dispute`, `silent` an Stufen und Vergaben, `award_id` an Vergaben),
  `validate.py` (`validate_catalog(groups, tiers, condition_status)` →
  ok/errors/warnings/counts). Zählerfalle: Tests dürfen Gruppenzahlen nicht als
  Zahl hinschreiben – aus der Datenbank lesen.
- Erfolge II, E9 Sichtbarkeit und Teilen (#619, PRs #689–#691):
  `services/achievement_visibility.py` (Seltenheit mit Mitgliedern als
  Grundmenge, `category_overview`, `hidden_summary`, `next_up` mit
  `CATEGORY_LINKS`, `leaderboard(category, period)`, Erfolg der Woche
  (`week_window`, Einstellung `achievement_of_week`), `recent_unlocks`,
  Anheften `set_pins`/`pinned_awards`, `viewer_sees_club`,
  `achievements_public(user)` – `None` → privat, `{}` → öffentlich –,
  `my_summary`), Routen in `badge_routes.py` `GET /api/achievements/me`
  (next_up, hidden, pinned, level), `PUT …/me/pins`, `…/me/summary`,
  `…/user/{id}` (`achievements_hidden`, Vereinsfilter), `…/overview`, `…/week`,
  `…/recent`, `…/award/{id}`, `…/share/{id}.png`, `…/leaderboard?category=
  &period=`; `services/achievement_share.py` (Pillow-Karte `render_card` mit
  `_blend`, `_wrap`, Polygon-Stern statt ★, Schriftkandidaten – Dockerfile
  `fonts-dejavu-core`; `share_payload`, `shareable`); Modell
  `UserUpdate.privacy_achievements_public`. Web: `components/tls/
  AchievementGroups.jsx` (Seltenheit, Sortierung, Geheim-Karte, Vereins-
  Teaser, Filter, Anheften, Teilen, `ListBadge`), `pages/public/
  AchievementsShowcasePage.jsx` und `AchievementSharePage.jsx` (Open-Graph),
  Profil `pages/user/profile/{AchievementPanels,AchievementsTab,PrivacyTab}.jsx`,
  `components/tls/AchievementsTile.jsx`, `lib/shareAchievement.js`. Der
  Server-Middleware-Header `Cache-Control: no-store` überschreibt Routen-
  Header – nicht dagegen testen.
- Erfolge II, E8 Abzeichen und Zeremonien (#618, PRs #692–#694):
  `components/achievements/` (`materials.js` neun Material-Looks, `Badge.jsx`
  + `badge.css`, `badgeArt.jsx` mit Relief, `motifs/{club,people,play,
  racing}.jsx` 142 Motive; Test `test_badge_art_keys.py` hält Motive und
  Katalog deckungsgleich), `components/achievements/ceremony/` (`select.js`
  Auswahl je Paket, `queue.js` Warteschlange, `sounds.js`, `particles.js`,
  `motions.jsx` elf Bewegungen, `Ceremony.jsx`, `CeremonyHost.jsx` mit
  `quietPrefixes`, `ceremony.css`); `AchievementCatchUp`, `AchievementUnlock
  Overlay`, `LevelUpCelebration` reihen nur noch ein; `lib/unlockSounds.js`;
  Vorschau `pages/admin/AdminAchievementPreviewPage.jsx` (`sampleCeremony`,
  e2e `achievement-preview.spec.js`); Einstellungen `ceremony_sound`,
  `ceremony_volume` 0–100, `ceremony_mode` full/subtle (`UserUpdate`,
  Profil-Reiter Benachrichtigungen). Das Abzeichen steht in allen Listen
  (Katalog, Profil, öffentliches Profil, Schaukasten, Dashboard, Teilen).
  Testfallen: jsdom kennt keinen `IntersectionObserver` (Attrappe vor dem
  Import von Seiten mit `whileInView`), `AnimatePresence` hält Ausgehende im
  DOM (`waitFor(... toBeNull())`).
- Erfolge II, E10 Admin-Backend (#620 Teil 1, PR #709; Teil 2 – acht Reiter im
  Web – offen): `services/achievement_admin.py`, Admin-Routen in
  `badge_routes.py` `POST /api/admin/achievements/award` (`earned_at`,
  `silent`), `DELETE …/award` mit Notiz, `…/award/bulk`, `…/events`
  (Sammlung `achievement_events`), `…/overview`, `…/catalog/check|export|
  import`, `…/season/{id}/preview`, `…/xp/caps`, `…/xp/prestige-reset`,
  `…/stats` und `…/stats.csv`; `_require_board` (Superadmin oder aktive
  Vorstandsposition), `achievement_counters.reconcile` merkt
  `achievements_reconcile_last`. Testfalle: `add_staff()` ist Superadmin –
  für „Staff ohne Vorstand“ `club_admin` nehmen; `award_achievement` legt
  `user_xp` an (Upsert in Tests).
- Seasonal Core (C1–C6, #721–#726; PRs #763 Web, #764 App) und die ersten
  Winter-Saisons (#765 Adventkranz, #766 Schnee, #767 Weihnachten):
  Kern der Jahreszeiten in `frontend/src/seasons/` – `anchors.js` (echte
  Kanten und Ecken: `measureAnchors` je Art nav/header/card/frame/image/hero/
  footer/footerLine mit stabilen Schlüsseln, `edgeSlot`/`pointSlot`/
  `cornerSlot`, Sonde `roomAt` (Behälter) und `areaFree` (Zeichenkästen),
  `freeSlots` gegen Ruhezonen, `chooseSlots`/`nearestFreeSlot`;
  `halloween/perches.js` und `webCorners.js` sind nur noch Adapter), `rng.js`
  (`seasonYear`, `seasonSeed`, `seasonRng` – Saat `saison:jahr:route[:salz]`,
  `SPANS_NEW_YEAR` für winter/snow/new_year/advent_calendar/christmas;
  Halloween würfelt je Saisonjahr über `YEAR_SALT`/`setYearSalt` statt je
  Ladung), `intensity.js` (`effectClasses` perch/corner/ambient/watch/motion/
  slots/crawl/rare/scene/interact je Seitenklasse, `allows`,
  `SEASON_CAPABILITIES` übersetzt je Saison – halloween, snow, christmas;
  `motion.js` `setSlots(n)` für ruhige Tage), `e2e/seasonQa.js` (`defineSeasonQa` – PC 1366/
  1440/1920, Handy 375, Tablet 768, Reduced Motion, Saison aus; jede Saison
  hat ihre `<saison>-regression.spec.js`), `docs/SEASONS.md` (Semantik,
  Checkliste, neue Saison anlegen). App: `mobile/src/seasons/rng.ts`
  (`seasonSeed`), `intensity.ts` (`effectClasses`, `seasonCapabilities`),
  `seasonQa.tsx` (`defineSeasonAcceptance`). Saisonmodule: `advent/`
  (`calendar.js` Adventsonntage wie der Server, `wreath.js` Kranz aus dem
  Jahres-Seed, `ignition.js` Anzünden einmal je Tag und Kerze, Widget neben
  dem Logo), `snow/` (`flakes.js` drei Tiefen und Böen aus dem Wetter,
  `layer.js` für den Canvas-Loop, `caps.js`/`SnowCaps.jsx` Hauben auf Kanten
  mit Stufe und Tauwetter, Schneeflocke mit Signal `snowflakes_clicked`),
  `christmas/` (#767: `lights.js`/`LightChain.jsx` Kette mit Draht
  in den untersten 16 px der Kopfzeile und oben in der Fußzeile – dort nur
  mit mindestens 30 px freiem Raum –, Lücken für Logo, Knöpfe und jede
  Schrift, Schein höchstens 7 px; `Toast` einmal je Tag, schließen über
  Knopf oder Escape; Feiertage ein Platz im Budget). Seit #768 gehören die
  Schneeflocken zur Seite statt zum Fenster (`scrollFlake`, Tiefen 1/0,8/
  0,55) und die Halloween-Katze miaut (`cat_meow` in `halloween/sounds.js`,
  nur mit eingeschaltetem Ton). Falle: das globale `img,
  video, canvas, svg { max-width: 100% }` in `index.css` lässt absolut
  positionierte SVGs in 0 px breiten Behältern kollabieren – `max-width:
  none` plus Breite als Stil.
- Wetter das ganze Jahr (#673, PR #770): eigene Saison `weather` in
  `services/seasons.py` – ein Fenster vom 1.1. bis zum ersten Augenblick des
  nächsten Jahres (keine Lücke zu Silvester), `always` (kein Termin im
  Kalender) und `channels: ("web",)`. `supported_channels(key)` /
  `runs_all_year(key)`; `merge_settings` und `PUT /api/settings/seasons`
  nehmen nur Kanäle an, die eine Saison bedienen kann – die App bekommt das
  Wetter erst mit #771. `admin_view` liefert je Saison `always` und
  `supported_channels`. Vorschau: `weather.demo()` (Gewitterregen 2,5 mm,
  Code 95) nur mit dem Vorschau-Token der Saison `weather`, gespeichert wird
  nichts. Web `frontend/src/seasons/weather/`: `rain.js` (reine Rechnung –
  `rainFactor` 0/0,35/0,65/1/1,2 aus `rain_mm`, drei Tiefen, `MAX_ALPHA`
  0,35, `dropCounts` mit `area`, `scrollDrop`, Spritzer), `storm.js`
  (`isThunderstorm` Code 95–99, Blitzabstand 8–25 s, Schein 0,14), `layer.js`
  (`createRainLayer`, `createWeatherLayer` entscheidet je Bild: Schnee-Saison
  → nichts, sonst Schnee oder Regen; Schnee außerhalb der Saison über
  `createSnowLayer({ baseFactor: 0 })`), `module.js` (`skyOnly: true`, in der
  Vorschau volle Menge auch im Admin), `index.js` (`weatherPlan`,
  `describeWeather` für den Admin). Schnee-Saison: `snowfallFactor` 0,55/0,8/
  1/1,25 aus `snow_cm + rain_mm` – Regen wird zu Schnee. `sky.js`: Vertrag der
  Ebenen `draw`, optional `idle()`, `slept(sekunden)`, `dispose()`; ruhen alle,
  schläft der Loop **ohne ein Bild**, parkt die Zeichenfläche auf 1×1
  (`parked`) und schaut alle 2 s nach; `areaFactor(size)` hebt die Teilchenzahl
  auf großen Fenstern (höchstens ×2). `SeasonStage`: `useLayerDisposal` räumt
  Ebenen verzögert ab (StrictMode ruft Effekte doppelt), gibt `preview` an
  `skyLayers` weiter und schreibt die Stärke von `skyOnly`-Saisonen nicht in
  `data-season-intensity`. Admin: die Schalter des Wetters stehen in
  `SeasonsWeatherCard.jsx` (keine eigene Saison-Karte, ohne „dezent“).
  Fallen: (1) eine Ganzjahres-Saison steht sonst als „1.1.–31.12.“ im
  Kalender und macht den Deko-Schalter im Footer ganzjährig sichtbar (gewollt);
  (2) wo sich zwei Striche kreuzen, addiert sich die Deckkraft – Tests prüfen
  den **Anteil** der Punkte über der Grenze, nicht den hellsten Punkt; mehrere
  Formen derselben Figur (Spritzer) in **einem** Pfad zeichnen; (3) Arbeitsbäume
  haben unter Windows CRLF – Patch-Skripte müssen Zeilenenden erhalten.
- Saison-Fundstücke (#678; PRs #773 Server und Web, #776 Katalog E, #777
  App): `SIGNAL_RULES` in `achievement_counters.py` je Signal mit `per_day`,
  `season`, optional `phases`, `live` (zählt nur im Augenblick) und `server`
  (seit #785: nur der Server selbst meldet – `record_signal(...,
  trusted=True)`; für Clients „unknown“). Halloween: `halloween_pumpkin` 1
  (Web und App melden ihn nur am 31.10. ab 18 Uhr; der Server prüft die
  Saison), `halloween_bats_scared` 30, `halloween_ghosts_freed`
  20, `halloween_cat_petted` 10; Schnee `snowflakes_clicked` 200 je Tag.
  `record_signal(user_id, name, count, day)`, `signal_day` (höchstens
  `REPLAY_DAYS = 7` zurück, nur Tage, an denen die Saison lief), `POST
  /api/achievements/signals` (bis zu 40 Zeilen) wertet sofort und leicht aus
  (`evaluate_user_progress(..., legacy=False)` rechnet nur die Zähler der
  Quelle) und liefert vergebene Stufen zurück. DSGVO: die Auskunft nennt
  Zähler, Signale je Tag, gelesene News, geöffnete Streams und gegebenes GG;
  „Konto löschen“ entfernt Signale, `news_reads`, `stream_watches` und
  `user_achievement_stats` (GG bleibt beim Match); ein Absatz in der
  Datenschutzerklärung (`site_texts.py`). Web: `seasons/signals.js` (Tag in
  Wien, Ausgang im Browser mit Eigentümer – am geteilten Rechner bekommt
  niemand fremde Funde –, Grenzen wie der Server), `seasons/SignalSync.jsx`
  (bündeln, nach dem Login nachmelden, erneut versuchen),
  `AchievementCatchUp` hört auf `tls:achievements-awarded`. Katalog E
  (`achievement_catalog/catalog_e.py`, Community, Bronze bis Diamant):
  Fledermausflüsterer 5/25/100/250/500, Flockenfänger 10/50/150/400/1000,
  Jahreszeiten-Sammler 25/100/300/750/1500; Zähler `halloween_bats_scared`
  und `season_collectibles_total`; `services/collectibles.py` und `GET
  /api/achievements/collectibles` (nur für die Person selbst) speisen die
  Karte „Saison-Fundstücke“ (`pages/user/profile/SeasonFindsPanel.jsx`,
  `SeasonFindIcons.jsx`, `season-finds.css`; Motive in
  `components/achievements/motifs/people.jsx`). App:
  `mobile/src/seasons/signals.ts` (Tag in Wien nach der Regel der
  EU-Sommerzeit ohne Zeitzonendaten, Ausgang im SecureStore mit höchstens 24
  Zeilen – rund 2 kB je Eintrag –, Zugriffe nacheinander), `signalSync.ts`
  (bündeln, erneut versuchen, melden beim Wechsel in den Hintergrund),
  eingehängt in `SeasonProvider.tsx`; `halloween.tsx` und `atmosphere.tsx`
  melden Fledermaus, Geist und Katze. Offen (#678, #772): Schalter
  „Fundstücke im öffentlichen Profil“ (Vorgabe aus), die Karte in der App,
  die Katze miaut in der App.
- Gelesen und gesehen (#780, PR #781): `POST /api/news/{slug}/read` sucht in
  `news_posts` über `find_by_slug_or_history` (auch alte Adressen) und zählt
  nur, was die Person lesen darf (`published`, `published_at` erreicht,
  sichtbar). Vorher suchte der Server in der falschen Sammlung, und der
  Test legte seine News in dieselbe falsche – Tests legen News jetzt über
  die echte Verwaltung an. `POST /api/streams/watch` prüft die Kennung
  (`WATCH_KEY`, Twitch/YouTube/Kick), deckelt mit `WATCHES_PER_DAY = 12` und
  bremst. Web `lib/streamWatch.js` (`streamKey`, `useStreamWatched`: eine
  Minute im sichtbaren Tab, einmal je Stream und Tag in Wien), eingebaut in
  `StreamEmbed` (`describeStream`), `LiveStreamSlider` und
  `TournamentLiveStreams` – ohne Zustimmung zu externen Medien kein Player,
  also kein Ping. App: `NewsDetailScreen` meldet nach dem Laden, nicht für
  Gäste. Nicht rückwirkend.
- Tag am Ort des Vereins (PR #774): der Server läuft in UTC und meldete nach
  Mitternacht bis zu zwei Stunden „gestern“. Fristen und Termine
  (`dolibarr_meetings`, `dolibarr_helper_shifts`, `membership_routes`)
  rechnen mit `dolibarr_policy.club_today()`, das Alter (Jumpscares ab 18,
  Mitgliederliste) mit `to_vienna(None).date()`, PDFs mit
  `pdf_service.club_now()`. Tests: `conftest.py` stellt die Saison-Uhr
  (`season_clock`, autouse) auf `SEASON_TEST_NOW` = 15.09.2026 12:00 Wien –
  wer eine andere Zeit braucht, setzt `seasons.to_vienna` im Test; Termine
  in Testdaten sind relativ zu heute. Die Gegenprobe mit verstellter Uhr
  (freezegun, Rezept unter 6.4) fand Tests, die ab dem 11.10.2026 von selbst
  rot geworden wären; als regelmäßige Frühwarnung vorgeschlagen in #775
  (A/B/C offen).
- Adventkalender (#641, #732; PR #785 – fasst #782–#784 und den App-Teil
  zusammen): `services/advent_calendar.py` (Saison `advent_calendar`;
  Sammlungen `advent_doors` – Jahr und Tag eindeutig –, `advent_openings` –
  Person, Jahr und Tag eindeutig –, `advent_views` für Zahlen ohne Namen; ein
  Türchen geht um `seasons.ADVENT_DOOR_HOUR = 6` Uhr in Wien auf
  (`advent_door_opens_at`, `advent_doors_open`), vorher verrät die
  Schnittstelle weder Titel noch Art; Nachholen bis 6. Jänner 23:59; Arten
  `KINDS` Text, Bild, Video, Clip, News, Event, Mitglied der Woche (nur mit
  Einwilligung), Sticker, Quiz (gespeichert wird nur die Teilnahme), Gewinn;
  `content_for` zeigt News- und Event-Karten nur, wenn die Person sie sehen
  darf; `calendar_view` holt Gäste-Türchen nach dem Login nach;
  `doors_in_best_year` zählt „Alle Türchen“ als 24 von 24 im selben Advent,
  vergeben beim 24. Türchen sofort; das Signal `advent_door` ist `server`).
  Routen `routes/advent_routes.py` unter `/api/seasonal/advent`: `GET ""`,
  `POST /{day}/open`, `POST /{day}/quiz`, `POST|DELETE /{day}/enter`; Admin
  `GET /admin/options`, `GET /admin/{year}`, `GET /admin/{year}/preview`,
  `PUT|DELETE /admin/{year}/{day}`, `POST /admin/{year}/copy` (nur in leere
  Tage; Mitglied der Woche und Gewinn neu bestätigen), `POST
  /admin/{year}/{day}/draw` und `…/redraw` – pflegen `require_area("content",
  "club")`, ziehen nur `club`. `services/season_raffles.py` (gemeinsam für
  Adventkalender und Eiersuche): `season_raffles` (eine je `source_key`),
  `season_raffle_entries` (eine je Person), `AUDIENCES` all/members,
  `MAX_WINNERS = 20`, Staff (`STAFF_AREAS`) nur mit Freigabe je Verlosung,
  gesperrte und gelöschte Konten nie; Mitmachen ist ein eigener Klick, `draw`
  schreibt ein Protokoll (Zeit, Person, Lose, Gewinner; ein zweiter Klick
  zieht nicht noch einmal), `redraw` nur für verfallene Gewinne; der Gewinn
  landet als Eintrag in `prize_pickups` („Verlosung“) mit privater
  Nachricht, nach außen nie ein Name; `terms()` liefert die fünf Sätze der
  Teilnahmebedingungen. `seasons_routes.with_calendar` setzt `data.ready`
  (gibt es Türchen für das Jahr?) – ohne zeigen Web und App keinen
  Einstieg. DSGVO: Auskunft und Löschen umfassen `advent_openings` und
  `season_raffle_entries`. Web: `frontend/src/advent/` (`scene.js`
  `sceneSvg(year, { filters })` – ein Bild der Winternacht über einem
  Tiroler Dorf mit Sternbild Löwe und Tatzenspur, aus dem die Türchen
  geschnitten sind; `doors.js` Form, Scharnier, Licht und Schmuck je Jahr;
  `Door.jsx`, `AdventBoard.jsx` mit 6/4/3 Spalten, `DoorDialog.jsx`,
  `AdventHint.jsx`, `storage.js` für Gäste-Türchen, `useAdventCalendar.js`,
  `parity.test.js`), Seite `/advent` (`pages/public/AdventCalendarPage.jsx`,
  Seitenklasse `calm`), kleines Türchen neben dem Logo
  (`seasons/adventCalendar/`), der Kranz nennt das offene Türchen; Admin
  `/admin/advent` (Content → Adventkalender; `AdminAdventPage.jsx`,
  `advent/DoorEditor.jsx`, `CalendarPreview.jsx`, `RafflePanel.jsx`,
  `form.js`; `AdminSheet` mit `noValidate`, damit das Formular selbst sagt,
  was fehlt); Gewinne unter „Meine Gewinne“ (`MyPrizesPage.jsx`). App:
  `mobile/src/advent/` (`doors.ts`, `scene.ts` – dieselbe Rechnung,
  Paritätstest auf beiden Seiten –, `DoorTile.tsx` mit Vorder- und Rückseite
  des Flügels als eigene Ebenen, `AdventBoard.tsx`, `DoorSheet.tsx`,
  `entry.tsx` mit dem Hinweis im Dashboard, `links.ts`: eigene Pfade über
  `navigateToUrl`, sonst Browser, nur http(s)),
  `screens/main/AdventCalendarScreen.tsx` (Mehr → Verein, nur solange der
  Kalender läuft; die Feier kommt nach dem Schließen des Fensters),
  `navigation/rootNavigation.ts` (`navigateToUrl`, `openTarget`),
  `lib/prizes.ts`, `seasons/SeasonStage.tsx` (`SCREEN_SEASONS`, `appCanShow`
  – Mehr → Darstellung nennt nur Saisonen, die die App zeigt). Videos und
  Clips bettet die App nicht ein. Offene Entscheidungen des Betreibers: 6 Uhr
  oder Mitternacht, Staff in Verlosungen, wer zieht, Hauptgewinn unter allen
  mit 24 Türchen.
- Saisonen in der App, Oktober 2026 (PRs #788 Adventkranz, #789 Katze, #792
  Halloween-Rest; App-Gegenstücke aus #772): `mobile/src/seasons/advent/`
  (`calendar.ts` Adventsonntage wie der Server, `wreath.ts` derselbe Kranz
  wie im Web aus `seasonRng` – Paritätstest mit festen Prüfsummen 2026 und
  2027 in `wreath.test.ts` und `frontend/src/seasons/advent/wreath.test.js`
  –, `ignition.ts` Anzünden einmal je Tag und Kerze im SecureStore,
  `WreathSvg.tsx` Kranz in SVG, Flammen und Streichholz als eigene
  `Animated.View`s mit nativem Treiber, ihr Kasten `FLAME_BOX` mittig auf
  dem Docht, `AdventWidget.tsx` im Dashboard-Kopf mit Gruß-Karte);
  `anchors.tsx` `useScreenFocused()` lässt Bewegung auf verdeckten Tabs
  ruhen. Halloween-Katze (`atmosphere.tsx`): Schwanz und Augen als
  `PivotLayer` – ein Kasten mittig auf dem Drehpunkt (`pivotBox`,
  `CAT_VIEW`, `TAIL_ROOT`, `EYES_CENTER`, `TAIL_HALF`, `EYES_HALF`);
  Tautropfen im Netz mit Index-Schlüssel. Karte „Saison-Fundstücke“ unter
  Profil → Erfolge (`SeasonFinds.tsx` mit `dayText`, `seasonHint`,
  `orderSeasons` wie im Web; `findIcons.tsx` Figuren auf einer
  Mondlicht-Scheibe, `findMotion`/`usePoke` – Antippen regt die Figur,
  nicht bei „Bewegung reduzieren“; lädt nach `onSignal` neu). Klänge:
  `sound/synth.ts` rechnet einen Laut wie die Web-Instrumente (Sägezahn mit
  PolyBLEP, Bandpass nach RBJ, Verläufe wie `AudioParam`; `MEOWS` wie im
  Web) und `encodeWav`/`toBase64`; `sound/player.ts` legt ihn einmal als
  `cache/season-sounds/<name>-v<SOUND_VERSION>.wav` ab und spielt ihn über
  `expo-audio` (`playsInSilentMode: false` – auch auf Android still bei
  Lautlos und Vibration –, `interruptionMode: "mixWithOthers"` – kein
  Audio-Fokus), danach `remove()` **und** `release()`; Schalter „Töne“ in
  `DecoSetting.tsx`, je Gerät (`season_sounds`), Vorgabe an wie im Web.
  `expo-audio` nur mit den Plugin-Optionen `microphonePermission`,
  `recordAudioAndroid`, `enableBackgroundPlayback`,
  `enableBackgroundRecording` = `false` (Test in
  `scripts/release-version.test.mjs`); `expo-asset` direkt eingetragen
  (expo-doctor verlangt es als Peer von expo-audio).
- Schnee und Wetter in der App (#642, #771; PR #795): Rechnung aus dem Web
  übernommen – `mobile/src/seasons/snow/flakes.ts` (Tiefen, Formen, Wind,
  Böen, `advanceFlake`, `scrollFlake`, `flakeCounts`, `snowfallFactor`,
  `fadeAt`), `weather/rain.ts` (`rainFactor`, `dropCounts`, `createDrop`,
  `advanceDrop`, `scrollDrop`), `weather/storm.ts` (`isThunderstorm`,
  `nextFlashAt`, `boltPath`, `createFlash`, `flashLevel`). Parität: derselbe
  Fingerabdruck `1298028011` in `mobile/src/seasons/snow/flakes.test.ts` und
  `frontend/src/seasons/snow/flakes.test.js` (dafür hat `advanceFlake` im Web
  einen optionalen `random`). Gezeichnet mit Reanimated 4: `sky/SnowField.tsx`
  und `sky/RainField.tsx` halten feste Plätze je Tiefe (`poolLayout`,
  `rainLayout`), die Rechnung je Bild läuft als Worklet im
  `useFrameCallback` (`stepFlakes`, `stepDrops` – ohne Reanimated testbar);
  jede Flocke ist eine `Animated.View` mit `FlakeSvg`, jeder Tropfen ein
  dünner Strich, bewegt nur über Versatz und Drehung um die Mitte.
  `sky/Lightning.tsx`: Schein und Blitz, Helligkeit als `withSequence`
  (`pulseSteps`), jeder Blitz fragt das Bewegungsbudget (`lightning` in
  `motion.ts`). `sky/scroll.ts`: eine Scroll-Quelle (`seasonScroll`,
  `reportScroll`, `seasonScrollProps(screen)` – je Screen dieselben
  Eigenschaften), elf Screens melden ihre Position; die Felder schieben nur
  innerhalb desselben Screens. Module: `snow/index.tsx` (`SnowSky`,
  `SnowflakeWidget` – fangen zählt `snowflakes_clicked`, Zahl am Gerät,
  Schneekönig bei 50; `skyBudget`: dezent 0, normal 30, kräftig 60;
  `snowShare` aus `snowKeys` in `intensity.ts`), `weather/index.tsx`
  (`weatherPlan`, `weatherShare`, `shouldFlash`, `WeatherSky`; Modul mit
  `skyOnly`, steht nicht unter „Gerade läuft“). `SeasonProvider` reicht
  `weather` aus `/seasonal/active` weiter. Mehrere Widgets im Kopf stehen
  übereinander (`widgetOnTop`: die Schneeflocke über dem Kranz) – nebeneinander
  brach der Name mitten im Wort um. `rng.ts` `SPANS_NEW_YEAR` jetzt wie im
  Web. Server: das Wetter bedient den Kanal App (`added_channels: ("app",)`);
  `seasons.stored_channels` und `channels_known` beim Speichern sorgen dafür,
  dass ein später dazugekommener Kanal bei alten Speicherständen an ist.
  Admin: `SeasonsWeatherCard.jsx` mit „Wo: Website / App“. Jest:
  `jest.setup.js` bildet Reanimated selbst nach (die mitgelieferte Attrappe
  lädt die Worklet-Laufzeit und kennt `useFrameCallback` nicht);
  `__frameCallbacks` lässt Tests Bilder weiterschalten.
- Weihnachten in der App (#642; PR #797): die Lichterkette rechnet wie im Web
  (`mobile/src/seasons/christmas/lights.ts` – `chainLayout`, `wireY`,
  `wirePath`, `inGap`, `glowRadius`; Saat `christmas:<Jahr>:lights:<Anker>`,
  im Web heißt der dritte Teil `route`, in der App `screen`), der Gruß in
  `christmas/greeting.ts` (`greetingFor`, `starField`, `yearSaltFor`,
  `greetingShownToday`/`markGreetingShown` – einmal je Tag nach der Uhr am
  Gerät, SecureStore `season_greeting_<Schlüssel>`). Parität: Kette
  `2814731317` in `christmas/lights.test.ts` und `lights.test.js`, Sterne der
  Karte `2991777711` in `greeting.test.ts` und `christmas/index.test.jsx`.
  `LightChain.tsx`: Draht, Nägel und Fassungen als stilles Bild, je Lämpchen
  Schein (unter dem Draht) und Kolben (darüber) als `Animated.View` mit einem
  gemeinsamen nativen Takt (`pulseCurve` als Kosinus-Runde, `flickerCurve`,
  `bulbStartDelay`), der Wind aus `weather.wind_factor` (`chainWind`). Neue
  Slots in `SeasonStage.tsx`: `Edge` (`SeasonEdgeSlot` an der Unterkante der
  Begrüßungskarte im Dashboard), `Greeting` (Karte über der Tab-Leiste, je
  Phase ein eigener Schlüssel) und `Backdrop` (`SeasonBackdropSlot` in
  `components/Screen.tsx`, hinter dem Inhalt jedes Screens); `christmasKeys`
  in `intensity.ts`. Der Abschied am 6. Jänner trägt in Web und App den
  Titel „Heilige Drei Könige“ (vorher stand „Danke fürs Mitfeiern“ doppelt).
- Nikolaus (X3 #736; PR #798): Server `services/nikolaus.py` (`boot_state`,
  `open_boot`, `pick_sticker` – fest aus Person und Jahr, zuerst ein noch
  fehlender), Sammlung `user_stickers` (eindeutig je `user_id`, `source`,
  `year`), Abfragen `GET /api/seasonal/nikolaus` und `POST …/open` (409
  außerhalb der Saison, 401 ohne Anmeldung). Saison-Pakete im Sticker-Katalog
  (`seasonal`): „Vom Nikolaus“ mit acht Fluent-Bildern steht **hinten** im
  Katalog (die Auswahl im Chat öffnet beim ersten Paket), erscheint im Chat
  nur mit den eigenen Stickern (`list_sticker_packs(user_id=…)`), senden kann
  ihn nur, wer ihn hat (`resolve_sticker`/`sticker_for_message` mit
  `user_id`); im Admin ganz sichtbar und abschaltbar (dann bleibt der Stiefel
  leer). Web `seasons/nikolaus/`: `boot.js` (Form, `cardFor`, `bootFit` misst
  den freien Platz über der Footer-Linie – Handy kleiner, PC frei vom Knopf
  „Nach oben“), `index.jsx` (`Footer` mit Stiefel und Karte, `Toast` als
  Hinweis „Zum Stiefel“, `footerAccessible`: der Footer-Platz versteckt eine
  bedienbare Szene nicht mehr vor Screenreadern), gemeinsame Kante
  `seasons/footerLine.js`. App `seasons/nikolaus/`: `boot.ts`, `BootSvg.tsx`
  (Gutschein als eigene Ebene hinter dem Stiefel), `index.tsx` (`Shelf` im
  Kopf von „Mehr“ über `SeasonShelfSlot`, links neben der Glocke; `Greeting`
  mit „Zum Stiefel“; `TabIcon`). Parität der Form `102233374`.
- Silvester im Web (#640; PR #800): `seasons/newYear/` – `fireworks.js`
  (sechs Arten `SHELLS`, Bahnen geschlossen mit Luftwiderstand und
  Schwerkraft `starAt`, `starLight` mit Nachglühen, `smokeAt`, `rocketAt`,
  `burstPoint`, `spreadFor` nach Fensterhöhe, `windDrift`, `soundDelay`),
  `choreography.js` (`handwriting(year)` aus dem Jahres-Seed: Zonen,
  Lieblingsart, Farbpaare, Muster der Salven um 00:00/00:05/00:10 – Fächer,
  Welle, Krone, Kaskade; `planHour` aus den Startsekunden des Servers),
  `countdown.js` (Stufen hint ab 23:00, calm ab 23:59:00, pulse, zero, done),
  `layer.js` (Himmels-Ebene, Budget 200/600/1200, `LATE_MS` 1,5 s ohne
  Nachholen, schläft mit 4 s Vorschau; gemessen 1,05 ms je Bild bei rund 1225
  Teilchen), `sound.js` (eigener Schalter `tls-newyear-sound`, Vorgabe aus,
  höchstens sechs Stimmen, Begrenzer), `index.jsx` (`Corners` hält die Ebene
  aktuell und zählt `online_at_new_year`, `Widget` mit Hinweis und
  Ton-Schalter, `Toast` mit Countdown-Karte und Gruß). Serveruhr:
  `seasons/clock.js` (`serverOffset` gegen die Mitte der Abfrage),
  `SeasonContext` gibt `serverOffset` und `serverNow` weiter; der Server
  cacht `/api/seasonal/active` in `NEW_YEAR_LIVE_PHASES` (23:45–00:44) nicht.
  Die Teilchen gehören zur Seite (`layer.js` schiebt sie mit dem Scrollen);
  wer die Null gesehen hat, bekommt den Gruß danach nicht noch einmal.
- Silvester in der App (#642, #739–#743; PR #803): `mobile/src/seasons/newYear/`
  – `fireworks.ts` und `choreography.ts` als Worklet-Port der Web-Rechnung
  (Parität `2787607397` Feuerwerk, `681797588` Choreografie in beiden
  Test-Dateien), `countdown.ts` (wie im Web, dazu `serverOffset`), `sky.ts`
  (`stepFire`/`drawFire` auf dem UI-Thread, Budget 200 „normal“/400
  „kräftig“, Rauch als Ringe mit eigenem Pinsel, Scrollen schiebt mit,
  `fireIdle`/`nextLaunchAt` zum Schlafen), `sound.ts` (eigener Schalter
  `newyear_sounds`, Vorgabe aus, höchstens drei Stimmen, Zischen/Knall als
  WAV im Cache), `index.tsx` (`FireworksSky`: Skia-`Picture` je Bild über
  `useFrameCallback`, weckt sich 1,5 s vor der nächsten Rakete;
  `NewYearWidget` schmal – „noch“ / „42 Min.“ übereinander und ein
  Lautsprecher-Knopf, sonst drückt er den Namen in der Begrüßungskarte weg;
  `NewYearGreeting`: Countdown-Karte oben, Null mit Gruß, einmal am Tag der
  Gruß; was je Jahr nur einmal geschehen darf – Signal, Tippen um 00:00,
  Merker –, steht in `seen` auf Modulebene, weil die Bühne den Gruß bei jedem
  Phasenwechsel neu einhängt). `SeasonProvider` misst den Versatz zur
  Serveruhr. Skia (`@shopify/react-native-skia` 2.6.2) ist nativ – wirkt erst
  mit Build 85; `jest.setup.js` hat Attrappen für Skia (`__skiaDraws`) und
  `runOnJS`.
- Winterhimmel (#730; PR #804): Web `seasons/skyLight.js` (`skyLight` aus
  Sonnenauf-/-untergang und WMO-Code: `night` mit 45 min Dämmerung,
  `warmth` um Auf- und Untergang, `side` 0,7 abends/0,3 morgens, `clouds`,
  `stars`, `moon`; `snowLightAt` Haubenfarben je Lage; `winterStars`),
  `snow/WinterSky.jsx` (wirklich hinter dem Inhalt: z-index −1; `pointFree`
  mit `SKY_BLOCKERS` – der ganze Kasten von Schrift, Bild, Grafik,
  Bedienelement sperrt; Sterne und `WinterMoon` sehen nach Laden, Scrollen
  und Größenänderung neu nach; der Mond tritt zurück, wenn Inhalt über
  seiner Scheibe liegt; Funkeln nur mit Bewegung), `MoonArt.jsx` und
  `moon.js` (Mond und Mondphase, mit #804 aus Halloween in den Kern gezogen;
  `halo` verstärkt den Schein), `SnowCaps.jsx` nimmt `light`/`moonX`. Dafür
  malt nur `<html>` das Schwarz – body, `#root` und das Gerüst in
  `PublicLayout.jsx` sind durchsichtig. App `sky/light.ts` (Parität
  `2188173118` mit `skyLight.test.js`), `snow/WinterSky.tsx`
  (`WinterSkyBackdrop` im Backdrop-Slot: Blauschein, Glühen, wenige stille
  Sterne, oben weich eingeblendet; kein Mond – keine freie Himmelsfläche).
  Der Server schickt `sunrise`, `sunset` und `code` im Wetter schon mit.
- Halloween IV, Feinschliff (Meilenstein 43, #695–#708; PRs #710–#714): Regeln
  in `seasons/quiet.js` (Ruhezonen `QUIET_SELECTOR` – `[data-season-quiet]`,
  Formulare, Dialoge, Menüs, Radix-Popper, Tabellen; `measureQuietZones`,
  `pointInQuiet`, `rectInQuiet`, `watchOverlays`; Bracket trägt
  `data-season-quiet="bracket"`), `seasons/motion.js` (Bewegungsbudget
  `EFFECTS` mit Plätzen, Abklingzeiten, Prioritäten; `createMotionScheduler`
  – `request(kind)` → Token oder null mit `lastReason`, `release`,
  `snapshot`, `subscribe`, versteckter Tab pausiert; Testschalter
  `unlimited`; nie gestartete Klassen haben keine Abklingzeit),
  `seasons/intensity.js` (`pageClass` lebendig/mittel/ruhig/still, `MATRIX`
  je Klasse und Stärke – Fledermäuse, Schwarm, Netze, `cornerWebs`,
  Abseil-Spinne, Krabbler, Schwaden, Augen, seltene Ereignisse, Nebel,
  Jumpscares, Plätze, `footerScene` –, `scaleForViewport` für Tablet/Handy),
  `SeasonStage` setzt `data-season-page` am `<html>`, `pageLayout` würfelt
  wie bisher und kappt danach (`applyCapabilities`; Testschalter
  `setLoadSalt`, die Tests setzen „feinschliff“). Fledermäuse:
  `halloween/perches.js` (Plätze an echten Kanten – Menüpunkte, Kopfzeile,
  Karten-Ecken sitzend und -Unterkante hängend, Rahmen `data-season-perch=
  "frame"`, freistehende Bilder, Löwe hängend, Fußzeilen-Strich; Sonde
  `elementFromPoint` plus Geometrie der Nachbarkarten, Schlüssel je Element,
  `choosePerches`, `nearestFreePerch`), `halloween/batLife.js` (Zustände
  perched → alert → takeoff → flying/approaching → landing → settle, „gone“
  bis ein sichtbarer Platz frei ist; Temperamente sleepy/skittish/roamer/
  curious; Bézier-Bahnen mit Welle und Drehung; `advanceBat(bat, dt, env)`,
  `reactToPointer` mit Pause je Fledermaus, `reactToScroll` mit Fenster;
  höchstens zwei Flüge, Budget `bat_flight`/`bat_scare`), Figur
  `SittingBatShape` und Mondlicht-Saum `RIM_EDGE` in `art.jsx`, Event-Kacheln
  `data-season-perch="card"`. Netze und Karten: `halloween/webCorners.js`
  (obere Innenecken von Karten und Fußzeile im Fenster, je Fensterhöhe
  `cornerWebs`, Sonde mit sechs Punkten, `chooseWebCorners`) und
  `CornerWebs.jsx` (SVG-Netze aus `buildPlan`/`staticLines`, winzige Spinne
  über Budget `web_spider`, Rückzug vor dem Zeiger, Ausweichen unter
  Dialogen; Dateiname bewusst anders als das Modul – Vite verwechselt auf
  Windows Namen, die sich nur in der Schreibung unterscheiden), Karten-Hover
  nur als `box-shadow` über `:root[data-season~="halloween"]` und
  `data-season-page`. Fußzeile als Szene (`Footer`, `useSceneBusy` über den
  Planer, Kürbisse auf dem Strich, erster Kürbis schaut dem Zeiger nach,
  `footerScene` voll/klein/keine). Atmosphäre: `halloween/atmosphere.js`
  (`fogStrength`, `spotFree`/`freeSpots`/`chooseSpot` als Raster mit Sonde,
  `edgeFree`), `Fog.jsx` (zwei Ebenen als `mix-blend-mode: screen`,
  `--fog-strength`, Drift mit `--season-wind`), `Watchers.jsx` (`Eyes`,
  `RareEdge`; Budget `eyes`/`rare_edge`; Testschalter `firstDelayMs`,
  `pauseMs`, `showMs`, `probe`). Schrift misst `seasons/glyphs.js` nur mit
  ihren Zeichenkästen (`blocksPoint`) – ein Textbehälter ist oft kartenbreit.
  Leistung: Fledermaus-Schleife tickt in Ruhe viermal je Sekunde
  (`IDLE_TICK_MS`), Abseil-Spinne wartet grob, Netz-Takt ruht im versteckten
  Tab. Abnahme `e2e/halloween-regression.spec.js` (neun Seiten × 1366/1440/
  1920 und 375/768, Dropdown, Reduced Motion, Saison aus). Probe-Skripte
  im Scratchpad (`probe_hw4b/c/d.cjs`) gegen `vite preview` mit gemockter
  Saison – jede Runde endet mit Screenshots. Effekt-Deps: nie eine je Render
  neue Liste als Effekt-Abhängigkeit (endloser Neustart, OOM in Vitest).
- Saisonneutrale Bausteine (#679–#681): `seasons/audio.js`
  (`createSoundEngine` – AudioContext erst nach der ersten Geste, Regler
  Töne/Musik, `play` mit 150 ms je Quelle, Bus `tls:season-sound` über
  `emitSound`, Ducking, Pause bei verstecktem Tab; `readSoundPrefs` in
  `localStorage` `tls-season-sound`; `setActiveEngine`), `SoundToggle.jsx`
  (drei Stände im Kreis, im Widget-Slot), `astronomy.js` (`moonPosition`
  nach Meeus/SunCalc, `nextMoonEvent`, `skyPlacement` Kuppel Osten links →
  Westen rechts, Horizont bei 86 %, 60° bei 20 %), `MoonInSky.jsx`
  (Minutentakt, Übergang nach dem ersten Bild, `render` von der Saison; Ort
  aus `SeasonContext.location`, Vorgabe Innsbruck). `SeasonStage` erzeugt die
  Engine, sobald ein Modul `sounds` hat (nicht bei „dezent“/„Bewegung
  reduzieren“/Admin); `SeasonContext` liefert `weather`, `location`,
  `scaresAllowed` (`GET /api/seasonal/me`: ab 18 aus `birth_date`, nur
  angemeldet, `private, no-store`). Modulvertrag erweitert um `sounds({season})`
  und `ScareToggle`.
- Erfolge II im Web (PR #656): `components/tls/CommendButton.jsx` (GG-Lob am
  Match), Gelesen-Ping in `NewsDetailPage.jsx`, `useOptionalAuth` in
  `context/AuthContext.jsx` (ohne Provider kein Fehler; Hooks nie in `try`).

**nginx / Uploads (#232, PR #263)**
- Compose hängt `uploads_data:/srv/uploads:ro` ins Frontend; nginx liefert
  `/api/static/uploads/` direkt von der Platte, `expires 30d`, Header
  `X-TLS-Media: nginx|backend`, Fallback `@tls_upload_backend`.
- Die Härtungs-Tests im Backend **zählen nginx-Blöcke** (8× `X-Forwarded-Host`,
  9× CSP-`add_header`) – bei neuen Proxy-Blöcken Zähler anpassen.
- Smoke: `scripts/check-media-serving.py` (CI-Schritt „Verify uploads are
  served by nginx“).

- Winter-Interaktionen (W5 #731; PR #808): die Schneeflocke fangen nach der Temperatur – Frost:
  Kristallbruch mit Splittern, Tauwetter: leises Schmelzen (`seasons/snow/catch.js`, App
  `snow/catch.ts`, gleicher Paritäts-Fingerabdruck); selten eine Spur im Schnee
  (`seasons/snow/tracks.js`, einmal am Tag; `capPath` mit Dellen). App mit dezenter Haptik.
- Saison-Fundstücke öffentlich (#678 Rest; PR #809): Schalter `privacy_season_finds_public` (Vorgabe
  aus) unter Privatsphäre in Web und App; das öffentliche Profil zeigt nur Summen je Saison
  (`components/tls/PublicSeasonFinds.jsx`, App `PublicSeasonFindsCard`).
- Fasching (S12 #643, F1–F3 #745–#747; PR #810): Web `seasons/carnival/` (Konfetti mit eigener Physik
  in `confetti.js`/`layer.js`, Partyhut am Löwen im Kopf und auf der Startseite – noch mit eigener
  Hut-Logik, der Umzug auf `seasons/mascot` aus Ostern steht aus –, Luftschlangen nur über freiem
  Rand `geometry.js`, Gruß), App `mobile/src/seasons/carnival/` (Skia-Konfetti, Partyhut als Widget
  und Tab-Symbol). Abnahme `e2e/carnival-regression.spec.js`.
- Vereinsgeburtstag (S13 #644, B1–B3 #749–#751; PR #811 im #839): Gründungsdatum aus Dolibarr oder
  Handfeld (`services/founding.py`, `years_on`), `services/club_birthday.py` (Gruß, Discord-Ereignis
  `club.birthday`), Jahres-Sticker (`services/season_stickers.py`); Torte mit Kerzen je Jahr
  (Fingerabdruck gleich in Web und App), Konfetti aus der Torte, Wimpel; die Flamme teilt er mit dem
  Adventkranz.
- Wochenrückblick (E12 #622; PR #813): `services/achievement_recap.py` (Mail einmal je Woche,
  abbestellbar – Zeile „Wochenrückblick“ in den Benachrichtigungs-Einstellungen), Erfolg der Woche auf
  Discord, Push-Deckel, Prestige und Rücknahme im Postfach (`xp._announce_prestige`).
- Katalog D Nachtrag (#615; PR #814): Papierkram (`document_opens`), Vorstandsarbeit (Datum je
  Funktion), Sprinter (`profile_completed_at`) sind messbar (`services/member_activity.py`); Katalog D
  hat 37 Gruppen (Stufen: Verein 27, Besonders 16 mit Eierkönig, Geheim 14).
- Erfolge in der App (E13 #623, Admin-Reiter #620; PRs #815–#817, #819, #820 im #839; wirkt mit
  Build 85 = 1.1.0): Admin mit acht Reitern (`pages/admin/achievements/*Tab.jsx`; Massenvergabe in
  einem Schreibzug, Material nur innerhalb der Leiter, Saisonabschluss nur für abgeschlossene
  Saisons). App `mobile/src/achievements/`: `Badge.tsx` mit der Kunst aus dem Web (`npm run
  sync:badge-art` → `badgeArt.generated.ts`; `badgeArt.test.ts` meldet Abweichungen), `ceremony/` (elf
  Auftritte, Auswahl und Warteschlange wie im Web, Partikel, Klang, Haptik je Material), `profile/`
  (Reiter „Erfolge“: Level, Prestige mit 24 h Rücknahme, Als Nächstes, Angeheftet, Vitrinen, Teilen),
  `showcase/` + `AchievementShowcaseScreen` (Bestenliste, Erfolg der Woche, Seltenheit),
  `PublicAchievements` im fremden Profil. Prestige auch im Web; `xp.prestige` meldet sich und gibt
  `own_view` zurück.
- Ostern und Eiersuche (S14 #645, S15 #646/#647, E1–E5 #753–#758; PRs #823–#826 im #839): Backend
  `services/easter_hunt.py` + `routes/easter_routes.py` (`/api/seasonal/easter/*`: Eier je Seite,
  sicherer Fund, Korb, Verlosung über `season_raffles`, Gruppe „Eierkönig“ mit Motiv `egg-king`,
  Vorschau-Token für die Verwaltung). Web `seasons/easterHunt/` (Eier auf den Seiten, `/ostern`,
  `/admin/ostern`) und `seasons/easter/` (Hasenohren über das gemeinsame `seasons/mascot/` –
  Kopf-Scan und `MascotHat`, das Stück im Header per Portal –, Eier-Reihe, Wiese, Blätter, Falter,
  Feldhase, Gruß). App `mobile/src/seasons/easterHunt/` (Eier auf den Saison-Plätzen der Karten,
  `clip` an Plätzen, Korb-Screen `EasterHunt`, Deep Link `/ostern`). Abnahmen
  `easter-hunt.spec.js`, `easter-regression.spec.js`.
- App-Kopfzeile (PR #821): keine leere Fläche unter der Kopfzeile der Unterseiten (`Screen` lässt die
  obere Kante weg; `screenLayout` + `UnderHeaderContext`).
- GG in der App (PR #822): „GG geben“ auf der Matchseite der App wie im Web
  (`/matches/{id}/commend`).
- Startseite I (#832; PR #834): `components/tls/Reveal.jsx` blendet nur die Deckkraft der Inhalte ein
  (die Rahmen bleiben, weil Saison-Deko daran hängt), News-Raster ohne Lücke (`newsCardSpan`),
  Hover-Tiefe über Schatten statt Verschieben, Countdown `tls-tick`, das Licht hinter dem Löwen folgt
  dem Zeiger (`glowOffset`) und atmet – als radialer Verlauf, nie als `blur` (siehe 6.4).
- Turniere I (#833; PR #835): `TournamentCard` (sichtbares Bild, `gameLine`, `cardAction`),
  `BracketTree` (Weg eines Spielers nur mit `(hover: hover)`, Tastatur über :focus-visible, „nicht
  gespielt“ nach dem Ende, Spiel um Platz 3, Podest nur aus der letzten Phase).
- Sammel-PR #839 (3.10.): die vier Stapel (E13, Geburtstag, Ostern, Discord V/VI) und #830 als ein PR –
  Entwürfe hatten nie CI (6.4). Beim Zusammenführen: Abzeichen-Kunst mit `egg-king` neu erzeugt,
  fehlender `HTTPException`-Import in `easter_routes` (F821), Zählung im Adminmenü auf 82,
  Frontend-Job 40 Minuten.

**App**
- Logik ohne UI: `mobile/src/lib/dashboard.ts` (`splitHomeTimeline`,
  `splitOpenAndPast`, `seasonLine`), `lib/format.ts` (Begriffe statt
  Rohwerte), `lib/teams.ts`, `lib/sponsors.ts` (`SPONSOR_TIERS`).
- Bausteine: `components/ContentCard.tsx` (`secondaryLabel`, kein
  „Details“-Knopf mehr), `components/ChatAttachments.tsx` (`AttachmentTile`
  mit Lade-/Fehlerzustand – zeigt den Grund, wenn ein Bild nicht lädt),
  `components/AuthorizedImage.tsx` (Bild mit Anmeldung: Bildlader, sonst
  API-Client als data:-Adresse; #238).
- Updates und „Was ist neu“ (#249, #250, PR #304): `update/AppUpdateProvider.tsx`
  fragt `/api/mobile/app-version?build=` (höchstens einmal pro Stunde),
  zeigt `components/AppUpdateBanner.tsx` (Download mit Anmeldung über
  `expo-file-system/legacy`, MD5/Größe prüfen, Installer über
  `expo-intent-launcher`) und `components/WhatsNewCard.tsx` aus
  `src/whatsnew.json` (`npm run whatsnew` schreibt sie aus `CHANGELOG.md`,
  der Preflight prüft sie). Logik in `lib/appUpdate.ts`, `lib/whatsnew.ts`.
- In-App-Banner (#251): `lib/popups.ts` (bündeln, unterdrücken im offenen
  Chat), Anzeige in `notifications/NotificationContext.tsx` (einer sichtbar,
  5 s, nach oben wischen).
- Bildschirm-Tests: `@testing-library/react-native` 14 macht `render` und
  `fireEvent` **asynchron** – immer `await render(…)`, `await
  fireEvent.press(…)`; sonst „render function has not been called“ (führt in
  die Irre). Vorlagen: `MoreScreen.test.tsx`, `TeamsScreen.test.tsx`,
  `InfoCenterScreen.test.tsx`.
- Der e2e-Test `frontend/e2e/admin-navigation.spec.js` zählt die
  Admin-Menüeinträge (**80** seit #648 Jahreszeiten; 79 seit #561, 77 mit #556) – jeder neue Menüpunkt braucht
  die neue Zahl. **Falle:** zwei parallele PRs, die je eine Zahl setzen, ergeben nach dem
  zweiten Merge eine dritte (24.09.: #550 setzte 60, #552 setzte 73, richtig war 69) – den
  zweiten nach dem Merge des ersten rebasen und die Zahl neu rechnen.

- Jahreszeiten in der App (#636, #655; PRs #650, #659): `mobile/src/seasons/` –
  `SeasonProvider.tsx` (Wahl in SecureStore `season_preference`, Abfrage bei
  AppState, `toast`/`showToast`), `SeasonStage.tsx` (Registry mit
  Corners/Sky/Widget/TabIcon, `useCurrentScreen()` über
  `navigationRef.addListener("state")`, Gruß als Karte unter der Kopfzeile
  `season-toast`), `DecoSetting.tsx` unter Mehr → Darstellung,
  `halloween.tsx` (`screenLayout(screen, intensity)` je Screen, Netzbau,
  Spinne am Faden, Krabbler – Sichtbarkeit über die Uhr, nicht über das
  Animationsende, das endet unter Jest sofort –, Kürbis-Widget und
  Tab-Symbol), `bats.ts`, `rng.ts`, `signals.ts`. RNTL 14: `render`,
  `fireEvent` und `screen.unmount()` sind async – immer `await`, sonst
  „overlapping act() calls“ und alle späteren Fake-Timer-Tests kippen.
  Builds: 1.0.1 = Build 80 (#650), 1.0.2 = Build 81 (#659); 1.0.3 kommt mit
  #665 (Halloween III in der App) vor dem 25.10.

---

## 6. Lokal prüfen (Pflicht vor jedem Push)

### 6.1 Der versionierte Check (jeder PC)

`scripts/local_check.py` liegt im Repo und läuft auf jedem PC mit den
Werkzeugen im PATH: Python 3.11, Node 24 (Web) und Node 20 (App, wie
`ci.yml`), Docker Desktop, Git for Windows und gitleaks. Er führt **alle**
Jobs aus `ci.yml` aus – ohne Bereichsfilter – und legt venvs unter
`~/.local-ci/` ab, nicht im Repo.

```bash
python scripts/local_check.py                          # alles außer extra
python scripts/local_check.py --all                    # plus Zusatzprüfungen
python scripts/local_check.py --only backend,frontend
python scripts/local_check.py --list                   # Schritte anzeigen
```

- Gruppen: `repository` (Secrets, Doku-Links, Shell-Skripte,
  Routen-Vertrag, Zeilenenden, Gitleaks über Historie und ungespeicherte
  Dateien), `backend`, `frontend` (inkl. Playwright), `mobile`, `container`.
- `extra` rechnet GitHub nicht: black/isort, flake8 komplett, mypy,
  Kontrast, ShellCheck, OSV über die Lockfiles. Diese Prüfungen arbeiten mit
  einer Ratsche: `scripts/ci-baseline.json` hält den bekannten Stand fest,
  nur **neue** Befunde schlagen fehl. Nach dem Abbau von Altlasten mit
  `--record` neu aufnehmen und die Baseline mitcommitten.
- Bericht: `.local-testing/local-check.json`, Logs unter
  `.local-testing/logs/`.
- Der Container-Smoke läuft als Compose-Projekt `tls-local-check`; ein
  lokaler Entwicklungs-Stack und seine Volumes bleiben unberührt. Sind die
  Ports 8001/3000 belegt, überspringt der Check den Smoke mit Hinweis.
- Die Git-Bash-Stolpersteine aus 6.4 (`MSYS_NO_PATHCONV`, TMPDIR) setzt der
  Check selbst.
- Neben anderen schweren Läufen können App-Tests an ihrem 5-s-Timeout
  scheitern – das ist Last, allein laufen sie grün.
- `.gitleaks.toml` erlaubt nur geprüfte Testwerte, jeweils an Datei und
  genauen Wert gebunden.
- Findet der Check `docker` oder `gitleaks` nicht, obwohl beide installiert
  sind: VS Code neu starten – der PATH wird beim Start gelesen.
- Vollständiger Lauf (`--all`) am 15.09. auf dem zweiten PC: 41 Schritte
  grün in rund 7 Minuten. Backend 919 bestanden / 20 übersprungen, Web 167
  Vitest- und 146 Browser-Tests, App 89 Tests. Ratsche: 468 Dateien mit
  Formatierungsdrift, 135 flake8-, 111 mypy-, 5 ShellCheck-Altlasten, 0 OSV.

**Erweitern.** `scripts/local_check.py` hat drei Teile: Kopf (Pfade,
Versionen, Ports, Umgebungen), gemeinsamer Kern (Runner, Ratsche, Gitleaks,
OSV, ShellCheck, Dienst-Helfer – dieselbe Kopie liegt in OmniFM,
IT-Tabelander und dolibarr-mahnwesen; ein Fix dort lohnt sich auch hier) und
die LION-Schritte mit `plan()`. Ein Schritt ist eine Funktion
`(context) -> str`: Rückgabe ist die Ergebniszeile, `StepFailed` nennt Grund
und Abhilfe, `StepSkipped` sagt, warum er hier nicht laufen kann.
Eingetragen wird er mit `Step(gruppe, name, beschreibung, aktion, needs)`;
`needs` nennt Schritte derselben Gruppe oder `gruppe/name`. Neue
Befund-Prüfungen laufen über `ratchet()`, CI-Gates nie.

**Maschinenlokal (nicht in Git)** auf dem Haupt-PC (`C:\Programmieren`, seit
16.09. der einzige Arbeitsplatz): Werkzeuge unter `~/.local-toolchain`
(Node 20/22, Go, llvm-mingw); `.ci-panel/test_checks.py` zeigt jeden Schritt
im VS-Code-Testing-Panel (über `.git/info/exclude` ausgeblendet);
`.vscode/tasks.json` ruft die Gruppen des Checks und das Release-Skript auf
(Terminal → Run Task); `C:\Programmieren\check-all.py --serve` ist das
Dashboard über alle Repos, `Programmieren.code-workspace` öffnet alle fünf.

### 6.2 Der alte CI-Spiegel (PC alt, abgelöst)

Bis 15.09. lief auf dem alten PC (`C:\GIT Privat\…`) ein CI-Spiegel
`.vscode/ci_mirror.py` mit Werkzeugen unter `.codex-tools`. Seit dem Umzug
(#273) ist `scripts/local_check.py` der eine Weg; der Spiegel und sein
Werkzeugverzeichnis wurden nicht übernommen. Was davon weiter gilt:

- Playwright: Der Check installiert nur Chromium (wie GitHub). Für
  Firefox/WebKit in `frontend/`: `npx playwright install firefox webkit`,
  dann `CI=true E2E_WORKERS=2 E2E_EXTRA_BROWSERS=1 yarn test:e2e`. Mit mehr
  als 2 Workern hängen Firefox-Admin-Seiten bei „Lade …“ – das ist Last,
  kein App-Fehler. WebKit unter Windows hat einzelne flaky Tests (bestehen
  bei Wiederholung).
- Kennzahlen des vollständigen Checks stehen in 6.1.

### 6.3 Einzelbefehle wie in ci.yml

```bash
# Backend (venv: backend/.venv, Python 3.11)
cd backend && .venv/Scripts/python.exe -m pytest -m "not live" -q
flake8 backend --select=E9,F63,F7,F82 --exclude=backend/tests
# Web
cd frontend && yarn lint && yarn build && yarn test
CI=true E2E_WORKERS=2 yarn test:e2e
# App
cd mobile && npm run typecheck && npm test && npm run test:security && npm run test:release
npx expo install --check
```

### 6.4 Bekannte Stolpersteine

- **Expo-Patch-Versionen:** „Validate Expo config“ (`npx expo install
  --check`) fällt durch, sobald Expo Patches veröffentlicht. Kein
  Code-Fehler. Beheben im nächsten App-PR mit
  `npx expo install expo expo-image-picker expo-notifications` (eigener
  Commit) oder gleich `npx expo install --fix` – mit dem Node 20 aus
  `~/.local-toolchain`, damit `package-lock.json` zum CI passt. Zuletzt am
  21.09. mit #335 nachgezogen (expo 57.0.24, expo-constants 57.0.19,
  expo-image-picker 57.0.19, expo-notifications 57.0.20).
- **Dependabot-PRs prüfen:** alle Zweige in einen eigenen Arbeitsordner
  mergen (`git worktree add -b chore/dependabot-pruefung C:/ldep
  origin/main`, dann `git merge origin/dependabot/…`), dort den lokalen
  Check einmal laufen lassen, Ordner danach mit `git worktree remove`
  entfernen. Ein CI-Job, der nach 2 s „fehlschlägt“ und alle anderen
  überspringt, ist kein Code: die Meldung steht in den Annotations des
  Check-Runs (am 21.09.: GitHub-Abrechnung).
- **Git Bash + Docker:** `MSYS_NO_PATHCONV=1` setzen; Env-Dateien,
  `docker compose cp`-Quellen und curl `-K` brauchen Windows-Pfade
  (`cygpath -w`); `/dev/null` wird zu `C:\dev\null` (leere Datei nehmen);
  `bc` fehlt (awk nehmen); TMPDIR als Windows-Pfad, sonst kommen Volumes leer an.
  Container-Namen sind fest → nur ein Stack gleichzeitig.
- **Vitest:** bei mehreren Treffern `getAllByText` statt `getByText`.
- Heredoc-Skripte mit typografischen Anführungszeichen oder „…“ brechen die
  Shell – Issue-/PR-Texte mit dem Write-Werkzeug in eine Datei schreiben und
  `--body-file` nutzen.
- Nie Arbeit auf einem fremden Feature-Zweig beginnen; wenn doch passiert:
  `git rebase --onto main <alter-zweig> <neuer-zweig>`.
- **Tailwind und Saison-SVGs:** die Vorgabe `svg { max-width: 100% }` lässt
  ein SVG in einem 0 px breiten Halter (`.tls-hbats`, `.tls-ghosts`,
  `.tls-moon-sky` …) auf 0 zusammenfallen – Geister, Fledermäuse und der
  Mond waren so unsichtbar (28./29.09.). Für solche Halter `svg {
  max-width: none }` setzen und in der Browser-Probe die Breite messen.
- **Dateinamen nur in der Groß-/Kleinschreibung verschieden** (`scare.js`
  neben `Scare.jsx`) brechen Importe auf Windows: `./Scare` löst auf die
  Kleinschreibung auf, die Komponente ist `undefined` („Element type is
  invalid“). Deshalb `scareRules.js`.
- **Browser-Proben eines Zweigs:** der lokale Check lässt `frontend/dist`
  liegen – `npx vite preview --port 3011` aus dem Worktree, Playwright mit
  `context.route("**/api/**")` und nachgestellten Antworten
  (`/seasonal/active` wie in `SeasonContext.test.jsx`, `/auth/me`,
  `/seasonal/me`), Skript aus dem Scratchpad mit
  `NODE_PATH=<worktree>/frontend/node_modules`. Canvas-Ebenen über
  `getImageData` zählen. `page.clock.install()` fälscht auch
  `requestAnimationFrame`: nie `runFor(Stunden)` (spielt jeden Frame nach),
  sondern `setSystemTime` und dann `runFor(61000)` für einen Minutentakt.
  Der Consent-Klick ist die erste Geste – vorher messen, was „vor der
  Geste“ gelten soll, und die Klang-Engine erst laden lassen.
- **Sicherheitscheck der App** (`npm run audit:ci`, `mobile/scripts/audit-ci.cjs`):
  sperrt ab „moderate“; Ausnahmen stehen mit Begründung und Frist in
  `mobile/scripts/security-audit-allowlist.json` – nach Ablauf wird der
  Check von selbst rot. Seit #786 hebt `overrides` `@grpc/grpc-js` auf
  1.14.5 (kommt mit dem Firebase-JS-Paket, in der Android-App nie geladen)
  und `brace-expansion` auf 5.0.12; einzige Ausnahme ist
  `GHSA-86W9-CPQP-85RV` (node-forge, keine reparierte Version, nur im
  Expo-Werkzeug zum Signieren von Over-the-air-Updates) bis **02.11.2026** –
  dann neu prüfen.
- **Schließwörter in Commit-Nachrichten:** ein „Fix“ direkt vor der Nummer
  eines anderen PRs schließt ihn beim Merge – so wurde PR #781 am 30.09.
  durch eine Commit-Nachricht von #773 geschlossen (wieder geöffnet, neu
  aufgesetzt). Vor fremden Nummern nie fix/fixes/fixed, close/closes/closed
  oder resolve/resolves/resolved schreiben; das deutsche „Schließt“ schließt
  nichts, jede Nummer braucht ihr eigenes `closes`.
- **Android-Emulator neben dem lokalen Check:** der Emulator (qemu mit
  Software-GPU) belegt die Kerne. Am 02.10. riss der Netzbau-Test der App
  (sonst knapp 4 s) so sein Zeitlimit von 15 s. Vor einem Check den
  Emulator beenden (`adb emu kill`).
- **Gegenprobe mit verstellter Uhr** (#774): Backend in einem Wegwerf-venv mit
  `freezegun` und einem pytest-Plugin, das jede Prüfung bei
  `freeze_time(zeitpunkt, tick=True, real_asyncio=True)` laufen lässt; die
  Anwendung vorher über `flow_harness.load_application()` laden. Web: eigene
  vitest-Konfiguration mit `vi.useFakeTimers({ now, toFake: ["Date"],
  shouldAdvanceTime: true })`; App: jest mit `jest.useFakeTimers({ now,
  advanceTimers: true })`. Ein Kanarien-Test beweist, dass die Uhr ankommt.
- **Worklets:** eine Funktion im Worklet kann keine Variable draußen setzen –
  sie bekommt eine Kopie (Wert außerhalb rechnen, wie `windX` im
  `RainField`). Funktionen, die je Bild laufen, tragen `"worklet"`; was sie
  aufrufen, auch.
- **Metro im CI-Modus** (`CI=1` in den Probe-Skripten) beobachtet keine
  Dateien: nach jeder Änderung während einer Sichtprobe Metro über den Port
  neu starten, sonst lädt die App den alten Stand. Ein eigener Abruf des
  Bundles mit anderen Parametern baut neu und täuscht frischen Code vor
  (#797).
- **Uhr im Emulator zurückstellen:** Android hält API-Antworten nach
  `Cache-Control` (Saisons 60 s) in `cache/http-cache`. Steht die Uhr danach
  vor dem `Date` der Antwort, gilt sie als frisch – die App zeigt die
  Saisonen eines anderen Tages. Vor dem Neustart `adb shell run-as
  at.lionsquad.app rm -rf cache/http-cache`. Kein Fehler der App.
- **Animated in der App:** `setValue()` stoppt die laufende Animation eines
  Werts – und `Animated.parallel` stoppt dann alle anderen. Ein
  Aufräum-Effekt beim Phasenwechsel brach so das Öffnen des Nikolausstiefels
  ab (#798): getrennte Werte für Dauer- und Klick-Bewegung, mit
  `Animated.add` verbinden.
- **Sichtprobe im Emulator:** `uiautomator dump` scheitert, solange etwas
  dauernd animiert („could not get idle state“) – Koordinaten aus dem
  Bildschirmfoto nehmen.
- **Versteckte Elemente in App-Tests:** was unter
  `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"`
  liegt (Lämpchen, Lichterfolge), findet `getByTestId` nur mit
  `{ includeHiddenElements: true }`; `toHaveTextContent("…")` vergleicht den
  ganzen Text – für Teile einen regulären Ausdruck nehmen.
- **Zeitlimit in App-Tests auf GitHub:** der 2-Kern-Rechner ist langsam; der
  Netzbau-Test brauchte bis über 15 s, sobald mehr Testdateien parallel
  liefen (#795) – er hat jetzt 60 s. Tests nie in vielen kleinen
  `act()`-Schritten vorspulen, sondern Zeitpunkte aus dem festen Seed
  vorher ausrechnen und springen.
- **Bewegung in der App auf Android:** bewegte Drehung und Skalierung an
  `react-native-svg`-Gruppen landen auf der Matrix der Android-Ansicht, deren
  Drehpunkt die Ecke der Zeichnung ist – `origin` geht verloren (Flammen
  flogen von links oben ein, der Schwanz der Katze wanderte, ihre Augen
  sprangen über den Kopf; so ausgeliefert in Build 82). Auch
  `transformOrigin` in Prozent war unzuverlässig (ein fest gedrehter Schwanz
  verschwand). Regel: jedes bewegte Teil als eigene `Animated.View`, deren
  Kasten **mittig auf dem Drehpunkt** sitzt (Android dreht und skaliert um
  die Mitte), darin ein kleines Svg mit `viewBox` um den Drehpunkt, nativer
  Treiber. Prüfen mit Signalfarben: fester Teil bei 0° rot, bei −12° grün,
  der bewegte gelb dazwischen.
- **Metro liefert alten Stand:** nach Worktree-Wechseln oder Änderungen an
  Modulen ohne Komponente lieferte Metro (Expo CLI, CI=1) auch mit `--clear`
  alte Dateien. Abhilfe: Metro über den Port 8081 beenden
  (`Get-NetTCPConnection -LocalPort 8081`), `%TEMP%\metro-cache` und
  `%TEMP%\metro-file-map-expo-*` löschen, neu starten, ein frisches Bundle
  holen (alte Datei vorher löschen, HTTP-Code prüfen) und ein Merkmal darin
  suchen, bevor man einem Bildschirmfoto traut.
- **expo-audio:** jeder Spieler legt eine Media3-Media-Session an
  („Media button session is changed to at.lionsquad.app“). `remove()` nimmt
  ihn nur aus der Liste des Moduls – Spieler und Session leben bis zur
  nächsten Speicherbereinigung weiter (6–8 s, so lange gehen die Tasten am
  Kopfhörer an die App). Nach dem Laut `remove()` und `release()`. Ohne
  Plugin-Optionen trägt das Paket Mikrofon und einen Dienst für Wiedergabe
  im Hintergrund ein – beides will Google erklärt haben.
- **Cloudflare vor lionsquad.at:** höchstens 100 MB je Anfrage – größere
  Uploads enden mit HTTP 413, auch von Hand im Admin. Die Release-APK bleibt
  deshalb ohne x86/x86_64 (#793).
- **Jest und `import()`:** dynamisches `await import("…")` scheitert in Jest
  („dynamic import callback … --experimental-vm-modules“). Native Module
  lazy mit `require` in try/catch laden wie `src/lib/installSource.ts`.
- **Sichtprobe der App im Emulator** (AVD `tls`, ohne Fenster): Uhr über
  `adb root`, `settings put global auto_time 0`,
  `setprop persist.sys.timezone Europe/Vienna`, `adb shell date
  MMDDhhmmYYYY.ss`; Backend als Probe-Server (echte App, mongomock,
  freezegun auf dem Zeitpunkt, Port 8010) und Metro mit
  `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8010`, `adb reverse tcp:8081
  tcp:8081`. Für neue native Module einen Debug-Build im Worktree:
  `google-services.json` aus dem Hauptordner kurz hineinkopieren, `expo
  prebuild --platform android --no-install`, `gradlew assembleDebug` (etwa
  5 min), die Datei danach wieder löschen. Aufnahmen mit `adb shell
  screenrecord`, Bilder mit ffmpeg; Git Bash braucht `MSYS_NO_PATHCONV=1`
  für `/sdcard/…` und Windows-Pfade für das Ziel von `adb pull`.
- **GitHub-CI läuft in UTC**, die Maschine hier in Wien: ein Test, der um
  Mitternacht einen Kalendertag erwartet, war lokal grün und in CI rot
  (#803). Erwartung mit demselben Helfer rechnen (`localDay`) statt mit
  festem Datum; vor dem Push `TZ=UTC node node_modules/jest/bin/jest.js …`
  (Node nimmt `TZ` auch unter Windows).
- **Saison-Hintergründe im Web:** `.tls-season-backdrop` (fixed, z-index 0)
  liegt ÜBER nicht positioniertem Inhalt, nur sehr durchsichtig. Wirklich
  dahinter liegt nur, was z-index −1 hat UND vor dem kein Hintergrund malt –
  deshalb malt seit #804 nur `<html>` das Schwarz. Eine spätere Regel
  `body { background }` in `index.css` hebt das wieder auf.
- **Paritäts-Seeds:** im Web heißt der Ort im `seasonSeed` `route`, in der
  App `screen`. Für gleiche Zufallsströme beide mit demselben Wert füllen
  (Winterhimmel: `route: "sky"` / `screen: "sky"`).
- **Widgets im Dashboard-Kopf der App** müssen schmal bleiben (zwei Zeilen,
  Knöpfe als Symbol): ein breites Widget drückt den Namen in der
  Begrüßungskarte auf null Breite – die Karte wird riesig und leer (#803).
- **CI läuft nicht für Entwürfe** (`ci.yml`: `github.event.pull_request.draft == false`, Typen
  opened/synchronize/reopened/ready_for_review): gestapelte Entwurfs-PRs hatten deshalb nie CI. Erst
  der Sammel-PR #839 fand den F821 in `easter_routes.py`, die veraltete Abzeichen-Kunst und die
  Zählung im Adminmenü. Vor jedem Push `flake8 --select=E9,F63,F7,F82` wie im Backend-Job.
- **Squash-Merges und Stapel:** nach dem Squash der Basis kollidiert ein gestapelter PR überall, wo er
  Zeilen der Basis weiter ändert (Drei-Wege-Merge gegen den alten `main`). Will der Betreiber alles
  auf einmal mergen: die Squash-Merges paarweise simulieren (Konfliktbild), konfliktfreie PRs sofort,
  die Stapel samt kollidierender PRs als **einen** Sammel-PR (`git merge --no-ff` je Stapelspitze,
  `git rerere` an, damit spätere `main`-Merges die Lösungen wiederholen); ist die Basis schon
  gesquasht, die Konfliktdateien mit dem alten Basis-Stand als Bezug neu mergen (`git merge-file`).
- **Frontend-Job: 40 Minuten** (seit #839): die Browser-Tests für Desktop und Handy laufen über
  21 Minuten; mit 25 Minuten brach GitHub den Job als „cancelled“ ab – das sieht aus wie ein fremder
  Abbruch. `concurrency: ci-${{ github.ref }}` bricht dagegen wirklich ab, sobald ein neuer Push kommt.
- **Animation auf `filter: blur()`:** ohne Grafikkarte (CI) rechnet der Browser die Unschärfe bei jeder
  Änderung der Deckkraft neu – das Atmen des Lichts hinter dem Löwen drückte den
  Schnee-Leistungstest von 60 auf 30 Bilder je Sekunde. Bewegte Leuchten als `radial-gradient` bauen;
  lokal ist das selbst mit `--disable-gpu` nicht nachzustellen.
- **Neues Motiv im Web → App-Kunst nachziehen:** `npm run sync:badge-art` in `mobile/`, sonst schlägt
  `badgeArt.test.ts` an.
- **Neuer Eintrag im Adminmenü:** `e2e/admin-navigation.spec.js` zählt mit (82 seit „Ostereiersuche“).

---

## 7. App-Release (lokal, nicht per Actions)

- Versionen `0.x.y-beta` bis 1.0; `versionCode` läuft durch (Build-Nummer).
  Tags `mobile-v<version>-build<N>`. Version steht in `mobile/package.json`,
  `package-lock.json`, `app.json` (`version` + `versionCode`), dazu
  `CHANGELOG.md` und `RELEASES.md` im App-PR.
- Geheimes liegt **nur** in `%USERPROFILE%\.lionsapp-release\`
  (`upload.jks`, `signing.json`, `google-services.json`). Neuer Schlüssel seit
  Build 57, Signer-SHA-256 beginnt mit `6f69a289…` und endet auf `…cb98`.
- Gebaut wird in einem **Git-Worktree ohne Leerzeichen im Pfad**, `C:\lsb`
  (Standard des Skripts; das Skript legt ihn selbst an und hält ihn aktuell).
  Ein Projektpfad mit Leerzeichen bricht den nativen reanimated-Build.
- Haupt-PC seit 16.09. (#273): JDK 21 unter `C:\Program Files\Java\jdk-21.0.10`
  (im PATH steht Java 25, das reicht dem Check), Android SDK unter
  `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools, platform-tools, build-tools
  36.0.0, platforms;android-36, ndk;27.1.12297006, cmake;3.22.1 – die
  Versionen aus React Native 0.86 `libs.versions.toml`, Lizenzen
  angenommen), `JAVA_HOME` und `ANDROID_HOME` als Benutzer-Variablen,
  `signing.json` zeigt mit `javaHome`/`androidHome` dorthin.
- `~/.gradle/gradle.properties` setzt `org.gradle.jvmargs=-Xmx6g
  -XX:MaxMetaspaceSize=1g`: Das Expo-Template gibt 2 GB vor, damit stürzt der
  Dex-Merge (`mergeDexRelease`) mit „OutOfMemoryError: Java heap space“ ab.
  Die Benutzerdatei übersteuert die Projektdatei.
- Claude führt das Release selbst aus; der Auto-Modus braucht dafür die
  Freigabe `Bash(npm run release:local*)` in `~/.claude/settings.json`
  (seit 16.09. eingetragen). Der Betreiber installiert danach nur die APK.

```bash
cd mobile
npm run release:local -- --check      # zeigt, was fehlt
npm run release:local -- --dry-run    # bauen und prüfen, nichts veröffentlichen
npm run release:local                 # bauen, prüfen, GitHub-Release und Tag anlegen
npm run release:local -- --upload-only  # nur die zuletzt gebaute APK an den Server schicken (#305)
```

- Erster Build auf einem PC: rund 12 Minuten (npm ci, prebuild, 8 Minuten
  Gradle); danach rund 4 Minuten mit warmem Cache.

- Ändert sich `package-lock.json` (auch nur die Version), läuft `npm ci` neu
  und alles Native baut von vorn (~30 min).
- Der NDK-Linker stürzt beim frischen Build gelegentlich einmal ab („linker
  command failed due to signal“, `libworklets.so`) – einfach erneut starten.
- Eine `| tail`-Pipe verschluckt den Exit-Code: auf „Abgebrochen:“ achten.
- Jest im Worktree kann mit „EPERM: operation not permitted, rename“ im
  Transform-Cache unter `%TEMP%\jest` scheitern, obwohl alle Tests bestehen
  (Windows-Dateisperre). Abhilfe: `%TEMP%\jest` löschen und neu starten.
- `signing.json` ist strenges JSON: ein Komma nach dem letzten Eintrag macht
  sie ungültig; das Skript nennt Zeile und Spalte, nie den Inhalt.
- Nach jedem Versionssprung `npm run whatsnew` (schreibt `src/whatsnew.json`
  aus `CHANGELOG.md`, #249) – der Preflight bricht sonst ab.
- Nach `gh release create` schickt das Skript die APK an den Vereinsserver
  (#250), wenn `uploadUrl`/`uploadToken` in `signing.json` oder
  `LIONSAPP_UPLOAD_URL`/`LIONSAPP_UPLOAD_TOKEN` gesetzt sind (Token =
  `APP_RELEASE_UPLOAD_TOKEN` der Server-`.env`; `docker-compose.yml` muss die
  Variable durchreichen, sonst 401 – #305). Ohne: Hinweis, kein Fehler; dann
  `-- --upload-only` nach dem nächsten `update.sh` oder Admin → System →
  App-Versionen von Hand.
- Nach jedem Build dem Betreiber Klick-Schritte geben (Release-Seite, APK,
  Installation; bei Schlüsselwechsel einmal deinstallieren).
- Versionshinweise für die Play Console nimmt das Skript aus dem
  Changelog-Abschnitt und schneidet bei 500 Zeichen mitten im Satz ab. Ein
  Release-PR enthält deshalb eine eigene Fassung mit höchstens 500 Zeichen
  zum Einfügen von Hand (zuerst in #791). Das Datum im Changelog ist der Tag
  des Builds (1.0.1–1.0.3 trugen Oktober-Daten, berichtigt in #791).
- Die Version folgt dem Plan: Jahreszeiten II läuft als 1.0.x (1.0.4 =
  Build 83), 1.1.0 ist für die Erfolge in der App reserviert (#623).

---

## 8. Deployment (Server)

Der Betreiber deployt **von Hand** mit `update.sh` auf dem Produktivserver.
Backend- und Web-Änderungen greifen **erst danach**. Bei jedem App-Test
fragen, ob der Server aktualisiert ist – Build 59 zeigte alte Termine, weil
#237 noch nicht am Server war. Der Betreiber aktualisiert den Server nach
Meilensteinen, nicht nach jedem PR (16.09.): an `update.sh` nur erinnern, wenn
ein Meilenstein abgeschlossen ist oder ein App-Build Backend-Änderungen
braucht.

---

## 9. Aktueller Stand (3. Oktober 2026)

### Gemergt 3. Oktober
Der Betreiber hat alles Offene gemergt: #807 (Release-PR 1.0.6 – nie gebaut, geht in 1.1.0 auf),
#808 (Winter-Interaktionen, schließt #731), #809 (Fundstücke öffentlich), #810 (Fasching, schließt
#643 und #745–#747), #812 (Gruß-Merker nach dem Tag am Gerät), #813 (Wochenrückblick, schließt
#622), #814 (Katalog D Nachtrag), #818 (App-Audit: braces bis 2.11. akzeptiert), #821
(App-Kopfzeile), #822 (GG in der App), #834 (Startseite I, schließt #832), #835 (Turniere I,
schließt #833) und den **Sammel-PR #839** mit E13 (#815–#817, #819, #820), Vereinsgeburtstag (#811),
Ostern (#823–#826) und Discord V/VI (#827–#831, #836–#838). Die 18 Einzel-PRs sind mit Verweis
geschlossen; mit #839 zu sind #620, #644, #645, #646, #749–#751, #753–#758, #572–#574, #581, #605
und #624–#626. `main` entspricht dem Sammel-Zweig (geprüft). Die Website braucht `update.sh`. Für den
Betreiber: Discord-Rechte für Threads, Willkommenstext prüfen und einschalten, Mitgliederkanal
wählen, Server-Widget einschalten, weitere Server im Reiter „Server“.

### Gemergt 2. Oktober (Nacht)
#801 (Release App 1.0.5 – Build 84 gebaut und veröffentlicht, siehe
App-Builds), #802 (Doku-Stand nach #800), #803 (Silvester in der App mit
Skia, schließt #739–#743; wirkt erst mit Build 85), #804 (Winterhimmel in
Web und App, schließt #730). Die Website braucht `update.sh` (Winterhimmel,
Silvester-Angleichungen im Web).

### Gemergt 2. Oktober (später Abend)
#798 (Nikolaus in Web und App, schließt #736), #799 (Doku-Stand nach #797),
#800 (Silvester im Web, schließt #640). Beide brauchen `update.sh` (neue
Abfragen, Sticker-Paket mit Index, kein Cache um Mitternacht).

### Gemergt 2. Oktober (Abend)
#796 (Doku-Stand nach #795), #797 (Weihnachten in der App: Lichterkette an
der Begrüßungskarte, Gruß einmal am Tag über der Tab-Leiste, warme
Lichtinseln; Abschied im Web jetzt mit Titel „Heilige Drei Könige“ – dafür
braucht die Website `update.sh`, eilt nicht).

### Gemergt 2. Oktober (Nachmittag)
#793 (Release-APK nur für ARM-Handys, 59 statt 105 MB – Cloudflare nimmt
höchstens 100 MB je Anfrage), #794 (Doku-Stand), #795 (Schnee und Wetter in
der App, schließt #771; der erste GitHub-Lauf war rot, weil der Netzbau-Test
sein Zeitlimit riss – siehe 6.4). `update.sh` danach eingespielt.

### Gemergt 2. Oktober (Vormittag)
#788 (Adventkranz in der App, schließt #637 und #727), #789 (Halloween-Katze
in der App: Schwanz an der Wurzel, Augen an Ort und Stelle), #790
(Doku-Stand), #791 (Release 1.0.4, Build 83), #792 (Halloween-Rest in der
App: Karte „Saison-Fundstücke“, die Katze miaut, Schalter „Töne“) – alle
innerhalb von zwei Minuten gemergt, ohne Konflikt (Probe-Merge aller vier
App-Zweige vorher grün, 461 Tests). Danach Build 83 gebaut (siehe
App-Builds).

### Gemergt 30. September – 2. Oktober
#773 (Saison-Fundstücke I: Signale kommen am Server an, Nachmelden nach dem
Login, Datenschutz), #774 (Tests hängen nicht mehr am Kalender; Fristen,
Termine und Alter nach dem Tag in Wien), #777 (Signale aus der App), #776
(Katalog E und die Karte „Saison-Fundstücke“), #778 (Doku-Stand), #781
(gelesen und gesehen zählt; schließt #780), #786 (App-Sicherheits-Update),
#787 (Dependabot: brace-expansion im Web), #785 (Adventkalender komplett –
fasst #782–#784 und den App-Teil zusammen, schließt #641 und #732; die vier
waren gestapelte Entwürfe, der Betreiber wollte einen mergbaren PR). Die
Server-Teile von #773, #774, #776, #781 und #785 brauchen `update.sh` (die
neuen Indizes legt `init_indexes` beim Start an); die App-Teile von #777,
#781 und #785 kommen mit dem nächsten Build.

### Gemergt zuletzt (16.–22. September)
#285/#294/#298 (Mitgliederbereich und Kopfzeile), #286 (App 0.4.1-beta), #299
(#265 Betrieb II), #304 (App 0.5.0-beta), #306/#308 (Release-Upload), #332
(#287–#292 Rollen und Rechte), #336 (#333–#335 Aufräumen), #311–#313
(Dependabot), #337 (#310 Livestreams), #338 (Dolibarr I), #344 (#343 Doku),
#349 (#345 Dolibarr einrichten), #350 (Discord I), #352 (#351
Compose-Override, andere Sitzung), #353 (Anmeldung und Teilen), #354 (App
0.6.0-beta, #355 Tagesgrenze), #356 (Dolibarr II), #357 (App 0.7.0-beta:
Mitgliederbereich, Build 65 am 22.09. gebaut und am Vereinsserver), #359
(#358 Passkey als zweiter Faktor), #360 (Web: Dynamik), #362 (#361
PDF-Worker als JavaScript – nginx kannte .mjs nicht), #363 (Abrechnung I,
Teil 1), #365 (Abrechnung I, Teil 2 – Schreibzugriff beim Betreiber
eingeschaltet, erster Durchlauf am 22.09. bestätigt: Beleg als Entwurf sauber
angelegt), #366 (#364 Mitgliederbereich aufgeräumt), #367 (Leistungen aus
Dolibarr im Event auswählen), #369 (Admin und Turniere – der Spieltag-Lauf
trägt bestehende Liga-Partien beim ersten Lauf nach `update.sh` nach), #371
(Abrechnung II – #319 Startgelder; Epic #314 geschlossen), #372 (#370
Rechnungskonditionen und lesbare Belege), #373 (Nachtrag: deutsche
Konditionstexte, Anleitung zur Kontonummer), #374 (App 0.8.0-beta – Kalender,
Galerie; Build 66 am 22.09. gebaut und am Vereinsserver), #375 (#368
Leitfaden Schritt 2), #376 (#260 Plattform-Konten verknüpfen), #377 (App
0.9.0-beta – #240 Freunde, #245 Laufbanner; `update.sh` für Backend/Admin,
Build 67 vom Haupt-PC), #378 (#302 Discord-Bot im Backend), #379 (#229
Marke: Standard-Favicon, Markenbilder in der App), #380 (#217 Stufe 1
App-Sperre, #219 Teil 1 Bildgrößen und AAB), #381 (#320 eigene Rechnungen für
alle, Rechnungen im Profil) – alle vier am 23.09. gemergt, `update.sh` und
Build 70 danach. Dann #383 (Doku-Stand nach #381) und #384 (#217 Stufe 2
Passkey in der App; `update.sh`, Build 71 am 23.09.) und #385 (#219 Teil 2
Absturzberichte über Crashlytics; nur App, Build 72 am 23.09.) und #386 (#230
Auszeichnungen: Vergabe, Trophäen-Bilder, Profil- und Teambanner in Web und
App; `update.sh`, Build 73 am 23.09.; die alten Turniere trägt der Job
`awards_backfill` von selbst nach – alle 5 min, läuft leer, sobald
Auszeichnungen da sind), #388 (#321 + #322 Abrechnung fertig: Zahlungsstand,
Prüffälle, Erstattungen, Summen je Veranstaltung, Steuersätze bestätigen;
`update.sh`, kein Build) und #389 (#230 Nachtrag: Auszeichnungen im eigenen
Reiter; Build 74 am 23.09., erstmals auch als AAB) und #391 (#390 Konto löschen
in der App + Abschnitt „Konto löschen“ in der Datenschutzerklärung; `update.sh`,
Build 75 am 23.09.), #394 (#219 Googles Play-Signaturschlüssel in assetlinks.json
und Passkey-Login; `update.sh`), #395 (#393 Release-Doku – der Squash landete
im gelöschten Basis-Zweig, Inhalt mit dem Doku-Stand danach nachgeholt) und
#398 (#326 Teil 1 Rechtliches II: Vereinsdaten und Obmann aus Dolibarr,
Datenschutzerklärung aus den echten Schaltern; `update.sh`), #404 (Doku-Stand),
#411 (#396 + #397 Events in der App: Kosten, Teilnehmer, Check-in; `update.sh`),
#413 (#402 Kalender auf der Website mit Abo-Feed; `update.sh`) und #418 (#414
Melden/Blockieren in der App; Build 76 am 23.09. aus #411 + #418), #420
(Doku-Stand), #422 (#403 + #407 Footer und Startseite; `update.sh`), #423
(#421 App-Update je Installationsquelle; Build 77 am 23.09.; `update.sh`),
#424 (#400 QR mit Löwe), #427 (#425 Startseite II; `update.sh`), #428 (#426
Layout am PC), #429 (#408 Adminmenü), #430 (#399 Turnierbaum), #432
(Doku-Stand), #433 (#431 Startseite III), #438 (#434 Admin-Formulare I), #440
(#434 Teil II – der Squash von #439 war in den toten Basiszweig gegangen, #440
hat den Stand nachgezogen), #441 (#435 Seitenblatt, Gruppe Verein), #442 (#435
Seitenblatt eSports/Content/Mitglieder), #443 (#436 Playwright bei drei
Breiten), #444 (Doku-Stand) und #445 (#409 Referenzen mit Einträgen;
`update.sh`), #446 (Doku-Stand nach #445), #448 (#406 „Über den Verein“ aus
echten Daten; `update.sh`), #447 (#405 Sponsoren und Partner aus Dolibarr
als Schalter; `update.sh`; gemergt, während der alte rote CI-Lauf noch
sichtbar war – der Squash enthielt die Korrektur) und #449 (#410
Mitgliederverzeichnis per Opt-in; `update.sh`), #450 (#328 Beitrittsantrag über
Dolibarr; `update.sh`; nach #449 neu aufgesetzt), #451 (Doku-Stand nach #449), #452
(#329 Teil 1 Einwilligungen; `update.sh`), #453 (#417 Wortfilter; `update.sh`, App-Build), #454 (#435 Rest Medien-Seitenblatt; nur Web), #455 (Doku-Stand nach #454), #456 (Rechtliches speichern repariert, Wegweiser in der Admin-Suche; nur Web; `update.sh`), #457 (#409 Referenzen als Erfolgswand; nur Web; `update.sh`), #458 (#260 Nachtrag verknüpfte Konten sichtbar; `update.sh`), #460 (Doku-Stand nach #457), #461 (Dolibarr-Übersicht und Dashboard-Kachel; `update.sh`), #462 (Profil-Sichtbarkeit je Betrachter; `update.sh`), #463 (#416 Verwarnungen mit Stufen; `update.sh`, App-Build), #464 (Doku-Stand nach #462), #465 (Einrichtung im Admin, Prüfung Discord/Twitch/Steam; `update.sh`), #466 (Mein Konto im Menü; nur Web), #467 (Konten verknüpfen II; `update.sh`), #468 (#326 Teil 2 Vorstand aus Dolibarr; `update.sh`), #470 (Menügruppe Verbindungen; nur Web), #471 (Doku-Stand nach #468), #472 (News-Detail am PC breit; nur Web), #473 (Doku-Stand nach #472), #474 (Profilseite neu; nur Web), #475 (Verbindungen ohne Doppeltes; nur Web), #476 (Partnerseiten, #469 Teil 1; `update.sh`), #477 (Doku-Stand nach #475), #478 (#415 Bildprüfung; `update.sh`, App-Build), #479 (Partner II Teil 2; `update.sh`), #480 (#459 verknüpfte Konten in der App; App-Build), #481 (Doku-Stand nach #480), #482 (Partner II Teil 3 Referenzen; `update.sh`), #483 (Partnerseiten in Sitemap und App; `update.sh`, App-Build), #484 (Discord-Bot Fehler als Klickweg, Neustart von selbst; `update.sh`), #485 (#326 Teil 3 Statuten aus Dolibarr, Reiter Rechtliches herausgelöst; `update.sh`), #487 (Doku-Stand nach #485), #486 (#324 Teil 1 Vereinsakte verbinden; `update.sh`, App-Build), #488 (#329 Teil 2 Meine Daten und Austritt; `update.sh`), #489 (App: Expo-Pakete auf SDK-Stand; App-Build), #490 (App: Vereinsakte, eigene Daten, Austritt; App-Build), #491 (Doku-Stand nach #490), #492 (Kanäle aus Dolibarr, Statuten-Archiv, Reiter Social Links; `update.sh`), #493 (Mitgliederverzeichnis aus der Dolibarr-Einwilligung; `update.sh`), #494 (Doku-Stand nach #493), #495 (Klarname bleibt beim Abgleich; `update.sh`), #496 (Mitgliederprofil aus Dolibarr; `update.sh`, Vereine ≥ 1.1), #497 (Doku-Stand nach #496), #498 (Dolibarr-Stand: Zeile Mitgliederverzeichnis; `update.sh`), #499 (Admin → Mitgliederprofile: Hinweis aus Dolibarr; `update.sh`), #500 (Testvertrag auf Vereine 1.1.0), #502 (Doku-Stand nach #500), #518 (Verzeichnis: keine Doppelten, Karte ohne Konto; `update.sh`), #519 (Rundgang-Kleinkram, öffentliches Profil; `update.sh`, App-Build), #520 (Discord no_guild in Klartext; `update.sh`), #522 (Vereinsdaten-Seite; `update.sh`), #523 (Verbindungen ohne Verlink-Seiten; `update.sh`), #524 (Einrichtung als FAQ; `update.sh`), #525 (#517 Teil 1 Alarme; `update.sh`), #526 (#507 Einladung zum Antrag; `update.sh`), #529 (Doku-Stand nach #524), #528 (Website-Profil im Feld-Format, Ersatz für #501; `update.sh`), #530 (#437 Variante A: totes Web-CMS weg, E-Mail-Vorlagen; `update.sh`), #532 (#401 Turnierseite; `update.sh`), #533 (#531 Vereinsakte ohne Einladungscode; `update.sh`, App-Build, Modul 1.4.0), #534 (#231 klassischer Match-Leseweg weg; `update.sh`), #535 (#527 Konten einmal im öffentlichen Profil; `update.sh`, App-Build), #536 (#521 „Mit … verknüpfen“-Knöpfe; `update.sh`, App-Build), #538 (#324 Rest: Vertrag 1.4.0, Rechnungen über die Bindung; `update.sh`), #539 (#510 Dolibarr-Schalter an einem Ort; `update.sh`), #540 (#516 Nutzermenü; `update.sh`, App-Build), #542 (#541 Plattform-Liste der Vereins-Kanäle; `update.sh`, App-Build), #543 (#512 Adminmenü; nur Web), #544 (#506 Vereinsprofil ↔ Konto; `update.sh`) – alle am 24.09. abends gemergt; danach #548 (#545 Google-Prüfung: Rechtstexte im Backend, Crawler-Vorschau mit ganzem Text; `update.sh`), #549 (#546 Einstellungen in die Menüleiste, „Alle Verbindungen“ mit Zustand je Anbindung; `update.sh`), #550 (#517 Teil 2 Betrieb & Logs als eine Seite; `update.sh`), #551 (Doku-Stand nach #544), #552 (#547 Welle 1: FACEIT, start.gg, Roblox, osu!, Lichess, GitHub, Kick, Reddit, Spotify; `update.sh`, App-Build), #553 (#537 Upload-Inventar als Skript; nur Skript), #554 (#223 Teil 1 Turnierbearbeitung in Dateien; nur Web), #555 (#223 Teil 2 Galerie, Fast Lap, Medien; nur Web) – alle am 24.09. nachts gemergt. Am 25.09. früh: #556 (#547 Welle 2; `update.sh`, App-Build), #557 (Doku-Stand nach #555), #560 (#415 Rest Prüffälle verbergen; `update.sh`), #559 (#558 Plattformen an-/abschalten; `update.sh`, App-Build), #561 (#547 Welle 3 Mastodon/Bluesky; `update.sh`, App-Build), #562 (#223 Rest Einstellungen-Seite; nur Web), #563 (#309 GitHub-Releases von selbst; `update.sh`, App-Build). `main` steht auf `05811dc`.

Am 25.09. (früh bis mittags) gemergt: #564 (Doku-Stand nach #563), #565 (#327 Generalversammlung
und Abstimmungen; `update.sh`, App-Build), #582 (#331 Helferdienste; `update.sh`, App-Build), #585
(#239 Sticker und GIFs der Tastatur, App 0.18.0-beta; `update.sh`, Build 78), #586 (#412
Play-Upload per `--play`; nur Skript), #587 (#219 Teil 3 Play-Store-Paket; nur Doku), #588 (#566
Discord III Teil 1: der Bot schickt alle Meldungen, Webhooks weg; `update.sh`, danach Bot verbinden
und Kanäle wählen) – die Meilensteine „App 0.9.0-beta“ und „Vereinsmodul 1.4“ sind geschlossen.

Am 25.09. (mittags bis früher Nachmittag) gemergt: #589 (#567 Discord als persönlicher
Benachrichtigungskanal; `update.sh`), #590 (#568 Erfolge als Gratulation; `update.sh`), #591
(Doku-Stand nach #588), #594 (#593 + #592 App 1.0.0 Play-Fassung ohne Installer; `update.sh`,
**Build 79 = 1.0.0** am 25.09. gebaut – AAB beim Betreiber für den offenen Test in der Play
Console), #595 (#583 Discord-Vorschau, Testkanal, „an mich“; `update.sh`), #596 (#580
Kalender-Knöpfe mit Outlook und Server-ICS; `update.sh`), #597 (#578 YouTube-Videos als News;
`update.sh`), #598 (#584 „Gerade in Steam“; `update.sh`, App-Karte mit der nächsten App-Version) –
der Meilenstein „Discord III“ ist fertig, „App 1.0.0“ hängt nur noch am Store (#219).

Am 25.09. (Nachmittag) gemergt: #599 (#579 Twitch-Clips und „Turnier live“; `update.sh`), #600
(Doku-Stand nach #598), #601 (#569 Einbettungen, die der Bot aktuell hält; `update.sh`), #602 (#570
Discord-Termine; `update.sh`, Bot-Rolle „Events verwalten“), #603 (#571 Bracket-Einbettung, Slash-Antworten
nur für die fragende Person; `update.sh`) – die Meilensteine „Discord IV“ und „Kanäle II“ sind fertig.

### Gemergt 26.–28. September
#607/#608 (Dependabot), #648 (#632/#633 Jahreszeiten: Zeitplan-Dienst,
Abfrage, Admin), #649 (#634/#635 Web-Bühne, Deko-Schalter, Halloween),
#650 (#636 App-Bühne, Halloween in der App, 1.0.1 – Build 80), #651 (#621
Über-uns-Zahlen), #653 (Vorschau wirkt sofort, auch im Admin – Ursache:
Token nur in `sessionStorage`, Bühne im Admin still), #652 (Erfolge II E1),
#657 (#655 Halloween groß – vom Betreiber als „zu übertrieben“ bewertet),
#654 (E7 XP und Level), #656 (E6 Zähler; nach dem Rebase meldete GitHub
„conflicting“, obwohl `git merge-tree` sauber war – ein leerer Commit stieß
die Neuberechnung an), #659 (Halloween-Feinschliff Web + App 1.0.2 –
Build 81; Nebel, Geister, Lichterketten, Friedhof raus, Netzbau, Abseil-
Spinne, echter Mond). Alle vom Betreiber gemergt; `update.sh` danach.

### Gemergt 29. September (Nachmittag und Abend)
#714 (Halloween IV Paket 5), #720 (Doku-Stand), #760–#762 (Halloween IV App
1–3: Plätze, Fledermausleben, Spinnen/Netz/Friedhof/Katze/Nebel, Abnahme –
Meilenstein 43 leer), #763 (Seasonal Core Web), #764 (Seasonal Core App –
schließt #721–#726), #765 (Adventkranz Web), #766 (Schnee Web), #767
(Weihnachten Web: Lichterkette, Gruß), #768 (Rückmeldung: Flocken gehören zur
Seite, Katze miaut), #769 (Doku-Stand), #770 (Wetter das ganze Jahr, schließt
#673). #762 war rot
wegen einer Expo-Drift (`expo install --check` verlangt expo ~57.0.26,
expo-constants ~57.0.20) – nur package.json und Lockfile angehoben. Die
Sichtproben laufen gegen einen Vite-Dev-Server je Worktree (`probe_*.cjs`
mit Playwright, Screenshots an den Betreiber).

### Gemergt 29. September (Vormittag)
#686 (Jumpscares ab 18), #687 (Doku-Stand), #688 (E5 Katalog D), #689–#691
(E9 Sichtbarkeit: Schaukasten, Profil-Reiter, Teilen-Karte), #692–#694 (E8
Abzeichen-Kunst, Zeremonien, Abzeichen in allen Listen), #709 (E10 Teil 1
Admin-Backend), #710–#713 (Halloween IV Pakete 1–4: Fundament, Fledermäuse,
Netze/Karten/Fußzeile, Nebel/Augen). Der Betreiber hat den Meilenstein 43
„Halloween Event 2026 – Feinschliff IV“ (#695–#708) angelegt und merged jeden
PR, sobald er ready ist. GitHub-Falle: „Closes #a, #b, #c“ schließt nur die
erste Nummer – jede Nummer braucht ihr eigenes `closes`; sieben Issues wurden
von Hand geschlossen.

### Gemergt 28.–29. September
#668 (Halloween III), #669 (Doku-Stand), #670 (Physik-Fix: kein Knäuel beim
Scrollen, Gräber sichtbar, Katze auf dem Strich), #671 (#666 echtes Wetter
und Sonnenuntergang), #672 (#665 App 1.0.3 Halloween III – Build 82), #674
(Halloween IV: SVG-Fix, Bahnen in Seitenkoordinaten, Würfeln je Ladung,
Katze läuft), #675 (E2 Katalog A), #676 (Halloween V: Fledermäuse still an
Menü/Buchstaben/Karten, Netz packen und wegwerfen, Katzenbeine, Läufer,
Kürbis-Gruß), #682 (E3 Katalog B samt Saison-Ranglisten und Hebung neu
definierter Gruppen), #684 (Halloween VI Klänge und Musik), #685 (Mond nach
Uhrzeit und Ort), #683 (E4 Katalog C). Der Betreiber merged, sobald ein PR
ready ist; Halloween-Runden kamen aus seinen Screenshots (siehe #658).

### Offene PRs
- Offen (3.10. Nachmittag): #860 Saison-Feinschliff (Faschingshut über `seasons/mascot` mit `crownTop`,
  keine Hasenohren in Web und App, „Ostereier verstecken“ – schließt #855, #857, #858). Aus der Sichtprobe
  des Betreibers vom 3.10. offen: #852 Adventkalender und Nikolaus neben dem Kranz, #853 Silvester mit
  Jahreszahl um 0 Uhr, #854 Discord-Zahl in „Dabei sein“, #856 Geburtstag festlicher, #859
  Vereinsplatzierungen im neuen Design. Release 1.1.0 (#851) ist gebaut (siehe App-Builds). Pausiert auf Wunsch des
  Betreibers: Discord VI D4 (#627) – Backend mit Tests als lokaler WIP-Commit `caef80f4` im Zweig
  `feat/discord-routing` (nicht gepusht), es fehlt die Oberfläche. Neu geplant: Meilenstein
  „Abrechnung III“ (#840 Rechnungs-PDF zuerst – die REST-Freigabe baut kein PDF, `PUT
  /documents/builddoc`; dann #841 und #842, zuletzt #843) und „Vereinsmodul 1.5“ (#844 Abstimmung als
  Popup, #845 Präsenz per Mitgliedskarte, #846 Konten in der Akte, #847 Teilnahmen, #848 Ehrungen,
  #849 Dokumente als Datei, #850 Dolibarr-Events als Entwurf; die Teile im Vereinsmodul hat der
  Betreiber neutral formuliert an die Vereine-Session gegeben). Entscheidung zur Datenpflege
  (Kommentar an #329): der Vorstand pflegt in Dolibarr, Mitglieder beantragen Änderungen. Nachzug:
  `seasons/carnival` auf `seasons/mascot` umstellen.
- Offen (2.10. Nacht): keine Feature-PRs. Als Nächstes W5 #731
  Winter-Interaktionen (Web und App), dann der Release-PR für App 1.0.6
  (Build 85: Silvester mit Skia #803, Winterhimmel #804, W5) – bis Mitte
  Dezember in die Play-Prüfung. Offene Issues: #772 Klammer App-Parität
  (Wunsch des Betreibers vom 29.09.: Wetter und Jahreszeiten sollen in der
  App gleich gut funktionieren – jeder Web-PR einer Jahreszeit nennt sein
  App-Gegenstück; Tabelle aktuell), #744 Abnahme Silvester Web+App (mit
  Build 85), #733 Abnahme Winter, #775 Frühwarnung mit verstellter Uhr
  (Entscheidung A/B/C offen), #678 Rest (Schalter „Fundstücke im
  öffentlichen Profil“). Danach Jahreszeiten II weiter: Eiersuche S15 #646
  (Verlosung über `season_raffles`), Fasching S12 #643 mit F1–F4
  (#745–#748). Offen bleibt:
  Erfolge II Rest (E10 Teil 2 – acht Admin-Reiter im Web –, E12 #622, E13
  #623; die vier zurückgestellten Gruppen aus #614 warten auf
  Datenquellen),
  Halloween VII aus dem nächsten Live-Blick (#677: alles wird
  überarbeitet), App-Fassung von Klang, Mond und Jumpscares (#667),
  Jahreszeiten II (#637–#642 bis 27.11.) von Anfang an nach dem Standard,
  der als Kommentar auf #637–#647 und #658 steht (Bild, Klang und Musik,
  Schrecken mit Rahmen, Himmel nach Uhrzeit, Wetter #673, Fundstücke #678,
  Überarbeitungsregel #677), Discord VI (#624–#631), Jahreszeiten III.
  Owner-Regeln seit 28./29.09.: nichts gilt als fertig (#677); Jumpscares nur
  ab 18 mit Geburtsdatum, 100 % zufällig, keine fremden Bilder (#680);
  Musik live erzeugt (#679); Fledermäuse jede für sich.
- Offen (25.09. Nachmittag): keine Feature-PRs. Nächste Pakete nach der Pause: Discord V (#572
  Thread je Turnier, #573 Link-Knöpfe und Befehle – Antworten `ephemeral`, #574 Willkommensnachricht, #581
  Online-Zahl und Voice auf der Website über das Server-Widget). Idee des Betreibers vom 25.09. (offen):
  „Neueste Videos“ je Mitglied auf dem Profil aus dem YouTube-Feed mit Opt-in (Live je Mitglied geht wegen
  des API-Kontingents nicht). Sonst hängt Offenes am Betreiber oder am Vereinsmodul: App 1.0.0-Rest (#219
  Store-Eintrag – alles in `docs/PLAY_STORE.md`, es fehlt das Entwicklerkonto), Dolibarr III (#330
  Ende-zu-Ende gegen eine Testinstanz, #329 Mandat – dolibarr-vereine#125), Später (#323
  Preisgelder, #575–#577 Discord-Ideen). Frage an den Betreiber (24.09. abends, offen): welche Verbindungen
  nach dem Server-Update fehlten und ob `.env`/Datenbank zurückgespielt wurden – `update.sh` und der
  Code löschen nichts; die Übersicht „Alle Verbindungen“ (#549) zeigt „gespeichert, aber nicht
  lesbar“, wenn der `SETTINGS_ENCRYPTION_KEY` nicht mehr passt. **Stapel-Falle vom 25.09.:** ein
  gestapelter PR, der den Commit seiner Basis noch mit sich trägt, meldet nach dem Squash der Basis
  „conflicting“, obwohl der Inhalt gleich ist – nach dem Merge der Basis immer `git rebase --onto
  origin/main <Basis-Commit>`, damit nur der eigene Commit bleibt.
  **Regel seit
  23.09. abends:**
  Feature-PRs fassen `CLAUDE.md` und `UMBAUPLAN.md` nicht mehr an – die Doku
  (§5-Eintrag, §9, UMBAUPLAN-Block und -Zeile) kommt gebündelt im
  Doku-Stand-PR nach dem Merge; so gibt es die Konflikte zwischen parallelen
  PRs nicht mehr. Danach: #437 Web-CMS (Befund: Seiten-Reiter ist nirgends
  angebunden, E-Mail-Vorlagen werden gebraucht – wartet auf die Entscheidung
  A/B des Betreibers), #401 Turnierseite (Reiter auf einer Seite, „Dein
  Stand“, Termine einmal – Antwort des Betreibers zu Reitern steht noch aus),
  dann Dolibarr III Rest (#326 Teil 2 Vorstandsseite – umgesetzt in #468, Teil 3
  Statuten – umgesetzt in #485; #324 Teil 1 Vereinsakte – umgesetzt in #486; #329 Teil 2 eigene Daten und Austritt – umgesetzt in #488; #329 Rest (Mandat), #324 Rest (Mitglieder-Archiv der Statuten, Rechnungen)
  über `/vereine/me/consents` und `/vereine/members/{id}/consents`; #324
  Dokumente, sobald dolibarr-vereine#157 liefert; #330 Durchläufe) und
  Moderation II (#415–#417, Meilenstein 28, Variante C) nach App 1.0.0; Play
  Console ruht auf Wunsch des Betreibers, bis alles fertig ist; #412
  (Play-Upload per API) wartet auf die Identitätsbestätigung des
  Entwicklerkontos. Beim Betreiber offen: `update.sh` nach #422, #423 und
  #427 (Backend: `club_numbers`, Server-Updater-Schalter, Branding
  `play_store_url`); nach #398: Einstellungen →
  Rechtliches → „Jetzt nachlesen“ → Haken „Vereinsdaten aus Dolibarr
  übernehmen“; den Crashlytics-Absatz aus den Zusatz-Datenschutzhinweisen
  entfernen (steht jetzt fest im Abschnitt LionsAPP).
- Gestapelte PRs: nach jedem
  Squash-Merge die restlichen sofort auf `main` umsetzen (`git rebase --onto
  origin/main <alter Basis-Zweig>`), sonst meldet GitHub „conflicting“, obwohl
  der Baum gleich ist (23.09. dreimal so passiert). **Zweite Falle:** Ein
  gestapelter PR, den der Betreiber merged, solange seine Basis noch der
  Feature-Zweig ist, landet in diesem Zweig – und verschwindet mit dessen
  Löschung (23.09. bei #395: 10 s nach #394 gemergt, Inhalt fehlte auf
  `main`, mit #398 nachgeholt; am 23.09. abends noch einmal bei #439, 9 s
  nach #438 – Nachzug als neuer Zweig aus `origin/<Basis>` plus `git rebase
  main`, PR #440). Deshalb in der Merge-Meldung an den Betreiber immer nur
  **einen** PR nennen; ohne gemeinsame Dateien den nächsten direkt auf `main`
  aufsetzen, sonst als Entwurf stapeln und erst nach dem Merge der Basis
  rebasen, `gh pr edit N --base main` und freigeben.

### App-Builds
- **Build 85** (`mobile-v1.1.0-build85`, Commit ee67572, 03.10.; App 1.1.0 mit E13, Jahreszeiten III,
  Discord im Mitgliederbereich, dazu Silvester mit Skia und der Winterhimmel aus der nie gebauten
  1.0.6). APK nur für ARM (SHA-256 beginnt mit `7d8c20c5`) am Vereinsserver und am GitHub-Release, AAB
  (115 MB, `535aa697`) auf dem Desktop des Betreibers; den Play-Upload macht der Betreiber (Notiz mit
  459 Zeichen im PR #851). Gebaut mit `npm run release:local -- --aab`; #623 und #647 danach mit
  Verweis aufs Release geschlossen.
- **Build 84** (`mobile-v1.0.5-build84`, Commit 155d699, 02.10.; #795 Schnee
  und Wetter, #797 Weihnachten, #798 Nikolaus). APK nur für ARM (60 MB,
  SHA-256 beginnt mit `d0fc588e`) am Vereinsserver und am GitHub-Release,
  AAB (72 MB, `039c9fe9`) auf dem Desktop des Betreibers; den Play-Upload
  macht der Betreiber (Notiz mit 440 Zeichen im PR #801). **Build 85
  (1.0.6)** folgt mit Silvester (#803 – Skia ist nativ, also nur mit neuem
  Build) und dem Winterhimmel (#804).
- **Build 83** (`mobile-v1.0.4-build83`, Commit d7fe6de, 02.10.; #788
  Adventkranz, #789 Katze, #792 Halloween-Rest mit Ton, dazu Adventkalender
  #785, Signale #777, News-Lesen #781). APK-SHA-256 beginnt mit `ca7cb41c`
  (106 MB), AAB-SHA-256 mit `e64f19ad` (72 MB); beides am GitHub-Release, das
  Bundle auch auf dem Desktop des Betreibers. Der Upload der APK an den
  Vereinsserver scheiterte mit HTTP 413: vor lionsquad.at sitzt Cloudflare
  und nimmt höchstens 100 MB je Anfrage (schon bei Build 81 und 82 so). Mit
  #793 enthält die Release-APK nur `armeabi-v7a` und `arm64-v8a` (59 statt
  105 MB); das App-Bundle behält alle vier Arten. Das Play-Dienstkonto
  (`--play`, #412) ist weiter nicht eingerichtet.
- **Build 82** (`mobile-v1.0.3-build82`, Commit 6ff7141, 28.09.; #665
  Halloween III in der App). Die Changelog-Daten von 1.0.1–1.0.3 sind mit
  #791 auf den 28.09. berichtigt.
- **Build 78** (`mobile-v0.18.0-beta-build78`, #585), **Build 79**
  (`mobile-v1.0.0-build79`, #594 – App 1.0.0 für den offenen Play-Test),
  **Build 80** (`mobile-v1.0.1-build80`, Commit 465a627, 28.09.; #650
  Halloween in der App; AAB-SHA-256 beginnt mit `e0c2ac8d`, AAB auf dem
  Desktop), **Build 81** (`mobile-v1.0.2-build81`, Commit 9db5555, 28.09.;
  #659 Halloween-Feinschliff; AAB auf dem Desktop). Die Release-Notizen von
  Build 81 wurden von Hand berichtigt – der CHANGELOG-Eintrag 1.0.2 beschreibt
  noch die Zwischenfassung (Nebel, Geist); mit #665 korrigieren.
- Veröffentlicht: Build 59 (`mobile-v0.3.0-beta-build59`), Build 60
  (`mobile-v0.3.1-beta-build60`), **Build 61** (`mobile-v0.4.0-beta-build61`,
  Commit ec89de6, am 16.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `46b6ce34`), **Build 62** (`mobile-v0.4.1-beta-build62`, Commit e64f840, am
  16.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `89180c42`; #238),
  **Build 63** (`mobile-v0.5.0-beta-build63`, Commit 0b6bc11, am 16.09. vom
  Haupt-PC gebaut, APK-SHA-256 beginnt mit `dc235dff`; #249–#251, #277). Die
  APK liegt seit 16.09. auch am Vereinsserver (nach #306/#308 mit
  `-- --upload-only` nachgereicht), **Build 64** (`mobile-v0.6.0-beta-build64`,
  Commit 5621ed5, am 22.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `44959a8c`; #218), am Vereinsserver abgelegt, **Build 65**
  (`mobile-v0.7.0-beta-build65`, Commit 770aaec, am 22.09. vom Haupt-PC
  gebaut, APK-SHA-256 beginnt mit `02de39d5`; #340, #339, #341, #342, #346),
  am Vereinsserver abgelegt, **Build 66** (`mobile-v0.8.0-beta-build66`,
  Commit b364246, am 22.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `0d1a60d4`; #216, #236, Startgeld-Haken aus #319), am Vereinsserver
  abgelegt, **Build 67** (`mobile-v0.9.0-beta-build67`, Commit 1d02528, am
  23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `aea3415c`; #240,
  #245), am Vereinsserver abgelegt, **Build 70** (`mobile-v0.11.0-beta-build70`,
  Commit 340fadf, am 23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `d7de350c`; #229 App-Teil, #217 Stufe 1, #219 Teil 1, #320 – die Builds 68
  und 69 sind ausgefallen, weil #379–#381 zusammen gemergt wurden), am
  Vereinsserver abgelegt, **Build 71** (`mobile-v0.12.0-beta-build71`, Commit
  b5d5fd3, am 23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `f40d4b20`;
  #217 Stufe 2), am Vereinsserver abgelegt, **Build 72**
  (`mobile-v0.13.0-beta-build72`, Commit 7dbebf8, am 23.09. vom Haupt-PC
  gebaut, APK-SHA-256 beginnt mit `02e19223`; #219 Teil 2 Absturzberichte),
  am Vereinsserver abgelegt, **Build 73** (`mobile-v0.14.0-beta-build73`,
  Commit 2c540e3, am 23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit
  `c1720f6c`; #230 Auszeichnungen), am Vereinsserver abgelegt, **Build 74**
  (`mobile-v0.14.1-beta-build74`, Commit fa80be8, am 23.09. vom Haupt-PC
  gebaut, APK-SHA-256 beginnt mit `c012d680`, erstmals auch als AAB –
  SHA-256 beginnt mit `ff90b730`, am GitHub-Release und auf dem Desktop des
  Betreibers für den internen Play-Test; #230 Nachtrag), am Vereinsserver
  abgelegt, **Build 75** (`mobile-v0.15.0-beta-build75`, Commit 495e4a3, am
  23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `71f5da5d`, AAB-SHA-256
  beginnt mit `4cbc150b`, AAB auch auf dem Desktop des Betreibers; #390 Konto
  löschen – das Bundle für den geschlossenen Play-Test), am Vereinsserver
  abgelegt, **Build 76** (`mobile-v0.16.0-beta-build76`, Commit c572c95, am
  23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `4dd72f5b`, AAB-SHA-256
  beginnt mit `1272baeb`, AAB auf dem Desktop des Betreibers; #396/#397 Events
  in der App + #414 Melden/Blockieren – das Bundle, mit dem die
  Inhaltseinstufung auf „Blockieren/Melden = Ja“ gestellt werden kann), am
  Vereinsserver abgelegt, **Build 77** (`mobile-v0.17.0-beta-build77`, Commit
  87583d3, am 23.09. vom Haupt-PC gebaut, APK-SHA-256 beginnt mit `664355a5`,
  AAB-SHA-256 beginnt mit `21cfce31`, AAB auf dem Desktop des Betreibers; #421
  Play-Update je Installationsquelle, `expo-in-app-updates`), am Vereinsserver
  abgelegt. **Build 78** steht an (`mobile-v0.18.0-beta-build78`, Version in #585 gesetzt: Sticker
  und GIFs der Tastatur, dazu Versammlungen und Abstimmungen, Helferdienste, Beta/Release-Plakette,
  Konten verknüpfen, Bildprüfung im Chat – `npm run release:local -- --aab`, mit eingerichtetem
  Dienstkonto `--play`).

### Erledigungen beim Betreiber
- Nach Build 83 (02.10.): das App-Bundle
  `LionsAPP-v1.0.4-build83-d7fe6de.aab` (Desktop oder GitHub-Release
  `mobile-v1.0.4-build83`) in der Play Console hochladen – erst in den internen
  Test, dann in den geschlossenen Test. Die Versionshinweise mit 426 Zeichen
  stehen in #791. Vor dem 25.10. ausrollen, sonst zählen Kürbis, Fledermäuse,
  Geister und Katze am 31.10. aus der App nicht.
- Nach #773–#787 (30.09.–2.10.): `update.sh` (neue Routen und Sammlungen für
  Signale, Fundstücke, Adventkalender und Verlosungen). Rechtstexte einmal
  lesen: Datenschutzerklärung (Absatz zu den Zählern aus #773, Satz zum
  Adventkalender und Absatz zu Verlosungen aus #785) und die
  Teilnahmebedingungen der Verlosung. Türchen anlegen unter Verwaltung →
  Content → Adventkalender – ohne Türchen zeigt weder Website noch App einen
  Kalender. Offene Entscheidungen: 6 Uhr oder Mitternacht, Vorstand und
  Verwaltung in Verlosungen, wer zieht, Hauptgewinn unter allen mit 24
  Türchen; #775 A/B/C.
- Nach #556–#563 (25.09. früh): `update.sh` und App-Build (Build 78: Plattformen Welle 2 und 3,
  Plattform-Haken, Beta/Release-Plakette mit Rückfrage beim Update). Danach: Verbindungen → Alle
  Verbindungen → „Plattformen für Mitglieder“ – abhaken, was der Verein nicht anbieten will („Alle
  aus“ + einzeln an geht schnell); für neue Plattformen je eine App anlegen (Anleitung auf der Seite;
  Meta/LinkedIn/Snap/Pinterest brauchen ein App-Review, vorher nur Tester); Mastodon und Bluesky
  einmal mit dem eigenen Konto durchspielen (erster echter Durchlauf – scheitert er, steht der Grund
  im Profil und unter Betrieb & Logs). System → App-Versionen: feinkörniges GitHub-Token (nur Lesen
  von Contents dieses Repos) eintragen, „Jetzt abgleichen“; Schalter „Betas gleich ausrollen“ steht
  an. Moderation → Bildprüfung: ein Avatar in Prüfung ist jetzt ein Platzhalter, bis jemand
  entscheidet – die Warteschlange gelegentlich ansehen.
- Nach #548–#555 (24.09. nachts): `update.sh` und App-Build (Welle 1 der Plattformen in der App).
  Danach: Verbindungen → Alle Verbindungen öffnen (Zustand jeder Anbindung; „nicht lesbar“ heißt:
  `SETTINGS_ENCRYPTION_KEY` in der Server-`.env` prüfen oder Zugangsdaten neu eintragen); System →
  Betrieb & Logs ansehen (die alten Log-Seiten leiten um); für neue Plattformen je eine App
  anlegen – Anleitung, Rückrufadresse zum Kopieren und „prüfen“ stehen auf der Seite der
  Plattform. Upload-Inventar bei Gelegenheit im Backend-Container: `python
  scripts/uploads-inventory.py` (nur lesend, Bericht als Markdown; Löschen bleibt Handarbeit).
- Nach #525–#544 (24.09. abends): `update.sh` und App-Build (Vereinsakte-Karten, Konten-Kasten,
  „Mit … verknüpfen“, Mehr-Menü). Vereinsmodul **1.4.0** installieren (`module_vereine-1.4.0.zip`,
  Modul einmal aus/ein), dem Website-API-Benutzer die Rechte „Über die API im Namen jedes
  Mitglieds handeln“ und „… abstimmen“ geben, dann Dolibarr → „Jetzt abgleichen“ – ab da
  brauchen Mitglieder mit bestätigter Zuordnung keinen Einladungscode mehr (Stand-Zeile
  „Zugriff für Mitglieder“ auf der Dolibarr-Seite sagt, ob das Recht fehlt). Betrieb → Alarme:
  E-Mail-Empfänger eintragen, Testalarm. Nach #548: in der Google Cloud Console Anwendungsname
  **THE LION SQUAD**, Startseite `https://lionsquad.at/`, Datenschutz `…/privacy`,
  Nutzungsbedingungen `…/terms`, Prüfung erneut anstoßen. Nach #549: Verbindungen → Alle
  Verbindungen öffnen – steht dort „gespeichert, aber nicht lesbar“, den alten
  `SETTINGS_ENCRYPTION_KEY` in der `.env` wiederherstellen oder die Zugangsdaten neu eintragen.
- Nach #518–#524 (25.09.): `update.sh` und App-Build; Dolibarr → „Jetzt abgleichen“ (Doppelte
  verschwinden beim ersten vollen Lauf); Betrieb → Alarme prüfen, sobald #525 drin ist.
- Nach #498, #499 (25.09.): `update.sh` (ein Lauf zusammen mit #495/#496 reicht).
- Nach #495, #496 (25.09.): `update.sh`. Im Vereinsmodul (ab 1.1.0): unter Einrichtung →
  Einwilligungen die Einwilligung für das Website-Profil wählen (die Website nimmt dieselbe
  fürs Verzeichnis, wenn dort keine gewählt ist); auf der Mitgliedskarte (Reiter Verein →
  Website-Profil) Gamertag, Kurztext, Spiele eintragen – das Foto ist das der Mitgliedskarte.
  Auf der Website: bei Mitgliedern ohne öffentlichen Nachnamen den Klarnamen selbst setzen.
- Nach #492, #493 (25.09.): `update.sh`. Im Vereinsmodul: die öffentlichen Kanäle unter
  Einrichtung → Vereine → Kanäle und Konten pflegen, dann auf der Website unter Social Links
  den Haken „Kanäle aus Dolibarr übernehmen“ setzen; einen Einwilligungstext „Nennung im
  Mitgliederverzeichnis“ anlegen, Mitglieder zustimmen lassen, unter Dolibarr → Verbindung
  diesen Text auswählen; danach unter Verein → Mitgliederprofile Foto und Bio ergänzen.
- Nach #486, #488, #489, #490 (25.09.): `update.sh` und App-Build. Im Vereinsmodul:
  dem Website-Benutzer das Recht „Für Personen handeln“ geben; unter Einrichtung →
  Externe Identitäten eine Einladung für dich erzeugen (Fähigkeiten „Dokumente“ und
  „eigene Daten“) und den Code unter Meine Mitgliedschaft → Vereinsakte einlösen;
  Kündigungsregel und „sofort“-Felder prüfen. Danach: Vereinsdokumente und „Meine
  Daten“ ansehen (Web und App).
- Nach #482, #483, #484, #485 (24.09.): `update.sh` und App-Build. Discord: im Developer Portal → deine App →
  Bot → „Privileged Gateway Intents“ den „Server Members Intent“ einschalten, „Save Changes“ –
  der Bot verbindet sich danach innerhalb von fünf Minuten von selbst (Stand unter Verbindungen →
  Discord). Dolibarr: Einrichtung → Statuten → Freigabe „Öffentlichkeit“, sonst bleibt der
  Statuten-Kasten der Vorstandsseite wie bisher; danach Vorstandsseite und Rechtliches (Zeile
  „Statuten“) ansehen. Referenzen: bei Turnieren mit PineApps den Partner-Haken setzen.
- Nach #476, #478, #479, #480 (24.09.): `update.sh` (Backend-Image neu: NudeNet/ONNX,
  der Build dauert einmalig länger) und App-Build. Danach: Admin → Moderation →
  Bildprüfung: Anbieter-Stand muss grün sein (NudeNet geladen), Schwellen
  lassen, die Warteschlange gelegentlich ansehen; Admin → Partner: bei PineApps
  Kanäle (Discord-Einladung + Server-ID mit eingeschaltetem Widget, Twitch-Kanal,
  YouTube), „seit“, Text und das TFT-Dashboard als Tool eintragen; bei Events und
  Turnieren mit PineApps den Partner-Haken setzen;
  offen aus #415: AWS Rekognition (bei Bedarf).
- Nach #474, #475 (24.09.): `update.sh`. Danach: Profilseite ansehen (fünf Reiter,
  Konten-Karte, Twitch nur live); Discord und Twitch nur noch unter Verbindungen
  (die Einstellungen haben die Reiter nicht mehr, alte Links leiten um).
- Nach #463, #465–#468, #470, #472 (24.09.): `update.sh` – der Server lief bis dahin ohne
  #463–#466 (kein `update.sh` seit dem Vorabend; die Anleitungen fehlten
  deshalb live). Danach: System → Einrichtung durchgehen (fehlende stehen
  offen), je Dienst die eigene Seite unter Verbindungen; Login & Konten →
  „prüfen“ bei Discord; Moderation → Stufen prüfen; Vorstand: in Dolibarr
  die Zustimmung zur Nennung je Person setzen, Fotos über den eigenen
  Verzeichnis-Eintrag; App-Build (Moderationskarte, verknüpfte Konten #459).
  Reihenfolge am 24.09. vom Betreiber freigegeben („was Sinn macht“):
  Profilseite (erledigt, #474), Partner II Teil 1 (erledigt, #476), #415
  Bildprüfung (erledigt, #478), Partner II Teil 2 (erledigt, #479), App-Karte
  #459 (erledigt, #480). Danach offen: #437 (CMS A/B) und #401 (Turnierseite) warten
  auf Antworten des Betreibers; #231 auf den Trockenlauf; #239 braucht ein
  eigenes Android-Modul.
- Nach #461, #462 (24.09.): `update.sh`. Discord-App (Client ID + Secret aus
  dem Developer Portal, App des Bots, Reiter OAuth2; Rückrufadresse unter
  Redirects) und Twitch-Rückrufadresse in der Developer Console eintragen
  (beides für „morgen“ angekündigt), dann im Profil verknüpfen. Profil →
  Privatsphäre → Gaming: Steam auf „Öffentlich“, wenn es alle sehen sollen.
- Nach #456, #457 (24.09.): `update.sh`. Dann Einstellungen → Rechtliches →
  Haken „Vereinsdaten aus Dolibarr übernehmen“ → „Rechtliches speichern“
  (bisher scheiterte das Speichern an der Analytics-Prüfung; danach kommen
  Name, ZVR, Behörde, Anschrift, Telefon, Obmann aus Dolibarr, „Über uns“
  zieht Gründung/Zweck/gemeinnützig nach). SEO & Analytics: Measurement-ID
  eintragen oder Analytics auf „Keine“ (heute Google ohne ID = zählt nichts).
  Nach #458: Discord Developer Portal → App des Bots → OAuth2 → Client ID +
  Client Secret in Einstellungen → Login & Konten speichern und dort die
  Rückrufadresse bei Redirects eintragen; Twitch Developer Console → App →
  OAuth Redirect URLs → `https://lionsquad.at/api/platform-links/twitch/
  callback` (ohne Schrägstrich am Ende, Client-Typ Confidential); dann im
  Profil verknüpfen – ein Fehler nennt jetzt den Grund der Plattform.
- Nach #450, #452, #453 (23.09.): `update.sh`. Beitrittsantrag über Dolibarr: in
  Dolibarr dem Website-API-Benutzer das Recht „Beitrittsanträge über die API
  anlegen“ geben (deckt auch die Einwilligungen), unter Einrichtung › Vereine ›
  Mitgliedsantrag die Pflichtfelder prüfen, dann in Finanzen → Dolibarr-
  Anbindung → Verbindung den Haken „Beitrittsanträge nach Dolibarr senden“
  setzen (nur im Modus Live wirksam). Wortfilter: Admin → Moderation →
  Wortfilter füllen und einschalten (ab Werk aus); App-Build für die
  Chat-Anzeige „wird geprüft“.
- Nach #447, #448, #449 (23.09.): `update.sh`. Dann: Admin → Verein → Über uns
  einmal ansehen (Standard = der alte Text; Gründungsjahr, Zweck und
  „gemeinnützig“ eintragen oder „Vereinsdaten aus Dolibarr“ einschalten).
  Sponsoren: erst wenn sie in Dolibarr als Geschäftspartner in den Kategorien
  „Sponsor“/„Partner“ (Unterkategorien = Stufe/Art, Zusatzfelder
  `sponsor_start`/`sponsor_end`) gepflegt sind, den Haken auf der
  Sponsorenseite setzen – vorher bleibt alles Handpflege. Mitglieder
  erfahren über „Meine Mitgliedschaft“, dass sie sich ins Verzeichnis
  eintragen können; die alte Handliste bleibt.
- Nach #445 (23.09.): `update.sh` (Backend: Referenzen mit Einträgen). Danach
  in Admin → Verein → Referenzen die alten Einträge einmal öffnen und
  speichern – bis dahin leitet der Server Plattform, Format, Liga und Saison
  aus dem Titel ab, danach stehen sie fest in den Feldern.
- `update.sh` nach #332, falls noch nicht geschehen. Danach gilt: Club-Admins
  brauchen auch für Mitglieder, Dokumente und Einstellungen eine bestätigte
  Zwei-Faktor-Anmeldung; eine Turnierleitung sieht News, Galerie und
  Sponsoren nicht mehr. Freigaben (Redaktion, Vereinsverwaltung,
  Turnierleitung) vergibt der Superadmin unter Admin → Alle Benutzer; wer
  einen Vorstandsposten hält, hat die Vereinsverwaltung von selbst.
- Discord: Betriebs-Webhook eintragen, falls noch nicht geschehen
  (Einstellungen → Discord), sonst gibt es keine Alarme. Für News und Events
  im Discord die beiden Schalter dort einschalten.
- Nach #378–#381 (23.09.): `update.sh` (neue Backend-Abhängigkeit discord.py),
  dann Einstellungen → Discord → „Discord-Bot“ einrichten (Token, Server
  Members Intent, Bot auf den Server, „Bot verbinden“) und Einstellungen →
  Branding → „Aus Logo und Akzentfarbe erzeugen“ (Standard-Favicon für helle
  Tableisten).
- Nach #384–#386 (23.09.): `update.sh` ist gelaufen. Offen beim Betreiber:
  den Absatz zu den Absturzberichten (Vorschlag am Issue #219) in die
  Datenschutzerklärung einfügen, bevor Build 72+ breit verteilt wird; das
  Google-Play-Konto anlegen und die Store-Texte an #219 bestätigen; für #231
  am Server `bash scripts/tournament-dryrun.sh` laufen lassen und die
  Zähl-Zeilen schicken.
- Play Console (23.09.): Build 75 läuft im internen Test (Rollout 14:37).
  Play App Signing ist aktiv; der SHA-256 des App-Signaturschlüssels
  (`1D:10:7A:DD…BA:26`, Seite „Mit Google Play geschützt“ → „Play
  App-Signatur verwalten“) ist mit #394 in `assetlinks.json` und
  `DEFAULT_APK_KEY_HASHES` eingetragen – nach `update.sh` gehen Passkeys auch
  in der Play-Version. Noch offen beim Betreiber (Play Console ruht auf seinen
  Wunsch, bis alles fertig ist): Build 77 (AAB auf dem Desktop, Build 76
  ebenso) in den internen Test laden, danach Inhaltseinstufung „Blockieren“
  und „Melden“ auf Ja; sobald der Eintrag öffentlich ist: Branding →
  „Play-Store-Link“ eintragen (Badge in Footer und Startseite) und Admin →
  App-Versionen → „Server-Updater anbieten“ aus; Testkonto `playtest` (normales Konto, keine
  Zwei-Faktor, **aktives Mitglied**, damit die Prüfer den Mitgliederbereich
  sehen) anlegen und unter App-Zugriff eintragen (Text auf Englisch, siehe
  Chat vom 23.09.); „App einrichten“ nach der Tabelle vom 23.09. abends
  (Anzeigen Nein, IARC „Alle anderen App-Typen“, Zielgruppe 13+, Datensicherheit
  → Lösch-Link `https://lionsquad.at/privacy#account-deletion`, Kategorie
  Sport); Screenshots vom Handy; Tester-Liste und Beitrittslink. Die Seite
  „API-Zugriff“ erscheint erst nach der Identitätsbestätigung (#412).
- Server: `docker-compose.override.yml` mit dem Host-Eintrag für
  `erp.lionsquad.at` ist seit 21.09. angelegt (#351) – Dolibarr ist wieder
  erreichbar; `update.sh` fasst die Datei nie an.
- GitHub → Settings → Billing and plans ansehen: am 21.09. um 02:18 UTC hat
  GitHub Actions-Jobs wegen Zahlung/Ausgabenlimit nicht gestartet (um 15:35
  lief der CI wieder).
- #310: erledigt am 21.09. – das Twitch-Client-Secret fehlte, der Betreiber
  hat es neu eingetragen, die Kanäle werden wieder erkannt. Nach dem Merge von
  #337 und `update.sh` zeigt Einstellungen → Twitch je Kanal, ob er auf die
  Startseite käme.

### Meilensteine und offene Issues (20 offen nach dem Merge von #398 und dem Schließen von #393; #396, #397 im Meilenstein App 1.0.0, #399–#403 aus der Prüfrunde vom 23.09. noch ohne Meilenstein – legt der Betreiber an)
Seit 21.09. hängt **jedes** offene Issue an einem Meilenstein; alle
Dolibarr-Issues tragen das Label `dolibarr`. Fertige Meilensteine sind auf
GitHub geschlossen. Die Einordnung der Dolibarr-Issues steht als Kommentar an
#314.

| Meilenstein | Issues |
| --- | --- |
| Web: Tempo und Betrieb | #310 Livestreams der Mitglieder fehlten auf der Startseite (Ursache: Twitch-Client-Secret fehlte, die Abfrage übersprang still; Diagnose in #337), #223 große Admin-Dateien (Twitch-Reiter ist herausgelöst), #231 klassischer Match-Leseweg, #364 Mitgliederbereich Web: Einstieg, Vollständigkeit, Altlasten (Wunsch vom 22.09.) – umgesetzt in #366; #231 klassischer Match-Leseweg – umgesetzt in #534 (24.09.); #223 Teile 1 und 2 in #554/#555 (Turnier, Galerie, Fast Lap, Medien in Dateien je Bereich); der Rest von #223 (`AdminSettingsPage` in Abschnitte) in #562 – der Meilenstein ist durch |
| Dolibarr I: Anbindung und Mitgliedschaft | #295 Mitgliedschaft und Beitragsstand automatisch und #297 Vereinsrechte aus Funktionen – umgesetzt in #338; #316 und #330 sind mit ihrem ersten Teil drin und wandern mit dem Rest weiter (siehe unten) |
| Dolibarr II: Eigene Rechnungen und PDF | #296 Rechnungs-Lesedienst, PDF-Archiv, Zahlungsweg aus Dolibarr; #325 ein PDF-Betrachter für Web (App: #341) – umgesetzt in #356 |
| Abrechnung I: Grundlage und Events | Teil 1 in #363 (#315, #318), Teil 2 in #365 (#316 Kundenanlage, #317 Belege ohne Dubletten, #322 Finanzübersicht mit Zuordnung/Freigabe). #370 Rechnungskonditionen (30 Tage, Überweisung, Girokonto) und lesbare Belegtexte mit Zusatz – umgesetzt in #372. #320 eigene Rechnungen für alle (Nicht-Mitglieder über die Einzelbelege ihrer Vorgänge, Quelle je Beleg, Filter, App-Bildschirm) – umgesetzt in #381. #321 Zahlungsstand im Detail, Prüffälle (Storno/Änderung nach dem Beleg, Überzahlung, Abweichung, verschwundener Beleg), Erstattungen mit Nachweis und #322 Rest (Filter, Summen je Veranstaltung, Zeitleiste, CSV, Steuersätze bestätigen, Runbook, Aufbewahrung) – umgesetzt in #388. Der Meilenstein ist durch |
| Abrechnung II: Turniere | #319 Startgelder (Zahler = anmeldende Person, Roster zählt, Preis erst mit der Freigabe), #314 Epic – umgesetzt in #371; Einzelrechnungen je Spieler bleiben eine spätere Stufe |
| Dolibarr III: Dokumente, Vereinsseiten, Mitgliedschaft online | #326 Vereinsdaten und Vorstand aus Dolibarr – Teil 1 in #398 (Rechtliches II: Impressum/Kontakt/Datenschutz aus `/vereine/organization` + `/vereine/board`, Datenschutzerklärung aus den echten Schaltern); Rest (Statuten, öffentliche Vorstandsseite) wartet auf dolibarr-vereine#158. #324 Dokumente, #328 Beitrittsantrag, #329 Einwilligungen/eigene Daten/Austritt, #330 Rest: Durchläufe – das Vereinsmodul 0.7.0 (23.09.) liefert Antrag, Einwilligungen und Antragsstand über die API; Dokumente (#157) noch nicht. Nachtrag 24.09.: Feld-Format (Vereine 1.2.0) in #528; #531 Vereinsakte ohne Einladungscode (Vereine 1.4.0) in #533; #324 Rest (eigene Rechnungen über die Bindung, Vertrag 1.4.0) in #538; #537 Upload-Inventar in #553; offen: #329 Mandat |
| Discord I: Kanäle und Meldungen | #300 ein Webhook je Zweck mit Schaltern, #301 Erfolge sofort auswerten und gebündelt melden, #303 Meldungen mit Bild und Vorschau – umgesetzt in #350 |
| Discord II: Konto-Verknüpfung und Bot | #260 Plattform-Konten verknüpfen (Discord OAuth2, Twitch OAuth2, Steam OpenID; verifiziert im Profil) – umgesetzt in #376; #302 Discord-Bot (im Backend, Token im Admin; zählt Nachrichten verknüpfter Konten, gleicht die drei Rollen ab, vier Slash-Befehle) – umgesetzt in #378. Der Betreiber richtet den Bot nach dem Merge im Admin ein. Nachtrag 24.09.: #521 offizielle „Mit … verknüpfen“-Knöpfe in #536, #541 Plattform-Liste der Vereins-Kanäle in #542; #545 Google-Prüfung in #548; #547 Welle 1 (FACEIT, start.gg, Roblox, osu!, Lichess, GitHub, Kick, Reddit, Spotify) in #552, Welle 2 (Threads, Facebook, LinkedIn, Snapchat, Pinterest, Telegram, Wargaming, Bungie) in #556, Welle 3 (Mastodon, Bluesky) in #561; #558 Haken je Plattform in #559 – der Meilenstein ist durch |
| Web: Anmeldung und Teilen | #348 angemeldet bleiben, Passkey anbieten, Zwei-Faktor für alle einrichtbar; #347 neutrale Link-Vorschau für Vereinsinhalte – umgesetzt in #353. Nachtrag #358 (Meilenstein Spaeter): Passkey mit Gerätesperre zählt als zweiter Faktor – Entscheidung des Betreibers vom 22.09. (Variante B), umgesetzt in #359 |
| Web: Dynamik | #224 Startseite (Countdown, Live-Zahlen, „Neu“), #225 Turnierseiten (Zeilen gleiten, Rahmen am Match, „gerade eingetragen“ + Hinweis), #226 Skelette statt „Lade …“ und Einblenden beim Seitenwechsel – umgesetzt in #360 |
| Admin und Turniere | #203 Events an mehreren Standorten, #204 Ort/Stadt und Karte aus der Adresse, #227 Tageszentrale erweitert, #228 Turnier-Leitfaden (Schritt 1), #235 geltenden Termin in die Partie schreiben – umgesetzt in #369; #368 Leitfaden Schritt 2 („Voreinstellung übernehmen“) – umgesetzt in #375 |
| Auszeichnungen und Marke | #229 Standard-Favicon für hell und dunkel (im Admin erzeugt) und Markenbilder/Vereinsname in der App – umgesetzt in #379, im Build 70 vom 23.09. #230 Gewinnerbanner und Trophäen – Entscheidungen am 23.09. bestätigt („passt“: Daten bei der Vergabe, Bild beim Ansehen, Bilder für Platz 1–3 je Turnier hochladen, Korrektur = erneut veröffentlichen). umgesetzt in #386 (Web, Teams, App), im Build 73 vom 23.09. Der Meilenstein ist durch |
| App 0.6.0-beta | #218 Erfolge mit Symbolen, Fortschritt und Freischalt-Moment – umgesetzt in #354, Build 64 nach dem Merge |
| App 0.7.0-beta: Mitgliederbereich | Wunsch des Betreibers vom 21.09.: der Mitgliederbereich auch in der LionsAPP. #340 eigener Einstieg und Aufbau wie im Web, #339 Meine Mitgliedschaft mit Beitragsstand und Belegen, #341 Vereinsdokumente (nur im privaten App-Speicher), #342 interne Events und News kennzeichnen – Meldungen nur an Berechtigte, #346 digitale Mitgliedskarte mit QR-Code (Web und App, Wallet vorbereitet) – umgesetzt in #357, Build 65 nach dem Merge. #327–#329 bringen ihren App-Teil selbst mit. Die Meilensteine dahinter sind am 22.09. um eins gerückt (Kalender/Galerie → 0.8.0, Sticker/Freunde/Laufbanner → 0.9.0) |
| App 0.8.0-beta | #216 Kalender (App: Monatsansicht, „In meinen Kalender“ per Gerätekalender/Google; Web: .ics + Google), #236 Galerie in der App – umgesetzt in #374, Build 66 am 22.09. gebaut. Persönlicher Kalender-Feed (`kalender.ics?token=`) bleibt „später, optional“ aus #216 |
| App 0.9.0-beta | #240 Freundschaftsanfragen (App: Knopf im Profil, Karte „Freunde“, live), #245 Laufbanner (Kanäle Web/App, Ticker über den Tabs) – umgesetzt in #377, Build 67 am 23.09. gebaut. #239 Sticker/GIFs der Tastatur – umgesetzt in #585 (lokales Expo-Modul `keyboard-image-input`, GIF bleibt GIF), Build 78; der Meilenstein ist geschlossen |
| App 1.0.0 | #217 Stufe 1 App-Sperre (Fingerabdruck/Gesicht/Gerätesperre beim Start und nach einer Minute im Hintergrund) – umgesetzt in #380, im Build 70 vom 23.09.; Stufe 2 Passkey-Login in der App – umgesetzt in #384, im Build 71 vom 23.09. #219 Store-Reife: Teil 1 (AAB-Option `--aab` im Release-Skript, Bilder in passender Breite überall) – umgesetzt in #380; Entscheidungen vom 23.09.: Play Store ja (geschlossener Test; der Betreiber legt das Konto an), Absturzberichte über Firebase Crashlytics – umgesetzt in #385, im Build 72 vom 23.09. (Absatz für die Datenschutzerklärung am 23.09. eingefügt). Play Store: Entwicklerkonto am 23.09. beantragt, App „LionsAPP“ (`at.lionsquad.app`) in der Play Console angelegt; Reihenfolge interner Test (Build 74 als AAB) → geschlossener Test → Produktion als 1.0.0; Store-Symbol und Funktionsgrafik liegen beim Betreiber, Screenshots vom Handy. #390 Konto löschen in der App (Google-Pflicht vor dem geschlossenen Test) – umgesetzt in #391, im Build 75 vom 23.09. #412 Play-Upload per API – umgesetzt in #586 (`--play`, Dienstkonto beim Betreiber); #219 Teil 3 Store-Paket (Texte, Datensicherheit, Testkonto, Grafiken) – in #587 (`docs/PLAY_STORE.md`). #593 + #592 Play-Fassung 1.0.0 ohne Installer, Profilstatus in Klartext – umgesetzt in #594, Build 79 = 1.0.0 am 25.09.; Store-Eintrag, Datensicherheit, IARC am 25.09. ausgefüllt (Organisationskonto, AT/DE/CH/IT, Tags Sport/Events/Kommunikation). Offen in #219: offener Test → Produktion in der Play Console |
| Spaeter | #309 GitHub-Releases automatisch abgleichen – umgesetzt in #563; #327 und #331 sind mit Vereine 1.4.0 in den Meilenstein „Vereinsmodul 1.4“ gewandert und dort umgesetzt (#565, #582); bleibt #323 Preisgelder und die Später-Ideen aus dem Discord-Plan (#575 Bracket als Bild, #576 Rollen je Team, #577 Aktionen per Knopf) |
| Web: Design II | #401 Turnierseite (eine Hauptaktion je Phase, „Dein Stand“, Termine einmal, Reiter) – umgesetzt in #532; der Meilenstein ist durch |
| Admin II: Formulare, CMS, E-Mail-Vorlagen | #437 Variante A (Entscheidung des Betreibers 24.09.): totes Web-CMS entfernt, E-Mail-Vorlagen als Seite – umgesetzt in #530; der Meilenstein ist durch |
| Admin sauber I: ein Ort je Thema | #508 (#523), #509 (#522), #510 Dolibarr-Schalter (#539), #511 FAQ (#524), #512 Adminmenü (#543), #513/#514 (#519), #515 (#520), #516 Nutzermenü (#540) – umgesetzt; #546 Einstellungen in die Menüleiste + Übersicht aller Verbindungen – umgesetzt in #549; Meilenstein geschlossen |
| Mitglieder sauber: Vereinsprofile und Konten | #504/#505 (#518), #506 Konto im Admin verknüpfen, Profil legt nie Konto/Mitgliedschaft an (#544), #507 Antrag für bestehendes Konto (#526) – der Meilenstein ist durch |
| Betrieb & Logs: ein Logsystem mit Alarmen | #517 Teil 1 Alarme – umgesetzt in #525; Teil 2 eine Seite „Betrieb & Logs“ mit Ereignissen aller Quellen – umgesetzt in #550; #517 geschlossen, Meilenstein geschlossen (ein gemeinsames Schreibmodell `ops_events` bleibt eine spätere Idee) |
| Vereinsmodul 1.4: Versammlungen, Abstimmungen, Helferdienste | #327 Generalversammlung und Abstimmungen – umgesetzt in #565; #331 Helferdienste – umgesetzt in #582; der Meilenstein ist geschlossen |
| Discord III: Bot statt Webhooks | Plan vom 25.09. (Entscheidung: Webhooks entfallen ganz, nur noch der Bot): #566 der Bot schickt alle Meldungen, Kanal je Zweck – umgesetzt in #588; #567 Discord als persönlicher Benachrichtigungskanal – umgesetzt in #589; #568 Erfolge als Gratulation per Direktnachricht – in #590; #583 Vorschau jeder Meldungsart, Testkanal, „an mich“ – in #595. Meilenstein fertig |
| Discord IV: Live-Einbettungen und Termine | #569 Einbettungen, die sich aktualisieren (Rangliste, Nächste Events, Live jetzt) – umgesetzt in #601; #570 Discord-Termine (Scheduled Events) – in #602; #571 Bracket als Text-Embed – in #603. Meilenstein fertig |
| Discord V: Komfort im Server | #572 Turnier-Threads, #573 Link-Knöpfe und Befehle, #574 Willkommensnachricht, #581 Discord online/Voice auf der Website |
| Kanäle II: YouTube, Twitch, Kalender | #578 YouTube-Feed → News – umgesetzt in #597; #580 Kalender-Knöpfe – in #596; #584 „Gerade in Steam“ (Opt-in, nur Mitglieder) – in #598; #579 Twitch-Clips + Turnier live – in #599. Meilenstein fertig |
| Jahreszeiten I: Kern und Halloween (bis 24.10.) | #632–#636 umgesetzt in #648, #649, #650, #653, #657, #659; #655 Rückmeldung (mit #657 geschlossen); #658 Maßstab für alle Saisonen; #660–#664 Halloween III (#668, #670), #665 App 1.0.3 (#672), #666 Wetter (#671), Halloween IV/V (#674, #676), #679 Klänge und Musik (#684), #681 Mond (#685), #680 Jumpscares (#686); offen #673 Wetter-Ebene, #678 Fundstücke, #677 Klammer |
| Jahreszeiten II: Advent, Weihnachten, Silvester (bis 27.11.) | #637 Adventkranz, #638 Schneefall, #639 Weihnachtsgruß und Nikolaus, #640 Silvester, #641 Adventkalender, #642 App (Build 1.0.3/1.0.4 bis 20.11.), #667 Skia und Neigungssensor |
| Jahreszeiten III: Fasching, Vereinsgeburtstag, Ostern (bis 12.3.2027) | #643 Fasching, #644 Vereinsgeburtstag, #645 Ostern, #646 Eiersuche, #647 App 1.1.0 |
| Erfolge II: Rework (bis 18.12.) | E1 #611 (#652), E7 #617 (#654), E6 #616 (#656), E2 #612 (#675), E3 #613 (#682), E4 #614 (#683) fertig; offen E5 Katalog D #615 (plus vier zurückgestellte Gruppen aus #614 und #678 Fundstücke), E8 #618 Zeremonien, E9 #619 Sichtbarkeit, E10 #620 Admin, E12 #622 Benachrichtigungen, E13 #623 App 1.1.0 |
| Discord VI: Mehrere Server (bis 29.1.2027) | #624–#631 (D1–D8: mehrere Server, Slash-Befehle je Server mit Spielfilter, Infos weitergeben) |

Geprüft am 21.09.: Kein altes Issue ist durch die Merges seither erledigt
(#240 Freunde in der App, #227 Tageszentrale, #216 Kalender, #245 Laufbanner,
#231 Leseweg – alles noch offen im Code).

### Reihenfolge
Vom Betreiber am 21.09. so bestätigt („wir machen es so, wie du es für
sinnvoll hältst“):

1. #310 Livestream-Bug – umgesetzt in #337 (Diagnose unter Betrieb, Grund je
   Kanal im Twitch-Reiter).
2. Dolibarr I – umgesetzt in #338 (ein PR für den Meilenstein). Eigener
   Server-Schritt, weil hier Rechte aus einem fremden System kommen; die
   Umstellung selbst macht der Betreiber nach `docs/DOLIBARR.md`.
3. Discord I – umgesetzt in #350 (ein PR für den Meilenstein).
4. Web: Anmeldung und Teilen – umgesetzt in #353. App 0.6.0-beta – umgesetzt in
   #354, Build 64 nach dem Merge.
5. Dolibarr II – umgesetzt in #356. App 0.7.0-beta: Mitgliederbereich (#340,
   #339, #341, #342, #346) – umgesetzt in #357, Build 65 nach dem Merge.
6. Web: Dynamik – umgesetzt in #360.
7. Abrechnung I – Teil 1 in #363 (Modell, Events, Aufträge, Finanzen),
   Teil 2 in #365 (Kunden und Belege in Dolibarr; erster Durchlauf am 22.09.
   bestätigt), #320 in #381, #321 + #322 in #388 – der Meilenstein ist durch. Admin und Turniere – umgesetzt in
   #369 (#203/#204 berührten dieselben
   Event-Formulare wie #318 – zusammen planen). Abrechnung II – umgesetzt in
   #371 (baut auf #369 auf). App 0.8.0-beta.
8. Discord II – umgesetzt in #376 (#260) und #378 (#302). App 0.9.0-beta –
   umgesetzt in #377, Build 67 am 23.09. gebaut. Auszeichnungen und Marke:
   #229 umgesetzt in #379; #230 in #386. Der Meilenstein ist damit durch.
   App 1.0.0: #217 Stufe 1 und #219 Teil 1 in #380, #217 Stufe 2 in #384;
   #219 Teil 2 Crashlytics in #385; Play-Bundle und Store-Eintrag, sobald das
   Play-Konto da ist (Texte als Vorschlag an #219).
9. Dolibarr III: #326 Teil 1 (Vereinsdaten/Vorstand, Rechtliches II) in
   #398; Statuten und Dokumente, sobald dolibarr-vereine#157/#158 liefern;
   #328/#329 sind mit Vereinsmodul 0.7.0 baubar (Antrag, Einwilligungen,
   Antragsstand über die API). Danach die Prüfrunde vom 23.09. (Turnierbaum,
   QR-Code, Turnierseite, Kalender im Web, Vereins-Reiter, Footer, lionsquad.at
   lesend) → Issues und Meilensteine.

10. Alte Meilensteine und Rundgang-Welle II (24.09. abends, Freigabe „gib Vollstoff“): #437 A
    (#530), #401 (#532), #531 (#533), #231 (#534), #527 (#535), #521 (#536), #324 Rest (#538),
    #510 (#539), #516 (#540), #541 (#542), #512 (#543), #506 (#544) – alle gemergt. Danach #545
    Google-Prüfung (#548), #546 Einstellungen ins Menü (#549), #517 Teil 2 (#550), #547 Welle 1
    (#552), #537 Upload-Inventar (#553), #223 Teile 1 und 2 (#554, #555) – alle gemergt; die
    Meilensteine „Admin sauber I“, „Mitglieder sauber“ und „Betrieb & Logs“ sind geschlossen.
    Am 25.09. früh gemergt: #556, #559, #561 (Plattformen Welle 2, Haken, Welle 3), #560 (#415 Rest),
    #562 (#223 Rest), #563 (#309 GitHub-Releases) – die Meilensteine „Web: Tempo und Betrieb“,
    „Discord II“ und „Moderation II“ sind geschlossen. Was bleibt, braucht den Betreiber (#239,
    #412, #219) oder das Vereinsmodul (#329, #330, #327, #331); #323 Preisgelder ist die einzige
    große offene Website-Aufgabe ohne Abhängigkeit.

11. 25.09. mittags („die älteren Meilensteine endlich alle fertig“, „App v0.9 ewig ausstehend“):
    #327 (#565), #331 (#582) – das Modul 1.4.0 hatte die Wege längst; #239 (#585), #412 (#586),
    #219 Teil 3 (#587) – App 0.9.0-beta und Vereinsmodul 1.4 geschlossen; die alten Meilensteine
    hängen nur noch am Betreiber (#219 Entwicklerkonto) oder am Modul (#329 Mandat, #330
    Testinstanz). Danach der Discord-Plan (Meilensteine 34–36, Kanäle II 37): #566 in #588 gemergt,
    #567 (#589) und #568 (#590) offen; als Nächstes #583, dann Discord IV.

12. 25.09. nachmittags: Build 78 (#585) und die Play-Console-Formulare (IARC „Alle anderen
    App-Typen“, Datensicherheit, Store-Eintrag, Screenshots aus dem Emulator mit Demo-Daten) –
    dann #594 (App 1.0.0, Build 79), #595 (#583), #596 (#580), #597 (#578), #598 (#584), alle
    gemergt; #599 (#579) offen. Entscheidungen des Betreibers: Play-Konto als Organisation (der
    Verein, keine 12-Tester-Regel), APK am GitHub-Release nur als Browser-Download (kein Installer
    in der App), Länder AT/DE/CH/IT, erst offener Test, dann Produktion. **Play-Console-Falle:**
    der Fehler „Berechtigung REQUEST_INSTALL_PACKAGES noch nicht erklärt“ kommt von Build 78 in
    einem aktiven Release oder Track, nicht von Build 79 (Bundle geprüft) – 78 aus dem Entwurf
    entfernen bzw. 79 auch in den internen Test; die Erklärung nie ausfüllen.

13. 25.09. nachmittags, Discord IV und Kanäle II fertig: #599 (#579), #601 (#569), #602 (#570), #603
    (#571) – nacheinander gemergt; #601 musste nach #599 neu aufgesetzt werden (Job-Liste, Twitch-Abfrage),
    #602 und #603 als Stapel je nach dem Merge der Basis umgehängt. Wunsch des Betreibers: Antworten auf
    Slash-Befehle nur für die fragende Person, Kanalweites nur als gepinnte Einbettung. Danach Pause;
    offen ist der offene Test der App in der Play Console (Bundle 79 aus der Bibliothek, Werbe-ID „Nein“).

14. 28.09. („LOS GEHTS LETS GO!“ nach der Fragenliste – alle Antworten A, Frage 20 A/B/C/E):
    Reihenfolge Jahreszeiten I → Erfolge II → Jahreszeiten II (bis 27.11.) → Discord VI →
    Jahreszeiten III; App-Builds 1.0.1 Halloween, 1.0.2 Feinschliff, 1.0.3 Halloween III,
    1.1.0 Erfolge und Ostern. Gemergt: #648–#651, #652–#654, #656, #657, #659; #668 ready.
    Drei Runden Halloween-Rückmeldung (zu klein → zu übertrieben → dezent und detailreich):
    kleine Silhouetten in Silber-Türkis, ein lebender Vorgang je Saison (Netzbau in echter
    Reihenfolge, sichtbar), Physik statt Keyframes, nichts abgeschnitten, nichts über Inhalt,
    je Seite gesät plus Salz je Ladung, genau ein klickbares Extra je Idee. Web und App
    Halloween gingen als ein PR (#659), weil der Betreiber weniger Merges will.

Vor jedem neuen Paket: Stand melden und auf das OK warten.

### Noch offene Doku
- Das Online-Artifact des Umbauplans (Abschnitt 1) auf den Stand von
  `UMBAUPLAN.md` bringen. „Was 22.2 gefunden hat“ und die Zeilen für
  #261/#262/#263/#264/#266/#267 stehen seit #271 in der Datei.

### GitHub-Befunde vom 15.09. (zweiter PC, nichts davon geändert)
- **CodeQL** (`codeql.yml`, nur manuell) startet nicht: „recent account
  payments have failed or your spending limit needs to be increased“ (am
  21.09. traf dieselbe Meldung den normalen CI der Dependabot-PRs). Die
  drei offenen CodeQL-Warnungen sind alt: eine zeigt auf
  `tournament_routes.py:3149` aus der Zeit vor Block 13 (die Datei hat heute
  24 Zeilen), die zwei anderen (`pdf_service.py:891`, `user_routes.py:626`)
  sind Vorbelegungen, die im Normalfall überschrieben werden – kein Fehler.
- **`main` hat keinen Branch-Schutz und keine Rulesets.** „Nie direkt auf
  `main`“ ist nur Vereinbarung. Empfehlung: Settings → Branches → „Require a
  pull request before merging“.
- **Rund 60 Remote-Zweige gemergter PRs** liegen noch auf GitHub.
  Empfehlung: Settings → General → „Automatically delete head branches“; die
  alten einmal unter Branches löschen.
- Zwei PRs wurden mit rotem letzten Lauf gemergt: #263 (Job „Bereiche und
  Geheimnis-Scan“, Log nicht mehr abrufbar) und #264 (`InfoCenterScreen`-Test
  am 5-s-Timeout, Last auf dem Runner). Der Lauf zu #270 auf demselben Stand
  war komplett grün, lokal ebenso.
- Alter lokaler Zweig `*-changes-new` des früheren Anbieters (Remote gelöscht):
  alle Patches sind in `main`; der Betreiber löscht ihn selbst.

### Wichtige Funde dieses Tages (für Erklärungen an den Betreiber)
- Bilder trugen `Cache-Control: no-store` über den nginx-`/api/`-Block und
  wurden nie gecacht; seit #263 liefert nginx sie mit 30 Tagen Cache
  (400-px-Fassung von 0,086 s auf 0,003 s je Bild).
- Server-Fehler waren nur in Container-Logs sichtbar; seit #266 als Gruppen
  unter Admin → Betrieb, mit „erledigt“/„wieder offen“.
- Richtiger Discord-Link: `discord.com/invite/thelionsquadesports`.
- Google (24.09.): Die OAuth-Prüfung scheiterte, weil Crawler von nginx nur die Server-Vorschau
  (`/api/seo/preview`) bekommen – Titel, ein Satz, „Seite öffnen“; die Datenschutzerklärung
  entstand erst mit JavaScript. Seit #548 liefert die Vorschau den ganzen Text (Rechtstexte im
  Backend, eine Quelle). Der Anwendungsname in der Console muss dem Vereinsnamen auf der
  Startseite entsprechen (**THE LION SQUAD**).
- „Alle Verbindungen weg nach dem Server-Update“ (24.09.): weder `update.sh` noch der Code löschen
  Einstellungen (Mongo-Daten im Volume `mongo_data`); gespeicherte Schlüssel gelten im Admin als
  „eingerichtet“, sobald ein Wert da ist – ob er sich mit dem aktuellen `SETTINGS_ENCRYPTION_KEY`
  lesen lässt, prüfte bis #549 niemand. Die Resend-Seite warnte außerdem „kein Key“ auch bei
  Versand über SMTP.
- Gestapelte PRs am 24.09. sauber: #536 (Basis #535) nach dem Merge der Basis sofort
  `git rebase --onto origin/main <alte Basis>`, `gh pr edit --base main`, Check, ready – nichts
  ging verloren.
- GitHub meldet nach einem Force-Push manchmal „conflicting“, obwohl der Baum sauber auf `main`
  sitzt – erst `git fetch` und `git merge-base --is-ancestor origin/main HEAD` prüfen; ist `main`
  weitergezogen (24.09.: #550/#551 vor #552), rebasen und die Navigationszahl neu rechnen.
- Plattformen mit Anmeldung (24.09., #547): 27 haben eine (Welle 1 + 2); PlayStation, Nintendo,
  EA, Ubisoft, Rockstar und GOG keine – die bleiben getippt; Instagram nur für Business-Konten
  über eine geprüfte Meta-App. Meta (Threads/Facebook), LinkedIn, Snap und Pinterest lassen fremde
  Konten erst nach einem App-Review zu – bis dahin nur eingetragene Tester.
- Jahreszeiten (28.09.): `/api/seasons/active` gab 404 – Präfix-Konflikt mit den
  Wettkampf-Saisonen, deshalb `/api/seasonal`. Die Sicherheits-Middleware erzwang `no-store`
  und machte den ETag-Cache wirkungslos (Ausnahme in `server.py`). Der Vorschau-Knopf tat
  nichts, weil das Token nur in `sessionStorage` lag und die Bühne im Admin still ist (#653).
  Ein `filter: drop-shadow` auf einer inneren SVG-Gruppe ergibt einen rechteckigen Kasten –
  Schein nur über Verläufe oder auf dem ganzen SVG. Vitest aus dem Worktree-Stamm startet ein
  globales Vitest 5 ohne jsdom – immer aus `frontend/` mit `--root`.
- App-Tests (28.09.): RNTL 14 macht auch `screen.unmount()` async; ohne `await` kippen alle
  späteren Fake-Timer-Tests mit „overlapping act() calls“. Unter jest-expo endet eine native
  `Animated.timing` sofort – Sichtbarkeit nie vom Animationsende ableiten.
- GitHub (28.09.): nach `git rebase --onto origin/main` meldete #656 „dirty“, obwohl
  `merge-tree` sauber war; ein leerer Commit erzwingt die Neuberechnung. Die Release-Notizen
  erzeugt `npm run release:local` aus dem CHANGELOG und legt das GitHub-Release selbst an –
  `gh release create` scheitert danach mit „already exists“, Text mit `gh release edit`.

---

## 10. Der Haupt-PC und was nicht über Git kommt

Seit 16.09. (#273) ist `C:\Programmieren\THE-LION_SQUAD-eSPORT-Webseite` auf
dem Haupt-PC der einzige Arbeitsplatz; der alte PC (`C:\GIT Privat\…`) ist
nur noch Sicherung. Was über Git kommt: der Code, diese Datei,
`UMBAUPLAN.md`, alle Zweige. Was **nicht** über Git kommt und auf einem
frischen Gerät neu entsteht oder von Hand mitmuss:

1. **`%USERPROFILE%\.lionsapp-release\`** (`upload.jks`, `signing.json`,
   `google-services.json`) – nur über USB oder einen anderen sicheren Weg,
   nie über Git, Chat oder einen Cloud-Link im Klartext. In `signing.json`
   die Pfade `javaHome` und `androidHome` auf das Gerät anpassen.
2. **Werkzeuge** (Abschnitt 6.1 und 7): Python 3.11, Node 24 und 20, Docker
   Desktop, Git for Windows, gitleaks, JDK 21, Android SDK per
   `sdkmanager` (Pakete in Abschnitt 7), `~/.gradle/gradle.properties` mit
   dem 6-GB-Heap, Benutzer-Variablen `JAVA_HOME` und `ANDROID_HOME`.
3. **Neu erzeugen statt kopieren:** der Check legt seine venvs unter
   `~/.local-ci/` an; `cd frontend && yarn install`, `cd mobile && npm ci`;
   den Build-Worktree `C:\lsb` legt das Release-Skript selbst an.
4. **`.vscode/`** des Repos (maschinenlokal, in `.gitignore`):
   `settings.json` (Testing-Panel), `tasks.json` (Check-Gruppen und
   Release), `extensions.json`. Kein Spiegel mehr, siehe 6.2.
5. **`.ci-panel/`** und `C:\Programmieren\check-all.py` (Testing-Panel und
   Dashboard über alle Repos), siehe 6.1.
6. Optional das Claude-Gedächtnis dieses Rechners:
   `C:\Users\<user>\.claude\projects\c--Programmieren\memory\` (Index
   `MEMORY.md`). Diese `CLAUDE.md` enthält alles Wesentliche daraus; das
   Gedächtnis ist nur Ergänzung.
