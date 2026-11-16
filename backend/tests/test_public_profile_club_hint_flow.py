"""Spielerprofil: Hinweis „Vereinsmitglied“ mit Link zum Vereinsprofil (#1267, Entscheidung 14.10.: kein Zusammenführen).

Das öffentliche Profil liefert ``club_profile_slug`` und die öffentliche Funktion (``club_role_title``) nur, wenn ein
aktives Vereinsprofil mit dem Konto verbunden ist - und nur bei öffentlichem Konto (sonst gibt es das Profil gar nicht).
Nichts Privates aus dem Vereinsprofil (Geburtstag, Zusatzfelder) geht mit."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def player(flow, name, *, public=True, member="active"):
    user = await flow.add_user(name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": public}})
    if member:
        await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": member, "membership_type": "ordinary"})
    return user


async def club_profile(flow, user, slug, **fields):
    doc = {"id": f"p-{slug}", "slug": slug, "user_id": user["id"] if user else None, "display_name": slug.title(),
           "role_title": "Mitglied", "is_active": True, "birth_date": "1990-01-01",
           "extra_fields": [{"label": "Telefon", "value": "0664 000"}], **fields}
    await flow.db.club_member_profiles.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_linked_public_account_carries_slug_and_public_role(flow):
    paula = await player(flow, "paula")
    await club_profile(flow, paula, "paula-p", role_title="Kassierin")
    flow.act_as(None)
    body = (await flow.get("/api/users/public/paula")).json()
    assert body["club_profile_slug"] == "paula-p"
    assert body["club_role_title"] == "Kassierin"
    text = str(body)
    assert "0664 000" not in text and "1990-01-01" not in text, "nichts Privates aus dem Vereinsprofil"


@pytest.mark.asyncio
async def test_board_function_wins_over_the_editorial_role(flow):
    max_ = await player(flow, "max")
    profile = await club_profile(flow, max_, "max-m", role_title="Mitglied", gender="male")
    await flow.db.board_positions.insert_one({"id": "bp-1", "title_male": "Obmann", "is_active": True, "order_index": 1,
                                             "user_id": profile["id"]})
    flow.act_as(None)
    body = (await flow.get("/api/users/public/max")).json()
    assert body["club_profile_slug"] == "max-m"
    assert body["club_role_title"] == "Obmann"


@pytest.mark.asyncio
async def test_no_hint_without_link_or_with_an_inactive_club_profile(flow):
    await player(flow, "lea")
    await club_profile(flow, None, "lea-ohne-konto")
    tom = await player(flow, "tom")
    await club_profile(flow, tom, "tom-alt", is_active=False)
    flow.act_as(None)
    for name in ("lea", "tom"):
        body = (await flow.get(f"/api/users/public/{name}")).json()
        assert body.get("club_profile_slug") is None and body.get("club_role_title") is None


@pytest.mark.asyncio
async def test_no_hint_after_the_membership_ended(flow):
    """Review #1267: Das redaktionelle Profil ist noch aktiv, die Mitgliedschaft aber zu Ende - kein „Vereinsmitglied“."""
    ex = await player(flow, "ex", member="former")
    await club_profile(flow, ex, "ex-e", role_title="Kassier")
    never = await player(flow, "nie", member=None)
    await club_profile(flow, never, "nie-n")
    flow.act_as(None)
    for name in ("ex", "nie"):
        body = (await flow.get(f"/api/users/public/{name}")).json()
        assert body["club_profile_slug"] is None and body["club_role_title"] is None, name


@pytest.mark.asyncio
async def test_private_account_shows_nothing(flow):
    ida = await player(flow, "ida", public=False)
    await club_profile(flow, ida, "ida-i")
    flow.act_as(None)
    response = await flow.get("/api/users/public/ida")
    assert response.status_code == 404
