# Repository Strategy

GitHub kann keine einzelnen Ordner innerhalb eines Repositories unterschiedlich sichtbar machen. Ein Repository ist insgesamt `public` oder `private`.

## Zielbild

- App fuer die Oeffentlichkeit: APKs duerfen frei heruntergeladen und getestet werden.
- Webseite/Admin/Deployment: Code, Update-Anleitungen, Serverdetails und Betriebsdoku sollen nicht oeffentlich sein.
- Releases: App-Versionen sollen sauber versioniert und nachvollziehbar bleiben.

## Empfohlene Struktur

### Sauberste Variante

1. Privates Haupt-Repository fuer Webseite, Backend, Admin und Deployment.
2. Oeffentliches App-Release-Repository fuer:
   - GitHub Releases
   - APK Downloads
   - Changelog
   - minimale Nutzer-Anleitung

Damit bleibt die Webseite geschuetzt, waehrend Tester die APK einfach herunterladen koennen.

### Monorepo-Variante

Ein einziges oeffentliches Repository ist nur sinnvoll, wenn auch der Website-Code oeffentlich sein darf. Unterordner wie `frontend/`, `backend/` oder `docs/` koennen nicht separat gesperrt werden.

Ein einziges privates Repository schuetzt alles, macht aber oeffentliche APK-Downloads ueber GitHub Releases nicht wirklich sauber fuer alle verfuegbar.

## Aktueller Stand

Dieses Repository baut APKs ueber den Workflow `Mobile APK Release`. Tags im Format `mobile-v...` erzeugen einen GitHub Release mit APK-Anhang.

Beispiel:

```bash
git tag mobile-v0.1.0-alpha.2
git push origin mobile-v0.1.0-alpha.2
```

Der Release ist ein App-Release. Er deployed nicht automatisch die Webseite.

## Versionierung

- `alpha`: fruehe oeffentliche Testversion
- `beta`: breiterer Test, wenn Kernfunktionen stabil sind
- `stable`: spaeter fuer produktive Versionen

Android braucht bei jedem APK-Release eine hoehere `expo.android.versionCode` in `mobile/app.json`.
