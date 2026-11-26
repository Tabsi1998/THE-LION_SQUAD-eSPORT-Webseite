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
# Pausen der Fristen (Entscheidung 26.11.): ``[{from, to}]`` an der Folge-Season - solange der Vorgänger wieder geöffnet ist.
PAUSES = "start_right_pauses"
PAUSE_LIMIT = 50
AUTO, ACCEPT = "auto", "accept"
NEXT, LEAD = "next", "lead"
DEFAULTS: dict = {"mode": ACCEPT, "accept_days": 14, "successor": NEXT, "remind_hours": 48, "announce": True,
                  # Restfrist (Entscheidung 26.11.): Wer ein Nachrück-Angebot verstreichen lässt, hat in der eigenen Liga mindestens so
                  # viele Tage für die Zusage.
                  "rest_days": 3}
CHOICES: dict[str, tuple[str, ...]] = {"mode": (AUTO, ACCEPT), "successor": (NEXT, LEAD)}
# Feld → (kleinster, größter Wert, Bezeichnung für die Meldung)
NUMBERS: dict[str, tuple[int, int, str]] = {
    "accept_days": (1, 60, "Die Frist für die Zusage (Tage)"),
    "remind_hours": (0, 336, "Die Erinnerung vor Fristende (Stunden)"),
    "rest_days": (0, 30, "Die Restfrist nach einem Nachrück-Angebot (Tage)"),
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


def start_reached(season: dict | None, now: datetime | None = None) -> bool:
    """Ist das Startdatum der Season erreicht - auch wenn sie noch Entwurf ist (Entscheidung 26.11.)? Ab dann verfällt nichts mehr
    automatisch und niemand rückt automatisch nach: Die Leitung entscheidet."""
    start = league_calendar.start_moment(season)
    return bool(start and (now or now_utc()) >= start)


def pauses(season: dict | None) -> list[tuple[datetime, datetime | None]]:
    """Die Pausen der Fristen, der Reihe nach - eine offene (``to`` leer) steht am Ende."""
    out = []
    for row in (season or {}).get(PAUSES) or []:
        begin = league_calendar.aware((row or {}).get("from")) if isinstance(row, dict) else None
        if begin:
            out.append((begin, league_calendar.aware(row.get("to"))))
    return sorted(out, key=lambda pair: pair[0])


def open_pause(season: dict | None) -> bool:
    """Läuft gerade eine Pause (der Vorgänger ist wieder geöffnet)?"""
    return any(end is None for _begin, end in pauses(season))


def _rests(right: dict | None) -> list[tuple[datetime, datetime | None]]:
    """Die Zeiten, in denen die Frist dieses Startrechts ruhte, weil ein Nachrück-Angebot offen war (``start_right.rests``)."""
    out = []
    for row in (right or {}).get("rests") or []:
        begin = league_calendar.aware((row or {}).get("from")) if isinstance(row, dict) else None
        end = league_calendar.aware(row.get("to")) if begin else None
        if begin and end:
            out.append((begin, end))
    return out


def _merged(spans: list[tuple[datetime, datetime | None]]) -> list[tuple[datetime, datetime | None]]:
    """Überlappende Ruhezeiten zusammengelegt - dieselbe Zeit zählt nur einmal, auch wenn Pause und Angebot zusammenfallen."""
    out: list[tuple[datetime, datetime | None]] = []
    for begin, end in sorted(spans, key=lambda pair: pair[0]):
        if out and (out[-1][1] is None or begin <= out[-1][1]):
            last_begin, last_end = out[-1]
            out[-1] = (last_begin, None if last_end is None or end is None else max(last_end, end))
        else:
            out.append((begin, end))
    return out


def _fell_back_at(right: dict | None) -> datetime | None:
    """Wann das letzte Nachrück-Angebot für dieses Co-Team endete (Rückfall auf das eigene Startrecht): Ab dann läuft die Restfrist."""
    ends = [end for _begin, end in _rests(right) if end]
    return max(ends) if ends else None


def _deadline(application: dict | None, season: dict | None) -> tuple[datetime | None, bool]:
    """(Fristende, ruht). ``accept_days`` ab der Vergabe; jede Ruhezeit, die in die laufende Frist fällt, verlängert sie um ihre
    Dauer (ab der Vergabe gerechnet): die Pausen der Season (Vorgänger wieder geöffnet) und die Zeit, in der für dieses Co-Team ein
    Nachrück-Angebot offen war (``rests``). Fällt eine offene Pause in die Frist, ruht sie: kein Ende, nichts ist überfällig. Eine
    Ruhezeit nach dem Fristende ändert nichts mehr. Nach einem verstrichenen Nachrück-Angebot endet die Frist nicht vor
    ``min_until`` (Restfrist, mindestens ``rest_days``) - und auch diese Restfrist ruht in jeder Pause, die nach dem Rückfall in sie
    fällt (Regel A gilt für jedes Fristende, egal woher es kommt). Äußerste Grenze bleibt das Startdatum der Season (das gemerkte,
    Nr. 253)."""
    right = right_of(application)
    offered = league_calendar.aware((right or {}).get("offered_at"))
    if not offered:
        return None, False
    until = offered + timedelta(days=int((stored(season) or DEFAULTS)["accept_days"]))
    for begin, end in _merged([*pauses(season), *_rests(right)]):
        if begin >= until:
            break
        if end is None:
            return None, True
        if end > offered:
            until += end - max(begin, offered)
    floor = league_calendar.aware(right.get("min_until"))
    if floor:
        since = _fell_back_at(right) or offered
        for begin, end in _merged(pauses(season)):
            if end is not None and end <= since:
                continue
            if max(begin, since) >= floor:
                break
            if end is None:
                return None, True
            floor += end - max(begin, since)
        until = max(until, floor)
    start = league_calendar.start_moment(season)
    return (min(until, start) if start else until), False


def restored_right(fills: dict | None, season: dict | None, now: datetime, actor_id: str | None, *, declined: bool) -> dict | None:
    """Das eigene Startrecht eines Nachrückers, wenn das Nachrück-Angebot endet (Entscheidung 26.11.). Solange das Angebot offen
    war, ruhte die eigene Frist - genau wie in der Pause.

    - **Abgelehnt** (``declined``): Das gilt als Zusage für die eigene Liga.
    - **Geschwiegen**: zurück in die eigene Liga mit der restlichen Frist - mindestens ``rest_days`` -, nie über das Startdatum
      hinaus (das begrenzt ``accept_until``). Die Erinnerung beginnt neu.
    - Wer schon zugesagt hatte, behält seine Zusage. Braucht die Season inzwischen keine Zusage mehr (umgeschaltet), gilt das
      frühere Startrecht wie alle anderen als zugesagt. ``None``: Es gab kein eigenes Startrecht (Modus „automatisch“)."""
    back = (fills or {}).get("back") or {}
    own = back.get("start_right") if isinstance(back.get("start_right"), dict) else None
    if own is None:
        return None
    if own.get("status") != OFFERED:
        return own
    stamp = now.isoformat()
    if not needs_accept(season):
        return {**own, "status": ACCEPTED, "accepted_at": stamp, "accepted_by": actor_id, "accepted_via": "mode"}
    if declined:
        return {**own, "status": ACCEPTED, "accepted_at": stamp, "accepted_by": actor_id, "accepted_via": "team"}
    since = (fills or {}).get("at") or stamp
    rest = int((stored(season) or DEFAULTS)["rest_days"])
    out = {key: value for key, value in own.items() if key != "reminded_at"}
    return {**out, "rests": [*(own.get("rests") or []), {"from": since, "to": stamp}], "min_until": (now + timedelta(days=rest)).isoformat()}


def accept_until(application: dict | None, season: dict | None) -> datetime | None:
    """Bis wann die Zusage geht - ``None`` ohne Startrecht mit Frist und solange die Frist ruht (``resting``)."""
    return _deadline(application, season)[0]


def resting(application: dict | None, season: dict | None) -> bool:
    """Ruht die Frist dieses Startrechts gerade (Pause, solange der Vorgänger wieder geöffnet ist)?"""
    right = right_of(application)
    return bool(right and right.get("status") == OFFERED and _deadline(application, season)[1])


def overdue(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Offen und die Frist ist vorbei - gilt schon, bevor der Job den Antrag anfasst. Nie, solange die Frist ruht."""
    right = right_of(application)
    until = accept_until(application, season)
    return bool(right and right.get("status") == OFFERED and until and (now or now_utc()) >= until)


def waits_for_lead(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Offen, die Frist ist vorbei und das Startdatum erreicht: Es verfällt nicht mehr von selbst - die Leitung entscheidet."""
    return (application or {}).get("status") == "accepted" and overdue(application, season, now) and start_reached(season, now)


def remind_at(application: dict | None, season: dict | None, settings: dict | None) -> datetime | None:
    """Wann die Erinnerung fällig ist: ``remind_hours`` vor Fristende - aber nie in der ersten Hälfte der Frist. Eine Erinnerung,
    die länger zurückreicht als die Frist selbst, käme sonst sofort nach der Vergabe. Nach einem verstrichenen Nachrück-Angebot
    zählt die Hälfte ab dem Rückfall: Die Nachricht dazu nennt die Frist schon. ``None``: keine Erinnerung."""
    right = right_of(application) or {}
    offered = league_calendar.aware(right.get("offered_at"))
    until = accept_until(application, season)
    hours = int((settings or {}).get("remind_hours") or 0)
    if not hours or not offered or not until or right.get("status") != OFFERED:
        return None
    return until - min(timedelta(hours=hours), (until - (_fell_back_at(right) or offered)) / 2)


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
        # Nach dem Startdatum verfällt nichts mehr von selbst: offen, bis die Leitung entscheidet (``waits_for_lead``).
        return EXPIRED if overdue(application, season, now) and not start_reached(season, now) else OFFERED
    if right.get("status") == ACCEPTED:
        return ACCEPTED
    return CONFIRMED


# ---------------------------------------------------------------- Nachrückerregel (ohne Datenbank)

def _rank(row: dict) -> int:
    return int(row.get("rank") or 999)


def _heads(rows: list[dict]) -> dict[str, list[dict]]:
    """Je Staffel die bestplatzierten Co-Teams der Gruppe - mehrere, wenn sie sich den Platz teilen (Gleichstand in der Tabelle)."""
    best: dict[str, list[dict]] = {}
    for row in rows:
        key = str(row.get("from_staffel") or "")
        if key not in best or _rank(row) < _rank(best[key][0]):
            best[key] = [row]
        elif _rank(row) == _rank(best[key][0]):
            best[key].append(row)
    return {key: best[key] for key in sorted(best)}


def candidates(place: dict, rights: list[dict], levels: list[int]) -> dict:
    """Wer für einen frei gewordenen Platz nachrückt. ``place``: ``{application_id, division_level, from_level}`` des frei gewordenen
    Startrechts. ``rights``: die offenen Startrechte der Season (``application_id``, ``from_level``, ``from_staffel``,
    ``division_level``, ``rank``, ``points``, ``played``, ``score_diff``, ``passed``, ``fills``, ``overdue``). ``levels``: die
    aktiven Liga N.

    Aufstieg frei geworden: zuerst der beste Nicht-Aufsteiger der Liga darunter, sonst der beste Absteiger (er bleibt). Sonst
    umgekehrt („der Nächste der Tabelle“). Zwischen Staffeln Punkte je Spiel, dann Map-Differenz je Spiel; bei Gleichstand ``tied``
    und kein ``pick`` - ein Los gibt es nicht (Nr. 156). Teilen sich in einer Staffel mehrere den besten Platz, ist auch das ein
    Gleichstand. **Nie Kandidat** ist, wessen eigene Frist vorbei ist (``overdue``, Entscheidung 26.11.): Nachrücken kann nur, wer
    zugesagt hat oder dessen Frist noch läuft."""
    level = place.get("division_level")
    freed = place.get("application_id")
    if not isinstance(level, int):
        return {"group": None, "candidates": [], "pick": None, "tied": []}
    below = min((item for item in levels if item > level), default=None)
    free = [row for row in rights if row.get("application_id") != freed and not row.get("fills") and not row.get("overdue")
            and freed not in (row.get("passed") or [])]
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
        found = league_cross_rank.pick([row for rows in heads.values() for row in rows], 1)
        order = [item["row"]["application_id"] for item in found["order"]]
        best = found["tied"] or found["chosen"]
        # Wer vorn liegt, bringt alle mit, die sich in seiner Staffel den Platz mit ihm teilen - auch das entscheidet die Leitung.
        shared = {row["application_id"] for top in best for row in heads[str(top.get("from_staffel") or "")]}
        if len(shared) > 1:
            return {"group": group, "candidates": order, "pick": None, "tied": [key for key in order if key in shared]}
        return {"group": group, "candidates": order, "pick": best[0]["application_id"], "tied": []}
    return {"group": None, "candidates": [], "pick": None, "tied": []}


# ---------------------------------------------------------------- Eingang, Zuteilen, das eigene Team

ASSIGN_WAITS = ("{name} hat das Startrecht noch nicht angenommen ({when}). Zuteilen geht nach der Zusage. Liegt sie dir schon "
                "vor, trag sie bei den Startrechten mit Grund ein.")


WAITLIST_FIRST = ("{name} hat das Startrecht noch nicht angenommen. Bitte erst ohne Staffel annehmen - dann beginnt die Frist für die "
                  "Zusage neu, und zuteilen geht nach der Zusage.")


def reoffer_fields(application: dict | None, now: str, season: dict | None) -> dict:
    """Zurück von der Warteliste (B.4): Ein noch nicht zugesagtes Startrecht wird neu vergeben - die Frist beginnt neu. Braucht die
    Season keine Zusage (mehr) - Modus „automatisch“ oder ausgeschaltet -, entsteht kein neues „Zusage offen“: Das Startrecht gilt
    dann wie alle anderen als zugesagt. Die Felder für denselben Schreibvorgang wie das Annehmen; leer, wenn nichts zu tun ist."""
    right = right_of(application)
    if not right or right.get("status") != OFFERED:
        return {}
    if not needs_accept(season):
        return {"carry_over.start_right": {**right, "status": ACCEPTED, "accepted_at": now, "accepted_by": None, "accepted_via": "mode"}}
    return {"carry_over.start_right": {"status": OFFERED, "offered_at": now}}


def waitlist_problem(application: dict | None, season: dict | None) -> str | None:
    """Annehmen von der Warteliste gleich mit Staffel geht nur mit Zusage: der Satz für 422 - ``None``, wenn nichts dagegen spricht
    (zugesagt, kein Startrecht, oder die Season braucht keine Zusage)."""
    right = right_of(application)
    if not right or right.get("status") != OFFERED or not needs_accept(season):
        return None
    return WAITLIST_FIRST.format(name=(application or {}).get("display_name") or "Das Co-Team")


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
    until = accept_until(application, season)
    return ASSIGN_WAITS.format(name=(application or {}).get("display_name") or "Das Co-Team",
                               when=f"Frist bis {day_text(until)}" if until else "die Frist ruht gerade")


def may_pass(application: dict | None, season: dict | None, now: datetime | None = None) -> bool:
    """Darf ein Nachrücker den Platz noch ablehnen? Solange er nicht zugesagt hat und nicht zugeteilt ist - ohne Zusage-Modus bis zum
    Start der Season."""
    carry = (application or {}).get("carry_over") or {}
    if not isinstance(carry.get("fills"), dict) or application.get("status") != "accepted" or application.get("assignment"):
        return False
    right = right_of(application)
    if right and right.get("status") == OFFERED:
        return not overdue(application, season, now)
    # Ohne Zusage-Modus - auch nach dem Umschalten auf „automatisch“ (``accepted_via: "mode"``): bis zum Start der Season.
    if right and right.get("accepted_via") != "mode":
        return False
    return not start_reached(season, now)


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
            # Die Frist ruht, solange der Endstand des Vorgängers geprüft wird - zusagen geht trotzdem.
            "paused": resting(application, season),
            # Startdatum erreicht und Frist vorbei: Es verfällt nicht mehr von selbst, die Leitung entscheidet.
            "waits_for_lead": waits_for_lead(application, season, now),
            # ``own_open``: Hinter dem Nachrück-Angebot wartet noch die eigene Zusage - ihre Frist ruht so lange; Ablehnen gilt als
            # Zusage für die eigene Liga, Schweigen lässt die Restfrist (mindestens ``rest_days``).
            "fills": ({"from_label": (fills.get("back") or {}).get("division_label"),
                       "own_open": ((fills.get("back") or {}).get("start_right") or {}).get("status") == OFFERED and needs_accept(season),
                       "rest_days": int((stored(season) or DEFAULTS)["rest_days"])} if fills else None),
            "can_accept": bool(can_act and current == OFFERED and not overdue(application, season, now)),
            "can_decline": bool(can_act and may_pass(application, season, now))}


def link_fields(application: dict | None, actor_id: str | None, now: str) -> dict:
    """Sonderweg „Co-Team zuteilen“: Teilt die Leitung ein Co-Team mit offenem Startrecht direkt zu, gilt das als Zusage durch die
    Leitung. Die Felder für denselben Schreibvorgang - leer, wenn es nichts zuzusagen gibt."""
    right = right_of(application)
    if not right or right.get("status") != OFFERED:
        return {}
    return {"carry_over.start_right.status": ACCEPTED, "carry_over.start_right.accepted_at": now,
            "carry_over.start_right.accepted_by": actor_id, "carry_over.start_right.accepted_via": "assignment"}
