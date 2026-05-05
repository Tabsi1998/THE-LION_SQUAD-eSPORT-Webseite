# Rollen- und Rechte-Audit

Stand: 05.05.2026

## Rollenmodell

- `player`: normaler Community-Account.
- `team_leader`: erweiterte Teamverwaltung im eigenen Teamkontext.
- `moderator`: Moderationsrechte, aber kein voller Adminbereich.
- `tournament_admin`: Adminrechte fuer Turniere, Events, Inhalte und operative Verwaltung.
- `club_admin`: Vereinsadmin mit erweiterter Vereinsverwaltung.
- `superadmin`: hoechste Rolle, darf Rollen aendern und Setup abschliessen.

Aktive Vereinsmitglieder werden nicht ueber die technische Rolle erkannt, sondern ueber den
Mitgliedschaftsstatus `active` oder `honorary`. Adminrollen duerfen Mitgliedsbereiche ebenfalls
betreten.

## Backend-Schutz

- Admin-APIs verwenden `require_admin()`.
- Superadmin-only Funktionen verwenden `require_super()`.
- Geschuetzte Nutzerfunktionen verwenden `get_current_user`.
- Mitgliedsbereiche verwenden `require_club_member()` oder frontendseitig `requireMember`.
- Gesperrte Nutzer werden in `get_current_user()` mit `403` blockiert.
- Negative Achievements werden nicht oeffentlich ausgegeben.

## Frontend-Schutz

- Alle `/admin/*` Seiten sind mit `ProtectedRoute requireAdmin` geschuetzt.
- Alle `/members/*` Seiten sind mit `ProtectedRoute requireMember` geschuetzt.
- Dashboard, Profil, Match-Hub und DSGVO-Daten sind loginpflichtig.

## Gepruefte sensible Bereiche

- Rollenwechsel: `POST /api/users/{id}/role` ist `superadmin` only.
- Admin-Systemstatus: `GET /api/admin/system-status` ist admin-only.
- Mail/SMTP/Discord/Branding/Rechtliches: admin-only.
- Private Dokumente: admin-only Verwaltung, geschuetzter Abruf ueber Dokumentroutes.
- Eigene Daten/DSGVO Export: loginpflichtig und nutzerbezogen.
- Team-/Match-Aktionen pruefen Besitzer, Teilnehmer oder Adminrolle.

## Offene Wachsamkeit

- Neue Adminseiten immer zusaetzlich im Backend schuetzen, nicht nur im Frontend.
- `moderator` ist bewusst nicht Teil von `require_admin()`. Falls Moderatoren eigene Adminseiten
  bekommen sollen, separate `require_role("moderator")`-Routen verwenden.
- Bilduploads sind fuer eingeloggte Nutzer erlaubt, weil Profile Avatare/Banner brauchen. Admin-
  Dokumentuploads und Sponsorlogos bleiben admin-only.
- Bei bezahlten Turnieren Zahlungsdaten, Belege und Preisabwicklung separat pruefen.
