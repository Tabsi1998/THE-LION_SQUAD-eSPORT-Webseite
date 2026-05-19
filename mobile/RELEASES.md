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

Schema fuer Vorabversionen, neueste Version oben:

```text
1.0.0
0.1.0-beta.1
0.1.0-alpha.14
0.1.0-alpha.13
0.1.0-alpha.12
0.1.0-alpha.11
0.1.0-alpha.10
0.1.0-alpha.9
0.1.0-alpha.8
0.1.0-alpha.7
0.1.0-alpha.6
0.1.0-alpha.5
0.1.0-alpha.4
0.1.0-alpha.3
0.1.0-alpha.2
0.1.0-alpha.1
```

Bei jedem Android-Release muss `expo.android.versionCode` in `mobile/app.json` um mindestens `1` erhoeht werden.

## APK manuell bauen

In GitHub unter `Actions` den Workflow `Mobile APK Release` starten. Der Workflow erzeugt ein Artefakt mit diesem Namensschema:

```text
LionsAPP-android-alpha-v0.1.0-alpha.14-<commit>.apk
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
git tag mobile-v0.1.0-alpha.14
git push origin mobile-v0.1.0-alpha.14
```

Der Workflow haengt die APK automatisch an den Release. Alpha- und Beta-Releases werden als `prerelease` markiert.

## Historische Alpha-Releases

Die vollstaendige Historie steht im `CHANGELOG.md`. Aeltere Alpha-Versionen sollten nicht nachtraeglich neu publiziert werden, wenn die GitHub-Release-Liste strikt absteigend bleiben soll: GitHub sortiert Releases nach Publikationsdatum, dadurch wuerden neu erstellte alte Releases oberhalb der aktuellen Alpha erscheinen. Fuer alte Versionen ohne APK ist deshalb eine Changelog-only-Dokumentation sauberer als ein nachtraeglich veroeffentlichter APK-Rebuild.
