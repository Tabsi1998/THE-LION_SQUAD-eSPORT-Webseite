# Mobile Security and Distribution

## Current Distribution Target

The public APK is an alpha build for Android testers. It can be attached to GitHub Releases, but GitHub is still an external APK source. Android can therefore show unknown-source and Play Protect prompts even when the APK is correctly signed.

The clean path for broad testing is Google Play Console:

- Internal testing for a small tester list.
- Closed testing for invited members.
- Open testing when the app is ready for wider public testing.

Google Play distribution removes the manual sideload flow because users install through the Play Store.

## Release Signing

Public APKs must never be signed with the Android debug certificate. The release workflow requires these GitHub Actions secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore itself must stay private and outside Git. If it is lost, existing sideloaded APK installations can no longer be updated with the same package name and certificate.

For Google Play, this key should be treated as the upload key. Google Play App Signing can then manage the final app signing key for Play Store distribution.

## Local Signing Secret Setup

Convert the local Java keystore to a GitHub secret value with PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("mobile\local-signing\the-lion-squad-upload.jks"))
```

Store the output as `ANDROID_KEYSTORE_BASE64` in GitHub repository secrets. Store the matching passwords and alias in the other three secrets.

## Release Integrity

Each GitHub APK release includes:

- The APK file.
- A `.sha256` checksum file.
- A `.signature.txt` file with the signer certificate metadata.
- Embedded release notes from `mobile/CHANGELOG.md`.

The workflow verifies the APK signature and fails if it detects the Android debug certificate.

## Play Protect Notes

Play Protect scans apps from Google Play and other sources. For APKs installed outside Google Play, users may be asked to scan or submit the unknown app to Google. That warning cannot be removed purely by changing the APK file.

What reduces warnings and risk:

- Use a stable release signing key.
- Keep Android target SDK current.
- Request only necessary permissions.
- Distribute through Google Play testing when possible.
- Keep checksums and release notes visible.
- Avoid repackaged APKs or third-party mirrors.
