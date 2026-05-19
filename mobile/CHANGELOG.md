# Changelog

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
