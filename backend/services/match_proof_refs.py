"""Bezug eines Nachweises (#2360): zu welcher Meldung, welchem Vorfall oder welchem Verfahren er gehört - und ob der noch offen ist.

Blatt-Modul ohne Datenbank: liest nur das Spiel. Die Felder stehen im Vertrag (docs/LIGA.md, „D.5/E.2-Vertrag“):
``incidents[]`` baut D.5, die Verfahren in ``disputes[]`` (mit ``id`` und ``kind``) baut E.2. Ein MOSS-Nachweis hängt an
einem Verfahren oder an einem Vorfall. Einträge ohne ``id`` sind
Altbestand („Problem melden“) und lassen sich nicht als Bezug ansprechen, zählen aber als offenes Verfahren am Spiel.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

KINDS = ("report", "incident", "protest", "statement", "moss")
# Altbestand: „Problem melden“ hängte sein Foto mit ``dispute`` an - es zählt wie ein Nachweis zum Protest.
LEGACY_KINDS = {"dispute": "protest"}
PROCEDURE_KINDS = frozenset({"protest", "statement", "moss"})
DECIDED_STATUSES = frozenset({"completed", "forfeit"})
CLOSED_STATUSES = frozenset({"cancelled", "archived", "bye"})
CLOSED_INCIDENT_STATES = frozenset({"agreed", "decided", "withdrawn"})


@dataclass(frozen=True)
class Ref:
    found: bool
    open: bool = False
    side: str | None = None                # die Seite, die gemeldet bzw. eingereicht hat
    evidence_until: datetime | None = None  # bis wann diese Seite nachreichen darf
    statement_until: datetime | None = None  # bis wann die Gegenseite Stellung nimmt
    hold_until: datetime | None = None      # beendet: Ende der Einspruchsfrist
    incident: bool = False                  # MOSS an einem Vorfall: zusätzlich gilt die Protestfrist des Spiels
    ended_at: datetime | None = None        # … und wann der Vorfall endete, soweit bekannt


MISSING = Ref(found=False)


def parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def kind_of(doc: dict) -> str | None:
    """Der Bezug eines gespeicherten Nachweises - Altbestand auf die heutigen Namen abgebildet."""
    kind = (doc.get("context") or {}).get("kind")
    return LEGACY_KINDS.get(kind, kind)


def _rows(match: dict, key: str) -> list[dict]:
    return [row for row in match.get(key) or [] if isinstance(row, dict)]


def _ended_at(entry: dict) -> datetime | None:
    return parse(entry.get("resolved_at")) or parse(entry.get("withdrawn_at"))


def _hold_until(entry: dict, appeal_hours: int) -> datetime | None:
    """Bis wann ein beendetes Verfahren noch angefochten werden kann - ``None``, solange es offen ist."""
    ended = _ended_at(entry)
    if ended is None:
        return None
    return parse(entry.get("appeal_until")) or ended + timedelta(hours=appeal_hours)


def _chain(match: dict, entry: dict) -> list[dict]:
    """Das Verfahren und die Einsprüche gegen seine Entscheidung."""
    if not entry.get("id"):
        return [entry]
    appeals = [row for row in _rows(match, "disputes")
               if row.get("kind") == "appeal" and (row.get("against") or {}).get("ref_id") == entry["id"]]
    return [entry, *appeals]


def _chain_state(match: dict, entry: dict, appeal_hours: int) -> tuple[bool, datetime | None]:
    chain = _chain(match, entry)
    if any(_ended_at(row) is None for row in chain):
        return True, None
    return False, max(_hold_until(row, appeal_hours) for row in chain)


def _incident_open(entry: dict) -> bool:
    return str(entry.get("state") or "proposed") not in CLOSED_INCIDENT_STATES


def _incident_ended_at(entry: dict) -> datetime | None:
    return (parse(entry.get("closed_at")) or parse((entry.get("decision") or {}).get("at"))
            or parse((entry.get("answer") or {}).get("at")))


def _incident_chain_state(match: dict, incident: dict, appeal_hours: int) -> tuple[bool, datetime | None]:
    """Der Vorfall und die Verfahren, die aus ihm folgen (``disputes[].incident_id``), samt Einsprüchen: offen, solange eines
    davon offen ist - sonst das späteste Ende plus Einspruchsfrist. ``None`` als Zeit: beendet, aber ohne Zeitpunkt."""
    states = [_chain_state(match, row, appeal_hours) for row in _rows(match, "disputes")
              if incident.get("id") and row.get("incident_id") == incident["id"]]
    if _incident_open(incident) or any(still_open for still_open, _ in states):
        return True, None
    ended = _incident_ended_at(incident)
    holds = [hold for _, hold in states if hold] + ([ended + timedelta(hours=appeal_hours)] if ended else [])
    return False, max(holds) if holds else None


def resolve(match: dict, kind: str, ref_id: str, *, appeal_hours: int) -> Ref:
    """Den Bezug am Spiel finden. ``report`` gibt es immer; alles andere braucht die Kennung eines Vorfalls oder Verfahrens."""
    if kind == "report":
        return Ref(found=True, open=str(match.get("status") or "") not in DECIDED_STATUSES | CLOSED_STATUSES)
    if not ref_id:
        return MISSING
    if kind == "incident":
        entry = next((row for row in _rows(match, "incidents") if row.get("id") == ref_id), None)
        if entry is None:
            return MISSING
        return Ref(found=True, open=_incident_open(entry), side=(entry.get("reported_by") or {}).get("registration_id"))
    if kind not in PROCEDURE_KINDS:
        return MISSING
    entry = next((row for row in _rows(match, "disputes") if row.get("id") == ref_id), None)
    if entry is None and kind == "moss":
        # MOSS darf auch an einem Vorfall hängen - etwa der Screenshot vom Absturz (§ 9a.6) zu ``moss_crash``.
        incident = next((row for row in _rows(match, "incidents") if row.get("id") == ref_id), None)
        if incident is None:
            return MISSING
        still_open, hold = _incident_chain_state(match, incident, appeal_hours)
        return Ref(found=True, open=still_open, hold_until=hold, incident=True, ended_at=_incident_ended_at(incident))
    if entry is None:
        return MISSING
    still_open, hold = _chain_state(match, entry, appeal_hours)
    return Ref(found=True, open=still_open, side=entry.get("registration_id"), evidence_until=parse(entry.get("evidence_until")),
               statement_until=parse((entry.get("statement") or {}).get("due_at")), hold_until=hold)


def match_hold(match: dict, now: datetime, *, appeal_hours: int) -> bool:
    """Läuft an diesem Spiel noch etwas, für das die Nachweise gebraucht werden: ein offener Vorfall, ein offenes Verfahren
    (auch Altbestand) oder eine Einspruchsfrist?"""
    if str(match.get("status") or "") == "disputed":
        return True
    if any(_incident_open(row) for row in _rows(match, "incidents")):
        return True
    for entry in _rows(match, "disputes"):
        hold = _hold_until(entry, appeal_hours)
        if hold is None or now < hold:
            return True
    return False
