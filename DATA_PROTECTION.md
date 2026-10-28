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
- Freunde beim Event, Turnier und Fast Lap (#1188): Wo jemand angemeldet ist (Event, Turniere, Fast Laps mit gültiger
  Zeit), sehen nur bestätigte Freunde – nie Fremde oder Gäste, nicht bei Blockierung, nicht bei gesperrten oder gelöschten
  Konten. Bei Teams zählt nur die gespeicherte Aufstellung bzw. wer vor dem Turnier beigetreten ist. Die Person schaltet
  es unter Privatsphäre selbst ab („Freunde sehen, wo ich angemeldet bin“); mit Geburtsdatum unter 14 Jahren ist es von
  Anfang an aus. Nach der ersten Anmeldung kommt einmal ein Hinweis mit „Ausschalten“. Die Antworten tragen
  `Cache-Control: private, no-store`, die App speichert sie nicht zwischen (`backend/services/event_friends.py`).
- Vor-Ort-Zugang zu Turnieren (#1592): Der QR-Code auf TV und Aushang trägt einen Code hinter dem `#` – er erreicht
  keinen Server-Log, keinen Referrer und keine Statistik; die Seite entfernt ihn sofort aus der Adresse. Gespeichert wird
  nur ein Prüfwert in `tournament_onsite_access` (mit der Kennung der Leitung, die ihn zuletzt erneuert hat). Eingelöst
  setzt der Server ein technisch notwendiges, HttpOnly-Cookie `tls_onsite` nur unter `/api`: Turnier-Kennung, Ablauf und
  Signatur, ohne Angaben zur Person, höchstens 12 Stunden und nie über das Turnierende hinaus. Eine Anmeldung darüber
  trägt `registered_via: "onsite"`.
- Partner-Plattform einer Turnierserie (#1964): Der Vorstand holt öffentliche Turniertage von der Plattform eines
  Partners (feste Adressliste, mit dem Partner abgesprochen, nur lesend). Übernommen werden nur Name wie beim
  Veranstalter (Riot-ID `Name#TAG`, Gäste ohne Tag), Platz, Punkte je Runde, Lobby, Partner im Double Up und
  „Ausgestiegen“ – als Entwurf, nie direkt veröffentlicht. Riot-Kennungen (PUUID), Avatare, Rang und Liga-Punkte und
  die Rohantwort werden nicht gespeichert; der Zwischenspeicher hält nur das eingedampfte Ergebnis zehn Minuten im
  Speicher des Servers. Neue Namen werden wie beim Eintragen offene Teilnehmer der Saison (`reference_participants`,
  Dialog „Unbekannte Namen“); Fremde bleiben extern. Protokoll: `reference_series.partner_source`,
  `reference_partner.import`, je Blatt `reference_result.save` bzw. `.pending_draft` mit `source: "partner"`.

## Konto löschen: was mit welchen Daten passiert

Ein Mitglied löscht sein Konto selbst (Website: Datenschutz → Meine Daten, App: Profil → Einstellungen); ein Superadmin
kann es für jemanden tun. Die vollständige Liste je Sammlung führt `backend/services/personal_data.py`: was beim Löschen
passiert, wo die Sammlung in der Auskunft steht und warum etwas bleibt. Der Wächter `test_personal_data_map_unit.py` sucht
alle Sammlungen im Code und verlangt jede dort – eine neue Sammlung ohne Entscheidung lässt die CI scheitern (#1029,
#1030). Umgesetzt in `backend/routes/dsgvo_routes.py` und `backend/services/account_erasure.py`, geprüft in
`test_account_erasure_flow.py`. Im Überblick:

| Was | Entscheidung |
| --- | --- |
| Name, E-Mail, Profilangaben, verknüpfte Konten, Sitzungen, Passkeys, Push-Geräte, Freundschaften, Blockierungen | gelöscht oder überschrieben. Am Konto selbst geht jedes Feld des Profilformulars (Handles, Spiele, Plattformen, Eingabegeräte, Webseite, Sichtbarkeits- und Nachrichten-Stufen …); nur Anzeigename („Gelöschter User“) und abgeschaltete Einwilligungen und Schalter bleiben. Die Liste wird aus dem Profilformular abgeleitet, `test_anonymize_profile_fields_flow.py` prüft jedes Feld; früher gelöschte Konten räumt die Migration 15 nach (#2118) |
| Avatar, Banner und alles, was das Konto für sein Profil hochgeladen hat (samt kleinerer Fassungen und einer Kopie in der Quarantäne der Bildprüfung) | gelöscht – außer ein Bild wird vom Team oder Verein verwendet, etwa als Teamlogo. Ein Profil einer anderen Person hält es nicht fest, es verliert nur den Eintrag. Dateien eines anderen Kontos oder des Vereins bleiben, auch wenn sie im gelöschten Profil eingetragen waren (#1039). Lässt sich eine Datei nicht löschen (etwa gesperrt), steht sie als Eintrag mit Status in `pending_file_cleanups` (Datei, Kennung des gelöschten Kontos, Fehlerart ohne Pfad); der stündliche Job `erasure_file_cleanup` holt das mit wachsendem Abstand nach, nach acht Versuchen steht der Eintrag als aufgegeben unter Betrieb → Checks, bis ein Admin ihn erneut versucht. Der Eintrag geht, sobald die Datei weg ist (#1046) |
| XP und Level, Erfolge, Zählerstände und Signale der Erfolge, Sticker, Adventkalender, Ostereier, Verlosungen, Discord-Aktivität, Verlauf der Saisonränge | gelöscht |
| Lesestände (Chats, Dokumente), Merker zu Jahresrückblick, Feedback und Stream-Ankündigungen | gelöscht |
| Selbst angelegter Eintrag im Mitgliederverzeichnis | gelöscht |
| Eintrag im Mitgliederverzeichnis aus der Mitgliederverwaltung oder von der Redaktion, Vorstandsposten | bleibt beim Verein, verliert nur die Verknüpfung zum Konto |
| Einlass bei der Generalversammlung (Anwesenheit am Eingang) | bleibt beim Verein, verliert nur die Verknüpfung zum Konto; wer als Vorstand selbst eingelassen hat, steht dort danach ohne Namen |
| Mitgliedsanträge | Motivation und Angaben zur Person gelöscht, ein laufender Antrag gilt als zurückgezogen; der Datensatz in der Mitgliederverwaltung bleibt Sache des Vereins |
| Wunschnummer (#2034) samt Verlauf und Anträgen | gelöscht, die Nummer ist sofort wieder frei. In der Mitgliederverwaltung wird sie gleich mit gelöscht; ist die gerade nicht erreichbar, bleibt bis dahin nur die Mitglieds-ID ohne Konto, ohne Nummer und ohne Verlauf stehen |
| Einladungen zur Mitgliedschaft und in Teams, Tokens der Mitgliedskarte, persönlicher Kalender-Link, Zugangslinks, Aufgaben im Turnier- und F1-Team, Captain einer externen Serie, Platz in der Liste „Am Start / Als Nächstes“ einer Fast Lap, Verbindung zur Mitgliederakte samt zwischengespeicherter Ehrungen | gelöscht bzw. abgeschaltet |
| Teilnahme an externen Serien (Turnierserie, Rennliga, Team-Liga), verknüpft mit dem selbst angelegten Eintrag im Mitgliederverzeichnis (#1741) | Ergebnis und Tabelle bleiben; der Teilnehmer gilt danach als extern, sein Name aus der Ergebnisliste des Veranstalters ist ausgeblendet, Aliase auf den Eintrag sind gelöscht. Zeigt die Teilnahme auf einen Eintrag aus der Mitgliederverwaltung oder der Redaktion, bleibt sie damit verknüpft – der Eintrag gehört dem Verein. In der Auskunft stehen Teilnahmen und Aliase an allen eigenen Profilen (`reference_participations`, `reference_aliases`) |
| Teamzugehörigkeit | bleibt für Teamhistorie und Aufstellungen; das Konto heißt dort „Gelöschter User“ |
| Anmeldungen zu Events und Turnieren | bleiben als Zählung und für den Turnierbaum – ohne Name, E-Mail, Notiz, Discord- und Plattform-Kennung |
| Turnier-Ergebnisse, Ergebnismeldungen, Terminvorschläge, Rundenzeiten, Saisonpunkte und -tabellen | bleiben ohne Namen (sportliche Integrität); Nachweis-Link und Notiz einer Rundenzeit gelöscht |
| Gewinne | der Nachweis der Übergabe bleibt, die Notiz ist gelöscht |
| Eigene Chatnachrichten, gehaltene Texte der Moderation | als „gelöscht“ markiert; die Entscheidung der Moderation bleibt |
| Meldungen, Verwarnungen und Sperren | bleiben als Nachweis der Moderation; die Kennung zeigt auf „Gelöschter User“. Meldungen von und über die Person, Verwarnungen und Sperren werden drei Jahre nach der Löschung endgültig gelöscht |
| Kontaktanfragen, die angemeldet geschrieben wurden | bleiben als Vorgang – Name, E-Mail-Adresse, Betreff und Text überschrieben; nach drei Jahren gelöscht |
| Kontaktanfragen ohne Anmeldung mit derselben E-Mail-Adresse | bleiben unberührt: ob die Adresse damals zu diesem Konto gehörte, hält niemand fest. Ihre Zahl steht im Protokoll der Löschung (`unlinked_contact_messages`); der Vorstand prüft sie bei einem Löschwunsch per Hand |
| Mails, die noch in der Warteschlange stehen | gelöscht; im Versandprotokoll ist der Empfänger überschrieben |
| Gespeicherte Namen: Autorin oder Autor eines News-Beitrags, Protokoll der Erfolge, Angaben zur Person in den Daten des Adminprotokolls | überschrieben bzw. entfernt; Beitrag und Vorgang bleiben |
| Absender einer „Nachricht an alle Angemeldeten“ eines Events (`event_messages`) | Name überschrieben; die Nachricht bleibt bis zur Frist des Adminprotokolls |
| Einwilligungen (Website und Mitgliederverwaltung) | bleiben als Nachweis, drei Jahre nach der Löschung endgültig gelöscht |
| Rechnungen | Belege bleiben sieben Jahre in der Buchhaltung; der Auftrag auf der Website behält Betrag und Belegnummer |

Konten, die vor einer Erweiterung gelöscht wurden, zieht eine Migration auf demselben Weg nach (Migration 4 für #928,
Migration 5 für #1029). Sie nimmt nur Konten im vollständigen Löschzustand: Zeitpunkt der Löschung, abgeschaltet,
„Gelöschter User“ und Ersatzadresse `deleted_…@deleted.invalid`.

### Was bleibt und wie lange

| Daten | Frist | Grund |
| --- | --- | --- |
| Belege in der Buchhaltung (Dolibarr) | sieben Jahre | Steuerrecht |
| Adminprotokoll (`audit_logs`) | 730 Tage, einstellbar unter Betrieb → Alarme (Job `ops_retention`) | Nachvollziehbarkeit; enthält Kennungen, Namen werden erst beim Lesen aufgelöst; Angaben zur Person in den Daten entfernt die Kontolöschung |
| Nachrichten an alle Angemeldeten eines Events (`event_messages`: Absender, Text, Zahl der Empfänger) | wie das Adminprotokoll (Job `ops_retention`); in der Auskunft des Absenders unter `event_messages_sent` | Nachweis, was die Turnierleitung wann an wie viele geschickt hat |
| Versandprotokoll (`email_logs`) | 90 Tage, einstellbar wie oben | Zustellnachweis; Empfänger bei der Kontolöschung überschrieben |
| Versandte Mails der Warteschlange (`mail_jobs`) | 30 Tage | Doppelversand verhindern |
| Upload-Protokoll mit IP-Adresse (`upload_events`) | 60 Tage (`UPLOAD_EVENT_RETENTION_DAYS`), läuft auch nach einer Kontolöschung ab | Missbrauch und Fehler bei Uploads nachvollziehen |
| Fehlerprotokoll der App (`mobile_client_logs`) | 90 Tage, bei der Kontolöschung sofort | Fehlersuche |
| Anmeldeversuche, Zähler gegen zu viele Anfragen | eine Stunde bzw. höchstens ein Tag | Schutz vor Durchprobieren |
| Spamschutz öffentlicher Formulare (#2067): Zähler je IP und E-Mail nur als Schlüssel-Hash (`rate_limits`), benutzte Formular-Token als Hash (`spam_guard_tokens`), Zähler je Stunde, Formular, Ergebnis und Grund ohne Inhalt, Adresse oder IP (`spam_guard_stats`) | höchstens ein Tag; Token bis eine Stunde nach Ablauf; Zähler 90 Tage | Schutz vor Spam; sicher erkannter Spam wird ohne Inhalt verworfen, verdächtige Kontaktanfragen bleiben als „Spam“ in der Inbox |
| Entfernte Bilder in der Quarantäne der Bildprüfung | 90 Tage, einstellbar | Nachprüfung einer Entscheidung |
| Fotos zu Ergebnismeldungen | 30 Tage nach dem Anhängen | Nachweis bei Einsprüchen |
| Nach einer Kontolöschung: Einwilligungsnachweise (Website und Mitgliederverwaltung), Moderationsfälle (Meldungen von und über die Person, Verwarnungen, Sperren), Ergebnismeldungen, angemeldet geschriebene Kontaktanfragen als Vorgang | drei Jahre ab der Löschung (Entscheidung des Vereins zu #1029). Die Löschung setzt `erase_after`, der tägliche Job `ops_retention` löscht Abgelaufenes (`purge_expired_records`). Für früher gelöschte Konten setzt Migration 5 die Frist ab dem damaligen `anonymized_at`. Einträge aktiver Konten laufen nicht ab | Nachweis |
| Ergebnisse und Tabellen | ohne Frist | sportliche Integrität, Teil des Turnierverlaufs |
| Anzeigenamen von Fast-Lap-Gästen ohne Konto (`f1_guests`, #1585) | 90 Tage nach dem Anlegen (Entscheidung des Vereins, 14.10.2026), dann „Gast <Nummer>“; ein mit einem Konto verknüpfter Gast bleibt als Nachweis mit der Kennung des Kontos stehen (Job `ops_retention`, `services/fastlap_guests.py`); die Zeiten bleiben ohne Namen | Gäste haben kein Konto, also weder Auskunft noch Löschung darüber – die Frist ersetzt sie. Vorher löscht die Leitung einen Namen auf Wunsch durch Umbenennen. Der Name geht nicht an Discord |

**Restlücke Spamschutz: Registrierung aus der App (#2067).** Die LionsAPP schickt kein Formular-Token, und eine echte
Bescheinigung, dass eine Anfrage aus der App kommt, gibt es nicht. `POST /api/auth/mobile/register` ist darum nur
begrenzt, nicht verschlossen: höchstens 3 Registrierungen je IP und Stunde, höchstens 30 je Stunde für alle zusammen
(beides unter Einstellungen → Spamschutz einstellbar), dazu die „Grenze je Netz“ aus „Zugang“; der Benutzername wird
wie auf der Website bewertet, der Betriebs-Check „Spamschutz“ meldet Spitzen bei App-Registrierungen. Was ein Bot dort
erreicht: ein Konto mit **unbestätigter** E-Mail-Adresse. Mit Passwort kann sich damit niemand anmelden – Website und
App lehnen das Login ohne bestätigte Adresse ab –, ohne Anmeldung gibt es weder Chat noch Profil noch Turnier-Anmeldung.
Es bleiben zwei Folgen: Benutzername und Adresse sind belegt, und an die angegebene Adresse geht eine Bestätigungsmail
(darum die Limits). Unbestätigte Konten werden derzeit nicht automatisch gelöscht.

Betriebsdaten ohne Personenbezug (`ops_errors`, `ops_slow_requests`, `ops_vitals`: nur „angemeldet“ oder „anonym“)
laufen nach 30 Tagen ab. Die Ereignis-Kennungen signierter Webhooks der Mitgliederverwaltung (`dolibarr_webhook_events`:
Kennung, Objektart, Zeitpunkt – ohne Mitgliedsnummer) laufen nach sieben Tagen ab.

## Auskunft: was die Datei enthält

`GET /api/dsgvo/export-my-data` (Website: Datenschutz → Meine Daten → Export) liefert eine JSON-Datei, Fassung 5. Je
Sammlung aus `personal_data.py` steht ein Schlüssel drin; der Test vergleicht beide Listen. Jede Liste ist vollständig:
Der Server liest seitenweise in der Reihenfolge des Anlegens und schreibt die Datei fortlaufend, ohne Obergrenze und
ohne alles auf einmal im Speicher. Bewusst nicht enthalten:

- Prüfwerte und Schlüssel: Passwort- und Token-Hashes, MFA-Geheimnisse, Push-Token, Schlüssel der Passkeys,
  Dateinamen, Adressen und Ablageorte hochgeladener Dateien (Uploads, Anhänge, Ergebnisfotos, Upload-Protokoll: nur
  Art, Größe, Datum und Prüfstand), Beitrittscodes von Teams, der Schlüssel der Mitgliederakte.
- Daten Dritter: wer die Person blockiert oder gemeldet hat und was dabei geschrieben wurde (Meldungen über die Person
  nur mit Art und Stand), Namen von Moderatorinnen, Vorstand und Verwaltung, und bei Einträgen im Adminprotokoll, in
  denen die Person selbst gehandelt hat, nur der Vorgang ohne Inhalt. Nachrichten: eigene mit Inhalt; empfangene
  Direktnachrichten nur als Vorgang (wann, in welchem Gespräch, gelesen), ohne den Text der anderen Person; Chats in
  Team, Match und Turnier nur die eigenen Nachrichten. Terminvorschläge ohne Antwort und Kennung der anderen Seite.
  Kontaktanfragen nur, wenn sie angemeldet geschrieben wurden.
- Reine Technik: Anmelde-Zwischenschritte und interne Warteschlangen.

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
