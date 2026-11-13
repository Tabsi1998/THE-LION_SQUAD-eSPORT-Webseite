"""Reiter „Check-in“ der Turnierleitung (#1161): die Liste zum Abhaken am Handy.

Geprüft über die echte Route ``GET /api/tournaments/{tid}/lead/checkin``:
- Rechte wie der Check-in-Weg: Organisation, Schiedsrichter, Ergebnisdienst, Stationsleitung und die Turnierleitung -
  Gäste, Spieler, Streamer und Helfer anderer Turniere nicht. ``can_check_in`` in der Leitungs-Ansicht sagt dasselbe.
- Startgeld je Zeile nur als Stand (offen, bezahlt, nichts); Beträge nur für den Bereich Finanzen.
- Team-Turnier: eine Zeile je Team, mit Aufstellung oder allen Mitgliedern samt „Ich bin da“.
- Abgehakt wird über den bestehenden Check-in-Weg; die Liste zeigt den neuen Stand. Staffeln haben keinen Check-in.
Namen sind erfunden.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def assign(flow, tournament, role):
    helper = await flow.add_user(name=f"helfer-{role}")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": role, "is_active": True})
    return helper


async def solo_setup(flow):
    tournament = await flow.create_tournament(title="LAN-Cup", event_mode="local", status="check_in", max_participants=16)
    people, regs = {}, {}
    for name, status in [("Zora", "approved"), ("Anton", "checked_in"), ("Berta", "approved"), ("Carl", "no_show"),
                         ("Dora", "pending"), ("Wanda", "waitlist"), ("Rudi", "rejected"), ("Xaver", "withdrawn")]:
        people[name] = await flow.add_user(name=name)
        regs[name] = await flow.register(tournament, people[name], status=status)
    fees = {
        "Zora": {"price_snapshot": {"total_cents": 1500, "currency": "EUR"}, "billing_status": "pending"},
        "Anton": {"price_snapshot": {"total_cents": 1500, "currency": "EUR"}, "billing_status": "invoiced",
                  "payment_state": "paid"},
        "Berta": {"price_snapshot": {"total_cents": 1500, "currency": "EUR"}, "billing_status": "invoiced",
                  "invoice_status": "validated", "payment_state": "partial"},
        "Dora": {"price_snapshot": {"total_cents": 1500, "currency": "EUR"}, "billing_status": "cancelled"},
    }
    for name, fields in fees.items():
        await flow.db.tournament_registrations.update_one({"id": regs[name]["id"]}, {"$set": fields})
    return tournament, people, regs


@pytest.mark.asyncio
async def test_rights_like_the_checkin_route(flow):
    tournament, people, _regs = await solo_setup(flow)
    url = f"/api/tournaments/{tournament['slug']}/lead/checkin"
    lead_url = f"/api/tournaments/{tournament['slug']}/lead"

    flow.act_as(None)
    response = await flow.get(url)
    assert response.status_code == 401
    flow.act_as(people["Anton"])
    response = await flow.get(url)
    assert response.status_code == 403
    streamer = await assign(flow, tournament, "stream_operator")
    flow.act_as(streamer)
    response = await flow.get(url)
    assert response.status_code == 403
    lead = await flow.get(lead_url)
    assert lead.status_code == 200, lead.text
    assert lead.json()["tournament"]["can_check_in"] is False, "Streamer lesen die Leitung, checken aber nicht ein"
    other = await flow.create_tournament(title="Anderes Turnier")
    flow.act_as(await assign(flow, other, "referee"))
    response = await flow.get(url)
    assert response.status_code == 403

    for role in ("organizer", "referee", "scorekeeper", "station_manager"):
        flow.act_as(await assign(flow, tournament, role))
        response = await flow.get(url)
        assert response.status_code == 200, (role, response.text)
        assert response.headers["cache-control"] == "private, no-store"
        lead = await flow.get(lead_url)
        assert lead.json()["tournament"]["can_check_in"] is True, role
        assert lead.json()["tournament"]["self_checkin"] is False, "vor Ort checkt nur die Leitung ein"
    flow.act_as(await flow.add_staff())
    response = await flow.get(url)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_list_with_fee_state_and_counts(flow):
    tournament, _people, _regs = await solo_setup(flow)
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    response = await flow.get(f"/api/tournaments/{tournament['id']}/lead/checkin")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applies"] is True and body["team_mode"] is False
    assert body["tournament"]["event_mode"] == "local" and body["tournament"]["self_checkin"] is False

    rows = {row["name"]: row for row in body["rows"]}
    assert list(rows) == ["Anton", "Berta", "Carl", "Dora", "Zora"], "Warteliste, Absage und Austritt fehlen"
    assert {name: row["fee"] for name, row in rows.items()} == {
        "Anton": "paid", "Berta": "open", "Carl": None, "Dora": None, "Zora": "open"}
    assert body["counts"] == {"total": 5, "present": 1, "no_show": 1, "open": 3, "fee_open": 2}
    assert all(row["kind"] == "solo" for row in body["rows"])
    # Die Turnierleitung sieht den Stand, keinen Betrag - und keine Mail-Adressen.
    assert "fee_cents" not in response.text and "1500" not in response.text and "@" not in response.text

    flow.act_as(await flow.add_user(role="club_admin", name="Kassa"))
    finance = (await flow.get(f"/api/tournaments/{tournament['id']}/lead/checkin")).json()
    amounts = {row["name"]: row.get("fee_cents") for row in finance["rows"]}
    assert amounts == {"Anton": 1500, "Berta": 1500, "Carl": None, "Dora": None, "Zora": 1500}


@pytest.mark.asyncio
async def test_checkin_route_moves_the_counter(flow):
    tournament, _people, regs = await solo_setup(flow)
    flow.act_as(await assign(flow, tournament, "scorekeeper"))
    url = f"/api/tournaments/{tournament['id']}/lead/checkin"
    done = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{regs['Zora']['id']}/checkin",
                           json={"status": "checked_in"})
    assert done.status_code == 200, done.text
    body = (await flow.get(url)).json()
    zora = next(row for row in body["rows"] if row["name"] == "Zora")
    assert zora["checked_in"] is True and zora["checked_in_at"]
    assert body["counts"]["present"] == 2

    undone = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{regs['Zora']['id']}/checkin",
                             json={"status": "approved"})
    assert undone.status_code == 200, undone.text
    body = (await flow.get(url)).json()
    zora = next(row for row in body["rows"] if row["name"] == "Zora")
    assert zora["checked_in"] is False and zora["checked_in_at"] is None
    assert body["counts"]["present"] == 1


@pytest.mark.asyncio
async def test_team_row_with_members_or_lineup(flow):
    tournament = await flow.create_tournament(title="Team-Cup", event_mode="hybrid", team_mode="team", team_size=5,
                                              status="check_in")
    big = [await flow.add_user(name=f"Mitglied {index:02d}") for index in range(10)]
    small = [await flow.add_user(name=name) for name in ("Ada", "Bo", "Cy")]
    teams = {}
    for name, tag, members in [("Löwen mit einem sehr langen Teamnamen für die Turnierleitung", "LSW", big),
                               ("Falken", "FLK", small)]:
        team = {"id": new_id(), "name": name, "tag": tag, "leader_id": members[0]["id"],
                "member_ids": [member["id"] for member in members]}
        await flow.db.teams.insert_one(dict(team))
        teams[tag] = team
    lions = {"id": new_id(), "tournament_id": tournament["id"], "team_id": teams["LSW"]["id"], "registration_type": "team",
             "display_name": teams["LSW"]["name"], "status": "approved",
             "presence": {big[0]["id"]: "2026-11-14T17:00:00+00:00", big[3]["id"]: "2026-11-14T17:05:00+00:00"}}
    falcons = {"id": new_id(), "tournament_id": tournament["id"], "team_id": teams["FLK"]["id"], "registration_type": "team",
               "display_name": "Falken", "status": "checked_in",
               "lineup": [small[0]["id"], small[1]["id"]], "substitutes": [small[2]["id"]],
               "presence": {small[1]["id"]: "2026-11-14T17:00:00+00:00"}}
    await flow.db.tournament_registrations.insert_many([dict(lions), dict(falcons)])

    flow.act_as(await assign(flow, tournament, "organizer"))
    body = (await flow.get(f"/api/tournaments/{tournament['id']}/lead/checkin")).json()
    assert body["team_mode"] is True and body["tournament"]["self_checkin"] is True
    rows = {row["team_tag"]: row for row in body["rows"]}
    assert len(body["rows"]) == 2, "eine Zeile je Team"

    lsw = rows["LSW"]
    assert lsw["kind"] == "team" and lsw["name"] == teams["LSW"]["name"]
    assert lsw["lineup_set"] is False and len(lsw["members"]) == 10
    assert {member["role"] for member in lsw["members"]} == {"member"}
    assert lsw["members_present"] == 2
    assert [member["leader"] for member in lsw["members"]].count(True) == 1

    flk = rows["FLK"]
    assert flk["lineup_set"] is True and flk["checked_in"] is True
    assert [(member["name"], member["role"], member["present"]) for member in flk["members"]] == [
        ("Ada", "starter", False), ("Bo", "starter", True), ("Cy", "substitute", False)]
    assert body["counts"]["present"] == 1 and body["counts"]["total"] == 2


@pytest.mark.asyncio
async def test_staffel_has_no_checkin_list(flow):
    tournament = await flow.create_tournament(title="Staffel A", league_context={"league_id": "liga-1", "season_id": "s1"})
    flow.act_as(await flow.add_user(role="superadmin", name="Chefin"))
    body = (await flow.get(f"/api/tournaments/{tournament['id']}/lead/checkin")).json()
    assert body["applies"] is False and body["rows"] == []
    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    assert lead["tournament"]["can_check_in"] is False


# Startgeld-Etikett (#1161, Review M1): nur, was wirklich offen ist. Jeder Stand ein Fall.
PRICED = {"price_snapshot": {"total_cents": 1500, "currency": "EUR"}}


@pytest.mark.parametrize("fields, expected", [
    ({"billing_status": "pending"}, "open"),
    ({"billing_status": "invoiced", "invoice_status": "validated", "payment_state": "partial"}, "open"),
    ({"billing_status": "invoiced", "payment_state": "paid"}, "paid"),
    ({"billing_status": "invoiced", "payment_state": "paid_reduced"}, "paid"),
    ({"billing_status": "invoiced", "payment_state": "overpaid"}, "paid"),
    ({"billing_status": "paid"}, "paid"),
    ({"billing_status": "invoiced", "invoice_status": "paid"}, "paid"),
    ({"billing_status": "invoiced", "payment_state": "credited"}, None),
    ({"billing_status": "invoiced", "payment_state": "abandoned"}, None),
    ({"billing_status": "cancelled"}, None),
])
def test_fee_state_only_marks_what_is_open(fields, expected):
    from services.tournament_checkin_board import fee_state

    assert fee_state({**PRICED, **fields}) == expected
    assert fee_state(fields) is None, "ohne Preis nie ein Etikett"


@pytest.mark.asyncio
async def test_credited_and_abandoned_do_not_count_as_open(flow):
    tournament = await flow.create_tournament(title="Kassa-Cup", event_mode="local", status="check_in", max_participants=8)
    for name, state in [("Gerda", "credited"), ("Hugo", "abandoned"), ("Ida", "overpaid"), ("Jan", "partial")]:
        reg = await flow.register(tournament, await flow.add_user(name=name))
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {
            **PRICED, "billing_status": "invoiced", "payment_state": state}})
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    body = (await flow.get(f"/api/tournaments/{tournament['id']}/lead/checkin")).json()
    assert {row["name"]: row["fee"] for row in body["rows"]} == {"Gerda": None, "Hugo": None, "Ida": "paid", "Jan": "open"}
    assert body["counts"]["fee_open"] == 1


async def full_with_waitlist(flow, *, limit=4):
    """Voll (limit/limit) plus eine Person auf der Warteliste - im Check-in, der Baum ist noch Vorschau."""
    tournament = await flow.create_tournament(title="Voll-Cup", event_mode="local", status="check_in", max_participants=limit)
    regs = [await flow.register(tournament, await flow.add_user(name=f"Spieler {index}")) for index in range(limit)]
    waiting = await flow.register(tournament, await flow.add_user(name="Wartende Wilma"), status="waitlist")
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    return tournament, regs, waiting


@pytest.mark.asyncio
async def test_back_from_no_show_needs_a_free_place(flow):
    """Review M2: „Nicht erschienen“, jemand rückt nach, dann „Rückgängig“ - das wäre überbucht."""
    tournament, regs, waiting = await full_with_waitlist(flow)
    base = f"/api/tournaments/{tournament['id']}/registrations"
    marked = await flow.post(f"{base}/{regs[0]['id']}/checkin", json={"status": "no_show"})
    assert marked.status_code == 200, marked.text
    assert marked.json()["waitlist_moved_up"] == [waiting["id"]]
    assert marked.json()["waitlist_moved_up_names"] == ["Wartende Wilma"], "die Meldung nennt den Namen (#1941)"

    for status in ("approved", "checked_in"):
        back = await flow.post(f"{base}/{regs[0]['id']}/checkin", json={"status": status})
        assert back.status_code == 409, (status, back.text)
        assert back.json()["detail"] == "Inzwischen ist Wartende Wilma nachgerückt – kein freier Platz mehr. In der Verwaltung entscheiden."
    # Derselbe Weg über die Verwaltung (Status-Auswahl) hat dieselbe Grenze.
    patched = await flow.patch(f"{base}/{regs[0]['id']}", json={"status": "approved"})
    assert patched.status_code == 409, patched.text
    stored = await flow.db.tournament_registrations.find_one({"id": regs[0]["id"]}, {"_id": 0, "status": 1})
    assert stored["status"] == "no_show"
    active = await flow.db.tournament_registrations.count_documents(
        {"tournament_id": tournament["id"], "status": {"$in": ["pending", "approved", "checked_in"]}})
    assert active == 4

    # Wird wieder ein Platz frei, geht die Rückkehr.
    await flow.post(f"{base}/{regs[1]['id']}/checkin", json={"status": "no_show"})
    back = await flow.post(f"{base}/{regs[0]['id']}/checkin", json={"status": "checked_in"})
    assert back.status_code == 200, back.text


@pytest.mark.asyncio
async def test_back_from_no_show_without_limit_or_with_room(flow):
    """Ohne Höchstzahl keine Grenze. „Abgelehnt“ → bestätigt ist eine Freigabe wie von der Warteliste - die entscheidet die
    Leitung bewusst, auch wenn alles voll ist (#2368)."""
    tournament, regs, _waiting = await full_with_waitlist(flow)
    base = f"/api/tournaments/{tournament['id']}/registrations"
    rejected = await flow.register(tournament, await flow.add_user(name="Rita"), status="rejected")
    response = await flow.patch(f"{base}/{rejected['id']}", json={"status": "approved"})
    assert response.status_code == 200, response.text
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$unset": {"max_participants": ""}})
    await flow.post(f"{base}/{regs[0]['id']}/checkin", json={"status": "no_show"})
    response = await flow.post(f"{base}/{regs[0]['id']}/checkin", json={"status": "checked_in"})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_board_says_when_no_show_moves_someone_up(flow):
    """Review M2: der Reiter fragt vor „Nicht erschienen“, wenn dann jemand von der Warteliste nachrückt."""
    from routes.tournament_registration_routes import WAITLIST_MOVE_UP_STATUSES as ROUTE_STATUSES
    from services.tournament_checkin_board import WAITLIST_MOVE_UP_STATUSES

    assert set(WAITLIST_MOVE_UP_STATUSES) == set(ROUTE_STATUSES)
    tournament, _regs, waiting = await full_with_waitlist(flow)
    url = f"/api/tournaments/{tournament['id']}/lead/checkin"
    body = (await flow.get(url)).json()
    assert body["waitlist_moves_up"] is True
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_closed_at": "2026-11-14T18:00:00+00:00"}})
    body = (await flow.get(url)).json()
    assert body["waitlist_moves_up"] is False, "nach dem Check-in-Ende rückt niemand von selbst nach"
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$unset": {"check_in_closed_at": ""}})
    await flow.db.tournament_registrations.update_one({"id": waiting["id"]}, {"$set": {"status": "rejected"}})
    body = (await flow.get(url)).json()
    assert body["waitlist_moves_up"] is False, "ohne Warteliste keine Rückfrage"


@pytest.mark.asyncio
async def test_pending_needs_approval_before_checkin(flow):
    """Review M3: „Da“ bei „Freigabe offen“ ginge an Freigabe und Startgeld vorbei - der Check-in-Weg lehnt ab."""
    tournament = await flow.create_tournament(title="Freigabe-Cup", event_mode="local", status="check_in", max_participants=8)
    dora = await flow.register(tournament, await flow.add_user(name="Dora"), status="pending")
    flow.act_as(await assign(flow, tournament, "referee"))
    base = f"/api/tournaments/{tournament['id']}/registrations/{dora['id']}/checkin"
    response = await flow.post(base, json={"status": "checked_in"})
    assert response.status_code == 409, response.text
    assert response.json()["detail"].startswith("Erst freigeben")
    stored = await flow.db.tournament_registrations.find_one({"id": dora["id"]}, {"_id": 0, "status": 1, "checked_in_at": 1})
    assert stored == {"status": "pending"}
    # „Nicht erschienen“ geht weiter - und nach der Freigabe der Check-in.
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    approved = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{dora['id']}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    response = await flow.post(base, json={"status": "checked_in"})
    assert response.status_code == 200, response.text
