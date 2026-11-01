# Moderation: was die Maschine tut, was der Mensch tut

Stand: 24.09.2026 (#415 Bildprüfung, #416 Verwarnungen mit Stufen, #417 Wortfilter).

## Bildprüfung (#415)

**Was geprüft wird.** Jedes Bild, das ein Nutzer hochlädt: Chat-Anhänge (Direkt-, Team-, Turnier-
und Match-Chat), Profilbilder und Banner, Teamlogos und alles andere, das über den Bild-Upload der
Website kommt. Videos werden nicht geprüft (nur ihr Standbild, wenn es als Bild hochgeladen wird).

**Wie.** Nach dem Upload entsteht ein Eintrag in `media_scans` mit Stand `pending`; die Prüfung läuft
im Hintergrund (sofort nach dem Upload und alle 20 Sekunden als Sammler). Der Anbieter ist ein
Schalter unter **Admin → Moderation → Bildprüfung**:

| Anbieter | Was passiert | Was nach draußen geht |
|---|---|---|
| **Selbst gehostet (NudeNet)** – Standard | ONNX-Modell im Backend erkennt sichtbare Nacktheit (Brust, Genitalien, Gesäß); Gewalt erkennt es nicht | nichts – kein Bild verlässt den Server |
| **Google Cloud Vision (SafeSearch)** | Google bewertet adult / racy / violence | das Bild geht an Google (Auftragsverarbeitung; steht dann in der Datenschutzerklärung) |
| **aus** | keine Prüfung | nichts |

**Drei Stufen, Schwellen einstellbar** (Standard: Prüfung nötig ab 0,6, Entfernen ab 0,85; es
zählt der höhere Wert aus Nacktheit und Gewalt):

- `safe` – nichts passiert.
- `review` – ein **Chat-Bild** bleibt für alle außer dem Absender und der Moderation verborgen
  („Bild wird geprüft“), bis ein Mensch entscheidet. Ein **öffentlicher Upload** (Avatar, Banner,
  Teamlogo) geht in die Quarantäne; seine Adresse liefert bis zur Entscheidung einen Platzhalter
  „Bild wird geprüft“ (für alle, auch für die Person selbst), die Verweise bleiben. Freigeben holt
  das Bild zurück, Entfernen leert die Verweise wie bei `blocked`. Der Platzhalter ist nicht
  cachebar (nginx `X-TLS-Placeholder`), ein freigegebenes Bild erscheint sofort wieder.
- `blocked` – das Bild geht sofort in die **Quarantäne** (`uploads/quarantine`, nur die Moderation
  sieht es), Verweise darauf werden geleert (Avatar, Banner, Teamlogo), im Chat steht „Bild entfernt
  – Moderation“, die Person bekommt eine Nachricht und – wenn eingeschaltet – einen **Treffer** für
  die Verwarnungsstufen (#416). Die Moderation bekommt eine Benachrichtigung.

**Der Mensch entscheidet.** Unter Bildprüfung sieht die Moderation jede Prüfung mit Vorschau,
Absender, Kontext und Werten und kann sie umdrehen: **Freigeben** holt ein entferntes Bild aus der
Quarantäne zurück und nimmt den Treffer zurück; **Entfernen** sperrt ein freigegebenes oder
unsicheres Bild. Alles steht im Audit-Log.

**Wenn der Anbieter ausfällt.** Nach drei Versuchen gilt das Bild als `failed` und bleibt sichtbar
(fail-open) – der Stand im Admin wird rot. So blockiert ein totes Modell keine Chats. Fehlt das
Paket `nudenet` im Backend, steht das ebenfalls im Stand.

**Aufbewahrung.** Entfernte Originale liegen 90 Tage (einstellbar) in der Quarantäne und werden
dann endgültig gelöscht; der Eintrag bleibt als Verlauf ohne Bild. Chat-Anhänge, die nie gesendet
wurden, räumt der bestehende Job weiter ab.

**Grenzen.** Badefotos, Cosplay, Spielszenen und Kunst sind Fehlerquellen – deshalb die Stufe
`review` und die Umkehr durch einen Menschen. Das lokale Modell erkennt keine Gewalt; wer Gewalt
prüfen will, schaltet auf Google Vision. Die Maschine sperrt nie eine Person – das bleibt beim
Menschen (#416, Stufe 3).

## Meldungen

Unter **Admin → System → Moderation → Meldungen** steht jede Meldung mit Kategorie, der gemeldeten Person, wer gemeldet hat,
und dem Text der gemeldeten Nachricht. Entschieden wird mit Knöpfen (#2122), jeder öffnet erst die Entscheidung mit den Folgen:

| Knopf | Was passiert | Grund |
|---|---|---|
| **In Prüfung nehmen** / **Wieder offen** / **Wieder prüfen** | Nur der Stand ändert sich | freiwillig |
| **Berechtigt** | Zählt als Treffer; je nach Stufe folgt eine Maßnahme mit Nachricht an die Person | Pflicht |
| **Erledigt** | Geschlossen ohne Treffer | freiwillig |
| **Verwerfen** | Geschlossen ohne Folgen | Pflicht |
| **Zurückstellen** (bei einer berechtigten Meldung) | Der Treffer aus dieser Meldung wird zurückgenommen | Pflicht |

- Eine schon laufende Maßnahme hebt Zurückstellen **nicht** auf – das bleibt eine eigene Entscheidung unter **Personen**. Die
  Meldung danach sagt, ob noch eine läuft.
- Der Grund bleibt stehen, wenn eine spätere Änderung keinen neuen mitbringt. Ein neuer ersetzt ihn.
- Gegen Konten mit Adminbereich entscheidet **Berechtigt** und **Zurückstellen** nur der Superadmin.
- Jede Änderung des Stands steht im Protokoll.

## Verwarnungen mit Stufen (#416)

Treffer aus Wortfilter, berechtigten Meldungen, Bildprüfung und von Hand zählen nach einstellbaren
Stufen (Standard: 1 Hinweis, 2 Verwarnung mit 24 h Chat-Sperre, 3 Sperre bis zur Entscheidung).
Die Person sieht ihren Stand unter „Meine Strafen“ und kann einmal Einspruch einlegen; Stufe 3 hebt
nur ein Mensch auf.

## Wortfilter (#417)

Wörter und Muster mit Aktion „zurückhalten“ (wartet auf Entscheidung) oder „nur markieren“.
Zurückgewiesene Funde zählen als Treffer.
