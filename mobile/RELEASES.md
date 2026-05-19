# Mobile Releases

Die Android-App wird als APK ueber GitHub Actions gebaut.

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
0.1.0-beta.1
1.0.0
```

Bei jedem Android-Release muss `expo.android.versionCode` in `mobile/app.json` um mindestens `1` erhoeht werden.

## APK manuell bauen

In GitHub unter `Actions` den Workflow `Mobile APK Release` starten. Der Workflow erzeugt ein Artefakt mit diesem Namensschema:

```text
THE-LION-SQUAD-android-alpha-v0.1.0-alpha.1-<commit>.apk
```

## GitHub Release erstellen

Fuer einen echten GitHub-Release einen Tag pushen:

```bash
git tag mobile-v0.1.0-alpha.1
git push origin mobile-v0.1.0-alpha.1
```

Der Workflow haengt die APK automatisch an den Release. Alpha- und Beta-Releases werden als `prerelease` markiert.
