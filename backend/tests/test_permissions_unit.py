"""Rollen und Rechte (#287): welche Bereiche eine Rolle hat, was sich vergeben lässt,
und wie ein fehlender Bereich benannt wird - ohne Datenbank."""
from services.permissions import (
    AREAS,
    GRANTABLE_AREAS,
    MFA_AREAS,
    area_labels,
    base_areas,
    clean_grants,
    missing_area_message,
    needs_mfa,
)


def test_roles_map_to_areas_not_to_a_ladder():
    assert base_areas({"role": "superadmin"}) == set(AREAS)
    assert base_areas({"role": "club_admin"}) == set(AREAS)
    assert base_areas({"role": "tournament_admin"}) == {"tournaments", "moderation"}
    assert base_areas({"role": "moderator"}) == {"moderation"}
    assert base_areas({"role": "player"}) == set()
    assert base_areas({"role": "team_leader"}) == set(), "die alte Rolle gibt keine Rechte mehr"
    assert base_areas(None) == set()


def test_grants_add_areas_but_never_system():
    assert base_areas({"role": "player", "areas": ["content"]}) == {"content"}
    assert base_areas({"role": "moderator", "areas": ["club", "system", "unsinn"]}) == {"moderation", "club"}
    assert clean_grants(["club", "content", "club", " tournaments ", "system", ""]) == ["tournaments", "content", "club"]
    assert clean_grants(None) == []
    assert "system" not in GRANTABLE_AREAS


def test_every_area_but_moderation_needs_a_second_factor():
    assert MFA_AREAS == {"tournaments", "content", "club", "finance", "system"}
    assert needs_mfa({"mfa_enabled": True, "auth_mfa_verified": True}) is False
    assert needs_mfa({"mfa_enabled": True, "auth_mfa_verified": False}) is True
    assert needs_mfa({}) is True
    assert needs_mfa(None) is True


def test_messages_name_the_area_in_german():
    assert missing_area_message(["content"]) == "Dafür fehlt der Bereich „Redaktion“. Vergeben kann ihn der Superadmin unter Admin → Alle Benutzer."
    assert missing_area_message(["tournaments", "moderation"]).startswith("Dafür fehlt der Bereich „Turnierleitung“ oder „Moderation“")
    assert area_labels({"club", "content"}) == "Redaktion, Vereinsverwaltung"
