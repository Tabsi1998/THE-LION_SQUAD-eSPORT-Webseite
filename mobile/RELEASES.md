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

Die interne Version bleibt SemVer-kompatibel, damit npm, Expo, GitHub Tags und Automatisierung sauber sortieren koennen. Der sichtbare Release-Name darf trotzdem lesbarer sein.

Empfohlenes Schema:

```text
1.0.0
1.0.0-beta.1
0.2.0-alpha.1
0.1.2-alpha.1
0.1.1-alpha.1
0.1.0-alpha.14
```

Regeln:

- Kleine Bugfixes/Hotfixes: Patch erhoehen und Alpha-Zaehler neu starten, z.B. `0.1.0-alpha.14` -> `0.1.1-alpha.1`.
- Mehrere kleine Alpha-Builds im selben Patch: Alpha-Zaehler erhoehen, z.B. `0.1.1-alpha.1` -> `0.1.1-alpha.2`.
- Groessere neue Funktionsphase: Minor erhoehen, z.B. `0.1.x` -> `0.2.0-alpha.1`.
- Breiterer Test: Beta-Kanal, z.B. `1.0.0-beta.1`.
- Produktive Version: stabile SemVer ohne Suffix, z.B. `1.0.0`.

Bei jedem Android-Release muss `expo.android.versionCode` in `mobile/app.json` um mindestens `1` erhoeht werden. Der `versionCode` ist der technische Android-Build-Zaehler und kann z.B. `15` sein, waehrend die sichtbare Version `0.1.1-alpha.1` ist.

## Release-Namen

Interner Tag:

```text
mobile-v0.1.1-alpha.1
```

Sichtbarer GitHub-Release-Name:

```text
LionsAPP ALPHA v0.1.1 (Build 15)
```

APK-Name:

```text
LionsAPP-ALPHA-v0.1.1-build15-<commit>.apk
```

Der Build-Zusatz kommt aus `expo.android.versionCode`. Dadurch ist fuer Tester klar, welche APK neuer ist, ohne dass die App-Version endlos bei `0.1.0-alpha.X` bleibt.

Historische Einordnung, neueste Version oben:

```text
0.6.0-alpha.1
0.5.0-alpha.1
0.4.0-alpha.1
0.3.0-alpha.1
0.2.0-alpha.1
0.1.1-alpha.1
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

## APK manuell bauen

In GitHub unter `Actions` den Workflow `Mobile APK Release` starten. Der Workflow erzeugt ein Artefakt mit diesem Namensschema:

```text
LionsAPP-ALPHA-v0.6.0-build20-<commit>.apk
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
git tag mobile-v0.1.1-alpha.1
git push origin mobile-v0.1.1-alpha.1
```

Der Workflow haengt die APK automatisch an den Release. Alpha- und Beta-Releases werden als `prerelease` markiert.

## Anzeige auf GitHub

GitHub zeigt Releases nicht strikt nach SemVer an, sondern primaer nach Release-/Publikationszeit. Deshalb kann ein alter Release oben landen, wenn er nachtraeglich neu erstellt oder neu publiziert wird.

Saubere Vorgehensweise:

- Neue Releases immer normal ueber neue Tags erstellen.
- Alte Releases nicht neu erstellen, wenn nur die Historie schoener aussehen soll.
- Bestehende alte Releases lieber umbenennen und den Text korrigieren, statt sie zu loeschen und neu zu publizieren.
- Fehlende alte Alpha-Stufen im Changelog und in dieser Release-Doku dokumentieren.
- Die aktuelle empfohlene APK steht immer im neuesten tatsaechlichen Release oben.

## Historische Alpha-Releases

Die vollstaendige Historie steht im `CHANGELOG.md`. Aeltere Alpha-Versionen sollten nicht nachtraeglich neu publiziert werden, wenn die GitHub-Release-Liste strikt absteigend bleiben soll: GitHub sortiert Releases nach Publikationsdatum, dadurch wuerden neu erstellte alte Releases oberhalb der aktuellen Alpha erscheinen. Fuer alte Versionen ohne APK ist deshalb eine Changelog-only-Dokumentation sauberer als ein nachtraeglich veroeffentlichter APK-Rebuild.

Bestehende Releases koennen nachtraeglich im Titel und Release-Text korrigiert werden, z.B. auf `LionsAPP ALPHA v0.1.0 (Build 14)`. Bereits veroeffentlichte APK-Dateinamen sollten als historische Artefakte unveraendert bleiben, ausser es gibt einen harten Grund fuer ein bewusstes Re-Upload.
