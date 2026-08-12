import pytest
from pydantic import ValidationError

from routes.contact_board_routes import ContactSubmit
from routes.phase_c_routes import ApplyBody


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "  "),
        ("subject", " \n "),
        ("message", "     "),
    ],
)
def test_contact_rejects_required_text_that_is_only_whitespace(field, value):
    payload = {
        "name": "Test Person",
        "email": "person@example.com",
        "topic": "general",
        "subject": "Testanfrage",
        "message": "Eine echte Nachricht",
        "accept_privacy": True,
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        ContactSubmit(**payload)


def test_contact_normalizes_required_text_before_persisting():
    body = ContactSubmit(
        name="  Test Person  ",
        email="person@example.com",
        topic="general",
        subject="  Testanfrage  ",
        message="  Eine echte Nachricht  ",
        accept_privacy=True,
    )

    assert body.name == "Test Person"
    assert body.subject == "Testanfrage"
    assert body.message == "Eine echte Nachricht"


def test_membership_application_rejects_whitespace_motivation_and_bounds_notes():
    with pytest.raises(ValidationError):
        ApplyBody(
            motivation=" " * 30,
            contribution_pref="full",
            accept_statutes=True,
            accept_privacy=True,
        )

    with pytest.raises(ValidationError):
        ApplyBody(
            motivation="Ich möchte den Verein aktiv unterstützen.",
            contribution_pref="full",
            accept_statutes=True,
            accept_privacy=True,
            notes="x" * 2001,
        )


def test_membership_application_normalizes_optional_text():
    body = ApplyBody(
        motivation="  Ich möchte den Verein aktiv unterstützen.  ",
        contribution_pref="full",
        accept_statutes=True,
        accept_privacy=True,
        notes="   ",
    )

    assert body.motivation == "Ich möchte den Verein aktiv unterstützen."
    assert body.notes is None
