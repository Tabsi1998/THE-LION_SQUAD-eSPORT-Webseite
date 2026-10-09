# Staging, Release und Rollback

Offene Arbeit: GitHub-Meilensteine. Das Abnahmeprotokoll mit den Klicktests führt der Betreiber
außerhalb des Repositorys.

## Wenn nur der Produktivserver vorhanden ist

Erster Schritt in der vorhandenen Serverkonsole, aus dem aktualisierten Checkout:

```bash
bash scripts/staging-preflight.sh
```

Der Check ist ausschließlich lesend: keine Installationen, kein Build/Start/Stop,
keine `.env`-Inhalte und keine neuen Ports. Er meldet Ressourcen, Testport-Belegung,
Docker-/Compose-Verfügbarkeit und bekannte Containerzustände. Die Ausgabe zuerst
gemeinsam bewerten; `manual_review_required` ist **keine Startfreigabe**.
Fehlen die Dateien auf dem Server, nur die Preflight-Dateien bereitstellen statt
deshalb ungeprüft den Produktivstack zu aktualisieren.

Staging kann nach bestätigter Kapazitätsreserve auf demselben Host laufen. Vorher
RAM/CPU/Plattenplatz, belegte Ports, Compose-Ziele, Backups und Reverse-Proxy read-only
prüfen. Containerlimits begrenzen nicht die Last eines Image-Builds. Bei knappen
Ressourcen nicht parallel bauen/starten; ein gemeinsamer Host bleibt eine Ausfallzone.

Öffentliches SSH ist dafür nicht nötig. Die vorhandene Hosting-/Serverkonsole oder
ein privater Zugang genügt; ohne direkten Agent-Zugriff führt der Betreiber die von
mir vorbereiteten Befehle dort aus. Staging dient nur der sicheren Update-Abnahme,
nicht dem Freischalten einer Website-Funktion.

Ein **separates Checkout** verwenden, nicht den Git-Stand des laufenden Produktivstacks
wechseln. Eigene HTTPS-Subdomain festlegen; Produktion und DNS nicht umschalten.
`tls-staging` ist ein eigenes Compose-Projekt mit eigenen Volumes und Netzwerk.
Vor dem Start die aufgelöste Konfiguration auf reine Loopback-Bindings, Ports
13000/18001, Staging-DB und getrennte Volumes prüfen, ohne Secrets zu protokollieren.
MongoDB-Ressourcenlimit für den zweiten Stack passend zur gemessenen Reserve festlegen.
Keine exportierten Produktionsvariablen in der Staging-Shell übernehmen: Shell-Variablen
haben bei Compose Vorrang vor `--env-file`.

`AUTH_COOKIE_DOMAIN` leer lassen (hostgebundene Cookies), Scheduler zunächst deaktivieren
und ausschließlich Testpostfächer/Test-Integrationen verwenden. Bei Bedarf die Subdomain
am Proxy auf Tester beschränken; Crawler-Ausschluss allein ist kein Zugriffsschutz.

## Staging einmalig einrichten

```bash
cp .env.staging.example .env.staging
nano .env.staging
python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
openssl rand -hex 32
bash scripts/staging-up.sh
```

Die ausgegebenen Zufallswerte als `SETTINGS_ENCRYPTION_KEY`, `JWT_SECRET` und ein separates
Mongo-Passwort eintragen. Staging nutzt eigene Container, Ports, Datenbank und Volumes. Niemals
Produktiv-Secrets oder einen Produktiv-Datenbankdump ohne vorherige Anonymisierung verwenden.

Standardmäßig: Web `127.0.0.1:13000`, API `127.0.0.1:18001`. Der Staging-Reverse-Proxy erhält eine
eigene HTTPS-Domain. Stoppen ohne Datenverlust:

```bash
bash scripts/staging-down.sh
```

## Abnahme

```bash
bash scripts/release-preflight.sh
PUBLIC_AUDIT_BASE_URL=https://staging.example.at corepack yarn --cwd frontend audit:public
```

Zusätzlich manuell testen: Registrierung plus E-Mail-Verifikation, Login/MFA, Google mit eigenem
Client, Passwortreset, erneute Zustimmung, Upload, Turnieranmeldung, Moderationsmeldung,
Admin-Rollen, Testmail und verschlüsseltes Backup samt Restore-Drill.

Die Fälle einzeln im Abnahmeprotokoll festhalten. Schreibende Live-Tests niemals
mit dem Produktivziel als Ersatz für fehlendes Staging ausführen.

## Release erstellen

Nur einen grün geprüften und auf Staging abgenommenen Commit markieren. Die Version
unten ist ein Beispiel; vor dem Taggen den tatsächlich nächsten freien Releasetag bestimmen:

```bash
git tag -a v2.3.0 -m "TLS platform v2.3.0"
git push origin v2.3.0
```

## Produktiv deployen

```bash
cd /opt/the-lion-squad
bash scripts/deploy-release.sh v2.3.0
```

Das Skript verlangt einen sauberen Worktree, speichert den vorherigen Commit, legt ein
verschlüsseltes Backup an, baut die Container und prüft Backend, Frontend und SPA-Routen.

## Rollback

Wenn nur der Code zurück muss:

```bash
target=$(cat .deploy/previous-release)
ROLLBACK_CONFIRM="$target" bash scripts/rollback-release.sh "$target"
```

Wenn eine Migration Daten inkompatibel verändert hat, zuerst den Dienst stoppen und anschließend
den ausdrücklich bestätigten Restore aus `BACKUP_RESTORE.md` verwenden. Ein DB-Restore ist keine
Standardreaktion auf einen reinen Frontendfehler.

## Go-live

- DNS/Proxy auf den richtigen Loopback-Port, TLS und HTTP→HTTPS prüfen.
- `/api/health/live`, `/api/health/ready` und `/health` extern überwachen.
- Admin-Setup 100 %, MFA für alle Admins, keine unnötigen Rollen.
- Google, SMTP/Resend, Discord und Twitch ausschließlich mit eigenen Zugängen testen.
- Impressum, Datenschutz, Nutzungsbedingungen und Consent-Versionen kontrollieren.
- Backup, Offsite-Kopie und Restore-Drill erfolgreich.
- Browser-Smoke auf Desktop und Mobil; danach Logs und Mailqueue mindestens 30 Minuten beobachten.
