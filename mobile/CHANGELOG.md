# Changelog

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
