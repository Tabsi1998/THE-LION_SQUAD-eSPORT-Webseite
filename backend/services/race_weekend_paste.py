"""Terminliste einfügen mit Läufen (#1930): je Zeile die Läufe, die „Läufe je Runde“ für ihre Runde vorgibt - mit
Uhrzeit-Versatz. Eigenes Modul, damit ``race_weekend`` (das ``models`` beim Prüfen nutzt) nicht vom Kalender abhängt.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from services.race_weekend import label_key, session_config, weekend_groups
from services.reference_calendar import ClockError, clock_gap_message, vienna_start
from services.round_phases import phase_for


def _shifted(day: str, clock: str | None, offset: int) -> tuple[str, str | None]:
    if not offset:
        return day, clock
    if clock:
        wall = datetime.combine(date.fromisoformat(day), datetime.strptime(clock, "%H:%M").time())
        moved = wall + timedelta(minutes=offset)
        return moved.date().isoformat(), moved.strftime("%H:%M")
    return (date.fromisoformat(day) + timedelta(days=offset // (24 * 60))).isoformat(), None


def expand_paste(parsed: dict, weekend: dict | None, rounds: list[dict]) -> dict:
    """Eine geprüfte Terminliste (``reference_calendar.parse_round_lines``) mit den Läufen je Zeile (``sessions``):
    eine Zeile mit Lauf („R1 Sprint“) legt genau diesen an, eine ohne Lauf alle Läufe der Vorgabe für ihre Runde - mit
    deren Uhrzeit-Versatz -, ohne Vorgabe einen Termin wie bisher. Ein Lauf, den es in der Runde schon gibt (im Kalender
    oder weiter oben in der Liste), ist ein Fehler. ``count`` zählt die Termine."""
    if parsed.get("errors"):
        return {**parsed, "count": 0}
    groups = weekend_groups(rounds)
    numbers = {group["key"]: group["number"] for group in groups if group["key"]}
    taken = {(group["key"], label_key(rnd.get("session"))) for group in groups if group["key"]
             for rnd in group["rounds"] if rnd.get("session")}
    upcoming = len(groups) + 1
    rows, errors = [], []
    for row in parsed.get("rows") or []:
        key = "".join(str(row.get("code") or "").split()).casefold() or None
        if key and key in numbers:
            number = numbers[key]
        else:
            number, upcoming = upcoming, upcoming + 1
            if key:
                numbers[key] = number
        if row.get("session"):
            config = session_config(weekend, number, row["session"])
            plan = [{**config, "label": config["label"] or row["session"], "offset": 0}]
        else:
            phase = phase_for((weekend or {}).get("formats"), number)
            # In zeitlicher Reihenfolge anlegen (nach Versatz) - so stimmt die Reihenfolge im Kalender.
            plan = sorted((phase or {}).get("sessions") or [None], key=lambda item: item["offset"] if item else 0)
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
                    error = f"{row.get('code')} {label} gibt es schon."
                    break
                taken.add((key, label_key(label)))
            sessions.append({"session": label, "day": day, "time": clock, "starts_at": starts_at,
                             "counts": config["counts"] if config else True, "weekend": number})
        if error:
            errors.append({"line": row.get("line"), "text": row.get("text"), "message": error})
            continue
        rows.append({**row, "weekend": number, "sessions": sessions})
    if errors:
        return {"rows": [], "errors": errors, "count": 0}
    return {"rows": rows, "errors": [], "count": sum(len(row["sessions"]) for row in rows)}
