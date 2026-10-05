# Datenschutz und Datenlebenszyklus

## Technische Umsetzung

- Neue Profile sind standardmäßig privat.
- Registrierungen benötigen Datenschutz- und Nutzungszustimmung sowie E-Mail-Verifikation.
- Jede Zustimmung wird mit Benutzer, Version, Zeitpunkt, Clienttyp und technischen Auditdaten
  nachvollziehbar protokolliert.
- Nutzer können ihren erweiterten Datenexport anfordern, Sessions verwalten, Newsletter widerrufen,
  andere Nutzer blockieren und Inhalte melden.
- „Löschen“ anonymisiert personenbezogene Daten; historische Turnierergebnisse bleiben ohne
  identifizierende Profildaten erhalten.
- Integrationsgeheimnisse werden mit `SETTINGS_ENCRYPTION_KEY` verschlüsselt; Passwörter werden
  ausschließlich gehasht gespeichert.
- Öffentliche Benutzerobjekte enthalten weder Passwort-/MFA-Daten noch stabile Google-Konto-IDs.

## Konto löschen: was mit welchen Daten passiert

Ein Mitglied löscht sein Konto selbst (Website: Datenschutz → Meine Daten, App: Profil → Einstellungen); ein Superadmin
kann es für jemanden tun. Die Entscheidung je Art von Daten (`backend/routes/dsgvo_routes.py`,
`backend/services/account_erasure.py`, Test `test_account_erasure_flow.py`):

| Was | Entscheidung |
| --- | --- |
| Name, E-Mail, Profilangaben, verknüpfte Konten, Sitzungen, Passkeys, Push-Geräte, Freundschaften, Blockierungen | gelöscht oder überschrieben |
| Avatar, Banner und alles, was das Konto für sein Profil hochgeladen hat (samt kleinerer Fassungen und einer Kopie in der Quarantäne der Bildprüfung) | gelöscht – außer ein Bild wird noch verwendet, etwa als Teamlogo |
| XP und Level, Zählerstände und Signale der Erfolge, Adventkalender, Ostereier, Verlosungen, Discord-Aktivität | gelöscht |
| Selbst angelegter Eintrag im Mitgliederverzeichnis | gelöscht |
| Eintrag im Mitgliederverzeichnis aus der Mitgliederverwaltung oder von der Redaktion, Vorstandsposten | bleibt beim Verein, verliert nur die Verknüpfung zum Konto |
| Einlass bei der Generalversammlung (Anwesenheit am Eingang) | bleibt beim Verein, verliert nur die Verknüpfung zum Konto; wer als Vorstand selbst eingelassen hat, steht dort danach ohne Namen |
| Mitgliedsanträge | Motivation und Angaben zur Person gelöscht, ein laufender Antrag gilt als zurückgezogen; der Datensatz in der Mitgliederverwaltung bleibt Sache des Vereins |
| Einladungen zur Mitgliedschaft, Tokens der Mitgliedskarte, Zugangslinks, Aufgaben im Turnier-Team | gelöscht bzw. abgeschaltet |
| Anmeldungen zu Events und Turnieren | bleiben als Zählung und für den Turnierbaum – ohne Name, E-Mail, Notiz, Discord- und Plattform-Kennung |
| Turnier-Ergebnisse, Rundenzeiten, Saisonpunkte | bleiben ohne Namen (sportliche Integrität); Nachweis-Link und Notiz einer Rundenzeit gelöscht |
| Gewinne | der Nachweis der Übergabe bleibt, die Notiz ist gelöscht |
| Eigene Chatnachrichten, gehaltene Texte der Moderation | als „gelöscht“ markiert; die Entscheidung der Moderation bleibt |
| Rechnungen | Belege bleiben sieben Jahre in der Buchhaltung; der Auftrag auf der Website behält Betrag und Belegnummer |

Die Auskunft (`GET /api/dsgvo/export-my-data`, Fassung 3) enthält dieselben Bereiche.

## Betreiberpflichten

Der Verein muss reale Zwecke, Rechtsgrundlagen, Auftragsverarbeiter, Löschfristen und Kontakte
festlegen. Vor Livebetrieb sind `/privacy`, `/terms` und `/imprint` fachlich beziehungsweise
juristisch zu prüfen. Besonders zu dokumentieren sind Hosting, Mailanbieter, Google-Anmeldung,
Analytics, Discord/Twitch-Einbindungen, Backups und mögliche Drittlandübermittlungen.

## Empfohlene Fristen

Diese Werte sind eine technische Ausgangsbasis und müssen rechtlich bestätigt werden:

- Sicherheits-/Auditlogs: 90 bis 180 Tage
- Clientfehlerlogs: höchstens 30 Tage
- Zustell-/Mailqueue-Fehler: 90 Tage
- abgelehnte Kontakt- und Mitgliedsanträge: 6 bis 12 Monate
- Backups: 14 bis 30 Tage, danach automatisiert löschen
- Consent- und notwendige Vereinsnachweise: entsprechend Nachweis-/Aufbewahrungspflicht

## Regelmäßige Kontrolle

Monatlich fehlgeschlagene Mail-, Backup- und Moderationsvorgänge prüfen. Vierteljährlich Rollen,
Admin-MFA, aktive Sessions, Dienstleister, öffentliche Profile und Löschfristen auditieren. Bei
einem Vorfall Zugangsdaten rotieren, Beweise geschützt sichern, Umfang bewerten und die
gesetzlichen Melde- und Informationsfristen mit dem Datenschutzverantwortlichen prüfen.
