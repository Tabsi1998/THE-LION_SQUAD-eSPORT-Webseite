# Konfiguration durch den Betreiber

Die Plattform enthält keine Zugangsdaten eines früheren Dienstleisters. Geheimnisse
werden entweder in der Server-`.env` oder verschlüsselt über den Adminbereich gespeichert.

## 1. Erster Start

```bash
cp .env.example .env
./install.sh
```

Danach als Superadmin anmelden, MFA im Profil einrichten und `/setup` öffnen. Den dortigen
Gesundheitswert auf 100 % bringen.

## 2. Google-Anmeldung mit deinem eigenen Konto

1. In der Google Cloud Console ein eigenes Projekt auswählen oder erstellen.
2. Den OAuth-Zustimmungsbildschirm mit Vereinsname, Supportadresse, Domain sowie Links zu
   `/privacy` und `/terms` pflegen.
3. Unter „APIs & Services → Credentials“ eine OAuth-Client-ID vom Typ „Web application“
   erstellen.
4. Als autorisierte JavaScript-Quellen exakt `https://lionsquad.at` und – falls genutzt –
   `https://www.lionsquad.at` bzw. deine Staging-Domain eintragen. Keine Wildcards.
5. Im Superadminbereich `Einstellungen → Anmeldung` nur die öffentliche Client-ID im Format
   `…apps.googleusercontent.com` eintragen, testen und danach Login/Registrierung/Verknüpfung
   gezielt aktivieren.

Ein Google-Client-Secret wird für Google Identity Services nicht benötigt und gehört weder
ins Frontend noch in den Adminbereich. Bestehende Konten werden nicht allein anhand einer
gleichen E-Mail automatisch verknüpft; die Verknüpfung erfolgt angemeldet im eigenen Profil.

## 3. Passkeys für die Website

Passkeys benötigen keinen Anbieter, API-Key oder Google-Zugang. Der Backenddienst
leitet die feste Domain und Herkunft aus `FRONTEND_URL` ab. Produktion benötigt
HTTPS; Entwicklung erlaubt auch `http://localhost` mit Port. IP-Adressen sind keine Passkey-Domain.
`PASSKEY_ENABLED=true` ist der Standard und wird von Compose an das Backend übergeben.
Mit `false` lassen sich Einrichtung und Anmeldung abschalten.

1. Mit bestätigter E-Mail-Adresse anmelden und gegebenenfalls Admin-MFA abschließen.
2. Im Profil unter **Grunddaten → Passkeys** einen Namen und das aktuelle Passwort
   eingeben, „Passkey hinzufügen“ wählen und den Gerätedialog bestätigen.
3. Abmelden und **Mit Passkey anmelden** testen. Die Geräte-PIN, Fingerabdruck oder
   Gesichtserkennung wird vom Gerät geprüft. Admin-MFA bleibt zusätzlich aktiv.
4. Einen zweiten Passkey bzw. den bisherigen Passwort-Zugang als Rückfall behalten.
   Entfernen ist im Profil mit Passwortbestätigung möglich; bestehende Sitzungen
   werden separat unter **Sitzungen** verwaltet.

**In der App (#919)** gelten dieselben Passkeys. Die App fragt beim Öffnen von „Anmelden“ selbst
nach einem vorhandenen Passkey; gibt es keinen, bleibt das Formular still. Nach einer Anmeldung mit
Passwort lädt sie einmal ein, einen anzulegen – dafür bekommt sie mit der Anmeldung ein Ticket
(zehn Minuten, einmal, nur für dieses Konto) und fragt das Passwort nicht noch einmal. Anlegen und
Entfernen später unter **Profil → Einstellungen → Passkeys**, beides mit dem aktuellen Passwort.
Die App-Herkünfte (Signaturschlüssel der Server-APK und der Play-Fassung) sind eingebaut;
`PASSKEY_APK_KEY_HASHES` ersetzt sie, leer schaltet Passkeys nur in der App ab – dann bietet die App
keine an.

Wer bisher ausschließlich Google nutzt, richtet zunächst über den E-Mail-Passwortreset
ein Passwort ein. Anmeldung und Einrichtung funktionieren nur auf derselben festen
Domain. Ein Domainwechsel erfordert die erneute Einrichtung; RP-Daten deshalb nicht
zwischen Produktion und Staging austauschen. Private Schlüssel oder biometrische
Daten werden nicht auf dem Server gespeichert. Öffentliche Schlüssel und einmalige,
fünf Minuten gültige Challenges liegen in MongoDB; Kontolöschung entfernt sie mit.

Implementierung: [py_webauthn](https://duo-labs.github.io/py_webauthn/registration.html).

## 4. E-Mail

Unter `Einstellungen → E-Mail/SMTP` entweder SMTP oder Resend mit deinem eigenen Zugang
konfigurieren. Danach Diagnose und Testmail ausführen. Maskierte Werte sind bereits gespeichert;
leer absenden überschreibt sie nicht. Die Schaltfläche zum Löschen entfernt den gespeicherten
Schlüssel tatsächlich.

## 5. Discord, Twitch und Server

- Discord: eigenen Webhook anlegen, im Adminbereich speichern und Testnachricht senden.
- Twitch: eigene Client-ID und eigenes Client-Secret verwenden; anschließend Verbindung testen.
- Gameserver: Zugangskennwörter nur im geschützten Adminbereich pflegen.

Diese Geheimnisse liegen verschlüsselt in MongoDB. `SETTINGS_ENCRYPTION_KEY` muss deshalb stabil
bleiben und separat gesichert werden.

## 6. Rechtliches und Einwilligungsversionen

Unter `Einstellungen → Rechtliches` echte Vereinsdaten, Datenschutzkontakt und ergänzende
Nutzungsbedingungen pflegen. Danach `/imprint`, `/privacy` und `/terms` im ausgeloggten Browser
kontrollieren. Die vorformulierten Texte ersetzen keine juristische Prüfung.

Bei einer wesentlichen Änderung Versionen in `.env` erhöhen, zum Beispiel:

```env
PRIVACY_POLICY_VERSION=2026-09-15
TERMS_VERSION=2026-09-15
```

Anschließend `docker compose up -d --force-recreate backend`. Web und App verlangen dann bei der
nächsten Anmeldung erneut eine ausdrückliche Zustimmung und protokollieren sie im Consent-Ledger.

## 7. Rollen

- `moderator`: Meldungen und operative Moderation
- `tournament_admin`: Turnierbetrieb
- `club_admin`: Mitglieder, Rechtliches, Integrationen und Vereinskonfiguration
- `superadmin`: Rollen, Einladungen und Anmeldeanbieter

Adminrollen müssen MFA verwenden. Rollen nach dem Minimalprinzip vergeben und vierteljährlich
prüfen.
