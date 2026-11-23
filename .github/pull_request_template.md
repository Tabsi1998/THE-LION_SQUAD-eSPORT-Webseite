<!--
PR-Titel: Typ nach Conventional Commits, Rest auf Deutsch – daraus entstehen Version und Changelog.
  feat: …   neue Funktion        fix: …   Fehler behoben       perf: …  schneller
  docs: …   nur Doku             chore: … Pflege/Abhängigkeiten  refactor:/test:/ci:/build: … ohne Changelog-Eintrag
  feat!: …  bricht etwas (neue Hauptversion)
-->

## Warum

<!-- Was war das Problem, und warum so gelöst? -->

## Was sich ändert

-

## Geprüft

- [ ] Lokal geprüft (`python scripts/local_check.py`, betroffene Gruppen)
- [ ] Doku angepasst, wo sich Verhalten ändert (`docs/…`, `mobile/CHANGELOG.md`)
- [ ] Keine Geheimnisse, keine Daten von Mitgliedern, keine Screenshots mit Namen

<!--
Prüftor (#1660, docs/entwicklung/prueftor.md): Bei sichtbaren Änderungen prüft die CI Barrierefreiheit, Kontrast,
Bundle, Ladezeit und Bewegungsregeln und schreibt das Ergebnis als einen Kommentar in den PR. Rot heißt nicht mergen.
Nur mit gutem Grund eine Ausnahme: eine Zeile je Prüfung (a11y, kontrast, bundle, ladezeit, bewegung) AUSSERHALB
dieses Kommentars, danach den Job „Prüftor“ neu starten. Beispiel:
Prüftor-Ausnahme bewegung: Begründung, warum es hier nicht anders geht
-->

Closes #
