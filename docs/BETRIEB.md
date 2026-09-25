# Betrieb, Logs und Alarme

Was die Website über sich selbst festhält, wo es steht und wann sie sich meldet.

## Wo was steht

| Seite | Was | Woher |
|---|---|---|
| System → Betrieb & Logs → **Fehler** | Gruppen unbehandelter Serverfehler und Antworten mit Status 5xx (ohne Namen, Adressen, Tokens) | `ops_errors`, 30 Tage |
| System → Betrieb & Logs → **Tempo** | Anfragen über der Schwelle (Route, Dauer) | `ops_slow_requests` |
| System → Betrieb & Logs → **Vitals** | Ladezeiten aus dem Browser je Route (LCP, INP, CLS, TTFB), anonym | `ops_vitals` |
| System → Betrieb & Logs → **Checks** | Auto-Checks alle fünf Minuten: Datenbank, Speicher, Mail-Queue, Twitch, Dolibarr, Fehlergruppen | `ops_check_runs` |
| System → Betrieb & Logs → **Alarme** | Wer bei welchem Ereignis eine Meldung bekommt, Sperrfrist, Testalarm, Aufbewahrung, letzte Alarme | `settings/ops_alerts`, `ops_alert_log` |
| System → Betrieb & Logs → **Überblick** | Je Quelle Zähler und Auffälligkeiten, die neuesten Probleme der letzten sieben Tage | Sammelsicht |
| System → Betrieb & Logs → **Ereignisse** | Alle Quellen in einer Liste: Serverfehler, Auto-Checks, Alarme, App-Logs, E-Mail-Versand, Mail-Queue, Adminaktionen, Uploads, Dolibarr-Abgleich, Discord-Bot – Filter nach Quelle, Schwere, Zeitraum, Text; „Als CSV“ | `GET /api/admin/ops/events` |
| System → Betrieb & Logs → **App-Logs** | Fehler und Meldungen der LionsAPP (Gerät, Version, Stufe) mit Status und Notiz | `mobile_client_logs`, 90 Tage |
| E-Mail → Mail-Queue | Wartende und fehlgeschlagene Sendungen, neu einreihen | `mail_jobs` |

Die früheren Seiten Logs, Audit Logs, App-Logs und Versandlogs leiten auf die passenden Reiter um
(`/admin/logs` → Ereignisse, `/admin/audit` → Ereignisse mit Quelle Adminaktionen, `/admin/mobile-logs`
→ App-Logs, `/admin/settings/mail-logs` → Ereignisse mit Quelle E-Mail).

## Alarme (#517)

Unter **System → Betrieb & Logs → Alarme** legt der Admin je Ereignisart fest, ob eine Meldung per **Discord**
(der Bot schickt in den Betriebskanal – ein privater Kanal nur für den Vorstand, gewählt unter Verbindungen → Discord; Bot aus = kein Alarm)
und/oder per **E-Mail** an die eingetragenen Empfänger geht.

| Ereignis | Wann |
|---|---|
| Auto-Check rot | eine der Prüfungen steht auf rot |
| Serverfehler (5xx) | eine neue Fehlergruppe |
| Mail nicht zustellbar | eine Mail ist nach allen Versuchen endgültig fehlgeschlagen – nur per Discord, eine Mail darüber käme ja nicht an |
| Hintergrundjob abgebrochen | ein Job des Schedulers (Abgleich, Erinnerungen, Versand …) bricht mit einem Fehler ab |
| Dolibarr-Abgleich rot | der Abgleich mit der Mitgliederverwaltung schlägt fehl (nicht erreichbar, Schlüssel, Antwort) |
| Discord-Bot offline | der Bot ist eingeschaltet, kommt aber nicht mehr auf den Server |
| App: kritischer Fehler | die LionsAPP meldet einen kritischen Fehler (Absturz, Login, Push) |

Vorgabe: Discord an, E-Mail aus. **Sperrfrist:** je Schlüssel (eine Prüfung, eine Fehlergruppe, ein Job,
ein App-Fingerabdruck) meldet die Website höchstens einmal je Frist (Vorgabe 60 Minuten) – ein
Dauerfehler flutet keinen Kanal. Der **Testalarm** geht alle Wege, die irgendeine Regel nutzt, ohne
Sperrfrist. Jede Meldung steht unter „Letzte Alarme“, auch wenn kein Weg eingerichtet war.

Alarme tragen nie Nutzdaten: keine Namen, keine vollständigen E-Mail-Adressen, keine Tokens – nur
Ereignis, Route, Fehlerart und Zähler.

## Aufbewahrung

- Versandlogs: 90 Tage (einstellbar unter Alarme, 7 Tage bis 10 Jahre)
- Adminaktionen: 2 Jahre (einstellbar)
- App-Logs 90 Tage, Fehlergruppen 30 Tage, Tempo-Messungen und Upload-Ereignisse: feste Frist, räumt die Datenbank selbst
- Alarm-Verlauf: 1 Jahr

Der Job `ops_retention` läuft einmal am Tag.
