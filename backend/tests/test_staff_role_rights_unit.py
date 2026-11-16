"""Helfer-Rollen in Worten (#1384): Die Sätze kommen aus denselben Listen, die die Routen prüfen - und die Verwaltung zeigt
dieselben (frontend/src/lib/staffRoleRights.json). Ändert sich eine Liste am Server, schlägt dieser Test an."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import tournament_permissions as perms  # noqa: E402

SHARED = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "staffRoleRights.json"


def test_the_frontend_mirror_equals_the_server_lists():
    shared = json.loads(SHARED.read_text(encoding="utf-8"))
    assert [(row["key"], row["label"]) for row in shared["rights"]] == [(key, label) for key, label, _roles in perms.STAFF_RIGHTS]
    server = {role: [key for key, _label, roles in perms.STAFF_RIGHTS if role in roles] for role in perms.STAFF_ROLE_ORDER}
    assert shared["roles"] == server
    assert set(perms.STAFF_ROLE_ORDER) == perms.READ_STAFF_ROLES, "jede Rolle, die überhaupt etwas sieht, hat einen Satz"


def test_sentences_follow_what_the_routes_allow():
    assert perms.staff_role_sentence("scorekeeper") == "Darf hier: Teilnehmer, Ergebnisse und Check-in."
    assert "Ablauf und Baum" not in perms.staff_role_sentence("scorekeeper"), "den Baum nicht"
    assert perms.staff_role_sentence("organizer") == "Darf hier: Ablauf und Baum, Teilnehmer, Ergebnisse, Check-in und Stationen."
    assert perms.staff_role_sentence("stream_operator").startswith("Darf hier nur ansehen")
    for role in perms.STAFF_ROLE_ORDER:
        rights = perms.staff_role_rights(role)
        assert ("Ergebnisse" in rights) == (role in perms.RESULT_STAFF_ROLES)
        assert ("Ablauf und Baum" in rights) == (role in perms.STRUCTURE_STAFF_ROLES)
