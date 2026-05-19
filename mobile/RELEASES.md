# Mobile Releases

Die Android-App wird als APK ueber GitHub Actions gebaut. GitHub Releases enthalten die APK, eine SHA-256-Pruefsumme, die Signatur-Metadaten und die passenden Changelog-Details direkt im Release-Text.

## Kanaele

- `alpha`: fruehe Testversion fuer freiwillige Tester
- `beta`: breiterer Test, wenn die Kernfunktionen stabil sind
- `stable`: spaeter fuer produktive Releases

Die Webseite bleibt davon getrennt. Ein App-Release veroeffentlicht nur die APK.

## Versionierung

Die Version steht an zwei Stellen und muss gleich sein:

- `mobile/package.json`
- `mobile/app.json`

Schema fuer Vorabversionen:

```text
0.1.0-alpha.1
0.1.0-alpha.2
0.1.0-alpha.5
0.1.0-alpha.6
0.1.0-alpha.7
0.1.0-alpha.8
0.1.0-alpha.9
0.1.0-beta.1
1.0.0
```

Bei jedem Android-Release muss `expo.android.versionCode` in `mobile/app.json` um mindestens `1` erhoeht werden.

## APK manuell bauen

In GitHub unter `Actions` den Workflow `Mobile APK Release` starten. Der Workflow erzeugt ein Artefakt mit diesem Namensschema:

```text
LionsAPP-android-alpha-v0.1.0-alpha.9-<commit>.apk
```

## Release-Signatur

GitHub-Releases muessen mit dem stabilen Upload-Key signiert werden. Dafuer braucht der Workflow diese Repository-Secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Ohne diese Repository-Secrets bricht der Release-Workflow ab, damit keine oeffentliche Debug-signierte APK entsteht. GitHub Actions Variables reichen dafuer nicht.

## GitHub Release erstellen

Fuer einen echten GitHub-Release einen Tag pushen:

```bash
git tag mobile-v0.1.0-alpha.9
git push origin mobile-v0.1.0-alpha.9
```

Der Workflow haengt die APK automatisch an den Release. Alpha- und Beta-Releases werden als `prerelease` markiert.
