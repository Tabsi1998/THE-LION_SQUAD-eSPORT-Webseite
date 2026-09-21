import inspect

from fastapi.params import Depends

from auth import get_optional_user
from routes import export_routes


STAFF_ONLY_EXPORTS = [
    export_routes.pdf_qr_sign_export,
    export_routes.pdf_tournament_participants,
    export_routes.pdf_tournament_checkin,
    export_routes.pdf_tournament_registration_qr,
    export_routes.pdf_tournament_matches,
    export_routes.pdf_tournament_station_signs,
]

PUBLIC_RESULT_EXPORTS = [
    export_routes.pdf_tournament_standings,
    export_routes.pdf_tournament_certificates,
    export_routes.pdf_tournament_certificate,
    export_routes.pdf_f1_lb,
    export_routes.pdf_f1_certificates,
    export_routes.pdf_f1_certificate,
    export_routes.pdf_f1_championship,
    export_routes.pdf_f1_championship_certificates,
    export_routes.pdf_f1_championship_certificate,
]


def _depends_parameter(endpoint, name):
    default = inspect.signature(endpoint).parameters[name].default
    assert isinstance(default, Depends)
    return default.dependency


def test_operational_pdf_exports_require_the_tournament_or_moderation_area():
    """Seit #287/#291: Bereich statt Rang - und weil „Turnierleitung“ dabei ist, mit Zwei-Faktor."""
    for endpoint in STAFF_ONLY_EXPORTS:
        dependency = _depends_parameter(endpoint, "me")
        closure_values = [cell.cell_contents for cell in (dependency.__closure__ or [])]

        assert ("tournaments", "moderation") in closure_values


def test_result_pdf_exports_are_optional_but_status_gated():
    for endpoint in PUBLIC_RESULT_EXPORTS:
        assert _depends_parameter(endpoint, "user") is get_optional_user
        assert "_result_export_allowed" in inspect.getsource(endpoint)


def test_tournament_result_exports_forward_access_and_user_to_standings():
    for endpoint in (
        export_routes.pdf_tournament_standings,
        export_routes.pdf_tournament_certificates,
        export_routes.pdf_tournament_certificate,
    ):
        signature = inspect.signature(endpoint)
        assert "access" in signature.parameters
        assert "access=access, user=user" in inspect.getsource(endpoint)


def test_pdf_filenames_use_safe_fallbacks():
    assert export_routes._pdf_filename_part("gamers-heaven", "t1") == "gamers-heaven"
    assert export_routes._pdf_filename_part("", "t1") == "t1"
    assert export_routes._pdf_filename_part(None, "", fallback="turnier") == "turnier"
    assert export_routes._pdf_filename("matches Gamers Heaven • Sonntag.pdf") == "matches_Gamers_Heaven_Sonntag.pdf"
