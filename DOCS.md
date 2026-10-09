# Dokumentation

Einstieg: [README](README.md). Offene Arbeit steht in den GitHub-Meilensteinen und -Issues.
Die folgenden Unterseiten haben jeweils einen eigenen Zweck.

## Handbuch für Betreiber

Was die Funktionen können und was ihr dafür einrichtet – zum Durchlesen, ohne Programmierkenntnisse:
[Handbuch](docs/handbuch/README.md), zuerst das Kapitel [Discord](docs/handbuch/discord.md).

## Installation und Betrieb

| Anleitung | Zweck |
| --- | --- |
| [INSTALL](INSTALL.md) | Erstinstallation und Bootstrap |
| [UPDATE](UPDATE.md) | Update, MongoDB-Abbruch, Login-Wiederherstellung und Cache |
| [CONFIGURATION](CONFIGURATION.md) | Eigene Anbieter, Mail, Google, Passkeys und Vereinsdaten |
| [BETRIEB](docs/BETRIEB.md) | Logs, Alarme, Live-Updates, Uploads, Suchmaschinen, Überwachung, Störfälle |
| [BACKUP_RESTORE](BACKUP_RESTORE.md) | Sicherungen und Wiederherstellung |

## Themen

| Thema | Zweck |
| --- | --- |
| [Discord](docs/DISCORD.md) | Bot, Befehle, Kanäle, Rollen, Anmeldung im Discord |
| [Dolibarr](docs/DOLIBARR.md) | Anbindung der Vereinsverwaltung: Mitglieder, Beiträge, Vorstand, Versammlungen |
| [Abrechnung](docs/ABRECHNUNG.md) | Kosten, Startgelder, Rechnungen, Freigaben |
| [Rollen](docs/ROLLEN.md) | Rollen, Bereiche und wer was darf |
| [Moderation](docs/MODERATION.md) | Meldungen, Wortfilter, Bildprüfung, Sperren |
| [Jahreszeiten](docs/SEASONS.md) | Saison-Deko und Aktionen in Web und App |
| [Google Play](docs/PLAY_STORE.md) | App-Eintrag, Tests, Veröffentlichung |

## Qualität und Abnahme

| Nachweis | Zweck |
| --- | --- |
| [SECURITY](SECURITY.md) | Sicherheitsmodell und Meldung von Schwachstellen |
| [DATA_PROTECTION](DATA_PROTECTION.md) | Daten, Löschung und Betreiberpflichten |
| [PUBLIC_ROUTE_INVENTORY](PUBLIC_ROUTE_INVENTORY.md) | Öffentliche Seiten und Routen |
| [Frontend](frontend/README.md) | Lokale Entwicklung und Build |
| [PERFORMANCE_BUDGETS](frontend/PERFORMANCE_BUDGETS.md) | Frontend-Leistungsziele |

Prüfungen: [CI](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions/workflows/ci.yml),
[CodeQL](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions/workflows/codeql.yml),
[alle Workflows](https://github.com/Tabsi1998/THE-LION_SQUAD-eSPORT-Webseite/actions).
Lokale Markdown-Linkziele werden mit `python scripts/check-doc-links.py` geprüft; dasselbe Skript hält
die Obergrenze von `CLAUDE.md` (60 KB).
Das ersetzt keine manuelle Prüfung externer Links oder der fachlichen Abnahme.

## Arbeit mit Claude Code

| Datei | Zweck |
| --- | --- |
| [CLAUDE](CLAUDE.md) | Arbeitsregeln, Kurzkarte, Prüfen, Release, Deployment – wird bei jedem Sitzungsstart geladen und bleibt deshalb kurz |

Stand, Verlauf, Stolpersteine und Pläne stehen seit 9.10.2026 nicht mehr im Repository, sondern in den
privaten Projektnotizen des Betreibers; frühere Fassungen bleiben im Git-Verlauf.

## App (LionsAPP)

[App-Anleitung](mobile/README.md) ·
[Changelog](mobile/CHANGELOG.md) · [Releases](mobile/RELEASES.md) ·
[Geräteabnahme](mobile/RELEASE_SMOKE_TEST.md) · [Google Play](docs/PLAY_STORE.md).

