# Changelog

## 0.11.0-alpha.1 - 2026-05-21

- Mobile: Season Pass Screen hinzugefuegt (Rangliste mit Podium, Punkte-Erklaerung, Pull-to-Refresh)
- Mobile: MoreScreen komplett ueberarbeitet (Icons, Season Pass Einstieg, Discord-Link, App-Version)
- Mobile: NewsScreen mit Suchfeld und Kategorie-Filter-Chips erweitert
- Mobile: DashboardScreen mit Season Pass Quick-Link Karte (Gold-Styling)
- Mobile: Offline-Cache (In-Memory + SecureStore) mit TTL und Stale-Fallback hinzugefuegt
- Mobile: API-Timeout (15s), automatisches GET-Caching, Offline-Stale-Fallback, bessere Fehlermeldungen
- Mobile: Push-Notifications Infrastruktur (PushService, Android Channels, graceful degradation)
- Mobile: Push-Token Registrierung/Deregistrierung bei Login/Logout
- Mobile: App-Badge-Zaehler wird automatisch mit ungelesenen Benachrichtigungen synchronisiert
- Mobile: Chat-Tastatur-Bug behoben (Input-Feld wurde auf Android von Tastatur ueberlappt)
- Mobile: Sponsoren im Info Center als Logo-Grid (2 Spalten, nur Logo, klickbar zur Website)
- Mobile: AppNavigator um SeasonPass-Route erweitert
- Web-Frontend: BottomNav Aktiv-Indikator Bug behoben, Gaeste-Navigation erweitert (News + Season)
- Web-Frontend: ScrollTop-Button ueberlappt BottomNav auf Mobile behoben
- Web-Frontend: Safe-Area-Inset Utilities in Tailwind (pb-safe-bottom etc.)
- Web-Frontend: Nginx Gzip-Kompression vollstaendig (30+ MIME-Typen), Proxy-Keepalive
- Web-Frontend: PWA manifest.json mit Season-Pass Shortcut, display_override, screenshots

## 0.10.0-alpha.1 - 2026-05-21

- Mobile: SkeletonCard + SkeletonList Komponente hinzugefuegt (animierter Pulse-Effekt als Ladeplatzhalter)
- Mobile: NewsScreen zeigt beim ersten Laden SkeletonList statt ActivityIndicator
- Mobile: TournamentsScreen zeigt beim ersten Laden SkeletonList statt ActivityIndicator
- Web-Frontend: Lazy Loading (loading="lazy" + decoding="async") fuer alle Bilder auf Public-Seiten (Home, News, Events, Gallery, Teams, Tournaments, F1)
- Web-Frontend: LazyImg-Komponente erstellt fuer wiederverwendbares Lazy Loading
- Web-Frontend: Accessibility-Verbesserungen in NotificationBell (aria-live, aria-label, Fokus-Management)
- CI: pip-audit --ignore-vuln PYSEC-2025-183 (false positive in safety-check)

## 0.9.0-alpha.1 - 2026-05-21

- Web-Frontend: Route-Konflikt /matches/:id behoben (MatchHubPage war nie erreichbar)
- Web-Frontend: Dashboard-Notifications-Endpunkt auf /notifications/me korrigiert (kein 403 mehr fuer normale User)
- Web-Frontend: Externes Pexels-Bild im Hero durch CSS-Gradient ersetzt (keine externe Abhaengigkeit mehr)
- Web-Frontend: ProtectedRoute leitet bei fehlenden Rechten jetzt auf /403 statt /dashboard weiter
- Web-Frontend: Passwort-Toggle (Eye/EyeOff) in Login und Register hinzugefuegt
- Web-Frontend: Passwort-Staerke-Indikator (4 Balken) in Register hinzugefuegt
- Web-Frontend: Scroll-to-Top jetzt auf allen Geraeten sichtbar (nicht mehr nur Mobile)
- Web-Frontend: TournamentsPage mit Loading-Skeleton, Error-State und Retry-Button verbessert
- Web-Frontend: Footer-Version dynamisch aus REACT_APP_VERSION Env-Variable
- Web-Frontend: Neue BottomNav-Komponente fuer Mobile (Home, Turniere, Events, Dashboard, Profil)
- Web-Frontend: PWA manifest.json mit standalone Display, App-Shortcuts und deutschen Metadaten
- Web-Frontend: iOS Safe-Area (env(safe-area-inset-bottom)) fuer Notch-Geraete
- Web-Frontend: AdminLayout Sidebar in 6 Gruppen unterteilt (Uebersicht, Mitglieder, eSports, Content, Verein, System)
- Web-Frontend: Moderator-Sidebar-Fix: /admin/stations jetzt korrekt sichtbar

## 0.8.0-alpha.1 - 2026-05-20

- Added a reusable mobile release preflight script that validates package/app version parity, package-lock version parity, Android package identity, Android versionCode, changelog coverage, release history coverage, and tag/version consistency.
- Added `npm run release:preflight` to the mobile app package.
- Wired the mobile release preflight into the main CI Mobile App job before Expo config validation.
- Wired the same preflight into the Mobile APK Release workflow before TypeScript and Android build steps.
- Hardened release automation so version, changelog, release docs, package name, slug, app name, and Git tag mismatches fail before building or publishing an APK.

## 0.7.0-alpha.1 - 2026-05-20

- Added a global native error boundary so render-time screen crashes show a controlled LionsAPP fallback instead of leaving testers on a blank or closed app view.
- Improved notification popup Safe-Area positioning so popups sit below the device status bar and notification bell on cutout/notch Android devices.
- Improved the floating notification bell with safe right inset handling, accessibility labels, and Android elevation.
- Documented the Google Play internal testing readiness path, alpha entry criteria, and manual smoke-test checklist for APK and Play testing.
- Kept the current APK flow unchanged while preparing the app shell for broader tester distribution.

## 0.6.0-alpha.1 - 2026-05-20

- Added central native notification routing so in-app notifications can open the matching Event, Tournament, Match, Team, Team-Chat, Tournament-Chat, Fast-Lap, News, Direct Message, Profile, or Home/Profile fallback.
- Made notification popups mark the item as read and jump directly to the best native target instead of only dismissing the popup.
- Reworked the Notification inbox to use the global notification context instead of polling independently, reducing duplicate notification requests while the inbox is open.
- Added visible "Oeffnen" affordance to notification cards so users know tapping a notification navigates to the relevant app area.
- Moved the root navigation ref into a shared navigation helper so notification routing can be reused consistently from overlays and screens.

## 0.5.0-alpha.1 - 2026-05-20

- Expanded the native Team detail screen with live banner/logo display, membership role state, richer members, Squads, Join-Code handling, Discord links, and pull-to-refresh.
- Added native Team management actions for permitted users: edit basic team data, invite users, promote/demote Co-Leaders, transfer leadership, remove members, leave teams, and join by Join-Code.
- Added native Squad management for Team-Leads and Co-Leads, including create, edit, archive/activate, delete, and member assignment.
- Added mobile handling for pending team invitations directly on the Teams screen.
- Added team-scoped mention suggestions for Team-Chat and made chat authors and `@username` mentions open native public profiles.
- Added direct profile-to-message navigation where public profile permissions allow messaging.

## 0.4.0-alpha.1 - 2026-05-20

- Added a native public profile detail screen backed by the live website profile API, including banner, avatar, membership state, profile stats, public info, gaming setup, socials, game IDs, achievements, tournament history, Fast-Lap bests, and teams.
- Made Info Center player cards open the native profile detail instead of staying as static cards.
- Made `@username` mentions in rich text route to native player profiles when the surrounding screen provides app navigation.
- Updated News and Event content links so profile targets open native public profiles.
- Made mentioned users in News tappable and linked personal profile references to the matching native tournament or Fast-Lap detail.
- Added a clearer membership status card to the mobile benefits area so locked and active member benefits are easier to understand.

## 0.3.0-alpha.1 - 2026-05-19

- Improved the native rich-text renderer with internal content links, native content embeds, ordered lists, decoded HTML entities, auto-linked URLs, and inline image rendering for Markdown, HTML, and standalone image URLs.
- Made `[[event:id]]`, `[[tournament:id]]`, `[[fastlap:id]]`, `[[news:id]]`, and team/profile links route inside the app instead of opening as raw text or external web links.
- Updated News details so linked Events and Fast-Lap challenges open their native app views and embedded images are rendered in the article body.
- Updated Event details so program text can open native linked content, Event news opens News detail, galleries are displayed, and sponsor logos can open their configured links.
- Added shared mobile content-link parsing for Events, Turniere, Fast Laps, News, Teams, and Profiles.

## 0.2.0-alpha.1 - 2026-05-19

- Added a native Match detail screen with participants, schedule status, station, linked tournament, schedule proposals, pending proposal decisions, match chat, result reporting, disputes, and staff forfeit actions.
- Linked tournament overview, bracket, match plan, Home open actions, and upcoming Home matches directly into native Match details.
- Added backend permission flags to the match page API so the app only shows result, dispute, and forfeit actions when the current user is allowed to use them.
- Added native result entry for legacy duel matches and staff Heat result entry for multi-slot matches.
- Kept Match detail live through periodic refresh and pull-to-refresh while preserving active form input.

## 0.1.1-alpha.1 - 2026-05-19

- Aligned native tournament registration with website eligibility rules for team mode, manageable teams, required game IDs, club-member blocks, and check-in.
- Added a tournament registration modal for team selection and game/player ID fields using live profile data.
- Loaded native tournament registrations directly so participant state, team registrations, and self-registration detection are more reliable.
- Aligned native event registration with website behavior for external registration links, companion counts, optional notes, registration windows, and reserved seats.
- Added Fast-Lap submission/reference policy information so users can see online submission windows and club-reference scoring rules in the app.

## 0.1.0-alpha.14 - 2026-05-19

- Added a native rich-text renderer for mobile Markdown, simple HTML formatting, links, lists, quotes, code, mentions, and hashtags.
- Applied rich-text rendering to news, event content, and chat messages so website formatting no longer appears as raw text.
- Added a global in-app notification provider with foreground polling, notification popups, and a floating bell with unread count.
- Made the notification inbox refresh automatically and keep the global unread badge in sync.
- Grouped the Events hub into Events, Turniere, and Fast Laps when showing all content.
- Removed visible manual refresh actions from Home and added background polling for Home and the Events hub.
- Added a mobile roadmap documenting remaining website-parity gaps and rollout phases.

## 0.1.0-alpha.13 - 2026-05-19

- Reworked the bottom "Turniere" area into an "Events" hub for all visible events, tournaments, and Fast-Lap challenges.
- Added native event details with program text, registration state, linked tournaments, linked Fast-Lap challenges, linked news, and sponsors.
- Added event registration and cancellation actions for logged-in users.
- Added tournament registration and cancellation actions in tournament details.
- Made Home event cards and Info Center event cards open the native event detail instead of jumping into a generic info list.
- Displayed match times with date and clock time, including a clear fallback when no time is scheduled.
- Rendered image URLs embedded in news content as images instead of raw URL text.

## 0.1.0-alpha.12 - 2026-05-19

- Added the missing root `SafeAreaProvider` so the authenticated tab navigator can safely read device insets after login.
- Fixed the post-login Android crash that happened when switching from the auth screens into the main app.

## 0.1.0-alpha.11 - 2026-05-19

- Removed the native Expo notifications module from the Android build to stabilize app startup on installed APKs.
- Kept the in-app notification inbox, direct messages, team chat, and tournament chat available through the live API.
- Left backend push-token support in place so phone push notifications can be re-enabled later with a dedicated Firebase/Expo push configuration.
- Prepared the release workflow for faster repeat Android builds through Gradle caching.

## 0.1.0-alpha.10 - 2026-05-19

- Fixed the mobile Profile screen TypeScript failure caused by the removed `StyleSheet.absoluteFillObject` API.
- Delayed native push-notification module loading so notification setup cannot crash the app during initial startup.
- Verified the Android JavaScript bundle export after the startup hardening.

## 0.1.0-alpha.9 - 2026-05-19

- Added native direct messages with conversation list and thread view.
- Added native Team-Chat and Turnier-Chat screens using the existing website chat APIs.
- Added a native notification inbox with read state and "mark all read".
- Added Expo push-token registration in the app and backend delivery hooks for platform notifications.
- Stored mobile push tokens per user and prepared notification pushes for reminders, mentions, messages, match updates, and Fast-Lap notices.

## 0.1.0-alpha.8 - 2026-05-19

- Renamed the installed app display name to `LionsAPP`.
- Added a native Fast-Lap area with challenge list, challenge details, track selector, per-track leaderboard, best time, and club reference times.
- Added the Fast-Lap module to the native More screen.
- Renamed APK release artifacts and GitHub release titles to `LionsAPP`.
- Clarified Android release signing errors so missing repository secrets are easier to diagnose.

## 0.1.0-alpha.7 - 2026-05-19

- Added a native News area with list and detail screens, including linked tournaments and events.
- Made Home news cards open the matching native news detail view.
- Added `/api/mobile/profile/references` for personal tournament and Fast-Lap references from the logged-in user's live account data.
- Added a "Referenzen" profile tab for personal placements, Fast-Lap ranks, podiums, wins, and season points.
- Moved public club CMS references out of the main app module list so "Referenzen" now means user profile history.

## 0.1.0-alpha.6 - 2026-05-19

- Added `/api/mobile/dashboard` as a native app dashboard feed for user-specific tournaments, events, open matches, actions, public upcoming items, and latest news.
- Rebuilt the app Home screen around live dashboard data with "Meine naechsten Termine", "Offene Aktionen", upcoming matches, and News sections.
- Added direct navigation from Home tournament cards and tournament actions into the native tournament detail screen.
- Added event and news visibility on Home so the first screen reflects current website content more closely.

## 0.1.0-alpha.5 - 2026-05-19

- Added explicit "Angemeldet bleiben" handling for mobile login and restored sessions via refresh token on app start.
- Improved logout and guest-mode token handling so persisted sessions are not left behind accidentally.
- Fixed Android bottom tab safe-area spacing so the menu stays above system navigation.
- Added a shared mobile media image component for local, API-relative, and external image URLs.
- Started rendering team logos, member avatars, sponsor logos, partner logos, and public profile avatars in native views.
- Switched partner and reference info tabs to the real website API sources instead of placeholder/member-derived data.

## 0.1.0-alpha.4 - 2026-05-19

- Release builds now require a stable Android upload key instead of the Android debug certificate.
- GitHub Releases now embed the matching changelog entry directly in the release body.
- APK releases now include SHA-256 checksum and signer certificate metadata next to the APK.
- The release workflow now fails if a public APK would be debug-signed.
- Added distribution guidance for APK sideloading, Play Protect, and Google Play testing.

## 0.1.0-alpha.3 - 2026-05-19

- Expanded the native profile screen with profile banner, avatar, editing, privacy settings, notification preferences, social links, game IDs, and mail overview.
- Added achievement groups with collapsible tiers, progress display, point totals, and manual achievement evaluation.
- Expanded tournament details with info, bracket, matches, standings, participants, prizes, and rules tabs.
- Removed demo-only assumptions from the app views and kept the mobile app pointed at the live API.

## 0.1.0-alpha.2 - 2026-05-19

- Added GitHub Actions CI for backend, frontend, and mobile checks.
- Added CodeQL analysis for JavaScript and TypeScript.
- Added Dependabot updates for npm, pip, and GitHub Actions.
- Added automated Android APK release builds through GitHub Actions.

## 0.1.0-alpha.1 - 2026-05-19

- Added the first native Android alpha for THE LION SQUAD.
- Added live login against the website API.
- Added mobile navigation for home, tournaments, teams, profile, and more.
