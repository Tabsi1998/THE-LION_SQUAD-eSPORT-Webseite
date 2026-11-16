"""Mindestalter (#1698, Fabians Entscheidung vom 16.11.): Vereinsmitglied ab 18, Konto ab 14.

- Der Beitrittsantrag verlangt ein Geburtsdatum. Wer am Wiener Tag des Antrags noch keine 18 ist, bekommt eine
  verständliche Absage - auf der Website und für die App, über denselben Server-Weg.
- Das Konto ab 14 (Art. 8 DSGVO, Österreich) steht nur als Text bei Registrierung und in der Datenschutzerklärung.
- Bestehende Mitglieder, Altanträge und alles, was die Verwaltung selbst anlegt, prüft das nicht nach.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

MEMBERSHIP_MIN_AGE = 18
ACCOUNT_MIN_AGE = 14

VIENNA = ZoneInfo("Europe/Vienna")

MISSING_TEXT = f"Für den Antrag brauchen wir dein Geburtsdatum – Vereinsmitglied wirst du ab {MEMBERSHIP_MIN_AGE} Jahren."
INVALID_TEXT = "Das Geburtsdatum stimmt so nicht – bitte als Tag, Monat und Jahr angeben."
TOO_YOUNG_TEXT = (f"Vereinsmitglied wirst du ab {MEMBERSHIP_MIN_AGE} Jahren. Bis dahin kannst du mit deinem Konto in der "
                  "Community mitmachen – den Antrag stellst du ab deinem 18. Geburtstag.")


def vienna_today(now: datetime | None = None) -> date:
    """Der heutige Tag in Wien: ein Geburtstag beginnt um Mitternacht dort, nicht erst in UTC."""
    return (now or datetime.now(timezone.utc)).astimezone(VIENNA).date()


def age_on(born: date, today: date) -> int:
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def membership_birth_problem(birth: str | date | None, today: date | None = None) -> str | None:
    """Warum dieses Geburtsdatum für einen Beitrittsantrag nicht reicht - oder ``None``, wenn es passt."""
    if not birth:
        return MISSING_TEXT
    try:
        born = birth if isinstance(birth, date) else date.fromisoformat(str(birth).strip()[:10])
    except ValueError:
        return INVALID_TEXT
    today = today or vienna_today()
    if born > today:
        return INVALID_TEXT
    if age_on(born, today) < MEMBERSHIP_MIN_AGE:
        return TOO_YOUNG_TEXT
    return None
