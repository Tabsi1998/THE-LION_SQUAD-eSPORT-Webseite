# Mobile Security and Distribution

## Current Distribution Target

The public APK is a beta build for Android testers. It can be attached to GitHub Releases, but GitHub is still an external APK source. Android can therefore show unknown-source and Play Protect prompts even when the APK is correctly signed.

The clean path for broad testing is Google Play Console:

- Internal testing for a small tester list.
- Closed testing for invited members.
- Open testing when the app is ready for wider public testing.

Google Play distribution removes the manual sideload flow because users install through the Play Store.

## Release Signing

Public APKs must never be signed with the Android debug certificate, and every APK must be signed with the same upload key as all previous releases (certificate SHA-256 `0c5562d7…97a1`). An APK with a different certificate cannot update an installed app.

Releases are built locally with `npm run release:local`, see [RELEASES.md](RELEASES.md). The keystore, its passwords and `google-services.json` stay outside the repository, by default in `%USERPROFILE%\.lionsapp-release`. The script refuses a keystore inside the repository, passes the signing values to Gradle only through environment variables, removes the generated push config after the build and refuses to publish an APK whose certificate differs.

The manual GitHub workflow remains as an emergency path. It reads the same values from repository secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) and only produces an artifact.

If the keystore is lost, existing sideloaded APK installations can no longer be updated with the same package name and certificate. Keep an offline backup.

For Google Play, this key should be treated as the upload key. Google Play App Signing can then manage the final app signing key for Play Store distribution.

## Release Integrity

Each GitHub APK release includes:

- The APK file.
- A `.sha256` checksum file.
- A `.signature.txt` file with the signer certificate metadata.
- Embedded release notes from `mobile/CHANGELOG.md`.

The release script verifies the APK signature and fails on the Android debug certificate or a different upload key.

## Play Protect Notes

Play Protect scans apps from Google Play and other sources. For APKs installed outside Google Play, users may be asked to scan or submit the unknown app to Google. That warning cannot be removed purely by changing the APK file.

What reduces warnings and risk:

- Use a stable release signing key.
- Keep Android target SDK current.
- Request only necessary permissions.
- Distribute through Google Play testing when possible.
- Keep checksums and release notes visible.
- Avoid repackaged APKs or third-party mirrors.

## Google Play Internal Testing Readiness

Internal testing should be the first Play Console track. It keeps the app away from public listing traffic while removing the sideload flow for selected testers.

Before uploading the first internal testing build:

- Confirm the package name stays `at.lionsquad.app`.
- Use the same upload key as the local release script.
- Upload an AAB build for Play Console, while APK releases can continue on GitHub for manual testers.
- Add a small tester list first, then expand after login, Home, Events, Teams, Chat, Profile, Notifications and logout have been smoke-tested.
- Keep the release name aligned with the mobile changelog, e.g. `LionsAPP v0.2.0-beta (Build 57)`.

Manual smoke-test checklist for every alpha candidate:

- Fresh install opens Login/Register without crash.
- Existing account login restores the session after app restart.
- Home loads live dashboard data.
- Events, Turniere, Fast Laps, Teams, Profile and More open without layout overlap.
- Notification bell and popup do not overlap the status bar or bottom navigation.
- A notification tap opens the expected native target.
- Team chat and direct messages can send and receive messages.
- Logout clears the session and returns to Login.

## Runtime Crash Handling

The app includes a native render error boundary. If a screen-level render error occurs, testers see a controlled fallback with an option to reload the view instead of a blank screen. This is not a replacement for production crash reporting; before beta or Play Store rollout, add a dedicated crash-reporting backend such as Sentry, Firebase Crashlytics or an equivalent service approved for the project.
