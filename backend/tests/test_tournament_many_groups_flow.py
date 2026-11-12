"""Viele Gruppen (#2216): Was die Auslosung anlegt, zeigen auch Gruppenliste und Tabelle.

Die Auslosung legt so viele Gruppen an, wie verlangt - höchstens eine je zwei Teilnehmer. Gruppenliste und Tabelle lasen
die Gruppen eines Turniers aber nur bis 50, Auszeichnungen, Profil, Event-Rückblick und Jahreswertung bis 100.
``to_list(n)`` liefert auf mongomock wie bei Motor höchstens n Einträge (#2357), der Fehler ist auf beiden Datenbanken zu sehen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

GROUPS = 60


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_list_and_table_show_every_drawn_group(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(GROUPS * 2, format="groups")
    drawn = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": GROUPS})
    assert drawn.status_code == 200, drawn.text
    assert drawn.json()["group_count"] == GROUPS

    listed = await flow.get(f"/api/tournaments/{tournament['id']}/groups")
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == GROUPS, "die Gruppenliste zeigt jede Gruppe"
    table = await flow.get(f"/api/tournaments/{tournament['id']}/standings")
    assert table.status_code == 200, table.text
    assert len(table.json()) == GROUPS, "die Tabelle hat eine Tabelle je Gruppe"
