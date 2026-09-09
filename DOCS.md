# Dokumentation

Einstieg: [README](README.md). Verbindliche Prioritäten und Abnahmen:
[RESTPLAN](RESTPLAN.md). Die folgenden Unterseiten haben jeweils einen eigenen Zweck.

## Installation und Betrieb

| Anleitung | Zweck |
| --- | --- |
| [INSTALL](INSTALL.md) | Erstinstallation und Bootstrap |
| [UPDATE](UPDATE.md) | Update, MongoDB-Abbruch, Login-Wiederherstellung und Cache |
| [CONFIGURATION](CONFIGURATION.md) | Eigene Anbieter, Mail, Google, Passkeys und Vereinsdaten |
| [ADMIN_GUIDE](ADMIN_GUIDE.md) | Redaktion und Adminfunktionen |
| [OPERATIONS](OPERATIONS.md) | Proxy, Uploads, Logs und laufender Betrieb |
| [RELEASE](RELEASE.md) | Staging, Freigabe, Deployment und Rollback |
| [BACKUP_RESTORE](BACKUP_RESTORE.md) | Sicherungen und Wiederherstellung |

## Qualität und Abnahme

| Nachweis | Zweck |
| --- | --- |
| [STAGING_ABNAHME](STAGING_ABNAHME.md) | Praxistest und Betreiberfreigabe |
| [LIVE_TESTS](LIVE_TESTS.md) | Tests auf einem ausgewählten Teststack |
| [SECURITY](SECURITY.md) | Sicherheitsmodell und Meldung von Schwachstellen |
| [DATA_PROTECTION](DATA_PROTECTION.md) | Daten, Löschung und Betreiberpflichten |
| [ROLE_AUDIT](ROLE_AUDIT.md) | Rollen und Berechtigungsprüfung |
| [PUBLIC_ROUTE_INVENTORY](PUBLIC_ROUTE_INVENTORY.md) | Öffentliche Seiten und Routen |
| [Frontend](frontend/README.md) | Lokale Entwicklung und Build |
| [PERFORMANCE_BUDGETS](frontend/PERFORMANCE_BUDGETS.md) | Frontend-Leistungsziele |

Prüfungen: [CI](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions/workflows/ci.yml),
[CodeQL](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions/workflows/codeql.yml),
[alle Workflows](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions).
Lokale Markdown-Linkziele werden mit `python scripts/check-doc-links.py` geprüft.
Das ersetzt keine manuelle Prüfung externer Links oder der fachlichen Abnahme.

## Turniere und Entwicklungshistorie

- [UMBAUPLAN](UMBAUPLAN.md): laufender Arbeitsstand des Turnier- und Übersichtlichkeitsumbaus — welcher Block steht, welcher offen ist.
- [COMPETITION_ENGINE](COMPETITION_ENGINE.md): eigenständiger künftiger Umbau mit Abnahmekriterien.
- [TOURNAMENT_CUSTOM_BRACKETS](TOURNAMENT_CUSTOM_BRACKETS.md): vorhandene Strukturen und Bedienung.
- [TOURNAMENT_MIGRATION_DRYRUN](TOURNAMENT_MIGRATION_DRYRUN.md): Bestandsaufnahme vor der Zusammenführung — liest nur, schreibt nichts.
- [IMPROVEMENT_REPORT](IMPROVEMENT_REPORT.md): Umsetzungshistorie der Plattformhärtung.
- [TOURNAMENT_ROADMAP](TOURNAMENT_ROADMAP.md) und [APP_BETA_PHASE_PLAN](APP_BETA_PHASE_PLAN.md):
  historische Planstände; neue Aufgaben entstehen ausschließlich im Restplan.
- [REPOSITORY_STRATEGY](REPOSITORY_STRATEGY.md): Hintergrund zur Trennung von Quellcode und App-Releases.

Diese Dokumente enthalten weiterhin technische Hintergründe und werden deshalb als
gekennzeichnete Historie erhalten. Das alte `auth_testing.md` mit überholten Demo-Zahlen
und unvollständigem MFA-Loginablauf wurde entfernt; aktuelle Tests stehen in
`backend/tests/`, `frontend/e2e/` und der Live-Test-Anleitung. Die alte, unbenutzte
Workbox-Service-Worker-Datei wurde ebenfalls entfernt. Die Git-Historie erhält beide.

## Native App – pausiert

[App-Anleitung](mobile/README.md) · [Roadmap](mobile/ROADMAP.md) ·
[Changelog](mobile/CHANGELOG.md) · [Releases](mobile/RELEASES.md) ·
[Geräteabnahme](mobile/RELEASE_SMOKE_TEST.md) ·
[Sicherheit und Verteilung](mobile/SECURITY_AND_DISTRIBUTION.md).

Diese Unterseiten sind kein Auftrag für einen neuen App-Release während der Website-Stabilisierung.
