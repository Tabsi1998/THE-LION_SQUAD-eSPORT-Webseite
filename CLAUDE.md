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

**nginx / Uploads (#232, PR #263)**
- Compose hängt `uploads_data:/srv/uploads:ro` ins Frontend; nginx liefert
  `/api/static/uploads/` direkt von der Platte, `expires 30d`, Header
  `X-TLS-Media: nginx|backend`, Fallback `@tls_upload_backend`.
- Die Härtungs-Tests im Backend **zählen nginx-Blöcke** (8× `X-Forwarded-Host`,
  9× CSP-`add_header`) – bei neuen Proxy-Blöcken Zähler anpassen.
- Smoke: `scripts/check-media-serving.py` (CI-Schritt „Verify uploads are
  served by nginx“).

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
  Admin-Menüeinträge (**36** seit „Betrieb“) – jeder neue Menüpunkt braucht
  die neue Zahl.

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

## 9. Aktueller Stand (21. September 2026)

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
(#329 Teil 1 Einwilligungen; `update.sh`), #453 (#417 Wortfilter; `update.sh`, App-Build), #454 (#435 Rest Medien-Seitenblatt; nur Web), #455 (Doku-Stand nach #454), #456 (Rechtliches speichern repariert, Wegweiser in der Admin-Suche; nur Web; `update.sh`), #457 (#409 Referenzen als Erfolgswand; nur Web; `update.sh`), #458 (#260 Nachtrag verknüpfte Konten sichtbar; `update.sh`), #460 (Doku-Stand nach #457), #461 (Dolibarr-Übersicht und Dashboard-Kachel; `update.sh`), #462 (Profil-Sichtbarkeit je Betrachter; `update.sh`), #463 (#416 Verwarnungen mit Stufen; `update.sh`, App-Build), #464 (Doku-Stand nach #462), #465 (Einrichtung im Admin, Prüfung Discord/Twitch/Steam; `update.sh`), #466 (Mein Konto im Menü; nur Web), #467 (Konten verknüpfen II; `update.sh`), #468 (#326 Teil 2 Vorstand aus Dolibarr; `update.sh`), #470 (Menügruppe Verbindungen; nur Web), #471 (Doku-Stand nach #468), #472 (News-Detail am PC breit; nur Web), #473 (Doku-Stand nach #472), #474 (Profilseite neu; nur Web), #475 (Verbindungen ohne Doppeltes; nur Web). `main` steht auf `7cf7252`.

### Offene PRs
- #476 (Partnerseiten, #469 Teil 1; Backend + Web; bereit, lokal grün).
  App-Gegenstück zu den verknüpften Konten: #459 (App 1.0.0). **Regel seit
  23.09. abends:**
  Feature-PRs fassen `CLAUDE.md` und `UMBAUPLAN.md` nicht mehr an – die Doku
  (§5-Eintrag, §9, UMBAUPLAN-Block und -Zeile) kommt gebündelt im
  Doku-Stand-PR nach dem Merge; so gibt es die Konflikte zwischen parallelen
  PRs nicht mehr. Danach: #437 Web-CMS (Befund: Seiten-Reiter ist nirgends
  angebunden, E-Mail-Vorlagen werden gebraucht – wartet auf die Entscheidung
  A/B des Betreibers), #401 Turnierseite (Reiter auf einer Seite, „Dein
  Stand“, Termine einmal – Antwort des Betreibers zu Reitern steht noch aus),
  dann Dolibarr III Rest (#326 Teil 2 Vorstandsseite aus Dolibarr – Vorschlag
  im Issue, Antwort steht aus; #329 Einwilligungen, eigene Daten, Austritt
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
  abgelegt. Nächster Build ist 78.

### Erledigungen beim Betreiber
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
  Profilseite (erledigt, #474), Partner II Teil 1 (PR #476), dann #415
  Bildprüfung, dann Partner II Teil 2 (#469: Partner an Events/Turnieren).
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
| Web: Tempo und Betrieb | #310 Livestreams der Mitglieder fehlten auf der Startseite (Ursache: Twitch-Client-Secret fehlte, die Abfrage übersprang still; Diagnose in #337), #223 große Admin-Dateien (Twitch-Reiter ist herausgelöst), #231 klassischer Match-Leseweg, #364 Mitgliederbereich Web: Einstieg, Vollständigkeit, Altlasten (Wunsch vom 22.09.) – umgesetzt in #366 |
| Dolibarr I: Anbindung und Mitgliedschaft | #295 Mitgliedschaft und Beitragsstand automatisch und #297 Vereinsrechte aus Funktionen – umgesetzt in #338; #316 und #330 sind mit ihrem ersten Teil drin und wandern mit dem Rest weiter (siehe unten) |
| Dolibarr II: Eigene Rechnungen und PDF | #296 Rechnungs-Lesedienst, PDF-Archiv, Zahlungsweg aus Dolibarr; #325 ein PDF-Betrachter für Web (App: #341) – umgesetzt in #356 |
| Abrechnung I: Grundlage und Events | Teil 1 in #363 (#315, #318), Teil 2 in #365 (#316 Kundenanlage, #317 Belege ohne Dubletten, #322 Finanzübersicht mit Zuordnung/Freigabe). #370 Rechnungskonditionen (30 Tage, Überweisung, Girokonto) und lesbare Belegtexte mit Zusatz – umgesetzt in #372. #320 eigene Rechnungen für alle (Nicht-Mitglieder über die Einzelbelege ihrer Vorgänge, Quelle je Beleg, Filter, App-Bildschirm) – umgesetzt in #381. #321 Zahlungsstand im Detail, Prüffälle (Storno/Änderung nach dem Beleg, Überzahlung, Abweichung, verschwundener Beleg), Erstattungen mit Nachweis und #322 Rest (Filter, Summen je Veranstaltung, Zeitleiste, CSV, Steuersätze bestätigen, Runbook, Aufbewahrung) – umgesetzt in #388. Der Meilenstein ist durch |
| Abrechnung II: Turniere | #319 Startgelder (Zahler = anmeldende Person, Roster zählt, Preis erst mit der Freigabe), #314 Epic – umgesetzt in #371; Einzelrechnungen je Spieler bleiben eine spätere Stufe |
| Dolibarr III: Dokumente, Vereinsseiten, Mitgliedschaft online | #326 Vereinsdaten und Vorstand aus Dolibarr – Teil 1 in #398 (Rechtliches II: Impressum/Kontakt/Datenschutz aus `/vereine/organization` + `/vereine/board`, Datenschutzerklärung aus den echten Schaltern); Rest (Statuten, öffentliche Vorstandsseite) wartet auf dolibarr-vereine#158. #324 Dokumente, #328 Beitrittsantrag, #329 Einwilligungen/eigene Daten/Austritt, #330 Rest: Durchläufe – das Vereinsmodul 0.7.0 (23.09.) liefert Antrag, Einwilligungen und Antragsstand über die API; Dokumente (#157) noch nicht |
| Discord I: Kanäle und Meldungen | #300 ein Webhook je Zweck mit Schaltern, #301 Erfolge sofort auswerten und gebündelt melden, #303 Meldungen mit Bild und Vorschau – umgesetzt in #350 |
| Discord II: Konto-Verknüpfung und Bot | #260 Plattform-Konten verknüpfen (Discord OAuth2, Twitch OAuth2, Steam OpenID; verifiziert im Profil) – umgesetzt in #376; #302 Discord-Bot (im Backend, Token im Admin; zählt Nachrichten verknüpfter Konten, gleicht die drei Rollen ab, vier Slash-Befehle) – umgesetzt in #378. Der Betreiber richtet den Bot nach dem Merge im Admin ein |
| Web: Anmeldung und Teilen | #348 angemeldet bleiben, Passkey anbieten, Zwei-Faktor für alle einrichtbar; #347 neutrale Link-Vorschau für Vereinsinhalte – umgesetzt in #353. Nachtrag #358 (Meilenstein Spaeter): Passkey mit Gerätesperre zählt als zweiter Faktor – Entscheidung des Betreibers vom 22.09. (Variante B), umgesetzt in #359 |
| Web: Dynamik | #224 Startseite (Countdown, Live-Zahlen, „Neu“), #225 Turnierseiten (Zeilen gleiten, Rahmen am Match, „gerade eingetragen“ + Hinweis), #226 Skelette statt „Lade …“ und Einblenden beim Seitenwechsel – umgesetzt in #360 |
| Admin und Turniere | #203 Events an mehreren Standorten, #204 Ort/Stadt und Karte aus der Adresse, #227 Tageszentrale erweitert, #228 Turnier-Leitfaden (Schritt 1), #235 geltenden Termin in die Partie schreiben – umgesetzt in #369; #368 Leitfaden Schritt 2 („Voreinstellung übernehmen“) – umgesetzt in #375 |
| Auszeichnungen und Marke | #229 Standard-Favicon für hell und dunkel (im Admin erzeugt) und Markenbilder/Vereinsname in der App – umgesetzt in #379, im Build 70 vom 23.09. #230 Gewinnerbanner und Trophäen – Entscheidungen am 23.09. bestätigt („passt“: Daten bei der Vergabe, Bild beim Ansehen, Bilder für Platz 1–3 je Turnier hochladen, Korrektur = erneut veröffentlichen). umgesetzt in #386 (Web, Teams, App), im Build 73 vom 23.09. Der Meilenstein ist durch |
| App 0.6.0-beta | #218 Erfolge mit Symbolen, Fortschritt und Freischalt-Moment – umgesetzt in #354, Build 64 nach dem Merge |
| App 0.7.0-beta: Mitgliederbereich | Wunsch des Betreibers vom 21.09.: der Mitgliederbereich auch in der LionsAPP. #340 eigener Einstieg und Aufbau wie im Web, #339 Meine Mitgliedschaft mit Beitragsstand und Belegen, #341 Vereinsdokumente (nur im privaten App-Speicher), #342 interne Events und News kennzeichnen – Meldungen nur an Berechtigte, #346 digitale Mitgliedskarte mit QR-Code (Web und App, Wallet vorbereitet) – umgesetzt in #357, Build 65 nach dem Merge. #327–#329 bringen ihren App-Teil selbst mit. Die Meilensteine dahinter sind am 22.09. um eins gerückt (Kalender/Galerie → 0.8.0, Sticker/Freunde/Laufbanner → 0.9.0) |
| App 0.8.0-beta | #216 Kalender (App: Monatsansicht, „In meinen Kalender“ per Gerätekalender/Google; Web: .ics + Google), #236 Galerie in der App – umgesetzt in #374, Build 66 am 22.09. gebaut. Persönlicher Kalender-Feed (`kalender.ics?token=`) bleibt „später, optional“ aus #216 |
| App 0.9.0-beta | #240 Freundschaftsanfragen (App: Knopf im Profil, Karte „Freunde“, live), #245 Laufbanner (Kanäle Web/App, Ticker über den Tabs) – umgesetzt in #377, Build 67 am 23.09. gebaut. #239 Sticker/GIFs der Tastatur bleibt offen (natives Modul um `TextInput`, eigener Schritt) |
| App 1.0.0 | #217 Stufe 1 App-Sperre (Fingerabdruck/Gesicht/Gerätesperre beim Start und nach einer Minute im Hintergrund) – umgesetzt in #380, im Build 70 vom 23.09.; Stufe 2 Passkey-Login in der App – umgesetzt in #384, im Build 71 vom 23.09. #219 Store-Reife: Teil 1 (AAB-Option `--aab` im Release-Skript, Bilder in passender Breite überall) – umgesetzt in #380; Entscheidungen vom 23.09.: Play Store ja (geschlossener Test; der Betreiber legt das Konto an), Absturzberichte über Firebase Crashlytics – umgesetzt in #385, im Build 72 vom 23.09. (Absatz für die Datenschutzerklärung am 23.09. eingefügt). Play Store: Entwicklerkonto am 23.09. beantragt, App „LionsAPP“ (`at.lionsquad.app`) in der Play Console angelegt; Reihenfolge interner Test (Build 74 als AAB) → geschlossener Test → Produktion als 1.0.0; Store-Symbol und Funktionsgrafik liegen beim Betreiber, Screenshots vom Handy. #390 Konto löschen in der App (Google-Pflicht vor dem geschlossenen Test) – umgesetzt in #391, im Build 75 vom 23.09. Offen in #219: Google-Signaturschlüssel in assetlinks/Passkeys eintragen, Store-Eintrag, geschlossener Test, 1.0.0 |
| Spaeter | #309 GitHub-Releases automatisch abgleichen; #323 Preisgelder, #327 Generalversammlung und Stimmabgabe, #331 Helferdienste – die drei warten auf das Vereinsmodul („Später“ bzw. v0.8) und wandern in einen eigenen Meilenstein, sobald es liefert |

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
