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


async def cup_for(flow, players: list[dict], **fields) -> tuple[dict, dict, list[dict]]:
    """Ein gestartetes Turnier für genau diese Personen, gesetzt in ihrer Reihenfolge - (Leitung, Turnier, Anmeldungen)."""
    staff = await flow.add_staff()
    tournament = await flow.create_tournament(max_participants=len(players), **fields)
    registrations = [await flow.register(tournament, player, seed=seed) for seed, player in enumerate(players, start=1)]
    flow.act_as(staff)
    await draw(flow, tournament)
    return staff, tournament, registrations


async def played_cup(flow, players: list[dict], *, publish: bool = True, **fields) -> tuple[dict, list[dict]]:
    """Ein ganzes K.-o.-Turnier: Es gewinnt jeweils, wer in ``players`` weiter vorn steht; danach abgeschlossen und
    (auf Wunsch) veröffentlicht. Zurück kommen Turnier und Anmeldungen."""
    staff, tournament, registrations = await cup_for(flow, players, **fields)
    await play_out(flow, staff, tournament, [registration["id"] for registration in registrations])
    await finish(flow, staff, tournament, publish=publish)
    return tournament, registrations


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


async def backdate(flow, match: dict, *, minutes: int) -> str:
    """Ein gespieltes Spiel in die Vergangenheit legen. Die Wege schreiben „jetzt“ - soll danach etwas „später“
    geschehen (Beitritt, Austritt), fallen zwei „jetzt“ sonst gelegentlich auf denselben Augenblick."""
    from datetime import timedelta

    from models import now_utc

    stamp = (now_utc() - timedelta(minutes=minutes)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"completed_at": stamp, "updated_at": stamp}})
    return stamp


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


async def team_cup(flow, *, tournament_fields: dict | None = None, **registration_fields):
    """Team „Lions“ (Leitung, Mitglied, Ersatz) als Nummer 1 gegen drei Einzelspieler - angemeldet hat die Leitung.
    Zurück: Leitung des Turniers, Turnier, Team, Team-Anmeldung, (Leitung, Mitglied, Ersatz), Anmeldungen der Rivalen."""
    staff = await flow.add_staff()
    lead, member, bench = [await flow.add_user(name=name) for name in ("Leitung", "Mitglied", "Ersatz")]
    team = await add_team(flow, "Lions", lead, [member, bench])
    tournament = await flow.create_tournament(max_participants=4, **(tournament_fields or {}))
    registration = await register_team(flow, tournament, team, by=lead, seed=1, **registration_fields)
    rivals = [await flow.add_user(name=f"Rivale {n}") for n in (1, 2, 3)]
    rival_regs = [await flow.register(tournament, rival, seed=seed) for seed, rival in enumerate(rivals, start=2)]
    flow.act_as(staff)
    await draw(flow, tournament)
    return staff, tournament, team, registration, (lead, member, bench), rival_regs


async def record_squad_members(flow, staffel: dict, squad_id: str, people: list[dict], *, via: str = "assign",
                               at: str | None = None) -> None:
    """Personen in den Liga-Kader der Season aufnehmen - über ``league_roster.record_members``, den Weg, den Zuteilen,
    Aufnahme ins Co-Team und Transfer nehmen (schreibt ``league_rosters.squad_ids`` und ``squad_joined_at``). ``at``
    stellt den Zeitpunkt der Aufnahme fest ein: Der Weg schreibt „jetzt“, und zwei „jetzt“ in einem Test können auf
    denselben Augenblick fallen."""
    from services import league_roster

    ids = [person["id"] for person in people]
    ctx = await league_roster.context_for_tournament(flow.db, staffel, ids)
    await league_roster.record_members(flow.db, ctx, ids, via=via, actor_id="liga-leitung", squad_id=squad_id)
    if at:
        season_id = staffel["league_context"]["season_id"]
        await flow.db.league_rosters.update_many({"season_id": season_id, "user_id": {"$in": ids}},
                                                 {"$set": {f"squad_joined_at.{squad_id}": at}})


async def squad_match(flow, *, leader: dict, squad_members: list[dict], others: list[dict], away: dict,
                      status: str = "live", liga_kader: bool = True) -> tuple[dict, dict, dict, dict]:
    """Eine Liga-Staffel, in der ein Co-Team spielt - das Spiel (Heim gewinnt) trägt keine Teilnehmerliste, wie nach
    einer kampflosen Wertung. ``others`` sind im Hauptteam, aber nicht im Kader des Co-Teams. Die Season kennt „ein Team
    je Season“ - damit führt sie den Liga-Kader auch ohne Pflicht-ID des Spiels. Zugeteilt wurde zum Jahresbeginn.
    ``liga_kader=False``: eine Season ohne Pflicht-IDs, Wartezeit und „ein Team je Season“ - dort schreibt derselbe Weg
    keinen Liga-Kader (``league_rosters`` bleibt leer).
    Zurück: Hauptteam, Co-Team, Heim-Anmeldung, Spiel; die Staffel steht in ``match["tournament_id"]``."""
    from flow_harness import new_id
    from models import now_utc

    team = await add_team(flow, "Heim", leader, [*squad_members, *others])
    squad = {"id": new_id(), "team_id": team["id"], "name": "Heim II", "member_ids": [person["id"] for person in squad_members],
             "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}
    await flow.db.team_squads.insert_one(dict(squad))
    guests = await add_team(flow, "Gast", away, [])
    season_id = new_id()
    await flow.db.league_seasons.insert_one({"id": season_id, "league_id": "l1", "name": "Season 1", "status": "active",
                                              "one_team_per_season": liga_kader})
    staffel = await flow.create_tournament(format="league", status=status, team_mode="team",
                                           league_context={"league_id": "l1", "season_id": season_id, "staffel": "A"})
    home_reg = await register_team(flow, staffel, team, by=None, squad_id=squad["id"])
    away_reg = await register_team(flow, staffel, guests, by=None)
    await record_squad_members(flow, staffel, squad["id"], squad_members, at="2026-01-01T00:00:00+00:00")
    stamp = now_utc().isoformat()
    match = {
        "id": new_id(), "tournament_id": staffel["id"], "stage_number": 1, "round": 1, "order": 1, "status": "completed",
        "completed_at": stamp, "updated_at": stamp, "match_type": "duel",
        "slots": [{"slot": 1, "registration_id": home_reg["id"], "status": "filled"}, {"slot": 2, "registration_id": away_reg["id"], "status": "filled"}],
        "results": [{"registration_id": home_reg["id"], "rank": 1}, {"registration_id": away_reg["id"], "rank": 2}],
    }
    await flow.db.matches_v2.insert_one(dict(match))
    return team, squad, home_reg, match


async def league_match(flow, *, home_lineup: list[dict], home_bench: list[dict], away: dict, status: str = "live") -> tuple[dict, dict, dict]:
    """Eine Liga-Staffel mit einem gespielten Spiel (Heim gewinnt 3:1): Teams ohne anmeldende Person, die Teilnehmerliste
    steht am Spiel (``lineups``, ``lineup_user_ids``) - so, wie ``services.league_games`` sie speichert.
    Zurück: Staffel, Heim-Anmeldung, Gast-Anmeldung."""
    from flow_harness import new_id
    from models import now_utc

    home = await add_team(flow, "Heim", home_lineup[0], [*home_lineup[1:], *home_bench])
    guests = await add_team(flow, "Gast", away, [])
    staffel = await flow.create_tournament(format="league", status=status,
                                           league_context={"league_id": "l1", "season_id": "s1", "staffel": "A"})
    home_reg = await register_team(flow, staffel, home, by=None)
    away_reg = await register_team(flow, staffel, guests, by=None)
    lineups = {home_reg["id"]: [person["id"] for person in home_lineup], away_reg["id"]: [away["id"]]}
    stamp = now_utc().isoformat()
    await flow.db.matches_v2.insert_one({
        "id": new_id(), "tournament_id": staffel["id"], "stage_number": 1, "round": 1, "order": 1, "status": "completed",
        "completed_at": stamp, "updated_at": stamp, "match_type": "duel",
        "slots": [{"slot": 1, "registration_id": home_reg["id"], "status": "filled"}, {"slot": 2, "registration_id": away_reg["id"], "status": "filled"}],
        "results": [{"registration_id": home_reg["id"], "rank": 1, "score": 3}, {"registration_id": away_reg["id"], "rank": 2, "score": 1}],
        "lineups": lineups, "lineup_user_ids": sorted({user for lineup in lineups.values() for user in lineup}),
    })
    return staffel, home_reg, away_reg
