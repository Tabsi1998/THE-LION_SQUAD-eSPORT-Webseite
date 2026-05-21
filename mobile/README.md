# THE LION SQUAD Mobile

Native mobile app built with Expo / React Native. The web app stays unchanged; this app talks to the same backend API through mobile bearer-token auth.

## Development

```powershell
cd C:\Privat\Programmierung\bracket-system\mobile
npm install
npm run android
```

In development, the default API target is `http://10.0.2.2:8001`, the Android emulator alias for the host machine. For a custom backend:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:8001"
npm run android
```

Release builds default to `https://lionsquad.at`. The login uses the deployed mobile bearer-token endpoints under `/api/auth/mobile/*`; public areas can also be opened without login through the live data mode.

## Checks

```powershell
npm run typecheck
npx expo install --check
npx expo export --platform android
npm audit --audit-level=moderate
```

## Push Notifications

Remote push notifications are delivered by the OS through Expo Push. The app does not need to keep a polling process running in the background for normal "app closed from recents" cases.

Operational requirements:

- Build/install a native Android or iOS build after `app.json` changes.
- Android 13+ must grant notification permission.
- Android release builds need valid Expo/EAS push credentials for the project id in `app.json`.
- The backend must be running the push sender code and able to reach `https://exp.host/--/api/v2/push/send`.
- A user must have logged in once on the device so the Expo push token is registered under `/api/mobile/push-token`.
- Notifications are not reliable after an explicit OS-level force stop or when the user/vendor blocks notifications or background activity for the app.

Current backend push sources include direct messages, mentions in team/tournament chat, team invites, tournament/match reminders and other entries created through `create_user_notification`.

## Implemented Foundation

- Native Expo app shell
- Website-aligned THE LION SQUAD colors and brand assets
- Secure mobile token storage with `expo-secure-store`
- Mobile login/register/refresh/logout API flow
- Authenticated API client with bearer token refresh
- Bottom tabs: Dashboard, Turniere, Teams, Profil, Mehr
- API-backed user areas: dashboard summary, tournaments, teams, profile, info center, events, sponsors, public profiles

## Next User Modules

- Match-Hub: report result, disputes, schedule proposals, chat
- Tournament detail: registration, check-in, bracket, standings
- Team detail: chat, invites, squads, member actions
- Events: event registration and participant state
- Fastlap: challenge detail, tracks, leaderboard, own times
- Member area: benefits, documents, member news, membership status
- Social: public profiles, friends, direct messages
- Media/content: news, gallery, servers
