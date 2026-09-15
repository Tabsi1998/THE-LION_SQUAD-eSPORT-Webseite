# App-Releases

Die LionsAPP für Android wird **lokal gebaut** und als GitHub-Release veröffentlicht. GitHub Actions baut nur noch im Notfall und nur von Hand ([mobile-release.yml](../.github/workflows/mobile-release.yml)), weil Actions-Minuten Geld kosten. Die Webseite ist davon getrennt.

## Versionen

| Version | Bedeutung |
| --- | --- |
| `0.2.0-beta`, `0.3.0-beta` … | Vor 1.0.0 gibt es nur Betas. |
| `1.0.0` | Das erste richtige Release. |
| `1.2.3-beta`, danach `1.2.3` | Ab 1.0.0: erst die Beta zum Testen, dann dieselbe Version als Release. |

- Neue Funktionen: Minor erhöhen, z. B. `0.2.0-beta` → `0.3.0-beta`.
- Nur Fehlerbehebungen: Patch erhöhen, z. B. `0.2.0-beta` → `0.2.1-beta`.
- Die Version steht gleich in `mobile/package.json`, `mobile/package-lock.json` und `mobile/app.json`. Der Preflight prüft das.

### Build-Zähler

Android vergleicht beim Update nicht die Version, sondern `expo.android.versionCode` in `app.json`. Er steigt mit **jedem** Build um mindestens 1, auch wenn dieselbe Version neu gebaut wird. `expo.ios.buildNumber` zieht mit.

Im September 2026 fing die sichtbare Version neu bei 0.x an (#205). Die alten 1.x- und 2.x-Betas sind historisch; der Build-Zähler lief einfach weiter, von Build 56 auf 57. Gleichzeitig kam ein neuer Signaturschlüssel (siehe unten): Wer eine App bis Build 56 installiert hat, muss sie einmal löschen und Build 57 neu installieren.

### Namen

| | Beispiel |
| --- | --- |
| Tag | `mobile-v0.2.0-beta-build57` |
| Release | `LionsAPP v0.2.0-beta (Build 57)` |
| APK | `LionsAPP-v0.2.0-beta-build57-<commit>.apk` |

Betas erscheinen auf GitHub als Pre-Release, Releases als „Latest“.

## Einmalig einrichten

Alles Geheime liegt **außerhalb des Repos**, standardmäßig in `%USERPROFILE%\.lionsapp-release`. Ein anderer Ort geht über die Umgebungsvariable `LIONSAPP_RELEASE_DIR`.

```text
.lionsapp-release\
  upload.jks             Upload-Schlüssel der App (seit Build 57)
  google-services.json   aus Firebase, Android-App at.lionsquad.app (für Push)
  signing.json           Passwörter und Pfade
```

Aufbau von `signing.json`:

```json
{
  "storeFile": "upload.jks",
  "storePassword": "…",
  "keyAlias": "…",
  "keyPassword": "…",
  "javaHome": "C:/Pfad/zum/jdk-21",
  "androidHome": "C:/Users/<name>/AppData/Local/Android/Sdk"
}
```

Pfade mit `/` schreiben. Ein einzelner `\` ist in JSON ungültig; das Skript meldet dann die Stelle, aber nie den Inhalt.

Statt der Datei gehen auch Umgebungsvariablen: `LIONSAPP_KEYSTORE`, `LIONSAPP_KEYSTORE_PASSWORD`, `LIONSAPP_KEY_ALIAS`, `LIONSAPP_KEY_PASSWORD`, `LIONSAPP_GOOGLE_SERVICES`, `LIONSAPP_JAVA_HOME`, `LIONSAPP_ANDROID_HOME`.

Außerdem nötig: JDK 21, Android SDK mit Build-Tools und eine angemeldete GitHub CLI (`gh auth login`).

**Der Schlüssel lässt sich nicht ersetzen.** Eine APK mit anderem Schlüssel lässt sich nicht über eine installierte LionsAPP installieren; alle müssten die App erst löschen. Das Skript bricht deshalb ab, wenn das Zertifikat nicht das erwartete ist (SHA-256 `6f69a289…cb98`, vollständig in `scripts/release-version.cjs`).

Genau das ist mit Build 57 einmal passiert: Der alte Schlüssel (SHA-256 `0c5562d7…97a1`) lag nur noch als GitHub-Secret vor. Statt ihn über GitHub Actions zurückzuholen, gibt es seit Build 57 einen neuen (#205). Die Push-Datei ließ sich dagegen aus der veröffentlichten APK von Build 56 zurückgewinnen, denn ihre Werte stecken in jeder APK.

### Schlüssel sichern

Den ganzen Ordner `%USERPROFILE%\.lionsapp-release` sichern, zum Beispiel auf einem USB-Stick, der sicher verwahrt wird, oder als Anhang im Passwortmanager. Nie ins Repo, nie in einen Chat oder ein Log. Geht er verloren, muss jede installierte App wieder gelöscht und neu installiert werden.

## Release bauen

Vorher im PR: Version und Build-Zähler erhöhen, einen Abschnitt in `CHANGELOG.md` schreiben, die Version unten in der Historie eintragen. Dann nach `main` mergen und lokal `main` holen.

```bash
cd mobile
npm run release:local -- --check     # zeigt, was fehlt
npm run release:local -- --dry-run   # baut und prüft, veröffentlicht nichts
npm run release:local                # baut, prüft und legt das Release an
```

Das Skript geht so vor:

1. Es prüft Version, Build-Zähler gegen alle bisherigen Tags, einen sauberen Stand auf `main` wie auf GitHub, Werkzeuge und Schlüssel. Ob der Schlüssel **der richtige** ist, zeigt schon `--check`, ohne zu bauen: keytool liest das Zertifikat, das Passwort geht dabei nur über eine Umgebungsvariable.
2. Es führt Preflight, Typecheck und Tests aus.
3. Es erzeugt das Android-Projekt (`expo prebuild`) und baut mit Gradle die APK.
4. Es prüft die Signatur: kein Debug-Zertifikat, das erwartete Zertifikat. Dann berechnet es SHA-256.
5. Es legt das GitHub-Release an, mit APK, Prüfsumme, Signaturangaben und dem Changelog-Abschnitt.

Passwörter bekommt Gradle nur über Umgebungsvariablen. Die Push-Datei wird nach dem Build aus `mobile/` entfernt, auch wenn der Build abbricht. `android/` und `builds/` sind von Git ausgeschlossen.

Gebaut wird in einem eigenen Ordner außerhalb des Repos (Standard `C:\lsb`, änderbar mit `buildDir` in `signing.json`). Das Skript legt dort ein Git-Worktree des Commits an und installiert die Abhängigkeiten; beim nächsten Mal bleiben sie erhalten. So entspricht die APK genau dem Commit, und der Pfad ist kurz und ohne Leerzeichen. Im Projektpfad `C:\GIT Privat\…` brach der native Build von react-native-reanimated mit `manifest 'build.ninja' still dirty after 100 tries` ab; ein Umweg über ein `subst`-Laufwerk half nicht, weil Node die Pfade wieder zum echten Ort auflöst. Der Ordner braucht einige GB und darf jederzeit gelöscht werden. Der erste Build dauert rund 15 Minuten.

## Notweg über GitHub Actions

Den Workflow `Mobile APK Release` von Hand starten. Er braucht die Repository-Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` und `GOOGLE_SERVICES_JSON_BASE64`. Er baut eine signierte APK als Artefakt (7 Tage aufbewahrt) und veröffentlicht nichts.

## Anzeige auf GitHub

GitHub sortiert Releases nach Veröffentlichungsdatum, nicht nach Version. Alte Releases deshalb nicht neu veröffentlichen, höchstens Titel oder Text korrigieren.

## Historie

Neueste oben.

- `0.2.0-beta`: Build 57, erste Version im neuen Schema

Vor dem Neustart bei 0.x galt ein Schema mit Zähler (`-beta.N`, `-alpha.N`). Diese Versionen sind historisch:

```text
2.0.0-beta.2
2.0.0-beta.1
1.5.0-beta.9
1.5.0-beta.8
1.5.0-beta.7
1.5.0-beta.6
1.5.0-beta.5
1.5.0-beta.4
1.5.0-beta.3
1.5.0-beta.2
1.5.0-beta.1
1.0.0-beta.13
1.0.0-beta.12
1.0.0-beta.11
1.0.0-beta.10
1.0.0-beta.9
1.0.0-beta.8
1.0.0-beta.7
1.0.0-beta.6
1.0.0-beta.5
1.0.0-beta.4
1.0.0-beta.3
1.0.0-beta.2
1.0.0-beta.1
0.12.0-beta.3
0.12.0-beta.2
0.12.0-beta.1
0.11.0-alpha.2
0.11.0-alpha.1
0.10.0-alpha.1
0.9.0-alpha.1
0.8.0-alpha.1
0.7.0-alpha.1
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

Die alte 0.x-Alpha-Reihe endete bei `0.12.0-beta.3`. Mit dem neuen Schema geht es bei `0.2.0-beta` weiter; die Tags unterscheiden sich durch den Build (`-build57`), deshalb gibt es keinen Konflikt.
