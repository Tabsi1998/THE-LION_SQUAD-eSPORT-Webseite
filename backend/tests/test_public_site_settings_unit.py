import asyncio
from types import SimpleNamespace

from fastapi import Response

import routes.extras_routes as extras_routes
from routes.setup_routes import _setup_checks
from services.public_site_settings import build_public_legal_settings, public_email, public_text


COMPLETE_BRANDING = {
    "id": "branding",
    "club_name": "THE LION SQUAD - eSPORTS",
    "domain": "https://lionsquad.at",
    "contact_email": "office@lionsquad.at",
    "privacy_contact_email": "dsgvo@lionsquad.at",
    "legal_name": "THE LION SQUAD - eSPORTS",
    "legal_form": "eingetragener Verein",
    "zvr_number": "1234567890",
    "street_address": "Vereinsstraße 1",
    "postal_code": "6410",
    "city": "Telfs",
    "state": "Tirol",
    "country": "Österreich",
    "registered_seat": "Telfs",
    "register_authority": "Bezirkshauptmannschaft Innsbruck",
    "representative_name": "Vereinsvertretung",
    "representative_role": "Obmann",
    "content_responsible": "Vereinsvertretung",
    "phone": "+43 123 456",
    "hosting_provider": "Eigenhosting",
    "hosting_country": "Österreich/EU",
    "updated_at": "2026-08-12T10:00:00+00:00",
}


def test_public_values_suppress_internal_and_reserved_placeholders():
    for value in (None, "", "Image: null", "TODO", "Noch im Adminbereich zu hinterlegen"):
        assert public_text(value) == ""
    for value in ("demo@example.com", "person@example.test", "not-an-email"):
        assert public_email(value) == ""
    assert public_email("office@lionsquad.at") == "office@lionsquad.at"


def test_canonical_contract_uses_configured_values_and_folds_legacy_text_once():
    branding = {
        **COMPLETE_BRANDING,
        "imprint": "Alter Zusatz",
        "legal_extra": "Alter Zusatz",
        "privacy_policy": "Bestehender Datenschutztext",
        "privacy_extra": "Neuer Zusatz",
    }

    result = build_public_legal_settings(branding)

    assert result["contact_email"] == "office@lionsquad.at"
    assert result["privacy_contact_email"] == "dsgvo@lionsquad.at"
    assert result["legal_extra"] == "Alter Zusatz"
    assert result["privacy_extra"] == "Neuer Zusatz\n\nBestehender Datenschutztext"
    assert result["legal_ready"] is True
    assert result["missing_legal_fields"] == []
    assert result["legal_updated_at"] == COMPLETE_BRANDING["updated_at"]


def test_missing_contact_is_not_replaced_with_a_fabricated_address():
    result = build_public_legal_settings({"club_name": "THE LION SQUAD", "contact_email": "demo@example.com"})

    assert result["contact_email"] == ""
    assert result["privacy_contact_email"] == ""
    assert result["contact_ready"] is False
    assert result["legal_ready"] is False
    assert "contact_email" in result["missing_legal_fields"]


def test_setup_health_uses_structured_legal_data_instead_of_legacy_free_text():
    checks = _setup_checks({"completed": True}, COMPLETE_BRANDING, {}, {}, True)
    by_key = {check["key"]: check for check in checks}
    assert by_key["legal"]["ok"] is True
    assert by_key["contact_email"]["ok"] is True

    legacy_only = {"club_name": "TLS", "domain": "https://lionsquad.at", "imprint": "Text", "privacy_policy": "Text"}
    legacy_checks = _setup_checks({"completed": True}, legacy_only, {}, {}, True)
    legacy_by_key = {check["key"]: check for check in legacy_checks}
    assert legacy_by_key["legal"]["ok"] is False
    assert legacy_by_key["contact_email"]["ok"] is False


class _SettingsCollection:
    async def find_one(self, *args, **kwargs):
        return {**COMPLETE_BRANDING, "imprint": "Nur einmal", "legal_extra": "Nur einmal"}


def test_public_endpoint_exposes_canonical_contract_without_legacy_fields(monkeypatch):
    monkeypatch.setattr(extras_routes, "get_db", lambda: SimpleNamespace(settings=_SettingsCollection()))

    payload = asyncio.run(extras_routes.public_settings(Response()))

    assert payload["contact_email"] == "office@lionsquad.at"
    assert payload["legal_extra"] == "Nur einmal"
    assert payload["legal_ready"] is True
    assert "imprint" not in payload
    assert "privacy_policy" not in payload
    assert "missing_legal_fields" not in payload
    assert "contact_ready" not in payload
