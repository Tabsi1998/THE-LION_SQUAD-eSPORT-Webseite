"""Regeln der Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“).

Blatt-Modul ohne Datenbank: die Einstellung ``start_rights`` der Season, die Frist, die getrennten Zustände, die Nachrückerregel und
was Eingang, Zuteilen und Los davon wissen müssen. Es importiert nichts, was zurück importiert - ``league_applications``,
``league_successor`` und ``league_draw`` lesen hier. Alles, was schreibt, steht in ``services/league_start_rights.py``.

- **Zustände** (``state``): ``forecast`` (laufende Tabelle), ``confirmed`` (gespeicherter Endstand samt Playoffs und Relegation),
  ``offered``/``accepted``/``declined``/``expired``/``revoked`` (Zusage), ``participating`` (einer Staffel zugeteilt).
- **Frist:** ``accept_days`` ab der Vergabe, spätestens der Start der Season - beim Lesen gerechnet, nie am Antrag gespeichert.
- **Nachrücken** (``candidates``): der beste Nicht-Aufsteiger bzw. der Nächste der Tabelle, über Staffeln hinweg mit
  ``league_cross_rank`` und ohne Los (Nr. 156). Keine Kette.

**Ohne die Einstellung an der Season geschieht nichts**: Dann gilt F.2 unverändert (Nr. 160).
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta

from models import now_utc
from services import league_calendar, league_cross_rank

FIELD = "start_rights"
NOTICES = "start_right_notices"
NOTICES_OPEN = "start_right_notices_open"
AUTO, ACCEPT = "auto", "accept"
NEXT, LEAD = "next", "lead"
DEFAULTS: dict = {"mode": ACCEPT, "accept_days": 14, "successor": NEXT, "remind_hours": 48, "announce": True}
CHOICES: dict[str, tuple[str, ...]] = {"mode": (AUTO, ACCEPT), "successor": (NEXT, LEAD)}
# Feld → (kleinster, größter Wert, Bezeichnung für die Meldung)
NUMBERS: dict[str, tuple[int, int, str]] = {
    "accept_days": (1, 60, "Die Frist für die Zusage (Tage)"),
    "remind_hours": (0, 336, "Die Erinnerung vor Fristende (Stunden)"),
}
OFFERED, ACCEPTED, DECLINED, EXPIRED = "offered", "accepted", "declined", "expired"
FORECAST, CONFIRMED, REVOKED, PARTICIPATING = "forecast", "confirmed", "revoked", "participating"
REJECTED, WAITLIST = "rejected", "waitlist"
NON_PROMOTED, RELEGATED = "non_promoted", "relegated"
REASON_MIN = 5


class StartRightProblem(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Einstellung

def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def _number_ok(key: str, value) -> bool:
    low, high, _label = NUMBERS[key]
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def normalize(raw) -> dict:
    """Die Einstellung aus einer Eingabe der Verwaltung - fehlende Felder mit Vorgabe, Falsches mit deutscher Meldung (422)."""
    if not isinstance(raw, dict):
        raise StartRightProblem("Die Einstellung der Startrechte fehlt.")
    if set(raw) - set(DEFAULTS):
        raise StartRightProblem("Die Einstellung der Startrechte enthält ein unbekanntes Feld.")
    out = defaults()
    for key, allowed in CHOICES.items():
        value = raw.get(key)
        if value is None:
            continue
        if value not in allowed:
            raise StartRightProblem("Bitte wählen, wie die Teams ihren Platz bekommen: automatisch oder mit Zusage." if key == "mode"
                                    else "Bitte wählen, wer nachrückt: automatisch nach der Regel oder nach Entscheid der Leitung.")
        out[key] = value
    for key, (low, high, label) in NUMBERS.items():
        value = raw.get(key)
        if value is None:
            continue
        if not _number_ok(key, value):
            raise StartRightProblem(f"{label} muss eine ganze Zahl von {low} bis {high} sein.")
        out[key] = value
    if raw.get("announce") is not None:
        if not isinstance(raw["announce"], bool):
            raise StartRightProblem("Die Nachricht zum bestätigten Auf- und Abstieg ist weder an noch aus.")
        out["announce"] = raw["announce"]
    return out


def stored(season: dict | None) -> dict | None:
    """Was an der Season wirklich steht (geprüft) - ``None`` ohne Feld: Dann gibt es keine Startrechte, alles bleibt wie in F.2.
    Ein von Hand verbogener Wert sperrt nichts, nur dieses Feld fällt auf die Vorgabe zurück."""
    raw = (season or {}).get(FIELD)
    if not isinstance(raw, dict):
        return None
    out = defaults()
    for key, allowed in CHOICES.items():
        if raw.get(key) in allowed:
            out[key] = raw[key]
    for key in NUMBERS:
        if _number_ok(key, raw.get(key)):
            out[key] = raw[key]
    if isinstance(raw.get("announce"), bool):
        out["announce"] = raw["announce"]
    return out


def needs_accept(season: dict | None) -> bool:
    """Brauchen übernommene Co-Teams dieser Season eine Zusage?"""
    return (stored(season) or {}).get("mode") == ACCEPT


def offer(now: datetime | None = None) -> dict:
    """Ein frisch vergebenes Startrecht: Die Frist läuft ab jetzt."""
    return {"status": OFFERED, "offered_at": (now or now_utc()).isoformat()}


# ---------------------------------------------------------------- Frist und Zustände

def right_of(application: dict | None) -> dict | None:
    value = ((application or {}).get("carry_over") or {}).get("start_right")
    return value if isinstance(value, dict) else None


def accept_until(application: dict | None, season: dict | None) -> datetime | None:
    """Bis wann die Zusage geht: ``accept_days`` ab der Vergabe, spätestens der Start der Season (der gemerkte, Nr. 253).
    ``None``: Der Antrag trägt kein Startrecht mit Frist."""
    right = right_of(application)
    offered = league_calendar.aware((right or {}).get("offered_at"))
    if not offered:
        return None
    until = offered + timedelta(days=int((stored(season) or DEFAULTS)["accept_days"]))
    start = league_calendar.start_moment(season)
    return min(until, start) if start else until


def overdue(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Offen und die Frist ist vorbei - gilt schon, bevor der Job den Antrag anfasst."""
    right = right_of(application)
    until = accept_until(application, season)
    return bool(right and right.get("status") == OFFERED and until and (now or now_utc()) >= until)


def state(application: dict | None, season: dict | None, now: datetime | None = None) -> str | None:
    """Der Zustand eines übernommenen Antrags (docs/LIGA.md „Getrennte Zustände“) - ``None`` ohne ``carry_over``."""
    carry = (application or {}).get("carry_over")
    if not carry:
        return None
    right = right_of(application) or {}
    status = application.get("status")
    if carry.get("revoked_at") and status == "rejected":
        return REVOKED
    if right.get("status") == EXPIRED:
        return EXPIRED
    if status == "withdrawn" or right.get("status") == DECLINED:
        return DECLINED
    if status != "accepted":
        # Von der Leitung abgelehnt bzw. auf die Warteliste gesetzt (B.4): weder verfallen noch abgemeldet.
        return WAITLIST if status == "waitlist" else REJECTED
    if application.get("assignment"):
        return PARTICIPATING
    if right.get("status") == OFFERED:
        return EXPIRED if overdue(application, season, now) else OFFERED
    if right.get("status") == ACCEPTED:
        return ACCEPTED
    return CONFIRMED


# ---------------------------------------------------------------- Nachrückerregel (ohne Datenbank)

def _heads(rows: list[dict]) -> list[dict]:
    """Je Staffel das bestplatzierte Co-Team der Gruppe."""
    best: dict[str, dict] = {}
    for row in rows:
        key = str(row.get("from_staffel") or "")
        if key not in best or int(row.get("rank") or 999) < int(best[key].get("rank") or 999):
            best[key] = row
    return [best[key] for key in sorted(best)]


def candidates(place: dict, rights: list[dict], levels: list[int]) -> dict:
    """Wer für einen frei gewordenen Platz nachrückt. ``place``: ``{application_id, division_level, from_level}`` des frei gewordenen
    Startrechts. ``rights``: die offenen Startrechte der Season (``application_id``, ``from_level``, ``from_staffel``,
    ``division_level``, ``rank``, ``points``, ``played``, ``score_diff``, ``passed``, ``fills``). ``levels``: die aktiven Liga N.

    Aufstieg frei geworden: zuerst der beste Nicht-Aufsteiger der Liga darunter, sonst der beste Absteiger (er bleibt). Sonst
    umgekehrt („der Nächste der Tabelle“). Zwischen Staffeln Punkte je Spiel, dann Map-Differenz je Spiel; bei Gleichstand ``tied``
    und kein ``pick`` - ein Los gibt es nicht (Nr. 156)."""
    level = place.get("division_level")
    freed = place.get("application_id")
    if not isinstance(level, int):
        return {"group": None, "candidates": [], "pick": None, "tied": []}
    below = min((item for item in levels if item > level), default=None)
    free = [row for row in rights if row.get("application_id") != freed and not row.get("fills") and freed not in (row.get("passed") or [])]
    groups = {
        # Kommt aus der Liga darunter und bleibt dort: der Nächste nach den Aufsteigern.
        NON_PROMOTED: [row for row in free if below is not None and row.get("from_level") == below and row.get("division_level") == below],
        # Kommt aus dieser Liga und müsste hinunter: Der Beste bleibt.
        RELEGATED: [row for row in free if row.get("from_level") == level and isinstance(row.get("division_level"), int)
                    and row["division_level"] > level],
    }
    promoted = isinstance(place.get("from_level"), int) and place["from_level"] > level
    for group in ((NON_PROMOTED, RELEGATED) if promoted else (RELEGATED, NON_PROMOTED)):
        heads = _heads(groups[group])
        if not heads:
            continue
        found = league_cross_rank.pick(heads, 1)
        order = [item["row"]["application_id"] for item in found["order"]]
        if found["tied"]:
            return {"group": group, "candidates": order, "pick": None, "tied": [row["application_id"] for row in found["tied"]]}
        return {"group": group, "candidates": order, "pick": found["chosen"][0]["application_id"], "tied": []}
    return {"group": None, "candidates": [], "pick": None, "tied": []}


# ---------------------------------------------------------------- Eingang, Zuteilen, das eigene Team

ASSIGN_WAITS = ("{name} hat das Startrecht noch nicht angenommen (Frist bis {day}). Zuteilen geht nach der Zusage. Liegt sie dir schon "
                "vor, trag sie bei den Startrechten mit Grund ein.")


def decline_fields(application: dict | None, now: str) -> dict:
    """Abmelden ist die Absage: die Felder für denselben Schreibvorgang wie der Statuswechsel - leer ohne Startrecht."""
    if not right_of(application):
        return {}
    return {"carry_over.start_right.status": DECLINED, "carry_over.start_right.closed_at": now}


def day_text(moment: datetime | None) -> str:
    return moment.astimezone(league_calendar.VIENNA).strftime("%d.%m.%Y, %H:%M Uhr") if moment else ""


def assign_problem(application: dict | None, season: dict | None) -> str | None:
    """Zuteilen nimmt nur zugesagte Startrechte: der Satz für 422 - ``None``, wenn nichts dagegen spricht."""
    right = right_of(application)
    if not right or right.get("status") != OFFERED:
        return None
    return ASSIGN_WAITS.format(name=(application or {}).get("display_name") or "Das Co-Team", day=day_text(accept_until(application, season)))


def may_pass(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Darf ein Nachrücker den Platz noch ablehnen? Solange er nicht zugesagt hat und nicht zugeteilt ist - ohne Zusage-Modus bis zum
    Start der Season."""
    carry = (application or {}).get("carry_over") or {}
    if not isinstance(carry.get("fills"), dict) or application.get("status") != "accepted" or application.get("assignment"):
        return False
    right = right_of(application)
    if right:
        return right.get("status") == OFFERED and not overdue(application, season, now)
    start = league_calendar.start_moment(season)
    return not start or (now or now_utc()) < start


def view(application: dict | None, season: dict | None, *, can_act: bool = False, now: datetime | None = None) -> dict | None:
    """Das Startrecht für das eigene Team und den Eingang - ``None``, wenn die Season keine Startrechte führt und der Antrag keines
    trägt (dann bleibt die Antwort, wie sie vor F.2a war). Ohne Namen anderer Teams."""
    carry = (application or {}).get("carry_over")
    if not carry:
        return None
    right = right_of(application)
    fills = carry.get("fills") if isinstance(carry.get("fills"), dict) else None
    if not stored(season) and not right and not fills:
        return None
    current = state(application, season, now)
    until = accept_until(application, season)
    return {"state": current, "accept_until": until.isoformat() if until and (right or {}).get("status") == OFFERED else None,
            "accepted_at": (right or {}).get("accepted_at"),
            "fills": {"from_label": (fills.get("back") or {}).get("division_label")} if fills else None,
            "can_accept": bool(can_act and current == OFFERED),
            "can_decline": bool(can_act and may_pass(application, season, now))}


def link_fields(application: dict | None, actor_id: str | None, now: str) -> dict:
    """Sonderweg „Co-Team zuteilen“: Teilt die Leitung ein Co-Team mit offenem Startrecht direkt zu, gilt das als Zusage durch die
    Leitung. Die Felder für denselben Schreibvorgang - leer, wenn es nichts zuzusagen gibt."""
    right = right_of(application)
    if not right or right.get("status") != OFFERED:
        return {}
    return {"carry_over.start_right.status": ACCEPTED, "carry_over.start_right.accepted_at": now,
            "carry_over.start_right.accepted_by": actor_id, "carry_over.start_right.accepted_via": "assignment"}
