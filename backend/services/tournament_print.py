"""Druckansicht (#1283): die Check-in-Liste eines Turniers zum Abhaken auf Papier.

Plan B für den Eventtag: fällt Netz oder Server aus, hakt die Turnierleitung auf dem Ausdruck vom Vorabend ab. Die
Liste trägt nur, was dafür nötig ist - Name, Team, Setzplatz und Stand (angemeldet, da, Warteliste). Keine Mail-
Adressen, keine Notizen, keine Konten-Kennungen. Wer sie abrufen darf, prüft die Route (Check-in-Recht im Turnier).
"""

# Wer am Turniertag kommen soll - in dieser Reihenfolge stehen sie auf dem Blatt; die Warteliste folgt darunter.
EXPECTED_STATUSES = ("checked_in", "approved", "pending", "no_show")
WAITLIST_STATUS = "waitlist"
LIST_LIMIT = 2000


def _name(registration: dict, team: dict | None) -> str:
    if team and team.get("name"):
        return str(team["name"])
    name = registration.get("display_name") or registration.get("ingame_name") or registration.get("team_name")
    return str(name or "Teilnehmer")


def _seed(registration: dict) -> int | None:
    try:
        value = int(registration.get("seed"))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def checkin_row(registration: dict, team: dict | None = None) -> dict:
    """Eine Zeile der Liste - nur Anzeigefelder."""
    ingame = str(registration.get("ingame_name") or "").strip()
    name = _name(registration, team)
    return {
        "id": registration.get("id"),
        "name": name,
        # Der Spielname nur, wenn er etwas anderes sagt als der Name (sonst steht dasselbe zweimal da).
        "ingame_name": ingame if ingame and ingame.lower() != name.lower() else "",
        "team_tag": str((team or {}).get("tag") or ""),
        "member_count": len((team or {}).get("member_ids") or []) if team else 0,
        "seed": _seed(registration),
        "status": registration.get("status"),
        "checked_in": registration.get("status") == "checked_in",
    }


def _sort_key(row: dict) -> tuple:
    seed = row.get("seed")
    return (seed is None, seed or 0, row["name"].casefold())


async def checkin_list(db, tournament: dict) -> dict:
    """Erwartete Teilnehmende (nach Setzplatz, sonst Name) und die Warteliste (in der Reihenfolge der Anmeldung)."""
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament["id"], "status": {"$in": [*EXPECTED_STATUSES, WAITLIST_STATUS]}},
        {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1, "team_id": 1, "seed": 1, "status": 1,
         "created_at": 1},
    ).to_list(LIST_LIMIT)
    team_ids = sorted({row["team_id"] for row in registrations if row.get("team_id")})
    teams = {
        row["id"]: row for row in await db.teams.find(
            {"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1, "tag": 1, "member_ids": 1},
        ).to_list(len(team_ids) + 1)
    } if team_ids else {}
    expected, waitlist = [], []
    for registration in registrations:
        row = checkin_row(registration, teams.get(registration.get("team_id")))
        if registration.get("status") == WAITLIST_STATUS:
            waitlist.append((str(registration.get("created_at") or ""), row))
        else:
            expected.append(row)
    expected.sort(key=_sort_key)
    return {
        "tournament": {"id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title"),
                       "team_mode": tournament.get("team_mode")},
        "expected": expected,
        "waitlist": [row for _, row in sorted(waitlist, key=lambda pair: pair[0])],
        "counts": {"expected": len(expected), "checked_in": sum(1 for row in expected if row["checked_in"]),
                   "waitlist": len(waitlist)},
    }
