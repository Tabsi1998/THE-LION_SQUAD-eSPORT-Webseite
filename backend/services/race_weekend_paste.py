"""Terminliste einfügen mit Läufen (#1930): je Zeile die Läufe, die „Ablauf je Runde“ für ihre Runde vorgibt - mit
Uhrzeit-Versatz. Eigenes Modul, damit ``race_weekend`` (das ``models`` beim Prüfen nutzt) nicht vom Kalender abhängt.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from services.race_weekend import GENERIC_LABELS, by_code, label_key, session_config, take_code, weekend_groups
from services.reference_calendar import ClockError, clock_gap_message, vienna_start
from services.round_phases import phase_for


def _shifted(day: str, clock: str | None, offset: int) -> tuple[str, str | None]:
    """Tag und Uhrzeit eines Laufs mit Versatz. Ohne Uhrzeit zählen nur ganze Tage - in beide Richtungen zur Null hin,
    ein Versatz von −30 Minuten bleibt also am selben Tag."""
    if not offset:
        return day, clock
    if clock:
        wall = datetime.combine(date.fromisoformat(day), datetime.strptime(clock, "%H:%M").time())
        moved = wall + timedelta(minutes=offset)
        return moved.date().isoformat(), moved.strftime("%H:%M")
    return (date.fromisoformat(day) + timedelta(days=int(offset / (24 * 60)))).isoformat(), None


def _own_code(number: int, numbers: dict) -> str:
    """Ein Kürzel für eine Zeile ohne Kürzel, deren Läufe zusammenbleiben müssen: „R5“ - gibt es das schon, „Runde 5“,
    dann mit Buchstaben."""
    for candidate in (f"R{number}", f"Runde {number}", *(f"R{number}{letter}" for letter in "abcdefghij")):
        if "".join(candidate.split()).casefold() not in numbers:
            return candidate
    return f"Runde {number}"


def _plan_labels(row: dict, plan: list) -> list[str] | None:
    """Die Läufe, die eine Zeile ohne Lauf laut Ablauf anlegt - ``None`` für eine Zeile mit genau einem Lauf."""
    if row.get("session"):
        return None
    labels = [config["label"] for config in plan if config and config.get("label")]
    return labels if len(labels) > 1 else None


# Vorschläge für „jeden Lauf einzeln“ (#2007), kürzeste zuerst - nur Wörter, die ``take_code`` kennt.
SUGGESTIONS = ("Q", "S", "Rennen", "Shootout", *(f"Lauf {number}" for number in range(1, 10)))


def _resolved(weekend: dict | None, number: int, session: str) -> str:
    """Der Lauf, den eine Zeile mit Lauf ``session`` in Runde ``number`` anlegt (wie in ``expand_paste``)."""
    config = session_config(weekend, number, session)
    # Ein allgemeiner Name („R1 Feature“ → Rennen) nimmt den Lauf derselben Art aus der Vorgabe (etwa Hauptrennen);
    # ein eigener („R1 Shootout“, „R1 Lauf 2“) bleibt, wie er ist.
    own = label_key(config["label"]) == label_key(session)
    return config["label"] if config["label"] and (own or session in GENERIC_LABELS) else session


def suggestion(code: str, label: str, weekend: dict | None, number: int) -> str | None:
    """Die kürzeste Zeile „R1 Q“, die der Parser genau auf den Lauf ``label`` abbildet - sonst ``None``."""
    for word in SUGGESTIONS:
        parsed_code, session, rest = take_code(f"{code} {word}")
        if parsed_code == code and session and not rest.strip() and \
                label_key(_resolved(weekend, number, session)) == label_key(label):
            return f"{code} {word}"
    return None


def _joined(items: list[str]) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} und {items[-1]}"


def _duplicate_message(row: dict, label: str, source, plan: list, weekend: dict | None, number: int) -> str:
    """Meldung für einen doppelten Lauf (#2007): aus der Saison, oder aus derselben Liste - dann mit Zeile und Grund."""
    code = row.get("code")
    if source is None:
        return f"{code} {label} gibt es in dieser Saison schon."
    line, earlier = source
    text = f"{code} {label} steht schon in Zeile {line}" if line else f"{code} {label} steht schon weiter oben"
    labels = _plan_labels(row, plan) or earlier
    if not labels:
        return f"{text}."
    singles = [suggestion(code, item, weekend, number) for item in labels]
    reason = f"{text} – ‚{code}‘ legt laut Ablauf {_joined(labels)} an."
    if not all(singles):
        return f"{reason} Bitte nur ‚{code}‘ je Runde."
    shown = ", ".join(f"‚{item}‘" for item in singles)
    return f"{reason} Entweder nur ‚{code}‘ je Runde oder jeden Lauf einzeln ({shown})."


def expand_paste(parsed: dict, weekend: dict | None, rounds: list[dict]) -> dict:
    """Eine geprüfte Terminliste (``reference_calendar.parse_round_lines``) mit den Läufen je Zeile (``sessions``):
    eine Zeile mit Lauf („R1 Sprint“) legt genau diesen an, eine ohne Lauf alle Läufe der Vorgabe für ihre Runde - mit
    deren Uhrzeit-Versatz -, ohne Vorgabe einen Termin wie bisher. Eine Zeile ohne Kürzel mit mehreren Läufen bekommt
    eines („R5“), damit ihre Läufe eine Runde bleiben. Ein Lauf, den es in der Runde schon gibt (im Kalender oder weiter
    oben in der Liste), ist ein Fehler. ``count`` zählt die Termine."""
    if parsed.get("errors"):
        return {**parsed, "count": 0}
    merge = by_code(rounds, weekend) or any(row.get("session") for row in parsed.get("rows") or [])
    groups = weekend_groups(rounds, weekend, merge=merge)
    numbers = {group["key"]: group["number"] for group in groups if group["key"]}
    # Woher ein Lauf kommt (#2007): ``None`` aus der Saison, sonst (Zeile, Läufe laut Ablauf oder ``None``).
    taken = {(group["key"], label_key(rnd.get("session"))): None for group in groups if group["key"]
             for rnd in group["rounds"] if rnd.get("session")}
    upcoming = len(groups) + 1
    rows, errors = [], []
    for row in parsed.get("rows") or []:
        key = "".join(str(row.get("code") or "").split()).casefold() or None
        if merge and key and key in numbers:
            number = numbers[key]
        else:
            number, upcoming = upcoming, upcoming + 1
            if key and merge:
                numbers[key] = number
        if row.get("session"):
            config = session_config(weekend, number, row["session"])
            plan = [{**config, "label": _resolved(weekend, number, row["session"]), "offset": 0}]
        else:
            phase = phase_for((weekend or {}).get("formats"), number)
            # In zeitlicher Reihenfolge anlegen (nach Versatz) - so stimmt die Reihenfolge im Kalender.
            plan = sorted((phase or {}).get("sessions") or [None], key=lambda item: item["offset"] if item else 0)
        if not key and len(plan) > 1:
            row = {**row, "code": _own_code(number, numbers)}
            key = "".join(row["code"].split()).casefold()
            numbers[key] = number
        sessions, error = [], None
        for config in plan:
            label = config["label"] if config else None
            offset = config["offset"] if config else 0
            day, clock = _shifted(row["day"], row.get("time"), offset)
            try:
                starts_at = vienna_start(day, clock)
            except ClockError:
                error = clock_gap_message(day, clock)
                break
            if label and key:
                if (key, label_key(label)) in taken:
                    error = _duplicate_message(row, label, taken[(key, label_key(label))], plan, weekend, number)
                    break
                taken[(key, label_key(label))] = (row.get("line"), _plan_labels(row, plan))
            sessions.append({"session": label, "day": day, "time": clock, "starts_at": starts_at,
                             "counts": config["counts"] if config else True, "weekend": number})
        if error:
            errors.append({"line": row.get("line"), "text": row.get("text"), "message": error})
            continue
        rows.append({**row, "weekend": number, "sessions": sessions})
    if errors:
        return {"rows": [], "errors": errors, "count": 0}
    return {"rows": rows, "errors": [], "count": sum(len(row["sessions"]) for row in rows)}
