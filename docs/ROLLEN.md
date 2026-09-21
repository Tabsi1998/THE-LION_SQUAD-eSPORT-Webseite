# Rollen und Rechte

Stand: Meilenstein „Web: Rollen und Rechte“ (#287–#292). Quelle der Wahrheit für
das, was eine Person im Adminbereich darf. Der Code dazu: `backend/services/permissions.py`
(Bereiche, Rollen, Vorstand), `backend/auth.py` (`require_area`), Web `frontend/src/lib/permissions.js`.

## Bereiche

Rechte hängen an Bereichen, nicht an einer Rangfolge. Eine Person kann mehrere haben.

| Bereich | Schlüssel | Was dazugehört |
| --- | --- | --- |
| Turnierleitung | `tournaments` | Turniere, Events, Stationen, Fast Lap, Saisons, Spiele, Gewinne, Strafen, Zugangslinks, PDF-Exporte |
| Redaktion | `content` | News, Galerie, Medien, Sponsoren, Partner, Referenzen, CMS-Seiten, Navigation, Sticker, Achievements, Seiten-Banner, Newsletter, Twitch-Streams |
| Vereinsverwaltung | `club` | Mitglieder und Mitgliederprofile, Anträge, Dokumente, Vorteile, Vorstand, Kontakt-Inbox, Benutzerliste (sperren, bearbeiten), Discord-Zähler |
| System | `system` | Einstellungen (Mail, Branding, Discord, Auth), Game-Server, Betrieb, Logs, Audit, App-Logs, Push-Tests, App-Versionen, E-Mail-Vorlagen, Wartungsläufe für Uploads |
| Moderation | `moderation` | Meldungen aus Chats, Moderationsseite; dazu die Lese-Seiten der Turnierleitung (Turniere, Fast Lap, Stationen) für zugewiesene Helfer |

## Wer hat welchen Bereich

| Rolle | Bereiche | Zwei-Faktor |
| --- | --- | --- |
| Superadmin | alle; vergibt Rollen und Freigaben | Pflicht |
| Club-Admin | alle | Pflicht (seit #291 auch für Mitgliederdaten und Einstellungen) |
| Turnierleitung (`tournament_admin`) | Turnierleitung, Moderation | Pflicht |
| Moderator | Moderation | nur für Exporte |
| Spieler | keiner – außer Freigaben oder Vorstandsposten | – |

**Freigaben:** Der Superadmin kann einer Person einzelne Bereiche geben (Admin → Alle Benutzer):
Turnierleitung, Redaktion, Vereinsverwaltung. System bleibt an Club-Admin und Superadmin gebunden.
Jede Freigabe steht im Audit-Log.

**Vorstand:** Wer einen aktiven Vorstandsposten hält oder vertritt (Admin → Vorstand), hat die
Vereinsverwaltung von selbst. Die Besetzung der Posten ist damit eine Rechtevergabe.

**Pro Turnier:** Unabhängig von der Rolle kann eine Person je Turnier zugewiesen werden
(Turnierseite → Staff: organizer, referee, scorekeeper, station_manager, stream_operator).
Ein `organizer` darf in seinem Turnier alles – Struktur, Ergebnisse, Check-in, Stationen und die
Gewinne dieses Turniers (#288). Das braucht keinen Bereich und keine Zwei-Faktor-Anmeldung.

## Was nicht mehr gilt

- Eine Turnierleitung darf keine News, Galerie, Sponsoren oder Partner mehr bearbeiten.
- Die Rolle `team_leader` gibt es nicht mehr; Teamleitung läuft pro Team (Teamseite). Bestehende
  Konten wurden beim Start auf `player` gesetzt, mit Audit-Eintrag.
- Mitgliederdaten, Dokumente und Einstellungen sind ohne bestätigte Zwei-Faktor-Anmeldung nicht
  erreichbar – auch nicht für Club-Admins.

## Wer sieht was im Adminbereich

Das Menü zeigt nur Gruppen und Einträge, für die ein Bereich vorhanden ist. Eine Seite ohne
Bereich führt auf `/403` mit dem fehlenden Bereich und dem Hinweis, wer ihn vergibt. Die Antwort
des Servers sagt dasselbe („Dafür fehlt der Bereich „Redaktion“ …“).
