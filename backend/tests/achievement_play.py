"""Turniere für die Erfolgs-Tests über die echten Wege spielen (#2337).

Der Audit vom 10.11.2026 fand Zähler, die jahrelang auf 0 standen, weil die Tests erfundene Felder anlegten
(``tournament_awards.place`` statt ``rank``). Darum entsteht hier alles so wie im Betrieb: Baum aus dem Format, Ergebnisse
über ``POST /api/matches/{id}/result``, kampflose Wertung über ``…/forfeit``, Abschluss und Veröffentlichung über
``POST /api/tournaments/{id}/status`` - das schreibt die Auszeichnungen mit ``record_tournament_awards``.
"""
from __future__ import annotations

DECIDED = {"completed", "forfeit"}


async def draw(flow, tournament: dict) -> None:
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)


async def cup(flow, count: int = 4, **fields) -> tuple[dict, dict, list[dict], list[dict]]:
    """Ein gestartetes Turnier mit ``count`` Teilnehmern (gesetzt 1..n) - (Leitung, Turnier, Personen, Anmeldungen)."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    await draw(flow, tournament)
    return staff, tournament, users, registrations


def sides(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]


async def decide(flow, staff: dict, match: dict, winner: str, *, score: tuple[int, int] | None = None) -> dict:
    """Ein Duell entscheiden - so, wie die Leitung es einträgt: nur Plätze, auf Wunsch mit Stand."""
    flow.act_as(staff)
    results = []
    for registration_id in sides(match):
        row = {"registration_id": registration_id, "rank": 1 if registration_id == winner else 2}
        if score:
            row["score"] = score[0] if registration_id == winner else score[1]
        results.append(row)
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": results})
    assert response.status_code == 200, response.text
    return await flow.reload(match)


async def rank(flow, staff: dict, match: dict, order: list[str]) -> dict:
    """Einen Lauf mit seiner Zielreihenfolge eintragen."""
    flow.act_as(staff)
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": registration_id, "rank": index} for index, registration_id in enumerate(order, start=1)]})
    assert response.status_code == 200, response.text
    return await flow.reload(match)


async def walkover(flow, staff: dict, match: dict, absent: str) -> dict:
    """Kampflos werten: ``absent`` ist nicht erschienen."""
    flow.act_as(staff)
    response = await flow.post(f"/api/matches/{match['id']}/forfeit",
                               json={"forfeit_registration_id": absent, "note": "Nicht erschienen"})
    assert response.status_code == 200, response.text
    return await flow.reload(match)


async def open_matches(flow, tournament: dict) -> list[dict]:
    """Spiele, die jetzt gespielt werden können: noch offen, alle Plätze belegt - in Spielreihenfolge."""
    rows = [match for match in await flow.matches(tournament)
            if match.get("status") not in DECIDED and match.get("status") != "cancelled" and not match.get("is_preview")
            and len(sides(match)) >= 2 and len(sides(match)) == len(match.get("slots") or [])]
    return sorted(rows, key=lambda match: (int(match.get("stage_number") or 0), int(match.get("round") or 0), int(match.get("order") or 0)))


async def play_out(flow, staff: dict, tournament: dict, favourites: list[str]) -> None:
    """Alle Duelle zu Ende spielen: es gewinnt, wer in ``favourites`` weiter vorn steht."""
    def strength(registration_id: str) -> int:
        return favourites.index(registration_id) if registration_id in favourites else len(favourites)

    for _guard in range(64):
        waiting = await open_matches(flow, tournament)
        if not waiting:
            return
        match = waiting[0]
        await decide(flow, staff, match, min(sides(match), key=strength))
    raise AssertionError("Das Turnier wird nicht fertig")


async def finish(flow, staff: dict, tournament: dict, *, publish: bool = True) -> None:
    """Abschließen und Ergebnisse veröffentlichen - der echte Weg schreibt Auszeichnungen, Punkte und Preise."""
    flow.act_as(staff)
    for status in ("completed", "results_published") if publish else ("completed",):
        response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": status})
        assert response.status_code == 200, response.text
        tournament["status"] = status


async def add_team(flow, name: str, leader: dict, members: list[dict], *, joined_at: str = "2026-01-01T00:00:00+00:00") -> dict:
    """Ein Team mit Leitung und Mitgliedern, wie die Team-Routen es speichern (``teams`` und ``team_members``)."""
    from flow_harness import new_id

    team = {"id": new_id(), "name": name, "tag": name[:4].upper(), "leader_id": leader["id"], "co_leader_ids": [],
            "member_ids": [leader["id"], *[member["id"] for member in members]], "created_by": leader["id"],
            "is_public": True, "created_at": joined_at}
    await flow.db.teams.insert_one(dict(team))
    await flow.db.team_members.insert_many(
        [{"team_id": team["id"], "user_id": leader["id"], "role": "leader", "joined_at": joined_at}]
        + [{"team_id": team["id"], "user_id": member["id"], "role": "member", "joined_at": joined_at} for member in members])
    return team


async def register_team(flow, tournament: dict, team: dict, *, by: dict | None, seed: int | None = None, **fields) -> dict:
    """Ein Team anmelden: ``by`` ist die Person, die anmeldet (in der Liga niemand)."""
    from flow_harness import new_id

    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": by["id"] if by else None, "team_id": team["id"],
                    "display_name": team["name"], "team_name": team["name"], "status": "approved", "seed": seed, **fields}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    return registration
