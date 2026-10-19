# Versionshinweise für Google Play

Der Text, der beim Hochladen des App-Bundles in den offenen Test der Play Console unter „Versionshinweise“
steht. Das Release-Skript übernimmt den Abschnitt der aktuellen Version in den GitHub-Release-Text, legt ihn
als `builds/play-notes-<Version>-build<N>.txt` zum Kopieren ab und gibt ihn mit `--play` an Google weiter.
Preflight und `npm run release:local -- --check` brechen ab, wenn er fehlt oder nicht passt.

Regeln:

- Je Version ein Abschnitt `## 1.2.3`, neueste oben. Darunter genau der Text für Google Play, ohne Markdown.
- Erste Zeile `Neu in 1.2.3:`, danach jeder Punkt in einer eigenen Zeile mit `• `.
- Höchstens 500 Zeichen inklusive Zeilenumbrüchen (Grenze von Google Play).
- Kurz und für Mitglieder verständlich: was sie in der App merken, keine Issue-Nummern, keine Technik.

## 1.7.2

Neu in 1.7.2:
• Mein Kalender: alle deine Termine mit deinem Stand an einem Ort
• Kalender-Abo: Termine automatisch im Handy- oder Google-Kalender
• Fester Eintrag „Mein Kalender-Abo“ in den Einstellungen

## 1.7.1

Neu in 1.7.1:
• Weiterkommen in vier Modi: Der Turnierbaum zeigt, wie es weitergeht – fester Baum, Auslosung nach der Runde, Show-Auslosung oder sofort zufällig
• Show-Auslosung als Moment: „Auslosung bereit“, die Namen gleiten in ihre Plätze, eine leichte Vibration
• Neue Namen im Baum: „Loser Runde 1“, „Grand Final“, „voraussichtlich“ bei vorgeplanten Zeiten
• Fast Lap: Versuche und Gäste wie auf der Website
