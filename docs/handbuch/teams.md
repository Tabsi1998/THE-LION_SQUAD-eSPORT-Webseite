# Teams

Teams sind die Gemeinschaften auf der Website: Mitglieder, Co-Teams, Team-Chat, Turnieranmeldung. Dieses Kapitel erklärt,
wer was darf, wie man Teams verwaltet und was beim Auflösen passiert. Wie Co-Teams in der Liga spielen, steht unter
[Liga leiten](liga.md).

## 1. Überblick

| Was | Wo | Wer |
| --- | --- | --- |
| Team anlegen, beitreten, suchen | **Community → Teams** (`/teams`) | alle mit Konto |
| Mitglieder, Rollen, Übergabe | Teamseite → **Mitglieder verwalten** | Teamleitung, Club-Admin, Superadmin |
| Einladen, Beitrittscode, Link und QR-Code | Teamseite → **Einladen** | Teamleitung, Co-Leitung |
| Name, Logo, Beschreibung | Teamseite → **Bearbeiten** | Teamleitung, Co-Leitung, Turnierleitung, Club-Admin, Superadmin |
| Öffentlich oder privat | Teamseite → **Bearbeiten** | Teamleitung, Club-Admin, Superadmin |
| Co-Teams, Captain, Vertreter | **Teams → Deine Teams** | Teamleitung, Co-Leitung, Turnierleitung, Club-Admin, Superadmin |
| Team auflösen | Teamseite → **Bearbeiten**, ganz unten | Teamleitung, Club-Admin, Superadmin |
| Aufgelöstes Team zurückholen | **Admin → eSports → Teams** oder **Teams → Deine Teams** | Club-Admin, Superadmin; die frühere Teamleitung nur, wenn sie selbst aufgelöst hat |
| Alle Teams, verwaiste Teams | **Admin → eSports → Teams** | Turnierleitung, Vereinsverwaltung |
| Alle Beitrittscodes erneuern | **Admin → eSports → Teams** | Club-Admin, Superadmin |

### Die Begriffe

- **Teamleitung**: führt das Team – eine Person. Vergibt Rollen, übergibt die Leitung, löst auf.
- **Co-Leitung**: pflegt Teamdaten, lädt ein, verwaltet Co-Teams. Löst nicht auf und vergibt keine Rollen.
- **Mitglied**: gehört zum Team, sieht Chat und Co-Teams.
- **Captain** und **Vertreter** gibt es nur im **Co-Team**: Sie handeln dort in der Liga (Termine, Ergebnisse).

## 2. Einrichten

Nichts einzurichten. Ein neues Team ist öffentlich. Name 2–60 Zeichen, Kürzel 2–8 Zeichen, jedes Kürzel gibt es nur einmal.

## 3. Die Funktionen einzeln

### 3.1 Beitreten: Link, Code, persönliche Einladung

Unter **Einladen** stehen drei Wege: **Einladungs-Link** mit QR-Code, **Beitrittscode** und die Suche nach einer Person.
**Neuen Link erzeugen** und **Beitrittscode erneuern** fragen nach; danach gilt der alte nicht mehr, wer schon im Team ist,
bleibt. Link und Code sind unabhängig: Einen zu erneuern ändert den anderen nicht. Der Code steht nie im Protokoll, dort
steht nur, dass und von wem er erneuert wurde.

Die Teamleitung bekommt eine Nachricht, wenn jemand beitritt oder geht; wer entfernt wird, erfährt es auch. Beitritte,
Austritte und Entfernen stehen im Protokoll (**Admin → System → Betrieb & Logs**).

### 3.2 Öffentlich oder privat

Der Schalter **Team öffentlich** steht unter **Bearbeiten**; die Vorgabe ist öffentlich.

Ein **privates** Team steht nicht in der Teamliste, der Suche, auf Profilen und bei verlinkten News. Die Teamseite sehen nur
Mitglieder und die Verwaltung; beitreten geht nur über den Einladungs-Link oder eine persönliche Einladung. In Turnieren
und Wertungen, an denen das Team teilnimmt, bleibt der Name sichtbar.

### 3.3 Co-Teams

Unter **Teams → Deine Teams** → **Co-Team**: Name, **Spiel** aus der Liste, **Kader**, **Captain** und **Vertreter**. Das
Spiel zählt für die Discord-Rollen und die Liga: Ein Co-Team mit anderem Spiel lässt sich nicht zuteilen, ohne Spiel passt es
überall. Solange es in einer Staffel spielt, bleibt sein Spiel.

### 3.4 Auflösen und wiederherstellen

**Team auflösen** verlangt den eingetippten Teamnamen und sagt vorher, was passiert. Läuft ein Turnier oder spielt ein
Co-Team in einer Staffel, geht es erst, wenn die Turnierleitung das geklärt hat.

Nach dem Auflösen:

- Das Team ist aus Listen, Suche und Team-Prüfungen verschwunden; alle Mitglieder bekommen eine Nachricht.
- Anmeldungen für Turniere, die noch nicht begonnen haben, sind zurückgezogen – und bleiben das auch beim Wiederherstellen.
- **Alte Turniere** und Wertungen zeigen weiter den Namen; die Adresse des Teams sagt „wurde aufgelöst“.

**30 Tage** lang lässt sich das Team wiederherstellen: unter **Admin → eSports → Teams → Aufgelöste Teams** oder, wenn die
frühere Teamleitung selbst aufgelöst hat, von ihr unter **Teams → Deine Teams**. Was ein Admin aufgelöst hat, holen nur Admins
zurück. Name und Kürzel laufen dabei durch den Wortfilter. Mitglieder, Co-Teams und Chat sind wieder da, dazu ein **neuer Beitrittscode**
und ein neuer Link. Hat ein anderes Team das Kürzel inzwischen, fragt die Seite nach einem neuen. Hat die frühere Teamleitung
ihr Konto gelöscht, übernimmt die Co-Leitung, sonst ein Mitglied.

Nach den 30 Tagen räumt der tägliche Job auf: Chat samt Anhängen, Einladungen, Kader und Mitgliederlisten sind weg, Logo und
Banner auch, wenn sie sonst nirgends stehen (Bilder aus der Mediathek bleiben). Nur Name und Kürzel bleiben für alte Turniere. Löscht jemand sein Konto, ist die Person sofort auch aus aufgelösten Teams heraus.

### 3.5 Teamverwaltung im Admin

**Admin → eSports → Teams** (auch über die Kachel **Teams** auf dem Dashboard): alle Teams mit Suche, auch private. **Ohne aktive
Teamleitung** steht rot in der Zeile – die Teamleitung hat ihr Konto gelöscht. Ein Klick führt zur Teamseite; dort übergeben
Club-Admin und Superadmin unter **Mitglieder verwalten** mit **Zur Teamleitung machen**.

**Alle Beitrittscodes erneuern** gibt jedem Team auf einmal einen neuen Code, etwa nach einer Bereinigung – mit Rückfrage und
Protokoll. Die alten Codes gelten sofort nicht mehr. Die Teamleitungen bekommen eine Nachricht und finden den neuen Code auf
ihrer Teamseite unter **Einladen**. Die Einladungs-Links bleiben; einen Code zeigt die Verwaltungsseite nie.

## 4. Wenn etwas nicht klappt

| Fehlerbild | Ursache | Lösung |
| --- | --- | --- |
| „Dieser Beitrittscode stimmt nicht.“ | Code wurde erneuert oder falsch abgetippt | Die Teamleitung nennt den aktuellen Code unter **Einladen** |
| „Als Teamleitung kannst du das Team nicht verlassen.“ | Ein Team braucht eine Leitung | Leitung übergeben oder Team auflösen |
| „Auflösen geht gerade nicht …“ | Turnier läuft oder Co-Team steht in einer Staffel | Die Turnierleitung klärt das Turnier; danach geht es |
| „Dieses Spiel gibt es hier nicht.“ | In der App frei eingetippter Spielname | Auf der Website aus der Liste wählen oder leer lassen |
| „Das Kürzel … hat inzwischen ein anderes Team“ | Beim Wiederherstellen ist das Kürzel vergeben | Neues Kürzel eintragen |
| Team fehlt unter „Aufgelöste Teams“ | Die 30 Tage sind vorbei | Nicht mehr wiederherstellbar; das Team neu anlegen |

## 5. Häufige Fragen

**Kann die Co-Leitung ein aufgelöstes Team zurückholen?** Nein, nur Club-Admin oder Superadmin und die frühere Teamleitung, wenn sie selbst aufgelöst hat.

**Kommen zurückgezogene Turnier-Anmeldungen zurück?** Nein, das Team meldet sich neu an, wenn die Anmeldung noch offen ist.

**Sieht die Turnierleitung Beitrittscodes?** Auf der Teamseite unter **Einladen** ja, weil sie Teams verwaltet; in der Admin-Liste und
im Protokoll stehen sie nie.
