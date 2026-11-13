"""Check-in vor Ort durch die Turnierleitung (#1161): die Liste für den Reiter „Check-in“ unter /tournaments/<slug>/leitung.

Eine Zeile je Anmeldung - bei Team-Turnieren je Team, mit Aufstellung (#1192) oder, ohne sie, den Mitgliedern samt
„Ich bin da“. Abgehakt wird über den einen Check-in-Weg ``POST /tournaments/{tid}/registrations/{rid}/checkin`` - Web und
App gleich. Diese Liste liest nur.

Startgeld (#319): je Zeile nur der Stand - ``open`` (Beleg offen), ``paid`` oder ``None`` (kostet nichts, im Event
enthalten, storniert). Beträge stehen nur für den Bereich „Finanzen“ dabei; die Turnierleitung braucht zum Abhaken nur
das Etikett. Keine Mail-Adressen, keine Dolibarr-Nummern, keine Notizen.
"""
from __future__ import annotations

from models import REGISTRATION_LIMIT
from services import team_lineup
from services.tournament_print import checkin_row

# Wer am Turniertag kommen soll. Warteliste, Absage, Austritt und Disqualifikation stehen nicht in der Liste.
BOARD_STATUSES = ("pending", "approved", "checked_in", "no_show")
PAID_STATES = ("paid", "paid_reduced")

_REG_FIELDS = {
    "_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1, "team_id": 1, "squad_id": 1, "seed": 1,
    "status": 1, "registration_type": 1, "lineup": 1, "substitutes": 1, "presence": 1, "checked_in_at": 1,
    "price_snapshot.total_cents": 1, "price_snapshot.currency": 1, "billing_status": 1, "invoice_status": 1,
    "payment_state": 1, "registered_via": 1, "created_at": 1,
}


def fee_state(registration: dict) -> str | None:
    """Startgeld der Anmeldung: ``open``, ``paid`` oder ``None`` (nichts zu zahlen)."""
    snapshot = registration.get("price_snapshot") or {}
    if int(snapshot.get("total_cents") or 0) <= 0 or registration.get("billing_status") == "cancelled":
        return None
    if registration.get("invoice_status") == "paid" or registration.get("payment_state") in PAID_STATES:
        return "paid"
    return "open"


def _members(registration: dict, team: dict | None, squad: dict | None, names: dict) -> tuple[list[dict], bool]:
    """Wer zur Team-Zeile gehört: die Aufgestellten samt Ersatz, sonst alle Mitglieder (Co-Team: dessen Mitglieder)."""
    present = registration.get("presence") or {}
    starters = list(registration.get("lineup") or [])
    if starters:
        substitutes = [uid for uid in registration.get("substitutes") or [] if uid not in starters]
        ordered = [(uid, "starter") for uid in starters] + [(uid, "substitute") for uid in substitutes]
        lineup_set = True
    else:
        source = (squad or {}).get("member_ids") if registration.get("squad_id") else (team or {}).get("member_ids")
        ordered = [(uid, "member") for uid in source or [] if uid]
        lineup_set = False
    leader = (team or {}).get("leader_id")
    return [{
        "id": uid, "name": names.get(uid, "Spieler"), "role": role, "leader": uid == leader, "present": uid in present,
    } for uid, role in ordered], lineup_set


def _sort_key(row: dict) -> tuple:
    seed = row.get("seed")
    return (row["name"].casefold(), seed is None, seed or 0)


async def checkin_board(db, tournament: dict, *, show_amounts: bool = False) -> dict:
    """Die Liste für den Reiter: Zeilen nach Name, Zähler „N von M da“ und die Zahl der offenen Startgelder."""
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"], "status": {"$in": list(BOARD_STATUSES)}}, _REG_FIELDS,
    ).to_list(REGISTRATION_LIMIT)
    team_mode = team_lineup.is_team_tournament(tournament)
    team_ids = sorted({row["team_id"] for row in registrations if row.get("team_id")})
    squad_ids = sorted({row["squad_id"] for row in registrations if row.get("squad_id")})
    teams = {row["id"]: row for row in await db.teams.find(
        {"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "member_ids": 1, "leader_id": 1},
    ).to_list(len(team_ids) + 1)} if team_ids else {}
    squads = {row["id"]: row for row in await db.team_squads.find(
        {"id": {"$in": squad_ids}}, {"_id": 0, "id": 1, "name": 1, "member_ids": 1},
    ).to_list(len(squad_ids) + 1)} if squad_ids else {}
    user_ids: set[str] = set()
    if team_mode:
        for row in registrations:
            user_ids.update(row.get("lineup") or [])
            user_ids.update(row.get("substitutes") or [])
            user_ids.update((teams.get(row.get("team_id")) or {}).get("member_ids") or [])
            user_ids.update((squads.get(row.get("squad_id")) or {}).get("member_ids") or [])
    user_ids.discard(None)
    names = {row["id"]: row.get("display_name") or row.get("username") or "Spieler" for row in await db.users.find(
        {"id": {"$in": sorted(user_ids)}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1},
    ).to_list(len(user_ids) + 1)} if user_ids else {}

    rows = []
    for registration in registrations:
        team = teams.get(registration.get("team_id"))
        row = checkin_row(registration, team)
        fee = fee_state(registration)
        row.update({
            "kind": "team" if team_mode and (team or registration.get("registration_type") == "team") else "solo",
            "checked_in_at": registration.get("checked_in_at") if row["checked_in"] else None,
            "fee": fee,
            "onsite": registration.get("registered_via") == "onsite",
        })
        if show_amounts and fee:
            row["fee_cents"] = int((registration.get("price_snapshot") or {}).get("total_cents") or 0)
            row["fee_currency"] = (registration.get("price_snapshot") or {}).get("currency") or "EUR"
        if row["kind"] == "team":
            members, lineup_set = _members(registration, team, squads.get(registration.get("squad_id")), names)
            row.update({
                "members": members, "lineup_set": lineup_set,
                "members_present": sum(1 for member in members if member["present"]),
            })
        rows.append(row)
    rows.sort(key=_sort_key)
    present = sum(1 for row in rows if row["checked_in"])
    return {
        "applies": True,
        "team_mode": team_mode,
        "rows": rows,
        "counts": {
            "total": len(rows),
            "present": present,
            "no_show": sum(1 for row in rows if row["status"] == "no_show"),
            "open": sum(1 for row in rows if row["status"] in ("pending", "approved")),
            "fee_open": sum(1 for row in rows if row["fee"] == "open"),
        },
    }
