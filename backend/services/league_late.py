"""Nachmeldefrist einer Season (docs/LIGA.md, B.4 „Nachmeldung nach dem Season-Start“, #2422, Entscheidung Nr. 184).

Ein Blatt-Modul ohne Importe aus dem Projekt: Selbstanmeldung (``league_applications``), Vorab-Prüfung (``league_readiness``),
Startseite (``league_home``) und Regelwerk-Variablen rechnen dasselbe wirksame Ende.

Das Anmeldefenster darf über den Beginn der Season hinausgehen (Nr. 180). Spätestens ``late_registration_days`` Tage nach dem Start
schließt die Anmeldung trotzdem (Vorgabe 14, fehlt das Feld, gilt sie auch). Die Leitung kann mit Grund verlängern
(``application_late_extension``) - dann gilt deren Ende, höchstens bis zum Ende des Fensters.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# Spiele einer Nachmeldung (#2422): gemeinsam für Nachmeldung (league_late_entry) und Strafen (league_sanctions), ohne Import-Kreis.
GENERATION_MODE = "late_entry"
# Ein Spiel, das entfallen ist, belegt die Woche nicht mehr - außer Nr. 188 (league_late_entry.held_cancel).
GONE_STATUSES = frozenset({"cancelled", "archived"})

FIELD = "late_registration_days"
DEFAULT_DAYS = 14
MAX_DAYS = 365
EXTENSION = "application_late_extension"
REASON_MIN = 5
REASON_MAX = 500


def aware(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def registration_name(registration: dict | None) -> str:
    """Der Name einer Anmeldung für Sätze: Anzeigename, sonst Team- oder Co-Team-Name."""
    row = registration or {}
    return row.get("display_name") or row.get("team_name") or row.get("squad_name") or "Team"


def late_days(season: dict | None) -> int:
    """Tage nach dem Start, bis zu denen eine Nachmeldung geht. Fehlt der Wert oder ist er kaputt: die Vorgabe."""
    raw = (season or {}).get(FIELD)
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_DAYS
    return min(max(days, 0), MAX_DAYS)


def extension_until(season: dict | None) -> datetime | None:
    return aware(((season or {}).get(EXTENSION) or {}).get("until"))


def late_deadline(season: dict | None) -> datetime | None:
    """Bis wann eine Nachmeldung höchstens geht: Start plus Frist; eine Verlängerung verlängert nur, sie verkürzt nie (Review
    #2422: wird die Frist später länger als eine alte Verlängerung, gilt die Frist). ``None``: kein Start."""
    extended = extension_until(season)
    start = aware((season or {}).get("start_date"))
    regular = start + timedelta(days=late_days(season)) if start else None
    if extended and regular:
        return max(extended, regular)
    return extended or regular


def effective_closes(season: dict | None) -> datetime | None:
    """Das wirksame Ende der Anmeldung: min(Ende des Fensters, Nachmeldefrist). ``None``: kein Fenster."""
    closes = aware((season or {}).get("application_closes_at"))
    if not closes:
        return None
    start = aware((season or {}).get("start_date"))
    if not start or closes <= start:
        return closes
    deadline = late_deadline(season)
    return min(closes, deadline) if deadline else closes


def effective_closes_iso(season: dict | None) -> str | None:
    moment = effective_closes(season)
    return moment.isoformat() if moment else None


def view(season: dict | None) -> dict:
    """Für die Verwaltung: Frist (gespeichert und geltend), ihr Ende, die Verlängerung und das wirksame Ende der Anmeldung."""
    deadline = late_deadline(season)
    extension = (season or {}).get(EXTENSION) or None
    return {"days": late_days(season), "stored_days": (season or {}).get(FIELD), "default_days": DEFAULT_DAYS,
            "deadline": deadline.isoformat() if deadline else None, "extension": extension,
            "effective_closes_at": effective_closes_iso(season), "capped": capped(season)}


def clean_extension(season: dict, until, reason, now: datetime) -> tuple[dict | None, str]:
    """Verlängern mit Grund (Nr. 184): ``until`` nach dem Ende der Frist ohne Verlängerung, höchstens bis zum Ende des Fensters.
    ``until`` leer nimmt die Verlängerung zurück. Gibt ``(neuer Wert, Grund)`` zurück, wirft ``ValueError`` mit deutschem Satz. Wer verlängert
    hat, steht nur im Protokoll (``league.season.late_extension``), nicht an der Season."""
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        raise ValueError(f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Er steht im Protokoll.")
    text = text[:REASON_MAX]
    if until in (None, ""):
        if not (season or {}).get(EXTENSION):
            raise ValueError("Diese Season hat keine verlängerte Nachmeldung.")
        return None, text
    moment = aware(until)
    if moment is None:
        raise ValueError("Bitte ein gültiges Ende angeben.")
    closes = aware(season.get("application_closes_at"))
    start = aware(season.get("start_date"))
    if not closes or not start:
        raise ValueError("Verlängern geht nur mit Anmeldefenster und Beginn der Season.")
    regular = start + timedelta(days=late_days(season))
    if moment <= regular:
        raise ValueError("Das neue Ende liegt nicht nach der Nachmeldefrist - dafür braucht es keine Verlängerung.")
    if moment > closes:
        raise ValueError("Das neue Ende liegt nach dem Ende des Anmeldefensters. Bitte zuerst das Fenster verlängern.")
    if moment <= now:
        raise ValueError("Das neue Ende liegt in der Vergangenheit.")
    return {"until": moment.isoformat(), "reason": text, "at": now.isoformat()}, text


def capped(season: dict | None) -> bool:
    """Schließt die Frist die Anmeldung früher als das Fenster? Dann sagt es die Vorab-Prüfung."""
    closes = aware((season or {}).get("application_closes_at"))
    effective = effective_closes(season)
    return bool(closes and effective and effective < closes)
